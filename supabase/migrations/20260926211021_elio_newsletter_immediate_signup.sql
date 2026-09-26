-- Explicit newsletter form consent subscribes immediately. Account verification
-- remains a separate requirement for redeeming the email-bound welcome offer.
create function elio.newsletter_subscribe_immediate(p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare
 s elio.newsletter_subscribers;
 v_email text:=elio.newsletter_email(p_payload->>'email');
 v_source text:=p_payload->>'source';
 ip text:=p_payload->>'ip_hash';
 unsubscribe_token text;
 accepted boolean;
begin
 perform elio.require(ip ~ '^[a-f0-9]{64}$','A trusted request identifier is required.');
 perform elio.require(p_payload->'consent'='true'::jsonb and p_payload->>'consent_version' in ('elio-newsletter-v1','elio-newsletter-v2-single-opt-in'),'Newsletter consent is required.');
 perform elio.require(v_source in ('home_popup','home_footer','account'),'Choose a valid newsletter source.');
 accepted:=elio.newsletter_rate('subscribe-global-hour',3600,50);
 accepted:=elio.newsletter_rate('subscribe-ip-hour:'||ip,3600,20) and accepted;
 accepted:=elio.newsletter_rate('subscribe-ip-day:'||ip,86400,100) and accepted;
 accepted:=elio.newsletter_rate('subscribe-email-minute:'||encode(extensions.digest(v_email,'sha256'),'hex'),60,1) and accepted;
 accepted:=elio.newsletter_rate('subscribe-email-day:'||encode(extensions.digest(v_email,'sha256'),'hex'),86400,5) and accepted;
 if not accepted then return jsonb_build_object('accepted',true,'queued',false,'rate_limited',true); end if;
 select * into s from elio.newsletter_subscribers where email=v_email for update;
 if found and s.status in ('subscribed','suppressed') then return jsonb_build_object('accepted',true,'queued',false); end if;
 if s.id is null then
  unsubscribe_token:=encode(extensions.gen_random_bytes(32),'hex');
  insert into elio.newsletter_subscribers(email,source,consent_version,consent_at,unsubscribe_digest,unsubscribe_encrypted)
  values(v_email,v_source,'elio-newsletter-v2-single-opt-in',now(),extensions.digest(unsubscribe_token,'sha256'),extensions.pgp_sym_encrypt(unsubscribe_token,(select token_key from elio.secrets where id))) returning * into s;
 else
  -- A new explicit Join can opt in again; passive account activation cannot.
  -- Keep any existing offer, original expiry and one-time welcome event intact.
  update elio.newsletter_subscribers set status='pending',source=v_source,consent_version='elio-newsletter-v2-single-opt-in',consent_at=now(),confirmation_digest=null,confirmation_expires_at=null
  where id=s.id returning * into s;
 end if;
 update elio.newsletter_outbox set status='skipped',last_error='Newsletter now joins immediately.',lease_token=null,leased_until=null
 where subscriber_id=s.id and event_type='newsletter_confirmation' and status in ('pending','sending');
 perform elio.newsletter_activate(s.id);
 return jsonb_build_object('accepted',true,'queued',true);
end $$;

-- Newsletter-generated codes belong to read-only newsletter analytics, never
-- the regular promo editor list (including older deployed admin clients).
do $$
declare
 definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$old$from jsonb_array_elements(result->'promos') promo where promo->>'deleted_at' is null$old$;
 replacement text:=$new$from jsonb_array_elements(result->'promos') promo where promo->>'deleted_at' is null
   and promo->>'newsletter_managed' is distinct from 'true'
   and not exists(select 1 from elio.newsletter_subscribers n where n.promo_id=(promo->>'id')::uuid)$new$;
begin
 if (length(definition)-length(replace(definition,hook,'')))/length(hook)<>1 then raise exception 'Expected regular promo list hook not found'; end if;
 execute replace(definition,hook,replacement);
end $$;
revoke all on function elio.newsletter_subscribe_immediate(jsonb) from public,anon,authenticated,service_role;

-- Preserve the service entry point's authorization, leases and legacy token
-- support, changing only the explicit signup branch.
do $$
declare
 definition text:=replace(pg_get_functiondef('elio.newsletter_service_dispatch(text,jsonb)'::regprocedure),E'\r\n',E'\n');
 start_marker text:=' if p_action=''newsletter_subscribe'' then';
 end_marker text:=' elsif p_action=''newsletter_activate_account'' then';
 first_at integer; last_at integer;
begin
 first_at:=strpos(definition,start_marker);last_at:=strpos(definition,end_marker);
 if first_at=0 or last_at<=first_at then raise exception 'Newsletter signup branch not found'; end if;
 execute substr(definition,1,first_at-1)||start_marker||E'\n  return elio.newsletter_subscribe_immediate(p_payload);\n'||substr(definition,last_at);
end $$;

-- Honor existing explicit public signups that were awaiting the old extra
-- confirmation step. Never opt in an unsubscribed or suppressed address.
do $$
declare s elio.newsletter_subscribers;
begin
 for s in select * from elio.newsletter_subscribers where status='pending' and source in ('home_popup','home_footer') and consent_at is not null and consent_version='elio-newsletter-v1' for update loop
  update elio.newsletter_outbox set status='skipped',last_error='Newsletter now joins immediately.',lease_token=null,leased_until=null
  where subscriber_id=s.id and event_type='newsletter_confirmation' and status in ('pending','sending');
  perform elio.newsletter_activate(s.id);
 end loop;
end $$;
