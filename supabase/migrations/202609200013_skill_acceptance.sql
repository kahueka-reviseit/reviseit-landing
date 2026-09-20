-- Content acceptance belongs to the completed generation skill.
-- Worker identity, leases, four-document checks and teacher access remain enforced.
create or replace function public.checkpoint_paper_job(target uuid,token uuid,stage text,artifact text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.lease is distinct from token or o.lease_until<=now() or o.state not in ('generating','rendering') then raise exception 'Worker lease lost'; end if;
 if stage='rendering' then
  update private.paper_orders set state=stage,updated_at=now() where id=target;
 elsif stage='held' then
  update private.paper_orders set state=stage,lease=null,lease_until=null,updated_at=now() where id=target;
 else raise exception 'Invalid checkpoint: content approval is not a workflow stage'; end if;
 insert into private.paper_job_events(order_id,event,actor) values(target,stage,o.worker_id);
end; $$;

create or replace function public.complete_paper_job(target uuid,token uuid,documents jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; n text; b bytea; h text; hashes text:='';
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.lease is distinct from token or o.lease_until<=now() or o.state<>'rendering' then raise exception 'Worker lease lost'; end if;
 if documents is null or jsonb_typeof(documents)<>'object' or not documents ?& array['paper','memo','learner-memo','teacher-description']
 or documents-array['paper','memo','learner-memo','teacher-description']<>'{}'::jsonb then raise exception 'Four documents required'; end if;
 foreach n in array array['paper','memo','learner-memo','teacher-description'] loop
  if jsonb_typeof(documents->n)<>'string' then raise exception 'Invalid document'; end if;
  b:=decode(documents->>n,'base64');
  if octet_length(b) not between 4 and 10485760 or substring(b from 1 for 4)<>decode('504b0304','hex') then raise exception 'Invalid Word document'; end if;
  h:=encode(sha256(b),'hex'); hashes:=hashes||n||':'||h||E'\n';
  insert into private.paper_documents(order_id,name,bytes,sha256) values(target,n,b,h);
 end loop;
 h:=encode(sha256(convert_to(hashes,'UTF8')),'hex');
 update private.paper_orders set pack_hash=h,state='released',lease=null,lease_until=null,updated_at=now() where id=target;
 insert into private.paper_job_events(order_id,event,actor,detail) values(target,'released',o.worker_id,jsonb_build_object('packHash',h));
 return h;
end; $$;

-- Old records stay immutable evidence. They are not automatically resumed or released.
create or replace function public.review_paper_job(target uuid,stage text,expected_hash text,approve boolean,note text) returns void
language plpgsql security definer set search_path='' as $$
begin
 raise exception 'External content approval has been retired; the skill workflow determines acceptance';
end; $$;

create or replace function public.paper_review_queue(target uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_paper_reviewer() then raise exception 'Paper reviewer access required'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'state',o.state,'schoolId',o.school_id,
 'memo',case when target is not null then o.memo_text else null end,'memoHash',o.memo_hash,'packHash',o.pack_hash)
 order by o.created_at),'[]'::jsonb) from private.paper_orders o
 where (target is null or o.id=target) and o.state in ('held','awaiting_memo_review','awaiting_release') and o.teacher_id<>auth.uid());
end; $$;
