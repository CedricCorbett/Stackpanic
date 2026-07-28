# 11. Free Order Emails for Life

**Time: 30 minutes. Cost: $0. Code: copy and paste.**

Right now, Stripe sends its own receipt. This adds one from you, automatically, the second payment clears.

---

## What you get

A confirmation email that goes out the moment a sale completes, no clicking send, no remembering to do it, using the same webhook you already built in guide 08.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Klaviyo | $20 to $60 per month | Priced by contact count |
| Shopify Email | Free tier, then paid | Tied to Shopify specifically |
| Mailchimp Transactional (Mandrill) | $20 minimum | Separate product from their main plan |

---

## What is actually free and what is not

Free. This reuses the Brevo account from guide 01, inside its 300-email-per-day free tier. An order confirmation email is one email per sale, so this ceiling only becomes real at real volume.

---

## Prerequisites

- Guide 00 complete
- Guide 01 complete, Part B ideally, since your domain is already verified with Brevo from that step
- Guide 08 complete, with a working webhook and at least one successful test order

---

## Step 1. Get a Brevo API key

This is a different credential from the SMTP key you used in guide 01. Do not reuse that one, it will not work here.

1. Log in to Brevo, go to **SMTP & API** → **API Keys**.
2. Click **Generate a new API key**. Name it something like `order-emails`.
3. Copy it. It is shown once.

> **Why two different keys for the same account.** The SMTP key authenticates your Gmail "send as" connection, a mail client speaking the SMTP protocol. The API key authenticates direct HTTP calls to Brevo, which is what a Worker does. Different protocol, different credential.

## Step 2. Store it

In `my-website`:

```
npx wrangler secret put BREVO_API_KEY
```

Paste the key.

## Step 3. Add the email function

Open `src/index.js`. In the checkout section from guide 08, add:

```js
async function sendOrderEmail(env, { toEmail, itemName, amountCents }) {
  if (!toEmail) return; // no email on file, nothing to send

  const amount = (amountCents / 100).toFixed(2);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "Your Business", email: "hello@yourbusiness.com" },
      to: [{ email: toEmail }],
      subject: "Your order is confirmed",
      htmlContent: `
        <p>Thanks for your order.</p>
        <p><b>${esc(itemName)}</b>, $${amount}</p>
        <p>Questions? Just reply to this email.</p>
      `
    })
  });

  if (!res.ok) {
    console.error("Order email failed:", await res.text());
  }
}
```

Change `sender.email` to an address you actually control on your domain, one that exists because of guide 01.

## Step 4. Call it from the webhook

Find the `stripeWebhook` function from guide 08. Inside the `if (event.type === "checkout.session.completed")` block, right after the `INSERT OR IGNORE` call, add:

```js
    await sendOrderEmail(env, {
      toEmail: session.customer_details?.email,
      itemName: session.metadata?.item_key || "your order",
      amountCents: session.amount_total || 0
    });
```

The full block should now read the database write, then the email send, in that order. If the database write fails, no email goes out for an order that was never recorded.

## Step 5. Deploy and test

```
npx wrangler deploy
```

Run through the test purchase from guide 08 again with card `4242 4242 4242 4242`. Check the inbox on the email you used at checkout.

---

## Verify it works

- [ ] A test purchase produces a confirmation email within about a minute
- [ ] The email shows the correct item and amount
- [ ] The email arrives from your own domain, not looking like it came through a generic service
- [ ] Checking your Worker logs (`npx wrangler tail`) during a test purchase shows no "Order email failed" line

---

## What breaks and how to fix it

**No email arrives, no error in the logs either**
`toEmail` was empty. This happens if Stripe Checkout was not configured to collect an email, though by default it is. Check the order in `/admin/orders`, if the Email column is blank, the checkout session itself did not collect one.

**"Order email failed" in the logs, 401 response**
Wrong API key, or you pasted the SMTP key by mistake. Regenerate the API key in Brevo and store it again.

**Email arrives but shows "via brevosend.com" in the sender**
Your domain is not authenticated with Brevo, meaning guide 01 Part B was skipped or its DNS records have not finished verifying. Go back to Brevo's sender settings and check the domain's status.

**Email arrives late, ten or more minutes after purchase**
Almost never Brevo. Check the Stripe webhook delivery log first, the delay is usually there, not in email sending.

**You are testing repeatedly and worried about hitting the 300-per-day limit**
Check remaining volume any time in the Brevo dashboard under account statistics. Test purchases count against the same 300, same as real ones.

---

## What to do next

Go to **09. Free Invoicing for Life**. Same Stripe secret key, a different part of the API.

---

## Sources to verify yourself

- Send a transactional email: `https://developers.brevo.com/docs/send-a-transactional-email`
- Brevo free plan limits: `https://www.brevo.com/pricing/`
