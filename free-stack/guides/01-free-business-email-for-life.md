# 01. Free Business Email for Life

**Time: 10 minutes. Cost: $0. Code: none.**

Stop paying per user for an email address.

---

## What you get

`you@yourbusiness.com` landing in the inbox you already read. Plus `sales@`, `info@`, `billing@`, and as many others as you want, all free, all forwarding wherever you say.

---

## What it replaces

| Tool | Cost |
|---|---|
| Google Workspace | $7 per user per month |
| Microsoft 365 Business Basic | $6 per user per month |
| Zoho Mail | $1 to $4 per user per month |
| GoDaddy Email | $6 per user per month |

Three people on Google Workspace is $252 a year. Forever. For forwarding.

---

## What is actually free and what is not

**Free forever:** receiving mail at your domain. Cloudflare Email Routing has no per-address charge and no volume tier.

**The one asterisk:** Cloudflare forwards mail in. It does not send mail out. To reply *from* `you@yourbusiness.com` instead of your Gmail address, you need a mail relay. Free relays exist. They are the one third-party dependency in this guide, and their free tiers can change. Part B covers it and gives you two options.

If you only need to receive, stop after Part A and you have a genuinely permanent, dependency-free setup.

---

## Prerequisites

- Guide 00 complete
- Your domain shows **Active** in the Cloudflare dashboard

---

# Part A. Receiving mail

## Step 1. Turn on Email Routing

1. Cloudflare dashboard, click your domain.
2. Left sidebar, click **Email**, then **Email Routing**.
3. Click **Get started**.

## Step 2. Add your first address

Cloudflare asks for two things.

- **Custom address:** the one you want people to write to. Example: `hello@yourbusiness.com`
- **Destination address:** the inbox you actually check. Your personal Gmail is fine.

Click **Create and continue**.

## Step 3. Confirm the destination

Cloudflare emails your destination inbox a verification link. Click it. This exists so you cannot forward mail to someone who did not agree to receive it.

## Step 4. Let Cloudflare add the DNS records

Cloudflare shows you the MX and TXT records it needs. Click **Add records and enable**.

Do not hand-copy these. Let it do it.

> **What just happened.** MX records tell the internet which server accepts mail for your domain. You just pointed them at Cloudflare. The TXT record is SPF, which tells receiving servers that Cloudflare is allowed to handle mail for you. Without it your forwarded mail lands in spam.

## Step 5. Add the rest of your addresses

Back on the Email Routing page, click **Routing rules**, then **Create address**. Repeat for each one you want.

A setup that covers most small businesses:

| Address | Forwards to |
|---|---|
| `hello@` | you |
| `sales@` | you |
| `billing@` | you or your bookkeeper |
| `support@` | you or whoever handles it |

There is also a **Catch-all** toggle. Turn it on and anything sent to any address at your domain forwards to you, including typos. This is worth doing.

## Step 6. Test it

Send an email from your phone to `hello@yourbusiness.com`. It should land in your destination inbox within a few seconds.

If it does not arrive in two minutes, check your spam folder before you assume it is broken.

**You are done with Part A.** You now have unlimited business email addresses for $0 per month, forever, with no third-party service in the path.

---

# Part B. Replying from your business address

Optional. Do this if replying from a Gmail address looks unprofessional to your buyers.

## Why you need a relay

Gmail will not let you send mail claiming to be from a domain it does not control unless you give it a real mail server to send through. That server is called an SMTP relay.

## Step 1. Pick a relay

Two options with real free tiers as of July 2026. Verify the current numbers on their pricing pages before you commit, because these move.

| Service | Free tier | Notes |
|---|---|---|
| Brevo | 300 emails per day | Most generous. Free tier has been stable for years. |
| Resend | 3,000 per month, 100 per day | Cleaner interface. Tighter daily cap. |

For an inbox you reply from, 300 a day is far more than enough. Use Brevo.

## Step 2. Get SMTP credentials

1. Sign up at `https://www.brevo.com`
2. In the dashboard, find **SMTP & API**.
3. Copy the **SMTP server**, **Port**, **Login**, and generate an **SMTP key**.

Write these down. The key is only shown once.

## Step 3. Authenticate your domain

Brevo will give you DNS records to prove you own the domain. Usually a DKIM record and a DMARC record.

1. Copy each record from Brevo.
2. In Cloudflare, go to your domain, then **DNS**, then **Records**, then **Add record**.
3. Add each one exactly as Brevo shows it.

Go back to Brevo and click verify. This can take a few minutes.

> **What just happened.** DKIM is a cryptographic signature on your outgoing mail. DMARC tells receiving servers what to do with mail that fails the check. Skipping these is the single most common reason business email goes to spam.

## Step 4. Add the address to Gmail

1. Gmail, click the gear, then **See all settings**.
2. Tab: **Accounts and Import**.
3. Under "Send mail as," click **Add another email address**.
4. Name: your name or business name. Email: `hello@yourbusiness.com`. Leave **Treat as an alias** checked.
5. Next it asks for SMTP. Fill in the values from Brevo.
   - SMTP Server: the one Brevo gave you
   - Port: `587`
   - Username: your Brevo login
   - Password: your Brevo SMTP key
   - Select **Secured connection using TLS**
6. Click **Add Account**.
7. Gmail sends a confirmation code to `hello@yourbusiness.com`. That forwards to you via Part A. Grab the code and enter it.

## Step 5. Make it the default

Same settings page. Next to your business address, click **make default**.

Also set the dropdown to **Reply from the same address the message was sent to**. Now replies to `sales@` go out as `sales@` automatically.

---

## Verify it works

- [ ] Mail sent to `hello@yourbusiness.com` arrives in your inbox
- [ ] Catch-all is on and a typo address still reaches you
- [ ] (Part B) A test message sent from Gmail shows your business address as the sender
- [ ] (Part B) Send a test to `check-auth@verifier.port25.com` and read the reply. SPF, DKIM, and DMARC should all say **pass**.

That last check is worth doing. It is the difference between the inbox and the spam folder, and most people never run it.

---

## What breaks and how to fix it

**Mail is not arriving at all**
Your MX records are wrong or your domain is still pending. Cloudflare, DNS, Records. You should see MX records pointing at addresses ending in `mx.cloudflare.net`. If you see MX records from a previous email provider, delete them. Two sets of MX records is the number one cause of this.

**Mail arrives but goes to spam**
The SPF TXT record is missing. Re-run the Email Routing setup wizard and let it add records again.

**Gmail says "Authentication failed" on the SMTP step**
You used your Brevo account password instead of the SMTP key. They are different. Regenerate the key.

**Replies show "on behalf of" or "via brevo"**
DKIM did not verify. Check the DKIM record in Cloudflare matches Brevo exactly, including any trailing characters. This is usually a copy-paste truncation.

**You hit the 300 per day cap**
You are using this as a bulk sender, not an inbox. That is a different job. See guide 18, Free Mail Merge for Life.

---

## What to do next

Go to **02. Free Website for Life**. Your first real deploy.

---

## Sources to verify yourself

- Email Routing limits: `https://developers.cloudflare.com/email-routing/limits/`
- Brevo pricing: `https://www.brevo.com/pricing/`
