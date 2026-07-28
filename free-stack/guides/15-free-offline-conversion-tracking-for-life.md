# 15. Free Offline Conversion Tracking for Life

**Time: 60 minutes. Cost: $0. Code: copy and paste.**

The lead came in on Tuesday. They signed the contract the following Monday, on a phone call, nowhere near your website. Meta has no way to know that happened, unless you tell it.

---

## What you get

A button on your leads list, "Mark converted," that tells Meta a specific lead became real revenue, days or weeks after the original visit, using the same attribution data guide 14 already captured. Meta's ad optimization starts learning from actual outcomes, not just form fills.

---

## What it replaces

Nothing on the open market does this out of the box for a small business. This is the piece that separates an agency that actually understands your business from one running ads on autopilot. Most small businesses never close this loop at all, and their ad account optimizes toward "people who fill out forms" instead of "people who become customers," which are very often different groups of people.

---

## What is actually free and what is not

Entirely free, same as guide 14. This is one more event type sent to the same Conversions API endpoint.

---

## Prerequisites

- Guide 00 complete
- Guide 14 complete, with `sendCapiEvent()` working and at least one successful test event

---

## Step 1. Add the columns

Create `schema-conversions.sql`:

```sql
ALTER TABLE leads ADD COLUMN converted_at TEXT;
ALTER TABLE leads ADD COLUMN conversion_value REAL;
```

```
npx wrangler d1 execute leads --remote --file=./schema-conversions.sql
```

## Step 2. Extend `sendCapiEvent` to carry a dollar value

Find `sendCapiEvent()` from guide 14. Replace it entirely with this version, which adds `value`, `currency`, and `actionSource` while staying fully compatible with how guide 14 already calls it:

```js
async function sendCapiEvent(env, { eventName, eventId, eventSourceUrl, email, fbc, fbp, ip, userAgent, value, currency, actionSource }) {
  const userData = {};
  if (email) userData.em = [await sha256Hex(email.trim().toLowerCase())];
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
  if (ip) userData.client_ip_address = ip;
  if (userAgent) userData.client_user_agent = userAgent;

  const customData = {};
  if (value) {
    customData.value = value;
    customData.currency = currency || "USD";
  }

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: actionSource || "website",
      event_source_url: eventSourceUrl,
      user_data: userData,
      ...(Object.keys(customData).length ? { custom_data: customData } : {})
    }]
  };

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.META_CAPI_TOKEN}`
      },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta API ${res.status}: ${errText}`);
  }
}
```

Guide 14's call to this function did not pass `value`, `currency`, or `actionSource`, so it keeps working exactly as before, `action_source` still defaults to `"website"` when not specified.

## Step 3. Add the conversion route

Above the `/admin/leads.csv` check in `src/index.js`:

```js
    if (url.pathname === "/admin/convert" && request.method === "POST") {
      return markConverted(request, env);
    }

```

## Step 4. Add the logic

```js
// ---------------------------------------------------------------
// Offline conversions (guide 15)
// ---------------------------------------------------------------

async function markConverted(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const leadId = Number(body.leadId);
  const value = Number(body.value) || 0;

  if (!leadId) return json({ ok: false, error: "Missing lead ID." }, 400);

  const lead = await env.DB.prepare(`SELECT * FROM leads WHERE id = ?`).bind(leadId).first();
  if (!lead) return json({ ok: false, error: "Lead not found." }, 404);

  await env.DB.prepare(
    `UPDATE leads SET converted_at = ?, conversion_value = ? WHERE id = ?`
  ).bind(new Date().toISOString(), value, leadId).run();

  // This is a separate real-world event from the original lead capture,
  // it gets its own fresh event_id, never reuse the lead's original one.
  await sendCapiEvent(env, {
    eventName: "Purchase",
    eventId: crypto.randomUUID(),
    eventSourceUrl: `https://yourbusiness.com${lead.page || ""}`,
    email: lead.email,
    fbc: lead.fbc,
    fbp: lead.fbp,
    ip: lead.client_ip,
    userAgent: lead.user_agent,
    value,
    currency: "USD",
    actionSource: "other"
  }).catch(err => console.error("Offline CAPI send failed:", err.message));

  return json({ ok: true });
}
```

> **Why `actionSource: "other"` instead of `"website"` this time.** The original lead capture genuinely happened on your website, `action_source: "website"` in guide 14 was accurate. This event, the actual sale, likely happened on a phone call or in person. Meta's `action_source` field accepts `phone_call`, `physical_store`, `email`, `chat`, `system_generated`, and `other`, among others. Set it to whatever actually happened. `"other"` is a safe default, change it if you know better.

## Step 5. Add the button to your leads admin page

Find `adminPage()` from guide 03. Two changes.

First, add a column to the header row:

```html
<tr><th>When</th><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Message</th><th>Outcome</th></tr>
```

Then update the row template to match:

```js
  const rows = results.map(r => `
    <tr>
      <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.source)}</td>
      <td>${esc(r.message)}</td>
      <td>${r.converted_at
        ? "Converted, $" + Number(r.conversion_value || 0).toFixed(2)
        : `<button onclick="markConverted(${r.id})">Mark converted</button>`}</td>
    </tr>`).join("");
```

Finally, add a script block just before the closing `</body>` tag in the same function's HTML template:

```html
<script>
async function markConverted(leadId) {
  const raw = prompt("Sale value in dollars? Enter 0 if there is no dollar amount to report.");
  if (raw === null) return;
  await fetch("/admin/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId, value: Number(raw) || 0 })
  });
  location.reload();
}
</script>
```

## Step 6. Deploy

```
npx wrangler deploy
```

## Step 7. Test it

Go to `/admin`. Find a lead from your guide 14 testing, one that has `fbc` or `fbp` populated. Click **Mark converted**, enter a test value like `100`.

Check Meta Events Manager, Test events, same as guide 14. You should see a `Purchase` event with `action_source: other` and a `value` of 100.

---

## Verify it works

- [ ] Clicking "Mark converted" updates the leads table to show "Converted, $100.00" instead of the button
- [ ] The Purchase event appears in Meta's Test events with the correct value
- [ ] Clicking a converted lead's row again does not show the button anymore, since it already has a `converted_at` value
- [ ] Marking a lead converted with `0` as the value still sends the event, just without a `custom_data.value` field, confirmed by checking the raw event in Test events

---

## What breaks and how to fix it

**Clicking "Mark converted" does nothing visible**
Check the Network tab for the `/admin/convert` response. Most often this is a JSON parsing issue if `leadId` came through as a string instead of a number somewhere in the chain, though the code above already handles that with `Number(body.leadId)`.

**Purchase event never reaches Meta, but the lead shows as converted**
This is `sendCapiEvent` failing silently by design, the `.catch()` on that call means a failed marketing signal never blocks the actual database update. Check `npx wrangler tail` for the real error, most often an expired `META_CAPI_TOKEN`.

**Conversion value shows as $0.00 even though you entered a real number**
The `prompt()` dialog returns text, and a stray comma or dollar sign typed into it, like `$1,000`, fails `Number()` silently and falls back to 0. Type digits only.

**You want to un-mark a lead that was converted by mistake**
There is no undo button by design, this should be rare and deliberate. Run it directly:
```
npx wrangler d1 execute leads --remote --command="UPDATE leads SET converted_at = NULL, conversion_value = NULL WHERE id = 42"
```
Meta does not support retracting an already-sent event, the mistaken Purchase event will still exist on their side.

**Two different leads with the same email both get marked converted, and you are not sure if Meta merges them**
It might, based on the hashed email, that is intentional matching behavior on Meta's side, not a bug in this system. Each event still carries its own `event_id` and is not deduplicated against the other.

---

## What to do next

Go to **13. Free CRM for Life**. Guides 03, 14, and 15 already do the hard part, capture, attribute, and report an outcome. The CRM is the interface that ties all three into one place to actually work from.

---

## Sources to verify yourself

- Conversions API parameters, including `action_source` values: `https://developers.facebook.com/docs/marketing-api/conversions-api/parameters`
