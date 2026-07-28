# 05. Free File Storage for Life

**Time: 75 minutes. Cost: $0. Code: copy and paste.**

Store files. Share a link. Never pay for a download again.

---

## What you get

A private page where you upload files and get back a public link for each one. Photos, PDFs, contracts, anything. No download limits. No bandwidth bill, ever, at any size.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Dropbox | $12 to $20 per month per user | Bandwidth caps on shared links |
| WeTransfer Pro | $12 per month | Files expire |
| Google Drive (business tier) | $6 to $18 per user per month | Per-user pricing |

The number that matters most here is not the storage price. Every one of those charges you, directly or through caps, for people downloading what you shared. R2 does not. That is the actual replacement.

---

## What is actually free and what is not

**Free:** 10 GB of storage per month, and this is the important part, **zero egress fees at any volume, forever**. Cloudflare does not charge for bandwidth out of R2. That is not a promotional rate. It has been R2's core pledge since launch.

**The one ceiling to know:** a single upload through this system tops out around 100 MB, because that is Cloudflare's request body limit on the free plan. Fine for photos, PDFs, and most documents. Not fine for a two hour video file.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working

This adds routes and a binding to that same file.

---

## The shape of what you are building

```
  You, in a browser, at /admin/files
                |
                |  pick a file, click upload
                v
  Your Worker  (new routes in src/index.js)
                |
                |  writes the bytes
                v
  Your R2 bucket
                |
                |  anyone with the link
                v
  yourbusiness.com/f/<key>   <- loads the file, publicly, forever
```

---

## Step 1. Create the bucket

In your `my-website` folder:

```
npx wrangler r2 bucket create business-files
```

## Step 2. Add the binding

Open `wrangler.toml`. Add this block anywhere after the `[[d1_databases]]` section:

```toml
[[r2_buckets]]
binding = "FILES"
bucket_name = "business-files"
```

No id to copy this time. R2 bindings work off the bucket name directly.

## Step 3. Add the routes

Open `src/index.js`. Find this line:

```js
if (url.pathname === "/admin/leads.csv") {
```

Add these new blocks directly above it:

```js
    if (url.pathname.startsWith("/f/")) {
      return serveFile(url, env);
    }

    if (url.pathname === "/admin/files" && request.method === "GET") {
      return filesPage(request, env);
    }

    if (url.pathname === "/admin/files/upload" && request.method === "POST") {
      return uploadFile(request, env, url);
    }

    if (url.pathname === "/admin/files/delete" && request.method === "POST") {
      return deleteFile(request, env);
    }

```

## Step 4. Write the logic

At the bottom of the file, in a new section, add:

```js
// ---------------------------------------------------------------
// File storage (guide 05)
// ---------------------------------------------------------------

async function serveFile(url, env) {
  const key = decodeURIComponent(url.pathname.replace("/f/", ""));
  const object = await env.FILES.get(key);

  if (!object) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000");

  return new Response(object.body, { headers });
}

async function uploadFile(request, env, url) {
  if (!authOk(request, env)) return askForPassword();

  const name = url.searchParams.get("name");
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";

  if (!name) {
    return json({ ok: false, error: "Missing filename." }, 400);
  }

  const key = crypto.randomUUID().slice(0, 8) + "-" + name.replace(/[^a-zA-Z0-9._-]/g, "_");

  await env.FILES.put(key, request.body, {
    httpMetadata: { contentType }
  });

  return json({ ok: true, url: `/f/${key}` });
}

async function deleteFile(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  if (!body.key) return json({ ok: false, error: "Missing key." }, 400);

  await env.FILES.delete(body.key);
  return json({ ok: true });
}

async function filesPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const listing = await env.FILES.list();
  const rows = listing.objects
    .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded))
    .map(obj => `
      <tr>
        <td><a href="/f/${esc(obj.key)}" target="_blank">${esc(obj.key)}</a></td>
        <td>${(obj.size / 1024).toFixed(0)} KB</td>
        <td>${esc(obj.uploaded.toISOString().slice(0, 10))}</td>
        <td><button onclick="del('${esc(obj.key)}')">Delete</button></td>
      </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Files</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; max-width: 720px; }
  h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 20px; }
  th, td { border-bottom: 1px solid #e4e7ec; padding: 8px; text-align: left; }
  th { background: #f7f8fa; }
  button { background: #d33; color: #fff; border: 0; padding: 4px 10px; border-radius: 4px; cursor: pointer; }
  #drop { border: 2px dashed #c7cbd1; border-radius: 8px; padding: 32px; text-align: center; color: #6b7280; }
  #drop.over { border-color: #1a56db; color: #1a56db; }
  #status { margin-top: 10px; font-size: 14px; color: #6b7280; }
</style></head><body>
  <h1>Files</h1>
  <div id="drop">Drop a file here, or click to choose one.
    <input type="file" id="picker" style="display:none">
  </div>
  <p id="status"></p>
  <table>
    <tr><th>File</th><th>Size</th><th>Uploaded</th><th></th></tr>
    ${rows}
  </table>

  <script>
    const drop = document.getElementById("drop");
    const picker = document.getElementById("picker");
    const status = document.getElementById("status");

    drop.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => picker.files[0] && upload(picker.files[0]));

    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      if (e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);
    });

    async function upload(file) {
      status.textContent = "Uploading " + file.name + "...";
      const res = await fetch("/admin/files/upload?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      const out = await res.json();
      status.textContent = out.ok ? "Done. Reloading..." : (out.error || "Upload failed.");
      if (out.ok) setTimeout(() => location.reload(), 600);
    }

    async function del(key) {
      if (!confirm("Delete " + key + "?")) return;
      await fetch("/admin/files/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      location.reload();
    }
  </script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

This reuses `authOk()`, `askForPassword()`, `json()`, and `esc()` from guide 03. Do not redefine any of them.

## Step 5. Deploy

```
npx wrangler deploy
```

Go to `https://yourbusiness.com/admin/files`, log in with the same admin password from guide 03, and drop in a photo.

Copy the link it gives you. Open it in a private browser window. It should load with no login required, because file serving at `/f/` is intentionally public. The admin page is what is protected, not the files themselves once shared.

---

## Verify it works

- [ ] Uploading a file succeeds and the table refreshes
- [ ] The `/f/<key>` link opens the file with no password prompt
- [ ] A PDF opens inline or downloads correctly, not as garbled text
- [ ] Deleting a file removes it, and the old link now 404s
- [ ] `/admin/files` itself still requires the password

---

## What breaks and how to fix it

**"env.FILES is undefined"**
The `[[r2_buckets]]` block is missing from `wrangler.toml`, or the `binding` name does not match `FILES` exactly, case included.

**Upload fails with no error message shown**
Open your browser's developer console (F12) and check the Network tab for the actual response. Usually a typo in the fetch URL or a missing Content-Type header.

**"413 Request Entity Too Large"**
The file is over 100 MB, the free plan's request body ceiling. Compress it, split it, or accept this is the one real limit in this guide.

**A photo downloads instead of displaying in the browser**
The browser upload did not send a Content-Type, or an old file uploaded before this was working has none stored. Re-upload it. New uploads set this automatically from the file's own type.

**File list shows the file but the link 404s**
The key in the list and the key used to serve it do not match, usually because you changed the key-generation logic after some files were already uploaded. Re-upload under the new scheme.

**Deleted a file and the old link still loads**
Cloudflare's edge cache held onto it. Wait a minute, or hard refresh. This is the `Cache-Control` header doing its job for everyone except you.

---

## What to do next

Go to **06. Free Link in Bio for Life**. The easiest one so far.

---

## Sources to verify yourself

- R2 pricing and egress: `https://developers.cloudflare.com/r2/pricing/`
- R2 Workers API: `https://developers.cloudflare.com/r2/api/workers/workers-api-reference/`
- Request body limits: `https://developers.cloudflare.com/workers/platform/limits/`
