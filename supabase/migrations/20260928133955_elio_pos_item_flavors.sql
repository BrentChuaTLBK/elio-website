begin;
alter table elio.pos_event_items drop constraint pos_event_items_kind_check;
alter table elio.pos_event_items add constraint pos_event_items_kind_check check(kind in ('event_item','custom_box','variant_item'));
alter table elio.pos_event_stock add column variant_item_id uuid references elio.pos_event_items(id);
create index pos_event_stock_variant_idx on elio.pos_event_stock(variant_item_id) where variant_item_id is not null;
alter table elio.pos_event_stock add constraint pos_event_variant_stock_type check(variant_item_id is null or stock_type='item');

create function elio.pos_save_event_variant_item(p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare eid uuid:=(p->>'event_id')::uuid;pid uuid:=(p->>'id')::uuid;it elio.pos_event_items;st elio.pos_event_stock;v jsonb;sid uuid;seen uuid[]:='{}';choices uuid[]:='{}';saved jsonb;before_value jsonb;result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);perform pg_advisory_xact_lock(841721950318::bigint);
 perform elio.require(exists(select 1 from elio.pos_events where id=eid and deleted_at is null),'Choose an existing event.');
 select * into it from elio.pos_event_items where id=pid;
 perform elio.require(pid is not null and (it.id is null or it.event_id=eid and it.deleted_at is null and it.kind in ('event_item','variant_item') and it.source_product_id is null),'Choose a custom event product that has not been deleted.');
 perform elio.require((it.id is null and coalesce((p->>'revision')::integer,0)=0) or it.revision=(p->>'revision')::integer,'This event item changed. Refresh first.');
 perform elio.require(length(trim(p->>'name')) between 1 and 160 and p->>'price_cents' ~ '^[0-9]+$' and (p->>'price_cents')::numeric between 0 and 100000000,'Enter a product name and valid base price.');
 perform elio.require(jsonb_typeof(p->'variants')='array' and jsonb_array_length(p->'variants') between 1 and 50,'Add 1 to 50 product flavors.');
 perform elio.require((select count(distinct value->>'id') from jsonb_array_elements(p->'variants'))=jsonb_array_length(p->'variants'),'Each flavor must appear once.');
 perform elio.require((select count(distinct lower(trim(value->>'name'))) from jsonb_array_elements(p->'variants'))=jsonb_array_length(p->'variants'),'Use a different name for each flavor.');
 before_value:=jsonb_build_object('item',to_jsonb(it),'flavors',(select jsonb_agg(to_jsonb(s)) from elio.pos_event_stock s where variant_item_id=pid));
 insert into elio.pos_event_items(id,event_id,name,price_cents,recipe,kind,active) values(pid,eid,trim(p->>'name'),(p->>'price_cents')::integer,'[]','variant_item',coalesce((p->>'active')::boolean,true))
 on conflict(id) do update set name=excluded.name,price_cents=excluded.price_cents,recipe='[]',kind='variant_item',active=excluded.active,revision=elio.pos_event_items.revision+1;
 for v in select value from jsonb_array_elements(p->'variants') loop
  sid:=(v->>'id')::uuid;select * into st from elio.pos_event_stock where id=sid;
  perform elio.require(sid is not null and (st.id is null or st.event_id=eid and st.variant_item_id=pid and st.deleted_at is null),'Flavor stock must belong to this product and event.');
  perform elio.require(jsonb_typeof(v->'available')='number' and v->>'available' ~ '^[0-9]+$' and (v->>'available')::numeric between 0 and 1000000,'Enter whole flavor stock from 0 to 1,000,000.');
  perform elio.require(v->>'surcharge_cents' ~ '^[0-9]+$' and (v->>'surcharge_cents')::numeric between 0 and 100000000,'Enter a valid additional surcharge.');
  saved:=elio.pos_event_action('pos_save_event_stock',jsonb_build_object('event_id',eid,'id',sid,'name',v->>'name','stock_type','item','available',v->'available','expected_available',v->'expected_available','revision',v->'revision','surcharge_cents',v->'surcharge_cents','reason',coalesce(nullif(trim(p->>'reason'),''),'Product flavor setup')));
  update elio.pos_event_stock set variant_item_id=pid where id=sid;
  seen:=array_append(seen,sid);if coalesce((v->>'active')::boolean,true) then choices:=array_append(choices,sid);end if;
 end loop;
 perform elio.require(cardinality(choices)>0 or not coalesce((p->>'active')::boolean,true),'Enable at least one flavor before offering this product for sale.');
 update elio.pos_event_stock set deleted_at=clock_timestamp(),revision=revision+1 where variant_item_id=pid and deleted_at is null and not(id=any(seen));
 update elio.pos_event_items set choice_stock_ids=choices where id=pid returning to_jsonb(pos_event_items) into result;
 insert into elio.pos_audit(actor,action,target_id,reason,before_data,after_data) values(auth.uid(),'pos_save_event_variant_item',pid,coalesce(p->>'reason','Product flavors updated'),before_value,jsonb_build_object('item',result,'flavors',(select jsonb_agg(to_jsonb(s)) from elio.pos_event_stock s where variant_item_id=pid)));
 return result;
end $$;
revoke all on function elio.pos_save_event_variant_item(jsonb) from public,anon,authenticated,service_role;

-- Extend stock availability, selection validation and pricing through existing order/accounting paths.
do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_event_item_remaining(uuid)'::regprocedure);
 old:=$a$when i.kind='custom_box' then$a$;
 replacement:=$b$when i.kind='variant_item' then coalesce((select sum(greatest(0,elio.pos_event_remaining(s.id))) from elio.pos_event_stock s where s.id=any(i.choice_stock_ids) and s.variant_item_id=i.id and s.event_id=i.event_id and s.deleted_at is null),0)::integer
 when i.kind='custom_box' then$b$;
 perform elio.require(position(old in definition)>0,'Missing variant availability hook.');execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('elio.pos_event_action(text,jsonb)'::regprocedure);
 old:=$a$where pid=any(i.choice_stock_ids) and i.deleted_at is null$a$;
 perform elio.require(position(old in definition)>0,'Missing variant stock type hook.');definition:=replace(definition,old,old||$a$ and i.kind='custom_box'$a$);
 old:=$a$and event_id=eid and deleted_at is null),'Every included stock item$a$;
 perform elio.require(position(old in definition)>0,'Missing recipe stock hook.');definition:=replace(definition,old,$b$and event_id=eid and deleted_at is null and variant_item_id is null),'Every included stock item$b$);execute definition;
 definition:=pg_get_functiondef('elio.pos_event_quote(jsonb,uuid)'::regprocedure);
 -- Find the saved line before applying current configuration rules, so old order snapshots survive conversion.
 old:=$a$sels:=coalesce(v_item->'selections','{}');$a$;
 replacement:=old||$b$
 old_item:=null;
 if original.id is not null then select value into old_item from jsonb_array_elements(original.data->'items') where value->>'product_id'=it.id::text and coalesce(value->'selections','{}')=sels limit 1;end if;
 if old_item is null then$b$;
 perform elio.require(position(old in definition)>0,'Missing variant selection hook.');definition:=replace(definition,old,replacement);
 old:=$a$else perform elio.require(sels='{}'::jsonb,'Event items use their saved flavor recipe.');end if;$a$;
 replacement:=$b$elsif it.kind='variant_item' then
 perform elio.require(jsonb_typeof(sels)='object' and sels-'flavors'='{}'::jsonb and jsonb_typeof(sels->'flavors')='object','Choose one product flavor.');
 perform elio.require((select count(*) from jsonb_each(sels->'flavors'))=1 and not exists(select 1 from jsonb_each(sels->'flavors') where value<>'1'::jsonb),'Choose exactly one product flavor.');
 else perform elio.require(sels='{}'::jsonb,'Event items use their saved flavor recipe.');end if;
 end if;$b$;
 perform elio.require(position(old in definition)>0,'Missing variant single choice hook.');definition:=replace(definition,old,replacement);
 old:=$a$usable:=ev.deleted_at is null and it.deleted_at is null and it.active;$a$;
 replacement:=old||$b$
 if it.kind='variant_item' then
 usable:=usable and coalesce(jsonb_typeof(sels->'flavors')='object',false) and coalesce((select count(*)=1 and bool_and(value='1') from jsonb_each_text(sels->'flavors')),false)
 and not exists(select 1 from jsonb_each_text(sels->'flavors') c where not exists(select 1 from elio.pos_event_stock s where s.id=c.key::uuid and s.id=any(it.choice_stock_ids) and s.variant_item_id=it.id and s.event_id=ev.id and s.deleted_at is null));
 end if;$b$;
 perform elio.require(position(old in definition)>0,'Missing variant usability hook.');definition:=replace(definition,old,replacement);
 old:=$a$elsif it.kind='custom_box' then
 recipe:='[]';$a$;
 perform elio.require(position(old in definition)>0,'Missing variant price hook.');definition:=replace(definition,old,$b$elsif it.kind in ('custom_box','variant_item') then
 recipe:='[]';$b$);execute definition;
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);old:=$a$if p_action='pos_catalog' then$a$;
 perform elio.require(position(old in definition)>0,'Missing variant dispatch hook.');execute replace(definition,old,$b$if p_action='pos_save_event_variant_item' then return elio.pos_save_event_variant_item(p_payload);end if;
 if p_action='pos_catalog' then$b$);
end $$;
commit;
