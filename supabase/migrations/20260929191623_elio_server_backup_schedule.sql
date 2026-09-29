-- Hosted infrastructure: pg_cron, pg_net, and Supabase Vault.
begin;
do $$ begin
 if not exists(select 1 from vault.secrets where name='elio_backup_worker_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'elio_backup_worker_token','Elio scheduled Google Sheets backup only');
 end if;
end $$;
create function public.elio_backup_worker_authorized(p_token text) returns boolean language sql security definer set search_path='' as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='elio_backup_worker_token'
 and extensions.digest(p_token,'sha256')=extensions.digest(decrypted_secret,'sha256')),false)
$$;
revoke all on function public.elio_backup_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.elio_backup_worker_authorized(text) to service_role;
create function elio.invoke_backup_worker() returns bigint language sql security invoker set search_path='' as $$
 select net.http_post(url:='https://dzxyhckkkrzqpwpavngn.supabase.co/functions/v1/order-backup',
 headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='elio_backup_worker_token')),
 body:='{}'::jsonb,timeout_milliseconds:=110000)
 where exists(select 1 from elio.order_backup_connection where id and enabled and (revision>synced_revision or last_error is not null or last_success_at is null or last_success_at<now()-interval '1 day') and (lease_until is null or lease_until<now()))
$$;
revoke all on function elio.invoke_backup_worker() from public,anon,authenticated,service_role;
select cron.schedule('elio-order-backup','*/5 * * * *','select elio.invoke_backup_worker();');
commit;
