begin;
-- POS-only products never enter the public website catalog.
create table elio.pos_products (
 id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
 price_cents integer not null check(price_cents between 0 and 100000000),
 stock_mode text not null check(stock_mode in ('daily','running','unlimited')),
 photo text not null default '',active boolean not null default true,deleted_at timestamptz,
 revision integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table elio.pos_stock (
 product_id uuid not null references elio.pos_products(id),stock_date date not null,
 capacity integer not null check(capacity between 0 and 100000000),revision integer not null default 1,
 primary key(product_id,stock_date)
);
create table elio.pos_allocations (
 order_id uuid not null references elio.orders(id),product_id uuid not null references elio.pos_products(id),
 stock_date date not null,quantity integer not null check(quantity>0),
 state text not null check(state in ('held','committed','retained')),primary key(order_id,product_id,stock_date)
);
create index pos_allocations_stock on elio.pos_allocations(product_id,stock_date);
create table elio.pos_audit (
 id bigint generated always as identity primary key,actor uuid not null,action text not null,target_id uuid not null,
 at timestamptz not null default clock_timestamp(),reason text,before_data jsonb,after_data jsonb
);
create index pos_audit_target on elio.pos_audit(target_id,id);
do $$ declare t text;begin
 foreach t in array array['pos_products','pos_stock','pos_allocations','pos_audit'] loop
  execute format('alter table elio.%I enable row level security',t);
  execute format('revoke all on elio.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;
revoke all on sequence elio.pos_audit_id_seq from public,anon,authenticated,service_role;

create function elio.pos_stock_date(p elio.pos_products,d date) returns date
language sql immutable set search_path='' as $$ select case when p.stock_mode='running' then date '0001-01-01' else d end $$;
create function elio.pos_remaining(p_id uuid,p_date date,p_exclude uuid default null) returns integer
language sql stable set search_path='' as $$
 select case when p.stock_mode='unlimited' then null else
  coalesce((select capacity from elio.pos_stock where product_id=p.id and stock_date=elio.pos_stock_date(p,p_date)),0)
  -coalesce((select sum(quantity)::integer from elio.pos_allocations where product_id=p.id and stock_date=elio.pos_stock_date(p,p_date)
   and (p_exclude is null or order_id<>p_exclude)),0) end
 from elio.pos_products p where id=p_id
$$;

create function elio.pos_catalog(p_date date) returns jsonb
language plpgsql set search_path='' as $$
declare products jsonb;only_pos jsonb;s jsonb;
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require(p_date is not null,'Choose the sale or fulfillment date.');
 perform elio.prepare_default_inventory();
 select data into s from elio.settings where id;
 select coalesce(jsonb_agg(elio.catalog_product(data,p_date)||jsonb_build_object('id',id,'source','website')
  order by coalesce((data->>'sort_order')::integer,0),data->>'name'),'[]') into products
 from elio.products where deleted_at is null and data->>'kind' in ('set','custom_box') and coalesce((data->>'active')::boolean,false);
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('source','pos','kind','pos_item','remaining',elio.pos_remaining(id,p_date),
  'stock_available',active and (stock_mode='unlimited' or elio.pos_remaining(id,p_date)>0)) order by name,id),'[]') into only_pos
 from elio.pos_products p where deleted_at is null;
 return jsonb_build_object('products',products,'pos_products',only_pos,'date',p_date,'server_time',clock_timestamp(),
  'flavors',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id) order by data->>'name'),'[]') from elio.products where data->>'kind'='flavor' and deleted_at is null and coalesce((data->>'active')::boolean,false)),
  'payment_options',s->'payment_options','pickup_address',s->>'pickup_address','pickup_hours',s->>'pickup_hours','delivery_window',s->>'delivery_window',
  'zones',(select coalesce(jsonb_agg(data||jsonb_build_object('id',id)),'[]') from elio.zones where coalesce((data->>'active')::boolean,false)));
end $$;

create function elio.pos_catalog_action(p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p elio.pos_products;before_value jsonb;pid uuid;d date;available integer;wanted integer;capacity_value integer;result jsonb;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform pg_advisory_xact_lock(841721950318::bigint);
 pid:=(p_payload->>'id')::uuid;perform elio.require(pid is not null,'A product ID is required.');
 select * into p from elio.pos_products where id=pid for update;before_value:=to_jsonb(p);
 if p_action='pos_save_product' then
  perform elio.require(p.id is null and coalesce((p_payload->>'revision')::integer,0)=0 or p.revision=(p_payload->>'revision')::integer,'This product changed. Refresh before saving.');
  perform elio.require(p.deleted_at is null,'This POS product has been deleted.');
  perform elio.require(length(trim(p_payload->>'name')) between 1 and 160,'Enter a product name (up to 160 characters).');
  perform elio.require(coalesce(length(p_payload->>'description'),0)<=2000,'Keep the description within 2,000 characters.');
  perform elio.require(p_payload->>'price_cents' ~ '^[0-9]+$' and (p_payload->>'price_cents')::bigint between 0 and 100000000,'Enter a valid price.');
  perform elio.require(p_payload->>'stock_mode' in ('daily','running','unlimited'),'Choose a stock mode.');
  perform elio.require(jsonb_typeof(p_payload->'active')='boolean','Choose product availability.');
  perform elio.require(coalesce(p_payload->>'photo','')='' or (length(p_payload->>'photo')<=2048 and p_payload->>'photo' ~ '^https://'),'Use a valid uploaded photo.');
  perform elio.require(p.id is null or p.stock_mode=p_payload->>'stock_mode' or not exists(select 1 from elio.pos_allocations where product_id=pid),
   'Stock mode cannot change after this product has orders. Create a new product instead.');
  insert into elio.pos_products(id,name,description,price_cents,stock_mode,photo,active)
  values(pid,trim(p_payload->>'name'),coalesce(p_payload->>'description',''),(p_payload->>'price_cents')::integer,p_payload->>'stock_mode',coalesce(p_payload->>'photo',''),(p_payload->>'active')::boolean)
  on conflict(id) do update set name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,stock_mode=excluded.stock_mode,
   photo=excluded.photo,active=excluded.active,revision=elio.pos_products.revision+1,updated_at=clock_timestamp();
 elsif p_action='pos_delete_product' then
  perform elio.require(p.id is not null,'POS product not found.');
  perform elio.require(p.revision=(p_payload->>'revision')::integer,'This product changed. Refresh before deleting.');
  update elio.pos_products set deleted_at=clock_timestamp(),active=false,revision=revision+1,updated_at=clock_timestamp() where id=pid;
 elsif p_action='pos_set_stock' then
  perform elio.require(p.id is not null and p.deleted_at is null and p.stock_mode<>'unlimited','Choose an existing product with tracked stock.');
  d:=(p_payload->>'date')::date;perform elio.require(d>=(now() at time zone 'Asia/Manila')::date,'Choose today or a future stock date.');
  wanted:=(p_payload->>'available')::integer;perform elio.require(wanted between 0 and 1000000,'Available stock must be a whole number between 0 and 1,000,000.');
  available:=elio.pos_remaining(pid,d);perform elio.require(available=(p_payload->>'expected_available')::integer,'Stock changed since this screen loaded. Refresh before adjusting it.');
  perform elio.require(length(trim(p_payload->>'reason')) between 1 and 1000,'Enter a reason for this stock adjustment.');
  capacity_value:=coalesce((select capacity from elio.pos_stock where product_id=pid and stock_date=elio.pos_stock_date(p,d)),0)+wanted-available;
  insert into elio.pos_stock(product_id,stock_date,capacity) values(pid,elio.pos_stock_date(p,d),capacity_value)
   on conflict(product_id,stock_date) do update set capacity=excluded.capacity,revision=elio.pos_stock.revision+1;
  result:=jsonb_build_object('id',pid,'date',d,'available',wanted);before_value:=jsonb_build_object('available',available,'date',d);
 else raise exception 'Unsupported POS catalog action';end if;
 if result is null then select to_jsonb(x) into result from elio.pos_products x where id=pid;end if;
 insert into elio.pos_audit(actor,action,target_id,reason,before_data,after_data) values(auth.uid(),p_action,pid,p_payload->>'reason',before_value,result);
 return result;
end $$;
revoke all on function elio.pos_stock_date(elio.pos_products,date),elio.pos_remaining(uuid,date,uuid),elio.pos_catalog(date),elio.pos_catalog_action(text,jsonb) from public,anon,authenticated,service_role;
commit;
