-- Saving a numeric price is sufficient. Keep the legacy field true for older
-- clients while removing it as an independent owner-controlled gate.
do $patch$
declare def text:=pg_get_functiondef('elio.validate_product()'::regprocedure); hook text;
begin
 hook:=$old$ if kind='flavor' then
  new.data:=new.data||jsonb_build_object('active',coalesce((new.data->>'price_confirmed')::boolean,false) and not coalesce((new.data->>'collection_hidden')::boolean,false),'in_rotation',true);
 end if;$old$;
 perform elio.require(position(hook in def)>0,'Missing flavor price compatibility hook.');
 def:=replace(def,hook,$new$ new.data:=new.data||jsonb_build_object('price_confirmed',true);
 if kind='flavor' then
  new.data:=new.data||jsonb_build_object('active',not coalesce((new.data->>'collection_hidden')::boolean,false),'in_rotation',true);
 end if;$new$);
 hook:=$old$ if coalesce((new.data->>'active')::boolean,false) then
  perform elio.require(coalesce((new.data->>'price_confirmed')::boolean,false),'Confirm this price before making the item available.');
 end if;$old$;
 perform elio.require(position(hook in def)>0,'Missing price confirmation validator.');
 execute replace(def,hook,'');
end $patch$;
update elio.products set data=data where true;

-- Public flavor groups are disjoint from the full collection. Prepared but
-- unpublished lineups stay private, including their membership IDs.
do $patch$
declare def text:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure); hook text;
begin
 hook:=$old$'photos',coalesce(data->'photos','[]'),'sort_order',data->'sort_order'$old$;
 perform elio.require(position(hook in def)>0,'Missing collection membership hook.');
 def:=replace(def,hook,$new$'photos',coalesce(data->'photos','[]'),'sort_order',data->'sort_order',
    'collection_only',not exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and elio.products.id=any(m.flavor_ids))$new$);
 hook:=$old$from elio.products where data->>'kind'='flavor' and not coalesce((data->>'collection_hidden')::boolean,false)$old$;
 perform elio.require(position(hook in def)>0,'Missing public collection visibility hook.');
 def:=replace(def,hook,hook||$new$
    and (not exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and elio.products.id=any(m.flavor_ids))
     or exists(select 1 from elio.flavor_menus m where m.month in (current_month,next_month) and m.published and elio.products.id=any(m.flavor_ids)))$new$);
 execute def;
end $patch$;
