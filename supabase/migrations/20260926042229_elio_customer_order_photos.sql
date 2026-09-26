-- Presentation-only cover URLs for authorized customer order responses.
-- Saved order snapshots and the independently frozen email payload stay intact.
create function elio.customer_order_photos(p_order jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
 select p_order || jsonb_build_object('items',coalesce(jsonb_agg(
   saved.item || jsonb_build_object('photo_url',case
     when jsonb_typeof(p.data#>'{photos,0}')='string'
     then nullif(btrim(p.data#>>'{photos,0}'),'') end)
   order by saved.position),'[]'::jsonb))
 from jsonb_array_elements(coalesce(p_order->'items','[]'::jsonb))
   with ordinality as saved(item,position)
 left join elio.products p on p.id=(saved.item->>'product_id')::uuid
$$;
revoke all on function elio.customer_order_photos(jsonb) from public,anon,authenticated;

-- Enrich only after dispatch has checked order access or completed submission.
-- Reuse its existing ownership, SECURITY DEFINER setting, grants and checks.
do $$
declare
 definition text := pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook text;
begin
 foreach hook in array array[
  'return elio.order_json(o.id,false,true);',
  'return elio.order_json(oid,false,true);',
  'return elio.order_json(o.id,role_name in (''owner'',''staff''),false);'
 ] loop
  if (length(definition)-length(replace(definition,hook,'')))/length(hook)<>1 then
   raise exception 'Expected authorized customer order response hook was not found: %',hook;
  end if;
  definition := replace(definition,hook,
    replace(left(hook,length(hook)-2),'return ','return elio.customer_order_photos(')||'));');
 end loop;
 execute definition;
end $$;
