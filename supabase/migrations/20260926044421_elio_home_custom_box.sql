-- Public display fields for the same visible custom box already linked at home.
-- Fixed sets, flavor visibility, stock and monthly menu publication are unchanged.
do $patch$
declare
 definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text:=$old$   'custom_box_id',(select id from elio.products where data->>'kind'='custom_box'$old$;
begin
 perform elio.require(
  length(definition)-length(replace(definition,hook,''))=length(hook),
  'Expected homepage custom-box display hook was not found.');
 definition:=replace(definition,hook,$new$   'custom_box',(select jsonb_build_object(
    'id',id,'slug',data->>'slug','name',data->>'name','description',data->>'description',
    'photos',coalesce(data->'photos','[]'),'price_cents',data->'price_cents')
    from elio.products where data->>'kind'='custom_box'
     and coalesce((data->>'active')::boolean,false)
    order by coalesce((data->>'sort_order')::integer,0),data->>'name',id limit 1),
$new$||hook);
 execute definition;
end $patch$;
