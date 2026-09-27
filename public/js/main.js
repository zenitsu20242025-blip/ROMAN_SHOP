// ---------- Cart storage (localStorage) ----------
function getCart() {
  return JSON.parse(localStorage.getItem("tk_cart") || "[]");
}
function saveCart(cart) {
  localStorage.setItem("tk_cart", JSON.stringify(cart));
  updateCartCount();
}
function addToCart(id, qty) {
  const cart = getCart();
  const existing = cart.find((i) => i.id === id);
  if (existing) existing.qty += qty;
  else cart.push({ id, qty });
  saveCart(cart);
}
function removeFromCart(id) {
  saveCart(getCart().filter((i) => i.id !== id));
}
function updateCartCount() {
  const el = document.getElementById("cart-count");
  if (!el) return;
  const count = getCart().reduce((sum, i) => sum + i.qty, 0);
  el.textContent = count;
}

// ---------- Helpers ----------
function money(n) { return "$" + n.toFixed(2); }
function qs(name) { return new URLSearchParams(window.location.search).get(name); }

async function fetchProducts() {
  const res = await fetch("/api/products");
  return res.json();
}
async function fetchProduct(id) {
  const res = await fetch("/api/products/" + id);
  if (!res.ok) return null;
  return res.json();
}

// ---------- Home page grid ----------
async function loadProductGrid() {
  const grid = document.getElementById("product-grid");
  const countEl = document.getElementById("product-count");
  const products = await fetchProducts();
  countEl.textContent = products.length + " items";
  grid.innerHTML = products.map((p) => `
    <a class="card" href="/product.html?id=${p.id}">
      <div class="thumb"><img src="${p.image}" alt="${p.name}"></div>
      <div class="category">${p.category}</div>
      <h3>${p.name}</h3>
      <div class="price-row">
        <span class="price">${money(p.price)}</span>
        <span class="compare">${money(p.compareAt)}</span>
      </div>
      <div class="spec-strip">
        ${Object.entries(p.spec).slice(0, 2).map(([k, v]) => `<span>${v}</span>`).join("")}
      </div>
    </a>
  `).join("");
}

// ---------- Product detail page ----------
async function loadProductDetail() {
  const id = qs("id");
  const container = document.getElementById("product-detail");
  const product = await fetchProduct(id);
  if (!product) {
    container.innerHTML = `<div class="empty-state">Product not found. <a href="/">Back to catalog</a></div>`;
    return;
  }
  container.innerHTML = `
    <div class="product-image"><img src="${product.image}" alt="${product.name}"></div>
    <div class="product-info">
      <div class="category">${product.category}</div>
      <h1>${product.name}</h1>
      <p class="desc">${product.description}</p>
      <table class="spec-table">
        ${Object.entries(product.spec).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
      </table>
      <div class="qty-row">
        <div class="qty-control">
          <button type="button" onclick="stepQty(-1)">−</button>
          <input id="qty-input" type="text" value="1" readonly>
          <button type="button" onclick="stepQty(1)">+</button>
        </div>
        <span class="price" style="font-size:22px;">${money(product.price)}</span>
      </div>
      <button class="btn" style="width:100%;" onclick="addToCart('${product.id}', getQty()); location.href='/cart.html';">
        Add to cart
      </button>
    </div>
  `;
}
function getQty() { return parseInt(document.getElementById("qty-input").value, 10); }
function stepQty(delta) {
  const input = document.getElementById("qty-input");
  input.value = Math.max(1, parseInt(input.value, 10) + delta);
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
    const p = products.find((prod) => prod.id === item.id);
    if (!p) return "";
    subtotal += p.price * item.qty;
    return `
      <div class="cart-row">
        <img src="${p.image}" alt="${p.name}">
        <div><strong>${p.name}</strong><div style="font-size:13px;color:#6B6F6B;">Qty ${item.qty}</div></div>
        <span>${money(p.price * item.qty)}</span>
        <button class="btn secondary" style="padding:6px 12px;font-size:13px;" onclick="removeFromCart('${p.id}'); renderCartPage();">Remove</button>
      </div>
    `;
  }).join("");

  panel.innerHTML = `
    ${rows}
    <div class="cart-totals"><span>Subtotal</span><span>${money(subtotal)}</span></div>
    <div class="cart-totals"><span>Shipping</span><span>Calculated at checkout</span></div>
    <div class="cart-totals total"><span>Estimated total</span><span>${money(subtotal)}</span></div>
    <a href="/checkout.html" class="btn" style="width:100%; text-align:center; display:block; margin-top:20px;">Proceed to checkout</a>
  `;
}

// ---------- Checkout summary ----------
async function renderCheckoutSummary() {
  const panel = document.getElementById("checkout-summary");
  if (!panel) return;
  const cart = getCart();
  if (!cart.length) {
    panel.innerHTML = `<div class="empty-state">Your cart is empty.</div>`;
    return;
  }
  const products = await fetchProducts();
  let subtotal = 0;
  const rows = cart.map((item) => {
    const p = products.find((prod) => prod.id === item.id);
    subtotal += p.price * item.qty;
    return `<div class="cart-totals"><span>${p.name} × ${item.qty}</span><span>${money(p.price * item.qty)}</span></div>`;
  }).join("");
  panel.innerHTML = `
    <h3 style="margin-bottom:16px;">Order summary</h3>
    ${rows}
    <div class="cart-totals total"><span>Total</span><span>${money(subtotal)}</span></div>
  `;
}

// ---------- Checkout submit ----------
function handleCheckoutSubmit() {
  const form = document.getElementById("checkout-form");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const customer = {
      email: data.email,
      name: `${data.firstName} ${data.lastName}`,
      address: {
        street: data.street,
        city: data.city,
        zip: data.zip,
        country: data.country,
        phone: data.phone,
      },
    };
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cart: getCart(), customer }),
    });
    const result = await res.json();
    if (result.ok) {
      localStorage.removeItem("tk_cart");
      window.location.href = "/confirmation.html?order=" + result.order.id;
    } else {
      alert(result.error || "Something went wrong. Please try again.");
    }
  });
}
