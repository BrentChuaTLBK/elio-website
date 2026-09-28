begin;
do $$
declare definition text; hook constant text:=' return tracking_url;';
begin
 definition:=pg_get_functiondef('elio.normalize_delivery_tracking_url(jsonb)'::regprocedure);
 perform elio.require(position(hook in definition)>0,'Missing courier URL validation hook.');
 execute replace(definition,hook,$new$
 perform elio.require(tracking_url !~* '^https?://(www\.)?(grab|lalamove)\.com\.?(:[0-9]+)?(/([a-z]{2}([/-][a-z]{2})?)?/?)?([?#].*)?$',
  'Paste the courier tracking link for this booking, not the courier homepage.');
 return tracking_url;$new$);
end $$;
commit;
