begin;
-- The PL/pgSQL function also declares a record named "a". Use a distinct
-- relation alias for the owner list so Postgres never resolves it ambiguously.
do $$
declare definition text;before_query text;after_query text;
begin
 definition:=pg_get_functiondef('elio.affiliate_api(text,jsonb)'::regprocedure);
 before_query:=$query$select a.id,a.name,a.active,a.commission_bps,a.revision,users.email,
    elio.affiliate_balance(a.id) as balance_cents,
    coalesce((select sum(earned_cents) from elio.affiliate_orders where affiliate_id=a.id),0) as earned_cents,
    (select count(*) from elio.affiliate_codes where affiliate_id=a.id) as code_count
   from elio.affiliates a join auth.users users on users.id=a.user_id$query$;
 after_query:=$query$select partner.id,partner.name,partner.active,partner.commission_bps,partner.revision,users.email,
    elio.affiliate_balance(partner.id) as balance_cents,
    coalesce((select sum(earned_cents) from elio.affiliate_orders where affiliate_id=partner.id),0) as earned_cents,
    (select count(*) from elio.affiliate_codes where affiliate_id=partner.id) as code_count
   from elio.affiliates partner join auth.users users on users.id=partner.user_id$query$;
 perform elio.require(position(before_query in definition)>0,'Missing affiliate admin query.');
 execute replace(definition,before_query,after_query);
end $$;
commit;
