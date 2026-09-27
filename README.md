# Roman — headless dropshipping storefront

A lean Node.js/Express storefront: product catalog, cart, checkout, admin
panel, and clearly marked extension points for CJ Dropshipping and a payment
gateway. Products and orders are stored in Supabase (Postgres) — durable by
default, no ephemeral-disk surprises on Render's free tier.

## 1. One-time Supabase setup

1. Go to [supabase.com](https://supabase.com) → **Start your project** →
   **Continue with GitHub** → **New Project** (no card required).
2. Pick a database password (save it somewhere) and a region close to your
   customers (e.g. Frankfurt for US/Europe).
3. Once the project is ready, open **SQL Editor → New query**, paste the
   entire contents of `supabase-setup.sql` from this repo, and click **Run**.
   This creates the `products` and `orders` tables and seeds the starter
   catalog.
4. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **service_role** key (secret — never commit this)

## 2. Environment variables

Set these on Render (Settings → Environment) — never in a committed file:

| Key | Value |
|---|---|
| `ADMIN_PASSWORD` | your own admin password |
| `SESSION_SECRET` | any long random string |
| `SUPABASE_URL` | from Supabase → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | the `service_role` key from the same page |
| `PORT` | `3000` |

For local development, copy `.env.example` to `.env` and fill in the same
values.

## 3. Local run

```bash
npm install
cp .env.example .env   # fill in the values above
npm start
```

Open http://localhost:3000

## Project structure

```
server.js              → API routes (products, checkout, orders, admin) — reads/writes Supabase
supabase-setup.sql      → run once in Supabase's SQL Editor to create + seed tables
data/products.json      → reference copy of the starter catalog only (not read at runtime)
public/                 → static frontend (plain HTML/CSS/JS, no build step)
public/admin/           → password-protected admin panel
```

## Push to GitHub

```bash
git init
git add .
git commit -m "Roman storefront"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env` is gitignored on purpose — never commit real API keys.

## Deploy on Render

1. New → Web Service → connect your GitHub repo.
2. Build command: `npm install`
3. Start command: `npm start`
4. Add the environment variables from step 2 above.

Because storage lives in Supabase, redeploys and restarts no longer erase
your products or orders — Render's disk being ephemeral doesn't matter
anymore.

## Wiring up CJ Dropshipping and payment

Both are stubbed with `--- ... EXTENSION POINT ---` comments in `server.js`
inside the `/api/checkout` route:

- **Payment (2Checkout/Verifone or Payoneer Checkout):** once your merchant
  account is approved, call their SDK/API with `PAYMENT_API_KEY` before
  marking an order `paid`. Until then, orders are saved with status
  `awaiting_manual_review` so nothing is lost.
- **CJ Dropshipping:** after payment is confirmed, call CJ's Create Order
  endpoint with `CJ_API_KEY`, the customer's address, and each item's `cjSku`
  (already stored per product and passed through checkout).

## Admin panel

Go to `/admin/login.html` and log in with `ADMIN_PASSWORD`. From
`/admin/index.html` you can:

- Add or delete products (Products tab) — saved directly to Supabase, no
  export/commit step needed anymore
- View placed orders (Orders tab)
- Export the current catalog as a JSON backup, if you want one

## Adding real products

Easiest: use the admin panel's "Add product" form — it writes straight to
Supabase. Alternatively, insert rows directly in Supabase's **Table Editor**
or **SQL Editor**. Each product needs: `id`, `name`, `category`, `price`,
`compare_at`, `spec` (a JSON object), `image`, `description`, `cj_sku` (the
SKU from your CJ Dropshipping account), and `stock`.
