-- Cover order-history and ownership lookups as Elio order volume grows.
create index if not exists action_keys_order_idx on elio.action_keys(order_id);
create index if not exists history_order_idx on elio.history(order_id,id);
create index if not exists outbox_order_idx on elio.outbox(order_id);
create index if not exists promo_usage_user_idx on elio.promo_usage(user_id);
