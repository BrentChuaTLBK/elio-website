begin;
create function elio.pos_validate_contact(p jsonb) returns void language plpgsql set search_path='' as $$
begin
 perform elio.require(coalesce(length(p#>>'{buyer,name}'),0)<=160 and coalesce(length(p#>>'{buyer,phone}'),0)<=40,'Customer details are too long.');
 perform elio.require(coalesce(p#>>'{buyer,email}','')='' or (length(p#>>'{buyer,email}')<=254 and p#>>'{buyer,email}' ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),'Enter a valid email or leave it blank.');
 perform elio.require(coalesce(length(p#>>'{buyer,social_platform}'),0)<=50 and coalesce(length(p#>>'{buyer,social_username}'),0)<=160,'Social details are too long.');
 perform elio.require(coalesce(length(p#>>'{recipient,name}'),0)<=160 and coalesce(length(p#>>'{recipient,phone}'),0)<=40,'Recipient details are too long.');
 perform elio.require(coalesce(length(p#>>'{address,line1}'),0)<=500 and coalesce(length(p#>>'{address,locality}'),0)<=160,'Delivery address is too long.');
 perform elio.require(coalesce(length(p#>>'{address,line2}'),0)<=500 and coalesce(length(p#>>'{address,postal_code}'),0)<=20 and coalesce(length(p->>'instructions'),0)<=2000,'Delivery details are too long.');
end $$;

create function elio.pos_quote(p_payload jsonb,p_original uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare o elio.orders;ful date;method text;item jsonb;old_item jsonb;p jsonb;pp elio.pos_products;
 pid uuid;source text;qty integer;requested integer;old_qty integer;needed boolean;sels jsonb;recipe jsonb;requirements jsonb;labels jsonb;items jsonb:='[]';
 choice record;flavor jsonb;unit bigint;subtotal bigint:=0;fee integer;remaining integer;d record;
begin
 perform elio.assert_staff(auth.uid(),false);
 ful:=(p_payload->>'fulfillment_date')::date;method:=p_payload->>'method';
 perform elio.require(ful is not null and ful>=(now() at time zone 'Asia/Manila')::date and ful<=(now() at time zone 'Asia/Manila')::date+366,'Choose today or a fulfillment date within the next year.');
 perform elio.require(method in ('pickup','delivery'),'Choose pickup or delivery.');
 perform elio.require(jsonb_typeof(p_payload->'items')='array' and jsonb_array_length(p_payload->'items') between 1 and 100,'Add between 1 and 100 products to the sale.');
 if p_original is not null then
  select * into strict o from elio.orders where id=p_original;
  perform elio.require(o.data->>'order_source' in ('in_person','direct'),'Use the website order editor for this order.');
 end if;
 for item in select value from jsonb_array_elements(p_payload->'items') loop
  pid:=(item->>'product_id')::uuid;qty:=(item->>'quantity')::integer;sels:=coalesce(item->'selections','{}');
  perform elio.require(qty between 1 and 10000 and item->>'quantity'=qty::text,'Enter a whole quantity between 1 and 10,000.');
  perform elio.require(jsonb_typeof(sels)='object','Invalid product configuration.');
  old_item:=null;
  if o.id is not null then select value into old_item from jsonb_array_elements(o.data->'items') where value->>'product_id'=pid::text and coalesce(value->'selections','{}')=sels limit 1;end if;
  source:=coalesce(item->>'source',old_item->>'source',case when exists(select 1 from elio.pos_products where id=pid) then 'pos' else 'website' end);
  perform elio.require(source in ('website','pos','custom'),'Choose a valid product source.');
  if old_item is not null then perform elio.require(source=old_item->>'source','An existing item cannot change catalog source.');end if;
  select sum((value->>'quantity')::integer) into requested from jsonb_array_elements(p_payload->'items') where value->>'product_id'=pid::text;
  select coalesce(sum((value->>'quantity')::integer),0) into old_qty from jsonb_array_elements(coalesce(o.data->'items','[]')) where value->>'product_id'=pid::text;
  needed:=old_item is null or ful is distinct from o.fulfillment_date or method is distinct from o.method or requested>old_qty;
  labels:='[]';recipe:='[]';requirements:='[]';
  if source='custom' then
   perform elio.require(not exists(select 1 from elio.products where id=pid) and not exists(select 1 from elio.pos_products where id=pid),'Use the website catalog to sell an existing product.');
   perform elio.require(length(trim(item->>'name')) between 1 and 160,'Enter a custom item name.');
   perform elio.require(item->>'unit_price_cents' ~ '^[0-9]+$' and (item->>'unit_price_cents')::bigint between 0 and 100000000,'Enter a valid custom item price.');
   perform elio.require(sels='{}'::jsonb,'Custom items have no stock configuration.');
   p:=jsonb_build_object('name',trim(item->>'name'),'kind','custom_item');unit:=(item->>'unit_price_cents')::integer;
  elsif source='pos' then
   select * into pp from elio.pos_products where id=pid;perform elio.require(pp.id is not null,'POS product not found.');
   perform elio.require(not needed or pp.active and pp.deleted_at is null,'POS product unavailable: '||pp.name);
   perform elio.require(sels='{}'::jsonb,'POS-only items do not have box configurations.');
   p:=jsonb_build_object('name',pp.name,'kind','pos_item');unit:=pp.price_cents;
  else
   select data into p from elio.products where id=pid;
   perform elio.require(p is not null and p->>'kind' in ('set','custom_box'),'Choose a website box. Individual flavors are selected inside a custom box.');
   perform elio.require(not needed or (coalesce((p->>'active')::boolean,false) and p->>'deleted_at' is null),'Website product unavailable: '||(p->>'name'));
   perform elio.require(method<>'delivery' or not coalesce((p->>'pickup_only')::boolean,false),(p->>'name')||' is pickup only.');
   unit:=(p->>'price_cents')::integer;
   if p->>'kind'='set' then
    perform elio.require(sels='{}'::jsonb,'Fixed boxes keep their configured flavors.');recipe:=elio.flavor_recipe(p);
   else
    perform elio.require((select count(*) from jsonb_object_keys(sels))=1 and jsonb_typeof(sels->'flavors')='object','Choose the flavors in your custom box.');
    for choice in select key,value from jsonb_each(sels->'flavors') loop
     perform elio.require(choice.value::text ~ '^[0-3]$','Choose between 0 and 3 of each flavor.');
     select data into flavor from elio.products where id::text=choice.key and data->>'kind'='flavor';
     perform elio.require(flavor is not null,'Unknown flavor.');
     if choice.value::text::integer>0 then
      perform elio.require(not needed or flavor->>'deleted_at' is null,'This flavor has been deleted.');
      unit:=unit+(flavor->>'price_cents')::integer*choice.value::text::integer;
      labels:=labels||jsonb_build_array(jsonb_build_object('group','Flavors per box','label',flavor->>'name','quantity',choice.value,'surcharge_cents',(flavor->>'price_cents')::integer));
     end if;
    end loop;
    recipe:=elio.flavor_recipe(p,sels);
   end if;
   if old_item is null then perform elio.require((select sum((value->>'quantity')::integer) from jsonb_array_elements(recipe))=3,'Choose exactly three flavor pieces for this box.');end if;
   select coalesce(jsonb_agg(value-'name'),'[]') into requirements from jsonb_array_elements(recipe);
  end if;
  if old_item is not null and source<>'custom' then unit:=(old_item->>'unit_price_cents')::integer;recipe:=old_item->'flavor_contents';requirements:=old_item->'stock_requirements';labels:=old_item->'selection_labels';end if;
  subtotal:=subtotal+unit*qty;perform elio.require(subtotal between 0 and 1000000000,'Sale total exceeds the supported amount.');
  items:=items||jsonb_build_array(jsonb_build_object('source',source,'product_id',pid,'product_kind',p->>'kind','name',case when source='custom' then p->>'name' else coalesce(old_item->>'name',p->>'name') end,
   'quantity',qty,'selections',sels,'selection_labels',labels,'unit_price_cents',unit,'line_total_cents',unit*qty,'stock_requirements',requirements,'flavor_contents',recipe));
 end loop;
 perform elio.check_stock(items,ful,p_original,true);
 for d in select (value->>'product_id')::uuid id,sum((value->>'quantity')::integer)::integer quantity from jsonb_array_elements(items) where value->>'source'='pos' group by 1 loop
  remaining:=elio.pos_remaining(d.id,ful,p_original);perform elio.require(remaining is null or remaining>=d.quantity,'Not enough stock for a POS product. Refresh the catalog and review quantities.');
 end loop;
 fee:=case when method='pickup' then 0 else coalesce((p_payload->>'delivery_cents')::integer,0) end;
 perform elio.require(fee between 0 and 100000000,'Enter a valid delivery fee.');
 return jsonb_build_object('items',items,'subtotal_cents',subtotal,'discount_cents',0,'delivery_cents',fee,'total_cents',subtotal+fee,'promo_snapshot',null,'delivery_zone_name',coalesce(p_payload#>>'{address,locality}',''),'delivery_zone_description','');
end $$;

create function elio.pos_allocate(p_id uuid) returns void language sql set search_path='' as $$
 insert into elio.pos_allocations(order_id,product_id,stock_date,quantity,state)
 select o.id,p.id,elio.pos_stock_date(p,o.fulfillment_date),sum((i->>'quantity')::integer)::integer,
  case when o.payment_status='paid' then 'committed' else 'held' end
 from elio.orders o cross join lateral jsonb_array_elements(o.data->'items') i join elio.pos_products p on p.id=(i->>'product_id')::uuid
 where o.id=p_id and i->>'source'='pos' group by o.id,p.id
$$;

create function elio.pos_record_payment(p_id uuid,p_payment jsonb) returns void language plpgsql set search_path='' as $$
declare o elio.orders;v_method text;method_name text;cash integer;total integer;option_value jsonb;settings jsonb;
begin
 select * into strict o from elio.orders where id=p_id for update;
 perform elio.require(o.payment_status='awaiting_payment' and o.fulfillment_status='pending_confirmation','Only an active unpaid POS order can receive payment.');
 total:=(o.data->>'total_cents')::integer;v_method:=p_payment->>'method';
 select data into settings from elio.settings where id;
 if v_method='cash' then
  method_name:='Cash';cash:=(p_payment->>'cash_received_cents')::integer;
  perform elio.require(cash between total and 1000000000,'Cash received must cover the full order total.');
 else
  select value into option_value from jsonb_array_elements(coalesce(settings->'payment_options','[]')) where value->>'label'=v_method;
  perform elio.require(option_value is not null,'Choose Cash or a configured payment option.');
  method_name:=coalesce(option_value->>'label',option_value->>'name');cash:=total;
 end if;
 perform elio.require(coalesce(length(p_payment->>'reference'),0)<=160,'Keep the payment reference within 160 characters.');
 insert into elio.payments(order_id,amount_cents,proof_path,payment_reference,approved_by)
 values(p_id,total,'',coalesce(p_payment->>'reference',''),auth.uid());
 update elio.orders set payment_status='paid',paid_amount_cents=total,fulfillment_status=case when data->>'pos_handed_over'='true' then 'completed' else 'confirmed' end,
  payment_reference=coalesce(p_payment->>'reference',''),revision=revision+1,
  data=data||jsonb_build_object('pos_payment',jsonb_build_object('method',v_method,'label',method_name,'cash_received_cents',cash,'change_cents',cash-total,'recorded_by',auth.uid(),'recorded_at',clock_timestamp())) where id=p_id;
 update elio.allocations set state='committed' where order_id=p_id;
 update elio.pos_allocations set state='committed' where order_id=p_id;
end $$;

create function elio.pos_order_action(p_action text,p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare o elio.orders;s jsonb;q jsonb;order_data jsonb;pid uuid;v_key uuid;token text;hashed text;source text;handed boolean;paid boolean;before_value jsonb;existing elio.action_keys;
begin
 perform elio.assert_staff(auth.uid(),false);perform pg_advisory_xact_lock(841721950318::bigint);
 if p_action='pos_quote' then return elio.pos_quote(p_payload);end if;
 if p_action='pos_orders' then
  return coalesce((select jsonb_agg(elio.order_json(id,true,false) order by created_at desc) from
   (select id,created_at from elio.orders where data->>'order_source' in ('in_person','direct') order by created_at desc limit 200) x),'[]');
 end if;
 v_key:=(p_payload->>'idempotency_key')::uuid;perform elio.require(v_key is not null,'A unique sale key is required. Reload the POS and try again.');
 hashed:=encode(extensions.digest((p_payload-'idempotency_key')::text||auth.uid()::text,'sha256'),'hex');
 if p_action='pos_create_order' then
  select * into o from elio.orders where idempotency_key=v_key;
  if found then perform elio.require(o.request_hash=hashed and o.data->>'order_source' in ('in_person','direct'),'This sale key was already used. Start a new sale.');return elio.order_json(o.id,true,false);end if;
  perform elio.require(not (elio.maintenance_state()->>'active')::boolean,'Maintenance is active. New POS orders are paused until it ends.');
  source:=p_payload->>'order_source';handed:=coalesce((p_payload->>'pos_handed_over')::boolean,false);paid:=coalesce((p_payload->>'paid')::boolean,false);
  perform elio.require(source in ('in_person','direct'),'Choose In-person sales or Direct orders.');
  perform elio.require(source<>'in_person' or paid,'Pop-up sales require full payment.');
  perform elio.require(not handed or paid and p_payload->>'method'='pickup' and (p_payload->>'fulfillment_date')::date=(now() at time zone 'Asia/Manila')::date,'Handed-over sales must be paid pickups for today.');
  perform elio.pos_validate_contact(p_payload);q:=elio.pos_quote(p_payload);
  perform elio.require(p_payload->'expected_quote'=q,'Prices or stock changed. Review the sale again before recording it.');
  select data into s from elio.settings where id;
  pid:=gen_random_uuid();token:=encode(extensions.gen_random_bytes(32),'hex');
  order_data:=q||jsonb_build_object('order_source',source,'pos_handed_over',handed,'pos_created_by',auth.uid(),
   'buyer',jsonb_build_object('name',coalesce(nullif(trim(p_payload#>>'{buyer,name}'),''),case when source='direct' then 'Direct customer' else 'Walk-in customer' end),'phone',coalesce(p_payload#>>'{buyer,phone}',''),'email',coalesce(p_payload#>>'{buyer,email}',''),'social_platform',coalesce(p_payload#>>'{buyer,social_platform}',''),'social_username',coalesce(p_payload#>>'{buyer,social_username}','')),
   'recipient',coalesce(p_payload->'recipient','{}'),'address',coalesce(p_payload->'address','{}'),'instructions',coalesce(p_payload->>'instructions',''),
   'pickup_address',s->>'pickup_address','pickup_hours',s->>'pickup_hours','delivery_window',s->>'delivery_window','payment_options',s->'payment_options','payment_instructions',s->>'payment_instructions','payment_note',s->>'payment_note',
   'contact_email',s->>'contact_email','contact_phone',s->>'contact_phone');
  insert into elio.orders(id,reference,user_id,access_digest,access_encrypted,payment_deadline,fulfillment_date,method,data,idempotency_key,request_hash)
  values(pid,elio.new_order_reference(),null,extensions.digest(token,'sha256'),extensions.pgp_sym_encrypt(token,(select token_key from elio.secrets where id)),clock_timestamp()+interval '30 days',(p_payload->>'fulfillment_date')::date,p_payload->>'method',order_data,v_key,hashed);
  perform elio.allocate_order(pid);perform elio.pos_allocate(pid);
  if paid then perform elio.pos_record_payment(pid,p_payload->'payment');end if;
  perform elio.audit(pid,auth.uid(),'pos_order_recorded',source,null,elio.order_json(pid,true,false)-'history');
  return elio.order_json(pid,true,false);
 elsif p_action='pos_pay_order' then
  pid:=(p_payload->>'order_id')::uuid;
  select * into existing from elio.action_keys where user_id=auth.uid() and action=p_action and elio.action_keys.key=v_key;
  if found then perform elio.require(existing.request_hash=hashed,'This payment key was already used.');return elio.order_json(existing.order_id,true,false);end if;
  select * into strict o from elio.orders where id=pid for update;
  perform elio.require(o.data->>'order_source' in ('in_person','direct'),'Use payment review for website orders.');
  perform elio.require(o.revision=(p_payload->>'revision')::integer,'This order changed. Refresh before recording payment.');
  before_value:=elio.order_json(pid,true,false)-'history';perform elio.pos_record_payment(pid,p_payload->'payment');
  perform elio.audit(pid,auth.uid(),'pos_payment_recorded',null,before_value,elio.order_json(pid,true,false)-'history');
  insert into elio.action_keys(user_id,action,key,order_id,request_hash) values(auth.uid(),p_action,v_key,pid,hashed);
  return elio.order_json(pid,true,false);
 end if;
 raise exception 'Unsupported POS order action';
end $$;
revoke all on function elio.pos_validate_contact(jsonb),elio.pos_quote(jsonb,uuid),elio.pos_allocate(uuid),elio.pos_record_payment(uuid,jsonb),elio.pos_order_action(text,jsonb) from public,anon,authenticated,service_role;
commit;
