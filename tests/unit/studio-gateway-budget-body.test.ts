// @vitest-environment node
import {test, expect} from 'vitest';
import {handleStudioGateway, MAX_BUDGET_BODY, MAX_GATEWAY_BODY} from '../../lib/studio/gateway';
import {sha256} from '../../lib/studio/contracts';
import {contract} from '../database/studio-budget-fixture';
const token='s'.repeat(40), id='00000000-0000-4000-8000-000000000001';
const c={...contract(),max_request_bytes:4*1024*1024};
const base={action:'budget_reserve',attemptId:id,lease:id,providerAttemptId:id};
function payload(size:number){
 const v={model:'recorded-only',max_tokens:100,stream:false,tools:[],messages:[{role:'user',content:''}],pins:{bundle:c.bundle_sha256}};
 const overhead=Buffer.byteLength(JSON.stringify(v));v.messages[0].content='a'.repeat(size-overhead);return JSON.stringify(v);
}
async function send(body:unknown,auth='Bearer '+token){
 const calls:{name:string,args:any}[]=[];
 const r=await handleStudioGateway(new Request('http://local/api/internal/studio',{method:'POST',headers:{authorization:auth},body:JSON.stringify(body)}),{
  token,storage:{} as any,rpc:async(name,args)=>{calls.push({name,args});return {data:name==='studio_budget_context'?{contract:c}:{reservedMicro:1},error:null};}
 });return {status:r.status,body:await r.json(),calls};
}
test('4 MiB exact request reaches normal budget validation without another base64 expansion',async()=>{
 const request=payload(4*1024*1024);const body={...base,requestUtf8:request};
 expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(MAX_BUDGET_BODY);
 const r=await send(body);expect(r.status).toBe(200);
 expect(r.calls.map(x=>x.name)).toEqual(['studio_budget_context','studio_budget_reserve']);
 expect(r.calls[1].args.p_request_manifest).toMatchObject({requestDigest:sha256(Buffer.from(request)),requestBytes:4*1024*1024});
});
test('legacy small requests retain identical request digest and budget manifest',async()=>{
 const request=payload(1000);const a=await send({...base,request:Buffer.from(request).toString('base64')});
 const b=await send({...base,requestUtf8:request});expect(a.status).toBe(200);expect(b.calls).toEqual(a.calls);
});
test('oversize, ambiguous encodings and malformed Unicode never reach budget RPCs',async()=>{
 for(const body of [{...base,requestUtf8:payload(4*1024*1024+1)}, {...base,request:'e30=',requestUtf8:'{}'},
  {...base,requestUtf8:'\ud800'}, {...base,requestUtf8:'x'.repeat(MAX_BUDGET_BODY)},
  {action:'output',content:'a'.repeat(MAX_GATEWAY_BODY)}, {...base,request:'A'.repeat(MAX_GATEWAY_BODY)}]){
  const r=await send(body);expect(r.status).toBe(400);expect(r.calls).toEqual([]);
 }
});
test('large input cannot bypass authentication or pinned capability checks',async()=>{
 const body={...base,requestUtf8:payload(3_500_000)};
 const unauth=await send(body,'wrong');expect(unauth.status).toBe(401);expect(unauth.calls).toEqual([]);
 const changed=JSON.parse(body.requestUtf8);changed.model='another-model';
 const r=await send({...base,requestUtf8:JSON.stringify(changed)});expect(r.status).toBe(409);
 expect(r.calls.map(x=>x.name)).toEqual(['studio_budget_context']);
});
