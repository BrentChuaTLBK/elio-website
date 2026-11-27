begin;

create function elio.confirm_pos_gift(target uuid, advance_revision boolean) returns void
language plpgsql set search_path='' as $$
begin
  update elio.orders
  set payment_status='paid',
      paid_amount_cents=0,
      payment_deadline='infinity'::timestamptz,
      fulfillment_status=case when fulfillment_status='pending_confirmation' then
        case when data->>'pos_handed_over'='true' then 'completed' else 'confirmed' end
        else fulfillment_status end,
      data=data||jsonb_build_object('pos_payment',jsonb_build_object(
        'method','gift','label','Gift','recorded_by',auth.uid(),'recorded_at',clock_timestamp())),
      revision=revision+advance_revision::integer
  where id=target and data->>'order_source'='direct' and data->>'gift'='true'
    and (data->>'total_cents')::bigint=0 and coalesce(paid_amount_cents,0)=0;
  perform elio.require(found,'Only a zero-charge Direct order can be confirmed as a gift.');
  update elio.allocations set state='committed' where order_id=target and state='held';
  update elio.pos_allocations set state='committed' where order_id=target and state='held';
end $$;
revoke all on function elio.confirm_pos_gift(uuid,boolean) from public,anon,authenticated,service_role;

do $migration$
declare
  definition text;
  change record;
begin
  definition:=pg_get_functiondef('elio.pos_quote(jsonb,uuid)'::regprocedure);
  for change in select * from (values
    ($old$begin
 perform elio.assert_staff(auth.uid(),false);$old$,
     $new$gift_order boolean;
begin
 perform elio.assert_staff(auth.uid(),false);
 perform elio.require(not (p_payload ? 'gift') or jsonb_typeof(p_payload->'gift')='boolean','Choose whether this Direct order is a gift.');
 perform elio.require(not coalesce((p_payload->>'gift')::boolean,false) or p_payload->>'order_source'='direct','Gift orders are available in Direct orders.');$new$),
    ($old$ select data into settings from elio.settings where id;$old$,
     $new$ gift_order:=coalesce((p_payload->>'gift')::boolean,(o.data->>'gift')::boolean,false);
 if gift_order then
  perform elio.require(coalesce(o.paid_amount_cents,0)=0 and o.payment_status is distinct from 'under_review'
    and coalesce(o.data#>>'{delivery_charge,state}','')<>'paid'
    and coalesce(o.data#>>'{delivery_charge,proof_status}','')<>'under_review',
    'Resolve any recorded payments or receipts before waiving this order.');
 elsif o.data->>'gift'='true' then
  raise exception 'A saved gift remains a no-charge order.';
 end if;

 select data into settings from elio.settings where id;$new$),
    ($old$ discount:=elio.direct_discount(p_payload->'discount',subtotal);$old$,
     $new$ if gift_order then
  -- Keep the validated recipe and stock requirements, but record the charged amounts as zero.
  select jsonb_agg(line.item||jsonb_build_object('unit_price_cents',0,'line_total_cents',0,'selection_labels',
    coalesce((select jsonb_agg(case when jsonb_typeof(saved_choice.value)='object'
      then saved_choice.value||jsonb_build_object('surcharge_cents',0) else saved_choice.value end order by saved_choice.ordinality)
      from jsonb_array_elements(coalesce(nullif(line.item->'selection_labels','null'::jsonb),'[]'::jsonb))
        with ordinality saved_choice(value,ordinality)),'[]'::jsonb)) order by line.ordinality)
  into items from jsonb_array_elements(items) with ordinality line(item,ordinality);
  subtotal:=0; fee:=0; discount:=0;
 else
  discount:=elio.direct_discount(p_payload->'discount',subtotal);
 end if;$new$),
    ($old$'discount',coalesce(p_payload->'discount','{"kind":"none","value":0}'::jsonb),$old$,
     $new$'discount',case when gift_order then '{"kind":"none","value":0}'::jsonb else coalesce(p_payload->'discount','{"kind":"none","value":0}'::jsonb) end,$new$),
    ($old$'delivery_zone_description',''),p_original);$old$,
     $new$'delivery_zone_description','')||(case when gift_order then '{"gift":true}'::jsonb else '{}'::jsonb end),p_original);$new$)
  ) as t(anchor,replacement) loop
    perform elio.require(length(definition)-length(replace(definition,change.anchor,''))=length(change.anchor),'Gift quote hook changed: '||change.anchor);
    definition:=replace(definition,change.anchor,change.replacement);
  end loop;
  execute definition;

  definition:=pg_get_functiondef('elio.pos_delivery_quote(jsonb,jsonb,uuid)'::regprocedure);
  change.anchor:=$old$ if coalesce(p->>'order_source','')<>'direct' then return q;end if;$old$;
  perform elio.require(position(change.anchor in definition)>0,'Direct delivery quote hook changed.');
  execute replace(definition,change.anchor,change.anchor||$new$
 if q->>'gift'='true' then
  return q||jsonb_build_object('delivery_charge',case when p->>'method'='delivery'
    then jsonb_build_object('state','included','recipient','elio','fee_cents',0) else null end);
 end if;$new$);

  definition:=pg_get_functiondef('elio.pos_order_action(text,jsonb)'::regprocedure);
  for change in select * from (values
    ($old$paid:=coalesce((p_payload->>'paid')::boolean,false);$old$,
     $new$paid:=coalesce((p_payload->>'paid')::boolean,false) or (p_payload->>'gift') is not distinct from 'true';$new$),
    ($old$  if paid then perform elio.pos_record_payment(pid,p_payload->'payment');end if;$old$,
     $new$  if q->>'gift'='true' then perform elio.confirm_pos_gift(pid,true);
  elsif paid then perform elio.pos_record_payment(pid,p_payload->'payment');end if;$new$),
    ($old$ if coalesce((p_payload->>'send_email')::boolean,false) then perform elio.queue_email(pid,case when paid then 'payment_approved' else 'order_submitted' end,$old$,
     $new$ if coalesce((p_payload->>'send_email')::boolean,false) and (q->>'gift') is distinct from 'true' then perform elio.queue_email(pid,case when paid then 'payment_approved' else 'order_submitted' end,$new$)
  ) as t(anchor,replacement) loop
    perform elio.require(length(definition)-length(replace(definition,change.anchor,''))=length(change.anchor),'Gift save hook changed: '||change.anchor);
    definition:=replace(definition,change.anchor,change.replacement);
  end loop;
  execute definition;

  definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
  for change in select * from (values
    ($old$field in ('discount','override_dates','override_reason'))$old$,
     $new$field in ('discount','override_dates','override_reason','gift'))$new$),
    ($old$array['items','fulfillment_date','method','delivery_cents','discount','override_dates','override_reason']$old$,
     $new$array['items','fulfillment_date','method','delivery_cents','discount','override_dates','override_reason','gift']$new$),
    ($old$  if p_action='preview_edit_order' then return before_order||merged||jsonb_build_object('preview',true); end if;$old$,
     $new$  if q->>'gift'='true' then merged:=merged||jsonb_build_object('gift',true,'discount',q->'discount');end if;
  if p_action='preview_edit_order' then return before_order||merged||jsonb_build_object('preview',true); end if;$new$),
    ($old$else '{}'::jsonb end),'Prices changed since the amendment preview.$old$,
     $new$else '{}'::jsonb end
    || case when (p_payload->'expected_quote') ? 'gift' then jsonb_build_object('gift',merged->'gift') else '{}'::jsonb end),'Prices changed since the amendment preview.$new$),
    ($old$ end if;
 end if;
 if p_action='cancel_order' and o.data->>'order_source' in ('in_person','direct') then$old$,
     $new$ end if;
 if q->>'gift'='true' and (o.data->>'gift') is distinct from 'true' then perform elio.confirm_pos_gift(oid,false);end if;
 end if;
 if p_action='cancel_order' and o.data->>'order_source' in ('in_person','direct') then$new$)
  ) as t(anchor,replacement) loop
    perform elio.require(length(definition)-length(replace(definition,change.anchor,''))=length(change.anchor),'Gift edit hook changed: '||change.anchor);
    definition:=replace(definition,change.anchor,change.replacement);
  end loop;
  execute definition;

  definition:=pg_get_functiondef('elio.pos_delivery_action(text,jsonb)'::regprocedure);
  change.anchor:=$old$ perform elio.require(o.data->>'order_source'='direct' and o.method='delivery','Choose a direct delivery order.');$old$;
  perform elio.require(position(change.anchor in definition)>0,'Direct delivery payment hook changed.');
  execute replace(definition,change.anchor,change.anchor||$new$
 perform elio.require((o.data->>'gift') is distinct from 'true','Delivery is already waived for this gift.');$new$);

  definition:=pg_get_functiondef('elio.accounting_rows_v2(date,date)'::regprocedure);
  change.anchor:=$old$where l.entry_date between p_start and p_end and elio.accounting_order_included(o)$old$;
  perform elio.require(position(change.anchor in definition)>0,'Automatic accounting entry hook changed.');
  -- A reclassified zero-payment gift retains its audit history and any real
  -- delivery expenses, while its former sale and discount leave the report.
  execute replace(definition,change.anchor,change.anchor||$new$ and (o.data->>'gift') is distinct from 'true'$new$);
end
$migration$;

commit;
