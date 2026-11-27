begin;

do $migration$
declare
  definition text := pg_get_functiondef('elio.calendar_order(elio.orders)'::regprocedure);
  old_condition text := $old$select case when o.payment_status='paid' and not o.refund_label
  and coalesce(o.data->>'order_source','website')<>'in_person'
  and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed') then$old$;
  paid_view text := 'o.fulfillment_date between first_date and last_date and elio.calendar_order(o) is not null';
begin
  perform elio.require(position(old_condition in definition)>0,'Calendar inclusion hook changed.');
  definition:=replace(definition,old_condition,$new$select case when not o.refund_label
  and coalesce(o.data->>'order_source','website')<>'in_person'
  and (o.payment_status='paid' and o.fulfillment_status in ('confirmed','preparing','ready_for_pickup','out_for_delivery','completed')
    or o.payment_status in ('awaiting_payment','under_review','rejected') and o.fulfillment_status='pending_confirmation') then$new$);
  perform elio.require(position($old$'status',o.fulfillment_status,$old$ in definition)>0,'Calendar payment projection hook changed.');
  execute replace(definition,$old$'status',o.fulfillment_status,$old$,$new$'status',o.fulfillment_status,'payment_status',o.payment_status,$new$);

  -- The dashboard calendar and pickup/delivery handoff lists remain based on paid orders.
  definition:=pg_get_functiondef('elio.calendar_admin(text,jsonb)'::regprocedure);
  perform elio.require(length(definition)-length(replace(definition,paid_view,''))=length(paid_view)*2,
    'Expected both paid calendar read hooks.');
  execute replace(definition,paid_view,paid_view||$paid$ and o.payment_status='paid'$paid$);

  -- Do not rewrite synchronized paid events. Reschedule only existing open unpaid orders.
  perform 1 from elio.calendar_connection where id for update;
  insert into elio.calendar_events(order_id,desired,event_id)
  select o.id,elio.calendar_order(o),'elio'||replace(o.id::text,'-','')||'g0'
  from elio.orders o
  where o.payment_status in ('awaiting_payment','under_review','rejected') and elio.calendar_order(o) is not null
  on conflict(order_id) do update set desired=excluded.desired,revision=elio.calendar_events.revision+1,
    next_attempt_at=clock_timestamp(),attempts=0,last_error=null,updated_at=clock_timestamp()
  where elio.calendar_events.desired is distinct from excluded.desired;
end
$migration$;

-- The existing minute-by-minute expiry process changes the order state. The
-- order trigger then leaves a tombstone for the normal Google sync worker.
commit;
