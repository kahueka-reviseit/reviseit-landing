import {ReleasePublication} from '../../app/(accounts)/admin/studio/release-publication';
import {releasePublication} from '../fixtures/studio-release-publication';
import {ReleasePreparations} from '../../app/(accounts)/admin/studio/release-preparation';
import {releasePreparations} from '../fixtures/studio-release-preparation';
import {IntegrationReview} from '../../app/(accounts)/admin/studio/integration-review';
import {integration,integrationEvidence} from '../fixtures/studio-integration';
import React from 'react';
import {MaintenanceCheckView,CheckPreparation} from '../../app/(accounts)/admin/studio/maintenance-check';
import {maintenanceCheck} from '../fixtures/studio-check';
import {DependencyImpact} from '../../app/(accounts)/admin/studio/dependency-impact';
import {impact} from '../fixtures/studio-impact';
import {createRoot} from 'react-dom/client';
import {StudioShell,StudioHeading,Checkpoints} from '../../app/(accounts)/admin/studio/components';
import {SourcesView} from '../../app/(accounts)/admin/studio/sources-view';
import {SourceRecord} from '../../app/(accounts)/admin/studio/source-record';
import {QueueView} from '../../app/(accounts)/admin/studio/queue-view';
import {InventoryWorkspace} from '../../app/(accounts)/admin/studio/inventory-workspace';
import {ExecutionSummary} from '../../app/(accounts)/admin/studio/execution-summary';
import {LibraryView} from '../../app/(accounts)/admin/studio/library-view';
import {CatalogueItemView} from '../../app/(accounts)/admin/studio/catalogue-item';
import {BankFileView} from '../../app/(accounts)/admin/studio/bank-file';
import {ReleasesView} from '../../app/(accounts)/admin/studio/releases-view';
import {DraftEditor} from '../../app/(accounts)/admin/studio/draft-editor';
import {draft,baseText,currentText} from '../fixtures/studio-draft';
import {formFile,formText} from '../fixtures/studio-form';
import {library,libraryItem,fileDetail,releases} from '../fixtures/studio-library';
import {StaffHeader} from '../../app/(accounts)/staff-header';
import {workspace,source,run,runId,moduleId,views,execution,runView} from '../fixtures/studio-ui';
import '../../app/globals.css';
const screen=new URLSearchParams(location.search).get('screen')||'sources';
document.addEventListener('click',e=>{const a=(e.target as Element).closest('a');if(!a||!a.getAttribute('href')?.startsWith('/admin/studio'))return;e.preventDefault();const href=a.getAttribute('href')!;const next=href.includes('/library/checks/')?'check':href.includes('/library/impact/')?'impact':href.includes('/library/drafts/')?'draft':href.includes('/library/items/')?'item':href.includes('/library/files/')?'file':href.includes('/library')?'library':href.includes('/releases')?'releases':href.includes('/inventory')?'inventory':href.includes('/execution')?'execution':href.includes('/runs/')?'run':href.includes('/queue')?'queue':href.includes('/sources/')?'source':'sources';location.href=`/?screen=${next}`;});
createRoot(document.getElementById('root')!).render(<><StaffHeader current="studio" studioEnabled signedIn name="Preview reviewer"/><div style={{padding:'6px 24px',background:'#EAF0F7',fontSize:13}}>LOCAL DESIGN PREVIEW · synthetic records · no uploads, model calls or saved decisions</div><StudioShell moduleId={moduleId} modules={[moduleId,'caps-grade-11-physical-sciences']} current={['integration','library','item','file','draft','form','impact','check','prepare-check'].includes(screen)?'library':['releases','release-preparation','release-publication'].includes(screen)?'releases':['queue','execution','run'].includes(screen)?'queue':'sources'}>
 {screen==='release-publication'?<ReleasePublication data={releasePublication} preparations={releasePreparations}/>:screen==='release-preparation'?<ReleasePreparations data={releasePreparations}/>:screen==='integration'?<IntegrationReview integration={integration} evidence={integrationEvidence} reportVerified/>:screen==='check'?<MaintenanceCheckView check={maintenanceCheck} verified/>:screen==='prepare-check'?<CheckPreparation snapshotId={maintenanceCheck.snapshotId} entries={maintenanceCheck.entries} checks={[]}/>:screen==='impact'?<DependencyImpact data={impact}/>:screen==='form'?<DraftEditor file={formFile} draft={null} baseText={formText} currentText={formText} selectedText={formText} selectedRevision={0} viewerId="synthetic-editor" asOf="2026-10-14"/>:
 screen==='draft'?<DraftEditor file={fileDetail} draft={draft} baseText={baseText} currentText={currentText} selectedText={baseText} selectedRevision={0} viewerId="synthetic-editor"/>:
 screen==='library'?<LibraryView data={library} moduleId={moduleId}/>:
 screen==='item'?<CatalogueItemView item={libraryItem}/>:
 screen==='file'?<BankFileView file={fileDetail} content={'# Synthetic task type\n\nThis is an isolated test document.\n\n## Variants\nPHYS_01 · 1A belongs to this parent.\n\n## Generation constraints\nUse this content only as a UI test fixture.'}/>:
 screen==='releases'?<ReleasesView data={releases} moduleId={moduleId}/>:
 screen==='sources'?<SourcesView sources={[source]} imported={[]} runs={[run]} upload={<p>Uploads are available in the authenticated admin application.</p>}/>:
 screen==='source'?<SourceRecord source={source} runs={[run]}/>:
 screen==='queue'?<QueueView runs={[run]}/>:
 screen==='inventory'?<InventoryWorkspace {...workspace}/>:
 screen==='run'?<><StudioHeading title="Analysis progress" breadcrumb="Work queue / Synthetic paper"/><Checkpoints runId={runId} views={views}/></>:
 <><StudioHeading title="Execution history" breadcrumb="Work queue / Synthetic paper / Execution history"/><ExecutionSummary runId={runId} view={runView} execution={execution}/><section id="evidence"><h2>Retained files</h2><p>Synthetic inventory revision 1 · verified</p></section><section id="provider-attempts"><h2>Provider attempts</h2><p>One recorded exchange · succeeded</p></section></>}
 </StudioShell></>);
