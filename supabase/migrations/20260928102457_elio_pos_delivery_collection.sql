begin;
create table elio.pos_delivery_payments (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references elio.orders(id),amount_cents integer not null check(amount_cents>0),
 method text not null,reference text not null default '',recorded_at timestamptz not null default clock_timestamp(),recorded_by uuid not null,
 idempotency_key uuid not null unique,request_hash text not null,
 voided_at timestamptz,voided_by uuid,void_reason text
);
create unique index pos_delivery_one_active_payment on elio.pos_delivery_payments(order_id) where voided_at is null;
alter table elio.pos_delivery_payments enable row level security;
revoke all on elio.pos_delivery_payments from public,anon,authenticated,service_role;

create function elio.pos_delivery_quote(p jsonb,q jsonb,p_original uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare o elio.orders;charge jsonb;fee integer;recipient text;pending boolean;
begin
 if coalesce(p->>'order_source','')<>'direct' then return q;end if;
 if p_original is not null then select * into strict o from elio.orders where id=p_original;end if;
 if p->>'method'='pickup' then
 perform elio.require(coalesce(o.data#>>'{delivery_charge,state}','') not in ('quoted','paid'),'Settle the separate delivery fee before changing to pickup.');
 return q||jsonb_build_object('delivery_charge',null);
 end if;
 if o.method='delivery' and o.data->'delivery_charge' is not null then
  fee:=coalesce((o.data->>'delivery_cents')::integer,0);
  perform elio.require(coalesce((p->>'delivery_cents')::integer,fee)=fee,'Use Delivery fee in the POS order list to update this separate charge.');
  return q||jsonb_build_object('delivery_charge',o.data->'delivery_charge','delivery_cents',fee,'total_cents',(q->>'subtotal_cents')::bigint-(q->>'discount_cents')::bigint+fee);
 end if;
 recipient:=coalesce(p->>'delivery_fee_recipient','elio');pending:=coalesce((p->>'delivery_fee_pending')::boolean,false);
 perform elio.require(recipient in ('elio','courier'),'Choose whether the customer pays Elio or the courier.');
 fee:=coalesce((q->>'delivery_cents')::integer,0);
 charge:=jsonb_build_object('state',case when pending then 'pending' when recipient='courier' then 'courier' else 'included' end,'recipient',recipient,'fee_cents',case when pending then null else fee end);
 if pending or recipient='courier' then fee:=0;end if;
 return q||jsonb_build_object('delivery_charge',charge,'delivery_cents',fee,'total_cents',(q->>'subtotal_cents')::bigint-(q->>'discount_cents')::bigint+fee);
end $$;

create function elio.pos_delivery_action(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare o elio.orders;prior elio.action_keys;fee integer;recipient text;charge jsonb;before_value jsonb;v_key uuid;hashed text;v_method text;s jsonb;is_pending boolean;
begin
 perform elio.assert_staff(auth.uid(),false);perform pg_advisory_xact_lock(841721950318::bigint);
 v_key:=(p->>'idempotency_key')::uuid;perform elio.require(v_key is not null,'A unique request key is required.');
 hashed:=encode(extensions.digest(p::text||auth.uid()::text,'sha256'),'hex');
 perform elio.require(p_action in ('pos_set_delivery_fee','pos_record_delivery_payment','pos_void_delivery_payment'),'Unsupported delivery payment action.');
 select * into prior from elio.action_keys where user_id=auth.uid() and action=p_action and key=v_key;
 if found then perform elio.require(prior.request_hash=hashed,'This delivery request key was already used.');return elio.order_json(prior.order_id,true,false);end if;
 select * into strict o from elio.orders where id=(p->>'order_id')::uuid for update;
 perform elio.require(o.data->>'order_source'='direct' and o.method='delivery','Choose a direct delivery order.');
 perform elio.require(not o.refund_label and o.fulfillment_status not in ('cancelled','expired'),'This order is closed or refunded.');
 perform elio.require(o.revision=(p->>'revision')::integer,'This order changed. Refresh before continuing.');
 charge:=o.data->'delivery_charge';before_value:=elio.order_json(o.id,true,false)-'history';
 if p_action='pos_set_delivery_fee' then
 perform elio.require(o.payment_status in ('paid','awaiting_payment'),'Finish reviewing the initial payment before setting the delivery fee.');
 perform elio.require(charge->>'state' in ('pending','quoted','courier') or charge->>'state'='included' and (o.payment_status='awaiting_payment' or coalesce((charge->>'fee_cents')::integer,0)=0),'This delivery fee was already collected. Correct the recorded payment before changing the recipient.');
 perform elio.require(length(trim(p->>'reason')) between 1 and 1000,'Enter the reason or booking reference.');
 fee:=(p->>'fee_cents')::integer;recipient:=p->>'recipient';is_pending:=fee is null;
 perform elio.require((is_pending or fee between 0 and 100000000) and recipient in ('elio','courier'),'Enter the exact delivery fee and who collects it.');
 charge:=jsonb_build_object('state',case when is_pending then 'pending' when recipient='courier' then 'courier' when o.payment_status='paid' and fee>0 then 'quoted' else 'included' end,
 'recipient',recipient,'fee_cents',fee,'confirmed_at',clock_timestamp());
 update elio.orders set data=data||jsonb_build_object('delivery_charge',charge,'delivery_cents',case when recipient='elio' and not is_pending then fee else 0 end,
 'total_cents',(data->>'subtotal_cents')::bigint-coalesce((data->>'discount_cents')::bigint,0)+case when recipient='elio' and not is_pending then fee else 0 end),revision=revision+1 where id=o.id;

 elsif p_action='pos_record_delivery_payment' then
 perform elio.require(o.payment_status='paid' and charge->>'state'='quoted' and charge->>'recipient'='elio','Only a separate unpaid Elio delivery fee can be recorded here.');
 fee:=(charge->>'fee_cents')::integer;v_method:=p->>'method';select data into s from elio.settings where id;
 perform elio.require(v_method='cash' or exists(select 1 from jsonb_array_elements(coalesce(s->'payment_options','[]')) x where x->>'label'=v_method),'Choose Cash or a configured payment method.');
 perform elio.require(coalesce(length(p->>'reference'),0)<=160,'Keep the payment reference within 160 characters.');
 insert into elio.pos_delivery_payments(order_id,amount_cents,method,reference,recorded_by,idempotency_key,request_hash)
 values(o.id,fee,case when v_method='cash' then 'Cash' else v_method end,coalesce(p->>'reference',''),auth.uid(),v_key,hashed);
 update elio.orders set data=data||jsonb_build_object('delivery_charge',charge||jsonb_build_object('state','paid','paid_at',clock_timestamp(),'payment_method',case when v_method='cash' then 'Cash' else v_method end,'payment_reference',coalesce(p->>'reference',''))),revision=revision+1 where id=o.id;
 elsif p_action='pos_void_delivery_payment' then
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(charge->>'state'='paid' and exists(select 1 from elio.pos_delivery_payments where order_id=o.id and voided_at is null),'There is no separate delivery payment to correct.');
 perform elio.require(length(trim(p->>'reason')) between 1 and 1000 and coalesce((p->>'refund_confirmed')::boolean,false),'Confirm the delivery payment was returned or was recorded in error, and enter a reason.');
 update elio.pos_delivery_payments set voided_at=clock_timestamp(),voided_by=auth.uid(),void_reason=trim(p->>'reason') where order_id=o.id and voided_at is null;
 update elio.orders set data=data||jsonb_build_object('delivery_charge',(charge-'paid_at'-'payment_method'-'payment_reference')||jsonb_build_object('state','quoted')),revision=revision+1 where id=o.id;
 end if;
 insert into elio.action_keys(user_id,action,key,order_id,request_hash) values(auth.uid(),p_action,v_key,o.id,hashed);
 perform elio.audit(o.id,auth.uid(),p_action,p->>'reason',before_value,elio.order_json(o.id,true,false)-'history');
 return elio.order_json(o.id,true,false);
end $$;
revoke all on function elio.pos_delivery_quote(jsonb,jsonb,uuid),elio.pos_delivery_action(text,jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_quote(jsonb,uuid)'::regprocedure);
 old:=$a$return jsonb_build_object('items',items$a$;
 perform elio.require(position(old in definition)>0,'Missing direct delivery quote hook.');
 definition:=replace(definition,old,$b$return elio.pos_delivery_quote(p_payload,jsonb_build_object('items',items$b$);
 old:=$a$'delivery_zone_description','');$a$;
 perform elio.require(position(old in definition)>0,'Missing direct delivery quote return hook.');
 execute replace(definition,old,$b$'delivery_zone_description',''),p_original);$b$);
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$if p_action='pos_catalog' then$a$;
 execute replace(definition,old,$b$if p_action in ('pos_set_delivery_fee','pos_record_delivery_payment','pos_void_delivery_payment') then return elio.pos_delivery_action(p_action,p_payload);end if;
 if p_action='pos_catalog' then$b$);
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$'delivery_zone_description',q->'delivery_zone_description');$a$;
 perform elio.require(position(old in definition)>0,'Missing edited delivery charge snapshot hook.');
 execute replace(definition,old,$b$'delivery_zone_description',q->'delivery_zone_description')||case when o.data->>'order_source'='direct' then jsonb_build_object('delivery_charge',q->'delivery_charge') else '{}'::jsonb end;$b$);
 definition:=pg_get_functiondef('elio.accounting_sync_order(uuid,jsonb,timestamptz,boolean)'::regprocedure);
 old:=$a$delivery:=coalesce((p_snapshot->>'delivery_cents')::bigint,0);$a$;
 perform elio.require(position(old in definition)>0,'Missing collected delivery income hook.');
 execute replace(definition,old,$b$delivery:=case when p_snapshot#>>'{delivery_charge,state}' in ('pending','quoted','courier') then 0 else coalesce((p_snapshot->>'delivery_cents')::bigint,0) end;$b$);
 definition:=pg_get_functiondef('elio.accounting_rows_v2(date,date)'::regprocedure);
 old:=$a$coalesce(o.data#>>'{pos_payment,label}','')$a$;
 perform elio.require(position(old in definition)>0,'Missing delivery payment method hook.');
 execute replace(definition,old,$b$case when c.system_key='delivery_fee' and o.data#>>'{delivery_charge,state}'='paid' then o.data#>>'{delivery_charge,payment_method}' else coalesce(o.data#>>'{pos_payment,label}','') end$b$);
 definition:=pg_get_functiondef('elio.accounting_report_v2(uuid,jsonb)'::regprocedure);
 old:=$a$and (p.approved_at at time zone 'Asia/Manila')::date between start_date and end_date;$a$;
 perform elio.require(position(old in definition)>0,'Missing delivery comparison payment-date hook.');
 execute replace(definition,old,$b$and ((p.approved_at at time zone 'Asia/Manila')::date between start_date and end_date or exists(select 1 from elio.pos_delivery_payments dp where dp.order_id=ord.id and dp.voided_at is null and (dp.recorded_at at time zone 'Asia/Manila')::date between start_date and end_date));$b$);
end $$;
commit;
