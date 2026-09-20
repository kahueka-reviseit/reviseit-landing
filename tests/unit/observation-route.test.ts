// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc})}));
import {POST} from '../../app/api/internal/observations/route';
const observer='observer-'.repeat(5),worker='worker-'.repeat(6),id='00000000-0000-4000-8000-000000000001',h='a'.repeat(64);
const capture={action:'capture',id,checksHash:h};
function request(value:unknown=capture,token=observer){return new Request('https://synthetic.example/api/internal/observations',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(value)});}
beforeEach(()=>{vi.stubEnv('SEMANTIC_OBSERVER_TOKEN',observer);vi.stubEnv('CONTENT_WORKER_TOKEN',worker);vi.stubEnv('SUPABASE_URL','https://synthetic.example');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic-private-key');rpc.mockReset();rpc.mockResolvedValue({data:{id},error:null});});
afterEach(()=>vi.unstubAllEnvs());
it('is disabled until a distinct observer credential is configured',async()=>{vi.stubEnv('SEMANTIC_OBSERVER_TOKEN','');expect((await POST(request())).status).toBe(503);vi.stubEnv('SEMANTIC_OBSERVER_TOKEN',worker);expect((await POST(request(capture,worker))).status).toBe(503);expect(rpc).not.toHaveBeenCalled();});
it.each(['',worker,'teacher-cookie'])('refuses non-observer credentials %s',async token=>{expect((await POST(request(capture,token))).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
it('captures only by order identity and check hash, with private caching headers',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');expect(rpc).toHaveBeenCalledExactlyOnceWith('capture_semantic_observation',{target:id,checks_hash:h});});
it.each(['claim','heartbeat','checkpoint','upload','finish','release'])('does not grant generation or release action %s',async action=>{expect((await POST(request({...capture,action}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
it('refuses teacher-supplied snapshot additions',async()=>{expect((await POST(request({...capture,answers:{}}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
it('records uncertainty without transforming it into success',async()=>{const evidence={reason:'Lost response'};expect((await POST(request({action:'record',id,inputHash:h,outcome:'uncertain',evidence}))).status).toBe(200);expect(rpc).toHaveBeenCalledExactlyOnceWith('record_semantic_observation',{target:id,input_hash:h,result_outcome:'uncertain',result_evidence:evidence});});
it.each([null,[],{text:'x'.repeat(64000)}])('refuses malformed or oversized result evidence',async evidence=>{expect((await POST(request({action:'record',id,inputHash:h,outcome:'response_received',evidence}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
it('bounds the actual request stream without trusting content length',async()=>{expect((await POST(request({text:'x'.repeat(70000)}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();});
it('does not leak database details',async()=>{rpc.mockResolvedValue({error:{message:'private specification secret',details:'private content'}});const r=await POST(request());expect(r.status).toBe(409);expect(await r.json()).toEqual({error:'Observation operation refused'});});
it('reports an unconfirmed operation without retrying it',async()=>{rpc.mockRejectedValue(new Error('secret connection text'));const r=await POST(request());expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'Observation operation could not be confirmed'});expect(rpc).toHaveBeenCalledTimes(1);});
