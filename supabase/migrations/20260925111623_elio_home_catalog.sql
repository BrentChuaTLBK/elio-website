-- The homepage showcases every individually visible flavor, independently of
-- stock and monthly announcements. Only public editorial fields leave here.
do $patch$
declare
 def text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$old$ if p_action='catalog' then$old$;
begin
 perform elio.require(position(hook in def)>0,'Missing homepage catalog dispatch hook.');
 def:=replace(def,hook,$new$ if p_action='home_catalog' then
  return jsonb_build_object(
   'flavors',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'slug',data->>'slug','name',data->>'name',
    'description',data->>'description','tagline',data->>'tagline',
    'photos',coalesce(data->'photos','[]'),'collection_details',data->'collection_details',
    'sort_order',data->'sort_order')
    order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]')
    from elio.products where data->>'kind'='flavor'
     and not coalesce((data->>'collection_hidden')::boolean,false)),
   'boxes',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'slug',data->>'slug','name',data->>'name','description',data->>'description',
    'photos',coalesce(data->'photos','[]'),'price_cents',data->'price_cents')
    order by coalesce((data->>'sort_order')::integer,0),data->>'name',id),'[]')
    from elio.products where data->>'kind'='set' and coalesce((data->>'active')::boolean,false)),
   'custom_box_id',(select id from elio.products where data->>'kind'='custom_box'
    and coalesce((data->>'active')::boolean,false)
    order by coalesce((data->>'sort_order')::integer,0),data->>'name',id limit 1));
 end if;
$new$||hook);
 execute def;
end $patch$;
