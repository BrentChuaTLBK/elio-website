begin;
alter table elio.pos_events add column deleted_at timestamptz;
alter table elio.pos_event_stock add column deleted_at timestamptz,add column source_product_id uuid,add column surcharge_cents integer not null default 0 check(surcharge_cents between 0 and 100000000);
alter table elio.pos_event_items add column deleted_at timestamptz,add column source_product_id uuid,add column kind text not null default 'event_item' check(kind in ('event_item','custom_box')),add column choice_stock_ids uuid[] not null default '{}';
create unique index pos_event_stock_import_unique on elio.pos_event_stock(event_id,source_product_id) where source_product_id is not null and deleted_at is null;
create unique index pos_event_item_import_unique on elio.pos_event_items(event_id,source_product_id) where source_product_id is not null and deleted_at is null;

create function elio.pos_event_item_remaining(p_id uuid) returns integer language sql stable set search_path='' as $$
 select case when not i.active or i.deleted_at is not null then 0
 when i.kind='custom_box' then coalesce((select sum(greatest(0,elio.pos_event_remaining(s.id)))::bigint/3 from elio.pos_event_stock s where s.id=any(i.choice_stock_ids) and s.event_id=i.event_id and s.deleted_at is null),0)::integer
 when exists(select 1 from jsonb_array_elements(i.recipe) r left join elio.pos_event_stock s on s.id=(r->>'stock_id')::uuid and s.event_id=i.event_id where s.id is null or s.deleted_at is not null) then 0
 else coalesce((select min(greatest(0,elio.pos_event_remaining((r->>'stock_id')::uuid))/(r->>'quantity')::integer) from jsonb_array_elements(i.recipe) r),0) end
 from elio.pos_event_items i where i.id=p_id
$$;

create function elio.pos_import_event_stock(p_event uuid,p_product uuid) returns uuid language plpgsql set search_path='' as $$
declare sid uuid;flavor jsonb;
begin
 select id into sid from elio.pos_event_stock where event_id=p_event and source_product_id=p_product and deleted_at is null;
 if sid is not null then return sid;end if;
 select data into flavor from elio.products where id=p_product and deleted_at is null and data->>'kind'='flavor' and coalesce((data->>'active')::boolean,false);
 perform elio.require(flavor is not null,'A required website flavor is unavailable. Update the website product first.');
 insert into elio.pos_event_stock(event_id,source_product_id,name,capacity,surcharge_cents) values(p_event,p_product,flavor->>'name',0,coalesce((flavor->>'price_cents')::integer,0)) returning id into sid;
 return sid;
end $$;

create function elio.pos_event_catalog_action(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare ev elio.pos_events;it elio.pos_event_items;st elio.pos_event_stock;eid uuid:=(p->>'event_id')::uuid;pid uuid:=(p->>'id')::uuid;
 product_id uuid;product jsonb;component record;recipe jsonb;choices uuid[];sid uuid;result jsonb;before_value jsonb;imported jsonb:='[]';skipped integer:=0;stock_before integer;
begin
 perform elio.assert_staff(auth.uid(),true);perform pg_advisory_xact_lock(841721950318::bigint);
 select * into ev from elio.pos_events where id=eid for update;perform elio.require(ev.id is not null,'Event not found.');
 if p_action='pos_delete_event' and ev.deleted_at is not null then return to_jsonb(ev);end if;
 perform elio.require(ev.deleted_at is null,'This event was deleted. Its reports and orders remain available.');
 if p_action='pos_delete_event' then
 perform elio.require(ev.revision=(p->>'revision')::integer,'This event changed. Refresh first.');before_value:=to_jsonb(ev);
 update elio.pos_events set deleted_at=clock_timestamp(),active=false,revision=revision+1 where id=eid returning to_jsonb(pos_events) into result;
 elsif p_action='pos_delete_event_stock' then
 select * into st from elio.pos_event_stock where id=pid and event_id=eid;
 perform elio.require(st.id is not null,'Stock item not found.');if st.deleted_at is not null then return to_jsonb(st);end if;
 perform elio.require(st.revision=(p->>'revision')::integer,'This stock item changed. Refresh first.');before_value:=to_jsonb(st);
 update elio.pos_event_stock set deleted_at=clock_timestamp(),revision=revision+1 where id=pid returning to_jsonb(pos_event_stock) into result;
 update elio.pos_event_items set active=false,revision=revision+1 where event_id=eid and deleted_at is null and kind='event_item' and exists(select 1 from jsonb_array_elements(elio.pos_event_items.recipe) r where r->>'stock_id'=pid::text);
 update elio.pos_event_items set choice_stock_ids=array_remove(choice_stock_ids,pid),active=active and cardinality(array_remove(choice_stock_ids,pid))>0,revision=revision+1 where event_id=eid and deleted_at is null and pid=any(choice_stock_ids);
 elsif p_action='pos_delete_event_item' then
 select * into it from elio.pos_event_items where id=pid and event_id=eid;
 perform elio.require(it.id is not null,'Event item not found.');if it.deleted_at is not null then return to_jsonb(it);end if;
 perform elio.require(it.revision=(p->>'revision')::integer,'This event item changed. Refresh first.');before_value:=to_jsonb(it);
 update elio.pos_event_items set deleted_at=clock_timestamp(),active=false,revision=revision+1 where id=pid returning to_jsonb(pos_event_items) into result;
 elsif p_action='pos_save_event_choice_item' then
 select * into it from elio.pos_event_items where id=pid and event_id=eid;
 perform elio.require(it.id is not null and it.kind='custom_box' and it.deleted_at is null,'Choose an existing event custom box.');
 perform elio.require(it.revision=(p->>'revision')::integer,'This event item changed. Refresh first.');before_value:=to_jsonb(it);
 perform elio.require(length(trim(p->>'name')) between 1 and 160 and (p->>'price_cents')::integer between 0 and 100000000,'Enter an item name and valid base price.');
 perform elio.require(jsonb_typeof(p->'choice_stock_ids')='array' and jsonb_array_length(p->'choice_stock_ids') between 1 and 50,'Choose the event flavors available in this custom box.');
 select array_agg(distinct value::uuid) into choices from jsonb_array_elements_text(p->'choice_stock_ids');
 perform elio.require(not exists(select 1 from unnest(choices) c where not exists(select 1 from elio.pos_event_stock s where s.id=c and s.event_id=eid and s.deleted_at is null)),'Choose live stock from this event only.');
 update elio.pos_event_items set name=trim(p->>'name'),price_cents=(p->>'price_cents')::integer,choice_stock_ids=choices,active=coalesce((p->>'active')::boolean,true),revision=revision+1 where id=pid returning to_jsonb(pos_event_items) into result;
 elsif p_action='pos_import_event_flavors' then
 perform elio.require(jsonb_typeof(p->'flavors')='array' and jsonb_array_length(p->'flavors') between 1 and 50,'Choose 1 to 50 flavors.');
 perform elio.require((select count(distinct value->>'product_id') from jsonb_array_elements(p->'flavors'))=jsonb_array_length(p->'flavors'),'Choose each flavor once.');
 for component in select (value->>'product_id')::uuid product_id,value->>'available' available from jsonb_array_elements(p->'flavors') loop
 perform elio.require(component.available ~ '^[0-9]+$' and component.available::integer between 0 and 1000000,'Enter whole event stock quantities from 0 to 1,000,000.');
 if exists(select 1 from elio.pos_event_stock where event_id=eid and source_product_id=component.product_id and deleted_at is null) then skipped:=skipped+1;continue;end if;
 sid:=elio.pos_import_event_stock(eid,component.product_id);
 update elio.pos_event_stock set capacity=component.available::integer where id=sid returning to_jsonb(pos_event_stock) into before_value;
 imported:=imported||jsonb_build_array(before_value);
 end loop;
 result:=jsonb_build_object('imported',imported,'skipped',skipped);before_value:=null;
 elsif p_action='pos_import_event_products' then
 perform elio.require(jsonb_typeof(p->'product_ids')='array' and jsonb_array_length(p->'product_ids') between 1 and 50,'Choose 1 to 50 website products.');
 select count(*) into stock_before from elio.pos_event_stock where event_id=eid and deleted_at is null;
 for product_id in select distinct value::uuid from jsonb_array_elements_text(p->'product_ids') loop
 if exists(select 1 from elio.pos_event_items where event_id=eid and source_product_id=product_id and deleted_at is null) then skipped:=skipped+1;continue;end if;
 select data into product from elio.products where id=product_id and deleted_at is null and coalesce((data->>'active')::boolean,false);
 perform elio.require(product is not null and product->>'kind' in ('set','custom_box','flavor'),'Choose an available website product.');
 choices:='{}';recipe:='[]';
 if product->>'kind'='custom_box' then
 select coalesce(array_agg(id order by name,id),'{}'::uuid[]) into choices from elio.pos_event_stock where event_id=eid and deleted_at is null and source_product_id is not null;
 perform elio.require(cardinality(choices) between 1 and 50,'Import the event flavors first, then import this custom box.');
 elsif product->>'kind'='flavor' then
 sid:=elio.pos_import_event_stock(eid,product_id);recipe:=jsonb_build_array(jsonb_build_object('stock_id',sid,'quantity',1));
 else
 perform elio.require(jsonb_typeof(product->'box_flavors')='array' and jsonb_array_length(product->'box_flavors')>0,'This website box has no flavor recipe.');
 for component in select value::uuid id,count(*)::integer quantity from jsonb_array_elements_text(product->'box_flavors') group by 1 loop
 sid:=elio.pos_import_event_stock(eid,component.id);recipe:=recipe||jsonb_build_array(jsonb_build_object('stock_id',sid,'quantity',component.quantity));end loop;
 end if;
 insert into elio.pos_event_items(event_id,source_product_id,name,price_cents,recipe,kind,choice_stock_ids)
 values(eid,product_id,product->>'name',coalesce((product->>'price_cents')::integer,0),recipe,case when product->>'kind'='custom_box' then 'custom_box' else 'event_item' end,choices)
 returning to_jsonb(pos_event_items) into before_value;
 imported:=imported||jsonb_build_array(before_value);
 end loop;
 result:=jsonb_build_object('imported',imported,'skipped',skipped,'stock_created',(select count(*) from elio.pos_event_stock where event_id=eid and deleted_at is null)-stock_before);before_value:=null;
 else raise exception 'Unsupported event catalog action';end if;
 insert into elio.pos_audit(actor,action,target_id,reason,before_data,after_data) values(auth.uid(),p_action,coalesce(pid,eid),coalesce(p->>'reason','Event catalog updated'),before_value,result);
 return result;
end $$;

create or replace function elio.pos_event_quote(p jsonb,p_original uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare ev elio.pos_events;v_item jsonb;it elio.pos_event_items;original elio.orders;old_item jsonb;stock elio.pos_event_stock;choice record;
 items jsonb:='[]';recipe jsonb;sels jsonb;qty integer;price bigint;subtotal bigint:=0;fee integer;d record;usable boolean;incoming_qty bigint;old_qty bigint;
begin
 perform elio.assert_staff(auth.uid(),false);
 select * into ev from elio.pos_events where id=(p->>'event_id')::uuid;
 perform elio.require(ev.id is not null,'Choose an event.');
 if p_original is not null then
 select * into strict original from elio.orders where id=p_original;
 perform elio.require(original.data->>'event_id'=ev.id::text,'An order cannot move to another event.');
 else
 perform elio.require(ev.deleted_at is null and ev.active and (now() at time zone 'Asia/Manila')::date between ev.starts_on and ev.ends_on,'This event is deleted, closed or outside its selling dates.');
 perform elio.require(exists(select 1 from elio.pos_cash_sessions where event_id=ev.id and sale_date=(now() at time zone 'Asia/Manila')::date and closed_at is null),'Open the event cash session before selling.');
 end if;
 perform elio.require(p->>'method' in ('pickup','delivery'),'Choose pickup or delivery.');
 perform elio.require((p->>'fulfillment_date')::date between (now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::date+366,'Choose today or a fulfillment date within the next year.');
 perform elio.require(jsonb_typeof(p->'items')='array' and jsonb_array_length(p->'items') between 1 and 100,'Add at least one event item.');
 for v_item in select value from jsonb_array_elements(p->'items') loop
 select * into it from elio.pos_event_items where id=(v_item->>'product_id')::uuid and event_id=ev.id;
 perform elio.require(it.id is not null,'Choose an item from this event.');
 qty:=(v_item->>'quantity')::integer;perform elio.require(qty between 1 and 10000 and v_item->>'quantity'=qty::text,'Use a whole quantity between 1 and 10,000.');
 sels:=coalesce(v_item->'selections','{}');
 if it.kind='custom_box' then
 perform elio.require(jsonb_typeof(sels)='object' and sels-'flavors'='{}'::jsonb and jsonb_typeof(sels->'flavors')='object','Choose the event flavors for this box.');
 perform elio.require(not exists(select 1 from jsonb_each(sels->'flavors') where jsonb_typeof(value)<>'number' or value::text !~ '^[1-3]$'),'Use whole flavor quantities from 1 to 3.');
 perform elio.require((select sum(value::integer) from jsonb_each_text(sels->'flavors'))=3,'Choose exactly 3 flavor pieces.');
 else perform elio.require(sels='{}'::jsonb,'Event items use their saved flavor recipe.');end if;
 old_item:=null;
 if original.id is not null then select value into old_item from jsonb_array_elements(original.data->'items') where value->>'product_id'=it.id::text and coalesce(value->'selections','{}')=sels limit 1;end if;
 select coalesce(sum((value->>'quantity')::integer),0) into incoming_qty from jsonb_array_elements(p->'items') where value->>'product_id'=it.id::text and coalesce(value->'selections','{}')=sels;
 select coalesce(sum((value->>'quantity')::integer),0) into old_qty from jsonb_array_elements(coalesce(original.data->'items','[]')) where value->>'product_id'=it.id::text and coalesce(value->'selections','{}')=sels;
 usable:=ev.deleted_at is null and it.deleted_at is null and it.active;
 if it.kind='custom_box' then
 usable:=usable and not exists(select 1 from jsonb_each_text(sels->'flavors') c where not exists(select 1 from elio.pos_event_stock s where s.id=c.key::uuid and s.id=any(it.choice_stock_ids) and s.event_id=ev.id and s.deleted_at is null));
 else
 usable:=usable and not exists(select 1 from jsonb_array_elements(it.recipe) r where not exists(select 1 from elio.pos_event_stock s where s.id=(r->>'stock_id')::uuid and s.event_id=ev.id and s.deleted_at is null));
 end if;
 perform elio.require(usable or old_item is not null and incoming_qty<=old_qty,'This event item or one of its stock ingredients is unavailable.');
 price:=coalesce((old_item->>'unit_price_cents')::bigint,it.price_cents);
 if old_item is not null then recipe:=old_item->'event_recipe';
 elsif it.kind='custom_box' then
 recipe:='[]';
 for choice in select key,value::integer quantity from jsonb_each_text(sels->'flavors') order by key loop
 select * into strict stock from elio.pos_event_stock where id=choice.key::uuid and event_id=ev.id;
 price:=price+stock.surcharge_cents::bigint*choice.quantity;
 recipe:=recipe||jsonb_build_array(jsonb_build_object('stock_id',stock.id,'name',stock.name,'quantity',choice.quantity,'surcharge_cents',stock.surcharge_cents));
 end loop;
 else
 select jsonb_agg(jsonb_build_object('stock_id',s.id,'name',s.name,'quantity',r->'quantity') order by s.id) into recipe
 from jsonb_array_elements(it.recipe) r join elio.pos_event_stock s on s.id=(r->>'stock_id')::uuid and s.event_id=ev.id;
 end if;
 subtotal:=subtotal+price*qty;perform elio.require(subtotal<=1000000000,'Sale total exceeds the supported amount.');
 items:=items||jsonb_build_array(jsonb_build_object('source','event','product_id',it.id,'product_kind','event_item','name',coalesce(old_item->>'name',it.name),'quantity',qty,
 'photo_url',old_item->'photo_url','selections',sels,'selection_labels',coalesce((select jsonb_agg(jsonb_build_object('group','Includes','label',r->>'name','quantity',r->'quantity')) from jsonb_array_elements(recipe) r),'[]'),
 'unit_price_cents',price,'line_total_cents',price*qty,'event_recipe',recipe,'flavor_contents','[]'::jsonb,'stock_requirements','[]'::jsonb));
 end loop;
 for d in select (r->>'stock_id')::uuid id,sum((r->>'quantity')::integer*(i->>'quantity')::integer)::bigint quantity
 from jsonb_array_elements(items) i cross join lateral jsonb_array_elements(i->'event_recipe') r group by 1 loop
 perform elio.require(elio.pos_event_remaining(d.id,p_original)>=d.quantity,'Not enough event stock. Review remaining pieces and quantities.');
 end loop;
 fee:=case when p->>'method'='pickup' then 0 else coalesce((p->>'delivery_cents')::integer,0) end;
 perform elio.require(fee between 0 and 100000000,'Enter a valid delivery fee.');
 return jsonb_build_object('event_id',ev.id,'event_name',ev.name,'items',items,'subtotal_cents',subtotal,'discount_cents',0,'delivery_cents',fee,'total_cents',subtotal+fee,'promo_snapshot',null,'delivery_zone_name',coalesce(p#>>'{address,locality}',''),'delivery_zone_description','');
end $$;

-- Extend existing management without changing cash reconciliation/reporting.
do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_event_action(text,jsonb)'::regprocedure);
 for old,replacement in select * from (values
 ($a$from elio.pos_events e),'[]')$a$,$b$from elio.pos_events e where e.deleted_at is null or coalesce((p->>'include_deleted')::boolean,false)),'[]')$b$),
 ($a$if p_action='pos_save_event' then$a$,$b$if p_action='pos_save_event' then
 perform elio.require(ev.deleted_at is null,'This event was deleted. Its history remains available.');$b$),
 ($a$perform elio.require(ev.id is not null,'Event not found.');$a$,$b$perform elio.require(ev.id is not null,'Event not found.');
 perform elio.require(ev.deleted_at is null or p_action in ('pos_event_data','pos_event_report','pos_close_cash','pos_reopen_cash','pos_cash_movement'),'This event was deleted. Its history remains available.');$b$),
 ($a$from elio.pos_event_stock s where event_id=eid),'[]'),
 'items'$a$,$b$from elio.pos_event_stock s where event_id=eid and deleted_at is null),'[]'),
 'items'$b$),
 ($a$'kind','event_item','remaining',coalesce((select min(elio.pos_event_remaining((r->>'stock_id')::uuid)/(r->>'quantity')::integer) from jsonb_array_elements(x.recipe) r),0)$a$,$b$'kind',x.kind,'remaining',elio.pos_event_item_remaining(x.id)$b$),
 ($a$from elio.pos_event_items x where event_id=eid),'[]')$a$,$b$from elio.pos_event_items x where event_id=eid and deleted_at is null),'[]')$b$),
 ($a$before_value:=to_jsonb(st);$a$,$b$before_value:=to_jsonb(st);
 perform elio.require(st.deleted_at is null and not exists(select 1 from elio.pos_event_stock where id=pid and event_id<>eid),'This stock item is deleted or belongs to another event.');$b$),
 ($a$select to_jsonb(s)||jsonb_build_object('remaining',wanted)$a$,$b$if p ? 'surcharge_cents' then
 perform elio.require((p->>'surcharge_cents')::integer between 0 and 100000000,'Enter a valid custom-box surcharge.');
 update elio.pos_event_stock set surcharge_cents=(p->>'surcharge_cents')::integer where id=pid;end if;
 select to_jsonb(s)||jsonb_build_object('remaining',wanted)$b$),
 ($a$before_value:=to_jsonb(it);$a$,$b$before_value:=to_jsonb(it);
 perform elio.require(it.deleted_at is null and coalesce(it.kind,'event_item')='event_item' and not exists(select 1 from elio.pos_event_items where id=pid and event_id<>eid),'This item is deleted, belongs to another event, or needs the custom-box editor.');$b$),
 ($a$and event_id=eid),'Every included stock item$a$,$b$and event_id=eid and deleted_at is null),'Every included stock item$b$)
 ) changes loop
 perform elio.require(position(old in definition)>0,'Event catalog integration point changed.');definition:=replace(definition,old,replacement);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$if p_action='pos_catalog' then$a$;
 perform elio.require(position(old in definition)>0,'Missing event catalog dispatch hook.');
 execute replace(definition,old,$b$if p_action in ('pos_delete_event','pos_delete_event_stock','pos_delete_event_item','pos_import_event_products','pos_import_event_flavors','pos_save_event_choice_item') then return elio.pos_event_catalog_action(p_action,p_payload);end if;
 if p_action='pos_catalog' then$b$);
end $$;
revoke all on function elio.pos_event_item_remaining(uuid),elio.pos_import_event_stock(uuid,uuid),elio.pos_event_catalog_action(text,jsonb) from public,anon,authenticated,service_role;
commit;
