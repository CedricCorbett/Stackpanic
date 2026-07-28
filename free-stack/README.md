# The Free Stack

A build-along library. Every guide gives away one piece of business software that you own forever and never pay a monthly fee for.

No trials. No seats. No "free up to 3 users."

Published by Leadspanic. Live at `stack.leadspanic.com`. Source in this repo.

---

## The rule this library obeys

A guide only enters this library if it passes three tests.

1. **Zero marginal cost.** Running it for 1,000 people costs the same as running it for 1: nothing.
2. **Zero support burden.** The reader deploys it on their own account. You never hold their uptime.
3. **Zero metered billing.** No per-message, per-minute, per-seat charges hiding underneath.

Anything that fails a test does not get a "for life" claim. It gets a different offer.

That rule is why this library is credible. Most "free" offers are trials. This one is not, and the reader can verify it themselves in the pricing tables linked in every guide.

---

## What is inside

| # | Guide | Replaces | Typical saving | Time to build | Code? |
|---|-------|----------|----------------|----------------|-------|
| 00 | Foundation | nothing (prerequisite) | n/a | 30 min | no |
| 01 | Free Business Email for Life | Google Workspace, Zoho | $7/user/mo | 10 min | no |
| 02 | Free Website for Life | Wix, Squarespace, GoDaddy | $25/mo | 45 min | copy/paste |
| 03 | Free Forms for Life | Typeform, Jotform | $29/mo | 60 min | copy/paste |
| 04 | Free Landing Pages for Life | Unbounce, Leadpages | $99/mo | 60 min | copy/paste |
| 05 | Free File Storage for Life | Dropbox, WeTransfer | $12/mo | 30 min | copy/paste |
| 06 | Free Link in Bio for Life | Linktree Pro | $9/mo | 30 min | copy/paste |
| 07 | Free QR Codes for Life | QR Code Generator Pro | $12/mo | 30 min | copy/paste |
| 08 | Free Checkout for Life | Shopify, Samcart | $39/mo | 90 min | copy/paste |
| 09 | Free Invoicing for Life | Invoice Ninja, Bill.com | $15/mo | 60 min | copy/paste |
| 10 | Free Booking Page for Life | Calendly | $15/mo | 60 min | copy/paste |
| 11 | Free Order Emails for Life | Klaviyo transactional | $20/mo | 45 min | copy/paste |
| 12 | Free Lead Dashboard for Life | Google Data Studio + glue | $0 but painful | 90 min | copy/paste |
| 13 | Free CRM for Life | GoHighLevel, HubSpot Starter | $97/mo | 3 hrs | copy/paste |
| 14 | Free Pixel and CAPI Server for Life | agency retainer | $300/mo | 2 hrs | copy/paste |
| 15 | Free Offline Conversion Tracking for Life | nothing on the market | n/a | 90 min | copy/paste |
| 16 | Free Market Data for Life | paid demographic tools | $200/mo | 60 min | copy/paste |
| 17 | Free Census Reports for Life | paid demographic tools | $200/mo | 60 min | Python |
| 18 | Free Mail Merge for Life | Mailchimp, Lemlist | $59/mo | 45 min | Apps Script |
| 19 | Free Automations for Life | Zapier, Make | $29/mo | 90 min | Apps Script |
| 20 | Free SOP Library for Life | Trainual, Notion Business | $60/mo | 60 min | no |
| 21 | Free Content Engine for Life | Later, Buffer + a VA | $200/mo | 2 hrs | Python |
| 22 | Free Thumbnails for Life | Canva Pro | $15/mo | 45 min | Python |
| 23 | Free Reel Scripts for Life | copywriter | $500/mo | 30 min | no |
| 24 | Free Social Management Suite for Life | Later, Hootsuite | $99/mo | 3 hrs | copy/paste |
| 25 | Free Auto-DM for Life | ManyChat | $29/mo | 90 min | copy/paste |

Add it up at the top of the table and the reader is looking at roughly **$1,800 per month** of software they are currently renting.

---

## The three things that are not free

Say these out loud, early, in every guide. Credibility comes from the disclosure, not from hiding it.

1. **A domain name.** About $10 to $12 per year at Cloudflare Registrar, sold at cost with no markup and no renewal games. You already pay this.
2. **Stripe fees.** 2.9% plus 30 cents per transaction. You only pay when you get paid.
3. **Your time.** Between 10 minutes and 3 hours per guide.

Everything else is $0 and stays $0.

---

## The free tier ceilings, stated honestly

Verified against Cloudflare's published limits as of July 2026. Re-check before you publish, these pages move.

| Resource | Free plan limit | What that means in the real world |
|---|---|---|
| Worker requests | 100,000 per day | About 20,000 page views per day |
| Worker CPU | 10 ms per request | Fine for everything in this library |
| Worker size | 3 MiB | Fine |
| Subrequests | 50 per invocation | Fine |
| D1 storage | 5 GB | Roughly 5 million lead records |
| D1 rows read | 5 million per day | Fine |
| D1 rows written | 100,000 per day | Fine |
| R2 storage | 10 GB per month | About 2,000 photos or 40 short videos |
| R2 egress | $0, always | This is the one that beats everyone |
| Pages builds | 500 per month | Fine |
| Email Routing | unlimited | Fine |

If a small business exceeds these, they have a good problem and a $5 per month bill.

---

## How to use this library

**As a reader:** start at 00. Do not skip it. Everything after it assumes the foundation is done. Then go in any order you want.

**As the publisher:** see `BUILD-ORDER.md`. The guides are not a pile of PDFs. They are a sequence, and the sequence is the content calendar.

---

## Guide format

Every guide in `/guides` follows the same shape. See `TEMPLATE.md`.

1. What you get
2. What it replaces and what that costs today
3. What is actually free and what is not
4. Prerequisites
5. Build it (numbered, copy/paste, no gaps)
6. Verify it works
7. What breaks and how to fix it
8. What to do next

No step is ever "and then configure it." Every step is a command or a click.

---

## License

MIT. See `LICENSE`. Do what you want with it, attribution appreciated, not required.

## Repo layout

```
free-stack/
├── README.md          this file
├── BUILD-ORDER.md      publish sequence, internal, not for the audience
├── TEMPLATE.md          the shape every guide follows
├── LICENSE
├── guides/              00 through 25, one file per guide
├── site/                stack.leadspanic.com, the Worker, D1, and the manifest-driven page
└── marketing/           launch post copy and the STACK keyword spec
```
