import { call, isUuid, isSha256, sha256, StudioError, type Rpc } from './contracts';
import { finaliseUpload, readArtifact } from './uploads';
import { COGNITIVE_CATEGORIES } from './cognitive-classification';
import type { StudioStorage } from './storage/types';

export type MarkCorrection = { runId: string; artifactId: string; expectedSha256: string; partId: string; marks: number | null; reason: string; command: string; asOf: string };

/** Narrow edit: only the selected assessed mark changes. Original observations remain evidence. */
export function correctInventoryMark(inventory: any, input: MarkCorrection, actor: string) {
  if (!isUuid(input.runId) || !isUuid(input.artifactId) || !isUuid(input.command) || !isUuid(actor) || !isSha256(input.expectedSha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf)) || input.asOf > new Date().toISOString().slice(0, 10)
    || typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000
    || (input.marks !== null && (typeof input.marks !== 'number' || !Number.isFinite(input.marks) || input.marks < 0 || input.marks > 1000)))
    throw new StudioError('Enter a valid mark and a reason of at least ten characters.');
  if (!Array.isArray(inventory?.questions) || !inventory.meta || !inventory.source_sha256) throw new StudioError('This inventory format cannot be edited here.');
  const next = structuredClone(inventory);
  const parts = next.questions.flatMap((q: any) => q.sub_questions || []).filter((p: any) => p.id === input.partId);
  if (parts.length !== 1) throw new StudioError('The assessed part is missing or ambiguous.');
  const part = parts[0];
  if (part.marks === input.marks) throw new StudioError('The mark is unchanged.');
  if (!Array.isArray(part.source_observations) || !part.source_observations.length) throw new StudioError('Source observations are required before a mark can be corrected.');
  const correction = { command: input.command, part_id: part.id, source_id: part.source_id, source_page: part.source_page,
    previous_marks: part.marks, corrected_marks: input.marks, reason: input.reason.trim(), recorded_by: actor,
    date: input.asOf, parent_artifact_id: input.artifactId, parent_sha256: input.expectedSha256, provenance: 'editor_correction' };
  next.human_mark_corrections = [...(next.human_mark_corrections || []), correction];
  next.meta.last_updated = input.asOf;
  part.marks = input.marks;
  // Do not rewrite source_content, source_observations, flags, cognitive labels or provider evidence.
  return next;
}

export type CognitiveCorrection = Omit<MarkCorrection, 'marks'> & { category: string | null };

export function correctInventoryCognition(inventory: any, input: CognitiveCorrection, actor: string) {
  if (!isUuid(input.runId) || !isUuid(input.artifactId) || !isUuid(input.command) || !isUuid(actor) || !isSha256(input.expectedSha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf)) || input.asOf > new Date().toISOString().slice(0,10)
    || typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000)
    throw new StudioError('Enter a classification and a reason of at least ten characters.');
  if ('level' in input) throw new StudioError("Use the Bloom's-only form. Refresh the review screen.");
  if (input.category !== null && !(COGNITIVE_CATEGORIES as readonly string[]).includes(input.category))
    throw new StudioError("Choose a Bloom's level, or leave it unresolved.");
  if (!Array.isArray(inventory?.questions) || !inventory.meta || !inventory.source_sha256) throw new StudioError('This inventory format cannot be edited here.');
  const next = structuredClone(inventory), parts = next.questions.flatMap((q: any) => q.sub_questions || []).filter((p: any) => p.id === input.partId);
  if (parts.length !== 1) throw new StudioError('The assessed part is missing or ambiguous.');
  const part = parts[0];
  const previous = { taxonomy_description: part.taxonomy_description ?? null,
    classification_reason: part.classification_reason ?? '', classification_provenance: part.classification_provenance ?? 'unresolved' };
  const corrected = { taxonomy_description: input.category,
    classification_reason: input.reason.trim(), classification_provenance: input.category === null ? 'unresolved' : 'reviewer_judgement' };
  if (JSON.stringify(previous) === JSON.stringify(corrected)) throw new StudioError('The classification and reason are unchanged.');
  next.human_cognitive_corrections = [...(next.human_cognitive_corrections || []), {
    command: input.command, part_id: part.id, source_id: part.source_id, source_page: part.source_page,
    previous, corrected, reason: input.reason.trim(), recorded_by: actor, date: input.asOf,
    parent_artifact_id: input.artifactId, parent_sha256: input.expectedSha256, provenance: 'editor_correction',
  }];
  next.meta.last_updated = input.asOf;
  // Any historical curriculum_level is source data: never infer or edit it from Bloom's.
  Object.assign(part, corrected);
  return next;
}

export type SourceReviewNote = Omit<MarkCorrection, 'marks'>;
/** Retain editorial findings in the inventory consumed by matching and drafting. */
export function addInventorySourceReview(inventory: any, input: SourceReviewNote, actor: string) {
  if (!isUuid(input.runId) || !isUuid(input.artifactId) || !isUuid(input.command) || !isUuid(actor) || !isSha256(input.expectedSha256)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || !Number.isFinite(Date.parse(input.asOf)) || input.asOf > new Date().toISOString().slice(0,10)
    || typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 2000)
    throw new StudioError('Enter a source finding of ten to two thousand characters.');
  if (!Array.isArray(inventory?.questions) || !inventory.meta || !inventory.source_sha256) throw new StudioError('This inventory format cannot be edited here.');
  const next = structuredClone(inventory), parts = next.questions.flatMap((q: any) => q.sub_questions || []).filter((p: any) => p.id === input.partId);
  if (parts.length !== 1) throw new StudioError('The assessed part is missing or ambiguous.');
  const part = parts[0];
  if ((part.source_review_notes || []).length >= 30) throw new StudioError('This part has reached its source-note limit.');
  part.source_review_notes = [...(part.source_review_notes || []), {
    command: input.command, part_id: part.id, source_id: part.source_id, source_page: part.source_page,
    reason: input.reason.trim(), recorded_by: actor, date: input.asOf,
    parent_artifact_id: input.artifactId, parent_sha256: input.expectedSha256, provenance: 'editor_note',
  }];
  next.meta.last_updated = input.asOf;
  return next;
}
export function saveInventorySourceReview(rpc: Rpc, verifiedRpc: Rpc, storage: StudioStorage, actor: string, input: SourceReviewNote) {
  return saveInventoryCorrection(rpc, verifiedRpc, storage, actor, input, addInventorySourceReview, 'Source review');
}

export function saveInventoryMark(rpc: Rpc, verifiedRpc: Rpc, storage: StudioStorage, actor: string, input: MarkCorrection) {
  return saveInventoryCorrection(rpc, verifiedRpc, storage, actor, input, correctInventoryMark, 'Marks');
}
export function saveInventoryCognition(rpc: Rpc, verifiedRpc: Rpc, storage: StudioStorage, actor: string, input: CognitiveCorrection) {
  return saveInventoryCorrection(rpc, verifiedRpc, storage, actor, input, correctInventoryCognition, 'Cognitive classification');
}
/** Authenticated editor RPC performs revision CAS, invalidation and audit in one transaction. */
async function saveInventoryCorrection<T extends Omit<MarkCorrection, 'marks'>>(rpc: Rpc, verifiedRpc: Rpc, storage: StudioStorage, actor: string, input: T, correct: (inventory: any, input: T, actor: string) => any, field: string) {
  const { info, bytes } = await readArtifact(rpc, storage, input.artifactId);
  if (info.runId !== input.runId || info.kind !== 'inventory' || info.logicalKey !== 'inventory' || info.sha256 !== input.expectedSha256)
    throw new StudioError('Inventory binding changed. Refresh and review the current revision.');
  const next = correct(JSON.parse(new TextDecoder().decode(bytes)), input, actor);
  const data = Buffer.from(JSON.stringify(next)), digest = sha256(data);
  const run = await call<any>(rpc, 'studio_run_view', { p_run: input.runId });
  const old = run.artifacts.find((a: any) => a.id === input.artifactId);
  // A repeated request can replay, but a stale competing edit fails before uploading bytes.
  if (old?.state !== 'current' && !run.artifacts.some((a: any) => a.kind === 'inventory' && a.sha256 === digest))
    throw new StudioError('Inventory revision changed. Refresh before correcting it.');
  if (run.run.state !== 'active') throw new StudioError('This run is no longer active.');
  const uploadHash = sha256('inventory-upload:' + input.command);
  const uploadCommand = `${uploadHash.slice(0,8)}-${uploadHash.slice(8,12)}-4${uploadHash.slice(13,16)}-8${uploadHash.slice(17,20)}-${uploadHash.slice(20,32)}`;
  const upload = await call<any>(rpc, 'studio_create_upload', { p_module: info.moduleId, p_sha256: digest, p_size: data.length,
    p_media_type: 'application/json', p_filename: 'inventory-correction.json', p_purpose: 'revision', p_command: uploadCommand });
  const session = await call<any>(rpc, 'studio_upload_session', { p_session: upload.sessionId });
  if (session.state === 'open') await storage.put(upload.provisionalKey, data, 'application/json');
  const result = await finaliseUpload(verifiedRpc, storage, upload.sessionId);
  if (result.state !== 'finalised') throw new StudioError('Correction bytes could not be verified. Refresh before trying again.');
  return call(rpc, 'studio_revise_artifact', { p_artifact: input.artifactId, p_blob: result.blobId,
    p_rationale: `${field === 'Marks' ? 'Part' : field + ' for part'} ${input.partId}: ${input.reason.trim()}`, p_command: input.command });
}

export function inventorySummary(inventory: any) {
  const leaves = inventory.questions.flatMap((q: any) => q.sub_questions);
  return { questions: inventory.questions.length, parts: leaves.length, marks: leaves.reduce((n: number, p: any) => n + (p.marks ?? 0), 0),
    unknownMarks: leaves.filter((p: any) => p.marks === null).length,
    unresolvedClassifications: leaves.filter((p: any) => !(COGNITIVE_CATEGORIES as readonly string[]).includes(p.taxonomy_description)).length,
    printedTotal: inventory.paper_metadata.total_marks };
}

/** Only the hash-verified PNG embedded in a page artifact can be displayed inline. */
export function sourcePagePng(info: any, bytes: Uint8Array) {
  if (info.kind !== 'page_text' || bytes.length > 1_500_000) throw new StudioError('Not a source page.');
  const page = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof page.render !== 'string') throw new StudioError('Source page image unavailable.');
  const png = Buffer.from(page.render, 'base64');
  if (!png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || sha256(png) !== page.render_sha256)
    throw new StudioError('Source image failed its integrity check.', 'integrity');
  return png;
}
