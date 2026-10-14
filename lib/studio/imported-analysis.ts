import {call,sha256,StudioError,type Rpc} from './contracts';
import type {StudioStorage} from './storage/types';
export { importedStatus, importedRole } from './presentation';
export async function readImportedFile(rpc:Rpc,storage:StudioStorage,id:string){
 const info=await call<any>(rpc,'studio_read_imported_file',{p_id:id});
 let bytes:Uint8Array|null;
 try{bytes=await storage.get(info.key);}catch{throw new StudioError('Imported file is temporarily inaccessible','integrity');}
 if(!bytes || bytes.length!==info.size || sha256(bytes)!==info.sha256){
  await call(rpc,'studio_report_integrity',{p_blob:info.blobId,p_state:bytes?'corrupt':'missing',p_detail:'Imported file failed read verification'});
  throw new StudioError('Integrity blocked: imported file differs from its recorded bytes','integrity');
 }
 return {info,bytes};
}
