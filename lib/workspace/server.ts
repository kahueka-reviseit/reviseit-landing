import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { defaultFormatting, type Workspace, type Curriculum } from './contracts';
import { thumbnailFor } from './catalogue';
export async function readWorkspace(client: SupabaseClient, schoolId:string, moduleId?: string): Promise<Workspace> {
  const [moduleResult, schoolResult] = await Promise.all([
    client.from('curriculum_modules').select('id,name,current_release,is_demo').order('id'),
    client.from('schools').select('name').eq('id',schoolId).maybeSingle(),
  ]);
  if (moduleResult.error || schoolResult.error) throw new Error('Workspace unavailable');
  const curricula:Curriculum[]=(moduleResult.data || []).map(m=>({id:m.id,name:m.name,release:m.current_release,isDemo:m.is_demo}));
  const module=moduleId ? curricula.find(m=>m.id===moduleId) : curricula[0];
  if (moduleId && !module) throw new Error('Curriculum access required');
  const empty:Workspace={schoolName:schoolResult.data?.name || 'Your school',curricula,module:module || null,entries:[],formatting:{revision:0,preferences:defaultFormatting},selection:{revision:0,release:module?.release || '',entryIds:[]}};
  if (!module) return empty;
  const [catalogue, formatting, selection] = await Promise.all([
    client.from('catalogue_summaries').select('entry_id,title,topic,description,marks_min,marks_max,thumbnail_alt').eq('module_id',module.id).eq('release',module.release).order('entry_id'),
    client.from('school_formatting').select('revision,preferences').eq('module_id',module.id).maybeSingle(),
    client.from('paper_selections').select('revision,release,entry_ids').eq('module_id',module.id).maybeSingle(),
  ]);
  if (catalogue.error || formatting.error || selection.error) throw new Error('Workspace unavailable');
  return {...empty,
    entries:(catalogue.data || []).map(c=>({id:c.entry_id,title:c.title,topic:c.topic,description:c.description,marks:{min:c.marks_min,max:c.marks_max},thumbnail:thumbnailFor(module.id,module.release,c.entry_id,c.thumbnail_alt)})),
    formatting:formatting.data || empty.formatting,
    selection:selection.data ? {revision:selection.data.revision,release:selection.data.release,entryIds:selection.data.entry_ids} : empty.selection,
  };
}
