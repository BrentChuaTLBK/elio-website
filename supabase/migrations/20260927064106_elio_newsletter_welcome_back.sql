-- Returning subscribers keep their original offer, redemption and expiry.
alter table elio.newsletter_subscribers add column rejoin_count integer not null default 0;
alter table elio.newsletter_outbox drop constraint newsletter_outbox_event_type_check;
alter table elio.newsletter_outbox add constraint newsletter_outbox_event_type_check check(event_type in
 ('newsletter_confirmation','newsletter_welcome','newsletter_welcome_back','newsletter_campaign','newsletter_test_campaign'));
do $$ declare definition text; hook text; begin
 definition:=pg_get_functiondef('elio.newsletter_subscribe_immediate(jsonb)'::regprocedure);
 hook:='accepted boolean;';
 perform elio.require(position(hook in definition)>0,'Missing rejoin declaration hook.');
 definition:=replace(definition,hook,hook||E'\n returning_subscriber boolean:=false;');
 hook:=$old$  update elio.newsletter_subscribers set status='pending',source=v_source$old$;
 perform elio.require(position(hook in definition)>0,'Missing rejoin transition hook.');
 definition:=replace(definition,hook,$new$  returning_subscriber:=s.status='unsubscribed' and s.promo_id is not null;
  update elio.newsletter_subscribers set rejoin_count=rejoin_count+case when returning_subscriber then 1 else 0 end,status='pending',source=v_source$new$);
 hook:=' perform elio.newsletter_activate(s.id);';
 perform elio.require(position(hook in definition)>0,'Missing rejoin notification hook.');
 execute replace(definition,hook,hook||$new$
 if returning_subscriber then
  insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,to_email,subject,payload)
  values('newsletter-welcome-back:'||s.id||':'||s.rejoin_count,'newsletter_welcome_back',s.id,s.email,
   'Welcome back to the Elio Newsletter',jsonb_build_object('event_type','newsletter_welcome_back',
    'subscriber',jsonb_build_object('email',s.email),'unsubscribe_token',elio.newsletter_unsubscribe_token(s),'settings',elio.newsletter_email_settings()))
  on conflict(event_key) do nothing;
 end if;
$new$);
end $$;
