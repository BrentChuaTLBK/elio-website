begin;
create table elio.order_backup_connection (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 token_digest bytea,
 configured_by uuid references auth.users(id) on delete set null,
 configured_at timestamptz,
 last_started_at timestamptz,
 last_success_at timestamptz,
 snapshot_at timestamptz,
 run_id uuid,
 active_count integer,
 paid_history_count integer,
 last_error text,
 recovery_file_id text,
 active_file_id text
);
alter table elio.order_backup_connection enable row level security;
revoke all on elio.order_backup_connection from public,anon,authenticated,service_role;
insert into elio.order_backup_connection(id) values(true);

create function elio.order_backup_status() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'configured_at',configured_at,'last_started_at',last_started_at,
 'last_success_at',last_success_at,'snapshot_at',snapshot_at,'active_count',active_count,'paid_history_count',paid_history_count,
 'last_error',last_error,'recovery_file_id',recovery_file_id,'active_file_id',active_file_id,
 'state',case when not enabled then 'disconnected' when last_success_at is null then 'awaiting_google_setup'
 when last_error is not null then 'error' when last_success_at<statement_timestamp()-interval '15 minutes' then 'stale' else 'connected' end)
 from elio.order_backup_connection where id
$$;
create function elio.order_backup_admin(p_action text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare token text;
begin
 perform elio.assert_staff(auth.uid(),true);
 if p_action='order_backup_setup' then
  token:=encode(extensions.gen_random_bytes(32),'hex');
  update elio.order_backup_connection set enabled=true,token_digest=extensions.digest(token,'sha256'),configured_by=auth.uid(),
   configured_at=clock_timestamp(),last_started_at=null,last_success_at=null,snapshot_at=null,run_id=null,last_error=null where id;
  return jsonb_build_object('token',token,'folder_id','1Sh49xlV0ScTwUrH6UC_5EMNehTHBoSIh','status',elio.order_backup_status());
 elsif p_action='order_backup_disconnect' then
  update elio.order_backup_connection set enabled=false,token_digest=null,run_id=null where id;
 end if;
 return elio.order_backup_status();
end $$;
create function elio.order_backup_service(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c elio.order_backup_connection; result jsonb; token text:=p_payload->>'token'; identifier uuid;
begin
 select * into c from elio.order_backup_connection where id for update;
 perform elio.require(c.enabled and length(token)=64 and token~'^[a-f0-9]{64}$' and c.token_digest=extensions.digest(token,'sha256'),'Backup connection authorization required.');
 if p_action='order_backup_export' then
  if c.last_started_at>clock_timestamp()-interval '30 seconds' then return jsonb_build_object('busy',true);end if;
  identifier:=extensions.gen_random_uuid();result:=elio.paid_order_recovery_snapshot();
  update elio.order_backup_connection set run_id=identifier,last_started_at=clock_timestamp(),last_error=null where id;
  return jsonb_build_object('run_id',identifier,'backup',result);
 end if;
 perform elio.require(c.run_id is not null and c.run_id=(p_payload->>'run_id')::uuid and c.last_started_at>clock_timestamp()-interval '10 minutes','Backup run expired. Retry the backup.');
 if p_action='order_backup_ack' then
  perform elio.require((p_payload->>'recovery_file_id')~'^[A-Za-z0-9_-]{10,200}$' and (p_payload->>'active_file_id')~'^[A-Za-z0-9_-]{10,200}$','Invalid backup file reference.');
  perform elio.require((p_payload->>'snapshot_at')::timestamptz<=clock_timestamp() and (p_payload->>'snapshot_at')::timestamptz>clock_timestamp()-interval '2 days','Invalid backup timestamp.');
  perform elio.require((p_payload->>'active_count')::integer>=0 and (p_payload->>'paid_history_count')::integer>=(p_payload->>'active_count')::integer,'Invalid backup counts.');
  update elio.order_backup_connection set last_success_at=clock_timestamp(),snapshot_at=(p_payload->>'snapshot_at')::timestamptz,
   active_count=(p_payload->>'active_count')::integer,paid_history_count=(p_payload->>'paid_history_count')::integer,
   recovery_file_id=p_payload->>'recovery_file_id',active_file_id=p_payload->>'active_file_id',last_error=null where id;
 elsif p_action='order_backup_fail' then
  update elio.order_backup_connection set last_error='Google backup did not finish. Check the Apps Script execution log; the previous saved files were retained.' where id;
 else raise exception 'Unsupported backup action';end if;
 return elio.order_backup_status();
end $$;
revoke all on function elio.order_backup_status(),elio.order_backup_admin(text),elio.order_backup_service(text,jsonb) from public,anon,authenticated,service_role;
do $$ declare definition text;hook text;begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);hook:=' if p_action=''admin_bootstrap'' then';
 perform elio.require(position(hook in definition)>0,'Missing backup admin dispatch hook.');
 execute replace(definition,hook,' if p_action in (''order_backup_status'',''order_backup_setup'',''order_backup_disconnect'') then return elio.order_backup_admin(p_action);end if;'||chr(10)||hook);
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);hook:=' if p_action=''authorize_analytics'' then';
 perform elio.require(position(hook in definition)>0,'Missing backup service dispatch hook.');
 execute replace(definition,hook,' if p_action in (''order_backup_export'',''order_backup_ack'',''order_backup_fail'') then return elio.order_backup_service(p_action,p_payload);end if;'||chr(10)||hook);
end $$;
commit;
