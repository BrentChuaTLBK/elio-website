begin;
create index orders_pos_created on elio.orders(created_at desc) where data->>'order_source' in ('direct','in_person');
create index orders_pos_event on elio.orders((data->>'event_id'),created_at) where data ? 'event_id';
do $$ declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('elio.pos_order_action(text,jsonb)'::regprocedure);
 for old,replacement in select * from (values
 ($a$clock_timestamp()+interval '30 days'$a$,$b$'infinity'::timestamptz$b$),
 ($a$'pos_created_by',auth.uid(),$a$,$b$'pos_created_by',auth.uid(),'pos_email_opt_in',source='direct' and coalesce((p_payload->>'send_email')::boolean,false),$b$),
 ($a$perform elio.pos_validate_contact(p_payload);q:=elio.pos_quote(p_payload);$a$,$b$perform elio.pos_validate_contact(p_payload);
 perform elio.require(not coalesce((p_payload->>'send_email')::boolean,false) or source='direct' and coalesce(p_payload#>>'{buyer,email}','')<>'','Enter an email address before choosing email updates.');
 q:=elio.pos_quote(p_payload);$b$),
 ($a$if p_action='pos_quote' then$a$,$b$if p_action='pos_payment_link' then
 select * into strict o from elio.orders where id=(p_payload->>'order_id')::uuid;
 perform elio.require(o.data->>'order_source'='direct','Only direct orders use customer payment links.');
 return jsonb_build_object('id',o.id,'reference',o.reference,'token',elio.order_token(o));end if;
 if p_action='pos_quote' then$b$),
 ($a$if paid then perform elio.pos_record_payment(pid,p_payload->'payment');end if;$a$,$b$if paid then perform elio.pos_record_payment(pid,p_payload->'payment');end if;
 if coalesce((p_payload->>'send_email')::boolean,false) then perform elio.queue_email(pid,case when paid then 'payment_approved' else 'order_submitted' end,'pos-created:'||pid);end if;$b$),
 ($a$before_value:=elio.order_json(pid,true,false)-'history';perform elio.pos_record_payment(pid,p_payload->'payment');$a$,$b$before_value:=elio.order_json(pid,true,false)-'history';perform elio.pos_record_payment(pid,p_payload->'payment');
 perform elio.queue_email(pid,'payment_approved','pos-paid:'||pid);$b$)
 ) edits loop
 if position(old in definition)=0 then raise exception 'POS link hook missing: %',old;end if;definition:=replace(definition,old,replacement);
 end loop;execute definition;
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 execute replace(definition,$a$'pos_quote','pos_orders','pos_create_order','pos_pay_order'$a$,$b$'pos_quote','pos_orders','pos_create_order','pos_pay_order','pos_payment_link'$b$);
 definition:=pg_get_functiondef('elio.order_json(uuid,boolean,boolean)'::regprocedure);
 for old,replacement in select * from (values
 ($a$'payment_deadline',elio.maintenance_deadline(o.payment_deadline,o.created_at)$a$,$b$'payment_deadline',case when o.data->>'order_source' in ('in_person','direct') then null else elio.maintenance_deadline(o.payment_deadline,o.created_at) end$b$),
 ($a$greatest(0,extract(epoch from (elio.maintenance_deadline(o.payment_deadline,o.created_at)-statement_timestamp())))::integer$a$,$b$case when o.data->>'order_source' in ('in_person','direct') then null else greatest(0,extract(epoch from (elio.maintenance_deadline(o.payment_deadline,o.created_at)-statement_timestamp())))::integer end$b$),
 ($a$,'uploads_paused',false$a$,''),
 ($a$return o.data ||$a$,$b$return (case when p_private then o.data else o.data-'pos_created_by'-'pos_payment' end) ||$b$)
 ) edits loop
 if position(old in definition)=0 then raise exception 'POS deadline hook missing: %',old;end if;definition:=replace(definition,old,replacement);
 end loop;execute definition;
end $$;
create function elio.pos_order_stock_state() returns trigger language plpgsql set search_path='' as $$
begin
 if new.data->>'order_source' in ('direct','in_person') then
  if new.payment_status='paid' then update elio.pos_allocations set state='committed' where order_id=new.id and state='held';
  elsif new.fulfillment_status in ('cancelled','expired') then delete from elio.pos_allocations where order_id=new.id and state='held';end if;
 end if;return new;
end $$;
revoke all on function elio.pos_order_stock_state() from public,anon,authenticated,service_role;
create trigger pos_order_stock_state after update of payment_status,fulfillment_status on elio.orders for each row execute function elio.pos_order_stock_state();
commit;
