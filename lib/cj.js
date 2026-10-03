/**
 * Minimal CJ Dropshipping API 2.0 client (no dependencies, Node 18+ fetch).
 * Docs: https://developers.cjdropshipping.com/
 *
 * - Access token is obtained from CJ_API_KEY and cached in memory.
 * - Calls are throttled to ~1 request/second (CJ's documented QPS limit).
 */
const BASE = "https://developers.cjdropshipping.com/api2.0/v1";

let tokenCache = null; // { accessToken, expiresAt }
let lastCall = 0;
let chain = Promise.resolve();

class CjError extends Error {
  constructor(message, payload) {
    super(message);
    this.name = "CjError";
    this.payload = payload;
  }
}

function configured() {
  return !!process.env.CJ_API_KEY;
}

function throttle() {
  const run = chain.then(async () => {
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  chain = run.catch(() => {});
  return run;
}

async function rawFetch(path, { method = "GET", body, query, token } = {}) {
  await throttle();
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, String(v));
    }
  }
  const headers = { "Content-Type": "application/json" };
  if (token) headers["CJ-Access-Token"] = token;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    throw new CjError(`CJ returned a non-JSON response (HTTP ${res.status})`);
  }
  return json;
}

async function fetchToken() {
  if (!configured()) throw new CjError("CJ_API_KEY is not set on the server");
  const j = await rawFetch("/authentication/getAccessToken", {
    method: "POST",
    body: { apiKey: process.env.CJ_API_KEY },
  });
  if (!(j.code === 200 && j.result !== false) || !j.data) {
    throw new CjError("CJ authentication failed: " + (j.message || "unknown error"), j);
  }
  tokenCache = {
    accessToken: j.data.accessToken,
    expiresAt: Date.parse(j.data.accessTokenExpiryDate) || Date.now() + 12 * 3600 * 1000,
  };
  return tokenCache.accessToken;
}

async function getToken(force = false) {
  if (!force && tokenCache && tokenCache.expiresAt - Date.now() > 3600 * 1000) {
    return tokenCache.accessToken;
  }
  return fetchToken();
}

function isAuthError(j) {
  return (
    j &&
    j.result === false &&
    (j.code === 1600001 || j.code === 401 || /token/i.test(j.message || ""))
  );
}

async function call(path, opts = {}) {
  let token = await getToken();
  let j = await rawFetch(path, { ...opts, token });
  if (isAuthError(j)) {
    token = await getToken(true);
    j = await rawFetch(path, { ...opts, token });
  }
  if (!(j.code === 200 && j.result !== false)) {
    throw new CjError(j.message || `CJ error ${j.code}`, j);
  }
  return j.data;
}

// ---------- Products ----------
async function searchProducts({ q, page = 1, countryCode }) {
  const data = await call("/product/listV2", {
    query: { keyWord: q, page, size: 20, countryCode },
  });
  const list = (data.content || []).flatMap((c) => c.productList || []);
  return list.map((p) => ({
    pid: p.id,
    name: p.nameEn,
    image: p.bigImage,
    price: p.sellPrice,
    nowPrice: p.nowPrice,
    freeShipping: p.addMarkStatus === 1,
    stock: p.warehouseInventoryNum,
    delivery: p.deliveryCycle,
    category: p.threeCategoryName,
  }));
}

async function getProduct(pid) {
  const p = await call("/product/query", { query: { pid } });
  return {
    pid: p.pid,
    name: p.productNameEn,
    sku: p.productSku,
    image: p.bigImage,
    images: p.productImageSet || [],
    category: p.categoryName,
    description: p.description || "",
    variants: (p.variants || []).map((v) => ({
      vid: v.vid,
      sku: v.variantSku,
      name: v.variantNameEn,
      key: v.variantKey,
      price: Number(v.variantSellPrice),
      image: v.variantImage || v.image || "",
    })),
  };
}

// ---------- Shipping ----------
// Picks the cheapest available CJ shipping method. If the lookup fails, falls
// back to CJ_DEFAULT_LOGISTIC (e.g. "CJPacket Ordinary").
async function pickLogistic({ items, toCountry, fromCountry }) {
  try {
    const data = await call("/logistic/freightCalculate", {
      method: "POST",
      body: {
        startCountryCode: fromCountry,
        endCountryCode: toCountry,
        products: items.map((i) => ({ quantity: i.qty, vid: i.cjVid })),
      },
    });
    const opts = (Array.isArray(data) ? data : [])
      .map((o) => ({ name: o.logisticName, price: Number(o.logisticPrice ?? o.price) }))
      .filter((o) => o.name && Number.isFinite(o.price));
    if (opts.length) {
      opts.sort((a, b) => a.price - b.price);
      return opts[0];
    }
  } catch (e) {
    console.warn("CJ freight lookup failed:", e.message);
  }
  if (process.env.CJ_DEFAULT_LOGISTIC) {
    return { name: process.env.CJ_DEFAULT_LOGISTIC, price: null };
  }
  throw new CjError(
    "Could not choose a CJ shipping method. Set CJ_DEFAULT_LOGISTIC (e.g. CJPacket Ordinary) in Render."
  );
}

// ---------- Orders ----------
async function createOrder(body) {
  return call("/shopping/order/createOrderV2", { method: "POST", body });
}

async function orderDetail(cjOrderId) {
  return call("/shopping/order/getOrderDetail", { query: { orderId: cjOrderId } });
}

async function balance() {
  return call("/shopping/pay/getBalance");
}

module.exports = {
  configured,
  searchProducts,
  getProduct,
  pickLogistic,
  createOrder,
  orderDetail,
  balance,
  CjError,
};
