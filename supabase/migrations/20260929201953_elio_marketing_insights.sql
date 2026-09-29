begin;

alter table elio.newsletter_subscribers
 add column acquisition_source text,
 add column acquisition_basis text not null default 'captured';
update elio.newsletter_subscribers set
 acquisition_source=case when rejoin_count=0 then source else 'unknown' end,
 acquisition_basis=case when rejoin_count=0 then 'legacy_recorded' else 'unknown' end;
alter table elio.newsletter_subscribers alter column acquisition_source set not null;
alter table elio.newsletter_subscribers add constraint newsletter_acquisition_source_check
 check(acquisition_source in ('home_popup','home_footer','account','checkout','unknown'));
alter table elio.newsletter_subscribers add constraint newsletter_acquisition_basis_check
 check(acquisition_basis in ('captured','legacy_recorded','unknown'));
create function elio.preserve_newsletter_acquisition() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then new.acquisition_source:=new.source;new.acquisition_basis:='captured';
 else new.acquisition_source:=old.acquisition_source;new.acquisition_basis:=old.acquisition_basis;end if;
 return new;
end $$;
create trigger newsletter_acquisition before insert or update on elio.newsletter_subscribers
 for each row execute function elio.preserve_newsletter_acquisition();
create index newsletter_confirmed_cohort on elio.newsletter_subscribers(confirmed_at) where confirmed_at is not null;
create index vouchers_issued_cohort on elio.vouchers(issued_at,campaign_id);
create index orders_paid_customer_email on elio.orders(lower(btrim(data#>>'{buyer,email}')),created_at)
 where payment_status='paid' and not refund_label;

-- A fixed window per recipient. A younger group never shares a denominator
-- with a mature group. Money is authoritative order data, never browser events.
create function elio.marketing_cohort_rows(p_month date)
returns table(subject_id text,kind text,group_key text,label text,acquisition_basis text,promo_id uuid,email text,
 issued_at timestamptz,mature boolean,expires_at timestamptz,first_order_id uuid,first_paid_at timestamptz,
 paid_orders bigint,gross_cents bigint,discount_cents bigint,sales_cents bigint,later_customer boolean)
language sql stable security invoker set search_path='' as $$
 with subjects as (
  select 'newsletter:'||n.id subject_id,'newsletter' kind,n.acquisition_source group_key,n.acquisition_source label,
   n.acquisition_basis,n.promo_id,n.email,n.confirmed_at issued_at
  from elio.newsletter_subscribers n where n.confirmed_at is not null
  union all
  select 'campaign:'||v.promo_id,'campaign',v.campaign_id::text,c.name,'captured',v.promo_id,v.owner_email,v.issued_at
  from elio.vouchers v join elio.voucher_campaigns c on c.id=v.campaign_id join elio.orders source on source.id=v.source_order_id
  where source.data->>'is_test' is distinct from 'true'
 ), selected as (
  select s.*,s.issued_at+interval '30 days'<=statement_timestamp() mature,(p.data->>'expires_at')::timestamptz expires_at
  from subjects s left join elio.promos p on p.id=s.promo_id
  where s.issued_at>=p_month::timestamp at time zone 'Asia/Manila'
   and s.issued_at<(p_month+interval '1 month') at time zone 'Asia/Manila'
 )
 select s.*,first_use.order_id,first_use.approved_at,uses.paid_orders,uses.gross_cents,uses.discount_cents,uses.sales_cents,
  exists(select 1 from elio.orders later join elio.payments pay on pay.order_id=later.id
   where lower(btrim(later.data#>>'{buyer,email}'))=lower(btrim(s.email))
    and later.id<>first_use.order_id and later.created_at>first_use.approved_at
    and pay.approved_at>first_use.approved_at and pay.approved_at<s.issued_at+interval '30 days'
    and later.payment_status='paid' and not later.refund_label and later.fulfillment_status not in ('cancelled','expired')
    and coalesce(later.data->>'order_source','website')='website' and later.data->>'is_test' is distinct from 'true')
 from selected s
 left join lateral (
  select o.id order_id,pay.approved_at from elio.promo_usage u join elio.orders o on o.id=u.order_id join elio.payments pay on pay.order_id=o.id
  where u.promo_id=s.promo_id and o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired')
   and coalesce(o.data->>'order_source','website')='website' and o.data->>'is_test' is distinct from 'true'
   and pay.approved_at>=s.issued_at and pay.approved_at<s.issued_at+interval '30 days'
  order by pay.approved_at,o.id limit 1
 ) first_use on true
 cross join lateral (
  select count(*) paid_orders,coalesce(sum((o.data->>'subtotal_cents')::bigint),0)::bigint gross_cents,
   coalesce(sum((o.data->>'discount_cents')::bigint),0)::bigint discount_cents,
   coalesce(sum(greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint)),0)::bigint sales_cents
  from elio.promo_usage u join elio.orders o on o.id=u.order_id join elio.payments pay on pay.order_id=o.id
  where u.promo_id=s.promo_id and o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired')
   and coalesce(o.data->>'order_source','website')='website' and o.data->>'is_test' is distinct from 'true'
   and pay.approved_at>=s.issued_at and pay.approved_at<s.issued_at+interval '30 days'
 ) uses;
$$;

create function elio.marketing_insights(p_action text,p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare m date; month_text text:=coalesce(p->>'month',to_char(now() at time zone 'Asia/Manila','YYYY-MM'));
 offset_rows integer:=greatest(coalesce((p->>'offset')::integer,0),0);result jsonb;category text:=p->>'kind';group_id text:=p->>'group_key';
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(month_text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$','Choose a valid report month.');
 m:=(month_text||'-01')::date;
 perform elio.require(m between date '2000-01-01' and (date_trunc('month',now() at time zone 'Asia/Manila'))::date,'Choose a current or past report month.');
 perform elio.require(offset_rows<=1000000,'Choose a valid report page.');
 if p_action='marketing_insights' then
  with rows as materialized(select * from elio.marketing_cohort_rows(m)), groups as (
   select kind,group_key,max(label) label,count(*) people,count(promo_id) issued,
    count(*) filter(where mature) observed_people,count(promo_id) filter(where mature) eligible_issued,
    count(*) filter(where not mature) collecting,
    count(*) filter(where mature and paid_orders>0) redeemed,
    count(distinct email) filter(where mature and later_customer) later_customers,
    count(distinct email) filter(where mature and paid_orders>0) redeemed_customers,
    coalesce(sum(paid_orders) filter(where mature),0) paid_orders,
    coalesce(sum(gross_cents) filter(where mature),0) gross_cents,
    coalesce(sum(discount_cents) filter(where mature),0) discount_cents,
    coalesce(sum(sales_cents) filter(where mature),0) sales_cents,
    count(*) filter(where acquisition_basis<>'captured') legacy_attribution,
    min(issued_at+interval '30 days') filter(where not mature) next_ready_at
   from rows group by kind,group_key
  ) select jsonb_build_object('month',month_text,'window_days',30,'generated_at',statement_timestamp(),
   'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by kind,label,group_key),'[]') from groups g),
   'missing_payment_records',(select count(*) from elio.orders o where o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired')
     and coalesce(o.data->>'order_source','website')='website' and not exists(select 1 from elio.payments pay where pay.order_id=o.id))) into result;
  return result;
 elsif p_action='marketing_cohort_orders' then
  perform elio.require(category in ('newsletter','campaign') and length(group_id) between 1 and 80,'Choose a report group.');
  with subjects as materialized(select * from elio.marketing_cohort_rows(m) where kind=category and group_key=group_id and mature),
  related as (
   select o.id,o.reference,pay.approved_at,promo.code,s.issued_at,
    (o.data->>'subtotal_cents')::bigint gross_cents,(o.data->>'discount_cents')::bigint discount_cents,
    greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint) sales_cents
   from subjects s join elio.promo_usage usage on usage.promo_id=s.promo_id join elio.promos promo on promo.id=s.promo_id
   join elio.orders o on o.id=usage.order_id join elio.payments pay on pay.order_id=o.id
   where o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired')
    and coalesce(o.data->>'order_source','website')='website' and o.data->>'is_test' is distinct from 'true'
    and pay.approved_at>=s.issued_at and pay.approved_at<s.issued_at+interval '30 days'
  ), page as(select * from related order by approved_at desc,id limit 50 offset offset_rows)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(page) order by approved_at desc,id),'[]') from page),
   'total',(select count(*) from related),'limit',50,'offset',offset_rows,
   'totals',(select jsonb_build_object('gross_cents',coalesce(sum(gross_cents),0),'discount_cents',coalesce(sum(discount_cents),0),'sales_cents',coalesce(sum(sales_cents),0)) from related)) into result;
  return result;
 elsif p_action='marketing_affiliates' then
  with sales as (
   select a.affiliate_id,count(*) filter(where o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired') and not a.excluded_self) paid_orders,
    coalesce(sum(a.net_sales_cents) filter(where o.payment_status='paid' and not o.refund_label and o.fulfillment_status not in ('cancelled','expired') and not a.excluded_self),0) sales_cents,
    coalesce(sum(a.estimated_cents) filter(where a.status='awaiting_completion'),0) estimated_cents
   from elio.affiliate_orders a join elio.orders o on o.id=a.order_id group by a.affiliate_id
  ), ledger as (
   select l.affiliate_id,sum(l.amount_cents) earned_cents from elio.affiliate_ledger l group by l.affiliate_id
  ), payouts as (
   select affiliate_id,sum(amount_cents) paid_cents from elio.affiliate_payouts where status='paid' group by affiliate_id
  ), partners as(
   select a.id,a.name,a.active,coalesce(s.paid_orders,0) paid_orders,coalesce(s.sales_cents,0) sales_cents,
    coalesce(s.estimated_cents,0) estimated_cents,coalesce(l.earned_cents,0) earned_cents,coalesce(paid.paid_cents,0) paid_cents,
    coalesce(l.earned_cents,0)-coalesce(paid.paid_cents,0) balance_cents
   from elio.affiliates a left join sales s on s.affiliate_id=a.id left join ledger l on l.affiliate_id=a.id left join payouts paid on paid.affiliate_id=a.id
  ) select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(a) order by a.name,a.id),'[]') from partners a),
   'generated_at',statement_timestamp(),'scope','all_time') into result;return result;
 elsif p_action='marketing_affiliate_ledger' then
  perform elio.require(exists(select 1 from elio.affiliates where id=(p->>'id')::uuid),'Affiliate not found.');
  with entries as materialized(select l.id,l.order_id,o.reference,l.amount_cents,l.reason,l.created_at
   from elio.affiliate_ledger l join elio.orders o on o.id=l.order_id where l.affiliate_id=(p->>'id')::uuid),
  page as(select * from entries order by created_at desc,id limit 50 offset offset_rows)
  select jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id),'[]') from page),
   'total',(select count(*) from entries),'earned_cents',(select coalesce(sum(amount_cents),0) from entries),'limit',50,'offset',offset_rows) into result;
  return result;
 end if;
 raise exception 'Unknown marketing report.';
end $$;
revoke all on function elio.preserve_newsletter_acquisition(),elio.marketing_cohort_rows(date),elio.marketing_insights(text,jsonb) from public,anon,authenticated,service_role;
do $$ declare d text;h text:=$hook$ if p_action='account_access' then$hook$;begin
 d:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 perform elio.require(position(h in d)>0,'Missing marketing report dispatch hook.');
 execute replace(d,h,$new$ if p_action in ('marketing_insights','marketing_cohort_orders','marketing_affiliates','marketing_affiliate_ledger') then return elio.marketing_insights(p_action,p_payload);end if;
$new$||h);
end $$;
commit;
