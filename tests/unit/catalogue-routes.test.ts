// @vitest-environment node
import {beforeEach,test,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {readFileSync} from 'node:fs';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({context:vi.fn(),rpc:vi.fn(),from:vi.fn(),select:vi.fn(),eq:vi.fn(),one:vi.fn()}));
vi.mock('../../lib/auth/access',()=>({accountContext:mocks.context}));
import {GET as search} from '../../app/api/teacher/catalogue/search/route';
import {GET as thumbnail} from '../../app/api/teacher/catalogue/thumbnail/route';
const req=(path='search?q=electricity')=>new NextRequest('http://localhost:3000/api/teacher/catalogue/'+path);
beforeEach(()=>{
 vi.resetAllMocks();mocks.context.mockResolvedValue({kind:'authenticated',user:{id:'teacher',email:'teacher@school.example',email_confirmed_at:'confirmed'},account:{status:'approved',email:'teacher@school.example',school_id:'school',department_id:'department'},supabase:{rpc:mocks.rpc,from:mocks.from}});
 mocks.from.mockReturnValue({select:mocks.select});mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({eq:mocks.eq,maybeSingle:mocks.one});mocks.rpc.mockResolvedValue({data:[],error:null});mocks.one.mockResolvedValue({data:null,error:null});
});
test.each(['anonymous','pending','suspended'])('%s cannot search or fetch diagrams',async kind=>{
 if(kind==='anonymous')mocks.context.mockResolvedValue({kind});else{const c=await mocks.context();c.account.status=kind;}
 for(const get of [search,thumbnail]){const r=await get(req());expect(r.status).toBe(kind==='anonymous'?401:403);expect(r.headers.get('cache-control')).toContain('no-store');}
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled();
});
test('search projects safe fields and caps responses at fifty',async()=>{
 const row={module_id:'grade-10',module_name:'Grade 10',release:'1',is_demo:false,entry_id:'Q1',title:'Example',topic:'Topic',description:'Description',marks:2,thumbnail_alt:'Circuit',thumbnail_png:'PRIVATE_BYTES',specification:'PRIVATE_SPEC'};
 mocks.rpc.mockResolvedValue({data:Array(51).fill(row)});const response=await search(req());const result=await response.json();expect(result.matches).toHaveLength(50);expect(result.hasMore).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE_');expect(result.matches[0].entry.thumbnail.src).toMatch(/^\/api\/teacher\/catalogue\/thumbnail\?/);
});
test.each(['','x'.repeat(121)])('invalid search is rejected before database access',async q=>{expect((await search(req('search?q='+q))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
test('unknown or inaccessible thumbnail returns no image',async()=>{expect((await thumbnail(req('thumbnail?curriculum=grade-10&release=1&entry=Q1'))).status).toBe(404);});
test('thumbnail returns only a PNG with private caching rules',async()=>{
 const png=readFileSync('tests/preview/public/sample-diagrams/circuit.png');mocks.one.mockResolvedValue({data:{thumbnail_png:png.toString('base64')}});const r=await thumbnail(req('thumbnail?curriculum=grade-10&release=1&entry=Q1'));
 expect(r.status).toBe(200);expect(r.headers.get('content-type')).toBe('image/png');expect(r.headers.get('x-content-type-options')).toBe('nosniff');expect(r.headers.get('cache-control')).toContain('no-store');expect(Buffer.from(await r.arrayBuffer())).toEqual(png);
 expect(mocks.eq.mock.calls).toEqual([['module_id','grade-10'],['release','1'],['entry_id','Q1']]);
});
test('SVG or invalid image bytes cannot be served as a diagram',async()=>{mocks.one.mockResolvedValue({data:{thumbnail_png:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}});const r=await thumbnail(req('thumbnail?curriculum=grade-10&release=1&entry=Q1'));expect(r.status).toBe(503);expect(await r.text()).not.toContain('svg');});
test('internal failures do not disclose private details',async()=>{mocks.rpc.mockRejectedValue(new Error('PRIVATE_CONFIGURATION'));const r=await search(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE_');});
