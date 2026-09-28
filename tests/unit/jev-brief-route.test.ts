import {it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),interpret:vi.fn(),allowed:vi.fn(),access:vi.fn()}));
vi.mock('../../lib/jobs/server',()=>({access:m.access,originError:(r:Request)=>r.headers.get('origin')==='https://pilot.example'?null:Response.json({}, {status:403}),body:(r:Request)=>r.json(),reply:(v:unknown,status=200)=>Response.json(v,{status})}));
vi.mock('../../lib/supabase/service',()=>({serviceClient:()=>({})}));
vi.mock('../../lib/jev/pilot',()=>({jevAllowed:m.allowed}));
vi.mock('../../lib/jev/saved-brief',()=>({savedBrief:m.interpret}));
vi.mock('../../lib/configurator/server',()=>({loadConfiguration:m.load,saveConfiguration:m.save,ConfigurationError:class extends Error{constructor(message:string,readonly status:number){super(message);}}}));
import {POST} from '../../app/api/teacher/orders/[id]/configuration/interpret/route';
import {ConfigurationError} from '../../lib/configurator/server';
const id='00000000-0000-4000-8000-000000000001';
const cfg={answers:{items:{q1:{shade:{kind:'choice',choiceId:'red'}}}},briefs:{q1:{text:'Use blue.',interpretedText:null,suggestions:{},resolutions:{}}}};
const loaded=()=>({row:{orderId:id,paid:true,submitted:false,state:'awaiting_answers',revision:2},configuration:structuredClone(cfg)});
const call=(origin='https://pilot.example',revision=2)=>POST(new Request('https://pilot.example/api',{method:'POST',headers:{origin},body:JSON.stringify({revision,lineId:'q1',requestKey:id})}),{params:Promise.resolve({id})});
beforeEach(()=>{vi.clearAllMocks();m.access.mockResolvedValue({user:{id:'teacher'}});m.allowed.mockReturnValue(true);m.load.mockResolvedValue(loaded());m.interpret.mockResolvedValue({answers:{shade:{kind:'choice',choiceId:'blue'}},unanswered:[]});m.save.mockResolvedValue({view:{revision:3}});});
it('uses the saved paragraph, keeps existing answers and saves against the same revision',async()=>{
 expect((await call()).status).toBe(200);expect(m.save.mock.calls[0][3]).toBe(2);
 const next=m.save.mock.calls[0][4];expect(next.answers.items.q1.shade.choiceId).toBe('red');expect(next.briefs.q1.text).toBe('Use blue.');expect(next.briefs.q1.suggestions.shade.choiceId).toBe('blue');
});
it('unrelated origins and inaccessible, unpaid or submitted orders make no provider call',async()=>{
 expect((await call('https://foreign.example')).status).toBe(403);
 for(const value of [null,{...loaded(),row:{...loaded().row,paid:false}},{...loaded(),row:{...loaded().row,submitted:true}}]){m.load.mockResolvedValue(value);expect((await call()).status).toBe(value?409:404);}
 expect(m.interpret).not.toHaveBeenCalled();
});
it('a stale starting revision is refused before calling and a late competing save is not overwritten',async()=>{
 expect((await call(undefined,1)).status).toBe(409);expect(m.interpret).not.toHaveBeenCalled();
 m.save.mockRejectedValue(new ConfigurationError('This paper changed.',409));expect((await call()).status).toBe(409);expect(m.save).toHaveBeenCalledTimes(1);
});
it('a provider failure leaves the stored brief alone and manual configuration available',async()=>{
 m.interpret.mockResolvedValue(null);const r=await call();expect(r.status).toBe(503);expect((await r.json()).error).toContain('choose options yourself');expect(m.save).not.toHaveBeenCalled();
});
