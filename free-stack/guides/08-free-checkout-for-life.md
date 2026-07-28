# 08. Free Checkout for Life

**Time: 90 minutes. Cost: $0 plus Stripe's own processing fee. Code: copy and paste.**

Take real payments. No monthly platform fee on top of what Stripe already charges.

Read this whole guide once before typing anything. It touches real money, and the webhook verification step matters more than anywhere else in this library.

---

## What you get

A "Buy Now" link that sends customers to a real, secure, Stripe-hosted checkout page, and an orders list you own showing every sale, synced automatically the moment payment clears.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Shopify | $39 to $399 per month | On top of card processing fees |
| Samcart | $59 to $319 per month | Page-view limits on lower tiers |
| Squarespace Commerce | $23 to $65 per month | Locked to their page builder |

Every one of these charges you a platform fee in addition to what Stripe or their processor already takes for moving the money. This guide removes the platform fee. Stripe's own cut stays, because someone has to actually move the money, and that part is never free anywhere.

---

## What is actually free and what is not

The checkout system itself: free, forever, no platform fee.

**Not free:** Stripe's processing fee, currently 2.9% plus 30 cents per successful US card transaction. That is not a rented tool, it is the cost of accepting a card at all, and every option on the market pays some version of it underneath. Verify the current rate on Stripe's own pricing page before you launch, rates can change.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- A Stripe account. Free to create at `https://dashboard.stripe.com/register`. No monthly fee, ever, they only make money when you do.

---

## The shape of what you are building

```
  Customer clicks "Buy Now"
                |
                v
  Your Worker creates a Checkout Session
  (a server-to-server call to Stripe, using your secret key)
                |
                v
  Customer is redirected to a page Stripe hosts and secures
                |
                |  card entered, payment succeeds
                v
  Stripe sends your Worker a webhook: "this session paid"
                |
                |  your Worker VERIFIES this really came from Stripe
                v
  Order saved to your D1 database
```

Two separate things happen after a sale: the customer's browser gets redirected to your thank-you page, and, independently, Stripe's servers call your webhook. Never trust the browser redirect alone to mean payment succeeded. Someone could hit that URL directly without paying. The webhook, verified, is the only proof that counts.

---

## Step 1. Get your Stripe keys

In the Stripe Dashboard, make sure you are in **Test mode** (toggle, usually top right). Go to **Developers** → **API keys**.

Copy two values:
- **Publishable key** (starts `pk_test_`), not used in this guide but you will see it referenced elsewhere
- **Secret key** (starts `sk_test_`), click reveal, copy it

Never put the secret key in any file that gets committed to a repository. It goes into a Wrangler secret, same as your admin password.

## Step 2. Store the secret key

In your `my-website` folder:

```
npx wrangler secret put STRIPE_SECRET_KEY
```

Paste the `sk_test_...` value when prompted.

## Step 3. Add the products table and orders table

Create `schema-checkout.sql`:

```sql
CREATE TABLE IF NOT EXISTS orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_session_id TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  item_key          TEXT,
  email             TEXT,
  amount_cents      INTEGER,
  status            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_session ON orders (stripe_session_id);
```

Run it:

```
npx wrangler d1 execute leads --remote --file=./schema-checkout.sql
```

> **Why `stripe_session_id` has a unique index.** Stripe can, and occasionally does, send the same webhook event more than once. The unique index plus `INSERT OR IGNORE` later means a duplicate delivery cannot create a duplicate order. This is not a hypothetical, it is a documented behavior you should design for from day one.

## Step 4. Add the routes

Open `src/index.js`. Add these above the `/admin/leads.csv` check:

```js
    if (url.pathname === "/buy") {
      return startCheckout(url, env);
    }

    if (url.pathname === "/webhook/stripe" && request.method === "POST") {
      return stripeWebhook(request, env);
    }

    if (url.pathname === "/admin/orders" && request.method === "GET") {
      return ordersPage(request, env);
    }

```

## Step 5. Add your product

At the top of the file, add:

```js
// ---------------------------------------------------------------
// Checkout (guide 08)
// ---------------------------------------------------------------

const PRODUCTS = {
  widget: {
    name: "Your Product Name",
    description: "One honest sentence about what they get.",
    cents: 4900
  }
};
```

Price is in cents. `4900` is $49.00. Add more keys for more products.

## Step 6. Add the Stripe request helpers

At the bottom of the file:

```js
async function stripeRequest(env, method, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      "Authorization": "Basic " + btoa(env.STRIPE_SECRET_KEY + ":"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body ? toFormBody(body).toString() : undefined
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Stripe request failed");
  return data;
}

// Stripe's API takes form-encoded bodies with bracket notation for
// nested data, like line_items[0][price_data][currency]=usd. This
// turns a normal JS object into that format.
function toFormBody(obj) {
  const params = new URLSearchParams();
  function add(key, value) {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => add(`${key}[${i}]`, v));
    } else if (typeof value === "object") {
      for (const k in value) add(`${key}[${k}]`, value[k]);
    } else {
      params.append(key, value);
    }
  }
  for (const k in obj) add(k, obj[k]);
  return params;
}
```

## Step 7. Start a checkout

Still in the same section:

```js
async function startCheckout(url, env) {
  const key = url.searchParams.get("item");
  const product = PRODUCTS[key];
  if (!product) return new Response("Unknown item.", { status: 404 });

  const origin = url.origin;

  const session = await stripeRequest(env, "POST", "/checkout/sessions", {
    mode: "payment",
    success_url: `${origin}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: product.cents,
        product_data: { name: product.name, description: product.description }
      }
    }],
    metadata: { item_key: key }
  });

  return Response.redirect(session.url, 303);
}
```

`{CHECKOUT_SESSION_ID}` is not a typo and not a variable you fill in. Stripe replaces that literal text with the real session ID when it redirects the customer back. Leave it exactly as written.

## Step 8. Verify the webhook, carefully

This is the step that matters most. Add it exactly as written.

```js
async function stripeWebhook(request, env) {
  const rawBody = await request.text();
  const sigHeader = request.headers.get("Stripe-Signature") || "";

  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(rawBody);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO orders
       (stripe_session_id, created_at, item_key, email, amount_cents, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
      session.id,
      new Date().toISOString(),
      session.metadata?.item_key || "",
      session.customer_details?.email || "",
      session.amount_total || 0,
      "paid"
    ).run();
  }

  return new Response("ok");
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(sigHeader.split(",").map(p => p.split("=")));
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  // Reject anything older than 5 minutes. Stops a captured request
  // from being replayed later.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) return false;

  const signedPayload = `${timestamp}.${rawBody}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const computedSig = [...new Uint8Array(sigBuffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(computedSig, expectedSig);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
```

> **Why this cannot be skipped or simplified.** Without signature verification, anyone who finds your webhook URL can POST a fake "payment succeeded" event and your system will believe them. This is not a theoretical attack, it is the first thing anyone probing a checkout endpoint tries. The verification above confirms the request was signed by Stripe, using a secret only you and Stripe know, within the last five minutes.

## Step 9. Add the orders admin page

```js
async function ordersPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`
  ).all();

  const rows = results.map(r => `
    <tr>
      <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
      <td>${esc(r.item_key)}</td>
      <td>${esc(r.email)}</td>
      <td>$${(r.amount_cents / 100).toFixed(2)}</td>
      <td>${esc(r.status)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Orders</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 16px; }
  th, td { border-bottom: 1px solid #e4e7ec; padding: 8px; text-align: left; }
  th { background: #f7f8fa; }
</style></head><body>
  <h1>Orders (${results.length})</h1>
  <table>
    <tr><th>When</th><th>Item</th><th>Email</th><th>Amount</th><th>Status</th></tr>
    ${rows}
  </table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

This reuses `authOk()` and `esc()` from guide 03.

## Step 10. Add the buy link and a thank-you page

Add a button somewhere on your site:

```html
<a class="btn" href="/buy?item=widget">Buy now, $49</a>
```

Create `public/thank-you.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Thank you</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="wrap">
    <div class="hero">
      <h1>Thank you.</h1>
      <p>Your order is confirmed. Check your email for a receipt from Stripe.</p>
    </div>
  </main>
</body>
</html>
```

## Step 11. Deploy

```
npx wrangler deploy
```

## Step 12. Register the webhook in Stripe

1. Stripe Dashboard, still in **Test mode**, go to **Developers** → **Webhooks**.
2. Click **Add endpoint**.
3. Endpoint URL: `https://yourbusiness.com/webhook/stripe`
4. Click **Select events**, choose `checkout.session.completed`, save.
5. Click into the endpoint you just created. Click **Reveal** next to Signing secret. Copy the value, it starts with `whsec_`.

## Step 13. Store the webhook secret

```
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Paste the `whsec_...` value.

## Step 14. Test it for real, with fake money

Go to `https://yourbusiness.com/buy?item=widget`. You should land on a real Stripe checkout page.

Use Stripe's test card: card number `4242 4242 4242 4242`, any future expiry date, any 3-digit CVC, any ZIP.

Complete the payment. You should land on your thank-you page. Then check `https://yourbusiness.com/admin/orders`. The order should be there within a few seconds.

---

## Verify it works

- [ ] `/buy?item=widget` redirects to a real Stripe checkout page
- [ ] A test card payment completes and lands on `/thank-you`
- [ ] The order appears at `/admin/orders` within a few seconds
- [ ] `/buy?item=nonsense` returns "Unknown item" instead of a broken page
- [ ] Posting a fake, unsigned request to `/webhook/stripe` gets rejected with "Invalid signature", not a 500 error

That last check matters. Try it:

```
curl -X POST https://yourbusiness.com/webhook/stripe -d '{"type":"checkout.session.completed"}'
```

This should return `Invalid signature`, not create an order.

---

## What breaks and how to fix it

**Checkout button leads to a Stripe error page instead of a payment form**
Almost always a missing or malformed `STRIPE_SECRET_KEY`. Run `npx wrangler secret put STRIPE_SECRET_KEY` again and re-paste it, making sure there is no extra whitespace.

**Payment completes on Stripe's page but no order shows up in `/admin/orders`**
The webhook is not reaching you. In the Stripe Dashboard, go to your webhook endpoint and check the "recent deliveries" log. A non-200 response there tells you exactly what your Worker returned. Most common cause: the webhook secret stored via Wrangler does not match the one shown in the Stripe Dashboard for that specific endpoint.

**Every webhook fails with "Invalid signature"**
Check three things in order: the webhook secret matches the exact endpoint you registered, you are reading `request.text()` before doing anything else with the request body, and you are not accidentally running this behind any code that reads or modifies the body first.

**Test payments work, but you are worried about accidentally taking a real payment while testing**
As long as you are using `sk_test_` and `whsec_` values from Test mode, no real card can be charged. Stripe test mode and live mode are fully separate systems, including separate webhook secrets. Do not switch to live keys until you are ready to actually sell something.

**An order appears twice**
This should not happen because of the unique index from step 3. If it does, check that `schema-checkout.sql` was actually run with `--remote` and that the unique index exists: `npx wrangler d1 execute leads --remote --command="SELECT sql FROM sqlite_master WHERE name='idx_orders_session'"`.

**"Unknown item" on a key you know you added**
The `?item=` value in the URL must match a key in `PRODUCTS` exactly, case included.

---

## Before you take a real payment

Switch `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to their live-mode equivalents (toggle Stripe out of Test mode, repeat steps 1 through 13 with the live values), and register a second webhook endpoint for live mode, since test and live secrets are never interchangeable.

---

## What to do next

Go to **11. Free Order Emails for Life**. Right now a customer's only proof of purchase is Stripe's own receipt. This adds one from you.

---

## Sources to verify yourself

- Checkout Sessions API: `https://docs.stripe.com/api/checkout/sessions/create`
- Webhook signature verification: `https://docs.stripe.com/webhooks/signature`
- Current processing rates: `https://stripe.com/pricing`
