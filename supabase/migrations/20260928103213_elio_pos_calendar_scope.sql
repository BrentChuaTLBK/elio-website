begin;
-- Direct pickup/delivery orders use the same calendar as website orders.
-- Event/in-person orders are excluded regardless of date or handed-over status.
do $$ declare definition text;old text;begin
 definition:=pg_get_functiondef('elio.calendar_order(elio.orders)'::regprocedure);
 old:=$hook$and not coalesce((o.data->>'pos_handed_over')::boolean,false)$hook$;
 perform elio.require(position(old in definition)>0,'POS calendar inclusion rule changed; review before deployment.');
 execute replace(definition,old,$replacement$and coalesce(o.data->>'order_source','website')<>'in_person'$replacement$);
 -- Reconcile any orders saved before the scope change, preserving event IDs.
 perform 1 from elio.calendar_connection where id for update;
 insert into elio.calendar_events(order_id,desired,event_id)
 select o.id,elio.calendar_order(o),'elio'||replace(o.id::text,'-','')||'g0'
 from elio.orders o where o.data->>'order_source'='direct' and elio.calendar_order(o) is not null
 on conflict(order_id) do update set desired=excluded.desired,revision=elio.calendar_events.revision+1,
 next_attempt_at=clock_timestamp(),attempts=0,last_error=null,updated_at=clock_timestamp()
 where elio.calendar_events.desired is distinct from excluded.desired;
 update elio.calendar_events e set desired=null,revision=e.revision+1,next_attempt_at=clock_timestamp(),attempts=0,last_error=null,updated_at=clock_timestamp()
 from elio.orders o where e.order_id=o.id and o.data->>'order_source'='in_person' and e.desired is not null;
end $$;
commit;
