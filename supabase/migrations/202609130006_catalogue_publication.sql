begin;
-- A dedicated delivery role. Provision a separate login externally; never grant to browser roles.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='reviseit_catalogue_publisher') then
  create role reviseit_catalogue_publisher nologin;
 end if;
end $$;

-- This is the receipt of the EXISTING publishCatalogue judgment, not a new approval API.
-- Only the trusted gate/operator can record it. Publisher and teachers cannot write receipts.
create table private.catalogue_gate_receipts (
 id uuid primary key,
 gate_action text not null check(gate_action='publishCatalogue'),
 gate_record_id text not null unique check(length(trim(gate_record_id)) between 1 and 200),
 reviewer_id text not null check(length(trim(reviewer_id)) between 1 and 200),
 approved_at timestamptz not null,
 expected_previous_release text,
 forms_digest text not null check(forms_digest ~ '^[a-f0-9]{64}$'),
 duplicate_skill_pairings_flagged boolean not null check(duplicate_skill_pairings_flagged),
 payload jsonb not null,
 revoked_at timestamptz,
 recorded_at timestamptz not null default now()
);
create table private.catalogue_imported_releases (
 module_id text not null references public.curriculum_modules(id),
 release text not null,
 approval_id uuid not null unique references private.catalogue_gate_receipts(id),
 payload jsonb not null,
 imported_at timestamptz not null default now(),
 primary key(module_id,release)
);
alter table private.catalogue_gate_receipts enable row level security;
alter table private.catalogue_imported_releases enable row level security;
revoke all on private.catalogue_gate_receipts,private.catalogue_imported_releases from public,anon,authenticated,reviseit_catalogue_publisher;

create function private.valid_catalogue_release(v jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; m jsonb; t jsonb; required text[]; k text;
begin
 required:=array['schema','status','module','release','contentDigest','entries'];
 if v is null or jsonb_typeof(v)<>'object' or not(v ?& required) or (v-required)<>'{}'::jsonb or octet_length(v::text)>20000000 then return false; end if;
 if v->>'schema' is distinct from 'reviseit/catalogue@2' or v->>'status' is distinct from 'published' then return false; end if;
 if jsonb_typeof(v->'release')<>'string' or length(trim(v->>'release')) not between 1 and 99 or jsonb_typeof(v->'contentDigest')<>'string' or v->>'contentDigest' !~ '^[a-f0-9]{64}$' then return false; end if;
 m:=v->'module';
 if jsonb_typeof(m)<>'object' or not(m ?& array['id','name']) or (m-array['id','name'])<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(m->'id')<>'string' or length(m->>'id')>120 or m->>'id' !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or jsonb_typeof(m->'name')<>'string' or length(trim(m->>'name')) not between 1 and 200 then return false; end if;
 if jsonb_typeof(v->'entries')<>'array' or jsonb_array_length(v->'entries') not between 1 and 500 then return false; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(v->'entries'))<>jsonb_array_length(v->'entries') then return false; end if;
 for e in select value from jsonb_array_elements(v->'entries') loop
  required:=array['id','code','kind','paper','title','topic','description','marks'];
  if jsonb_typeof(e)<>'object' or not(e ?& required) or (e-(required||array['preview','thumbnail']))<>'{}'::jsonb then return false; end if;
  foreach k in array array['id','code','kind','title','topic','description'] loop
   if jsonb_typeof(e->k)<>'string' or length(trim(e->>k))<1 then return false; end if;
  end loop;
  if e->>'kind' not in ('structured','mcq') or e->>'code' !~ '^[A-Z0-9_-]+$' or e->>'id'<>(e->>'kind')||':'||(e->>'code') or length(e->>'id')>120 or length(e->>'title')>200 or length(e->>'topic')>200 or length(e->>'description')>500 or e->'paper' not in ('1'::jsonb,'2'::jsonb) then return false; end if;
  m:=e->'marks';
  if jsonb_typeof(m)<>'object' or not(m ?& array['min','max']) or (m-array['min','max'])<>'{}'::jsonb then return false; end if;
  if jsonb_typeof(m->'min')<>'number' or jsonb_typeof(m->'max')<>'number' or (m->>'min')::numeric<>trunc((m->>'min')::numeric) or (m->>'max')::numeric<>trunc((m->>'max')::numeric) or (m->>'min')::numeric<1 or (m->>'max')::numeric<(m->>'min')::numeric or (m->>'max')::numeric>100 then return false; end if;
  if e ? 'preview' and not public.valid_catalogue_preview(e->'preview') then return false; end if;
  if e ? 'thumbnail' then
   t:=e->'thumbnail';
   if jsonb_typeof(t)<>'object' or not(t ?& array['png','alt']) or (t-array['png','alt'])<>'{}'::jsonb then return false; end if;
   if jsonb_typeof(t->'png')<>'string' or length(t->>'png') not between 12 and 350000 or t->>'png' !~ '^iVBORw0KGgo[A-Za-z0-9+/=]+$' or jsonb_typeof(t->'alt')<>'string' or length(trim(t->>'alt')) not between 1 and 300 then return false; end if;
   if substring(decode(t->>'png','base64') from 1 for 8)<>decode('89504e470d0a1a0a','hex') then return false; end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function private.valid_catalogue_release(jsonb) from public,anon,authenticated,reviseit_catalogue_publisher;

create function public.import_catalogue_release(approval_id uuid,manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt private.catalogue_gate_receipts%rowtype; prior private.catalogue_imported_releases%rowtype;
 module_key text; release_key text; current_version text; e jsonb; module_exists boolean;
begin
 if not private.valid_catalogue_release(manifest) then raise exception 'Invalid published catalogue'; end if;
 module_key:=manifest->'module'->>'id'; release_key:=manifest->>'release';
 -- Lock absent modules too, preventing two initial publications from racing.
 perform pg_advisory_xact_lock(hashtextextended(module_key,0));
 select * into receipt from private.catalogue_gate_receipts where id=approval_id for share;
 if not found or receipt.revoked_at is not null or receipt.payload<>manifest then raise exception 'Catalogue approval required'; end if;
 select * into prior from private.catalogue_imported_releases where module_id=module_key and release=release_key;
 if found then
  if prior.payload<>manifest or prior.approval_id<>approval_id then raise exception 'Catalogue release is immutable'; end if;
  -- A delayed identical retry NEVER reactivates a historical release.
  return jsonb_build_object('status','already-imported','module',module_key,'release',release_key);
 end if;
 select current_release into current_version from public.curriculum_modules where id=module_key for update;
 module_exists:=found;
 if (module_exists and current_version is distinct from receipt.expected_previous_release) or (not module_exists and receipt.expected_previous_release is not null) then raise exception 'Catalogue predecessor changed'; end if;
 if exists(select 1 from public.catalogue_summaries where module_id=module_key and release=release_key) then raise exception 'Catalogue release already exists outside publication history'; end if;
 if not module_exists then
  insert into public.curriculum_modules(id,name,current_release,is_demo) values(module_key,manifest->'module'->>'name',release_key,false);
 end if;
 for e in select value from jsonb_array_elements(manifest->'entries') loop
  insert into public.catalogue_summaries(module_id,release,entry_id,title,topic,description,marks_min,marks_max,preview,thumbnail_png,thumbnail_alt)
  values(module_key,release_key,e->>'id',e->>'title',e->>'topic',e->>'description',(e->'marks'->>'min')::int,(e->'marks'->>'max')::int,e->'preview',e->'thumbnail'->>'png',e->'thumbnail'->>'alt');
 end loop;
 insert into private.catalogue_imported_releases(module_id,release,approval_id,payload) values(module_key,release_key,approval_id,manifest);
 update public.curriculum_modules set name=manifest->'module'->>'name',current_release=release_key where id=module_key;
 return jsonb_build_object('status','imported','module',module_key,'release',release_key,'entries',jsonb_array_length(manifest->'entries'));
end $$;
revoke all on function public.import_catalogue_release(uuid,jsonb) from public,anon,authenticated;
-- Supabase may grant function execution to service_role through default privileges.
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  revoke all on function public.import_catalogue_release(uuid,jsonb) from service_role;
  revoke all on private.catalogue_gate_receipts,private.catalogue_imported_releases from service_role;
 end if;
end $$;
grant usage on schema public to reviseit_catalogue_publisher;
grant execute on function public.import_catalogue_release(uuid,jsonb) to reviseit_catalogue_publisher;

create function private.protect_imported_catalogue_rows() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (tg_op<>'INSERT' and exists(select 1 from private.catalogue_imported_releases where module_id=old.module_id and release=old.release)) or
    (tg_op<>'DELETE' and exists(select 1 from private.catalogue_imported_releases where module_id=new.module_id and release=new.release)) then
  raise exception 'Catalogue release is immutable';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function private.protect_imported_catalogue_rows() from public,anon,authenticated,reviseit_catalogue_publisher;
create trigger protect_imported_catalogue_rows before insert or update or delete on public.catalogue_summaries for each row execute function private.protect_imported_catalogue_rows();
commit;
