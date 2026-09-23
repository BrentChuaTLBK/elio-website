-- A readable courier reference is separate from the private UUID and access token.
-- Six symbols from a 32-character alphabet: no I/O/0/1 ambiguity, no date or sequence.
create function elio.new_order_reference() returns text
language plpgsql volatile security invoker set search_path='' as $$
declare
 alphabet constant text:='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
 random_bytes bytea; candidate text; attempt integer; symbol_count integer; i integer;
begin
 -- Use the same transaction lock as create_order so collision checks and inserts
 -- remain serialized. The existing unique index is the final uniqueness guard.
 perform pg_advisory_xact_lock(841721950318::bigint);
 for attempt in 1..20 loop
  -- Retry five candidates at each length, then expand if a longer code is needed.
  symbol_count:=6+(attempt-1)/5;
  random_bytes:=extensions.gen_random_bytes(symbol_count);
  candidate:='ELIO-';
  for i in 0..symbol_count-1 loop
   candidate:=candidate||substr(alphabet,(get_byte(random_bytes,i)%32)+1,1);
  end loop;
  if not exists(select 1 from elio.orders where reference=candidate) then return candidate; end if;
 end loop;
 raise exception 'Could not assign an order reference. Please try again.';
end $$;
revoke all on function elio.new_order_reference() from public,anon,authenticated;

do $adapt$
declare def text; old text;
begin
 def:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),'');
 old:=$x$'ELIO-'||to_char(now() at time zone 'Asia/Manila','YYMMDD')||'-'||upper(substr(replace(oid::text,'-',''),1,10))$x$;
 if position(old in def)=0 then raise exception 'Missing order reference patch point'; end if;
 def:=replace(def,old,'elio.new_order_reference()');
 execute def;
end $adapt$;

-- Existing references and secure links remain unchanged.
