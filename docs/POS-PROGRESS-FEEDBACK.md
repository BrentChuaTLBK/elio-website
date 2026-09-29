# POS progress feedback and product-editor spacing

Approved by Brent on 30 September 2026 after proposal 02. The product-editor spacing fix was separately requested with a screenshot during implementation.

## Stock saves

Single event-stock, bulk event-stock and direct POS product-stock forms show “Saving stock…” while pending. Form values are captured before controls disable. Existing disabled states are restored on failure; entered values remain available to retry. Close is visibly disabled while saving. Success confirms the saved quantity or number of rows.

If saving succeeds but reloading the latest quantities fails, the editor closes and explicitly reports that stock was saved and a refresh is needed. It does not invite a second save. A new event-stock row keeps its ID across retries after a lost response, preventing duplicate creation under a new ID.

## Event switching

The affected POS controls disable while an event loads, accompanied by a visible progress message and status announcement. New catalog/event data is committed to the UI after the reads succeed. On failure, the previous event, stock, cart and report are restored together. Cancelling the existing cart-clear confirmation preserves the current event and cart. Success announces the event is ready.

## Product editor

The Delete fixed box / product action and preservation note now share a vertical layout with a 12px gap. The note no longer inherits the negative margin used for field help. Deletion permissions, confirmation and record-preservation behavior are unchanged.

## Verification

`tests/ui/pos-feedback.mjs` uses an isolated database and real POS/admin UI. It checks delayed saves, disabled controls, duplicate submission, failure/retry, persisted quantities, bulk selection, saved-but-refresh-failed messaging, cancelled/failed/successful event switches, report-read rollback, and a lost response when adding stock. It checks the actual product-editor delete section at 320/390/768/1440px without deleting a product. The existing `tests/ui/pos.mjs` regression and JavaScript syntax check also passed. No live orders or stock were changed for testing.

Proposal 03 (payment-email presentation) remains a local preview awaiting approval; no email templates or sending rules were changed.
