begin;

-- Direct sales keep their own manual discount, separate from storefront promo codes.
create function elio.direct_discount(p jsonb, subtotal bigint) returns bigint
language plpgsql immutable security invoker set search_path='' as $$
declare kind text:=coalesce(p->>'kind','none'); value bigint; amount bigint;
begin
  perform elio.require(kind in ('none','fixed','percent'),'Choose a valid discount.');
  if kind='none' then return 0; end if;
  perform elio.require(p->>'value' ~ '^[0-9]{1,10}$','Enter a whole percentage or an amount in cents.');
  value:=(p->>'value')::bigint;
  if kind='percent' then
    perform elio.require(value<=100,'The discount percentage cannot exceed 100.');
    amount:=round(subtotal*value/100.0);
  else amount:=value;
  end if;
  perform elio.require(amount<=subtotal,'The discount cannot exceed the product subtotal.');
  return amount;
end $$;
revoke all on function elio.direct_discount(jsonb,bigint) from public,anon,authenticated,service_role;

-- Direct Sales methods are labels for staff-recorded payments. Until an owner
-- customizes them, use the shop's existing configured payment labels.
create table elio.direct_payment_settings (
 id boolean primary key default true check(id), methods jsonb, revision integer not null default 0
);
alter table elio.direct_payment_settings enable row level security;
revoke all on elio.direct_payment_settings from public,anon,authenticated,service_role;
insert into elio.direct_payment_settings(id) values(true);

create function elio.direct_payment_methods() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(d.methods,(select coalesce(jsonb_agg(jsonb_build_object('label',label,'active',true) order by pos),'[]'::jsonb)
  from (select btrim(x->>'label') label,min(i) pos from jsonb_array_elements(coalesce(s.data->'payment_options','[]')) with ordinality t(x,i)
   where btrim(x->>'label')<>'' and lower(btrim(x->>'label'))<>'cash' group by btrim(x->>'label')) labels))
 from elio.direct_payment_settings d cross join elio.settings s where d.id and s.id
$$;

create function elio.save_direct_payment_methods(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v elio.direct_payment_settings; m jsonb:=p->'methods';
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(jsonb_typeof(m)='array','Choose valid payment methods.');
 perform elio.require(jsonb_array_length(m)<=49,'Use up to 49 payment methods plus Cash.');
 perform elio.require(not exists(select 1 from jsonb_array_elements(m) x where jsonb_typeof(x) is distinct from 'object'
   or jsonb_typeof(x->'label') is distinct from 'string' or jsonb_typeof(x->'active') is distinct from 'boolean'
   or length(btrim(x->>'label')) not between 1 and 80 or lower(btrim(x->>'label'))='cash'),'Give each method a name. Cash is always available.');
 select coalesce(jsonb_agg(jsonb_build_object('label',btrim(x->>'label'),'active',x->'active') order by i),'[]'::jsonb) into m
 from jsonb_array_elements(m) with ordinality t(x,i);
 perform elio.require((select count(distinct lower(x->>'label')) from jsonb_array_elements(m) x)=jsonb_array_length(m),'Payment method names must be unique.');
 select * into v from elio.direct_payment_settings where id for update;
 if v.methods is distinct from m then
  perform elio.require(v.revision=(p->>'revision')::integer,'Payment methods changed. Reopen the editor.');
  update elio.direct_payment_settings set methods=m,revision=revision+1 where id returning * into v;
 end if;
 return jsonb_build_object('methods',v.methods,'revision',v.revision);
end $$;
revoke all on function elio.direct_payment_methods(),elio.save_direct_payment_methods(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare def text:=pg_get_functiondef('elio.pos_quote(jsonb,uuid)'::regprocedure); r record;
begin
  for r in select * from (values
    ('remaining integer;d record;', 'remaining integer;d record; settings jsonb; discount bigint; override_dates boolean:=coalesce((p_payload->>''override_dates'')::boolean,false);'),
    ('::date+366,''Choose today or a fulfillment date within the next year.''','::date+730,''Choose today or a fulfillment date within the next two years.'''),
    (' for item in select value from jsonb_array_elements(p_payload->''items'') loop',$b$
 select data into settings from elio.settings where id;
 if override_dates then
  if o.id is null or not coalesce((o.data->>'override_dates')::boolean,false)
     or o.fulfillment_date<>ful or o.method<>method or o.data->>'override_reason' is distinct from p_payload->>'override_reason' then
    perform elio.assert_staff(auth.uid(),true);
  end if;
  perform elio.require(length(coalesce(p_payload->>'override_reason',''))<=500,'Keep the override reason within 500 characters.');
 elsif o.id is null or o.fulfillment_date<>ful or o.method<>method then
  perform elio.require(elio.date_supported(ful,method,settings),'This fulfillment date is closed. An owner can override the date.');
 end if;
 for item in select value from jsonb_array_elements(p_payload->'items') loop$b$),
    ('   unit:=(p->>''price_cents'')::integer;',$b$
   if needed and override_dates then perform elio.assert_staff(auth.uid(),true); end if;
   if needed and not override_dates then
    if ful=(statement_timestamp() at time zone 'Asia/Manila')::date then
     perform elio.require(coalesce((p->>'allow_same_day')::boolean,false) and (p->>'lead_days')::integer=0
       and elio.is_production(ful,settings) and (nullif(settings->>'cutoff_time','') is null
       or (statement_timestamp() at time zone 'Asia/Manila')::time<(settings->>'cutoff_time')::time),
       'This box needs an owner date override for same-day fulfillment.');
    else
     perform elio.require(ful>=elio.earliest_lead_date(statement_timestamp(),coalesce((p->>'lead_days')::integer,0),settings),
       'This box needs more production time. Choose a later date or use an owner date override.');
    end if;
   end if;
   unit:=(p->>'price_cents')::integer;$b$),
    ('   p:=jsonb_build_object(''name'',trim(item->>''name''),''kind'',''custom_item'');', $b$   perform elio.require(length(coalesce(item->>'description',''))<=2000,'Keep custom item details within 2,000 characters.');
   p:=jsonb_build_object('name',trim(item->>'name'),'kind','custom_item');$b$),
    ('''stock_requirements'',requirements,''flavor_contents'',recipe));',$b$'stock_requirements',requirements,'flavor_contents',recipe)
   || case when source='custom' and nullif(btrim(item->>'description'),'') is not null
     then jsonb_build_object('description',btrim(item->>'description')) else '{}'::jsonb end);$b$),
    (' return elio.pos_delivery_quote(p_payload,jsonb_build_object(', $b$ discount:=elio.direct_discount(p_payload->'discount',subtotal);
 return elio.pos_delivery_quote(p_payload,jsonb_build_object($b$),
    ('''discount_cents'',0,''delivery_cents'',fee,''total_cents'',subtotal+fee', $b$'discount_cents',discount,'discount',coalesce(p_payload->'discount','{"kind":"none","value":0}'::jsonb),
 'override_dates',override_dates,'override_reason',coalesce(p_payload->>'override_reason',''),
 'delivery_cents',fee,'total_cents',subtotal-discount+fee$b$)
  ) as t(anchor,replacement) loop
    perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Direct quote hook changed: '||r.anchor);
    def:=replace(def,r.anchor,r.replacement);
  end loop;
  execute def;

  def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  for r in select * from (values
    ('''instructions'',''delivery_cents''),''Unsupported order edit field:', $b$'instructions','delivery_cents')
      or (o.data->>'order_source'='direct' and field in ('discount','override_dates','override_reason')),'Unsupported order edit field:$b$),
    ('same_ops:=not (changes ?| array[''items'',''fulfillment_date'',''method'',''address'',''delivery_cents'']);', $b$same_ops:=not (changes ?| array['items','fulfillment_date','method','delivery_cents','discount','override_dates','override_reason'])
   and (not (changes ? 'address') or coalesce(o.data->>'order_source','website')='direct');
  if o.data->>'order_source'='direct' and not same_ops then
   perform elio.require(o.payment_status<>'under_review' and not o.refund_label,'Review the payment proof or refund before editing this order.');
  end if;$b$)
  ) as t(anchor,replacement) loop
    perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Direct edit hook changed: '||r.anchor);
    def:=replace(def,r.anchor,r.replacement);
  end loop;
  execute def;
  def:=pg_get_functiondef('elio.pos_catalog(date)'::regprocedure);
  perform elio.require(strpos(def,$key$jsonb_agg(data||jsonb_build_object('id',id) order by data->>'name')$key$)>0,'Missing direct flavor catalog.');
  execute replace(def,$key$jsonb_agg(data||jsonb_build_object('id',id) order by data->>'name')$key$,
   $value$jsonb_agg(data||jsonb_build_object('id',id,'remaining',case when elio.flavor_in_lineup(id,p_date) and coalesce((data->>'in_rotation')::boolean,false)
      and not exists(select 1 from elio.inventory i where i.product_id=elio.products.id and i.date=p_date and not i.available)
     then elio.capacity_remaining(id,p_date) else 0 end) order by data->>'name')$value$);

  def:=pg_get_functiondef('elio.pos_catalog(date)'::regprocedure);
  perform elio.require(strpos(def,$key$'payment_options',s->'payment_options'$key$)>0,'Missing POS payment catalog.');
  execute replace(def,$key$'payment_options',s->'payment_options'$key$,$value$'payment_options',s->'payment_options','direct_methods',elio.direct_payment_methods(),'direct_methods_revision',(select revision from elio.direct_payment_settings where id)$value$);
  def:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  perform elio.require(strpos(def,' elsif p_action=''get_order'' then')>0,'Missing direct method gateway.');
  execute replace(def,' elsif p_action=''get_order'' then',$value$ elsif p_action='pos_save_direct_methods' then return elio.save_direct_payment_methods(p_payload);
 elsif p_action='get_order' then$value$);
  def:=pg_get_functiondef('elio.pos_record_payment(uuid,jsonb)'::regprocedure);
  perform elio.require(strpos(def,$key$jsonb_array_elements(coalesce(settings->'payment_options','[]')) where value->>'label'=v_method$key$)>0,'Missing POS payment options.');
  execute replace(def,$key$jsonb_array_elements(coalesce(settings->'payment_options','[]')) where value->>'label'=v_method$key$,
    $value$jsonb_array_elements(elio.direct_payment_methods()) where value->>'label'=v_method and (value->>'active')::boolean$value$);
  def:=pg_get_functiondef('elio.pos_delivery_action(text,jsonb)'::regprocedure);
  perform elio.require(strpos(def,$key$jsonb_array_elements(coalesce(s->'payment_options','[]')) x where x->>'label'=v_method$key$)>0,'Missing delivery payment options.');
  execute replace(def,$key$jsonb_array_elements(coalesce(s->'payment_options','[]')) x where x->>'label'=v_method$key$,
    $value$jsonb_array_elements(elio.direct_payment_methods()) x where x->>'label'=v_method and (x->>'active')::boolean$value$);

  def:=pg_get_functiondef('elio.order_json(uuid,boolean,boolean)'::regprocedure);
  perform elio.require(strpos(def,'o.data-''pos_created_by''-''pos_payment''')>0,'Missing customer order projection.');
  execute replace(def,'o.data-''pos_created_by''-''pos_payment''','o.data-''pos_created_by''-''pos_payment''-''override_reason''-''override_dates''');
end $patch$;
commit;
