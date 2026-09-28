-- Category removal can still tidy metadata on preserved, retired records.
begin;
create or replace function elio.guard_product_deletion() returns trigger
language plpgsql set search_path='' as $$
declare metadata text[]:=array['category_id','category_ids','category_sort_orders','sort_order'];
begin
 if tg_op='UPDATE' and old.deleted_at is not null then
  perform elio.require(new.deleted_at is not distinct from old.deleted_at
   and new.data-metadata=old.data-metadata,
   'This item has been deleted. Create a new item instead.');
 end if;
 new.data:=new.data-'deleted_at';
 if new.deleted_at is not null then
  new.data:=new.data||jsonb_build_object('deleted_at',new.deleted_at,'active',false,'in_rotation',false,'collection_hidden',true);
 end if;
 return new;
end $$;
do $$ declare definition text;anchor text:=$x$from elio.products where (data->>'kind'='flavor')=(scope='flavors')$x$;begin
 definition:=pg_get_functiondef('elio.reorder_catalog(jsonb)'::regprocedure);
 perform elio.require(position(anchor in definition)>0,'Missing catalog ordering filter.');
 execute replace(definition,anchor,anchor||' and deleted_at is null');
end $$;
commit;
