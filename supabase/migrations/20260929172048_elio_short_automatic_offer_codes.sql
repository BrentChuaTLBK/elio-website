-- New automatic offers use the existing newsletter's six-character mixed format.
-- Issued promo/voucher records and the atomic unique-code retry remain untouched.
begin;
do $$
declare
 definition text:=pg_get_functiondef('elio.voucher_completed_order()'::regprocedure);
 hook text:=$old$   v_code:='ELIO-'||upper(encode(extensions.gen_random_bytes(5),'hex'));$old$;
begin
 perform elio.require(length(definition)-length(replace(definition,hook,''))=length(hook),'Expected automatic offer code generator was not found.');
 definition:=replace(definition,hook,$new$   select string_agg(case n
     when 0 then substr('ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%24+1,1)
     when 1 then substr('23456789',get_byte(bytes,n)%8+1,1)
     else substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ',get_byte(bytes,n)%32+1,1)
    end,'' order by get_byte(bytes,n+6),n)
    into v_code from (select extensions.gen_random_bytes(12) bytes) entropy cross join generate_series(0,5) n;$new$);
 execute definition;
 definition:=pg_get_functiondef('elio.voucher_email_preview(jsonb)'::regprocedure);
 hook:=$old$'code','ELIO-PREVIEW'$old$;
 perform elio.require(length(definition)-length(replace(definition,hook,''))=length(hook),'Expected automatic offer preview code was not found.');
 execute replace(definition,hook,$new$'code','K7M4Q2'$new$);
end $$;
commit;
