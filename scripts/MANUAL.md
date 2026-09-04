# scripts/

Every file in this directory is one of two things:

- **Wired.** A `"scripts"` entry in `package.json` names it, so
  `npm run <name>` is how it runs. `package.json` is the list of wired
  scripts; this file does not repeat it, so the two cannot drift.
- **Manual-only.** It is run by hand, and it is listed in this file
  under the `# Manual-only` heading below with one line saying what it
  does and how to invoke it.

`tests/scriptsWired.test.ts` fails when a file is neither, when an npm
script points at a file that no longer exists, when a manual-only
listing names a file that no longer exists, or when a file is listed as
manual-only but is wired after all.

## Why the rule exists

v0 accumulated 29 orphaned probes and nobody could tell which were dead
and which were load-bearing, so nothing could be deleted and nothing
could be trusted. The rule is ARCHITECTURE.md §2.12 and one of the
engineering invariants in CLAUDE.md: the answer to "is this script
alive?" must always be in one of two files.

## Adding a script

1. Prefer wiring. Add `"probe:<name>": "node scripts/probe-<name>.mjs"`
   (or a `bake:<name>`) to `package.json`. A probe that is wired is a
   probe someone can run without reading its source first.
2. List it here only when it is genuinely run by hand: a one-off bake
   whose arguments change every time, or a tool that needs something the
   repo does not ship. Say what it does and give the command.
3. A helper module that a wired script imports is never run on its own,
   so it cannot be wired; list it here with the name of the script that
   imports it, so the reason it exists is written down.

## The allow-list

Everything between the `# Manual-only` heading and the next heading is
the allow-list. Every `scripts/...` path written in that section counts
as listed, prose included, so a path is written there only to list it.

# Manual-only

Nothing is run by hand in Phase 0. The boot probe is wired as
`npm run probe:boot`.
