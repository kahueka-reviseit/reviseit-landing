import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requireStudioEditor } from '../../../../../../../lib/studio/server';
import { call, isUuid } from '../../../../../../../lib/studio/contracts';
import { studioStorage } from '../../../../../../../lib/studio/storage';
import { readArtifact } from '../../../../../../../lib/studio/uploads';
import { inventorySummary } from '../../../../../../../lib/studio/inventory-review';
import { creditsEnabled } from '../../../../../../../lib/credits/server';
import { StaffHeader } from '../../../../../staff-header';
import { InventoryWorkspace } from '../../../inventory-workspace';
import { StudioShell } from '../../../components';
import ui from '../../../../../experience.module.css';
export const dynamic = 'force-dynamic';
export default async function InventoryReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; if (!isUuid(id)) notFound();
  const { rpc, account } = await requireStudioEditor(), storage = studioStorage();
  const v = await call<any>(rpc, 'studio_run_view', { p_run: id });
  const gate = await call<any>(rpc, 'studio_gate_view', { p_run: id, p_gate: 'G1_inventory' });
  const bound = gate.binding?.artifacts || [], selected = v.artifacts.find((a: any) => a.kind === 'inventory' && a.logicalKey === 'inventory' && a.state === 'current' && bound.some((b: any) => b.id === a.id));
  if (!storage || !selected) return <main className={ui['site-shell__main']}><div className={ui['page--staff']}><h1>Inventory is not ready for review</h1><Link href={`/admin/studio/runs/${id}`}>Return to run</Link></div></main>;
  const { info, bytes } = await readArtifact(rpc, storage, selected.id);
  const inventory = JSON.parse(new TextDecoder().decode(bytes)), totals = inventorySummary(inventory);
  const ledgerRef = bound.find((a: any) => a.logicalKey === 'evidence:source_pages');
  const ledger = ledgerRef ? JSON.parse(new TextDecoder().decode((await readArtifact(rpc, storage, ledgerRef.id)).bytes)) : null;
  const pageLinks = new Map<string, string>();
  for (const ref of ledger?.pageArtifacts || []) {
    const artifact = bound.find((a: any) => a.logicalKey === ref.logicalKey);
    if (artifact) pageLinks.set(JSON.stringify([ref.sourceId, ref.filePage]), `/admin/studio/pages/${artifact.id}`);
  }
  const commands = Object.fromEntries(inventory.questions.flatMap((q: any) => q.sub_questions.map((p: any) => [p.id,{marks:randomUUID(),cognition:randomUUID()}])));
  return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name || '').split(/\s+/)[0] || undefined}/>
    <StudioShell moduleId={v.run.module_id}><InventoryWorkspace runId={id} inventory={inventory} totals={totals} artifact={{id:selected.id,sha256:info.sha256,revision:info.revision}} gate={gate} editable={v.run.state==='active'} rehearsal={v.run.purpose==='rehearsal'} pageLinks={Object.fromEntries(pageLinks)} commands={commands} decisionCommand={randomUUID()} asOf={new Date().toISOString().slice(0,10)} revisions={v.artifacts.filter((a:any)=>a.kind==='inventory')}/></StudioShell></>;
}
