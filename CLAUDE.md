# Working on TRADDOMIUM: Micro Battle!

TRADDOMIUM: Micro Battle! is a browser-based direct-control ant survival
RPG built with three.js + TypeScript + Vite, tested primarily on mobile
landscape. The player controls ONE ant inside a persistent colony/world;
individual ants can die, the colony continues.

## World position is authoritative; the floating origin is not

TRADDOMIUM runs at TRUE SCALE. The island is 5,600,000 world units
across and a world unit is a centimetre to the terrain and to the ant
alike. Nothing may be handed to the GPU in those coordinates: float32
resolves 0.25 units at that range, a quarter of her body length.

So there are two coordinate concepts, and they are two TYPES with
different field names so they cannot be swapped by accident:

```
WorldPoint  { wx, wz }   MACRO. Authoritative. Persistent.
LocalPoint  { lx, lz }   Rendered. Temporary. Meaningless alone.
```

**The rule.** Anything that outlives a frame is addressed in WORLD
coordinates — nests, players, creatures, food sites, death markers,
saved objects, and every position that will one day cross a network. A
`LocalPoint` is measured from an origin that moves as she walks, so the
same value means a different place ten seconds later. Storing one as a
location is a bug that surfaces only after a reload, or when two
machines compare notes.

`origin.ts` is a TRANSFORM into render space. It is not the location
system, and nothing should ask it where anything *is*. Convert at the
boundary, through `toLocal` / `toWorld`, and never by hand.

**Chunks are global.** A chunk's identity comes from world position
alone (`coords.ts`), so moving the origin cannot change what belongs
where. Generate and load microterrain — and later everything else that
lives in a chunk — by GLOBAL chunk coordinate. That is what lets the
same ground appear identically on two devices, after a reload, or a
week later.

This is not a style preference. Going to true scale produced four bugs
in one afternoon and every one was this mistake: a camera clamped its
height against its own rendered position and sat two kilometres up a
mountain; a ground readout did the same; a texture tiled off rendered
position and would have slid sideways on every shift; and the shader's
biome bands were bare literals from the old scale, so a beach rendered
as cliff rubble. Convention did not survive one change.


## Where the truth lives, in order

When sources disagree, this is the order:

1. **Joshua's newest explicit instruction.**
2. **`MASTERROADMAP.md`** in this repo — the long-form product vision.
   A feature appearing there does NOT mean build it now.
3. **Trello** — current execution: what is being built, acceptance
   criteria, bugs, ownership. Cards stay short because the roadmap
   holds the long form.
4. **This file and the README** — stable engineering guidance.
5. Older experiments and prototypes, as references only.

**Board:** https://trello.com/b/DoBMcBRT/traddomium-micro-battle-typescript

There is a SEPARATE Godot board for the Godot prototype. This repo is
the TypeScript one; do not take work from the Godot board.

Scan Trello BEFORE starting substantial work and AGAIN before finishing.
When this file conflicts with a newer card or instruction, flag the
conflict and follow the newer source.

Some Trello lists still hold cards from the Trail of Ants / voxel build
— tunnels, SoilQuery, corner climbing. Those describe a codebase this
repo does not contain. Check that a card's subject actually exists in
`src/` before starting it.

## Clean-rebuild rule

This repo is a deliberate clean rebuild of earlier implementations
(original TRADDOMIUM, Trail of Ants, and lessons from Thronemound's
island). Reuse requirements, research, measurements and art; do NOT
wholesale copy old tangled code. Nothing from the old implementations is
automatically considered complete.

Build one focused development scene (lab) per system, in the spine's
order, with an integration gate before the next layer. Labs register in
`src/main.ts` and stay reachable via `?scene=` permanently.

## Controls belong to the thumbs, not the screen

Screen space near the thumbs is the scarcest resource in this game, and
the action controls (grab, dig, bite) have first claim on it. Before
adding a control, check whether a gesture can carry it instead: the
camera is a drag rather than a button for exactly this reason, and Auto
is a drag past the stick's rim rather than a permanent button.

Movement itself is settled (see README "Controls"): the stick is
camera-relative, pace is a CEILING rather than propulsion, and steering
is looking. An earlier note here said gait rides the stick's own
deflection — that was the pre-v0.4 design and is no longer true.

## The feeling bar

BAD: press GRAB → object teleports to the ant.
GOOD: approach → head aims → jaws open → reach → grab → carry.
That physical language connects locomotion, digging, carrying and
combat. Prefer physical, readable interactions over instant state flips.

## The terrain is not ours to move

**Standing rule (Joshua, and it overrides anything below).** The island
is surveyed Kauaʻi and stays surveyed. **No system may modify terrain
height** — no carving a channel for a river, no flattening a shelf for a
lake, no pressing the ground down to meet a water level. The only
sanctioned change to the surface is the **smoothing dial**.

Water is not an exception; water is the reason the rule exists. Every
inland-water system this repo has shipped and removed did the same
thing in the end: when the water would not sit where a dataset said it
should, it moved the ground to make it fit. That is backwards. Water
runs off terrain, finds its own fills and its own drainage, and if it
ends up somewhere the map did not predict then the map is what is
approximate — a 13.67 m elevation sample has no 5 m stream bed in it,
and inventing one does not add information, it just hides the
disagreement.

So: a water system may READ `terrainHeight` and it may never write it.
A surveyed river is a thing to **check the simulation against**, not a
thing to reshape the island for.

### The one exception: sanitising invalid source data at load

**Terrain source data may be sanitized during loading when a sample is
demonstrably invalid, missing/NODATA, non-finite, or physically
impossible for the dataset. This correction must happen before the
heightfield enters the world and must not be driven by gameplay,
hydrology, water placement, or desired visual outcomes.**
(Joshua, 2026-08-30.)

That is data repair, not terrain modification, and the rest of the rule
above is untouched: gameplay, hydrology, water, AI and every other
world system may NOT modify VALID terrain heights to make their own
system fit.

Why it exists: the DEM shipped with scattered samples hundreds of
metres below sea level sitting inside dry land, and since the water
query calls any ground below zero THE SEA, each became a flooded shaft
— a 27 m square, 200 m deep, reading SALTWATER in a beach. The test for
"demonstrably invalid" is a fact about the island rather than a tuning
number: **Hawaiʻi has no dry land below sea level**, so a below-sea-level
sample the open ocean cannot reach is not a place on Kauaʻi.

`src/world/demRepair.ts` is the only code allowed to do this, it runs
once as each grid loads, and it is bound by its own rules: it may only
ever write samples that are water or void (dry land is never touched),
it judges connectivity against the WHOLE island rather than any tile,
and it fills from the surrounding ground rather than clamping to zero.
tests/demRepair.test.ts holds all of that.

## The ocean's look is accepted — protect it

**Standing rule (Joshua, 2026-08-29, on the v0.0.99 device pass): "the
ocean now looks absolutely stunning... treat the current ocean VISUAL
LOOK as accepted and protect it."**

That covers the water shader, the foam and its LOD sphere, and the
swell's heights, periods and wavelengths. Gameplay and camera work on
the sea is fine and expected; changing how it LOOKS is not, unless he
asks. In particular, do not "fix" a physics or camera problem by making
the waves smaller, flatter or slower — that trades a bug for the thing
he likes most about the build.

`npm run probe:foamsphere` is the regression check: it holds the shipped
frame against a no-foam control at altitude and in the surf. Run it after
touching anything the water reads.

ONE SANCTIONED DEPARTURE, v0.0.105 (Stage D, at Joshua's instruction).
Water cannot hold a wave taller than itself, so the shore now carries a
depth-limited breaking envelope: the surface may stand at most 0.39 of
the depth. That is physics, it applies to BOTH seas, and it does change
the shipped ocean — but only in water shallower than about 1.5 m, where
it was drawing a 0.9 m wave over 30 cm of sand. Everything from 1.5 m
out — the whole of what the accepted frames show — is untouched, and
the foam probe measures the same surf to within its noise. The envelope
is a soft minimum, so it can only ever LOWER the water: nothing that
keys off surface height can be made to happen more often by it.

Known and deliberately NOT optimised yet: the water fragment shader runs
four ripple octaves in two flow phases, about eight ordinary ripple
samples per water fragment, before any distance fade. It is the likely
next GPU bottleneck and is to be profiled on its own, not trimmed as a
side effect of unrelated work.

## Engineering invariants

- The heightfield (`src/world/heightfield.ts`) is the single source of
  ground truth: the mesh, the walker, the camera and the tests all
  sample the same pure function. Keep it pure and deterministic.
- A meter may only move if there is a way to move it back.
- An unavailable action must never look functional.
- Verify with `npm run test`, `npm run typecheck`, `npm run build`
  before pushing. Read `package.json` for the current command list.
- Automated/headless environments can run far slower than real time;
  don't retune per-second systems from wall-clock observations.

## Screenshots and probes mean STOP before pushing

If a change was checked with a screenshot or a probe, show Joshua the
result and wait before pushing. He catches things in a rendered frame
that no test does, and it is much cheaper for him to say "the water is
too wide" once than for three corrective pushes to land on his device.

Anything not verified visually — a refactor, a test, a doc, a fix with
a unit test behind it — push without asking, as before.

(Joshua's standing instruction, 2026-08-24.)

## Probes cost time — use the smallest thing that answers the question

**Standing rule (Joshua, 2026-08-29).** Do NOT run every available
probe for every fix. The headless renderer manages about a frame and a
half a second, so a full probe sweep costs many minutes and most of it
answers nothing about the change in hand.

For an obvious or local regression: read the code and its history
first, name the invariant that was actually violated, make the smallest
correction, then run the TARGETED tests plus typecheck and build. Add
one focused measurement only if it materially helps.

Reserve the long render probes for:

- renderer / physics synchronisation changes
- water, terrain or LOD changes where a visual regression could hide
- an uncertain root cause
- final verification of a stage
- anything a targeted test genuinely cannot establish

A probe is not justified by existing. `probe:foamsphere` after a change
to a camera constant is a several-minute measurement of something the
change cannot reach — that happened in v0.0.107 and is the example this
rule is written from.

And when the only question left is how it FEELS or LOOKS on the device,
stop after the technical verification and ask Joshua to test it. Do not
spend time trying to prove visual acceptance numerically.

## Git and collaboration

- Inspect current main and Trello before writing; don't duplicate work
  another agent has claimed (ownership = labels on cards).
- Joshua tests from the live build, so device-testable work must reach
  the deployed branch. Cards Claude moves from Coding to Testing get
  Joshua's label attached alongside Claude's.
- Notes meant for Claude belong in card DESCRIPTIONS (Trello card
  comments don't reach Claude through the current connector).
