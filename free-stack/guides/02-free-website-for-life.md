# 02. Free Website for Life

**Time: 45 minutes. Cost: $0. Code: copy and paste.**

A real business website on your own domain. No monthly fee, no page limit, no "upgrade to remove branding."

---

## What you get

A multi-page site at `https://yourbusiness.com` with a home page, a services page, and a contact page. Fast everywhere in the world. No bandwidth bill ever.

---

## What it replaces

| Tool | Cost | What they charge you for |
|---|---|---|
| Squarespace | $16 to $49 per month | The editor |
| Wix | $17 to $159 per month | Removing their ads |
| GoDaddy Website Builder | $12 to $30 per month | Hosting |
| Webflow | $14 to $39 per month | Publishing |

Squarespace Business is $276 a year. Ten years is $2,760. For a five page site.

---

## What is actually free

All of it. Cloudflare Workers static hosting on the free plan handles 100,000 requests a day with no bandwidth charge. That is roughly 20,000 page views a day.

If you exceed that, congratulations, and the bill becomes $5 a month.

---

## Prerequisites

- Guide 00 complete
- Your domain shows **Active** in Cloudflare

---

## Step 1. Make the project

In your terminal:

```
mkdir my-website
cd my-website
mkdir public
```

Everything the world sees goes in `public`.

## Step 2. Build the pages

You need four files inside `public`. Create each one with your text editor.

- **Mac:** `open -e public/index.html`, then Format, Make Plain Text
- **Windows:** `notepad public/index.html`

### `public/style.css`

One stylesheet for every page. Change the two color values at the top and the whole site changes.

```css
:root {
  --ink: #12151a;
  --accent: #1a56db;
  --paper: #ffffff;
  --muted: #5b6472;
  --line: #e4e7ec;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.6;
}

.wrap { max-width: 900px; margin: 0 auto; padding: 0 24px; }

header {
  border-bottom: 1px solid var(--line);
  padding: 20px 0;
  position: sticky;
  top: 0;
  background: var(--paper);
}

header .wrap { display: flex; justify-content: space-between; align-items: center; }

.logo { font-weight: 700; font-size: 20px; text-decoration: none; color: var(--ink); }

nav a {
  margin-left: 24px;
  text-decoration: none;
  color: var(--muted);
  font-size: 15px;
}

nav a:hover { color: var(--accent); }

.hero { padding: 80px 0; }
.hero h1 { font-size: 44px; line-height: 1.15; margin-bottom: 16px; }
.hero p { font-size: 19px; color: var(--muted); max-width: 560px; }

.btn {
  display: inline-block;
  margin-top: 28px;
  background: var(--accent);
  color: #fff;
  padding: 14px 28px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 600;
}

section { padding: 56px 0; border-top: 1px solid var(--line); }
section h2 { font-size: 30px; margin-bottom: 12px; }

.grid { display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-top: 28px; }
.card { border: 1px solid var(--line); border-radius: 8px; padding: 22px; }
.card h3 { font-size: 18px; margin-bottom: 8px; }
.card p { color: var(--muted); font-size: 15px; }

footer { padding: 40px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }

@media (max-width: 600px) {
  .hero { padding: 48px 0; }
  .hero h1 { font-size: 32px; }
  nav a { margin-left: 14px; font-size: 14px; }
}
```

### `public/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Business | What You Do</title>
  <meta name="description" content="One sentence about what you do and who you do it for.">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <div class="wrap">
      <a href="/" class="logo">Your Business</a>
      <nav>
        <a href="/">Home</a>
        <a href="/services">Services</a>
        <a href="/contact">Contact</a>
      </nav>
    </div>
  </header>

  <main class="wrap">
    <div class="hero">
      <h1>The one thing you do, said plainly.</h1>
      <p>The second line explains who it is for and what changes for them. Say it the way you would say it out loud.</p>
      <a href="/contact" class="btn">Get a quote</a>
    </div>

    <section>
      <h2>What we do</h2>
      <div class="grid">
        <div class="card">
          <h3>Service one</h3>
          <p>Two sentences. What it is. What the customer gets.</p>
        </div>
        <div class="card">
          <h3>Service two</h3>
          <p>Two sentences. What it is. What the customer gets.</p>
        </div>
        <div class="card">
          <h3>Service three</h3>
          <p>Two sentences. What it is. What the customer gets.</p>
        </div>
      </div>
    </section>
  </main>

  <footer class="wrap">
    &copy; 2026 Your Business. Greenville, SC.
  </footer>
</body>
</html>
```

### `public/services.html`

Copy `index.html`, change the `<title>`, and replace the `<main>` block with your services detail. Keep the header and footer identical.

### `public/contact.html`

Same. Copy, change the title, put your phone, email, and hours in the `<main>` block.

For now put your email address in as a plain link. Guide 03 replaces this with a real form.

## Step 3. Configure

Create `wrangler.toml` in the `my-website` folder, not in `public`.

```toml
name = "my-website"
compatibility_date = "2026-07-01"

[assets]
directory = "./public"
html_handling = "auto-trailing-slash"
not_found_handling = "404-page"
```

> **What `html_handling` does.** Without it, your visitors would have to type `/services.html`. With it, `/services` works. That is the difference between a real website and a folder of files.

> **What `not_found_handling` does.** If someone hits a URL that does not exist, Cloudflare looks for `public/404.html` and serves it. Make one. It takes 30 seconds and it is the mark of a site that was built on purpose.

## Step 4. Deploy

```
npx wrangler deploy
```

Open the `.workers.dev` URL it prints. Click through all three pages.

## Step 5. Put it on your real domain

Right now it lives at a Cloudflare subdomain. Move it to yours.

1. Cloudflare dashboard, **Compute (Workers)**, click **my-website**.
2. **Settings** tab, then **Domains & Routes**.
3. Click **Add**, then **Custom domain**.
4. Type `yourbusiness.com`. Click **Add domain**.
5. Repeat for `www.yourbusiness.com`.

Cloudflare handles the DNS and the SSL certificate automatically. Give it two or three minutes.

Open `https://yourbusiness.com`. That is your site.

> **What just happened.** Cloudflare created the DNS records and issued a free TLS certificate. The padlock in the browser is real, it renews itself forever, and you will never get an expiry email about it.

---

## Step 6. The parts everyone skips

Three things that take five minutes and matter more than the design.

**A favicon.** Put a 32x32 PNG at `public/favicon.png` and add this inside `<head>` on every page:
```html
<link rel="icon" href="/favicon.png">
```

**A sitemap.** Create `public/sitemap.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://yourbusiness.com/</loc></url>
  <url><loc>https://yourbusiness.com/services</loc></url>
  <url><loc>https://yourbusiness.com/contact</loc></url>
</urlset>
```

**A robots file.** Create `public/robots.txt`:
```
User-agent: *
Allow: /
Sitemap: https://yourbusiness.com/sitemap.xml
```

Then submit the sitemap in Google Search Console. Free.

---

## Verify it works

- [ ] `https://yourbusiness.com` loads with a padlock
- [ ] `https://www.yourbusiness.com` loads too
- [ ] All three nav links work with no `.html` in the address bar
- [ ] It looks right on your phone
- [ ] A made-up URL like `/nope` shows your 404 page
- [ ] Run it through `https://pagespeed.web.dev` and check the mobile score

That last one usually comes back near 100. Squarespace sites rarely do.

---

## Making changes later

The loop is always the same.

1. Edit the file in `public`
2. Run `npx wrangler deploy`
3. Refresh

There is no publish button and no save-then-sync. The deploy command is the publish button.

---

## What breaks and how to fix it

**404 on every page after deploying**
Your files are not inside `public`, or the `directory` line in `wrangler.toml` points somewhere else. Run `ls public` and confirm you see your HTML files.

**CSS is not loading, page looks like plain text**
The path in your `<link>` tag is wrong. It must be `/style.css` with the leading slash. Without the slash, `/services` looks for `/services/style.css`.

**Custom domain stuck on "Initializing"**
Your domain is not fully active in Cloudflare yet. Check the domain overview page. If it says Pending, finish guide 00 step 2.

**Windows saved the file as `index.html.txt`**
Notepad does this. In the Save dialog, set "Save as type" to **All Files** and type the full name with the extension.

**Changes are not showing up**
Two causes. Either you forgot `npx wrangler deploy`, or your browser cached the old version. Hard refresh with Ctrl+Shift+R or Cmd+Shift+R.

---

## What to do next

Go to **03. Free Forms for Life** and replace that plain email link on your contact page with a real form that stores leads in a database you own.

---

## Sources to verify yourself

- Static assets: `https://developers.cloudflare.com/workers/static-assets/`
- Workers pricing: `https://developers.cloudflare.com/workers/platform/pricing/`
