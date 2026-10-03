/**
 * Roman storefront backend.
 * - Products/orders live in Supabase (durable).
 * - CJ Dropshipping API: product import, order creation, tracking sync.
 * - Payments: Stripe Checkout (if configured) or manual mode (admin marks paid).
 */
const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const cj = require("./lib/cj");
const stripe = require("./lib/stripe");

const app = express();
const PORT = process.env.PORT || 3000;
app.set("trust proxy", 1);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---------- Config ----------
const PAYMENT_PROVIDER = (process.env.PAYMENT_PROVIDER || "manual").toLowerCase(); // manual | stripe
const CJ_FROM_COUNTRY = process.env.CJ_FROM_COUNTRY || "CN"; // CN or US warehouse
const CJ_PAY_MODE = (process.env.CJ_PAY_MODE || "manual").toLowerCase(); // manual | balance
const CJ_SANDBOX = String(process.env.CJ_SANDBOX || "").toLowerCase() === "true";

const COUNTRIES = [
  ["US", "United States"], ["CA", "Canada"], ["GB", "United Kingdom"], ["AU", "Australia"],
  ["AT", "Austria"], ["BE", "Belgium"], ["BG", "Bulgaria"], ["HR", "Croatia"], ["CY", "Cyprus"],
  ["CZ", "Czechia"], ["DK", "Denmark"], ["EE", "Estonia"], ["FI", "Finland"], ["FR", "France"],
  ["DE", "Germany"], ["GR", "Greece"], ["HU", "Hungary"], ["IE", "Ireland"], ["IT", "Italy"],
  ["LV", "Latvia"], ["LT", "Lithuania"], ["LU", "Luxembourg"], ["MT", "Malta"], ["NL", "Netherlands"],
  ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["SK", "Slovakia"], ["SI", "Slovenia"],
  ["ES", "Spain"], ["SE", "Sweden"], ["NO", "Norway"], ["CH", "Switzerland"],
];
const COUNTRY_NAME = Object.fromEntries(COUNTRIES);

// ---------- Middleware ----------
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf; // needed for webhook signature checks
    },
  })
);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", secure: "auto", maxAge: 1000 * 60 * 60 * 8 },
  })
);
app.use(express.static(path.join(__dirname, "public")));

// Async route wrappers. Public routes hide internal error details.
const pub = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(req.method, req.path, err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  });
const adm = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(req.method, req.path, err);
    res.status(500).json({ error: err.message || "Server error" });
  });

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Not authenticated" });
}
function safeEq(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
const loginAttempts = new Map();
function tooManyLogins(ip) {
  const now = Date.now();
  const recent = (loginAttempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  loginAttempts.set(ip, recent);
  return recent.length >= 10;
}

// ---------- Mapping ----------
function rowToProduct(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    price: Number(r.price),
    compareAt: r.compare_at != null ? Number(r.compare_at) : null,
    spec: r.spec || {},
    image: r.image,
    description: r.description,
    stock: r.stock,
    cjSku: r.cj_sku,
    cjPid: r.cj_pid,
    cjVid: r.cj_vid,
    cost: r.cost != null ? Number(r.cost) : null,
  };
}
function publicProduct(p) {
  const { cjSku, cjPid, cjVid, cost, ...rest } = p;
  return rest;
}
const PRODUCT_COLS = {
  name: "name", category: "category", price: "price", compareAt: "compare_at", spec: "spec",
  image: "image", description: "description", stock: "stock", cjSku: "cj_sku", cjPid: "cj_pid",
  cjVid: "cj_vid", cost: "cost",
};
function productToRow(p) {
  const row = {};
  for (const [k, col] of Object.entries(PRODUCT_COLS)) {
    if (p[k] !== undefined) row[col] = p[k] === "" ? null : p[k];
  }
  return row;
}
function rowToOrder(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    customer: r.customer,
    lineItems: r.line_items || [],
    total: Number(r.total),
    cjOrderId: r.cj_order_id,
    cjStatus: r.cj_status,
    cjAmount: r.cj_amount != null ? Number(r.cj_amount) : null,
    logisticName: r.logistic_name,
    trackingNumber: r.tracking_number,
    trackingUrl: r.tracking_url,
    paymentProvider: r.payment_provider,
    paymentRef: r.payment_ref,
    paidAt: r.paid_at,
    error: r.error,
  };
}
function maskEmail(e = "") {
  const [u, d] = e.split("@");
  return u && d ? `${u[0]}***@${d}` : "";
}
function publicOrder(o) {
  return {
    id: o.id,
    status: o.status,
    total: o.total,
    createdAt: o.createdAt,
    items: o.lineItems.map((i) => ({ name: i.name, qty: i.qty })),
    trackingNumber: o.trackingNumber,
    trackingUrl: o.trackingUrl,
    email: maskEmail(o.customer && o.customer.email),
  };
}

// ---------- Data access ----------
async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*").order("name");
  if (error) throw error;
  return data.map(rowToProduct);
}
async function getOrder(id) {
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}
async function patchOrder(id, patch) {
  const { error } = await supabase.from("orders").update(patch).eq("id", id);
  if (error) throw error;
}

// ---------- Fulfillment ----------
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

async function fulfill(id) {
  const order = await getOrder(id);
  if (!order) throw new Error("Order not found");
  if (order.cjOrderId) return order;
  if (!cj.configured()) {
    await patchOrder(id, { error: "Paid, but CJ_API_KEY is not set — order was not sent to CJ." });
    return order;
  }
  try {
    const missing = order.lineItems.filter((i) => !i.cjVid).map((i) => i.name);
    if (missing.length) {
      throw new Error(`No CJ variant linked for: ${missing.join(", ")}. Import these products from CJ.`);
    }
    const a = order.customer.address;
    const logistic = await cj.pickLogistic({
      items: order.lineItems,
      toCountry: a.country,
      fromCountry: CJ_FROM_COUNTRY,
    });
    const body = {
      orderNumber: order.id,
      shippingZip: clip(a.zip, 20),
      shippingCountryCode: a.country,
      shippingCountry: COUNTRY_NAME[a.country] || a.country,
      shippingProvince: clip(a.state, 50),
      shippingCity: clip(a.city, 50),
      shippingPhone: clip(a.phone, 20),
      shippingCustomerName: clip(order.customer.name, 50),
      shippingAddress: clip(a.street, 500),
      email: clip(order.customer.email, 50),
      remark: "",
      logisticName: logistic.name,
      fromCountryCode: CJ_FROM_COUNTRY,
      payType: CJ_PAY_MODE === "balance" ? 2 : 3, // 2 = pay from CJ balance, 3 = create only
      products: order.lineItems.map((i) => ({ vid: i.cjVid, quantity: i.qty })),
    };
    if (a.street2) body.shippingAddress2 = clip(a.street2, 500);
    if (CJ_SANDBOX) body.isSandbox = 1;

    const data = await cj.createOrder(body);
    const notes = (data.interceptOrderReasons || []).map((r) => r.message).filter(Boolean);
    await patchOrder(id, {
      status: "sent_to_cj",
      cj_order_id: data.orderId || null,
      cj_status: data.orderStatus || null,
      cj_amount: data.orderAmount ? Number(data.orderAmount) : null,
      logistic_name: logistic.name,
      error: notes.length ? "CJ flagged: " + notes.join("; ") : null,
    });
  } catch (err) {
    console.error("CJ order failed for", id, err.message);
    await patchOrder(id, { status: "cj_error", error: clip(err.message, 500) });
  }
  return getOrder(id);
}

// Idempotent: only the first caller flips pending -> paid and triggers CJ.
async function markPaidAndFulfill(id, { provider, ref } = {}) {
  const patch = { status: "paid", paid_at: new Date().toISOString(), payment_provider: provider || null };
  if (ref) patch.payment_ref = ref;
  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", id)
    .in("status", ["pending_payment", "payment_error"])
    .select("id");
  if (error) throw error;
  if (!data.length) return { skipped: true };
  return fulfill(id);
}

async function syncOrder(o) {
  const d = await cj.orderDetail(o.cjOrderId);
  const s = d.orderStatus;
  const patch = { cj_status: s, synced_at: new Date().toISOString() };
  if (d.trackNumber) patch.tracking_number = d.trackNumber;
  if (d.trackingUrl) patch.tracking_url = d.trackingUrl;
  if (s === "SHIPPED") patch.status = "shipped";
  else if (s === "DELIVERED") patch.status = "delivered";
  else if (s === "CANCELLED") patch.status = "cj_cancelled";
  await patchOrder(o.id, patch);
}

async function syncOpenOrders(limit = 8) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("status", ["sent_to_cj", "shipped"])
    .not("cj_order_id", "is", null)
    .order("synced_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  let done = 0;
  const errors = [];
  for (const row of data) {
    try {
      await syncOrder(rowToOrder(row));
      done++;
    } catch (e) {
      errors.push(`${row.id}: ${e.message}`);
    }
  }
  return { checked: data.length, updated: done, errors };
}

// ============ PUBLIC API ============
app.get("/api/config", (req, res) => {
  res.json({ countries: COUNTRIES.map(([code, name]) => ({ code, name })), payment: PAYMENT_PROVIDER });
});

app.get("/api/products", pub(async (req, res) => {
  res.json((await loadProducts()).map(publicProduct));
}));

app.get("/api/products/:id", pub(async (req, res) => {
  const p = (await loadProducts()).find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found" });
  res.json(publicProduct(p));
}));

app.post("/api/checkout", pub(async (req, res) => {
  const { cart, customer } = req.body || {};
  const bad = (msg) => res.status(400).json({ error: msg });

  if (!Array.isArray(cart) || !cart.length || cart.length > 30) return bad("Your cart is empty.");
  const c = customer || {};
  const a = c.address || {};
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || "") && c.email.length <= 50;
  if (!emailOk) return bad("Please enter a valid email address (max 50 characters).");
  if (!c.name || !a.street || !a.city || !a.state || !a.zip || !a.phone) {
    return bad("Please fill in all delivery fields.");
  }
  if (!COUNTRY_NAME[a.country]) return bad("Sorry, we do not deliver to that country yet.");

  const products = await loadProducts();
  const merged = new Map();
  for (const item of cart) {
    const qty = Number.parseInt(item && item.qty, 10);
    if (!item || !Number.isInteger(qty) || qty < 1 || qty > 20) return bad("Invalid quantity.");
    merged.set(item.id, (merged.get(item.id) || 0) + qty);
  }
  let total = 0;
  const lineItems = [];
  for (const [pid, qty] of merged) {
    const p = products.find((x) => x.id === pid);
    if (!p) return bad("A product in your cart is no longer available.");
    total += p.price * qty;
    lineItems.push({ id: p.id, name: p.name, qty, price: p.price, image: p.image, cjVid: p.cjVid, cjSku: p.cjSku });
  }
  total = Math.round(total * 100) / 100;

  const order = {
    id: "ord_" + crypto.randomBytes(9).toString("hex"),
    createdAt: new Date().toISOString(),
    customer: {
      name: clip(c.name, 50),
      email: c.email.trim(),
      address: {
        street: clip(a.street, 200), street2: clip(a.street2, 200), city: clip(a.city, 50),
        state: clip(a.state, 50), zip: clip(a.zip, 20), country: a.country, phone: clip(a.phone, 20),
      },
    },
  };
  const { error } = await supabase.from("orders").insert({
    id: order.id,
    created_at: order.createdAt,
    status: "pending_payment",
    customer: order.customer,
    line_items: lineItems,
    total,
    payment_provider: PAYMENT_PROVIDER,
  });
  if (error) throw error;

  const confirmationPath = `/confirmation.html?order=${order.id}`;
  if (PAYMENT_PROVIDER === "stripe") {
    if (!stripe.configured()) {
      await patchOrder(order.id, { status: "payment_error", error: "Stripe keys are not set" });
      return res.status(503).json({ error: "Payments are not available right now." });
    }
    const base = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
    try {
      const s = await stripe.createSession({
        order, lineItems,
        successUrl: base + confirmationPath,
        cancelUrl: base + "/cart.html",
      });
      await patchOrder(order.id, { payment_ref: s.ref });
      return res.json({ ok: true, orderId: order.id, redirectUrl: s.url });
    } catch (e) {
      console.error("Stripe session failed:", e.message);
      await patchOrder(order.id, { status: "payment_error", error: clip(e.message, 300) });
      return res.status(502).json({ error: "We could not start the payment. Please try again." });
    }
  }
  // Manual mode: order is saved as pending_payment; you confirm payment in the admin panel.
  res.json({ ok: true, orderId: order.id, redirectUrl: confirmationPath });
}));

app.get("/api/orders/:id", pub(async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  res.json(publicOrder(o));
}));

// Stripe webhook (signature verified with STRIPE_WEBHOOK_SECRET)
app.post("/api/webhooks/stripe", async (req, res) => {
  let event;
  try {
    event = stripe.verifyWebhook(req.rawBody, req.get("stripe-signature"));
  } catch (e) {
    return res.status(400).send("Bad signature");
  }
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const orderId = s.metadata && s.metadata.order_id;
      const order = orderId && (await getOrder(orderId));
      if (order && s.payment_status === "paid") {
        if (s.amount_total === Math.round(order.total * 100)) {
          await markPaidAndFulfill(orderId, { provider: "stripe", ref: s.payment_intent || s.id });
        } else {
          await patchOrder(orderId, { error: "Stripe amount mismatch — check manually" });
        }
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error("Webhook handling failed:", e);
    res.status(500).send("error"); // Stripe will retry
  }
});

// Cron endpoint (add to cron-job.org every ~30 min): syncs CJ status + tracking.
app.get("/api/cron/sync", async (req, res) => {
  if (!process.env.CRON_TOKEN || !safeEq(req.query.token || "", process.env.CRON_TOKEN)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    res.json(await syncOpenOrders());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ ADMIN ============
app.post("/admin/api/login", (req, res) => {
  const ip = req.ip;
  if (tooManyLogins(ip)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: "ADMIN_PASSWORD is not set on the server" });
  const { password } = req.body || {};
  if (!password || !safeEq(password, process.env.ADMIN_PASSWORD)) {
    loginAttempts.set(ip, [...(loginAttempts.get(ip) || []), Date.now()]);
    return res.status(401).json({ error: "Wrong password" });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});
app.post("/admin/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/admin/api/session", (req, res) => res.json({ isAdmin: !!(req.session && req.session.isAdmin) }));

app.get("/admin/api/status", requireAdmin, adm(async (req, res) => {
  const out = {
    payment: { provider: PAYMENT_PROVIDER, ready: PAYMENT_PROVIDER === "stripe" ? stripe.configured() : true },
    cj: { configured: cj.configured(), sandbox: CJ_SANDBOX, payMode: CJ_PAY_MODE, fromCountry: CJ_FROM_COUNTRY,
          defaultLogistic: process.env.CJ_DEFAULT_LOGISTIC || null },
    cronToken: !!process.env.CRON_TOKEN,
    siteUrl: process.env.SITE_URL || null,
  };
  if (req.query.test === "1") {
    try {
      out.cj.balance = await cj.balance();
      out.cj.connected = true;
    } catch (e) {
      out.cj.connected = false;
      out.cj.error = e.message;
    }
  }
  res.json(out);
}));

// Products
app.get("/admin/api/products", requireAdmin, adm(async (req, res) => res.json(await loadProducts())));

app.post("/admin/api/products", requireAdmin, adm(async (req, res) => {
  const p = req.body || {};
  if (!p.id || !p.name || !p.price) return res.status(400).json({ error: "id, name and price are required" });
  const { error } = await supabase.from("products").insert({ id: p.id, ...productToRow(p) });
  if (error) {
    if (error.code === "23505") return res.status(409).json({ error: "A product with this id already exists" });
    throw error;
  }
  res.json({ ok: true });
}));

app.put("/admin/api/products/:id", requireAdmin, adm(async (req, res) => {
  const row = productToRow(req.body || {});
  if (!Object.keys(row).length) return res.status(400).json({ error: "Nothing to update" });
  const { error } = await supabase.from("products").update(row).eq("id", req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

app.delete("/admin/api/products/:id", requireAdmin, adm(async (req, res) => {
  const { error } = await supabase.from("products").delete().eq("id", req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

app.get("/admin/api/export", requireAdmin, adm(async (req, res) => {
  res.setHeader("Content-Disposition", "attachment; filename=products.json");
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(await loadProducts(), null, 2));
}));

// CJ catalog: search, inspect, import
app.get("/admin/api/cj/search", requireAdmin, adm(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "Enter a search term" });
  res.json(await cj.searchProducts({ q, page: req.query.page || 1, countryCode: req.query.country || undefined }));
}));

app.get("/admin/api/cj/product/:pid", requireAdmin, adm(async (req, res) => {
  res.json(await cj.getProduct(req.params.pid));
}));

app.post("/admin/api/cj/import", requireAdmin, adm(async (req, res) => {
  const { pid, vid, name, price, compareAt, category } = req.body || {};
  if (!pid || !vid || !price) return res.status(400).json({ error: "pid, vid and price are required" });
  const prod = await cj.getProduct(pid);
  const v = prod.variants.find((x) => x.vid === vid);
  if (!v) return res.status(400).json({ error: "Variant not found on CJ" });
  const plain = String(prod.description).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const lastCat = String(prod.category || "").split(/[/>]/).pop().trim();
  const row = {
    id: "p-" + crypto.randomBytes(4).toString("hex"),
    name: clip(name || prod.name, 120),
    category: category || lastCat || null,
    price: Number(price),
    compare_at: compareAt ? Number(compareAt) : null,
    spec: v.key ? { option: v.key } : {},
    image: v.image || prod.image,
    description: plain,
    cj_pid: prod.pid,
    cj_vid: v.vid,
    cj_sku: v.sku,
    cost: v.price,
  };
  const { error } = await supabase.from("products").insert(row);
  if (error) throw error;
  res.json({ ok: true, id: row.id });
}));

// Orders
app.get("/admin/api/orders", requireAdmin, adm(async (req, res) => {
  const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  res.json(data.map(rowToOrder));
}));

app.post("/admin/api/orders/:id/mark-paid", requireAdmin, adm(async (req, res) => {
  const r = await markPaidAndFulfill(req.params.id, { provider: "manual" });
  res.json({ ok: true, skipped: !!r.skipped });
}));

app.post("/admin/api/orders/:id/retry-cj", requireAdmin, adm(async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: "Order not found" });
  if (o.cjOrderId) return res.status(400).json({ error: "Already sent to CJ" });
  if (!["cj_error", "paid"].includes(o.status)) return res.status(400).json({ error: "Order is not paid yet" });
  const r = await fulfill(o.id);
  res.json({ ok: true, status: r.status, error: r.error });
}));

app.post("/admin/api/sync", requireAdmin, adm(async (req, res) => res.json(await syncOpenOrders(20))));

app.listen(PORT, () => console.log(`Roman running on port ${PORT}`));
