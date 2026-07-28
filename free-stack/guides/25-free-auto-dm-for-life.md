# 25. Free Auto-DM for Life

**Time: 20 minutes for Part A, 30 more for Part B. Cost: $0. Code: none for Part A, copy and paste for Part B.**

The last of the original five. Someone comments a word, they get a DM. This is the exact mechanic this library used to reach you.

---

## What you get

Comment a keyword on your post, get an instant DM with whatever you want to send, a link, an offer, an answer. Built entirely on Meta's own free tools, no third-party app holding the keys to your account.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| ManyChat | $15 to $145 per month | Priced by contact count, a viral post can bump you a tier overnight |
| Chatfuel | $14.99 to $300 per month | Similar shape, similar bill |

---

## What is actually free and what is not

Entirely free, both parts. Part A lives inside Meta Business Suite, which costs nothing to use. Part B reuses infrastructure you already built in guide 06, no new service anywhere.

---

## Prerequisites

**Part A:** An Instagram account set to Professional, Business or Creator, free to switch in the Instagram app's own settings.

**Part B:** Guide 06 complete, specifically the click-tracking half, Part B of that guide.

---

# Part A. The native automation

This is the same mechanic every keyword-to-DM funnel in this library runs on, including the one that likely got you this document.

## Step 1. Open Automations

Go to `https://business.facebook.com`, log in with the account connected to your Instagram Professional profile. In the left menu, click **Inbox**, then **Automations** in the top menu of that section.

## Step 2. Create a keyword reply

1. Click **Create automation**, or find **Comment to Message** or **Keyword replies** depending on what your account's interface labels it, Meta renames this occasionally.
2. Set the trigger: a specific word or phrase someone comments, on a specific post or on all posts.
3. Set the reply: the DM that gets sent, write it exactly as you would type it to one person.
4. Choose whether to also leave a public reply on the comment itself, most people leave this off so the DM feels like the actual payoff.
5. Save and turn it on.

## Step 3. Test it yourself

Comment your own keyword on the target post from a different account, or ask someone else to. Confirm the DM arrives within a few seconds.

---

## Verify it works, Part A

- [ ] Commenting the exact keyword produces a DM within seconds
- [ ] A near-miss, wrong capitalization or a typo, either still triggers it or clearly does not, confirm which, Meta's keyword matching behavior is worth knowing precisely before you rely on it
- [ ] The automation applies to the posts you intended, not accidentally scoped to only one when you meant all

---

## What breaks and how to fix it, Part A

**Keyword automation menu is missing entirely**
The Instagram account is not set to Professional. Switch it in the Instagram app, Settings, Account type, this takes effect within minutes.

**DM never arrives even though the comment posted**
Check the automation is actually toggled on, it is easy to save a draft and never flip the enable switch. Also confirm the triggering post is the one the rule is actually scoped to.

**It worked, then stopped working with no changes made**
Meta occasionally requires re-confirming Page and Instagram account permissions after their own backend changes. Re-open the automation, resave it, this usually resolves silently.

**Multiple keywords need different DMs**
Native automations support multiple separate rules, each with its own keyword and its own reply. Create one rule per keyword rather than trying to cram conditional logic into a single rule, the native tool is not built for branching.

---

# Part B. Make the link inside the DM trackable

Optional. The native automation above has no analytics of its own, you cannot see how many people who got the DM actually clicked through. This closes that gap using guide 06's redirect-and-log pattern, already built, nothing new to learn.

## Step 1. Point the DM at a tracked link

If you have not already, complete guide 06 Part B. You will have a working `/l/<slug>` redirect that logs a click before sending someone on.

## Step 2. Add a slug for this specific keyword

Open `src/index.js`, find the `LINKS` object from guide 06:

```js
const LINKS = {
  site:      "https://yourbusiness.com",
  whatsapp:  "https://wa.me/18645551234",
  quote:     "https://yourbusiness.com/contact",
  instagram: "https://instagram.com/yourbusiness",
  // add one entry per keyword automation
  guide:     "https://yourbusiness.com/lp?v=igdm-guide"
};
```

The destination can be any page in this library, a landing page from guide 04 with its own `?v=` tag, a booking page from guide 10, whatever the DM is actually promising.

## Step 3. Deploy

```
npx wrangler deploy
```

## Step 4. Update the DM's text in Meta Business Suite

Go back to the automation from Part A, edit the reply to include `https://yourbusiness.com/l/guide` instead of a raw destination link.

## Step 5. Check the numbers

Same command from guide 06:

```
npx wrangler d1 execute leads --remote --command="SELECT slug, COUNT(*) as clicks FROM link_clicks GROUP BY slug ORDER BY clicks DESC"
```

Now the `guide` row tells you exactly how many people who got this specific DM actually clicked through, the number ManyChat would otherwise put behind a paid tier.

---

## Verify it works, Part B

- [ ] The DM's link now shows your own domain, `/l/guide`, not the raw destination
- [ ] Clicking it still lands correctly on the intended page
- [ ] The click count query shows a rising number as people click through
- [ ] The click gets logged even though it originated from inside Instagram's own DM interface, not your own site, confirming the tracking works regardless of where the link was clicked from

---

## What breaks and how to fix it, Part B

**Link in the DM still shows the untracked version**
The automation's reply text was not actually updated and resaved in Meta Business Suite, this is a manual edit on their side, not something the code push touches.

**Clicks are not being logged**
Confirm the slug in the DM's URL, `/l/guide`, matches a key in `LINKS` exactly. A mismatch here fails silently to a 404 rather than an error you would notice immediately.

**You want per-keyword attribution but multiple keywords point to the same slug**
Give each keyword automation its own unique slug in `LINKS`, even if they currently point at the same destination. Splitting them now costs nothing and means you are not stuck merging data later if you ever want to see them separately.

---

## What to do next

That is the library, all 26. Guide 13's CRM is the room where everything else in this project actually gets used day to day, worth a look back at if it has been a while since you built it.

---

## Sources to verify yourself

- Meta Business Suite automations: `https://www.facebook.com/business/help` (search "Instagram automated responses")
