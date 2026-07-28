export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      return subscribe(request, env);
    }

    if (url.pathname === "/admin") {
      return adminPage(request, env);
    }

    if (url.pathname === "/admin/subscribers.csv") {
      return adminCsv(request, env);
    }

    // Everything else: serve the static files from /public
    return env.ASSETS.fetch(request);
  }
};

// ---------------------------------------------------------------
// Saving a subscriber
// ---------------------------------------------------------------

async function subscribe(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  // Honeypot. Real people never fill this in, bots always do.
  if (body.website) {
    return json({ ok: true }); // lie to the bot, save nothing
  }

  const email = clean(body.email, 200).toLowerCase();
  const source = clean(body.source, 120) || "direct";

  if (!email || !email.includes("@") || !email.includes(".")) {
    return json({ ok: false, error: "That email does not look right." }, 400);
  }

  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscribers (created_at, email, source) VALUES (?, ?, ?)`
  ).bind(new Date().toISOString(), email, source).run();

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
    `SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 500`
  ).all();

  const rows = results.map(r => `
    <tr>
      <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td>
      <td>${esc(r.email)}</td>
      <td>${esc(r.source)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Subscribers</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 32px; }
  h1 { font-size: 22px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 16px; }
  th, td { border-bottom: 1px solid #e4e7ec; padding: 8px; text-align: left; }
  th { background: #f7f8fa; }
  a.btn { display:inline-block; background:#12151a; color:#fff; padding:8px 16px; border-radius:6px; text-decoration:none; font-size:14px; }
</style></head><body>
  <h1>Subscribers (${results.length})</h1>
  <a class="btn" href="/admin/subscribers.csv">Download CSV</a>
  <table>
    <tr><th>When</th><th>Email</th><th>Source</th></tr>
    ${rows}
  </table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function adminCsv(request, env) {
  if (!authOk(request, env)) return askForPassword();

  const { results } = await env.DB.prepare(
    `SELECT created_at, email, source FROM subscribers ORDER BY created_at DESC`
  ).all();

  const header = "created_at,email,source";
  const lines = results.map(r => [r.created_at, r.email, r.source].map(csvCell).join(","));

  return new Response([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscribers.csv"'
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
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
