# Security policy

This repo holds more than one standalone project. Report a vulnerability
privately rather than filing a public issue, regardless of which project
folder it's in.

## Reporting a vulnerability

Email the maintainer directly (see the repository's contact info on GitHub) or
open a [GitHub private security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository. Include:

- Which project folder it's in
- What you found and where (file/line if you have it)
- A concrete way to reproduce or exploit it
- What you think the impact is

You should get an acknowledgment within a few days. There is no bug bounty —
these are personal/small-business open-source tools, not a funded program —
but real reports are genuinely appreciated and will be fixed and credited.

## Per-project detail

- [`social-suite/SECURITY.md`](social-suite/SECURITY.md) —
  scope, what's already been reviewed, and what to do if you're running that
  project yourself and suspect a credential leaked.

## General rule across every project here

None of these projects should ever have a real credential committed to a file
in this repo. Access tokens, API keys, and secrets are configured through each
project's own environment/secrets mechanism at deploy time, never pasted into
source. If you ever find one, that's the highest-priority report you can
send.
