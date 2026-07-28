# Deploying the site

This is `stack.leadspanic.com`. It is guide 03's pattern (a form that writes to D1) applied to email capture instead of leads, serving the manifest-driven ledger from `public/index.html`.

If you have not done guide 00 and guide 03 yet, do those first. This assumes both.

## Deploy

From this folder:

```
npx wrangler d1 create free-stack-subscribers
```

Copy the `database_id` it prints into `wrangler.toml`, replacing `PASTE-YOUR-ID-HERE`.

```
npx wrangler d1 execute free-stack-subscribers --remote --file=./schema.sql
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

Then attach the custom domain the same way guide 02 step 5 shows: **Compute (Workers)** → **free-stack-site** → **Settings** → **Domains & Routes** → add `stack.leadspanic.com`.

## Before this goes live, edit two things

1. **`public/index.html`**, near the bottom of the `<script>` tag: `REPO_BASE` points at `github.com/leadspanic/free-stack`. Swap it for your real repo path once it exists.
2. **`repo`** section in the same file: the visible link text and `href` next to "Every guide, every line of code...". Same swap.

## Updating the manifest weekly

Edit `public/manifest.json` only. Flip a guide's `"status"` from `"locked"` to `"live"` the day it publishes, then:

```
npx wrangler deploy
```

That is the entire weekly release process. No code changes, no redesign, one field flip and a deploy.

## Checking who signed up

`https://stack.leadspanic.com/admin`, username `admin`, the password you set above.
