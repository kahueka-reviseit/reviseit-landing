// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const rpc=vi.hoisted(()=>vi.fn());
vi.mock('../../lib/jobs/server',()=>({
 access:async()=>({supabase:{rpc}}),originError:()=>null,body:async()=>({requestKey:'00000000-0000-4000-8000-000000000001',answers:{setting:'a'}}),
 reply:(value:unknown,status=200)=>Response.json(value,{status}),rpcError:()=>Response.json({error:'Generic error'},{status:503})
}));
import {POST} from '../../app/api/teacher/orders/[id]/submit/route';
const context={params:Promise.resolve({id:'00000000-0000-4000-8000-000000000002'})};
beforeEach(()=>rpc.mockReset());
describe('authored answer conflict response',()=>{
 it('returns a field-specific clarification without the private policy',async()=>{
  rpc.mockResolvedValue({error:{message:'Incompatible answers',details:JSON.stringify({itemId:'first',fieldId:'setting',message:'First question: Setting: Choose a supported combination.',privatePolicy:'must not escape'})}});
  const response=await POST(new Request('https://synthetic.example/submit',{method:'POST'}),context);
  expect(response.status).toBe(422);expect(await response.json()).toEqual({error:'First question: Setting: Choose a supported combination.',fieldError:{itemId:'first',fieldId:'setting'}});
 });
 it.each(['not json','null','{}',JSON.stringify({itemId:'first',fieldId:'setting',message:'x'.repeat(1001)})])('malformed detail remains a bounded clarification: %s',async details=>{
  rpc.mockResolvedValue({error:{message:'Incompatible answers',details}});
  const response=await POST(new Request('https://synthetic.example/submit',{method:'POST'}),context);
  expect(response.status).toBe(422);expect(await response.json()).toEqual({error:'These answers cannot be used together. Please check your selections.'});
 });
});
