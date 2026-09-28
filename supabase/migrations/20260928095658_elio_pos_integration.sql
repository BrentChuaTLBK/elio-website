begin;
-- Authorization and deployment review:
-- The user requested shared website stock for direct POS orders, non-expiring
-- DM payment links, separate event stock/prices, and explicitly said to connect
-- the POS properly to existing Accounting. These are the required integration
-- points for those requested behaviors; existing website orders retain their
-- current behavior. No orders, payments, or existing ledger rows are rewritten.
-- Read-only production checks confirmed zero orders and no category-name
-- conflicts. Every target definition below exactly matched the pre-migration
-- definitions used by the isolated 194-check backend suite (including existing
-- website, accounting, calendar, stock and email regression checks).
-- Fail atomically if any integration target has changed since that comparison.
do $$ declare f record;begin
 for f in select * from (values
 ('elio.accounting_rows_v2(date,date)','79b080079c869856f67326c2a3318032'),
 ('elio.accounting_sync_order(uuid,jsonb,timestamptz,boolean)','d5f150bfe3d6652f1a23f6e274dc32fc'),
 ('elio.calendar_order(elio.orders)','2b128799d2420319b63d78cc9d71689f'),
 ('elio.dispatch(text,jsonb,text)','5bc43f9813dd4b0ad10ee9be5c72c042'),
 ('elio.expire_orders()','fc1145389b3f98f5560d3e80c47048a8'),
 ('elio.order_json(uuid,boolean,boolean)','956a6df1abff7664067bfdd7c6c826d1'),
 ('elio.queue_email(uuid,text,text,date,jsonb)','e17496103cecb88eae151133a40f8dc8')
 ) checked(signature,expected_hash) loop
 if md5(pg_get_functiondef(f.signature::regprocedure))<>f.expected_hash then
 raise exception 'POS integration aborted: % changed since verification',f.signature;end if;
 end loop;
end $$;
-- Existing order operations keep both stock pools in step. Event stock is added
-- by its own allocation function in the event migration.
do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 for old,replacement in select * from (values
 ($a$ if p_action='account_access' then$a$,$b$ if p_action='pos_catalog' then return elio.pos_catalog((p_payload->>'date')::date);end if;
 if p_action in ('pos_save_product','pos_delete_product','pos_set_stock') then return elio.pos_catalog_action(p_action,p_payload);end if;
 if p_action in ('pos_quote','pos_orders','pos_create_order','pos_pay_order') then return elio.pos_order_action(p_action,p_payload);end if;
 if p_action='account_access' then$b$),
 ($a$perform elio.validate_contact(merged);$a$,$b$if o.data->>'order_source' in ('in_person','direct') then perform elio.pos_validate_contact(merged);else perform elio.validate_contact(merged);end if;$b$),
 ($a$q:=elio.calculate_quote(merged,o.user_id,oid,true);$a$,$b$if o.data->>'order_source' in ('in_person','direct') then q:=elio.pos_quote(merged,oid);else q:=elio.calculate_quote(merged,o.user_id,oid,true);end if;$b$),
 ($a$if not same_ops then delete from elio.allocations where order_id=oid; perform elio.allocate_order(oid); perform elio.sync_promo(oid); end if;$a$,
 $b$if not same_ops then
 delete from elio.allocations where order_id=oid;perform elio.allocate_order(oid);perform elio.sync_promo(oid);
 if o.data->>'order_source' in ('in_person','direct') then delete from elio.pos_allocations where order_id=oid;perform elio.pos_allocate(oid);end if;
 end if;$b$),
 ($a$if p_action<>'add_staff_note' then perform elio.audit$a$,$b$if p_action='cancel_order' and o.data->>'order_source' in ('in_person','direct') then
 if o.payment_status<>'paid' or coalesce((p_payload->>'restore_stock')::boolean,false) then delete from elio.pos_allocations where order_id=oid;
 else update elio.pos_allocations set state='retained' where order_id=oid;end if;
 end if;
 if p_action<>'add_staff_note' then perform elio.audit$b$)
 ) edits loop
  if position(old in definition)=0 then raise exception 'POS dispatch hook missing: %',old;end if;
  definition:=replace(definition,old,replacement);
 end loop;
 execute definition;
 definition:=pg_get_functiondef('elio.expire_orders()'::regprocedure);
 old:=$a$where payment_status = 'awaiting_payment'$a$;
 if position(old in definition)=0 then raise exception 'POS expiry hook missing';end if;
 execute replace(definition,old,$b$where coalesce(data->>'order_source','website') not in ('in_person','direct') and payment_status = 'awaiting_payment'$b$);
 definition:=pg_get_functiondef('elio.order_json(uuid,boolean,boolean)'::regprocedure);
 old:=$a$return o.data || jsonb_build_object$a$;
 definition:=replace(definition,old,$b$return o.data || jsonb_build_object$b$);
 old:=$a$|| case when p_token then$a$;
 if position(old in definition)=0 then raise exception 'POS deadline hook missing';end if;
 execute replace(definition,old,$b$|| case when o.data->>'order_source' in ('in_person','direct') then jsonb_build_object('payment_deadline',null,'payment_seconds_remaining',null,'uploads_paused',false) else '{}'::jsonb end || case when p_token then$b$);
 definition:=pg_get_functiondef('elio.queue_email(uuid,text,text,date,jsonb)'::regprocedure);
 old:=$a$select data-'owner_email' into s$a$;
 if position(old in definition)=0 then raise exception 'POS email hook missing';end if;
 execute replace(definition,old,$b$if o.data->>'order_source' in ('in_person','direct') and (not coalesce((o.data->>'pos_email_opt_in')::boolean,false) or coalesce(o.data#>>'{buyer,email}','')='') then return;end if;
 select data-'owner_email' into s$b$);
 definition:=pg_get_functiondef('elio.calendar_order(elio.orders)'::regprocedure);
 old:=$a$o.payment_status='paid' and not o.refund_label$a$;
 if position(old in definition)=0 then raise exception 'POS calendar hook missing';end if;
 execute replace(definition,old,$b$o.payment_status='paid' and not o.refund_label and not coalesce((o.data->>'pos_handed_over')::boolean,false)$b$);
end $$;

insert into elio.accounting_categories(name,kind,system_key) values
 ('In-person POS sales','sale','in_person'),('Direct order sales','sale','direct');
do $$ declare definition text;old text;begin
 definition:=pg_get_functiondef('elio.accounting_sync_order(uuid,jsonb,timestamptz,boolean)'::regprocedure);
 old:=$a$('website',sales-s.sales_cents)$a$;
 if position(old in definition)=0 then raise exception 'POS accounting hook missing';end if;
 execute replace(definition,old,$b$(case when p_snapshot->>'order_source' in ('in_person','direct') then p_snapshot->>'order_source' else 'website' end,sales-s.sales_cents)$b$);
 definition:=pg_get_functiondef('elio.accounting_rows_v2(date,date)'::regprocedure);
 old:=$a$'Website',l.order_id,o.reference,null::integer,c.kind,''::text,''::text$a$;
 if position(old in definition)=0 then raise exception 'POS accounting row hook missing';end if;
 execute replace(definition,old,$b$case o.data->>'order_source' when 'in_person' then 'In-person POS' when 'direct' then 'Direct order' else 'Website' end,l.order_id,o.reference,null::integer,c.kind,coalesce(o.data#>>'{buyer,name}',''),coalesce(o.data#>>'{pos_payment,label}','')$b$);
end $$;
commit;
