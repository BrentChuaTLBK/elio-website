begin;
-- Owner-only, read-only operational recovery export. No access tokens or Auth
-- credentials; private receipt files require a separate Storage backup.
create or replace function elio.paid_order_recovery_snapshot() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 with paid as materialized (
  select o.*,o.fulfillment_status not in ('completed','cancelled','expired','refunded') and not o.refund_label as awaiting_service
  from elio.orders o where o.payment_status in ('paid','under_review')
 ), selected_products as (
  select a.product_id from elio.allocations a join paid o on o.id=a.order_id
  union select (i->>'product_id')::uuid from paid o cross join lateral jsonb_array_elements(o.data->'items') i
 )
 select jsonb_build_object(
  'schema_version',1,'source','elio-paid-order-recovery','generated_at',statement_timestamp(),
  'timezone','Asia/Manila',
  'active_count',(select count(*) from paid where awaiting_service),
  'paid_history_count',(select count(*) from paid where payment_status='paid'),
  'review_count',(select count(*) from paid where payment_status='under_review'),
  'active_paid_count',(select count(*) from paid where awaiting_service and payment_status='paid'),
  'active_review_count',(select count(*) from paid where awaiting_service and payment_status='under_review'),
  'active_total_cents',(select coalesce(sum((data->>'total_cents')::bigint),0) from paid where awaiting_service),
  'active_order_ids',(select coalesce(jsonb_agg(id order by fulfillment_date,id),'[]') from paid where awaiting_service),
  'paid_orders',(select coalesce(jsonb_agg(elio.order_json(id,true,false) order by fulfillment_date,id),'[]') from paid where payment_status='paid'),
  'review_orders',(select coalesce(jsonb_agg(elio.order_json(id,true,false) order by fulfillment_date,id),'[]') from paid where payment_status='under_review'),
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
  'limitations',jsonb_build_array('Point-in-time copy; changes after generated_at are not included.','Includes paid-order history, payment-review orders and affiliate-related orders; other unpaid orders, auth accounts and full shop configuration are not a complete database backup.','Receipt and payout-proof paths are included; the underlying private image files are not bundled.','Restore requires reconciliation in an isolated environment. Do not blindly overwrite production.')) into result;
 return result;
end $$;

create or replace function elio.mark_order_backup_dirty() returns trigger language plpgsql security invoker set search_path='' as $$
declare relevant boolean:=true;identifier uuid;
begin
 if tg_table_name='orders' then
  relevant:=false;
  if tg_op<>'INSERT' then relevant:=old.payment_status in ('paid','under_review');end if;
  if tg_op<>'DELETE' then relevant:=relevant or new.payment_status in ('paid','under_review');end if;
  identifier:=case when tg_op='DELETE' then old.id else new.id end;
  relevant:=relevant or exists(select 1 from elio.affiliate_orders where order_id=identifier);
 elsif tg_table_name in ('payments','allocations') then
  identifier:=case when tg_op='DELETE' then old.order_id else new.order_id end;
  relevant:=exists(select 1 from elio.orders where id=identifier and payment_status in ('paid','under_review'));
 end if;
 if not relevant then return null;end if;
 update elio.order_backup_connection set revision=revision+1 where id;
 return null;
end $$;

alter table elio.order_backup_connection add column proof_archive_file_ids text[] not null default '{}',add column proof_archive_id text,add column proof_count integer,add column active_review_count integer;
do $$ declare def text;begin
 def:=pg_get_functiondef('elio.order_backup_status()'::regprocedure);
 def:=replace(def,'''active_count'',active_count,','''active_count'',active_count,''active_review_count'',active_review_count,''proof_archive_id'',proof_archive_id,''proof_count'',proof_count,');
 execute def;
 def:=pg_get_functiondef('elio.order_backup_service(text,jsonb)'::regprocedure);
 def:=replace(def,'''too_large'',''readback''','''too_large'',''readback'',''proof_files''');
 def:=replace(def,'''spreadsheet_id'',c.spreadsheet_id,''snapshot'',snapshot','''spreadsheet_id'',c.spreadsheet_id,''proof_archive_file_ids'',to_jsonb(c.proof_archive_file_ids),''snapshot'',snapshot');
 def:=replace(def,'active_count=case when code is null then',
 'active_review_count=case when code is null then (p_payload->>''active_review_count'')::integer else active_review_count end,
   proof_archive_id=case when code is null then p_payload->>''proof_archive_id'' else proof_archive_id end,
   proof_count=case when code is null then (p_payload->>''proof_count'')::integer else proof_count end,
   active_count=case when code is null then');
 execute def;
end $$;
update elio.order_backup_connection set revision=revision+1 where id;
commit;
