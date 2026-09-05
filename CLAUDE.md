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
and drainage.

*Carving has been tried FOUR times and is not in v1.* Beyond Extinction
carved once; v0 carved three times, and says so itself in `9ee00a7`
("THIS IS THE THIRD CARVE THIS PROJECT HAS HAD"). The first pressed
ground toward a water level with no bound and cut benches out of the
Napali walls. The second was gated by a claim radius, so the cut fell
from full depth to nothing between one lattice vertex and the next and
grew a row of 73 cm fins down every bank. The third was bounded at three
metres, ungated, and dug to a USGS-SURVEYED centreline instead of to a
centreline derived from a blurred island — the only one whose bed, water
and ground were the same survey — and it still could not reach the 1% of
the network buried deeper than three metres, because those are gorges
the grid cannot see. That is the standing lesson: at 13.67 m a sample,
the best data there is, a 5-20 m channel is 0.4-1.5 samples wide, so
every carve is inventing sub-survey detail and then defending it.

*Decided by Joshua, 2026-09-04, opening Phase 2:* "add the best HD
terrain, no terrain editing." This closes the question the file used to
leave open (whether a bounded, discharge-scaled carve derived from the
terrain's OWN flow could join the DEM transform chain). It is a decision,
not a default — reopen it only with him. Live erosion during play stays
permanently excluded: the Mei/Decaudin/Hu erosion steps write the bed
every tick by definition.

**The ocean's look is accepted — protect it. Its COST is a known problem,
and quality tiers are the answer, not smaller waves.** When the ocean is
re-added (Phase 3) its shader, foam, swell heights, periods and
wavelengths come across as accepted tuning, with the foam-sphere probe and
the shader fixture test as the regression checks. Do not fix a camera or
physics problem by making waves smaller.

*Joshua, 2026-09-05, from the device:* he likes the v0 ocean — real waves
and swells derived from NOAA data, "really amazing" — AND names it a
likely cause of v0's choppiness. His own screenshots of it read 10 to 30
fps. Two reasons he gives, both actionable rather than aesthetic: v0 had
no texture size options, everything was about 1024, and the work was
probably not balanced well between the CPU and the GPU. So the ocean
arrives WITH `assets/textureQuality.ts` wired to it, testable at medium,
low and ultra-low on his phone, and profiled for which side of the machine
it is spending on. His standing preference, in his words: sacrificing
graphics on mobile is better than amazing graphics with horrible
performance. Terrain landed at 60 fps on his device; the ocean must not
be what takes that back.

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
- **The relay's authority is `src/net/Host.ts` itself, never a second
  copy of the rules.** `worker/` imports that file and runs it unchanged;
  it owns a socket, a clock and a call to `tick()` and nothing else. A
  game rule written in `worker/` is a bug: the loopback would stop
  predicting the room a phone connects to.
- **The relay's address is baked into the build** (`__RELAY_URL__`, from
  `vite.config.ts`, default the deployed relay, `TRADDOMIUM_RELAY_URL=`
  for a build with no online play) and `?relay=ws://127.0.0.1:<port>`
  points a running build at a local one — which is how a developer on
  `npm run relay:dev`, and `npm run probe:multiplayer`, reach a relay
  that is not the deployed one.
- **The texture rung is the player's quality setting, and `?tier=` is the
  way to reach one that is not.** `assets/textureQuality.ts` owns the rule
  and `app/registerScenes.ts` reads the address bar, exactly as `?relay=`
  does. It exists because ULTRA_LOW is deliberately not one of the
  player's three levels and Joshua's Phase 3 brief requires the sea to be
  testable at it on a phone. An override, never a setting: nothing is
  stored, and the HUD's SEA line names the rung actually in use, so a
  typo shows up as the wrong word rather than as a phone that will not
  open.
- A client-side PIN is a convenience, not security.
- Every file in `scripts/` is wired to a `package.json` script or listed
  in `scripts/MANUAL.md`.

## Verification

Measure rather than assume. `npm run typecheck`, `npm test`,
`npm run build`, `npm run probe:boot`; read `package.json` for the current
list. CI runs typecheck + test + build + `relay:typecheck` on every push.

`npm run typecheck` is NOT the whole typecheck. `worker/` compiles
`src/net/` against the workers runtime — no DOM lib, no vite defines, no
ambient declarations from `src/env.d.ts` — so a core file can be clean
under the app's tsconfig and break the relay's. Run `relay:typecheck`
whenever `src/net/` changes; a build-time constant named in core is the
way that has actually happened, and `tests/simulationCore.test.ts` now
fails on it locally too.

**Agents: the minimum for research, more allowed for coding, used
wisely** (Joshua, 2026-09-05). Reading this codebase to answer a question
is usually faster and more reliable done directly — the files say what
they mean, and a fanned-out search of them mostly returns what a grep
would. Parallel agents earn their cost when there is real work to do in
parallel, not merely a lot to read.

**Probes cost time — use the smallest thing that answers the question.**
The headless renderer runs at about a frame and a half a second. For a
local regression: read the code, name the invariant violated, make the
smallest fix, run targeted tests + typecheck + build. Reserve render
probes for renderer/physics sync, water/terrain/LOD visuals, uncertain
root causes, and final stage verification. Never retune a per-second
system from probe wall-clock.

**Work goes STRAIGHT TO `main`, and `main` deploys to the phone.**
Joshua, 2026-09-05: "Don't do any more PR's, push and edit directly from
now on", and, asked whether that meant `main` itself or a branch he would
merge: straight to `main`.

This SUPERSEDES the rule that used to stand here — that anything checked
with a screenshot or probe waited for his go-ahead before it reached
`main`. It is his call and it is recorded rather than argued with, but
the consequence is worth stating plainly, because the old rule existed
for a reason: there is no longer a gate between a push and his phone.
What used to be caught by "show him a screenshot first" now has to be
caught BEFORE the push. So verify harder, not less — run the probes and
look at the shots yourself, and prefer one validated push to three
corrective ones. A change you would have wanted a second opinion on is
now a change to say so about in the same breath as pushing it.

## Git and collaboration

- `main` is the deployed branch and is where work goes DIRECTLY: commit
  and push to it. NO PULL REQUESTS (Joshua, 2026-09-05) — not as a
  formality, not "just for CI". Never force-push `main`.
- CI runs on push to `main`, so a push is also what gets the branch
  through typecheck + test + build + `relay:typecheck`. There is no
  second chance to notice a break before it deploys.
- While v1 is rebuilt, the Pages site carries BOTH builds (Joshua,
  2026-09-04): v0 from `legacy/v0-main` at the site root, which is what
  the installed PWA opens, and v1 from `main` under `/v1/`. The deploy
  workflow builds both; when v1 is ready to become the game, it moves to
  the root and v0 retires.
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

Learned on the Phase 0 build: an agent's isolated worktree can start at
`main`'s tip, not at the core commit. Give every leaf agent the core
commit hash and have it `git checkout -b phase<N>/<module> <hash>` before
writing a line, and merge only branches whose parent is that hash.

## Keep this file useful

Stable guidance only. Sprint priorities, the active card, branch names
and one-off bug states belong on Trello, in commits and in
`docs/ARCHITECTURE.md`'s phase table. If this file starts contradicting
the board or the spec, update or simplify it.
