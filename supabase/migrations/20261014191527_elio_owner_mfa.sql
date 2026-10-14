-- Require a verified, current owner session for owner privileges. Ordinary
-- customer and staff permissions stay unchanged. Trusted service workers keep
-- their separate service-role boundary; interactive Edge calls verify the
-- caller through account_access before invoking that boundary.
create function elio.owner_mfa_satisfied(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case
  when coalesce(elio.role_for(p_user),'')<>'owner' then true
  when auth.jwt()->>'role'='service_role' then true
  else coalesce(auth.uid()=p_user and auth.jwt()->>'aal'='aal2'
   and exists (
    select 1 from auth.sessions s join auth.mfa_factors f
     on f.id=s.factor_id and f.user_id=s.user_id
    where s.id::text=auth.jwt()->>'session_id' and s.user_id=p_user
     and s.aal::text='aal2' and (s.not_after is null or s.not_after>statement_timestamp())
     and f.status::text='verified'
   ),false)
 end
$$;
revoke all on function elio.owner_mfa_satisfied(uuid) from public,anon,authenticated;

create or replace function elio.assert_staff(p_user uuid,p_owner boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(elio.role_for(p_user),'') not in ('owner','staff') or (p_owner and coalesce(elio.role_for(p_user),'')<>'owner') then
  raise exception 'Authorized % access required',case when p_owner then 'owner' else 'staff' end using errcode='42501';
 end if;
 if not elio.owner_mfa_satisfied(p_user) then
  raise exception 'Verify your authenticator code in Team sign in before using owner tools.' using errcode='P0MFA';
 end if;
end $$;

create or replace function elio.can_access(p_order elio.orders,p_user uuid,p_token text)
returns boolean language sql stable security definer set search_path='' as $$
 select (p_user is not null and (p_order.user_id=p_user
  or (elio.role_for(p_user) in ('owner','staff') and elio.owner_mfa_satisfied(p_user))))
  or (length(coalesce(p_token,''))>=40 and extensions.digest(p_token,'sha256')=p_order.access_digest)
$$;

do $migration$
declare d text:=pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure);
 old_access text:=$old$return jsonb_build_object('role',elio.role_for(u));$old$;
 old_role text:=$old$role_name:=elio.role_for(u);$old$;
begin
 if position(old_access in d)=0 or position(old_role in d)=0 then
  raise exception 'Owner MFA dispatcher anchors changed';
 end if;
 d:=replace(d,old_access,$new$-- A reserved first owner must be able to enroll before any privileged action.
  -- Claim only the verified designated account, under the same dispatcher lock.
  if u is not null and not exists(select 1 from elio.staff) then
   perform pg_advisory_xact_lock(841721950318::bigint);
   if not exists(select 1 from elio.staff) then
    insert into elio.staff(user_id,role)
     select a.id,'owner' from auth.users a join elio.pending_owners e on lower(a.email)=e.email
     where a.id=u and a.email_confirmed_at is not null on conflict do nothing;
    if found then delete from elio.pending_owners p using auth.users a where a.id=u and p.email=lower(a.email);end if;
   end if;
  end if;
  return jsonb_build_object(
   'role',elio.role_for(u),
   'mfa_required',coalesce(elio.role_for(u)='owner' and not elio.owner_mfa_satisfied(u),false),
   'mfa_enrolled',exists(select 1 from auth.mfa_factors where user_id=u and status::text='verified')
  );$new$);
 -- Customer-owned/token order reads remain available, but must never gain
 -- private staff fields from an owner session that has not completed MFA.
 d:=replace(d,old_role,old_role||$new$
 if role_name='owner' and not elio.owner_mfa_satisfied(u) then role_name:=null;end if;$new$);
 execute d;
end $migration$;

-- Upload policies already check the current database role. Add the current
-- session requirement rather than relying on a browser-only enrollment check.
do $migration$
declare p record;
begin
 for p in select policyname,with_check from pg_policies where schemaname='storage'
  and tablename='objects' and policyname in ('elio_owner_product_photo_insert','elio_owner_website_photo_insert') loop
  execute format('alter policy %I on storage.objects with check ((%s) and (select public.shop_api(''account_access'',''{}''::jsonb,null) @> ''{"role":"owner","mfa_required":false}''::jsonb))',p.policyname,p.with_check);
 end loop;
end $migration$;
