import { call, sha256, type Rpc } from './contracts';
import type { StudioStorage } from './storage/types';

/**
 * Orphan and integrity reconciliation (C02). Runs with the service session. It never deletes a
 * referenced blob: every deletion first takes a database claim that rechecks references and blocks
 * a concurrent finalisation of the same key. Objects younger than the grace period are kept, because
 * a writer may have stored bytes and not yet committed the reference. Automatic production cleanup is
 * outside this slice: deleteOrphans defaults to false (report only).
 */
export type ReconcileReport = {
  expiredSessions: number; orphans: string[]; deleted: string[]; keptYoung: string[]; refused: string[];
  missing: string[]; corrupt: string[]; finishedClaims: string[];
};
export async function reconcileStorage(rpc: Rpc, storage: StudioStorage, options: { graceMs?: number; now?: Date; deleteOrphans?: boolean; verifyBytes?: boolean } = {}): Promise<ReconcileReport> {
  const grace = options.graceMs ?? 24 * 3600 * 1000, now = options.now ?? new Date();
  const report: ReconcileReport = { expiredSessions: 0, orphans: [], deleted: [], keptYoung: [], refused: [], missing: [], corrupt: [], finishedClaims: [] };
  report.expiredSessions = await call<number>(rpc, 'studio_expire_uploads', {});
  const inventory = await call<{ blobs: { id: string; key: string; sha256: string; size: number; integrity: string }[]; sessions: { key: string; state: string }[]; claims: { key: string }[] }>(rpc, 'studio_storage_inventory', {});
  // Complete claims interrupted between claim and finish.
  for (const c of inventory.claims) {
    if (options.deleteOrphans) { await storage.delete(c.key); await call(rpc, 'studio_gc_finish', { p_key: c.key }); report.finishedClaims.push(c.key); }
  }
  const blobs = new Map(inventory.blobs.map(b => [b.key, b]));
  const listed = await storage.list('studio/');
  const present = new Set(listed.map(o => o.key));
  for (const o of listed) {
    if (blobs.has(o.key)) continue;
    const session = inventory.sessions.find(s => s.key === o.key);
    if (session && (session.state === 'open' || session.state === 'verifying')) continue;
    report.orphans.push(o.key);
    if (now.getTime() - o.lastModified.getTime() < grace) { report.keptYoung.push(o.key); continue; }
    if (!options.deleteOrphans) continue;
    if (await call<boolean>(rpc, 'studio_gc_claim', { p_key: o.key })) {
      await storage.delete(o.key); await call(rpc, 'studio_gc_finish', { p_key: o.key }); report.deleted.push(o.key);
    } else report.refused.push(o.key);
  }
  for (const b of inventory.blobs) {
    if (b.integrity !== 'verified') continue;
    if (!present.has(b.key)) {
      report.missing.push(b.key);
      await call(rpc, 'studio_worker_report_integrity', { p_blob: b.id, p_state: 'missing', p_detail: 'Absent from storage listing during reconciliation' });
    } else if (options.verifyBytes) {
      const bytes = await storage.get(b.key);
      if (!bytes || bytes.length !== b.size || sha256(bytes) !== b.sha256) {
        report.corrupt.push(b.key);
        await call(rpc, 'studio_worker_report_integrity', { p_blob: b.id, p_state: bytes ? 'corrupt' : 'missing', p_detail: 'Reconciliation digest check failed' });
      }
    }
  }
  return report;
}
