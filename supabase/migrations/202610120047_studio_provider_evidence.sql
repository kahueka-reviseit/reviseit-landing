begin;
-- Remote evidence is immutable and belongs to the original provider attempt, including late failures.
-- It grants no lease, retry, review or stage-completion authority.
create table private.studio_provider_evidence (
 provider_attempt_id uuid not null references private.studio_provider_attempts(id),
 kind text not null check(kind in ('request','exchange')),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 8388608),
 manifest jsonb not null,
 state text not null default 'pending' check(state in ('pending','verified')),
 created_at timestamptz not null default now(), verified_at timestamptz,
 primary key(provider_attempt_id,kind)
);
create table private.studio_provider_evidence_parts (
 provider_attempt_id uuid not null, kind text not null,
 ordinal integer not null check(ordinal between 0 and 7),
 module_id text not null references private.studio_modules(module_id),
 sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 1048576),
 blob_id uuid references private.studio_blobs(id),
 primary key(provider_attempt_id,kind,ordinal),
 foreign key(provider_attempt_id,kind) references private.studio_provider_evidence(provider_attempt_id,kind)
);
alter table private.studio_provider_evidence enable row level security;
alter table private.studio_provider_evidence_parts enable row level security;

create function public.studio_evidence_begin(p_provider_attempt uuid,p_kind text,p_sha256 text,p_size integer,p_parts jsonb,p_attempt uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare pa private.studio_provider_attempts; op private.studio_provider_operations; s private.studio_stages; m text; e private.studio_provider_evidence; part jsonb; n integer:=0; total integer:=0; k text;
begin
 if p_kind not in ('request','exchange') or coalesce(p_sha256,'') !~ '^[a-f0-9]{64}$' or p_size not between 1 and 8388608 or jsonb_typeof(p_parts) is distinct from 'array' then raise exception 'Invalid evidence manifest'; end if;
 if jsonb_array_length(p_parts) not between 1 and 8 then raise exception 'Invalid evidence parts'; end if;
 select * into pa from private.studio_provider_attempts where id=p_provider_attempt for update;
 if not found then raise exception 'Provider attempt not found'; end if;
 select * into op from private.studio_provider_operations where id=pa.operation_id;
 select r.module_id into m from private.studio_stages st join private.studio_runs r on r.id=st.run_id where st.id=op.stage_id;
 select * into e from private.studio_provider_evidence where provider_attempt_id=pa.id and kind=p_kind;
 if e.provider_attempt_id is not null then
  if e.sha256<>p_sha256 or e.size_bytes<>p_size or e.manifest<>p_parts then raise exception 'Evidence replay changed'; end if;
  return jsonb_build_object('state',e.state);
 end if;
 if p_kind='request' and pa.dispatch_state='prepared' then
  s:=private.studio_fence(p_attempt,p_lease);
  if op.stage_id<>s.id or op.current_attempt_id<>pa.id or pa.stage_attempt_id<>p_attempt or pa.dispatch_state<>'prepared' then raise exception 'Evidence request needs the current prepared attempt'; end if;
 elsif pa.dispatch_state not in ('dispatched','uncertain','succeeded','failed') then raise exception 'Evidence retention requires dispatch';
 end if;
 for part in select value from jsonb_array_elements(p_parts) loop
  if jsonb_typeof(part) is distinct from 'object' or (select count(*) from jsonb_object_keys(part))<>3 or part->>'ordinal'<>n::text or coalesce(part->>'sha256','') !~ '^[a-f0-9]{64}$' or (part->>'size')::integer not between 1 and 1048576 then raise exception 'Invalid evidence part'; end if;
  total:=total+(part->>'size')::integer;n:=n+1;
  k:='studio/blobs/'||m||'/'||(part->>'sha256');perform private.studio_key_lock(k);
  if exists(select 1 from private.studio_gc_claims where object_key=k) then raise exception 'Storage cleanup in progress; retry'; end if;
 end loop;
 if total<>p_size then raise exception 'Evidence size mismatch'; end if;
 insert into private.studio_provider_evidence(provider_attempt_id,kind,sha256,size_bytes,manifest) values(pa.id,p_kind,p_sha256,p_size,p_parts);
 insert into private.studio_provider_evidence_parts(provider_attempt_id,kind,ordinal,module_id,sha256,size_bytes)
 select pa.id,p_kind,(v->>'ordinal')::integer,m,v->>'sha256',(v->>'size')::integer from jsonb_array_elements(p_parts) v;
 return jsonb_build_object('state','pending');
end $$;

create function public.studio_evidence_info(p_provider_attempt uuid,p_kind text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('providerAttemptId',e.provider_attempt_id,'kind',e.kind,'sha256',e.sha256,'size',e.size_bytes,'state',e.state,
  'operation',o.operation,'requestDigest',o.request_digest,'resultDigest',a.result_digest,'dispatchState',a.dispatch_state,
  'parts',(select jsonb_agg(jsonb_build_object('ordinal',p.ordinal,'sha256',p.sha256,'size',p.size_bytes,'blobId',p.blob_id,'key','studio/blobs/'||p.module_id||'/'||p.sha256) order by p.ordinal) from private.studio_provider_evidence_parts p where p.provider_attempt_id=e.provider_attempt_id and p.kind=e.kind))
 from private.studio_provider_evidence e join private.studio_provider_attempts a on a.id=e.provider_attempt_id join private.studio_provider_operations o on o.id=a.operation_id
 where e.provider_attempt_id=p_provider_attempt and e.kind=p_kind
$$;

create function public.studio_evidence_part_commit(p_provider_attempt uuid,p_kind text,p_ordinal integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p private.studio_provider_evidence_parts; b private.studio_blobs;
begin
 select * into p from private.studio_provider_evidence_parts where provider_attempt_id=p_provider_attempt and kind=p_kind and ordinal=p_ordinal for update;
 if not found then raise exception 'Evidence intent missing'; end if;
 b:=private.studio_register_blob(p.module_id,p.sha256,p.size_bytes,'application/octet-stream');
 update private.studio_provider_evidence_parts set blob_id=b.id where provider_attempt_id=p_provider_attempt and kind=p_kind and ordinal=p_ordinal;
 return jsonb_build_object('blobId',b.id);
end $$;

-- Called only by the authenticated gateway after reading and checking the complete envelope.
create function public.studio_evidence_finish(p_provider_attempt uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.studio_provider_evidence;
begin
 select * into e from private.studio_provider_evidence where provider_attempt_id=p_provider_attempt and kind=p_kind for update;
 if not found or exists(select 1 from private.studio_provider_evidence_parts p where p.provider_attempt_id=p_provider_attempt and p.kind=p_kind and (p.blob_id is null or not private.studio_blob_ok(p.blob_id))) then raise exception 'Evidence parts are not verified'; end if;
 update private.studio_provider_evidence set state='verified',verified_at=coalesce(verified_at,now()) where provider_attempt_id=p_provider_attempt and kind=p_kind;
 return jsonb_build_object('state','verified','sha256',e.sha256);
end $$;

create function private.studio_evidence_guard() returns trigger language plpgsql set search_path='' as $$
begin
 -- Historical mock attempts have no evidence intent. New recorded workers always create one before dispatch.
 if exists(select 1 from private.studio_provider_evidence where provider_attempt_id=new.id and kind='request') then
  if new.dispatch_state='dispatched' and not exists(select 1 from private.studio_provider_evidence where provider_attempt_id=new.id and kind='request' and state='verified') then raise exception 'Evidence request is not durable'; end if;
  if new.dispatch_state in ('succeeded','failed') and not exists(select 1 from private.studio_provider_evidence where provider_attempt_id=new.id and kind='exchange' and state='verified' and sha256=new.result_digest) then raise exception 'Evidence response is not durable'; end if;
 end if;
 return new;
end $$;
create trigger studio_provider_evidence_guard before update on private.studio_provider_attempts for each row execute function private.studio_evidence_guard();

create function public.studio_evidence_pending() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('providerAttemptId',a.id,'dispatchState',a.dispatch_state,'requestState',q.state,'exchangeState',coalesce(e.state,'missing'),'integrityBlocked',exists(select 1 from private.studio_provider_evidence_parts p join private.studio_blobs b on b.id=p.blob_id where p.provider_attempt_id=a.id and b.integrity<>'verified'))),'[]'::jsonb)
 from private.studio_provider_attempts a join private.studio_provider_evidence q on q.provider_attempt_id=a.id and q.kind='request'
 left join private.studio_provider_evidence e on e.provider_attempt_id=a.id and e.kind='exchange'
 where q.state<>'verified' or (a.dispatch_state in ('dispatched','uncertain','succeeded','failed') and e.state is distinct from 'verified') or exists(select 1 from private.studio_provider_evidence_parts p join private.studio_blobs b on b.id=p.blob_id where p.provider_attempt_id=a.id and b.integrity<>'verified')
$$;

create or replace function public.studio_gc_claim(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_key !~ '^studio/(uploads|blobs)/[a-z0-9-]+/[A-Za-z0-9-]+$' then raise exception 'Invalid object key'; end if;
 perform private.studio_key_lock(p_key);
 if exists(select 1 from private.studio_provider_evidence_parts p where 'studio/blobs/'||p.module_id||'/'||p.sha256=p_key) then return false; end if;
 if p_key like 'studio/uploads/%' then
  if exists(select 1 from private.studio_upload_sessions where provisional_key=p_key and state in ('open','verifying') and expires_at > now()-interval '1 hour') then return false; end if;
 else
  if exists(select 1 from private.studio_blobs where immutable_key=p_key) then return false; end if;
  if exists(select 1 from private.studio_upload_sessions where target_key=p_key and state='verifying') then return false; end if;
 end if;
 insert into private.studio_gc_claims(object_key) values(p_key) on conflict do nothing;
 return true;
end $$;
revoke all on function public.studio_evidence_begin(uuid,text,text,integer,jsonb,uuid,uuid) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_evidence_begin(uuid,text,text,integer,jsonb,uuid,uuid) to service_role;
revoke all on function public.studio_evidence_info(uuid,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_evidence_info(uuid,text) to service_role;
revoke all on function public.studio_evidence_part_commit(uuid,text,integer) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_evidence_part_commit(uuid,text,integer) to service_role;
revoke all on function public.studio_evidence_finish(uuid,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_evidence_finish(uuid,text) to service_role;
revoke all on function public.studio_evidence_pending() from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_evidence_pending() to service_role;
-- Replay deterministic output from this exact attempt, without widening pinned input reads.
create function public.studio_retained_output(p_attempt uuid,p_lease uuid,p_logical_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s private.studio_stages;
begin
 s:=private.studio_fence(p_attempt,p_lease);
 return (select jsonb_build_object('blobId',b.id,'key',b.immutable_key,'sha256',b.sha256,'size',b.size_bytes,'mediaType',b.media_type)
 from private.studio_artifacts a join private.studio_blobs b on b.id=a.blob_id
 where a.stage_attempt_id=p_attempt and a.logical_key=p_logical_key and a.state='current');
end $$;
revoke all on function public.studio_retained_output(uuid,uuid,text) from public,anon,authenticated,reviseit_studio_operator;
grant execute on function public.studio_retained_output(uuid,uuid,text) to service_role;
commit;
