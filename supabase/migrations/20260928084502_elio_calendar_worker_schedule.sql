-- Hosted infrastructure: pg_cron, pg_net, and Supabase Vault.
begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
do $$ begin
 if not exists(select 1 from vault.secrets where name='elio_calendar_worker_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'elio_calendar_worker_token','Elio order calendar sync only');
 end if;
end $$;

create function public.elio_calendar_worker_authorized(p_token text) returns boolean
language sql security definer set search_path='' as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='elio_calendar_worker_token'
  and extensions.digest(p_token,'sha256')=extensions.digest(decrypted_secret,'sha256')),false)
$$;
revoke all on function public.elio_calendar_worker_authorized(text) from public,anon,authenticated;
grant execute on function public.elio_calendar_worker_authorized(text) to service_role;

create function elio.invoke_calendar_worker() returns bigint language sql security invoker set search_path='' as $$
 select net.http_post(url:='https://dzxyhckkkrzqpwpavngn.supabase.co/functions/v1/calendar-sync',
  headers:=jsonb_build_object('Content-Type','application/json','x-worker-token',(select decrypted_secret from vault.decrypted_secrets where name='elio_calendar_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=110000)
 where exists(select 1 from elio.calendar_connection where id and enabled)
$$;

create or replace function elio.calendar_wake() returns void language plpgsql security invoker set search_path='' as $$
begin
 update elio.calendar_connection set last_dispatch_at=clock_timestamp()
 where id and enabled and (last_dispatch_at is null or last_dispatch_at<clock_timestamp()-interval '5 seconds');
 if found then perform elio.invoke_calendar_worker();end if;
end $$;
revoke all on function elio.invoke_calendar_worker(),elio.calendar_wake() from public,anon,authenticated,service_role;
select cron.schedule('elio-calendar-sync','* * * * *','select elio.invoke_calendar_worker();');
commit;
