begin;

-- Keep the existing recipe/allocation model, but save a standalone product and
-- its one-unit stock together. A failed or stale edit rolls back both records.
create function elio.pos_save_event_simple_item(p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare eid uuid:=(p->>'event_id')::uuid;pid uuid:=(p->>'id')::uuid;sid uuid:=(p->>'stock_id')::uuid;
 it elio.pos_event_items;st elio.pos_event_stock;stock_result jsonb;result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);perform pg_advisory_xact_lock(841721950318::bigint);
 perform elio.require(exists(select 1 from elio.pos_events where id=eid and deleted_at is null),'Choose an existing event.');
 select * into it from elio.pos_event_items where id=pid;
 select * into st from elio.pos_event_stock where id=sid;
 perform elio.require(pid is not null and sid is not null,'Product and stock identifiers are required.');
 perform elio.require(it.id is null or it.event_id=eid and it.deleted_at is null and it.kind='event_item' and it.source_product_id is null,'Choose a standalone event product.');
 perform elio.require(it.id is null and st.id is null or it.id is not null and st.event_id=eid and st.deleted_at is null and st.stock_type='item' and st.variant_item_id is null and st.source_product_id is null
  and it.recipe=jsonb_build_array(jsonb_build_object('stock_id',sid,'quantity',1)),'This product must use its own stock, one unit per sale.');
 perform elio.require(not exists(select 1 from elio.pos_event_items x where x.id<>pid and x.deleted_at is null and
  (exists(select 1 from jsonb_array_elements(x.recipe) r where r->>'stock_id'=sid::text) or sid=any(x.choice_stock_ids))),'This stock is shared with another item. Edit its shared recipe instead.');
 perform elio.require(p->>'available' ~ '^[0-9]+$' and jsonb_typeof(p->'available')='number' and (p->>'available')::numeric between 0 and 1000000,'Enter whole available stock from 0 to 1,000,000.');
 perform elio.require(p->>'price_cents' ~ '^[0-9]+$' and (p->>'price_cents')::numeric between 0 and 100000000,'Enter a valid event price.');
 perform elio.require((it.id is null and coalesce((p->>'revision')::int,0)=0) or it.revision=(p->>'revision')::int,'This product changed. Refresh first.');
 stock_result:=elio.pos_event_action('pos_save_event_stock',jsonb_build_object('event_id',eid,'id',sid,
  'name',p->>'name','stock_type','item','available',p->'available','expected_available',p->'expected_available','revision',p->'stock_revision',
  'surcharge_cents',0,'reason',coalesce(nullif(trim(p->>'reason'),''),'Product stock updated')));
 result:=elio.pos_event_action('pos_save_event_item',jsonb_build_object('event_id',eid,'id',pid,'revision',p->'revision',
  'name',p->>'name','price_cents',p->'price_cents','active',coalesce((p->>'active')::boolean,true),
  'recipe',jsonb_build_array(jsonb_build_object('stock_id',sid,'quantity',1))));
 return result||jsonb_build_object('stock',stock_result);
end $$;
revoke all on function elio.pos_save_event_simple_item(jsonb) from public,anon,authenticated,service_role;
do $$ declare definition text;old text:=$a$if p_action='pos_catalog' then$a$;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 perform elio.require(position(old in definition)>0,'Missing simple event product dispatch hook.');
 execute replace(definition,old,$b$if p_action='pos_save_event_simple_item' then return elio.pos_save_event_simple_item(p_payload);end if;
 if p_action='pos_catalog' then$b$);
end $$;
commit;
