# Elio accounting

Open `manage.html#accounting` with an owner account. Staff and customer accounts
cannot read accounting reports, costs, client details, or history.

The implementation follows the accounting modules in
[TLB Kitchen's bakery repository](https://github.com/BrentChuaTLBK/bakery-website),
reviewed against tree `70a54b2ca3c8b1687e3430530f61896efa313b61`.

## Reports

- Website product sales are recorded on payment approval, using the Manila date.
- Discounts appear separately under expenses and are subtracted once.
- Customer delivery fees appear under income; actual courier costs are separate
  expenses on the cost date entered by the owner.
- Later changes to paid order amounts create adjustment entries on the change
  date. They do not overwrite the original recorded amounts.
- Only paid orders in confirmed, preparing, ready for pickup, out for delivery,
  or completed states count. Cancelled, expired, and refund-labelled orders are
  excluded from all report periods, including their discounts and courier costs.
  Saved records and audit history remain intact.
- The result is income less recorded expenses. Blank delivery costs mean unknown;
  an explicit zero means no cost. Missing costs are shown in the report.
- Existing payment histories are imported once. Where history is unavailable,
  current saved amounts are booked on the approval date and identified as imports.

This uses the same current-order inclusion rule as TLB; the Analytics screen uses
placement dates, so different date ranges can produce different totals.

## Manual entries and delivery costs

No manual categories are seeded. Owners create their own shared categories and
choose Sales / income or Expense on each entry. Categories can be renamed or
archived; old entries remain. Optional client/supplier names, payment methods,
and notes are private. Revisions reject stale edits, retries are idempotent, and
removal retains audit history.

Each delivery order has an owner-only Delivery accounting section. Recording a
courier cost does not change customer pricing, payment status, emails, or stock.

Excel export refreshes eligibility, then includes the whole selected date range,
not just the visible page. Workbooks contain a summary, category sheets with
separate income/expense tables, and delivery comparisons. Customer text is stored
as literal text; currency and dates remain typed cells.

## Validation

`node tests/backend/run.mjs` covers owner-only access, exact totals, safe retries,
payment posting, historical imports, order adjustments, cancellations, refunds,
shared categories, and audit history. Use `PGLITE_PACKAGE_ROOT` for a separate
PGlite dependency directory when needed.

`node --test tests/accounting.test.mjs` checks decimal parsing and real XLSX
roundtrips. `EXCELJS_TEST_PATH` can point to the pinned ExcelJS 4.4.0 browser bundle.

`node tests/ui/accounting.mjs` covers desktop/mobile entry workflows, delivery
costs, category creation, date filters, real downloads, and staff restrictions.
Configure `PLAYWRIGHT_PACKAGE_ROOT`, `BROWSER_EXECUTABLE_PATH`, and
`EXCELJS_TEST_PATH` for the local test tools. These use fixtures, not live orders.
