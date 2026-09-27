-- Contact lifecycle is independent of newsletter campaigns. Local consent and
-- earned welcome offers remain after provider contacts are removed.
create table elio.newsletter_contact_sync (
 subscriber_id uuid primary key references elio.newsletter_subscribers(id),
 version bigint not null default 1, synced_version bigint not null default 0,
 synced_consent_at timestamptz, checked_at timestamptz not null default 'epoch',
 available_at timestamptz not null default now(), last_error text
);
alter table elio.newsletter_contact_sync enable row level security;
revoke all on elio.newsletter_contact_sync from public,anon,authenticated;
alter table elio.newsletter_broadcast_runtime add column contact_sync_lease boolean not null default false;

create function elio.newsletter_contact_changed() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='pending' then return new; end if;
 if tg_op='UPDATE' then
  if new.status is not distinct from old.status and new.consent_at is not distinct from old.consent_at then return new; end if;
 end if;
 insert into elio.newsletter_contact_sync(subscriber_id) values(new.id)
 on conflict(subscriber_id) do update set version=elio.newsletter_contact_sync.version+1,available_at=now(),last_error=null;
 return new;
end $$;
create trigger newsletter_contact_changed after insert or update of status,consent_at
on elio.newsletter_subscribers for each row execute function elio.newsletter_contact_changed();

-- Backfill active signups now; preserve known provider opt-outs on contacts
-- previously registered through a campaign. Never import another brand's list.
insert into elio.newsletter_contact_sync(subscriber_id,synced_consent_at)
select s.id,case when r.subscriber_id is not null then s.consent_at end
from elio.newsletter_subscribers s left join elio.newsletter_resend_contacts r on r.subscriber_id=s.id
where s.status='subscribed' or r.subscriber_id is not null;

create function elio.newsletter_contact_dispatch(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare r elio.newsletter_broadcast_runtime; q elio.newsletter_contact_sync; s elio.newsletter_subscribers;
 v_sub uuid:=(p_payload->>'subscriber_id')::uuid; v_version bigint:=(p_payload->>'version')::bigint;
 contact uuid; result jsonb;
begin
 select * into r from elio.newsletter_broadcast_runtime where id for update;
 if p_action='newsletter_contact_claim' then
  if r.segment_id is null or r.topic_id is null then return jsonb_build_object('configured',false); end if;
  if r.leased_until>now() or exists(select 1 from elio.newsletter_broadcasts where campaign_id=r.active_campaign_id and status in ('submitting','queued')) then
   return jsonb_build_object('busy',true);
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from (
   select pending.subscriber_id,pending.version from elio.newsletter_contact_sync pending join elio.newsletter_subscribers subscriber on subscriber.id=pending.subscriber_id
   where subscriber.status<>'pending' and pending.available_at<=now() and (pending.synced_version<>pending.version or
    (pending.checked_at<now()-interval '5 minutes' and exists(select 1 from elio.newsletter_resend_contacts c where c.subscriber_id=subscriber.id)))
   order by (pending.synced_version<>pending.version) desc,pending.checked_at,pending.subscriber_id limit 3
  ) x;
  if jsonb_array_length(result)=0 then return jsonb_build_object('idle',true); end if;
  update elio.newsletter_broadcast_runtime set lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes',contact_sync_lease=true where id returning * into r;
  return jsonb_build_object('lease_token',r.lease_token,'segment_id',r.segment_id,'topic_id',r.topic_id,'rows',result);
 end if;
 perform elio.require(r.contact_sync_lease and r.lease_token=(p_payload->>'lease_token')::uuid and r.leased_until>now(),'Contact synchronization claim is stale.');
 if p_action='newsletter_contact_release' then
  update elio.newsletter_broadcast_runtime set lease_token=null,leased_until=null,contact_sync_lease=false where id;
  return jsonb_build_object('released',true);
 end if;
 -- Lock in subscriber-before-queue order, matching consent-change triggers.
 select * into s from elio.newsletter_subscribers where id=v_sub for update;
 select * into q from elio.newsletter_contact_sync where subscriber_id=v_sub for update;
 if q.subscriber_id is null or q.version is distinct from v_version or s.status='pending' then return jsonb_build_object('stale',true); end if;
 select contact_id into contact from elio.newsletter_resend_contacts where subscriber_id=v_sub;
 if p_action='newsletter_contact_context' then
  return jsonb_build_object('subscriber_id',s.id,'email',s.email,'status',s.status,'contact_id',contact,
   'fresh_consent',s.status='subscribed' and q.synced_consent_at is distinct from s.consent_at);
 elsif p_action='newsletter_contact_opt_out' then
  -- Persist provider opt-outs before deleting the contact. A lost deletion
  -- acknowledgement must never cause a retry to recreate that subscriber.
  perform elio.newsletter_unsubscribe(s.id);
  return (select jsonb_build_object('version',version) from elio.newsletter_contact_sync where subscriber_id=v_sub);
 elsif p_action='newsletter_contact_done' then
  if coalesce((p_payload->>'unsubscribed')::boolean,false) and s.status='subscribed' then
   perform elio.newsletter_unsubscribe(s.id);
   select * into q from elio.newsletter_contact_sync where subscriber_id=s.id;
  end if;
  if nullif(p_payload->>'contact_id','') is null then
   delete from elio.newsletter_resend_contacts where subscriber_id=v_sub;
  else
   insert into elio.newsletter_resend_contacts(subscriber_id,contact_id) values(v_sub,(p_payload->>'contact_id')::uuid)
   on conflict(subscriber_id) do update set contact_id=excluded.contact_id,checked_at=now();
  end if;
  update elio.newsletter_contact_sync set synced_version=q.version,synced_consent_at=s.consent_at,checked_at=now(),available_at=now(),last_error=null where subscriber_id=v_sub;
  return jsonb_build_object('recorded',true);
 elsif p_action='newsletter_contact_error' then
  update elio.newsletter_contact_sync set available_at=now()+interval '1 minute',last_error=left(coalesce(p_payload->>'error','Contact synchronization needs review.'),1000) where subscriber_id=v_sub;
  return jsonb_build_object('recorded',true);
 end if;
 raise exception 'Unknown newsletter contact action.' using errcode='22023';
end $$;

do $$ declare definition text; hook text; begin
 definition:=pg_get_functiondef('elio.newsletter_service_dispatch(text,jsonb)'::regprocedure);
 hook:=E'begin\n';
 perform elio.require(position(hook in definition)>0,'Missing contact service hook.');
 execute replace(definition,hook,hook||E' if p_action like ''newsletter_contact_%'' then return elio.newsletter_contact_dispatch(p_action,p_payload); end if;\n');
 -- Campaigns wait for durable signup sync instead of granting topic consent.
 definition:=pg_get_functiondef('elio.newsletter_broadcast_context(uuid)'::regprocedure);
 hook:=$old$'contact_id',r.contact_id$old$;
 perform elio.require(position(hook in definition)>0,'Missing contact readiness hook.');
 execute replace(definition,hook,hook||$new$,'contact_ready',r.contact_id is not null and exists(select 1 from elio.newsletter_contact_sync q where q.subscriber_id=s.id and q.version=q.synced_version and q.synced_consent_at=s.consent_at)$new$);
end $$;
revoke all on function elio.newsletter_contact_changed(),elio.newsletter_contact_dispatch(text,jsonb) from public,anon,authenticated,service_role;
