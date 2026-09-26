-- Optional courier links are staff-owned order metadata. They never progress an
-- order, approve a payment, or change its stock allocation.
create function elio.normalize_delivery_tracking_url(value jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare
 raw_url text; tracking_url text; parts text[]; authority text; host text; port text;
begin
 perform elio.require(value is null or jsonb_typeof(value) in ('null','string'),
   'Enter a valid HTTP or HTTPS delivery tracking link.');
 raw_url:=coalesce(value#>>'{}','');
 tracking_url:=nullif(btrim(raw_url),'');
 if tracking_url is null then return null; end if;
 perform elio.require(length(tracking_url)<=2048 and tracking_url !~ '[[:space:][:cntrl:]\\]'
   and tracking_url !~* '%(0[0-9a-f]|1[0-9a-f]|7f)',
   'Enter a valid HTTP or HTTPS delivery tracking link (maximum 2048 characters).');
 parts:=regexp_match(tracking_url,'^https?://([^/?#]+)([/?#].*)?$','i');
 perform elio.require(parts is not null,'Enter a full HTTP or HTTPS delivery tracking link.');
 authority:=parts[1];
 perform elio.require(position('@' in authority)=0,'Tracking links must not include a username or password.');
 if left(authority,1)='[' then
  parts:=regexp_match(authority,'^\[([0-9a-fA-F:.]+)\](:([0-9]{1,5}))?$');
  perform elio.require(parts is not null,'Enter a valid tracking link host.');
  host:=parts[1]; port:=parts[3];
  begin
   perform elio.require(family(host::inet)=6,'Enter a valid tracking link host.');
  exception when invalid_text_representation then
   raise exception 'Enter a valid tracking link host.' using errcode='22023';
  end;
 else
  parts:=regexp_match(authority,'^([A-Za-z0-9.-]+)(:([0-9]{1,5}))?$');
  perform elio.require(parts is not null,'Enter a valid tracking link host.');
  host:=parts[1]; port:=parts[3];
  perform elio.require(length(host)<=253 and host ~ '^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$',
    'Enter a valid tracking link host.');
  if host ~ '^[0-9.]+$' then
   begin
    perform elio.require(family(host::inet)=4 and masklen(host::inet)=32,'Enter a valid tracking link host.');
   exception when invalid_text_representation then
    raise exception 'Enter a valid tracking link host.' using errcode='22023';
   end;
  end if;
 end if;
 perform elio.require(port is null or port::integer between 1 and 65535,'Enter a valid tracking link port.');
 return tracking_url;
end $$;

-- Ignore superseded tracking notices, including retries. Before the first send,
-- take the current authorized order details and recipient; then retain the body
-- for the provider's idempotent retries. Existing prepared messages stay frozen.
do $$
declare
 definition text:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 prepare_hook text:=$old$  if p_action='prepare_email' then$old$;
 photo_hook text:=$old$   if not (e.payload ? 'product_photos') then$old$;
begin
 if (length(definition)-length(replace(definition,prepare_hook,'')))/length(prepare_hook)<>1
   or (length(definition)-length(replace(definition,photo_hook,'')))/length(photo_hook)<>1 then
  raise exception 'Expected email preparation hooks were not found for delivery tracking';
 end if;
 definition:=replace(definition,prepare_hook,prepare_hook||$new$
   if e.event_type='delivery_tracking_updated' then
    select * into o from elio.orders where id=e.order_id;
    good:=o.method='delivery' and o.payment_status='paid' and not o.refund_label
      and o.fulfillment_status in ('confirmed','preparing','out_for_delivery')
      and (o.data->'delivery_tracking_updated_at') is not distinct from (e.payload->'tracking_updated_at')
      and (o.data->>'delivery_tracking_url') is not distinct from (e.payload->>'tracking_url');
    if not good then
     update elio.outbox set status='skipped',last_error='Tracking notice superseded or order no longer eligible.',lease_token=null,leased_until=null where id=e.id;
     return jsonb_build_object('skip',true);
    end if;
    if not (e.payload ? 'product_photos') then
     update elio.outbox set payload=e.payload||jsonb_build_object('order',elio.order_json(e.order_id,false,true),'settings',s-'owner_email'),
       to_email=o.data#>>'{buyer,email}' where id=e.id returning * into e;
    end if;
   end if;
   if e.event_type in ('out_for_delivery','fulfillment_reminder') and e.payload ? 'product_photos'
     and nullif(e.payload#>>'{order,delivery_tracking_url}','') is not null then
    select * into o from elio.orders where id=e.order_id;
    if o.method<>'delivery' or (e.payload#>>'{order,delivery_tracking_url}') is distinct from (o.data->>'delivery_tracking_url') then
     update elio.outbox set status='skipped',last_error='Delivery notice contains a superseded tracking link.',lease_token=null,leased_until=null where id=e.id;
     return jsonb_build_object('skip',true);
    end if;
   end if;$new$);
 definition:=replace(definition,photo_hook,$new$   if e.event_type not in ('order_review_required','fulfillment_reminder') and not (e.payload ? 'product_photos') then
    select * into o from elio.orders where id=e.order_id;
    update elio.outbox set payload=jsonb_set(e.payload,'{order}',(e.payload->'order')||jsonb_build_object(
      'delivery_tracking_url',case when o.method='delivery' then o.data->'delivery_tracking_url' else 'null'::jsonb end,
      'delivery_tracking_updated_at',case when o.method='delivery' then o.data->'delivery_tracking_updated_at' else 'null'::jsonb end))
      where id=e.id returning * into e;
   end if;
$new$||photo_hook);
 execute definition;
end $$;
revoke all on function elio.normalize_delivery_tracking_url(jsonb) from public,anon,authenticated;

create function elio.queue_delivery_tracking_email(p_id uuid,p_previous_url text) returns void
language plpgsql security invoker set search_path='' as $$
declare
 o elio.orders; settings jsonb; tracking_url text; change text;
begin
 select * into strict o from elio.orders where id=p_id;
 tracking_url:=o.data->>'delivery_tracking_url';
 change:=case when tracking_url is null then 'removed' when p_previous_url is null then 'added' else 'replaced' end;
 select data-'owner_email' into settings from elio.settings where id;
 insert into elio.outbox(event_key,event_type,order_id,to_email,subject,payload)
 values('delivery-tracking:'||o.id||':'||o.revision,'delivery_tracking_updated',o.id,
   o.data#>>'{buyer,email}',
   case change when 'added' then 'Delivery tracking is available' when 'removed' then 'Delivery tracking link removed' else 'Delivery tracking link updated' end||' · '||o.reference,
   jsonb_build_object('event_type','delivery_tracking_updated','order',elio.order_json(o.id,false,true),
     'settings',settings,'tracking_url',tracking_url,'previous_tracking_url',p_previous_url,
     'tracking_change',change,'tracking_updated_at',o.data->'delivery_tracking_updated_at'))
 on conflict(event_key) do nothing;
end $$;
revoke all on function elio.queue_delivery_tracking_email(uuid,text) from public,anon,authenticated;

create function elio.save_delivery_tracking(p_order elio.orders,p_payload jsonb,p_actor uuid,p_key uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 tracking_url text; previous_url text; changed_at timestamptz:=clock_timestamp(); change text;
begin
 perform elio.require(p_order.method='delivery','Delivery tracking applies to delivery orders only.');
 perform elio.require(p_order.payment_status='paid' and p_order.fulfillment_status in ('confirmed','preparing','out_for_delivery') and not p_order.refund_label,
   'Tracking can only be changed for a paid active delivery order without a refund label.');
 perform elio.require(p_payload ? 'tracking_url','Provide a tracking link, or an empty value to remove it.');
 tracking_url:=elio.normalize_delivery_tracking_url(p_payload->'tracking_url');
 previous_url:=nullif(p_order.data->>'delivery_tracking_url','');
 if tracking_url is distinct from previous_url then
  change:=case when tracking_url is null then 'removed' when previous_url is null then 'added' else 'replaced' end;
  update elio.orders set data=data||jsonb_build_object('delivery_tracking_url',tracking_url,'delivery_tracking_updated_at',changed_at),
    revision=revision+1 where id=p_order.id;
  perform elio.audit(p_order.id,p_actor,'save_delivery_tracking','Delivery tracking link '||change||'.',
    jsonb_build_object('delivery_tracking_url',previous_url),
    jsonb_build_object('delivery_tracking_url',tracking_url,'delivery_tracking_updated_at',changed_at));
  -- A first link saved before dispatch travels in the out-for-delivery email.
  -- Replacements, removals, and links restored after removal notify immediately.
  if previous_url is not null or p_order.data ? 'delivery_tracking_updated_at'
    or p_order.fulfillment_status='out_for_delivery' then
   perform elio.queue_delivery_tracking_email(p_order.id,previous_url);
  end if;
 end if;
 insert into elio.action_keys(user_id,action,key,order_id,request_hash)
 values(p_actor,'save_delivery_tracking',p_key,p_order.id,p_hash);
 return elio.order_json(p_order.id,true,false);
end $$;
revoke all on function elio.save_delivery_tracking(elio.orders,jsonb,uuid,uuid,text) from public,anon,authenticated;

-- Reuse the dispatcher's staff authorization, locked row, revision comparison,
-- and duplicate-key check. Do not expose a second mutation entrypoint.
do $$
declare
 definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 action_hook text:=$old$'preview_edit_order','add_staff_note'),'Unknown ordering action.');$old$;
 revision_hook text:=$old$ perform elio.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh it and review the latest version before saving.');$old$;
begin
 if (length(definition)-length(replace(definition,action_hook,'')))/length(action_hook)<>1
   or (length(definition)-length(replace(definition,revision_hook,'')))/length(revision_hook)<>1 then
  raise exception 'Expected guarded order action hooks were not found for delivery tracking';
 end if;
 definition:=replace(definition,action_hook,$new$'preview_edit_order','add_staff_note','save_delivery_tracking'),'Unknown ordering action.');$new$);
 definition:=replace(definition,revision_hook,revision_hook||$new$
 if p_action='save_delivery_tracking' then
  return elio.save_delivery_tracking(o,p_payload,u,v_key,hashed);
 end if;$new$);
 execute definition;
end $$;
