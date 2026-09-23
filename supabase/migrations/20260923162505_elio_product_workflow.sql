-- All boxes now consume the same individual flavor pool.
-- This installation has no orders yet. Never reinterpret existing box reservations.
do $$ begin
 if exists(select 1 from elio.allocations a join elio.products p on p.id=a.product_id where p.data->>'kind'<>'flavor') then
  raise exception 'Existing box reservations need an explicit flavor allocation migration before applying this change.';
 end if;
end $$;

create or replace function elio.validate_product() returns trigger language plpgsql set search_path='' as $$
declare kind text:=new.data->>'kind'; flavors jsonb; ref text; flavor_id uuid; normalized jsonb:='[]';
begin
 perform elio.require(kind in ('set','custom_box','flavor'),'Choose fixed set, custom box, or individual flavor.');
 if tg_op='UPDATE' then perform elio.require(new.data->>'kind'=old.data->>'kind','Product type cannot change; create a new item instead.'); end if;
 perform elio.require(jsonb_typeof(new.data->'price_cents')='number' and new.data->>'price_cents' ~ '^[0-9]+$','Prices must use whole centavos.');
 perform elio.require(jsonb_typeof(new.data->'active')='boolean','Availability must be true or false.');
 if coalesce((new.data->>'active')::boolean,false) then
  perform elio.require(coalesce((new.data->>'price_confirmed')::boolean,false),'Confirm this price before making the item available.');
 end if;
 if kind='flavor' then
  perform elio.require(jsonb_typeof(new.data->'in_rotation')='boolean','Choose whether the flavor is in the current menu.');
 elsif kind='set' then
  flavors:=coalesce(new.data->'box_flavors','[]');
  perform elio.require(jsonb_typeof(flavors)='array','Select the flavors inside this fixed box.');
  perform elio.require(jsonb_array_length(flavors)=3,'Choose exactly three flavors for this fixed box.');
  for ref in select jsonb_array_elements_text(flavors) loop
   select id into flavor_id from elio.products where data->>'kind'='flavor' and (id::text=ref or data->>'slug'=ref) order by id limit 1;
   perform elio.require(flavor_id is not null,'Choose an existing flavor for each piece in this fixed box.');
   normalized:=normalized||jsonb_build_array(flavor_id);
  end loop;
  new.data:=jsonb_set(new.data,'{box_flavors}',normalized);
 end if;
 -- Custom choices derive from flavor records. Fixed sets have a saved recipe.
 new.data:=jsonb_set(new.data,'{option_groups}','[]');
 return new;
end $$;

create or replace function elio.validate_inventory() returns trigger language plpgsql set search_path='' as $$
begin
 perform elio.require(exists(select 1 from elio.products where id=new.product_id and data->>'kind'='flavor'),
  'Set quantities for individual flavors. All boxes use flavor stock.');
 return new;
end $$;

-- Quantity here is pieces PER BOX; stock_demand multiplies it by ordered boxes.
create function elio.flavor_recipe(p jsonb, selections jsonb default '{}') returns jsonb
language sql stable set search_path='' as $$
 with pieces as (
  select id, data->>'name' as name, count(*)::integer as quantity
  from jsonb_array_elements_text(case when p->>'kind'='set' then p->'box_flavors' else '[]'::jsonb end) r(ref)
  join elio.products f on f.data->>'kind'='flavor' and (f.id::text=r.ref or f.data->>'slug'=r.ref)
  group by id,data->>'name'
  union all
  select f.id,f.data->>'name',(r.value::text)::integer
  from jsonb_each(case when p->>'kind'='custom_box' then coalesce(selections->'flavors','{}') else '{}'::jsonb end) r
  join elio.products f on f.id::text=r.key and f.data->>'kind'='flavor'
  where (r.value::text)::integer>0
 ) select coalesce(jsonb_agg(jsonb_build_object('product_id',id,'name',name,'quantity',quantity) order by id),'[]') from pieces
$$;

-- Stock-only availability. Fulfillment rules and shop pauses remain enforced by quote.
create function elio.catalog_product(p jsonb, p_date date default null) returns jsonb
language plpgsql stable set search_path='' as $$
declare v jsonb:=elio.product_view(p); r record; f jsonb; remaining integer; boxes integer:=null; total integer:=0;
 available boolean:=true; unlimited boolean:=false; choices jsonb:='[]'; recipe jsonb;
begin
 if p->>'kind'='set' then
  recipe:=elio.flavor_recipe(p);
  available:=(select coalesce(sum((value->>'quantity')::integer),0)=3 from jsonb_array_elements(recipe));
  for r in select * from jsonb_to_recordset(recipe) as x(product_id uuid,quantity integer) loop
   select data into f from elio.products where id=r.product_id;
   remaining:=case when p_date is null then null else elio.capacity_remaining(r.product_id,p_date) end;
   if not coalesce((f->>'active')::boolean,false) or not coalesce((f->>'in_rotation')::boolean,false)
    or exists(select 1 from elio.inventory i where i.product_id=r.product_id and i.date=p_date and not i.available) then
    available:=false; boxes:=0;
   elsif remaining is not null then boxes:=least(boxes,greatest(remaining,0)/r.quantity); end if;
  end loop;
  available:=available and (boxes is null or boxes>0);
  v:=v||jsonb_build_object('flavor_contents',recipe);
 elsif p->>'kind'='custom_box' then
  for r in select id,data from elio.products where data->>'kind'='flavor' order by coalesce((data->>'sort_order')::integer,0),data->>'name' loop
   remaining:=case when p_date is null then null else elio.capacity_remaining(r.id,p_date) end;
   available:=coalesce((r.data->>'active')::boolean,false) and coalesce((r.data->>'in_rotation')::boolean,false)
    and not exists(select 1 from elio.inventory i where i.product_id=r.id and i.date=p_date and not i.available);
   if not available then remaining:=0; end if;
   if available and remaining is null then unlimited:=true; end if;
   total:=total+greatest(coalesce(remaining,0),0);
   choices:=choices||jsonb_build_array(jsonb_build_object('id',r.id,'label',r.data->>'name','surcharge_cents',(r.data->>'price_cents')::integer,
    'active',available,'stock_available',available and (remaining is null or remaining>0),'remaining_pieces',remaining));
  end loop;
  v:=jsonb_set(v,'{option_groups,0,choices}',choices);
  boxes:=case when unlimited then null else total/3 end;
  available:=unlimited or boxes>0;
 end if;
 return v||jsonb_build_object('stock_available',available,'remaining_boxes',boxes,'stock_date',p_date);
end $$;

do $adapt$
declare def text; old text; replacement text;
begin
 def:=replace(pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure),chr(13),'');
 old:=$x$perform elio.require(ful<=(date_trunc('month',p_submitted at time zone 'Asia/Manila')+interval '3 months - 1 day')::date,'Choose a date within the current month or the next two months.');$x$;
 replacement:=$x$perform elio.require(ful<=(date_trunc('month',p_submitted at time zone 'Asia/Manila')+interval '2 months - 1 day')::date,'Choose a date within this month or next month.');$x$;
 if position(old in def)=0 then raise exception 'Missing customer booking window patch point'; end if;
 def:=replace(def,old,replacement);
 old:=$x$  p:=elio.product_view(p);$x$;
 replacement:=old||$x$
  if p->>'kind'='set' then perform elio.require(sels='{}'::jsonb,'Fixed-set flavors cannot be changed by customers. Choose a custom box instead.'); end if;$x$;
 if position(old in def)=0 then raise exception 'Missing fixed box selections patch point'; end if;
 def:=replace(def,old,replacement);
 old:=$x$  else
   item_stock:=jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',1));
  end if;$x$;
 replacement:=$x$  else
   select jsonb_agg(value-'name' order by value->>'product_id') into item_stock from jsonb_array_elements(elio.flavor_recipe(p));
   perform elio.require((select sum((value->>'quantity')::integer) from jsonb_array_elements(item_stock))=3,'This fixed box needs three configured flavors.');
  end if;$x$;
 if position(old in def)=0 then raise exception 'Missing fixed box stock patch point'; end if;
 def:=replace(def,old,replacement);
 old:=$x$'stock_requirements',item_stock)$x$;
 replacement:=$x$'stock_requirements',item_stock,'flavor_contents',case when p_admin and same_config then coalesce(old_item->'flavor_contents','[]') else elio.flavor_recipe(p,sels) end)$x$;
 if position(old in def)=0 then raise exception 'Missing flavor snapshot patch point'; end if;
 def:=replace(def,old,replacement);
 execute def;

 def:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),'');
 old:=$x$jsonb_agg(elio.product_view(data)||jsonb_build_object('id',id) order by$x$;
 replacement:=$x$jsonb_agg(elio.catalog_product(data,nullif(p_payload->>'fulfillment_date','')::date)||jsonb_build_object('id',id) order by$x$;
 if position(old in def)=0 then raise exception 'Missing catalog availability patch point'; end if;
 def:=replace(def,old,replacement);
 execute def;
end $adapt$;

revoke all on function elio.flavor_recipe(jsonb,jsonb),elio.catalog_product(jsonb,date) from public,anon,authenticated;

-- Owners can add public product photos without receiving privileged server keys.
-- INSERT only: a unique object path prevents overwriting an existing image.
grant insert on storage.objects to authenticated;
create policy elio_owner_product_photo_insert on storage.objects for insert to authenticated
with check (
 bucket_id='product-images'
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
 and (select public.shop_api('account_access','{}'::jsonb,null)->>'role')='owner'
);
