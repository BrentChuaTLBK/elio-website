-- Editorial headings are independent of dated lineups, stock, and shop closures.
-- Return only these three public strings, never the rest of the shop settings.
create or replace function elio.flavor_menu_data(p_public boolean default true) returns jsonb
language sql stable set search_path='' as $$
 with months as (
  select date_trunc('month',now() at time zone 'Asia/Manila')::date as current_month
 ), menus as (
  select m.* from elio.flavor_menus m,months d
  where m.month between d.current_month and (d.current_month+interval '1 month')::date
   and (not p_public or m.published)
 ) select jsonb_build_object('current_month',current_month,'next_month',(current_month+interval '1 month')::date,
  'menus',(select coalesce(jsonb_agg(to_jsonb(m) order by month),'[]') from menus m),
  'headings',(select jsonb_build_object(
   'current',coalesce(data->'flavor_headings'->>'current','Flavors of the Month'),
   'next',coalesce(data->'flavor_headings'->>'next','Coming Next Month'),
   'collection',coalesce(data->'flavor_headings'->>'collection','The full collection.')
  ) from elio.settings where id)) from months
$$;
revoke all on function elio.flavor_menu_data(boolean) from public,anon,authenticated;

-- Use the existing verified-owner settings endpoint and validate before saving.
do $patch$
declare def text:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),'');
 hook text:=$old$   row_data:=s||coalesce(p_payload->'settings','{}');$old$;
begin
 if position(hook in def)=0 then raise exception 'Missing settings validation patch point'; end if;
 def:=replace(def,hook,hook||$new$
   if row_data ? 'flavor_headings' then
    perform elio.require(jsonb_typeof(row_data->'flavor_headings')='object','Provide valid flavor headings.');
    perform elio.require(not exists(select 1 from jsonb_object_keys(row_data->'flavor_headings') k where k not in ('current','next','collection')),'Use only the three flavor headings.');
    foreach field in array array['current','next','collection'] loop
     perform elio.require(jsonb_typeof(row_data->'flavor_headings'->field)='string' and length(trim(row_data->'flavor_headings'->>field)) between 1 and 80,'Enter each flavor heading using 1–80 characters.');
     row_data:=jsonb_set(row_data,array['flavor_headings',field],to_jsonb(trim(row_data->'flavor_headings'->>field)));
    end loop;
   end if;$new$);
 execute def;
end $patch$;
