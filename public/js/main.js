// ---------- Store settings (edit the email here — it updates every page) ----------
const STORE_EMAIL = "support@example.com";

// ---------- Helpers ----------
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) { return "$" + Number(n).toFixed(2); }
function qs(name) { return new URLSearchParams(window.location.search).get(name); }

// ---------- Cart (localStorage) ----------
function getCart() {
  try { return JSON.parse(localStorage.getItem("tk_cart") || "[]"); } catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem("tk_cart", JSON.stringify(cart));
  updateCartCount();
}
function addToCart(id, qty) {
  const cart = getCart();
  const existing = cart.find((i) => i.id === id);
  if (existing) existing.qty += qty; else cart.push({ id, qty });
  saveCart(cart);
}
function removeFromCart(id) { saveCart(getCart().filter((i) => i.id !== id)); }
function updateCartCount() {
  const el = document.getElementById("cart-count");
  if (el) el.textContent = getCart().reduce((sum, i) => sum + i.qty, 0);
}

async function fetchProducts() { return (await fetch("/api/products")).json(); }
async function fetchProduct(id) {
  const res = await fetch("/api/products/" + encodeURIComponent(id));
  return res.ok ? res.json() : null;
}

function priceRow(p) {
  const compare = p.compareAt && p.compareAt > p.price ? `<span class="compare">${money(p.compareAt)}</span>` : "";
  return `<span class="price">${money(p.price)}</span>${compare}`;
}
function slugify(s) {
  return String(s || "uncategorized").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "uncategorized";
}

// ---------- Shared product cache (used by header categories + catalog) ----------
let _productsPromise = null;
function fetchProductsCached() {
  if (!_productsPromise) _productsPromise = fetchProducts();
  return _productsPromise;
}

function cardHtml(p) {
  return `
    <a class="card" href="/product.html?id=${encodeURIComponent(p.id)}">
      <div class="thumb"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div>
      <div class="category">${esc(p.category || "")}</div>
      <h3>${esc(p.name)}</h3>
      <div class="price-row">${priceRow(p)}</div>
    </a>`;
}

function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const name = p.category || "Other";
    const slug = slugify(name);
    if (!groups.has(slug)) groups.set(slug, { name, slug, items: [] });
    groups.get(slug).items.push(p);
  }
  return [...groups.values()];
}

// ---------- Home: catalog grouped by category, with search ----------
async function loadProductGrid() {
  const root = document.getElementById("product-grid");
  const countEl = document.getElementById("product-count");
  const products = await fetchProductsCached();
  if (!products.length) {
    root.innerHTML = `<div class="no-results">New products are coming soon.</div>`;
    countEl.textContent = "";
    return;
  }
  const applyFilter = () => {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get("q") || "").trim().toLowerCase();
    const searchInput = document.getElementById("search-input");
    if (searchInput && document.activeElement !== searchInput) searchInput.value = q;

    const filtered = q ? products.filter((p) => p.name.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q)) : products;
    countEl.textContent = filtered.length + (filtered.length === 1 ? " item" : " items") + (q ? ` for “${q}”` : "");

    if (!filtered.length) {
      root.innerHTML = `<div class="no-results">No products match “${esc(q)}”. <a href="/">Clear search</a></div>`;
      return;
    }
    const groups = groupByCategory(filtered);
    root.innerHTML = groups.map((g) => `
      <section class="category-section" id="cat-${g.slug}">
        <h2>${esc(g.name)}</h2>
        <span class="cat-count">${g.items.length} ${g.items.length === 1 ? "item" : "items"}</span>
        <div class="grid">${g.items.map(cardHtml).join("")}</div>
      </section>`).join("");

    if (!q && window.location.hash) {
      const el = document.querySelector(window.location.hash);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };
  applyFilter();
  window.addEventListener("popstate", applyFilter);
  return applyFilter;
}

// ---------- Product page ----------
async function loadProductDetail() {
  const container = document.getElementById("product-detail");
  const product = await fetchProduct(qs("id"));
  if (!product) {
    container.innerHTML = `<div class="empty-state">Product not found. <a href="/">Back to catalog</a></div>`;
    return;
  }
  document.title = "Roman — " + product.name;
  const specs = Object.entries(product.spec || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  container.innerHTML = `
    <div class="product-image"><img src="${esc(product.image)}" alt="${esc(product.name)}"></div>
    <div class="product-info">
      <div class="category">${esc(product.category || "")}</div>
      <h1>${esc(product.name)}</h1>
      <p class="desc">${esc(product.description || "")}</p>
      ${specs ? `<table class="spec-table">${specs}</table>` : ""}
      <div class="qty-row">
        <div class="qty-control">
          <button type="button" id="qty-minus">−</button>
          <input id="qty-input" type="text" value="1" readonly>
          <button type="button" id="qty-plus">+</button>
        </div>
        <span>${priceRow(product)}</span>
      </div>
      <p style="font-size:14px;color:#6B6F6B;margin:0 0 16px;">Free shipping · arrives in 7–12 days</p>
      <button class="btn" style="width:100%;" id="add-btn">Add to cart</button>
    </div>`;
  const input = document.getElementById("qty-input");
  const step = (d) => { input.value = Math.min(20, Math.max(1, parseInt(input.value, 10) + d)); };
  document.getElementById("qty-minus").onclick = () => step(-1);
  document.getElementById("qty-plus").onclick = () => step(1);
  document.getElementById("add-btn").onclick = () => {
    addToCart(product.id, parseInt(input.value, 10));
    location.href = "/cart.html";
  };
}

// ---------- Cart page ----------
async function renderCartPage() {
  const panel = document.getElementById("cart-panel");
  const cart = getCart();
  if (!cart.length) {
    panel.innerHTML = `<div class="empty-state">Your cart is empty. <a href="/">Browse the catalog</a></div>`;
    return;
  }
  const products = await fetchProducts();
  let subtotal = 0;
  const rows = cart.map((item) => {
    const p = products.find((x) => x.id === item.id);
    if (!p) return "";
    subtotal += p.price * item.qty;
    return `
      <div class="cart-row">
        <img src="${esc(p.image)}" alt="${esc(p.name)}">
        <div><strong>${esc(p.name)}</strong><div style="font-size:13px;color:#6B6F6B;">Qty ${item.qty}</div></div>
        <span>${money(p.price * item.qty)}</span>
        <button class="btn secondary" style="padding:6px 12px;font-size:13px;" data-remove="${esc(p.id)}">Remove</button>
      </div>`;
  }).join("");
  panel.innerHTML = `
    ${rows}
    <div class="cart-totals"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="cart-totals"><span>Shipping</span><span>Free</span></div>
    <div class="cart-totals total"><span>Total</span><span>${money(subtotal)}</span></div>
    <a href="/checkout.html" class="btn" style="width:100%; text-align:center; display:block; margin-top:20px;">Proceed to checkout</a>`;
  panel.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => { removeFromCart(b.dataset.remove); renderCartPage(); };
  });
}

// ---------- Checkout ----------
async function renderCheckoutSummary() {
  const panel = document.getElementById("checkout-summary");
  if (!panel) return;
  const cart = getCart();
  if (!cart.length) { panel.innerHTML = `<div class="empty-state">Your cart is empty.</div>`; return; }
  const products = await fetchProducts();
  let subtotal = 0;
  const rows = cart.map((item) => {
    const p = products.find((x) => x.id === item.id);
    if (!p) return "";
    subtotal += p.price * item.qty;
    return `<div class="cart-totals"><span>${esc(p.name)} × ${item.qty}</span><span>${money(p.price * item.qty)}</span></div>`;
  }).join("");
  panel.innerHTML = `
    <h3 style="margin-bottom:16px;">Order summary</h3>
    ${rows}
    <div class="cart-totals"><span>Shipping</span><span>Free</span></div>
    <div class="cart-totals total"><span>Total</span><span>${money(subtotal)}</span></div>`;
}

async function handleCheckoutSubmit() {
  const form = document.getElementById("checkout-form");
  if (!form) return;
  const select = document.getElementById("country-select");
  try {
    const cfg = await (await fetch("/api/config")).json();
    select.innerHTML = `<option value="">Select country</option>` +
      cfg.countries.map((c) => `<option value="${esc(c.code)}">${esc(c.name)}</option>`).join("");
    const btn = document.getElementById("pay-btn");
    if (cfg.payment === "stripe") btn.textContent = "Continue to secure payment";
    else btn.textContent = "Place order";
  } catch { /* leave select empty; submit will report */ }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("pay-btn");
    const errEl = document.getElementById("checkout-error");
    errEl.style.display = "none";
    const d = Object.fromEntries(new FormData(form).entries());
    const payload = {
      cart: getCart(),
      customer: {
        name: `${d.firstName} ${d.lastName}`.trim(),
        email: d.email,
        address: { street: d.street, street2: d.street2, city: d.city, state: d.state, zip: d.zip, country: d.country, phone: d.phone },
      },
    };
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = "Please wait…";
    try {
      const res = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await res.json();
      if (res.ok && result.redirectUrl) { window.location.href = result.redirectUrl; return; }
      throw new Error(result.error || "Something went wrong. Please try again.");
    } catch (err) {
      errEl.textContent = err.message;
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = old;
    }
  });
}

// ---------- Shared footer + contact email ----------
// ---------- Shared header (search + category nav) ----------
async function renderHeader() {
  const mount = document.getElementById("site-header");
  if (!mount) return;
  const onHome = location.pathname === "/" || location.pathname.endsWith("/index.html");

  mount.innerHTML = `
    <div class="announce">Free worldwide shipping · <strong>Secure checkout</strong> · 14-day returns</div>
    <header class="site-header">
      <div class="wrap top-row">
        <a href="/" class="brand">Roman</a>
        <form class="search-box" id="site-search-form" role="search">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="search-input" type="search" name="q" placeholder="Search products…" autocomplete="off">
        </form>
        <div class="header-right">
          <a href="/cart.html" class="cart-pill">Cart <span id="cart-count">0</span></a>
        </div>
      </div>
      <div class="wrap"><nav class="cat-nav" id="cat-nav"><a href="/#catalog">All</a></nav></div>
    </header>`;
  updateCartCount();

  const form = document.getElementById("site-search-form");
  const input = document.getElementById("search-input");
  const params = new URLSearchParams(location.search);
  if (params.get("q")) input.value = params.get("q");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (onHome) {
      const url = q ? `/?q=${encodeURIComponent(q)}` : "/";
      history.pushState({}, "", url);
      if (window._applyCatalogFilter) window._applyCatalogFilter();
      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
    } else {
      location.href = q ? `/?q=${encodeURIComponent(q)}` : "/";
    }
  });
  if (onHome) {
    input.addEventListener("input", () => {
      const q = input.value.trim();
      const url = q ? `/?q=${encodeURIComponent(q)}` : "/";
      history.replaceState({}, "", url);
      if (window._applyCatalogFilter) window._applyCatalogFilter();
    });
  }

  try {
    const products = await fetchProductsCached();
    const cats = groupByCategory(products).sort((a, b) => b.items.length - a.items.length);
    const nav = document.getElementById("cat-nav");
    nav.innerHTML = `<a href="/#catalog">All</a>` + cats.map((c) =>
      `<a href="/#cat-${c.slug}">${esc(c.name)} (${c.items.length})</a>`).join("");
  } catch { /* category nav is a nice-to-have; search still works without it */ }
}

document.addEventListener("DOMContentLoaded", () => {
  renderHeader();

  const footerWrap = document.querySelector("footer .wrap");
  if (footerWrap) {
    footerWrap.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px 24px;margin-bottom:10px;">
        <a href="/shipping.html">Shipping</a>
        <a href="/returns.html">Returns &amp; Refunds</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
        <a href="/contact.html">Contact</a>
      </div>
      <div>© Roman. Orders ship from our fulfillment partner within 1–3 business days; delivery typically 7–12 days.</div>`;
  }
  document.querySelectorAll("[data-email]").forEach((el) => {
    el.innerHTML = `<a href="mailto:${STORE_EMAIL}" style="text-decoration:underline;">${STORE_EMAIL}</a>`;
  });
  updateCartCount();
});
