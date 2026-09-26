-- Persist the exact provider request before delivery. A retry after a deployment
-- must keep the same content as well as the same provider idempotency key.
alter table elio.outbox add column provider_payload jsonb
  check(provider_payload is null or jsonb_typeof(provider_payload)='object');

-- Patch only the already-authorized prepare branch. Existing leases, attempts,
-- eligibility checks, historical sent rows and function privileges are retained.
do $$
declare
 definition text:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 hook text:=$old$   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$old$;
 replacement text:=$new$   if e.provider_payload is null and p_payload ? 'provider_payload' then
    perform elio.require(jsonb_typeof(p_payload->'provider_payload')='object'
      and ((p_payload->'provider_payload') - array['from','to','reply_to','subject','html','text'])='{}'::jsonb
      and (p_payload#>'{provider_payload,to}')=jsonb_build_array(e.to_email)
      and jsonb_typeof(p_payload#>'{provider_payload,from}')='string'
      and length(p_payload#>>'{provider_payload,from}') between 1 and 500
      and (p_payload#>>'{provider_payload,from}') !~ '[\r\n]'
      and jsonb_typeof(p_payload#>'{provider_payload,reply_to}')='string'
      and length(p_payload#>>'{provider_payload,reply_to}') between 1 and 320
      and (p_payload#>>'{provider_payload,reply_to}') !~ '[\r\n]'
      and jsonb_typeof(p_payload#>'{provider_payload,subject}')='string'
      and length(p_payload#>>'{provider_payload,subject}') between 1 and 998
      and (p_payload#>>'{provider_payload,subject}') !~ '[\r\n]'
      and jsonb_typeof(p_payload#>'{provider_payload,html}')='string'
      and length(p_payload#>>'{provider_payload,html}')>0
      and jsonb_typeof(p_payload#>'{provider_payload,text}')='string'
      and length(p_payload#>>'{provider_payload,text}')>0,
      'Provide a complete email provider payload for the prepared recipient.');
    update elio.outbox set provider_payload=p_payload->'provider_payload' where id=e.id returning * into e;
   end if;
   return jsonb_build_object('id',e.id,'event_key',e.event_key,'to_email',e.to_email,'subject',e.subject,'payload',e.payload,'provider_payload',e.provider_payload,'attempts',e.attempts,'lease_token',e.lease_token,'first_attempt_at',e.first_attempt_at);$new$;
begin
 if (length(definition)-length(replace(definition,hook,'')))/length(hook)<>1 then
  raise exception 'Expected authorized email preparation return was not found';
 end if;
 execute replace(definition,hook,replacement);
end $$;
