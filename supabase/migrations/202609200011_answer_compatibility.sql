-- Source-bound admission rules are private, immutable parts of new version-two plans.
-- Existing version-one test receipts remain readable. No publication or payment path is added.
create function private.valid_answer_policy(p jsonb,fs jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare r jsonb; point jsonb; seen text[]:='{}'; scoped_fields jsonb;
begin
 if not private.form_keys(p,array['compatibilityRules','instanceChoices'])
 or jsonb_typeof(p->'compatibilityRules') is distinct from 'array'
 or jsonb_typeof(p->'instanceChoices') is distinct from 'object' then return false; end if;
 if jsonb_array_length(p->'compatibilityRules')>100 then return false; end if;
 for r in select value from jsonb_array_elements(p->'compatibilityRules') loop
  if not private.form_keys(r,array['id','operator','when','then','teacherError']) or not private.form_id(r->'id')
   or r->>'id'=any(seen) or r->>'operator' is distinct from 'requires' or not private.form_text(r->'teacherError',500) then return false; end if;
  seen:=array_append(seen,r->>'id');
  for point in select value from jsonb_array_elements(jsonb_build_array(r->'when',r->'then')) loop
   if not private.form_keys(point,array['field','choiceId']) or not private.form_id(point->'field') or not private.form_id(point->'choiceId') then return false; end if;
   if not exists(select 1 from jsonb_array_elements(fs) field, lateral jsonb_array_elements(field->'choices') choice
    where field->'id'=point->'field' and field->>'type'='choice' and choice->'id'=point->'choiceId') then return false; end if;
  end loop;
 end loop;
 select coalesce(jsonb_agg(field),'[]'::jsonb) into scoped_fields from jsonb_array_elements(fs) field where p->'instanceChoices' ? (field->>'id');
 return private.valid_questionnaire_section(scoped_fields,p->'instanceChoices');
exception when others then return false;
end; $$;

create or replace function private.valid_generation_plan(p jsonb,f jsonb,module text,release text) returns boolean
language plpgsql immutable set search_path='' as $$
declare line jsonb; item jsonb; pos integer:=0;
begin
 if p is null then return true; end if;
 if not private.form_keys(p,array['schemaVersion','module','release','formRevision','lines','paper'])
  or coalesce(p->'schemaVersion' not in ('1'::jsonb,'2'::jsonb),true) or p->>'module' is distinct from module or p->>'release' is distinct from release
  or not private.valid_questionnaire(f) or p->'formRevision' is distinct from f->'revision'
  or jsonb_typeof(p->'lines') is distinct from 'array' or octet_length(p::text)>100000 then return false; end if;
 if jsonb_array_length(p->'lines')<>jsonb_array_length(f->'items') then return false; end if;
 if not private.form_keys(p->'paper',array['paper_label','subject','grade','date','exam_period','instructions']) then return false; end if;
 if jsonb_typeof(p->'paper'->'instructions') is distinct from 'array' then return false; end if;
 for line in select value from jsonb_array_elements(p->'lines') loop
  item:=f->'items'->pos;pos:=pos+1;
  if not private.form_keys(line,array['id','specification','profileKey','profileSha256','marks'] || case when p->'schemaVersion'='2'::jsonb then array['answerPolicy'] else array[]::text[] end)
   or line->'id' is distinct from item->'id' or line->'marks' is distinct from item->'marks'
   or not private.form_id(line->'profileKey') or not private.form_text(line->'specification',160)
   or not private.form_text(line->'profileSha256',64) or line->>'profileSha256' !~ '^[a-f0-9]{64}$' then return false; end if;
  if p->'schemaVersion'='2'::jsonb and not private.valid_answer_policy(line->'answerPolicy',item->'fields') then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;

create function private.answer_policy_error(p jsonb,a jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare entry record; selected jsonb:='{}'; r jsonb; changed boolean:=true; before_field text; after_field text;
begin
 for entry in select key,value from jsonb_each(p->'instanceChoices') loop
  if a->entry.key is distinct from entry.value then
   return jsonb_build_object('field',entry.key,'message','This answer is outside the supported version of this question.');
  end if;
 end loop;
 for entry in select key,value from jsonb_each(a) loop
  if entry.value->>'kind'='choice' then selected:=selected||jsonb_build_object(entry.key,entry.value->'choiceId'); end if;
 end loop;
 while changed loop
  changed:=false;
  for r in select value from jsonb_array_elements(p->'compatibilityRules') loop
   before_field:=r->'when'->>'field';after_field:=r->'then'->>'field';
   if selected->before_field is distinct from r->'when'->'choiceId' then continue; end if;
   if selected ? after_field then
    if selected->after_field is distinct from r->'then'->'choiceId' then
     return jsonb_build_object('field',after_field,'message',r->>'teacherError');
    end if;
   else
    selected:=selected||jsonb_build_object(after_field,r->'then'->'choiceId');changed:=true;
   end if;
  end loop;
 end loop;
 return null;
end; $$;
revoke all on function private.valid_answer_policy(jsonb,jsonb),private.answer_policy_error(jsonb,jsonb) from public,anon,authenticated;
create or replace function public.submit_paper_answers(target uuid,request_key uuid,submitted_answers jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; line jsonb; problem jsonb; item jsonb; field jsonb;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or not private.can_read_order(o) then raise exception 'Order access required'; end if;
 if request_key is null or not private.valid_order_answers(o.form,submitted_answers) then raise exception 'Invalid answers'; end if;
 if o.state in ('cancelled','held') then raise exception 'Order cannot be submitted'; end if;
 if o.submission_key is not null then
  if o.submission_key=request_key and o.answers=submitted_answers then return o.id; end if;
  raise exception 'Order already submitted';
 end if;
 if o.state<>'awaiting_answers' then raise exception 'Order already submitted'; end if;
 if o.generation_plan->'schemaVersion'='2'::jsonb then
  for line in select value from jsonb_array_elements(o.generation_plan->'lines') loop
   problem:=private.answer_policy_error(line->'answerPolicy',submitted_answers->'items'->(line->>'id'));
   if problem is not null then
    select value into item from jsonb_array_elements(o.form->'items') where value->'id'=line->'id';
    select value into field from jsonb_array_elements(item->'fields') where value->'id'=problem->'field';
    raise exception 'Incompatible answers' using detail=jsonb_build_object('itemId',line->>'id','fieldId',problem->>'field',
     'message',(item->>'title')||': '||(field->>'label')||': '||(problem->>'message'))::text;
   end if;
  end loop;
 end if;
 update private.paper_orders set answers=submitted_answers,submission_key=request_key,submitted_at=now(),state='queued',updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'submitted',auth.uid()::text);
 return o.id;
end; $$;

