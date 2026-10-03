/**
 * Stripe Checkout (hosted page) — no SDK, just fetch + crypto.
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 * Webhook endpoint to register in Stripe: https://YOUR-SITE/api/webhooks/stripe
 * Event to send: checkout.session.completed
 */
const crypto = require("crypto");

function configured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_WEBHOOK_SECRET;
}

async function createSession({ order, lineItems, successUrl, cancelUrl }) {
  const p = new URLSearchParams();
  p.append("mode", "payment");
  p.append("success_url", successUrl);
  p.append("cancel_url", cancelUrl);
  p.append("customer_email", order.customer.email);
  p.append("client_reference_id", order.id);
  p.append("metadata[order_id]", order.id);
  lineItems.forEach((li, i) => {
    p.append(`line_items[${i}][quantity]`, String(li.qty));
    p.append(`line_items[${i}][price_data][currency]`, "usd");
    p.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(li.price * 100)));
    p.append(`line_items[${i}][price_data][product_data][name]`, li.name);
    if (li.image && /^https:\/\//.test(li.image)) {
      p.append(`line_items[${i}][price_data][product_data][images][0]`, li.image);
    }
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: p,
  });
  const j = await res.json();
  if (!res.ok) throw new Error("Stripe: " + (j.error && j.error.message ? j.error.message : res.status));
  return { url: j.url, ref: j.id };
}

// Returns the parsed event if the signature is valid, otherwise throws.
function verifyWebhook(rawBody, sigHeader) {
  if (!sigHeader || !rawBody) throw new Error("Missing signature");
  const parts = Object.fromEntries(
    sigHeader.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const t = parts.t;
  const sigs = sigHeader
    .split(",")
    .filter((s) => s.startsWith("v1="))
    .map((s) => s.slice(3));
  if (!t || !sigs.length) throw new Error("Bad signature header");
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) throw new Error("Signature timestamp too old");
  const expected = crypto
    .createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${rawBody.toString("utf8")}`)
    .digest("hex");
  const ok = sigs.some((s) => {
    const a = Buffer.from(s);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw new Error("Invalid signature");
  return JSON.parse(rawBody.toString("utf8"));
}

module.exports = { configured, createSession, verifyWebhook };
