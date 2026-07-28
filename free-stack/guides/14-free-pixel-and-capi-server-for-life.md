# 14. Free Pixel and CAPI Server for Life

**Time: 2 hours. Cost: $0. Code: copy and paste.**

The setup an agency charges $300 a month to install and "maintain." It does not need maintaining. It needs to be built correctly once.

---

## What you get

Every lead your site captures gets reported to Meta twice, once from the visitor's browser, once from your own server, so an ad blocker or iOS privacy setting killing the browser copy does not blind your ad account. Meta gets a cleaner signal, your ad optimization gets better, and duplicate leads never get double-counted.

---

## What it replaces

An agency retainer for "pixel and tracking setup and maintenance," typically **$300 a month**, sometimes bundled into a larger management fee. There is no single named product here to put in a pricing table, because this is exactly the kind of thing that gets sold as ongoing service rather than software. It is neither. It is a few hundred lines of code that do not need touching again once they work.

---

## What is actually free and what is not

Entirely free. Meta does not charge to receive events, browser-side or server-side. You are paying nothing here except the time to set it up once, correctly.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- A Meta Pixel already created in Meta Events Manager, `https://business.facebook.com/events_manager`. If you have run any Facebook or Instagram ad before, you likely already have one. If not, Events Manager walks you through creating one, it takes about two minutes and asks for nothing but a name.

---

## The two concepts this guide depends on, stated plainly

Get these two ideas straight before touching any code, they are easy to conflate and doing so quietly breaks everything.

**Matching** is how Meta connects an event to a specific ad and person, using `fbc` (from the ad click) and `fbp` (a browser identifier) and, optionally, a hashed email. Better matching means better ad optimization.

**Deduplication** is how Meta avoids counting the same real-world action twice when both the browser and your server report it. This uses only two fields: `event_name` and `event_id`, matched exactly, case included. It does not look at `fbc`, `fbp`, or email at all for this purpose. Those help matching. They do nothing for dedup.

Confuse these two and you will either double-count every lead, or think matching is broken when it is actually dedup, or the reverse. Keep them separate in your head the whole way through.

---

## Step 1. Get your Pixel ID and a CAPI access token

1. In Events Manager, select your Pixel.
2. Go to **Settings**.
3. Under **Conversions API**, click **Generate access token**. Copy it, shown once.
4. Your Pixel ID is visible at the top of the same page, a long number.

## Step 2. Store the credentials

```
npx wrangler secret put META_PIXEL_ID
npx wrangler secret put META_CAPI_TOKEN
```

## Step 3. Extend the leads table

Create `schema-capi.sql`:

```sql
ALTER TABLE leads ADD COLUMN fbc TEXT;
ALTER TABLE leads ADD COLUMN fbp TEXT;
ALTER TABLE leads ADD COLUMN capi_event_id TEXT;
ALTER TABLE leads ADD COLUMN client_ip TEXT;
ALTER TABLE leads ADD COLUMN user_agent TEXT;
```

```
npx wrangler d1 execute leads --remote --file=./schema-capi.sql
```

This adds columns to the same `leads` table from guide 03. Nothing gets recreated.

## Step 4. Add the Meta Pixel base code

Add this to every page's `<head>`, meaning `style.css` cannot hold it. Replace `YOUR_PIXEL_ID`.

**This is not just the static files in `public/`.** The two pages that actually receive paid ad traffic, guide 04's landing pages and guide 10's booking page, are not files on disk at all, they are HTML template strings built inside `src/index.js` (`LP_PAGE` in guide 04, the template inside `bookingPage()` in guide 10). Each one has its own `<head>` block, and each one needs this same snippet pasted into it directly. Skipping them means the two pages your ad spend actually lands on are the two pages with no pixel on them at all, while your check in Step 10 below still passes, because you tested it on `/contact`, not `/lp` or `/book`. If you built any other guide that renders its own full HTML page from a template string in `src/index.js`, check its `<head>` too.

```html
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', 'YOUR_PIXEL_ID');
fbq('track', 'PageView');
</script>
```

This is Meta's own standard snippet, unmodified. Do not simplify it, the odd structure is intentional, it queues calls made before the script finishes loading.

## Step 5. Capture fbc and fbp, and generate one shared event ID

Add this to `public/contact.html`, right before the closing `</script>` tag of the form-handling script from guide 03, or in a shared script if more than one page has a form:

```js
function getCookie(name) {
  const match = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
  return match ? match.pop() : null;
}

function getFbc() {
  const stored = getCookie("_fbc");
  if (stored) return stored;
  const fbclid = new URLSearchParams(location.search).get("fbclid");
  if (!fbclid) return null;
  return "fb.1." + Date.now() + "." + fbclid;
}
```

> **Why `getFbc()` checks the cookie first.** If the Pixel has already run on an earlier page view this session, it may have already set `_fbc` itself. Only build one from a raw `fbclid` as a fallback, and never invent one when no `fbclid` is present anywhere. A fabricated `fbc` is worse than none, it actively degrades matching.

## Step 6. Wire it into the lead form submission

Find the form submit handler from guide 03. Right before the `fetch("/api/lead", ...)` call, add:

```js
  const eventId = crypto.randomUUID();
  data.event_id = eventId;
  data.fbc = getFbc();
  data.fbp = getCookie("_fbp");

  if (typeof fbq === "function") {
    fbq("track", "Lead", {}, { eventID: eventId });
  }
```

That `{ eventID: eventId }` third argument on the `fbq` call is what lets Meta's browser-side event carry the same ID your server is about to send. Miss this and dedup silently never works, nothing errors, you just get double-counted leads and never know why.

## Step 7. Update the server to store the new fields and send the CAPI event

Open `src/index.js`. In `saveLead()` from guide 03, find where the `INSERT INTO leads` statement runs. Replace that whole block with:

```js
  const eventId = clean(body.event_id, 100);
  const fbc = clean(body.fbc, 200);
  const fbp = clean(body.fbp, 200);
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";

  await env.DB.prepare(
    `INSERT INTO leads
     (created_at, name, email, phone, message, source, page, fbc, fbp, capi_event_id, client_ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    new Date().toISOString(), name, email, phone, message, source, page,
    fbc, fbp, eventId, clientIp, userAgent
  ).run();

  await sendCapiEvent(env, {
    eventName: "Lead",
    eventId,
    eventSourceUrl: page ? `https://yourbusiness.com${page}` : "https://yourbusiness.com",
    email,
    fbc,
    fbp,
    ip: clientIp,
    userAgent
  }).catch(err => console.error("CAPI send failed:", err.message));
```

The `.catch()` on the last line matters. If Meta's API is briefly down, the lead still saves, only the CAPI report is lost for that one event. A marketing signal failing should never take your actual lead capture down with it.

## Step 8. Add the CAPI sending function

At the bottom of the file:

```js
// ---------------------------------------------------------------
// Meta Conversions API (guide 14)
// ---------------------------------------------------------------

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendCapiEvent(env, { eventName, eventId, eventSourceUrl, email, fbc, fbp, ip, userAgent }) {
  const userData = {};
  if (email) userData.em = [await sha256Hex(email.trim().toLowerCase())];
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
  if (ip) userData.client_ip_address = ip;
  if (userAgent) userData.client_user_agent = userAgent;

  const payload = {
    data: [{
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl,
      user_data: userData
    }]
  };

  const res = await fetch(
    `https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}/events`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.META_CAPI_TOKEN}`
      },
      body: JSON.stringify(payload)
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Meta API ${res.status}: ${errText}`);
  }
}
```

> **Why the token goes in an `Authorization` header instead of the URL.** A handful of guides in this library, and a lot of example code you'll find online, put `access_token` straight in the query string because it is one line shorter. Don't. `npx wrangler tail`, this guide's own step 10, and Cloudflare's own request logs all print the full URL, meaning your long-lived Meta token would sit in plain text in the exact tool you were told to run to debug this. The Graph API accepts the same token as a standard OAuth2 Bearer header, so use that instead and the token never appears anywhere it can be read back.

> **Why the email gets hashed and `fbc`/`fbp` do not.** Meta requires personal data like email to arrive pre-hashed with SHA-256, lowercase and trimmed first, so raw personal information never crosses the wire. `fbc` and `fbp` are not personal data, they are opaque tracking identifiers, and hashing them would break Meta's ability to match them at all. Hash the person, never hash the identifier.

## Step 9. Deploy

```
npx wrangler deploy
```

## Step 10. Test it properly

Do not guess whether this worked. Verify it.

1. In Events Manager, go to your Pixel, then **Test events**.
2. It shows a **Test event code**. Copy it.
3. Temporarily add `test_event_code: "YOUR_CODE"` as a sibling of `data` in the `payload` object in `sendCapiEvent`, redeploy.
4. Submit your contact form with a real-looking test email.
5. Watch the **Test events** tab. You should see two entries for the same event, one tagged Browser, one tagged Server, both with a green **Event Match Quality** indicator and, critically, shown as **deduplicated** into one, not two separate events.
6. Remove the `test_event_code` line and redeploy once confirmed. Leaving it in means production events stop appearing as real traffic.

---

## Verify it works

- [ ] Test Events in Meta shows both a Browser and a Server event for the same submission
- [ ] Those two events show as deduplicated, not as two separate leads
- [ ] The lead in `/admin` has non-empty `fbc` when the test URL included a `fbclid` parameter
- [ ] Submitting the form with the Pixel deliberately blocked, an ad blocker or a private window with tracking protection, still results in a CAPI event reaching Meta, since the server-side call does not depend on the browser at all
- [ ] `npx wrangler tail` during a submission shows no "CAPI send failed" line
- [ ] If you built guide 04 or guide 10, view source on `/lp` and on `/book` specifically, not just `/contact`, and confirm the Pixel snippet is actually there. These are template strings in `src/index.js`, not files in `public/`, and it is easy to add the snippet to every static page and still miss both of them

---

## What breaks and how to fix it

**Browser and server events both show up in Test Events, but as two separate events, not deduplicated**
The `eventID` passed to `fbq('track', 'Lead', {}, {eventID: eventId})` does not exactly match the `event_id` sent server-side, including case. Log both values during a test and diff them character by character, this is almost always a subtle mismatch, not a conceptual error.

**CAPI event never shows up in Test Events at all**
Check `npx wrangler tail` for the actual error text from Meta. The most common causes are an expired or copy-paste-truncated `META_CAPI_TOKEN`, or a `META_PIXEL_ID` that has extra whitespace from the copy.

**Event Match Quality score is low even though the event arrives**
This is a matching problem, not a dedup problem. Check that `fbc` is actually populated on real ad traffic (test by clicking an actual ad, or manually appending `?fbclid=test123` to your URL to confirm the capture code runs at all) and that the email is being hashed, not sent in plain text, which Meta silently rejects rather than erroring on.

**"Unsupported get request" or a permissions error from the Graph API**
The access token does not have Conversions API permission, or you generated a token from the wrong Pixel. Regenerate it from Events Manager, Settings, Conversions API, on the exact Pixel whose ID you are using.

**Leads captured through guide 04's landing pages are missing `fbc`**
If you built guide 04's variant form integration, make sure the `getFbc()`, `getCookie()`, and event-ID generation code from steps 5 and 6 got added there too, not just on `/contact`. Every page with a lead form needs this, copy-pasting into one and forgetting the other is the single most common gap.

---

## What to do next

Go to **15. Free Offline Conversion Tracking for Life**. This guide captured the click. The next one tells Meta what happened after it, days later, off the site entirely.

---

## Sources to verify yourself

- Conversions API overview: `https://developers.facebook.com/docs/marketing-api/conversions-api`
- Deduplication: `https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events`
- Current Graph API version: `https://developers.facebook.com/docs/graph-api/changelog/versions/`
