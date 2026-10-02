begin;
-- Resolve the complete range on every report/export, using the same eligible
-- rows as the report so deleted, cancelled and refunded records stay excluded.
-- Patch only range selection to retain collected-delivery payment behavior.
do $$ declare definition text; old_text text; new_text text; begin
 definition:=pg_get_functiondef('elio.accounting_report_v2(uuid,jsonb)'::regprocedure);
 old_text:=$old$start_date:=(p_payload->>'start')::date;end_date:=(p_payload->>'end')::date;$old$;
 new_text:=$new$if p_payload->'all_time'='true'::jsonb then
  select min(r.entry_date),max(r.entry_date) into start_date,end_date
  from elio.accounting_rows_v2('-infinity'::date,'infinity'::date) r;
  start_date:=coalesce(start_date,(now() at time zone 'Asia/Manila')::date);
  end_date:=coalesce(end_date,start_date);
 else
  start_date:=(p_payload->>'start')::date;end_date:=(p_payload->>'end')::date;
 end if;$new$;
 if position(new_text in definition)=0 then
  perform elio.require(position(old_text in definition)>0,'Missing accounting date-range hook.');
  definition:=replace(definition,old_text,new_text);
 end if;
 old_text:=$old$'report_version',2,'start',start_date$old$;
 new_text:=$new$'report_version',2,'all_time',coalesce(p_payload->'all_time'='true'::jsonb,false),'start',start_date$new$;
 if position(new_text in definition)=0 then
  perform elio.require(position(old_text in definition)>0,'Missing accounting report metadata hook.');
  definition:=replace(definition,old_text,new_text);
 end if;
 execute definition;
end $$;
revoke all on function elio.accounting_report_v2(uuid,jsonb) from public,anon,authenticated,service_role;
commit;
