import {render,screen,waitFor,fireEvent,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import JevAdvice from '../../app/(accounts)/teacher/orders/[id]/jev-advice';
const props={orderId:'synthetic',lineId:'q1',revision:1,enabled:true,saved:true,answers:{note:{kind:'text' as const,text:'Use blue'}},fields:[{id:'shade',type:'choice' as const,label:'Shade',hint:'',required:true,allowAutomatic:true,allowOther:true,choices:[{id:'blue',label:'Blue'}]}],onAccept:vi.fn()};
afterEach(()=>{cleanup();vi.unstubAllGlobals();props.onAccept.mockReset();});
it('does not call while typing, unsaved, blank or disabled',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const v=render(<JevAdvice {...props} saved={false}/>);await new Promise(r=>setTimeout(r,1000));expect(fetch).not.toHaveBeenCalled();
 v.rerender(<JevAdvice {...props} answers={{}}/>);await new Promise(r=>setTimeout(r,1000));expect(fetch).not.toHaveBeenCalled();
 v.rerender(<JevAdvice {...props} enabled={false}/>);expect(screen.queryByLabelText('Jev suggestions')).toBeNull();
});
it('checks saved state and only changes an answer after an explicit click',async()=>{
 const fetch=vi.fn(async()=>new Response(JSON.stringify({status:'checked',hints:[{checkId:'one',field:'shade',text:'It sounds like you want blue.',suggestion:{field:'shade',option:'blue'}}]})));vi.stubGlobal('fetch',fetch);
 render(<JevAdvice {...props}/>);await screen.findByText('It sounds like you want blue.',{},{timeout:2500});expect(props.onAccept).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Use Blue'}));expect(props.onAccept).toHaveBeenCalledWith('shade',{kind:'choice',choiceId:'blue'});
 fireEvent.click(screen.getByRole('button',{name:'Keep my answer'}));expect(screen.queryByText('It sounds like you want blue.')).toBeNull();expect(fetch).toHaveBeenCalledTimes(1);
});
it('discards a late reply when a teacher edits again',async()=>{
 let resolve:(r:Response)=>void=()=>{};const fetch=vi.fn(()=>new Promise<Response>(r=>{resolve=r;}));vi.stubGlobal('fetch',fetch);
 const v=render(<JevAdvice {...props}/>);await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1),{timeout:2500});v.rerender(<JevAdvice {...props} saved={false} answers={{note:{kind:'text',text:'Now red'}}}/>);
 resolve(new Response(JSON.stringify({status:'checked',hints:[{checkId:'old',field:'note',text:'Stale advice'}]})));await new Promise(r=>setTimeout(r,50));expect(screen.queryByText('Stale advice')).toBeNull();
});
