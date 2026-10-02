-- Prevent stale owner editors from overwriting newer catalog and shop changes.
-- Existing records without edit_revision start at zero; no business rows are
-- rewritten during this migration. All later actual data edits advance it.
create function elio.track_catalog_edit_revision() returns trigger
language plpgsql set search_path='' as $$
declare expected jsonb; current_revision bigint:=0; changed boolean;
begin
 if tg_op='UPDATE' then current_revision:=coalesce((old.data->>'edit_revision')::bigint,0); end if;
 if new.data ? '_elio_expected_edit_revision' then
  expected:=new.data->'_elio_expected_edit_revision';
  new.data:=new.data-'_elio_expected_edit_revision';
  if tg_op='UPDATE' then
   perform elio.require(jsonb_typeof(expected)='number' and expected::text ~ '^(0|[1-9][0-9]{0,15})$'
    and expected::numeric<=9007199254740991,'This editor is out of date. Refresh the dashboard and reopen it before saving.');
   perform elio.require(expected::bigint<=current_revision,'This record changed. Refresh the dashboard and reopen it before saving.');
   changed:=(new.data-'edit_revision') is distinct from (old.data-'edit_revision');
   perform elio.require(not changed or expected::bigint=current_revision,'This record changed in another tab or session. Your edits were not saved. Refresh the dashboard and reopen it before saving.');
  else
   perform elio.require(expected is null or expected='null'::jsonb,'This record no longer exists. Refresh the dashboard before saving.');
  end if;
 end if;
 if tg_op='INSERT' then current_revision:=1;
 elsif (new.data-'edit_revision') is distinct from (old.data-'edit_revision') then current_revision:=current_revision+1;
 end if;
 new.data:=jsonb_set(new.data,'{edit_revision}',to_jsonb(current_revision),true);
 return new;
end $$;
revoke all on function elio.track_catalog_edit_revision() from public,anon,authenticated,service_role;

-- The final BEFORE trigger sees values normalized by existing validators.
create trigger zz_elio_edit_revision before insert or update of data on elio.products for each row execute function elio.track_catalog_edit_revision();
create trigger zz_elio_edit_revision before insert or update of data on elio.settings for each row execute function elio.track_catalog_edit_revision();
create trigger zz_elio_edit_revision before insert or update of data on elio.promos for each row execute function elio.track_catalog_edit_revision();
create trigger zz_elio_edit_revision before insert or update of data on elio.zones for each row execute function elio.track_catalog_edit_revision();
create trigger zz_elio_edit_revision before insert or update of data on elio.categories for each row execute function elio.track_catalog_edit_revision();

-- Separate UPDATE from INSERT: INSERT ... ON CONFLICT fires insert triggers
-- before update triggers and would otherwise consume the expected-version flag.
create function elio.save_catalog_edit(p_table text,p_id uuid,p_data jsonb,p_expected jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare proposed jsonb:=p_data||jsonb_build_object('_elio_expected_edit_revision',p_expected); saved jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 if p_table='products' then
  update elio.products set data=proposed,updated_at=now() where id=p_id returning data into saved;
  if not found then insert into elio.products(id,data) values(p_id,proposed) returning data into saved; end if;
 elsif p_table='settings' then
  update elio.settings set data=proposed where id returning data into saved;
  perform elio.require(found,'Shop settings are unavailable. Refresh the dashboard.');
 elsif p_table='promos' then
  update elio.promos set code=p_data->>'code',data=proposed where id=p_id returning data into saved;
  if not found then insert into elio.promos(id,code,data) values(p_id,p_data->>'code',proposed) returning data into saved; end if;
 elsif p_table='zones' then
  update elio.zones set data=proposed where id=p_id returning data into saved;
  if not found then insert into elio.zones(id,data) values(p_id,proposed) returning data into saved; end if;
 elsif p_table='categories' then
  update elio.categories set data=proposed where id=p_id returning data into saved;
  if not found then insert into elio.categories(id,data) values(p_id,proposed) returning data into saved; end if;
 else raise exception 'Unknown catalog edit.';
 end if;
 return saved;
end $$;
revoke all on function elio.save_catalog_edit(text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare def text; before text; after text;
begin
 def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 before:=$old$insert into elio.products(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data,updated_at=now(); select data into row_data from elio.products where id=rid; return row_data;$old$;
 after:=$new$return elio.save_catalog_edit('products',rid,row_data,p_payload->'expected_revision');$new$;
 perform elio.require(position(before in def)>0,'Missing product edit revision hook.');def:=replace(def,before,after);
 before:=$old$update elio.settings set data=row_data where id; return row_data;$old$;
 after:=$new$return elio.save_catalog_edit('settings',null,row_data,p_payload->'expected_revision');$new$;
 perform elio.require(position(before in def)>0,'Missing settings edit revision hook.');def:=replace(def,before,after);
 before:=$old$insert into elio.zones(id,data) values(rid,row_data) on conflict(id) do update set data=excluded.data; return row_data;$old$;
 after:=$new$return elio.save_catalog_edit('zones',rid,row_data,p_payload->'expected_revision');$new$;
 perform elio.require(position(before in def)>0,'Missing delivery zone edit revision hook.');def:=replace(def,before,after);
 before:=$old$insert into elio.promos(id,code,data) values(rid,row_data->>'code',row_data) on conflict(id) do update set code=excluded.code,data=excluded.data; return row_data;$old$;
 after:=$new$return elio.save_catalog_edit('promos',rid,row_data,p_payload->'expected_revision');$new$;
 perform elio.require(position(before in def)>0,'Missing promo edit revision hook.');def:=replace(def,before,after);
 before:=$old$elio.save_catalog_category(p_payload->'category')$old$;
 after:=$new$elio.save_catalog_category((p_payload->'category')||jsonb_build_object('_expected_revision',p_payload->'expected_revision'))$new$;
 perform elio.require(position(before in def)>0,'Missing category edit revision dispatch.');def:=replace(def,before,after);
 execute def;

 def:=pg_get_functiondef('elio.save_catalog_category(jsonb)'::regprocedure);
 before:=$old$insert into elio.categories values(rid,result) on conflict(id) do update set data=excluded.data;
 return result;$old$;
 after:=$new$return elio.save_catalog_edit('categories',rid,result,p_data->'_expected_revision');$new$;
 perform elio.require(position(before in def)>0,'Missing category edit revision hook.');execute replace(def,before,after);

 def:=pg_get_functiondef('elio.flavor_menu_action(text,jsonb)'::regprocedure);
 before:=$old$perform elio.require(product is not null,'Flavor not found.');$old$;
 after:=before||$new$
   perform elio.require(jsonb_typeof(p_payload->'expected_current_month')='boolean' and jsonb_typeof(p_payload->'expected_next_month')='boolean','This flavor editor is out of date. Refresh the dashboard and reopen it before saving.');
   for i in 0..1 loop
    target_month:=case when i=0 then current_month else next_month end;
    select coalesce(rid=any(m.flavor_ids),false) into selected from elio.flavor_menus m where m.month=target_month for update;
    selected:=coalesce(selected,false);
    perform elio.require(
     selected=(p_payload->>case when i=0 then 'expected_current_month' else 'expected_next_month' end)::boolean
     or selected=((p_payload->>case when i=0 then 'current_month' else 'next_month' end)::boolean and not (p_payload->>'hidden')::boolean),
     'This flavor lineup changed in another tab or session. Your edits were not saved. Refresh the dashboard and reopen it before saving.');
   end loop;$new$;
 perform elio.require(position(before in def)>0,'Missing flavor membership revision hook.');def:=replace(def,before,after);
 before:=$old$jsonb_build_object('product',product),null)$old$;
 after:=$new$jsonb_build_object('product',product,'expected_revision',p_payload->'expected_revision'),null)$new$;
 perform elio.require(position(before in def)>0,'Missing flavor product revision hook.');def:=replace(def,before,after);
 execute def;
end $patch$;
