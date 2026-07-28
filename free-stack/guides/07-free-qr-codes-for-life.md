# 07. Free QR Codes for Life

**Time: 60 minutes. Cost: $0. Code: copy and paste.**

A QR code that keeps working even after you change what it points to.

---

## What you get

An admin page where you create a QR code, print it once, and put it on a truck, a flyer, or a door. Change where it sends people any time, without reprinting anything. See exactly how many times each one has been scanned.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| QR Code Generator Pro (Beaconstac, Uniqode, similar) | $5 to $30 per month | Charges for editing after printing and for scan counts |
| Static QR generators | Free | Generate a code but cannot be edited or measured once printed |

Be clear-eyed about what you are actually replacing here. A plain, unchangeable QR code is already free everywhere, always has been. What costs money is the ability to **change the destination after the code is printed** and to **see how many times it has been scanned**. That is the entire paid feature. That is the entire thing this guide builds.

---

## What is actually free and what is not

All of it. This reuses the D1 database from guide 03 and a small, permissively licensed JavaScript library loaded from a CDN to draw the actual QR image in your browser. No API calls, no per-code fee, no scan limit.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working

If you also did guide 06 Part B, this will feel familiar. It is the same redirect-and-log idea, aimed at a printed code instead of a tapped button.

---

## The shape of what you are building

```
  Printed QR code, scanned by a phone camera
                |
                v
  yourbusiness.com/q/<slug>      <- this NEVER changes once printed
                |
                |  your Worker looks up <slug>
                v
  Wherever you last told it to go, plus one scan logged
```

The QR image encodes the `/q/<slug>` URL, not the final destination. That one layer of indirection is the entire trick.

---

## Step 1. Add the table

Create `schema-qr.sql` in `my-website`:

```sql
CREATE TABLE IF NOT EXISTS qr_codes (
  slug        TEXT PRIMARY KEY,
  destination TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  scans       INTEGER NOT NULL DEFAULT 0
);
```

Run it against your existing database:

```
npx wrangler d1 execute leads --remote --file=./schema-qr.sql
```

## Step 2. Add the routes

Open `src/index.js`. Add these above the `/admin/leads.csv` check:

```js
    if (url.pathname.startsWith("/q/")) {
      return qrRedirect(url, env);
    }

    if (url.pathname === "/admin/qr" && request.method === "GET") {
      return qrAdminPage(request, env);
    }

    if (url.pathname === "/admin/qr/create" && request.method === "POST") {
      return qrCreate(request, env);
    }

    if (url.pathname === "/admin/qr/delete" && request.method === "POST") {
      return qrDelete(request, env);
    }

```

## Step 3. Write the logic

At the bottom of the file:

```js
// ---------------------------------------------------------------
// QR codes (guide 07)
// ---------------------------------------------------------------

async function qrRedirect(url, env) {
  const slug = url.pathname.replace("/q/", "");

  const row = await env.DB.prepare(
    `SELECT destination FROM qr_codes WHERE slug = ?`
  ).bind(slug).first();

  if (!row) {
    return new Response("This code is not set up yet.", { status: 404 });
  }

  await env.DB.prepare(
    `UPDATE qr_codes SET scans = scans + 1 WHERE slug = ?`
  ).bind(slug).run();

  return Response.redirect(row.destination, 302);
}

async function qrCreate(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const slug = clean(body.slug, 60).toLowerCase().replace(/[^a-z0-9-]/g, "");
  const destination = clean(body.destination, 500);
  const label = clean(body.label, 120);

  if (!slug || !destination) {
    return json({ ok: false, error: "Need a slug and a destination." }, 400);
  }
  if (!destination.startsWith("http://") && !destination.startsWith("https://")) {
    return json({ ok: false, error: "Destination needs http:// or https://" }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO qr_codes (slug, destination, label, created_at, scans)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(slug) DO UPDATE SET destination = excluded.destination, label = excluded.label`
  ).bind(slug, destination, label, new Date().toISOString()).run();

  return json({ ok: true, slug });
}

async function qrDelete(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  if (!body.slug) return json({ ok: false, error: "Missing slug." }, 400);

  await env.DB.prepare(`DELETE FROM qr_codes WHERE slug = ?`).bind(body.slug).run();
  return json({ ok: true });
}

async function qrAdminPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT * FROM qr_codes ORDER BY created_at DESC`
  ).all();

  const origin = new URL(request.url).origin;

  const rows = results.map(r => `
    <div class="card" data-slug="${esc(r.slug)}">
      <div class="qrbox" id="qr-${esc(r.slug)}"></div>
      <div class="meta">
        <b>${esc(r.label || r.slug)}</b>
        <span>${origin}/q/${esc(r.slug)}</span>
        <span>${r.scans} scans</span>
        <span class="dest">${esc(r.destination)}</span>
        <button onclick="del('${esc(r.slug)}')">Delete</button>
      </div>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QR Codes</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; max-width: 720px; }
  h1 { font-size: 22px; }
  form { display:flex; gap:8px; margin:20px 0; flex-wrap:wrap; }
  input { padding:10px; border:1px solid #d7dbe0; border-radius:6px; font-size:14px; }
  input[name="label"] { flex:1 1 140px; }
  input[name="destination"] { flex:2 1 240px; }
  button { background:#12151a; color:#fff; border:0; padding:10px 16px; border-radius:6px; cursor:pointer; font-size:14px; }
  .card { display:flex; gap:16px; border:1px solid #e4e7ec; border-radius:8px; padding:16px; margin-bottom:12px; align-items:center; }
  .qrbox { flex-shrink:0; }
  .meta { display:flex; flex-direction:column; gap:4px; font-size:13px; }
  .meta b { font-size:15px; }
  .meta span { color:#6b7280; }
  .dest { word-break:break-all; }
  .meta button { align-self:flex-start; background:#d33; margin-top:4px; }
</style></head><body>
  <h1>QR Codes</h1>

  <form id="createForm">
    <input name="label" placeholder="Label (e.g. Truck decal)">
    <input name="destination" placeholder="https://yourbusiness.com/contact" required>
    <button type="submit">Create</button>
  </form>
  <p id="status"></p>

  <div id="list">${rows}</div>

  <script>
    const origin = "${origin}";

    function renderAll() {
      document.querySelectorAll(".qrbox").forEach(box => {
        box.innerHTML = "";
        const slug = box.id.replace("qr-", "");
        new QRCode(box, {
          text: origin + "/q/" + slug,
          width: 120,
          height: 120
        });
      });
    }
    renderAll();

    document.getElementById("createForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      data.slug = (data.label || "code").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) + "-" + Math.floor(Math.random() * 900 + 100);

      const res = await fetch("/admin/qr/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      const out = await res.json();
      document.getElementById("status").textContent = out.ok ? "Created." : (out.error || "Something went wrong.");
      if (out.ok) setTimeout(() => location.reload(), 500);
    });

    async function del(slug) {
      if (!confirm("Delete this code? The printed QR will stop working.")) return;
      await fetch("/admin/qr/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug })
      });
      location.reload();
    }
  </script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

This reuses `authOk()`, `askForPassword()`, `json()`, `clean()`, and `esc()` from guide 03. None of them get redefined.

> **Why the slug includes a random number.** Two truck decals both labeled "Truck" would otherwise collide and overwrite each other's destination. The random suffix keeps them distinct without you having to think about it.

## Step 4. Deploy

```
npx wrangler deploy
```

Go to `https://yourbusiness.com/admin/qr`, log in, and create your first code. A QR image renders immediately below the form.

## Step 5. Print it

Right-click the QR image, save it, drop it into whatever you are printing, a flyer, a decal, a yard sign. Scan it with your own phone once to confirm it lands on the right page.

## Step 6. Change the destination whenever you want

Create a new code with the **same label**, and the `ON CONFLICT` clause in `qrCreate` updates the existing row's destination instead of making a duplicate. The printed code, and the URL inside it, never change. Only where it points changes.

To retarget an existing slug exactly, call the create endpoint again with that same slug and a new destination. The admin form above always makes a new slug, so for now, retargeting an exact existing code means editing the row directly:

```
npx wrangler d1 execute leads --remote --command="UPDATE qr_codes SET destination = 'https://yourbusiness.com/new-page' WHERE slug = 'your-slug-123'"
```

---

## Verify it works

- [ ] Scanning the printed code with a real phone camera lands on the destination
- [ ] The scan count in `/admin/qr` goes up after each scan
- [ ] Deleting a code makes its `/q/<slug>` URL return a 404 instead of redirecting
- [ ] Running the create form twice with the same label updates rather than duplicates
- [ ] Changing a destination via the command above changes where the same printed code goes, with no reprint

---

## What breaks and how to fix it

**QR image never appears, box stays blank**
The cdnjs script tag failed to load, usually a typo in the URL, or your network blocking cdnjs. Check the browser console for a script loading error.

**Scanning shows "This code is not set up yet"**
The slug in the URL does not match any row in `qr_codes`. Most often this happens because you deleted a code that is still printed somewhere.

**Scan count does not increase**
You are looking at the local database, not the remote one, when you check the count, or you are testing by visiting the URL in a browser tab you already had open and cached. Use a private window.

**Creating a code with the same label makes a duplicate instead of updating**
The random suffix in the slug means two codes with the same label almost never generate the exact same slug. The `ON CONFLICT` only fires on an exact slug match. To truly retarget one code, use the SQL update command in step 6, not the form.

**"no such table: qr_codes"**
`schema-qr.sql` was run without `--remote`, or not run at all.

**Phone camera does not recognize the code as scannable**
The image was resized so small the modules blur together. Print QR codes at least one inch square, larger for anything viewed from a distance like a yard sign or truck decal.

---

## What to do next

That closes out the easy run. Guide 08, Free Checkout for Life, is next, and it is the first one that touches real money.

---

## Sources to verify yourself

- qrcodejs library, MIT licensed: `https://github.com/davidshimjs/qrcodejs`
- D1 querying from the CLI: `https://developers.cloudflare.com/d1/wrangler-commands/#d1-execute`
