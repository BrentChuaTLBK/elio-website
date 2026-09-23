-- Hosted infrastructure: pg_cron, pg_net, and Supabase Vault.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Generate the credential inside the database; never return it to a client.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'elio_email_worker_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'elio_email_worker_token', 'Elio scheduled email worker only');
  end if;
end $$;

create function elio.email_worker_authorized(p_token text) returns boolean
language sql security definer set search_path = '' as $$
  select coalesce(length(p_token) = 64 and exists (
    select 1 from vault.decrypted_secrets
    where name = 'elio_email_worker_token'
      and extensions.digest(p_token, 'sha256') = extensions.digest(decrypted_secret, 'sha256')
  ), false)
$$;
revoke all on function elio.email_worker_authorized(text) from public, anon, authenticated;
grant execute on function elio.email_worker_authorized(text) to service_role;

create function public.elio_email_worker_authorized(p_token text) returns boolean
language sql security invoker set search_path = '' as $$
  select elio.email_worker_authorized(p_token)
$$;
revoke all on function public.elio_email_worker_authorized(text) from public, anon, authenticated;
grant execute on function public.elio_email_worker_authorized(text) to service_role;

-- The cron command contains no credentials. Only its database owner can run it.
create function elio.invoke_email_worker() returns bigint
language sql security invoker set search_path = '' as $$
  select net.http_post(
    url := 'https://dzxyhckkkrzqpwpavngn.supabase.co/functions/v1/email-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'elio_email_worker_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 110000
  )
$$;
revoke all on function elio.invoke_email_worker() from public, anon, authenticated, service_role;

select cron.schedule('elio-email-worker', '* * * * *', 'select elio.invoke_email_worker();');
