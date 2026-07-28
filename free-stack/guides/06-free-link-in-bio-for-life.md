# 06. Free Link in Bio for Life

**Time: 20 minutes for the page, 30 more for click counts. Cost: $0. Code: copy and paste.**

The easiest one in the library. One page, every link you want to share, no monthly fee to change a color.

---

## What you get

A page at `yourbusiness.com/links` with a stack of buttons, one per link, styled to match your brand. Put it in your Instagram bio.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Linktree Pro | $9 to $24 per month | Charges for removing their branding and for click analytics |
| Beacons | $10 to $50 per month | Same shape, different name |
| Later's Link in Bio | $25 and up | Bundled into a bigger plan you may not need |

---

## What is actually free and what is not

Part A, the page itself, is entirely free. It is one more static file, same as everything in guide 02.

Part B, click counts, is also free. It reuses the D1 database from guide 03. No new cost, only a new table.

---

## Prerequisites

**Part A:** Guide 00 and guide 02 complete.
**Part B:** Also requires guide 03 complete.

---

# Part A. The page

## Step 1. Create the page

Add a new file, `public/links.html`, inside your `my-website` project.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Business</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="wrap" style="max-width:420px; padding-top:56px;">
    <div style="text-align:center; margin-bottom:32px;">
      <h1 style="font-size:22px;">Your Business</h1>
      <p style="color:var(--muted); font-size:15px;">Greenville, SC</p>
    </div>

    <div style="display:flex; flex-direction:column; gap:14px;">
      <a class="btn" style="text-align:center;" href="https://yourbusiness.com">Visit our website</a>
      <a class="btn" style="text-align:center; background:#25D366;" href="https://wa.me/18645551234">Message us on WhatsApp</a>
      <a class="btn" style="text-align:center;" href="https://yourbusiness.com/contact">Get a free quote</a>
      <a class="btn" style="text-align:center; background:transparent; color:var(--ink); border:1px solid var(--line);" href="https://instagram.com/yourbusiness">Follow on Instagram</a>
    </div>
  </main>
</body>
</html>
```

This reuses `.btn` and `.wrap` from `style.css`, already in your project since guide 02. Swap the four links for your own. Add or remove rows as needed.

## Step 2. Deploy

```
npx wrangler deploy
```

Visit `https://yourbusiness.com/links` and tap through every button on your phone, not just your laptop. This page lives inside a bio field, it will almost always be opened on mobile first.

**You are done with Part A.** Put that URL in your Instagram bio right now.

---

## Verify it works

- [ ] Every button goes to the right place
- [ ] It looks right on a phone
- [ ] The page loads fast, since a bio-link visitor's patience is measured in seconds

---

# Part B. Click counts

Optional. Do this if you want to know which link people actually tap, the thing Linktree charges extra for.

## Step 1. Add the table

Create `schema-links.sql` in `my-website`:

```sql
CREATE TABLE IF NOT EXISTS link_clicks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clicked_at TEXT NOT NULL,
  slug       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_clicks_slug ON link_clicks (slug);
```

Run it against your existing database:

```
npx wrangler d1 execute leads --remote --file=./schema-links.sql
```

This adds a table to the same database guide 03 created. You are not creating a second database.

## Step 2. Add the redirect route

Open `src/index.js`. Add this block above the `/admin/leads.csv` check:

```js
    if (url.pathname.startsWith("/l/")) {
      return trackedRedirect(url, env);
    }

```

## Step 3. Add the logic

At the bottom of the file:

```js
// ---------------------------------------------------------------
// Link-in-bio click tracking (guide 06)
// ---------------------------------------------------------------

const LINKS = {
  site:      "https://yourbusiness.com",
  whatsapp:  "https://wa.me/18645551234",
  quote:     "https://yourbusiness.com/contact",
  instagram: "https://instagram.com/yourbusiness"
};

async function trackedRedirect(url, env) {
  const slug = url.pathname.replace("/l/", "");
  const dest = LINKS[slug];

  if (!dest) {
    return new Response("Not found", { status: 404 });
  }

  await env.DB.prepare(
    `INSERT INTO link_clicks (clicked_at, slug) VALUES (?, ?)`
  ).bind(new Date().toISOString(), slug).run();

  return Response.redirect(dest, 302);
}
```

## Step 4. Point your buttons at the tracked routes

Back in `public/links.html`, change each `href` to go through `/l/<slug>` instead of the real URL directly:

```html
<a class="btn" style="text-align:center;" href="/l/site">Visit our website</a>
<a class="btn" style="text-align:center; background:#25D366;" href="/l/whatsapp">Message us on WhatsApp</a>
<a class="btn" style="text-align:center;" href="/l/quote">Get a free quote</a>
<a class="btn" style="text-align:center; background:transparent; color:var(--ink); border:1px solid var(--line);" href="/l/instagram">Follow on Instagram</a>
```

The slug in the `href` (`site`, `whatsapp`, `quote`, `instagram`) must match a key in the `LINKS` object exactly.

## Step 5. See the counts

Simplest option, no new page needed. Run this whenever you want the numbers:

```
npx wrangler d1 execute leads --remote --command="SELECT slug, COUNT(*) as clicks FROM link_clicks GROUP BY slug ORDER BY clicks DESC"
```

## Step 6. Deploy and test

```
npx wrangler deploy
```

Tap each button. Run the command from step 5 again. Counts should go up.

---

## Verify it works

- [ ] Tapping a link-in-bio button still lands on the right destination
- [ ] The count command shows a row per slug with a rising number
- [ ] A slug not in `LINKS` returns a 404 instead of a broken redirect

---

## What breaks and how to fix it

**Buttons work but nothing shows up in the click count**
The `href` in `links.html` still points at the real URL directly instead of `/l/<slug>`. Part B only counts clicks that go through the redirect.

**"no such table: link_clicks"**
`schema-links.sql` was run locally instead of `--remote`, or not run at all. Run the command from step 1 again with `--remote`.

**A link 404s that used to work**
The slug in `href` does not match a key in the `LINKS` object. These are case-sensitive and must match exactly.

**Redirect works but goes to the wrong destination**
Two entries in `LINKS` share a value by copy-paste mistake. Check each one points where you think it does.

**The count query returns nothing at all**
You are querying the local database instead of the remote one. Add `--remote` to the command.

---

## What to do next

Go to **07. Free QR Codes for Life**. Same redirect-and-count pattern, now printed on paper instead of tapped on a screen.

---

## Sources to verify yourself

- D1 querying from the CLI: `https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute`
