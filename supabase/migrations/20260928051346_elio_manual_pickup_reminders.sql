begin;
create function elio.send_pickup_reminder(p_order elio.orders,p_actor uuid,p_key uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare requested_at timestamptz:=clock_timestamp(); settings jsonb;
begin
 perform elio.require(p_order.method='pickup' and p_order.payment_status='paid'
  and p_order.fulfillment_status='ready_for_pickup' and not p_order.refund_label,
  'Pickup reminders are available only for paid orders marked Ready for pickup.');
 perform elio.require(not exists(select 1 from elio.outbox where order_id=p_order.id and event_type='pickup_reminder'
  and (status in ('pending','sending') or created_at>requested_at-interval '15 minutes')),
  'A pickup reminder is already queued or was requested in the last 15 minutes. Check Email delivery before sending another.');
 select data-'owner_email' into settings from elio.settings where id;
 update elio.orders set data=data||jsonb_build_object('pickup_reminder_requested_at',requested_at,
  'pickup_reminder_count',coalesce((data->>'pickup_reminder_count')::integer,0)+1),revision=revision+1 where id=p_order.id;
 insert into elio.outbox(event_key,event_type,order_id,to_email,subject,payload)
 values('pickup-reminder:'||p_order.id||':'||p_key,'pickup_reminder',p_order.id,p_order.data#>>'{buyer,email}',
  'A reminder about your pickup · '||p_order.reference,
  jsonb_build_object('event_type','pickup_reminder','order',elio.order_json(p_order.id,false,true),'settings',settings));
 perform elio.audit(p_order.id,p_actor,'send_pickup_reminder','Pickup reminder requested for '||(p_order.data#>>'{buyer,email}')||'.',
  '{}'::jsonb,jsonb_build_object('requested_at',requested_at));
 insert into elio.action_keys(user_id,action,key,order_id,request_hash) values(p_actor,'send_pickup_reminder',p_key,p_order.id,p_hash);
 return elio.order_json(p_order.id,true,false);
end $$;
revoke all on function elio.send_pickup_reminder(elio.orders,uuid,uuid,text) from public,anon,authenticated,service_role;

-- Reuse staff authorization, row lock, revision check and idempotency guard.
do $$
declare definition text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 action_hook text:=$old$'save_delivery_tracking'),'Unknown ordering action.');$old$;
 revision_hook text:=$old$ perform elio.require((p_payload->>'revision')::integer=o.revision,'This order changed. Refresh it and review the latest version before saving.');$old$;
begin
 perform elio.require(position(action_hook in definition)>0 and position(revision_hook in definition)>0,'Missing guarded pickup reminder action hooks.');
 definition:=replace(definition,action_hook,$new$'save_delivery_tracking','send_pickup_reminder'),'Unknown ordering action.');$new$);
 execute replace(definition,revision_hook,revision_hook||$new$
 if p_action='send_pickup_reminder' then return elio.send_pickup_reminder(o,u,v_key,hashed); end if;$new$);
end $$;

-- Check again under the worker lease: a queued reminder must not chase a
-- collected, cancelled or refunded order. Freeze the first prepared payload.
do $$
declare definition text:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook text:=$old$  if p_action='prepare_email' then$old$;
begin
 perform elio.require(position(hook in definition)>0,'Missing pickup reminder preparation hook.');
 execute replace(definition,hook,hook||$new$
   if e.event_type='pickup_reminder' then
    select * into o from elio.orders where id=e.order_id;
    if not (o.method='pickup' and o.payment_status='paid' and o.fulfillment_status='ready_for_pickup' and not o.refund_label) then
     update elio.outbox set status='skipped',last_error='Order no longer needs a pickup reminder.',lease_token=null,leased_until=null where id=e.id;
     return jsonb_build_object('skip',true);
    end if;
    if not (e.payload ? 'product_photos') then
     update elio.outbox set payload=e.payload||jsonb_build_object('order',elio.order_json(e.order_id,false,true),'settings',s-'owner_email'),
      to_email=o.data#>>'{buyer,email}' where id=e.id returning * into e;
    end if;
   end if;$new$);
end $$;
commit;
