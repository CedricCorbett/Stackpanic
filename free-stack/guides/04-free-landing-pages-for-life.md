# 04. Free Landing Pages for Life

**Time: 60 minutes. Cost: $0. Code: copy and paste.**

One page. Every ad gets its own headline. Zero extra pages to maintain.

---

## What you get

A page at `yourbusiness.com/lp` that changes its headline, subhead, and button text based on which ad sent the visitor there. Point a roofing ad at `yourbusiness.com/lp?v=roofing` and an HVAC ad at `yourbusiness.com/lp?v=hvac`, and each visitor reads copy that matches the ad they clicked.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Unbounce | $99 to $249 per month | Charges by visitor volume |
| Leadpages | $49 to $99 per month | Page limits on cheaper tiers |
| Instapage | $199 and up | Built for agencies, priced like it |

Unbounce's $99 plan is $1,188 a year for something that is, underneath, a page that swaps four words based on a URL.

---

## What is actually free and what is not

All of it. This is not a new service, it is a routing decision inside the Worker you already deployed in guide 03. No new binding, no new bill.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working

This guide edits that file. If you only did guide 02 and skipped guide 03, do guide 03 first. There is no `src/index.js` to edit yet without it.

---

## The shape of what you are building

```
  yourbusiness.com/lp?v=hvac
                |
                v
  Your Worker checks the ?v= value
                |
        -----------------
        |               |
  known variant?   unknown or missing?
        |               |
   use its copy    use the default copy
        |               |
        -----------------
                |
                v
       one HTML page, different words
```

---

## Step 1. Add the variant list

Open `src/index.js` from guide 03. Near the top, above `export default {`, add this block.

```js
// ---------------------------------------------------------------
// Landing page variants (guide 04)
// ---------------------------------------------------------------

const VARIANTS = {
  default: {
    headline: "The service your neighborhood actually needs.",
    subhead: "Straightforward pricing. No surprise callbacks.",
    cta: "Get a free quote"
  },
  hvac: {
    headline: "Your AC dies in July. We don't.",
    subhead: "Same-day HVAC service across the area.",
    cta: "Get same-day service"
  },
  roofing: {
    headline: "One storm. One roof. Done right.",
    subhead: "Licensed roofing, insurance paperwork handled for you.",
    cta: "Get a free inspection"
  }
};

const LP_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>__HEADLINE__</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="wrap">
    <div class="hero">
      <h1>__HEADLINE__</h1>
      <p>__SUBHEAD__</p>
      <a href="/contact" class="btn">__CTA__</a>
    </div>
  </main>
</body>
</html>`;
```

Replace the three example variants with your own. Keys are whatever comes after `?v=`, lowercase, no spaces.

> **Why there is no header or navigation on this page.** A real landing page hides everything that is not the one action you want. A nav bar is an exit. This template has none on purpose.

## Step 2. Route it

Find this line in your existing `fetch` handler:

```js
if (url.pathname === "/admin/leads.csv") {
```

Add this new block directly above it:

```js
    if (url.pathname === "/lp") {
      return landingPage(url);
    }

```

Your routing chain should now check `/lp` before it falls through to the static file server.

## Step 3. Render it

At the bottom of the file, in the same section as your other helper functions, add:

```js
// ---------------------------------------------------------------
// Landing pages (guide 04)
// ---------------------------------------------------------------

function landingPage(url) {
  const key = (url.searchParams.get("v") || "default").toLowerCase();
  const variant = VARIANTS[key] || VARIANTS.default;

  const html = LP_PAGE
    .replaceAll("__HEADLINE__", esc(variant.headline))
    .replaceAll("__SUBHEAD__", esc(variant.subhead))
    .replaceAll("__CTA__", esc(variant.cta));

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
```

Do not add a second `esc()` function. Guide 03 already defined one. This one reuses it.

## Step 4. Deploy and test

```
npx wrangler deploy
```

Visit these three URLs:

- `https://yourbusiness.com/lp`
- `https://yourbusiness.com/lp?v=hvac`
- `https://yourbusiness.com/lp?v=roofing`

Each should show different copy. Try a made-up value like `?v=nonsense`. It should show the default copy, not an error.

---

## Step 5. Make it convert

Right now the button goes to `/contact`. That works, but it loses the variant tag the moment someone clicks through.

If you built guide 03's form, wire it in directly instead. Replace the `<a href="/contact" class="btn">` line in `LP_PAGE` with the actual form markup from guide 03, and add one hidden field so the lead record remembers which ad brought them in:

```html
<input type="hidden" name="source" value="__VARIANT__">
```

Add `.replaceAll("__VARIANT__", esc(key))` to the chain in `landingPage()`. Now a lead captured on `/lp?v=hvac` shows `hvac` in the Source column at `/admin`, the same admin page guide 03 already built.

---

## Verify it works

- [ ] `/lp` shows the default variant
- [ ] `/lp?v=hvac` shows different copy than default
- [ ] `/lp?v=made-up-value` falls back to default instead of erroring
- [ ] The page has no navigation bar
- [ ] It looks right on a phone, since most ad traffic arrives on one

---

## What breaks and how to fix it

**The page shows literal text like `__HEADLINE__` instead of your copy**
A `.replaceAll()` call is missing or misspelled. The placeholder in `LP_PAGE` must match the string you are replacing exactly, including the double underscores.

**"Identifier 'esc' has already been declared"**
You added a second `esc()` function. Delete it. Guide 03's version is the one you use.

**`/lp` returns a 404**
The `if` block for `/lp` is below the `env.ASSETS.fetch(request)` fallback instead of above it. Order matters. Move it up.

**Changing a variant's copy does not show up**
You edited the file but did not run `npx wrangler deploy` again. There is no auto-sync.

**The whole site breaks after this edit, not just `/lp`**
A stray comma or missing closing brace in the `VARIANTS` object. Run `npx wrangler deploy` and read the exact line number in the error.

**Ad platform shows a broken preview thumbnail**
Some platforms crawl the URL before it goes live for review. Make sure `/lp?v=yourkey` is deployed and returns 200 before submitting the ad.

---

## What to do next

Go to **05. Free File Storage for Life**. Same file, same project, one more thing it does.

---

## Sources to verify yourself

- Static assets and routing: `https://developers.cloudflare.com/workers/static-assets/`
