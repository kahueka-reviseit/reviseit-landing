'use server';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { requireStudioEditor } from '../../../../lib/studio/server';
import { studioStorage } from '../../../../lib/studio/storage';
import { createUpload, finaliseUpload } from '../../../../lib/studio/uploads';
import { call, isSha256, isUuid, GATES, SOURCE_TYPES, StudioError } from '../../../../lib/studio/contracts';

/**
 * Studio administration commands. Each re-checks editor access, sends a fresh command key (or the
 * one the form carried, so a resubmitted form replays rather than repeats) and lets the database
 * function decide the transition. Errors are reported in plain words; nothing is retried silently.
 */
export type ActionResult = { ok: true; value?: unknown } | { ok: false; error: string };
const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof StudioError || e instanceof Error ? e.message.replace(/^.*?: /, '') : 'The request could not be completed.' });
const commandKey = (v: FormDataEntryValue | null) => typeof v === 'string' && isUuid(v) ? v : randomUUID();

export async function startUpload(input: { moduleId: string; sha256: string; size: number; mediaType: string; filename: string; command: string }): Promise<ActionResult> {
  try {
    const { rpc } = await requireStudioEditor(); const storage = studioStorage();
    if (!storage) return { ok: false, error: 'Studio storage is not configured.' };
    if (!isSha256(input.sha256) || !(SOURCE_TYPES as readonly string[]).includes(input.mediaType) || !isUuid(input.command)) return { ok: false, error: 'Check the selected file.' };
    return { ok: true, value: await createUpload(rpc, storage, { ...input, purpose: 'source' }) };
  } catch (e) { return fail(e); }
}
export async function finishUpload(sessionId: string): Promise<ActionResult> {
  try {
    const { verifiedRpc } = await requireStudioEditor(); const storage = studioStorage();
    if (!storage || !isUuid(sessionId)) return { ok: false, error: 'Studio storage is not configured.' };
    return { ok: true, value: await finaliseUpload(verifiedRpc, storage, sessionId) };
  } catch (e) { return fail(e); }
}
export async function createSource(form: FormData): Promise<ActionResult> {
  try {
    const { rpc } = await requireStudioEditor();
    const blobId = String(form.get('blobId') || ''), role = String(form.get('role') || 'combined');
    const r = await call(rpc, 'studio_create_source', { p_module: String(form.get('moduleId') || ''), p_title: String(form.get('title') || ''),
      p_files: [{ blobId, role, filename: String(form.get('filename') || 'source.pdf') }], p_identity: {}, p_command: commandKey(form.get('command')) });
    revalidatePath('/admin/studio'); return { ok: true, value: r };
  } catch (e) { return fail(e); }
}
export async function startRun(form: FormData) {
  const { rpc } = await requireStudioEditor();
  const options = await call<any>(rpc, 'studio_execution_options', {});
  if (!options.profiles.some((p: any) => p.id === form.get('profile')) || !options.skills.some((k: any) => k.id === form.get('skillContract'))) throw new StudioError('Choose a registered recorded runtime and analysis skill.');
  await call(rpc, 'studio_start_run', { p_source: String(form.get('sourceId')), p_expected_source_revision: Number(form.get('revision')), p_purpose: String(form.get('purpose')),
    p_snapshot: String(form.get('snapshotId')), p_skill_contract: String(form.get('skillContract')), p_profile: String(form.get('profile')), p_command: commandKey(form.get('command')) });
  revalidatePath('/admin/studio');
}
export async function recordDecision(form: FormData) {
  const { rpc } = await requireStudioEditor();
  const run = String(form.get('runId')), gate = String(form.get('gate'));
  if (!(GATES as readonly string[]).includes(gate)) throw new StudioError('Unknown review');
  const bound = String(form.get('bound') || '').split(',').filter(isUuid);
  await call(rpc, 'studio_record_decision', { p_run: run, p_gate: gate, p_expected_version: Number(form.get('version')), p_bound: bound, p_outcome: String(form.get('outcome')),
    p_rationale: String(form.get('rationale') || ''), p_authorisation: { provenance: String(form.get('provenance') || 'explicit_review'), reference: String(form.get('reference') || ''), scope: String(form.get('scope') || '') },
    p_items: JSON.parse(String(form.get('items') || '[]')), p_command: commandKey(form.get('command')) });
  revalidatePath(`/admin/studio/runs/${run}`);
}
export async function retryStage(form: FormData) {
  const { rpc } = await requireStudioEditor();
  await call(rpc, 'studio_retry_stage', { p_stage: String(form.get('stageId')), p_expected_attempts: Number(form.get('attempts')), p_reason: String(form.get('reason') || ''), p_command: commandKey(form.get('command')) });
  revalidatePath(`/admin/studio/runs/${String(form.get('runId'))}`);
}
export async function cancelStage(form: FormData) {
  const { rpc } = await requireStudioEditor();
  await call(rpc, 'studio_cancel_stage', { p_stage: String(form.get('stageId')), p_reason: String(form.get('reason') || 'Cancelled by an editor'), p_command: commandKey(form.get('command')) });
  revalidatePath(`/admin/studio/runs/${String(form.get('runId'))}`);
}

/** A request for corrections is distinct from approval and from retrying a failed call. */
export async function requestRevision(_previous: ActionResult | null, form: FormData): Promise<ActionResult> {
  try {
    const { rpc } = await requireStudioEditor();
    const run = String(form.get('runId'));
    const result = await call(rpc, 'studio_request_revision', {
      p_run: run, p_gate: String(form.get('gate')), p_expected_version: Number(form.get('version')),
      p_bound: String(form.get('bound') || '').split(',').filter(isUuid),
      p_instruction: String(form.get('instruction') || ''), p_command: commandKey(form.get('command')),
    });
    revalidatePath(`/admin/studio/runs/${run}`);
    return { ok: true, value: result };
  } catch (e) { return fail(e); }
}

/** A mark correction records no checkpoint approval and never changes source observations. */
export async function correctInventoryMarkAction(form: FormData): Promise<ActionResult> {
  try {
    const { rpc, verifiedRpc, user } = await requireStudioEditor();
    const storage = studioStorage();
    if (!storage) return { ok: false, error: 'Studio storage is not configured.' };
    const { saveInventoryMark } = await import('../../../../lib/studio/inventory-review');
    const raw = String(form.get('marks') ?? '').trim(), run = String(form.get('runId'));
    const value = await saveInventoryMark(rpc, verifiedRpc, storage, user.id, {
      runId: run, artifactId: String(form.get('artifactId')), expectedSha256: String(form.get('expectedSha256')),
      partId: String(form.get('partId')), marks: raw === '' ? null : Number(raw), reason: String(form.get('reason') || ''),
      command: String(form.get('command')), asOf: String(form.get('asOf')),
    });
    revalidatePath(`/admin/studio/runs/${run}`); revalidatePath(`/admin/studio/runs/${run}/inventory`);
    return { ok: true, value };
  } catch (e) { return fail(e); }
}

export async function reviewInventoryAction(form: FormData): Promise<ActionResult> {
  try {
    if (form.get('gate') !== 'G1_inventory' || form.get('reviewed') !== 'yes')
      return { ok: false, error: 'Confirm that you reviewed the inventory and its open issues.' };
    await recordDecision(form);
    revalidatePath(`/admin/studio/runs/${String(form.get('runId'))}/inventory`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Reviewer-authored cognitive classification; original extraction and marks remain intact. */
export async function correctInventoryCognitionAction(form: FormData): Promise<ActionResult> {
  try {
    const { rpc, verifiedRpc, user } = await requireStudioEditor();
    const storage = studioStorage();
    if (!storage) return { ok: false, error: 'Studio storage is not configured.' };
    const { saveInventoryCognition } = await import('../../../../lib/studio/inventory-review');
    if (form.has('level')) return { ok: false, error: "Refresh the review screen to use the Bloom's-only correction form." };
    const run = String(form.get('runId'));
    const value = await saveInventoryCognition(rpc, verifiedRpc, storage, user.id, {
      runId: run, artifactId: String(form.get('artifactId')), expectedSha256: String(form.get('expectedSha256')),
      partId: String(form.get('partId')), category: String(form.get('category') || '') || null,
      reason: String(form.get('reason') || ''), command: String(form.get('command')), asOf: String(form.get('asOf')),
    });
    revalidatePath(`/admin/studio/runs/${run}`); revalidatePath(`/admin/studio/runs/${run}/inventory`);
    return { ok: true, value };
  } catch (e) { return fail(e); }
}

/** Source notes are versioned evidence, not checkpoint approval. */
export async function addInventorySourceReviewAction(form: FormData): Promise<ActionResult> {
  try {
    const { rpc, verifiedRpc, user } = await requireStudioEditor();
    const storage = studioStorage();
    if (!storage) return { ok: false, error: 'Studio storage is not configured.' };
    const { saveInventorySourceReview } = await import('../../../../lib/studio/inventory-review');
    const run = String(form.get('runId'));
    const value = await saveInventorySourceReview(rpc, verifiedRpc, storage, user.id, {
      runId: run, artifactId: String(form.get('artifactId')), expectedSha256: String(form.get('expectedSha256')),
      partId: String(form.get('partId')), reason: String(form.get('reason') || ''),
      command: String(form.get('command')), asOf: String(form.get('asOf')),
    });
    revalidatePath(`/admin/studio/runs/${run}`); revalidatePath(`/admin/studio/runs/${run}/inventory`);
    return { ok: true, value };
  } catch (e) { return fail(e); }
}
