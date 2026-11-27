-- Upcoming is the open fulfillment queue, including overdue orders at any payment stage.
do $migration$
declare
  matches text := pg_get_functiondef('elio.admin_order_matches(elio.orders,jsonb)'::regprocedure);
  summary text := pg_get_functiondef('elio.admin_core_summary()'::regprocedure);
  order_date_gate text := '(o.fulfillment_date>=(now() at time zone ''Asia/Manila'')::date or o.payment_status=''paid'') and ';
  summary_date_gate text := '(fulfillment_date>=(now() at time zone ''Asia/Manila'')::date or payment_status=''paid'') and ';
begin
  perform elio.require(length(matches)-length(replace(matches,order_date_gate,''))=length(order_date_gate),
    'Expected the previous Upcoming date gate in the order filter.');
  perform elio.require(length(summary)-length(replace(summary,summary_date_gate,''))=2*length(summary_date_gate),
    'Expected the previous Upcoming date gate in both overview queries.');
  execute replace(matches,order_date_gate,'');
  execute replace(summary,summary_date_gate,'');
end
$migration$;
