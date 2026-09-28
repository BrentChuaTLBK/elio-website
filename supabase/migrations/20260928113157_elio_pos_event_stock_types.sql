begin;
alter table elio.pos_event_stock add column stock_type text not null default 'item' check(stock_type in ('flavor','item'));
-- Website flavor imports and flavors already offered in custom boxes remain flavor stock.
update elio.pos_event_stock s set stock_type='flavor' where s.source_product_id is not null or exists(select 1 from elio.pos_event_items i where s.id=any(i.choice_stock_ids));
do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_import_event_stock(uuid,uuid)'::regprocedure);
 old:=$a$insert into elio.pos_event_stock(event_id,source_product_id,name,capacity,surcharge_cents) values(p_event,p_product,flavor->>'name',0,coalesce((flavor->>'price_cents')::integer,0))$a$;
 perform elio.require(position(old in definition)>0,'Missing flavor import stock type hook.');
 execute replace(definition,old,$b$insert into elio.pos_event_stock(event_id,source_product_id,name,capacity,surcharge_cents,stock_type) values(p_event,p_product,flavor->>'name',0,coalesce((flavor->>'price_cents')::integer,0),'flavor')$b$);
 definition:=pg_get_functiondef('elio.pos_event_action(text,jsonb)'::regprocedure);
 old:=$a$qty:=coalesce(elio.pos_event_remaining(pid),0);wanted:=(p->>'available')::integer;$a$;
 replacement:=$b$perform elio.require(coalesce(p->>'stock_type',st.stock_type,'item') in ('flavor','item'),'Choose flavor stock or other item stock.');
 perform elio.require(st.source_product_id is null or coalesce(p->>'stock_type',st.stock_type)='flavor','Imported website flavors stay in flavor stock.');
 perform elio.require(coalesce(p->>'stock_type',st.stock_type,'item')='flavor' or not exists(select 1 from elio.pos_event_items i where pid=any(i.choice_stock_ids) and i.deleted_at is null),'Remove this flavor from custom-box choices before changing its stock type.');
 qty:=coalesce(elio.pos_event_remaining(pid),0);wanted:=(p->>'available')::integer;$b$;
 perform elio.require(position(old in definition)>0,'Missing stock type validation hook.');definition:=replace(definition,old,replacement);
 old:=$a$if p ? 'surcharge_cents' then$a$;
 replacement:=$b$update elio.pos_event_stock set stock_type=coalesce(p->>'stock_type',st.stock_type,'item') where id=pid;
 if p ? 'surcharge_cents' then$b$;
 perform elio.require(position(old in definition)>0,'Missing stock type save hook.');execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('elio.pos_event_catalog_action(text,jsonb)'::regprocedure);
 old:=$a$and s.event_id=eid and s.deleted_at is null)),'Choose live stock from this event only.');$a$;
 replacement:=$b$and s.event_id=eid and s.deleted_at is null and s.stock_type='flavor')),'Choose flavor stock from this event only.');$b$;
 perform elio.require(position(old in definition)>0,'Missing custom flavor type hook.');execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('elio.pos_event_quote(jsonb,uuid)'::regprocedure);
 old:=$a$s.id=any(it.choice_stock_ids) and s.event_id=ev.id and s.deleted_at is null$a$;
 perform elio.require(position(old in definition)>0,'Missing sale flavor type hook.');execute replace(definition,old,old||$a$ and s.stock_type='flavor'$a$);
end $$;
commit;
