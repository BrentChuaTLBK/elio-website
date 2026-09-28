begin;

-- Calendar summaries use order snapshots; no payment credentials or private notes.
create or replace function elio.calendar_order(o elio.orders) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when o.payment_status='paid' and not o.refund_label
  and coalesce(o.data->>'order_source','website')<>'in_person'
  and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed') then
 jsonb_build_object('id',o.id,'reference',o.reference,'date',o.fulfillment_date,'method',o.method,
  'status',o.fulfillment_status,'total_cents',o.data->'total_cents',
  'buyer',jsonb_build_object('name',o.data#>>'{buyer,name}','phone',o.data#>>'{buyer,phone}','email',o.data#>>'{buyer,email}',
   'social_platform',o.data#>>'{buyer,social_platform}','social_username',o.data#>>'{buyer,social_username}'),
  'recipient',jsonb_build_object('name',o.data#>>'{recipient,name}','phone',o.data#>>'{recipient,phone}'),
  'address',jsonb_build_object('line1',o.data#>>'{address,line1}','line2',o.data#>>'{address,line2}',
   'locality',o.data#>>'{address,locality}','postal_code',o.data#>>'{address,postal_code}'),
  'instructions',o.data->>'instructions','pickup_address',o.data->>'pickup_address',
  'window',case when o.method='pickup' then o.data->>'pickup_hours' else o.data->>'delivery_window' end,
  'items',coalesce((select jsonb_agg(jsonb_build_object('name',v->>'name','quantity',v->'quantity',
   'selection_labels',coalesce(v->'selection_labels','[]'::jsonb),'flavor_contents',coalesce(v->'flavor_contents','[]'::jsonb)))
   from jsonb_array_elements(coalesce(o.data->'items','[]')) v),'[]'::jsonb)) end
$$;

-- Preserve event IDs and dates while refreshing the richer saved summaries.
do $$ begin
 perform 1 from elio.calendar_connection where id for update;
 insert into elio.calendar_events(order_id,desired,event_id)
 select o.id,elio.calendar_order(o),'elio'||replace(o.id::text,'-','')||'g0'
 from elio.orders o where elio.calendar_order(o) is not null
 on conflict(order_id) do update set desired=excluded.desired,revision=elio.calendar_events.revision+1,
  next_attempt_at=clock_timestamp(),attempts=0,last_error=null,updated_at=clock_timestamp()
 where elio.calendar_events.desired is distinct from excluded.desired;
 if found then begin perform elio.calendar_wake();exception when others then null;end;end if;
end $$;

commit;
