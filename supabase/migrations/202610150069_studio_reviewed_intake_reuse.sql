begin;
-- Reuse reviewed extraction evidence after an execution-version change. This is
-- an editor action, not a worker shortcut or a transfer of checkpoint approval.
-- No blob is rewritten, no provider attempt is invented, and G1 remains pending.
create function public.studio_reuse_reviewed_intake(p_run uuid,p_from_run uuid,p_expected_decision uuid,p_reason text,p_command uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=private.studio_require_editor(); req jsonb; res jsonb; r private.studio_runs; old private.studio_runs;
 i private.studio_run_inputs; oi private.studio_run_inputs; target private.studio_stages; source private.studio_stages;
 d private.studio_decisions; ids uuid[]; a private.studio_artifacts; made uuid; copied jsonb:='[]';
begin
 req:=jsonb_build_object('run',p_run,'fromRun',p_from_run,'decision',p_expected_decision,'reason',p_reason);
 res:=private.studio_replay(me::text,p_command,'reuse_reviewed_intake',req);if res is not null then return res;end if;
 if p_run is null or p_from_run is null or p_run=p_from_run or length(trim(coalesce(p_reason,'')))<10 then raise exception 'Reviewed intake reuse requires two runs and a reason';end if;
 perform 1 from private.studio_runs where id in (p_run,p_from_run) order by id for update;
 select * into r from private.studio_runs where id=p_run;select * into old from private.studio_runs where id=p_from_run;
 if r.id is null or old.id is null or r.purpose<>'rehearsal' or old.purpose<>'rehearsal' or r.state<>'active' or r.module_id<>old.module_id then raise exception 'Reviewed intake reuse requires compatible rehearsal runs';end if;
 select * into i from private.studio_run_inputs where run_id=r.id and input_revision=r.current_input_revision;
 select * into oi from private.studio_run_inputs where run_id=old.id and input_revision=old.current_input_revision;
 if i.source_revision_id is distinct from oi.source_revision_id or i.snapshot_id is distinct from oi.snapshot_id
  or private.studio_level_digest(i,'validate') is distinct from private.studio_level_digest(oi,'validate') then raise exception 'Reviewed intake input pins changed';end if;
 d:=private.studio_live_decision(old.id,'G1_inventory');
 if d.id is null or d.id is distinct from p_expected_decision or d.bound is distinct from private.studio_gate_binding(old.id,'G1_inventory') then raise exception 'Reviewed inventory decision changed';end if;
 source:=private.studio_current_stage(old.id,'S1_extract');target:=private.studio_current_stage(r.id,'S1_extract');
 if source.state is distinct from 'succeeded' or target.state is distinct from 'queued' or target.attempt_count<>0
  or exists(select 1 from private.studio_artifacts where run_id=r.id)
  or exists(select 1 from private.studio_decisions where run_id=r.id)
  or exists(select 1 from private.studio_provider_operations o join private.studio_stages s on s.id=o.stage_id where s.run_id=r.id)
  then raise exception 'Reviewed intake destination must be untouched';end if;
 if exists(select 1 from private.studio_provider_attempts pa join private.studio_provider_operations o on o.id=pa.operation_id join private.studio_stages s on s.id=o.stage_id where s.run_id=old.id and pa.dispatch_state in ('prepared','dispatched','uncertain'))
  or exists(select 1 from private.studio_budget_reservations where run_id=old.id and state='held') then raise exception 'Reviewed intake has unsettled execution';end if;
 ids:=private.studio_stage_outputs(source.id);
 if (select count(*) from private.studio_artifacts where id=any(ids) and kind='inventory' and logical_key='inventory')<>1
  or not exists(select 1 from private.studio_artifacts where id=any(ids) and kind='evidence' and logical_key='evidence:source_pages')
  or not exists(select 1 from private.studio_artifacts where id=any(ids) and kind='page_text')
  or exists(select 1 from private.studio_artifacts where id=any(ids) and kind not in ('inventory','page_text','evidence')) then raise exception 'Reviewed intake evidence is incomplete';end if;
 perform private.studio_require_blobs(array(select blob_id from private.studio_artifacts where id=any(ids)));
 for a in select * from private.studio_artifacts where id=any(ids) order by logical_key loop
  insert into private.studio_artifacts(run_id,module_id,logical_key,kind,revision,parent_id,blob_id,sha256,schema,stage_id,author_kind,author_id,meta,rationale)
  values(r.id,r.module_id,a.logical_key,a.kind,1,a.id,a.blob_id,a.sha256,a.schema,target.id,'user',me::text,
   a.meta||jsonb_build_object('reusedIntake',jsonb_build_object('runId',old.id,'artifactId',a.id,'decisionId',d.id,'sha256',a.sha256,'originalAuthorKind',a.author_kind,'originalAuthorId',a.author_id)),p_reason) returning id into made;
  copied:=copied||jsonb_build_object('from',a.id,'to',made,'sha256',a.sha256);
 end loop;
 update private.studio_stages set state='succeeded',completed_at=now(),updated_at=now() where id=target.id;
 perform private.studio_event(r.module_id,r.id,'editor',me::text,'reviewed_intake_reused',jsonb_build_object('fromRun',old.id,'sourceDecision',d.id,'artifacts',copied,'reason',p_reason,'approvalTransferred',false,'providerCalls',0));
 perform private.studio_advance(r.id);
 return private.studio_remember(me::text,p_command,'reuse_reviewed_intake',req,jsonb_build_object('runId',r.id,'fromRun',old.id,'artifacts',copied,'approvalTransferred',false));
end $$;
revoke all on function public.studio_reuse_reviewed_intake(uuid,uuid,uuid,text,uuid) from public,anon,service_role,reviseit_studio_operator;
grant execute on function public.studio_reuse_reviewed_intake(uuid,uuid,uuid,text,uuid) to authenticated;
commit;
