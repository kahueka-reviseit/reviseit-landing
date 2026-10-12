import { test,expect } from 'vitest';
import { budgetManifest } from '../../lib/studio/budget';
import { contract } from '../database/studio-budget-fixture';
const c=contract();
const request=()=>({model:'recorded-only',max_tokens:100,stream:false,tools:[{type:'function',function:{name:'read_record',parameters:{type:'object'}}}],messages:[{role:'user',content:[{type:'text',text:'Retained history and tool schema bytes count'},{type:'image_url',image_url:{url:'data:image/png;base64,cG5n'}}]}],pins:{bundle:c.bundle_sha256}});
test('admission derives input ceiling from complete request bytes and all image occurrences',()=>{
 const r=request();const bytes=Buffer.from(JSON.stringify(r));const m=budgetManifest(bytes,c);
 expect(m.requestBytes).toBe(bytes.length);expect(m.imageCount).toBe(1);expect(m.inputTokenBound).toBe(bytes.length+1000);
 r.messages.push(r.messages[0]);const larger=Buffer.from(JSON.stringify(r));expect(budgetManifest(larger,c).inputTokenBound).toBe(larger.length+2000);
});
test('unsupported routing, missing output bounds and mismatched bundle cannot reach reservation',()=>{
 for(const extra of [{max_tokens:0},{max_tokens:null},{max_tokens:Infinity},{max_tokens:true},{pins:{bundle:'different'}},{provider:{allow_fallbacks:true}},{temperature:0},{model:'live-model'},{stream:true}])
  expect(()=>budgetManifest(Buffer.from(JSON.stringify({...request(),...extra})),c)).toThrow(/Budget/);
 const r=request();(r.messages[0].content[1] as any).image_url.url='https://example.test/image.png';
 expect(()=>budgetManifest(Buffer.from(JSON.stringify(r)),c)).toThrow(/inline pinned/);
});
