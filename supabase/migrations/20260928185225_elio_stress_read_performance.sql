begin;
-- Read-only catalog traffic should not serialize with every other visitor.
-- Mutations still hold the existing global lock. Reads acquire it only when
-- default inventory or an expired reservation actually needs to be refreshed.
create function elio.default_inventory_needs_refresh() returns boolean
language sql stable security invoker set search_path='' as $body$
 with days as (
  select m.month,f.id as product_id,d::date as date
  from elio.flavor_menus m cross join lateral unnest(m.flavor_ids) f(id)
  join elio.products p on p.id=f.id and p.data->>'kind'='flavor'
   and not coalesce((p.data->>'collection_hidden')::boolean,false)
  cross join lateral generate_series(greatest(m.month,(now() at time zone 'Asia/Manila')::date)::timestamp,
   (m.month+interval '1 month - 1 day')::timestamp,interval '1 day') d
  where m.month between date_trunc('month',now() at time zone 'Asia/Manila')::date
   and (date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 month')::date
 ), reserved as (
  select a.product_id,a.date,sum(a.quantity)::integer as quantity from elio.allocations a
  where a.date >= (now() at time zone 'Asia/Manila')::date group by a.product_id,a.date
 )
 select exists(
 select 1 from days d cross join elio.settings s
 left join reserved r using(product_id,date)
 left join elio.inventory i using(product_id,date)
 where s.id and (i.product_id is null or not i.configured and
  (i.capacity is distinct from greatest(s.inventory_default,coalesce(r.quantity,0)) or not i.available))
 )
$body$;
revoke all on function elio.default_inventory_needs_refresh() from public,anon,authenticated,service_role;

-- List views already fetch get_order when opening details. Avoid reading and
-- transmitting before/after audit snapshots for every order on every refresh.
create function elio.order_list_json(o elio.orders) returns jsonb
language plpgsql stable security invoker set search_path='' as $body$
declare p_private boolean:=true;p_token boolean:=false;h jsonb:='[]'::jsonb;
begin
 return (case when p_private then o.data else o.data-'pos_created_by'-'pos_payment' end) || jsonb_build_object('id',o.id,'reference',o.reference,'created_at',o.created_at,'fulfillment_date',o.fulfillment_date,'method',o.method,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,'payment_deadline',case when o.data->>'order_source' in ('in_person','direct') then null else elio.maintenance_deadline(o.payment_deadline,o.created_at) end,
 'uploads_paused',o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation' and (elio.maintenance_state()->>'uploads_paused')::boolean,
 'payment_seconds_remaining',case when o.data->>'order_source' in ('in_person','direct') then null else greatest(0,extract(epoch from (elio.maintenance_deadline(o.payment_deadline,o.created_at)-statement_timestamp())))::integer end,'proof_path',case when p_private then o.proof_path else null end,'proof_submitted',o.proof_path is not null,'payment_reference',o.payment_reference,'paid_amount_cents',o.paid_amount_cents,'refund_label',o.refund_label,'revision',o.revision,'history',h) || case when o.data->>'order_source' in ('in_person','direct') then jsonb_build_object('payment_deadline',null,'payment_seconds_remaining',null) else '{}'::jsonb end || case when p_token then jsonb_build_object('access_token',elio.order_token(o)) else '{}'::jsonb end;
end $body$;
revoke all on function elio.order_list_json(elio.orders) from public,anon,authenticated,service_role;

do $patch$
declare definition text;old_text text;new_text text;
begin
definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
old_text:=$old$ perform pg_advisory_xact_lock(841721950318::bigint);
 perform elio.expire_orders();$old$;
new_text:=$new$ if p_action in ('catalog','quote','home_catalog','flavor_collection','faqs') then
  if p_action in ('catalog','quote') and (
   exists(select 1 from elio.orders where coalesce(data->>'order_source','website') not in ('in_person','direct')
    and payment_status='awaiting_payment' and fulfillment_status='pending_confirmation'
    and elio.maintenance_deadline(payment_deadline,created_at,clock_timestamp())<=clock_timestamp())
   or elio.default_inventory_needs_refresh()) then
   perform pg_advisory_xact_lock(841721950318::bigint);
   perform elio.expire_orders();
   perform elio.prepare_default_inventory();
  end if;
 else
  perform pg_advisory_xact_lock(841721950318::bigint);
  perform elio.expire_orders();
 end if;$new$;
perform elio.require(position(old_text in definition)>0,'Read-lock migration marker missing.');
definition:=replace(definition,old_text,new_text);
old_text:=$old$if p_action in ('admin_bootstrap','catalog','quote','create_order') then$old$;
perform elio.require(position(old_text in definition)>0,'Inventory refresh marker missing.');
definition:=replace(definition,old_text,$new$if p_action in ('admin_bootstrap','create_order') then$new$);
old_text:=$old$'orders',(select coalesce(jsonb_agg(elio.order_json(id,true,false) order by created_at desc),'[]') from elio.orders)$old$;
perform elio.require(position(old_text in definition)>0,'Order list marker missing.');
definition:=replace(definition,old_text,$new$'orders',(select coalesce(jsonb_agg(elio.order_list_json(list_order) order by list_order.created_at desc),'[]') from elio.orders list_order)$new$);
execute definition;

definition:=pg_get_functiondef('elio.pos_order_action(text,jsonb)'::regprocedure);
old_text:=$old$select jsonb_agg(elio.order_json(id,true,false) order by created_at desc) from
   (select id,created_at from elio.orders where data->>'order_source' in ('in_person','direct') order by created_at desc limit 200) x$old$;
perform elio.require(position(old_text in definition)>0,'POS list marker missing.');
definition:=replace(definition,old_text,$new$select jsonb_agg(elio.order_list_json(x) order by x.created_at desc) from elio.orders x
   where x.id in (select id from elio.orders where data->>'order_source' in ('in_person','direct') order by created_at desc limit 200)$new$);
execute definition;
end $patch$;
commit;
