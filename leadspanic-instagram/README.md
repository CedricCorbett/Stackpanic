# Leadspanic Social

> **New here?** This file is the technical reference — every endpoint, every
> guardrail, every internal decision, explained. For a step-by-step walkthrough
> written for a non-technical business owner (create the accounts, run the
> commands, connect Meta, go live), start at **[SETUP.md](SETUP.md)** instead.
> Come back here once it's running, or whenever you want to know exactly how
> something works.

One app for both Instagram accounts: schedule and publish posts, answer DMs, and
run as many comment codes as you want. Runs entirely on your own Cloudflare
account. No monthly ManyChat fee, no third party holding your tokens.

---

## 1. What it does

**Scheduler.** A calendar. Attach media, write a caption, pick a time. A cron
checks every 15 minutes and publishes what is due. Handles single images, video
and Reels, Stories, and **carousels of 2 to 10 slides**, which is what your
`leadspanic-grid` teardowns actually are.

**Posting schedule.** Define recurring slots once ("Tue 09:00, Thu 09:00"), then
drop content into the queue and it lands in the next free slot. Times are
wall-clock in your timezone and stay correct across daylight saving.

**Comment codes.** Someone comments `MAP`, they get a DM with your map link.
`PRICING` gets the price sheet instead. Each code can also post a public reply in
the comment thread, tag the person, and send one timed follow-up if they go
quiet. Add, rename, and switch codes off from the app, no redeploy. This is the
ManyChat replacement.

**Tracked links.** Every code's link goes out as a short link through your own
Worker, which counts the click and redirects. UTM tags are applied
automatically. You get real attribution per code with no Meta permission
involved.

**DM replies.** An inbound DM gets an answer written only from a knowledge base
you control. Anything resembling a complaint, refund ask, or pricing negotiation
gets no automated reply and is flagged for you.

**Inbox.** Every conversation, both channels, both accounts, with tags for
segmentation. Reply yourself from the app, sent exactly as typed.

**Analytics.** Link clicks and code usage measured here, plus reach, saves and
follows pulled from Instagram Insights.

**Drafts.** Turn on "hold for approval" and anything a skill pushes in lands as a
draft instead of publishing. Your safety catch on autonomous posting.

Both accounts are first-class: separate codes, knowledge base, guardrails,
timezone, and switches. Switch with the dropdown at the top right.

---

## 2. Plain-English vocabulary

- **Worker** — a small program running on Cloudflare's servers. No machine to patch.
- **D1** — Cloudflare's SQL database. Calendar, codes, contacts, log.
- **R2** — Cloudflare's file storage. Images, video, backups.
- **Cron trigger** — a schedule that wakes the Worker. One every 15 minutes to
  publish and send follow-ups, one daily for tokens, insights, and backups.
- **Webhook** — Meta calling *your* app the instant something happens, instead of
  your app constantly asking "anything new?"
- **Secret** — a sensitive value stored on Cloudflare and handed to your code at
  runtime, so it never appears in a file. Set with `wrangler secret put NAME`.
- **Access token** — the credential letting this app act on your account. Expires
  every 60 days. This app refreshes it for you.
- **UTM tags** — query parameters on a link that tell your analytics where a
  visitor came from.
- **PWA** — a web app you can add to your phone's home screen.

---

## 3. What was fixed from `ig-scheduler`

Two of these mean the old version could never have worked at all.

1. **Tokens are no longer in a file.** `ig-scheduler/schema.sql` had both live
   tokens pasted into a column meant for the *name* of a secret. The code then
   looked up an environment variable literally named `IGAAXXZB9v1Ab1...`, found
   nothing, and failed every publish with `Missing secret`. Here, tokens are
   pasted into the app, encrypted immediately, and stored encrypted in D1.
   `npm run check` fails the build if a token ever appears in any file.
2. **Two cron passes cannot double-post.** Rows are claimed with a conditional
   update before publishing.
3. **A broken post stops retrying**, capped at 3 attempts, with backoff between
   them so a transient rate limit does not burn all three inside 45 minutes.
4. **Reads require auth.** `GET /api/posts` and `/api/accounts` were open to
   anyone with the URL.
5. **Tokens refresh themselves.** There was no refresh job at all, so day 61
   would have killed it silently.

Four more bugs were found by testing *this* build before delivery, which is the
argument for `npm run check` and for the local dry run:

- A failed code reply lost the record of who commented.
- The thread-list route was swallowing the thread-messages route.
- The reply length cap could cut a word in half.
- **Five routes returned a promise without `await` inside the try block**, so
  rejections escaped the error handler entirely and a forged deletion request
  returned an opaque 500 instead of 403.

A third round, a full code and security review run immediately before this
became open source, found sixteen more worth naming rather than burying in a
commit message:

- **A stored-XSS-plus-SSRF pair that could fully take over the dashboard from
  a leaked ingest token.** Media upload accepted any `Content-Type` (including
  `text/html`) and any `source_url` with no host restriction. Uploads are now
  allow-listed to real image/video types, served with `nosniff`, and
  `source_url` is restricted to public http(s) hosts.
- **A follow-up could send twice** if two cron passes overlapped. It's now
  claimed atomically before sending, the same way posts already were.
- **A follow-up could fire after the contact had already replied**, if they
  replied on the *other* channel (DM vs. comment) from the one the follow-up
  was queued on, or on the same calendar day, because of a timestamp-format
  mismatch. Both are fixed.
- **The ESCALATE guardrail could be talked around** by the model wrapping the
  word in a sentence instead of returning it bare. Checked as a substring now,
  not an exact match — the safe direction to be wrong in.
- **A contact mid-escalation on one channel could still get an automated
  reply on the other.** Checked across both now.
- **Meta's data-deletion callback didn't delete everything it claimed to.** A
  comment that never matched a code left identifiable text in the event log
  forever, since no `contacts` row was ever created for it to cascade from.
- **A retry after a successful-but-unrecorded publish could double-post to
  Instagram.** Container and media IDs are now recorded incrementally, and a
  failure after Instagram already has the post live is left as a loud,
  unrepeatable stuck state instead of retried from scratch.
- **A Story published as a video always failed**, and a carousel slide could
  silently post a video as a static image if its extension didn't say so.
  Both now check the file's real content type.
- **On the one Sunday a year US clocks spring forward, two slots an hour
  apart could collide onto the same instant**, silently pushing one a week
  out.
- **`npm run check`'s own safety net had gaps**: the encryption and signature
  tests silently skipped on Node 18 (this project's documented minimum), the
  token scanner only checked a fixed list of files instead of the whole
  project, and nothing tested the one guarantee that makes an ingest token
  safe to leak — that it can never publish directly. All closed, and the
  DST bug above is now specifically asserted against.
- Plus a calendar day-placement bug for any timezone other than UTC, an
  explicit `0` silently reset to a default in three settings fields, and the
  hourly/daily send caps themselves having a race window under concurrent
  webhook deliveries.

Full detail on any of these is in the commit history around the open-source
release.

---

## 4. Setup

In order. Step 6 has a trap in it that is called out.

### Before you start

- Node.js 18 or newer
- Wrangler: `npm install -g wrangler`, then `wrangler login`
- An Anthropic API key from console.anthropic.com, only needed for AI DM replies

```bash
cd leadspanic-instagram
npm install
```

### Step 1 — get your Instagram tokens

Generate a fresh long-lived token for each account in the Meta developer console.
You will paste them into the app in step 7. Do not put them in any file: this
project's whole design (see section 3) exists because a predecessor project
once had tokens pasted into a tracked file by mistake. `npm run check` fails
the build if that ever happens again, but the safest habit is to never let a
token touch a file at all — paste it into the dashboard, once, and let it get
encrypted immediately.

### Step 2 — create the storage

```bash
wrangler r2 bucket create leadspanic-ig-media
wrangler d1 create leadspanic-ig
```

Copy the `database_id` the second command prints into `wrangler.toml`, replacing
`REPLACE_WITH_DATABASE_ID_FROM_WRANGLER_D1_CREATE`. **Deploy fails until you do.**

### Step 3 — create the tables

```bash
npm run db:migrate
```

Creates every table and seeds both accounts paused, with replies off and no
token. Fail-safe: nothing can send until you deliberately turn it on.

### Step 4 — set your secrets

```bash
wrangler secret put API_TOKEN               # openssl rand -hex 32
wrangler secret put TOKEN_ENC_KEY           # openssl rand -hex 32  (exactly 64 hex chars)
wrangler secret put META_APP_SECRET         # Meta app → Settings → Basic
wrangler secret put WEBHOOK_VERIFY_TOKEN    # any string you invent, re-entered in Meta's dashboard
wrangler secret put ANTHROPIC_API_KEY       # console.anthropic.com
wrangler secret put INGEST_TOKEN            # optional, see section 9. Only needed to wire skills up.
```

- `API_TOKEN` — the password for the app. You type it once in the browser.
- `TOKEN_ENC_KEY` — encrypts your Instagram tokens. **Change this later and every
  stored token becomes unreadable; you must re-paste them.**
- `META_APP_SECRET` — proves an incoming webhook really came from Meta, and
  verifies data deletion requests. Without it anyone who found your webhook URL
  could make your account send DMs.
- `WEBHOOK_VERIFY_TOKEN` — used once, during Meta's handshake.
- `ANTHROPIC_API_KEY` — writes DM replies. Comment codes never use it.

### Step 5 — check before you deploy

```bash
npm run check
```

Verifies config, asserts the comment matcher and the timezone maths, round-trips
the token encryption and both Meta signature schemes, and scans every file for
anything shaped like a live access token. Two warnings are expected before your
first deploy.

### Step 6 — deploy, twice

```bash
npm run deploy
```

Wrangler prints your live URL. **Put that exact URL into the `PUBLIC_ORIGIN` line
in `wrangler.toml` and deploy again.**

This is the trap. Meta downloads your media *from* `PUBLIC_ORIGIN` while creating
a post, and your tracked short links are built from it. Wrong value means
publishing fails with an error that looks like an authentication problem. The app
shows a red banner while it is still the placeholder, and the publisher refuses
to try rather than failing confusingly.

### Step 7 — open the app and paste your tokens

Open the URL. It asks for your `API_TOKEN` once and remembers it in that browser.
Add it to your phone's home screen if you want it as an app.

Settings → pick an account → paste that account's fresh token → save. The app
checks it with Instagram, confirms it belongs to the account you think it does,
exchanges it for a fresh long-lived one, encrypts it, stores it. Never shown
again. Repeat for the second account.

Then **Activate account**. Leave **automatic replies off** until App Review
clears and you have tested on a throwaway account.

### Step 8 — test publishing before anything else

Schedule one real post a few minutes out, then press **Run now** instead of
waiting for the cron. Check Activity. A green `post_published` row with a
permalink means the whole media pipeline works.

Get this working before touching the DM half. It proves your token handling,
media storage, and deploy on the simpler of the two systems.

### Step 9 — connect Meta (only needed for codes and DMs)

In the Meta developer dashboard:

| Setting | Value |
|---|---|
| Webhook callback URL | `https://<your-worker-url>/webhook/instagram` |
| Verify token | the `WEBHOOK_VERIFY_TOKEN` from step 4 |
| Subscribed fields | `comments` and `messages` |
| Privacy Policy URL | `https://<your-worker-url>/privacy` |
| Data Deletion Request URL | `https://<your-worker-url>/webhook/deletion` |

The last two are App Review requirements and are served by this Worker. The
Settings tab shows both URLs once `PUBLIC_ORIGIN` is set, ready to copy.

---

## 5. Verify against Meta's docs before you go live

Flagging rather than asserting. Meta changes endpoint shapes and permission
requirements between versions, and this is exactly where being confidently wrong
costs a week. Check each against Meta's own current docs, not a blog post and
not me:

1. **Which permissions content publishing needs.** The old `ig-scheduler` README
   claimed no App Review was needed for accounts you own. Often true in
   development mode against your own or tester accounts, but production
   publishing normally involves `instagram_business_content_publish`.
2. **That `instagram_manage_messages` and `instagram_manage_comments` need App
   Review.** Confident about this one; confirm the current process.
3. **`instagram_business_manage_insights`**, the third permission, needed for the
   Analytics tab's reach and saves. Click counts do not need it.
4. **The carousel publishing flow**: child containers with `is_carousel_item`,
   then a `CAROUSEL` parent with `children`, then publish the parent. Confirm the
   slide count limits and which media types may be mixed.
5. **The private reply endpoint**, `POST /{ig-user-id}/messages` with
   `recipient: {comment_id}`, and the time window Meta allows between a comment
   and a private reply.
6. **The public comment reply endpoint**, `POST /{comment-id}/replies`.
7. **The 24-hour messaging window**, which is why follow-up delays are capped
   under 24 hours.
8. **Your actual rate limits.** The 150/hour cap is a conservative guess under a
   widely-reported ~200/hour ceiling, not a measured value.
9. **`GRAPH_VERSION`** in `wrangler.toml` is pinned to `v25.0`. Confirm it is
   current and supported.

If any differ, the change is small and lives in one file: `src/meta.js`.

---

## 6. Meta App Review

You are requesting three permissions: `instagram_manage_messages`,
`instagram_manage_comments`, and `instagram_business_manage_insights`. Request
exactly those. Checking extra boxes "just in case" is the most common rejection
reason.

**Timeline is the real constraint.** First-pass review commonly runs 2 to 20
days, and a rejection adds 3 to 5 more. Everything else here is hours of work.
Start early and in parallel.

**Order matters.** Reviewers test a live, working demo, not a mockup. Deploy and
get the comment flow working on a throwaway account *before* recording the
screencast. Build the comment flow first: it is a fixed-template send with no AI,
so it is the fastest thing to get demonstrably working.

**Before you record**, confirm both compliance URLs load in a browser you are not
signed into: `/privacy` and `/webhook/deletion`. A privacy policy that 404s is a
guaranteed rejection.

### Screencast script

One continuous recording, narrated, no jump cuts.

> "This app is Leadspanic Social. It automates three things on the connected
> Instagram account: replying to specific comment keywords with a private
> message, answering direct messages using a knowledge base the account owner
> controls, and reading post performance metrics for the owner's own posts."

**Part 1, comments:** show a post, comment a word matching one of your codes,
switch to the DM inbox, show the private reply arriving with the link. Say: *"The
app detected the keyword and sent a private reply automatically, using
instagram_manage_comments to read the comment and send the private reply."*

**Part 2, messages:** send a plain question as a DM, show the reply. Say: *"The
app read the incoming message and replied using instagram_manage_messages, based
only on information the account owner entered in the dashboard."*

**Part 3, insights:** open the Analytics tab, press Pull fresh Insights, show
reach and saves appearing. Say: *"The app reads performance metrics for the
owner's own posts using instagram_business_manage_insights, shown only to the
account owner."*

**Part 4, the guardrail.** Not required, and the single best thing you can add.
Send a DM saying "I want a refund." Show Activity: no reply sent, the
conversation flagged for a human. This demonstrates you built restraint, not just
reach.

### If it is rejected

Rejections are vague on purpose. Do not resubmit the same video. Check, in
order: could someone who has never seen the app replicate every step from the
video, is the privacy policy live at a URL Meta can reach, does the app's
behaviour match exactly what you narrated. Fix, re-record, resubmit once.

---

## 7. Comment codes

Each code has:

- **Keyword** — what people comment. Stored uppercase, matched case-insensitively.
- **Link** — the destination. Sent as a tracked short link with UTMs applied.
- **Reply text** — `{{link}}` is replaced with the tracked link.
- **Public reply** — optional text posted in the comment thread itself, e.g.
  "Sent, check your DMs." This is the half that feeds the post back into the
  algorithm. Leave blank to send only the DM.
- **Follow-up** — optional single message N hours later, cancelled automatically
  if they reply first. Keep under 24 hours; Instagram will not deliver later.
- **Tag** — everyone using this code gets tagged, so you can segment later.
- **Matching** — *whole word* (default, safer) or *anywhere in the comment*.
- **Priority** — lower wins. "MAP and PRICING" sends one reply, not two.
- **Only on one post** — optional. Blank means every post.
- **Active** — switch off without deleting.

**Test before going live.** The Codes tab has a test box: type a comment, and it
shows which code fires, the exact DM, the public reply, the tag, and the
follow-up, without touching Instagram. Verified behaviour:

| Comment | Result |
|---|---|
| `MAP` | fires |
| `map please` | fires, case-insensitive |
| `#MAP` | fires |
| `MAP!` | fires |
| `MAP_2` | fires, underscore is a separator |
| `mapping my area` | does **not** fire |
| `roadmap` | does **not** fire |
| `MAPS` | does **not** fire |

A code whose link still says `REPLACE_ME` gets no short link and will not send.
It logs `send_blocked` instead, so a half-configured code fails visibly rather
than DMing a dead URL. Two example codes ship that way on purpose.

---

## 8. Posting schedule and the queue

Add slots on the Schedule tab: weekday plus time, in the account's timezone. Then
either tick "use the next free slot" when composing, or `POST /api/queue`, and
the post lands on the next slot nothing else occupies.

Timezones are handled properly rather than by storing an offset. 9am Eastern is
13:00 UTC in summer and 14:00 UTC in winter; both are asserted in
`npm run check`, along with the case where a late-evening slot falls on the next
day in UTC and must still count as the earlier weekday locally.

---

## 9. Connecting your content skills

The skills render pixels. This app schedules them. The bridge is a script, not
an MCP server: three HTTP calls, run from wherever the skill runs.

### The ingest token

There are two tokens with two privilege levels:

| Secret | Can do |
|---|---|
| `API_TOKEN` | everything. This is you, in the dashboard. |
| `INGEST_TOKEN` | upload media, create drafts. **Nothing else.** |

The second one exists because an unattended pipeline needs a credential it can
carry, and you would never want the admin token sitting in a skill bundle or a
scheduled routine. An ingest token cannot read your inbox, cannot pause the
account, cannot replace an access token, cannot force a publish. Worst case, a
leaked ingest token fills your media library with drafts you never approve.

Set it when you are ready to wire the skills up:

```bash
wrangler secret put INGEST_TOKEN     # openssl rand -hex 32, different from API_TOKEN
```

It is optional. Leave it unset and only the admin token works.

**Anything an ingest token creates is a draft, always.** That is enforced in the
Worker, not in the script, and it cannot be overridden by passing `status` in
the request body. So the safety chain is: skill creates a draft → it appears on
your calendar with an amber bar → nothing reaches Instagram until you tap
Approve.

### The publish skill

`leadspanic-publish` owns the API and the script. The three content skills hand
off to it rather than each carrying their own copy, so when this API changes
there is one place to update, not three.

```bash
# a whole leadspanic-grid output directory
python3 scripts/publish.py --url <worker_url> --key <INGEST_TOKEN> \
    --account leadspanic --batch ./out

# see what would happen, send nothing
... --dry-run
```

Batch mode groups `slide*.png` into one carousel in **numeric** order (so
`slide10` lands after `slide2`, not before it), pairs captions from
`captions.txt`, skips `thumbnail.png`, and publishes the rest as singles. Each
post goes into the next free slot on your posting schedule unless you pass
`--at`.

Credentials are arguments, never files. Same convention `fetch_queue.py`
already uses for the content-queue API: Claude asks you for the URL and key at
run time.

### Raw API, if you want it without the skill

```bash
# upload, once per image
curl -X POST https://<your-worker>/api/media \
  -H "Authorization: Bearer <INGEST_TOKEN>" -H "Content-Type: application/json" \
  -d '{"source_url": "<image url>"}'      # or {"data_base64": "...", "content_type": "image/png"}

# then create the post, into the next free slot
curl -X POST https://<your-worker>/api/queue \
  -H "Authorization: Bearer <INGEST_TOKEN>" -H "Content-Type: application/json" \
  -d '{"account_id":"leadspanic","media_type":"CAROUSEL",
       "media_keys":["s1.png","s2.png","s3.png","s4.png","s5.png","s6.png"],
       "caption":"...","first_comment":"comment MAP for the breakdown","source":"claude"}'
```

Use `/api/posts` with `scheduled_time` instead of `/api/queue` when the timing
matters. `media_type` is `IMAGE`, `CAROUSEL`, `REELS`, or `STORIES`.

### Why not an MCP server

An MCP server would solve one problem: storing a credential so it works from
any device with no key handling. The scoped ingest token solves the same problem
for less. Reach for MCP when you want to schedule conversationally from your
phone with no skill invocation, or want analytics queries exposed as tools. It
would be a route on this same Worker, not a new service to host.

## 10. Every endpoint

All `/api` routes need `Authorization: Bearer <API_TOKEN>`.

| Route | Method | Purpose |
|---|---|---|
| `/api/status` | GET | health, secrets present, heartbeats, account state |
| `/api/accounts` | GET | list accounts |
| `/api/accounts/:id` | PATCH | pause, replies on/off, approval hold, timezone, AI ceiling |
| `/api/accounts/:id/token` | POST | paste a token, encrypted and stored |
| `/api/accounts/:id/test` | GET | does the stored token still work |
| `/api/posts` | GET, POST | calendar read, schedule a post |
| `/api/posts/:id` | PATCH, DELETE | edit or remove |
| `/api/posts/:id/approve` | POST | draft becomes scheduled |
| `/api/queue` | POST | schedule into the next free slot |
| `/api/slots` | GET, POST | recurring posting schedule |
| `/api/slots/:id` | PATCH, DELETE | edit or remove a slot |
| `/api/media` | GET, POST | library listing, upload |
| `/api/media/:key` | DELETE | delete, refused if a post still uses it |
| `/api/triggers` | GET, POST | comment codes; short link synced automatically |
| `/api/triggers/:id` | PATCH, DELETE | edit or remove a code |
| `/api/test-match` | POST | what would this comment do, without sending |
| `/api/analytics` | GET | clicks, code usage, insight totals |
| `/api/insights/refresh` | POST | pull fresh Insights now |
| `/api/resources` | GET, POST | DM knowledge base |
| `/api/resources/:id` | PATCH, DELETE | edit or remove an entry |
| `/api/guardrails/:account` | GET, PUT | voice, escalation list, length cap |
| `/api/contacts` | GET | list, filter by `?tag=` |
| `/api/contacts/:id` | PATCH | set tags or a note |
| `/api/conversations` | GET | inbox |
| `/api/conversations/:id/messages` | GET | one thread |
| `/api/conversations/:id/reply` | POST | reply yourself, no AI |
| `/api/conversations/:id` | PATCH | open / escalated / closed |
| `/api/scheduled-sends` | GET | queued follow-ups |
| `/api/log` | GET | the event log |
| `/api/export` | GET | full JSON snapshot, tokens stripped |
| `/api/backup` | POST | write a snapshot to R2 now |
| `/api/run-now` | POST | publish due posts and send due follow-ups |
| `/api/refresh-tokens` | POST | run the token refresh now |

Routes an `INGEST_TOKEN` may reach: `POST /api/media`, `POST /api/queue`, `POST /api/posts`. Everything else returns 403 for it.

Public, no bearer token:

| Route | Method | Purpose |
|---|---|---|
| `/webhook/instagram` | GET, POST | Meta's handshake, then Meta's events |
| `/webhook/deletion` | POST | Meta's data deletion callback |
| `/deletion-status?code=` | GET | confirmation page for a deletion |
| `/r/:code` | GET | tracked short link, counts and redirects |
| `/media/:key` | GET | so Meta can fetch your media |
| `/privacy` | GET | the privacy policy App Review requires |

---

## 11. How the guardrails actually work

**Escalation is a branch in the code, not a request in a prompt.** The model is
told to reply with the single word `ESCALATE` when a message matches your
escalation list. `src/webhook.js` checks for that string and sends nothing at
all, marks the thread escalated, and logs it. A prompt instruction can be argued
around; a code branch cannot.

**Replies can only use facts you entered.** The prompt is built from your
resources and forbids inventing a statistic, price, or date. Nothing relevant
found means the fallback line, not a guess. An empty knowledge base means every
DM gets the fallback line, which is the correct failure direction.

**An escalated thread stays with you.** The bot does not re-enter a conversation
it handed off, and a queued follow-up on that thread is cancelled.

**A follow-up is cancelled if they reply first.** Chasing someone who already
answered is the fastest way to read as a bot, and it is exactly what a naive
timer does.

**Four gates before any automated send:** the account is active, replies are
enabled, the hourly cap is not exceeded, and the daily AI-reply ceiling is not
reached. Every blocked send is logged with its reason, so "why did nothing
happen" is always answerable from the Activity tab.

**Your own replies bypass those gates**, because they restrain the bot, not you.
Pause still applies, because paused means off.

Everything above is editable in the app and takes effect on the next message.

---

## 12. When something breaks

There is no external alerting, by design: no extra service to maintain. Instead
the app watches its own pulse and tells you at the top of every screen.

**Red banner** appears for: a placeholder `PUBLIC_ORIGIN`, a missing secret, a
missing or failing token, a token under 5 days from expiry that has not renewed,
or **a publish cron that has not run in 45 minutes**. That last one is the check
that catches a silently dead scheduler.

**Check the Activity tab.** Event names are meant to be self-explanatory:

| Event | Means |
|---|---|
| `send_blocked` | a gate stopped it; the reason is in the row |
| `send_failed` | Meta refused it; Meta's own error text is in the row |
| `post_deferred` | transient Meta error, retrying with backoff |
| `followup_cancelled` | they replied first, so it was not sent |
| `webhook_rejected` | something hit your webhook without a valid signature |
| `token_refresh_failed` | the failure that silently kills everything if ignored |
| `escalated` | a DM was handed to you deliberately |
| `post_drafted` | held for your approval |

**"Nothing posted and there is no error."** The account is paused, or
`PUBLIC_ORIGIN` is still the placeholder, or the post is a draft. All three show
in the app.

**"It worked for two months then stopped."** Token expiry. Settings shows the
refresh error, and the banner has been telling you for days.

**"Comments do nothing."** In order: is the webhook subscribed to `comments`, are
replies turned on, does the code's link still say `REPLACE_ME`, and does the test
box match the comment you are typing.

**"DMs get the fallback line every time."** Your knowledge base is empty or has
no entry matching the question.

---

## 13. What is deliberately not built

Decisions, not oversights.

- **No cold outbound DMs.** Messaging businesses who never contacted you is a
  named account-restriction trigger under Meta's enforcement, and doing it from
  this app would risk the organic engine that already works. An outbound tool
  should be a separate, human-initiated project that shares no code with this one.
- **No multi-step drip.** One timed follow-up per code. Later steps in a longer
  sequence usually fall outside Instagram's 24-hour window anyway, so the extra
  state machine would mostly produce messages that cannot send.
- **No send queue.** Over the hourly cap, a reply is skipped and logged rather
  than queued. At your volume the cap will not be reached, and the log makes it
  visible if it ever is.
- **No semantic search.** Knowledge matching is keyword scoring. Worth adding
  vectors past roughly 20 to 30 entries; before that it is infrastructure bought
  against a problem you do not have.
- **No external alerts.** In-app banners and heartbeats instead, per your call.
- **No Story reply automation.**
- **No content generation.** Your skills own that; this app schedules and replies.
- **No multi-user accounts or roles.** One `API_TOKEN`. Personal use.

---

## 14. Files

```
leadspanic-instagram/
  wrangler.toml       bindings, crons, PUBLIC_ORIGIN, pinned Graph version
  schema.sql          every table, no secrets, safe to re-run
  scripts/check.mjs   pre-deploy checks and logic assertions
  src/
    index.js          the router, media, short links, deletion callback
    db.js             every SQL statement
    meta.js           every call to Instagram
    crypto.js         token encryption, webhook and signed_request verification
    schedule.js       slot placement and timezone maths
    publish.js        publish cron, follow-ups, daily maintenance
    webhook.js        comment codes and DM replies
    util.js           shared helpers, auth check, UTM tagging
  public/             the dashboard PWA and the privacy policy, no build step
```

No build step anywhere, on purpose. Open any of these, read it, change it.
