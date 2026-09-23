-- Return only the current authenticated user's team role for account navigation.
-- This read does not run order maintenance or load dashboard/customer records.
do $migration$
declare
  definition text := pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  anchor text := ' perform pg_advisory_xact_lock(841721950318::bigint);';
begin
  if position(anchor in definition) = 0 then
    raise exception 'Account access migration: dispatcher lock anchor not found';
  end if;
  definition := replace(definition, anchor, $patch$
 if p_action='account_access' then
  return jsonb_build_object('role',elio.role_for(u));
 end if;
$patch$ || anchor);
  execute definition;
end $migration$;
