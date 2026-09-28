import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {jevAllowed,savedAdvice} from '../../lib/jev/pilot';
const id='00000000-0000-4000-8000-000000000001';
const teacher='00000000-0000-4000-8000-000000000002';
const doc={facets:[{id:'shade',type:'choice',domain:{options:[{id:'red',label:'Red'}]}}],jevChecks:[{id:'conflict',type:'noul',activation:'shadow',stage:'post',fields:['note','shade'],instructions:'Does the note conflict with the shade?',criteria:['Delegation is valid.'],hint:'conflict',flagAbove:0.85}],hints:{conflict:'Your note may conflict with your selected shade.'}};
const loaded=(text='Use blue')=>({row:{orderId:id,revision:1},defs:{lines:[{id:'q1',classification:{doc}}]},configuration:{answers:{items:{q1:{note:{kind:'text',text},shade:{kind:'choice',choiceId:'red'}}}}}} as any);
function env(){vi.stubEnv('JEV_MODE','advisory');vi.stubEnv('TYPESAFE_API_KEY','synthetic-key-with-no-secret');vi.stubEnv('JEV_ORDER_IDS',id);}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('requires both the explicit order allowlist and a direct key',()=>{
 expect(jevAllowed(id,{})).toBe(false);env();expect(jevAllowed(id)).toBe(true);expect(jevAllowed(teacher)).toBe(false);
});
it('blank and delegated text makes no reservation or provider call',async()=>{
 env();const service={rpc:vi.fn()};expect(await savedAdvice(service as any,loaded(''),teacher,'q1')).toEqual({status:'not_applicable',hints:[]});expect(service.rpc).not.toHaveBeenCalled();
 const x=loaded();x.configuration.answers.items.q1.note={kind:'automatic'};
 expect((await savedAdvice(service as any,x,teacher,'q1')).status).toBe('not_applicable');
});
it('stores typed results once and serves repeated state without another request',async()=>{
 env();let saved:any=null;
 const service={rpc:vi.fn(async(name:string,args:any)=>{if(name==='reserve_jev_advice')return {data:saved?{status:'complete',response:saved}:{status:'dispatch'}};saved=args.result;return {data:null};})};
 const provider=vi.fn(async()=>new Response(JSON.stringify({model:'synthetic',answers:{conflict:{type:'noul',noul:0.97}},usage:{input_tokens:10,output_tokens:5}})));vi.stubGlobal('fetch',provider);
 const a=await savedAdvice(service as any,loaded(),teacher,'q1');expect(a.hints).toHaveLength(1);
 expect(await savedAdvice(service as any,loaded(),teacher,'q1')).toEqual(a);expect(provider).toHaveBeenCalledTimes(1);
 expect((provider.mock.calls as unknown[][])[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
});
it('reserved, exhausted and uncertain calls cannot retry',async()=>{
 env();const provider=vi.fn();vi.stubGlobal('fetch',provider);
 for(const status of ['reserved','unavailable','limit']){const r=await savedAdvice({rpc:async()=>({data:{status}})} as any,loaded(),teacher,'q1');expect(r.hints).toEqual([]);}
 expect(provider).not.toHaveBeenCalled();
});
it('provider failure retains the consumed slot and never changes the order',async()=>{
 env();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('timeout');}));const rpc=vi.fn(async(name:string)=>({data:name==='reserve_jev_advice'?{status:'dispatch'}:null}));
 expect((await savedAdvice({rpc} as any,loaded(),teacher,'q1')).status).toBe('unavailable');expect(rpc.mock.calls.map(x=>x[0])).toEqual(['reserve_jev_advice','finish_jev_advice']);expect((rpc.mock.calls[1] as any)[1].result).toBeNull();
});

it('database reservations survive instances, enforce the cap and protect access',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table private.paper_orders(id uuid primary key);insert into private.paper_orders values('${id}');
 create function public.paper_configuration_for_teacher(target uuid,target_teacher uuid) returns jsonb language sql as $$select case when target_teacher='${teacher}' then '{"paid":true,"state":"awaiting_answers","submitted":false,"revision":1,"configuration":{"lines":{"q1":{}}}}'::jsonb else null end$$;`);
 await db.exec(readFileSync('supabase/migrations/202609280024_jev_advice.sql','utf8'));
 const reserve=async(hash:string,limit=2,rev=1,t=teacher)=> (await db.query<{r:any}>('select public.reserve_jev_advice($1,$2,$3,$4,$5,$6) r',[id,t,'q1',rev,hash.repeat(64),limit])).rows[0].r;
 expect((await reserve('a',2,2)).status).toBe('unavailable');expect((await reserve('a',2,1,id)).status).toBe('unavailable');
 expect((await reserve('a')).status).toBe('dispatch');expect((await reserve('a')).status).toBe('reserved');
 await db.query('select public.finish_jev_advice($1,$2,$3,$4)',[id,'q1','a'.repeat(64),JSON.stringify({answers:{test:1}})]);
 expect((await reserve('a')).status).toBe('complete');expect((await reserve('b')).status).toBe('dispatch');expect((await reserve('c')).status).toBe('limit');
 await db.exec('set role authenticated');await expect(reserve('d')).rejects.toThrow(/permission denied/);await db.exec('reset role');
 expect((await db.query<{n:number}>('select count(*)::int n from private.jev_advice_calls')).rows[0].n).toBe(2);
 }finally{await db.close();}
},20000);
