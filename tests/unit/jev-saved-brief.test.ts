import {it,expect,vi,afterEach} from 'vitest';
import {savedBrief} from '../../lib/jev/saved-brief';
const id='00000000-0000-4000-8000-000000000001',teacher='00000000-0000-4000-8000-000000000002';
const field={id:'shade',type:'choice',label:'Shade',hint:'',required:true,allowAutomatic:true,allowOther:true,choices:[{id:'blue',label:'Blue'}]};
const loaded=(fields:any[]=[field])=>({row:{orderId:id,revision:2},defs:{lines:[{id:'q1',fields}]},configuration:{briefs:{q1:{text:'Use blue.',interpretedText:null,suggestions:{},resolutions:{}}}}} as any);
function env(){vi.stubEnv('JEV_MODE','advisory');vi.stubEnv('TYPESAFE_API_KEY','synthetic-test-key-not-a-secret');vi.stubEnv('JEV_ORDER_IDS',id);vi.stubEnv('JEV_REQUESTS_PER_ORDER','100');}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('calls the direct service only after reserving the exact saved revision and reuses a completed request',async()=>{
 env();let saved:any=null;const rpc=vi.fn(async(name:string,args:any)=>{if(name==='reserve_jev_advice')return {data:saved?{status:'complete',response:saved}:{status:'dispatch'}};saved=args.result;return {data:null};});
 const fetch=vi.fn(async()=>new Response(JSON.stringify({model:'synthetic',answers:{field_0:{type:'choice',choice:'blue',probabilities:{blue:.99}}},usage:{input_tokens:10,output_tokens:2}})));vi.stubGlobal('fetch',fetch);
 const first=await savedBrief({rpc} as any,loaded(),teacher,'q1',id);expect(first?.answers).toEqual({shade:{kind:'choice',choiceId:'blue'}});
 expect(await savedBrief({rpc} as any,loaded(),teacher,'q1',id)).toEqual(first);expect(fetch).toHaveBeenCalledTimes(1);
 expect((fetch.mock.calls as any)[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
 expect((rpc.mock.calls as any)[0][1]).toMatchObject({target:id,target_teacher:teacher,expected_revision:2,call_limit:100});
});
it('zero-field items retain the paragraph without spending',async()=>{
 env();const rpc=vi.fn(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 expect(await savedBrief({rpc} as any,loaded([]),teacher,'q1',id)).toEqual({answers:{},understood:[],unanswered:[]});expect(rpc).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('limits, uncertain reservations and provider errors never silently retry or modify saved configuration',async()=>{
 env();const fetch=vi.fn(async()=>{throw Error('timeout');});vi.stubGlobal('fetch',fetch);
 for(const status of ['limit','reserved','unavailable'])expect(await savedBrief({rpc:async()=>({data:{status}})} as any,loaded(),teacher,'q1',id)).toBeNull();
 expect(fetch).not.toHaveBeenCalled();
 const state=loaded(),before=structuredClone(state);const rpc=vi.fn(async(name:string)=>({data:name==='reserve_jev_advice'?{status:'dispatch'}:null}));
 expect(await savedBrief({rpc} as any,state,teacher,'q1',id)).toBeNull();expect(state).toEqual(before);expect(fetch).toHaveBeenCalledTimes(1);expect((rpc.mock.calls as any)[1][1].result).toBeNull();
});
