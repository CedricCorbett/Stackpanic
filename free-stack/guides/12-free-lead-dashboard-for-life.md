# 12. Free Lead Dashboard for Life

**Time: 60 minutes. Cost: $0. Code: copy and paste.**

The flat list from guide 03 tells you what came in. This tells you what it means.

---

## What you get

A page showing total leads, your best-performing source, and two charts, leads by source and leads over the last 30 days, built straight from the same table guide 03 already fills.

---

## What it replaces

The usual path here is connecting a spreadsheet export to Google's Looker Studio (formerly Data Studio), wiring up a scheduled refresh, and hoping the connector does not break. It is free, technically, but it is a part-time maintenance job, not a tool. This is the same information, live, with no export step and nothing to reconnect.

---

## What is actually free and what is not

All of it. No charting library, no dependency, the charts are plain SVG built from your own query results.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with at least a handful of test leads captured, since an empty chart proves nothing

---

## Step 1. Add the route

Above the `/admin/leads.csv` check in `src/index.js`:

```js
    if (url.pathname === "/admin/dashboard" && request.method === "GET") {
      return dashboardPage(request, env);
    }

```

## Step 2. Add the chart renderer

At the bottom of the file:

```js
// ---------------------------------------------------------------
// Lead dashboard (guide 12)
// ---------------------------------------------------------------

function svgBarChart(data, { width = 640, height = 180, barColor = "#1a56db" } = {}) {
  if (!data.length) return "<p>No data yet.</p>";
  const max = Math.max(...data.map(d => d.count), 1);
  const barWidth = width / data.length;
  const bars = data.map((d, i) => {
    const barHeight = (d.count / max) * (height - 30);
    const x = i * barWidth;
    const y = height - barHeight - 20;
    const showCount = data.length <= 12;
    const fontSize = data.length > 20 ? 8 : 10;
    return `
      <rect x="${x + 2}" y="${y}" width="${Math.max(barWidth - 4, 1)}" height="${barHeight}" fill="${barColor}" rx="2"/>
      ${showCount ? `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="11" fill="#111">${d.count}</text>` : ""}
      <text x="${x + barWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="${fontSize}" fill="#666">${esc(String(d.label))}</text>
    `;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}">${bars}</svg>`;
}
```

> **Why a hand-rolled SVG instead of a charting library.** Two bar charts made of rectangles do not need a dependency. Every `<rect>` here is just a positioned, colored box, the "chart" is arithmetic, not a library's job. Reach for a real charting tool once you need pie charts, tooltips, or interactivity, none of which a lead count needs.

## Step 3. Add the dashboard page

```js
async function dashboardPage(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) as count FROM leads`).first();
  const total = totalRow.count;

  const { results: bySource } = await env.DB.prepare(
    `SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC LIMIT 8`
  ).all();

  const { results: byDayRaw } = await env.DB.prepare(
    `SELECT date(created_at) as day, COUNT(*) as count FROM leads
     WHERE created_at >= date('now', '-29 days') GROUP BY day`
  ).all();

  // Fill in every day of the last 30, including zero-lead days,
  // so the trend is not misleadingly compressed to only busy days.
  const dayMap = Object.fromEntries(byDayRaw.map(r => [r.day, r.count]));
  const byDay = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    byDay.push({ label: key.slice(5), count: dayMap[key] || 0 });
  }

  const topSource = bySource[0]?.source || "none yet";
  const last30 = byDay.reduce((sum, d) => sum + d.count, 0);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Dashboard</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; max-width: 700px; }
  h1 { font-size: 22px; }
  h2 { font-size: 16px; margin-top: 36px; }
  .stats { display: flex; gap: 16px; margin: 20px 0; flex-wrap: wrap; }
  .stat { border: 1px solid #e4e7ec; border-radius: 8px; padding: 16px; flex: 1; min-width: 140px; }
  .stat b { display: block; font-size: 24px; }
  .stat span { color: #6b7280; font-size: 13px; }
  svg { width: 100%; height: auto; margin-top: 10px; }
</style></head><body>
  <h1>Lead Dashboard</h1>
  <div class="stats">
    <div class="stat"><b>${total}</b><span>total leads, all time</span></div>
    <div class="stat"><b>${esc(topSource)}</b><span>top source</span></div>
    <div class="stat"><b>${last30}</b><span>leads, last 30 days</span></div>
  </div>

  <h2>Leads by source</h2>
  ${svgBarChart(bySource.map(r => ({ label: r.source || "direct", count: r.count })))}

  <h2>Leads, last 30 days</h2>
  ${svgBarChart(byDay, { height: 140 })}
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

This reuses `authOk()`, `askForPassword()`, and `esc()` from guide 03.

## Step 4. Deploy

```
npx wrangler deploy
```

Go to `https://yourbusiness.com/admin/dashboard`.

---

## Verify it works

- [ ] Total leads matches the count you see on `/admin`
- [ ] The source chart shows a bar per distinct source value, tallest first
- [ ] The 30-day chart shows 30 bars, including flat zero-height ones for days with no leads, not just the days that had activity
- [ ] Submitting a new test lead and refreshing updates both the total and the relevant chart

---

## What breaks and how to fix it

**"No data yet" where you expected charts**
No leads exist in the database yet at all, or `env.DB` points at a different database than the one guide 03 wrote to. Confirm with `/admin` first, if leads show up there, they will show up here.

**One bar is enormous and the rest are unreadable slivers**
Correct behavior, not a bug, if one source genuinely dominates. The chart scales every bar relative to the largest value. A skewed chart is often the actual finding.

**Day labels overlap and are unreadable**
This is a known limit of a simple hand-rolled chart at 30 data points on a narrow phone screen. Rotate your phone to landscape, or widen the `width` parameter passed to `svgBarChart` for the day chart if you view this mostly on a laptop.

**Source names show up as "direct" for everything**
Every lead's `source` column is empty, meaning the `?v=` tag from guide 03 is not being passed on the links driving your traffic. Check that ad and post links actually include `?v=something`.

**Dashboard shows fewer leads than `/admin/leads.csv`**
The dashboard's day chart only covers the last 30 days by design. The total stat at the top counts everything, all time, so compare against that number instead.

---

## What to do next

Go to **14. Free Pixel and CAPI Server for Life** if you have not already, then **15**. Guide 13, Free CRM for Life, is the last guide in this run, and it pulls this dashboard, guide 14's attribution data, and guide 15's conversion tracking into one working pipeline.

---

## Sources to verify yourself

- SQLite date functions, used in the day-by-day query: `https://www.sqlite.org/lang_datefunc.html`
