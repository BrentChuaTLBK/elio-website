begin;

-- Aggregate each ledger separately before joining so multiple codes, orders and
-- payments never multiply sales or commissions. Balances remain per affiliate.
create function elio.affiliate_admin_overview() returns jsonb
language sql stable security invoker set search_path='' as $$
 with orders as (
  select affiliate_id,
   coalesce(sum(net_sales_cents) filter(where status in ('earned','awaiting_completion')),0)::bigint as net_sales_cents,
   count(*) filter(where status in ('earned','awaiting_completion')) as paid_orders,
   count(*) filter(where status='earned') as completed_orders,
   coalesce(sum(estimated_cents) filter(where status='awaiting_completion'),0)::bigint as estimated_cents,
   coalesce(sum(earned_cents),0)::bigint as earned_cents
  from elio.affiliate_orders group by affiliate_id
 ), payments as (
  select affiliate_id,sum(amount_cents)::bigint as paid_cents from elio.affiliate_payouts where status='paid' group by affiliate_id
 ), codes as (
  select affiliate_id,count(*) as code_count from elio.affiliate_codes group by affiliate_id
 ), partners as (
  select a.id,a.name,a.active,a.commission_bps,a.revision,u.email,
   coalesce(c.code_count,0) as code_count,coalesce(o.net_sales_cents,0) as net_sales_cents,
   coalesce(o.paid_orders,0) as paid_orders,coalesce(o.completed_orders,0) as completed_orders,
   coalesce(o.estimated_cents,0) as estimated_cents,coalesce(o.earned_cents,0) as earned_cents,
   coalesce(p.paid_cents,0) as paid_cents,coalesce(o.earned_cents,0)-coalesce(p.paid_cents,0) as balance_cents
  from elio.affiliates a join auth.users u on u.id=a.user_id
  left join orders o on o.affiliate_id=a.id left join payments p on p.affiliate_id=a.id left join codes c on c.affiliate_id=a.id
 )
 select jsonb_build_object(
  'affiliates',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name,p.id),'[]') from partners p),
  'stats',(select jsonb_build_object('affiliates',count(*),'active_affiliates',count(*) filter(where active),
   'net_sales_cents',coalesce(sum(net_sales_cents),0),'paid_orders',coalesce(sum(paid_orders),0),
   'completed_orders',coalesce(sum(completed_orders),0),'earned_cents',coalesce(sum(earned_cents),0),
   'estimated_cents',coalesce(sum(estimated_cents),0),'paid_cents',coalesce(sum(paid_cents),0),
   'payable_cents',coalesce(sum(greatest(balance_cents,0)),0),'offset_cents',coalesce(sum(greatest(-balance_cents,0)),0)
  ) from partners),
  'top_affiliates',(select coalesce(jsonb_agg(to_jsonb(p) order by p.net_sales_cents desc,p.paid_orders desc,p.name,p.id),'[]')
   from (select * from partners where paid_orders>0 order by net_sales_cents desc,paid_orders desc,name,id limit 5)p),
  'generated_at',statement_timestamp());
$$;
revoke all on function elio.affiliate_admin_overview() from public,anon,authenticated,service_role;

do $$
declare definition text; start_pos integer;end_pos integer;
begin
 definition:=pg_get_functiondef('elio.affiliate_api(text,jsonb)'::regprocedure);
 start_pos:=position('  return jsonb_build_object(''affiliates''' in definition);
 end_pos:=position(' elsif p_action=''affiliate_report''' in definition);
 perform elio.require(start_pos>0 and end_pos>start_pos,'Missing affiliate admin report branch.');
 execute left(definition,start_pos-1)||'  return elio.affiliate_admin_overview();'||E'\n'||substr(definition,end_pos);
end $$;
commit;
