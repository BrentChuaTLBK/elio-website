-- Save one month's picker and publication setting together. The existing
-- membership trigger resets unsold stock only for added/removed flavors.
create function elio.flavor_lineup_action(p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare current_month date:=date_trunc('month',now() at time zone 'Asia/Manila')::date;
 target_month date; current_ids uuid[]; wanted uuid[]; expected uuid[]; published boolean;
 removed jsonb:='[]'; flavor record; impact jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 perform elio.require(p_action in ('preview_flavor_lineup','save_flavor_lineup'),'Unknown lineup action.');
 perform elio.require(p_payload->>'expected_month'=current_month::text,'The calendar month changed. Refresh the dashboard before saving.');
 target_month:=(p_payload->>'month')::date;
 perform elio.require(target_month in (current_month,(current_month+interval '1 month')::date),'Choose this month or next month.');
 perform elio.require(jsonb_typeof(p_payload->'flavor_ids')='array' and jsonb_typeof(p_payload->'expected_flavor_ids')='array','Choose a valid flavor list.');
 perform elio.require(jsonb_typeof(p_payload->'published')='boolean' and jsonb_typeof(p_payload->'expected_published')='boolean','Choose whether to publish this lineup.');
 perform elio.require(not exists(select 1 from jsonb_array_elements(p_payload->'flavor_ids') x where jsonb_typeof(x)<>'string'),'Choose valid flavor IDs.');
 select coalesce(array_agg(value::uuid order by ord),'{}') into wanted from jsonb_array_elements_text(p_payload->'flavor_ids') with ordinality x(value,ord);
 select coalesce(array_agg(value::uuid),'{}') into expected from jsonb_array_elements_text(p_payload->'expected_flavor_ids');
 perform elio.require(cardinality(wanted)=(select count(distinct id) from unnest(wanted) id),'Choose each flavor once.');
 perform elio.require(not exists(select 1 from unnest(wanted) as requested(flavor_id) where not exists(select 1 from elio.products p where p.id=requested.flavor_id and p.data->>'kind'='flavor' and not coalesce((p.data->>'collection_hidden')::boolean,false))),'Only visible flavors can join a lineup. Unhide the flavor in the collection first.');
 select m.flavor_ids,m.published into current_ids,published from elio.flavor_menus m where month=target_month for update;
 current_ids:=coalesce(current_ids,'{}');published:=coalesce(published,false);
 perform elio.require(cardinality(current_ids)=cardinality(expected) and current_ids @> expected and current_ids <@ expected and published=(p_payload->>'expected_published')::boolean,'This lineup changed in another session. Refresh before saving your selection.');
 for flavor in select id,data->>'name' as name from elio.products where id=any(current_ids) and not id=any(wanted) order by data->>'name' loop
  impact:=elio.flavor_removal_impact(jsonb_build_object('id',flavor.id,'current_month',target_month<>current_month,'next_month',target_month=current_month,'hidden',false));
  select x into impact from jsonb_array_elements(impact->'months') x where (x->>'month')::date=target_month;
  removed:=removed||jsonb_build_array(jsonb_build_object('id',flavor.id,'name',flavor.name,'orders',coalesce((impact->>'orders')::integer,0),'pieces',coalesce((impact->>'pieces')::integer,0)));
 end loop;
 if p_action='preview_flavor_lineup' then return jsonb_build_object('removed',removed); end if;
 -- Insert an empty row first so additions go through the same stock-reset trigger.
 insert into elio.flavor_menus(month) values(target_month) on conflict(month) do nothing;
 update elio.flavor_menus set flavor_ids=wanted,published=(p_payload->>'published')::boolean,updated_at=now() where month=target_month;
 return elio.flavor_menu_data(false);
end $$;
revoke all on function elio.flavor_lineup_action(text,jsonb) from public,anon,authenticated;

do $patch$
declare def text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure); hook text:=$old$ if p_action='catalog' then$old$;
begin
 perform elio.require(position(hook in def)>0,'Missing lineup dispatch hook.');
 def:=replace(def,hook,$new$ if p_action in ('preview_flavor_lineup','save_flavor_lineup') then return elio.flavor_lineup_action(p_action,p_payload); end if;
$new$||hook);
 execute def;
end $patch$;

-- Monthly membership is the ordering switch for flavors. Legacy flags remain
-- derived compatibility fields for existing storefronts, not owner controls.
do $patch$
declare def text; hook text;
begin
 def:=pg_get_functiondef('elio.validate_product()'::regprocedure);
 hook:=$old$ perform elio.require(jsonb_typeof(new.data->'active')='boolean','Availability must be true or false.');$old$;
 perform elio.require(position(hook in def)>0,'Missing product validation hook.');
 def:=replace(def,hook,$new$ if kind='flavor' then
  new.data:=new.data||jsonb_build_object('active',coalesce((new.data->>'price_confirmed')::boolean,false) and not coalesce((new.data->>'collection_hidden')::boolean,false),'in_rotation',true);
 end if;
$new$||hook);
 execute def;
 def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook:=$old$insert into elio.products(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data,updated_at=now(); return row_data;$old$;
 perform elio.require(position(hook in def)>0,'Missing product response hook.');
 def:=replace(def,hook,$new$insert into elio.products(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data,updated_at=now(); select data into row_data from elio.products where id=rid; return row_data;$new$);
 execute def;
end $patch$;
update elio.products set data=data where data->>'kind'='flavor';
