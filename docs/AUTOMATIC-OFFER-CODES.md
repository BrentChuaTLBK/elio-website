# Short automatic-offer codes

Requested by the user: new automatic offers use the same six-character uppercase letter-and-number format as newsletter welcome codes, for example `K7M4Q2`. Both use the existing newsletter alphabet and guarantee at least one letter and one number. The `ELIO-` prefix is removed for newly issued automatic offers. The admin email preview uses `K7M4Q2`.

Migration `20260929172048_elio_short_automatic_offer_codes.sql` changes only the generator inside `elio.voucher_completed_order()` and the sample code in `elio.voucher_email_preview(jsonb)`. Existing issued codes, terms and email snapshots are not rewritten. The unique constraint, conflict retry, ownership restrictions and one-use rules remain in place. Security-invoker mode, empty search path and function grants are preserved.

Validation: all 245 backend checks across 76 migration files passed in an isolated PGlite database. Suites 56/57 explicitly verify mixed six-character newsletter/automatic codes, matching outbox payload, redemption, campaign limits, account access, expiry, POS exclusions, opt-in sending and preview output. Hosted cron migrations are not executed by the local runner.

Applied to production and verified both deployed function definitions. Existing promo-row hashes and voucher count were unchanged, as were both function ACLs/search paths/security modes. No production voucher, order or email was generated for this change. Security advisor returned the existing private-table RLS notices and the previously declined leaked-password warning; no new function warning.
