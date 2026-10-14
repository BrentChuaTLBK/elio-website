-- Owner-only exact lookup. Subscriber, consent, campaign and delivery records
-- remain unchanged; only the existing abuse-prevention counter is incremented.
create function elio.newsletter_subscriber_lookup(p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare
 u uuid:=auth.uid(); address text; s elio.newsletter_subscribers;
 q elio.newsletter_contact_sync; contact_exists boolean; configured boolean;
 sync_current boolean; sync_state text; eligible boolean;
begin
 perform elio.assert_staff(u,true);
 address:=elio.newsletter_email(p_payload->>'email');
 perform elio.require(elio.newsletter_rate('owner-subscriber-lookup:'||u::text,60,30),'Please wait a minute before looking up more subscribers.');
 select * into s from elio.newsletter_subscribers where email=address;
 if not found then return jsonb_build_object('found',false); end if;
 select * into q from elio.newsletter_contact_sync where subscriber_id=s.id;
 select exists(select 1 from elio.newsletter_resend_contacts where subscriber_id=s.id) into contact_exists;
 select coalesce(segment_id is not null and topic_id is not null,false) into configured from elio.newsletter_broadcast_runtime where id;
 configured:=coalesce(configured,false);
 sync_current:=coalesce(q.version=q.synced_version and q.synced_consent_at=s.consent_at,false);
 eligible:=s.status='subscribed';
 sync_state:=case when q.last_error is not null then 'needs_review'
   when s.status='pending' and q.subscriber_id is null then 'not_started'
   when sync_current and eligible and contact_exists then 'current'
   when sync_current and not eligible and not contact_exists then 'removed'
   else 'pending' end;
 return jsonb_build_object('found',true,'subscriber',jsonb_build_object(
  'email',s.email,'status',s.status,'source',s.source,'consent_version',s.consent_version,
  'consent_at',s.consent_at,'created_at',s.created_at,'confirmed_at',s.confirmed_at,
  'subscribed_at',s.subscribed_at,'unsubscribed_at',s.unsubscribed_at,
  'suppressed',s.status='suppressed','marketing_eligible',eligible,
  'contact_sync',jsonb_build_object('state',sync_state,'contact_present',contact_exists,
   'checked_at',case when q.checked_at>'epoch'::timestamptz then q.checked_at else null end,
   'configured',configured,'ready',eligible and configured and contact_exists and sync_current and q.last_error is null)));
end $$;

do $$
declare definition text:=pg_get_functiondef('elio.newsletter_admin_dispatch(text,jsonb)'::regprocedure);
 hook text:='perform elio.assert_staff(u,true);';
begin
 if position(hook in definition)=0 then raise exception 'Newsletter owner guard not found'; end if;
 execute replace(definition,hook,hook||$patch$
 if p_action='newsletter_subscriber_lookup' then return elio.newsletter_subscriber_lookup(p_payload); end if;
 $patch$);
end $$;
revoke all on function elio.newsletter_subscriber_lookup(jsonb) from public,anon,authenticated,service_role;
