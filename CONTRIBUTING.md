# Contributing

Thanks for looking at this. A few things that will make a change easy to
review and merge.

## Before you write code

For anything bigger than a typo fix, open an issue first describing what you
want to change and why. This project deliberately does *not* build some
things (see "What is deliberately not built" in the README) — an issue first
saves you writing a PR for something that's a considered no.

## Local setup

```bash
cd leadspanic-instagram
npm install
npm run check
```

`npm run check` runs entirely on your machine with plain Node — it needs no
Cloudflare account, no credentials, and no deploy. It should pass before you
open a PR. If you're changing timezone math, comment matching, token
encryption, or the ingest-token draft-forcing guarantee, add an assertion to
`scripts/check.mjs` that would have caught your bug — that file is the entire
test suite, and a fix with no accompanying assertion is a fix someone can
silently regress later.

## Code style

There's no build step, no bundler, no TypeScript, no linter config, and no
framework — that's intentional (see the README's closing line: "Open any of
these, read it, change it."). Match what's already there:

- Vanilla JS, ES modules, `async`/`await`, no dependencies beyond `wrangler`.
- Comments explain *why*, not *what* — the code should read clearly enough
  that a comment restating it would be noise. Reserve comments for a
  non-obvious constraint, a workaround, or an invariant a future reader could
  easily break without knowing.
- No premature abstraction. Three similar lines beat a speculative helper
  built for a fourth case that doesn't exist yet.
- Keep the "fail loud, fail safe" posture: a broken config should show a red
  banner or a logged event, not fail silently. A safety property (draft
  forcing, encryption, signature verification) should be enforced in code, not
  left to a prompt, a convention, or a comment.

## Security-sensitive changes

Anything touching `src/crypto.js`, the auth/ingest-token logic in
`src/util.js` and `src/index.js`, or the webhook signature verification in
`src/webhook.js` gets read more carefully, not less. See `SECURITY.md` for how
to report a vulnerability privately instead of through a PR or public issue.

## Pull requests

- Keep them scoped to one change. A bug fix doesn't need to also refactor the
  file it's in.
- Describe what you tested, not just what you changed. If you touched
  anything Meta-API-shaped, note whether you verified it against Meta's
  current docs (see README section 5) — API shapes drift, and "it compiles"
  is not the same as "it matches what Meta currently expects."
- Update the README if you change documented behavior (an endpoint, a
  guardrail, a setup step). A README claim that stops matching the code is
  worse than no claim at all — this project's own review process found and
  fixed several of exactly that kind of gap before its first release.
