-- Grouped forms remain private order data. No new order-creation or entitlement path.
create function private.form_keys(v jsonb, keys text[]) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='object' and v ?& keys and v-keys='{}'::jsonb,false);
$$;
create function private.form_id(v jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'
 and (v#>>'{}') not in ('constructor','prototype','__proto__'),false);
$$;
create function private.form_text(v jsonb, maximum integer, blank boolean default false) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(v)='string' and length(v#>>'{}')<=maximum
 and (blank or length(btrim(v#>>'{}',E' \t\n\r'))>0)
 and (v#>>'{}') !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]',false);
$$;
create function private.valid_questionnaire_fields(fs jsonb, maximum integer) returns boolean
language plpgsql immutable set search_path='' as $$
declare f jsonb; c jsonb; seen text[]:='{}'; choices text[];
begin
 if fs is null or jsonb_typeof(fs) is distinct from 'array' then return false; end if;
 if jsonb_array_length(fs)>maximum then return false; end if;
 for f in select value from jsonb_array_elements(fs) loop
  if not private.form_id(f->'id') or f->>'id'=any(seen)
   or not private.form_text(f->'label',300) or not private.form_text(f->'hint',1500,true)
   or coalesce(jsonb_typeof(f->'required'),'') is distinct from 'boolean'
   or coalesce(jsonb_typeof(f->'allowAutomatic'),'') is distinct from 'boolean' then return false; end if;
  seen:=array_append(seen,f->>'id');
  if f->>'type'='text' then
   if not private.form_keys(f,array['id','label','hint','required','allowAutomatic','type','maxLength'])
    or jsonb_typeof(f->'maxLength') is distinct from 'number' or (f->>'maxLength')::numeric not between 1 and 2000
    or trunc((f->>'maxLength')::numeric)<>(f->>'maxLength')::numeric then return false; end if;
  elsif f->>'type'='choice' then
   if not private.form_keys(f,array['id','label','hint','required','allowAutomatic','type','choices','allowOther'])
    or jsonb_typeof(f->'allowOther') is distinct from 'boolean' or jsonb_typeof(f->'choices') is distinct from 'array' then return false; end if;
   if jsonb_array_length(f->'choices') not between 1 and 30 then return false; end if;
   choices:='{}';
   for c in select value from jsonb_array_elements(f->'choices') loop
    if not private.form_keys(c,array['id','label']) or not private.form_id(c->'id')
     or c->>'id'=any(choices) or not private.form_text(c->'label',300) then return false; end if;
    choices:=array_append(choices,c->>'id');
   end loop;
  else return false;
  end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
create function private.valid_questionnaire(f jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; seen text[]:='{}'; total integer;
begin
 if not private.form_keys(f,array['schemaVersion','revision','items','paperFields'])
  or f->'schemaVersion' is distinct from '2'::jsonb or not private.form_text(f->'revision',64)
  or f->>'revision' !~ '^[a-f0-9]{64}$' or jsonb_typeof(f->'items') is distinct from 'array'
  or not private.valid_questionnaire_fields(f->'paperFields',20) then return false; end if;
 if jsonb_array_length(f->'items') not between 1 and 30 then return false; end if;
 total:=jsonb_array_length(f->'paperFields');
 for item in select value from jsonb_array_elements(f->'items') loop
  if not private.form_keys(item,array['id','title','marks','fields']) or not private.form_id(item->'id')
   or item->>'id'=any(seen) or not private.form_text(item->'title',160)
   or jsonb_typeof(item->'marks') is distinct from 'number' or (item->>'marks')::numeric not between 1 and 100
   or trunc((item->>'marks')::numeric)<>(item->>'marks')::numeric
   or not private.valid_questionnaire_fields(item->'fields',30) then return false; end if;
  if jsonb_array_length(item->'fields')<1 then return false; end if;
  seen:=array_append(seen,item->>'id');total:=total+jsonb_array_length(item->'fields');
  if total>200 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
create function private.valid_questionnaire_section(fs jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare f jsonb; answer jsonb;
begin
 if a is null or jsonb_typeof(a) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(a))<>jsonb_array_length(fs) then return false; end if;
 for f in select value from jsonb_array_elements(fs) loop
  answer:=a->(f->>'id');
  if answer is null then return false; end if;
  case answer->>'kind'
   when 'automatic' then
    if not private.form_keys(answer,array['kind']) or not (f->>'allowAutomatic')::boolean then return false; end if;
   when 'omit' then
    if not private.form_keys(answer,array['kind']) or (f->>'required')::boolean then return false; end if;
   when 'choice' then
    if not private.form_keys(answer,array['kind','choiceId']) or f->>'type'<>'choice'
     or not private.form_id(answer->'choiceId') then return false; end if;
    if not exists(select 1 from jsonb_array_elements(f->'choices') c where c->'id'=answer->'choiceId') then return false; end if;
   when 'text' then
    if not private.form_keys(answer,array['kind','text']) or not private.form_text(answer->'text',2000,true) then return false; end if;
    if f->>'type'='choice' then
     if not (f->>'allowOther')::boolean or not private.form_text(answer->'text',2000) then return false; end if;
    elsif not private.form_text(answer->'text',(f->>'maxLength')::integer,not (f->>'required')::boolean) then return false;
    end if;
   else return false;
  end case;
 end loop;
 return true;
exception when others then return false;
end; $$;
create function private.valid_questionnaire_answers(f jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb;
begin
 if not private.valid_questionnaire(f) or not private.form_keys(a,array['schemaVersion','revision','items','paper'])
  or a->'schemaVersion' is distinct from '2'::jsonb or a->'revision' is distinct from f->'revision'
  or octet_length(a::text)>64000 or jsonb_typeof(a->'items') is distinct from 'object'
  or not private.valid_questionnaire_section(f->'paperFields',a->'paper') then return false; end if;
 if (select count(*) from jsonb_object_keys(a->'items'))<>jsonb_array_length(f->'items') then return false; end if;
 for item in select value from jsonb_array_elements(f->'items') loop
  if not private.valid_questionnaire_section(item->'fields',a->'items'->(item->>'id')) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
-- Keep the original functions and their privileges for already issued flat orders.
alter function private.valid_order_form(jsonb) rename to valid_legacy_order_form;
alter function private.valid_order_answers(jsonb,jsonb) rename to valid_legacy_order_answers;
create function private.valid_order_form(f jsonb) returns boolean
language sql immutable set search_path='' as $$
 select case when jsonb_typeof(f)='array' then coalesce(private.valid_legacy_order_form(f),false)
 else private.valid_questionnaire(f) end;
$$;
create function private.valid_order_answers(f jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if not private.valid_order_form(f) then return false; end if;
 if jsonb_typeof(f)='array' then return coalesce(private.valid_legacy_order_answers(f,a),false); end if;
 return private.valid_questionnaire_answers(f,a);
exception when others then return false;
end; $$;
-- A constraint depends on the old function identity even after rename. Rebind it.
alter table private.paper_orders drop constraint valid_form;
alter table private.paper_orders add constraint valid_form check(private.valid_order_form(form));
revoke all on function private.form_keys(jsonb,text[]),private.form_id(jsonb),private.form_text(jsonb,integer,boolean),
 private.valid_questionnaire_fields(jsonb,integer),private.valid_questionnaire(jsonb),
 private.valid_questionnaire_section(jsonb,jsonb),private.valid_questionnaire_answers(jsonb,jsonb),
 private.valid_order_form(jsonb),private.valid_order_answers(jsonb,jsonb) from public,anon,authenticated;

-- A submitted receipt contains labels and chosen answers, not the full form or private snapshot.
create function private.questionnaire_receipt(f jsonb,a jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare section jsonb; field jsonb; answer jsonb; value text; result jsonb:='[]'; lines jsonb; sections jsonb;
begin
 if not private.valid_questionnaire_answers(f,a) then return null; end if;
 sections:=f->'items'||jsonb_build_array(jsonb_build_object('id','paper','title','Settings for the whole paper','fields',f->'paperFields','shared',true));
 for section in select x from jsonb_array_elements(sections) x loop
  lines:='[]';
  for field in select x from jsonb_array_elements(section->'fields') x loop
   answer:=case when section->'shared'='true'::jsonb then a->'paper'->(field->>'id') else a->'items'->(section->>'id')->(field->>'id') end;
   case answer->>'kind'
    when 'choice' then select c->>'label' into value from jsonb_array_elements(field->'choices') c where c->'id'=answer->'choiceId';
    when 'text' then value:=answer->>'text';
    when 'automatic' then value:='Choose for me';
    when 'omit' then value:='No preference';
   end case;
   lines:=lines||jsonb_build_array(jsonb_build_object('label',field->>'label','value',value));
  end loop;
  if jsonb_array_length(lines)>0 then result:=result||jsonb_build_array(jsonb_build_object('title',section->>'title','fields',lines)); end if;
 end loop;
 return result;
end; $$;
revoke all on function private.questionnaire_receipt(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.teacher_orders(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'title',o.title,'moduleId',o.module_id,'release',o.release,'internalTest',true,
 'state',o.state,'createdAt',o.created_at,'updatedAt',o.updated_at,
 'form',case when target is not null and o.state='awaiting_answers' then o.form else null end,
 'answers',case when target is not null then o.answers else null end,
 'answerSummary',case when target is not null and jsonb_typeof(o.form)='object' and o.answers is not null then private.questionnaire_receipt(o.form,o.answers) else null end,
 'documents',case when o.state='released' then to_jsonb(array['paper','memo','learner-memo','teacher-description']) else '[]'::jsonb end
 ) order by o.created_at desc),'[]'::jsonb)
 from (select * from private.paper_orders x where (target is null or x.id=target) and private.can_read_order(x)
 order by x.created_at desc limit 100) o;
$$;
