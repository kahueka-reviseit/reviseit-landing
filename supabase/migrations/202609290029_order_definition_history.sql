-- C12: append-only history for an authorised upgrade of one unsubmitted configured
-- order's pinned definitions. Additive. No function, trigger or existing row changes.
-- The upgrade itself is a reviewed operator transaction, not an application feature:
-- the issued-input trigger stays as it is for every order and every other writer.
-- Each row keeps the complete previous form and snapshot, so earlier configuration
-- revisions remain readable against exactly the definitions they were saved under.
begin;
create table private.paper_order_definition_history (
 order_id uuid not null references private.paper_orders(id),
 sequence integer not null check(sequence>=1),
 from_release text not null, to_release text not null,
 from_definitions_sha256 text not null check(from_definitions_sha256 ~ '^[a-f0-9]{64}$'),
 to_definitions_sha256 text not null check(to_definitions_sha256 ~ '^[a-f0-9]{64}$' and to_definitions_sha256<>from_definitions_sha256),
 from_form_revision text not null, to_form_revision text not null,
 -- Revisions up to and including this one were saved under the previous definitions.
 last_revision_on_previous integer not null check(last_revision_on_previous>=1),
 first_revision_on_current integer not null check(first_revision_on_current=last_revision_on_previous+1),
 previous_form jsonb not null, previous_snapshot jsonb not null,
 previous_form_sha256 text not null check(previous_form_sha256 ~ '^[a-f0-9]{64}$'),
 previous_snapshot_sha256 text not null check(previous_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 current_form_sha256 text not null check(current_form_sha256 ~ '^[a-f0-9]{64}$'),
 current_snapshot_sha256 text not null check(current_snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 -- Per line: stable line identity, entry, kind and the previous and current definition hashes.
 line_map jsonb not null check(jsonb_typeof(line_map)='array'),
 reason text not null check(length(trim(reason)) between 3 and 500),
 actor text not null default session_user,
 recorded_at timestamptz not null default now(),
 primary key(order_id,sequence),
 unique(order_id,from_definitions_sha256)
);
alter table private.paper_order_definition_history enable row level security;
revoke all on private.paper_order_definition_history from public,anon,authenticated,service_role,reviseit_catalogue_publisher;
create trigger freeze_order_definition_history before update or delete on private.paper_order_definition_history
for each row execute function private.freeze_authored_form();
commit;
