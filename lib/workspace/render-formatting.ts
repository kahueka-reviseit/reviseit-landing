import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isFormatting, type Formatting } from './contracts';
export type RenderFormatting = {schemaVersion:1; schoolId:string; schoolName:string; moduleId:string; revision:number; preferences:Formatting|null};
export async function readRenderFormatting(client:SupabaseClient, schoolId:string, moduleId:string, revision:number):Promise<RenderFormatting> {
  const {data,error}=await client.rpc('read_render_formatting',{target_module:moduleId,expected_revision:revision});
  if(error) {
    if(/Formatting changed/.test(error.message)) throw new Error('Formatting changed');
    if(/access required/.test(error.message)) throw new Error('Curriculum access required');
    throw new Error('Formatting unavailable');
  }
  if(!data || data.schemaVersion!==1 || data.schoolId!==schoolId || data.moduleId!==moduleId || data.revision!==revision ||
    typeof data.schoolName!=='string' || !data.schoolName.trim() ||
    (revision===0 ? data.preferences!==null : !isFormatting(data.preferences))) throw new Error('Unsupported formatting');
  // Closed output shape: never forward new database fields implicitly.
  return {schemaVersion:1,schoolId,schoolName:data.schoolName,moduleId,revision,preferences:data.preferences===null?null:{...data.preferences}};
}
