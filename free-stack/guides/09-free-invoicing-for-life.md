# 09. Free Invoicing for Life

**Time: 60 minutes. Cost: $0 plus Stripe's processing fee on paid invoices. Code: copy and paste.**

A real invoice, with a due date and a pay-online link, sent from a form instead of a template you fill in by hand.

---

## What you get

A private page where you type in who owes you money, what for, and how much. Stripe generates a proper invoice, emails it to them, and gives them a link to pay it online. You never touch a PDF.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Invoice Ninja (hosted) | $10 to $30 per month | Self-hosting the free version means running your own server |
| Bill.com | $15 to $79 per user per month | Priced for teams, overkill for one person billing clients |
| FreshBooks | $19 to $65 per month | Invoicing bundled with accounting features you may not need |

---

## What is actually free and what is not

The invoicing tool: free. Stripe's Invoicing API has no separate fee to create or send an invoice.

**Not free:** if the client pays the invoice through the link Stripe gives them, the same processing fee from guide 08 applies, currently 2.9% plus 30 cents. If they pay you by check or cash instead and you just want the paper trail, there is no fee at all, Stripe never touches the money in that case.

---

## Prerequisites

- Guide 00 complete
- Guide 08 complete, with `STRIPE_SECRET_KEY` already stored

No new database table for this one. Every invoice you create lives in Stripe's own dashboard, which already does a better job of tracking status, sent, viewed, paid, than anything worth rebuilding here.

---

## Step 1. Add the routes

Open `src/index.js`. Add these above the `/admin/leads.csv` check:

```js
    if (url.pathname === "/admin/invoice" && request.method === "GET") {
      return invoiceAdminPage(request, env);
    }

    if (url.pathname === "/admin/invoice/create" && request.method === "POST") {
      return createInvoice(request, env);
    }

```

## Step 2. Add the invoice creation logic

In the checkout section from guide 08, add:

```js
async function createInvoice(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const email = clean(body.email, 200);
  const name = clean(body.name, 120);
  const description = clean(body.description, 500);
  const amountCents = Math.round(Number(body.amount) * 100);
  const dueDays = Number(body.dueDays) || 14;

  if (!email || !description || !amountCents || amountCents <= 0) {
    return json({ ok: false, error: "Need an email, a description, and an amount greater than $0." }, 400);
  }

  const customer = await stripeRequest(env, "POST", "/customers", { email, name });

  const invoice = await stripeRequest(env, "POST", "/invoices", {
    customer: customer.id,
    collection_method: "send_invoice",
    days_until_due: dueDays
  });

  await stripeRequest(env, "POST", "/invoiceitems", {
    customer: customer.id,
    invoice: invoice.id,
    amount: amountCents,
    currency: "usd",
    description
  });

  const sent = await stripeRequest(env, "POST", `/invoices/${invoice.id}/send`, {});

  return json({ ok: true, url: sent.hosted_invoice_url });
}
```

This reuses `stripeRequest()`, `authOk()`, `askForPassword()`, `clean()`, and `json()`, all already in the file from guides 03 and 08. Nothing here gets redefined.

> **Why a customer, then an invoice, then an item, then a send, in that order.** Stripe's invoicing model separates who owes money (Customer) from the bill itself (Invoice) from what's on it (Invoice Item). An invoice created this way with `send_invoice` as the collection method sits as a draft until the send step, which both finalizes it and emails it in one call. Skipping the send step leaves a draft that nobody ever sees.

> **One honest limitation.** This creates a new Stripe Customer record every time, even for someone you have billed before. That is harmless, Stripe still tracks their full invoice history if you search by email in the Dashboard, but if you bill the same clients repeatedly and want one clean customer record per client, do that lookup and reuse in the Stripe Dashboard itself rather than through this form.

## Step 3. Add the admin form

```js
async function invoiceAdminPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Send an Invoice</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; max-width: 480px; }
  h1 { font-size: 22px; }
  label { display:block; margin:14px 0 6px; font-weight:600; font-size:14px; }
  input, textarea { width:100%; padding:10px; border:1px solid #d7dbe0; border-radius:6px; font-size:14px; box-sizing:border-box; }
  button { margin-top:18px; background:#12151a; color:#fff; border:0; padding:12px 20px; border-radius:6px; cursor:pointer; }
  #result { margin-top:18px; font-size:14px; }
  #result a { word-break:break-all; }
</style></head><body>
  <h1>Send an Invoice</h1>
  <form id="f">
    <label>Customer name</label>
    <input name="name">
    <label>Customer email</label>
    <input name="email" type="email" required>
    <label>What is this for</label>
    <textarea name="description" rows="2" required></textarea>
    <label>Amount (USD)</label>
    <input name="amount" type="number" step="0.01" min="0.01" required>
    <label>Due in how many days</label>
    <input name="dueDays" type="number" value="14">
    <button type="submit">Create and send</button>
  </form>
  <div id="result"></div>

  <script>
    document.getElementById("f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const button = e.target.querySelector("button");
      button.disabled = true;
      const data = Object.fromEntries(new FormData(e.target));
      const res = await fetch("/admin/invoice/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const out = await res.json();
      document.getElementById("result").innerHTML = out.ok
        ? "Sent. Hosted invoice link: <a href='" + out.url + "' target='_blank'>" + out.url + "</a>"
        : (out.error || "Something went wrong.");
      button.disabled = false;
    });
  </script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

## Step 4. Deploy

```
npx wrangler deploy
```

## Step 5. Send a test invoice

Go to `https://yourbusiness.com/admin/invoice`. Use your own email as the customer email so you can see what the client sees. Fill in a small test amount, submit.

Check your inbox for the invoice email from Stripe. Open the hosted link. It should show an itemized invoice with a due date and a pay button. Pay it with the same test card from guide 08, `4242 4242 4242 4242`, to confirm the full loop, or just confirm the page renders correctly and stop there.

---

## Verify it works

- [ ] Submitting the form returns a hosted invoice link
- [ ] The test email inbox receives an invoice email from Stripe
- [ ] The hosted invoice shows the correct description, amount, and due date
- [ ] Submitting with a $0 or blank amount shows an error instead of creating a broken invoice
- [ ] The invoice appears in your Stripe Dashboard under **Invoicing**

---

## What breaks and how to fix it

**"Need an email, a description, and an amount greater than $0"**
One of the required fields was blank, or the amount field had a stray character in it, like a dollar sign typed into the number input.

**Form submits but nothing happens, no error, no link**
Open the browser console and check the Network tab for the actual response from `/admin/invoice/create`. Usually this traces back to a Stripe API error, most often `STRIPE_SECRET_KEY` missing entirely if you skipped guide 08.

**Invoice email never arrives**
Check the Stripe Dashboard under **Invoicing**, the invoice itself will show a status. If it says "Open" but the client says nothing arrived, check their spam folder first, this is far more common than an actual delivery failure.

**Invoice shows the wrong amount**
The amount field expects dollars, like `49.99`, and the code multiplies by 100 to get cents internally. If you typed `4999` meaning $49.99, you just billed $4,999.

**"days_until_due" error from Stripe**
This only applies when `collection_method` is `send_invoice`, which is exactly what this guide uses, so it should always be present. If you see this error, `dueDays` came through as `0` or empty, check the form field actually has a value.

---

## What to do next

Go to **10. Free Booking Page for Life**. Different problem, same instinct: replace a recurring bill with something you own.

---

## Sources to verify yourself

- Invoicing integration guide: `https://docs.stripe.com/invoicing/integration`
- Create an invoice: `https://docs.stripe.com/api/invoices/create`
