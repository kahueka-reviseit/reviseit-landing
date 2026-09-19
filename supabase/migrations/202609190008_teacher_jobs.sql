begin;
-- Internal test orders are provisioned by a trusted operator. Catalogue access is
-- not payment. No teacher-accessible order/entitlement creation function exists.
create table private.paper_orders (
 id uuid primary key default gen_random_uuid(), teacher_id uuid not null references auth.users(id),
 school_id uuid not null references public.schools(id), module_id text not null references public.curriculum_modules(id),
 release text not null, title text not null check(length(title) between 1 and 160),
 entitlement text not null check(entitlement='internal_test'),
 adapter_key text not null check(adapter_key ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
 form jsonb not null, snapshot jsonb not null,
 state text not null default 'awaiting_answers' check(state in
 ('awaiting_answers','queued','generating','awaiting_memo_review','rendering','awaiting_release','released','held','cancelled')),
 answers jsonb, submission_key uuid, submitted_at timestamptz,
 lease uuid, lease_until timestamptz, worker_id text,
 memo_text text, memo_hash text, memo_review jsonb,
 pack_hash text, release_review jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check ((answers is null) = (submission_key is null))
);
create table private.paper_documents (
 order_id uuid not null references private.paper_orders(id),
 name text not null check(name in ('paper','memo','learner-memo','teacher-description')),
 bytes bytea not null check(octet_length(bytes) between 1 and 10485760),
 sha256 text not null, primary key(order_id,name)
);
create table private.paper_job_events (
 id bigint generated always as identity primary key, order_id uuid not null references private.paper_orders(id),
 event text not null, actor text not null, detail jsonb not null default '{}', at timestamptz not null default now()
);
create table private.paper_reviewers (user_id uuid primary key references auth.users(id));
alter table private.paper_orders enable row level security;
alter table private.paper_documents enable row level security;
alter table private.paper_job_events enable row level security;
alter table private.paper_reviewers enable row level security;
revoke all on private.paper_orders,private.paper_documents,private.paper_job_events,private.paper_reviewers from public,anon,authenticated;

create function public.is_paper_reviewer() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.paper_reviewers r join auth.users u on u.id=r.user_id
 where r.user_id=auth.uid() and u.email_confirmed_at is not null);
$$;
create function private.can_read_order(o private.paper_orders) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(o.teacher_id=auth.uid() and o.school_id=public.approved_school_id()
 and exists(select 1 from public.school_curriculum_access a where a.school_id=o.school_id and a.module_id=o.module_id and a.active),false);
$$;
create function private.valid_order_form(f jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare q jsonb; op jsonb; seen text[]:='{}';
begin
 if jsonb_typeof(f)<>'array' or jsonb_array_length(f) not between 1 and 20 then return false; end if;
 for q in select value from jsonb_array_elements(f) loop
  if jsonb_typeof(q)<>'object' or q - array['id','label','options'] <> '{}'::jsonb
   or not (q ?& array['id','label','options']) or jsonb_typeof(q->'id')<>'string'
   or (q->>'id') !~ '^[a-z][a-z0-9_]{0,59}$' or q->>'id'=any(seen)
   or jsonb_typeof(q->'label')<>'string' or length(q->>'label') not between 1 and 300
   or jsonb_typeof(q->'options')<>'array' then return false; end if;
  if jsonb_array_length(q->'options') not between 1 and 30 then return false; end if;
  for op in select value from jsonb_array_elements(q->'options') loop
   if jsonb_typeof(op)<>'string' or length(op#>>'{}') not between 1 and 200 then return false; end if;
  end loop;
  if (select count(distinct value) from jsonb_array_elements(q->'options')) <> jsonb_array_length(q->'options') then return false; end if;
  seen:=array_append(seen,q->>'id');
 end loop;
 return true;
exception when others then return false;
end; $$;
create function private.valid_order_answers(f jsonb,a jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare q jsonb;
begin
 if a is null or jsonb_typeof(a)<>'object' or octet_length(a::text)>16000 then return false; end if;
 if (select count(*) from jsonb_object_keys(a)) <> jsonb_array_length(f) then return false; end if;
 for q in select value from jsonb_array_elements(f) loop
  if not a ? (q->>'id') or not (q->'options' @> jsonb_build_array(a->(q->>'id'))) then return false; end if;
 end loop;
 return true;
end; $$;
alter table private.paper_orders add constraint valid_form check(private.valid_order_form(form));

create function public.teacher_orders(target uuid default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',o.id,'title',o.title,'moduleId',o.module_id,'release',o.release,'internalTest',true,
 'state',o.state,'createdAt',o.created_at,'updatedAt',o.updated_at,
 'form',case when target is not null and o.state='awaiting_answers' then o.form else null end,
 'answers',case when target is not null then o.answers else null end,
 'documents',case when o.state='released' then to_jsonb(array['paper','memo','learner-memo','teacher-description']) else '[]'::jsonb end
 ) order by o.created_at desc),'[]'::jsonb)
 from (select * from private.paper_orders x where (target is null or x.id=target) and private.can_read_order(x)
 order by x.created_at desc limit 100) o;
$$;
create function public.submit_paper_answers(target uuid,request_key uuid,submitted_answers jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders;
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
 update private.paper_orders set answers=submitted_answers,submission_key=request_key,submitted_at=now(),state='queued',updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'submitted',auth.uid()::text);
 return o.id;
end; $$;

-- These functions are callable only by the server-side worker gateway. The
-- worker receives immutable order identity and cannot submit its own school.
create function public.claim_paper_job(worker text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; token uuid;
begin
 if worker is null or worker !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' then raise exception 'Invalid worker'; end if;
 select * into o from private.paper_orders x
 where (x.state='queued' or (x.state in ('generating','rendering') and x.lease_until<now()))
 and (x.worker_id is null or x.worker_id=worker)
 and exists(select 1 from public.teacher_accounts a join auth.users u on u.id=a.user_id
 where a.user_id=x.teacher_id and a.status='approved' and a.school_id=x.school_id
 and u.email_confirmed_at is not null and lower(u.email)=lower(a.email))
 and exists(select 1 from public.school_curriculum_access a where a.school_id=x.school_id and a.module_id=x.module_id and a.active)
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 -- A restarted worker must use the same persistent state volume. Another host
 -- must not replay possibly billable calls on a fresh volume.
 if o.worker_id is not null and o.worker_id<>worker then return null; end if;
 token:=gen_random_uuid();
 update private.paper_orders set lease=token,lease_until=now()+interval '90 seconds',worker_id=worker,
 state=case when o.state='queued' then 'generating' else o.state end,updated_at=now() where id=o.id;
 insert into private.paper_job_events(order_id,event,actor) values(o.id,'claimed',worker);
 return jsonb_build_object('resumed',o.worker_id is not null,'id',o.id,'lease',token,'adapterKey',o.adapter_key,'schoolId',o.school_id,
 'moduleId',o.module_id,'release',o.release,'answers',o.answers,'snapshot',o.snapshot,
 'memoReview',o.memo_review,'internalTest',true);
end; $$;
create function public.heartbeat_paper_job(target uuid,token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.paper_orders set lease_until=now()+interval '90 seconds' where id=target and lease=token
 and lease_until>now() and state in ('generating','rendering');
 if not found then raise exception 'Worker lease lost'; end if;
end; $$;
create function public.checkpoint_paper_job(target uuid,token uuid,stage text,artifact text default null) returns void
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; h text;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.lease is distinct from token or o.lease_until<=now() or o.state not in ('generating','rendering') then raise exception 'Worker lease lost'; end if;
 if stage='awaiting_memo_review' then
  if o.state<>'generating' or o.memo_review is not null or artifact is null or octet_length(artifact) not between 2 and 2000000
   or jsonb_typeof(artifact::jsonb)<>'object' then raise exception 'Invalid memo checkpoint'; end if;
  h:=encode(sha256(convert_to(artifact,'UTF8')),'hex');
  update private.paper_orders set memo_text=artifact,memo_hash=h,state=stage,lease=null,lease_until=null,updated_at=now() where id=target;
 elsif stage='rendering' then
  if o.memo_review is null then raise exception 'Memo approval required'; end if;
  update private.paper_orders set state=stage,updated_at=now() where id=target;
 elsif stage='held' then
  update private.paper_orders set state=stage,lease=null,lease_until=null,updated_at=now() where id=target;
 else raise exception 'Invalid checkpoint'; end if;
 insert into private.paper_job_events(order_id,event,actor) values(target,stage,o.worker_id);
end; $$;
create function public.complete_paper_job(target uuid,token uuid,documents jsonb) returns text
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
 update private.paper_orders set pack_hash=h,state='awaiting_release',lease=null,lease_until=null,updated_at=now() where id=target;
 insert into private.paper_job_events(order_id,event,actor,detail) values(target,'awaiting_release',o.worker_id,jsonb_build_object('packHash',h));
 return h;
end; $$;

-- Chunk uploads stay below hosted HTTP body limits. A complete pack is still
-- published atomically, and expired lease chunks can never be reused.
create table private.paper_upload_chunks (
 order_id uuid not null references private.paper_orders(id), lease uuid not null,
 name text not null check(name in ('paper','memo','learner-memo','teacher-description')),
 part integer not null check(part between 0 and 19),
 bytes bytea not null check(octet_length(bytes) between 1 and 524288),
 primary key(order_id,lease,name,part)
);
alter table private.paper_upload_chunks enable row level security;
revoke all on private.paper_upload_chunks from public,anon,authenticated;
create function public.upload_paper_chunk(target uuid,token uuid,document_name text,part_number integer,content text) returns void
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; b bytea; previous bytea;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found or o.lease is distinct from token or o.lease_until<=now() or o.state<>'rendering' then raise exception 'Worker lease lost'; end if;
 if content is null or octet_length(content)>700000 then raise exception 'Invalid chunk'; end if;
 b:=decode(content,'base64');
 delete from private.paper_upload_chunks where order_id=target and lease<>token;
 select bytes into previous from private.paper_upload_chunks where order_id=target and lease=token and name=document_name and part=part_number;
 if found then
  if previous<>b then raise exception 'Chunk changed'; end if;
  return;
 end if;
 insert into private.paper_upload_chunks values(target,token,document_name,part_number,b);
end; $$;
create function public.finish_paper_upload(target uuid,token uuid,expected_hashes jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare n text; b bytea; h text; docs jsonb:='{}'; c integer; maximum integer; o private.paper_orders;
begin
 select * into o from private.paper_orders where id=target for update;
 if not found then raise exception 'Worker lease lost'; end if;
 -- A lost acknowledgement may be retried after completion. Only the exact
 -- retained token and all four hashes can confirm the previously stored result.
 if o.state in ('awaiting_release','released') and o.lease=token then
  if (select count(*) from private.paper_documents d where d.order_id=target and expected_hashes->>d.name=d.sha256)=4
  and (select count(*) from jsonb_object_keys(expected_hashes))=4 then return o.pack_hash; end if;
  raise exception 'Pack changed';
 end if;
 if o.lease is distinct from token or o.lease_until<=now() or o.state<>'rendering' then raise exception 'Worker lease lost'; end if;
 if expected_hashes is null or jsonb_typeof(expected_hashes)<>'object' or (select count(*) from jsonb_object_keys(expected_hashes))<>4 then raise exception 'Four documents required'; end if;
 foreach n in array array['paper','memo','learner-memo','teacher-description'] loop
  select count(*),max(part),string_agg(bytes,''::bytea order by part) into c,maximum,b from private.paper_upload_chunks where order_id=target and lease=token and name=n;
  if c=0 or maximum<>c-1 or expected_hashes->>n is distinct from encode(sha256(b),'hex') then raise exception 'Incomplete document'; end if;
  docs:=docs||jsonb_build_object(n,encode(b,'base64'));
 end loop;
 h:=public.complete_paper_job(target,token,docs);
 update private.paper_orders set lease=token where id=target;
 delete from private.paper_upload_chunks where order_id=target;
 return h;
end; $$;
revoke all on function public.upload_paper_chunk(uuid,uuid,text,integer,text),public.finish_paper_upload(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.upload_paper_chunk(uuid,uuid,text,integer,text),public.finish_paper_upload(uuid,uuid,jsonb) to service_role;

create function public.review_paper_job(target uuid,stage text,expected_hash text,approve boolean,note text) returns void
language plpgsql security definer set search_path='' as $$
declare o private.paper_orders; review jsonb;
begin
 if not public.is_paper_reviewer() then raise exception 'Paper reviewer access required'; end if;
 select * into o from private.paper_orders where id=target for update;
 if not found or auth.uid()=o.teacher_id then raise exception 'Independent reviewer required'; end if;
 if approve is null or note is null or length(trim(note)) not between 10 and 2000 then raise exception 'Review evidence required'; end if;
 if stage not in ('memo','release') or stage is null then raise exception 'Invalid review stage'; end if;
 if (stage='memo' and (o.state<>'awaiting_memo_review' or expected_hash is distinct from o.memo_hash))
 or (stage='release' and (o.state<>'awaiting_release' or expected_hash is distinct from o.pack_hash)) then raise exception 'Review changed'; end if;
 review:=jsonb_build_object('actor',auth.uid(),'artifact_sha256',expected_hash,'approved',approve,'note',trim(note),'at',now());
 if stage='memo' then
  update private.paper_orders set memo_review=review,state=case when approve then 'queued' else 'held' end,updated_at=now() where id=target;
 else
  if (select count(*) from private.paper_documents where order_id=target)<>4 then raise exception 'Four documents required'; end if;
  update private.paper_orders set release_review=review,state=case when approve then 'released' else 'held' end,updated_at=now() where id=target;
 end if;
 insert into private.paper_job_events(order_id,event,actor,detail) values(target,stage||case when approve then '_approved' else '_rejected' end,auth.uid()::text,review);
end; $$;
create function public.paper_review_queue(target uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_paper_reviewer() then raise exception 'Paper reviewer access required'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'state',o.state,'schoolId',o.school_id,
 'memo',case when target is not null then o.memo_text else null end,'memoHash',o.memo_hash,'packHash',o.pack_hash)
 order by o.created_at),'[]'::jsonb) from private.paper_orders o
 where (target is null or o.id=target) and o.state in ('awaiting_memo_review','awaiting_release') and o.teacher_id<>auth.uid());
end; $$;
create function public.paper_document(target uuid,document_name text,for_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o private.paper_orders; d private.paper_documents;
begin
 select * into o from private.paper_orders where id=target;
 if not found then raise exception 'Document access required'; end if;
 if for_review then
  if not public.is_paper_reviewer() or o.teacher_id=auth.uid() or o.state<>'awaiting_release' then raise exception 'Document access required'; end if;
 else
  if not private.can_read_order(o) or o.state<>'released' then raise exception 'Document access required'; end if;
 end if;
 select * into d from private.paper_documents where order_id=target and name=document_name;
 if not found then raise exception 'Document access required'; end if;
 return jsonb_build_object('name',d.name,'base64',encode(d.bytes,'base64'),'sha256',d.sha256);
end; $$;

revoke all on function private.can_read_order(private.paper_orders), private.valid_order_form(jsonb),private.valid_order_answers(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.is_paper_reviewer(),public.teacher_orders(uuid),public.submit_paper_answers(uuid,uuid,jsonb),
 public.review_paper_job(uuid,text,text,boolean,text),public.paper_review_queue(uuid),public.paper_document(uuid,text,boolean),
 public.claim_paper_job(text),public.heartbeat_paper_job(uuid,uuid),public.checkpoint_paper_job(uuid,uuid,text,text),public.complete_paper_job(uuid,uuid,jsonb)
 from public,anon,authenticated;
grant execute on function public.is_paper_reviewer(),public.teacher_orders(uuid),public.submit_paper_answers(uuid,uuid,jsonb),
 public.review_paper_job(uuid,text,text,boolean,text),public.paper_review_queue(uuid),public.paper_document(uuid,text,boolean) to authenticated;
grant execute on function public.claim_paper_job(text),public.heartbeat_paper_job(uuid,uuid),
 public.checkpoint_paper_job(uuid,uuid,text,text),public.complete_paper_job(uuid,uuid,jsonb) to service_role;
commit;
