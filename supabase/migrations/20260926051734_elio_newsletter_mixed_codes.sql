-- Every new six-character offer includes a letter and a digit. Existing codes
-- and the unique-index collision retry are preserved.
do $$
declare
 definition text:=pg_get_functiondef('elio.newsletter_activate(uuid)'::regprocedure);
 hook text:=$old$   select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%32+1,1),'' order by n)
    into v_code from (select extensions.gen_random_bytes(6) bytes) entropy cross join generate_series(0,5) n;$old$;
begin
 perform elio.require(length(definition)-length(replace(definition,hook,''))=length(hook),
  'Expected newsletter offer generator was not found.');
 definition:=replace(definition,hook,$new$   select string_agg(case n
     when 0 then substr('ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%24+1,1)
     when 1 then substr('23456789',get_byte(bytes,n)%8+1,1)
     else substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%32+1,1)
    end,'' order by get_byte(bytes,n+6),n)
    into v_code from (select extensions.gen_random_bytes(12) bytes) entropy cross join generate_series(0,5) n;$new$);
 execute definition;
end $$;
