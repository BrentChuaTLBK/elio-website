begin;

-- Preserve the existing subject for all current campaigns and older clients.
alter table elio.voucher_campaigns add column email_subject text not null
 default 'A little thank-you from Elio · your next-order voucher'
 check(length(btrim(email_subject)) between 1 and 200 and email_subject !~ '[[:cntrl:]]');

create function elio.voucher_email_subject(p text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare subject text:=btrim(coalesce(p,'A little thank-you from Elio · your next-order voucher'));
begin
 perform elio.require(length(subject) between 1 and 200 and subject !~ '[[:cntrl:]]','Enter an email subject of 1–200 characters on one line.');
 return subject;
end $$;
revoke all on function elio.voucher_email_subject(text) from public,anon,authenticated,service_role;

create or replace function elio.voucher_api(p_action text,p jsonb) returns jsonb
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
   insert into elio.voucher_campaigns(name,terms,email_subject,created_by) values(n,t,elio.voucher_email_subject(v->>'email_subject'),auth.uid()) returning * into c;
  else
   select * into c from elio.voucher_campaigns where id=(v->>'id')::uuid for update;
   perform elio.require(found,'Campaign not found.');
   perform elio.require((v->>'revision')::integer=c.revision,'Campaign changed. Refresh before saving.');
   perform elio.require(c.status='draft' or st<>'draft','Pause a published campaign instead of returning it to draft.');
   update elio.voucher_campaigns set name=n,status=st,terms=t,email_subject=case when v ? 'email_subject' then elio.voucher_email_subject(v->>'email_subject') else c.email_subject end,revision=revision+1,updated_at=now() where id=c.id returning * into c;
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

-- Snapshot the subject when issuing: later edits never rewrite queued emails.
create or replace function elio.voucher_completed_order() returns trigger
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
   c.email_subject,
   jsonb_build_object('event_type','newsletter_voucher','title',c.name,'offer',offer,
    'subscriber',jsonb_build_object('email',recipient_email),
    'unsubscribe_token',case when opted_in then elio.newsletter_unsubscribe_token(s) end,'settings',elio.newsletter_email_settings()),
   case when opted_in then 'pending' else 'skipped' end,case when not opted_in then 'Customer is not subscribed to marketing emails. Voucher remains in their account.' end);
 end loop;
 return new;
end $$;

create or replace function elio.voucher_email_preview(p jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c jsonb; t jsonb; n text; expiry timestamptz;
begin
 perform elio.assert_staff(auth.uid(),true);
 if p ? 'campaign' and p->'campaign'<>'null'::jsonb then
  c:=p->'campaign';
 else
  select to_jsonb(v) into c from elio.voucher_campaigns v where id=(p->>'id')::uuid;
 end if;
 perform elio.require(jsonb_typeof(c)='object','Choose a campaign to preview.');
 n:=btrim(c->>'name');
 perform elio.require(length(n) between 1 and 120 and n !~ '[[:cntrl:]]','Enter a campaign name of 1–120 characters.');
 t:=elio.voucher_terms(c->'terms');
 expiry:=case when t->>'expiry_mode'='days' then now()+make_interval(days=>(t->>'expiry_days')::integer) else (t->>'expires_at')::timestamptz end;
 return jsonb_build_object('event_type','newsletter_voucher','title',n,
  'subject',elio.voucher_email_subject(c->>'email_subject'),
  'subscriber',jsonb_build_object('email','preview@example.test'),
  'offer',jsonb_build_object('code','ELIO-PREVIEW','kind',t->'kind','value',t->'value',
   'min_subtotal_cents',t->'min_subtotal_cents','cap_cents',t->'cap_cents','expires_at',expiry),
  'settings',elio.newsletter_email_settings());
end $$;

commit;
