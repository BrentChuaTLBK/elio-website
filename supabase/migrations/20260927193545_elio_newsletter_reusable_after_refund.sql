begin;
-- Keep redemption history. Only newsletter codes release their use limit when
-- the associated order is refunded/cancelled. Issued terms never change.
create function elio.promo_use_counts(p_order uuid,p_promo uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select not exists(select 1 from elio.newsletter_subscribers where promo_id=p_promo)
  or exists(select 1 from elio.orders where id=p_order and not refund_label
   and fulfillment_status not in ('cancelled','expired') and payment_status not in ('rejected','cancelled'));
$$;
revoke all on function elio.promo_use_counts(uuid,uuid) from public,anon,authenticated,service_role;
do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure);
 hook:='from elio.promo_usage where elio.promo_usage.promo_id=v_promo_id';
 perform elio.require((length(definition)-length(replace(definition,hook,'')))/length(hook)=2,'Missing promo usage limit hooks.');
 execute replace(definition,hook,hook||' and elio.promo_use_counts(order_id,promo_id)');
 definition:=pg_get_functiondef('elio.newsletter_offer_report(jsonb)'::regprocedure);
 hook:='where promo_id=p.id and state=''redeemed''';
 perform elio.require(position(hook in definition)>0,'Missing newsletter consumed count.');
 execute replace(definition,hook,hook||' and elio.promo_use_counts(order_id,promo_id)');
end $$;

-- If a refund is undone after the code has been reused, do not silently allow
-- two retained uses of a personal single-use offer. The owner receives an error.
create function elio.newsletter_restore_use() returns trigger
language plpgsql security invoker set search_path='' as $$
declare promo uuid;
begin
 if (old.refund_label or old.fulfillment_status in ('cancelled','expired'))
  and not new.refund_label and new.fulfillment_status not in ('cancelled','expired') and new.payment_status='paid' then
  select usage.promo_id into promo from elio.promo_usage usage join elio.newsletter_subscribers n on n.promo_id=usage.promo_id where usage.order_id=new.id;
  if promo is not null then
   perform pg_advisory_xact_lock(841721950318::bigint);
   perform elio.require(not exists(select 1 from elio.promo_usage where promo_id=promo and order_id<>new.id and elio.promo_use_counts(order_id,promo_id)),
    'This newsletter code has already been reused on another active order. Cancel that unpaid order or resolve its refund before restoring this order.');
  end if;
 end if;
 return new;
end $$;
revoke all on function elio.newsletter_restore_use() from public,anon,authenticated,service_role;
create trigger elio_newsletter_restore_use before update of refund_label,fulfillment_status on elio.orders for each row execute function elio.newsletter_restore_use();
commit;
