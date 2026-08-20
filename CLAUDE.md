# Working on TRADDOMIUM: Micro Battle!

TRADDOMIUM: Micro Battle! is a browser-based direct-control ant survival
RPG built with three.js + TypeScript + Vite, tested primarily on mobile
landscape. The player controls ONE ant inside a persistent colony/world;
individual ants can die, the colony continues.

## Trello is the living source of truth

**Board:** https://trello.com/b/DoBMcBRT/traddomium-micro-battle

Trello is authoritative for the current roadmap, gameplay design, UI
direction, bugs, acceptance criteria and work ownership. Scan the board
BEFORE starting substantial work and AGAIN before finishing. This file
is a stable operating guide, not a design bible — when it conflicts with
a newer Trello card or Joshua's explicit instruction, flag the conflict
and follow the newer source.

Key reference cards live in "Planning — 2026 Direct-Control Rebuild":
"The pillars" and "The spine".

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
camera is a drag rather than a button for exactly this reason, and gait
rides the stick's own deflection rather than costing three slots.

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
