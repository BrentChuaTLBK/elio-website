begin;
create function elio.pos_bulk_event_stock(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare eid uuid:=(p->>'event_id')::uuid; entry jsonb; stock elio.pos_event_stock; result jsonb:='[]'; reason text:=trim(p->>'reason');
begin
 perform elio.assert_staff(auth.uid(),true);
 perform pg_advisory_xact_lock(841721950318::bigint);
 perform elio.require(exists(select 1 from elio.pos_events where id=eid and deleted_at is null),'Choose an existing event that has not been deleted.');
 perform elio.require(jsonb_typeof(p->'items')='array','Choose stock quantities to update.');
 perform elio.require(jsonb_array_length(p->'items') between 1 and 200,'Update 1 to 200 stock items at a time.');
 perform elio.require((select count(distinct value->>'id') from jsonb_array_elements(p->'items'))=jsonb_array_length(p->'items'),'Each stock item must appear once.');
 perform elio.require(length(reason) between 1 and 1000,'Enter a stock adjustment reason.');
 for entry in select value from jsonb_array_elements(p->'items') loop
  perform elio.require(jsonb_typeof(entry->'available')='number' and entry->>'available' ~ '^[0-9]+$' and (entry->>'available')::numeric between 0 and 1000000,'Enter whole quantities between 0 and 1,000,000.');
  perform elio.require(jsonb_typeof(entry->'expected_available')='number' and entry->>'expected_available' ~ '^[0-9]+$' and jsonb_typeof(entry->'revision')='number' and entry->>'revision' ~ '^[0-9]+$','Refresh the event stock before saving.');
  select * into stock from elio.pos_event_stock where id=(entry->>'id')::uuid and event_id=eid and deleted_at is null;
  perform elio.require(stock.id is not null,'Every stock item must belong to this event and must not be deleted.');
  -- The existing writer checks revisions and remaining quantities and preserves allocations/audit history.
  result:=result||jsonb_build_array(elio.pos_event_action('pos_save_event_stock',jsonb_build_object(
    'event_id',eid,'id',stock.id,'revision',entry->'revision','expected_available',entry->'expected_available',
    'available',entry->'available','name',stock.name,'reason',reason)));
 end loop;
 return jsonb_build_object('updated',result);
end $$;
revoke all on function elio.pos_bulk_event_stock(jsonb) from public,anon,authenticated,service_role;
do $$ declare definition text;hook text:=$h$if p_action='pos_catalog' then$h$;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 perform elio.require(position(hook in definition)>0,'Missing POS bulk stock dispatch hook.');
 execute replace(definition,hook,$h$if p_action='pos_bulk_event_stock' then return elio.pos_bulk_event_stock(p_payload);end if;
 if p_action='pos_catalog' then$h$);
end $$;
commit;
