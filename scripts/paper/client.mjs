import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

/**
 * Minimal Model Context Protocol client for the Paper desktop relay (`~/.paper/bin/paper mcp`).
 * Paper must be running with the files open. Every call names its file explicitly.
 */
export async function connectPaper({command=process.env.PAPER_CLI||path.join(os.homedir(),'.paper/bin/paper')}={}) {
  const child=spawn(command,['mcp'],{stdio:['pipe','pipe','inherit']});
  let buffer='',next=0;const waiting=new Map();
  child.stdout.on('data',chunk=>{buffer+=chunk;let at;
    while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!line)continue;
      let message;try{message=JSON.parse(line);}catch{continue;}
      if(message.id&&waiting.has(message.id)){waiting.get(message.id)(message);waiting.delete(message.id);}}});
  child.on('error',error=>{for(const resolve of waiting.values())resolve({error:{message:String(error)}});waiting.clear();});
  const rpc=(method,params)=>new Promise(resolve=>{const id=++next;waiting.set(id,resolve);
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'reviseit-paper-link',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const raw=async(name,args)=>{const reply=await rpc('tools/call',{name,arguments:args});
    if(reply.error)throw new Error(`${name}: ${JSON.stringify(reply.error)}`);
    const content=reply.result.content||[];
    if(reply.result.isError)throw new Error(`${name}: ${content.map(c=>c.text).join(' ')}`);
    return content;};
  /** The last text block that parses as JSON (the first block is always the file header). */
  const json=async(name,args)=>{const texts=(await raw(name,args)).filter(c=>c.type==='text').map(c=>c.text);
    for(const text of texts.slice().reverse()){try{return JSON.parse(text);}catch{}}
    return texts;};
  const tokenHash=async fileId=>JSON.parse((await raw('get_tokens',{fileId,namePattern:'--no-such-token'}))[0].text).contentHash.tokens;
  return {raw,json,tokenHash,close:()=>child.kill()};
}
