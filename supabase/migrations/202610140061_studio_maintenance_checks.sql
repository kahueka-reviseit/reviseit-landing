-- Isolated full-bank checks for explicitly selected maintenance revisions.
-- Content review never grants bank integration or teacher publication authority.
create table private.studio_maintenance_checks (
 id uuid primary key default gen_random_uuid(), snapshot_id uuid not null references private.studio_snapshots(id),
 entries jsonb not null, candidate_manifest_sha256 text not null, validator_sha256 text not null,
 state text not null default 'queued' check(state in ('queued','running','succeeded','failed')),
 lease uuid, lease_until timestamptz, worker text, error text,
 report_blob_id uuid references private.studio_blobs(id), report jsonb,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),completed_at timestamptz,
 review_version integer not null default 0
);
create table private.studio_maintenance_reviews (
 id uuid primary key default gen_random_uuid(),check_id uuid not null references private.studio_maintenance_checks(id),
 version integer not null, reviewer uuid not null references auth.users(id),self_reviewed boolean not null,
 outcome text not null check(outcome in ('approved','returned','rejected')),rationale text not null,
 acknowledgements jsonb not null,report_sha256 text not null,created_at timestamptz not null default now(),unique(check_id,version)
);
alter table private.studio_maintenance_checks enable row level security;
alter table private.studio_maintenance_reviews enable row level security;
revoke all on private.studio_maintenance_checks,private.studio_maintenance_reviews from public,anon,authenticated,service_role,reviseit_studio_operator;
create trigger studio_immutable before update or delete on private.studio_maintenance_reviews for each row execute function private.studio_immutable();

create function private.studio_maintenance_check_current(c private.studio_maintenance_checks) returns boolean language sql stable set search_path='' as $$
 select not exists(select 1 from jsonb_array_elements(c.entries) e left join private.studio_maintenance_drafts d on d.id=(e->>'draftId')::uuid
 left join private.studio_maintenance_revisions r on r.draft_id=d.id and r.revision=d.revision
 left join private.studio_blobs b on b.id=r.blob_id
 where d.id is null or d.state<>'draft' or d.revision<>(e->>'revision')::integer or b.sha256 is distinct from e->>'sha256' or b.integrity is distinct from 'verified')
 and not exists(select 1 from private.studio_snapshot_files f join private.studio_blobs b on b.id=f.blob_id where f.snapshot_id=c.snapshot_id and b.integrity<>'verified')
 and exists(select 1 from private.studio_snapshots s join private.studio_modules m on m.module_id=s.module_id where s.id=c.snapshot_id and (s.purpose='rehearsal' or m.accepted_snapshot_id=s.id));
$$;
create function private.studio_maintenance_check_files(c private.studio_maintenance_checks) returns jsonb language sql stable set search_path='' as $$
 select jsonb_agg(jsonb_build_object('path',f.path,'sha256',coalesce(e->>'sha256',f.sha256),'blobId',coalesce((e->>'blobId')::uuid,f.blob_id),'size',b.size_bytes,'mediaType',b.media_type) order by f.path collate "C")
 from private.studio_snapshot_files f left join lateral(select x from jsonb_array_elements(c.entries) x where x->>'path'=f.path) j(e) on true
 join private.studio_blobs b on b.id=coalesce((e->>'blobId')::uuid,f.blob_id) where f.snapshot_id=c.snapshot_id;
$$;
create function public.studio_request_maintenance_check(p_snapshot uuid,p_entries jsonb,p_command uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();req jsonb:=jsonb_build_array(p_snapshot,p_entries);res jsonb;s private.studio_snapshots;e jsonb;d private.studio_maintenance_drafts;b private.studio_blobs;entries jsonb:='[]';c private.studio_maintenance_checks;files jsonb;
begin
 res:=private.studio_replay(me::text,p_command,'request_maintenance_check',req);if res is not null then return res;end if;
 select * into s from private.studio_snapshots where id=p_snapshot;
 if not found or s.subject_adapter not in ('caps-physical-sciences@1','caps-physical-sciences@2') then raise exception 'This bank checker supports Physical Sciences only';end if;
 if s.purpose<>'rehearsal' and not exists(select 1 from private.studio_modules where module_id=s.module_id and accepted_snapshot_id=s.id) then raise exception 'Select the current accepted bank or a rehearsal copy';end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 50 then raise exception 'Select 1 to 50 saved drafts';end if;
 -- Consistent lock order also serialises review against concurrent saves/discards.
 for e in select value from jsonb_array_elements(p_entries) order by value->>'draftId' loop
  select * into d from private.studio_maintenance_drafts where id=(e->>'draftId')::uuid for update;
  if not found or d.snapshot_id<>s.id or d.state<>'draft' or d.revision is distinct from (e->>'revision')::integer then raise exception 'Draft changed or belongs to another bank';end if;
  select x.* into b from private.studio_maintenance_revisions r join private.studio_blobs x on x.id=r.blob_id where r.draft_id=d.id and r.revision=d.revision;
  if b.sha256 is distinct from e->>'sha256' or b.integrity<>'verified' then raise exception 'Draft bytes changed or failed integrity';end if;
  if exists(select 1 from jsonb_array_elements(entries) x where x->>'path'=d.path) then raise exception 'Duplicate draft';end if;
  entries:=entries||jsonb_build_array(jsonb_build_object('draftId',d.id,'revision',d.revision,'path',d.path,'sha256',b.sha256,'blobId',b.id,'author',(select created_by from private.studio_maintenance_revisions where draft_id=d.id and revision=d.revision)));
 end loop;
 c.snapshot_id:=s.id;c.entries:=entries;files:=private.studio_maintenance_check_files(c);
 if jsonb_array_length(files)>5000 or (select sum((x->>'size')::bigint) from jsonb_array_elements(files) x)>67108864 then raise exception 'Candidate exceeds the 5000 file / 64 MB check limit';end if;
 insert into private.studio_maintenance_checks(snapshot_id,entries,candidate_manifest_sha256,validator_sha256,created_by)
 values(s.id,entries,private.studio_sha(private.studio_manifest_text(s.module_id,files)),'4c927946377193eca3b7f3558aa2abb590abae0771d5f498a97cb281df50cd7f',me) returning * into c;
 perform private.studio_event(s.module_id,null,'editor',me::text,'maintenance_check_requested',jsonb_build_object('checkId',c.id,'candidate',c.candidate_manifest_sha256));
 return private.studio_remember(me::text,p_command,'request_maintenance_check',req,jsonb_build_object('checkId',c.id));
end $$;
create function public.studio_claim_maintenance_check(p_worker text,p_validator text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_maintenance_checks;s private.studio_snapshots;
begin
 if p_worker is null or p_worker !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$' then raise exception 'Invalid worker';end if;
 select * into c from private.studio_maintenance_checks where state='queued' and validator_sha256=p_validator order by created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 if not private.studio_maintenance_check_current(c) then update private.studio_maintenance_checks set state='failed',error='Drafts or bank changed before checking',completed_at=now() where id=c.id;return null;end if;
 update private.studio_maintenance_checks set state='running',worker=p_worker,lease=gen_random_uuid(),lease_until=now()+interval '30 minutes' where id=c.id returning * into c;
 select * into s from private.studio_snapshots where id=c.snapshot_id;
 return jsonb_build_object('checkId',c.id,'lease',c.lease,'moduleId',s.module_id,'candidateManifestSha256',c.candidate_manifest_sha256,'validatorSha256',c.validator_sha256,'subjectAdapter',s.subject_adapter,'entries',c.entries,'files',private.studio_maintenance_check_files(c));
end $$;
create function private.studio_maintenance_check_lease(p_check uuid,p_lease uuid) returns private.studio_maintenance_checks language plpgsql volatile set search_path='' as $$
declare c private.studio_maintenance_checks;begin
 select * into c from private.studio_maintenance_checks where id=p_check for update;
 if not found or c.state<>'running' or c.lease is distinct from p_lease or c.lease_until<=now() then raise exception 'Studio lease lost';end if;
 if not private.studio_maintenance_check_current(c) then raise exception 'Studio lease lost: maintenance revision changed';end if;return c;
end $$;
create function public.studio_maintenance_check_read(p_check uuid,p_lease uuid,p_blob uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_maintenance_checks;b private.studio_blobs;begin
 c:=private.studio_maintenance_check_lease(p_check,p_lease);
 if not exists(select 1 from jsonb_array_elements(private.studio_maintenance_check_files(c)) x where x->>'blobId'=p_blob::text) then raise exception 'Input not available to this maintenance check';end if;
 select * into b from private.studio_blobs where id=p_blob;
 if b.integrity<>'verified' then raise exception 'Integrity blocked';end if;
 return jsonb_build_object('blobId',b.id,'key',b.immutable_key,'size',b.size_bytes,'sha256',b.sha256,'mediaType',b.media_type);
end $$;
create function public.studio_maintenance_check_context(p_check uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_maintenance_checks;begin
 select * into c from private.studio_maintenance_checks where id=p_check;
 if c.state is distinct from 'succeeded' or c.lease is distinct from p_lease then c:=private.studio_maintenance_check_lease(p_check,p_lease);end if;return jsonb_build_object('moduleId',(select module_id from private.studio_snapshots where id=c.snapshot_id));end $$;
create function public.studio_finish_maintenance_check(p_check uuid,p_lease uuid,p_report jsonb,p_sha256 text,p_size bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_maintenance_checks;b private.studio_blobs;m text;begin
 select * into c from private.studio_maintenance_checks where id=p_check for update;
 if c.state='succeeded' and c.lease=p_lease and c.report=p_report and exists(select 1 from private.studio_blobs where id=c.report_blob_id and sha256=p_sha256) then return jsonb_build_object('checkId',c.id,'state',c.state);end if;
 c:=private.studio_maintenance_check_lease(p_check,p_lease);
 if p_report->>'schema' is distinct from 'reviseit/maintenance-check@1' or p_report->>'checkId' is distinct from c.id::text or p_report->>'candidateManifestSha256' is distinct from c.candidate_manifest_sha256 or p_report->>'validatorSha256' is distinct from c.validator_sha256
 or jsonb_typeof(p_report->'structuralOk') is distinct from 'boolean' or jsonb_typeof(p_report->'errors') is distinct from 'array' or jsonb_typeof(p_report->'warnings') is distinct from 'array'
 or jsonb_typeof(p_report->'checks') is distinct from 'array' or jsonb_typeof(p_report->'notChecked') is distinct from 'array'
 or jsonb_typeof(p_report->'fileCount') is distinct from 'number' or jsonb_typeof(p_report->'authoredFormCount') is distinct from 'number'
 or p_report->>'humanReview' is distinct from 'pending' or p_report->'integrationOccurred' is distinct from 'false'::jsonb
 or (p_report->>'structuralOk')::boolean is distinct from (jsonb_array_length(p_report->'errors')=0) or p_size not between 1 and 1500000 then raise exception 'Invalid maintenance validation report';end if;
 select module_id into m from private.studio_snapshots where id=c.snapshot_id;
 b:=private.studio_register_blob(m,p_sha256,p_size,'application/json');
 if b.integrity<>'verified' then raise exception 'Integrity blocked: use explicit recovery';end if;
 update private.studio_maintenance_checks set state='succeeded',report=p_report,report_blob_id=b.id,completed_at=now() where id=c.id;
 return jsonb_build_object('checkId',c.id,'state','succeeded');
end $$;
create function public.studio_fail_maintenance_check(p_check uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.studio_maintenance_checks;begin
 select * into c from private.studio_maintenance_checks where id=p_check for update;
 if c.state<>'running' or c.lease is distinct from p_lease then raise exception 'Studio lease lost';end if;
 update private.studio_maintenance_checks set state='failed',error='The isolated check did not complete. Explicitly request a new check to try again.',completed_at=now() where id=c.id;
 return jsonb_build_object('checkId',c.id,'state','failed');end $$;
create function public.studio_maintenance_check_view(p_check uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();c private.studio_maintenance_checks;s private.studio_snapshots;begin
 select * into c from private.studio_maintenance_checks where id=p_check;if not found then raise exception 'Check not found';end if;
 select * into s from private.studio_snapshots where id=c.snapshot_id;
 return jsonb_build_object('id',c.id,'moduleId',s.module_id,'snapshotId',s.id,'purpose',s.purpose,'baseManifestSha256',s.manifest_sha256,'candidateManifestSha256',c.candidate_manifest_sha256,'validatorSha256',c.validator_sha256,
 'entries',(select jsonb_agg(e-'author') from jsonb_array_elements(c.entries) e),'state',c.state,'current',private.studio_maintenance_check_current(c),'expired',c.state='running' and c.lease_until<=now(),'error',c.error,'createdAt',c.created_at,'completedAt',c.completed_at,'reviewVersion',c.review_version,
 'report',c.report,'reportBlobId',c.report_blob_id,'reportSha256',(select sha256 from private.studio_blobs where id=c.report_blob_id),
 'reviews',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'version',r.version,'outcome',r.outcome,'rationale',r.rationale,'selfReviewed',r.self_reviewed,'createdAt',r.created_at) order by r.version desc),'[]'::jsonb) from private.studio_maintenance_reviews r where r.check_id=c.id));end $$;
create function public.studio_maintenance_checks_view(p_snapshot uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();begin return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'state',c.state,'createdAt',c.created_at,'current',private.studio_maintenance_check_current(c)) order by c.created_at desc),'[]'::jsonb) from private.studio_maintenance_checks c where c.snapshot_id=p_snapshot);end $$;
create function public.studio_review_maintenance_check(p_check uuid,p_version integer,p_report_sha256 text,p_outcome text,p_rationale text,p_acknowledgements jsonb,p_command uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor();c private.studio_maintenance_checks;r private.studio_maintenance_reviews;req jsonb:=jsonb_build_array(p_check,p_version,p_report_sha256,p_outcome,p_rationale,p_acknowledgements);res jsonb;e jsonb;begin
 res:=private.studio_replay(me::text,p_command,'review_maintenance_check',req);if res is not null then return res;end if;
 select * into c from private.studio_maintenance_checks where id=p_check for update;
 if not found or c.state<>'succeeded' or c.review_version is distinct from p_version then raise exception 'Check or review changed. Refresh before reviewing';end if;
 for e in select value from jsonb_array_elements(c.entries) order by value->>'draftId' loop perform 1 from private.studio_maintenance_drafts where id=(e->>'draftId')::uuid for update;end loop;
 perform 1 from private.studio_modules where module_id=(select module_id from private.studio_snapshots where id=c.snapshot_id) for update;
 if not private.studio_maintenance_check_current(c) then raise exception 'Drafts or accepted bank changed. A fresh check and review are required';end if;
 if not exists(select 1 from private.studio_blobs where id=c.report_blob_id and sha256=p_report_sha256 and integrity='verified') then raise exception 'Validation report changed or failed integrity';end if;
 if p_outcome is null or p_outcome not in ('approved','returned','rejected') or p_rationale is null or length(btrim(p_rationale)) not between 10 and 4000 then raise exception 'Select an outcome and give a reason of 10 to 4000 characters';end if;
 if p_outcome='approved' and ((c.report->>'structuralOk')::boolean is not true or p_acknowledgements is distinct from '{"findings":true,"sources":true,"compatibility":true,"content":true}'::jsonb) then raise exception 'Passing structural checks and all four human review acknowledgements are required';end if;
 insert into private.studio_maintenance_reviews(check_id,version,reviewer,self_reviewed,outcome,rationale,acknowledgements,report_sha256)
 values(c.id,c.review_version+1,me,exists(select 1 from jsonb_array_elements(c.entries) x where x->>'author'=me::text),p_outcome,btrim(p_rationale),coalesce(p_acknowledgements,'{}'),p_report_sha256) returning * into r;
 update private.studio_maintenance_checks set review_version=r.version where id=c.id;
 return private.studio_remember(me::text,p_command,'review_maintenance_check',req,jsonb_build_object('checkId',c.id,'reviewVersion',r.version));end $$;
revoke all on function private.studio_maintenance_check_current(private.studio_maintenance_checks),private.studio_maintenance_check_files(private.studio_maintenance_checks),private.studio_maintenance_check_lease(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.studio_request_maintenance_check(uuid,jsonb,uuid),public.studio_maintenance_check_view(uuid),public.studio_maintenance_checks_view(uuid),public.studio_review_maintenance_check(uuid,integer,text,text,text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.studio_request_maintenance_check(uuid,jsonb,uuid),public.studio_maintenance_check_view(uuid),public.studio_maintenance_checks_view(uuid),public.studio_review_maintenance_check(uuid,integer,text,text,text,jsonb,uuid) to authenticated;
revoke all on function public.studio_claim_maintenance_check(text,text),public.studio_maintenance_check_read(uuid,uuid,uuid),public.studio_maintenance_check_context(uuid,uuid),public.studio_finish_maintenance_check(uuid,uuid,jsonb,text,bigint),public.studio_fail_maintenance_check(uuid,uuid) from public,anon,authenticated;
grant execute on function public.studio_claim_maintenance_check(text,text),public.studio_maintenance_check_read(uuid,uuid,uuid),public.studio_maintenance_check_context(uuid,uuid),public.studio_finish_maintenance_check(uuid,uuid,jsonb,text,bigint),public.studio_fail_maintenance_check(uuid,uuid) to service_role;
