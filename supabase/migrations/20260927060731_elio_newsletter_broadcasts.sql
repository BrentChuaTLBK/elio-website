-- Campaigns use Resend Broadcasts. Individual tests and welcome codes retain
-- their separate outbox. No campaign may fall back to the transactional API.
create table elio.newsletter_broadcasts (
 campaign_id uuid primary key references elio.newsletter_campaigns(id),
 status text not null default 'preparing' check(status in ('preparing','submitting','queued','sent','failed','cancelled')),
 provider_id uuid, provider_payload jsonb, submitted_at timestamptz,
 attempts integer not null default 0, available_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_error text
);
create table elio.newsletter_broadcast_runtime (
 id boolean primary key default true check(id), segment_id uuid, topic_id uuid,
 active_campaign_id uuid references elio.newsletter_broadcasts(campaign_id),
 lease_token uuid, leased_until timestamptz
);
insert into elio.newsletter_broadcast_runtime(id) values(true);
create table elio.newsletter_resend_contacts (
 subscriber_id uuid primary key references elio.newsletter_subscribers(id),
 contact_id uuid not null, registered_at timestamptz not null default now(),
 checked_at timestamptz not null default now()
);
alter table elio.newsletter_outbox add column broadcast_synced boolean not null default false;
do $$ declare t text; begin
 foreach t in array array['newsletter_broadcasts','newsletter_broadcast_runtime','newsletter_resend_contacts'] loop
  execute format('alter table elio.%I enable row level security',t);
  execute format('revoke all on elio.%I from public,anon,authenticated',t);
 end loop;
end $$;

create function elio.newsletter_broadcast_context(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(b)||jsonb_build_object(
  'payload',(select payload-'subscriber'-'unsubscribe_token' from elio.newsletter_outbox where campaign_id=b.campaign_id order by created_at,id limit 1),
  'recipients',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'email',s.email,'synced',o.broadcast_synced,'contact_id',r.contact_id) order by s.id),'[]')
    from elio.newsletter_outbox o join elio.newsletter_subscribers s on s.id=o.subscriber_id
    left join elio.newsletter_resend_contacts r on r.subscriber_id=s.id
    where o.campaign_id=b.campaign_id and o.status in ('pending','sending') and s.status='subscribed'))
 from elio.newsletter_broadcasts b where b.campaign_id=p_id
$$;

create function elio.newsletter_broadcast_dispatch(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare r elio.newsletter_broadcast_runtime; b elio.newsletter_broadcasts;
 v_id uuid:=(p_payload->>'campaign_id')::uuid; v_sub uuid:=(p_payload->>'subscriber_id')::uuid;
 v_ids jsonb; actual jsonb; supplied jsonb; v_status text;
begin
 select * into r from elio.newsletter_broadcast_runtime where id for update;
 if p_action='newsletter_broadcast_config' then
  return jsonb_build_object('segment_id',r.segment_id,'topic_id',r.topic_id);
 elsif p_action='newsletter_broadcast_claim' then
  if r.segment_id is null or r.topic_id is null then return jsonb_build_object('configured',false); end if;
  if r.leased_until>now() then return jsonb_build_object('busy',true); end if;
  select * into b from elio.newsletter_broadcasts where campaign_id=r.active_campaign_id and status not in ('sent','failed','cancelled');
  if not found then
   select * into b from elio.newsletter_broadcasts where status='preparing' order by created_at,campaign_id limit 1;
  end if;
  if b.campaign_id is null then return jsonb_build_object('idle',true); end if;
  if b.available_at>now() then return jsonb_build_object('busy',true); end if;
  update elio.newsletter_broadcast_runtime set active_campaign_id=b.campaign_id,lease_token=gen_random_uuid(),leased_until=now()+interval '3 minutes' where id returning * into r;
  return jsonb_build_object('lease_token',r.lease_token,'segment_id',r.segment_id,'topic_id',r.topic_id,'job',elio.newsletter_broadcast_context(b.campaign_id));
 elsif p_action='newsletter_broadcast_contacts' then
  -- Reconcile provider opt-outs even when no campaign is running. These rows
  -- were registered only after recorded local newsletter consent.
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
   select s.id,s.email,s.status,c.contact_id from elio.newsletter_resend_contacts c join elio.newsletter_subscribers s on s.id=c.subscriber_id
   where c.checked_at<now()-interval '5 minutes' order by c.checked_at limit 10) x);
 elsif p_action='newsletter_broadcast_contact_checked' then
  perform elio.require(exists(select 1 from elio.newsletter_resend_contacts where subscriber_id=v_sub),'Unknown marketing contact.');
  if coalesce((p_payload->>'unsubscribed')::boolean,false) then perform elio.newsletter_unsubscribe(v_sub); end if;
  update elio.newsletter_resend_contacts set checked_at=now() where subscriber_id=v_sub;
  return jsonb_build_object('recorded',true);
 end if;
 perform elio.require(r.active_campaign_id=v_id and r.lease_token=(p_payload->>'lease_token')::uuid and r.leased_until>now(),'Broadcast claim is stale.');
 select * into b from elio.newsletter_broadcasts where campaign_id=v_id for update;
 if p_action='newsletter_broadcast_context' then return elio.newsletter_broadcast_context(v_id);
 elsif p_action='newsletter_broadcast_contact' then
  perform elio.require(b.status='preparing' and exists(select 1 from elio.newsletter_outbox where campaign_id=v_id and subscriber_id=v_sub),'Recipient is outside this reviewed campaign.');
  if coalesce((p_payload->>'unsubscribed')::boolean,false) then perform elio.newsletter_unsubscribe(v_sub);
  else
   insert into elio.newsletter_resend_contacts(subscriber_id,contact_id) values(v_sub,(p_payload->>'contact_id')::uuid)
   on conflict(subscriber_id) do update set contact_id=excluded.contact_id,checked_at=now();
   update elio.newsletter_outbox set broadcast_synced=true where campaign_id=v_id and subscriber_id=v_sub;
  end if;
 elsif p_action='newsletter_broadcast_payload' then
  supplied:=p_payload->'provider_payload';
  perform elio.require(b.status='preparing' and supplied->>'segment_id'=r.segment_id::text and supplied->>'topic_id'=r.topic_id::text and supplied->>'send'='false'
   and length(supplied->>'html') between 1 and 500000 and length(supplied->>'text') between 1 and 100000,'Invalid broadcast snapshot.');
  update elio.newsletter_broadcasts set provider_payload=coalesce(provider_payload,supplied),updated_at=now() where campaign_id=v_id;
 elsif p_action='newsletter_broadcast_created' then
  perform elio.require(b.status='preparing' and b.provider_payload is not null,'Broadcast has no frozen content.');
  perform elio.require(b.provider_id is null or b.provider_id=(p_payload->>'provider_id')::uuid,'Broadcast identity cannot change.');
  update elio.newsletter_broadcasts set provider_id=(p_payload->>'provider_id')::uuid,updated_at=now() where campaign_id=v_id;
 elsif p_action='newsletter_broadcast_begin_send' then
  perform elio.require(b.status='preparing' and b.provider_id is not null,'Broadcast is not ready.');
  select coalesce(jsonb_agg(s.email order by s.email),'[]') into actual from elio.newsletter_outbox o join elio.newsletter_subscribers s on s.id=o.subscriber_id
   where o.campaign_id=v_id and o.status='pending' and s.status='subscribed';
  select coalesce(jsonb_agg(value order by value),'[]') into supplied from jsonb_array_elements_text(p_payload->'emails');
  perform elio.require(actual=supplied and jsonb_array_length(actual)>0,'Broadcast recipients changed. Synchronize again.');
  perform elio.require(not exists(select 1 from elio.newsletter_outbox o join elio.newsletter_subscribers s on s.id=o.subscriber_id where o.campaign_id=v_id and o.status='pending' and s.status='subscribed' and not o.broadcast_synced),'Broadcast contacts are not synchronized.');
  update elio.newsletter_outbox set status='skipped',last_error='Subscriber no longer eligible.' where campaign_id=v_id and status='pending' and subscriber_id not in(select id from elio.newsletter_subscribers where status='subscribed');
  update elio.newsletter_broadcasts set status='submitting',submitted_at=now(),updated_at=now(),last_error=null where campaign_id=v_id;
 elsif p_action='newsletter_broadcast_status' then
  v_status:=p_payload->>'status';
  perform elio.require(v_status in ('queued','sent','failed','cancelled'),'Invalid broadcast status.');
  perform elio.require(b.status in ('submitting','queued') or (b.status='preparing' and v_status='cancelled'),'Broadcast was not submitted.');
  update elio.newsletter_broadcasts set status=v_status,updated_at=now(),last_error=null where campaign_id=v_id;
  if v_status='sent' then
   update elio.newsletter_outbox set status='sent',provider_id=b.provider_id::text,sent_at=now(),last_error=null where campaign_id=v_id and status in ('pending','sending');
  elsif v_status in ('failed','cancelled') then
   update elio.newsletter_outbox set status=case when v_status='cancelled' then 'skipped' else 'failed' end,last_error='Broadcast '||v_status where campaign_id=v_id and status in ('pending','sending');
  end if;
 elsif p_action='newsletter_broadcast_error' then
  update elio.newsletter_broadcasts set attempts=attempts+1,available_at=now()+make_interval(secs=>least(3600,(power(2,least(attempts,6))*60)::integer)),
   last_error=left(coalesce(p_payload->>'error','Broadcast delivery needs review.'),500),updated_at=now() where campaign_id=v_id;
 elsif p_action='newsletter_broadcast_release' then
  update elio.newsletter_broadcast_runtime set lease_token=null,leased_until=null where id;
  return jsonb_build_object('released',true);
 else raise exception 'Unknown broadcast action.' using errcode='22023';
 end if;
 return elio.newsletter_broadcast_context(v_id);
end $$;

do $$ declare definition text; hook text; begin
 definition:=pg_get_functiondef('elio.newsletter_unsubscribe(uuid)'::regprocedure);
 hook:=E'begin\n';
 perform elio.require(position(hook in definition)>0,'Missing unsubscribe synchronization hook.');
 execute replace(definition,hook,hook||E' update elio.newsletter_resend_contacts set checked_at=''epoch'' where subscriber_id=p_id;\n');
 definition:=pg_get_functiondef('elio.newsletter_service_dispatch(text,jsonb)'::regprocedure);
 hook:=E'begin\n';
 perform elio.require(position(hook in definition)>0,'Missing newsletter service hook.');
 definition:=replace(definition,hook,hook||E' if p_action like ''newsletter_broadcast_%'' then return elio.newsletter_broadcast_dispatch(p_action,p_payload); end if;\n');
 definition:=replace(definition,'where status in (''pending'',''sending'') and first_attempt_at','where event_type<>''newsletter_campaign'' and status in (''pending'',''sending'') and first_attempt_at');
 hook:='for e in select * from elio.newsletter_outbox where ((status=';
 perform elio.require(position(hook in definition)>0,'Missing campaign exclusion hook.');
 definition:=replace(definition,hook,'for e in select * from elio.newsletter_outbox where event_type<>''newsletter_campaign'' and ((status=');
 execute definition;
 definition:=pg_get_functiondef('elio.newsletter_admin_dispatch(text,jsonb)'::regprocedure);
 hook:=$old$  update elio.newsletter_campaigns set status='queued',queued_at=now(),updated_at=now() where id=c.id;$old$;
 perform elio.require(position(hook in definition)>0,'Missing reviewed campaign hook.');
 execute replace(definition,hook,hook||E'\n  insert into elio.newsletter_broadcasts(campaign_id) values(c.id) on conflict do nothing;');
 definition:=pg_get_functiondef('elio.newsletter_campaign_json(elio.newsletter_campaigns)'::regprocedure);
 hook:=$old$'queued_at',p.queued_at,$old$;
 perform elio.require(position(hook in definition)>0,'Missing broadcast report hook.');
  execute replace(definition,hook,hook||$new$
  'broadcast',(select jsonb_build_object('id',provider_id,'status',status,'error',last_error) from elio.newsletter_broadcasts where campaign_id=p.id),$new$);
end $$;

-- Only migrate wholly unsent campaigns. Any partially accepted legacy campaign
-- stays stopped for review, avoiding resending to an already accepted recipient.
insert into elio.newsletter_broadcasts(campaign_id)
select c.id from elio.newsletter_campaigns c where c.status='queued'
 and exists(select 1 from elio.newsletter_outbox where campaign_id=c.id and status='pending')
 and not exists(select 1 from elio.newsletter_outbox where campaign_id=c.id and (status='sent' or first_attempt_at is not null));
revoke all on function elio.newsletter_broadcast_context(uuid),elio.newsletter_broadcast_dispatch(text,jsonb) from public,anon,authenticated;
