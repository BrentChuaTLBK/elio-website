begin;
create function elio.newsletter_account_preference(p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare account auth.users;s elio.newsletter_subscribers;result jsonb;wants boolean;
begin
 select * into account from auth.users where id=auth.uid() and email_confirmed_at is not null;
 perform elio.require(account.id is not null,'Sign in with your verified Elio account to change email preferences.');
 perform elio.require(jsonb_typeof(p_payload->'subscribed')='boolean','Choose whether to receive the newsletter.');
 wants:=(p_payload->>'subscribed')::boolean;
 -- Only the authenticated account email is used; submitted email/IDs are ignored.
 perform pg_advisory_xact_lock(hashtextextended('elio-newsletter-preference:'||lower(btrim(account.email)),0));
 select * into s from elio.newsletter_subscribers where email=lower(btrim(account.email)) for update;
 if not wants then
  if s.id is not null then perform elio.newsletter_unsubscribe(s.id);end if;
  -- Prevent a stored signup opt-in from reactivating an absent/pending subscription.
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}')||'{"newsletter_opt_in":false}'::jsonb where id=account.id;
 elsif s.id is null or s.status not in ('subscribed','suppressed') then
  result:=elio.newsletter_subscribe_immediate(jsonb_build_object('email',account.email,'source','account','consent',true,
   'consent_version','elio-newsletter-v2-single-opt-in','ip_hash',encode(extensions.digest('account:'||account.id::text,'sha256'),'hex')));
  perform elio.require(not coalesce((result->>'rate_limited')::boolean,false),'Please wait a moment before trying to join again.');
 end if;
 return elio.newsletter_settings();
end $$;
revoke all on function elio.newsletter_account_preference(jsonb) from public,anon,authenticated,service_role;
do $$
declare definition text;hook text:=' if p_action=''newsletter_settings'' then return elio.newsletter_settings(); end if;';
begin
 definition:=pg_get_functiondef('elio.newsletter_admin_dispatch(text,jsonb)'::regprocedure);
 perform elio.require(position(hook in definition)>0,'Missing newsletter preference hook.');
 execute replace(definition,hook,hook||E'\n if p_action=''newsletter_account_preference'' then return elio.newsletter_account_preference(p_payload); end if;');
end $$;
commit;
