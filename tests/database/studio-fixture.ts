// Shared synthetic fixture for the Curriculum Studio foundation tests. Runs the real migration stack
// in PGlite and calls the Studio functions by name, exactly as the Supabase client's rpc would.
// Identities, curriculum records and documents are synthetic. No storage or provider credentials.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Rpc } from '../../lib/studio/contracts';

import { verifiedUploadRpc } from '../../lib/studio/uploads';
const trusted = new WeakMap<Rpc, Rpc>();
export function verified(rpc: Rpc): Rpc { const result = trusted.get(rpc); if (!result) throw new Error('Not an editor test session'); return result; }

export const ids = {
  editor: '00000000-0000-4000-8000-0000000000e1', editor2: '00000000-0000-4000-8000-0000000000e2',
  outsider: '00000000-0000-4000-8000-0000000000e3', teacher: '00000000-0000-4000-8000-0000000000e4',
};
export const MODULE = 'studio-synthetic', OTHER = 'studio-other';
export const SKILL = 'past-paper-analysis@2026-10-07', PROFILE = 'mock-v0';
export const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
export const AUTH = { provenance: 'explicit_review', reference: 'Synthetic test review', scope: 'This synthetic run only' };

export type Actor = { kind: 'user'; id: string } | { kind: 'service' } | { kind: 'operator' } | { kind: 'anon' } | { kind: 'owner' };
export class StudioDb {
  db = new PGlite();
  private types = new Map<string, { names: string[]; types: string[] }>();
  private queue: Promise<unknown> = Promise.resolve();
  private tx = false;
  private n = 0;
  /** Run one statement group; inside a test transaction, a savepoint keeps an expected error from aborting it. */
  private async guarded<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.tx) return fn();
    const sp = 'sp' + (++this.n);
    await this.db.exec('savepoint ' + sp);
    try { const r = await fn(); await this.db.exec('release savepoint ' + sp); return r; }
    catch (e) { await this.db.exec('rollback to savepoint ' + sp); throw e; }
  }
  begin() { return this.serial(async () => { await this.db.exec('begin'); this.tx = true; }); }
  rollback() { return this.serial(async () => { this.tx = false; await this.db.exec('rollback; reset role'); }); }
  private serial<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }
  async init() {
    await this.db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,public to authenticated,anon,service_role;grant execute on function auth.uid() to authenticated,anon;`);
    for (const f of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) await this.db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
    const r = await this.db.query<{ proname: string; names: string[] | null; types: string[] }>(`select p.proname, p.proargnames names, array(select format_type(t,null) from unnest(p.proargtypes) t) types
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'studio\\_%'`);
    for (const row of r.rows) this.types.set(row.proname, { names: row.names || [], types: row.types });
    for (const id of Object.values(ids)) await this.db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, id + '@synthetic.example']);
    for (const id of [ids.editor, ids.editor2, ids.outsider]) await this.db.query('insert into private.account_reviewers values($1)', [id]);
    for (const id of [ids.editor, ids.editor2]) await this.db.query('insert into private.studio_editors(user_id) values($1)', [id]);
    await this.db.query(`insert into public.curriculum_modules(id,name,current_release) values('${MODULE}','Synthetic Studio module','1'),('${OTHER}','Other synthetic module','1')`);
  }
  private async as(actor: Actor) {
    await this.db.exec('reset role');
    await this.db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor.kind === 'user' ? actor.id : '']);
    if (actor.kind === 'user') await this.db.exec('set role authenticated');
    else if (actor.kind === 'service') await this.db.exec('set role service_role');
    else if (actor.kind === 'operator') await this.db.exec('set role reviseit_studio_operator');
    else if (actor.kind === 'anon') await this.db.exec('set role anon');
  }
  rpc(actor: Actor): Rpc {
    const rpc: Rpc = (name, args) => {
      const run = async () => {
        const t = this.types.get(name);
        if (!t) return { data: null, error: { message: `function public.${name} does not exist` } };
        const keys = Object.keys(args), params: unknown[] = [];
        const sql = keys.map((k, i) => {
          const at = t.names.indexOf(k); if (at < 0) throw new Error(`Unknown argument ${k} for ${name}`);
          const type = t.types[at], v = args[k];
          params.push(v === null || v === undefined ? null : type === 'jsonb' ? JSON.stringify(v) : type.endsWith('[]') ? `{${(v as unknown[]).join(',')}}` : v);
          return `${k}=>$${i + 1}::${type}`;
        });
        try { return await this.guarded(async () => { await this.as(actor); const r = await this.db.query<{ r: unknown }>(`select public.${name}(${sql.join(',')}) as r`, params); await this.db.exec('reset role'); return { data: r.rows[0].r, error: null }; }); }
        catch (e: any) { return { data: null, error: { message: String(e?.message || e) } }; }
        finally { await this.db.exec('reset role'); }
      };
      return this.serial(run);
    };
    if (actor.kind === 'user') trusted.set(rpc, verifiedUploadRpc(rpc, this.rpc({kind:'service'}), actor.id));
    return rpc;
  }
  async sql<T = any>(text: string, params: unknown[] = [], role?: string) {
    return this.serial(async () => {
      try { return await this.guarded(async () => { await this.db.exec('reset role'); if (role) await this.db.exec('set role ' + role); return (await this.db.query<T>(text, params)).rows; }); }
      finally { await this.db.exec('reset role'); }
    });
  }
  close() { return this.db.close(); }
}

export async function ok<T = any>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc(name, args); if (r.error) throw new Error(`${name}: ${r.error.message}`); return r.data as T;
}
export async function refused(rpc: Rpc, name: string, args: Record<string, unknown>) {
  const r = await rpc(name, args); if (!r.error) throw new Error(`${name} unexpectedly succeeded: ${JSON.stringify(r.data)}`); return r.error.message;
}
export const key = () => randomUUID();

/** Simulates the trusted server path for a verified upload (the storage half is tested separately). */
export async function blob(rpc: Rpc, module: string, content: string, type = 'application/pdf', purpose: 'source' | 'revision' = 'source') {
  const bytes = type === 'application/pdf' ? '%PDF-1.7 synthetic ' + content : content;
  const digest = sha(bytes), size = Buffer.byteLength(bytes);
  const s = await ok(rpc, 'studio_create_upload', { p_module: module, p_sha256: digest, p_size: size, p_media_type: type, p_filename: 'synthetic.' + (type === 'application/pdf' ? 'pdf' : 'md'), p_purpose: purpose, p_command: key() });
  await ok(verified(rpc), 'studio_prepare_commit', { p_session: s.sessionId, p_sha256: digest, p_size: size, p_detected_type: type });
  const c = await ok(verified(rpc), 'studio_commit_upload', { p_session: s.sessionId });
  return c.blobId as string;
}

export type BankFile = { path: string; content: string; record?: { kind: string; id: string; parent?: string }; requires?: string[] };
export const baseBank: BankFile[] = [
  { path: 'data/reference/curriculum-policy.md', content: '# Synthetic policy v1', record: { kind: 'reference', id: 'curriculum-policy' } },
  { path: 'data/task-types/physics/PHYS_01_Synthetic_Motion.md', content: '# PHYS_01 synthetic motion\n- 1A: synthetic variant', record: { kind: 'task_type', id: 'PHYS_01' } },
  { path: 'data/task-types/physics/PHYS_02_Synthetic_Force.md', content: '# PHYS_02 synthetic force', record: { kind: 'task_type', id: 'PHYS_02' } },
  { path: 'data/specs/paper-1-physics/SPEC_P1_PHYS_01_Synthetic.md', content: '# Spec P1-PHYS-01 uses PHYS_01', record: { kind: 'specification', id: 'P1-PHYS-01' }, requires: ['PHYS_01'] },
  { path: 'data/archive/OLD_Synthetic.md', content: '# archived' },
];
export function manifestSha(module: string, files: { path: string; sha256: string }[]) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  return sha(JSON.stringify({ files: Object.fromEntries(sorted.map(f => [f.path, f.sha256])), module, schema: 'reviseit/studio-bank-manifest@1' }));
}
export function snapshotPayload(module: string, bank: BankFile[]) {
  const files = bank.map(f => ({ path: f.path, sha256: sha(f.content), size: Buffer.byteLength(f.content), mediaType: 'text/markdown' }));
  const records = bank.filter(f => f.record).flatMap(f => [{ recordKind: f.record!.kind, recordId: f.record!.id, path: f.path, sha256: sha(f.content) },
    ...(f.record!.kind === 'task_type' ? [{ recordKind: 'task_variant', recordId: f.record!.id.replace(/^\D+_0?/, '') + 'A', parentRecordId: f.record!.id, path: f.path, sha256: sha(f.content) }] : [])]);
  const links = bank.flatMap(f => (f.requires || []).map(t => ({ fromKind: f.record!.kind, fromId: f.record!.id, toKind: 'task_type', toId: t, required: true })));
  return { files, records, links, manifest: manifestSha(module, files) };
}
export async function importSnapshot(op: Rpc, module: string, bank: BankFile[], opts: { origin?: string; purpose?: string; accept?: boolean; parent?: string | null } = {}) {
  const p = snapshotPayload(module, bank);
  const r = await ok(op, 'studio_register_snapshot', { p_module: module, p_manifest_sha256: p.manifest, p_files: p.files, p_records: p.records, p_links: p.links,
    p_origin: opts.origin ?? 'operator_import', p_purpose: opts.purpose ?? 'canonical', p_parent: opts.parent ?? null, p_changeset: null, p_created_by: 'synthetic-operator' });
  if (opts.accept !== false && (opts.purpose ?? 'canonical') === 'canonical') {
    const m = await ok(op, 'studio_storage_inventory', {});
    void m;
  }
  return { snapshotId: r.snapshotId as string, manifest: p.manifest };
}
export async function accept(op: Rpc, module: string, snapshot: string, previous: string | null) {
  return ok(op, 'studio_accept_snapshot', { p_module: module, p_snapshot: snapshot, p_expected_previous: previous });
}

/** A fake worker step: claim the next stage, persist outputs, complete. Returns the claim. */
export async function work(svc: Rpc, outputs: { key: string; kind: string; content: string; record?: Record<string, string>; meta?: Record<string, unknown>; media?: string }[] = [], expectKey?: string) {
  const c = await ok(svc, 'studio_claim', { p_worker: 'synthetic-worker' });
  if (!c) throw new Error('Nothing to claim');
  if (expectKey && c.stageKey !== expectKey) throw new Error(`Claimed ${c.stageKey}, expected ${expectKey}`);
  const made: string[] = [];
  for (const o of outputs) {
    const r = await ok(svc, 'studio_put_output', { p_attempt: c.attemptId, p_lease: c.lease, p_logical_key: o.key, p_kind: o.kind, p_sha256: sha(o.content), p_size: Buffer.byteLength(o.content),
      p_media_type: o.media || 'application/json', p_schema: null, p_record: o.record ?? null, p_meta: o.meta ?? {}, p_provider_attempt: null });
    made.push(r.artifactId);
  }
  return { claim: c, made };
}
export async function complete(svc: Rpc, claim: any, made: string[]) {
  return ok(svc, 'studio_complete', { p_attempt: claim.attemptId, p_lease: claim.lease, p_outputs: made });
}
export async function gate(rpc: Rpc, run: string, g: string, outcome = 'approved', items: unknown[] = [], rationale = 'Synthetic reviewed evidence') {
  const v = await ok(rpc, 'studio_gate_view', { p_run: run, p_gate: g });
  return ok(rpc, 'studio_record_decision', { p_run: run, p_gate: g, p_expected_version: v.version, p_bound: (v.binding?.artifacts || []).map((a: any) => a.id),
    p_outcome: outcome, p_rationale: rationale, p_authorisation: AUTH, p_items: items, p_command: key() });
}
