-- Keep editorial drafts out of the public settings payload.
alter table elio.settings add column faq_content jsonb not null
 default '{"heading":"Frequently asked questions","items":[]}'::jsonb;
alter table elio.settings add column faq_revision integer not null default 0;

update elio.settings set faq_content=jsonb_build_object('heading','Frequently asked questions','items',jsonb_build_array(
 jsonb_build_object('id',gen_random_uuid(),'question','What flavors are available?',
  'answer','Our menu rotates, while the full collection stays here to explore. See flavors of the month for the current lineup.',
  'visible',true,'link_label','Flavors of the month','link_url','flavors.html#monthly-flavors'),
 jsonb_build_object('id',gen_random_uuid(),'question','Can I customize a box?',
  'answer','Choose three available flavors in our build-your-own box. Flavor surcharges are shown before you add it to your basket. Fixed sets come with their listed flavors.',
  'visible',true,'link_label','Build your own box','link_url','order.html?product=your-own'),
 jsonb_build_object('id',gen_random_uuid(),'question','How should I store the cheesecakes?',
  'answer','Storage and serving instructions will be added before ordering opens.',
  'visible',true,'link_label','','link_url',''),
 jsonb_build_object('id',gen_random_uuid(),'question','Do you offer gift packaging?',
  'answer','Elio''s packaging concept pairs a brown three-piece box with a matching paper bag. Final gifting options will be confirmed before ordering opens.',
  'visible',true,'link_label','','link_url','')
)) where id;

create function elio.faq_data(p_public boolean default true) returns jsonb
language sql stable set search_path='' as $$
 select case when p_public then jsonb_build_object('heading',faq_content->>'heading','items',
  (select coalesce(jsonb_agg(jsonb_build_object('id',item->>'id','question',item->>'question','answer',item->>'answer',
    'link_label',item->>'link_label','link_url',item->>'link_url') order by position),'[]')
   from jsonb_array_elements(faq_content->'items') with ordinality x(item,position) where (item->>'visible')::boolean))
 else jsonb_build_object('faq_content',faq_content,'faq_revision',faq_revision) end
 from elio.settings where id
$$;

create function elio.save_faqs(p_payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare content jsonb:=p_payload->'content'; current_revision integer; item jsonb; cleaned jsonb:='[]';
 ids uuid[]:='{}'; item_id uuid; heading text; question text; answer text; link_label text; link_url text;
begin
 perform elio.assert_staff(auth.uid(),true);
 perform elio.require(elio.is_verified(auth.uid()),'A verified owner account is required.');
 select faq_revision into current_revision from elio.settings where id for update;
 perform elio.require(jsonb_typeof(p_payload->'expected_revision')='number' and
  p_payload->>'expected_revision'=current_revision::text,'FAQs changed in another session. Refresh before saving.');
 perform elio.require(jsonb_typeof(content)='object','Provide valid FAQ content.');
 heading:=trim(content->>'heading');
 perform elio.require(jsonb_typeof(content->'heading')='string' and length(heading) between 1 and 100,'Enter an FAQ heading using 1–100 characters.');
 perform elio.require(jsonb_typeof(content->'items')='array','Provide a list of FAQs.');
 perform elio.require(jsonb_array_length(content->'items')<=50,'Use at most 50 FAQs.');
 for item in select value from jsonb_array_elements(content->'items') loop
  perform elio.require(jsonb_typeof(item)='object','Provide valid FAQ entries.');
  item_id:=(item->>'id')::uuid;
  perform elio.require(item_id is not null and not item_id=any(ids),'Each FAQ needs its own unique ID.');
  ids:=array_append(ids,item_id);
  question:=trim(item->>'question');answer:=trim(item->>'answer');
  perform elio.require(jsonb_typeof(item->'question')='string' and length(question) between 1 and 200,'Enter each question using 1–200 characters.');
  perform elio.require(jsonb_typeof(item->'answer')='string' and length(answer) between 1 and 6000,'Enter each answer using 1–6,000 characters.');
  perform elio.require(jsonb_typeof(item->'visible')='boolean','Choose whether to show each FAQ.');
  link_label:=trim(coalesce(item->>'link_label',''));link_url:=trim(coalesce(item->>'link_url',''));
  perform elio.require(length(link_label)<=120 and length(link_url)<=2048,'Use a shorter FAQ link.');
  perform elio.require((link_url='' and link_label='') or (link_label<>'' and
   link_url ~ '^(https?://[^[:space:]]+|mailto:[^[:space:]]+|/?[A-Za-z0-9_-]+\.html([?#][^[:space:]]*)?)$'),
   'Add both link text and a valid website or email link.');
  cleaned:=cleaned||jsonb_build_array(jsonb_build_object('id',item_id,'question',question,'answer',answer,
   'visible',(item->>'visible')::boolean,'link_label',link_label,'link_url',link_url));
 end loop;
 update elio.settings set faq_content=jsonb_build_object('heading',heading,'items',cleaned),faq_revision=faq_revision+1 where id;
 return elio.faq_data(false);
end $$;
revoke all on function elio.faq_data(boolean),elio.save_faqs(jsonb) from public,anon,authenticated;

do $adapt$
declare definition text:=replace(pg_get_functiondef('elio.dispatch(text,jsonb,text)'::regprocedure),chr(13),''); old text;
begin
 old:='perform elio.expire_orders();';
 if position(old in definition)=0 then raise exception 'Missing FAQ dispatch patch point'; end if;
 definition:=replace(definition,old,old||$patch$
 if p_action='faqs' then return elio.faq_data(true); end if;
 if p_action='save_faqs' then return elio.save_faqs(p_payload); end if;$patch$);
 old:=$patch$return result||jsonb_build_object('promos',$patch$;
 if position(old in definition)=0 then raise exception 'Missing FAQ bootstrap patch point'; end if;
 definition:=replace(definition,old,$patch$return result||elio.faq_data(false)||jsonb_build_object('promos',$patch$);
 execute definition;
end $adapt$;
