# 19. Free Automations for Life

**Time: 30 minutes. Cost: $0. Code: copy and paste.**

The single most common thing people pay Zapier for: when this happens, tell me immediately. No monthly fee, no task limit.

---

## What you get

The moment a lead comes in, a message lands in Slack or Discord, whichever you use, seconds after they hit submit. No checking `/admin` every hour to see if anything is new.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Zapier | $29.99 to $73.50 per month | Priced by number of tasks per month, a busy month costs more |
| Make (formerly Integromat) | $9 to $29 per month | Cheaper than Zapier, same idea, same recurring bill |

The specific automation both of these get bought for most often, "notify me the second a lead comes in," is one webhook call. That is the entire mechanism, on either platform, under all the workflow-builder UI.

---

## What is actually free and what is not

Entirely free. Slack and Discord both offer incoming webhooks with no cost and no message limit worth worrying about at small-business volume.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- A Slack workspace or a Discord server you already use

---

## Step 1. Create the webhook

**Slack:** Go to `https://api.slack.com/apps`, **Create New App**, **From scratch**, name it and pick your workspace. In the app settings, **Incoming Webhooks**, toggle it on, **Add New Webhook to Workspace**, pick a channel. Copy the URL, starts with `https://hooks.slack.com/services/`.

**Discord:** In your server, go to the channel you want notified in, **Edit Channel**, **Integrations**, **Webhooks**, **New Webhook**. Name it, copy the **Webhook URL**, starts with `https://discord.com/api/webhooks/`.

Either way, you now have one URL. Treat it like a password, anyone with it can post to that channel.

## Step 2. Store it

```
npx wrangler secret put NOTIFY_WEBHOOK_URL
```

Paste whichever URL you got.

## Step 3. Add the notification function

Open `src/index.js`. Add this in the checkout or leads section:

```js
// ---------------------------------------------------------------
// Instant notifications (guide 19)
// ---------------------------------------------------------------

async function notifyTeam(env, message) {
  if (!env.NOTIFY_WEBHOOK_URL) return; // not configured, skip silently

  const isDiscord = env.NOTIFY_WEBHOOK_URL.includes("discord.com");
  const body = isDiscord ? { content: message } : { text: message };

  const res = await fetch(env.NOTIFY_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    console.error("Notification webhook failed:", await res.text());
  }
}
```

> **Why it checks `env.NOTIFY_WEBHOOK_URL` and returns quietly instead of erroring.** Same reasoning as the Brevo check in guide 10. Not everyone using this file will have done this guide, and a missing notification should never take down the actual lead capture underneath it.

> **Why it auto-detects Slack versus Discord from the URL.** The two platforms want the message text under a different key, `text` for Slack, `content` for Discord. Checking the URL itself means one function handles both, no separate config flag to remember to set correctly.

## Step 4. Call it when a lead comes in

Find `saveLead()` from guide 03. Right after the `INSERT INTO leads` call succeeds, add:

```js
  await notifyTeam(env, `New lead: ${name} (${email || phone}) from ${source || "direct"}`)
    .catch(err => console.error("Notify failed:", err.message));
```

## Step 5. Deploy and test

```
npx wrangler deploy
```

Submit a test lead through your contact form. Check Slack or Discord, the message should appear within a couple of seconds.

---

## Verify it works

- [ ] A test lead produces a channel message within a few seconds
- [ ] The message shows the correct name, contact info, and source
- [ ] Removing the `NOTIFY_WEBHOOK_URL` secret does not break lead capture, it just stops sending notifications
- [ ] A malformed or revoked webhook URL fails quietly in the logs, `npx wrangler tail`, rather than breaking the form

---

## What breaks and how to fix it

**No message ever arrives, no error either**
`NOTIFY_WEBHOOK_URL` was never set, so the function returns immediately by design. Confirm with `npx wrangler secret put NOTIFY_WEBHOOK_URL` again.

**Message arrives in the wrong Discord channel or Slack channel**
The webhook is bound permanently to the channel it was created in on both platforms. You cannot redirect an existing webhook, delete it and create a new one in the correct channel.

**"invalid_payload" from Slack**
The JSON body is malformed, almost always because a template literal somewhere has an unescaped quote or line break inside the message text. Log the message string before sending it and check it by eye.

**Discord shows the notification but it looks blank**
An empty or whitespace-only `content` field. Discord silently accepts this rather than erroring, check that `name`, `email`, and `source` are not all empty on the lead that triggered it.

**Webhook worked yesterday, fails today**
Someone in the workspace or server deleted or regenerated it. Both platforms let this happen with no warning to integrations using the old URL. Recreate it and update the secret.

---

## What to do next

This same pattern, one function, one webhook check, works anywhere else in this file that something worth knowing about just happened. A new order from guide 08, a booking from guide 10, a conversion from guide 15, all one line each: `await notifyTeam(env, "...")`. Wire in whichever of those matter most to hear about immediately.

Go to **21. Free Content Engine for Life** next.

---

## Sources to verify yourself

- Slack incoming webhooks: `https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/`
- Discord webhooks: `https://docs.discord.com/developers/resources/webhook`
