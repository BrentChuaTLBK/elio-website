begin;
-- Originals retain their MIME type and extension when WebP conversion fails.
update storage.buckets set file_size_limit=20971520,
 allowed_mime_types=array['image/png','image/jpeg','image/heic','image/heif','image/webp']
where id in ('product-images','website-images','payment-proofs','affiliate-payout-proofs');

alter policy elio_owner_product_photo_insert on storage.objects with check (
 bucket_id='product-images'
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|heic|heif|webp)$')
 and (select public.shop_api('account_access','{}'::jsonb,null)->>'role')='owner'
);
alter policy elio_owner_website_photo_insert on storage.objects with check (
 bucket_id='website-images'
 and name ~ ('^'||(select auth.uid())::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|heic|heif|webp)$')
 and (select public.shop_api('account_access','{}'::jsonb,null)->>'role')='owner'
);

do $migration$
declare definition text; old text;
begin
 definition:=pg_get_functiondef('elio.service_dispatch(text,jsonb)'::regprocedure);
 old:=$old$\.(png|jpg|jpeg|webp)$$old$;
 perform elio.require(position(old in definition)>0,'Missing private proof path validation.');
 execute replace(definition,old,$new$\.(png|jpg|jpeg|heic|heif|webp)$$new$);
 definition:=pg_get_functiondef('elio.affiliate_service(text,jsonb)'::regprocedure);
 old:=$old$\.(png|jpg|webp)$$old$;
 perform elio.require(position(old in definition)>0,'Missing private payout receipt path validation.');
 execute replace(definition,old,$new$\.(png|jpg|jpeg|heic|heif|webp)$$new$);
 definition:=pg_get_functiondef('elio.save_website_photo(jsonb)'::regprocedure);
 old:=$old$\.webp$$old$;
 perform elio.require(position(old in definition)>0,'Missing website photo path validation.');
 definition:=replace(definition,old,$new$\.(webp|png|jpg|jpeg|heic|heif)$$new$);
 old:=$old$metadata->>'mimetype'='image/webp'$old$;
 perform elio.require(position(old in definition)>0,'Missing website photo MIME validation.');
 definition:=replace(definition,old,$new$metadata->>'mimetype'=case lower(substring(next_path from '[^.]+$')) when 'png' then 'image/png' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'heic' then 'image/heic' when 'heif' then 'image/heif' when 'webp' then 'image/webp' end$new$);
 execute definition;
end $migration$;
commit;
