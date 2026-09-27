-- The newsletter library needs its audience count and campaigns, not subscriber
-- identities or the independent welcome-offer report used by Promo codes.
do $$
declare definition text:=pg_get_functiondef('elio.newsletter_admin_dispatch(text,jsonb)'::regprocedure);
 hook text:=$old$ if p_action='newsletter_admin' then$old$;
begin
 perform elio.require(position(hook in definition)>0,'Newsletter admin summary hook was not found.');
 execute replace(definition,hook,$new$ if p_action='newsletter_admin' and p_payload->>'view'='campaigns' then
  return jsonb_build_object('counts',(select jsonb_build_object('subscribed',count(*)) from elio.newsletter_subscribers where status='subscribed'),
   'campaigns',(select coalesce(jsonb_agg(elio.newsletter_campaign_json(d) order by d.created_at desc),'[]') from (select * from elio.newsletter_campaigns order by created_at desc limit 100) d));
 end if;
$new$||hook);
end $$;
