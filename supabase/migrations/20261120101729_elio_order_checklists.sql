begin;

create table elio.order_preparation_checks (
  order_id uuid primary key references elio.orders(id) on delete cascade,
  content_key text not null
);
alter table elio.order_preparation_checks enable row level security;
revoke all on elio.order_preparation_checks from public, anon, authenticated, service_role;

-- Compile the same saved kitchen details for the screen, paper, and stale-edit check.
create view elio.order_checklist_rows with (security_invoker = true) as
select o.id, o.reference, o.fulfillment_date, o.method, o.payment_status, o.fulfillment_status as status,
  coalesce(o.data->>'order_source','website') as source,
  jsonb_build_object('name', o.data#>>'{buyer,name}') as buyer,
  case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end as window,
  coalesce(o.data->>'instructions','') as instructions, kitchen.items,
  encode(sha256(convert_to(jsonb_build_array(kitchen.items,coalesce(o.data->>'instructions',''))::text,'UTF8')),'hex') as content_key,
  coalesce(o.data->>'order_source','website') <> 'in_person'
    and o.fulfillment_status not in ('expired','completed')
    and o.payment_status in ('awaiting_payment','under_review','paid')
    and (o.data->>'order_source'='direct' or o.payment_status <> 'awaiting_payment'
      or o.fulfillment_status <> 'pending_confirmation'
      or elio.maintenance_deadline(o.payment_deadline,o.created_at,statement_timestamp()) > statement_timestamp()) as open
from elio.orders o
cross join lateral (
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',i.item->'product_id', 'quantity',i.item->'quantity',
    'name',coalesce(nullif(i.item->>'name',''),i.item->>'custom_name'),
    'description',coalesce(nullif(i.item->>'description',''),i.item->>'custom_description'),
    'selection_labels',i.item->'selection_labels', 'flavor_contents',i.item->'flavor_contents',
    'selections',i.item->'selections'
  ) order by i.position),'[]'::jsonb) as items
  from jsonb_array_elements(coalesce(o.data->'items','[]'::jsonb)) with ordinality as i(item,position)
) kitchen
where not o.refund_label and o.fulfillment_status <> 'cancelled' and o.payment_status <> 'cancelled';
revoke all on elio.order_checklist_rows from public, anon, authenticated, service_role;

create function elio.order_checklist(p_action text, p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  oid uuid;
  current_key text;
  mark boolean;
  first_date date;
  last_date date;
begin
  perform elio.assert_staff(auth.uid(),false);
  perform elio.require(elio.is_verified(auth.uid()),'Verify your staff email to use the order checklist.');
  if p_action='order_checklist' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'reference',r.reference,'fulfillment_date',r.fulfillment_date,'method',r.method,
      'buyer',r.buyer,'items',r.items,'instructions',r.instructions,'payment_status',r.payment_status,
      'content_key',r.content_key,'prepared',c.order_id is not null
    ) order by r.fulfillment_date,r.reference,r.id),'[]'::jsonb)
    from elio.order_checklist_rows r
    left join elio.order_preparation_checks c on (c.order_id,c.content_key)=(r.id,r.content_key)
    where r.open);
  elsif p_action='order_checklist_period' then
    perform elio.require(p_payload->>'from' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and p_payload->>'to' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$','Choose valid fulfillment dates.');
    first_date := (p_payload->>'from')::date;
    last_date := (p_payload->>'to')::date;
    perform elio.require(last_date-first_date between 0 and 62,'Choose up to 63 consecutive fulfillment dates per request.');
    return jsonb_build_object('orders',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',r.id,'reference',r.reference,'date',r.fulfillment_date,'source',r.source,'method',r.method,
      'status',r.status,'payment_status',r.payment_status,'buyer',r.buyer,'window',r.window,
      'items',r.items,'instructions',r.instructions
    ) order by r.fulfillment_date,r.reference,r.id),'[]'::jsonb)
    from elio.order_checklist_rows r where r.fulfillment_date between first_date and last_date));
  end if;

  perform elio.require(p_action='set_order_prepared' and jsonb_typeof(p_payload->'prepared')='boolean'
    and p_payload->>'content_key' ~ '^[0-9a-f]{64}$','Choose a valid order and preparation state.');
  oid := (p_payload->>'order_id')::uuid;
  mark := (p_payload->>'prepared')::boolean;
  perform 1 from elio.orders where id=oid for update;
  select r.content_key into current_key from elio.order_checklist_rows r where r.id=oid and r.open;
  perform elio.require(found,'This order is no longer on the checklist.');
  perform elio.require(current_key=p_payload->>'content_key','Order details changed. Refresh the checklist and review the updated order.');
  if mark then
    insert into elio.order_preparation_checks as c(order_id,content_key) values(oid,current_key)
    on conflict(order_id) do update set content_key=excluded.content_key where c.content_key<>excluded.content_key;
  else
    delete from elio.order_preparation_checks where order_id=oid;
  end if;
  return jsonb_build_object('prepared',mark);
end $$;
revoke all on function elio.order_checklist(text,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
  definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  anchor text:=' if p_action in (''calendar_list'',''calendar_sync_now'') then';
  branch text:=' if p_action in (''order_checklist'',''set_order_prepared'',''order_checklist_period'') then return elio.order_checklist(p_action,p_payload);end if;';
begin
  perform elio.require((length(definition)-length(replace(definition,anchor,'')))/length(anchor)=1,'Missing checklist dispatch hook.');
  execute replace(definition,anchor,branch||chr(10)||anchor);
end $patch$;
commit;
