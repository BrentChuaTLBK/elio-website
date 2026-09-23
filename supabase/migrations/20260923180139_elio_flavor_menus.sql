-- Monthly lineups control the showcase and date-specific flavor eligibility.
alter table elio.inventory add column configured boolean not null default true;
create table elio.flavor_menus (
 month date primary key check (extract(day from month)=1),
 flavor_ids uuid[] not null default '{}',
 published boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table elio.flavor_menus enable row level security;
revoke all on elio.flavor_menus from public,anon,authenticated;

insert into elio.flavor_menus(month,flavor_ids,published)
select date_trunc('month',now() at time zone 'Asia/Manila')::date,
 coalesce(array_agg(id order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'{}'),true
from elio.products where data->>'kind'='flavor';

create function elio.flavor_in_lineup(p_id uuid,p_date date,p_published boolean default true) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from elio.flavor_menus m join elio.products p on p.id=p_id
  where m.month=date_trunc('month',p_date)::date and p_id=any(m.flavor_ids)
   and (not p_published or m.published) and not coalesce((p.data->>'collection_hidden')::boolean,false))
$$;

-- Removing a flavor clears only the unsold stock. Existing reservations survive.
create function elio.reset_removed_flavor_stock() returns trigger
language plpgsql set search_path='' as $$
declare flavor uuid;
begin
 for flavor in select distinct unnest(old.flavor_ids||new.flavor_ids) loop
  if (flavor=any(old.flavor_ids)) is distinct from (flavor=any(new.flavor_ids)) then
   insert into elio.inventory(product_id,date,capacity,available,configured)
   select flavor,d::date,coalesce((select sum(a.quantity)::integer from elio.allocations a where a.product_id=flavor and a.date=d::date),0),false,false
   from generate_series(new.month::timestamp,(new.month+interval '1 month - 1 day')::timestamp,interval '1 day') d
   on conflict(product_id,date) do update set capacity=excluded.capacity,available=false,configured=false;
  end if;
 end loop;
 return new;
end $$;
create trigger reset_removed_flavor_stock before update of flavor_ids on elio.flavor_menus
for each row execute function elio.reset_removed_flavor_stock();

create function elio.hide_flavor_from_lineups() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.data->>'kind'='flavor' and coalesce((new.data->>'collection_hidden')::boolean,false) then
  update elio.flavor_menus set flavor_ids=array_remove(flavor_ids,new.id),updated_at=now()
  where new.id=any(flavor_ids) and month>=date_trunc('month',now() at time zone 'Asia/Manila')::date;
 end if;
 return new;
end $$;
create trigger hide_flavor_from_lineups after insert or update of data on elio.products
for each row execute function elio.hide_flavor_from_lineups();

create or replace function elio.capacity_remaining(p_product uuid,p_date date,p_exclude uuid default null) returns integer
language sql stable security definer set search_path='' as $$
 select case when not exists(select 1 from elio.inventory where product_id=p_product and date=p_date) then 0
 else (select i.capacity-coalesce((select sum(a.quantity)::integer from elio.allocations a where a.product_id=i.product_id
  and a.date=i.date and (p_exclude is null or a.order_id<>p_exclude)),0)
  from elio.inventory i where i.product_id=p_product and i.date=p_date) end
$$;
create or replace function elio.inventory_json() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'date',i.date,'capacity',i.capacity,'available',i.available,'configured',i.configured,
 'reserved',coalesce((select sum(a.quantity)::integer from elio.allocations a where a.product_id=i.product_id and a.date=i.date),0),
 'remaining',elio.capacity_remaining(i.product_id,i.date)) order by i.date,i.product_id),'[]') from elio.inventory i
 where date >= (now() at time zone 'Asia/Manila')::date-7
$$;

create function elio.flavor_menu_data(p_public boolean default true) returns jsonb
language sql stable set search_path='' as $$
 with months as (
  select date_trunc('month',now() at time zone 'Asia/Manila')::date as current_month
 ), menus as (
  select m.* from elio.flavor_menus m,months d
  where m.month between d.current_month and (d.current_month+interval '1 month')::date
   and (not p_public or m.published)
 ) select jsonb_build_object('current_month',current_month,'next_month',(current_month+interval '1 month')::date,
  'menus',(select coalesce(jsonb_agg(to_jsonb(m) order by month),'[]') from menus m)) from months
$$;

create function elio.flavor_menu_action(p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare current_month date:=date_trunc('month',now() at time zone 'Asia/Manila')::date;
 next_month date:=(current_month+interval '1 month')::date; target_month date; rid uuid;
 product jsonb; result jsonb; ids uuid[]; selected boolean; i integer;
begin
 if p_action='flavor_collection' then
  return elio.flavor_menu_data(true)||jsonb_build_object('flavors',(
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',data->>'slug','name',data->>'name',
    'description',data->>'description','tagline',data->>'tagline','collection_category',data->>'collection_category',
    'photos',coalesce(data->'photos','[]'),'sort_order',data->'sort_order')
    order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]')
   from elio.products where data->>'kind'='flavor' and not coalesce((data->>'collection_hidden')::boolean,false)));
 end if;
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 perform elio.require(p_payload->>'expected_month'=current_month::text,'The calendar month changed. Refresh the dashboard before saving.');
 if p_action='save_flavor_menu_visibility' then
  target_month:=(p_payload->>'month')::date;
  perform elio.require(target_month in (current_month,next_month),'Choose this month or next month.');
  perform elio.require(jsonb_typeof(p_payload->'published')='boolean','Choose whether to show this menu.');
  insert into elio.flavor_menus(month,published) values(target_month,(p_payload->>'published')::boolean)
  on conflict(month) do update set published=excluded.published,updated_at=now();
 elsif p_action='save_flavor_editor' then
  rid:=nullif(p_payload->>'id','')::uuid;
  if rid is not null then
   select data into product from elio.products where id=rid and data->>'kind'='flavor' for update;
   perform elio.require(product is not null,'Flavor not found.');
  else
   rid:=gen_random_uuid();
   product:=jsonb_build_object('kind','flavor','price_cents',0,'price_confirmed',false,'active',false,
    'in_rotation',true,'min_quantity',1,'lead_days',0,'photos','[]'::jsonb,'option_groups','[]'::jsonb,'sort_order',0);
  end if;
  perform elio.require(length(trim(coalesce(p_payload->>'name',''))) between 1 and 160,'Enter a flavor name.');
  perform elio.require(length(coalesce(p_payload->>'description',''))<=6000,'Use a description of 6,000 characters or fewer.');
  perform elio.require(length(coalesce(p_payload->>'tagline',''))<=100,'Use a short description of 100 characters or fewer.');
  perform elio.require(jsonb_typeof(p_payload->'current_month')='boolean' and jsonb_typeof(p_payload->'next_month')='boolean','Choose the monthly placements.');
  perform elio.require(jsonb_typeof(p_payload->'hidden')='boolean','Choose the flavor visibility.');
  if p_payload ? 'photos' then
   perform elio.require(jsonb_typeof(p_payload->'photos')='array' and jsonb_array_length(p_payload->'photos')<=20,'Use at most 20 photos.');
   perform elio.require(not exists(select 1 from jsonb_array_elements_text(p_payload->'photos') f where f !~ '^(https://|assets/)'),'Use a valid uploaded photo.');
   product:=product||jsonb_build_object('photos',p_payload->'photos');
  end if;
  product:=product||jsonb_build_object('id',rid,'name',trim(p_payload->>'name'),'description',coalesce(p_payload->>'description',''),
   'tagline',coalesce(p_payload->>'tagline',''),'collection_hidden',(p_payload->>'hidden')::boolean);
  if p_payload ? 'category_ids' then product:=product||jsonb_build_object('category_ids',p_payload->'category_ids'); end if;
  -- Reuse the product validator; never accept prices, stock or activation in this editor.
  result:=elio.dispatch('save_product',jsonb_build_object('product',product),null);
  for i in 0..1 loop
   target_month:=case when i=0 then current_month else next_month end;
   selected:=(p_payload->>case when i=0 then 'current_month' else 'next_month' end)::boolean and not (p_payload->>'hidden')::boolean;
   insert into elio.flavor_menus(month,published) values(target_month,false) on conflict(month) do nothing;
   select flavor_ids into ids from elio.flavor_menus where month=target_month for update;
   ids:=array_remove(ids,rid);
   if selected then ids:=array_append(ids,rid); end if;
   update elio.flavor_menus set flavor_ids=ids,updated_at=now() where month=target_month;
  end loop;
 else raise exception 'Unknown flavor menu action.';
 end if;
 return elio.flavor_menu_data(false);
end $$;
revoke all on function elio.flavor_menu_data(boolean),elio.flavor_menu_action(text,jsonb) from public,anon,authenticated;
revoke all on function elio.flavor_in_lineup(uuid,date,boolean),elio.reset_removed_flavor_stock(),elio.hide_flavor_from_lineups() from public,anon,authenticated;

do $adapt$
declare def text; old text;
begin
 def:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),'');
 old:=$x$ if p_action='catalog' then$x$;
 if position(old in def)=0 then raise exception 'Missing public dispatch patch point'; end if;
 def:=replace(def,old,$x$ if p_action in ('flavor_collection','save_flavor_editor','save_flavor_menu_visibility') then
  return elio.flavor_menu_action(p_action,p_payload);
 end if;
$x$||old);
 old:=$x$result:=jsonb_build_object('role',role_name,'products',$x$;
 if position(old in def)=0 then raise exception 'Missing admin bootstrap patch point'; end if;
 def:=replace(def,old,$x$result:=jsonb_build_object('flavor_menus',elio.flavor_menu_data(false),'role',role_name,'products',$x$);
 old:=$x$'in_rotation',data->'in_rotation','photos',data->'photos'$x$;
 if position(old in def)=0 then raise exception 'Missing catalog flavor months patch point'; end if;
 def:=replace(def,old,old||$x$,'collection_hidden',data->'collection_hidden','available_months',(select coalesce(jsonb_agg(m.month order by m.month),'[]') from elio.flavor_menus m where m.published and id=any(m.flavor_ids) and m.month between date_trunc('month',now() at time zone 'Asia/Manila')::date and (date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 month')::date)$x$);
 old:=$x$elsif p_action='save_inventory' then$x$;
 if position(old in def)=0 then raise exception 'Missing inventory eligibility patch point'; end if;
 def:=replace(def,old,old||$x$
  perform elio.require(coalesce(p_payload->>'mode','replace') in ('replace','fill_unconfigured'),'Choose a valid quantity update mode.');
  for x in select value from jsonb_array_elements(p_payload->'rows') loop
   perform elio.require(elio.flavor_in_lineup((x->>'product_id')::uuid,(x->>'date')::date,false),
    'All boxes use flavor stock. Only flavors in that month’s lineup can have daily quantities. Update Flavor menus first.');
  end loop;$x$);
 execute def;
 def:=pg_get_functiondef('elio.save_daily_quantities(jsonb)'::regprocedure);
 old:=$x$product:=(x->>'product_id')::uuid; day:=(x->>'date')::date;$x$;
 if position(old in def)=0 then raise exception 'Missing quantity fill mode patch point'; end if;
 def:=replace(def,old,old||$x$
   if p_payload->>'mode'='fill_unconfigured' and exists(select 1 from elio.inventory where product_id=product and date=day and configured) then continue; end if;
$x$);
 old:=$x$set capacity=excluded.capacity,available=excluded.available$x$;
 if position(old in def)=0 then raise exception 'Missing explicit inventory configuration patch point'; end if;
 def:=replace(def,old,old||',configured=true');
 execute def;

 def:=pg_get_functiondef('elio.check_stock(jsonb,date,uuid,boolean)'::regprocedure);
 old:=$x$  if p->>'kind'='flavor' then$x$;
 if position(old in def)=0 then raise exception 'Missing stock eligibility patch point'; end if;
 def:=replace(def,old,old||$x$
   perform elio.require(elio.flavor_in_lineup(d.product_id,p_date),'Flavor unavailable in the published lineup for this date: '||(p->>'name'));$x$);
 execute def;

 def:=pg_get_functiondef('elio.catalog_product(jsonb,date)'::regprocedure);
 old:=$x$if not coalesce((f->>'active')::boolean,false)$x$;
 if position(old in def)=0 then raise exception 'Missing fixed box lineup patch point'; end if;
 def:=replace(def,old,$x$if (p_date is not null and not elio.flavor_in_lineup(r.product_id,p_date)) or coalesce((f->>'collection_hidden')::boolean,false) or not coalesce((f->>'active')::boolean,false)$x$);
 old:=$x$available:=coalesce((r.data->>'active')::boolean,false)$x$;
 if position(old in def)=0 then raise exception 'Missing custom box lineup patch point'; end if;
 def:=replace(def,old,$x$available:=(p_date is null or elio.flavor_in_lineup(r.id,p_date)) and not coalesce((r.data->>'collection_hidden')::boolean,false) and coalesce((r.data->>'active')::boolean,false)$x$);
 execute def;
end $adapt$;
