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

One entry is run by hand; the rest are helper modules, which cannot be
wired because they are never run on their own:

- `scripts/bakeStoryLab.py` — bakes the story's painted laboratory into
  `public/models/lab-story.glb` from `art/story/lab-night.jpg`: recovers
  the picture's camera, rebuilds the room as boxes and bakes the picture
  onto them (`src/storylab`). Manual because it needs Python 3 with numpy
  and OpenCV, which the repository does not ship:
  `python3 scripts/bakeStoryLab.py`.

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
- `scripts/bakeBadge.mjs` — cuts the TOMBS card and clip out of Joshua's toon lanyard master (`art/humans/Badge-Toon.glb`) and bakes `public/models/badge.glb` in the frame the runtime hangs it by. Imported by `bakeHumans.mjs` (`npm run bake:humans`, or `-- --only=badge`).
- `scripts/smoothSeatWeights.mjs` — smooths the bone weights in space across the hips so a shirt's hem and the cloth under it fold together when a body sits. A module, imported by `bake:humans` for bodies with `smoothSeat`.
- `scripts/protectBumpWeights.mjs` — moves the thigh share of a pregnant bump's bone weights onto the pelvis, so the bump keeps its shape when she sits instead of swinging into her lap with the legs. A module, imported by `bake:humans` for bodies with `protectBump`; pinned by `tests/sarahBump.test.ts`.
- `scripts/rigFingers.mjs` — gives a mitten-rigged hand five four-jointed fingers, measured from the hand's own mesh (the fingers are found as the pieces the hand splits into when cut back from the tips), appended after the master's joints with the hand's weights shared out along them. A module, imported by `bake:humans` for bodies with `rigFingers`; pinned by `tests/sarahFingers.test.ts`.
- `scripts/bellyMorph.mjs` — adds a `belly` morph target to a pregnant body: the same vertices drawn back from full term to nearly flat, measured from the mesh's own front profile, with matching normals. A module, imported by `bake:humans` for bodies with `bellyMorph` (Sarah's base mannequin); pinned by `tests/sarahBase.test.ts`.
- `scripts/growClothes.mjs` — grows a fitted shirt and leggings from a body's own skin (copied, pushed out by the cloth's thickness, same bone weights, same belly morph), each its own primitive and material. A module, imported by `bake:humans` for bodies with `clothes`.
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
- `scripts/clearShirtLogo.mjs` — paints out the "TOIARG" logo the scanner
  printed on Jack's polo where TOMBS was meant to be (Joshua, 2026-09-29:
  paint over it rather than repair the text). The letters and their halo
  are found in SPACE inside a box on the chest and refilled from the polo
  round them, gathered in 3D so the fill crosses UV seams; the colour,
  normal and roughness maps are all filled, because the roughness map
  printed the logo as a satin block of its own. A module, not a command;
  imported by the `bake:humans` script, which holds the box.
- `scripts/paintSarah.mjs` — paints Sarah's untextured `Sarah-Lab3.glb`
  from nothing: every texel coloured by where it sits on her body (skin,
  hair, top with its neckband, skirt, shoes, bands, the lanyard found by its
  shape along a measured path, card), and her face and front projected from
  the reference photograph she was made from (`art/humans/ref/`), each
  region taking the photograph only where its pixel is that material. The
  occlusion bake supplies the shading the photograph does not. A module, not
  a command; imported by the `bake:humans` script.
- `scripts/smoothLegWeights.mjs` — rebuilds Sarah's hip, knee and ankle
  skin weights from height with a smooth blend across each joint, because
  her Lab3 master was rigged with hard edges there and tore open along
  them as soon as a walk bent a knee or an ankle. A module, not a command;
  imported by the `bake:humans` script, run on the bodies whose entry asks
  for it.
- `scripts/relayHarness.mjs` — starts `wrangler dev --local` on a free
  port, waits for `/health`, and stops it again, cleaning up its Durable
  Object state. Imported by `npm run probe:relay`,
  `npm run probe:multiplayer` and `npm run probe:bot`, which all need a relay running on this
  machine and neither of which is testing that plumbing.
