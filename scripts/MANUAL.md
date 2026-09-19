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

Nothing here is run by hand. The one entry is a helper module, which
cannot be wired because it is never run on its own:

- `scripts/probeWeather.mjs` — the canned Open-Meteo the world probes
  share: routes the island's weather request to a reply for the places
  asked for, so the live path runs with no way out to the internet and
  no console error. A module, not a command; every world probe calls
  `stubWeather(page)`.
- `scripts/probePng.mjs` — the PNG reader the pixel probes share
  (`probe-terrain`, `probe-ocean`, `probe-sky`). A module, not a command: it is here
  because two probes reading their own screenshots is two decoders, and
  the second one was written handling only RGBA and threw on the first
  RGB frame Playwright handed it.
- `scripts/probeSpawn.mjs` — the walk across the spawn map, shared by
  every probe that reaches the world through the front door
  (`probe-boot`, `probe-terrain`, `probe-ocean`). A module, not a
  command. It exists because NEW GAME now asks WHERE before it opens a
  world, so three probes gained the same step on the same day, and
  because it handles BOTH endings of that screen: an island to pick a
  region from, and the "Begin anyway" a build with no survey offers
  instead. There is deliberately no query parameter that skips the
  screen — a probe that can skip a step a player cannot is measuring a
  different program.
- `scripts/humanSurface.mjs` — a human master's surface, asked the two
  questions the bake needs: STANDOFF (how far it is from a texel straight
  into the body to the next surface — a lanyard lying on a shirt reads a
  few millimetres, the shirt itself reads the width of her torso) and
  OCCLUSION (how much of the hemisphere above a texel is open, which is
  what puts the contact shadow back once photographic shading has been
  replaced by flat colour). Also the rasteriser that says where every
  texel of the atlas is in space. A module, not a command; imported by
  the authoring pass below. Its occlusion bake is cached under
  `art/humans/cache/` keyed on the master's own size, because it takes
  about two minutes a body and depends on nothing else.
- `scripts/humanSurface.d.mts` — the types for that module, so
  `tests/humanSurface.test.ts` can import it. It exists because everything
  under `scripts/` is plain JS — these are run by `node`, not by vite, and
  a build step for a bake script is a build step nobody asked for.
- `scripts/authorSarah.mjs` — the authoring pass `npm run bake:humans`
  runs over Sarah: it replaces the lanyard and the top with flat colour
  taken from the scan's own median plus that baked contact shadow, and
  lifts the ID card onto its own material so the TOMBS artwork on it is
  legible (in the body's 2048 atlas the card's island is 70 by 38 texels,
  which is why the printing always read as mush). It touches nothing
  above the collarbone. A module, not a command; imported by the
  `bake:humans` script. Every threshold in it was measured on
  `Sarah-Lab2.glb` and is quoted with what it separates — it is an
  authoring pass for one body, not a general tool.
- `scripts/printBadge.mjs` — prints a TOMBS ID card on the badge round
  Jack's or Sarah's neck. Both were scanned wearing a real lanyard, and in
  the body's 2048 atlas the card's UV island is about SEVENTY BY
  THIRTY-EIGHT TEXELS — at that size a logo is twenty texels wide, so
  better art placed there changes nothing. It lifts the card's triangles
  onto their own material and rebuilds their UVs from the card's own
  plane. The card is found by a DEPTH SLAB measured per person, and the
  two scans differ: Jack's has a clean gap behind the card, Sarah's fused
  card, sleeve and clip into one 32 mm lump welded to the cloth and needs
  a colour gate as well. A module, not a command; imported by the
  `bake:humans` script, which holds each person's slab.
- `scripts/relayHarness.mjs` — starts `wrangler dev --local` on a free
  port, waits for `/health`, and stops it again, cleaning up its Durable
  Object state. Imported by `npm run probe:relay`,
  `npm run probe:multiplayer` and `npm run probe:bot`, which all need a relay running on this
  machine and neither of which is testing that plumbing.
