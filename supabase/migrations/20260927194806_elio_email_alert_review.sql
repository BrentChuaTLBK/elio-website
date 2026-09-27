begin;
alter table elio.outbox add column reviewed_at timestamptz, add column reviewed_by uuid;

create function elio.review_email_alert(p_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare entry elio.outbox;
begin
 perform elio.assert_staff(auth.uid(),false);
 select * into entry from elio.outbox where id=(p_payload->>'id')::uuid for update;
 perform elio.require(entry.id is not null,'Email notification not found.');
 perform elio.require(entry.status<>'sent' and nullif(entry.last_error,'') is not null,'This notification no longer needs review. Refresh the dashboard.');
 perform elio.require(entry.status=p_payload->>'status' and entry.attempts=(p_payload->>'attempts')::integer and entry.last_error=p_payload->>'last_error','This notification changed. Refresh and review its latest status.');
 update elio.outbox set reviewed_at=coalesce(reviewed_at,clock_timestamp()),reviewed_by=coalesce(reviewed_by,auth.uid()) where id=entry.id;
 return jsonb_build_object('reviewed',true);
end $$;

-- A later retry or changed error is a new alert and must be visible again.
create function elio.reset_email_review() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status is distinct from old.status or new.attempts is distinct from old.attempts or new.last_error is distinct from old.last_error then
  new.reviewed_at:=null;new.reviewed_by:=null;
 end if;
 return new;
end $$;
create trigger elio_reset_email_review before update of status,attempts,last_error on elio.outbox for each row execute function elio.reset_email_review();
revoke all on function elio.review_email_alert(jsonb),elio.reset_email_review() from public,anon,authenticated,service_role;

do $$
declare definition text;hook text;
begin
 definition:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 hook:=' if p_action=''admin_bootstrap'' then';
 perform elio.require(position(hook in definition)>0,'Missing email review dispatch hook.');
 definition:=replace(definition,hook,' if p_action=''review_email_alert'' then return elio.review_email_alert(p_payload);end if;'||chr(10)||hook);
 hook:='select id,event_type,order_id,status,attempts,last_error,created_at,sent_at from elio.outbox';
 perform elio.require(position(hook in definition)>0,'Missing email review list hook.');
 execute replace(definition,hook,'select id,event_type,order_id,status,attempts,last_error,created_at,sent_at,reviewed_at from elio.outbox');
end $$;
commit;
