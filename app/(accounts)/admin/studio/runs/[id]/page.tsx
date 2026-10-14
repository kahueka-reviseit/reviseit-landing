import RunDetail from './run-detail';
export const dynamic='force-dynamic';
export default async function StudioRun(props:{params:Promise<{id:string}>}) { return RunDetail(props); }
