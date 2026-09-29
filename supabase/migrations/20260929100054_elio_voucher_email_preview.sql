begin;

-- Read-only samples use the same validated terms and settings as issued emails.
create function elio.voucher_email_preview(p jsonb) returns jsonb
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
  'subject','A little thank-you from Elio · your next-order voucher',
  'subscriber',jsonb_build_object('email','preview@example.test'),
  'offer',jsonb_build_object('code','ELIO-PREVIEW','kind',t->'kind','value',t->'value',
   'min_subtotal_cents',t->'min_subtotal_cents','cap_cents',t->'cap_cents','expires_at',expiry),
  'settings',elio.newsletter_email_settings());
end $$;
revoke all on function elio.voucher_email_preview(jsonb) from public,anon,authenticated,service_role;

do $$ declare d text; h text; begin
 d:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 h:=$h$ if p_action='account_access' then$h$;
 perform elio.require(position(h in d)>0,'Missing voucher preview route hook.');
 execute replace(d,h,$new$ if p_action='voucher_email_preview' then return elio.voucher_email_preview(p_payload);end if;
$new$||h);
end $$;

commit;
