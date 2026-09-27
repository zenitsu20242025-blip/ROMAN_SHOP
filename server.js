/**
 * Roman storefront backend — Supabase-backed storage.
 *
 * Products and orders both live in Supabase (Postgres), not on Render's disk,
 * so nothing is lost on restart, redeploy, or a free-tier reset. See README.md
 * for the one-time Supabase project + table setup.
 */

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.use(cors());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 hour admin session
  })
);
app.use(express.static(path.join(__dirname, "public")));

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Not authenticated" });
}

// ---------- Supabase <-> app-shape mapping ----------
function rowToProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    compareAt: row.compare_at !== null ? Number(row.compare_at) : undefined,
    spec: row.spec || {},
    image: row.image,
    description: row.description,
    cjSku: row.cj_sku,
    stock: row.stock,
  };
}

function productToRow(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    price: p.price,
    compare_at: p.compareAt ?? null,
    spec: p.spec ?? {},
    image: p.image,
    description: p.description,
    cj_sku: p.cjSku,
    stock: p.stock ?? null,
  };
}

function rowToOrder(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    customer: row.customer,
    lineItems: row.line_items,
    total: Number(row.total),
  };
}

async function loadProducts() {
  const { data, error } = await supabase.from("products").select("*").order("name");
  if (error) throw error;
  return data.map(rowToProduct);
}

async function loadOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data.map(rowToOrder);
}

async function saveOrder(order) {
  const { error } = await supabase.from("orders").insert({
    id: order.id,
    created_at: order.createdAt,
    status: order.status,
    customer: order.customer,
    line_items: order.lineItems,
    total: order.total,
  });
  if (error) throw error;
}

// ============ PUBLIC STOREFRONT API ============

app.get("/api/products", async (req, res) => {
  try {
    res.json(await loadProducts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const products = await loadProducts();
    const product = products.find((p) => p.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/checkout", async (req, res) => {
  try {
    const { cart, customer } = req.body;
    if (!cart || !cart.length) return res.status(400).json({ error: "Cart is empty" });
    if (!customer || !customer.email || !customer.address) {
      return res.status(400).json({ error: "Missing customer details" });
    }

    const products = await loadProducts();
    let total = 0;
    const lineItems = cart.map((item) => {
      const product = products.find((p) => p.id === item.id);
      if (!product) throw new Error(`Unknown product: ${item.id}`);
      total += product.price * item.qty;
      return { ...item, price: product.price, cjSku: product.cjSku };
    });

    const order = {
      id: "ord_" + Date.now(),
      createdAt: new Date().toISOString(),
      status: "pending_payment",
      customer,
      lineItems,
      total: Number(total.toFixed(2)),
    };

    // --- PAYMENT GATEWAY EXTENSION POINT (2Checkout / Verifone or Payoneer Checkout) ---
    // Once approved, call the gateway's SDK here with process.env.PAYMENT_API_KEY
    // and only mark the order "paid" after it confirms the charge.
    if (!process.env.PAYMENT_API_KEY) {
      order.status = "awaiting_manual_review";
    }
    // --- END PAYMENT EXTENSION POINT ---

    await saveOrder(order);

    // --- CJ DROPSHIPPING EXTENSION POINT ---
    // After payment is confirmed, call CJ's Create Order endpoint with
    // process.env.CJ_API_KEY, customer.address, and each lineItem.cjSku.
    // --- END CJ EXTENSION POINT ---

    res.json({ ok: true, order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const orders = await loadOrders();
    const order = orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ ADMIN ============

app.post("/admin/api/login", (req, res) => {
  const { password } = req.body;
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "ADMIN_PASSWORD is not set on the server" });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }
  req.session.isAdmin = true;
  res.json({ ok: true });
});

app.post("/admin/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/admin/api/session", (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

app.get("/admin/api/products", requireAdmin, async (req, res) => {
  try {
    res.json(await loadProducts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/api/products", requireAdmin, async (req, res) => {
  try {
    const p = req.body;
    if (!p.id || !p.name || !p.price) {
      return res.status(400).json({ error: "id, name and price are required" });
    }
    const { error } = await supabase.from("products").insert(productToRow(p));
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "A product with this id already exists" });
      throw error;
    }
    res.json({ ok: true, product: p });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase
      .from("products")
      .update(productToRow({ ...req.body, id: req.params.id }))
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/api/products/:id", requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from("products").delete().eq("id", req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /admin/api/export — download the current catalog as JSON (for backup)
app.get("/admin/api/export", requireAdmin, async (req, res) => {
  try {
    const products = await loadProducts();
    res.setHeader("Content-Disposition", "attachment; filename=products.json");
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(products, null, 2));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/api/orders", requireAdmin, async (req, res) => {
  try {
    res.json(await loadOrders());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Roman running on port ${PORT}`);
});
