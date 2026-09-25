// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({rpc})}));
import {POST} from '../../app/api/internal/jobs/route';
const token='t'.repeat(40);
const call=(body:object,auth='Bearer '+token)=>POST(new Request('https://synthetic.example/api/internal/jobs',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)}));
beforeEach(()=>{rpc.mockReset();rpc.mockResolvedValue({data:null,error:null});process.env.CONTENT_WORKER_TOKEN=token;process.env.SUPABASE_URL='https://synthetic.example';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';});
describe('worker claim capabilities (CFG01A)',()=>{
 it('passes both configured-plan versions through to the database claim',async()=>{
  expect((await call({action:'claim',worker:'w1',capabilities:['configured-plan@1','configured-plan@2']})).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('claim_paper_job',{worker:'w1',capabilities:['configured-plan@1','configured-plan@2']});
 });
 it('a worker declaring nothing sends exactly the previous claim',async()=>{
  expect((await call({action:'claim',worker:'w1'})).status).toBe(200);expect(rpc).toHaveBeenCalledWith('claim_paper_job',{worker:'w1'});
 });
 it('unknown capabilities and bad tokens are refused before the database',async()=>{
  expect((await call({action:'claim',worker:'w1',capabilities:['configured-plan@3']})).status).toBe(400);
  expect((await call({action:'claim',worker:'w1'},'Bearer wrong')).status).toBe(401);expect(rpc).not.toHaveBeenCalled();
 });
});
