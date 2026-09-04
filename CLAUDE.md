# Working on TRADDOMIUM: Micro Battle! (v1)

TRADDOMIUM: Micro Battle! is a browser-based direct-control ant survival
RPG built with three.js + TypeScript + Vite, deployed to GitHub Pages and
tested primarily on a phone in landscape. YOU ARE THE ANT: the player
controls one ant inside a persistent colony and world; ants can die, the
colony continues.

## This is a clean rebuild. Read this before touching anything.

On 2026-09-04 Joshua decided to rebuild the game from the foundation
outward rather than keep patching the v0 integration, whose systems
(world rendering, PlayerAnt, flight, climbing, water, camera, autonomy,
UI) had become able to affect one another too easily.

- **`docs/ARCHITECTURE.md` is the approved spec.** Module map, ownership,
  allowed dependency directions, the session seam, the rebuild phases and
  Phase 0's definition of done all live there. Build to it.
- **v0 is preserved untouched as the branch `legacy/v0-main`.** It is a
  reference and a parts bin, read-only. Nothing in it is part of v1 until
  it is deliberately re-added in the phase that needs it (ARCHITECTURE.md
  §11) and checked against §2 of that document. Do not copy v0 files
  across "because they worked" — the modules were fine; the wiring was
  the problem.
- **`docs/research/` is reference material carried from v0 verbatim**
  (ant biology, navigation research, session design, the water audit, the
  terrain notes, and v0's own CLAUDE.md as `CLAUDE_MD_v0.md`). Research
  there is still true; implementation notes there describe a codebase
  this repo no longer contains.

## Where the truth lives, in order

1. **Joshua's newest explicit instruction.**
2. **`MASTERROADMAP.md`** — the long-form product vision. A feature
   appearing there does NOT mean build it now.
3. **Trello** — current execution: what is being built, acceptance
   criteria, bugs, ownership. Board:
   https://trello.com/b/DoBMcBRT/traddomium-micro-battle-typescript
   (there is a separate Godot board; this repo is the TypeScript one).
4. **`docs/ARCHITECTURE.md` and this file** — stable engineering guidance.
5. `docs/research/` and `legacy/v0-main` — references only.

Scan Trello BEFORE starting substantial work and AGAIN before finishing.
When this file conflicts with a newer card or instruction, flag the
conflict and follow the newer source.

## Standing rules carried forward from v0 (Joshua's, still in force)

**World position is authoritative; the floating origin is not.** The
island is real Kauaʻi at TRUE SCALE: 5,600,000 world units across, one
unit a centimetre to terrain and ant alike. Nothing at that range goes to
the GPU raw. `WorldPoint {wx, wz}` (authoritative, persistent) and
`LocalPoint {lx, lz}` (rendered, temporary) are two TYPES with different
field names. Anything that outlives a frame is stored in world
coordinates; conversion happens only at the render boundary. Chunks are
identified by global world position. In v1 the ground-truth height API
takes a `WorldPoint`, not bare numbers — the one place v0 left the seam
unchecked, and where its bugs came from.

**The terrain is not ours to move.** No system modifies terrain height.
The only sanctioned writes are (a) the smoothing dial and (b) load-time
sanitisation of demonstrably invalid DEM samples (NODATA, non-finite, dry
land below sea level — Hawaiʻi has none), done before the heightfield
enters the world and never driven by gameplay, hydrology or a desired
look. Water READS terrain; it never writes it. Waterways are not drawn
over the terrain; the terrain is flooded and water finds its own fills
and drainage. Two carving implementations (Beyond Extinction's and v0's
own) both ended up gouging terrain to fit a dataset that disagreed with
it, and both were removed. *Open decision, Phase 2:* Joshua has asked
whether a deterministic, bounded, discharge-scaled channel carve derived
from the terrain's OWN flow (not from an external dataset, not random,
applied once at load) should join the DEM transform chain. Decide it
then, with him. Live erosion during play is permanently excluded: the
Mei/Decaudin/Hu erosion steps write the bed every tick by definition.

**The ocean's look is accepted — protect it.** When the ocean is re-added
(Phase 3) its shader, foam, swell heights, periods and wavelengths come
across as accepted tuning, with the foam-sphere probe and the shader
fixture test as the regression checks. Do not fix a camera or physics
problem by making waves smaller.

**Controls belong to the thumbs, not the screen.** Screen space near the
thumbs is the scarcest resource; action controls have first claim.
Before adding a control, check whether a gesture can carry it. Movement
is settled: camera-relative stick, pace as a CEILING, steering is
looking.

**The feeling bar.** approach → head aims → jaws open → reach → grab →
carry, never press → object teleports.

**A meter may only move if there is a way to move it back. An unavailable
action must never look functional.** "Multiplayer" in the UI may never
imply more than exists; the honest caption is pinned by a test.

## Engineering invariants specific to v1

- A module mutates only state it owns. Everything else is a typed
  parameter in or a read-only query out.
- Raw wall-clock frame time and simulation dt are separate values from
  the moment they are read. Instrumentation never sees a clamped dt.
- One asset loader (`assets/`), one scene-transition choke point
  (`app/SceneManager.goTo`). Every navigable screen — menu, loader,
  world, every dev tool — is an ordinary `Scene`.
- Core modules (`world/`, `actor/`, `autonomy/`, `data/`, `net/`,
  `persistence/`, `perf/FrameStats`) import nothing from `three`, the DOM,
  storage or the network. `tests/simulationCore.test.ts` enforces it.
- Screens receive typed hook objects and never import the module whose
  state they show or drive. Renderers and cameras take continuous signals
  (position, up, facing, a 0..1 lever), never a gameplay mode enum.
- State is derived from measured facts each frame where possible; a
  latch that is genuinely needed is one named object, not loose fields.
- Numbers live in `data/` registries with a `WIRED` list and a test.
- A client-side PIN is a convenience, not security.
- Every file in `scripts/` is wired to a `package.json` script or listed
  in `scripts/MANUAL.md`.

## Verification

Measure rather than assume. `npm run typecheck`, `npm test`,
`npm run build`, `npm run probe:boot`; read `package.json` for the current
list. CI runs typecheck + test + build on every push.

**Probes cost time — use the smallest thing that answers the question.**
The headless renderer runs at about a frame and a half a second. For a
local regression: read the code, name the invariant violated, make the
smallest fix, run targeted tests + typecheck + build. Reserve render
probes for renderer/physics sync, water/terrain/LOD visuals, uncertain
root causes, and final stage verification. Never retune a per-second
system from probe wall-clock.

**Screenshots and probes mean STOP before landing on main.** `main`
deploys to GitHub Pages, which is what Joshua's phone runs. Anything
checked with a screenshot or probe is shown to him first and waits for
his go-ahead before it reaches `main`; his device pass then happens on
the deployed build. It is far cheaper for him to say "the water is too
wide" once from a screenshot than for three corrective pushes to land on
his phone. Pushing to a feature branch is not landing. Refactors, tests,
docs and fixes with a unit test behind them land without asking.

## Git and collaboration

- `main` is the deployed branch. Develop on feature branches; land via
  PR once Joshua has seen the result and said go. Never force-push
  `main`.
- `legacy/v0-main` is a read-only archive. Do not commit to it.
- Ownership on Trello is by label (Claude, ChatGPT, Joshua, helpers by
  name). Cards Claude moves from Coding to Testing get Joshua's label
  alongside Claude's. Card COMMENTS do not reach Claude; notes for Claude
  go in card DESCRIPTIONS or to Joshua directly.
- Bump the package version per the project's release practice; the
  build stamps its commit into `version.json` so a phone can tell which
  build it is running.

## Parallel agent work (Joshua's standing plan for v1)

Contracts land first and serially (`app/`, `session/`, the `Scene` and
`DevTool` contracts, `data/schema`). Leaf modules are then built in
parallel, each agent owning one directory and never editing another's
files; the shared wiring (`app/registry.ts`, `main.ts`) is done by the
integration pass, which also runs the full verification. A module is
done when it typechecks, its tests pass, and its public surface matches
`docs/ARCHITECTURE.md`.

## Keep this file useful

Stable guidance only. Sprint priorities, the active card, branch names
and one-off bug states belong on Trello, in commits and in
`docs/ARCHITECTURE.md`'s phase table. If this file starts contradicting
the board or the spec, update or simplify it.
