begin;
create table elio.website_maintenance (
 id boolean primary key default true check(id),revision integer not null default 1,
 data jsonb not null default '{"mode":"off","announce":false,"pause_uploads":true,"message":"We’re making a few improvements. Thank you for your patience.","starts_at":null,"ends_at":null}'::jsonb
);
insert into elio.website_maintenance(id) values(true);
create table elio.maintenance_windows (
 id uuid primary key default gen_random_uuid(),starts_at timestamptz not null,ends_at timestamptz,
 pause_uploads boolean not null,created_by uuid not null,
 check(ends_at is null or ends_at>=starts_at)
);
create index maintenance_windows_time on elio.maintenance_windows(starts_at,ends_at);
alter table elio.website_maintenance enable row level security;
alter table elio.maintenance_windows enable row level security;
revoke all on elio.website_maintenance,elio.maintenance_windows from public,anon,authenticated,service_role;

create function elio.maintenance_state(p_at timestamptz default statement_timestamp()) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('active',w.id is not null,'uploads_paused',coalesce(w.pause_uploads,false),
  'announce',coalesce((m.data->>'announce')::boolean,false) and ((m.data->>'ends_at') is null or (m.data->>'ends_at')::timestamptz>p_at),
  'message',m.data->>'message','starts_at',case when w.id is not null then to_jsonb(w.starts_at) else m.data->'starts_at' end,
  'ends_at',case when w.id is not null then to_jsonb(w.ends_at) else m.data->'ends_at' end,'server_time',p_at)
 from elio.website_maintenance m left join lateral (select * from elio.maintenance_windows
  where starts_at<=p_at and (ends_at is null or ends_at>p_at) order by starts_at desc limit 1)w on true where m.id;
$$;

-- Stop the payment clock only while uploads were actually paused. Historical
-- windows are retained after edits. A pause never revives an already-late order.
create function elio.maintenance_deadline(p_deadline timestamptz,p_created timestamptz,p_at timestamptz default statement_timestamp()) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare result timestamptz:=p_deadline;win record;first_at timestamptz;last_at timestamptz;counted_until timestamptz:=p_created;
begin
 for win in select starts_at,ends_at from elio.maintenance_windows where pause_uploads and starts_at<p_at and (ends_at is null or ends_at>p_created) order by starts_at,id loop
  first_at:=greatest(win.starts_at,p_created,counted_until);last_at:=least(coalesce(win.ends_at,p_at),p_at);
  if first_at<result and last_at>first_at then result:=result+(last_at-first_at);end if;
  counted_until:=greatest(counted_until,last_at);
 end loop;
 return result;
end $$;

create function elio.maintenance_admin(p_action text,p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare old elio.website_maintenance;incoming jsonb;mode_value text;starts timestamptz;ends timestamptz;moment timestamptz:=clock_timestamp();changed boolean;
begin
 perform elio.assert_staff(auth.uid(),true);
 if p_action='maintenance_admin' then return (select jsonb_build_object('settings',data,'revision',revision,'status',elio.maintenance_state()) from elio.website_maintenance where id);end if;
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into strict old from elio.website_maintenance where id for update;
 perform elio.require((p_payload->>'revision')::integer=old.revision,'Maintenance settings changed. Refresh before saving.');
 incoming:=p_payload->'settings';mode_value:=incoming->>'mode';
 perform elio.require(mode_value in ('off','manual','scheduled'),'Choose a maintenance mode.');
 perform elio.require(jsonb_typeof(incoming->'announce')='boolean' and jsonb_typeof(incoming->'pause_uploads')='boolean','Choose the announcement and upload settings.');
 perform elio.require(length(btrim(incoming->>'message')) between 1 and 400,'Enter a maintenance message of 1–400 characters.');
 starts:=nullif(incoming->>'starts_at','')::timestamptz;ends:=nullif(incoming->>'ends_at','')::timestamptz;
 perform elio.require(ends is null or (starts is not null and ends>starts),'The end time must be after the start time.');
 if mode_value='scheduled' then
  perform elio.require(starts is not null and ends is not null and ends>moment,'Choose a start and future end for scheduled maintenance.');
  perform elio.require(starts>=moment-interval '1 minute' or (old.data->>'mode'='scheduled' and starts=(old.data->>'starts_at')::timestamptz),'Choose a future start time.');
 end if;
 if (incoming->>'announce')::boolean then perform elio.require(starts is not null and ends is not null,'Set the planned start and end for the announcement.');end if;
 incoming:=jsonb_build_object('mode',mode_value,'announce',(incoming->>'announce')::boolean,'pause_uploads',(incoming->>'pause_uploads')::boolean,
  'message',btrim(incoming->>'message'),'starts_at',starts,'ends_at',ends);
 changed:=old.data->>'mode' is distinct from mode_value or old.data->'pause_uploads' is distinct from incoming->'pause_uploads'
  or (mode_value='scheduled' and (old.data->'starts_at' is distinct from incoming->'starts_at' or old.data->'ends_at' is distinct from incoming->'ends_at'));
 if changed then
  -- End active windows now and neutralize future windows; never erase elapsed pauses.
  update elio.maintenance_windows set ends_at=greatest(starts_at,moment) where ends_at is null or ends_at>moment;
  if mode_value in ('manual','scheduled') then
   insert into elio.maintenance_windows(starts_at,ends_at,pause_uploads,created_by)
   values(case when mode_value='manual' then moment else greatest(starts,moment) end,case when mode_value='scheduled' then ends else null end,(incoming->>'pause_uploads')::boolean,auth.uid());
  end if;
 end if;
 update elio.website_maintenance set data=incoming,revision=revision+1 where id;
 return (select jsonb_build_object('settings',data,'revision',revision,'status',elio.maintenance_state()) from elio.website_maintenance where id);
end $$;

do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook:=' if p_action=''catalog'' then';
 perform elio.require(position(hook in definition)>0,'Missing maintenance dispatch hook.');
 definition:=replace(definition,hook,$new$
 if p_action='site_status' then return elio.maintenance_state(); end if;
 if p_action in ('maintenance_admin','save_maintenance') then return elio.maintenance_admin(p_action,p_payload);end if;
 if p_action='quote' then perform elio.require(not (elio.maintenance_state()->>'active')::boolean,'Elio is undergoing maintenance. New orders will reopen when maintenance ends.');end if;
$new$||hook);
 hook:='  perform elio.validate_contact(p_payload);';
 perform elio.require(position(hook in definition)>0,'Missing new-order maintenance guard.');
 execute replace(definition,hook,$new$  perform elio.require(not (elio.maintenance_state()->>'active')::boolean,'Elio is undergoing maintenance. New orders will reopen when maintenance ends.');
$new$||hook);

 definition:=pg_get_functiondef('elio.expire_orders()'::regprocedure);
 hook:='payment_deadline <= clock_timestamp()';
 perform elio.require(position(hook in definition)>0,'Missing maintenance expiry hook.');
 execute replace(definition,hook,'elio.maintenance_deadline(payment_deadline,created_at,clock_timestamp()) <= clock_timestamp()');

 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook:='clock_timestamp()<o.payment_deadline';
 perform elio.require(position(hook in definition)>0,'Missing maintenance proof deadline hook.');
 definition:=replace(definition,hook,'clock_timestamp()<elio.maintenance_deadline(o.payment_deadline,o.created_at,clock_timestamp())');
 hook:='  perform elio.require(o.payment_status=''awaiting_payment''';
 perform elio.require(position(hook in definition)>0,'Missing maintenance proof guard.');
 execute replace(definition,hook,$new$  perform elio.require(not (elio.maintenance_state()->>'uploads_paused')::boolean,'Payment-proof uploads are paused for maintenance. Your remaining upload time is protected. Please return when maintenance ends.');
$new$||hook);

 definition:=pg_get_functiondef('elio.order_json(uuid,boolean,boolean)'::regprocedure);
 hook:='''payment_deadline'',o.payment_deadline';
 perform elio.require(position(hook in definition)>0,'Missing maintenance order deadline hook.');
 execute replace(definition,hook,$new$'payment_deadline',elio.maintenance_deadline(o.payment_deadline,o.created_at),
 'uploads_paused',o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation' and (elio.maintenance_state()->>'uploads_paused')::boolean,
 'payment_seconds_remaining',greatest(0,extract(epoch from (elio.maintenance_deadline(o.payment_deadline,o.created_at)-statement_timestamp())))::integer$new$);
end $$;
revoke all on function elio.maintenance_state(timestamptz),elio.maintenance_deadline(timestamptz,timestamptz,timestamptz),elio.maintenance_admin(text,jsonb) from public,anon,authenticated,service_role;
commit;
