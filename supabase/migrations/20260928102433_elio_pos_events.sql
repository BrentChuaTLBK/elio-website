begin;
create table elio.pos_events (
 id uuid primary key default gen_random_uuid(),name text not null,starts_on date not null,ends_on date not null,
 active boolean not null default true,revision integer not null default 1,check(ends_on>=starts_on)
);
create table elio.pos_event_stock (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references elio.pos_events(id),name text not null,
 capacity integer not null default 0 check(capacity between 0 and 100000000),revision integer not null default 1
);
create index pos_event_stock_event on elio.pos_event_stock(event_id);
create table elio.pos_event_items (
 id uuid primary key default gen_random_uuid(),event_id uuid not null references elio.pos_events(id),name text not null,
 price_cents integer not null check(price_cents between 0 and 100000000),recipe jsonb not null,
 active boolean not null default true,revision integer not null default 1
);
create index pos_event_items_event on elio.pos_event_items(event_id);
create table elio.pos_event_allocations (
 order_id uuid not null references elio.orders(id),stock_id uuid not null references elio.pos_event_stock(id),
 quantity integer not null check(quantity>0),state text not null check(state in ('committed','retained')),primary key(order_id,stock_id)
);
create index pos_event_allocations_stock on elio.pos_event_allocations(stock_id);
create table elio.pos_cash_sessions (
 event_id uuid not null references elio.pos_events(id),sale_date date not null,opening_cents integer not null check(opening_cents>=0),
 counted_cents integer check(counted_cents>=0),closed_at timestamptz,closed_by uuid,expected_at_close bigint,
 revision integer not null default 1,primary key(event_id,sale_date)
);
create table elio.pos_cash_movements (
 id uuid primary key,event_id uuid not null,sale_date date not null,amount_cents integer not null check(amount_cents<>0),reason text not null,
 created_at timestamptz not null default clock_timestamp(),created_by uuid not null,
 foreign key(event_id,sale_date) references elio.pos_cash_sessions(event_id,sale_date)
);
create index pos_cash_movements_session on elio.pos_cash_movements(event_id,sale_date);
do $$ declare t text;begin
 foreach t in array array['pos_events','pos_event_stock','pos_event_items','pos_event_allocations','pos_cash_sessions','pos_cash_movements'] loop
 execute format('alter table elio.%I enable row level security',t);execute format('revoke all on elio.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

create function elio.pos_event_remaining(p_id uuid,p_exclude uuid default null) returns integer language sql stable set search_path='' as $$
 select s.capacity-coalesce((select sum(quantity)::integer from elio.pos_event_allocations where stock_id=s.id and (p_exclude is null or order_id<>p_exclude)),0)
 from elio.pos_event_stock s where s.id=p_id
$$;

create function elio.pos_event_quote(p jsonb,p_original uuid default null) returns jsonb language plpgsql set search_path='' as $$
declare ev elio.pos_events;v_item jsonb;it elio.pos_event_items;original elio.orders;old_item jsonb;
 items jsonb:='[]';recipe jsonb;qty integer;price integer;subtotal bigint:=0;fee integer;d record;
begin
 perform elio.assert_staff(auth.uid(),false);
 select * into ev from elio.pos_events where id=(p->>'event_id')::uuid;
 perform elio.require(ev.id is not null,'Choose an event.');
 if p_original is not null then
 select * into strict original from elio.orders where id=p_original;
 perform elio.require(original.data->>'event_id'=ev.id::text,'An order cannot move to another event.');
 else
 perform elio.require(ev.active and (now() at time zone 'Asia/Manila')::date between ev.starts_on and ev.ends_on,'This event is closed or outside its selling dates.');
 perform elio.require(exists(select 1 from elio.pos_cash_sessions where event_id=ev.id and sale_date=(now() at time zone 'Asia/Manila')::date and closed_at is null),'Open the event cash session before selling.');
 end if;
 perform elio.require(p->>'method' in ('pickup','delivery'),'Choose pickup or delivery.');
 perform elio.require((p->>'fulfillment_date')::date between (now() at time zone 'Asia/Manila')::date and (now() at time zone 'Asia/Manila')::date+366,'Choose today or a fulfillment date within the next year.');
 perform elio.require(jsonb_typeof(p->'items')='array' and jsonb_array_length(p->'items') between 1 and 100,'Add at least one event item.');
 for v_item in select value from jsonb_array_elements(p->'items') loop
 select * into it from elio.pos_event_items where id=(v_item->>'product_id')::uuid and event_id=ev.id;
 perform elio.require(it.id is not null,'Choose an item from this event.');
 qty:=(v_item->>'quantity')::integer;perform elio.require(qty between 1 and 10000 and v_item->>'quantity'=qty::text,'Use a whole quantity between 1 and 10,000.');
 perform elio.require(coalesce(v_item->'selections','{}')='{}'::jsonb,'Event items use their saved flavor recipe.');
 old_item:=null;
 if original.id is not null then select value into old_item from jsonb_array_elements(original.data->'items') where value->>'product_id'=it.id::text limit 1;end if;
 perform elio.require(it.active or (old_item is not null and qty<=(old_item->>'quantity')::integer),'This event item is unavailable.');
 price:=coalesce((old_item->>'unit_price_cents')::integer,it.price_cents);
 if old_item is not null then recipe:=old_item->'event_recipe';else
 select jsonb_agg(jsonb_build_object('stock_id',s.id,'name',s.name,'quantity',r->'quantity')) into recipe
 from jsonb_array_elements(it.recipe) r join elio.pos_event_stock s on s.id=(r->>'stock_id')::uuid and s.event_id=ev.id;
 end if;
 subtotal:=subtotal+price::bigint*qty;perform elio.require(subtotal<=1000000000,'Sale total exceeds the supported amount.');
 items:=items||jsonb_build_array(jsonb_build_object('source','event','product_id',it.id,'product_kind','event_item','name',coalesce(old_item->>'name',it.name),'quantity',qty,
 'selections','{}'::jsonb,'selection_labels',coalesce((select jsonb_agg(jsonb_build_object('group','Includes','label',r->>'name','quantity',r->'quantity')) from jsonb_array_elements(recipe) r),'[]'),
 'unit_price_cents',price,'line_total_cents',price::bigint*qty,'event_recipe',recipe,'flavor_contents','[]'::jsonb,'stock_requirements','[]'::jsonb));
 end loop;
 for d in select (r->>'stock_id')::uuid id,sum((r->>'quantity')::integer*(i->>'quantity')::integer)::bigint quantity
 from jsonb_array_elements(items) i cross join lateral jsonb_array_elements(i->'event_recipe') r group by 1 loop
 perform elio.require(elio.pos_event_remaining(d.id,p_original)>=d.quantity,'Not enough event stock. Review remaining pieces and quantities.');
 end loop;
 fee:=case when p->>'method'='pickup' then 0 else coalesce((p->>'delivery_cents')::integer,0) end;
 perform elio.require(fee between 0 and 100000000,'Enter a valid delivery fee.');
 return jsonb_build_object('event_id',ev.id,'event_name',ev.name,'items',items,'subtotal_cents',subtotal,'discount_cents',0,'delivery_cents',fee,'total_cents',subtotal+fee,'promo_snapshot',null,'delivery_zone_name',coalesce(p#>>'{address,locality}',''),'delivery_zone_description','');
end $$;

create function elio.pos_event_allocate(p_id uuid) returns void language sql set search_path='' as $$
 insert into elio.pos_event_allocations(order_id,stock_id,quantity,state)
 select o.id,(r->>'stock_id')::uuid,sum((r->>'quantity')::integer*(i->>'quantity')::integer)::integer,'committed'
 from elio.orders o cross join lateral jsonb_array_elements(o.data->'items') i cross join lateral jsonb_array_elements(i->'event_recipe') r
 where o.id=p_id and o.data->>'order_source'='in_person' group by 1,2
$$;

create function elio.pos_cash_expected(p_event uuid,p_date date) returns bigint language sql stable set search_path='' as $$
 select coalesce((select opening_cents from elio.pos_cash_sessions where event_id=p_event and sale_date=p_date),0)::bigint
 +coalesce((select sum(p.amount_cents) from elio.payments p join elio.orders o on o.id=p.order_id
 where o.data->>'event_id'=p_event::text and o.data#>>'{pos_payment,method}'='cash' and (p.approved_at at time zone 'Asia/Manila')::date=p_date),0)
 +coalesce((select sum(amount_cents) from elio.pos_cash_movements where event_id=p_event and sale_date=p_date),0)
$$;

create function elio.pos_event_action(p_action text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare eid uuid;ev elio.pos_events;it elio.pos_event_items;st elio.pos_event_stock;cs elio.pos_cash_sessions;mv elio.pos_cash_movements;
 pid uuid;d date;qty integer;wanted integer;recipe_row jsonb;before_value jsonb;result jsonb;recipe jsonb;expected bigint;
begin
 perform elio.assert_staff(auth.uid(),p_action in ('pos_save_event','pos_save_event_item','pos_save_event_stock','pos_reopen_cash'));
 perform pg_advisory_xact_lock(841721950318::bigint);
 if p_action='pos_events' then return coalesce((select jsonb_agg(to_jsonb(e) order by starts_on desc,name) from elio.pos_events e),'[]');end if;
 eid:=(p->>'event_id')::uuid;pid:=(p->>'id')::uuid;d:=coalesce((p->>'date')::date,(now() at time zone 'Asia/Manila')::date);
 select * into ev from elio.pos_events where id=eid for update;before_value:=to_jsonb(ev);
 if p_action='pos_save_event' then
 perform elio.require(eid is not null and (ev.id is null and coalesce((p->>'revision')::integer,0)=0 or ev.revision=(p->>'revision')::integer),'This event changed. Refresh first.');
 perform elio.require(length(trim(p->>'name')) between 1 and 160,'Enter an event name.');
 perform elio.require((p->>'ends_on')::date>=(p->>'starts_on')::date,'Event end must be on or after its start.');
 insert into elio.pos_events(id,name,starts_on,ends_on,active) values(eid,trim(p->>'name'),(p->>'starts_on')::date,(p->>'ends_on')::date,coalesce((p->>'active')::boolean,true))
 on conflict(id) do update set name=excluded.name,starts_on=excluded.starts_on,ends_on=excluded.ends_on,active=excluded.active,revision=elio.pos_events.revision+1;
 select to_jsonb(e) into result from elio.pos_events e where id=eid;
 else
 perform elio.require(ev.id is not null,'Event not found.');
 if p_action='pos_event_data' then
 return to_jsonb(ev)||jsonb_build_object('stock',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('remaining',elio.pos_event_remaining(s.id)) order by name) from elio.pos_event_stock s where event_id=eid),'[]'),
 'items',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('source','event','kind','event_item','remaining',coalesce((select min(elio.pos_event_remaining((r->>'stock_id')::uuid)/(r->>'quantity')::integer) from jsonb_array_elements(x.recipe) r),0)) order by name) from elio.pos_event_items x where event_id=eid),'[]'),
 'cash_session',(select to_jsonb(c)||jsonb_build_object('expected_cents',elio.pos_cash_expected(eid,d)) from elio.pos_cash_sessions c where event_id=eid and sale_date=d));
 elsif p_action='pos_save_event_stock' then
 select * into st from elio.pos_event_stock where id=pid and event_id=eid;before_value:=to_jsonb(st);
 perform elio.require(pid is not null and (st.id is null and coalesce((p->>'revision')::integer,0)=0 or st.revision=(p->>'revision')::integer),'This stock item changed. Refresh first.');
 perform elio.require(length(trim(p->>'name')) between 1 and 160,'Enter a flavor or stock item name.');
 qty:=coalesce(elio.pos_event_remaining(pid),0);wanted:=(p->>'available')::integer;
 perform elio.require(qty=(p->>'expected_available')::integer,'Stock changed. Refresh before adjusting it.');
 perform elio.require(wanted between 0 and 1000000,'Enter a whole available quantity between 0 and 1,000,000.');
 perform elio.require(length(trim(p->>'reason')) between 1 and 1000,'Enter a stock adjustment reason.');
 insert into elio.pos_event_stock(id,event_id,name,capacity) values(pid,eid,trim(p->>'name'),coalesce(st.capacity,0)+wanted-qty)
 on conflict(id) do update set name=excluded.name,capacity=excluded.capacity,revision=elio.pos_event_stock.revision+1;
 select to_jsonb(s)||jsonb_build_object('remaining',wanted) into result from elio.pos_event_stock s where id=pid;
 elsif p_action='pos_save_event_item' then
 select * into it from elio.pos_event_items where id=pid and event_id=eid;before_value:=to_jsonb(it);
 perform elio.require(pid is not null and (it.id is null and coalesce((p->>'revision')::integer,0)=0 or it.revision=(p->>'revision')::integer),'This event item changed. Refresh first.');
 perform elio.require(length(trim(p->>'name')) between 1 and 160,'Enter an item name.');
 perform elio.require((p->>'price_cents')::integer between 0 and 100000000,'Enter a valid event price.');
 recipe:=p->'recipe';perform elio.require(jsonb_typeof(recipe)='array' and jsonb_array_length(recipe) between 1 and 50,'Choose the stock pieces used by this item.');
 for recipe_row in select value from jsonb_array_elements(recipe) loop
 perform elio.require(exists(select 1 from elio.pos_event_stock where id=(recipe_row->>'stock_id')::uuid and event_id=eid),'Every included stock item must belong to this event.');
 perform elio.require(recipe_row->>'quantity' ~ '^[1-9][0-9]*$' and (recipe_row->>'quantity')::integer<=10000,'Enter whole recipe quantities greater than zero.');
 end loop;
 perform elio.require((select count(distinct r->>'stock_id') from jsonb_array_elements(recipe) r)=jsonb_array_length(recipe),'Each stock item should appear once in the recipe.');
 insert into elio.pos_event_items(id,event_id,name,price_cents,recipe,active) values(pid,eid,trim(p->>'name'),(p->>'price_cents')::integer,recipe,coalesce((p->>'active')::boolean,true))
 on conflict(id) do update set name=excluded.name,price_cents=excluded.price_cents,recipe=excluded.recipe,active=excluded.active,revision=elio.pos_event_items.revision+1;
 select to_jsonb(x) into result from elio.pos_event_items x where id=pid;
 elsif p_action in ('pos_open_cash','pos_close_cash','pos_reopen_cash','pos_cash_movement') then
 select * into cs from elio.pos_cash_sessions where event_id=eid and sale_date=d for update;before_value:=to_jsonb(cs);
 if p_action='pos_open_cash' then
 perform elio.require(cs.event_id is null,'This cash session already exists. Refresh the event.');
 perform elio.require(d=(now() at time zone 'Asia/Manila')::date and ev.active and d between ev.starts_on and ev.ends_on,'Open a session for an active event today.');
 perform elio.require((p->>'opening_cents')::integer between 0 and 1000000000,'Enter the opening cash amount.');
 insert into elio.pos_cash_sessions(event_id,sale_date,opening_cents) values(eid,d,(p->>'opening_cents')::integer);
 else
 perform elio.require(cs.event_id is not null,'Open a cash session first.');
 if p_action='pos_cash_movement' then
 perform elio.require(cs.closed_at is null,'Reopen this session before recording cash movement.');
 perform elio.require(pid is not null and (p->>'amount_cents')::integer<>0 and abs((p->>'amount_cents')::bigint)<=1000000000 and length(trim(p->>'reason')) between 1 and 1000,'Enter the cash amount and reason.');
 select * into mv from elio.pos_cash_movements where id=pid;
 if mv.id is not null then perform elio.require(mv.event_id=eid and mv.sale_date=d and mv.amount_cents=(p->>'amount_cents')::integer and mv.reason=p->>'reason','This cash movement key was already used.');return to_jsonb(mv);end if;
 insert into elio.pos_cash_movements(id,event_id,sale_date,amount_cents,reason,created_by) values(pid,eid,d,(p->>'amount_cents')::integer,p->>'reason',auth.uid()) returning to_jsonb(pos_cash_movements) into result;
 else
 perform elio.require(cs.revision=(p->>'revision')::integer,'This cash session changed. Refresh first.');
 if p_action='pos_close_cash' then
 perform elio.require(cs.closed_at is null,'This session is already closed.');
 expected:=elio.pos_cash_expected(eid,d);perform elio.require(expected=(p->>'expected_cents')::bigint,'A sale or cash movement changed the expected cash. Review the count again.');
 perform elio.require((p->>'counted_cents')::integer between 0 and 1000000000,'Enter the cash you counted.');
 update elio.pos_cash_sessions set counted_cents=(p->>'counted_cents')::integer,expected_at_close=expected,closed_at=clock_timestamp(),closed_by=auth.uid(),revision=revision+1 where event_id=eid and sale_date=d;
 else
 perform elio.require(length(trim(p->>'reason')) between 1 and 1000,'Enter a reason to reopen this cash session.');
 update elio.pos_cash_sessions set closed_at=null,closed_by=null,counted_cents=null,expected_at_close=null,revision=revision+1 where event_id=eid and sale_date=d;
 end if;end if;end if;
 if result is null then select to_jsonb(c)||jsonb_build_object('expected_cents',elio.pos_cash_expected(eid,d)) into result from elio.pos_cash_sessions c where event_id=eid and sale_date=d;end if;
 elsif p_action='pos_event_report' then
 return jsonb_build_object('event',to_jsonb(ev),'date',d,'sales',coalesce((select jsonb_agg(to_jsonb(t)) from (
 select o.data#>>'{pos_payment,label}' method,count(*) orders,sum((o.data->>'total_cents')::bigint) total_cents,sum((o.data->>'delivery_cents')::bigint) delivery_cents
 from elio.orders o where o.data->>'event_id'=eid::text and elio.accounting_order_included(o) and (o.created_at at time zone 'Asia/Manila')::date=d group by 1) t),'[]'),
 'cash',(select to_jsonb(c)||jsonb_build_object('expected_cents',elio.pos_cash_expected(eid,d)) from elio.pos_cash_sessions c where event_id=eid and sale_date=d),
 'movements',coalesce((select jsonb_agg(to_jsonb(m) order by created_at) from elio.pos_cash_movements m where event_id=eid and sale_date=d),'[]'),
 'stock',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('remaining',elio.pos_event_remaining(s.id)) order by name) from elio.pos_event_stock s where event_id=eid),'[]'));
 else raise exception 'Unsupported event action';end if;end if;
 insert into elio.pos_audit(actor,action,target_id,reason,before_data,after_data) values(auth.uid(),p_action,coalesce(pid,eid),p->>'reason',before_value,result);
 return result;
end $$;
revoke all on function elio.pos_event_remaining(uuid,uuid),elio.pos_event_quote(jsonb,uuid),elio.pos_event_allocate(uuid),elio.pos_cash_expected(uuid,date),elio.pos_event_action(text,jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_quote(jsonb,uuid)'::regprocedure);
 old:=$a$perform elio.assert_staff(auth.uid(),false);$a$;
 execute replace(definition,old,old||$b$
 if p_payload->>'order_source'='in_person' then return elio.pos_event_quote(p_payload,p_original);end if;$b$);
 definition:=pg_get_functiondef('elio.pos_order_action(text,jsonb)'::regprocedure);
 old:=$a$perform elio.allocate_order(pid);perform elio.pos_allocate(pid);$a$;
 if position(old in definition)=0 then raise exception 'Event allocate hook missing';end if;
 execute replace(definition,old,old||'perform elio.pos_event_allocate(pid);');
 definition:=pg_get_functiondef('elio.pos_record_payment(uuid,jsonb)'::regprocedure);
 old:=$a$else
  select value into option_value$a$;
 if position(old in definition)=0 then raise exception 'Event payment hook missing';end if;
 execute replace(definition,old,$b$elsif o.data->>'order_source'='in_person' then
 perform elio.require(v_method in ('GCash','BDO','EastWest'),'Choose Cash, GCash, BDO, or EastWest.');method_name:=v_method;cash:=total;
 else
  select value into option_value$b$);
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$if p_action='pos_catalog' then$a$;
 execute replace(definition,old,$b$if p_action in ('pos_events','pos_save_event','pos_event_data','pos_save_event_stock','pos_save_event_item','pos_open_cash','pos_close_cash','pos_reopen_cash','pos_cash_movement','pos_event_report') then return elio.pos_event_action(p_action,p_payload);end if;
 if p_action='pos_catalog' then$b$);
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$delete from elio.pos_allocations where order_id=oid;perform elio.pos_allocate(oid);$a$;
 execute replace(definition,old,old||'delete from elio.pos_event_allocations where order_id=oid;perform elio.pos_event_allocate(oid);');
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old:=$a$then delete from elio.pos_allocations where order_id=oid;
 else update elio.pos_allocations set state='retained' where order_id=oid;end if;$a$;
 if position(old in definition)=0 then raise exception 'Event cancellation hook missing';end if;
 execute replace(definition,old,$b$then delete from elio.pos_allocations where order_id=oid;delete from elio.pos_event_allocations where order_id=oid;
 else update elio.pos_allocations set state='retained' where order_id=oid;update elio.pos_event_allocations set state='retained' where order_id=oid;end if;$b$);
end $$;
commit;
