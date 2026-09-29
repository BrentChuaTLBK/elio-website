begin;

create table elio.voucher_campaigns (
 id uuid primary key default gen_random_uuid(), name text not null,
 status text not null default 'draft' check(status in ('draft','active','paused')),
 terms jsonb not null, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
-- Durable completion history prevents status toggles and campaign restarts issuing twice.
create table elio.voucher_completions (
 order_id uuid primary key references elio.orders(id), user_id uuid references auth.users(id), customer_key text not null,
 completed_at timestamptz not null default now()
);
create index voucher_completions_customer on elio.voucher_completions(user_id,completed_at);
create index voucher_completions_email on elio.voucher_completions(customer_key,completed_at);
create table elio.vouchers (
 promo_id uuid primary key references elio.promos(id), campaign_id uuid not null references elio.voucher_campaigns(id),
 user_id uuid references auth.users(id), owner_email text not null, source_order_id uuid not null references elio.orders(id),
 title text not null, issued_at timestamptz not null default now(),
 unique(campaign_id,source_order_id)
);
create index vouchers_customer on elio.vouchers(user_id,issued_at desc);
create index vouchers_campaign_customer on elio.vouchers(campaign_id,user_id);
create index vouchers_campaign_email on elio.vouchers(campaign_id,owner_email);
create index vouchers_guest_email on elio.vouchers(owner_email,issued_at desc) where user_id is null;
create index vouchers_source on elio.vouchers(source_order_id);
do $$ declare t text; begin
 foreach t in array array['voucher_campaigns','voucher_completions','vouchers'] loop
  execute format('alter table elio.%I enable row level security',t);
  execute format('revoke all on elio.%I from public,anon,authenticated,service_role',t);
 end loop;
end $$;

-- Existing completions establish history only. No retroactive offers or emails.
insert into elio.voucher_completions(order_id,user_id,customer_key,completed_at)
 select o.id,o.user_id,lower(btrim(coalesce(u.email,o.data#>>'{buyer,email}'))),o.created_at
 from elio.orders o left join auth.users u on u.id=o.user_id
 where nullif(btrim(coalesce(u.email,o.data#>>'{buyer,email}')),'') is not null
 and coalesce(o.data->>'order_source','website')='website'
 and o.payment_status='paid' and o.fulfillment_status='completed' and not o.refund_label;

alter table elio.newsletter_outbox drop constraint newsletter_outbox_event_type_check;
alter table elio.newsletter_outbox add constraint newsletter_outbox_event_type_check check(event_type in
 ('newsletter_confirmation','newsletter_welcome','newsletter_welcome_back','newsletter_campaign','newsletter_test_campaign','newsletter_voucher'));
alter table elio.newsletter_outbox add column voucher_id uuid references elio.vouchers(promo_id);
create unique index newsletter_outbox_voucher on elio.newsletter_outbox(voucher_id) where voucher_id is not null;

create function elio.voucher_terms(p jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare k text; expiry timestamptz;
begin
 perform elio.require(jsonb_typeof(p)='object','Provide campaign terms.');
 perform elio.require(p->>'trigger' in ('first_completed','every_completed'),'Choose when customers earn a voucher.');
 perform elio.require(p->>'kind' in ('fixed','percent'),'Choose a discount type.');
 foreach k in array array['value','min_subtotal_cents','customer_limit'] loop
  perform elio.require(jsonb_typeof(p->k)='number' and p->>k ~ '^[0-9]{1,9}$','Use whole numbers for amounts and limits.');
 end loop;
 perform elio.require((p->>'value')::integer between 1 and case when p->>'kind'='percent' then 100 else 100000000 end,'Enter a valid discount.');
 perform elio.require((p->>'min_subtotal_cents')::integer between 0 and 100000000,'Enter a valid minimum product spend.');
 perform elio.require((p->>'customer_limit')::integer between 1 and 100,'Set a customer issue limit from 1 to 100.');
 if p->>'kind'='percent' then
  perform elio.require(jsonb_typeof(p->'cap_cents')='number' and p->>'cap_cents' ~ '^[0-9]{1,9}$' and (p->>'cap_cents')::integer between 1 and 100000000,'Set a positive maximum percentage discount.');
 end if;
 perform elio.require(p->>'expiry_mode' in ('days','fixed'),'Choose how vouchers expire.');
 if p->>'expiry_mode'='days' then
  perform elio.require(jsonb_typeof(p->'expiry_days')='number' and p->>'expiry_days' ~ '^[0-9]{1,3}$' and (p->>'expiry_days')::integer between 1 and 365,'Set an expiry of 1–365 days.');
 else
  expiry:=(p->>'expires_at')::timestamptz;
  perform elio.require(expiry is not null and isfinite(expiry),'Set a valid expiry date.');
 end if;
 return jsonb_build_object('trigger',p->>'trigger','kind',p->>'kind','value',(p->>'value')::integer,
  'min_subtotal_cents',(p->>'min_subtotal_cents')::integer,'customer_limit',(p->>'customer_limit')::integer,
  'cap_cents',case when p->>'kind'='percent' then (p->>'cap_cents')::integer end,
  'expiry_mode',p->>'expiry_mode','expiry_days',case when p->>'expiry_mode'='days' then (p->>'expiry_days')::integer end,'expires_at',expiry);
end $$;

create function elio.voucher_source_valid(p_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from elio.vouchers v join elio.orders o on o.id=v.source_order_id
  where v.promo_id=p_id and o.payment_status='paid' and not o.refund_label
  and o.fulfillment_status not in ('cancelled','expired'))
$$;

create function elio.voucher_completed_order() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c elio.voucher_campaigns; s elio.newsletter_subscribers; account auth.users;
 first_order boolean; promo uuid; v_code text; expiry timestamptz; offer jsonb; attempts integer; opted_in boolean; recipient_email text;
begin
 if coalesce(new.data->>'order_source','website')<>'website'
  or new.payment_status<>'paid' or new.fulfillment_status<>'completed' or new.refund_label then return new;end if;
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into account from auth.users where id=new.user_id;
 recipient_email:=lower(btrim(coalesce(account.email,new.data#>>'{buyer,email}')));
 if nullif(recipient_email,'') is null then return new;end if;
 insert into elio.voucher_completions(order_id,user_id,customer_key) values(new.id,new.user_id,recipient_email) on conflict do nothing;
 if not found then return new;end if;
 first_order:=not exists(select 1 from elio.voucher_completions where (user_id=new.user_id or customer_key=recipient_email) and order_id<>new.id);
 select * into s from elio.newsletter_subscribers where email=recipient_email;
 opted_in:=coalesce(s.status='subscribed',false);
 for c in select * from elio.voucher_campaigns where status='active' order by id loop
  if c.terms->>'trigger'='first_completed' and not first_order then continue;end if;
  if (select count(*) from elio.vouchers where campaign_id=c.id and (user_id=new.user_id or owner_email=recipient_email))>=(c.terms->>'customer_limit')::integer then continue;end if;
  expiry:=case when c.terms->>'expiry_mode'='days' then now()+make_interval(days=>(c.terms->>'expiry_days')::integer) else (c.terms->>'expires_at')::timestamptz end;
  if expiry<=now() then continue;end if;
  promo:=gen_random_uuid();attempts:=0;
  loop
   attempts:=attempts+1;perform elio.require(attempts<=12,'Unable to generate a unique voucher. Please retry.');
   v_code:='ELIO-'||upper(encode(extensions.gen_random_bytes(5),'hex'));
   offer:=jsonb_build_object('id',promo,'code',v_code,'kind',c.terms->>'kind','value',c.terms->'value',
    'min_subtotal_cents',c.terms->'min_subtotal_cents','cap_cents',c.terms->'cap_cents',
    'per_account_limit',1,'global_limit',1,'expires_at',expiry,'active',true,'voucher_managed',true);
   insert into elio.promos(id,code,data) values(promo,v_code,offer) on conflict(code) do nothing;
   exit when found;
  end loop;
  insert into elio.vouchers(promo_id,campaign_id,user_id,owner_email,source_order_id,title) values(promo,c.id,new.user_id,recipient_email,new.id,c.name);
  insert into elio.newsletter_outbox(event_key,event_type,subscriber_id,voucher_id,to_email,subject,payload,status,last_error)
   values('voucher:'||promo,'newsletter_voucher',s.id,promo,recipient_email,
   'A little thank-you from Elio · your next-order voucher',
   jsonb_build_object('event_type','newsletter_voucher','title',c.name,'offer',offer,
    'subscriber',jsonb_build_object('email',recipient_email),
    'unsubscribe_token',case when opted_in then elio.newsletter_unsubscribe_token(s) end,'settings',elio.newsletter_email_settings()),
   case when opted_in then 'pending' else 'skipped' end,case when not opted_in then 'Customer is not subscribed to marketing emails. Voucher remains in their account.' end);
 end loop;
 return new;
end $$;
create trigger elio_issue_completed_voucher after insert or update of payment_status,fulfillment_status,refund_label on elio.orders
 for each row execute function elio.voucher_completed_order();

-- Personal offers release refunded/cancelled redemptions, retaining the original expiry.
create or replace function elio.promo_use_counts(p_order uuid,p_promo uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select (not exists(select 1 from elio.newsletter_subscribers where promo_id=p_promo)
  and not exists(select 1 from elio.vouchers where promo_id=p_promo))
 or exists(select 1 from elio.orders where id=p_order and not refund_label
  and fulfillment_status not in ('cancelled','expired') and payment_status not in ('rejected','cancelled'))
$$;

create function elio.voucher_check(p_promo uuid,p_user uuid,p_admin boolean) returns void
language plpgsql stable security invoker set search_path='' as $$
declare v elio.vouchers;
begin
 select * into v from elio.vouchers where promo_id=p_promo;
 if found then
  perform elio.require(not p_admin,'Personal vouchers can only be applied by the customer at website checkout.');
  perform elio.require(elio.is_verified(p_user) and (v.user_id=p_user or (v.user_id is null and exists(select 1 from auth.users where id=p_user and lower(btrim(email))=v.owner_email))),'Sign in to the verified account that earned this voucher, or use the verified email from your guest checkout.');
  perform elio.require(elio.voucher_source_valid(p_promo),'This voucher is unavailable because its qualifying order was cancelled or refunded.');
 end if;
end $$;

-- One shared lifecycle calculation powers reports and the account wallet.
create view elio.voucher_facts with (security_invoker=true) as
 with issued as (
  select v.promo_id,v.campaign_id,v.user_id,v.owner_email email,v.title,v.issued_at,elio.voucher_source_valid(v.promo_id) source_valid,'order'::text source
   from elio.vouchers v
  union all
  select n.promo_id,null::uuid,null::uuid,n.email,'Your welcome treat',n.confirmed_at,true,'newsletter'
   from elio.newsletter_subscribers n where n.promo_id is not null
 )
 select i.*,p.code,p.data terms,(p.data->>'expires_at')::timestamptz expires_at,
  case when use.paid_orders>0 then 'used' when use.reserved>0 then 'reserved'
   when not i.source_valid or not coalesce((p.data->>'active')::boolean,false) or p.data->>'deleted_at' is not null then 'inactive'
   when (p.data->>'expires_at')::timestamptz<=now() then 'expired' else 'available' end status,
  use.paid_orders,use.sales_cents,use.discount_cents,e.status email_status,e.last_error email_note
 from issued i join elio.promos p on p.id=i.promo_id
 left join elio.newsletter_outbox e on e.voucher_id=i.promo_id
 cross join lateral (
  select count(*) filter(where o.payment_status='paid') paid_orders,
   count(*) filter(where u.state='reserved' and o.payment_status in ('awaiting_payment','under_review')) reserved,
   coalesce(sum(greatest(0,(o.data->>'subtotal_cents')::bigint-(o.data->>'discount_cents')::bigint)) filter(where o.payment_status='paid'),0) sales_cents,
   coalesce(sum((o.data->>'discount_cents')::bigint) filter(where o.payment_status='paid'),0) discount_cents
  from elio.promo_usage u join elio.orders o on o.id=u.order_id
  where u.promo_id=i.promo_id and o.fulfillment_status not in ('cancelled','expired') and not o.refund_label
   and o.payment_status not in ('cancelled','rejected')
   and (o.payment_status<>'awaiting_payment' or o.fulfillment_status<>'pending_confirmation'
    or elio.maintenance_deadline(o.payment_deadline,o.created_at,now())>now())
 ) use;
revoke all on elio.voucher_facts from public,anon,authenticated,service_role;

create function elio.voucher_card(f elio.voucher_facts) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',f.promo_id,'title',f.title,'source',f.source,'code',f.code,'issued_at',f.issued_at,
 'expires_at',f.expires_at,'status',f.status,'kind',f.terms->'kind','value',f.terms->'value',
 'min_subtotal_cents',f.terms->'min_subtotal_cents','cap_cents',f.terms->'cap_cents')
$$;

create function elio.voucher_api(p_action text,p jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c elio.voucher_campaigns; v jsonb; t jsonb; result jsonb; k text; n text; st text;
 offset_rows integer:=greatest(coalesce((p->>'offset')::integer,0),0); total bigint; account_email text;
begin
 if p_action='my_vouchers' then
  perform elio.require(elio.is_verified(auth.uid()),'Verify your account email to view your vouchers.');
  select lower(btrim(email)) into account_email from auth.users where id=auth.uid();
  st:=coalesce(p->>'status','available');
  perform elio.require(st in ('available','used','expired'),'Choose a voucher tab.');
  with mine as (select * from elio.voucher_facts where user_id=auth.uid() or (user_id is null and email=account_email)),
  filtered as (select * from mine where case when st='available' then status in ('available','reserved') when st='expired' then status in ('expired','inactive') else status=st end),
  page as (select * from filtered order by issued_at desc,promo_id limit 50 offset offset_rows)
  select jsonb_build_object('vouchers',(select coalesce(jsonb_agg(elio.voucher_card(page) order by issued_at desc,promo_id),'[]') from page),
   'total',(select count(*) from filtered),'offset',offset_rows,'limit',50,
   'counts',(select jsonb_build_object('available',count(*) filter(where status in ('available','reserved')),'used',count(*) filter(where status='used'),'expired',count(*) filter(where status in ('expired','inactive'))) from mine)) into result;
  return result;
 end if;
 perform elio.assert_staff(auth.uid(),true);
 if p_action='voucher_save_campaign' then
  v:=p->'campaign';perform elio.require(jsonb_typeof(v)='object','Provide a campaign.');
  n:=btrim(v->>'name');st:=coalesce(v->>'status','draft');
  perform elio.require(length(n) between 1 and 120 and n !~ '[[:cntrl:]]','Enter a campaign name of 1–120 characters.');
  perform elio.require(st in ('draft','active','paused'),'Choose a campaign status.');
  t:=elio.voucher_terms(v->'terms');
  perform elio.require(st<>'active' or t->>'expiry_mode'<>'fixed' or (t->>'expires_at')::timestamptz>now(),'Choose a future expiry before activating this campaign.');
  perform pg_advisory_xact_lock(841721950318::bigint);
  if nullif(v->>'id','') is null then
   perform elio.require(st='draft','Save and review a draft before activating a campaign.');
   perform elio.require((select count(*) from elio.voucher_campaigns)<200,'The campaign limit has been reached.');
   insert into elio.voucher_campaigns(name,terms,created_by) values(n,t,auth.uid()) returning * into c;
  else
   select * into c from elio.voucher_campaigns where id=(v->>'id')::uuid for update;
   perform elio.require(found,'Campaign not found.');
   perform elio.require((v->>'revision')::integer=c.revision,'Campaign changed. Refresh before saving.');
   perform elio.require(c.status='draft' or st<>'draft','Pause a published campaign instead of returning it to draft.');
   update elio.voucher_campaigns set name=n,status=st,terms=t,revision=revision+1,updated_at=now() where id=c.id returning * into c;
  end if;
  return to_jsonb(c)-'created_by';
 elsif p_action='voucher_campaigns' then
  with stats as (select campaign_id,jsonb_build_object('issued',count(*),'used',count(*) filter(where status='used'),
   'expired',count(*) filter(where status='expired'),'available',count(*) filter(where status='available'),
   'reserved',count(*) filter(where status='reserved'),'inactive',count(*) filter(where status='inactive'),
   'sales_cents',coalesce(sum(sales_cents),0),'discount_cents',coalesce(sum(discount_cents),0),
   'emails_accepted',count(*) filter(where email_status='sent'),'emails_pending',count(*) filter(where email_status in ('pending','sending')),
   'emails_failed',count(*) filter(where email_status='failed'),'emails_skipped',count(*) filter(where email_status='skipped')) data
   from elio.voucher_facts where campaign_id is not null group by campaign_id)
  select coalesce(jsonb_agg((to_jsonb(campaign_row)-'created_by')||jsonb_build_object('stats',coalesce(s.data,'{}')) order by campaign_row.created_at desc),'[]') into result
   from elio.voucher_campaigns campaign_row left join stats s on s.campaign_id=campaign_row.id;
  return jsonb_build_object('campaigns',result);
 elsif p_action='voucher_campaign_report' then
  select * into c from elio.voucher_campaigns where id=(p->>'id')::uuid;
  perform elio.require(found,'Campaign not found.');
  with filtered as (select f.*,coalesce(u.email,f.email) customer_email from elio.voucher_facts f left join auth.users u on u.id=f.user_id where f.campaign_id=c.id),
  page as (select * from filtered order by issued_at desc,promo_id limit 50 offset offset_rows)
  select jsonb_build_object('total',(select count(*) from filtered),'offset',offset_rows,'limit',50,
   'vouchers',(select coalesce(jsonb_agg(jsonb_build_object('code',code,'email',customer_email,'issued_at',issued_at,'expires_at',expires_at,
    'status',status,'sales_cents',sales_cents,'discount_cents',discount_cents,'email_status',email_status,'email_note',email_note) order by issued_at desc,promo_id),'[]') from page)) into result;
  return result;
 end if;
 raise exception 'Unknown voucher action.' using errcode='22023';
end $$;

do $$ declare d text; h text; begin
 -- Explicit checkout signup is independent of order submission and payment.
 d:=pg_get_functiondef('elio.newsletter_subscribe_immediate(jsonb)'::regprocedure);
 h:=$h$v_source in ('home_popup','home_footer','account')$h$;
 perform elio.require(position(h in d)>0,'Missing newsletter source validation hook.');
 execute replace(d,h,$new$v_source in ('home_popup','home_footer','account','checkout')$new$);
 d:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 h:=$h$ if p_action='account_access' then$h$;
 perform elio.require(position(h in d)>0,'Missing voucher API hook.');
 d:=replace(d,h,$new$ if p_action in ('my_vouchers','voucher_campaigns','voucher_campaign_report','voucher_save_campaign') then return elio.voucher_api(p_action,p_payload);end if;
$new$||h);
 h:=$h$ if p_action in ('save_promo','delete_promo') then$h$;
 d:=replace(d,h,h||$new$
  perform elio.require(not exists(select 1 from elio.vouchers where promo_id=coalesce(nullif(p_payload->>'id',''),nullif(p_payload#>>'{promo,id}',''))::uuid),'Issued vouchers keep their original terms. Manage future offers in Automatic offers.');$new$);
 d:=replace(d,$h$and promo->>'newsletter_managed' is distinct from 'true'$h$,$new$and promo->>'newsletter_managed' is distinct from 'true' and promo->>'voucher_managed' is distinct from 'true'$new$);
 execute d;
 d:=pg_get_functiondef('elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)'::regprocedure);
 h:=$h$   perform elio.newsletter_check_offer((promo->>'id')::uuid,p_user);$h$;
 perform elio.require(position(h in d)>0,'Missing personal voucher validation hook.');
 execute replace(d,h,h||$new$
   perform elio.voucher_check((promo->>'id')::uuid,p_user,p_admin);$new$);
 d:=pg_get_functiondef('elio.newsletter_restore_use()'::regprocedure);
 h:='join elio.newsletter_subscribers n on n.promo_id=usage.promo_id where usage.order_id=new.id';
 perform elio.require(position(h in d)>0,'Missing personal voucher restore hook.');
 execute replace(d,h,'where usage.order_id=new.id and (exists(select 1 from elio.newsletter_subscribers n where n.promo_id=usage.promo_id) or exists(select 1 from elio.vouchers v where v.promo_id=usage.promo_id))');
 d:=pg_get_functiondef('elio.newsletter_service_dispatch(text,jsonb)'::regprocedure);
 h:='   if not coalesce(good,false) then';
 perform elio.require(position(h in d)>0,'Missing voucher email eligibility hook.');
 execute replace(d,h,$new$   if e.event_type='newsletter_voucher' then
    good:=good and elio.voucher_source_valid(e.voucher_id) and (e.payload#>>'{offer,expires_at}')::timestamptz>now()
     and exists(select 1 from elio.vouchers v left join auth.users u on u.id=v.user_id where v.promo_id=e.voucher_id and lower(btrim(coalesce(u.email,v.owner_email)))=e.to_email);
   end if;
$new$||h);
end $$;

revoke all on function elio.voucher_terms(jsonb),elio.voucher_source_valid(uuid),elio.voucher_completed_order(),
 elio.voucher_check(uuid,uuid,boolean),elio.voucher_card(elio.voucher_facts),elio.voucher_api(text,jsonb)
 from public,anon,authenticated,service_role;
commit;
