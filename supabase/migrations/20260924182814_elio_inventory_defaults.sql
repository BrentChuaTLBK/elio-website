-- Explicit daily quantities override the shared default. Automatic rows remain
-- unconfigured so a later default change can update them without touching saves.
alter table elio.settings add column inventory_default integer not null default 0
 check (inventory_default between 0 and 1000000);

create function elio.prepare_default_inventory() returns void
language sql set search_path='' as $$
 with days as (
  select m.month,f.id as product_id,d::date as date
  from elio.flavor_menus m cross join lateral unnest(m.flavor_ids) f(id)
  join elio.products p on p.id=f.id and p.data->>'kind'='flavor'
   and not coalesce((p.data->>'collection_hidden')::boolean,false)
  cross join lateral generate_series(greatest(m.month,(now() at time zone 'Asia/Manila')::date)::timestamp,
   (m.month+interval '1 month - 1 day')::timestamp,interval '1 day') d
  where m.month between date_trunc('month',now() at time zone 'Asia/Manila')::date
   and (date_trunc('month',now() at time zone 'Asia/Manila')+interval '1 month')::date
 ), reserved as (
  select a.product_id,a.date,sum(a.quantity)::integer as quantity from elio.allocations a
  where a.date >= (now() at time zone 'Asia/Manila')::date group by a.product_id,a.date
 )
 insert into elio.inventory(product_id,date,capacity,available,configured)
 select d.product_id,d.date,greatest(s.inventory_default,coalesce(r.quantity,0)),true,false
 from days d cross join elio.settings s left join reserved r using(product_id,date)
 where s.id
 on conflict(product_id,date) do update set capacity=excluded.capacity,available=true
 where not elio.inventory.configured and
  (elio.inventory.capacity is distinct from excluded.capacity or not elio.inventory.available)
$$;

create function elio.prepare_lineup_inventory() returns trigger
language plpgsql set search_path='' as $$
begin
 perform elio.prepare_default_inventory();
 return new;
end $$;
create trigger prepare_lineup_inventory after insert or update of flavor_ids on elio.flavor_menus
for each row execute function elio.prepare_lineup_inventory();

create function elio.save_inventory_default(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare quantity integer;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 perform elio.require(jsonb_typeof(p_payload->'quantity')='number' and
  (p_payload->>'quantity') ~ '^[0-9]{1,7}$','Enter a whole default quantity from 0 to 1,000,000.');
 quantity:=(p_payload->>'quantity')::integer;
 perform elio.require(quantity between 0 and 1000000,'Enter a whole default quantity from 0 to 1,000,000.');
 update elio.settings set inventory_default=quantity where id;
 perform elio.prepare_default_inventory();
 return jsonb_build_object('inventory_default',quantity,'inventory',elio.inventory_json());
end $$;
revoke all on function elio.prepare_default_inventory(),elio.prepare_lineup_inventory(),elio.save_inventory_default(jsonb)
 from public,anon,authenticated;

do $adapt$
declare definition text:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),''); old text;
begin
 -- Dispatch already holds the same transaction lock used by orders and stock.
 old:='perform elio.expire_orders();';
 if position(old in definition)=0 then raise exception 'Missing default inventory dispatch patch point'; end if;
 definition:=replace(definition,old,old||$patch$
 if p_action='save_inventory_default' then return elio.save_inventory_default(p_payload); end if;
 if p_action in ('admin_bootstrap','catalog','quote','create_order') then
  perform elio.prepare_default_inventory();
 end if;$patch$);
 old:=$patch$result:=jsonb_build_object('flavor_menus',elio.flavor_menu_data(false),$patch$;
 if position(old in definition)=0 then raise exception 'Missing default inventory bootstrap patch point'; end if;
 definition:=replace(definition,old,$patch$result:=jsonb_build_object('inventory_default',(select inventory_default from elio.settings where id),'flavor_menus',elio.flavor_menu_data(false),$patch$);
 execute definition;
end $adapt$;
