-- Paid orders stay in the working queue until fulfillment is finished, even
-- after their scheduled date. Keep all list/export/selection filters aligned.
-- Preserve private invoker permissions and the inlinable row predicate.
create or replace function elio.admin_order_matches(o elio.orders,p jsonb) returns boolean
language sql stable security invoker as $$
 select
  (coalesce(p->>'task','all')='all' or p->>'task'='review' and o.payment_status='under_review' and o.fulfillment_status='pending_confirmation' and not o.refund_label
   or p->>'task'='awaiting_payment' and o.payment_status='awaiting_payment' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded')
   or p->>'task'='today' and o.fulfillment_date=(now() at time zone 'Asia/Manila')::date and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded'))
  and (coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(o.reference||' '||coalesce(o.data#>>'{buyer,name}','')||' '||coalesce(o.data#>>'{buyer,email}','')||' '||coalesce(o.data#>>'{buyer,phone}','')))>0)
  and (coalesce(p->>'payment','')='' or p->>'payment'=o.payment_status and (p->>'payment'<>'under_review' or o.fulfillment_status='pending_confirmation' and not o.refund_label))
  and (coalesce(p->>'fulfillment','')='' or p->>'fulfillment'=case when o.refund_label then 'refunded' else o.fulfillment_status end)
  and (coalesce(p->>'date','')='' or o.fulfillment_date::text=p->>'date')
  and (coalesce(p->>'method','')='' or o.method=p->>'method')
  and (coalesce(p->>'refund','')='' or o.refund_label=(p->>'refund'='yes'))
  and (not coalesce((p->>'upcoming')::boolean,false) or (o.fulfillment_date>=(now() at time zone 'Asia/Manila')::date or o.payment_status='paid') and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded'))
$$;

create or replace function elio.admin_order_page(p_action text,p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare total bigint; page_size integer:=least(greatest(coalesce((p->>'limit')::integer,50),1),100);
 page_index integer:=greatest(coalesce((p->>'page')::integer,0),0); rows jsonb; upcoming boolean:=coalesce((p->>'upcoming')::boolean,false);
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require(length(coalesce(p->>'search',''))<=254,'Search must be 254 characters or fewer.');
 perform elio.require(coalesce(p->>'task','all') in ('all','review','awaiting_payment','today') and coalesce(p->>'payment','') in ('','awaiting_payment','under_review','paid','rejected','cancelled')
  and coalesce(p->>'fulfillment','') in ('','pending_confirmation','confirmed','preparing','ready_for_pickup','out_for_delivery','completed','refunded','cancelled','expired')
  and coalesce(p->>'method','') in ('','pickup','delivery') and coalesce(p->>'refund','') in ('','yes','no'),'Choose valid order filters.');
 if coalesce(p->>'date','')<>'' then perform elio.require((p->>'date')::date::text=p->>'date','Choose a valid fulfillment date.'); end if;
 select count(*) into total from elio.orders o where elio.admin_order_matches(o,p);
 if p_action='admin_order_ids' then
  select coalesce(jsonb_agg(o.id order by case when upcoming then o.fulfillment_date end,o.created_at desc,o.id desc),'[]') into rows from elio.orders o where elio.admin_order_matches(o,p);
  return jsonb_build_object('ids',rows,'total',total);
 end if;
 page_index:=least(page_index,greatest(0,ceil(total::numeric/page_size)::integer-1));
 select coalesce(jsonb_agg(elio.order_list_json(o) order by case when upcoming then o.fulfillment_date end,o.created_at desc,o.id desc),'[]') into rows from
  (select * from elio.orders o where elio.admin_order_matches(o,p)
   order by case when upcoming then o.fulfillment_date end,o.created_at desc,o.id desc
   limit case when p_action='admin_order_export' then null else page_size end
   offset case when p_action='admin_order_export' then 0 else page_index*page_size end) o;
 return jsonb_build_object('orders',rows,'total',total,'page',page_index,'limit',page_size);
end $$;

create or replace function elio.admin_core_summary() returns jsonb
language sql stable security invoker set search_path='' as $$
 with latest_email as (select * from elio.outbox order by created_at desc limit 100),
 attention as (
  select 'payment'::text as kind,o.id as order_id,'Review payment · '||o.reference as title,'Awaiting review; order placed over an hour ago.'::text as detail,o.created_at as at
   from elio.orders o where o.payment_status='under_review' and o.fulfillment_status='pending_confirmation' and not o.refund_label and o.created_at<=now()-interval '1 hour'
  union all select 'delivery',o.id,'Delivery payment · '||o.reference,'Quoted delivery fee has not been recorded as received.',coalesce((o.data->>'updated_at')::timestamptz,o.created_at)
   from elio.orders o where o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded') and o.method='delivery' and o.data#>>'{delivery_charge,state}'='quoted'
  union all select 'email',e.order_id,'Email sending needs review','Open Email delivery below to inspect the error.',e.created_at from latest_email e where e.last_error is not null and e.status not in ('sent','skipped') and e.reviewed_at is null
 ), summary as (
  select count(*) as all_orders,
   count(*) filter(where payment_status='under_review' and fulfillment_status='pending_confirmation' and not refund_label) as review,
   count(*) filter(where payment_status='awaiting_payment' and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded')) as awaiting_payment,
   count(*) filter(where fulfillment_date=(now() at time zone 'Asia/Manila')::date and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded')) as today,
   count(*) filter(where (fulfillment_date>=(now() at time zone 'Asia/Manila')::date or payment_status='paid') and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded')) as upcoming from elio.orders
 )
 select jsonb_build_object('order_summary',jsonb_build_object('all',all_orders,'review',review,'awaiting_payment',awaiting_payment,'today',today,'upcoming',upcoming),
  'overview_orders',(select coalesce(jsonb_agg(elio.order_list_json(o) order by fulfillment_date,created_at desc,id desc),'[]') from (select * from elio.orders where (fulfillment_date>=(now() at time zone 'Asia/Manila')::date or payment_status='paid') and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded') order by fulfillment_date,created_at desc,id desc limit 7) o),
  'attention',jsonb_build_object('total',(select count(*) from attention),'items',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'orderId',order_id,'title',title,'detail',detail,'at',at) order by at,order_id),'[]') from (select * from attention order by at,order_id limit 6) a))) from summary
$$;

revoke all on function elio.admin_order_matches(elio.orders,jsonb),elio.admin_order_page(text,jsonb),elio.admin_core_summary() from public,anon,authenticated,service_role;
