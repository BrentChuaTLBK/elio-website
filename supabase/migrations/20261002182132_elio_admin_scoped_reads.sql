-- Keep complete reporting independent from the bounded order list. Legacy
-- bootstrap remains available to POS and older clients during a rolling release.
-- Pure SQL helpers are intentionally inlinable. Only the private callers below
-- invoke them, with an empty search_path; they do not read any other relation.
create function elio.admin_order_matches(o elio.orders,p jsonb) returns boolean
language sql stable security invoker as $$
 select
  (coalesce(p->>'task','all')='all' or p->>'task'='review' and o.payment_status='under_review' and o.fulfillment_status='pending_confirmation' and not o.refund_label
   or p->>'task'='today' and o.fulfillment_date=(now() at time zone 'Asia/Manila')::date and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded'))
  and (coalesce(p->>'search','')='' or position(lower(p->>'search') in lower(o.reference||' '||coalesce(o.data#>>'{buyer,name}','')||' '||coalesce(o.data#>>'{buyer,email}','')||' '||coalesce(o.data#>>'{buyer,phone}','')))>0)
  and (coalesce(p->>'payment','')='' or p->>'payment'=o.payment_status and (p->>'payment'<>'under_review' or o.fulfillment_status='pending_confirmation' and not o.refund_label))
  and (coalesce(p->>'fulfillment','')='' or p->>'fulfillment'=case when o.refund_label then 'refunded' else o.fulfillment_status end)
  and (coalesce(p->>'date','')='' or o.fulfillment_date::text=p->>'date')
  and (coalesce(p->>'method','')='' or o.method=p->>'method')
  and (coalesce(p->>'refund','')='' or o.refund_label=(p->>'refund'='yes'))
  and (not coalesce((p->>'upcoming')::boolean,false) or o.fulfillment_date>=(now() at time zone 'Asia/Manila')::date and not o.refund_label and o.fulfillment_status not in ('cancelled','expired','completed','refunded'))
$$;

create function elio.admin_order_page(p_action text,p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare total bigint; page_size integer:=least(greatest(coalesce((p->>'limit')::integer,50),1),100);
 page_index integer:=greatest(coalesce((p->>'page')::integer,0),0); rows jsonb; upcoming boolean:=coalesce((p->>'upcoming')::boolean,false);
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require(length(coalesce(p->>'search',''))<=254,'Search must be 254 characters or fewer.');
 perform elio.require(coalesce(p->>'task','all') in ('all','review','today') and coalesce(p->>'payment','') in ('','awaiting_payment','under_review','paid','rejected','cancelled')
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

create function elio.admin_core_summary() returns jsonb
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
   count(*) filter(where fulfillment_date=(now() at time zone 'Asia/Manila')::date and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded')) as today,
   count(*) filter(where fulfillment_date>=(now() at time zone 'Asia/Manila')::date and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded')) as upcoming from elio.orders
 )
 select jsonb_build_object('order_summary',jsonb_build_object('all',all_orders,'review',review,'today',today,'upcoming',upcoming),
  'overview_orders',(select coalesce(jsonb_agg(elio.order_list_json(o) order by fulfillment_date,created_at desc,id desc),'[]') from (select * from elio.orders where fulfillment_date>=(now() at time zone 'Asia/Manila')::date and not refund_label and fulfillment_status not in ('cancelled','expired','completed','refunded') order by fulfillment_date,created_at desc,id desc limit 7) o),
  'attention',jsonb_build_object('total',(select count(*) from attention),'items',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'orderId',order_id,'title',title,'detail',detail,'at',at) order by at,order_id),'[]') from (select * from attention order by at,order_id limit 6) a))) from summary
$$;

-- Same non-negative safe-integer rule used by the established JS reports.
create function elio.report_integer(value jsonb) returns bigint
language sql immutable security invoker as $$
 select case when jsonb_typeof(value)='number' and (value#>>'{}') ~ '^[0-9]+(\.0+)?$'
   or jsonb_typeof(value)='string' and (value#>>'{}') ~ '^[0-9]+$'
  then case when (value#>>'{}')::numeric<=9007199254740991 then (value#>>'{}')::bigint end end
$$;

create function elio.admin_analytics(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare start_date date:=nullif(p->>'start','')::date; end_date date:=nullif(p->>'end','')::date;
 today date:=(now() at time zone 'Asia/Manila')::date; first_date date; last_date date; unit text; step integer; result jsonb;
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require((start_date is null or start_date::text=p->>'start') and (end_date is null or end_date::text=p->>'end') and (start_date is null or end_date is null or start_date<=end_date),'Choose a valid date range.');
 select coalesce(start_date,min((created_at at time zone 'Asia/Manila')::date),end_date,today),coalesce(end_date,greatest(max((created_at at time zone 'Asia/Manila')::date),today,coalesce(start_date,end_date,today))) into first_date,last_date
  from elio.orders where (start_date is null or (created_at at time zone 'Asia/Manila')::date>=start_date) and (end_date is null or (created_at at time zone 'Asia/Manila')::date<=end_date);
 unit:=case when last_date-first_date+1<=31 then 'day' when last_date-first_date+1<=217 then 'week' else 'month' end;
 step:=case when unit='month' then ceil(((extract(year from last_date)-extract(year from first_date))*12+extract(month from last_date)-extract(month from first_date)+1)/31)::integer else 1 end;
 with recursive rows as materialized (
  select o.*,(created_at at time zone 'Asia/Manila')::date as placed,
   payment_status='paid' and fulfillment_status not in ('cancelled','expired','refunded') and not refund_label as active,
   elio.report_integer(data->'total_cents') as current_value,coalesce(elio.report_integer(data->'subtotal_cents'),0) as product_value,
   coalesce(elio.report_integer(data->'discount_cents'),0) as discount_value,coalesce(elio.report_integer(data->'delivery_cents'),0) as delivery_value,
   case when jsonb_typeof(data#>'{buyer,email}')='string' then lower(btrim(data#>>'{buyer,email}')) else '' end as email,
   case when jsonb_typeof(data#>'{promo_snapshot,code}')='string' then upper(btrim(data#>>'{promo_snapshot,code}')) else '' end as promo
  from elio.orders o where (start_date is null or (created_at at time zone 'Asia/Manila')::date>=start_date) and (end_date is null or (created_at at time zone 'Asia/Manila')::date<=end_date)
 ), customers as (select email,count(*) as orders from rows where active and email<>'' group by email),
 items as materialized (
   select r.id,r.created_at,i.item_index,i.item,coalesce(elio.report_integer(i.item->'quantity'),0) as quantity,
   coalesce(i.item->>'product_id','') as product_id,coalesce(i.item->>'name','Unknown product') as name,
   case when jsonb_typeof(i.item->'flavor_contents')='array' then i.item->'flavor_contents' else '[]'::jsonb end as recipe
  from rows r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data->'items')='array' then r.data->'items' else '[]'::jsonb end) with ordinality i(item,item_index)
  where r.active and jsonb_typeof(i.item)='object' and coalesce(elio.report_integer(i.item->'quantity'),0)>0
 ), products as (
  select case when i.product_id<>'' then 'id:'||i.product_id else 'name:'||i.name end as key,min(i.product_id) as product_id,(array_agg(coalesce(p.data->>'name',i.name) order by i.created_at desc,i.id desc,i.item_index))[1] as name,
   sum(i.quantity) as units,sum(case when i.item->'line_total_cents' is null or i.item->'line_total_cents'='null'::jsonb then case when coalesce(elio.report_integer(i.item->'unit_price_cents'),0)*i.quantity<=9007199254740991 then coalesce(elio.report_integer(i.item->'unit_price_cents'),0)*i.quantity else 0 end else coalesce(elio.report_integer(i.item->'line_total_cents'),0) end) as value,count(distinct i.id) as orders
  from items i left join elio.products p on p.id::text=i.product_id group by 1
 ), flavors as (
  select coalesce(nullif(f.item->>'product_id',''),nullif(f.item->>'name',''),'Unknown flavor') as id,(array_agg(coalesce(nullif(f.item->>'name',''),'Unknown flavor') order by i.created_at desc,i.id desc,i.item_index,f.flavor_index))[1] as name,
   sum(elio.report_integer(f.item->'quantity')*i.quantity) as pieces,count(distinct i.id) as orders
  from items i cross join lateral jsonb_array_elements(i.recipe) with ordinality f(item,flavor_index)
  where coalesce(elio.report_integer(f.item->'quantity'),0)*i.quantity between 1 and 9007199254740991 group by 1
 ), promos as (select promo,count(*) as orders,sum(discount_value) as discount from rows where active and promo<>'' and discount_value>0 group by promo),
 bucket_starts(day,next_day) as (
  select first_date,case when unit='month' then (date_trunc('month',first_date)+make_interval(months=>step))::date else first_date+case when unit='week' then 7 else 1 end end
  union all select next_day,case when unit='month' then (date_trunc('month',next_day)+make_interval(months=>step))::date else next_day+case when unit='week' then 7 else 1 end end from bucket_starts where next_day<=last_date
 ), trend as (
  select b.day as start,least(b.next_day-1,last_date) as finish,count(r.id) as orders,count(r.id) filter(where r.payment_status='paid') as paid,
   coalesce(sum(r.paid_amount_cents) filter(where r.payment_status='paid'),0) as approved,count(r.id) filter(where r.active) as active,
   coalesce(sum(r.current_value) filter(where r.active),0) as value from bucket_starts b left join rows r on r.placed between b.day and least(b.next_day-1,last_date) group by b.day,b.next_day
 )
 select jsonb_build_object('range',jsonb_build_object('start',coalesce(start_date::text,''),'end',coalesce(end_date::text,'')),'invalidRange',false,'invalidDateOrderCount',0,
  'totalOrders',count(*),'paidOrderCount',count(*) filter(where payment_status='paid'),'approvedPaymentsCents',coalesce(sum(paid_amount_cents) filter(where payment_status='paid'),0),
  'approvedAmountOrderCount',count(*) filter(where payment_status='paid' and paid_amount_cents is not null),'missingApprovedAmountCount',count(*) filter(where payment_status='paid' and paid_amount_cents is null),
  'averageApprovedPaymentCents',round(avg(paid_amount_cents) filter(where payment_status='paid')),
  'activePaidOrderCount',count(*) filter(where active),'currentOrderValueCents',coalesce(sum(current_value) filter(where active),0),'averageOrderValueCents',round(coalesce(sum(current_value) filter(where active),0)/nullif(count(*) filter(where active),0)::numeric),
  'currentProductValueCents',coalesce(sum(product_value) filter(where active),0),'currentDiscountCents',coalesce(sum(discount_value) filter(where active),0),'currentDeliveryCents',coalesce(sum(delivery_value) filter(where active),0),
  'additionalPaymentCents',coalesce(sum(greatest(0,current_value-paid_amount_cents)) filter(where active and current_value is not null and paid_amount_cents is not null),0),
  'refundDifferenceCents',coalesce(sum(greatest(0,paid_amount_cents-current_value)) filter(where active and current_value is not null and paid_amount_cents is not null),0),
  'awaitingPaymentCount',count(*) filter(where payment_status='awaiting_payment' and fulfillment_status not in ('cancelled','expired','refunded') and not refund_label),
  'underReviewCount',count(*) filter(where payment_status='under_review' and fulfillment_status not in ('cancelled','expired','refunded') and not refund_label),
  'expiredCount',count(*) filter(where fulfillment_status='expired'),'cancelledCount',count(*) filter(where fulfillment_status='cancelled'),'refundFlaggedCount',count(*) filter(where refund_label),
  'paidAdjustmentCount',count(*) filter(where payment_status='paid' and current_value is not null and paid_amount_cents is not null and current_value<>paid_amount_cents),
  'pickupCount',count(*) filter(where active and method='pickup'),'deliveryCount',count(*) filter(where active and method='delivery'),
  'refundedPaidOrderCount',count(*) filter(where payment_status='paid' and refund_label),'fullRefundOrderValueCents',coalesce(sum(current_value) filter(where payment_status='paid' and refund_label),0),
  'customerCount',(select count(*) from customers),'repeatCustomerCount',(select count(*) from customers where orders>=2),
  'completedOrderCount',count(*) filter(where active and fulfillment_status='completed'),'toFulfillCount',count(*) filter(where active and fulfillment_status<>'completed'))
 ||jsonb_build_object('promoUseCount',(select coalesce(sum(orders),0) from promos),'distinctPromoCodeCount',(select count(*) from promos),
  'promoCodes',(select coalesce(jsonb_agg(jsonb_build_object('code',promo,'orderCount',orders,'discountCents',discount)),'[]') from promos),
  'totalUnits',(select coalesce(sum(quantity),0) from items),'topProducts',(select coalesce(jsonb_agg(jsonb_build_object('productId',product_id,'name',name,'units',units,'lineValueCents',value,'orderCount',orders)),'[]') from products),
  'totalFlavorPieces',(select coalesce(sum(pieces),0) from flavors),'topFlavors',(select coalesce(jsonb_agg(jsonb_build_object('flavorId',id,'name',name,'pieces',pieces,'orderCount',orders)),'[]') from flavors),
  'missingFlavorRecipeCount',(select count(*) from items where jsonb_array_length(recipe)=0),
  'trend',(select coalesce(jsonb_agg(jsonb_build_object('start',start,'end',finish,'orderCount',orders,'paidOrderCount',paid,'approvedPaymentsCents',approved,'activePaidOrderCount',active,'currentOrderValueCents',value) order by start),'[]') from trend),
  'trendUnit',unit,'trendInterval',step) into result from rows;
 return result;
end $$;

create function elio.admin_production_core(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path='' as $$
 with rows as materialized (
  select * from elio.orders where coalesce(data->>'order_source','website')<>'in_person' and payment_status='paid' and not refund_label
   and fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed') and fulfillment_date between p_from and p_to
 ), items as materialized (
  select r.id,r.reference,r.created_at,row_number() over(order by r.created_at desc,r.id desc,i.item_index) as seen,r.fulfillment_status='completed' as served,i.item,i.item_index,elio.report_integer(i.item->'quantity') as quantity,
   case when coalesce(i.item->>'product_kind','')<>'' then i.item->>'product_kind'='custom_box' else coalesce(i.item->'selections','{}')?'flavors' end as custom,
   case when jsonb_typeof(i.item->'flavor_contents')='array' then i.item->'flavor_contents' else '[]'::jsonb end as recipe
  from rows r cross join lateral jsonb_array_elements(case when jsonb_typeof(r.data->'items')='array' then r.data->'items' else '[]'::jsonb end) with ordinality i(item,item_index)
  where coalesce(i.item->>'product_kind','') not in ('pos_item','event_item','custom_item') and coalesce(elio.report_integer(i.item->'quantity'),0)>0
 ), recipe as materialized (
  select i.*,coalesce(nullif(f.item->>'product_id',''),nullif(f.item->>'name','')) as flavor_id,
   coalesce(nullif(f.item->>'name',''),'Unnamed flavor') as flavor_name,elio.report_integer(f.item->'quantity') as per_box,f.flavor_index
  from items i cross join lateral jsonb_array_elements(i.recipe) with ordinality f(item,flavor_index)
  where coalesce(elio.report_integer(f.item->'quantity'),0)>0
 ), flavors as (
  select flavor_id,(array_agg(flavor_name order by created_at desc,id desc,item_index,flavor_index))[1] as name,sum(per_box*quantity) as pieces,
   coalesce(sum(per_box*quantity) filter(where served),0) as served,min(seen) as first_seen,(array_agg(flavor_index order by seen,flavor_index))[1] as first_flavor from recipe group by flavor_id
 ), parts as (
  select id,item_index,flavor_id,(array_agg(flavor_name order by flavor_index))[1] as name,sum(per_box) as quantity from recipe where flavor_id is not null group by id,item_index,flavor_id
 ), combinations as (
  select id,item_index,jsonb_agg(jsonb_build_array(flavor_id,quantity) order by flavor_id) as key,
   jsonb_agg(jsonb_build_object('id',flavor_id,'name',name,'quantity',quantity) order by flavor_id) as parts from parts group by id,item_index
 ), boxes as (
  select i.*,coalesce(nullif(i.item->>'product_id',''),i.item->>'name') as product,
   case when i.custom then coalesce(c.key,jsonb_build_array('unknown',i.id,i.item_index)) else '"fixed"'::jsonb end as combination_key,
   case when i.custom then coalesce(c.parts,'[]'::jsonb) else '[]'::jsonb end as combination_parts from items i left join combinations c using(id,item_index)
 ), sets as (
  select product,combination_key,(array_agg(coalesce(nullif(item->>'name',''),'Elio box') order by created_at desc,id desc,item_index))[1] as name,
   bool_or(custom) as custom,(array_agg(combination_parts order by created_at desc,id desc,item_index))[1] as parts,
   sum(quantity) as boxes,coalesce(sum(quantity) filter(where served),0) as served,min(seen) as first_seen from boxes group by product,combination_key
 )
 select jsonb_build_object('orders',(select count(*) from rows),'boxes',coalesce(sum(quantity),0),'pieces',(select coalesce(sum(pieces),0) from flavors),
  'fixed',coalesce(sum(quantity) filter(where not custom),0),'custom',coalesce(sum(quantity) filter(where custom),0),
  'servedBoxes',coalesce(sum(quantity) filter(where served),0),'servedPieces',(select coalesce(sum(served),0) from flavors),
  'flavors',(select coalesce(jsonb_agg(jsonb_build_object('id',flavor_id,'name',name,'pieces',pieces,'served',served) order by first_seen,first_flavor),'[]') from flavors),
  'sets',(select coalesce(jsonb_agg(jsonb_build_object('name',name,'kind',case when custom then 'Custom box' else 'Fixed set' end,'combination_parts',parts,'boxes',boxes,'served',served) order by first_seen),'[]') from sets),
  'missing',(select coalesce(jsonb_agg(reference order by created_at desc,id desc),'[]') from (select distinct id,reference,created_at from items where jsonb_array_length(recipe)=0) m)) from items
$$;

create function elio.admin_production(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare from_date date:=(p->>'from')::date; to_date date:=(p->>'to')::date;
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require(from_date is not null and to_date is not null and from_date::text=p->>'from' and to_date::text=p->>'to' and from_date<=to_date,'Choose a valid fulfillment date range.');
 return elio.admin_production_core(from_date,to_date)||jsonb_build_object('from',from_date,'to',to_date,'days',(
  select coalesce(jsonb_agg(elio.admin_production_core(day,day)||jsonb_build_object('date',day) order by day),'[]')
  from (select distinct fulfillment_date as day from elio.orders where coalesce(data->>'order_source','website')<>'in_person' and payment_status='paid' and not refund_label
   and fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed') and fulfillment_date between from_date and to_date) d));
end $$;

do $$
declare definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$h$ if p_action='admin_bootstrap' then$h$;
 orders_hook text:=$h$'orders',(select coalesce(jsonb_agg(elio.order_list_json(list_order) order by list_order.created_at desc),'[]') from elio.orders list_order)$h$;
begin
 perform elio.require(position(hook in definition)>0 and position(orders_hook in definition)>0,'Admin scoped-read migration markers missing.');
 definition:=replace(definition,hook,$patch$
 if p_action in ('admin_order_page','admin_order_ids','admin_order_export') then return elio.admin_order_page(p_action,p_payload); end if;
 if p_action='admin_analytics' then return elio.admin_analytics(p_payload); end if;
 if p_action='admin_production' then return elio.admin_production(p_payload); end if;
 $patch$||hook);
 definition:=replace(definition,orders_hook,$patch$'orders',case when p_payload->>'scope'='core' then '[]'::jsonb else (select coalesce(jsonb_agg(elio.order_list_json(list_order) order by list_order.created_at desc,list_order.id desc),'[]') from elio.orders list_order) end,
 'orders_mode',case when p_payload->>'scope'='core' then 'scoped' else 'complete' end,
 'reporting',case when p_payload->>'scope'='core' then elio.admin_core_summary() else null end$patch$);
 -- These reads use saved state. Bootstrap still processes expiry on refresh.
 -- Reporting must not hold the checkout mutation advisory lock.
 perform elio.require(position($marker$if p_action in ('catalog','quote','home_catalog','flavor_collection','faqs') then$marker$ in definition)>0,'Admin read-lock marker missing.');
 definition:=replace(definition,$marker$if p_action in ('catalog','quote','home_catalog','flavor_collection','faqs') then$marker$,
  $marker$if p_action in ('catalog','quote','home_catalog','flavor_collection','faqs','admin_order_page','admin_order_ids','admin_order_export','admin_analytics','admin_production') then$marker$);
 execute definition;
end $$;
revoke all on function elio.admin_order_matches(elio.orders,jsonb),elio.admin_order_page(text,jsonb),elio.admin_core_summary(),elio.report_integer(jsonb),elio.admin_analytics(jsonb),elio.admin_production_core(date,date),elio.admin_production(jsonb) from public,anon,authenticated,service_role;
