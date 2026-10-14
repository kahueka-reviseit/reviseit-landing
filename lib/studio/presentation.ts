/** Read-only presentation helpers. Never infer a human approval from a succeeded stage. */
export const moduleLabel = (id: string) => id.replace(/^caps-/, '').split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
export const money = (micro: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 }).format(micro / 1_000_000);
export const checkpointSteps = [
  { gate: 'G1_inventory', title: 'Inventory and source identity', work: 'S1 · Extract inventory', stages: ['S1_extract'], detail: 'Review marks, Bloom’s levels and source uncertainties.' },
  { gate: 'G2_matches', title: 'Review matches', work: 'S2–S3 · Match tasks and specifications', stages: ['S2_task_match','S3_spec_match'], detail: 'Agree existing types, variants and proposed gaps.' },
  { gate: 'G3_records', title: 'Review drafted records', work: 'S4–S6 · Prioritise, draft and validate', stages: ['S4_prioritise','S5_draft','S6_assemble_validate'], detail: 'Read the proposed records and bank checks.' },
  { gate: 'G4_content', title: 'Content judgments', work: 'Human content review', stages: [], detail: 'Resolve the scientific and curriculum decisions.' },
  { gate: 'G5_integration', title: 'Authorise bank integration', work: 'S7 · Prepare evidence package', stages: ['S7_package'], detail: 'Review the exact bank changes. Publication is separate.' },
] as const;
export function checkpointStatus(view: any, decisions: any[] = [], gate?: string) {
  if (!view) return 'Status unavailable';
  if (view.live) return 'Approved';
  if (decisions.some(d => d.gate === gate && d.invalidated_at && d.outcome === 'approved')) return 'Review out of date';
  if (view.binding && view.previousApproved) return 'Needs review';
  return 'Waiting';
}
export function queueStatus(stages: Record<string,string>, gates: any[], state = 'active') {
  if (state !== 'active') return state === 'completed' ? 'Completed' : state === 'cancelled' ? 'Cancelled' : state;
  if (Object.values(stages).includes('running')) return 'Running';
  if (Object.values(stages).some(s => ['failed','uncertain','blocked'].includes(s))) return 'Blocked';
  if (gates.some(g => !g)) return 'Status unavailable';
  if (gates.some(g => g?.binding && g.previousApproved && !g.live)) return 'Needs review';
  if (gates.length === 5 && gates.every(g => g?.live)) return 'Reviewed';
  return 'Waiting';
}

export const importedStatus = {reports_retained:'Imported analysis · reports retained',source_only:'Imported source · reports unavailable',reference_document:'Reference document'} as const;
export const importedRole = {question_paper:'Question paper',memorandum:'Memorandum',combined:'Paper and memorandum',source:'Source document',reference:'Reference',analysis_report:'Analysis report'} as const;
