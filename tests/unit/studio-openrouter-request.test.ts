import { test,expect } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { budgetManifest } from '../../lib/studio/budget';
import { contract } from '../database/studio-budget-fixture';
const sha=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const stable=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
const p={endpoint:'https://openrouter.ai/api/v1/chat/completions',model:'synthetic/model',provider:'synthetic/region',capability_sha256:sha('capabilities'),pricing_sha256:sha('prices'),input_micro_per_million:1000000,output_micro_per_million:1250000};
const c={...contract(),...p,evidence:{openrouter:p}};
function fixture(){
 const wire={model:p.model,max_tokens:10,stream:false,tools:[],messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,cG5n'}}]}],
  provider:{order:[p.provider],only:[p.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,max_price:{prompt:'1',completion:'1.25'}}};
 const raw=Buffer.from(stable(wire));
 return {schema:'reviseit/openrouter-request@1',profileDigest:sha(stable(p)),pins:{bundle:c.bundle_sha256},wireBody:raw.toString('base64'),wireSha256:sha(raw)};
}
test('OpenRouter admission verifies the registered route and counts the whole retained request plus images',()=>{
 const e=fixture(),bytes=Buffer.from(JSON.stringify(e)),m=budgetManifest(bytes,c);
 expect(m).toMatchObject({requestDigest:sha(bytes),requestBytes:bytes.length,inputTokenBound:bytes.length+1000,imageCount:1,model:p.model,endpoint:p.endpoint});
});
test('live admission refuses caching hints, hosted tools and uncompiled requests',()=>{
 const live={...c,mode:'openrouter'};
 expect(budgetManifest(Buffer.from(JSON.stringify(fixture())),live).mode).toBe('openrouter');
 for(const mutate of [(w:any)=>w.messages[0].content[0].cache_control={type:'ephemeral'},
  (w:any)=>w.messages[0].content[0].image_url.detail='high',
  (w:any)=>w.tools=[{type:'web_search'}],(w:any)=>w.tools=[{type:'function',function:{name:'f',parameters:{},cache_control:{type:'ephemeral'}}}]]){
  const e=fixture(),w=JSON.parse(Buffer.from(e.wireBody,'base64').toString());mutate(w);const raw=Buffer.from(stable(w));e.wireBody=raw.toString('base64');e.wireSha256=sha(raw);
  expect(()=>budgetManifest(Buffer.from(JSON.stringify(e)),live)).toThrow(/Budget/);
 }
 expect(()=>budgetManifest(Buffer.from(JSON.stringify({model:p.model,max_tokens:10,stream:false,tools:[],messages:[],pins:{bundle:c.bundle_sha256}})),live)).toThrow(/Budget/);
});
test('rehashed wire tampering cannot bypass pinned provider, privacy, capability, price or output ceilings',()=>{
 for(const mutate of [(w:any)=>w.provider.allow_fallbacks=true,(w:any)=>w.provider.only=['other'],(w:any)=>w.provider.zdr=false,
  (w:any)=>w.provider.max_price.prompt='999',(w:any)=>w.provider.require_parameters=false,(w:any)=>w.stream=true,
  (w:any)=>w.max_tokens=32769,(w:any)=>w.model='other',(w:any)=>w.plugins=[{id:'file-parser'}],
  (w:any)=>w.messages[0].content[0].image_url.url='https://remote.test/image']){
   const e=fixture(),w=JSON.parse(Buffer.from(e.wireBody,'base64').toString());mutate(w);const raw=Buffer.from(stable(w));e.wireBody=raw.toString('base64');e.wireSha256=sha(raw);
   expect(()=>budgetManifest(Buffer.from(JSON.stringify(e)),c)).toThrow(/Budget/);
 }
 for(const contract of [{...c,mode:'live'},{...c,evidence:{}},{...c,pricing_sha256:sha('changed')},{...c,input_micro_per_million:999},{...c,endpoint:'other'}])
  expect(()=>budgetManifest(Buffer.from(JSON.stringify(fixture())),contract)).toThrow(/Budget/);
});
test.skipIf(!process.env.STUDIO_E2E_WORKER||!process.env.STUDIO_EXECUTION_PYTHON)('Python compiler output is admitted by TypeScript without reinterpretation',()=>{
 const r=spawnSync(process.env.STUDIO_EXECUTION_PYTHON!,['-m','studio.tests.execution_driver'],{cwd:process.env.STUDIO_E2E_WORKER,input:JSON.stringify({mode:'openrouter_fixture'}),encoding:'utf8',env:{NODE_ENV:'test',PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}});
 expect(r.status,r.stderr).toBe(0);const v=JSON.parse(r.stdout),bytes=Buffer.from(v.envelope,'base64'),env=JSON.parse(bytes.toString());
 const m=budgetManifest(bytes,{...c,...v.profile,evidence:{openrouter:v.profile},bundle_sha256:env.pins.bundle});
 expect(m.requestDigest).toBe(sha(bytes));expect(m.imageCount).toBe(0);
});
