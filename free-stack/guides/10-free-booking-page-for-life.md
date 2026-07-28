# 10. Free Booking Page for Life

**Time: 90 minutes. Cost: $0. Code: copy and paste.**

Visitors pick an open slot. Two people cannot grab the same one. No monthly fee to remove a "powered by" badge.

---

## What you get

A page at `yourbusiness.com/book` showing your real, open time slots for the next two weeks. A visitor picks one, gives you their name and email, and it is locked in. The same slot cannot be double-booked, even if two people are looking at the page at the same instant.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Calendly | $12 to $20 per month | Free tier caps at one event type |
| Acuity Scheduling | $16 to $61 per month | Pricing climbs fast with client volume |
| SimplyBook.me | $9.90 to $59.90 per month | Booking limits on lower tiers |

---

## What is actually free and what is not

All of it. No new service, this is D1 doing what it already does in guide 03, applied to time slots instead of leads.

**The one thing this does not do, on purpose:** adjust times for a visitor's own timezone. Every slot is shown in your business's fixed timezone, labeled clearly, the same way a real storefront has one set of open hours regardless of where the customer is calling from. Building correct timezone conversion, including daylight saving transitions, is a genuinely hard problem, and a wrong answer there is worse than an honest, clearly labeled fixed one. If you serve clients across multiple time zones as a core part of your business, that is the one place in this library where a dedicated tool like Calendly may still be worth the fee.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- Guide 11 complete, optional, for an emailed confirmation instead of an on-screen one only

---

## Step 1. Add the table

Create `schema-bookings.sql`:

```sql
CREATE TABLE IF NOT EXISTS bookings (
  slot_id    TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL
);
```

The slot itself is the primary key. That single line is what makes double-booking impossible, not application logic you have to get right, the database refuses the second write outright.

```
npx wrangler d1 execute leads --remote --file=./schema-bookings.sql
```

## Step 2. Set your availability

Open `src/index.js`. Add this near your other config blocks:

```js
// ---------------------------------------------------------------
// Booking (guide 10)
// ---------------------------------------------------------------

const BOOKING_CONFIG = {
  timezoneLabel: "Eastern",    // display only, does not affect any math
  slotMinutes: 30,
  daysAhead: 14,
  // 0 = Sunday, 1 = Monday ... 6 = Saturday
  // Each day maps to a list of [start, end] ranges, 24-hour time.
  hours: {
    1: [["09:00", "12:00"], ["13:00", "17:00"]],
    2: [["09:00", "12:00"], ["13:00", "17:00"]],
    3: [["09:00", "12:00"], ["13:00", "17:00"]],
    4: [["09:00", "12:00"], ["13:00", "17:00"]],
    5: [["09:00", "12:00"], ["13:00", "17:00"]]
  }
};

// Add specific dates here to close them, vacation, a holiday, whatever.
const BLACKOUT_DATES = new Set([
  // "2026-08-15",
]);
```

No entry for Saturday or Sunday means closed those days. Add `6: [[...]]` or `0: [[...]]` if you work weekends.

## Step 3. Generate available slots

```js
function generateSlots() {
  const slots = [];
  const now = new Date();

  // Start from tomorrow, not today. This avoids the question of
  // whether a 9am slot today has already passed in your timezone,
  // a question that needs real timezone math to answer safely.
  for (let d = 1; d <= BOOKING_CONFIG.daysAhead; d++) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d));
    const weekday = day.getUTCDay();
    const ranges = BOOKING_CONFIG.hours[weekday];
    if (!ranges) continue;

    const dateStr = day.toISOString().slice(0, 10);
    if (BLACKOUT_DATES.has(dateStr)) continue;

    for (const [start, end] of ranges) {
      let [h, m] = start.split(":").map(Number);
      const [endH, endM] = end.split(":").map(Number);

      while (h < endH || (h === endH && m < endM)) {
        const slotId = `${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        slots.push(slotId);
        m += BOOKING_CONFIG.slotMinutes;
        if (m >= 60) { h += Math.floor(m / 60); m %= 60; }
      }
    }
  }
  return slots;
}
```

> **Why `Date.UTC` shows up even though this guide avoids timezone math.** This only uses UTC to walk calendar days correctly, so month and year boundaries roll over properly. The actual slot label, the date and time a visitor sees and books, is built as plain text right after, and never gets converted through any timezone-aware formatting. That is the whole trick: use `Date` for counting days, never for representing the appointment time itself.

## Step 4. Add the routes

Above the `/admin/leads.csv` check:

```js
    if (url.pathname === "/book") {
      return bookingPage(request, env);
    }

    if (url.pathname === "/book/slots" && request.method === "GET") {
      return availableSlots(env);
    }

    if (url.pathname === "/book/reserve" && request.method === "POST") {
      return bookSlot(request, env);
    }

    if (url.pathname === "/admin/bookings" && request.method === "GET") {
      return bookingsAdminPage(request, env);
    }

```

## Step 5. Add the booking logic

```js
async function availableSlots(env) {
  const all = generateSlots();

  const { results } = await env.DB.prepare(`SELECT slot_id FROM bookings`).all();
  const taken = new Set(results.map(r => r.slot_id));

  const open = all.filter(s => !taken.has(s));
  return new Response(JSON.stringify(open), { headers: { "Content-Type": "application/json" } });
}

async function bookSlot(request, env) {
  const body = await request.json().catch(() => ({}));
  const slotId = clean(body.slot, 30);
  const name = clean(body.name, 120);
  const email = clean(body.email, 200);

  if (!slotId || !name || !email) {
    return json({ ok: false, error: "Need a name, email, and a selected time." }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (slot_id, created_at, name, email) VALUES (?, ?, ?, ?)`
    ).bind(slotId, new Date().toISOString(), name, email).run();
  } catch {
    return json({ ok: false, error: "That time was just taken. Pick another." }, 409);
  }

  if (env.BREVO_API_KEY) {
    await sendBookingEmail(env, { toEmail: email, name, slotId }).catch(() => {});
  }

  return json({ ok: true });
}

async function sendBookingEmail(env, { toEmail, name, slotId }) {
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Your Business", email: "hello@yourbusiness.com" },
      to: [{ email: toEmail }],
      subject: "You're booked",
      htmlContent: `<p>Hi ${esc(name)},</p><p>You're confirmed for <b>${esc(slotId.replace("T", " "))} ${esc(BOOKING_CONFIG.timezoneLabel)}</b>.</p>`
    })
  });
}

async function bookingsAdminPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT * FROM bookings ORDER BY slot_id ASC`
  ).all();

  const rows = results.map(r => `
    <tr>
      <td>${esc(r.slot_id.replace("T", " "))}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.email)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Bookings</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 16px; }
  th, td { border-bottom: 1px solid #e4e7ec; padding: 8px; text-align: left; }
  th { background: #f7f8fa; }
</style></head><body>
  <h1>Bookings (${results.length}), all times ${esc(BOOKING_CONFIG.timezoneLabel)}</h1>
  <table>
    <tr><th>When</th><th>Name</th><th>Email</th></tr>
    ${rows}
  </table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

`sendBookingEmail` only ever gets called if `env.BREVO_API_KEY` exists, meaning you did guide 11. If you have not, booking still works, the confirmation is on-screen only.

## Step 6. Build the public page

```js
async function bookingPage(request, env) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Book a time</title>
  <link rel="stylesheet" href="/style.css">
  <style>
    #slots { display:flex; flex-wrap:wrap; gap:10px; margin:24px 0; }
    .slot { border:1px solid var(--line); padding:10px 14px; border-radius:6px; cursor:pointer; font-size:14px; }
    .slot:hover { border-color: var(--accent); }
    #form { display:none; max-width:400px; }
    #form label { display:block; margin:12px 0 6px; font-weight:600; font-size:14px; }
    #form input { width:100%; padding:10px; border:1px solid var(--line); border-radius:6px; font-size:16px; box-sizing:border-box; }
  </style>
</head>
<body>
  <main class="wrap" style="padding-top:48px;">
    <h1>Book a time</h1>
    <p style="color:var(--muted)">All times ${BOOKING_CONFIG.timezoneLabel}.</p>
    <div id="slots">Loading...</div>

    <div id="form">
      <h2 id="chosen"></h2>
      <label>Name</label>
      <input id="name" required>
      <label>Email</label>
      <input id="email" type="email" required>
      <button class="btn" id="confirm" style="margin-top:18px;border:0;cursor:pointer">Confirm</button>
      <p id="status" style="margin-top:12px"></p>
    </div>
  </main>

  <script>
    let chosenSlot = null;

    async function loadSlots() {
      const res = await fetch("/book/slots");
      const slots = await res.json();
      const container = document.getElementById("slots");
      container.innerHTML = "";
      if (slots.length === 0) {
        container.textContent = "No open times right now. Check back soon.";
        return;
      }
      slots.forEach(s => {
        const btn = document.createElement("div");
        btn.className = "slot";
        btn.textContent = s.replace("T", " ");
        btn.onclick = () => selectSlot(s);
        container.appendChild(btn);
      });
    }

    function selectSlot(slot) {
      chosenSlot = slot;
      document.getElementById("chosen").textContent = slot.replace("T", " ");
      document.getElementById("form").style.display = "block";
    }

    document.getElementById("confirm").addEventListener("click", async () => {
      const name = document.getElementById("name").value.trim();
      const email = document.getElementById("email").value.trim();
      const status = document.getElementById("status");

      if (!name || !email || !chosenSlot) {
        status.textContent = "Fill in your name and email.";
        return;
      }

      const res = await fetch("/book/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: chosenSlot, name, email })
      });
      const out = await res.json();

      if (out.ok) {
        document.getElementById("form").innerHTML = "<p>You're booked. Check your email for confirmation.</p>";
      } else {
        status.textContent = out.error || "Something went wrong.";
        if (res.status === 409) loadSlots();
      }
    });

    loadSlots();
  </script>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

## Step 7. Deploy

```
npx wrangler deploy
```

Visit `https://yourbusiness.com/book`. Pick a slot, book it with a real email you can check.

---

## Verify it works

- [ ] `/book` shows a real list of open times, none in the past
- [ ] Booking a slot succeeds and it disappears from the list on refresh
- [ ] Booking the same slot again, in a second tab, before refreshing either one, fails with "already taken" instead of creating a duplicate
- [ ] `/admin/bookings` shows the booking with the right time and name
- [ ] A date added to `BLACKOUT_DATES` no longer shows any slots that day, after a redeploy

---

## What breaks and how to fix it

**No slots show up at all**
`BOOKING_CONFIG.hours` has no entry for any day that falls in your `daysAhead` window, most often because every key was typed as a string like `"1"` instead of a number `1`. JavaScript object keys need to match exactly how `getUTCDay()` returns them, as numbers.

**A slot shows as open but booking it fails immediately**
Someone else took it between the page loading and you clicking confirm. This is the primary key doing its job, not a bug. The page reloads the list automatically when this happens.

**Times look shifted by a few hours from what you configured**
You are reading the raw `slot_id` string and expecting it to behave like a timezone-aware date somewhere else in your code. It never does. Treat it as a label, not a computable time, everywhere in this system.

**Confirmation email never arrives, but the booking is in `/admin/bookings`**
`BREVO_API_KEY` is not set, meaning guide 11 was not completed. The booking itself is unaffected, only the email is skipped.

**Old, already-passed dates still showing after a while**
The Worker regenerates the slot list fresh on every request, there is no stale cache to clear. If old dates are showing, check your server clock assumption is right: `now` is evaluated in UTC by `new Date()` inside a Worker, which is correct and does not need adjusting.

---

## What to do next

That closes the money-plumbing batch, checkout, invoicing, order emails, and booking, all sharing one Stripe key and one Brevo key. Guide 18, Free Mail Merge for Life, is next, a completely different tool: Google Apps Script, no Cloudflare involved at all.

---

## Sources to verify yourself

- D1 primary keys and constraints: `https://developers.cloudflare.com/d1/reference/database-commands/`
