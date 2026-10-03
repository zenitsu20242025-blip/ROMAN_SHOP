# Roman — dropshipping storefront (Node/Express + Supabase + CJ Dropshipping)

## What it does
- Storefront: catalog, cart, checkout, order-status page, policy pages.
- Admin (`/admin/login.html`): import products from CJ, edit prices, see orders,
  mark payments, retry CJ orders, sync tracking.
- Order flow: customer checks out -> order saved (`pending_payment`) -> payment
  confirmed (Stripe webhook, or you click "Mark paid") -> order created at CJ ->
  CJ status/tracking synced by cron -> customer sees it on the order page.

## One-time setup
1. Supabase SQL Editor: run `supabase-setup.sql`, then `supabase-migration-2.sql`.
2. Render -> Environment: copy every key from `.env.example` and fill it in.
3. Push to GitHub; Render redeploys.
4. Admin -> Setup tab: check every row is OK, press "Test CJ connection".
5. Admin -> Import from CJ: add real products. Delete the demo products (`rm-*`).

## Test safely first
Keep `CJ_SANDBOX=true`, place a test order, click "Mark paid & send to CJ" in the
Orders tab and confirm a CJ order appears. Only then set `CJ_SANDBOX=false`.

## Payments
- `PAYMENT_PROVIDER=manual`: orders wait as "Awaiting payment"; you confirm.
- `PAYMENT_PROVIDER=stripe`: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`;
  in Stripe add webhook `https://YOUR-SITE/api/webhooks/stripe`, event
  `checkout.session.completed`.
- Another gateway: add `lib/<name>.js` with createSession/verifyWebhook and call
  `markPaidAndFulfill(orderId, {provider})` from its webhook.

## Cron jobs (cron-job.org)
1. Keep-alive: `GET https://YOUR-SITE/` every 10 minutes.
2. Tracking sync: `GET https://YOUR-SITE/api/cron/sync?token=CRON_TOKEN` every 30 minutes.

## CJ balance
With `CJ_PAY_MODE=manual` each CJ order waits unpaid in your CJ dashboard until
you pay it. With `balance`, it is paid from your CJ balance automatically and
fails if the balance is too low (then use "Retry CJ" after topping up).
