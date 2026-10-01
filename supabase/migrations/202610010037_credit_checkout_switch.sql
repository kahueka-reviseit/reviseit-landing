begin;
-- The database switch also protects direct calls to the older checkout functions.
-- Existing payments remain reconcilable and their orders are never rewritten.
create function private.enforce_credit_checkout_switch() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.entitlement='paid' and exists(select 1 from private.credit_settings where singleton and enabled) then
  raise exception 'Use department credit for new papers';
 end if;
 return new;
end $$;
create trigger credit_checkout_switch before insert on private.paper_orders
for each row execute function private.enforce_credit_checkout_switch();
revoke all on function private.enforce_credit_checkout_switch() from public,anon,authenticated,service_role;
commit;
