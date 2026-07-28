# Security policy

This project handles real credentials: Instagram access tokens (encrypted at
rest), your `API_TOKEN`/`INGEST_TOKEN` bearer secrets, your Meta app secret,
and your Anthropic API key. Take a report seriously if you get one, and please
report privately rather than filing a public issue.

## Reporting a vulnerability

Email the maintainer directly (see the repository's contact info on GitHub) or
open a [GitHub private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository instead of a public issue. Include:

- What you found and where (file/line if you have it)
- A concrete way to reproduce or exploit it
- What you think the impact is (what could someone actually do with this)

You should get an acknowledgment within a few days. There is no bug bounty —
this is a personal/small-business open-source tool, not a funded program — but
real reports are genuinely appreciated and will be fixed and credited.

## What's already been through a security pass

Before this project's first public release, both a code-quality review and a
dedicated security review were run against the whole codebase (see the git
history around the release commit for what was found and fixed — token
handling, an unrestricted-upload stored-XSS/SSRF pair, several race conditions
in the send-cap and follow-up logic, and a data-deletion gap were the
significant ones). That does not mean the code is bug-free going forward,
especially after changes — it means a first, thorough pass already happened
before anyone else was asked to trust this with real Instagram credentials.

## Scope

In scope: anything in `social-suite/` — the Worker, the dashboard, the
schema, the pre-deploy check script.

Out of scope: vulnerabilities in Cloudflare Workers, D1, R2, or the Instagram
Graph API themselves (report those to Cloudflare or Meta directly), and
anything requiring physical or already-authenticated admin access to a
deployment you don't control.

## If you're running this yourself

- Rotate `API_TOKEN`, `INGEST_TOKEN`, and `TOKEN_ENC_KEY` if you ever suspect
  one leaked. Changing `TOKEN_ENC_KEY` means re-pasting every stored Instagram
  token, since existing ciphertext becomes unreadable — see the main README.
- `npm run check` scans the whole project for anything shaped like a live
  Instagram access token before every deploy. Do not skip it.
- Never commit a real token, even to a private fork. Encrypted-at-rest-in-D1,
  never-in-a-file is the entire design principle this project is built around.
