# Delivery tracking

New customer emails link to the secure Elio order page with `section=tracking`. The page fetches the current order and focuses its tracking section. Customers see the latest saved courier booking link, or an explicit unavailable message when there is no link. Cancelled and refunded orders do not show a courier link. Already-sent emails cannot be changed.

The admin editor and backend reject bare Grab and Lalamove homepages, including country/language landing pages. Existing saved homepages are hidden by the customer page. Booking and tracking URLs on those services remain accepted.

The email worker preserves its existing authentication, delivery retries and frozen provider payloads. This change does not resend previous notifications. Only the order email renderer changed in the deployed worker; other deployed modules were retained.

Validation: backend tracking URL checks, email rendering and mocked email-worker tests, plus the current-link browser scenarios in `tests/ui/payment-options.mjs`. Browser checks use fixtures and send no email. The customer Print button is removed; staff preparation-slip printing remains available.
