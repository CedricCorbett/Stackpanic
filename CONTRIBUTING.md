# Contributing

This repo holds more than one standalone project, each in its own top-level
folder. General rules first, then go to the specific project's own
`CONTRIBUTING.md` for anything project-specific (local setup, test suite,
code style for that project).

## General rules, repo-wide

- Keep changes inside the project folder they belong to. A fix to
  `leadspanic-instagram/` shouldn't touch `free-stack/` in the same PR, and
  vice versa — they're independent projects sharing a repo, not one codebase.
- For anything bigger than a typo fix, open an issue first describing what you
  want to change and why.
- Describe what you tested, not just what you changed.
- Update the relevant project's docs if you change documented behavior. A
  claim in a README or guide that stops matching the code is worse than no
  claim at all.

## Where to actually look

- [`leadspanic-instagram/CONTRIBUTING.md`](leadspanic-instagram/CONTRIBUTING.md) —
  local setup, the test suite, code style, security-sensitive areas.
- [`free-stack/README.md`](free-stack/README.md) and
  [`free-stack/TEMPLATE.md`](free-stack/TEMPLATE.md) — the shape every guide
  follows, if you're proposing a new one or editing an existing one.
