-- Adapted from BrentChuaTLBK/bakery-website at 7e81baa1a6ef9ae179662aeea7cc238e59e37764.
-- Only ordering/admin migrations are included. No source business data or credentials.

-- Source: 202609130001_ordering.sql
-- Elio draft ordering backend. No demo catalog, owner or banking data seeded.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists elio;
revoke all on schema elio from public, anon, authenticated;

create table elio.secrets (id boolean primary key default true check(id), token_key text not null);
insert into elio.secrets(token_key) values (encode(extensions.gen_random_bytes(48),'hex'));
create table elio.settings (id boolean primary key default true check(id), data jsonb not null);
insert into elio.settings(data) values ('{"shop_name":"Elio Basque Cheesecake","paused":true,"pause_message":"Ordering setup is in progress.","pickup_address":"","contact_email":"","contact_phone":"","payment_instructions":"","delivery_window":"9:00 AM – 6:00 PM","production_weekdays":[0,1,2,3,4,5,6],"nonproduction_dates":[],"fulfillment_weekdays":[0,1,2,3,4,5,6],"blocked_dates":[],"cutoff_time":null,"reminder_time":"08:00","reminders_enabled":false,"owner_email":"","site_url":""}');
create table elio.staff (user_id uuid primary key references auth.users(id), role text not null check(role in ('owner','staff')));
create table elio.categories (id uuid primary key default gen_random_uuid(), data jsonb not null);
create table elio.products (id uuid primary key default gen_random_uuid(), data jsonb not null, updated_at timestamptz not null default now());
create table elio.zones (id uuid primary key default gen_random_uuid(), data jsonb not null);
create table elio.promos (id uuid primary key default gen_random_uuid(), code text not null unique, data jsonb not null);
create table elio.inventory (product_id uuid not null references elio.products(id), date date not null, capacity integer not null check(capacity>=0), available boolean not null default true, primary key(product_id,date));
create table elio.orders (
 id uuid primary key default gen_random_uuid(), reference text not null unique,
 user_id uuid references auth.users(id), access_digest bytea not null unique, access_encrypted bytea not null,
 created_at timestamptz not null default now(), fulfillment_date date not null, method text not null check(method in ('pickup','delivery')),
 payment_status text not null default 'awaiting_payment' check(payment_status in ('awaiting_payment','under_review','paid','rejected')),
 fulfillment_status text not null default 'pending_confirmation' check(fulfillment_status in ('pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery','completed','cancelled','expired')),
 payment_deadline timestamptz not null default now()+interval '60 minutes', proof_path text, payment_reference text,
 paid_amount_cents integer, refund_label boolean not null default false, revision integer not null default 1,
 data jsonb not null, idempotency_key uuid not null unique, request_hash text not null
);
create index orders_owner on elio.orders(user_id,created_at desc);
create index orders_due on elio.orders(fulfillment_date,fulfillment_status);
create table elio.allocations (order_id uuid not null references elio.orders(id), product_id uuid not null references elio.products(id), date date not null, quantity integer not null check(quantity>0), state text not null check(state in ('held','committed','retained')), primary key(order_id,product_id,date));
create index allocations_capacity on elio.allocations(product_id,date);
create table elio.promo_usage (order_id uuid primary key references elio.orders(id), promo_id uuid not null references elio.promos(id), user_id uuid not null references auth.users(id), state text not null check(state in ('reserved','redeemed')));
create index promo_usage_limits on elio.promo_usage(promo_id,user_id);
create table elio.payments (id uuid primary key default gen_random_uuid(), order_id uuid not null unique references elio.orders(id), amount_cents integer not null check(amount_cents>=0), proof_path text not null, payment_reference text not null, approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now());
create table elio.history (id bigint generated always as identity primary key, order_id uuid not null references elio.orders(id), at timestamptz not null default now(), actor text not null, action text not null, reason text, before_data jsonb, after_data jsonb, private boolean not null default false);
create table elio.action_keys (user_id uuid not null, action text not null, key uuid not null, order_id uuid not null references elio.orders(id), request_hash text not null, primary key(user_id,action,key));
create table elio.outbox (
 id uuid primary key default gen_random_uuid(), event_key text not null unique, event_type text not null, order_id uuid not null references elio.orders(id), target_date date,
 to_email text not null, subject text not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','skipped')),
 attempts integer not null default 0, available_at timestamptz not null default now(), lease_token uuid, leased_until timestamptz,
 created_at timestamptz not null default now(), sent_at timestamptz, provider_id text, last_error text
);
create index outbox_ready on elio.outbox(status,available_at);

-- Deny direct reads/writes, even if broad default grants are present in a project.
do $$ declare t record; begin
 for t in select tablename from pg_tables where schemaname='elio' loop
  execute format('alter table elio.%I enable row level security',t.tablename);
  execute format('revoke all on elio.%I from public, anon, authenticated',t.tablename);
 end loop;
end $$;

create function elio.role_for(p_user uuid) returns text language sql stable security definer set search_path='' as $$ select role from elio.staff where user_id=p_user $$;
create function elio.is_verified(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) $$;
create function elio.assert_staff(p_user uuid,p_owner boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(elio.role_for(p_user),'') not in ('owner','staff') or (p_owner and coalesce(elio.role_for(p_user),'')<>'owner') then raise exception 'Authorized % access required',case when p_owner then 'owner' else 'staff' end using errcode='42501'; end if;
end $$;
create function elio.require(p_ok boolean,p_message text) returns void language plpgsql set search_path='' as $$ begin if p_ok is distinct from true then raise exception '%',p_message using errcode='22023'; end if; end $$;
create function elio.order_token(p_order elio.orders) returns text language sql stable security definer set search_path='' as $$ select extensions.pgp_sym_decrypt(p_order.access_encrypted,token_key) from elio.secrets where id $$;
create function elio.can_access(p_order elio.orders,p_user uuid,p_token text) returns boolean language sql stable security definer set search_path='' as $$
 select (p_user is not null and (p_order.user_id=p_user or elio.role_for(p_user) in ('owner','staff'))) or (length(coalesce(p_token,''))>=40 and extensions.digest(p_token,'sha256')=p_order.access_digest)
$$;
create function elio.order_json(p_id uuid,p_private boolean default false,p_token boolean default false) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare o elio.orders; h jsonb;
begin
 select * into strict o from elio.orders where id=p_id;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at',at,'actor',case when p_private then actor else case when actor='system' then 'System' else 'Elio' end end,'action',action,'reason',reason,'before',case when p_private then before_data end,'after',case when p_private then after_data end)) order by id),'[]') into h from elio.history where order_id=p_id and (p_private or not private);
 return o.data || jsonb_build_object('id',o.id,'reference',o.reference,'created_at',o.created_at,'fulfillment_date',o.fulfillment_date,'method',o.method,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,'payment_deadline',o.payment_deadline,'proof_path',case when p_private then o.proof_path else null end,'proof_submitted',o.proof_path is not null,'payment_reference',o.payment_reference,'paid_amount_cents',o.paid_amount_cents,'refund_label',o.refund_label,'revision',o.revision,'history',h) || case when p_token then jsonb_build_object('access_token',elio.order_token(o)) else '{}'::jsonb end;
end $$;
create function elio.audit(p_id uuid,p_actor uuid,p_action text,p_reason text default null,p_before jsonb default null,p_after jsonb default null,p_private boolean default false) returns void language sql security definer set search_path='' as $$
 insert into elio.history(order_id,actor,action,reason,before_data,after_data,private) values(p_id,coalesce(p_actor::text,'system'),p_action,p_reason,p_before,p_after,p_private)
$$;
create function elio.queue_email(p_id uuid,p_event text,p_key text,p_date date default null,p_old jsonb default null) returns void language plpgsql security definer set search_path='' as $$
declare o elio.orders; s jsonb; subject text;
begin
 select * into strict o from elio.orders where id=p_id;
 select data-'owner_email' into s from elio.settings where id;
 subject := case p_event when 'order_submitted' then 'Order received — payment instructions' when 'payment_approved' then 'Payment approved — order confirmed' when 'payment_rejected' then 'Payment rejected — order cancelled' when 'order_cancelled' then 'Order cancelled' when 'order_expired' then 'Payment deadline expired' when 'fulfillment_reminder' then 'Your order is scheduled for today' when 'ready_for_pickup' then 'Your order is ready for pickup' when 'out_for_delivery' then 'Your order is out for delivery' else 'Order update' end;
 insert into elio.outbox(event_key,event_type,order_id,target_date,to_email,subject,payload) values(p_key,p_event,p_id,p_date,o.data#>>'{buyer,email}',subject||' · '||o.reference,jsonb_build_object('event_type',p_event,'order',elio.order_json(p_id,false,true),'settings',s,'old_order',p_old)) on conflict(event_key) do update set status='pending',payload=excluded.payload,to_email=excluded.to_email,available_at=now(),last_error=null where elio.outbox.status='skipped' and elio.outbox.event_type='fulfillment_reminder';
end $$;
create function elio.expire_orders() returns integer language plpgsql security definer set search_path='' as $$
declare o elio.orders; n integer:=0;
begin
 for o in select * from elio.orders where payment_status='awaiting_payment' and fulfillment_status='pending_confirmation' and payment_deadline<=clock_timestamp() for update loop
  update elio.orders set fulfillment_status='expired',revision=revision+1 where id=o.id;
  delete from elio.allocations where order_id=o.id and state='held';
  delete from elio.promo_usage where order_id=o.id and state='reserved';
  perform elio.audit(o.id,null,'expired','No valid payment proof was submitted within 60 minutes.');
  perform elio.queue_email(o.id,'order_expired','expired:'||o.id);
  n:=n+1;
 end loop;
 return n;
end $$;

create function elio.is_production(p_date date,p_settings jsonb) returns boolean language sql immutable set search_path='' as $$
 select (p_settings->'production_weekdays') @> to_jsonb(array[extract(dow from p_date)::integer]) and not ((p_settings->'nonproduction_dates') ? p_date::text)
$$;
create function elio.earliest_lead_date(p_submitted timestamptz,p_days integer,p_settings jsonb) returns date language plpgsql immutable set search_path='' as $$
declare d date:=(p_submitted at time zone 'Asia/Manila')::date+1; needed integer:=p_days; counted integer:=0; i integer;
begin
 if nullif(p_settings->>'cutoff_time','') is not null and (p_submitted at time zone 'Asia/Manila')::time >= (p_settings->>'cutoff_time')::time then needed:=needed+1; end if;
 if needed=0 then return d; end if;
 for i in 1..3660 loop
  if elio.is_production(d,p_settings) then counted:=counted+1; end if;
  d:=d+1;
  if counted>=needed then return d; end if;
 end loop;
 raise exception 'No usable production schedule is configured.';
end $$;
create function elio.date_supported(p_date date,p_method text,p_settings jsonb) returns boolean language sql immutable set search_path='' as $$
 select (p_settings->'fulfillment_weekdays') @> to_jsonb(array[extract(dow from p_date)::integer])
 and not ((p_settings->'blocked_dates') ? p_date::text)
 and not (coalesce(p_settings->(case when p_method='pickup' then 'pickup_blocked_dates' else 'delivery_blocked_dates' end),'[]'::jsonb) ? p_date::text)
$$;
create function elio.capacity_remaining(p_product uuid,p_date date,p_exclude uuid default null) returns integer language sql stable security definer set search_path='' as $$
 select i.capacity-coalesce((select sum(a.quantity)::integer from elio.allocations a where a.product_id=i.product_id and a.date=i.date and (p_exclude is null or a.order_id<>p_exclude)),0) from elio.inventory i where i.product_id=p_product and i.date=p_date
$$;
create function elio.inventory_json() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'date',i.date,'capacity',i.capacity,'available',i.available,'reserved',i.capacity-elio.capacity_remaining(i.product_id,i.date),'remaining',elio.capacity_remaining(i.product_id,i.date)) order by i.date,i.product_id),'[]') from elio.inventory i where date >= (now() at time zone 'Asia/Manila')::date-7
$$;
create function elio.calculate_quote(p_payload jsonb,p_user uuid,p_original uuid default null,p_admin boolean default false,p_submitted timestamptz default clock_timestamp()) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s jsonb; o elio.orders; old_data jsonb; old_item jsonb; item jsonb; p jsonb; g jsonb; c jsonb; sels jsonb; group_sels jsonb; labels jsonb; items jsonb:='[]';
 v_product_id uuid; qty integer; base integer; surcharge bigint; unit bigint; subtotal bigint:=0; delivery integer:=0; discount integer:=0; total bigint;
 selected integer; n integer; choice_key text; group_key text; chosen jsonb; sum_count integer; key_count integer;
 ful date; method text; earliest date; item_earliest date; stock integer; requested integer; existing_qty integer; require_item boolean; same_config boolean;
 promo jsonb; v_promo_id uuid; v_code text; usage_count integer; reserved boolean:=false; changed_date boolean; z record;
begin
 select data into s from elio.settings where id;
 if p_original is not null then select * into strict o from elio.orders where id=p_original; old_data:=o.data; end if;
 ful:=(p_payload->>'fulfillment_date')::date; method:=p_payload->>'method';
 perform elio.require(ful is not null,'Choose a fulfillment date.');
 perform elio.require(method in ('pickup','delivery'),'Choose pickup or delivery.');
 perform elio.require(jsonb_typeof(p_payload->'items')='array' and jsonb_array_length(p_payload->'items') between 1 and 100,'Add between 1 and 100 product configurations to your cart.');
 changed_date:=p_original is null or ful<>o.fulfillment_date or method<>o.method;
 if not p_admin then
  perform elio.require(not coalesce((s->>'paused')::boolean,true),coalesce(nullif(s->>'pause_message',''),'The shop is temporarily paused for new orders.'));
  perform elio.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
 end if;
 if not p_admin or changed_date then perform elio.require(elio.date_supported(ful,method,s),'This fulfillment date is closed to new '||method||' bookings. Choose another date.'); end if;
 earliest:=(p_submitted at time zone 'Asia/Manila')::date+1;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
  v_product_id:=(item->>'product_id')::uuid; qty:=(item->>'quantity')::integer; sels:=coalesce(item->'selections','{}');
  perform elio.require(qty between 1 and 10000 and item->>'quantity'=qty::text,'Product quantities must be whole numbers between 1 and 10000.');
  perform elio.require(jsonb_typeof(sels)='object','Product selections must be an object.');
  select data into p from elio.products where id=v_product_id;
  perform elio.require(p is not null,'A selected product no longer exists.');
  old_item:=null;
  if p_original is not null then select value into old_item from jsonb_array_elements(old_data->'items') where value->>'product_id'=v_product_id::text and coalesce(value->'selections','{}')=sels limit 1; end if;
  same_config:=old_item is not null;
  select coalesce(sum((value->>'quantity')::integer),0)::integer into requested from jsonb_array_elements(p_payload->'items') where value->>'product_id'=v_product_id::text;
  select coalesce(sum(quantity),0)::integer into existing_qty from elio.allocations where order_id=p_original and elio.allocations.product_id=v_product_id and date=ful;
  require_item:=not p_admin or not same_config or changed_date or requested>existing_qty;
  if require_item then
   perform elio.require(coalesce((p->>'active')::boolean,false),'Product unavailable: '||(p->>'name'));
   perform elio.require(requested>=coalesce((p->>'min_quantity')::integer,1),'Minimum quantity for '||(p->>'name')||' is '||coalesce(p->>'min_quantity','1')||'.');
  end if;
  if p_admin and same_config then
   unit:=(old_item->>'unit_price_cents')::integer; labels:=coalesce(old_item->'selection_labels','[]');
  else
   surcharge:=0; labels:='[]';
   for group_key in select jsonb_object_keys(sels) loop
    perform elio.require(exists(select 1 from jsonb_array_elements(coalesce(p->'option_groups','[]')) where value->>'id'=group_key),'Unknown product option group.');
   end loop;
   for g in select value from jsonb_array_elements(coalesce(p->'option_groups','[]')) loop
    group_sels:=coalesce(sels->(g->>'id'),'{}'); sum_count:=0;
    perform elio.require(jsonb_typeof(group_sels)='object','Invalid option choices.');
    for choice_key,chosen in select key,value from jsonb_each(group_sels) loop
     perform elio.require(jsonb_typeof(chosen)='number' and chosen::text ~ '^[0-9]+$','Flavor quantities must be nonnegative whole numbers.');
     n:=chosen::text::integer;
     select value into c from jsonb_array_elements(g->'choices') where value->>'id'=choice_key;
     perform elio.require(c is not null,'Unknown option choice.');
     if n>0 then
      perform elio.require(coalesce((c->>'active')::boolean,true),'Option unavailable: '||(c->>'label'));
      sum_count:=sum_count+n; surcharge:=surcharge+(c->>'surcharge_cents')::integer*n;
      labels:=labels||jsonb_build_array(jsonb_build_object('group',g->>'label','label',c->>'label','quantity',n,'surcharge_cents',(c->>'surcharge_cents')::integer));
     end if;
    end loop;
    perform elio.require(sum_count=(g->>'required_count')::integer,'Choose exactly '||(g->>'required_count')||' for '||(g->>'label')||' in '||(p->>'name')||'.');
   end loop;
   unit:=(p->>'price_cents')::integer+surcharge;
  end if;
  perform elio.require(unit between 0 and 100000000,'Product price is outside the supported range.');
  if not p_admin then
   item_earliest:=elio.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s); earliest:=greatest(earliest,item_earliest);
   perform elio.require(ful>=item_earliest,(p->>'name')||' needs full production days. Earliest lead-time date: '||item_earliest::text||'.');
  end if;
  if require_item then
   perform elio.require(exists(select 1 from elio.inventory i where i.product_id=v_product_id and date=ful and available),'No available quantity is configured for '||(p->>'name')||' on '||ful::text||'.');
   stock:=elio.capacity_remaining(v_product_id,ful,p_original);
   perform elio.require(stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');
  end if;
  subtotal:=subtotal+unit*qty;
  items:=items||jsonb_build_array(jsonb_build_object('product_id',v_product_id,'name',case when p_admin and same_config then old_item->>'name' else p->>'name' end,'quantity',qty,'selections',sels,'selection_labels',labels,'unit_price_cents',unit,'line_total_cents',unit*qty));
 end loop;
 perform elio.require(subtotal<=1000000000,'Order subtotal exceeds the supported amount.');
 if method='delivery' then
  perform elio.require(nullif(trim(p_payload#>>'{address,locality}'),'') is not null,'Select a supported delivery locality.');
  if p_admin and p_original is not null and o.method='delivery' and p_payload#>>'{address,locality}'=o.data#>>'{address,locality}' then
   delivery:=(o.data->>'delivery_cents')::integer;
  else
   select data into z from elio.zones where coalesce((data->>'active')::boolean,false) and (data->'localities') ? (p_payload#>>'{address,locality}') order by id limit 1;
   perform elio.require(z.data is not null,'This delivery locality is outside our supported zones.');
   delivery:=(z.data->>'fee_cents')::integer;
  end if;
 end if;
 if p_admin and p_payload ? 'delivery_cents' then delivery:=(p_payload->>'delivery_cents')::integer; perform elio.require(delivery between 0 and 100000000,'Delivery fee must be a nonnegative PHP amount.'); end if;
 if p_original is not null then
  promo:=old_data->'promo_snapshot';
  if promo='null'::jsonb then promo:=null; end if;
 else
  v_code:=upper(trim(coalesce(p_payload->>'promo_code','')));
  if v_code<>'' then
   perform elio.require(p_user is not null and elio.is_verified(p_user),'Sign in with a verified email address to redeem a promo code. Your cart is preserved.');
   select data||jsonb_build_object('id',id) into promo from elio.promos where elio.promos.code=v_code;
   perform elio.require(promo is not null,'Promo code not found.');
   perform elio.require(coalesce((promo->>'active')::boolean,false),'This promo code is inactive.');
   perform elio.require((promo->>'expires_at')::timestamptz>p_submitted,'This promo code has expired.');
   perform elio.require(subtotal>=(promo->>'min_subtotal_cents')::integer,'This promo requires a product subtotal of PHP '||to_char((promo->>'min_subtotal_cents')::numeric/100,'FM999999990.00')||', excluding delivery.');
   promo:=promo||jsonb_build_object('eligible_at',p_submitted);
  end if;
 end if;
 if promo is not null then
  v_promo_id:=(promo->>'id')::uuid;
  if subtotal>=(promo->>'min_subtotal_cents')::integer then
   if promo->>'kind'='fixed' then discount:=least(subtotal,(promo->>'value')::integer); else discount:=round(subtotal*(promo->>'value')::numeric/100)::integer; if promo->>'cap_cents' is not null then discount:=least(discount,(promo->>'cap_cents')::integer); end if; discount:=least(discount,subtotal); end if;
   if p_original is null or not exists(select 1 from elio.promo_usage where order_id=p_original) then
    select count(*) into usage_count from elio.promo_usage where elio.promo_usage.promo_id=v_promo_id;
    perform elio.require(usage_count<(promo->>'global_limit')::integer,'This promo has reached its total use limit.');
    select count(*) into usage_count from elio.promo_usage where elio.promo_usage.promo_id=v_promo_id and user_id=p_user;
    perform elio.require(usage_count<(promo->>'per_account_limit')::integer,'This account has reached this promo code’s use limit.');
   end if;
  end if;
 end if;
 total:=subtotal-discount+delivery;
 return jsonb_build_object('items',items,'subtotal_cents',subtotal,'discount_cents',discount,'delivery_cents',delivery,'total_cents',total,'promo',promo,'promo_snapshot',promo,'earliest_date',earliest);
end $$;

create function elio.validate_contact(p jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform elio.require(length(trim(coalesce(p#>>'{buyer,name}',''))) between 1 and 200,'Enter the buyer name.');
 perform elio.require(length(trim(coalesce(p#>>'{buyer,phone}',''))) between 5 and 40,'Enter a valid buyer contact number.');
 perform elio.require(length(coalesce(p#>>'{buyer,email}',''))<=254 and coalesce(p#>>'{buyer,email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid buyer email address.');
 if nullif(p#>>'{buyer,social_username}','') is not null then perform elio.require(p#>>'{buyer,social_platform}' in ('Facebook','Instagram','facebook','instagram'),'Choose Facebook or Instagram for the social username.'); end if;
 if p->>'method'='delivery' then
  perform elio.require(length(trim(coalesce(p#>>'{recipient,name}',''))) between 1 and 200,'Enter the delivery recipient name separately.');
  perform elio.require(length(trim(coalesce(p#>>'{recipient,phone}',''))) between 5 and 40,'Enter the delivery recipient contact number.');
  perform elio.require(length(trim(coalesce(p#>>'{address,line1}',''))) between 5 and 1000,'Enter the complete delivery address.');
 end if;
end $$;
create function elio.allocate_order(p_id uuid) returns void language sql security definer set search_path='' as $$
 insert into elio.allocations(order_id,product_id,date,quantity,state)
 select o.id,(v->>'product_id')::uuid,o.fulfillment_date,sum((v->>'quantity')::integer)::integer,case when o.payment_status='paid' then 'committed' else 'held' end
 from elio.orders o cross join lateral jsonb_array_elements(o.data->'items') v where o.id=p_id group by o.id,(v->>'product_id')::uuid,o.fulfillment_date,o.payment_status
$$;
create function elio.sync_promo(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare o elio.orders; promo jsonb;
begin
 select * into strict o from elio.orders where id=p_id; promo:=o.data->'promo_snapshot';
 if o.payment_status='paid' then
  if promo is not null and promo<>'null'::jsonb and (o.data->>'subtotal_cents')::integer>=(promo->>'min_subtotal_cents')::integer then
   insert into elio.promo_usage(order_id,promo_id,user_id,state) values(p_id,(promo->>'id')::uuid,o.user_id,'redeemed') on conflict(order_id) do nothing;
  end if;
  return;
 end if;
 if promo is null or promo='null'::jsonb or (o.data->>'subtotal_cents')::integer<(promo->>'min_subtotal_cents')::integer then delete from elio.promo_usage where order_id=p_id and state='reserved';
 else insert into elio.promo_usage(order_id,promo_id,user_id,state) values(p_id,(promo->>'id')::uuid,o.user_id,'reserved') on conflict(order_id) do nothing; end if;
end $$;
create function public.shop_api(p_action text,p_payload jsonb default '{}'::jsonb,p_token text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); role_name text; s jsonb; result jsonb; row_data jsonb; q jsonb; x jsonb; g jsonb; c jsonb; before_order jsonb; merged jsonb; changes jsonb;
 o elio.orders; oid uuid; rid uuid; token text; v_key uuid; hashed text; existing_action elio.action_keys; next_status text; reason text; v_email text; target_user uuid;
 submitted_at timestamptz; field text; product uuid; day date; cap integer; taken integer; same_ops boolean; n integer; v_role text;
begin
 -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.
 perform pg_advisory_xact_lock(841721950318::bigint);
 perform elio.expire_orders();
 submitted_at:=clock_timestamp();
 perform elio.require(jsonb_typeof(p_payload)='object','Invalid request payload.');
 select data into s from elio.settings where id;
 role_name:=elio.role_for(u);
 if p_action='catalog' then
  select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') into result from elio.products where coalesce((data->>'active')::boolean,false);
  return jsonb_build_object('products',result,'categories',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0)),'[]') from elio.categories),'settings',s-'owner_email','zones',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.zones where coalesce((data->>'active')::boolean,false)),'inventory',elio.inventory_json());
 elsif p_action='quote' then
  return elio.calculate_quote(p_payload,u);
 elsif p_action='create_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid; perform elio.require(v_key is not null,'A unique submission key is required. Refresh checkout and retry.');
  hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text||coalesce(u::text,'guest'),'sha256'),'hex');
  select * into o from elio.orders where idempotency_key=v_key;
  if found then
   perform elio.require(o.request_hash=hashed,'This submission key was already used for a different checkout.');
   return elio.order_json(o.id,false,true);
  end if;
  perform elio.validate_contact(p_payload);
  q:=elio.calculate_quote(p_payload,u,null,false,submitted_at);
  if p_payload ? 'expected_quote' then
   perform elio.require(p_payload->'expected_quote'=jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents'),'Prices or availability changed since review. Review your order again.');
  end if;
  oid:=gen_random_uuid(); token:=encode(extensions.gen_random_bytes(32),'hex');
  row_data:=jsonb_build_object('buyer',p_payload->'buyer','recipient',p_payload->'recipient','address',p_payload->'address','instructions',left(coalesce(p_payload->>'instructions',''),2000),'items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents','promo_snapshot',q->'promo_snapshot','payment_instructions',s->>'payment_instructions','pickup_address',s->>'pickup_address','pickup_hours',s->>'pickup_hours','pickup_instructions',s->>'pickup_instructions','delivery_window',s->>'delivery_window','contact_email',s->>'contact_email','contact_phone',s->>'contact_phone');
  insert into elio.orders(id,reference,user_id,access_digest,access_encrypted,created_at,payment_deadline,fulfillment_date,method,data,idempotency_key,request_hash)
  values(oid,'ELIO-'||to_char(now() at time zone 'Asia/Manila','YYMMDD')||'-'||upper(substr(replace(oid::text,'-',''),1,10)),u,extensions.digest(token,'sha256'),extensions.pgp_sym_encrypt(token,(select token_key from elio.secrets where id)),submitted_at,submitted_at+interval '60 minutes',(p_payload->>'fulfillment_date')::date,p_payload->>'method',row_data,v_key,hashed);
  perform elio.allocate_order(oid); perform elio.sync_promo(oid);
  perform elio.audit(oid,u,'order_submitted'); perform elio.queue_email(oid,'order_submitted','submitted:'||oid);
  return elio.order_json(oid,false,true);
 elsif p_action='get_order' then
  select * into o from elio.orders where id=(p_payload->>'order_id')::uuid;
  if not found or not coalesce(elio.can_access(o,u,p_token),false) then raise exception 'Order access not authorized.' using errcode='42501'; end if;
  return elio.order_json(o.id,role_name in ('owner','staff'),false);
 elsif p_action='my_orders' then
  if u is null then raise exception 'Sign in to view your order history.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(elio.order_json(id,false,false) order by created_at desc),'[]') into result from elio.orders where user_id=u; return result;
 end if;
 perform elio.assert_staff(u,false);
 if p_action='admin_bootstrap' then
  return jsonb_build_object('role',role_name,'products',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.products),'categories',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.categories),'settings',case when role_name='owner' then s else s-'owner_email' end,'zones',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.zones),'inventory',elio.inventory_json(),'promos',case when role_name='owner' then (select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.promos) else '[]'::jsonb end,'orders',(select coalesce(jsonb_agg(elio.order_json(id,true,false) order by created_at desc),'[]') from elio.orders),'email_status',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from (select id,event_type,order_id,status,attempts,last_error,created_at,sent_at from elio.outbox order by created_at desc limit 100) e));
 elsif p_action='save_inventory' then
  perform elio.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
  for x in select value from jsonb_array_elements(p_payload->'rows') loop
   product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
   perform elio.require(cap between 0 and 1000000 and day is not null,'Enter a valid date and nonnegative whole-unit capacity.');
   select coalesce(sum(quantity),0)::integer into taken from elio.allocations where product_id=product and date=day;
   perform elio.require(cap>=taken,'Capacity cannot be below the '||taken||' units already reserved or committed on '||day||'.');
   insert into elio.inventory(product_id,date,capacity,available) values(product,day,cap,coalesce((x->>'available')::boolean,true)) on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
  end loop;
  return elio.inventory_json();
 end if;
 if p_action in ('save_product','save_category','delete_category','save_settings','save_zone','save_promo','list_staff','save_staff') then
  perform elio.assert_staff(u,true);
  if p_action='save_product' then
   row_data:=p_payload->'product'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform elio.require(length(trim(row_data->>'name')) between 1 and 200,'Product name is required.');
   perform elio.require((row_data->>'price_cents')::integer between 0 and 100000000,'Set a valid nonnegative product price.');
   perform elio.require(coalesce((row_data->>'min_quantity')::integer,1) between 1 and 10000,'Minimum quantity must be a positive whole number.');
   perform elio.require(coalesce((row_data->>'lead_days')::integer,0) between 0 and 365,'Lead time must be 0–365 full production days.');
   if row_data->>'category_id' is not null then perform elio.require(exists(select 1 from elio.categories where id=(row_data->>'category_id')::uuid),'Category not found.'); end if;
   perform elio.require(jsonb_typeof(coalesce(row_data->'photos','[]'))='array' and jsonb_array_length(coalesce(row_data->'photos','[]'))<=20,'Use at most 20 product photos.');
   perform elio.require(jsonb_typeof(coalesce(row_data->'option_groups','[]'))='array','Invalid option groups.');
   for g in select value from jsonb_array_elements(coalesce(row_data->'option_groups','[]')) loop
    perform elio.require(nullif(g->>'id','') is not null and nullif(g->>'label','') is not null and (g->>'required_count')::integer between 1 and 1000,'Option groups need IDs, labels and a positive selection count.');
    select count(*) into n from jsonb_array_elements(row_data->'option_groups') where value->>'id'=g->>'id'; perform elio.require(n=1,'Option group IDs must be unique.');
    perform elio.require(jsonb_typeof(g->'choices')='array' and jsonb_array_length(g->'choices')>0,'Add choices to every option group.');
    for c in select value from jsonb_array_elements(g->'choices') loop
     perform elio.require(nullif(c->>'id','') is not null and nullif(c->>'label','') is not null and (c->>'surcharge_cents')::integer between 0 and 100000000,'Choices need IDs, labels and nonnegative surcharges.');
     select count(*) into n from jsonb_array_elements(g->'choices') where value->>'id'=c->>'id'; perform elio.require(n=1,'Choice IDs must be unique within a group.');
    end loop;
   end loop;
   row_data:=jsonb_build_object('description','','category_id',null,'min_quantity',1,'lead_days',0,'active',false,'photos','[]'::jsonb,'option_groups','[]'::jsonb,'sort_order',0)||row_data||jsonb_build_object('id',rid);
   insert into elio.products(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data,updated_at=now(); return row_data;
  elsif p_action='save_category' then
   row_data:=p_payload->'category'; perform elio.require(length(trim(row_data->>'name')) between 1 and 100,'Category name is required.'); rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=row_data||jsonb_build_object('id',rid);
   insert into elio.categories(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data; return row_data;
  elsif p_action='delete_category' then
   rid:=(p_payload->>'id')::uuid; update elio.products set data=jsonb_set(data,'{category_id}','null') where data->>'category_id'=rid::text; delete from elio.categories where id=rid; return jsonb_build_object('deleted',true);
  elsif p_action='save_settings' then
   row_data:=s||coalesce(p_payload->'settings','{}');
   foreach field in array array['production_weekdays','fulfillment_weekdays'] loop
    perform elio.require(jsonb_typeof(row_data->field)='array' and jsonb_array_length(row_data->field)>0,'Configure at least one '||field||' entry.');
    for x in select value from jsonb_array_elements(row_data->field) loop perform elio.require(x::text ~ '^[0-6]$','Weekdays must be integers from 0 (Sunday) to 6 (Saturday).'); end loop;
   end loop;
   foreach field in array array['nonproduction_dates','blocked_dates','pickup_blocked_dates','delivery_blocked_dates'] loop
    if row_data ? field then
     perform elio.require(jsonb_typeof(row_data->field)='array','Date settings must be arrays.');
     for x in select value from jsonb_array_elements(row_data->field) loop day:=(x#>>'{}')::date; end loop;
    end if;
   end loop;
   if nullif(row_data->>'cutoff_time','') is not null then perform (row_data->>'cutoff_time')::time; end if;
   perform (row_data->>'reminder_time')::time;
   if nullif(row_data->>'site_url','') is not null then perform elio.require(row_data->>'site_url' ~ '^https?://[^[:space:]]+$','Site URL must begin with https:// (http:// is allowed for local testing).'); end if;
   if not coalesce((row_data->>'paused')::boolean,true) then
    perform elio.require(nullif(trim(row_data->>'payment_instructions'),'') is not null,'Configure payment instructions before opening orders.');
    perform elio.require(nullif(trim(row_data->>'pickup_address'),'') is not null,'Configure the pickup address before opening orders.');
    perform elio.require(nullif(trim(row_data->>'contact_email'),'') is not null or nullif(trim(row_data->>'contact_phone'),'') is not null,'Configure a business contact email or phone before opening orders.');
    perform elio.require(nullif(trim(row_data->>'site_url'),'') is not null,'Configure the complete test site URL before opening orders so secure email links work.');
   end if;
   update elio.settings set data=row_data where id; return row_data;
  elsif p_action='save_zone' then
   row_data:=p_payload->'zone'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform elio.require(nullif(trim(row_data->>'name'),'') is not null and (row_data->>'fee_cents')::integer between 0 and 100000000,'Delivery zone needs a name and nonnegative fee.');
   perform elio.require(jsonb_typeof(row_data->'localities')='array' and jsonb_array_length(row_data->'localities')>0,'Add covered localities.');
   if coalesce((row_data->>'active')::boolean,true) then
    perform elio.require(not exists(select 1 from elio.zones z cross join lateral jsonb_array_elements_text(z.data->'localities') a where z.id<>rid and coalesce((z.data->>'active')::boolean,false) and (row_data->'localities') ? a),'A locality already belongs to another active delivery zone.');
   end if;
   row_data:=jsonb_build_object('active',true)||row_data||jsonb_build_object('id',rid); insert into elio.zones(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data; return row_data;
  elsif p_action='save_promo' then
   row_data:=p_payload->'promo'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));
   perform elio.require(row_data->>'code' ~ '^[A-Z0-9_-]{1,50}$','Promo code must contain 1–50 letters, digits, underscores or hyphens.');
   perform elio.require(row_data->>'kind' in ('percent','fixed'),'Choose a percentage or fixed promo.');
   perform elio.require((row_data->>'value')::integer>0 and ((row_data->>'kind')<>'percent' or (row_data->>'value')::integer<=100),'Enter a positive discount (percentage at most 100).');
   perform elio.require((row_data->>'min_subtotal_cents')::integer>=0 and (row_data->>'cap_cents' is null or (row_data->>'cap_cents')::integer>=0),'Promo minimum and cap cannot be negative.');
   perform elio.require((row_data->>'per_account_limit')::integer>0 and (row_data->>'global_limit')::integer>0,'Promo use limits must be positive whole numbers.');
   perform elio.require(row_data->>'expires_at' is not null,'Promo expiry is required.'); perform (row_data->>'expires_at')::timestamptz;
   insert into elio.promos(id,code,data) values(rid,row_data->>'code',row_data) on conflict(id) do update set code=excluded.code,data=excluded.data; return row_data;
  elsif p_action='list_staff' then
   select coalesce(jsonb_agg(jsonb_build_object('user_id',t.user_id,'email',a.email,'role',t.role)),'[]') into result from elio.staff t join auth.users a on a.id=t.user_id; return result;
  elsif p_action='save_staff' then
   v_email:=lower(trim(p_payload->>'email')); v_role:=p_payload->>'role';
   perform elio.require(v_role in ('owner','staff','none'),'Choose owner, staff, or none.');
   select id into target_user from auth.users where lower(email)=v_email and email_confirmed_at is not null;
   perform elio.require(target_user is not null,'The staff member must first register and verify their email.');
   if elio.role_for(target_user)='owner' and v_role<>'owner' then perform elio.require((select count(*) from elio.staff where role='owner')>1,'The final owner cannot be removed or demoted.'); end if;
   if v_role='none' then delete from elio.staff where user_id=target_user; else insert into elio.staff(user_id,role) values(target_user,v_role) on conflict(user_id) do update set role=excluded.role; end if;
   return jsonb_build_object('user_id',target_user,'email',v_email,'role',v_role);
  end if;
 end if;
 -- Remaining actions operate on one existing order and use a revision plus retry key.
 perform elio.require(p_action in ('approve_payment','reject_payment','set_fulfillment','cancel_order','set_refund_label','edit_order','preview_edit_order','add_staff_note'),'Unknown ordering action.');
 oid:=(p_payload->>'order_id')::uuid; select * into o from elio.orders where id=oid for update; perform elio.require(found,'Order not found.');
 if p_action<>'preview_edit_order' then
  v_key:=(p_payload->>'idempotency_key')::uuid; perform elio.require(v_key is not null,'A unique action key is required.');
  hashed:=encode(extensions.digest((p_payload-'revision')::text,'sha256'),'hex');
  select * into existing_action from elio.action_keys where user_id=u and action=p_action and elio.action_keys.key=v_key;
  if found then perform elio.require(existing_action.order_id=oid and existing_action.request_hash=hashed,'This action key was already used for a different request.'); return elio.order_json(oid,true,false); end if;
 end if;
 perform elio.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh it and review the latest version before saving.');
 before_order:=elio.order_json(oid,true,false)-'history'; reason:=nullif(trim(p_payload->>'reason'),'');
 if p_action='approve_payment' then
  perform elio.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation','Only an active payment under review can be approved.');
  insert into elio.payments(order_id,amount_cents,proof_path,payment_reference,approved_by) values(oid,(o.data->>'total_cents')::integer,o.proof_path,o.payment_reference,u);
  update elio.orders set payment_status='paid',fulfillment_status='confirmed',paid_amount_cents=(data->>'total_cents')::integer,revision=revision+1 where id=oid;
  update elio.allocations set state='committed' where order_id=oid and state='held';
  update elio.promo_usage set state='redeemed' where order_id=oid and state='reserved';
 elsif p_action='reject_payment' then
  perform elio.require(reason is not null,'A payment rejection reason is required.');
  perform elio.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation','Only an active payment under review can be rejected.');
  update elio.orders set payment_status='rejected',fulfillment_status='cancelled',revision=revision+1 where id=oid;
  delete from elio.allocations where order_id=oid and state='held'; delete from elio.promo_usage where order_id=oid and state='reserved';
 elsif p_action='set_fulfillment' then
  next_status:=p_payload->>'status';
  perform elio.require(o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed'),'Only a paid active order can progress through fulfillment.');
  perform elio.require(next_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed'),'Choose a supported fulfillment progress status.');
  perform elio.require(next_status<>'ready_for_pickup' or o.method='pickup','Ready for pickup applies to pickup orders only.');
  perform elio.require(next_status<>'out_for_delivery' or o.method='delivery','Out for delivery applies to delivery orders only.');
  update elio.orders set fulfillment_status=next_status,revision=revision+1 where id=oid;
 elsif p_action='cancel_order' then
  perform elio.require(reason is not null,'A cancellation reason is required.');
  perform elio.require(o.fulfillment_status not in ('cancelled','expired','completed'),'This order is already closed or completed.');
  if o.payment_status='paid' then perform elio.require(p_payload ? 'restore_stock','Explicitly decide whether produced/committed units can be restored.'); end if;
  update elio.orders set fulfillment_status='cancelled',revision=revision+1 where id=oid;
  if o.payment_status<>'paid' or (p_payload->>'restore_stock')::boolean then delete from elio.allocations where order_id=oid; else update elio.allocations set state='retained' where order_id=oid; end if;
  delete from elio.promo_usage where order_id=oid and state='reserved';
 elsif p_action='set_refund_label' then
  perform elio.require(p_payload ? 'enabled','Choose whether the Refund label is enabled.');
  update elio.orders set refund_label=(p_payload->>'enabled')::boolean,revision=revision+1 where id=oid;
 elsif p_action='add_staff_note' then
  perform elio.require(length(trim(coalesce(p_payload->>'note',''))) between 1 and 5000,'Enter a private staff note (maximum 5000 characters).');
  update elio.orders set revision=revision+1 where id=oid;
  perform elio.audit(oid,u,'staff_note',p_payload->>'note',null,null,true);
 elsif p_action in ('edit_order','preview_edit_order') then
  if p_action='edit_order' then perform elio.require(reason is not null,'An amendment reason is required.'); end if;
  changes:=coalesce(p_payload->'changes','{}'); perform elio.require(jsonb_typeof(changes)='object','Invalid order changes.');
  for field in select jsonb_object_keys(changes) loop perform elio.require(field in ('items','fulfillment_date','method','buyer','recipient','address','instructions','delivery_cents'),'Unsupported order edit field: '||field); end loop;
  merged:=o.data||jsonb_build_object('fulfillment_date',o.fulfillment_date,'method',o.method)||changes;
  foreach field in array array['buyer','recipient','address'] loop
   if jsonb_typeof(changes->field)='object' then merged:=jsonb_set(merged,array[field],(case when jsonb_typeof(o.data->field)='object' then o.data->field else '{}'::jsonb end)||(changes->field)); end if;
  end loop;
  perform elio.validate_contact(merged);
  same_ops:=not (changes ?| array['items','fulfillment_date','method','address','delivery_cents']);
  perform elio.require(same_ops or o.fulfillment_status not in ('cancelled','expired','completed'),'Closed or completed orders allow contact corrections and notes; their products, date, method and amounts cannot be amended.');
  if not same_ops then
   if (changes ? 'method' or changes ? 'address') and not (changes ? 'delivery_cents') then merged:=merged-'delivery_cents'; end if;
   q:=elio.calculate_quote(merged,o.user_id,oid,true);
   merged:=merged||jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents','promo_snapshot',q->'promo_snapshot');
  end if;
  if p_action='preview_edit_order' then return before_order||merged||jsonb_build_object('preview',true); end if;
  if p_payload ? 'expected_quote' then
   perform elio.require(p_payload->'expected_quote'=jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents'),'Prices changed since the amendment preview. Preview the changes again before saving.');
  end if;
  update elio.orders set data=merged-'fulfillment_date'-'method',fulfillment_date=(merged->>'fulfillment_date')::date,method=merged->>'method',revision=revision+1 where id=oid;
  if not same_ops then delete from elio.allocations where order_id=oid; perform elio.allocate_order(oid); perform elio.sync_promo(oid); end if;
 end if;
 if p_action<>'add_staff_note' then perform elio.audit(oid,u,p_action,reason,before_order,elio.order_json(oid,true,false)-'history'); end if;
 insert into elio.action_keys(user_id,action,key,order_id,request_hash) values(u,p_action,v_key,oid,hashed);
 if p_action='approve_payment' then perform elio.queue_email(oid,'payment_approved','approved:'||oid);
 elsif p_action='reject_payment' then perform elio.queue_email(oid,'payment_rejected','rejected:'||oid);
 elsif p_action='cancel_order' then perform elio.queue_email(oid,'order_cancelled','cancelled:'||oid);
 elsif p_action='set_fulfillment' and next_status in ('ready_for_pickup','out_for_delivery') and next_status<>o.fulfillment_status then perform elio.queue_email(oid,next_status,next_status||':'||oid||':'||(o.revision+1));
 end if;
 return elio.order_json(oid,true,false);
end $$;

alter table elio.outbox add column first_attempt_at timestamptz;
update elio.settings set data=data||'{"pickup_hours":"","pickup_instructions":"","pickup_blocked_dates":[],"delivery_blocked_dates":[]}'::jsonb where id;

create function public.shop_service(p_action text,p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 o elio.orders; u uuid:=(p_payload->>'user_id')::uuid; oid uuid:=(p_payload->>'order_id')::uuid; token text:=p_payload->>'token';
 e elio.outbox; row_data jsonb; result jsonb:='[]'; s jsonb; local_now timestamp:=now() at time zone 'Asia/Manila';
 n integer:=0; expired_count integer:=0; v_limit integer; lease uuid; good boolean; v_path text;
begin
 perform pg_advisory_xact_lock(841721950318::bigint);
 expired_count:=elio.expire_orders();
 select data into s from elio.settings where id;
 if p_action in ('authorize_upload','commit_proof','authorize_proof_read') then
  if p_action='authorize_upload' and p_payload->>'kind'='product' then perform elio.assert_staff(u,true); return jsonb_build_object('allowed',true); end if;
  select * into o from elio.orders where id=oid for update;
  if p_action='authorize_proof_read' then
   perform elio.assert_staff(u,false); perform elio.require(o.id is not null and o.proof_path is not null,'No payment proof is available for this order.'); return jsonb_build_object('path',o.proof_path);
  end if;
  if o.id is null or not coalesce(elio.can_access(o,u,token),false) then raise exception 'Order access not authorized.' using errcode='42501'; end if;
  perform elio.require(o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation' and clock_timestamp()<o.payment_deadline,'Payment proof is no longer accepted for this order. Place a new order or contact us directly if payment was already sent.');
  if p_action='authorize_upload' then perform elio.require(p_payload->>'kind'='proof','Choose proof or product upload.'); return jsonb_build_object('allowed',true,'order_id',oid); end if;
  v_path:=p_payload->>'path';
  perform elio.require(v_path ~ ('^'||oid::text||'/[a-f0-9-]{36}\.(png|jpg|jpeg|webp)$'),'Invalid private proof storage path.');
  perform elio.require(length(trim(coalesce(p_payload->>'payment_reference',''))) between 1 and 200,'Enter a payment reference (maximum 200 characters).');
  update elio.orders set proof_path=v_path,payment_reference=trim(p_payload->>'payment_reference'),payment_status='under_review',revision=revision+1 where id=oid;
  perform elio.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');
  return elio.order_json(oid,false,false);
 elsif p_action='maintenance' then
  if coalesce((s->>'reminders_enabled')::boolean,false) and local_now::time>=(s->>'reminder_time')::time then
   for o in select * from elio.orders where fulfillment_date=local_now::date and payment_status='paid' and fulfillment_status not in ('cancelled','expired','completed') loop
    perform elio.queue_email(o.id,'fulfillment_reminder','reminder:'||o.id||':'||o.fulfillment_date,o.fulfillment_date); n:=n+1;
   end loop;
  end if;
  return jsonb_build_object('expired',expired_count,'reminders_considered',n);
 elsif p_action='claim_emails' then
  v_limit:=least(greatest(coalesce((p_payload->>'limit')::integer,3),1),10);
  -- Never retry a delivery with an unknown outcome beyond the provider's 24-hour idempotency window.
  update elio.outbox set status='failed',last_error='Delivery outcome requires staff review: idempotency window elapsed.',lease_token=null,leased_until=null where status in ('pending','sending') and first_attempt_at<now()-interval '23 hours' and (leased_until is null or leased_until<now());
  for e in select * from elio.outbox where ((status='pending' and available_at<=now()) or (status='sending' and leased_until<=now())) and attempts<8 order by created_at for update skip locked limit v_limit loop
   if e.event_type='fulfillment_reminder' then
    select * into o from elio.orders where id=e.order_id;
    good:=coalesce((s->>'reminders_enabled')::boolean,false) and o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed') and o.fulfillment_date=e.target_date and e.target_date=local_now::date;
    if not good then update elio.outbox set status='skipped',last_error='Reminder no longer matches an active paid order date.' where id=e.id; continue; end if;
   end if;
   lease:=gen_random_uuid();
   update elio.outbox set status='sending',attempts=attempts+1,lease_token=lease,leased_until=now()+interval '3 minutes',first_attempt_at=coalesce(first_attempt_at,now()) where id=e.id returning * into e;
   result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at));
  end loop;
  return result;
 elsif p_action in ('prepare_email','email_sent','email_failed') then
  select * into e from elio.outbox where id=(p_payload->>'id')::uuid and lease_token=(p_payload->>'lease_token')::uuid and status='sending' for update;
  perform elio.require(found and e.leased_until>now(),'Email claim is stale; another worker owns this message.');
  if p_action='prepare_email' then
   if e.event_type='fulfillment_reminder' then
    select * into o from elio.orders where id=e.order_id;
    good:=coalesce((s->>'reminders_enabled')::boolean,false) and o.payment_status='paid' and o.fulfillment_status not in ('cancelled','expired','completed') and o.fulfillment_date=e.target_date and e.target_date=local_now::date;
    if not good then update elio.outbox set status='skipped',last_error='Reminder invalidated by order change.',lease_token=null,leased_until=null where id=e.id; return jsonb_build_object('skip',true); end if;
    update elio.outbox set payload=jsonb_build_object('event_type',e.event_type,'order',elio.order_json(e.order_id,false,true),'settings',s-'owner_email'),to_email=o.data#>>'{buyer,email}' where id=e.id returning * into e;
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);
  elsif p_action='email_sent' then
   update elio.outbox set status='sent',sent_at=now(),provider_id=p_payload->>'provider_id',lease_token=null,leased_until=null,last_error=null where id=e.id;
   return jsonb_build_object('sent',true);
  else
   update elio.outbox set status=case when coalesce((p_payload->>'terminal')::boolean,false) or attempts>=8 then 'failed' else 'pending' end,available_at=now()+make_interval(secs=>least(3600,(power(2,attempts)*30)::integer)),last_error=left(coalesce(p_payload->>'error','Email delivery failed.'),2000),lease_token=null,leased_until=null where id=e.id;
   return jsonb_build_object('recorded',true);
  end if;
 end if;
 raise exception 'Unknown service action.' using errcode='22023';
end $$;

-- All implementation helpers and tables are private; only the two dispatch RPCs are exposed.
revoke all on all functions in schema elio from public, anon, authenticated;
revoke all on function public.shop_api(text,jsonb,text) from public;
grant execute on function public.shop_api(text,jsonb,text) to anon, authenticated;
revoke all on function public.shop_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.shop_service(text,jsonb) to service_role;
alter default privileges in schema elio revoke all on tables from public, anon, authenticated;
alter default privileges in schema elio revoke execute on functions from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('payment-proofs','payment-proofs',false,5242880,array['image/png','image/jpeg','image/webp']),
 ('product-images','product-images',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No browser INSERT/UPDATE/SELECT proof policies: Edge Functions use the service role only after SQL authorization.


-- Source: 20260914220730_validate_contact_phone.sql
-- Validate phone formatting for new orders and staff contact corrections.
-- Existing order data is preserved. The public API still calls the same
-- private validate_contact(jsonb) function for both create_order and edit_order.
create or replace function elio.valid_contact_phone(value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select length(phone) <= 40
    and regexp_replace(phone, '^[+]', '') !~ '[^0-9 ()-]'
    and length(regexp_replace(phone, '[^0-9]', '', 'g')) between 7 and 15
  from (select btrim(coalesce(value, '')) as phone) normalized;
$$;

revoke all on function elio.valid_contact_phone(text) from public, anon, authenticated;

create or replace function elio.validate_contact(p jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform elio.require(length(trim(coalesce(p#>>'{buyer,name}',''))) between 1 and 200,'Enter the buyer name.');
  perform elio.require(elio.valid_contact_phone(p#>>'{buyer,phone}'),'Enter a valid buyer contact number using 7–15 digits. You may include a leading +, spaces, hyphens and parentheses.');
  perform elio.require(length(coalesce(p#>>'{buyer,email}',''))<=254 and coalesce(p#>>'{buyer,email}','') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$','Enter a valid buyer email address.');
  if nullif(p#>>'{buyer,social_username}','') is not null then
    perform elio.require(p#>>'{buyer,social_platform}' in ('Facebook','Instagram','facebook','instagram'),'Choose Facebook or Instagram for the social username.');
  end if;
  if p->>'method'='delivery' then
    perform elio.require(length(trim(coalesce(p#>>'{recipient,name}',''))) between 1 and 200,'Enter the delivery recipient name separately.');
    perform elio.require(elio.valid_contact_phone(p#>>'{recipient,phone}'),'Enter a valid delivery recipient contact number using 7–15 digits. You may include a leading +, spaces, hyphens and parentheses.');
    perform elio.require(length(trim(coalesce(p#>>'{address,line1}',''))) between 5 and 1000,'Enter the complete delivery address.');
  end if;
end;
$$;

revoke all on function elio.validate_contact(jsonb) from public, anon, authenticated;



-- Source: 20260914221623_payment_proof_window_15_minutes.sql
-- New orders have 15 minutes to submit their first valid payment proof.
-- Already-issued deadlines, timely proofs under review, paid orders and the
-- existing stock/expiry transaction are deliberately left unchanged.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := 'submitted_at,submitted_at+interval ''60 minutes'',';
  new_value text := 'submitted_at,submitted_at+interval ''15 minutes'',';
begin
  -- Keep the complete live API, its ownership, grants and validation. Abort
  -- instead of silently changing a different path if this insertion changes.
  if length(definition) - length(replace(definition, old_value, '')) = length(old_value) then
    execute replace(definition, old_value, new_value);
  elsif position(old_value in definition) = 0
    and length(definition) - length(replace(definition, new_value, '')) = length(new_value) then
    null; -- Safe to replay; do not recalculate any existing order deadline.
  else
    raise exception 'Unexpected create_order payment deadline expression; review public.shop_api before applying this migration.';
  end if;
end;
$migration$;

alter table elio.orders alter column payment_deadline set default now() + interval '15 minutes';

-- The actual saved deadline remains authoritative, including for older orders.
-- Successful shop API calls already run this inside the shared advisory lock
-- before reading or reserving stock, so checkout need not wait for cron.
create or replace function elio.expire_orders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare o elio.orders; n integer := 0;
begin
  for o in select * from elio.orders
    where payment_status = 'awaiting_payment'
      and fulfillment_status = 'pending_confirmation'
      and payment_deadline <= clock_timestamp()
    for update
  loop
    update elio.orders set fulfillment_status = 'expired', revision = revision + 1 where id = o.id;
    delete from elio.allocations where order_id = o.id and state = 'held';
    delete from elio.promo_usage where order_id = o.id and state = 'reserved';
    perform elio.audit(o.id, null, 'expired', 'No valid payment proof was submitted before the payment deadline.');
    perform elio.queue_email(o.id, 'order_expired', 'expired:' || o.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;



-- Source: 20260915151235_delivery_options.sql
-- Delivery restrictions and zone details for future bookings.
-- Existing orders, deadlines, fees and snapshots are not rewritten. Legacy
-- products without pickup_only and zones without description retain defaults.
-- Existing date_supported already enforces delivery_blocked_dates independently
-- of pickup and global blocked_dates; no settings values are changed here.
-- Guarded edits preserve the complete current API, grants and stock locking,
-- including the 15-minute payment deadline and contact validation migration.
-- For an existing delivery order, the same product/date/quantity may be retained
-- after marking that product pickup only, just as inactive products are retained.
-- New allocations and changes of date or method must satisfy the new restriction.
-- Reapplying is a no-op; every guarded replacement must match before execution.

do $migration$
declare
  definition text := pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)'::regprocedure);
  patch record;
begin
  if position('TLB_DELIVERY_OPTIONS_V1' in definition)=0 then
    for patch in select * from (values
    ($old$declare
 s jsonb; o elio.orders;$old$,$new$declare
 -- TLB_DELIVERY_OPTIONS_V1
 delivery_zone_name text := ''; delivery_zone_description text := '';
 s jsonb; o elio.orders;$new$,1),
    ($old$  if require_item then
   perform elio.require(coalesce((p->>'active')::boolean,false)$old$,$new$  if require_item then
   perform elio.require(method<>'delivery' or not coalesce((p->>'pickup_only')::boolean,false),(p->>'name')||' is pickup only. Choose pickup or remove this product to use delivery.');
   perform elio.require(coalesce((p->>'active')::boolean,false)$new$,1),
    ($old$   delivery:=(o.data->>'delivery_cents')::integer;$old$,$new$   delivery:=(o.data->>'delivery_cents')::integer;
   delivery_zone_name:=coalesce(o.data->>'delivery_zone_name','');
   delivery_zone_description:=coalesce(o.data->>'delivery_zone_description','');$new$,1),
    ($old$   delivery:=(z.data->>'fee_cents')::integer;$old$,$new$   delivery:=(z.data->>'fee_cents')::integer;
   delivery_zone_name:=coalesce(z.data->>'name','');
   delivery_zone_description:=coalesce(z.data->>'description','');$new$,1),
    ($old$'earliest_date',earliest);$old$,$new$'earliest_date',earliest,'delivery_zone_name',delivery_zone_name,'delivery_zone_description',delivery_zone_description);$new$,1)
    ) as patches(old_value,new_value,expected_count)
    loop
      -- Dashboard-installed SQL may retain CRLF line endings. Match those
      -- exact anchors without rewriting unrelated function text.
      if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
        patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
        patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
      end if;
      if length(definition)-length(replace(definition,patch.old_value,'')) <> length(patch.old_value)*patch.expected_count then
        raise exception 'Unexpected function definition in % delivery migration; review before applying.', 'elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)';
      end if;
      definition:=replace(definition,patch.old_value,patch.new_value);
    end loop;
    execute definition;
  end if;
end;
$migration$;

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  patch record;
begin
  if position('TLB_DELIVERY_OPTIONS_V1' in definition)=0 then
    for patch in select * from (values
    ($old$ -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.$old$,$new$ -- TLB_DELIVERY_OPTIONS_V1
 -- One transaction-wide lock keeps low-volume bakery capacity, promo and edit operations serializable.$new$,1),
    ($old$'promo_snapshot',q->'promo_snapshot'$old$,$new$'promo_snapshot',q->'promo_snapshot','delivery_zone_name',q->'delivery_zone_name','delivery_zone_description',q->'delivery_zone_description'$new$,2),
    ($old$   row_data:=p_payload->'product'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$old$,$new$   row_data:=p_payload->'product';
   perform elio.require(not (row_data ? 'pickup_only') or jsonb_typeof(row_data->'pickup_only')='boolean','Pickup only must be enabled or disabled.');
   rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$new$,1),
    ($old$jsonb_build_object('description','','category_id',null,'min_quantity',1$old$,$new$jsonb_build_object('pickup_only',false,'description','','category_id',null,'min_quantity',1$new$,1),
    ($old$   row_data:=p_payload->'zone'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$old$,$new$   row_data:=p_payload->'zone';
   perform elio.require(not (row_data ? 'description') or (jsonb_typeof(row_data->'description')='string' and length(row_data->>'description')<=2000),'Delivery zone description must be text with at most 2000 characters.');
   rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());$new$,1),
    ($old$   row_data:=jsonb_build_object('active',true)||row_data||jsonb_build_object('id',rid); insert into elio.zones$old$,$new$   row_data:=jsonb_build_object('active',true,'description','')||row_data||jsonb_build_object('id',rid); insert into elio.zones$new$,1),
    ($old$jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents')$old$,$new$(jsonb_build_object('items',q->'items','subtotal_cents',q->'subtotal_cents','discount_cents',q->'discount_cents','delivery_cents',q->'delivery_cents','total_cents',q->'total_cents')
    || case when (p_payload->'expected_quote') ? 'delivery_zone_name' then jsonb_build_object('delivery_zone_name',q->'delivery_zone_name') else '{}'::jsonb end
    || case when (p_payload->'expected_quote') ? 'delivery_zone_description' then jsonb_build_object('delivery_zone_description',q->'delivery_zone_description') else '{}'::jsonb end)$new$,1),
    ($old$jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents')$old$,$new$(jsonb_build_object('items',merged->'items','subtotal_cents',merged->'subtotal_cents','discount_cents',merged->'discount_cents','delivery_cents',merged->'delivery_cents','total_cents',merged->'total_cents')
    || case when (p_payload->'expected_quote') ? 'delivery_zone_name' then jsonb_build_object('delivery_zone_name',merged->'delivery_zone_name') else '{}'::jsonb end
    || case when (p_payload->'expected_quote') ? 'delivery_zone_description' then jsonb_build_object('delivery_zone_description',merged->'delivery_zone_description') else '{}'::jsonb end)$new$,1)
    ) as patches(old_value,new_value,expected_count)
    loop
      -- Dashboard-installed SQL may retain CRLF line endings. Match those
      -- exact anchors without rewriting unrelated function text.
      if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
        patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
        patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
      end if;
      if length(definition)-length(replace(definition,patch.old_value,'')) <> length(patch.old_value)*patch.expected_count then
        raise exception 'Unexpected function definition in % delivery migration; review before applying.', 'public.shop_api(text,jsonb,text)';
      end if;
      definition:=replace(definition,patch.old_value,patch.new_value);
    end loop;
    execute definition;
  end if;
end;
$migration$;



-- Source: 20260915153120_customer_booking_calendar_window.sql
-- Customer bookings use the current Manila calendar month plus the next two
-- months, through the final day of that second following month. The existing
-- no-same-day rule still applies. Staff amendments and existing order records,
-- allocations, payments, deadlines and queued emails are not changed.
-- Add only the guard to the installed quote function so all existing delivery,
-- stock, permission and pricing behavior remains intact. Reapplying is a no-op.

do $migration$
declare
  definition text := pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)'::regprocedure);
  old_value text := $old$  perform elio.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
 end if;$old$;
  new_value text := $new$  perform elio.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');
  -- TLB_CUSTOMER_BOOKING_CALENDAR_V1
  perform elio.require(ful<=(date_trunc('month',p_submitted at time zone 'Asia/Manila')+interval '3 months - 1 day')::date,'Choose a date within the current month or the next two months.');
 end if;$new$;
begin
  if position('TLB_CUSTOMER_BOOKING_CALENDAR_V1' in definition)=0 then
    -- Dashboard-installed SQL may use CRLF. Preserve its original line endings.
    if position(old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
      old_value:=replace(old_value,chr(10),chr(13)||chr(10));
      new_value:=replace(new_value,chr(10),chr(13)||chr(10));
    end if;
    if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
      raise exception 'Unexpected quote definition in customer booking calendar migration; review before applying.';
    end if;
    execute replace(definition,old_value,new_value);
  end if;
end;
$migration$;



-- Source: 20260915161342_product_same_day_orders.sql
-- Same-day ordering is an explicit product option, valid only with zero full
-- production days. The shop's existing Manila cutoff applies: before cutoff
-- (or with none configured) today is eligible; at/after cutoff tomorrow is the
-- earliest eligible date. Non-opted-in products retain their production rules.
-- No products, settings, orders, allocations, payments or emails are changed.
-- Existing staff amendment behavior and customer booking horizon are retained.
-- Guarded replacements support LF/CRLF, fail on unexpected source, and replay
-- without changing already-installed functions or their existing privileges.

do $migration$
declare
  signature text;
  definition text;
  patch record;
begin
  foreach signature in array array[
    'elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
    'public.shop_api(text,jsonb,text)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position('TLB_PRODUCT_SAME_DAY_V1' in definition)=0 then
      for patch in select * from (values
        ('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$  perform elio.require(ful>(p_submitted at time zone 'Asia/Manila')::date,'Same-day fulfillment is not available. Choose a future date.');$old$,
         $new$  -- TLB_PRODUCT_SAME_DAY_V1
  perform elio.require(ful>=(p_submitted at time zone 'Asia/Manila')::date,'Past fulfillment dates are not available. Choose today or a future date.');$new$),
        ('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$ earliest:=(p_submitted at time zone 'Asia/Manila')::date+1;$old$,
         $new$ earliest:=(p_submitted at time zone 'Asia/Manila')::date+case when p_admin then 1 else 0 end;$new$),
        ('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
         $old$   item_earliest:=elio.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s); earliest:=greatest(earliest,item_earliest);$old$,
         $new$   if ful=(p_submitted at time zone 'Asia/Manila')::date then
    perform elio.require(coalesce(p->'allow_same_day'='true'::jsonb,false) and coalesce((p->>'lead_days')::integer,0)=0,(p->>'name')||' is not available for same-day orders. Choose a future date.');
    perform elio.require(nullif(s->>'cutoff_time','') is null or (p_submitted at time zone 'Asia/Manila')::time<(s->>'cutoff_time')::time,'The same-day order cutoff has passed. Choose tomorrow or another available date.');
   end if;
   if coalesce(p->'allow_same_day'='true'::jsonb,false) and coalesce((p->>'lead_days')::integer,0)=0 then
    item_earliest:=(p_submitted at time zone 'Asia/Manila')::date;
    if nullif(s->>'cutoff_time','') is not null and (p_submitted at time zone 'Asia/Manila')::time>=(s->>'cutoff_time')::time then item_earliest:=item_earliest+1; end if;
   else
    item_earliest:=elio.earliest_lead_date(p_submitted,coalesce((p->>'lead_days')::integer,0),s);
   end if;
   earliest:=greatest(earliest,item_earliest);$new$),
        ('public.shop_api(text,jsonb,text)',
         $old$   row_data:=p_payload->'product';$old$,
         $new$   -- TLB_PRODUCT_SAME_DAY_V1
   row_data:=p_payload->'product';
   perform elio.require(not (row_data ? 'allow_same_day') or jsonb_typeof(row_data->'allow_same_day')='boolean','Same-day ordering must be enabled or disabled.');
   perform elio.require(not coalesce((row_data->>'allow_same_day')::boolean,false) or coalesce((row_data->>'lead_days')::integer,0)=0,'Same-day products must have 0 full production days.');$new$),
        ('public.shop_api(text,jsonb,text)',
         $old$jsonb_build_object('pickup_only',false,'description','','category_id',null,'min_quantity',1$old$,
         $new$jsonb_build_object('allow_same_day',false,'pickup_only',false,'description','','category_id',null,'min_quantity',1$new$)
      ) as patches(function_signature,old_value,new_value)
      where function_signature=signature
      loop
        if position(patch.old_value in definition)=0 and position(chr(13)||chr(10) in definition)>0 then
          patch.old_value:=replace(patch.old_value,chr(10),chr(13)||chr(10));
          patch.new_value:=replace(patch.new_value,chr(10),chr(13)||chr(10));
        end if;
        if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
          raise exception 'Unexpected function definition in % same-day migration; review before applying.',signature;
        end if;
        definition:=replace(definition,patch.old_value,patch.new_value);
      end loop;
      execute definition;
    end if;
  end loop;
end;
$migration$;



-- Source: 20260917182432_website_analytics_access.sql
-- The reporting Edge Function supplies a remotely verified auth user ID.
-- This action remains behind the existing service-role-only gateway. It returns
-- no customer/order data and runs before the gateway's order maintenance/lock.

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text := E'begin\n perform pg_advisory_xact_lock(841721950318::bigint);';
  new_value text := E'begin\n if p_action=\'authorize_analytics\' then\n  perform elio.assert_staff(u,false);\n  return jsonb_build_object(\'allowed\',true);\n end if;\n perform pg_advisory_xact_lock(841721950318::bigint);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then
    return;
  end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'shop_service definition differs from the expected version; review before adding analytics access.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;
revoke all on function public.shop_service(text,jsonb) from public, anon, authenticated;
grant execute on function public.shop_service(text,jsonb) to service_role;


-- Source: 20260918054801_require_social_contact.sql
-- Compatibility stage: accept explicit N/A while retaining existing blank contacts.
-- Deploy this before the required-contact checkout UI. The following migration
-- enables strict validation for new customer submissions after that UI is live.

create or replace function elio.validate_social_contact(p_buyer jsonb, p_required boolean)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  platform text := lower(regexp_replace(coalesce(p_buyer->>'social_platform',''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  username text := regexp_replace(coalesce(p_buyer->>'social_username',''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  if not p_required and platform='' and username='' then
    return;
  end if;
  perform elio.require(jsonb_typeof(p_buyer->'social_platform')='string'
    and platform in ('facebook','instagram','na'), 'Choose Facebook, Instagram, or N/A.');
  perform elio.require(jsonb_typeof(p_buyer->'social_username')='string'
    and length(username)>0,
    'Enter your social username or profile name, or N/A if unavailable.');
  perform elio.require(length(username)<=100,
    'Keep your social username or profile name to 100 characters or fewer.');
  perform elio.require(platform<>'na' or lower(username)='n/a',
    'Use N/A when no social platform is available.');
end;
$$;

revoke all on function elio.validate_social_contact(jsonb,boolean) from public, anon, authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('elio.validate_contact(jsonb)'::regprocedure);
  old_value text := E'  if nullif(p#>>\'{buyer,social_username}\',\'\') is not null then\n    perform elio.require(p#>>\'{buyer,social_platform}\' in (\'Facebook\',\'Instagram\',\'facebook\',\'instagram\'),\'Choose Facebook or Instagram for the social username.\');\n  end if;';
  new_value text := E'  perform elio.validate_social_contact(p->\'buyer\',false);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'validate_contact definition differs from the expected version; review before adding social contact validation.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;



-- Source: 20260918055004_enforce_social_contact_checkout.sql
-- Activate after the required-contact checkout UI is live.
-- Existing orders, quote/catalog requests and successful submission retries
-- remain unchanged; only genuinely new orders require a social contact or N/A.

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := E'  perform elio.validate_contact(p_payload);\n  q:=elio.calculate_quote(p_payload,u,null,false,submitted_at);';
  new_value text := E'  perform elio.validate_contact(p_payload);\n  perform elio.validate_social_contact(p_payload->\'buyer\',true);\n  q:=elio.calculate_quote(p_payload,u,null,false,submitted_at);';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if position(new_value in definition)>0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
    raise exception 'shop_api create_order definition differs from the expected version; review before requiring social contact.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;



-- Source: 20260918083120_optional_payment_reference.sql
-- Payment proof remains required. A bank/transfer reference is supplementary
-- and may be omitted without preventing proof review or payment approval.

create or replace function elio.normalize_payment_reference(value jsonb)
returns text language plpgsql immutable security invoker set search_path=''
as $$
declare
  reference_text text;
begin
  perform elio.require(value is null or jsonb_typeof(value) in ('null','string'),
    'Payment reference must be text (maximum 200 characters).');
  reference_text:=nullif(regexp_replace(coalesce(value#>>'{}',''),
    '^[[:space:]]+|[[:space:]]+$','','g'),'');
  perform elio.require(reference_text is null or length(reference_text)<=200,
    'Payment reference must be text (maximum 200 characters).');
  return reference_text;
end
$$;
revoke all on function elio.normalize_payment_reference(jsonb) from public, anon, authenticated;

-- The approval inserts the same optional reference stored with the order.
-- Existing records and all required proof columns are unchanged.
alter table elio.payments alter column payment_reference drop not null;

do $migration$
declare
  definition text:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text:=E'  perform elio.require(length(trim(coalesce(p_payload->>\'payment_reference\',\'\'))) between 1 and 200,\'Enter a payment reference (maximum 200 characters).\');\n  update elio.orders set proof_path=v_path,payment_reference=trim(p_payload->>\'payment_reference\'),payment_status=\'under_review\',revision=revision+1 where id=oid;';
  new_value text:=E'  update elio.orders set proof_path=v_path,payment_reference=elio.normalize_payment_reference(p_payload->\'payment_reference\'),payment_status=\'under_review\',revision=revision+1 where id=oid;';
begin
  if position(E'\r\n' in definition)>0 then
    old_value:=replace(old_value,chr(10),chr(13)||chr(10));
    new_value:=replace(new_value,chr(10),chr(13)||chr(10));
  end if;
  if length(definition)-length(replace(definition,new_value,''))=length(new_value)
    and position(old_value in definition)=0 then return; end if;
  if length(definition)-length(replace(definition,old_value,''))<>length(old_value)
    or position(new_value in definition)>0 then
    raise exception 'shop_service proof submission differs from the expected version; review before making payment reference optional.';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;



-- Source: 20260918105037_admin_promo_usage.sql
-- Report the authoritative usage ledger in the existing owner-only promo list.
-- This adds counts only; it does not change reservations, orders, or permissions.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := $old$'promos',case when role_name='owner' then (select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.promos) else '[]'::jsonb end$old$;
  new_value text := $new$'promos',case when role_name='owner' then (
    select coalesce(jsonb_agg(p.data||jsonb_build_object(
      'id',p.id,
      'usage_count',coalesce(usage.usage_count,0),
      'redeemed_count',coalesce(usage.redeemed_count,0),
      'reserved_count',coalesce(usage.reserved_count,0)
    )),'[]'::jsonb)
    from elio.promos p
    left join (
      select promo_id,count(*) as usage_count,
        count(*) filter (where state='redeemed') as redeemed_count,
        count(*) filter (where state='reserved') as reserved_count
      from elio.promo_usage group by promo_id
    ) usage on usage.promo_id=p.id
  ) else '[]'::jsonb end$new$;
begin
  -- Preserve every other live API change and its ownership/security settings.
  -- Abort on unexpected source instead of silently replacing the wrong query.
  if length(definition) - length(replace(definition,old_value,'')) = length(old_value) then
    execute replace(definition,old_value,new_value);
  elsif position(old_value in definition)=0
    and length(definition) - length(replace(definition,new_value,'')) = length(new_value) then
    null; -- Safe to replay without touching existing data.
  else
    raise exception 'Unexpected admin_bootstrap promo query; review public.shop_api before applying promo usage counts.';
  end if;
end;
$migration$;



-- Source: 20260918173858_soft_delete_promos.sql
-- Deletion hides and disables a promo, keeping its identity and existing uses.
-- Existing order snapshots remain authoritative for previously placed orders.
do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_parts text[] := array[
    $old$if p_action='admin_bootstrap' then$old$,
    $old$return jsonb_build_object('role',role_name,$old$,
    $old$from elio.outbox order by created_at desc limit 100) e));$old$,
    $old$row_data:=p_payload->'promo'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid()); row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));$old$
  ];
  new_parts text[] := array[
    $new$-- TLB_PROMO_DELETION_V1
 if p_action='delete_promo' then
  perform elio.assert_staff(u,true);
  rid:=(p_payload->>'id')::uuid;
  select data into row_data from elio.promos where id=rid;
  perform elio.require(row_data is not null,'Promo code not found.');
  if row_data->>'deleted_at' is null then
   update elio.promos set data=data||jsonb_build_object('active',false,'deleted_at',clock_timestamp(),'deleted_by',u) where id=rid;
  end if;
  return jsonb_build_object('id',rid,'deleted',true);
 end if;
 if p_action='admin_bootstrap' then$new$,
    $new$result:=jsonb_build_object('role',role_name,$new$,
    $new$from elio.outbox order by created_at desc limit 100) e));
  return result||jsonb_build_object('promos',(select coalesce(jsonb_agg(promo),'[]'::jsonb) from jsonb_array_elements(result->'promos') promo where promo->>'deleted_at' is null));$new$,
    $new$row_data:=(p_payload->'promo')-'deleted_at'-'deleted_by'; rid:=coalesce((row_data->>'id')::uuid,gen_random_uuid());
   perform elio.require(not exists(select 1 from elio.promos where id=rid and data->>'deleted_at' is not null),'This promo code was deleted and cannot be reactivated. Create a new code with a different name.');
   perform elio.require(not exists(select 1 from elio.promos where code=upper(trim(row_data->>'code')) and id<>rid and data->>'deleted_at' is not null),'This promo code was deleted and its name cannot be reused. Choose a different code.');
   row_data:=jsonb_build_object('active',true,'min_subtotal_cents',0,'cap_cents',null)||row_data||jsonb_build_object('id',rid,'code',upper(trim(row_data->>'code')));$new$
  ];
  i integer;
begin
  if position('-- TLB_PROMO_DELETION_V1' in definition)>0 then
    for i in 1..array_length(new_parts,1) loop
      if position(new_parts[i] in definition)=0 then
        raise exception 'Unexpected promo deletion definition; review public.shop_api before replaying this migration.';
      end if;
    end loop;
    return;
  end if;
  for i in 1..array_length(old_parts,1) loop
    if length(definition)-length(replace(definition,old_parts[i],''))<>length(old_parts[i]) then
      raise exception 'Unexpected promo deletion anchor %; review public.shop_api before applying this migration.',i;
    end if;
    definition:=replace(definition,old_parts[i],new_parts[i]);
  end loop;
  execute definition;
end;
$migration$;



-- Source: 20260918192825_count_order_day_before_cutoff.sql
-- A configured cutoff allows the order day to count when production is open.
-- Keep the established next-day start when no cutoff is configured, and keep
-- fulfillment after the last production day. Same-day opt-in is handled by
-- calculate_quote; zero lead days alone still cannot enable same-day orders.
create or replace function elio.earliest_lead_date(p_submitted timestamptz,p_days integer,p_settings jsonb)
returns date language plpgsql immutable set search_path='' as $$
declare
  local_submitted timestamp := p_submitted at time zone 'Asia/Manila';
  d date := local_submitted::date + 1;
  needed integer := p_days;
  counted integer := 0;
  i integer;
begin
  if needed=0 then return d; end if;
  if nullif(p_settings->>'cutoff_time','') is not null
     and local_submitted::time < (p_settings->>'cutoff_time')::time then
    d := local_submitted::date;
  end if;
  for i in 1..3660 loop
    if elio.is_production(d,p_settings) then counted:=counted+1; end if;
    d:=d+1;
    if counted>=needed then return d; end if;
  end loop;
  raise exception 'No usable production schedule is configured.';
end $$;



-- Source: 20260918195030_staff_order_review_emails.sql
-- Queue staff notifications in the same transaction that accepts payment proof.
-- Recipients come only from verified accounts with an owner/staff assignment.
-- No existing orders are backfilled and no customer access tokens enter these emails.

create or replace function elio.queue_order_review_emails(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare
  o elio.orders;
  s jsonb;
  recipient record;
  summary jsonb;
begin
  select * into strict o from elio.orders where id=p_id;
  perform elio.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation'
    and o.proof_path is not null,'Only a submitted payment proof can request review.');
  select jsonb_build_object('shop_name',data->'shop_name','site_url',data->'site_url')
    into s from elio.settings where id;
  summary:=jsonb_build_object('id',o.id,'reference',o.reference,
    'buyer_name',o.data#>>'{buyer,name}','fulfillment_date',o.fulfillment_date,
    'method',o.method,'total_cents',o.data->'total_cents');
  for recipient in
    select lower(trim(a.email)) as email,jsonb_agg(a.id order by a.id) as user_ids
    from elio.staff t join auth.users a on a.id=t.user_id
    where t.role in ('owner','staff') and a.email_confirmed_at is not null
      and nullif(trim(a.email),'') is not null
    group by lower(trim(a.email))
  loop
    insert into elio.outbox(event_key,event_type,order_id,to_email,subject,payload)
    values('review:'||o.id||':'||o.revision||':'||md5(recipient.email),
      'order_review_required',o.id,recipient.email,'Order ready for review · '||o.reference,
      jsonb_build_object('event_type','order_review_required','order',summary,
        'settings',s,'recipient_user_ids',recipient.user_ids))
    on conflict(event_key) do nothing;
  end loop;
end $$;
revoke all on function elio.queue_order_review_emails(uuid) from public,anon,authenticated;

-- Guard source replacements so replay is harmless and unexpected changes fail
-- atomically instead of silently omitting the notification or recipient checks.
do $migration$
declare
  definition text:=pg_get_functiondef('public.shop_service(text,jsonb)'::regprocedure);
  old_value text;
  new_value text;
  patch record;
begin
  for patch in select * from (values
    ($old$  perform elio.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');$old$,
     $new$  perform elio.audit(oid,u,'proof_submitted','Initial payment proof received before its deadline.');
  perform elio.queue_order_review_emails(oid); -- TLB_ORDER_REVIEW_EMAIL_V1$new$),
    ($old$  if p_action='prepare_email' then
   if e.event_type='fulfillment_reminder' then$old$,
     $new$  if p_action='prepare_email' then
   if e.event_type='order_review_required' then
    -- Recheck access before sending: removing a team member or changing their
    -- verified address must not disclose an order to the old recipient.
    select exists(select 1 from elio.staff t join auth.users a on a.id=t.user_id
      where t.role in ('owner','staff') and a.email_confirmed_at is not null
        and (e.payload->'recipient_user_ids') ? a.id::text
        and lower(trim(a.email))=e.to_email) into good;
    if not good then
      update elio.outbox set status='skipped',last_error='Recipient no longer has verified staff or owner access.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
    select * into o from elio.orders where id=e.order_id;
    if o.payment_status<>'under_review' or o.fulfillment_status<>'pending_confirmation' then
      update elio.outbox set status='skipped',last_error='Order no longer needs payment review.',
        lease_token=null,leased_until=null where id=e.id;
      return jsonb_build_object('skip',true);
    end if;
   end if;
   if e.event_type='fulfillment_reminder' then$new$)
  ) as replacements(old_text,new_text)
  loop
    -- Normalize the migration file too: a Windows checkout may already use CRLF.
    old_value:=replace(patch.old_text,E'\r\n',E'\n');
    new_value:=replace(patch.new_text,E'\r\n',E'\n');
    if position(E'\r\n' in definition)>0 then
      old_value:=replace(old_value,chr(10),chr(13)||chr(10));
      new_value:=replace(new_value,chr(10),chr(13)||chr(10));
    end if;
    if length(definition)-length(replace(definition,new_value,''))=length(new_value) then
      continue;
    end if;
    if length(definition)-length(replace(definition,old_value,''))<>length(old_value) then
      raise exception 'Unexpected shop_service definition; review before applying staff review emails.';
    end if;
    definition:=replace(definition,old_value,new_value);
  end loop;
  execute definition;
end $migration$;



-- Source: 20260918200638_review_email_order_details.sql
-- Include saved product lines and payment totals in future review notifications.
-- Existing outbox payloads stay unchanged so provider retries retain their body.
create or replace function elio.queue_order_review_emails(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare
  o elio.orders;
  s jsonb;
  recipient record;
  summary jsonb;
  items jsonb;
begin
  select * into strict o from elio.orders where id=p_id;
  perform elio.require(o.payment_status='under_review' and o.fulfillment_status='pending_confirmation'
    and o.proof_path is not null,'Only a submitted payment proof can request review.');
  select jsonb_build_object('shop_name',data->'shop_name','site_url',data->'site_url')
    into s from elio.settings where id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'name',line->'name','quantity',line->'quantity',
    'selection_labels',coalesce(line->'selection_labels','[]'::jsonb),
    'unit_price_cents',line->'unit_price_cents','line_total_cents',line->'line_total_cents'
  ) order by position),'[]'::jsonb) into items
  from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) with ordinality as saved(line,position);
  summary:=jsonb_build_object('id',o.id,'reference',o.reference,
    'buyer_name',o.data#>>'{buyer,name}','fulfillment_date',o.fulfillment_date,
    'method',o.method,'items',items,'subtotal_cents',o.data->'subtotal_cents',
    'discount_cents',o.data->'discount_cents','delivery_cents',o.data->'delivery_cents',
    'total_cents',o.data->'total_cents','promo_code',o.data#>>'{promo_snapshot,code}');
  for recipient in
    select lower(trim(a.email)) as email,jsonb_agg(a.id order by a.id) as user_ids
    from elio.staff t join auth.users a on a.id=t.user_id
    where t.role in ('owner','staff') and a.email_confirmed_at is not null
      and nullif(trim(a.email),'') is not null
    group by lower(trim(a.email))
  loop
    insert into elio.outbox(event_key,event_type,order_id,to_email,subject,payload)
    values('review:'||o.id||':'||o.revision||':'||md5(recipient.email),
      'order_review_required',o.id,recipient.email,'Order ready for review · '||o.reference,
      jsonb_build_object('event_type','order_review_required','order',summary,
        'settings',s,'recipient_user_ids',recipient.user_ids))
    on conflict(event_key) do nothing;
  end loop;
end $$;
revoke all on function elio.queue_order_review_emails(uuid) from public,anon,authenticated;



-- Source: 20260918202752_close_cancelled_payment_reviews.sql
-- Cancellation closes an unapproved payment without claiming it was rejected,
-- approved, or refunded. Keep approved payments and their audit records intact.
alter table elio.orders drop constraint orders_payment_status_check;
alter table elio.orders add constraint orders_payment_status_check
  check (payment_status in ('awaiting_payment','under_review','paid','rejected','cancelled'));

do $migration$
declare
  definition text := pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure);
  old_value text := $old$update elio.orders set fulfillment_status='cancelled',revision=revision+1 where id=oid;$old$;
  new_value text := $new$update elio.orders set payment_status=case when payment_status in ('awaiting_payment','under_review') then 'cancelled' else payment_status end,fulfillment_status='cancelled',revision=revision+1 where id=oid;$new$;
begin
  if strpos(definition,new_value)>0 then return; end if;
  if (length(definition)-length(replace(definition,old_value,'')))/length(old_value)<>1 then
    raise exception 'Expected exactly one order cancellation update in public.shop_api';
  end if;
  execute replace(definition,old_value,new_value);
end
$migration$;

-- Repair only already-cancelled, unapproved payments. No stock, promo, refund,
-- receipt, or outbox changes; stale staff forms must refresh after this repair.
do $repair$
declare
  o elio.orders;
  before_order jsonb;
begin
  for o in select * from elio.orders
    where fulfillment_status='cancelled'
      and payment_status in ('awaiting_payment','under_review')
    for update
  loop
    before_order := elio.order_json(o.id,true,false)-'history';
    update elio.orders set payment_status='cancelled',revision=revision+1 where id=o.id;
    perform elio.audit(o.id,null,'payment_review_closed',
      'Closed the pending payment status because this order was already cancelled. No payment or refund was processed.',
      before_order,elio.order_json(o.id,true,false)-'history');
  end loop;
end
$repair$;



-- Source: 20260919075336_daily_quantity_limits.sql
-- Blank/missing daily limits mean unlimited. Keep all saved numeric limits,
-- availability flags, orders and allocations. Existing checkout locking and
-- staff authorization in shop_api continue to cover the entire batch.

alter table elio.inventory alter column capacity drop not null;

create or replace function elio.inventory_json() returns jsonb
language sql stable security definer set search_path='' as $$
 with reserved as (
  select product_id,date,sum(quantity)::integer as quantity
  from elio.allocations
  where date >= (now() at time zone 'Asia/Manila')::date-7
  group by product_id,date
 ), quantities as (
  select coalesce(i.product_id,a.product_id) as product_id,
   coalesce(i.date,a.date) as date,i.capacity,coalesce(i.available,true) as available,
   coalesce(a.quantity,0) as reserved
  from elio.inventory i full join reserved a using(product_id,date)
  where coalesce(i.date,a.date) >= (now() at time zone 'Asia/Manila')::date-7
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'product_id',product_id,'date',date,'capacity',capacity,'available',available,
  'reserved',reserved,'remaining',capacity-reserved,'unlimited',capacity is null
 ) order by date,product_id),'[]'::jsonb) from quantities
$$;

-- Private helper; only the existing authorized API branch calls it.
create or replace function elio.save_daily_quantities(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare x jsonb; product uuid; day date; cap integer; taken integer;
begin
 perform elio.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
 perform elio.require(jsonb_array_length(p_payload->'rows') between 1 and 20000,'Save between 1 and 20,000 product/date quantities at a time.');
 for x in select value from jsonb_array_elements(p_payload->'rows') loop
  perform elio.require(jsonb_typeof(x)='object' and x ? 'capacity','Provide a quantity or null for no limit.');
  perform elio.require(x->'capacity'='null'::jsonb or (jsonb_typeof(x->'capacity')='number' and x->>'capacity' ~ '^[0-9]+$'),'Enter a nonnegative whole quantity or null for no limit.');
  product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
  perform elio.require(product is not null and day is not null and (cap is null or cap between 0 and 1000000),'Enter a valid product, date and whole quantity up to 1,000,000.');
  perform elio.require(not (x ? 'available') or jsonb_typeof(x->'available')='boolean','Availability must be true or false.');
  select coalesce(sum(quantity),0)::integer into taken from elio.allocations where product_id=product and date=day;
  perform elio.require(cap is null or cap>=taken,'Quantity cannot be below the '||taken||' units already ordered on '||day||'.');
  insert into elio.inventory(product_id,date,capacity,available)
   values(product,day,cap,coalesce((x->>'available')::boolean,true))
   on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
 end loop;
 return elio.inventory_json();
end $$;
revoke all on function elio.save_daily_quantities(jsonb) from public,anon,authenticated;

-- Guarded patches retain subsequent order, promo, payment and email changes.
do $migration$
declare signature text; definition text; patch record; keep_crlf boolean;
begin
 foreach signature in array array[
  'elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
  'public.shop_api(text,jsonb,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  keep_crlf:=position(chr(13)||chr(10) in definition)>0;
  definition:=replace(definition,chr(13)||chr(10),chr(10));
  if position('TLB_DAILY_LIMITS_V1' in definition)=0 then
   for patch in select * from (values
    ('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)',
     $old$   perform elio.require(exists(select 1 from elio.inventory i where i.product_id=v_product_id and date=ful and available),'No available quantity is configured for '||(p->>'name')||' on '||ful::text||'.');
   stock:=elio.capacity_remaining(v_product_id,ful,p_original);
   perform elio.require(stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');$old$,
     $new$   -- TLB_DAILY_LIMITS_V1: absence/null is unlimited; explicit closures still apply.
   perform elio.require(not exists(select 1 from elio.inventory i where i.product_id=v_product_id and date=ful and not available),(p->>'name')||' is unavailable on '||ful::text||'.');
   stock:=elio.capacity_remaining(v_product_id,ful,p_original);
   perform elio.require(stock is null or stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');$new$),
    ('public.shop_api(text,jsonb,text)',
     $old$  perform elio.require(jsonb_typeof(p_payload->'rows')='array','Provide inventory rows.');
  for x in select value from jsonb_array_elements(p_payload->'rows') loop
   product:=(x->>'product_id')::uuid; day:=(x->>'date')::date; cap:=(x->>'capacity')::integer;
   perform elio.require(cap between 0 and 1000000 and day is not null,'Enter a valid date and nonnegative whole-unit capacity.');
   select coalesce(sum(quantity),0)::integer into taken from elio.allocations where product_id=product and date=day;
   perform elio.require(cap>=taken,'Capacity cannot be below the '||taken||' units already reserved or committed on '||day||'.');
   insert into elio.inventory(product_id,date,capacity,available) values(product,day,cap,coalesce((x->>'available')::boolean,true)) on conflict(product_id,date) do update set capacity=excluded.capacity,available=excluded.available;
  end loop;
  return elio.inventory_json();$old$,
     $new$  -- TLB_DAILY_LIMITS_V1: staff authorization and transaction lock above apply.
  return elio.save_daily_quantities(p_payload);$new$)
   ) as patches(function_signature,old_value,new_value) where function_signature=signature loop
    patch.old_value:=replace(patch.old_value,chr(13)||chr(10),chr(10));
    patch.new_value:=replace(patch.new_value,chr(13)||chr(10),chr(10));
    if length(definition)-length(replace(definition,patch.old_value,''))<>length(patch.old_value) then
     raise exception 'Unexpected function definition in % daily limits migration; review before applying.',signature;
    end if;
    definition:=replace(definition,patch.old_value,patch.new_value);
   end loop;
   if keep_crlf then definition:=replace(definition,chr(10),chr(13)||chr(10)); end if;
   execute definition;
  end if;
 end loop;
end $migration$;


