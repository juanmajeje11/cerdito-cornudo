# Cerdito Cornudo · Supabase

Project ref: `qvcfovnjkejqzqzkcjxu` (São Paulo). Colombia settings are COP and `America/Bogota`.

## Current setup

- The initial schema and security hardening migration are applied.
- The admin profile for Juan is active.
- Tables, RLS, protected order RPCs, idempotent order creation and Realtime are configured.
- The live app is served at [Cerdito Cornudo](https://qvcfovnjkejqzqzkcjxu.supabase.co/functions/v1/cerdito-app/index.html).
- The 12 visible products and prices from the supplied menu images are loaded under the category “Parrilla”. The picadas are separate with-res and without-res options.

## Operating rules

- Auth users require an active `public.profiles` row; there is no public signup.
- Admin manages products. Orders preserve product-name and price snapshots.
- Orders are closed when service is completed; closure counts toward the sales dashboard but is not payment collection or confirmation.
- Admin cancellation requires a reason and is retained for audit; cancelled orders are excluded from sales.
- Taxes and payment methods are not configured. The app labels totals provisional and does not invent a tax rate.
- Do not expose the `private` schema or place a secret/service-role key in the browser.

## Adding waiters later

Create each user in Supabase Auth, then associate their Auth UUID with the restaurant and role `waiter` in `public.profiles`. Never put passwords in SQL, project files, or chat.

