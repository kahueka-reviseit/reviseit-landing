/**
 * Strict headline coverage (addendum C05), computed only from reviewed items. Semantic labels and
 * resolution status are separate fields: unresolved, evidence-blocked and unmapped are never labels.
 *
 * A leaf is fully covered only when a reviewed, sufficient solution path covers all of its assessed
 * work with resolved EXACT or VARIANT components. A required EXACT plus a required NEAR is partial and
 * earns zero marks. A fully covered leaf earns its printed marks once, however many components or
 * alternative paths cover it. No fractional marks are invented. The denominator is every inventoried
 * printed mark; leaves without review or without printed marks are reported, not dropped.
 */
export const TASK_LABELS = ['EXACT', 'VARIANT', 'NEAR', 'NOVEL'] as const;
export const SPEC_LABELS = ['EXACT', 'CLOSE', 'PARTIAL', 'NONE'] as const;
export const STATUSES = ['resolved', 'unresolved', 'evidence_blocked', 'unmapped'] as const;
export type TaskLabel = typeof TASK_LABELS[number];
export type Component = { id: string; label: TaskLabel | null; status: typeof STATUSES[number]; recordRef?: { moduleId: string; kind: 'task_type'; id: string; parentId?: string } | null };
export type SolutionPath = { components: string[]; sufficient: boolean; role?: 'required' | 'alternative' };
export type LeafReview = { leafId: string; reviewed: boolean; components: Component[]; paths: SolutionPath[]; hardNegatives?: string[] };
export type InventoryLeaf = { id: string; marks: number | null; format: 'structured' | 'multiple_choice'; question: string };
export type QuestionMatch = { question: string; reviewed: boolean; label: typeof SPEC_LABELS[number] | null; status: typeof STATUSES[number] };

export function checkReview(r: LeafReview) {
  const ids = new Set(r.components.map(c => c.id));
  for (const c of r.components) {
    if (c.label !== null && !(TASK_LABELS as readonly string[]).includes(c.label)) throw new Error(`Invalid task label ${c.label}`);
    if (!(STATUSES as readonly string[]).includes(c.status)) throw new Error(`Invalid status ${c.status}`);
    if (c.status === 'resolved' && c.label === null) throw new Error('A resolved component needs a semantic label');
    if (c.label === 'NOVEL' && c.recordRef) throw new Error('A NOVEL component has no existing record reference');
  }
  for (const p of r.paths) for (const id of p.components) if (!ids.has(id)) throw new Error(`Path references unknown component ${id}`);
}

export type LeafOutcome = 'full' | 'partial' | 'none' | 'unreviewed';
export function leafOutcome(r: LeafReview | undefined): LeafOutcome {
  if (!r || !r.reviewed) return 'unreviewed';
  checkReview(r);
  const byId = new Map(r.components.map(c => [c.id, c]));
  const strong = (id: string) => { const c = byId.get(id)!; return c.status === 'resolved' && (c.label === 'EXACT' || c.label === 'VARIANT'); };
  if (r.paths.some(p => p.sufficient && p.components.length > 0 && p.components.every(strong))) return 'full';
  if (r.components.some(c => c.status === 'resolved' && (c.label === 'EXACT' || c.label === 'VARIANT' || c.label === 'NEAR'))) return 'partial';
  return 'none';
}

export function taskCoverage(leaves: InventoryLeaf[], reviews: LeafReview[]) {
  const byLeaf = new Map(reviews.map(r => [r.leafId, r]));
  let numerator = 0, denominator = 0;
  const partial: string[] = [], unreviewed: string[] = [], missingMarks: string[] = [], full: string[] = [];
  for (const leaf of leaves) {
    if (leaf.marks === null) { missingMarks.push(leaf.id); continue; }
    denominator += leaf.marks;
    const o = leafOutcome(byLeaf.get(leaf.id));
    if (o === 'full') { numerator += leaf.marks; full.push(leaf.id); }
    else if (o === 'partial') partial.push(leaf.id);
    else if (o === 'unreviewed') unreviewed.push(leaf.id);
  }
  return { numerator, denominator, full, partial, unreviewed, missingMarks };
}

export function specificationCoverage(questions: QuestionMatch[]) {
  const structured = questions.length;
  if (structured === 0) return { numerator: 0, denominator: 0, value: 'not_applicable' as const, unreviewed: [] as string[] };
  const counted = questions.filter(q => q.reviewed && q.status === 'resolved' && (q.label === 'EXACT' || q.label === 'CLOSE'));
  return { numerator: counted.length, denominator: structured, value: counted.length / structured, unreviewed: questions.filter(q => !q.reviewed).map(q => q.question) };
}
