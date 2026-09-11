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

**The stick's ceiling is the player's, and its floor never moves**
(Joshua, 2026-09-08: "make the joystick camera speed adjustable so slow
is 1-5m per second, medium is 1-10m per second, and fast is 1-30m per
second... I am moving too fast to see them"). `Camera speed` in Settings
picks the top a full push reaches (`FreeFlyCamera.CAMERA_SPEEDS`); every
rung starts at the same 1 m/s, so each reads "1 to n" and what changes is
how much of the stick's travel is spent below walking pace. The default
is MEDIUM: `fast` is a speed for crossing the island, and since the
ecology arrived the island is not what there is to look at.

**Controls belong to the thumbs, not the screen.** Screen space near the
thumbs is the scarcest resource; action controls have first claim.
Before adding a control, check whether a gesture can carry it. Movement
is settled: camera-relative stick, pace as a CEILING, steering is
looking.

**The feeling bar.** approach → head aims → jaws open → reach → grab →
carry, never press → object teleports.

**Ants do not push each other; the world still pushes everyone**
(Joshua, 2026-09-10, deciding it on the back of Baseline A). There is NO
hard body collision between normal ants, insects or players. They may
overlap. What stays fully solid is the WORLD: terrain, trees, rocks,
tunnel walls, roots, logs, structures and every other world surface — an
ant is stopped by the ground and by things, never by another ant.

Three consequences, all binding:

- **Combat is sensors, not shoving.** Hitboxes, hurtboxes and sensing
  volumes decide what lands. A body never blocks another body as a
  fighting mechanic.
- **Soft separation, if it is ever added, is STEERING and nothing else.**
  A light push-apart so a crowd does not visually stack into one animal
  is allowed later; it may bias where an ant wants to walk, and it may
  never become a barrier. The test it has to pass is the one that
  motivated the rule: it must not jam a tunnel and must not let one
  player wall another in.
- **The exception is size.** An "alpha" insect or a boss big enough to be
  swarmed is a CRAWLABLE SURFACE: ants attach to it and move across its
  body to attack and to work together. Ants attached to it still do not
  collide with one another. The machinery for this already exists —
  `creatures/surface.ts` carries a body over faces by a heading and an
  `up` — but every `Climbable` there is a static, world-axis-aligned box,
  and a boss's body moves and turns. The gap to close is a `Climbable`
  whose frame is a live transform, not a new climbing system.

This is a decision that BUYS something, which is why it is recorded here
rather than left implicit: creature-creature collision would be an
all-pairs cost paid every tick on exactly the crowds the game is trying
to hold, and `docs/PERFORMANCE.md`'s baselines are measured without it.
A future change that quietly adds body blocking invalidates every one of
those numbers.

**The ladder, as Joshua specified it on 2026-09-11 — and the
measurement that made him respecify it.** A drawn creature is on one of
four rungs, all decided by distance from the CAMERA:

|  |  |
|---|---|
| 0 – 0.3 m | the full model: its own textures, animated every frame |
| 0.3 – 0.5 m | THE SAME MODEL, STILL ANIMATED, in a solid matching colour |
| 0.5 – 0.6 m | that flat model crossfades to the impostor, BY DISTANCE |
| over 0.6 m | the twenty-triangle impostor, in the same solid colour |

His words: "do full model and everything from 0-0.3m, from 0.3-0.5m, the
texture will be a solid matching color but model still there and
animated… from 0.5-0.6 it will fade to procedural and over 0.6m is
procedural same solid color, no model or animation."

**The middle tier gives up its TEXTURE, never its MOTION, and that is a
measurement rather than a preference.** It used to keep the textures and
freeze the bones, re-posing four times a second. His own uncapped run
(Baseline C-ALL) priced that: posing 198 skinned rigs cost 1.3 ms of a
31 ms frame. The frame is not the posing — it is the GPU submitting and
shading those meshes — so the lever is the MATERIAL. Animation is nearly
free and is what makes an ant read as alive; keep it.

The colour is `LOOK[species].colour`, the same number the impostor is
built from, so "same solid color" is true by construction and not by two
tables being kept in step.

Four rules hold it together, and none is optional:

- **Distance is PRIORITY, the budget is CAPACITY.** Everything inside
  0.3 m wants its textures and the nearest are served first; when that
  budget runs out the rest fall to the solid coat, and past both they
  are ellipsoids. In the GAME that is not a bug — a phone in a forest
  has budgets — but the HUD has to say WHICH limit is binding, which is
  why both counts print against their cap (`13/13 textured`) with the
  demand under them (`inside 412 in 0.3 m`), and print the count alone
  where there is no cap. **A count with no cap beside it is not a
  reading — and a cap on a stress bench is not a measurement.**
- **Rank is hysteretic too, not only distance.** Two radii cure a body
  wandering across a line; they do nothing when four hundred bodies are
  inside one radius and thirteen may be textured, because then nobody
  crosses anything and the nearest thirteen are a different thirteen
  every frame. A body that holds a tier sorts from `HOLD_ADVANTAGE` of
  its distance: a challenger has to be a fifth nearer to take its place.
- **The rung's capacity is a CLONE TABLE, not a measurement, and THE
  BENCH HAS NO CAPACITY AT ALL** (Joshua, 2026-09-11: "Remove any limits
  because it is a stress test, and if you keep adding rules, how can I
  actually get the correct numbers?"). `fullBudgetFor` is the sum of
  `POOL_SIZES`, sized for an island where a handful of animals are near;
  do not defend thirteen as though a phone had chosen it. The Creature
  Lab runs `FaunaView.setUncapped(true)` — no budget, no pool ceiling —
  and RIGS chooses only WHICH QUESTION: `ALL` gives every drawn body the
  full textured model whatever its distance, `LOD` lets the radii decide
  and nothing else. A run ends because the phone ended it. **Measure
  uncapped, then choose a cap.** Adding a rule to the bench to work
  around a limit on the bench is the mistake to avoid; take the limit off
  instead. The pool grows to demand (`POOL_WARM` up front,
  `POOL_GROWTH_PER_FRAME` after), which is what makes that affordable.
  And the bench measures at the rung the player plays at — it reads
  `settings.detail` through `detailFor`, exactly as the world does, and
  its report says the rung caps nothing there.
- **The latching boundary is TWO numbers; the fade is neither latched
  nor timed.** A body wins its textures at `TEXTURED_IN` and keeps them
  to `TEXTURED_OUT`, so one sitting on the line cannot strobe. The
  crossfade needs no hysteresis because it is continuous in DISTANCE:
  `meshShare` is 1 at 0.5 m, 0 at 0.6 m and a straight ramp between, and
  the impostor draws the rest of the animal. It is simply true every
  frame — nothing to start, hold, finish or get out of step with the
  tiers, which is what the timed crossfade it replaces kept doing.

**THE LOD CENTRE IS THE CAMERA, NEVER THE INSECT** (Joshua, 2026-09-10:
"That range is based on the camera as that's what the player sees in
1st (not added yet), 3rd person, etc… needs to be around the camera not
insect"). The radius is about WHAT IS ON SCREEN, so it is measured from
the eye the frame was drawn from — the follow camera in first or third
person, the observer camera in observer mode — in three dimensions,
height included (`FaunaView.update`'s `eye`/`eyeHeight`, which the scene
fills from the ACTIVE camera). Never from the player's body, never from
the room's centre, never from a fixed point. A body's own position is
what is being measured, not what it is measured from.

The consequence is worth stating so it is never mistaken for a bug: a
radius written for a camera riding with an ant does not cover a box
being looked at from OUTSIDE it. The Creature Lab's bench stood 1.00 m
from the centre of its 1 m room, so none of that room's floor was inside
the near radius — the ladder working exactly as specified, on a bench
that could never see it work. Joshua: "if the room is a 1x1x1m block and
I asked for 0.6m, then most of the room should be rendered."

**THE BENCH VIEWPOINT IS A FUNCTION OF THE RADII AND MOVES WHEN THEY
DO.** `FREE_START` now stands in the room at 0.32 m from the middle,
which puts 17% of the floor inside `TEXTURED_IN`, 53% inside `FADE_FROM`
and 68% inside `MESH_OUT` — every rung on one screen — at the cost of
framing 52% of the floor rather than 96%. Both columns are measured
against the real frustum at 932 × 430, in `docs/PERFORMANCE.md`. When a
radius changes, recompute that table and move the bench. Never anchor
the ladder to something else.

**A meter may only move if there is a way to move it back. An unavailable
action must never look functional.** "Multiplayer" in the UI may never
imply more than exists; the honest caption is pinned by a test.

**Generic UI may be copied; what is ours stays ours** (Joshua,
2026-09-07). A joystick, a health or water meter, a button cluster, a
layout — conventions shared by countless games — may be taken from v0 or
modelled on other games, Path of Titans included; he raised the ant game
with that studio years ago and was told there was no objection. What is
NOT copied is a name, a game-specific element unique to another title,
or anything that would make this read as that game. Do not stop or
narrow work over a joystick or a meter; do keep the game's own elements
its own.

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
- **The world's objects are a function; the rung is a lens** (Joshua,
  2026-09-06). Where a tree, a rock or a blade stands comes from ONE
  fixed world seed, its 16 m cell and the habitat — never from
  `Math.random`, never from a neighbour, never from what streamed in
  (`world/objects/populate.ts` reads the coarse survey through
  `world/habitat.ts`; only the object's CONTACT with the ground — its
  foot height and the ground's normal under it, which is how a rock is
  bedded and a twig lies along the slope — reads the live heightfield,
  in `flora/WorldObjects.ts`, and re-reads it when a tile lands).
  The detail rung sets the bubble's radius and per-family caps and
  nothing else: a cap is a maximum, not a quota, and a tree stands in
  the same place at every rung. Trees and rocks carry stable ids
  (`tree:cx,cz:site`); a future save stores DELTAS against them, never
  the generated world.
- **Only an authorised actor edits the ground; the animals are data**
  (the pre-player ecology pass, 2026-09-07). The list of who may change
  the terrain is short and explicit — player ants, AI ants, burrowing
  creatures, a tool granted the right — and everything else NEVER does:
  water, rain, rivers, the sea, the weather, walking, growth, aphids,
  flies. A burrower's only door is `creatures/terrainEdit.ts`, the
  species table says which species may knock. Alpha.27 implements that
  seam with `world/SparseSoil.ts`: saved world-addressed capsule deltas
  sampled on a 1 mm lattice, separate from the immutable survey. The
  detailed local editor runs within 1 m horizontally / 2 m vertically
  of the observer. Remote rooms retain the no-op until authoritative
  terrain replication exists. The HUD counts APPLIED edits, not attempts.
  Do not build a second, private way to deform the ground for one
  creature. The creatures themselves follow the objects' rule — one
  seed, a 16 m cell and the habitat say where an animal is; the rung
  says how many this phone simulates and draws, as caps that are
  maximums; every number in `creatures/species.ts` is labelled
  MEASURED, BIOLOGICAL SHAPE or GAME TUNING; and `creatures/` is core,
  so a server can run the same tick.
  Soil meshes stream without deleting edits. SoloSave v2 carries the
  additive `terrainEdits` document (8,192 bounded strokes per slot); an
  exhausted journal refuses new cuts visibly rather than erasing old
  tunnels. `SoilView` publishes completed columns before `TerrainView`
  clips its coarse sheet. SOIL is an observer cutaway only: it never digs,
  and its temporary camera pace restores the normal rung when closed.
  Player DIG/BUILD, ant collision/navigation, full nest planning and cave
  flooding are still later milestones. Water only reads `surfaceAt`.
- **The sky is the island's, or it says so** (Phase 5, 2026-09-07). The
  weather is read live from Open-Meteo over the 22-station grid, kept
  for three hours, and only then falls back to the seeded model — and
  the HUD's sky line names which of the three it is showing (`live`,
  `cached`, `sim`). `?sky=` and `?hour=` hold a sky or an hour open for
  a probe or a look, the way `?tier=` holds a rung: overrides, never
  settings, and the line reads `sim` while one is in force. The sun's
  place comes from the real HST clock through `world/weather/solar.ts`
  (NOAA's equations, pinned against Līhuʻe's published sunrise); nothing
  invents a time of day.
- **The player may HOLD the sky, and the sheet says so** (Joshua,
  2026-09-08: "add a time slider from midnight to midnight... for solo
  play, time can be changed, but live multiplayer won't be"). This
  DEPARTS from the line above — an hour used to be an override and never
  a setting — and it departs deliberately, for a reason worth keeping:
  Kaua'i's real sky is dark for half of every day, he tests in the
  Hawaiian evening, and a correct world at 4 a.m. is a black screen with
  everything in it. `?hour=` cannot reach a home-screen app with no
  address bar. So `settings.timeOfDay` holds an hour, `Settings` shows a
  slider from midnight to midnight in quarter hours, and
  `solar.heldHourMs` is the ONE rule both it and `?hour=` use — today's
  date, because the sun's height at an hour is a function of the season,
  and no drift, because an offset added to `Date.now()` creeps.
  What keeps the older rule's intent is the HUD: the clock line prints
  `held` for as long as the clock is standing still, by the slider or by
  the address bar, so a held sky can never be mistaken for the island's.
  It moves the SUN and, through the sun, what the animals do; the WEATHER
  stays the island's live reading, so the source word still means what it
  says. SOLO ONLY — a room's clock belongs to everyone in it, and the
  refusal is at the point of USE (`holding()`), not where the setting is
  read, because settings are applied before the session's mode is known.
- **Light decides what shows; nothing paints it** (the lighting polish,
  2026-09-07). The sea's sheen and its foam's opacity read the scene's
  own lights, the ground's wetness is a lens on its colour, the sun's
  shadow is the sun light's and follows the Detail rung, and the night
  dome follows the real sun through astronomical night. Do not fix a
  night rim, a black slope or a dull sea by adding a constant: find the
  term that ignores the light and make it read the light. Wetness and
  shadows are appearance only — no height, no material swap, no
  island-wide field — and `tests/terrainView.test.ts`, `tests/skyView.test.ts`
  and `tests/seaWaterLook.test.ts` pin that.
- **The finder is an INSTRUMENT, and the only thing in `src/` allowed to
  look like one** (Joshua, 2026-09-08: "I don't see any worms in the
  game... can you make a simple 3D finder I can turn on to find them
  better?"). Nothing was broken — the forest holds forty worms of forty —
  but a 150 mm animal 12 mm under the soil on a 5,600,000-unit island is
  a correct ecology and an empty screen. So `fauna/FinderView.ts` is
  unlit, ignores the depth buffer and holds a constant size on screen:
  three properties that would be bugs in a renderer and are the whole
  specification of a gizmo, and it does NOT follow "light decides what
  shows". The rule that matters: an instrument READS the world and never
  arranges it. Do not widen a reach, grow a body, hold a worm at the
  surface or spawn anything to make the animals easier to find — put a
  pin on them, and let `creatures/finder.ts` say where a camera has to
  stand to see one. It is off by default and every probe shot but
  `probe:finder`'s is taken with it off.
- **The ground MOVES, so anything remembered against it is remembered as
  a DEPTH** (the worm's L, 2026-09-08). `Heightfield.heightAt` answers
  from the coarse lattice until an HD tile lands under the camera and
  from the tile after; the two agree at every coarse sample and differ
  everywhere between, which is metres in a gorge. A renderer that stored
  an absolute height once and clamped it to the ground later is
  therefore holding a number that goes stale, and a one-sided clamp
  strands it: `FaunaView`'s worm trail kept each crumb's height and
  raised it to the ground, so a ground that DROPPED left the body hanging
  where the old lattice had been and drew all 15 cm of worm standing
  vertically out of the hill. Store the depth and resolve the height from
  the current ground every frame — then a tile landing moves the body
  with the world, which is what it is for. The same rule is why the
  objects re-read their feet when a tile lands (`flora/WorldObjects.ts`).
- A client-side PIN is a convenience, not security.
- Every file in `scripts/` is wired to a `package.json` script or listed
  in `scripts/MANUAL.md`.

## Verification

Measure rather than assume. `npm run typecheck`, `npm test`,
`npm run build`, `npm run probe:boot`; read `package.json` for the current
list. `npm run probe:soil` checks worm cuts, the soil controls at phone/PC
viewport sizes, and saved reload against the built game. CI runs typecheck +
test + build + `relay:typecheck` on every push.

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
  build it is running — and the running app READS that stamp
  (`app/updateCheck.ts`, wired in `main.ts`): at boot, whenever it
  comes back on screen and every few minutes at the menu it compares the
  live commit with its own and reloads itself when they differ, never
  mid-game and never twice for the same commit. A home-screen app is
  otherwise never reloaded by anyone, so this is how a push reaches the
  phone.
- Every icon is baked ONTO THE FOREST FLOOR (`bake:art -- icons`): no
  home screen shows a transparent corner — iOS flattens the icon onto
  white and rounds it — so the circle sits in a dark tile that is part
  of the picture.

## Parallel agent work (Joshua's standing plan for v1)

**THE DIVISION OF LABOUR IS FIXED (Joshua, 2026-09-08):**

> "1) You do the searches… 2) Other Agents Code… 3) You make sure the
> Agents did the job correctly. You are the assistant designer under me,
> and I don't need over 8 agents at a time for something simple since TCS
> didn't use any agents to build it and it worked."

Three rules, in his order, and they override any habit of fanning out:

1. **Claude does the reading.** Searching this codebase, tracing a bug,
   measuring a symptom and deciding what is actually wrong is CLAUDE's
   job, done directly. Do not spawn agents to read — a fanned-out search
   mostly returns what a grep would, and the answer arrives with someone
   who has to defend it. (This is the older "minimum for research" line,
   now a rule rather than a preference.)
2. **Agents write the code.** Once the design is decided, leaf modules
   are what agents are for: one agent, one file or one directory, never
   another's files.
3. **Claude verifies.** Not a reviewer agent — Claude reads the diff,
   runs the typecheck, the tests, the build and the probes, and looks at
   the shots. A review agent is a third opinion nobody asked for and it
   is Claude who answers for the push.

**Eight agents is the ceiling for ordinary work, and it is a ceiling,
not a target.** TCS was built with none. If a task wants more than a
handful, the task is probably not decomposed — decompose it, or do it.

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
