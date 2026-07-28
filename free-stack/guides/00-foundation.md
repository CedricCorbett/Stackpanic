# 00. Foundation

**Time: 30 minutes. Cost: about $11 per year for a domain. Code: none.**

Do this once. Every other guide in this library assumes it is done.

---

## What you get

Four things.

1. A Cloudflare account. This is where everything runs.
2. A domain name you own outright.
3. Node.js on your computer.
4. Wrangler, the tool that pushes your work to the internet.

At the end you will have deployed something live at your own web address. It will take about two minutes once the setup is done.

---

## What this replaces

Nothing yet. This is the plumbing. But it is the reason every guide after this one costs $0.

---

## What is actually free

Everything here except the domain.

The domain costs about $10 to $12 per year. Cloudflare sells domains at wholesale cost with no markup and no renewal price jump. Most registrars advertise $1 the first year and charge $22 the second. Cloudflare charges the same every year.

That is the only recurring bill in this entire library.

---

## Step 1. Make a Cloudflare account

1. Go to `https://dash.cloudflare.com/sign-up`
2. Enter an email and a password.
3. Confirm the email they send you.

No credit card. Do not add one. If a guide in this library ever asks you for a card, something is wrong.

---

## Step 2. Get a domain

You have two situations.

**If you do not own a domain yet:**

1. In the Cloudflare dashboard, click **Domain Registration**, then **Register Domain**.
2. Search for the name you want.
3. Buy it. Roughly $11 for a `.com`.

**If you already own a domain somewhere else:**

You can move it to Cloudflare, or you can leave it where it is and just point it at Cloudflare. Moving it is better because you get the wholesale price and the free email routing in guide 01.

1. In the dashboard, click **Add a domain**.
2. Type your domain, pick the **Free** plan.
3. Cloudflare shows you two nameservers. Copy both.
4. Log in to wherever you bought the domain. Find the nameserver settings. Replace what is there with the two Cloudflare gave you.
5. Wait. This can take anywhere from 10 minutes to 24 hours.

You do not need to wait for this to finish before doing step 3.

> **What just happened.** Nameservers are the sign that tells the internet who is in charge of your domain. You just pointed that sign at Cloudflare. Cloudflare now answers every request for your name.

---

## Step 3. Install Node.js

Node is the engine. Wrangler runs on it.

1. Go to `https://nodejs.org`
2. Download the **LTS** version. LTS means long term support. It is the stable one.
3. Run the installer. Accept every default.

Now open a terminal.

- **Mac:** press Cmd + Space, type `Terminal`, press Enter.
- **Windows:** press the Windows key, type `PowerShell`, press Enter.

Type this and press Enter:

```
node --version
```

You should see something like `v22.14.0`. The exact number does not matter as long as the first number is 20 or higher.

If you see "command not found," close the terminal completely, open a new one, and try again. The installer only affects terminals opened after it ran.

> **What just happened.** You installed a program and asked it to tell you its version. That is the standard way to confirm an install worked. You will do this a lot.

---

## Step 4. Log wrangler in to Cloudflare

Wrangler is the command line tool for Cloudflare. You do not install it globally. You run it on demand with `npx`, which downloads it fresh each time and keeps you current automatically.

In your terminal:

```
npx wrangler login
```

The first time, it will ask if it can install the package. Say yes.

A browser window opens asking you to authorize Wrangler. Click **Allow**.

Back in the terminal you should see a success message.

Confirm it:

```
npx wrangler whoami
```

It should print your email address and your account ID. Copy the account ID somewhere. You will not need it often but when you do need it, you will really need it.

---

## Step 5. Deploy something live

This is the whole point of the exercise. You are about to put a page on the internet.

Make a folder and go into it:

```
mkdir hello-stack
cd hello-stack
```

Make a folder for your files:

```
mkdir public
```

Create a file. The easiest way is with your normal text editor.

- **Mac:** run `open -e public/index.html` to open TextEdit. Then go to Format, and click Make Plain Text.
- **Windows:** run `notepad public/index.html` and click Yes when it asks to create the file.

Paste this in and save:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>It works</title>
  </head>
  <body>
    <h1>It works.</h1>
    <p>This page costs nothing to run.</p>
  </body>
</html>
```

Now create the config file. Same method, but the filename is `wrangler.toml` and it goes in the `hello-stack` folder, not in `public`.

```toml
name = "hello-stack"
compatibility_date = "2026-07-01"

[assets]
directory = "./public"
```

Deploy it:

```
npx wrangler deploy
```

You will see a URL ending in `.workers.dev`. Open it.

Your page is live.

> **What just happened.** `wrangler.toml` is the instruction sheet. `name` becomes part of your URL. `compatibility_date` locks in Cloudflare's behavior as of that date so a future update cannot silently break your site. `[assets]` tells Cloudflare which folder holds the files to serve.

---

## Step 6. Confirm you are on the free plan

1. Go to the Cloudflare dashboard.
2. Click **Compute (Workers)**, then **Plans** in the sidebar.
3. It should say **Free**.

If it says anything else, you are about to get billed for things this library says are free. Fix it before continuing.

---

## The free tier's real ceilings

Every "for life" claim in this library rests on staying under these. Verify against Cloudflare's current published limits before you build, these pages move.

| Resource | Free plan limit | What that means in practice |
|---|---|---|
| Worker requests | 100,000 per day | Roughly 20,000 page views a day |
| Worker CPU time | 10 ms per request | Fine for everything in this library |
| D1 storage | 5 GB | Millions of rows for anything here |
| D1 rows written | 100,000 per day | Fine at normal small-business volume |
| R2 storage | 10 GB per month | Thousands of photos, dozens of short videos |
| R2 egress | $0, always | The one that beats every paid competitor outright |

If you exceed these, you have a good problem, and a bill of a few dollars a month, not a broken site. This is not "running it for 1,000 people costs the same as running it for one." Above these lines, it does not.

## Step 7. Set up one rate limit rule

Every guide in this library that accepts a public submission, a lead form, a booking, a market-data lookup, has no rate limit of its own written into its code. That is deliberate: writing and testing a rate limiter in every single guide's code would be real, ongoing engineering, the opposite of "for life." Cloudflare's free plan includes one Rate Limiting Rule, configured once here, that covers every endpoint you build in every later guide, no code required.

1. In the Cloudflare dashboard, open your domain, then **Security → WAF → Rate limiting rules**.
2. Create a rule: match requests where the path starts with `/api/` or `/book/` or `/admin/` (adjust to what you actually build), method `POST`.
3. Set the threshold to something generous for a real visitor and painful for a script, for example 20 requests per 1 minute per IP address.
4. Action: **Block**, for 1 minute.

Without this, a public form with no login (which is every form in this library, by design) can be hit thousands of times a minute by a script, which can fill your calendar with junk bookings, exhaust the free-tier request ceiling above, or, worse, burn through a paid-per-call key you configure later, like your Census API key or your Meta Conversions API token. One rule here protects every guide that follows.

---

## Verify it works

Check all four before moving on.

- [ ] `npx wrangler whoami` prints your email
- [ ] Your `.workers.dev` URL loads the "It works" page
- [ ] Your domain shows **Active** in the Cloudflare dashboard
- [ ] Your Workers plan says **Free**
- [ ] A rate limiting rule exists under Security → WAF for your domain

If all five pass, every other guide in this library will work.

---

## What breaks and how to fix it

**"command not found: npx"**
Node did not install, or your terminal is stale. Close every terminal window, open a fresh one, run `node --version` again. If it still fails, reinstall Node.

**"Authentication error" on deploy**
Your login expired. Run `npx wrangler login` again.

**"A worker with this name already exists"**
Someone else on your account used that name, or you ran it twice. Change the `name` line in `wrangler.toml` to something else and deploy again.

**Domain stuck on "Pending Nameserver Update"**
The nameservers did not save at your old registrar. Log back in there and check they match exactly. Some registrars silently append a dot or reject a save without telling you.

**The page loads but shows a 404**
Your file is not named `index.html`, or it is not inside `public`. Run `ls public` on Mac or `dir public` on Windows and look at the actual filename. Windows loves to save `index.html.txt`.

**"It works" shows old content after you edit it**
You edited the file but did not redeploy. Run `npx wrangler deploy` again. There is no auto-sync.

---

## What to do next

Go to **01. Free Business Email for Life**. It takes 10 minutes, needs no code, and it is the fastest proof that this whole approach is real.

---

## Sources to verify yourself

Do not take my word on the pricing. Check these before you build.

- Workers pricing and limits: `https://developers.cloudflare.com/workers/platform/pricing/`
- Cloudflare Registrar pricing: `https://www.cloudflare.com/products/registrar/`
