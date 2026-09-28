begin;

create function elio.validate_payment_options(p_options jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; result jsonb:='[]'; field text; value text; normalized jsonb;
begin
 perform elio.require(jsonb_typeof(p_options)='array','Payment options must be a list.');
 perform elio.require(jsonb_array_length(p_options)<=20,'Save no more than 20 payment options.');
 for item in select opt.value from jsonb_array_elements(p_options) opt loop
  perform elio.require(jsonb_typeof(item)='object','Each payment option must contain account details.');
  normalized:='{}';
  foreach field in array array['label','account_name','account_number'] loop
   perform elio.require(jsonb_typeof(item->field)='string','Enter a method name, account name and account number.');
   value:=btrim(item->>field);
   perform elio.require(length(value) between 1 and case field when 'label' then 80 when 'account_name' then 140 else 100 end and value !~ E'[\n\r\t]','Payment names and numbers must be complete, on one line and within their length limits.');
   normalized:=normalized||jsonb_build_object(field,value);
  end loop;
  perform elio.require(not (item ? 'note') or item->'note'='null'::jsonb or jsonb_typeof(item->'note')='string','Payment instructions must be text.');
  value:=btrim(coalesce(item->>'note',''));
  perform elio.require(length(value)<=500,'Each payment option can have up to 500 characters of instructions.');
  result:=result||jsonb_build_array(normalized||jsonb_build_object('note',value));
 end loop;
 return result;
end $$;
revoke all on function elio.validate_payment_options(jsonb) from public,anon,authenticated,service_role;

-- Keep the existing order email renderer and older clients supplied with the
-- same saved payment details as the structured cards.
create function elio.payment_options_text(p_options jsonb,p_note text)
returns text language sql immutable security invoker set search_path='' as $$
 select concat_ws(E'\n\n',case when jsonb_array_length(p_options)>0 then 'Accepted Payment Methods:' end,
  (select string_agg(concat_ws(E'\n',value->>'label',value->>'account_name',value->>'account_number',nullif(value->>'note','')),E'\n\n' order by ordinal)
   from jsonb_array_elements(p_options) with ordinality as options(value,ordinal)),nullif(btrim(p_note),''));
$$;
revoke all on function elio.payment_options_text(jsonb,text) from public,anon,authenticated,service_role;

-- Convert only the recognized existing three-line account format. Unrecognized
-- instructions stay intact and remain editable as general instructions.
do $$
declare s jsonb; body text; block text; lines text[]; options jsonb:='[]'; valid boolean:=true;
begin
 select data into s from elio.settings where id for update;
 if not(s ? 'payment_options') and coalesce(s->>'payment_instructions','') ~* '^Accepted Payment Methods:' then
  body:=regexp_replace(replace(s->>'payment_instructions',E'\r',''),'^Accepted Payment Methods:[[:space:]]*','','i');
  foreach block in array regexp_split_to_array(btrim(body),E'\n[ \t]*\n') loop
   lines:=regexp_split_to_array(btrim(block),E'\n');
   if cardinality(lines)<>3 or btrim(lines[1])='' or btrim(lines[2])='' or btrim(lines[3]) !~ '^[+0-9][0-9 +()-]{3,99}$' then valid:=false;exit;end if;
   options:=options||jsonb_build_array(jsonb_build_object('label',btrim(lines[1]),'account_name',btrim(lines[2]),'account_number',btrim(lines[3]),'note',''));
  end loop;
  if valid and jsonb_array_length(options)>0 then
   update elio.settings set data=s||jsonb_build_object('payment_options',elio.validate_payment_options(options),'payment_note','','payment_options_revision',1) where id;
  end if;
 end if;
end $$;

do $$
declare definition text; hook text;
begin
 definition:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),E'\r\n',E'\n');
 hook:=$old$elsif p_action='save_settings' then
   row_data:=s||coalesce(p_payload->'settings','{}');$old$;
 perform elio.require(position(hook in definition)>0,'Missing payment settings validation hook.');
 definition:=replace(definition,hook,$new$elsif p_action='save_settings' then
   select data into s from elio.settings where id for update;
   row_data:=s||coalesce(p_payload->'settings','{}');
   if row_data ? 'payment_options' then
    row_data:=jsonb_set(row_data,'{payment_options}',elio.validate_payment_options(row_data->'payment_options'));
    perform elio.require(not(row_data ? 'payment_note') or row_data->'payment_note'='null'::jsonb or jsonb_typeof(row_data->'payment_note')='string','General payment instructions must be text.');
    perform elio.require(length(coalesce(row_data->>'payment_note',''))<=2000,'General payment instructions can have up to 2000 characters.');
    row_data:=row_data||jsonb_build_object('payment_note',btrim(coalesce(row_data->>'payment_note','')));
    if (s->'payment_options',s->>'payment_note') is distinct from (row_data->'payment_options',row_data->>'payment_note') then
     perform elio.require(coalesce((p_payload->'settings'->>'payment_options_revision')::integer,0)=coalesce((s->>'payment_options_revision')::integer,0),'Payment options changed. Refresh before saving your changes.');
     row_data:=row_data||jsonb_build_object('payment_options_revision',coalesce((s->>'payment_options_revision')::integer,0)+1);
    else
     row_data:=row_data||jsonb_build_object('payment_options_revision',coalesce((s->>'payment_options_revision')::integer,0));
    end if;
    perform elio.require(coalesce((row_data->>'paused')::boolean,true) or jsonb_array_length(row_data->'payment_options')>0,'Add at least one payment option before opening orders.');
    row_data:=row_data||jsonb_build_object('payment_instructions',elio.payment_options_text(row_data->'payment_options',row_data->>'payment_note'));
   end if;$new$);
 hook:=$old$'payment_instructions',s->>'payment_instructions','pickup_address'$old$;
 perform elio.require(position(hook in definition)>0,'Missing order payment snapshot hook.');
 execute replace(definition,hook,$new$'payment_instructions',s->>'payment_instructions','payment_options',s->'payment_options','payment_note',s->>'payment_note','pickup_address'$new$);
end $$;

commit;
