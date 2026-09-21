-- Elio additions to the TLB order contract: flavor pieces versus finished sets.
-- All pricing and stock demand are generated here; client totals are not trusted.

create table elio.pending_owners (email text primary key check(email=lower(email)));
alter table elio.pending_owners enable row level security;
revoke all on elio.pending_owners from public,anon,authenticated;

create function elio.product_view(p jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare choices jsonb;
begin
 if p->>'kind'='custom_box' then
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',data->>'name',
   'surcharge_cents',(data->>'price_cents')::integer,
   'active',coalesce((data->>'active')::boolean,false) and coalesce((data->>'in_rotation')::boolean,false))
   order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') into choices
   from elio.products where data->>'kind'='flavor';
  return p||jsonb_build_object('option_groups',jsonb_build_array(jsonb_build_object(
   'id','flavors','label','Flavors per box','required_count',3,'choices',choices)));
 end if;
 return p;
end $$;

create function elio.stock_demand(p_items jsonb)
returns table(product_id uuid,quantity integer) language sql immutable set search_path='' as $$
 select (d->>'product_id')::uuid,sum((d->>'quantity')::integer*(i->>'quantity')::integer)::integer
 from jsonb_array_elements(p_items) i cross join lateral jsonb_array_elements(i->'stock_requirements') d
 group by (d->>'product_id')::uuid
$$;

create function elio.check_stock(p_items jsonb,p_date date,p_original uuid,p_admin boolean)
returns void language plpgsql set search_path='' as $$
declare d record; used integer; remaining integer; p jsonb;
begin
 for d in select * from elio.stock_demand(p_items) order by product_id loop
  select coalesce(sum(quantity),0)::integer into used from elio.allocations
   where order_id=p_original and product_id=d.product_id and date=p_date;
  -- Keeping/reducing an existing reservation remains possible after a menu closes.
  if p_admin and d.quantity<=used then continue; end if;
  select data into p from elio.products where id=d.product_id;
  perform elio.require(p is not null,'A stock item no longer exists.');
  if p->>'kind'='flavor' then
   perform elio.require(coalesce((p->>'active')::boolean,false) and coalesce((p->>'in_rotation')::boolean,false),
    'Flavor unavailable: '||(p->>'name'));
  end if;
  perform elio.require(not exists(select 1 from elio.inventory where product_id=d.product_id and date=p_date and not available),
   (p->>'name')||' is unavailable on '||p_date||'.');
  remaining:=elio.capacity_remaining(d.product_id,p_date,p_original);
  perform elio.require(remaining is null or remaining>=d.quantity,
   'Only '||coalesce(remaining,0)||case when p->>'kind'='flavor' then ' pieces of ' else ' sets of ' end||
   (p->>'name')||' remain on '||p_date||'.');
 end loop;
end $$;

create or replace function elio.allocate_order(p_id uuid) returns void
language sql set search_path='' as $$
 insert into elio.allocations(order_id,product_id,date,quantity,state)
 select o.id,d.product_id,o.fulfillment_date,d.quantity,
  case when o.payment_status='paid' then 'committed' else 'held' end
 from elio.orders o cross join lateral elio.stock_demand(o.data->'items') d where o.id=p_id
$$;

-- Guarded transforms preserve all upstream order/payment/promo fixes.
do $adapt$
declare def text; old text; replacement text;
begin
 def:=replace(pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamp with time zone)'::regprocedure),chr(13),'');
 def:=replace(def,' s jsonb; o elio.orders;', ' item_stock jsonb; s jsonb; o elio.orders;');
 old:='  perform elio.require(p is not null,''A selected product no longer exists.'');';
 replacement:=old||$x$
  perform elio.require(coalesce(p->>'kind','set')<>'flavor','Individual flavors must be selected inside a custom box.');
  p:=elio.product_view(p);$x$;
 if position(old in def)=0 then raise exception 'Missing Elio product quote patch point'; end if;
 def:=replace(def,old,replacement);
 old:='  select coalesce(sum(quantity),0)::integer into existing_qty from elio.allocations where order_id=p_original and elio.allocations.product_id=v_product_id and date=ful;';
 replacement:='  select coalesce(sum((value->>''quantity'')::integer),0)::integer into existing_qty from jsonb_array_elements(old_data->''items'') where value->>''product_id''=v_product_id::text and ful=o.fulfillment_date;';
 if position(old in def)=0 then raise exception 'Missing quantity patch point'; end if;
 def:=replace(def,old,replacement);
 old:=$x$  if require_item then
   -- TLB_DAILY_LIMITS_V1: absence/null is unlimited; explicit closures still apply.
   perform elio.require(not exists(select 1 from elio.inventory i where i.product_id=v_product_id and date=ful and not available),(p->>'name')||' is unavailable on '||ful::text||'.');
   stock:=elio.capacity_remaining(v_product_id,ful,p_original);
   perform elio.require(stock is null or stock>=requested,'Only '||coalesce(stock,0)::text||' units of '||(p->>'name')||' remain on '||ful::text||'.');
  end if;$x$;
 if position(old in def)=0 then raise exception 'Missing stock patch point'; end if;
 def:=replace(def,old,$x$  if p_admin and same_config then
   item_stock:=old_item->'stock_requirements';
  elsif p->>'kind'='custom_box' then
   select jsonb_agg(jsonb_build_object('product_id',key,'quantity',value::text::integer) order by key)
    into item_stock from jsonb_each(sels->'flavors') where value::text::integer>0;
  else
   item_stock:=jsonb_build_array(jsonb_build_object('product_id',v_product_id,'quantity',1));
  end if;$x$);
 def:=replace(def,$m$'line_total_cents',unit*qty)$m$,$m$'line_total_cents',unit*qty,'stock_requirements',item_stock)$m$);
 def:=replace(def,' perform elio.require(subtotal<=1000000000',
  ' perform elio.check_stock(items,ful,p_original,p_admin);'||chr(10)||' perform elio.require(subtotal<=1000000000');
 execute def;

 def:=replace(pg_get_functiondef('public.shop_api(text,jsonb,text)'::regprocedure),chr(13),'');
 -- Server product views build custom choices directly from current flavor records.
 def:=replace(def,$m$from elio.products where coalesce((data->>'active')::boolean,false)$m$,
  $m$from elio.products where coalesce((data->>'active')::boolean,false) and coalesce(data->>'kind','set')<>'flavor'$m$);
 def:=replace(def,$m$jsonb_agg(data||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name')$m$,
  $m$jsonb_agg(elio.product_view(data)||jsonb_build_object('id',id) order by coalesce((data->>'sort_order')::integer,0),data->>'name')$m$);
 def:=replace(def,$m$jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.products$m$,
  $m$jsonb_agg(elio.product_view(data)||jsonb_build_object('id',id)),'[]') from elio.products$m$);
 -- Insert owner claiming before the staff guard, only for an explicitly allowed verified account.
 old:=' role_name:=elio.role_for(u);';
 if position(old in def)=0 then raise exception 'Missing owner patch point'; end if;
 def:=replace(def,old,$x$
 if u is not null and not exists(select 1 from elio.staff) then
  insert into elio.staff(user_id,role)
   select a.id,'owner' from auth.users a join elio.pending_owners e on lower(a.email)=e.email
   where a.id=u and a.email_confirmed_at is not null on conflict do nothing;
  if found then delete from elio.pending_owners; end if;
 end if;
$x$||old);
 execute def;
end $adapt$;

-- Validate extensions even when a request bypasses the admin UI.
create function elio.validate_product() returns trigger language plpgsql set search_path='' as $$
declare kind text:=new.data->>'kind';
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
 end if;
 if kind in ('flavor','custom_box') then new.data:=jsonb_set(new.data,'{option_groups}','[]'); end if;
 return new;
end $$;
create trigger validate_elio_product before insert or update on elio.products for each row execute function elio.validate_product();

create function elio.validate_inventory() returns trigger language plpgsql set search_path='' as $$
begin
 perform elio.require(exists(select 1 from elio.products where id=new.product_id and data->>'kind' in ('flavor','set')),
  'Set quantities for individual flavors or fixed sets. Custom boxes use flavor stock.');
 return new;
end $$;
create trigger validate_elio_inventory before insert or update on elio.inventory for each row execute function elio.validate_inventory();

-- Keep privileged dispatch private. Only wrappers in public are exposed to PostgREST.
alter function public.shop_api(text,jsonb,text) set schema elio;
alter function elio.shop_api(text,jsonb,text) rename to dispatch;
create function public.shop_api(p_action text,p_payload jsonb default '{}',p_token text default null)
returns jsonb language sql security invoker set search_path='' as $$ select elio.dispatch(p_action,p_payload,p_token) $$;
alter function public.shop_service(text,jsonb) set schema elio;
alter function elio.shop_service(text,jsonb) rename to service_dispatch;
create function public.shop_service(p_action text,p_payload jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select elio.service_dispatch(p_action,p_payload) $$;
revoke all on all tables in schema elio from public,anon,authenticated;
revoke all on all sequences in schema elio from public,anon,authenticated;
revoke all on all functions in schema elio from public,anon,authenticated;
revoke all on function public.shop_api(text,jsonb,text),public.shop_service(text,jsonb) from public,anon,authenticated;
grant usage on schema elio to anon,authenticated,service_role;
grant execute on function elio.dispatch(text,jsonb,text),public.shop_api(text,jsonb,text) to anon,authenticated;
grant execute on function elio.service_dispatch(text,jsonb),public.shop_service(text,jsonb) to service_role;
alter default privileges in schema elio revoke execute on functions from public;

-- Dashboard-created auto-RLS event triggers do not need browser RPC access.
do $$ begin
 if to_regprocedure('public.rls_auto_enable()') is not null then
  revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
 end if;
end $$;

-- Unconfirmed business details stay blank. Checkout stays paused until the owner configures it.
update elio.settings set data=data||'{"shop_name":"Elio Basque Cheesecake","paused":true,"pause_message":"Elio ordering is being prepared.","delivery_window":"","site_url":"https://eliocheesecakes.com","owner_email":"","reminders_enabled":false}' where id;
create index if not exists staff_role_idx on elio.staff(role);
create index if not exists orders_reference_search on elio.orders(created_at desc);
create index if not exists payments_approver_idx on elio.payments(approved_by);

-- Existing public Elio catalog as drafts. No prices, stock, or availability is assumed.
do $seed$
declare p jsonb; product_id uuid;
begin
 for p in select value from jsonb_array_elements('[{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"vanilla","name":"Vanilla","description":"Made with fragrant vanilla seeds and a touch of sea salt. Smooth, creamy, and timeless.","in_rotation":true,"sort_order":0},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"gorgonzola","name":"Gorgonzola","description":"Made with Gorgonzola Dolce and a hint of vanilla, balancing creamy sweetness with a gentle blue-cheese tang.","in_rotation":true,"sort_order":1},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"chocolate","name":"Chocolate","description":"Made with 54.5% Belgian dark chocolate for a rich, smooth taste and a gently bittersweet finish.","in_rotation":true,"sort_order":2},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"ube","name":"Ube","description":"Made with 100% real ube, topped with ube halaya blended with coconut cream and finished with desiccated coconut.","in_rotation":true,"sort_order":3},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"matcha","name":"Matcha","description":"Made with Japanese matcha green tea, balancing its earthy flavor and gentle bitterness with the richness of cream cheese.","in_rotation":true,"sort_order":4},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"hojicha","name":"Hojicha","description":"Made with roasted Japanese green tea for a warm, toasted flavor and a smooth, subtly nutty finish.","in_rotation":true,"sort_order":5},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":[],"kind":"flavor","slug":"speculoos","name":"Speculoos","description":"Made with caramelized biscuit spread for warm, spiced sweetness, balanced with a touch of sea salt.","in_rotation":true,"sort_order":6},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":["assets/trio-story-concept.webp"],"kind":"set","slug":"signature","name":"The Signature Trio","description":"Three favorites, beautifully boxed.","box_flavors":["vanilla","chocolate","matcha"],"sort_order":100},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":["assets/shop-tea-box-concept.webp"],"kind":"set","slug":"tea","name":"The Tea Collection","description":"A little calm. A lovely trio.","box_flavors":["vanilla","matcha","hojicha"],"sort_order":101},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":["assets/shop-discovery-box-concept.webp"],"kind":"set","slug":"discovery","name":"The Discovery Box","description":"Something a little unexpected.","box_flavors":["ube","gorgonzola","speculoos"],"sort_order":102},{"price_cents":0,"price_confirmed":false,"active":false,"min_quantity":1,"lead_days":0,"allow_same_day":false,"pickup_only":false,"option_groups":[],"photos":["assets/shop-custom-box-concept.webp"],"kind":"custom_box","slug":"your-own","name":"Build your own box","description":"Choose your three favorites.","box_flavors":[],"sort_order":103}]'::jsonb) loop
  product_id:=gen_random_uuid();
  insert into elio.products(id,data) values(product_id,p||jsonb_build_object('id',product_id));
 end loop;
end $seed$;
