// @vitest-environment node
import { test,expect,vi,beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({context:vi.fn(),read:vi.fn(),rpc:vi.fn()}));
vi.mock('../../lib/auth/access',()=>({accountContext:mocks.context}));
vi.mock('../../lib/workspace/server',()=>({readWorkspace:mocks.read}));
import { GET,PUT } from '../../app/api/teacher/workspace/route';
const body={kind:'selection',moduleId:'demo-grade-10-sciences',revision:0,release:'demo-1',entryIds:['DEMO_01']};
function request(payload:unknown=body,origin='http://localhost:3000'){return new NextRequest('http://localhost:3000/api/teacher/workspace',{method:'PUT',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(payload)});}
beforeEach(()=>{vi.resetAllMocks();mocks.context.mockResolvedValue({kind:'authenticated',user:{id:'teacher',email:'teacher@school.example',email_confirmed_at:'confirmed'},account:{status:'approved',email:'teacher@school.example',school_id:'school',department_id:'department'},supabase:{rpc:mocks.rpc}});mocks.rpc.mockResolvedValue({data:1,error:null});});
test.each(['anonymous','unavailable'])('%s cannot load workspace',async kind=>{mocks.context.mockResolvedValue({kind});const r=await GET(new NextRequest('http://localhost:3000/api/teacher/workspace'));expect(r.status).toBe(kind==='anonymous'?401:503);expect(mocks.read).not.toHaveBeenCalled();expect(r.headers.get('cache-control')).toContain('no-store');});
test('pending accounts cannot call the save endpoint directly',async()=>{const c=await mocks.context();c.account.status='pending';mocks.context.mockResolvedValue(c);expect((await PUT(request())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();});
test('cross-origin mutations are rejected',async()=>{expect((await PUT(request(body,'https://foreign.example'))).status).toBe(403);expect(mocks.context).not.toHaveBeenCalled();});
test('school and teacher identifiers supplied by a caller never reach the save procedure',async()=>{expect((await PUT(request({...body,schoolId:'other-school',userId:'other-teacher'}))).status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('save_paper_selection',{target_module:body.moduleId,target_release:'demo-1',expected_revision:0,selected_ids:['DEMO_01']});});
test('invalid preferences fail before any database write',async()=>{expect((await PUT(request({kind:'formatting',moduleId:body.moduleId,revision:0,preferences:{font:'Arial'}}))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
test('stale saves become a useful conflict response without database details',async()=>{mocks.rpc.mockResolvedValue({error:{message:'Selection changed. Reload before saving'}});const r=await PUT(request());expect(r.status).toBe(409);expect(await r.text()).toContain('Reload the workspace');});
test('database failures do not claim success or expose internals',async()=>{mocks.rpc.mockResolvedValue({error:{message:'internal secret failure'}});const r=await PUT(request());expect(r.status).toBe(503);expect(await r.text()).not.toContain('secret');});

test('unexpected read failures never expose internal error messages',async()=>{mocks.read.mockRejectedValue(new Error('private database details'));const r=await GET(new NextRequest('http://localhost:3000/api/teacher/workspace'));expect(r.status).toBe(503);expect(await r.text()).not.toContain('private database details');});
test('array values cannot masquerade as valid formatting strings',async()=>{const r=await PUT(request({kind:'formatting',moduleId:body.moduleId,revision:0,preferences:{font:['Arial'],fontSize:12,spacing:'normal',header:'',answerLines:true}}));expect(r.status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
