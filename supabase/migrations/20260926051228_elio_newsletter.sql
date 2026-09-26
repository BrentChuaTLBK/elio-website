-- Newsletter consent and marketing delivery are separate from customer orders.
create table elio.newsletter_subscribers (
 id uuid primary key default gen_random_uuid(), email text not null unique,
 status text not null default 'pending' check(status in ('pending','subscribed','unsubscribed','suppressed')),
 source text not null, consent_version text not null, consent_at timestamptz not null,
 created_at timestamptz not null default now(), confirmed_at timestamptz, subscribed_at timestamptz,
 unsubscribed_at timestamptz, confirmation_digest bytea, confirmation_expires_at timestamptz,
 unsubscribe_digest bytea not null unique, unsubscribe_encrypted bytea not null,
 confirmation_generation integer not null default 1,
 promo_id uuid unique references elio.promos(id), offer_expires_at timestamptz
);
create table elio.newsletter_campaigns (
 id uuid primary key default gen_random_uuid(), data jsonb not null,
 status text not null default 'draft' check(status in ('draft','queued')),
 revision integer not null default 1, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), queued_at timestamptz
);
create table elio.newsletter_outbox (
 id uuid primary key default gen_random_uuid(), event_key text not null unique,
 event_type text not null check(event_type in ('newsletter_confirmation','newsletter_welcome','newsletter_campaign','newsletter_test_campaign')),
 subscriber_id uuid references elio.newsletter_subscribers(id), campaign_id uuid references elio.newsletter_campaigns(id),
 to_email text not null, subject text not null, payload jsonb not null, provider_payload jsonb,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_token uuid, leased_until timestamptz, first_attempt_at timestamptz, prepared_at timestamptz,
 created_at timestamptz not null default now(), sent_at timestamptz, provider_id text, last_error text
);
create index newsletter_outbox_ready on elio.newsletter_outbox(status,available_at);
create index newsletter_outbox_subscriber on elio.newsletter_outbox(subscriber_id);
create table elio.newsletter_rate_limits (key text primary key, bucket bigint not null, hits integer not null, updated_at timestamptz not null default now());
do $$ declare name text; begin
 foreach name in array array['newsletter_subscribers','newsletter_campaigns','newsletter_outbox','newsletter_rate_limits'] loop
  execute format('alter table elio.%I enable row level security',name);
  execute format('revoke all on elio.%I from public,anon,authenticated',name);
 end loop;
end $$;

create function elio.newsletter_settings() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',true,'popup_delay_ms',5000,'discount_percent',5,
  'min_subtotal_cents',50000,'cap_cents',10000,'expiry_days',14,'confirmation_hours',48,
  'mailing_address',coalesce(nullif(btrim(data->>'newsletter_mailing_address'),''),data->>'pickup_address',''),
  'own_status',(select n.status from elio.newsletter_subscribers n join auth.users u on lower(btrim(u.email))=n.email where u.id=auth.uid()),
  'opted_in',exists(select 1 from elio.newsletter_subscribers n join auth.users u on lower(btrim(u.email))=n.email where u.id=auth.uid() and n.status in ('pending','subscribed')),
  'known_subscriber',exists(select 1 from elio.newsletter_subscribers n join auth.users u on lower(btrim(u.email))=n.email where u.id=auth.uid()))
 from elio.settings where id
$$;
create function elio.newsletter_email_settings() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('site_url',data->>'site_url','shop_name',data->>'shop_name',
  'contact_email',data->>'contact_email','newsletter_mailing_address',elio.newsletter_settings()->>'mailing_address')
 from elio.settings where id
$$;
create function elio.newsletter_email(value text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare email text:=lower(btrim(coalesce(value,'')));
begin
 perform elio.require(length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and email !~ '[[:cntrl:]]','Enter a valid email address.');
 return email;
end $$;
create function elio.newsletter_rate(p_key text,p_seconds integer,p_limit integer) returns boolean
language plpgsql volatile security invoker set search_path='' as $$
declare period bigint:=floor(extract(epoch from clock_timestamp())/p_seconds); total integer;
begin
 insert into elio.newsletter_rate_limits(key,bucket,hits) values(p_key,period,1)
 on conflict(key) do update set hits=case when elio.newsletter_rate_limits.bucket=excluded.bucket then elio.newsletter_rate_limits.hits+1 else 1 end,bucket=excluded.bucket,updated_at=now()
 returning hits into total;
 delete from elio.newsletter_rate_limits where updated_at<now()-interval '2 days';
 return total<=p_limit;
end $$;
create function elio.newsletter_unsubscribe_token(p elio.newsletter_subscribers) returns text
language sql stable security invoker set search_path='' as $$
 select extensions.pgp_sym_decrypt(p.unsubscribe_encrypted,token_key) from elio.secrets where id
$$;
create function elio.newsletter_unsubscribe(p_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
begin
 update elio.newsletter_subscribers set status=case when status='suppressed' then status else 'unsubscribed' end,
  unsubscribed_at=coalesce(unsubscribed_at,now()),confirmation_digest=null,confirmation_expires_at=null where id=p_id;
 update elio.newsletter_outbox set status='skipped',last_error='Subscriber unsubscribed.',lease_token=null,leased_until=null
 where subscriber_id=p_id and status in ('pending','sending');
 return jsonb_build_object('status','unsubscribed');
end $$;
create function elio.newsletter_campaign_data(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare subject text:=btrim(coalesce(p->>'subject','')); title text:=btrim(coalesce(p->>'title',''));
 body text:=btrim(coalesce(p->>'body','')); cta_label text:=btrim(coalesce(p->>'cta_label',''));
 cta_url text:=btrim(coalesce(p->>'cta_url','')); image_url text:=btrim(coalesce(p->>'image_url',''));
begin
 perform elio.require(length(subject) between 1 and 150 and subject !~ '[[:cntrl:]]','Enter an email subject of 1–150 characters.');
 perform elio.require(length(title) between 1 and 160 and title !~ '[[:cntrl:]]','Enter a newsletter title of 1–160 characters.');
 perform elio.require(length(body) between 1 and 20000,'Enter a newsletter message of 1–20,000 characters.');
 perform elio.require(length(cta_label)<=80 and cta_label !~ '[[:cntrl:]]','Use a button label of at most 80 characters.');
 perform elio.require((cta_label='')=(cta_url=''),'Provide both a button label and its link, or leave both blank.');
 if cta_url<>'' then
  perform elio.normalize_delivery_tracking_url(to_jsonb(cta_url));
  perform elio.require(cta_url ~* '^https://','Newsletter buttons require HTTPS links.');
 end if;
 if image_url<>'' then
  perform elio.normalize_delivery_tracking_url(to_jsonb(image_url));
  perform elio.require(image_url ~* '^https://','Newsletter images require HTTPS links.');
 end if;
 return jsonb_build_object('subject',subject,'title',title,'body',body,'cta_label',cta_label,'cta_url',cta_url,'image_url',image_url);
end $$;
create function elio.newsletter_campaign_json(p elio.newsletter_campaigns) returns jsonb
language sql stable security invoker set search_path='' as $$
 select p.data||jsonb_build_object('id',p.id,'status',p.status,'revision',p.revision,'created_at',p.created_at,'updated_at',p.updated_at,'queued_at',p.queued_at,
  'queued_count',(select count(*) from elio.newsletter_outbox where campaign_id=p.id and event_type='newsletter_campaign'),
  'sent_count',(select count(*) from elio.newsletter_outbox where campaign_id=p.id and status='sent' and event_type='newsletter_campaign'),
  'failed_count',(select count(*) from elio.newsletter_outbox where campaign_id=p.id and status='failed' and event_type='newsletter_campaign'))
$$;

create function elio.newsletter_activate(p_id uuid) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare s elio.newsletter_subscribers; promo uuid; v_code text; offer jsonb; expiry timestamptz; attempts integer:=0;
begin
 select * into s from elio.newsletter_subscribers where id=p_id for update;
 perform elio.require(found and s.status in ('pending','subscribed'),'This subscription cannot be activated.');
 if s.status='subscribed' then return jsonb_build_object('status','subscribed'); end if;
 if s.promo_id is null then
  promo:=gen_random_uuid();expiry:=now()+interval '14 days';
  loop
   attempts:=attempts+1;
   perform elio.require(attempts<=12,'An offer code could not be generated. Please retry confirmation.');
   select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%32+1,1),'' order by n)
    into v_code from (select extensions.gen_random_bytes(6) bytes) entropy cross join generate_series(0,5) n;
   offer:=jsonb_build_object('id',promo,'code',v_code,'kind','percent','value',5,'min_subtotal_cents',50000,'cap_cents',10000,'per_account_limit',1,'global_limit',1,'expires_at',expiry,'active',true,'newsletter_managed',true);
   insert into elio.promos(id,code,data) values(promo,v_code,offer) on conflict(code) do nothing;
   exit when found;
  end loop;
  update elio.newsletter_subscribers set promo_id=promo,offer_expires_at=expiry where id=s.id;
 end if;
 update elio.newsletter_subscribers set status='subscribed',confirmed_at=coalesce(confirmed_at,now()),subscribed_at=now(),unsubscribed_at=null where id=s.id returning * into s;
 select data into offer from elio.promos where id=s.promo_id;
 insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,to_email,subject,payload)
 values('newsletter-welcome:'||s.id,'newsletter_welcome',s.id,s.email,'Welcome to Elio · your 5% offer',jsonb_build_object('event_type','newsletter_welcome','subscriber',jsonb_build_object('email',s.email),'offer',offer-'id'-'newsletter_managed','unsubscribe_token',elio.newsletter_unsubscribe_token(s),'settings',elio.newsletter_email_settings()))
 on conflict(event_key) do nothing;
 return jsonb_build_object('status','subscribed');
end $$;

create function elio.newsletter_service_dispatch(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare s elio.newsletter_subscribers; e elio.newsletter_outbox; account auth.users;
 v_email text; confirm_token text; unsubscribe_token text; v_source text;
 ip text:=p_payload->>'ip_hash'; token text:=p_payload->>'token';
 accepted boolean; result jsonb:='[]'; v_limit integer; lease uuid; good boolean; supplied jsonb;
begin
 if p_action in ('newsletter_subscribe','newsletter_confirm','newsletter_unsubscribe') then
  perform elio.require(ip ~ '^[a-f0-9]{64}$','A trusted request identifier is required.');
 end if;
 if p_action='newsletter_subscribe' then
  v_email:=elio.newsletter_email(p_payload->>'email');v_source:=p_payload->>'source';
  perform elio.require(p_payload->'consent'='true'::jsonb and p_payload->>'consent_version'='elio-newsletter-v1','Newsletter consent is required.');
  perform elio.require(v_source in ('home_popup','home_footer','account'),'Choose a valid newsletter source.');
  -- Account consent belongs to the verified signup metadata, never this public request.
  -- In particular, an anonymous request must not reactivate old consent after opt-out.
  if v_source='account' then return jsonb_build_object('accepted',true,'queued',false); end if;
  accepted:=elio.newsletter_rate('subscribe-global-hour',3600,50);
  accepted:=elio.newsletter_rate('subscribe-ip-hour:'||ip,3600,20) and accepted;
  accepted:=elio.newsletter_rate('subscribe-ip-day:'||ip,86400,100) and accepted;
  accepted:=elio.newsletter_rate('subscribe-email-minute:'||encode(extensions.digest(v_email,'sha256'),'hex'),60,1) and accepted;
  accepted:=elio.newsletter_rate('subscribe-email-day:'||encode(extensions.digest(v_email,'sha256'),'hex'),86400,5) and accepted;
  if not accepted then return jsonb_build_object('accepted',true,'queued',false,'rate_limited',true); end if;
  select * into s from elio.newsletter_subscribers where email=v_email for update;
  if found and s.status in ('subscribed','suppressed') then return jsonb_build_object('accepted',true,'queued',false); end if;
  confirm_token:=encode(extensions.gen_random_bytes(32),'hex');
  if s.id is null then
   unsubscribe_token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into elio.newsletter_subscribers(email,source,consent_version,consent_at,confirmation_digest,confirmation_expires_at,unsubscribe_digest,unsubscribe_encrypted)
   values(v_email,v_source,'elio-newsletter-v1',now(),extensions.digest(confirm_token,'sha256'),now()+interval '48 hours',extensions.digest(unsubscribe_token,'sha256'),extensions.pgp_sym_encrypt(unsubscribe_token,(select token_key from elio.secrets where id))) returning * into s;
  else
   update elio.newsletter_subscribers set status='pending',source=v_source,consent_version='elio-newsletter-v1',consent_at=now(),confirmation_digest=extensions.digest(confirm_token,'sha256'),confirmation_expires_at=now()+interval '48 hours',confirmation_generation=confirmation_generation+1 where id=s.id returning * into s;
  end if;
  update elio.newsletter_outbox set status='skipped',last_error='Confirmation superseded.',lease_token=null,leased_until=null
   where subscriber_id=s.id and event_type='newsletter_confirmation' and status in ('pending','sending');
  if v_source='account' then return jsonb_build_object('accepted',true,'queued',false); end if;
  insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,to_email,subject,payload)
  values('newsletter-confirm:'||s.id||':'||s.confirmation_generation,'newsletter_confirmation',s.id,s.email,'Confirm your Elio newsletter subscription',jsonb_build_object('event_type','newsletter_confirmation','subscriber',jsonb_build_object('email',s.email),'confirmation_token',confirm_token,'confirmation_generation',s.confirmation_generation,'confirmation_expires_at',s.confirmation_expires_at,'unsubscribe_token',elio.newsletter_unsubscribe_token(s),'settings',elio.newsletter_email_settings()));
  return jsonb_build_object('accepted',true,'queued',true);
 elsif p_action='newsletter_activate_account' then
  select * into account from auth.users where id=(p_payload->>'user_id')::uuid and email_confirmed_at is not null;
  if not found then return jsonb_build_object('status','not_subscribed'); end if;
  v_email:=elio.newsletter_email(account.email);
  select * into s from elio.newsletter_subscribers where email=v_email for update;
  if found and s.status='subscribed' then return jsonb_build_object('status','subscribed'); end if;
  if (s.id is not null and (s.status<>'pending' or s.source<>'account'))
   or account.raw_user_meta_data->'newsletter_opt_in' is distinct from 'true'::jsonb
   or account.raw_user_meta_data->>'newsletter_consent_version' is distinct from 'elio-newsletter-v1' then
   return jsonb_build_object('status','not_subscribed');
  end if;
  if s.id is null then
   unsubscribe_token:=encode(extensions.gen_random_bytes(32),'hex');
   insert into elio.newsletter_subscribers(email,source,consent_version,consent_at,unsubscribe_digest,unsubscribe_encrypted)
   values(v_email,'account','elio-newsletter-v1',now(),extensions.digest(unsubscribe_token,'sha256'),extensions.pgp_sym_encrypt(unsubscribe_token,(select token_key from elio.secrets where id))) returning * into s;
  end if;
  return elio.newsletter_activate(s.id);
 elsif p_action='newsletter_confirm' then
  accepted:=elio.newsletter_rate('confirm-ip-hour:'||ip,3600,60);
  if not accepted then return jsonb_build_object('status','rate_limited'); end if;
  perform elio.require(token ~ '^[a-f0-9]{64}$','This confirmation link is invalid or expired.');
  select * into s from elio.newsletter_subscribers where confirmation_digest=extensions.digest(token,'sha256') for update;
  perform elio.require(found and s.status in ('pending','subscribed') and s.source<>'account','This confirmation link is invalid or expired.');
  if s.status='subscribed' then return jsonb_build_object('status','subscribed'); end if;
  perform elio.require(s.confirmation_expires_at>now(),'This confirmation link is invalid or expired.');
  return elio.newsletter_activate(s.id);
 elsif p_action='newsletter_unsubscribe' then
  perform elio.require(token ~ '^[a-f0-9]{64}$','This unsubscribe link is invalid.');
  select * into s from elio.newsletter_subscribers where unsubscribe_digest=extensions.digest(token,'sha256') for update;
  perform elio.require(found,'This unsubscribe link is invalid.');
  return elio.newsletter_unsubscribe(s.id);
 elsif p_action='newsletter_claim_emails' then
  v_limit:=least(greatest(coalesce((p_payload->>'limit')::integer,3),1),10);
  update elio.newsletter_outbox set status='failed',last_error='Delivery outcome requires review: idempotency window elapsed.',lease_token=null,leased_until=null
   where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours' and (leased_until is null or leased_until<now());
  for e in select * from elio.newsletter_outbox where ((status='pending' and available_at<=now()) or (status='sending' and leased_until<=now())) and attempts<8
   order by case when event_type='newsletter_campaign' then 1 else 0 end,created_at,id for update skip locked limit v_limit loop
   lease:=gen_random_uuid();
   update elio.newsletter_outbox set status='sending',attempts=attempts+1,lease_token=lease,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=e.id returning * into e;
   result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'provider_payload',e.provider_payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at));
  end loop;
  return result;
 elsif p_action in ('newsletter_prepare_email','newsletter_email_sent','newsletter_email_failed') then
  select * into e from elio.newsletter_outbox where id=(p_payload->>'id')::uuid and lease_token=(p_payload->>'lease_token')::uuid and status='sending' for update;
  perform elio.require(found and e.leased_until>now(),'Newsletter email claim is stale.');
  if p_action='newsletter_prepare_email' then
   good:=e.event_type='newsletter_test_campaign';
   if e.subscriber_id is not null then
    select * into s from elio.newsletter_subscribers where id=e.subscriber_id;
    if e.event_type='newsletter_confirmation' then
     good:=s.status='pending' and s.source<>'account' and s.confirmation_expires_at>now() and s.confirmation_generation=(e.payload->>'confirmation_generation')::integer;
    else good:=s.status='subscribed'; end if;
   end if;
   if not coalesce(good,false) then
    update elio.newsletter_outbox set status='skipped',last_error='Subscriber or confirmation no longer eligible.',lease_token=null,leased_until=null where id=e.id;
    return jsonb_build_object('skip',true);
   end if;
   supplied:=p_payload->'provider_payload';
   if supplied is not null then
    perform elio.require(jsonb_typeof(supplied)='object' and supplied->'to'=jsonb_build_array(e.to_email) and length(supplied->>'html') between 1 and 500000 and length(supplied->>'text') between 1 and 100000,'Invalid frozen newsletter provider payload.');
   end if;
   update elio.newsletter_outbox set prepared_at=coalesce(prepared_at,now()),provider_payload=coalesce(provider_payload,supplied) where id=e.id returning * into e;
   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'provider_payload',e.provider_payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);
  elsif p_action='newsletter_email_sent' then
   update elio.newsletter_outbox set status='sent',sent_at=now(),provider_id=left(p_payload->>'provider_id',200),lease_token=null,leased_until=null,last_error=null where id=e.id;
   return jsonb_build_object('sent',true);
  else
   update elio.newsletter_outbox set status=case when coalesce((p_payload->>'terminal')::boolean,false) or attempts>=8 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>least(3600,(power(2,attempts)*30)::integer)),last_error=left(coalesce(p_payload->>'error','Newsletter delivery failed.'),2000),lease_token=null,leased_until=null where id=e.id;
   return jsonb_build_object('recorded',true);
  end if;
 end if;
 raise exception 'Unknown newsletter service action.' using errcode='22023';
end $$;

create function elio.newsletter_admin_dispatch(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare u uuid:=auth.uid(); s elio.newsletter_subscribers; c elio.newsletter_campaigns;
 content jsonb; subscriber_rows jsonb; total integer; eligible integer; eligible_ids uuid[];
 v_limit integer:=least(greatest(coalesce((p_payload->>'limit')::integer,50),1),100);
 v_offset integer:=greatest(coalesce((p_payload->>'offset')::integer,0),0);
 filter text:=lower(btrim(coalesce(p_payload->>'search',''))); selected_status text:=nullif(p_payload->>'status','');
 recipient text; queued integer:=0;
begin
 if p_action='newsletter_settings' then return elio.newsletter_settings(); end if;
 perform elio.assert_staff(u,true);
 if p_action='newsletter_admin' then
  perform elio.require(length(filter)<=254 and (selected_status is null or selected_status in ('pending','subscribed','unsubscribed','suppressed')),'Choose a valid subscriber filter.');
  select count(*) into total from elio.newsletter_subscribers where (selected_status is null or status=selected_status) and (filter='' or position(filter in email)>0);
  select coalesce(jsonb_agg(row_data order by created_at desc,id),'[]') into subscriber_rows from (
   select n.id,n.created_at,jsonb_build_object('id',n.id,'email',n.email,'status',n.status,'source',n.source,'created_at',n.created_at,'confirmed_at',n.confirmed_at,'subscribed_at',n.subscribed_at,'unsubscribed_at',n.unsubscribed_at,'offer_code',p.code,'offer_expires_at',n.offer_expires_at) row_data
   from elio.newsletter_subscribers n left join elio.promos p on p.id=n.promo_id
   where (selected_status is null or n.status=selected_status) and (filter='' or position(filter in n.email)>0)
   order by n.created_at desc,n.id limit v_limit offset v_offset
  ) rows;
  return jsonb_build_object('counts',(select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'subscribed',count(*) filter(where status='subscribed'),'unsubscribed',count(*) filter(where status='unsubscribed'),'suppressed',count(*) filter(where status='suppressed')) from elio.newsletter_subscribers),
   'subscribers',subscriber_rows,'total',total,'limit',v_limit,'offset',v_offset,
   'campaigns',(select coalesce(jsonb_agg(elio.newsletter_campaign_json(d) order by d.created_at desc),'[]') from (select * from elio.newsletter_campaigns order by created_at desc limit 100) d),
   'settings',elio.newsletter_settings())||elio.newsletter_offer_report(p_payload);
 elsif p_action='newsletter_admin_unsubscribe' then
  perform elio.require(exists(select 1 from elio.newsletter_subscribers where id=(p_payload->>'subscriber_id')::uuid),'Subscriber not found.');
  return elio.newsletter_unsubscribe((p_payload->>'subscriber_id')::uuid);
 elsif p_action in ('newsletter_save_campaign','newsletter_preview_campaign','newsletter_test_campaign') then
  content:=elio.newsletter_campaign_data(p_payload->'campaign');
  if p_action='newsletter_preview_campaign' then
   select count(*) into eligible from elio.newsletter_subscribers where status='subscribed';
   return jsonb_build_object('event_type','newsletter_campaign','campaign',content||jsonb_build_object('id',p_payload#>>'{campaign,id}','revision',p_payload#>'{campaign,revision}'),'settings',elio.newsletter_email_settings(),'subscriber',jsonb_build_object('email','preview@example.test'),'unsubscribe_token','preview-only','recipient_count',eligible);
  elsif p_action='newsletter_test_campaign' then
   recipient:=elio.newsletter_email(p_payload->>'recipient');
   perform elio.require(elio.newsletter_rate('admin-test:'||u::text,3600,10),'The hourly test-email limit has been reached.');
   insert into elio.newsletter_outbox(event_key,event_type,to_email,subject,payload)
   values('newsletter-test:'||gen_random_uuid(),'newsletter_test_campaign',recipient,'[Test] '||(content->>'subject'),jsonb_build_object('event_type','newsletter_test_campaign','campaign',content,'settings',elio.newsletter_email_settings(),'subscriber',jsonb_build_object('email',recipient),'unsubscribe_token',null));
   return jsonb_build_object('queued',true,'recipient',recipient);
  end if;
  if nullif(p_payload#>>'{campaign,id}','') is not null then
   select * into c from elio.newsletter_campaigns where id=(p_payload#>>'{campaign,id}')::uuid for update;
   perform elio.require(found and c.status='draft','Only draft newsletters can be edited.');
   perform elio.require(c.revision=(p_payload#>>'{campaign,revision}')::integer,'This newsletter changed. Reload before editing.');
   update elio.newsletter_campaigns set data=content,revision=revision+1,updated_at=now() where id=c.id returning * into c;
  else
   insert into elio.newsletter_campaigns(data,created_by) values(content,u) returning * into c;
  end if;
  return elio.newsletter_campaign_json(c);
 elsif p_action='newsletter_send_campaign' then
  select * into c from elio.newsletter_campaigns where id=(p_payload->>'campaign_id')::uuid for update;
  perform elio.require(found,'Newsletter draft not found.');
  perform elio.require(c.revision=(p_payload->>'expected_revision')::integer,'This newsletter changed after review. Preview it again.');
  if c.status='queued' then return jsonb_build_object('campaign_id',c.id,'queued',(select count(*) from elio.newsletter_outbox where campaign_id=c.id),'status','queued'); end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into eligible_ids from elio.newsletter_subscribers where status='subscribed';
  eligible:=cardinality(eligible_ids);
  perform elio.require(eligible=(p_payload->>'expected_recipient_count')::integer,'The subscriber list changed after review. Preview it again.');
  perform elio.require(eligible>0,'There are no confirmed active subscribers to send to.');
  for s in select * from elio.newsletter_subscribers where id=any(eligible_ids) order by id loop
   insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,campaign_id,to_email,subject,payload)
   values('newsletter-campaign:'||c.id||':'||s.id,'newsletter_campaign',s.id,c.id,s.email,c.data->>'subject',jsonb_build_object('event_type','newsletter_campaign','campaign',c.data||jsonb_build_object('id',c.id,'revision',c.revision),'settings',elio.newsletter_email_settings(),'subscriber',jsonb_build_object('email',s.email),'unsubscribe_token',elio.newsletter_unsubscribe_token(s)));
   queued:=queued+1;
  end loop;
  update elio.newsletter_campaigns set status='queued',queued_at=now(),updated_at=now() where id=c.id;
  return jsonb_build_object('campaign_id',c.id,'queued',queued,'status','queued');
 end if;
 raise exception 'Unknown newsletter action.' using errcode='22023';
end $$;

create function elio.newsletter_offer_report(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_limit integer:=least(greatest(coalesce((p_payload->>'offer_limit')::integer,50),1),100);
 v_offset integer:=greatest(coalesce((p_payload->>'offer_offset')::integer,0),0);
 search text:=lower(btrim(coalesce(p_payload->>'offer_search',''))); status_filter text:=nullif(p_payload->>'offer_status',''); result jsonb;
begin
 perform elio.require(length(search)<=254 and (status_filter is null or status_filter in ('used','reserved','inactive','expired','active')),'Choose a valid offer filter.');
 with issued as (
  select p.id,n.email,p.code,n.confirmed_at issued_at,n.offer_expires_at expires_at,
   coalesce((p.data->>'active')::boolean,false) active,p.data->>'deleted_at' deleted_at,
   (select count(*) from elio.promo_usage where promo_id=p.id and state='redeemed') redeemed_count,
   (select count(*) from elio.promo_usage where promo_id=p.id and state='reserved') reserved_count,
   sales.paid_order_count,sales.sales_cents,sales.discount_cents
  from elio.newsletter_subscribers n join elio.promos p on p.id=n.promo_id
  cross join lateral (select count(*) paid_order_count,
   coalesce(sum(greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint)),0) sales_cents,
   coalesce(sum((o.data->>'discount_cents')::bigint),0) discount_cents
   from elio.promo_usage usage join elio.orders o on o.id=usage.order_id
   where usage.promo_id=p.id and o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired') and not o.refund_label) sales
 ), offers as (
  select *,case when redeemed_count>0 then 'used' when reserved_count>0 then 'reserved'
   when not active or deleted_at is not null then 'inactive' when expires_at<=now() then 'expired' else 'active' end status from issued
 ), filtered as (
  select * from offers where (search='' or position(search in lower(email||' '||code))>0) and (status_filter is null or status=status_filter)
 ), page as (select * from filtered order by issued_at desc,id limit v_limit offset v_offset)
 select jsonb_build_object('offer_counts',(select jsonb_build_object('issued',count(*),'unused',count(*) filter(where status='active'),
  'reserved',count(*) filter(where status='reserved'),'redeemed',count(*) filter(where status='used'),
  'expired',count(*) filter(where status='expired'),'inactive',count(*) filter(where status='inactive'),
  'paid_order_count',coalesce(sum(paid_order_count),0),'sales_cents',coalesce(sum(sales_cents),0),'discount_cents',coalesce(sum(discount_cents),0)) from offers),
  'offers',(select coalesce(jsonb_agg(to_jsonb(page) order by issued_at desc,id),'[]') from page),
  'offer_total',(select count(*) from filtered),'offer_limit',v_limit,'offer_offset',v_offset) into result;
 return result;
end $$;

-- Keep code ownership out of order snapshots; only verified Auth identity binds it.
create function elio.newsletter_check_offer(p_promo uuid,p_user uuid) returns void
language plpgsql stable security invoker set search_path='' as $$
declare subscriber_email text;
begin
 select email into subscriber_email from elio.newsletter_subscribers where promo_id=p_promo;
 if found then
  perform elio.require(exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null and lower(btrim(email))=subscriber_email),'Sign in with the verified email address that received this newsletter offer.');
 end if;
end $$;
do $$
declare definition text; hook text;
begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook:=$old$ if p_action='catalog' then$old$;
 perform elio.require(position(hook in definition)>0,'Missing newsletter customer dispatch hook.');
 definition:=replace(definition,hook,$new$ if p_action like 'newsletter\_%' escape '\' then return elio.newsletter_admin_dispatch(p_action,p_payload); end if;
 if p_action in ('save_promo','delete_promo') then
  perform elio.require(not exists(select 1 from elio.newsletter_subscribers where promo_id=coalesce(nullif(p_payload->>'id',''),nullif(p_payload#>>'{promo,id}',''))::uuid),'Subscriber welcome offers cannot be edited or deleted.');
 end if;
$new$||hook);
 execute definition;
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook:=$old$ expired_count:=elio.expire_orders();$old$;
 perform elio.require(position(hook in definition)>0,'Missing newsletter service dispatch hook.');
 definition:=replace(definition,hook,$new$ if p_action like 'newsletter\_%' escape '\' then return elio.newsletter_service_dispatch(p_action,p_payload); end if;
$new$||hook);
 execute definition;
 definition:=pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure);
 hook:=$old$   perform elio.require(promo is not null,'Promo code not found.');$old$;
 perform elio.require(position(hook in definition)>0,'Missing newsletter offer binding hook.');
 definition:=replace(definition,hook,hook||$new$
   perform elio.newsletter_check_offer((promo->>'id')::uuid,p_user);$new$);
 execute definition;
end $$;

revoke all on function elio.newsletter_settings(),elio.newsletter_email_settings(),elio.newsletter_email(text),elio.newsletter_rate(text,integer,integer),elio.newsletter_unsubscribe_token(elio.newsletter_subscribers),elio.newsletter_unsubscribe(uuid),elio.newsletter_campaign_data(jsonb),elio.newsletter_campaign_json(elio.newsletter_campaigns),elio.newsletter_activate(uuid),elio.newsletter_admin_dispatch(text,jsonb),elio.newsletter_service_dispatch(text,jsonb),elio.newsletter_offer_report(jsonb),elio.newsletter_check_offer(uuid,uuid) from public,anon,authenticated;
