begin;

create table elio.daily_box_limits (
  fulfillment_date date primary key,
  capacity integer check (capacity between 0 and 1000000)
);
alter table elio.daily_box_limits enable row level security;
revoke all on table elio.daily_box_limits from public, anon, authenticated, service_role;

-- Website lines predating POS have neither source nor product_kind. They are all boxes.
-- Direct sales can mix website boxes, POS singles and manually priced items.
create function elio.box_quantity(items jsonb) returns bigint
language sql immutable security invoker set search_path='' as $$
  select coalesce(sum((line->>'quantity')::bigint),0)::bigint
  from jsonb_array_elements(items) line
  where coalesce(line->>'source','website')='website'
    and coalesce(line->>'product_kind','set') in ('set','custom_box')
$$;

create function elio.booked_boxes(day date, except_order uuid default null) returns bigint
language sql stable security invoker set search_path='' as $$
  select coalesce(sum(elio.box_quantity(o.data->'items')),0)::bigint
  from elio.orders o
  where o.fulfillment_date=day and o.id is distinct from except_order
    and coalesce(o.data->>'order_source','website') in ('website','direct')
    and (
      o.fulfillment_status not in ('cancelled','expired')
      or (o.fulfillment_status='cancelled' and exists (
        select 1 from elio.allocations a where a.order_id=o.id and a.state='retained'
      ))
    )
    and not (coalesce(o.data->>'order_source','website')='website'
      and o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation' and o.payment_deadline is not null
      and elio.maintenance_deadline(o.payment_deadline,o.created_at,statement_timestamp())<=statement_timestamp())
$$;

create function elio.check_daily_box_limit(items jsonb, day date, original uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$
declare maximum integer; requested bigint;
begin
  select capacity into maximum from elio.daily_box_limits where fulfillment_date=day;
  if maximum is null then return; end if;
  requested:=elio.box_quantity(items);
  if requested=0 then return; end if;
  -- Staff may keep or reduce an existing booking after lowering its date's limit.
  if original is not null and exists (
    select 1 from elio.orders where id=original and fulfillment_date=day
      and elio.box_quantity(data->'items')>=requested
  ) then return; end if;
  perform elio.require(requested<=maximum-elio.booked_boxes(day,original),
    'This quantity exceeds the box limit for this date. Choose fewer boxes or another date.');
end $$;

create function elio.daily_box_limits_json(staff_view boolean) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare first_day date:=(now() at time zone 'Asia/Manila')::date;
  last_day date:=(date_trunc('month',first_day)+interval '2 months - 1 day')::date;
begin
  if staff_view then
    return (select coalesce(jsonb_agg(jsonb_build_object('date',d.day,'capacity',l.capacity,
        'configured',l.fulfillment_date is not null,'reserved',elio.booked_boxes(d.day)) order by d.day),'[]'::jsonb)
      from (
        select fulfillment_date as day from elio.daily_box_limits where fulfillment_date between first_day and last_day
        union
        select fulfillment_date from elio.orders where fulfillment_date between first_day and last_day
          and coalesce(data->>'order_source','website') in ('website','direct')
      ) d left join elio.daily_box_limits l on l.fulfillment_date=d.day);
  end if;
  return (select coalesce(jsonb_object_agg(fulfillment_date,greatest(0,capacity-elio.booked_boxes(fulfillment_date))),'{}'::jsonb)
    from elio.daily_box_limits where capacity is not null and fulfillment_date between first_day and last_day);
end $$;

create function elio.save_box_limits(changes jsonb, mode text) returns void
language plpgsql volatile security invoker set search_path='' as $$
declare entry jsonb; day date; maximum integer; prior elio.daily_box_limits;
  today date:=(now() at time zone 'Asia/Manila')::date;
begin
  perform elio.assert_staff(auth.uid(),false);
  perform elio.require(mode in ('replace','fill_unconfigured'),'Choose a valid save mode.');
  perform elio.require(jsonb_typeof(changes)='array','Choose valid dates for the box limit.');
  perform elio.require(jsonb_array_length(changes) between 1 and 180,'Choose up to 180 dates for the box limit.');
  for entry in select value from jsonb_array_elements(changes) loop
    day:=(entry->>'date')::date;
    perform elio.require(day between today and (date_trunc('month',today)+interval '2 months - 1 day')::date,
      'Choose a current or upcoming fulfillment date.');
    perform elio.require(entry ? 'capacity' and (entry->'capacity'='null'::jsonb or
      (jsonb_typeof(entry->'capacity')='number' and entry->>'capacity' ~ '^[0-9]{1,7}$')),
      'Enter a whole box limit or select No limit.');
    maximum:=(entry->>'capacity')::integer;
    perform elio.require(maximum is null or maximum between 0 and 1000000,'Enter a box limit from 0 to 1,000,000.');
    select * into prior from elio.daily_box_limits where fulfillment_date=day;
    if found and (mode='fill_unconfigured' or prior.capacity is not distinct from maximum) then continue; end if;
    perform elio.require((prior.fulfillment_date is not null) is not distinct from (entry->>'configured')::boolean
      and prior.capacity is not distinct from (entry->>'expected')::integer,
      'The box limit changed. Refresh Daily quantities and review the selected dates.');
    insert into elio.daily_box_limits(fulfillment_date,capacity) values(day,maximum)
      on conflict(fulfillment_date) do update set capacity=excluded.capacity;
  end loop;
end $$;

revoke all on function elio.box_quantity(jsonb), elio.booked_boxes(date,uuid),
  elio.check_daily_box_limit(jsonb,date,uuid), elio.daily_box_limits_json(boolean),
  elio.save_box_limits(jsonb,text) from public,anon,authenticated,service_role;

-- Website checkout and direct POS already recheck flavor stock under the same
-- transaction lock as inventory saves. Event POS uses its independent stock ledger.
do $migration$
declare definition text; hook text;
begin
  definition:=pg_get_functiondef('elio.check_stock(jsonb,date,uuid,boolean)'::regprocedure);
  hook:='for d in select * from elio.stock_demand(p_items)';
  perform elio.require(strpos(definition,hook)>0,'Stock validation hook missing.');
  execute replace(definition,hook,'perform elio.check_daily_box_limit(p_items,p_date,p_original); '||hook);

  definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  hook:=$h$'settings',s-'owner_email','zones'$h$;
  perform elio.require(strpos(definition,hook)>0,'Shop catalog settings hook missing.');
  definition:=replace(definition,hook,$h$'settings',(s-'owner_email')||jsonb_build_object('daily_box_remaining',elio.daily_box_limits_json(false)),'zones'$h$);
  hook:=$h$result:=jsonb_build_object('inventory_default',$h$;
  perform elio.require(strpos(definition,hook)>0,'Dashboard inventory hook missing.');
  definition:=replace(definition,hook,$h$result:=jsonb_build_object('daily_box_limits',elio.daily_box_limits_json(true),'inventory_default',$h$);
  hook:=$h$elsif p_action='save_inventory' then$h$;
  perform elio.require(strpos(definition,hook)>0,'Daily quantities action hook missing.');
  definition:=replace(definition,hook,$h$elsif p_action in ('save_inventory','save_box_quantities') then$h$);
  hook:='return elio.save_daily_quantities(p_payload);';
  perform elio.require(strpos(definition,hook)>0,'Daily quantities save hook missing.');
  execute replace(definition,hook,$h$if p_action='save_box_quantities' then
    perform elio.require(jsonb_typeof(p_payload->'rows')='array','Choose valid flavor quantities.');
    perform elio.save_box_limits(p_payload->'box_limits',coalesce(p_payload->>'mode','replace'));
    if jsonb_array_length(p_payload->'rows')>0 then result:=elio.save_daily_quantities(p_payload);
    else result:=elio.inventory_json(); end if;
    return jsonb_build_object('inventory',result,'daily_box_limits',elio.daily_box_limits_json(true));
  end if;
  return elio.save_daily_quantities(p_payload);$h$);
end $migration$;
commit;
