# Leadspanic Social — setup guide

**Start here.** This file walks you through everything, click by click, from
"I have never used a terminal" to a live Instagram automation running on your
own Cloudflare account. No coding knowledge required — just the ability to
copy a command, paste it, and press Enter.

If you get stuck, jump to [Troubleshooting](#troubleshooting) near the
bottom — it covers the mistakes almost everyone makes on their first setup.

---

## What you're setting up

One app, running entirely on your own free/cheap Cloudflare account, that:

- **Schedules and publishes Instagram posts** — images, video, Reels, Stories,
  and multi-image carousels — on a calendar you control.
- **Replies to comments automatically.** Someone comments a word like `MAP`,
  they get a DM with your link, instantly, day or night.
- **Answers DMs with AI**, but only using facts you type in yourself — it
  refuses to make anything up, and hands anything sensitive (a complaint, a
  refund ask, pricing negotiation) straight to you instead of guessing.
- **Tracks link clicks** so you know which comment code actually produces
  bookings, without needing any special Meta permission for it.

No monthly ManyChat-style subscription. No third party holding your Instagram
tokens. It's your Cloudflare account, your database, your data.

**Time to set up:** roughly 45–90 minutes of active work, spread over a few
days — most of the delay is Meta reviewing your app afterward (see
[Part G](#part-g-connect-meta-comment-replies-and-dms)), not anything you're
doing wrong.

---

## Contents

- [What you'll need before you start](#what-youll-need-before-you-start)
- [A few words, explained](#a-few-words-explained)
- [Part A — Create your accounts](#part-a--create-your-accounts)
- [Part B — Install the tools on your computer](#part-b--install-the-tools-on-your-computer)
- [Part C — Get the code](#part-c--get-the-code)
- [Part D — Create the cloud storage](#part-d--create-the-cloud-storage)
- [Part E — Set your secrets](#part-e--set-your-secrets)
- [Part F — Deploy](#part-f--deploy)
- [Part G — Connect Meta (comment replies and DMs)](#part-g--connect-meta-comment-replies-and-dms)
- [Part H — Go live, carefully](#part-h--go-live-carefully)
- [Troubleshooting](#troubleshooting)
- [Where to go next](#where-to-go-next)

---

## What you'll need before you start

All free to create, except where noted. Have these ready — you don't need to
do anything with them yet, just know you'll be signing up:

| Thing | Why | Cost |
|---|---|---|
| A computer (Mac, Windows, or Linux) | Everything below runs locally, once | — |
| A [Cloudflare](https://dash.cloudflare.com/sign-up) account | This is where the app actually runs | Free for this project's scale |
| A domain is **not** required | Cloudflare gives you a free `*.workers.dev` address | — |
| A [Meta Developers](https://developers.facebook.com/) account | Lets the app talk to Instagram | Free |
| An Instagram **Professional** (Business or Creator) account, linked to a Facebook Page | Meta requires this for API access — a personal account cannot be automated | Free |
| An [Anthropic](https://console.anthropic.com/) account | Powers the AI-written DM replies. Skip this if you only want the scheduler and comment codes | Pay-as-you-go, a few dollars a month for typical volume |

---

## A few words, explained

Skip this if you already know what these mean.

- **Terminal** — a text window where you type commands instead of clicking
  icons. On a Mac: press `Cmd+Space`, type `Terminal`, press Enter. On
  Windows: press the Start key, type `PowerShell`, press Enter. You'll paste
  commands from this guide into it and press Enter after each one.
- **Node.js** — a program that lets your computer run the JavaScript code this
  project is written in. You'll install it once in [Part B](#part-b--install-the-tools-on-your-computer).
- **Cloudflare Worker** — a small program that runs on Cloudflare's servers
  instead of your own computer, so it's still running when your laptop is
  closed. This whole project is one Worker.
- **Wrangler** — Cloudflare's command-line tool for deploying a Worker. You'll
  install and use it in the parts below.
- **D1** — Cloudflare's database. This is where your calendar, comment codes,
  contacts, and activity log live.
- **R2** — Cloudflare's file storage, for your images and videos.
- **Secret** — a sensitive value (a password, an API key) stored securely on
  Cloudflare and never written into a file. You set these with a command in
  [Part E](#part-e--set-your-secrets).
- **`API_TOKEN`** — the password for *your* dashboard. You'll invent this
  yourself and type it into your browser once.
- **Webhook** — Meta calling *your* app the instant a comment or DM arrives,
  instead of your app constantly asking "anything new?"

---

## Part A — Create your accounts

### A1. Cloudflare

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
   and create a free account (email + password is enough).
2. Verify your email if asked. You do not need to add a domain or a payment
   method to follow this guide.

✅ **Done when:** you can log in at dash.cloudflare.com and see an empty
dashboard.

### A2. Meta Developer account + app

This is the most fiddly part, because it's Meta's process, not this
project's. Take it slowly.

1. Make sure the Instagram account you want to automate is a **Professional**
   account (Business or Creator), and is **linked to a Facebook Page**. In the
   Instagram app: Settings → Account type and tools → confirm it says
   Professional account. If it's linked to a Page already, you'll see it in
   Settings → Account Center → Linked accounts. If not, Instagram will walk
   you through linking one when you switch to a Professional account —
   creating a Page takes two minutes if you don't have one.
2. Go to [developers.facebook.com](https://developers.facebook.com/) and log
   in with the Facebook account tied to that Page.
3. Click **My Apps** (top right) → **Create App**.
4. Choose **Other** → **Business** as the app type, give it a name (e.g. "My
   Business Social"), and finish the wizard.
5. In your new app's left sidebar, click **Add Product**, find **Instagram**,
   and click **Set Up**. This adds the permissions and webhook settings you'll
   use later.
6. Still in the sidebar, click **App Settings → Basic**. Copy the **App
   Secret** somewhere you can find it in [Part E](#part-e--set-your-secrets) —
   click "Show", you may need to re-enter your Facebook password.

You'll come back to this same app in [Part G](#part-g--connect-meta-comment-replies-and-dms)
to point its webhook at your deployed Worker, and to request the permissions
that let it actually send comment replies and DMs. Nothing sends until then —
scheduled posting works independently of this step.

✅ **Done when:** you have a Meta app, and you've copied its App Secret
somewhere safe (a password manager, not a plain text file).

### A3. Anthropic (only if you want AI-written DM replies)

1. Go to [console.anthropic.com](https://console.anthropic.com/) and sign up.
2. Add a payment method (Settings → Billing) — this is pay-as-you-go, not a
   subscription. Typical small-business DM volume costs a few dollars a
   month.
3. Go to **API Keys**, click **Create Key**, name it (e.g. "leadspanic-social"),
   and copy the key somewhere safe. It's only shown once.

If you skip this, the scheduler and comment codes still work fully — you'll
just leave DM auto-replies off.

---

## Part B — Install the tools on your computer

You do this once, on your own computer.

### B1. Install Node.js

1. Go to [nodejs.org](https://nodejs.org/) and download the **LTS** version
   (the button labeled "LTS", not "Current"). This project needs version 18
   or newer.
2. Run the installer, accepting the defaults.
3. Open a terminal (see [the glossary above](#a-few-words-explained) if you're
   not sure how) and check it worked:

   ```bash
   node --version
   ```

   ✅ **Done when:** this prints something like `v20.11.0`. Any number 18 or
   higher is fine.

### B2. Install Wrangler and log in

In the same terminal:

```bash
npm install -g wrangler
wrangler login
```

The second command opens a browser tab asking you to authorize Wrangler
against your Cloudflare account. Click **Allow**. Close the tab once it says
you're logged in — the terminal will confirm it too.

✅ **Done when:** the terminal prints something like "Successfully logged in."

---

## Part C — Get the code

Pick whichever of these you're comfortable with — both end up in the same
place.

**Option 1 — download a ZIP (simplest, no extra tools):**

1. On this project's GitHub page, click the green **Code** button, then
   **Download ZIP**.
2. Unzip it somewhere you'll remember, e.g. your Desktop.

**Option 2 — clone with git (if you already use git):**

```bash
git clone <this repository's URL>
```

Either way, open a terminal and move into the project folder:

```bash
cd leadspanic-instagram
npm install
```

`npm install` downloads the project's few dependencies. It's normal for this
to take a minute and print some text.

✅ **Done when:** the terminal returns to a normal prompt with no red error
text.

---

## Part D — Create the cloud storage

Still in that same terminal, inside the `leadspanic-instagram` folder:

```bash
wrangler r2 bucket create leadspanic-ig-media
wrangler d1 create leadspanic-ig
```

The second command prints a block of text ending in something like:

```toml
[[d1_databases]]
binding = "DB"
database_name = "leadspanic-ig"
database_id = "a1b2c3d4-....."
```

1. Copy that `database_id` value (just the id, the long string of letters and
   numbers).
2. Open the file `wrangler.toml` in this project folder with any text editor
   (Notepad, TextEdit, VS Code — whatever you have).
3. Find the line that says:

   ```toml
   database_id = "REPLACE_WITH_DATABASE_ID_FROM_WRANGLER_D1_CREATE"
   ```

4. Replace the placeholder text between the quotes with the id you copied,
   and save the file.

**This step is not optional — deploying will fail with a clear error message
until you do it.**

### D1. Tell the app which Instagram account(s) it manages

There's no in-app button to add an account — you do it once, here, by editing
the seed data at the very bottom of `schema.sql`, before you run the
migration below.

1. Open `schema.sql` in a text editor and scroll to the `-- Seed.` section
   near the bottom.
2. Change `account_one` (and `account_two`, if you're running a second
   account — delete that row entirely if you only have one) to your own short
   handle and business name.
3. Leave `ig_user_id` as the placeholder for now if you don't know Meta's
   numeric id for your account yet — you'll fix it in one line in
   [Part G1](#g1-open-the-app-and-connect-your-accounts) if you get it wrong,
   the app tells you the correct value.
4. If you added example comment codes (`trg_map`/`trg_audit`), either edit
   their `keyword`/`link` to something real, or just delete those two rows —
   you can always add codes from the app's **Codes** tab later.

Now create the tables:

```bash
npm run db:migrate
```

✅ **Done when:** this prints a series of successful table-creation messages
with no red `Error` text.

---

## Part E — Set your secrets

Secrets are typed once, here, and Cloudflare stores them securely — they are
never written into any file in this project.

Run each of these one at a time. After each `wrangler secret put NAME`
command, it will prompt you to paste a value and press Enter.

```bash
wrangler secret put API_TOKEN
wrangler secret put TOKEN_ENC_KEY
wrangler secret put META_APP_SECRET
wrangler secret put WEBHOOK_VERIFY_TOKEN
wrangler secret put ANTHROPIC_API_KEY
```

What to paste for each:

| Secret | What to paste |
|---|---|
| `API_TOKEN` | A password you invent for your own dashboard. Generate a random one by running `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` in your terminal and pasting its output. |
| `TOKEN_ENC_KEY` | Another random value from that same command. **Write this one down somewhere safe** — if you ever change it later, every Instagram token you've stored becomes unreadable and you'll have to re-paste them. |
| `META_APP_SECRET` | The App Secret you copied in [Part A2](#a2-meta-developer-account--app). |
| `WEBHOOK_VERIFY_TOKEN` | Any string you make up — a random word is fine. You'll type this exact same value into Meta's dashboard in [Part G](#part-g--connect-meta-comment-replies-and-dms). |
| `ANTHROPIC_API_KEY` | The key you copied in [Part A3](#a3-anthropic-only-if-you-want-ai-written-dm-replies). Skip this `wrangler secret put` command entirely if you're not using AI DM replies. |

Every value here can be generated the same cross-platform way — run
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
again for each one you need to invent, and paste a fresh result each time.

✅ **Done when:** each command prints a confirmation like "Success! Uploaded
secret API_TOKEN."

---

## Part F — Deploy

This part has one trap, and it's called out clearly below. Read both steps
before running anything.

### F1. First deploy

```bash
npm run check
npm run deploy
```

`npm run check` runs a safety check on your machine (no Cloudflare needed for
it) — two warnings are expected and fine at this point. `npm run deploy`
uploads your Worker. When it finishes, it prints your live URL, something
like:

```
https://leadspanic-instagram.your-name.workers.dev
```

**Copy that exact URL.**

### F2. The trap: paste your real URL back in, then deploy again

Open `wrangler.toml` again and find this line:

```toml
PUBLIC_ORIGIN = "https://leadspanic-instagram.YOUR-SUBDOMAIN.workers.dev"
```

Replace it with the **exact URL** Wrangler just printed for you, then save
the file and deploy once more:

```bash
npm run deploy
```

**Why this matters:** Meta downloads your images and video *from* this URL
when publishing a post, and your tracked comment-code links are built from it.
If you skip this step, publishing will fail with a confusing error, and the
app will show a red banner reminding you until you fix it.

✅ **Done when:** you've deployed twice, and the second `wrangler.toml` value
matches the URL Wrangler actually gave you.

---

## Part G — connect Meta (comment replies and DMs)

Posting to your calendar already works after Part F. This part turns on
automated comment replies and DM handling, which need Meta's review before
they can run for real.

### G1. Open the app and connect your account(s)

1. Open your live URL from Part F in a browser.
2. It asks for your `API_TOKEN` (the one you invented in Part E) — paste it
   in. Your browser remembers it after that.
3. Go to **Settings**, pick an account, paste that Instagram account's access
   token (generate one in the Meta developer console, under your app →
   Instagram → API setup with Instagram login, or via Graph API Explorer),
   and save. The app verifies it, exchanges it for a long-lived token,
   encrypts it, and stores it. Repeat for a second account if you're running
   two.

   **If you left `ig_user_id` as the placeholder in Part D1**, this step will
   fail with a message like *"That token belongs to Instagram account id
   1784...., but 'account_one' is configured as
   REPLACE_WITH_YOUR_IG_USER_ID_1. Nothing was saved."* — that number in the
   error **is** the id you need. Fix it with one command (swap in the real id
   and your account's handle from Part D1) and try saving the token again:

   ```bash
   wrangler d1 execute leadspanic-ig --remote --command="UPDATE accounts SET ig_user_id='PASTE_THE_ID_FROM_THE_ERROR' WHERE id='account_one'"
   ```

4. Click **Activate account**. Leave **automatic replies** off for now.

### G2. Test publishing first

Before touching the DM/comment side at all: schedule one real post a few
minutes out, then press **Run now** in the app instead of waiting. Check the
**Activity** tab for a green `post_published` row with a working link. This
proves your token, your media storage, and your deploy all work — the
simpler half of the two systems.

### G3. Point Meta's webhook at your app

In your Meta app's dashboard (developers.facebook.com → My Apps → your app →
**Instagram** in the sidebar → **Webhooks**, or **App Settings → Webhooks**):

| Field | Value |
|---|---|
| Callback URL | `https://<your-worker-url>/webhook/instagram` |
| Verify token | The exact `WEBHOOK_VERIFY_TOKEN` you set in Part E |
| Subscribed fields | `comments` and `messages` |
| Privacy Policy URL | `https://<your-worker-url>/privacy` |
| Data Deletion Request URL | `https://<your-worker-url>/webhook/deletion` |

Your app's **Settings** tab shows all four of these URLs pre-filled and ready
to copy, once `PUBLIC_ORIGIN` is set correctly from Part F.

### G4. Request App Review

You're requesting three permissions: `instagram_manage_messages`,
`instagram_manage_comments`, and `instagram_business_manage_insights`. Request
exactly those — nothing else. Meta's own reviewers commonly take **2 to 20
days** for a first pass, and a rejection adds another 3–5 days, so start this
early and expect to wait.

The technical README (in `leadspanic-instagram/README.md`, sections 5 and 6)
has the exact screencast script Meta expects, a permission-by-permission
checklist, and what to do if you're rejected. Read that before you submit —
it is the single biggest thing that determines whether your first submission
is approved.

✅ **Done when:** Meta's dashboard shows your webhook subscribed with a green
checkmark, and (once review clears) your requested permissions show
"Approved."

---

## Part H — go live, carefully

1. Once App Review clears, test the comment and DM flow on a **throwaway**
   Instagram account first, not your real business account.
2. In the app's **Codes** tab, use the built-in test box: type a comment,
   confirm the right code fires, before it ever touches real Instagram.
3. Turn on **automatic replies** for one real account.
4. Watch the **Activity** tab for the first day. Every blocked or failed send
   is logged with a plain-English reason — "why did nothing happen" should
   always be answerable from that tab.
5. Turn on the second account once the first is behaving as expected.

You're live. From here, day-to-day use is entirely inside the app: scheduling
posts, adding comment codes, writing your DM knowledge base, checking
analytics. Nothing below this line requires a terminal again unless you're
changing the code itself.

---

## Troubleshooting

**"Deploy failed" mentioning `database_id`** — you skipped the placeholder
swap in [Part D](#part-d--create-the-cloud-storage). Open `wrangler.toml` and
check it.

**"Publishing fails" or posts get stuck** — almost always the `PUBLIC_ORIGIN`
trap in [Part F2](#f2-the-trap-paste-your-real-url-back-in-then-deploy-again).
The app shows a red banner while this is still wrong.

**"Nothing posted and there's no error"** — check, in order: is the account
paused (Settings), is the post still sitting as a draft waiting for your
approval, and is `PUBLIC_ORIGIN` really set. All three show in the app.

**"Comments do nothing"** — check, in order: is the webhook actually
subscribed to `comments` in Meta's dashboard (Part G3), are replies turned on
for that account, does the comment code's link still say `REPLACE_ME` (the
two example codes ship that way on purpose and won't send until you edit
them), and does the app's own test box (Codes tab) match what you typed on
Instagram.

**"It worked for two months, then stopped"** — your Instagram access token
expired. Settings shows the refresh error. The app refreshes tokens
automatically every day, 10 days before they'd expire, but only if the
Worker's daily cron is actually running — check the Activity tab for a
`token_refresh_failed` event if this happens.

**Meta rejected my App Review submission** — don't resubmit the same video.
Walk through the technical README's section 6 checklist line by line: could
someone who's never seen the app follow your video exactly, does your privacy
policy URL actually load, does the app's behavior match exactly what you
narrated.

**I'm stuck on something not listed here** — the technical README
(`leadspanic-instagram/README.md`) covers the system in much more depth,
including a full list of every event you might see in the Activity tab and
what it means (section 12).

---

## Where to go next

- **[`README.md`](README.md)** — the technical reference: every API
  endpoint, exactly how the AI guardrails work, the full Meta App Review
  script, and what this project deliberately does *not* build.
- **[`CONTRIBUTING.md`](CONTRIBUTING.md)** — if you want to change or extend the code.
- **[`SECURITY.md`](SECURITY.md)** — how to report a security issue privately.

This project has no build step anywhere, on purpose. Once it's running, open
any file in `src/`, read it, and change it.
