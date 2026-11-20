-- Box questions share the order selection contract with the generated trio flavor group.
-- Raw product data keeps owner-authored questions separate from generated flavor choices.
create function elio.validate_box_questions(questions jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare question jsonb; choice jsonb; group_ids text[]:='{}'; choice_ids text[];
begin
 perform elio.require(jsonb_typeof(questions)='array','Box questions must be a list.');
 for question in select value from jsonb_array_elements(questions) loop
  perform elio.require(jsonb_typeof(question)='object' and jsonb_typeof(question->'id')='string'
   and (question->>'id') ~ '^[a-zA-Z0-9_-]{1,100}$' and question->>'id' not in ('flavors','__proto__','constructor','prototype')
   and not ((question->>'id')=any(group_ids)),'Each box question needs a unique ID.');
  group_ids:=array_append(group_ids,question->>'id');
  perform elio.require(jsonb_typeof(question->'label')='string' and length(trim(question->>'label')) between 1 and 160
   and question->'required_count'='1'::jsonb,'Name each question and require exactly one answer.');
  perform elio.require(jsonb_typeof(question->'choices')='array' and jsonb_array_length(question->'choices')>0,'Add at least one choice to each question.');
  choice_ids:='{}';
  for choice in select value from jsonb_array_elements(question->'choices') loop
   perform elio.require(jsonb_typeof(choice)='object' and jsonb_typeof(choice->'id')='string'
    and (choice->>'id') ~ '^[a-zA-Z0-9_-]{1,100}$' and choice->>'id' not in ('__proto__','constructor','prototype')
    and not ((choice->>'id')=any(choice_ids)),'Each answer needs a unique ID within its question.');
   choice_ids:=array_append(choice_ids,choice->>'id');
   perform elio.require(jsonb_typeof(choice->'label')='string' and length(trim(choice->>'label')) between 1 and 240,'Give each answer a name.');
   perform elio.require(jsonb_typeof(choice->'surcharge_cents')='number' and (choice->>'surcharge_cents') ~ '^[0-9]+$'
    and (choice->>'surcharge_cents')::numeric<=100000000,'Enter a valid extra price in whole centavos.');
   perform elio.require(not(choice?'active') or jsonb_typeof(choice->'active')='boolean','Choose a valid answer availability.');
  end loop;
  perform elio.require(exists(select 1 from jsonb_array_elements(question->'choices') c where coalesce((c->>'active')::boolean,true)),'Each question needs an available choice.');
 end loop;
end $$;

-- Snapshot the answer text and price on the order. Continued edits to the menu do not change an existing purchase.
create function elio.order_option_labels(p jsonb, groups jsonb, selections jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare g jsonb; c jsonb; picked jsonb; entry record; group_key text; n integer; total integer; labels jsonb:='[]';
begin
 for group_key in select jsonb_object_keys(selections) loop
  perform elio.require(exists(select 1 from jsonb_array_elements(groups) where value->>'id'=group_key),'Unknown product option group.');
 end loop;
 for g in select value from jsonb_array_elements(groups) loop
  picked:=coalesce(selections->(g->>'id'),'{}'); total:=0;
  perform elio.require(jsonb_typeof(picked)='object','Invalid option choices.');
  for entry in select key,value from jsonb_each(picked) loop
   perform elio.require(jsonb_typeof(entry.value)='number' and entry.value::text ~ '^[0-9]+$','Flavor quantities must be nonnegative whole numbers.');
   n:=entry.value::text::integer;
   select value into c from jsonb_array_elements(g->'choices') where value->>'id'=entry.key;
   perform elio.require(c is not null,'Unknown option choice.');
   if n>0 then
    perform elio.require(coalesce((c->>'active')::boolean,true),'Option unavailable: '||(c->>'label'));
    total:=total+n;
    labels:=labels||jsonb_build_array(jsonb_build_object('group_id',g->>'id','group',g->>'label','label',c->>'label','quantity',n,'surcharge_cents',(c->>'surcharge_cents')::integer));
   end if;
  end loop;
  perform elio.require(total=(g->>'required_count')::integer,'Choose exactly '||(g->>'required_count')||' for '||(g->>'label')||' in '||(p->>'name')||'.');
 end loop;
 if p->>'kind'='set' and jsonb_array_length(labels)>0 then
  select coalesce(jsonb_agg(jsonb_build_object('group_id','flavors','group','Inside your box','label',f->>'name','quantity',f->'quantity','surcharge_cents',0) order by f->>'product_id'),'[]')||labels
   into labels from jsonb_array_elements(elio.flavor_recipe(p)) f;
 end if;
 return labels;
end $$;
revoke all on function elio.validate_box_questions(jsonb), elio.order_option_labels(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;

do $migration$
declare def text; r record; signature text;
begin
 signature:='elio.validate_product()';
 def:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 for r in select * from (values
  ($a$new.data:=jsonb_set(new.data,'{option_groups}','[]');$a$, $b$new.data:=jsonb_set(new.data,'{option_groups}','[]');
 if tg_op='UPDATE' and not(new.data?'box_questions') and old.data?'box_questions' then
  new.data:=new.data||jsonb_build_object('box_questions',old.data->'box_questions');
 end if;
 if new.data?'box_questions' then
  perform elio.require(kind in ('set','custom_box'),'Questions can only be added to boxes.');
  perform elio.validate_box_questions(new.data->'box_questions');
 end if;$b$)
 ) as edits(anchor,replacement) loop
  perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Box question hook changed in '||signature);
  def:=replace(def,r.anchor,r.replacement);
 end loop;
 execute def;
 signature:='elio.product_view(jsonb)';
 def:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 for r in select * from (values
  ($a$'required_count',3,'choices',choices)));$a$,$b$'required_count',3,'choices',choices))||coalesce(p->'box_questions','[]'));$b$),
  ($a$ return p;$a$,$b$ if p->>'kind'='set' and p?'box_questions' then
  return p||jsonb_build_object('option_groups',p->'box_questions');
 end if;
 return p;$b$)
 ) as edits(anchor,replacement) loop
  perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Box question hook changed in '||signature);
  def:=replace(def,r.anchor,r.replacement);
 end loop;
 execute def;
 signature:='elio.calculate_quote(jsonb,uuid,uuid,boolean,timestamptz)';
 def:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 for r in select * from (values
  ($a$perform elio.require(sels='{}'::jsonb,'Fixed-set flavors cannot$a$,$b$perform elio.require(not(sels?'flavors'),'Fixed-set flavors cannot$b$),
  ($a$   surcharge:=0; labels:='[]';
   for group_key in select jsonb_object_keys(sels) loop
    perform elio.require(exists(select 1 from jsonb_array_elements(coalesce(p->'option_groups','[]')) where value->>'id'=group_key),'Unknown product option group.');
   end loop;
   for g in select value from jsonb_array_elements(coalesce(p->'option_groups','[]')) loop
    group_sels:=coalesce(sels->(g->>'id'),'{}'); sum_count:=0;
    perform elio.require(jsonb_typeof(group_sels)='object','Invalid option choices.');
    for choice_key,chosen in select key,value from jsonb_each(group_sels) loop
     perform elio.require(jsonb_typeof(chosen)='number' and chosen::text ~ '^[0-9]+$','Flavor quantities must be nonnegative whole numbers.');
     n:=chosen::text::integer;
     select value into c from jsonb_array_elements(g->'choices') where value->>'id'=choice_key;
     perform elio.require(c is not null,'Unknown option choice.');
     if n>0 then
      perform elio.require(coalesce((c->>'active')::boolean,true),'Option unavailable: '||(c->>'label'));
      sum_count:=sum_count+n; surcharge:=surcharge+(c->>'surcharge_cents')::integer*n;
      labels:=labels||jsonb_build_array(jsonb_build_object('group',g->>'label','label',c->>'label','quantity',n,'surcharge_cents',(c->>'surcharge_cents')::integer));
     end if;
    end loop;
    perform elio.require(sum_count=(g->>'required_count')::integer,'Choose exactly '||(g->>'required_count')||' for '||(g->>'label')||' in '||(p->>'name')||'.');
   end loop;
   unit:=(p->>'price_cents')::integer+surcharge;$a$,$b$   labels:=elio.order_option_labels(p,coalesce(p->'option_groups','[]'),sels);
   select coalesce(sum((v->>'quantity')::bigint*(v->>'surcharge_cents')::bigint),0) into surcharge from jsonb_array_elements(labels) v;
   unit:=(p->>'price_cents')::integer+surcharge;$b$)
 ) as edits(anchor,replacement) loop
  perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Box question hook changed in '||signature);
  def:=replace(def,r.anchor,r.replacement);
 end loop;
 execute def;
 signature:='elio.pos_quote(jsonb,uuid)';
 def:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
 for r in select * from (values
  ($a$perform elio.require(sels='{}'::jsonb,'Fixed boxes keep their configured flavors.');$a$,$b$perform elio.require(not(sels?'flavors'),'Fixed boxes keep their configured flavors.');$b$),
  ($a$(select count(*) from jsonb_object_keys(sels))=1 and jsonb_typeof(sels->'flavors')='object'$a$,$b$jsonb_typeof(sels->'flavors')='object'$b$),
  ($a$   if old_item is null then perform elio.require((select sum((value->>'quantity')::integer) from jsonb_array_elements(recipe))=3$a$,
   $b$   if old_item is null then
    declare answers jsonb:=elio.order_option_labels(p,coalesce(p->'box_questions','[]'),sels-'flavors');
    begin
     labels:=labels||answers;
     select unit+coalesce(sum((a->>'quantity')::bigint*(a->>'surcharge_cents')::bigint),0) into unit from jsonb_array_elements(answers) a;
    end;
   end if;
   if old_item is null then perform elio.require((select sum((value->>'quantity')::integer) from jsonb_array_elements(recipe))=3$b$)
 ) as edits(anchor,replacement) loop
  perform elio.require((length(def)-length(replace(def,r.anchor,'')))/length(r.anchor)=1,'Box question hook changed in '||signature);
  def:=replace(def,r.anchor,r.replacement);
 end loop;
 execute def;
end $migration$;
