# 03. Free Forms for Life

**Time: 60 minutes. Cost: $0. Code: copy and paste.**

Unlimited forms. Unlimited submissions. Every lead stored in a database you own and can export any time.

This is the first guide with a backend. Take it slow. Everything after this one gets easier because of what you learn here.

---

## What you get

A contact form on your site that saves every submission to your own database, blocks spam bots, tags which page and which ad the lead came from, and lets you download the whole list as a CSV.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Typeform | $29 to $99 per month | 100 responses per month on the cheap plan |
| Jotform | $39 to $129 per month | Submission caps |
| Gravity Forms | $59 to $259 per year | Needs WordPress |
| HubSpot Forms | Free, then $20+ | They own your data |

Typeform's $29 plan caps you at 100 responses a month. This has no cap.

---

## What is actually free

All of it.

D1 is Cloudflare's database. The free plan gives you 5 GB of storage, 5 million rows read per day, and 100,000 rows written per day. A lead record is roughly 500 bytes. 5 GB is about 10 million leads.

You will not hit this.

---

## Prerequisites

- Guide 02 complete and deployed
- You are working in the `my-website` folder

---

## The shape of what you are building

Three moving parts. Understand this before you type anything.

```
  Visitor fills out the form on your page
                |
                |  browser sends the data
                v
  Your Worker  (src/index.js)   <- the code that receives it
                |
                |  writes a row
                v
  Your D1 database (leads)      <- where it lives
                |
                |  you read it back
                v
  /admin  page and  /admin/leads.csv
```

The Worker is the part that was missing in guide 02. In guide 02 Cloudflare just handed out files. Now it runs your code first.

---

## Step 1. Create the database

In your `my-website` folder:

```
npx wrangler d1 create leads
```

The output looks like this:

```
[[d1_databases]]
binding = "DB"
database_name = "leads"
database_id = "8f2a1c04-3d7e-4b19-9a02-c5e6f7d81b33"
```

**Copy those four lines.** You need them in step 3.

## Step 2. Define the table

Create a file called `schema.sql` in the `my-website` folder.

```sql
CREATE TABLE IF NOT EXISTS leads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name       TEXT,
  email      TEXT,
  phone      TEXT,
  message    TEXT,
  source     TEXT,
  page       TEXT
);

CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at);
```

Run it against the live database:

```
npx wrangler d1 execute leads --remote --file=./schema.sql
```

It will ask you to confirm. Say yes.

> **What the columns are for.** `created_at` is when it came in. `source` is which ad or campaign sent them, pulled from the URL. `page` is which page of your site they were on. Those last two are what turn a form into a marketing tool, and almost nobody sets them up.

> **`--remote` vs `--local`.** Wrangler keeps a copy of the database on your computer for testing. `--remote` means the real one on the internet. Forget the flag and you will be very confused about why your data is missing.

## Step 3. Update the config

Open `wrangler.toml` and make it look like this. The `main` line and the `binding` line under `[assets]` are new.

```toml
name = "my-website"
main = "src/index.js"
compatibility_date = "2026-07-01"

[assets]
directory = "./public"
binding = "ASSETS"
html_handling = "auto-trailing-slash"
not_found_handling = "404-page"

[[d1_databases]]
binding = "DB"
database_name = "leads"
database_id = "PASTE-YOUR-ID-HERE"
```

Replace `PASTE-YOUR-ID-HERE` with the id from step 1.

> **What a binding is.** `binding = "DB"` means your code will refer to the database as `env.DB`. You never put a password or a connection string in your code. Cloudflare wires it up at runtime. This is why there is nothing here for a hacker to steal.

## Step 4. Write the Worker

Create a folder called `src`, then a file `src/index.js`.

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/lead" && request.method === "POST") {
      return saveLead(request, env);
    }

    if (url.pathname === "/admin") {
      return adminPage(request, env);
    }

    if (url.pathname === "/admin/leads.csv") {
      return adminCsv(request, env);
    }

    // Everything else: serve the static files from /public
    return env.ASSETS.fetch(request);
  }
};

// ---------------------------------------------------------------
// Saving a lead
// ---------------------------------------------------------------

async function saveLead(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  // Honeypot. Real people never fill this in, bots always do.
  if (body.website) {
    return json({ ok: true });   // lie to the bot, save nothing
  }

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const phone = clean(body.phone, 40);
  const message = clean(body.message, 4000);
  const source = clean(body.source, 120);
  const page = clean(body.page, 300);

  if (!name || (!email && !phone)) {
    return json({ ok: false, error: "Name and either email or phone are required." }, 400);
  }

  if (email && !email.includes("@")) {
    return json({ ok: false, error: "That email does not look right." }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO leads (created_at, name, email, phone, message, source, page)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(new Date().toISOString(), name, email, phone, message, source, page).run();

  return json({ ok: true });
}

function clean(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// ---------------------------------------------------------------
// Admin
// ---------------------------------------------------------------

function authOk(request, env) {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = atob(header.slice(6));
  const split = decoded.indexOf(":");
  const user = decoded.slice(0, split);
  const pass = decoded.slice(split + 1);
  return user === "admin" && pass === env.ADMIN_PASSWORD;
}

function askForPassword() {
  return new Response("Authorization required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="admin"' }
  });
}

async function adminPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT * FROM leads ORDER BY created_at DESC LIMIT 200`
  ).all();

  const rows = results.map(r => `
    <tr>
      <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
      <td>${esc(r.name)}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.phone)}</td>
      <td>${esc(r.source)}</td>
      <td>${esc(r.message)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Leads</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; }
  h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 16px; }
  th, td { border-bottom: 1px solid #e4e7ec; padding: 8px; text-align: left; vertical-align: top; }
  th { background: #f7f8fa; }
  a.btn { display:inline-block; background:#12151a; color:#fff; padding:8px 16px; border-radius:6px; text-decoration:none; font-size:14px; }
</style></head><body>
  <h1>Leads (${results.length})</h1>
  <a class="btn" href="/admin/leads.csv">Download CSV</a>
  <table>
    <tr><th>When</th><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Message</th></tr>
    ${rows}
  </table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function adminCsv(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT created_at, name, email, phone, source, page, message
     FROM leads ORDER BY created_at DESC`
  ).all();

  const header = "created_at,name,email,phone,source,page,message";
  const lines = results.map(r =>
    [r.created_at, r.name, r.email, r.phone, r.source, r.page, r.message]
      .map(csvCell).join(",")
  );

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="leads.csv"'
    }
  });
}

function csvCell(value) {
  const s = (value ?? "").toString();
  // Leading =, +, -, @ can execute as a formula in Excel. Neutralize it.
  const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function esc(value) {
  return (value ?? "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

> **Why `.bind(...)` instead of building the SQL string.** If you glued the user's input straight into the SQL, someone could type SQL into the name box and delete your table. `.bind()` sends the values separately so they are always treated as data, never as commands. This is called a prepared statement. Use it every single time, forever.

> **Why `esc()` exists.** Someone can put HTML in the message box. If you print it raw on your admin page, their code runs in your browser. `esc()` turns the dangerous characters into harmless text.

> **Why `csvCell` prefixes an apostrophe.** A lead whose name starts with `=` becomes a live formula when you open the CSV in Excel. That is a real attack. One character stops it.

## Step 5. Set the admin password

```
npx wrangler secret put ADMIN_PASSWORD
```

It prompts you. Type a long random password and press Enter. It will not show as you type.

Use a password manager. Do not reuse anything.

> **Why a secret and not a line in `wrangler.toml`.** Anything in `wrangler.toml` gets committed to GitHub the day you start using GitHub. Secrets are stored encrypted on Cloudflare and never appear in your files.

## Step 6. Put the form on your page

Replace the `<main>` block in `public/contact.html` with this.

```html
<main class="wrap">
  <div class="hero">
    <h1>Get a quote</h1>
    <p>Tell us what you need. We reply the same day.</p>
  </div>

  <section>
    <form id="leadForm" style="max-width:520px">
      <label>Name
        <input name="name" required>
      </label>
      <label>Email
        <input name="email" type="email">
      </label>
      <label>Phone
        <input name="phone" type="tel">
      </label>
      <label>What do you need?
        <textarea name="message" rows="4"></textarea>
      </label>

      <!-- Honeypot. Hidden from people, visible to bots. -->
      <input name="website" tabindex="-1" autocomplete="off"
             style="position:absolute;left:-9999px" aria-hidden="true">

      <button type="submit" class="btn" style="border:0;cursor:pointer">Send it</button>
      <p id="formMsg" style="margin-top:14px"></p>
    </form>
  </section>
</main>

<script>
const form = document.getElementById("leadForm");
const msg  = document.getElementById("formMsg");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  msg.textContent = "Sending...";

  const data = Object.fromEntries(new FormData(form));
  data.page   = location.pathname;
  data.source = new URLSearchParams(location.search).get("v") || "direct";

  try {
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const out = await res.json();
    if (out.ok) {
      form.reset();
      msg.textContent = "Got it. We will be in touch today.";
    } else {
      msg.textContent = out.error || "Something went wrong. Call us instead.";
      button.disabled = false;
    }
  } catch {
    msg.textContent = "Network problem. Please try again.";
    button.disabled = false;
  }
});
</script>
```

Add this to `public/style.css` so the form is not ugly:

```css
form label { display:block; margin-bottom:16px; font-weight:600; font-size:15px; }
form input, form textarea {
  display:block; width:100%; margin-top:6px; padding:12px;
  border:1px solid var(--line); border-radius:6px;
  font-size:16px; font-family:inherit;
}
form input:focus, form textarea:focus { outline:2px solid var(--accent); border-color:var(--accent); }
```

> **Why `font-size:16px` on inputs.** Anything smaller and iPhone Safari zooms in when the user taps the field. It is jarring and it costs you submissions.

> **What `data.source` does.** If you send an ad to `yourbusiness.com/contact?v=fb-roofing-may`, that tag gets stored with the lead. Now you know which ad produced which customer. This one line is the foundation for guides 12, 14, and 15.

## Step 7. Deploy and test

```
npx wrangler deploy
```

1. Go to `https://yourbusiness.com/contact?v=test-run`
2. Fill the form in. Submit it.
3. Go to `https://yourbusiness.com/admin`
4. Username `admin`, password the one you set.

Your lead should be there with `test-run` in the Source column.

---

## Step 8. Get notified when a lead comes in

Right now leads sit in a database and nobody tells you. Two options.

**Fast version:** check `/admin` once a day. Bookmark it on your phone home screen.

**Real version:** guide 11, Free Order Emails for Life, wires up an email alert on every submission. Do that one next if leads matter more than anything else on your list.

---

## Verify it works

- [ ] A test submission appears at `/admin`
- [ ] The Source column shows the `?v=` tag you used
- [ ] `/admin` asks for a password in a private browser window
- [ ] The CSV downloads and opens correctly in Excel or Sheets
- [ ] Submitting with an empty name shows an error instead of saving a blank row
- [ ] The form works on your phone

Bot test: open your browser console on the contact page, run
`document.querySelector('[name=website]').value = 'bot'`, then submit. It should say success and **not** appear in `/admin`.

---

## What breaks and how to fix it

**"env.DB is undefined"**
The `[[d1_databases]]` block is missing from `wrangler.toml`, or you pasted the id wrong. Double square brackets, not single.

**"no such table: leads"**
You ran `schema.sql` locally instead of remotely. Run it again with `--remote`.

**The form posts but nothing appears in /admin**
You are looking at the local database. Or the honeypot caught you because a browser extension autofilled the hidden field. Turn off autofill extensions and try in a private window.

**`/admin` never asks for a password**
You did not set the secret. Run `npx wrangler secret put ADMIN_PASSWORD` and deploy again.

**Everything 404s after adding `main` to wrangler.toml**
`src/index.js` is missing or has a syntax error. Run `npx wrangler deploy` and read the error. It tells you the line number.

**Static pages stopped loading but the form works**
You added `main` but forgot `binding = "ASSETS"` under `[assets]`. Without it, `env.ASSETS.fetch` has nothing to call.

---

## What to do next

Two good directions.

- **04. Free Landing Pages for Life.** One Worker serving five different offers off the `?v=` tag you just wired up.
- **11. Free Order Emails for Life.** Get an email the second a lead comes in.

---

## Sources to verify yourself

- D1 pricing: `https://developers.cloudflare.com/d1/platform/pricing/`
- Prepared statements: `https://developers.cloudflare.com/d1/worker-api/prepared-statements/`
- Secrets: `https://developers.cloudflare.com/workers/configuration/secrets/`
