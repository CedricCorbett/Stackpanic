# 24. Free Social Management Suite for Life

**Time: 2 hours for the queue, more if you build Part B. Cost: $0. Code: copy and paste.**

One of the five hooks this whole library started from. It gets real weight.

---

## What you get

A calendar where you upload media, write a caption, and set a date and time. At that time, a message lands wherever guide 19 sends it, "time to post," with the caption and the media link right there. Optionally, if you clear Meta's own approval process, it posts itself.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Later | $25 to $80 per month | Media storage limits on lower tiers |
| Hootsuite | $99 to $249 per month | Priced for agencies managing many accounts |
| Buffer | $6 to $120 per month | Cheaper entry, but auto-publish still sits behind their infrastructure, not yours |

---

## What is actually free and what is not

The queue, the storage, and the reminder system: entirely free, built on guide 05's R2 and a new piece, Cloudflare's scheduled Workers.

**Real auto-publishing to Instagram is a separate, honest conversation, covered in Part B.** The API access itself costs nothing. Getting Meta to approve your app for it is not a technical step you control, it is a review process that takes two to four weeks and can be rejected. Nobody selling a scheduling tool makes this part disappear, they have simply already been through it. Part A does not need it at all.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- Guide 05 complete, R2 bucket and file routes working
- Guide 19 recommended, for the reminder notification, Part A still works without it, just silently, check `/admin/queue` manually instead

---

# Part A. The queue, storage, and reminders

## Step 1. Add the table

Create `schema-queue.sql`:

```sql
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  media_key     TEXT NOT NULL,
  caption       TEXT,
  platform      TEXT NOT NULL DEFAULT 'instagram',
  scheduled_for TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  created_at    TEXT NOT NULL
);
```

```
npx wrangler d1 execute leads --remote --file=./schema-queue.sql
```

## Step 2. Add the Cron Trigger

Open `wrangler.toml`, add:

```toml
[triggers]
crons = ["*/15 * * * *"]
```

That runs every 15 minutes. This is the first guide in the library using scheduled Workers instead of request-triggered ones, a Worker that wakes up on a timer with no visitor involved at all.

## Step 3. Add the routes

Above the `/admin/leads.csv` check in `src/index.js`:

```js
    if (url.pathname === "/admin/queue" && request.method === "GET") {
      return queuePage(request, env);
    }

    if (url.pathname === "/admin/queue/upload" && request.method === "POST") {
      return queueUpload(request, env, url);
    }

    if (url.pathname === "/admin/queue/schedule" && request.method === "POST") {
      return scheduleQueueItem(request, env);
    }

    if (url.pathname === "/admin/queue/delete" && request.method === "POST") {
      return deleteQueueItem(request, env);
    }

```

## Step 4. Add the logic

```js
// ---------------------------------------------------------------
// Content queue (guide 24)
// ---------------------------------------------------------------

async function queueUpload(request, env, url) {
  if (!authOk(request, env)) return askForPassword();

  const name = url.searchParams.get("name");
  const contentType = request.headers.get("Content-Type") || "application/octet-stream";
  if (!name) return json({ ok: false, error: "Missing filename." }, 400);

  const key = "queue/" + crypto.randomUUID().slice(0, 8) + "-" + name.replace(/[^a-zA-Z0-9._-]/g, "_");
  await env.FILES.put(key, request.body, { httpMetadata: { contentType } });

  return json({ ok: true, key });
}

async function scheduleQueueItem(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const mediaKey = clean(body.mediaKey, 300);
  const caption = clean(body.caption, 2200);
  const scheduledFor = clean(body.scheduledFor, 40);
  const platform = clean(body.platform, 20) || "instagram";

  if (!mediaKey || !scheduledFor) {
    return json({ ok: false, error: "Need media and a scheduled time." }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO scheduled_posts (media_key, caption, platform, scheduled_for, status, created_at)
     VALUES (?, ?, ?, ?, 'queued', ?)`
  ).bind(mediaKey, caption, platform, scheduledFor, new Date().toISOString()).run();

  return json({ ok: true });
}

async function deleteQueueItem(request, env) {
  if (!authOk(request, env)) return askForPassword();
  const body = await request.json().catch(() => ({}));
  if (!body.id) return json({ ok: false, error: "Missing id." }, 400);
  await env.DB.prepare(`DELETE FROM scheduled_posts WHERE id = ?`).bind(body.id).run();
  return json({ ok: true });
}

// Guide 19 is recommended, not required (see Prerequisites above). If it was
// never built, notifyTeam does not exist at all, and calling an undefined
// function throws a ReferenceError before a .catch() ever gets attached to
// it, killing the entire scheduled() run, including every post after the
// first. This is the one place both Part A and Part B ever try to notify
// anyone, so every call below goes through here instead of notifyTeam
// directly.
async function notify(env, message) {
  if (typeof notifyTeam !== "function") {
    console.log("(guide 19 not installed, would have notified):", message);
    return;
  }
  return notifyTeam(env, message).catch(err => console.error("Notification failed:", err.message));
}

async function queuePage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT * FROM scheduled_posts ORDER BY scheduled_for ASC`
  ).all();

  const rows = results.map(p => `
    <div class="item">
      <img src="/f/${esc(p.media_key)}" loading="lazy">
      <div class="meta">
        <b>${esc(new Date(p.scheduled_for).toLocaleString())}</b>
        <span class="status status-${esc(p.status)}">${esc(p.status)}</span>
        <p>${esc((p.caption || "").slice(0, 140))}</p>
        <button onclick="del(${p.id})">Delete</button>
      </div>
    </div>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Content Queue</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; max-width: 720px; }
  h1 { font-size: 22px; }
  #uploader { border: 2px dashed #c7cbd1; border-radius: 8px; padding: 24px; text-align: center; color: #6b7280; }
  form { display: flex; flex-direction: column; gap: 10px; margin: 20px 0; max-width: 420px; }
  input, textarea { padding: 10px; border: 1px solid #d7dbe0; border-radius: 6px; font-size: 14px; }
  button { background: #12151a; color: #fff; border: 0; padding: 10px 16px; border-radius: 6px; cursor: pointer; }
  .item { display: flex; gap: 14px; border: 1px solid #e4e7ec; border-radius: 8px; padding: 12px; margin-top: 12px; }
  .item img { width: 90px; height: 90px; object-fit: cover; border-radius: 6px; }
  .status { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #f0f0ec; }
  .status-reminded { background: #dcfce7; }
  .item button { background: #d33; font-size: 12px; padding: 4px 10px; margin-top: 6px; }
</style></head><body>
  <h1>Content Queue</h1>

  <div id="uploader">Drop media here, or click to choose.
    <input type="file" id="picker" style="display:none">
  </div>
  <p id="uploadStatus"></p>

  <form id="scheduleForm">
    <input type="hidden" id="mediaKey">
    <textarea id="caption" placeholder="Caption" rows="3"></textarea>
    <input type="datetime-local" id="scheduledFor" required>
    <button type="submit">Add to queue</button>
  </form>

  ${rows}

  <script>
    const uploader = document.getElementById("uploader");
    const picker = document.getElementById("picker");
    const uploadStatus = document.getElementById("uploadStatus");

    uploader.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => picker.files[0] && upload(picker.files[0]));

    async function upload(file) {
      uploadStatus.textContent = "Uploading...";
      const res = await fetch("/admin/queue/upload?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      const out = await res.json();
      if (out.ok) {
        document.getElementById("mediaKey").value = out.key;
        uploadStatus.textContent = "Uploaded. Now set a caption and time below.";
      } else {
        uploadStatus.textContent = out.error || "Upload failed.";
      }
    }

    document.getElementById("scheduleForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const mediaKey = document.getElementById("mediaKey").value;
      if (!mediaKey) { alert("Upload media first."); return; }

      // datetime-local gives back a plain "2026-08-15T14:30" with no timezone,
      // which new Date() correctly reads as your browser's local time. Convert
      // it to a real UTC instant here, before it ever reaches the server: the
      // cron trigger below compares against new Date().toISOString(), and
      // comparing a bare local string against a UTC one made every post fire
      // however many hours off UTC you are, not at the time you actually picked.
      const scheduledFor = new Date(document.getElementById("scheduledFor").value).toISOString();

      await fetch("/admin/queue/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaKey,
          caption: document.getElementById("caption").value,
          scheduledFor
        })
      });
      location.reload();
    });

    async function del(id) {
      if (!confirm("Remove this from the queue?")) return;
      await fetch("/admin/queue/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      });
      location.reload();
    }
  </script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

This reuses `authOk()`, `askForPassword()`, `esc()`, `clean()`, `json()`, and `env.FILES` from guides 03 and 05.

## Step 5. Add the scheduled handler

At the very bottom of the file, add a second export alongside `fetch`:

```js
export default {
  async fetch(request, env) {
    // ... your existing fetch handler, unchanged ...
  },

  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();

    const { results } = await env.DB.prepare(
      `SELECT * FROM scheduled_posts WHERE status = 'queued' AND scheduled_for <= ?`
    ).bind(now).all();

    for (const post of results) {
      const preview = (post.caption || "(no caption)").slice(0, 60);
      await notify(env, `Time to post: "${preview}" — https://yourbusiness.com/f/${post.media_key}`);

      await env.DB.prepare(`UPDATE scheduled_posts SET status = 'reminded' WHERE id = ?`).bind(post.id).run();
    }
  }
};
```

You cannot have two `export default` blocks. Merge this into your existing one, the `fetch` method stays exactly as it already is, `scheduled` is new.

> **Why this is a completely different trigger than everything else in this file.** Every other function in this project runs because a request arrived, a visitor, a webhook, an API call. `scheduled` runs because a clock struck, with nobody watching. It has no `request` object because there is no request. This is the same underlying idea as a cron job on a server, except there is no server to maintain.

## Step 6. Deploy

```
npx wrangler deploy
```

Wrangler will show the cron trigger was registered. Add a test post scheduled a few minutes out, wait, check that the reminder arrives on schedule.

---

## Verify it works, Part A

- [ ] Uploading media and scheduling it shows up in the queue list
- [ ] A post scheduled a few minutes in the future produces a reminder notification within 15 minutes of that time
- [ ] After the reminder fires, the post's status changes from `queued` to `reminded`
- [ ] Deleting a queued post removes it and it never fires a reminder
- [ ] `npx wrangler tail` during the scheduled window shows the cron actually running, even with nobody visiting the site

---

# Part B. Real auto-publish to Instagram

Optional, and genuinely harder than everything else in this library, not because the code is difficult, because Meta's own approval process is out of your hands. Read this whole section before starting, so the timeline does not surprise you partway through.

## What this actually requires

- An Instagram account converted to Professional (Business or Creator), free, done in the Instagram app itself
- That account connected to a Facebook Page
- A Meta developer app, created at `https://developers.facebook.com`
- App Review approval for the `instagram_business_content_publish` permission for most setups. Review timelines are not published by Meta and vary; budget a few weeks and expect the possibility of a rejection and resubmission. Some solo-owner setups may qualify for Standard Access without a review at all — check your own app's access level in the developer dashboard before assuming you need to wait
- A long-lived access token for that app, which itself expires and needs periodic refreshing

None of this is a guide can shortcut. It is Meta's gate, not a technical hurdle.

## Step 1. Extend the schema

Create a new file, `schema-queue-publish.sql`:

```sql
ALTER TABLE scheduled_posts ADD COLUMN ig_container_id TEXT;
```

```
npx wrangler d1 execute leads --remote --file=./schema-queue-publish.sql
```

## Step 2. Store your credentials, once approved

```
npx wrangler secret put IG_USER_ID
npx wrangler secret put IG_ACCESS_TOKEN
```

## Step 3. Add the publish functions

```js
// ---------------------------------------------------------------
// Instagram auto-publish (guide 24, Part B)
// ---------------------------------------------------------------

// Every call here sends IG_ACCESS_TOKEN as an Authorization header, never in
// the URL or the logged request. A token in a query string ends up in
// `npx wrangler tail` and Cloudflare's own request logs in plain text; a
// header does not. See guide 14's note on this same point.
async function createIgContainer(env, { mediaUrl, caption, isVideo }) {
  const params = new URLSearchParams({ caption: caption || "" });
  params.set(isVideo ? "video_url" : "image_url", mediaUrl);
  if (isVideo) params.set("media_type", "REELS");

  const res = await fetch(`https://graph.facebook.com/v25.0/${env.IG_USER_ID}/media`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.IG_ACCESS_TOKEN}` },
    body: params
  });
  const data = await res.json();
  if (!data.id) throw new Error("Container creation failed: " + JSON.stringify(data));
  return data.id;
}

async function checkIgContainerStatus(env, containerId) {
  const res = await fetch(
    `https://graph.facebook.com/v25.0/${containerId}?fields=status_code`,
    { headers: { "Authorization": `Bearer ${env.IG_ACCESS_TOKEN}` } }
  );
  const data = await res.json();
  return data.status_code;
}

async function publishIgContainer(env, containerId) {
  const res = await fetch(`https://graph.facebook.com/v25.0/${env.IG_USER_ID}/media_publish`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.IG_ACCESS_TOKEN}` },
    body: new URLSearchParams({ creation_id: containerId })
  });
  const data = await res.json();
  if (!data.id) throw new Error("Publish failed: " + JSON.stringify(data));
  return data.id;
}
```

> **Why there is no polling loop inside one function.** Instagram can take anywhere from a few seconds to a couple of minutes to finish processing a container, video especially. A Worker is not built to sit and wait for minutes inside a single invocation. Instead, the state lives in the database, and the cron trigger you already built checks on it every 15 minutes, picking up exactly where the last run left off.

## Step 4. Extend the scheduled handler

Replace the `scheduled` function from Part A with this version, which now moves posts through `queued` → `publishing` → `posted`:

```js
  async scheduled(event, env, ctx) {
    const now = new Date().toISOString();

    // Stage one: due posts get a container created and a reminder sent either way.
    const { results: due } = await env.DB.prepare(
      `SELECT * FROM scheduled_posts WHERE status = 'queued' AND scheduled_for <= ?`
    ).bind(now).all();

    for (const post of due) {
      const mediaUrl = `https://yourbusiness.com/f/${post.media_key}`;
      const preview = (post.caption || "(no caption)").slice(0, 60);

      if (env.IG_ACCESS_TOKEN) {
        try {
          const containerId = await createIgContainer(env, {
            mediaUrl, caption: post.caption, isVideo: post.media_key.match(/\.(mp4|mov)$/i)
          });
          await env.DB.prepare(
            `UPDATE scheduled_posts SET status = 'publishing', ig_container_id = ? WHERE id = ?`
          ).bind(containerId, post.id).run();
        } catch (err) {
          await notify(env, `Auto-publish failed to start: "${preview}", posting manually needed`);
          await env.DB.prepare(`UPDATE scheduled_posts SET status = 'failed' WHERE id = ?`).bind(post.id).run();
        }
      } else {
        await notify(env, `Time to post: "${preview}" — ${mediaUrl}`);
        await env.DB.prepare(`UPDATE scheduled_posts SET status = 'reminded' WHERE id = ?`).bind(post.id).run();
      }
    }

    // Stage two: anything mid-publish gets checked, and finished if ready.
    const { results: publishing } = await env.DB.prepare(
      `SELECT * FROM scheduled_posts WHERE status = 'publishing'`
    ).all();

    for (const post of publishing) {
      const status = await checkIgContainerStatus(env, post.ig_container_id).catch(() => "ERROR");

      if (status === "FINISHED") {
        await publishIgContainer(env, post.ig_container_id).catch(err => console.error("Publish failed:", err.message));
        await env.DB.prepare(`UPDATE scheduled_posts SET status = 'posted' WHERE id = ?`).bind(post.id).run();
        await notify(env, `Posted: "${(post.caption || "").slice(0, 60)}"`);
      } else if (status === "ERROR" || status === "EXPIRED") {
        await env.DB.prepare(`UPDATE scheduled_posts SET status = 'failed' WHERE id = ?`).bind(post.id).run();
        await notify(env, `Auto-publish failed: "${(post.caption || "").slice(0, 60)}", post it manually`);
      }
      // still IN_PROGRESS: leave it, the next run 15 minutes from now checks again
    }
  }
```

If `IG_ACCESS_TOKEN` is never set, this behaves exactly like Part A, a reminder only. Nothing breaks by skipping Part B entirely.

## Step 5. Deploy and test with a real approved app

```
npx wrangler deploy
```

Schedule a real post a few minutes out. Watch `npx wrangler tail`. You should see a container get created within 15 minutes of the scheduled time, then, within another cron cycle or two, a publish confirmation.

---

## Verify it works, Part B

- [ ] With `IG_ACCESS_TOKEN` unset, the queue behaves exactly like Part A alone
- [ ] With it set and an approved app, a scheduled post moves through `queued`, `publishing`, `posted` over one or two cron cycles
- [ ] A deliberately broken image URL produces a `failed` status and a notification, not a silent stall
- [ ] The published post actually appears on Instagram, checked directly, not just inferred from the database status

---

## What breaks and how to fix it

**Uploads work but the queue list shows broken images**
The `/f/` route from guide 05 is what serves these, confirm that guide is fully deployed, not just the R2 binding added.

**Reminder never fires even well past the scheduled time**
Check that `[triggers]` with the `crons` array actually deployed, `npx wrangler deployments list` or the Cloudflare dashboard's Triggers tab for this Worker should show it registered. A typo in the cron syntax fails silently on deploy in some cases, redeploy and check the dashboard directly.

**Container creation fails immediately with a permissions error**
`instagram_business_content_publish` was not actually approved yet, or the token belongs to a different app than the one that got approved. Both are the review process, not this code.

**Container sits at `IN_PROGRESS` for hours**
This does happen with larger video files. It will resolve or expire within 24 hours per Meta's own container lifecycle, nothing to fix on your end beyond waiting for the next few cron cycles.

**Rate limit errors when scheduling many posts close together**
Instagram caps API-published posts per rolling 24-hour window, the exact number has moved between documentation versions, check `https://developers.facebook.com/docs/instagram-platform/content-publishing/` for the current figure before scheduling in bulk.

---

## What to do next

Go to **25. Free Auto-DM for Life**. Lighter than this one, and it reuses the exact notification pattern you just built.

---

## Sources to verify yourself

- Content publishing overview: `https://developers.facebook.com/docs/instagram-platform/content-publishing/`
- Cloudflare Cron Triggers: `https://developers.cloudflare.com/workers/configuration/cron-triggers/`
