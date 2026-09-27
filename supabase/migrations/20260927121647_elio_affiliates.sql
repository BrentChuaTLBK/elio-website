begin;

create table elio.affiliates (
 id uuid primary key, user_id uuid not null unique references auth.users(id),
 name text not null check(length(btrim(name)) between 1 and 120), active boolean not null default true,
 commission_bps integer not null check(commission_bps between 0 and 10000),
 revision integer not null default 1, created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create table elio.affiliate_codes (
 promo_id uuid primary key references elio.promos(id), affiliate_id uuid not null references elio.affiliates(id),
 starts_at timestamptz not null, revision integer not null default 1, created_at timestamptz not null default clock_timestamp()
);
create index affiliate_codes_affiliate on elio.affiliate_codes(affiliate_id);
create table elio.affiliate_orders (
 order_id uuid primary key references elio.orders(id), affiliate_id uuid not null references elio.affiliates(id),
 promo_id uuid not null references elio.affiliate_codes(promo_id), code text not null,
 commission_bps integer not null check(commission_bps between 0 and 10000), excluded_self boolean not null,
 net_sales_cents bigint not null default 0, estimated_cents bigint not null default 0,
 earned_cents bigint not null default 0, status text not null default 'awaiting_payment', version integer not null default 0,
 first_earned_at timestamptz, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index affiliate_orders_affiliate on elio.affiliate_orders(affiliate_id,created_at desc,order_id);
create index affiliate_orders_promo on elio.affiliate_orders(promo_id);
create table elio.affiliate_ledger (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references elio.affiliates(id),
 order_id uuid not null references elio.orders(id), amount_cents bigint not null check(amount_cents<>0),
 version integer not null, reason text not null, created_at timestamptz not null default clock_timestamp(), unique(order_id,version)
);
create index affiliate_ledger_affiliate on elio.affiliate_ledger(affiliate_id,created_at desc);
create table elio.affiliate_payouts (
 id uuid primary key, affiliate_id uuid not null references elio.affiliates(id),
 amount_cents bigint not null check(amount_cents between 1 and 999999999), paid_on date not null,
 payment_method text not null check(payment_method in ('gcash','cash','bank_transfer','other')),
 reference text not null default '' check(length(reference)<=200), note text not null default '' check(length(note)<=2000),
 proof_path text not null unique, request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'paid' check(status in ('paid','voided')), revision integer not null default 1,
 created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
 voided_by uuid, voided_at timestamptz, void_reason text
);
create index affiliate_payouts_affiliate on elio.affiliate_payouts(affiliate_id,paid_on desc,id);
create index affiliate_payouts_date on elio.affiliate_payouts(paid_on) where status='paid';
create table elio.affiliate_audit (
 id bigint generated always as identity primary key, target_id uuid not null, actor uuid not null,
 action text not null, before_data jsonb, after_data jsonb, at timestamptz not null default clock_timestamp()
);
create index affiliate_audit_target on elio.affiliate_audit(target_id,id);
do $$ declare t text; begin
 foreach t in array array['affiliates','affiliate_codes','affiliate_orders','affiliate_ledger','affiliate_payouts','affiliate_audit'] loop
  execute format('alter table elio.%I enable row level security',t);
  execute format('revoke all on elio.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence elio.affiliate_audit_id_seq from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('affiliate-payout-proofs','affiliate-payout-proofs',false,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Existing orders retain their assigned affiliate and rate. Editing an affiliate
-- cannot retroactively move an order or change its commission percentage.
create function elio.affiliate_sync_order(p_order elio.orders,p_new boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare a elio.affiliates; c elio.affiliate_codes; s elio.affiliate_orders; net bigint:=0; estimate bigint:=0; earned bigint:=0; state text;
begin
 if p_new then
  select * into c from elio.affiliate_codes where promo_id=(p_order.data#>>'{promo_snapshot,id}')::uuid;
  if not found then return; end if;
  perform pg_advisory_xact_lock(841721950318::bigint);
  select * into strict a from elio.affiliates where id=c.affiliate_id;
  insert into elio.affiliate_orders(order_id,affiliate_id,promo_id,code,commission_bps,excluded_self,created_at)
  values(p_order.id,a.id,c.promo_id,p_order.data#>>'{promo_snapshot,code}',a.commission_bps,
   p_order.user_id=a.user_id,p_order.created_at) on conflict(order_id) do nothing;
 end if;
 -- Serialize commission reversals with payout commits. Non-affiliate orders
 -- avoid this lock, so normal ordering does not wait for affiliate bookkeeping.
 if not p_new and exists(select 1 from elio.affiliate_orders where order_id=p_order.id) then
  perform pg_advisory_xact_lock(841721950318::bigint);
 end if;
 select * into s from elio.affiliate_orders where order_id=p_order.id for update;
 if not found then return; end if;
 state:=case when s.excluded_self then 'self_purchase'
  when p_order.refund_label then 'refunded'
  when p_order.fulfillment_status in ('cancelled','expired') or p_order.payment_status in ('rejected','cancelled') then 'cancelled'
  when p_order.payment_status<>'paid' then 'awaiting_payment'
  when coalesce((p_order.data->>'subtotal_cents')::bigint,0)<coalesce((p_order.data#>>'{promo_snapshot,min_subtotal_cents}')::bigint,0) then 'below_minimum'
  when p_order.fulfillment_status='completed' then 'earned'
  when p_order.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery') then 'awaiting_completion'
  else 'awaiting_payment' end;
 if state in ('earned','awaiting_completion') then
  net:=greatest(0,coalesce((p_order.data->>'subtotal_cents')::bigint,0)-coalesce((p_order.data->>'discount_cents')::bigint,0));
  estimate:=round(net::numeric*s.commission_bps/10000)::bigint;
  if state='earned' then earned:=estimate; end if;
 end if;
 if earned<>s.earned_cents then
  insert into elio.affiliate_ledger(affiliate_id,order_id,amount_cents,version,reason)
  values(s.affiliate_id,s.order_id,earned-s.earned_cents,s.version+1,
   case when earned<s.earned_cents then 'Commission reversal: '||state else 'Completed order commission' end);
 end if;
 update elio.affiliate_orders set net_sales_cents=net,estimated_cents=estimate,earned_cents=earned,status=state,
  version=s.version+case when earned<>s.earned_cents then 1 else 0 end,
  first_earned_at=case when state='earned' then coalesce(s.first_earned_at,clock_timestamp()) else s.first_earned_at end,
  updated_at=clock_timestamp() where order_id=s.order_id;
end $$;
create function elio.affiliate_order_changed() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform elio.affiliate_sync_order(new,TG_OP='INSERT');return new;end $$;
create trigger affiliate_order_changed after insert or update on elio.orders for each row execute function elio.affiliate_order_changed();

create function elio.affiliate_balance(p_id uuid) returns bigint language sql stable security invoker set search_path='' as $$
 select coalesce((select sum(earned_cents) from elio.affiliate_orders where affiliate_id=p_id),0)
  -coalesce((select sum(amount_cents) from elio.affiliate_payouts where affiliate_id=p_id and status='paid'),0)
$$;
create function elio.affiliate_report(p_id uuid,p_payload jsonb default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; offset_orders integer:=coalesce((p_payload->>'order_offset')::integer,0); offset_payouts integer:=coalesce((p_payload->>'payout_offset')::integer,0);
begin
 perform elio.require(offset_orders between 0 and 1000000 and offset_payouts between 0 and 1000000,'Choose a valid results page.');
 select jsonb_build_object('affiliate',jsonb_build_object('id',a.id,'name',a.name,'active',a.active,'commission_bps',a.commission_bps,'revision',a.revision),
  'stats',jsonb_build_object(
   'earned_cents',coalesce((select sum(earned_cents) from elio.affiliate_orders where affiliate_id=a.id),0),
   'estimated_cents',coalesce((select sum(estimated_cents) from elio.affiliate_orders where affiliate_id=a.id and status='awaiting_completion'),0),
   'net_sales_cents',coalesce((select sum(net_sales_cents) from elio.affiliate_orders where affiliate_id=a.id and status='earned'),0),
   'completed_orders',(select count(*) from elio.affiliate_orders where affiliate_id=a.id and status='earned'),
   'paid_cents',coalesce((select sum(amount_cents) from elio.affiliate_payouts where affiliate_id=a.id and status='paid'),0),
   'balance_cents',elio.affiliate_balance(a.id)),
  'codes',(select coalesce(jsonb_agg(p.data||jsonb_build_object('id',c.promo_id,'starts_at',c.starts_at,'revision',c.revision,
   'used_count',(select count(*) from elio.promo_usage where promo_id=c.promo_id and state='redeemed'),
   'reserved_count',(select count(*) from elio.promo_usage where promo_id=c.promo_id and state='reserved'),
   'completed_orders',(select count(*) from elio.affiliate_orders where promo_id=c.promo_id and status='earned'),
   'net_sales_cents',coalesce((select sum(net_sales_cents) from elio.affiliate_orders where promo_id=c.promo_id and status='earned'),0),
   'earned_cents',coalesce((select sum(earned_cents) from elio.affiliate_orders where promo_id=c.promo_id),0)) order by c.created_at,c.promo_id),'[]')
   from elio.affiliate_codes c join elio.promos p on p.id=c.promo_id where c.affiliate_id=a.id),
  'orders',(select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc,t.order_id),'[]') from (
   select s.order_id,o.reference,s.code,s.created_at,s.commission_bps,s.net_sales_cents,s.estimated_cents,s.earned_cents,s.status
   from elio.affiliate_orders s join elio.orders o on o.id=s.order_id where s.affiliate_id=a.id order by s.created_at desc,s.order_id limit 50 offset offset_orders)t),
  'order_total',(select count(*) from elio.affiliate_orders where affiliate_id=a.id),'order_offset',offset_orders,
  'payouts',(select coalesce(jsonb_agg(to_jsonb(t) order by t.paid_on desc,t.created_at desc,t.id),'[]') from (
   select id,amount_cents,paid_on,payment_method,reference,note,status,revision,created_at,voided_at,void_reason,true as has_proof
   from elio.affiliate_payouts where affiliate_id=a.id order by paid_on desc,created_at desc,id limit 20 offset offset_payouts)t),
  'payout_total',(select count(*) from elio.affiliate_payouts where affiliate_id=a.id),'payout_offset',offset_payouts,
  'generated_at',clock_timestamp()) into result from elio.affiliates a where a.id=p_id;
 perform elio.require(result is not null,'Affiliate not found.');return result;
end $$;

create function elio.affiliate_api(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=auth.uid(); a elio.affiliates;c elio.affiliate_codes;p elio.affiliate_payouts;target uuid;account_id uuid;
 before_value jsonb;result jsonb;promo jsonb;old_promo jsonb;email_value text;name_value text;active_value boolean;rate integer;start_time timestamptz;end_time timestamptz;
begin
 perform elio.require(u is not null and elio.is_verified(u),'Sign in with your verified Elio account.');
 if p_action in ('affiliate_status','affiliate_dashboard') then
  select * into a from elio.affiliates where user_id=u;
  if p_action='affiliate_status' then return jsonb_build_object('assigned',a.id is not null); end if;
  perform elio.require(a.id is not null,'An affiliate code has not been assigned to your account yet.');
  return elio.affiliate_report(a.id,p_payload);
 end if;
 perform elio.assert_staff(u,true);
 if p_action='affiliate_admin' then
  return jsonb_build_object('affiliates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name,t.id),'[]') from (
   select a.id,a.name,a.active,a.commission_bps,a.revision,users.email,
    elio.affiliate_balance(a.id) as balance_cents,
    coalesce((select sum(earned_cents) from elio.affiliate_orders where affiliate_id=a.id),0) as earned_cents,
    (select count(*) from elio.affiliate_codes where affiliate_id=a.id) as code_count
   from elio.affiliates a join auth.users users on users.id=a.user_id)t));
 elsif p_action='affiliate_report' then return elio.affiliate_report((p_payload->>'id')::uuid,p_payload);
 elsif p_action='affiliate_history' then
  return (select coalesce(jsonb_agg(jsonb_build_object('action',action,'at',at,'before',before_data-'proof_path'-'request_hash','after',after_data-'proof_path'-'request_hash') order by id),'[]') from elio.affiliate_audit where target_id=(p_payload->>'id')::uuid);
 end if;
 perform pg_advisory_xact_lock(841721950318::bigint);
 target:=(p_payload->>'id')::uuid;perform elio.require(target is not null,'A record ID is required.');
 if p_action='affiliate_save' then
  select * into a from elio.affiliates where id=target for update;before_value:=case when found then to_jsonb(a) end;
  if a.id is null then
   email_value:=lower(btrim(coalesce(p_payload->>'email','')));
   select id into account_id from auth.users where lower(email)=email_value and email_confirmed_at is not null;
   perform elio.require(account_id is not null,'The affiliate must first create an Elio account and verify their email.');
   perform elio.require(not exists(select 1 from elio.affiliates where user_id=account_id),'This account is already an affiliate. Open its existing record.');
  else account_id:=a.user_id;end if;
  name_value:=btrim(p_payload->>'name');rate:=(p_payload->>'commission_bps')::integer;active_value:=coalesce((p_payload->>'active')::boolean,true);
  perform elio.require(length(name_value) between 1 and 120 and rate between 0 and 10000,'Enter a name and a commission percentage from 0 to 100.');
  if a.id is not null and (a.name,a.commission_bps,a.active) is not distinct from (name_value,rate,active_value) then return to_jsonb(a)-'user_id';end if;
  perform elio.require(coalesce(a.revision,0)=(p_payload->>'revision')::integer,'This affiliate changed. Refresh before saving.');
  insert into elio.affiliates(id,user_id,name,commission_bps,active) values(target,account_id,name_value,rate,active_value)
  on conflict(id) do update set name=excluded.name,commission_bps=excluded.commission_bps,active=excluded.active,revision=elio.affiliates.revision+1,updated_at=clock_timestamp()
  returning to_jsonb(elio.affiliates.*) into result;
 elsif p_action='affiliate_save_code' then
  select * into c from elio.affiliate_codes where promo_id=target for update;
  select data into old_promo from elio.promos where id=target;
  perform elio.require(c.promo_id is not null or old_promo is null,'Choose a new code ID; regular and newsletter codes cannot be reassigned.');
  select * into a from elio.affiliates where id=(p_payload->>'affiliate_id')::uuid;
  perform elio.require(a.id is not null and (c.affiliate_id is null or c.affiliate_id=a.id),'Codes cannot be moved between affiliates.');
  before_value:=case when c.promo_id is not null then old_promo||jsonb_build_object('starts_at',c.starts_at,'revision',c.revision) end;
  start_time:=(p_payload->>'starts_at')::timestamptz;end_time:=(p_payload#>>'{promo,expires_at}')::timestamptz;
  promo:=jsonb_build_object('id',target,'affiliate_managed',true,'code',upper(btrim(p_payload#>>'{promo,code}')),
   'kind',p_payload#>>'{promo,kind}','value',(p_payload#>>'{promo,value}')::integer,
   'min_subtotal_cents',(p_payload#>>'{promo,min_subtotal_cents}')::integer,'cap_cents',(p_payload#>>'{promo,cap_cents}')::integer,
   'per_account_limit',(p_payload#>>'{promo,per_account_limit}')::integer,'global_limit',(p_payload#>>'{promo,global_limit}')::integer,
   'expires_at',end_time,'active',coalesce((p_payload#>>'{promo,active}')::boolean,true));
  perform elio.require(promo->>'code' ~ '^[A-Z0-9_-]{1,40}$','Use 1–40 letters, numbers, underscores or hyphens for the code.');
  perform elio.require(promo->>'kind' in ('percent','fixed') and (promo->>'value')::integer between 1 and 999999999 and (promo->>'kind'<>'percent' or (promo->>'value')::integer<=100),'Enter a valid percentage or fixed discount.');
  perform elio.require((promo->>'min_subtotal_cents')::integer between 0 and 999999999 and (promo->>'cap_cents' is null or (promo->>'cap_cents')::integer between 0 and 999999999),'Enter a valid minimum and optional discount cap.');
  perform elio.require((promo->>'per_account_limit')::integer>0 and (promo->>'global_limit')::integer>0,'Usage limits must be positive whole numbers.');
  perform elio.require(start_time is not null and end_time is not null and end_time>start_time,'The expiry must be after the starting date.');
  perform elio.require(not exists(select 1 from elio.promos where code=promo->>'code' and id<>target),'That promo code already exists.');
  if c.promo_id is not null and old_promo=promo and c.starts_at=start_time then return promo||jsonb_build_object('revision',c.revision,'starts_at',c.starts_at);end if;
  perform elio.require(coalesce(c.revision,0)=(p_payload->>'revision')::integer,'This code changed. Refresh before saving.');
  insert into elio.promos(id,code,data) values(target,promo->>'code',promo) on conflict(id) do update set code=excluded.code,data=excluded.data;
  insert into elio.affiliate_codes(promo_id,affiliate_id,starts_at) values(target,a.id,start_time)
  on conflict(promo_id) do update set starts_at=excluded.starts_at,revision=elio.affiliate_codes.revision+1 returning * into c;
  result:=promo||jsonb_build_object('revision',c.revision,'starts_at',c.starts_at);
 elsif p_action='affiliate_void_payout' then
  select * into p from elio.affiliate_payouts where id=target for update;
  perform elio.require(p.id is not null,'Payout not found.');
  if p.status='voided' then return to_jsonb(p)-'proof_path'-'request_hash';end if;
  perform elio.require(p.revision=(p_payload->>'revision')::integer,'This payout changed. Refresh before correcting it.');
  perform elio.require(length(btrim(p_payload->>'reason')) between 3 and 2000,'Enter a reason for voiding this recorded payout.');
  before_value:=to_jsonb(p);
  update elio.affiliate_payouts set status='voided',revision=revision+1,voided_by=u,voided_at=clock_timestamp(),void_reason=btrim(p_payload->>'reason') where id=target
  returning to_jsonb(elio.affiliate_payouts.*) into result;
 else raise exception 'Unknown affiliate action.' using errcode='22023';end if;
 insert into elio.affiliate_audit(target_id,actor,action,before_data,after_data) values(target,u,p_action,before_value,result);
 return result-'user_id'-'proof_path'-'request_hash';
end $$;

-- Upload and read actions are service-only. The Edge Function verifies the Auth
-- identity and the database independently checks owner/affiliate authorization.
create function elio.affiliate_service(p_action text,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid:=(p_payload->>'user_id')::uuid;p elio.affiliate_payouts;a elio.affiliates;target uuid:=(p_payload->>'id')::uuid;
 val bigint;payment_date date;method text;note_value text;ref_value text;fingerprint text;path text;result jsonb;
begin
 perform elio.require(u is not null and elio.is_verified(u),'Sign in with your verified Elio account.');
 if p_action='affiliate_proof_read' then
  select * into p from elio.affiliate_payouts where id=target;
  perform elio.require(p.id is not null and (elio.role_for(u)='owner' or exists(select 1 from elio.affiliates where id=p.affiliate_id and user_id=u)),'This payout receipt is not available to your account.');
  return jsonb_build_object('path',p.proof_path,'affiliate_id',p.affiliate_id,'id',p.id);
 end if;
 perform elio.assert_staff(u,true);
 perform elio.require(p_action in ('affiliate_authorize_payout','affiliate_commit_payout'),'Unknown payout action.');
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into a from elio.affiliates where id=(p_payload->>'affiliate_id')::uuid for update;
 perform elio.require(a.id is not null and target is not null,'Affiliate and payout IDs are required.');
 fingerprint:=p_payload->>'request_hash';perform elio.require(fingerprint ~ '^[a-f0-9]{64}$','Payout fingerprint is required.');
 select * into p from elio.affiliate_payouts where id=target;
 if found then
  perform elio.require(p.affiliate_id=a.id and p.request_hash=fingerprint,'This payout ID has already been used for different details. Refresh before recording another payment.');
  return jsonb_build_object('recorded',true,'payout',to_jsonb(p)-'request_hash','path',p.proof_path);
 end if;
 val:=(p_payload->>'amount_cents')::bigint;payment_date:=(p_payload->>'paid_on')::date;method:=p_payload->>'payment_method';
 note_value:=btrim(coalesce(p_payload->>'note',''));ref_value:=btrim(coalesce(p_payload->>'reference',''));
 perform elio.require(val between 1 and 999999999 and val<=elio.affiliate_balance(a.id),'The payout must be positive and cannot exceed the available completed-order commission.');
 perform elio.require(payment_date is not null and payment_date<=(clock_timestamp() at time zone 'Asia/Manila')::date,'Enter the date you made the payment, not a future date.');
 perform elio.require(method in ('gcash','cash','bank_transfer','other') and length(note_value)<=2000 and length(ref_value)<=200,'Check the payment method, reference and notes.');
 if p_action='affiliate_authorize_payout' then return jsonb_build_object('allowed',true);end if;
 path:=p_payload->>'path';
 perform elio.require(path ~ ('^'||a.id||'/'||target||'/[0-9a-f-]{36}\.(png|jpg|webp)$'),'Invalid private receipt path.');
 insert into elio.affiliate_payouts(id,affiliate_id,amount_cents,paid_on,payment_method,reference,note,proof_path,request_hash,created_by)
 values(target,a.id,val,payment_date,method,ref_value,note_value,path,fingerprint,u) returning * into p;
 insert into elio.affiliate_audit(target_id,actor,action,after_data) values(p.id,u,'affiliate_record_payout',to_jsonb(p));
 return jsonb_build_object('recorded',true,'payout',to_jsonb(p)-'request_hash','path',p.proof_path);
end $$;

create function elio.affiliate_check_code(p_id uuid,p_at timestamptz) returns void
language plpgsql stable security invoker set search_path='' as $$
declare c elio.affiliate_codes;begin
 select * into c from elio.affiliate_codes where promo_id=p_id;
 if found then
  perform elio.require(exists(select 1 from elio.affiliates where id=c.affiliate_id and active),'This affiliate code is currently inactive.');
  perform elio.require(c.starts_at<=p_at,'This promo code is not valid yet.');
 end if;
end $$;

do $$ declare definition text;hook text;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook:=$old$ if p_action='catalog' then$old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate dispatch hook.');
 definition:=replace(definition,hook,$new$ if p_action like 'affiliate\_%' escape '\' then return elio.affiliate_api(p_action,p_payload);end if;
 if p_action in ('save_promo','delete_promo') then
  perform elio.require(not exists(select 1 from elio.affiliate_codes where promo_id=coalesce(nullif(p_payload->>'id',''),nullif(p_payload#>>'{promo,id}',''))::uuid),'Manage affiliate codes in the Affiliates section.');
 end if;
$new$||hook);execute definition;
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook:=$old$ expired_count:=elio.expire_orders();$old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate service hook.');
 execute replace(definition,hook,$new$ if p_action like 'affiliate\_%' escape '\' then return elio.affiliate_service(p_action,p_payload);end if;
$new$||hook);
 definition:=pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure);
 hook:=$old$   perform elio.require(promo is not null,'Promo code not found.');$old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate promo hook.');
 execute replace(definition,hook,hook||$new$
   perform elio.affiliate_check_code((promo->>'id')::uuid,p_submitted);$new$);
end $$;

-- Actual payouts are accounting expenses once recorded. Estimated or earned but
-- unpaid commission is displayed in Affiliates and is not counted as cash paid.
insert into elio.accounting_categories(name,kind,system_key) values('Affiliate payouts','expense','affiliate_payout');
do $$ declare definition text;hook text;begin
 definition:=pg_get_functiondef('elio.accounting_rows_v2(date,date)'::regprocedure);
 hook:=$old$  and d.cost_date between p_start and p_end and elio.accounting_order_included(o)$old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate accounting hook.');
 execute replace(definition,hook,hook||$new$
 union all
 select p.id,p.paid_on,c.id,p.amount_cents,'Affiliate payout: '||a.name||case when p.reference<>'' then ' · '||p.reference else '' end,'Affiliate payout',null::uuid,null::text,null::integer,'expense',a.name,p.payment_method
 from elio.affiliate_payouts p join elio.affiliates a on a.id=p.affiliate_id
 cross join elio.accounting_categories c where c.system_key='affiliate_payout' and p.status='paid' and p.paid_on between p_start and p_end
$new$);
end $$;

revoke all on function elio.affiliate_sync_order(elio.orders,boolean),elio.affiliate_order_changed(),elio.affiliate_balance(uuid),elio.affiliate_report(uuid,jsonb),elio.affiliate_api(text,jsonb),elio.affiliate_service(text,jsonb),elio.affiliate_check_code(uuid,timestamptz) from public,anon,authenticated,service_role;
commit;
