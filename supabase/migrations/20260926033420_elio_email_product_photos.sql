-- Freeze public product cover URLs when an authorized email claim is prepared.
-- Saved order names, recipes and prices are never replaced by current catalog data.
do $$
declare
 definition text := pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook text := $old$   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$old$;
 refresh_hook text := $old$'settings',s-'owner_email'),to_email=o.data#>>'{buyer,email}'$old$;
begin
 if position(hook in definition)=0 or position(refresh_hook in definition)=0 then
  raise exception 'Expected email preparation hooks were not found';
 end if;
 definition := replace(definition,refresh_hook,$new$'settings',s-'owner_email') || case when e.payload ? 'product_photos' then jsonb_build_object('product_photos',e.payload->'product_photos') else '{}'::jsonb end,to_email=o.data#>>'{buyer,email}'$new$);
 definition := replace(definition,hook,$new$   if not (e.payload ? 'product_photos') then
    update elio.outbox set payload=e.payload || jsonb_build_object('product_photos',(
      select coalesce(jsonb_object_agg(p.id::text,p.data#>>'{photos,0}'),'{}'::jsonb)
      from elio.products p
      where p.id in (
        select (item->>'product_id')::uuid
        from jsonb_array_elements(coalesce(e.payload#>'{order,items}','[]'::jsonb)) item
      ) and jsonb_typeof(p.data#>'{photos,0}')='string'
    )) where id=e.id returning * into e;
   end if;
$new$ || hook);
 execute definition;
end $$;
