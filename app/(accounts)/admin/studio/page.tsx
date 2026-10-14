import { creditsEnabled } from '../../../../lib/credits/server';
import { requireStudioEditor } from '../../../../lib/studio/server';
import { call } from '../../../../lib/studio/contracts';
import { StaffHeader } from '../../staff-header';
import { Notice } from '../../system/notice';
import { StudioShell } from './components';
import { SourcesView } from './sources-view';
import { UploadSource } from './upload-source';
export const dynamic = 'force-dynamic';
export default async function Studio({ searchParams }: { searchParams: Promise<{module?: string}> }) {
  const { rpc, account } = await requireStudioEditor();
  const query = await searchParams;
  let data: any = null, imported: any[] = [];
  try { [data, imported] = await Promise.all([call(rpc,'studio_overview',{}),call<any[]>(rpc,'studio_imported_analyses',{})]); } catch { /* Render unavailable, never a fabricated empty catalogue. */ }
  const modules = data?.modules.map((m:any)=>m.moduleId) || [];
  const moduleId = modules.includes(query.module) ? query.module : undefined;
  const inModule = (x:any) => !moduleId || x.moduleId===moduleId;
  return <><StaffHeader current="studio" studioEnabled creditsEnabled={creditsEnabled()} signedIn name={(account.full_name||'').split(/\s+/)[0]}/><StudioShell modules={modules} moduleId={moduleId}>
    {!data ? <Notice tone="problem">Studio could not be loaded. Refresh to try again.</Notice> : <SourcesView sources={data.sources.filter(inModule)} imported={imported.filter(inModule)} runs={data.runs.filter(inModule)} upload={modules.length ? <UploadSource key={moduleId} modules={moduleId ? [moduleId] : modules}/> : <p>No module has been enrolled yet.</p>}/>}
  </StudioShell></>;
}
