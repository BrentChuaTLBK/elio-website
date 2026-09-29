begin;
-- Manual downloads may optionally include unserved, unpaid website/direct orders.
-- Automatic recovery continues using paid_order_recovery_snapshot unchanged.
create function elio.manual_order_recovery(p_scope text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; unpaid jsonb; ids uuid[];
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(p_scope in ('paid_review','all_unserved'),'Choose a valid backup scope.');
 result:=elio.paid_order_recovery_snapshot()||jsonb_build_object('download_scope',p_scope);
 if p_scope='paid_review' then return result; end if;
 select coalesce(jsonb_agg(elio.order_json(o.id,true,false) order by fulfillment_date,id),'[]'),coalesce(array_agg(o.id),'{}') into unpaid,ids
 from elio.orders o where o.payment_status in ('awaiting_payment','rejected')
 and o.fulfillment_status not in ('completed','cancelled','expired','refunded') and not o.refund_label
 and coalesce(o.data->>'order_source','website')<>'in_person';
 result:=result||jsonb_build_object('unpaid_orders',unpaid,'unpaid_count',jsonb_array_length(unpaid),
 'active_order_ids',(result->'active_order_ids')||to_jsonb(ids),
 'active_count',(result->>'active_count')::integer+cardinality(ids),
 'active_total_cents',(result->>'active_total_cents')::bigint+(select coalesce(sum((o->>'total_cents')::bigint),0) from jsonb_array_elements(unpaid)o),
 'allocations',(result->'allocations')||(select coalesce(jsonb_agg(to_jsonb(a) order by order_id,product_id,date),'[]') from elio.allocations a where order_id=any(ids)),
 'payments',(result->'payments')||(select coalesce(jsonb_agg(to_jsonb(p) order by order_id),'[]') from elio.payments p where order_id=any(ids)));
 result:=result||jsonb_build_object(
 'products',(select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]') from elio.products p where p.id in(
 select (v->>'id')::uuid from jsonb_array_elements(result->'products')v union
 select (i->>'product_id')::uuid from jsonb_array_elements(unpaid)o cross join lateral jsonb_array_elements(o->'items')i union
 select (a->>'product_id')::uuid from jsonb_array_elements(result->'allocations')a)),
 'inventory',(select coalesce(jsonb_agg(to_jsonb(i) order by product_id,date),'[]') from elio.inventory i where exists(select 1 from jsonb_array_elements(result->'allocations')a where i.product_id=(a->>'product_id')::uuid and i.date=(a->>'date')::date)));
 return result;
end $$;
revoke all on function elio.manual_order_recovery(text) from public,anon,authenticated,service_role;
do $$declare definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);hook text:=$h$ if p_action='admin_bootstrap' then$h$;begin
 perform elio.require(position(hook in definition)>0,'Missing admin dispatch hook.');
 execute replace(definition,hook,$new$ if p_action='manual_order_recovery' then return elio.manual_order_recovery(coalesce(p_payload->>'scope','paid_review')); end if;
$new$||hook);
end $$;
commit;

