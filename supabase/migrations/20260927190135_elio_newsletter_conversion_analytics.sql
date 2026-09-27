begin;

-- Marketing conversion is distinct from a code's redemption limit. A refunded
-- or cancelled paid order keeps its single-use history but is no longer a sale.
create or replace function elio.newsletter_offer_report(p_payload jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_limit integer:=least(greatest(coalesce((p_payload->>'offer_limit')::integer,50),1),100);
 v_offset integer:=greatest(coalesce((p_payload->>'offer_offset')::integer,0),0);
 search text:=lower(btrim(coalesce(p_payload->>'offer_search','')));
 status_filter text:=nullif(p_payload->>'offer_status',''); result jsonb;
begin
 perform elio.require(length(search)<=254 and (status_filter is null or status_filter in
  ('converted','not_converted','expired','used','reserved','inactive','active')),'Choose a valid offer filter.');
 with issued as (
  select p.id,n.email,p.code,n.confirmed_at issued_at,n.offer_expires_at expires_at,
   coalesce((p.data->>'active')::boolean,false) active,p.data->>'deleted_at' deleted_at,
   (select count(*) from elio.promo_usage where promo_id=p.id and state='redeemed') consumed_count,
   (select count(*) from elio.promo_usage where promo_id=p.id and state='reserved') reserved_count,
   sales.paid_order_count as redeemed_count,sales.paid_order_count,sales.sales_cents,sales.discount_cents
  from elio.newsletter_subscribers n join elio.promos p on p.id=n.promo_id
  cross join lateral (
   select count(*) paid_order_count,
    coalesce(sum(greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint)),0) sales_cents,
    coalesce(sum((o.data->>'discount_cents')::bigint),0) discount_cents
   from elio.promo_usage usage join elio.orders o on o.id=usage.order_id
   where usage.promo_id=p.id and o.payment_status='paid'
    and o.fulfillment_status not in ('cancelled','expired') and not o.refund_label
  ) sales
 ), offers as (
  select *,case when paid_order_count>0 then 'converted'
    when expires_at<=now() then 'expired' else 'not_converted' end conversion_status,
   -- Legacy fields support an already-open dashboard during the rollout.
   case when paid_order_count>0 then 'used' when expires_at<=now() then 'expired'
    when consumed_count>0 or not active or deleted_at is not null then 'inactive'
    when reserved_count>0 then 'reserved' else 'active' end status
  from issued
 ), filtered as (
  select * from offers where (search='' or position(search in lower(email||' '||code))>0)
   and (status_filter is null or case when status_filter in ('converted','not_converted','expired')
    then conversion_status=status_filter else status=status_filter end)
 ), page as (select * from filtered order by issued_at desc,id limit v_limit offset v_offset)
 select jsonb_build_object('offer_report_version',2,'offer_counts',(select jsonb_build_object(
  'issued',count(*),'converted',count(*) filter(where conversion_status='converted'),
  'expired',count(*) filter(where conversion_status='expired'),
  'redeemed',count(*) filter(where conversion_status='converted'),
  'unused',count(*) filter(where status='active'),'reserved',count(*) filter(where status='reserved'),
  'inactive',count(*) filter(where status='inactive'),'paid_order_count',coalesce(sum(paid_order_count),0),
  'sales_cents',coalesce(sum(sales_cents),0),'discount_cents',coalesce(sum(discount_cents),0)) from offers),
  'offers',(select coalesce(jsonb_agg(to_jsonb(page)-'consumed_count' order by issued_at desc,id),'[]') from page),
  'offer_total',(select count(*) from filtered),'offer_limit',v_limit,'offer_offset',v_offset) into result;
 return result;
end $$;
revoke all on function elio.newsletter_offer_report(jsonb) from public,anon,authenticated,service_role;

commit;
