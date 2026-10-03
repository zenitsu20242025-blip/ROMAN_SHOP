-- Run once in Supabase → SQL Editor (after supabase-setup.sql). Safe to re-run.

alter table products
  add column if not exists cj_pid text,
  add column if not exists cj_vid text,
  add column if not exists cost numeric;

alter table orders
  add column if not exists cj_order_id text,
  add column if not exists cj_status text,
  add column if not exists cj_amount numeric,
  add column if not exists logistic_name text,
  add column if not exists tracking_number text,
  add column if not exists tracking_url text,
  add column if not exists payment_provider text,
  add column if not exists payment_ref text,
  add column if not exists paid_at timestamptz,
  add column if not exists synced_at timestamptz,
  add column if not exists error text;

-- The 6 demo products have fake CJ SKUs and cannot be fulfilled. Remove them
-- once you have imported real products from the admin panel:
-- delete from products where id like 'rm-%';
