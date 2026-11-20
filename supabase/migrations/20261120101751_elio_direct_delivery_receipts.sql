begin;

alter table elio.orders add column delivery_receipt_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('delivery-proofs','delivery-proofs',false,20971520,array['image/jpeg','image/png','image/webp','image/heic','image/heif']);

create function elio.delivery_receipt_service(action text,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 o elio.orders; oid uuid:=(p->>'order_id')::uuid; actor uuid:=(p->>'user_id')::uuid;
 path text:=p->>'path'; c jsonb; proof jsonb;
begin
 select * into o from elio.orders where id=oid for update;
 perform elio.require(o.id is not null and o.data->>'order_source'='direct' and o.method='delivery','Delivery receipt unavailable.');
 if action='read_delivery_receipt' then
  perform elio.assert_staff(actor,false);perform elio.require(elio.is_verified(actor) and o.delivery_receipt_path is not null,'Delivery receipt unavailable.');
  return jsonb_build_object('path',o.delivery_receipt_path);
 end if;
 perform elio.require(elio.can_access(o,actor,p->>'token'),'Order access not authorized.');
 c:=o.data->'delivery_charge';
 if action='commit_delivery_receipt' and o.delivery_receipt_path=path and c->>'proof_status'='under_review' then
  return jsonb_build_object('saved',true);
 end if;
 perform elio.require(not (elio.maintenance_state()->>'uploads_paused')::boolean,'Payment-proof uploads are paused for maintenance.');
 perform elio.require(not o.refund_label and o.fulfillment_status not in ('cancelled','expired') and o.payment_status='paid'
  and c->>'state'='quoted' and c->>'recipient'='elio' and (c->>'fee_cents')::integer>0
  and coalesce(c->>'proof_status','')<>'under_review','There is no separate ELIO delivery receipt to submit right now.');
 if action='authorize_delivery_upload' then
  return jsonb_build_object('allowed',true,'quoted_at',c->>'confirmed_at','fee_cents',c->'fee_cents');
 end if;
 perform elio.require(action='commit_delivery_receipt' and path ~ ('^'||oid::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif)$')
  and exists(select 1 from storage.objects where bucket_id='delivery-proofs' and name=path),'Delivery receipt upload is missing.');
 perform elio.require(c->>'confirmed_at'=p->>'quoted_at' and c->'fee_cents'=p->'fee_cents','The delivery quote changed. Refresh before submitting.');
 perform elio.require(coalesce(length(p->>'payment_reference'),0)<=160,'Keep the delivery reference within 160 characters.');
 proof:=jsonb_build_object('proof_status','under_review','proof_reference',coalesce(p->>'payment_reference',''));
 update elio.orders set delivery_receipt_path=path,data=jsonb_set(data,'{delivery_charge}',(c-'proof_feedback')||proof),revision=revision+1 where id=oid;
 perform elio.audit(oid,actor,'delivery_receipt_submitted','Delivery receipt submitted for review.',null,null);
 return jsonb_build_object('saved',true,'previous',o.delivery_receipt_path);
end $$;
revoke all on function elio.delivery_receipt_service(text,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare d text; r record;
begin
 d:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 perform elio.require(strpos(d,' if left(p_action,9)=''calendar_''')>0,'Missing service dispatch hook.');
 execute replace(d,' if left(p_action,9)=''calendar_''',$part$ if p_action in ('authorize_delivery_upload','commit_delivery_receipt','read_delivery_receipt') then return elio.delivery_receipt_service(p_action,p_payload);end if;
 if left(p_action,9)='calendar_'$part$);
 d:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 perform elio.require(strpos(d,'''pos_set_delivery_fee'',''pos_record_delivery_payment'',''pos_void_delivery_payment''')>0,'Missing delivery action gateway.');
 execute replace(d,'''pos_set_delivery_fee'',''pos_record_delivery_payment'',''pos_void_delivery_payment''','''pos_set_delivery_fee'',''pos_record_delivery_payment'',''pos_void_delivery_payment'',''pos_reject_delivery_receipt''');
 d:=pg_get_functiondef('elio.pos_delivery_action(text,jsonb)'::regprocedure);
 for r in select * from (values
 ('is_pending boolean;', 'is_pending boolean; received integer;'),
 ($part$'pos_record_delivery_payment','pos_void_delivery_payment')$part$,$part$'pos_record_delivery_payment','pos_void_delivery_payment','pos_reject_delivery_receipt')$part$),
 ($part$if p_action='pos_set_delivery_fee' then$part$,$part$if p_action='pos_set_delivery_fee' then
  perform elio.require(coalesce(charge->>'proof_status','')<>'under_review','Review the separate delivery receipt before changing the fee.');$part$),
 ($part$ insert into elio.pos_delivery_payments($part$,$part$ received:=case when v_method='cash' then coalesce((p->>'cash_received_cents')::integer,fee) else fee end;
 perform elio.require(received between fee and 1000000000,'Cash received must cover the full delivery fee.');
 charge:=(charge-'proof_feedback')||jsonb_build_object('cash_received_cents',received,'change_cents',received-fee);
 if charge->>'proof_status'='under_review' then charge:=charge||'{"proof_status":"accepted"}'::jsonb;end if;
 insert into elio.pos_delivery_payments($part$),
 ($part$ elsif p_action='pos_void_delivery_payment' then$part$,$part$ elsif p_action='pos_reject_delivery_receipt' then
  perform elio.require(charge->>'state'='quoted' and charge->>'proof_status'='under_review','No delivery receipt is awaiting review.');
  perform elio.require(length(btrim(p->>'reason')) between 1 and 500,'Enter a reason for the customer.');
  update elio.orders set data=jsonb_set(data,'{delivery_charge}',charge||jsonb_build_object('proof_status','rejected','proof_feedback',btrim(p->>'reason'))),revision=revision+1 where id=o.id;
 elsif p_action='pos_void_delivery_payment' then$part$),
 ($part$(charge-'paid_at'-'payment_method'-'payment_reference')$part$,$part$(charge-'paid_at'-'payment_method'-'payment_reference'-'proof_status'-'proof_reference'-'proof_feedback'-'cash_received_cents'-'change_cents')$part$)
 ) as z(anchor,replacement) loop
  perform elio.require((length(d)-length(replace(d,r.anchor,'')))/length(r.anchor)=1,'Missing delivery receipt hook: '||r.anchor);
  d:=replace(d,r.anchor,r.replacement);
 end loop;
 execute d;
end $migration$;

commit;
