create table elio.newsletter_offer_settings (
 id boolean primary key default true check(id),
 discount_percent integer not null default 5 check(discount_percent between 1 and 100),
 min_subtotal_cents integer not null default 50000 check(min_subtotal_cents between 0 and 100000000),
 cap_cents integer not null default 10000 check(cap_cents between 1 and 100000000),
 expiry_days integer not null default 14 check(expiry_days between 1 and 365),
 revision integer not null default 1, updated_at timestamptz not null default now()
);
insert into elio.newsletter_offer_settings(id) values(true);
alter table elio.newsletter_offer_settings enable row level security;
revoke all on elio.newsletter_offer_settings from public,anon,authenticated,service_role;

create function elio.save_newsletter_offer_settings(p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare current elio.newsletter_offer_settings; value jsonb:=p_payload->'settings'; key text;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(jsonb_typeof(value)='object','Provide welcome offer settings.');
 foreach key in array array['discount_percent','min_subtotal_cents','cap_cents','expiry_days','revision'] loop
  perform elio.require(jsonb_typeof(value->key)='number' and value->>key ~ '^[0-9]+$','Use whole-number offer settings.');
 end loop;
 select * into current from elio.newsletter_offer_settings where id for update;
 perform elio.require((value->>'revision')::integer=current.revision,'Offer settings changed. Refresh before saving.');
 perform elio.require((value->>'discount_percent')::numeric between 1 and 100,'Discount must be between 1% and 100%.');
 perform elio.require((value->>'min_subtotal_cents')::numeric between 0 and 100000000,'Choose a valid minimum spend.');
 perform elio.require((value->>'cap_cents')::numeric between 1 and 100000000,'Choose a positive maximum discount.');
 perform elio.require((value->>'expiry_days')::numeric between 1 and 365,'Expiry must be between 1 and 365 days.');
 update elio.newsletter_offer_settings set discount_percent=(value->>'discount_percent')::integer,
  min_subtotal_cents=(value->>'min_subtotal_cents')::integer,cap_cents=(value->>'cap_cents')::integer,
  expiry_days=(value->>'expiry_days')::integer,revision=revision+1,updated_at=now() where id returning * into current;
 return to_jsonb(current)-'id';
end $$;

-- A saved layout is part of the reviewed campaign snapshot.
do $$
declare definition text:=pg_get_functiondef('elio.newsletter_campaign_data(jsonb)'::regprocedure); hook text;
begin
 hook:=$old$ return jsonb_build_object('subject',subject,'title',title,'body',body,'cta_label',cta_label,'cta_url',cta_url,'image_url',image_url);$old$;
 perform elio.require(position(hook in definition)>0,'Missing newsletter layout validation hook.');
 execute replace(definition,hook,$new$ perform elio.require(coalesce(p->>'template','spotlight') in ('spotlight','offer','letter'),'Choose a valid newsletter template.');
 return jsonb_build_object('subject',subject,'title',title,'body',body,'cta_label',cta_label,'cta_url',cta_url,'image_url',image_url,'template',coalesce(p->>'template','spotlight'));$new$);
end $$;
revoke all on function elio.save_newsletter_offer_settings(jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text; hook text;
begin
 definition:=pg_get_functiondef('elio.newsletter_settings()'::regprocedure);
 hook:=$old$'enabled',true,'popup_delay_ms',5000,'discount_percent',5,
  'min_subtotal_cents',50000,'cap_cents',10000,'expiry_days',14,'confirmation_hours',48,$old$;
 perform elio.require(position(hook in definition)>0,'Missing public welcome settings hook.');
 definition:=replace(definition,hook,$new$'enabled',true,'popup_delay_ms',5000,'discount_percent',policy.discount_percent,
  'min_subtotal_cents',policy.min_subtotal_cents,'cap_cents',policy.cap_cents,'expiry_days',policy.expiry_days,'revision',policy.revision,'confirmation_hours',0,$new$);
 definition:=replace(definition,'from elio.settings where id','from elio.settings cross join elio.newsletter_offer_settings policy where elio.settings.id and policy.id');
 execute definition;

 definition:=pg_get_functiondef('elio.newsletter_activate(uuid)'::regprocedure);
 definition:=replace(definition,'attempts integer:=0;','attempts integer:=0; policy elio.newsletter_offer_settings;');
 hook:=$old$promo:=gen_random_uuid();expiry:=now()+interval '14 days';$old$;
 perform elio.require(position(hook in definition)>0,'Missing welcome offer issuance hook.');
 definition:=replace(definition,hook,$new$select * into strict policy from elio.newsletter_offer_settings where id for share;
  promo:=gen_random_uuid();expiry:=now()+make_interval(days=>policy.expiry_days);$new$);
 definition:=replace(definition,$old$'value',5,'min_subtotal_cents',50000,'cap_cents',10000$old$,$new$'value',policy.discount_percent,'min_subtotal_cents',policy.min_subtotal_cents,'cap_cents',policy.cap_cents$new$);
 definition:=replace(definition,'Please retry confirmation.','Please try joining again.');
 definition:=replace(definition,$old$'Welcome to Elio · your 5% offer'$old$,$new$'Welcome to Elio · your '||(offer->>'value')||'% offer'$new$);
 execute definition;

 definition:=pg_get_functiondef('elio.newsletter_admin_dispatch(text,jsonb)'::regprocedure);
 hook:=$old$ if p_action='newsletter_admin' then$old$;
 perform elio.require(position(hook in definition)>0,'Missing owner newsletter dispatch hook.');
 execute replace(definition,hook,$new$ if p_action='newsletter_save_offer_settings' then return elio.save_newsletter_offer_settings(p_payload); end if;
$new$||hook);
end $$;
