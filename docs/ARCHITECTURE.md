# TRADDOMIUM: Micro Battle! — v1 Architecture

**Status:** approved by Joshua on 2026-09-04 after a read-only audit of
Beyond Extinction, Thronemound Colony Sim (`?scene=island`) and the v0
TRADDOMIUM build. This is the spec the rebuild is built against. The
audit's reasoning lives in the conversation that produced it; the
decisions live here.

**The rebuild rule.** v1 is built from the foundation outward. It starts
from a blank tree. Good v0 modules (listed in §11) are re-added
deliberately, in the phase that needs them, after being checked against
this document — never carried across wholesale, because the thing that
went wrong in v0 was not any one module but the way they were wired
together. v0 is preserved untouched as the branch `legacy/v0-main`.

---

## 1. The goal in one sentence

Six months from now, adding a feature should answer three questions
immediately — **where it belongs, who owns it, what it is allowed to
change** — without any one class quietly becoming the whole game again
(v0's `IslandScene.ts` was 4,540 lines and was the live production scene;
`PlayerAnt.ts` was 1,007 lines and mixed transform, rendering, climbing,
flight attitude and a direct import of the UI settings module).

## 2. Principles (each one is a v0 lesson, not a preference)

1. **One owner per module. A module may only mutate state it owns.**
   Everything else is a typed parameter in, or a read-only query out.
2. **Renderers and cameras accept continuous, surface-agnostic signals**
   (position, up vector, facing, a 0..1 lever, a boolean easing flag) —
   never a gameplay mode enum by name. v0's `FollowCamera` already did
   this right; v0's HUDs sometimes did not.
3. **State is derived every frame from measured facts where possible,
   not transitioned by hand at call sites.** v0's `motion.ts` was built
   after a bug where nine mutually-constrained booleans on one scene had
   their constraints written down nowhere. Where a latch is genuinely
   needed (v0 climbing grip, to stop chatter at the foot of a trunk), it
   is one named object, not loose fields.
4. **Raw frame time and simulation dt are two different numbers from the
   moment they are read.** v0 clamped `dt` to 0.1 s for anti-teleport
   reasons and fed that same value to the FPS readout, so the display
   could not report below 10 fps by construction. Instrumentation reads
   the raw wall-clock delta; physics reads a separately clamped sim dt.
5. **One choke point for scene transitions, one for asset loading.**
   (Beyond Extinction's `SceneManager.goTo()` and `assets.ts` — the two
   things in that codebase every subsystem actually funnels through.)
6. **Core modules import nothing from `three`, the DOM, storage or the
   network.** A source-text test enforces it. This is what makes a
   module unit-testable, and it is the running definition of "what could
   run on a server" once multiplayer authority matters.
7. **Screens talk to their owner through typed hook objects and never
   import the module whose state they display or drive.** v0's
   `GameFlow.ts` proved this works; the rule now extends into the world
   instead of stopping at its front door.
8. **Numbers live in registries, never inline.** Gameplay consumes
   authoritative data; it does not invent another copy.
9. **An unavailable action must never look functional**, and a meter may
   only move if there is a way to move it back.
10. **Honesty in the UI is a tested invariant**: "Multiplayer" may never
    imply more than what exists. v0 pinned the caption "Online play is
    not built yet." in a test; v1 keeps that discipline.
11. **A client-side PIN is a convenience toggle, not security.** Any dev
    tool that writes to anything shared is gated server-side or not at
    all.
12. **Every file under `scripts/` is wired to a `package.json` script or
    listed in an explicit manual-only allowlist.** v0 accumulated 29
    orphaned probes nobody could tell were dead or load-bearing.

## 3. Module map and ownership

```
src/
  main.ts       boot only: construct App, start it. Nothing else.
  app/          App (composition root, single rAF loop), AppState,
                Scene contract + SceneContext, SceneManager, Renderer,
                FrameClock, registry of navigable scenes, and the
                update watch (version.json against the running commit;
                reloads at boot / on resume / at the menu, never
                mid-game — main.ts supplies the browser).
  session/      GameSession contract, LocalSoloSession + the SoloSave
                document, RemoteMultiplayerSession (mock until transport
                exists), PlayerProfile (device-local layer first) and
                playerIdOf().
  world/        terrain / water / weather / vegetation / ecology (what
                the island offers to eat and drink — world/ecology, a
                pure query over the objects and the water), and
                WorldLoader.
                Phase 0 holds only WorldLoader and the empty world. Phase 6
                adds random.ts (the one stable hash and PRNG), landcover.ts
                (the ESA WorldCover raster), coast.ts (distance to the
                sea), habitat.ts (what belongs where) and objects/ (cells,
                families, the deterministic populator, the per-rung
                budgets, the world seed and the delta seam).
  actor/        Player{Transform, Vitals, GroundLocomotion, Flight,
                SurfaceGrip, Rig} composed from small pure modules.
                Phase 1 holds the contracts: ActorId, PlayerId,
                ActorState (position is a WorldPoint), CapsuleTuning and
                the pure flat-plane Transform.step.
  view/         three.js visual adapters for actors (CapsuleView) — the
                only place actor state meets a mesh; actor/ stays
                three-free.
  terrain/      the ground's renderer and its residency: TerrainView, a
                geometry clipmap of concentric rings over
                world/heightfield (its innermost rings FINER than the
                survey's step, so the drawn triangles converge on the
                bilinear surface everything else stands on — added with
                Phase 6's objects, whose feet showed the gap), and
                TerrainStreamer, which keeps the high-detail tiles near
                the camera loaded and lets the rest go. What view/ is to
                actor/, this is to world/ — the only place a height meets
                a mesh; world/ stays three-free. Added in Phase 2.
  sea/          the water's renderer: OceanView (two sheets, near and
                far), waterLook (the one shader every sheet wears) and
                SeaTextures (the ripple and foam maps, loaded once and
                shared). What terrain/ is to the ground, this is to
                world/sea/. Added in Phase 3.
  flora/        the world objects' renderer: WorldObjects (the bubble of
                grass, twigs, stones, rocks and trees that streams by
                16 m cell after the camera and draws as a dozen
                InstancedMeshes), the blade (Joshua's 2022 OBJ, inlined),
                the procedural tree (v0's treeMesh, three shapes), rocks
                and twigs. What terrain/ is to world/heightfield and sea/
                to world/sea, this is to world/objects: the only place a
                populated cell meets a mesh, and where each object takes
                its REST on the ground — foot and normal from the live
                heightfield: a twig along the slope, a rock on its base,
                bedded; a tree up, buried as the slope needs. Added in
                Phase 6.
  sky/          the sky's renderer: SkyView (an HDRI skydome — two images
                cross-faded and turned so the baked sun stands at the
                real one's bearing — that drives the sun light, the sky
                light, the fog and the horizon), skyLook (pure: the light
                and the air from the weather and the sun's position),
                RainView (v0's rain, a sheet of drops around the camera).
                What terrain/ is to the heightfield and flora/ to
                world/objects, this is to world/weather and its solar
                clock: the only place a reading meets a light. Added in
                Phase 5.
  camera/       FollowCamera + CameraOwnership. Phase 0 has FreeFlyCamera
                only (under perf/).
  input/        keyboard / pointer / touch (Input.ts, DOM) → one shared
                Intent shape (Intent.ts, pure), also produced by autonomy/.
  autonomy/     mission brain, autopilot, route planner — an Intent
                PRODUCER, sibling to input/. Empty until its phase.
  creatures/    the island's animals, as CORE: species as data
                (species.ts — sizes cited, senses, paces, needs,
                populations, what medium each lives in and whether it may
                edit the ground), CreatureState (a WorldPoint and a
                height, a heading, a behaviour, needs), the deterministic
                population per 16 m cell (the same rule the objects
                follow: seed + cell + habitat, never Math.random), the
                throttled decision (intent.ts: a behaviour chosen every
                THINK_S, not every frame), the continuous locomotion
                (locomotion.ts: walk, burrow, fly — pure integrators),
                and the simulation over resident creatures in tiers (far:
                nothing; near: intent + locomotion at a low rate; full:
                every frame). It reads the world through one read-only
                query object (CreatureWorld) and mutates only creature
                state. The terrain-edit seam (terrainEdit.ts) is the ONLY
                door a burrower has to the ground; alpha.27 supplies
                world/SparseSoil for local solo worlds. Remote worlds keep
                the no-op until shared terrain authority exists. Three-free; a server
                can run the same tick. Added in Phase 6.5, the pre-player ecology pass.
                finder.ts (6.7) is the instrument's arithmetic: which
                animal is nearest, how deep it is, and the pose a camera
                must take to SEE a 15 cm animal. It reads; it changes
                nothing.
  fauna/        the animals' renderer: one loaded rig per species
                (SkeletonUtils clones from a pool lent to the nearest
                creatures), procedural motion on the rigs — legs found by
                measurement, wings, the worm's chain aimed along its
                trail — and instanced impostors past the pool's reach.
                What flora/ is to world/objects, this is to creatures/.
                Added in Phase 6.5, the pre-player ecology pass.
                FinderView (6.7) is the one deliberate GIZMO in src/:
                unlit, depth-test off, constant size on screen. It is an
                instrument laid over the world, off by default, and it
                says so in its own header so nobody 'fixes' it into
                obeying the lighting rule.
  ui/           screens (menu, settings, about, loading, pause) and HUD
                widgets. Typed hooks only. ui/splash/ is the key-art
                stage: the three-layer meter sandwich, the boot splash
                that index.html paints with the document, and the
                generated cutout numbers scripts/bakeArt.mjs measures.
  devtools/     the Editors / Dev Tools hub and the DevTool contract.
                Every tool is an ordinary scene. Phase 1 adds the
                Network Lab: one in-process host, two loopback clients.
  data/         schema.ts (registry + curve × life-state multiplier
                pattern) and the typed registries (empty shells).
  net/          Transport contract, LoopbackTransport (a modelled wire:
                latency, jitter, drop, seeded), WebSocketTransport (the
                same contract over a real socket: backoff, and the
                remembered hello that re-attaches an identity), protocol.ts
                (the message shapes, their guards and the Authority
                interface, §5), HostAuthority (Host.ts), Client, Replica
                (interpolated remote actors) and NetworkConditions. All
                pure — WebSocketTransport reaches the platform's socket
                constructor through an injected factory, never by naming
                a global.
  perf/         PerformanceWorldScene, FreeFlyCamera, PerfHud,
                FrameStats (pure).
  persistence/  versioned storage wrapper with defensive reads.
  assets/       assetUrl(), loadModel() with retry + tagged placeholder,
                loadTexture(). The only loader in the codebase.
tests/          vitest. simulationCore.test.ts is the import-boundary test.
scripts/        Playwright probes and bakes, every one wired or allow-listed.
docs/research/  reference material carried from v0, read-only.

worker/         THE RELAY, deployed to Cloudflare, not to Pages. index.ts
                routes (/health, /room/<code>); RoomDurableObject holds
                ONE room = one Durable Object = one `src/net/Host.ts`;
                WebSocketTransport wears the core `Transport` over a
                workerd socket; roomCode.ts says what a code is. It owns
                a socket, a clock and a call to tick() — and no game rule.
```

**Allowed dependency direction** (an arrow means "may import"):

```
main → app, ui(splash/BootSplash only: the document splash is boot's)
app → session, ui, devtools, world(WorldLoader), perf, input, assets, persistence
session → persistence, net, data, world(coords), actor(PlayerId)
actor → world(coords), input(Intent.ts) only
net → actor, world(coords), input(Intent.ts)
devtools(Network Lab) → net, actor, view, perf(grid/camera helpers), three / DOM
world, actor, autonomy, data, net, perf(FrameStats), persistence, input(Intent.ts) → NOTHING in three/DOM (core)
perf(scenes/hud), camera, view, ui, devtools, assets → three / DOM allowed
view → three allowed; it reads ActorState and writes a mesh
terrain → three, world(heightfield as types, coords, origin, dem, demRepair),
          assets(demSource, for the tiles it streams) — nothing else
terrain → NEVER actor, view, session, ui (the ground does not know who stands on it)
flora → three, world(objects, habitat/heightfield as types, coords, origin, random) — nothing else
flora → NEVER actor, view, session, ui, net (the grass does not know who walks through it)
sky → three, world(weather as types, weather/solar, coords, origin), assets(textureQuality, skyManifest, skySource) — nothing else
sky → NEVER actor, view, session, ui, net, perf (the sky does not know who is under it)
creatures → world(coords, random, habitat/heightfield/objects/ecology as TYPES and pure helpers), data — nothing else; NEVER three, DOM, storage, network
fauna → three, creatures (as types + the species table), world(coords, origin), assets(assets.loadModel) — nothing else
fauna → NEVER actor, view, session, ui, net, perf
actor → NEVER view (a state module does not know what it looks like)
ui → NEVER world, actor, autonomy, session internals (typed hooks only)
camera → NEVER actor mode enums (continuous signals only)
worker → net (Host, protocol, Transport) and NOTHING else of src/
worker → NEVER three, the DOM or node: workerd is its own runtime
```

`terrain/` was added on 2026-09-04, in Phase 2. Terrain rendering had no
home in this map: `world/` is core and may not touch three, and `view/` is
defined here as the actor adapter. A terrain mesh is neither, and putting
it in `view/` broke that directory's own boundary test on the first
commit — the honest fix was a directory rather than a wider rule. It
crosses the render boundary exactly as `view/` does, through
`origin.toLocal`, and `tests/viewBoundary.test.ts` now holds both to the
same `.wx` ban. `coords.snapTo` was added at the same time for the same
reason: a clipmap must snap a ring to a lattice, and it must be able to
do that without taking a world coordinate apart by hand.

`sea/` was added on 2026-09-05, in Phase 3, for the reason `terrain/`
was: the water's renderer is neither an actor adapter nor core, and it
crosses the render boundary the same way. It is the one renderer the
`.wx` ban does not fit, and that is a real exception rather than a
loophole — the water's SKIN is world-locked. The ripple tiles against
world position, the swell is evaluated at world position, and the far
sheet's hole is a world distance, so `uCentre` and `uHole` are world
coordinates by design; the water audit lists exactly this as correct in
v0 ("world-coordinate uniforms, per-frame place(), y never rebased").
`tests/viewBoundary.test.ts` therefore holds `sea/` to the sharper rule
the ban was a proxy for: every world coordinate it reads goes straight
to the GPU or straight back into another world coordinate, and the mesh
still crosses through `origin.toLocal`.

`flora/` was added on 2026-09-06, in Phase 6, for the reason the other
two renderer directories were. It is held to the sea's sharpened rule
rather than the `.wx` ban (`tests/viewBoundary.test.ts`): a world
coordinate it reads goes back into another world coordinate — an
object's distance from the camera is world minus world — or through
`origin.toLocal`, in `WorldObjects.ts` alone; the geometry bakes touch
none. Three decisions Joshua made opening the phase are recorded in the
code rather than here: ONE fixed world seed for every player and room
(`world/objects/seed.ts`), the ESA landcover raster as the habitat's
first input (`world/landcover.ts`), and all-procedural props
(`flora/propGeometry.ts`). The rule the phase is built on, in his words:
"Kauaʻi determines what exists. The deterministic world generator
determines where it exists. Detail Quality determines how much the
device represents." The detail rung never reaches the populator — it
sets the bubble's radius and its caps (`world/objects/budget.ts`) and
nothing else, and a test holds a tree in the same place at every rung.

`creatures/` and `fauna/` were added on 2026-09-07, in the pre-player
ecology pass (Phase 6.5), and split the same way the objects are: the
animals are CORE (`creatures/` — species as data with every number
labelled, a plain `CreatureState` per animal, a deterministic
population per 16 m cell from the same seed and habitat the plants
use, a decision every `thinkS` rather than every frame, and pure
locomotion integrators), and the way they look is a renderer
(`fauna/` — one loaded rig per species, a small pool of skeleton clones
lent to the nearest, procedural legs, wings and the worm's chain,
instanced impostors past the pool). Joshua's rule for the pass extends
the vegetation's: "Kauaʻi determines what belongs there. The
deterministic world determines where it exists. Detail Quality
determines how richly the device represents it. Creature AI determines
what living things do. Only explicitly authorized actors may change
the terrain. Water responds to the world, but does not sculpt it." The
last two sentences are the seam in `creatures/terrainEdit.ts`: a
burrower's only door to the ground is `BurrowEditor`, the species table
says which species may knock. Alpha.27 supplies `world/SparseSoil` in
local worlds: world-addressed subtractive capsule deltas, sampled on a 1 mm
lattice. Sweeps include descent and surfacing. The immutable survey still
stands; only authorised actors write deltas, and the HUD counts applied
edits. Nearby detailed edits run within 1 m of the observer (2 m vertically).
Remote worlds retain the no-op pending authoritative terrain replication.
SoloSave v2 adds optional `terrainEdits`, preserving alpha.26 saves. Its
8,192-stroke bound refuses new work visibly at capacity; it never discards
old tunnels. `terrain/SoilView` streams complete 3.2 cm columns on a
millisecond budget and publishes them to `SoilClip` only as a WHOLE window:
the last complete window stays shown and clipped until every column of the
next one is built (double-buffered, so a depth change or a moved window never
shows a half-built pit or a hole to the sky). The window is ±1..8 tiles
(19-51 cm a side, half-tiles a parameter the scene sizes to the selected
worm; every column is ~9.5k triangles and 18-34 ms, so 6 is the practical
top on a phone). The observer section lowers only the rendered ceiling. Its
outer rim returns to the surveyed surface and is SEALED against the sparse
edits, so a tunnel leaving the window meets a wall of soil rather than the
void under the coarse sheet. The scene sizes the window to the selected
worm (`soilHalfTilesFor`: half the body plus a 5 cm margin, 3..8 tiles),
re-centres it on the worm's tile only when the worm is two tiles from the
centre, holds the camera 3 mm above the cut floor while the section is open
(`FreeFlyCamera.holdAbove`), and when the eye is in SOLID soil — below the
cut floor, or underground with the section shut — fogs to the soil's own
albedo within centimetres and takes the background with it
(`terrain/undergroundLook`, the underwater block's latch/restore discipline,
water winning over soil), leaving the pit's air and the sky over it untouched.
An outer render seam joins the
actual coarse triangles through `TerrainView.drawnHeightAt`. That query is
for this visual join only, never for creature or water authority. The
renderer uses core tile-address helpers and the floating origin, never
subtracts world coordinates itself. Water receives read-only `surfaceAt`
and a revision; this handles surface openings, not 3D cave flooding.
Player digging/building, ant collision/navigation, the planner and shared
soil remain later milestones. Water, rain, rivers, the sea, the
weather, walking, growth, aphids and flies never reach the seam at all.
The island's resources (`world/ecology/`) are DERIVED from the plants
and the real water rather than placed: nectar is a flower's, sap a
tree's, litter the forest floor's, and a water edge is where the
freshwater solver says the ground is dry beside ground that is wet —
"Water is a WORLD SYSTEM, not an object quota."

`net → input(Intent.ts)` was added on 2026-09-04, with the practice bot
(`net/PracticeBot.ts`): a scripted player's thumbs must speak the ONE
movement shape — the same one `actor →` already reaches for — or a bot
would be moved by something the player's own body is not. `Intent` is
pure and core, so the core rule above is untouched. Flagged here as a
spec amendment rather than made quietly, because Joshua approved this
document.

## 4. App flow and AppState

```
BOOT → MAIN MENU
        ├─ RESUME (shown only when a save exists; names the newest game)
        │    ├─ one saved game  → that slot        → PLAY
        │    └─ two or three    → slot list → slot → PLAY
        ├─ NEW GAME → Session picker
        │    ├─ SOLO        → slot list → slot     → PLAY
        │    │                 (an occupied slot asks before it is replaced)
        │    └─ MULTIPLAYER → no slot              → PLAY
        ├─ PROFILE
        ├─ SETTINGS
        ├─ EDITORS / DEV TOOLS → (hub) → any tool scene
        └─ ABOUT

PLAY = SESSION → WORLD LOADER → WORLD
```

RESUME exists exactly when a save this build can open exists, and it says
when that game was last played. With one saved game it opens it; with two
or three it opens the slot list, because choosing the newest for the
player would be the menu deciding which game they meant. NEW GAME on an
OCCUPIED slot asks before it replaces the game there — the only path that
destroys a save, and the reason the slots exist at all.

**Multiplayer takes no slot.** Nothing about a multiplayer game is kept on
this device — a server would own that state — so offering a save slot for
one would promise a game is being kept somewhere it is not.

`AppState` is a small explicit union — `boot | menu | session | loading |
playing | paused` — owned by `App`, one layer ABOVE scenes, so that a
session (a live connection, a room id, a load percentage) can outlive a
scene swap. Beyond Extinction conflated app state with the active scene
and could not express "the world is frozen"; v1 can, and the frame loop
gates every ticking system on it centrally rather than each scene
remembering to check.

Every navigable thing — menu, settings, the loader, the world, the dev
hub, every dev tool — implements the same `Scene` contract (`name`, own
`THREE.Scene` + camera, `enter/update/resize/dispose`, optional
`renderOverlays`) and is reached only through `SceneManager.goTo()`,
which does: fade out → dispose old → reset shared singletons (input
handlers, audio, hints) → construct → `await enter()` → set current →
resize → fade in, with a queued (not dropped) second request and a
scripted fallback to the menu on `enter()` failure.

## 5. The session seam (solo + multiplayer from the foundation)

From `docs/research/SESSION_ARCHITECTURE.md` §19, built as written:

```ts
interface GameSession {
  readonly mode: 'solo' | 'multiplayer'
  readonly mapId: string
  readonly canPauseWorld: boolean          // solo true, multiplayer false
  readonly authority: 'local' | 'server'
  save(state?: SessionSaveState): Promise<void>   // Phase 1: the camera pose, in WorldPoints
  leave(): Promise<void>
}
```

`LocalSoloSession` is real from Phase 0 (local authority, true pause,
local saves, offline). `RemoteMultiplayerSession` is a MOCK from Phase 0
— same interface, no transport, honest caption — so gameplay code never
learns whether another player is local or remote. Session state has ONE
owner: the session object. It is passed, not the enum (v0 duplicated
`mode` between `GameFlow` and `IslandScene`).

The first multiplayer milestone is two browsers, two coloured capsules,
one tiny session, each seeing the other move, with disconnect/reconnect —
before any ant exists. `net/Transport` is the seam it plugs into, and
`net/protocol.ts` fixes what crosses it: `hello` → `welcome`, then
`join` / `leave` as players come and go, `move` from a client, `snapshot`
from the authority, `bye` on the way out — plain data, every position a
`WorldPoint`, each guarded by `isMessage()` before it touches state.

**A move is a claim.** One party — the `Authority` — owns the truth of
where every actor is. A client's `move` says "I am here now, claim
number `seq`"; the authority applies it if it is plausible and answers
with the truth in the next `snapshot`, which may put the actor somewhere
else. That is how a teleport, a fast-forwarded clock or a malformed
position is refused without a rejection message: the client reconciles
to the snapshot. `LocalAuthority` (solo) applies claims directly;
`HostAuthority` (multiplayer) validates and rebroadcasts. Both hide
behind the one interface, so a session never asks which it holds.

**WHERE THE RELAY IS, AND WHO GETS TO SAY.** One file answers it:
`net/relayConfig.ts`, which resolves the address in one order — `?relay=`
in the address bar, then `__RELAY_URL__` (baked in at build time by
`vite.config.ts`, defaulting to the deployed relay and overridable with
`TRADDOMIUM_RELAY_URL`), then `''`. An empty answer is the honest
no-relay build: no room step is offered at all and the multiplayer
caption is the pinned "Online play is not built yet." A constant rather
than a fetched config because the screen must answer "is there online
play here?" synchronously, before it offers a room; `?relay=` is what
covers the one thing a constant cannot do, and it is how
`npm run probe:multiplayer` points the BUILT game at a relay running on
127.0.0.1. `relayConfig` is core, so it never reads the address bar
itself: `app/registerScenes.ts` reads the parameter and passes it in,
which is also what makes the order testable without a browser. The same
file holds what a room CODE is, pinned by test against the worker's own
`roomCode.ts`, so the client can never offer a code the relay refuses.

The room a player types becomes `wss://<relay>/room/<code>`, which is
what `RemoteMultiplayerSession` holds as its wire; the world scene finds
that wire on the session it was handed and drives it through
`net/NetworkedWorld` (hello, claims at the authority's own snapshot rate,
remote actors out of the `Replica`). WHERE YOU JOIN IS THE AUTHORITY'S
TO SAY: the camera stands over the actor the welcome names before it
claims anything, or its first claim would be a jump the travel budget
refuses — and then every claim after it, since the gap never closes.

**ONE HOST, TWO PLACES IT RUNS.** The relay in `worker/` does not
reimplement the authority: its Durable Object imports `src/net/Host.ts`
and runs that file unchanged. The travel budget that refuses a teleport,
the spawn, the 20 Hz snapshot round, the disconnect grace and the
identity re-attach are therefore the SAME code in three places — the
loopback the Network Lab drives, the vitest replication test, and the
room a phone connects to. That is what `net/` being free of `three`, the
DOM and node buys, and why the boundary is worth a test
(`tests/simulationCore.test.ts`): the moment a rule can only run in one
of those places, the loopback stops predicting the relay and the tests
stop being evidence. `worker/` supplies only what `Host` deliberately
lacks — a socket, a clock and something to call `tick()`.

## 6. State architecture

```
AppState      boot | menu | session | loading | playing | paused
SessionState  the GameSession object (mode, authority, mapId)
WorldState    persistent world facts: discovery, unlocked areas, world clock
PlayerState   vitals, stats, carried items
  └─ Posture  derived every frame (idle | walking | wading | swimming |
              diving | flying | climbing) — one pure function, no setter
```

A true pause exists only when `session.canPauseWorld`. It gates the
frame loop centrally: physics, streaming, hydrology, weather and
animation all stop because the loop stops advancing sim dt, not because
each of them checks a flag.

## 7. Data architecture

`data/schema.ts` defines the one pattern every registry uses, generalised
from v0's `castes.ts`, which the audit found to be the single clean
data-driven table in v0:

- a **growth curve** (5 sample points, interpolated) × an **orthogonal
  life-state multiplier**, resolved by one `statOf(registry, id, stat,
  growth, state)` function;
- `curveOf` **throws** on an unknown stat name (a typo can never
  propagate a zero);
- each registry declares a `WIRED` list — the fields live systems
  actually consume — and a test asserts agreement at one named reference
  point, so a data file cannot drift silently from the game it describes.

Registries (typed, empty shells in Phase 0): species, castes, growth
stages, abilities, items, resources, biomes, vegetation, water types,
damage types. The rule for "where does this stat belong": if it is a
growth-curve stat it is on the species/caste; if it is a discrete
capability it is an ability; if it is a property of a thing in the world
it is on that thing's registry. There is exactly one registry per kind.

## 8. Editors / dev tools

A tool is an ordinary `Scene` (or a DOM panel) satisfying the `DevTool`
contract (`id`, `title`, `open()`, `close()`, optional `sceneFactory`).
Tools register themselves from their own file; the hub lists what is
registered. The hub is a routed main-menu destination, not a hidden
gesture. Persistence for any tool goes through one generic
`KeyedContentStore<T>` (baked defaults + local overlay + export), never a
hand-copied per-tool store. Planned tools, in rough order: Performance
World (Phase 0), World/Terrain viewer, Water viewer, Vegetation viewer,
Animation viewer, Ant/stat editor, Spawn editor, Profiler, Network/session
lab.

## 9. Performance instrumentation

`app/FrameClock` exposes `rawDt` (unclamped wall-clock, for measurement)
and `simDt` (clamped, for integration). `perf/FrameStats` is a pure ring
buffer with mean and 95th-percentile-low; `perf/PerfHud` renders it.
`perf/PerformanceWorldScene` is the permanent benchmark scene with a
free-fly camera and a layer list that grows with the world plan:

```
EMPTY → Kauaʻi terrain → ocean → freshwater → weather → vegetation → player
```

Each layer is a toggle so its cost is measurable in isolation on a real
device. The probe environment (SwiftShader) runs far slower than a
phone; per-second systems are never retuned from probe wall-clock.

## 10. World loading

`world/WorldLoader` resolves a world descriptor (`{ id, layers }`) to a
world `Scene` factory. Heavy loading happens only inside the target
scene's `enter()`, behind the loading screen, and reports progress
through a milestone-weighted, monotonic fraction built from real
completion signals (bytes, tiles-ready ratio, subsystem-ready flags) with
a rate-smoothed ETA — not a timer.

*Known limit (Phase 0):* `SceneManager.goTo` disposes the loading scene
before the world's `enter()` runs, so the bar is drawn at 0 % behind the
fade today. Before a world with real load time exists (Phase 2), the
transition gains a hold-until-ready shape that keeps the loader current
while the world enters; the progress wiring is already in place.

When terrain arrives (Phase 2): the surveyed DEM enters the world through
a deterministic load-time transform chain — `demRepair` (invalid samples
only) → the hydrology bake → the heightfield — and nothing downstream
ever writes a height. Whether a deterministic, bounded, discharge-scaled
channel carve is added to that chain is an open decision for Phase 2
(see CLAUDE.md, "The terrain is not ours to move"). Live erosion is
permanently excluded.

## 11. Rebuild phases, and what is re-added from `legacy/v0-main` when

| Phase | Builds | Re-added from v0 (after review against §2) |
|---|---|---|
| **0 App shell** | app/, session/ (solo + mock multiplayer), ui/ (menu, settings, about, loading, pause), devtools/ hub, data/ schema, perf/ empty world + FreeFly + PerfHud, net/ stub, persistence/, assets/, tests, CI, boot probe | nothing — blank slate |
| 1 Session + profile | PlayerProfile + PlayerId, SoloSave v2 (camera pose in world coordinates) through `LocalSoloSession`, honest multiplayer mock, actor/ contracts + Intent + `net/protocol`, two-capsule loopback test. Also carries the loading artwork port (splash sandwich, bake script, icons, manifest), and `coords.ts` / `origin.ts` pulled forward from Phase 2 because actors need a `WorldPoint` from day one. **Shipped THREE solo save slots** (`session/SoloSlots.ts`): three independent SoloSave documents, RESUME and NEW GAME on the menu in place of one CONTINUE, and a confirmation in front of the only path that replaces a save. Slot 1 keeps the original single-save key, so a device that already held a game finds it as slot 1 | `save.ts` shape, `coords.ts`, `origin.ts` + their tests, `sessionMode`/`soloSave` tests, the splash assets |
| **1.5 The relay** | The server side of multiplayer: `src/net/WebSocketTransport.ts` (the client's real wire) and `worker/` — a Cloudflare Worker router plus one SQLite-backed Durable Object per room, each running one unchanged `Host`. Proved locally against real workerd by `npm run probe:relay`: two sockets, one room, a walk, a refused teleport, a drop that lingers through the grace, a re-attach that returns the same actor | nothing — v0 had no server |
| **1.6 The room, end to end** | The browser half: `net/relayConfig.ts` (where the relay is, what a room code is), the room screen (`ui/RoomCodeScene.ts`) between MULTIPLAYER and the world, the relay baked into the build (`__RELAY_URL__`, `?relay=` to override), and `net/NetworkedWorld.ts` driving the protocol from the world scene — claims from the free-fly camera, other players drawn through `view/ActorViews`, one honest SESSION line in the perf HUD. Proved by `npm run probe:multiplayer`: two browser contexts at 932 × 430, one locally running relay, the same room code, each connected and drawing the other's capsule, A's flight followed on B's screen, A's exit leaving B up and honest, zero console errors. What is NOT built: the game — no ant, no terrain, nothing saved — which is what the room screen and the multiplayer card say on screen | nothing |
| 2 Kauaʻi terrain | heightfield with a `WorldPoint`-typed API, chunk streaming keyed by global chunk id, terrain layer in the perf world. The `discovery.ts` codec moves here from Phase 1: there is nothing to discover before terrain | `heightfield.ts`, `kauai*.ts`, `demRepair.ts`, `lod.ts`, `stableHash.ts`, `discovery.ts`, the DEM binaries, their tests |
| 3 Ocean | the accepted look, two-owner water router from day one | `seaSwell.ts`, `surf.ts`, `Ocean.ts`, `waterLook.ts`, `liveSea.ts`, foam probe + `oceanShader` fixture test |
| 4 Inland water | hydrology bake feeding the local solver; per-reach bed materials; cascade FX; NHDPlus/DLNR names | `drainage.ts`, `islandChannels.ts`, `hydro.ts`, `waterSim.ts`, `nearestWater.ts` |
| **5 Sky / weather** | **The island's sky, live (2026-09-07).** Joshua: "real weather synced… with a skybox HDRI." THE FEED: `world/weather/liveWeather.ts` — one `WeatherSource`, live → cached → simulated: v0's Open-Meteo provider re-added as `assets/openMeteo.ts` (the only file that spells the endpoint; a reply is untrusted input), v0's 22-station grid (`stations.ts`), field (`field.ts`, a Shepard taper over 20 km, wind as a velocity vector) and blend (`blend.ts`, per-variable easing in sim time) ported into core, the reading kept three hours in this device's storage (`persistence/weatherCache.ts`), the seeded `SkyModel` under it all, `Conditions` → `WeatherNow` through `toWeatherNow`. THE SUN: `world/weather/solar.ts`, NOAA's equations on the real HST clock, pinned against Līhuʻe's published sunrise and sunset. THE LOOK: `sky/` — `skyLook` (pure: image, light, fog, horizon from the reading and the sun; overcast goes diffuse, not merely dim), `SkyView` (an HDRI skydome of Poly Haven CC0 pure skies from TCS baked to the texture ladder by `scripts/bakeSky.mjs`, two images cross-faded and turned so the baked sun stands at the real one's bearing, driving the scene's sun and sky lights, fog and horizon), `RainView` (v0's rain sheet). The HUD's sky line names the source (`live`/`cached`/`sim`); `?sky=`/`?hour=` are a probe's doors (`probe:sky`); the `weather` layer toggle is real. NOT built: lightning, wind on the grass, wet ground, an environment map (PMREM) — the lights are driven numerically first, to be measured on the phone | `openMeteo.ts`, `stations.ts`, `field.ts`, `blend.ts`, `gameplay.ts`'s bridge (as `toWeatherNow`), `Rain.ts` (as `sky/RainView.ts`), `sky.ts`'s palette and fog rule (as `sky/skyLook.ts`); TCS's `public/sky/*.hdr` as art masters. `WeatherService.ts` was read and reshaped rather than ported: its chain is `LiveWeather`, its cache the persistence store, its clock a hook |
| **6 Vegetation** | **The biome-aware world-object streamer (2026-09-06).** Three questions answered apart: HABITAT (`world/habitat.ts` — the ESA landcover raster, distance to the sea, the coarse survey's height and slope, the drainage; rainfall and soil as typed seams), WORLD GENERATION (`world/objects/populate.ts` — one fixed seed + a 16 m cell + the habitat → a jittered-lattice, patch-clumped, deterministic population with stable ids on trees and rocks and a `WorldDelta` seam), DETAIL (`world/objects/budget.ts` — the rung's radius and per-family caps, maximums not quotas). Drawn by `flora/WorldObjects.ts` as a camera bubble of instanced meshes, thinned by rank against true 3D distance, each object at its family's REST on the ground (foot and normal from the live heightfield, re-posed on its revision: twigs along the slope, rocks and stones on their base and bedded, trees up and buried as the slope needs — Joshua's "basic collision with ground and simple physics for now", 2026-09-06, from his phone) over a clipmap that draws the heightfield at up to an eighth of the HD step so the drawn ground is where the feet are (`terrain/TerrainView.ts`, `SUB_HD_LEVELS`); the `vegetation` layer in the perf world with its own HUD lines and `probe:objects`. NOT built, by the brief: climbing, collision, wind, persistence of deltas (the seam exists; nothing writes it), the far vegetation impostor past the bubble | `stableHash` (as `world/random.ts`), `landcover.ts` (reshaped: a class, bilinear class weights), `kauai-veg.bin` verbatim, `treeMesh` (as `flora/treeGeometry.ts`, plus scrub and palm shapes). `GroundCover` and `trunkSolid` were read and not ported: the first never ran in a shipped scene, the second is Phase 7/8's |
| **6.5 Ecology (pre-player)** | **What lives on the island before the ant does (2026-09-07).** Seven more plant families grown by the same three questions (fern, reed, flower, leaf litter, small shrub, broadleaf, coastal — `world/objects/`), the resource layer derived from them and from the real water (`world/ecology/`: nectar, seed, sap, litter, honeydew hosts, water edges; amounts are capacities, nothing is consumed yet), and three animals — earthworm, aphid, housefly — as data-driven core (`creatures/`: cited sizes by the spine, throttled intent, walk/burrow/fly integrators, deterministic population per cell, far/near/full tiers, caps per rung that are maximums) drawn by `fauna/` from the three rigged-but-unanimated GLBs with procedural motion. Four more layers in the perf world (resources, worms, aphids, flies) with HUD lines and `probe:ecology`. NOT built, by the brief: the Queen, combat, economy, colonies, farming, erosion; the terrain edit itself (the seam is built, the editor is the no-op until the voxel milestone) | the three GLBs verbatim (from TCS, where they were sized against the literature); TCS's `creatureBrain` throttle, `Critter.findLegs`, `WormBody` chain-aiming and `islandWorm` band constants as techniques, re-written; BE's `faunaLogic` shape |
| **6.6 Ocean/land lighting polish** | **The last 5% of the accepted look (2026-09-07).** Joshua: 'Do not make night brighter. Make light matter more. Do not paint a white coastline.' The sea's sheen and foam opacity now follow the scene's own lights (`sea/waterLook.ts`: the fresnel sheen reads the hemisphere sky colour with a gain that keeps clear noon within 1/255; the foam's opacity lift is gated by the lights' luminance, exactly 1 for every daytime sky and ~0 at night; the wash breathes with the crest above a floor). The ground reads wet where the sea and the rain leave it (`terrain/wetness.ts`, a lens on the Lambert colour with a gentle sun glint, two scalars a frame, never a height). The first shadow: the sun light's own, a camera-following box per Detail rung (`sky/shadows.ts`: none below medium, 512² at medium, 1024² at high), terrain receives, bodies cast, blades never; off at night, under cloud and with the weather off. The night dome follows the sun through astronomical night (`skyLook.domeExposureFor`). Rain on the eye (`sky/LensView.ts`, `lensExposure.ts`): a pooled overlay under the HUD, exposure from upward pitch and wind into the lens, reused for surfacing. The underwater crossing blends to the sky's live horizon and dims the air lights with depth (`underwaterLook.light`). `probe:lighting` reproduces the four phone views. | nothing: v0 had no shadows, no lens and no wetness; its terrain material (world-position tiling on Standard) is noted as the way a texture will one day arrive |
| **6.7 The creature finder** | **An instrument for finding animals four orders of magnitude smaller than the island (2026-09-08).** Joshua, from the phone: "I don't see any worms in the game or any of the glb models you added... can you make a simple 3D finder I can turn on to find them better?" Nothing was broken — `probe:ecology` counts forty worms of forty at the Wailua forest — but a 150 mm worm 12 mm under the soil, on a 5,600,000-unit island, is a correct ecology and an empty screen. So: `creatures/finder.ts` (core; nearest sighting by horizontal distance, how deep, and the viewpoint that puts an animal across a quarter of a phone screen — three body lengths, never inside the ground), `fauna/FinderView.ts` (one instanced pin per animal, per-species colour, dimmed and standing on the GROUND over a buried worm, `depthTest: false`, constant `PIN_PIXELS` on screen at any distance), a `finder` switch and a GO button on the stat sheet with an `eco-find` line naming the nearest, `settings.finderOn` so the switch survives the reload a push now causes, and `probe:finder`, which drives the whole thing and counts the pins in the screenshot's pixels. NOT a change to the world: no reach widened, no body grown, no worm held at the surface | nothing; v0 had no such instrument |
| **6.8 Looking at what lives there** | **The two things that stood between the finder and actually seeing an animal (2026-09-08).** Joshua, with the finder on: "I am moving too fast to see them", and the worm "is not digging any dirt and halfway on the surface and ground like it's swimming". So: a `Camera speed` setting — the ceiling a full stick push reaches, 5 / 10 / 30 m/s, floor unchanged at 1 m/s at every rung (`FreeFlyCamera.CAMERA_SPEEDS`, default medium), applied the moment the pause menu closes. And a drawn worm now lies ON the ground: `FaunaView.onGround` clamps every point of the chain's path to the ground under it at DRAW time, which fixes the ones already laid rather than only the next ones. The cause was the seeded trail — a worm gets its rig with no history, so `lend` lays a straight line of crumbs at its own height, and on a slope a quarter of the body is inside the hill for the fifty seconds it takes to crawl a body length out of it. This alpha.26 pass retained the no-op digging seam; alpha.27 adds shared soil below | nothing |
| **6.9 Shared voxel soil** | **First worm validation, alpha.27.** `SparseSoil` records world-addressed capsule cuts on a 1 mm density lattice over the immutable survey. Local worms submit swept bores through the shared edit gate; solo slots persist them. Nearby column meshes replace the coarse surface only when ready. SOIL → Find worm and a 0–24 mm cutaway expose the same tunnels, with slower inspection movement; surface mode restores the ordinary view. Water reads the edited surface and preserves flow when a sealed bore leaves its bed unchanged. `probe:soil` covers touch/PC controls and saved reload. Player DIG/BUILD, ant collision/navigation, full nest planning, cave flooding and multiplayer terrain remain later milestones | TCS island density, persistent deltas and mesh-before-clip as behavior references; clean implementation at TMB’s centimetre scale |
| **6.9 A clock the player can hold** | **The island is dark half the time and that is when he tests (2026-09-08).** Joshua, after alpha.27: "it's dark in the game, I can't really see if it worked or not... I see the arrows still, but didn't see any models". Measured at the Wailua forest: at 04:00 HST the frame is 95.4% near-black pixels, mean luminance 5.3 of 255; at noon, 66.2 and none. Nothing was broken — the finder's pins are unlit BY DESIGN, which is exactly why they were the only thing he could see. So: `solar.heldHourMs(nowMs, hour)` (the one rule for an hour on the island's own day — today's date for the season, no drift), `settings.timeOfDay` (0..24 or null for live), a slider on the stat sheet from midnight to midnight in quarter hours with a LIVE button, and `held` printed beside the clock for as long as it stands still — by the slider or by `?hour=`. Solo only: `holding()` refuses it in a room at the point of use, since settings are applied before the session's mode is known. It moves the sun and through it the ecology (a worm surfaces at night); the weather stays the island's live reading | nothing |
| 7 Player shell | `actor/` composition, `Posture` incl. climbing, camera ownership seam | `locomotion`, `gait`, `pace`, `stamina`, `motion`, `castes`, `FollowCamera` + its boundary test |
| 8 Ground movement → Flight → Surface traversal | one atomic take-off (`launchInto`), integration test for flight↔climb | `flight.ts`, `wings`, `wingbeat`, `climb.ts`, `surfaceGrip.ts`, `waveClearance`, `wading` |
| 9 Autonomy / navigation | Intent producer sibling to input | `missionBrain`, `mission`, `autopilot`, `routePlanner`, `wander`, `lookout` + `DRONE_GCS_AUDIT` |
| 10 Deeper gameplay | combat, colonies, quests, predators | research only |

## 12. Phase 0 — definition of done

- `npm run typecheck`, `npm test`, `npm run build` are green in CI.
- The bare URL boots to the main menu; PLAY → SOLO loads the Performance
  World through the loading screen; a free-fly camera moves; the perf HUD
  shows raw FPS (mean and 95th-percentile low) and sim dt as two
  separate numbers; PAUSE truly stops sim dt in solo; MULTIPLAYER is
  selectable and honestly labelled "not built yet".
- EDITORS opens the hub and lists the Performance World as its first
  tool; SETTINGS persists across reload; ABOUT shows version + commit.
- `tests/simulationCore.test.ts` passes and covers every `core` module.
- `tests/frameClock.test.ts` fails if raw and sim dt are ever the same
  value under a stall (the v0 FPS-floor regression, as a test).
- `scripts/probe-boot.mjs` drives the bare URL through PLAY on a
  932 × 430 viewport and records a screenshot with zero console errors.
- CLAUDE.md describes v1, not v0.
