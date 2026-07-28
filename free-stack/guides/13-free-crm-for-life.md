# 13. Free CRM for Life

**Time: 2 hours. Cost: $0. Code: copy and paste.**

Not a new system. The same leads table from guide 03, given a pipeline, notes, and a direct line to the conversion reporting from guide 15.

---

## What you get

A board with five columns, New, Contacted, Qualified, Won, Lost. Every lead from guide 03 sits in one of them. Move a card, leave a note. Move something to Won, and the exact same Meta reporting guide 15 built fires automatically, no separate step, no remembering to do it later.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| GoHighLevel | $97 to $497 per month | Pipeline is one small piece of a much bigger, harder-to-learn platform |
| HubSpot Starter | $20 per seat per month | Free tier caps contacts and strips automation |
| Pipedrive | $14 to $99 per month | Solid pipeline, but it is the only thing it does, everything else in this library stays disconnected from it |

The real cost these tools charge for is not the pipeline view itself, a list of columns is not hard. It is having your leads, your ad attribution, and your conversion reporting all live in the same place instead of three disconnected tools. That is what this guide actually builds.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete
- Guide 14 complete
- Guide 15 complete, this guide directly refactors code from it, so it has to exist first
- Guide 12 recommended, not required, the dashboard link on this page assumes it exists

---

## Step 1. Add the pipeline columns

Create `schema-crm.sql`:

```sql
ALTER TABLE leads ADD COLUMN stage TEXT NOT NULL DEFAULT 'new';

CREATE TABLE IF NOT EXISTS lead_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  note       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes (lead_id);
```

```
npx wrangler d1 execute leads --remote --file=./schema-crm.sql
```

Every existing lead gets `stage = 'new'` automatically, that default applies retroactively to rows that already existed.

## Step 2. Split guide 15's conversion logic in two

This is the one real refactor in this library. Find `markConverted()` from guide 15. Replace it with these two functions, a plain data function and a thin HTTP wrapper around it:

```js
async function recordConversion(env, { leadId, value }) {
  const lead = await env.DB.prepare(`SELECT * FROM leads WHERE id = ?`).bind(leadId).first();
  if (!lead || lead.converted_at) return; // does not exist, or already converted

  await env.DB.prepare(
    `UPDATE leads SET converted_at = ?, conversion_value = ? WHERE id = ?`
  ).bind(new Date().toISOString(), value, leadId).run();

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
  }).catch(err => console.error("Conversion CAPI failed:", err.message));
}

async function markConverted(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const leadId = Number(body.leadId);
  const value = Number(body.value) || 0;
  if (!leadId) return json({ ok: false, error: "Missing lead ID." }, 400);

  await recordConversion(env, { leadId, value });
  return json({ ok: true });
}
```

`/admin` still works exactly as guide 15 left it, its "Mark converted" button calls `markConverted`, which now calls `recordConversion` underneath. The CRM board is about to call `recordConversion` directly for the same reason, so the reporting logic exists in exactly one place, not two.

> **Why this split matters beyond just this guide.** The moment the same real action, reporting a conversion, can be triggered from two different buttons in two different parts of the app, keeping that logic in one function instead of two is the difference between one bug to fix later and two.

## Step 3. Add the routes

Above the `/admin/leads.csv` check:

```js
    if (url.pathname === "/admin/crm" && request.method === "GET") {
      return crmPage(request, env);
    }

    if (url.pathname === "/admin/crm/move" && request.method === "POST") {
      return moveLeadStage(request, env);
    }

    if (url.pathname === "/admin/crm/note" && request.method === "POST") {
      return addLeadNote(request, env);
    }

```

## Step 4. Add the stage list and move/note handlers

```js
// ---------------------------------------------------------------
// CRM (guide 13)
// ---------------------------------------------------------------

const STAGES = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" }
];

async function moveLeadStage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const leadId = Number(body.leadId);
  const stage = clean(body.stage, 20);
  const value = Number(body.value) || 0;

  if (!leadId || !STAGES.some(s => s.key === stage)) {
    return json({ ok: false, error: "Invalid lead or stage." }, 400);
  }

  await env.DB.prepare(`UPDATE leads SET stage = ? WHERE id = ?`).bind(stage, leadId).run();

  // Moving into Won is the moment this becomes real revenue. Report
  // it through the exact same path guide 15 built, nothing new here.
  if (stage === "won") {
    await recordConversion(env, { leadId, value });
  }

  return json({ ok: true });
}

async function addLeadNote(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const body = await request.json().catch(() => ({}));
  const leadId = Number(body.leadId);
  const note = clean(body.note, 1000);

  if (!leadId || !note) return json({ ok: false, error: "Missing lead or note text." }, 400);

  await env.DB.prepare(
    `INSERT INTO lead_notes (lead_id, created_at, note) VALUES (?, ?, ?)`
  ).bind(leadId, new Date().toISOString(), note).run();

  return json({ ok: true });
}
```

## Step 5. Build the board

```js
async function crmPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results: leads } = await env.DB.prepare(
    `SELECT * FROM leads ORDER BY created_at DESC LIMIT 300`
  ).all();

  const { results: notes } = await env.DB.prepare(
    `SELECT * FROM lead_notes ORDER BY created_at ASC`
  ).all();

  const notesByLead = {};
  notes.forEach(n => { (notesByLead[n.lead_id] ||= []).push(n); });

  const columns = STAGES.map(stage => {
    const stageLeads = leads.filter(l => (l.stage || "new") === stage.key);
    const cards = stageLeads.map(l => leadCard(l, stage.key, notesByLead[l.id] || [])).join("");
    return `
      <div class="column">
        <h2>${esc(stage.label)} <span class="count">${stageLeads.length}</span></h2>
        <div class="cards">${cards || '<p class="empty">Nothing here.</p>'}</div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>CRM</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: -apple-system, sans-serif; margin: 24px; background: #f7f8fa; }
  h1 { font-size: 20px; display: flex; justify-content: space-between; align-items: center; }
  h1 a { font-size: 13px; font-weight: 400; }
  .board { display: flex; gap: 14px; margin-top: 20px; overflow-x: auto; padding-bottom: 20px; }
  .column { flex: 0 0 240px; background: #fff; border-radius: 8px; border: 1px solid #e4e7ec; padding: 12px; }
  .column h2 { font-size: 14px; display: flex; justify-content: space-between; }
  .count { color: #6b7280; font-weight: 400; }
  .card { background: #f7f8fa; border: 1px solid #e4e7ec; border-radius: 6px; padding: 10px; margin-top: 10px; font-size: 13px; }
  .card b { font-size: 14px; }
  .badge { background: #dcfce7; color: #166534; font-size: 11px; padding: 2px 6px; border-radius: 4px; }
  .meta { color: #6b7280; margin-top: 4px; }
  .note { background: #fff; border-radius: 4px; padding: 6px; margin-top: 4px; font-size: 12px; }
  .actions { margin-top: 8px; display: flex; gap: 6px; }
  select, .actions button { font-size: 12px; padding: 4px; border-radius: 4px; border: 1px solid #d7dbe0; }
  .empty { color: #9ca3af; font-size: 12px; }
</style></head><body>
  <h1>Pipeline <a href="/admin/dashboard">View dashboard</a></h1>
  <div class="board">${columns}</div>

  <script>
    async function moveStage(leadId, stage) {
      if (!stage) return;
      let value = 0;
      if (stage === "won") {
        const raw = prompt("Sale value in dollars? Enter 0 if none.");
        if (raw === null) return;
        value = Number(raw) || 0;
      }
      await fetch("/admin/crm/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, stage, value })
      });
      location.reload();
    }

    async function addNote(leadId) {
      const note = prompt("Note:");
      if (!note) return;
      await fetch("/admin/crm/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, note })
      });
      location.reload();
    }
  </script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function leadCard(lead, currentStage, leadNotes) {
  const moveOptions = STAGES
    .filter(s => s.key !== currentStage)
    .map(s => `<option value="${s.key}">Move to ${esc(s.label)}</option>`)
    .join("");

  const notesHtml = leadNotes.map(n => `<p class="note">${esc(n.note)}</p>`).join("");

  const convertedBadge = lead.converted_at
    ? `<span class="badge">Converted, $${Number(lead.conversion_value || 0).toFixed(2)}</span>`
    : "";

  return `
    <div class="card">
      <b>${esc(lead.name)}</b> ${convertedBadge}
      <div class="meta">${esc(lead.email)} &middot; ${esc(lead.source || "direct")}</div>
      ${notesHtml}
      <div class="actions">
        <select onchange="moveStage(${lead.id}, this.value); this.value=''">
          <option value="">Move to...</option>
          ${moveOptions}
        </select>
        <button onclick="addNote(${lead.id})">+ Note</button>
      </div>
    </div>`;
}
```

This reuses `authOk()`, `askForPassword()`, `esc()`, `clean()`, `json()`, `sendCapiEvent()`, and now `recordConversion()`, all already in the file.

## Step 6. Deploy

```
npx wrangler deploy
```

Go to `https://yourbusiness.com/admin/crm`.

---

## Verify it works

- [ ] Every existing lead from guide 03 shows up in the New column
- [ ] Moving a card to another stage updates it immediately on reload
- [ ] Moving a card to Won prompts for a value, then shows the green Converted badge
- [ ] That same Won move produces a Purchase event in Meta's Test events, confirming `recordConversion` fired correctly
- [ ] Moving an already-converted lead to a different stage and back to Won does not send a second Purchase event, `recordConversion` checks `lead.converted_at` first
- [ ] Adding a note shows it on the card after reload
- [ ] `/admin` still works and its own "Mark converted" button still functions, confirming the guide 15 refactor did not break the original path

---

## What breaks and how to fix it

**"Invalid lead or stage" when moving a card**
The `stage` value sent does not exactly match one of the keys in `STAGES`, almost always a typo introduced while editing. The five valid keys are `new`, `contacted`, `qualified`, `won`, `lost`, lowercase, no spaces.

**Moving to Won does not trigger a Purchase event**
Check that `META_PIXEL_ID` and `META_CAPI_TOKEN` are still set, `npx wrangler secret list` shows names but not values, confirm both are present. If they are, check `npx wrangler tail` during the move for the actual error from `sendCapiEvent`.

**A lead that was already converted through `/admin` shows no badge on the board**
Reload the CRM page, the board only reflects the database state at page load, same as every other page in this library, there is no live sync between tabs.

**Notes disappear after adding one**
The `lead_id` sent from `addNote()` does not match the card's actual database id, check that `leadCard()` is using `lead.id`, the database's own row id, not something else.

**Board loads with every lead crammed into New, even ones you moved before**
`schema-crm.sql` was run without `--remote`, so the `stage` column exists locally but not on the live database, and every read falls back to the `new` default.

**Existing `/admin/leads.csv` export now looks different**
It should not, this guide never touches the CSV export logic from guide 03. If columns look different, something else changed that file, check recent edits.

---

## What to do next

That closes the attribution spine, capture, dashboard, pixel and server tracking, offline conversions, and a pipeline to work from, all reading and writing the same `leads` table. Nothing in this run duplicated data between tools, because there were never multiple tools to begin with.

---

## Sources to verify yourself

- SQLite `ALTER TABLE ADD COLUMN` behavior with defaults: `https://www.sqlite.org/lang_altertable.html`
