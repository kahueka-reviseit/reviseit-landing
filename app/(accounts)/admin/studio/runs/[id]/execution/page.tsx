import RunDetail from '../run-detail';
export const dynamic='force-dynamic';
export default async function Execution(props:{params:Promise<{id:string}>}) { return RunDetail({...props,history:true}); }
