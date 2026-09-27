begin;

-- Kept outside affiliates/account metadata so overview exports and customer
-- account data never accidentally include a payout destination.
create table elio.affiliate_payout_details (
 affiliate_id uuid primary key references elio.affiliates(id),
 method text not null check(method in ('gcash','bank_transfer')),
 account_name text not null check(length(btrim(account_name)) between 2 and 120),
 account_number text not null,
 bank_name text,
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp(),
 check((method='gcash' and account_number ~ '^09[0-9]{9}$' and bank_name is null)
    or (method='bank_transfer' and account_number ~ '^[0-9]{6,34}$' and bank_name is not null and length(btrim(bank_name)) between 2 and 80))
);
alter table elio.affiliate_payout_details enable row level security;
revoke all on elio.affiliate_payout_details from public,anon,authenticated,service_role;

create function elio.affiliate_save_payout_details(p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 u uuid:=auth.uid(); a elio.affiliates; previous elio.affiliate_payout_details;
 method_value text; name_value text; number_value text; bank_value text; result jsonb;
begin
 perform elio.require(u is not null and elio.is_verified(u),'Sign in with your verified Elio account.');
 select * into a from elio.affiliates where user_id=u;
 perform elio.require(a.id is not null,'An affiliate code has not been assigned to your account yet.');
 perform elio.require(not (p_payload ?| array['id','affiliate_id','user_id']),'Payout details can only be saved for your own affiliate account.');
 perform pg_advisory_xact_lock(841721950318::bigint);
 select * into previous from elio.affiliate_payout_details where affiliate_id=a.id for update;
 method_value:=p_payload->>'method';name_value:=btrim(p_payload->>'account_name');
 number_value:=regexp_replace(btrim(p_payload->>'account_number'),'[[:space:]-]','','g');
 perform elio.require(method_value in ('gcash','bank_transfer'),'Choose GCash or bank transfer.');
 perform elio.require(length(name_value) between 2 and 120 and name_value !~ '[[:cntrl:]]','Enter the account holder name (2–120 characters).');
 if method_value='gcash' then
  if number_value ~ '^\+?639[0-9]{9}$' then number_value:='0'||right(number_value,10);end if;
  perform elio.require(number_value ~ '^09[0-9]{9}$','Enter an 11-digit GCash number beginning with 09, or its +63 equivalent.');
  bank_value:=null;
 else
  bank_value:=btrim(p_payload->>'bank_name');
  perform elio.require(length(bank_value) between 2 and 80 and bank_value !~ '[[:cntrl:]]','Enter the bank name (2–80 characters).');
  perform elio.require(number_value ~ '^[0-9]{6,34}$','Enter a bank account number with 6–34 digits.');
 end if;
 -- An exact retry is safe, while a stale edit cannot overwrite a newer account.
 if previous.affiliate_id is not null and (previous.method,previous.account_name,previous.account_number,previous.bank_name)
  is not distinct from (method_value,name_value,number_value,bank_value) then return to_jsonb(previous)-'affiliate_id';end if;
 perform elio.require(coalesce(previous.revision,0)=(p_payload->>'revision')::integer,'Your payout details changed. Cancel this edit and refresh before saving again.');
 insert into elio.affiliate_payout_details(affiliate_id,method,account_name,account_number,bank_name)
 values(a.id,method_value,name_value,number_value,bank_value)
 on conflict(affiliate_id) do update set method=excluded.method,account_name=excluded.account_name,
  account_number=excluded.account_number,bank_name=excluded.bank_name,
  revision=elio.affiliate_payout_details.revision+1,updated_at=clock_timestamp()
 returning to_jsonb(elio.affiliate_payout_details.*)-'affiliate_id' into result;
 -- Record who changed the destination without duplicating bank details in logs.
 insert into elio.affiliate_audit(target_id,actor,action,before_data,after_data)
 values(a.id,u,'affiliate_save_payout_details',
  case when previous.affiliate_id is not null then jsonb_build_object('method',previous.method,'revision',previous.revision) end,
  jsonb_build_object('method',method_value,'revision',result->'revision'));
 return result;
end $$;
revoke all on function elio.affiliate_save_payout_details(jsonb) from public,anon,authenticated,service_role;

do $$ declare definition text;hook text;begin
 definition:=pg_get_functiondef('elio.affiliate_api(text,jsonb)'::regprocedure);
 hook:=$old$ if p_action in ('affiliate_status','affiliate_dashboard') then$old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate self-service hook.');
 execute replace(definition,hook,$new$ if p_action='affiliate_save_payout_details' then return elio.affiliate_save_payout_details(p_payload);end if;
$new$||hook);
 definition:=pg_get_functiondef('elio.affiliate_report(uuid,jsonb)'::regprocedure);
 hook:=$old$  'stats',jsonb_build_object($old$;
 perform elio.require(position(hook in definition)>0,'Missing affiliate report hook.');
 execute replace(definition,hook,$new$  'payout_details',(select to_jsonb(d)-'affiliate_id' from elio.affiliate_payout_details d where d.affiliate_id=a.id),
$new$||hook);
end $$;
commit;
