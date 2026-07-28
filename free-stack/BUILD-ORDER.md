# Build Order and Release Plan

Internal document. Not for the audience.

---

## Why this is a series and not 26 downloads

Three reasons, in order of weight.

**1. The dependency chain is real.** Guide 03 cannot be done without guide 00. If someone downloads a 26-file zip, they open the one with the best title, hit a missing prerequisite in step 2, and quit. Then they never come back and they never tell anyone. A pile of guides has a completion rate near zero.

**2. One episode per week is 26 weeks of content that never repeats.** Every guide is a build-along. You film yourself doing the exact thing the guide describes. The content is the build. The guide is the payoff in the DM. You are not making content about a product, the content and the product are the same object.

**3. Serialized content trains the algorithm.** You already committed to episodic reels so the platform learns who the content is for. "Day 7: I built you a free CRM" does that. Twenty-six standalone posts do not.

---

## The mechanic

One keyword for the whole library. Not one per guide.

```
Comment STACK
```

DM reply sends one link: the library index page.

The index page lists all 26 guides. Released ones are live links. Unreleased ones are greyed out with the release week showing. That is a content calendar the audience can see, which does two things: it proves you are not going to disappear, and it makes people come back on a schedule without you sending anything.

Email capture sits on the index page, not on the comment. Comment gets them the link. The link gets them the library. The library asks for an email to get notified when the next one drops. Three steps, each one small.

---

## Dependency chain

```
00 Foundation
 |
 +-- 01 Business Email          (no code, instant win)
 |
 +-- 02 Website                 (first deploy)
 |    |
 |    +-- 06 Link in Bio, Part A only (static page, no backend)
 |
 +-- 03 Forms                   (first database, first routed Worker file)
      |
      +-- 04 Landing Pages       (adds a route to the same index.js)
      +-- 05 File Storage        (adds a route to the same index.js)
      |    |
      |    +-- 24 Social Suite
      |
      +-- 06 Link in Bio, Part B (adds a route to the same index.js)
      +-- 07 QR Codes            (adds a route to the same index.js)
      +-- 10 Booking Page        (guide 11 is an optional add-on, not required)
      +-- 12 Lead Dashboard      (13 links to this page but does not require it)
      +-- 16 Market Data
      +-- 19 Automations         (adds a route to the same index.js)
      +-- 14 Pixel and CAPI
      |    |
      |    +-- 15 Offline Conversions
      |         |
      |         +-- 13 CRM        (refactors code from 15, hard dependency)
      +-- 08 Checkout
           |
           +-- 09 Invoicing        (reuses STRIPE_SECRET_KEY from 08)
           +-- 11 Order Emails     (reuses the webhook from 08)

Standalone, no Worker touched at all, just the tool named:
 -- 17 Census Reports    (Python, its own Census API key, not 16's D1 cache)
 -- 18 Mail Merge        (Apps Script + Sheet, guide 01 for a business address)
 -- 20 SOP Library       (Google Drive and Docs, guide 01 recommended)
 -- 21 Content Engine    (Python, reuses guide 22's text-wrapping function)
 -- 22 Thumbnails        (Python)
 -- 23 Reel Scripts      (no code, a template only)
 -- 25 Auto-DM           (Part A is a Meta dashboard walkthrough, no code at
                           all; Part B optionally extends guide 06, not 24)
```

**Sixth correction, made while writing batch 7, the final two.** 25 was pre-planned as a child of 24, on the assumption both original-five-hook guides would share infrastructure since they'd been asked about together at the very start of this project. They do not. 25's actual core, the native Meta keyword-to-DM setup, is a dashboard walkthrough with zero code, and its optional deeper half reuses guide 06's click tracking, not anything from 24. Grouping two guides because they were asked about in the same sentence, rather than because they share a dependency, was the same category of mistake as the earlier ones: a plausible-looking relationship that turned out not to be a real one once the guide got written.

**Fifth correction, made while writing batch 6.** The pre-emptive bet from the last correction was half right. 21 and 23 confirmed standalone exactly as guessed, no Worker touched by either. 19 broke the pattern: the actual highest-value automation, an instant Slack or Discord ping the moment a lead arrives, only makes sense triggered from inside `saveLead()` itself, so it needed the Worker after all. Worth stating plainly: the bet was a bet, not a rule, and this is the outcome of actually checking it rather than letting it stand unverified.

**Fourth correction, made while writing batch 5.** 17, 20, and 22 were all placed as children of Worker-based guides, 16, 02, and 05 respectively. Writing all three the same way, standalone scripts with no Cloudflare touched, showed the placements were wrong in the same direction every time: anything that does not extend `src/index.js` was still getting forced into that tree anyway, out of habit more than accuracy. Pulled every standalone tool out into its own flat list rather than inventing a nested relationship that was not real. 19, 21, and 23 are listed there pre-emptively based on the same pattern, worth confirming once those are actually written.

**Third correction, made while writing batch 4.** The original plan had 13 CRM hanging off 12 Lead Dashboard. Writing it showed the CRM's actual payload, an automatic Meta conversion report the moment a deal moves to Won, requires refactoring code straight out of guide 15, and needs guide 14's CAPI plumbing underneath that. 12 turned out to be a recommendation, one link in the CRM's header, not a technical dependency at all. Same lesson as the first two corrections, now three for three: the tree gets accurate by building, not by predicting.

**Second correction, made while writing batch 3.** Guide 18 turned out to need no Cloudflare infrastructure at all, Apps Script and a Google Sheet are the whole stack, so it moved from under 03 to under 01, the only real prerequisite it has. Guides 09 and 11 both turned out to reuse guide 08's Stripe secret key and helper functions directly, so they moved from being direct children of 03 to children of 08. Same pattern as the first correction: the dependency tree gets more accurate by actually writing the guides, not by planning harder up front.

Publish in a valid topological order. The calendar below is one.

---

## 26-week release calendar

Difficulty ramps. Week 1 is a 10 minute no-code win on purpose. If the first episode is hard, nobody sees week 2.

| Week | Guide | Episode hook |
|---|---|---|
| 0 | 00 Foundation | "Before I give you anything, do these 3 things. 30 minutes." |
| 1 | 01 Business Email | "Google charges $7 a month for this. It took me 10 minutes and cost $0." |
| 2 | 02 Website | "I built a real business website in 45 minutes. It will never send me a bill." |
| 3 | 03 Forms | "Typeform wants $29 a month. Watch." |
| 4 | 05 File Storage | "Dropbox charges for downloads. This one doesn't. Ever." |
| 5 | 06 Link in Bio | "Linktree Pro is $9 a month to change a color." |
| 6 | 04 Landing Pages | "One page. Five versions. Zero dollars." |
| 7 | 07 QR Codes | "The QR code on your truck can't be edited. Mine can." |
| 8 | 18 Mail Merge | "I emailed 447 people from a spreadsheet. $0." |
| 9 | 08 Checkout | "Taking money without Shopify." |
| 10 | 11 Order Emails | "The receipt email nobody sets up." |
| 11 | 09 Invoicing | "Invoices that don't cost $15 a month." |
| 12 | 10 Booking Page | "Calendly, but yours." |
| 13 | 12 Lead Dashboard | "Where did that lead actually come from?" |
| 14 | 14 Pixel and CAPI | "Agencies charge $300 a month for this file." |
| 15 | 15 Offline Conversions | "Teaching Meta what a closed deal looks like." |
| 16 | 13 CRM | "The big one. A CRM you own." |
| 17 | 16 Market Data | "Looking up any block in America for $0." |
| 18 | 17 Census Reports | "Real receipts, free API, 60 minutes." |
| 19 | 19 Automations | "Zapier is $29 a month to move a row." |
| 20 | 20 SOP Library | "Trainual is $60 a month for a folder." |
| 21 | 05 -> 21 Content Engine | "The thing that makes my posts." |
| 22 | 22 Thumbnails | "Canva Pro for the one feature you use." |
| 23 | 23 Reel Scripts | "The hook library I actually use." |
| 24 | 24 Social Suite | "Scheduling posts without Later." |
| 25 | 25 Auto-DM | "Replacing ManyChat with 40 lines." |

Week 26 onward: teardowns, upgrades, and reader submissions. The library keeps working.

---

## What each week produces

One build session. Four assets. Film once.

1. **The guide** (markdown, published to the index)
2. **One long-form build-along** (screen record, 8 to 15 min, YouTube)
3. **Three to five reels** cut from the same recording, 9:16, the hook is the saving
4. **One static or carousel** with the before/after cost

The recording is the source. Everything else is a cut. This is the same pattern as the teardown workflow.

---

## The ramp-up sequence

Do not publish week 0 into an empty room.

**Phase 1, before week 0.** Publish the index page with all 26 titles visible and everything greyed out. One post: the full list, the total monthly saving, and the release date of guide 00. That post is the strongest single asset in the whole plan, because the list itself is the hook. People will save it before a single guide exists.

**Phase 2, weeks 0 to 4.** No-code and easy wins only. Reply to every comment by hand. This is where the first 500 followers come from and you cannot automate it yet.

**Phase 3, weeks 5 to 15.** Turn on the keyword automation. Start the email list from the index page. Introduce the "what I would charge to do this for you" line at the end of each build-along. That is the first monetization signal and it should be soft.

**Phase 4, week 16 onward.** The CRM episode is the pivot point. Anyone who completed 16 guides is a qualified buyer for done-for-you. Offer the deploy service here, not before.

---

## The monetization line

The library is free forever and stays free forever. That is not a bait step, and if it ever becomes one the whole thing loses its only advantage.

What gets sold is the two things the library structurally cannot give away.

1. **Deployment.** "I will do all 26 for you in one week." Fixed fee.
2. **Support.** "Something broke and I need a human." Retainer or per incident.

Both of those fail the cost test in `README.md`, which is exactly why they are the paid products. The rule that decides what goes in the library is the same rule that decides what gets a price.

---

## Kill rules

- A guide that takes more than 3 hours for a reader gets split into two guides.
- A guide that requires a credit card at any step gets cut or reworked.
- An episode under 0.8% CTR after 5,000 impressions gets a new hook, not a new guide.
- If a Cloudflare limit changes and breaks a "for life" claim, the guide gets updated within 7 days or pulled. The claim is the whole asset.
