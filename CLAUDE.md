# Working on TRADDOMIUM: Micro Battle!

TRADDOMIUM: Micro Battle! is a browser-based direct-control ant survival
RPG built with three.js + TypeScript + Vite, tested primarily on mobile
landscape. The player controls ONE ant inside a persistent colony/world;
individual ants can die, the colony continues.

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

## Git and collaboration

- Inspect current main and Trello before writing; don't duplicate work
  another agent has claimed (ownership = labels on cards).
- Joshua tests from the live build, so device-testable work must reach
  the deployed branch. Cards Claude moves from Coding to Testing get
  Joshua's label attached alongside Claude's.
- Notes meant for Claude belong in card DESCRIPTIONS (Trello card
  comments don't reach Claude through the current connector).
