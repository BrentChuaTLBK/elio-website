-- Retire catalog items without deleting order snapshots, stock, or accounting.
begin;
alter table elio.products add column deleted_at timestamptz;

create function elio.guard_product_deletion() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' then
  perform elio.require(old.deleted_at is null,'This item has been deleted. Create a new item instead.');
 end if;
 -- The private column is authoritative; clients cannot inject a deletion flag.
 new.data:=new.data-'deleted_at';
 if new.deleted_at is not null then
  new.data:=new.data||jsonb_build_object('deleted_at',new.deleted_at,'active',false,'in_rotation',false,'collection_hidden',true);
 end if;
 return new;
end $$;
create trigger aa_guard_product_deletion before insert or update on elio.products
 for each row execute function elio.guard_product_deletion();

create function elio.delete_product(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p elio.products; affected integer;
begin
 perform elio.assert_staff(auth.uid(),true);
 -- Same lock as checkout: a deletion and new reservation cannot race.
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into p from elio.products where id=(p_payload->>'id')::uuid for update;
 perform elio.require(p.id is not null,'This catalog item could not be found.');
 if p.deleted_at is not null then return jsonb_build_object('deleted',true,'id',p.id); end if;
 select count(*) into affected from elio.products
  where deleted_at is null and data->>'kind'='set' and data->'box_flavors' @> jsonb_build_array(p.id::text);
 update elio.products set deleted_at=clock_timestamp() where id=p.id;
 -- Keep the recipe and allocation references. Hidden flavors cannot be ordered;
 -- remove future lineup memberships so they cannot be selected again.
 if p.data->>'kind'='flavor' then
  update elio.flavor_menus set flavor_ids=array_remove(flavor_ids,p.id),updated_at=clock_timestamp()
   where month>=date_trunc('month',now() at time zone 'Asia/Manila')::date and p.id=any(flavor_ids);
 end if;
 return jsonb_build_object('deleted',true,'id',p.id,'unavailable_boxes',affected);
end $$;

do $adapt$
declare def text; anchor text:=$x$ if p_action='account_access' then$x$;
begin
 def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 if position(anchor in def)=0 then raise exception 'Missing catalog deletion dispatch hook';end if;
 execute replace(def,anchor,$x$ if p_action='delete_product' then return elio.delete_product(p_payload);end if;
$x$||anchor);
end $adapt$;
revoke all on function elio.guard_product_deletion(),elio.delete_product(jsonb) from public,anon,authenticated,service_role;
commit;
