# Customer payment options

In **Shop settings → Payment options**, the owner can add, edit or remove up to 20 payment methods. Each has a method name, account name, account number and optional instructions. General instructions can be entered below the list. Save shop settings to publish changes. At least one method is required while orders are open.

Customers awaiting payment see every saved option as a separate card, with copy buttons for account name and number. Leading zeroes are preserved. If clipboard access is blocked, the value is selected for manual copying. The existing full-payment deadline and receipt-upload flow apply. Paid, closed, refunded and maintenance-paused orders do not show payment cards.

The backend validates options, rejects stale payment-setting edits and stores the methods and general instructions with each new order. It also generates `payment_instructions` for the existing order email renderer. Later settings changes do not change the accounts on existing orders or their emails. Older orders using the recognized three-line payment format also render cards; unrecognized legacy instructions remain visible as text.

Validation:

- `node tests/payment-options.test.mjs`
- `node tests/backend/run.mjs` — includes permissions, input validation, snapshots, email contents and legacy conversion.
- `node tests/ui/payment-options.mjs` — uses local mocked API responses; checks copying, manual-copy fallback, receipt submission, closed states and adding/saving/removing methods at 1440, 390 and 320px. Requires the same Playwright environment variables as the other UI checks.

No customer emails are sent by these tests.
