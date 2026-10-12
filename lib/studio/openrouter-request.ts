// Offline admission only. The database still refuses live profiles and contracts.
import { createHash } from 'node:crypto';
const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const keys=(v:any,names:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...names].sort().join('|');
const fail=():never=>{throw new Error('Budget OpenRouter request violates pinned contract');};
const price=(micro:number)=>{const whole=Math.floor(micro/1000000),fraction=String(micro%1000000).padStart(6,'0').replace(/0+$/,'');return String(whole)+(fraction?'.'+fraction:'');};

export function unwrapOpenRouter(envelope:any,contract:any){
 const p=contract.evidence?.openrouter;
 if(!keys(envelope,['schema','profileDigest','pins','wireBody','wireSha256'])||envelope.schema!=='reviseit/openrouter-request@1'
   ||!keys(p,['endpoint','model','provider','capability_sha256','pricing_sha256','input_micro_per_million','output_micro_per_million'])
   ||p.endpoint!=='https://openrouter.ai/api/v1/chat/completions'||contract.endpoint!==p.endpoint
   ||!['model','provider'].every(k=>typeof p[k]==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(p[k]))
   ||!['capability_sha256','pricing_sha256'].every(k=>typeof p[k]==='string'&&/^[a-f0-9]{64}$/.test(p[k])&&p[k]===contract[k])
   ||!['input_micro_per_million','output_micro_per_million'].every(k=>Number.isSafeInteger(p[k])&&p[k]>0&&p[k]<=1e12&&p[k]===Number(contract[k]))
   ||p.model!==contract.model||envelope.profileDigest!==hash(canonical(p))
   ||typeof envelope.wireBody!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.wireBody))fail();
 const raw=Buffer.from(envelope.wireBody,'base64');
 if(hash(raw)!==envelope.wireSha256)fail();
 let wire:any;try{wire=JSON.parse(raw.toString('utf8'));}catch{fail();}
 const provider={order:[p.provider],only:[p.provider],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true,
   max_price:{prompt:price(p.input_micro_per_million),completion:price(p.output_micro_per_million)}};
 if(!keys(wire,['model','max_tokens','stream','tools','messages','provider'])||canonical(wire.provider)!==canonical(provider))fail();
 const {provider:_,...request}=wire;
 return {...request,pins:envelope.pins};
}
