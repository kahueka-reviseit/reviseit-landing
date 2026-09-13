// @vitest-environment node
import {test,expect,vi,beforeEach} from 'vitest';
import {NextRequest} from 'next/server';
import type {SupabaseClient} from '@supabase/supabase-js';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn()}));
vi.mock('../../lib/auth/access',()=>({accountContext:mock.context}));
import {readRenderFormatting} from '../../lib/workspace/render-formatting';
import {GET} from '../../app/api/teacher/formatting/route';
const school='00000000-0000-4000-8000-000000000010',moduleId='demo-grade-10-sciences';
const saved={schemaVersion:1,schoolId:school,schoolName:'First',moduleId,revision:1,preferences:{font:'Times New Roman',fontSize:11,spacing:'relaxed',header:'First school',answerLines:true}};
const client={rpc:mock.rpc} as unknown as SupabaseClient;
const request=(query=`curriculum=${moduleId}&revision=1`)=>new NextRequest('http://localhost:3000/api/teacher/formatting?'+query);
beforeEach(()=>{vi.resetAllMocks();mock.rpc.mockResolvedValue({data:structuredClone(saved),error:null});mock.context.mockResolvedValue({kind:'authenticated',user:{id:'teacher',email:'teacher@school.example',email_confirmed_at:'yes'},account:{status:'approved',email:'teacher@school.example',school_id:school,department_id:'department'},supabase:client});});
test('export uses authenticated identity and saved preferences, never caller overrides',async()=>{const r=await GET(request(`curriculum=${moduleId}&revision=1&schoolId=foreign&font=Arial`));expect(r.status).toBe(200);expect(await r.json()).toEqual(saved);expect(mock.rpc).toHaveBeenCalledWith('read_render_formatting',{target_module:moduleId,expected_revision:1});expect(r.headers.get('cache-control')).toBe('private, no-store');});
test.each(['anonymous','unavailable'])('%s cannot export',async kind=>{mock.context.mockResolvedValue({kind});expect((await GET(request())).status).toBe(kind==='anonymous'?401:503);expect(mock.rpc).not.toHaveBeenCalled();});
test('pending school verification blocks export',async()=>{const c=await mock.context();c.account.status='pending';expect((await GET(request())).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
test.each(['revision=1','curriculum=module','curriculum=module&revision=-1','curriculum=module&revision=1.5'])('invalid request %s fails closed',async query=>{expect((await GET(request(query))).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
test.each([['Formatting changed. Reload',409],['Curriculum access required',403],['private database error',503]])('maps %s to %s without exposing internals',async(message,status)=>{mock.rpc.mockResolvedValue({error:{message}});const r=await GET(request());expect(r.status).toBe(status);expect(await r.text()).not.toContain('private database error');});
test('invalid stored settings never reach the renderer',async()=>{mock.rpc.mockResolvedValue({data:{...saved,preferences:{...saved.preferences,font:'Unknown font'}}});expect((await GET(request())).status).toBe(422);});
test('wrong-school response is rejected even if a privileged client is accidentally supplied',async()=>{mock.rpc.mockResolvedValue({data:{...saved,schoolId:'other'}});await expect(readRenderFormatting(client,school,moduleId,1)).rejects.toThrow('Unsupported formatting');});
test('no saved row is an explicit fallback snapshot',async()=>{mock.rpc.mockResolvedValue({data:{...saved,revision:0,preferences:null}});expect(await readRenderFormatting(client,school,moduleId,0)).toMatchObject({revision:0,preferences:null});});
test('snapshot detaches its preferences from later changes to the database object',async()=>{const data=structuredClone(saved);mock.rpc.mockResolvedValue({data});const result=await readRenderFormatting(client,school,moduleId,1);data.preferences.header='Later change';expect(result.preferences?.header).toBe('First school');});

test('multiline or control-character headings are unsupported',async()=>{mock.rpc.mockResolvedValue({data:{...saved,preferences:{...saved.preferences,header:'First\nSecond'}}});expect((await GET(request())).status).toBe(422);});
