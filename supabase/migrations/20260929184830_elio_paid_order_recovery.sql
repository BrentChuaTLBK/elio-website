begin;
-- Owner-only, read-only operational recovery export. No access tokens or Auth
-- credentials; private receipt files require a separate Storage backup.
create function elio.paid_order_recovery_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 with paid as materialized (
  select o.*,o.fulfillment_status not in ('completed','cancelled','expired','refunded') and not o.refund_label as awaiting_service
  from elio.orders o where o.payment_status='paid'
 ), selected_products as (
  select a.product_id from elio.allocations a join paid o on o.id=a.order_id
  union select (i->>'product_id')::uuid from paid o cross join lateral jsonb_array_elements(o.data->'items') i
 )
 select jsonb_build_object(
  'schema_version',1,'source','elio-paid-order-recovery','generated_at',statement_timestamp(),
  'timezone','Asia/Manila',
  'active_count',(select count(*) from paid where awaiting_service),
  'paid_history_count',(select count(*) from paid),
  'active_total_cents',(select coalesce(sum((data->>'total_cents')::bigint),0) from paid where awaiting_service),
  'active_order_ids',(select coalesce(jsonb_agg(id order by fulfillment_date,id),'[]') from paid where awaiting_service),
  'paid_orders',(select coalesce(jsonb_agg(elio.order_json(id,true,false) order by fulfillment_date,id),'[]') from paid),
  'payments',(select coalesce(jsonb_agg(to_jsonb(p) order by p.order_id),'[]') from elio.payments p join paid o on o.id=p.order_id),
  'allocations',(select coalesce(jsonb_agg(to_jsonb(a) order by a.order_id,a.product_id,a.date),'[]') from elio.allocations a join paid o on o.id=a.order_id),
  'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]') from elio.products p join selected_products s on s.product_id=p.id),
  'inventory',(select coalesce(jsonb_agg(to_jsonb(i) order by i.product_id,i.date),'[]') from elio.inventory i where exists(select 1 from elio.allocations a join paid o on o.id=a.order_id where a.product_id=i.product_id and a.date=i.date)),
  'affiliates',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from elio.affiliates a),
  'affiliate_codes',(select coalesce(jsonb_agg(to_jsonb(a) order by a.promo_id),'[]') from elio.affiliate_codes a),
  'affiliate_orders',(select coalesce(jsonb_agg(to_jsonb(a) order by a.order_id),'[]') from elio.affiliate_orders a),
  'affiliate_order_details',(select coalesce(jsonb_agg(elio.order_json(o.id,true,false) order by o.id),'[]') from elio.orders o where exists(select 1 from elio.affiliate_orders a where a.order_id=o.id)),
  'affiliate_ledger',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from elio.affiliate_ledger a),
  'affiliate_payouts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') from elio.affiliate_payouts a),
  'limitations',jsonb_build_array('Point-in-time copy; changes after generated_at are not included.','Includes paid-order history and affiliate-related orders; other unpaid orders, auth accounts and full shop configuration are not a complete database backup.','Receipt and payout-proof paths are included; the underlying private image files are not bundled.','Restore requires reconciliation in an isolated environment. Do not blindly overwrite production.')) into result;
 return result;
end $$;
create function elio.paid_order_recovery() returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 perform elio.assert_staff(auth.uid(),true);
 return elio.paid_order_recovery_snapshot();
end $$;
revoke all on function elio.paid_order_recovery(),elio.paid_order_recovery_snapshot() from public,anon,authenticated,service_role;
do $$
declare definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$h$ if p_action='admin_bootstrap' then$h$;
begin
 perform elio.require(position(hook in definition)>0,'Missing admin dispatch hook.');
 execute replace(definition,hook,$new$ if p_action='paid_order_recovery' then return elio.paid_order_recovery(); end if;
$new$||hook);
end $$;
commit;
