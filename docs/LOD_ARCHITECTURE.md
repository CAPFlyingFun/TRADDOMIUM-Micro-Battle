# The Master LOD / Distance Architecture

Approved by Joshua, 2026-08-29 (chat), as "Option B": one authoritative
player-centred distance core with many category consumers. This
document is the design of record; `src/world/lod.ts` is the code of
record. If they disagree, flag it and follow the newer decision.

## The one rule

**There is ONE answer to "how far is this from the player", and it is
TRUE 3D EUCLIDEAN DISTANCE from the Queen** — `√(dx² + dy² + dz²)`,
all three axes, in world coordinates. A queen 166 m above the beach is
166 m from that beach's foam and grass, not 0 m because her shadow
touches it. No system may invent its own `myRenderDistance` again.

Think of the player at the centre of a series of 3D spheres. The
master core (`lod.ts`) owns the spheres; consumers own what happens
inside each shell.

## What the core owns — and refuses to own

Owns: the anchor (Queen's 3D world position + smoothed speed), true 3D
distance, the Detail dial and its radius, the micro feather, category
profiles, tier evaluation with hysteresis.

Refuses: meshes, materials, textures, scheduling, networking. The core
imports no renderer. Consumers decide what a tier *means*. The shader
bridge (terrainMaterial's uniforms), debug tooling, and any future
entity scheduler are separate files that read from the core — growing
them into `lod.ts` is how a core becomes a god-object.

## The three classes

- **MICRO** — expensive ant-scale detail, hard-bounded by the Detail
  sphere: fine terrain relief/normals, fine terrain material, foam
  fizz/lace, tiny surface effects, small grass/litter detail. Gated by
  `detailFraction()`: full inside 0.7R, feathered, GONE at R. At 200%
  (R = 20 m): full to 14 m, fading 14–20 m, nothing past 20 m.
- **MACRO** — visible beyond the sphere in cheaper forms: trees, large
  rocks, nests, insects, NPC ants, other players, landmarks. Each owns
  a tier ladder (`tierAt`) that may reach kilometres.
- **COVERAGE** — "what part of the world must exist": terrain geometry
  tiers, HD elevation tiles, ocean sheet windows. These legitimately
  stay PLANAR, because the ground under a high-flying queen must exist
  to be landed on however far away it is. They register with the core
  for the debug view; they are not asked to go spherical. **Do not
  convert planar streaming to spherical for architectural purity.**

## Detail distance vs. world coverage

The distinction above is load-bearing. If the Queen is 166 m directly
above the beach: foam detail, grass and micro relief consider
themselves ~166 m away (MICRO — gone); but the terrain beneath her
still exists, landing terrain stays valid, and required ocean coverage
stays present (COVERAGE — planar, untouched).

## Two gates, lesser wins

**The master radius says what detail the player has earned. The
screen-space texel safeguards say what the pixel can physically
resolve. Whichever wants LESS detail wins.** Distance LOD never
replaces the texel-footprint safeguards (terrainMaterial's fades, the
foam's texel knees) — distance without them smears grazing angles;
they without distance let altitude redefine the dial (the v0.0.9x
lesson).

## Simulation and network are separate axes

The core answers distance and render tier. **Simulation rate** is a
per-category mapping the sim owns. **Network relevance** gets its own
profile with a hard floor: a player, nest or colony never stops
existing or updating position at a low rate merely because its model
stopped rendering. One distance, three policies.

## Floating origin

All core math runs in world coordinates (float64 — precision is free;
see `origin.ts`). The anchor carries `wy`, which the planar
`WorldPoint` deliberately lacks; her rendered y IS her world y because
the origin rebases in x/z only. Only the shader bridge converts to
render space, once a frame. Distances are origin-invariant by
construction, and `tests/lod.test.ts` pins it.

## Hysteresis and cadence

Discrete tier boundaries latch: coarser the moment a boundary is
crossed (detail never overstays its budget); finer again only past the
boundary minus a margin (8% with a half-metre floor), so an object at
exactly 20 m cannot flicker. Continuous per-pixel feathers need no
hysteresis. When populations arrive, entities evaluate in staggered
buckets by tier under a per-frame budget — squared distances in loops,
transitions notified only on change, no allocation in hot paths.

**Speed-aware margins:** the anchor exposes smoothed speed and
`leadDistance(seconds)` = speed × latency. Streaming and preloading
consumers lead their windows by it (and may bias along velocity), so
Auto-Ant ×10 travel (~7 m/s) cannot outrun a load.

## The staged plan

- **Stage 0** ✅ — core module + tests, dial ownership moved, zero
  intended visual change (this stage; frames must be bit-identical).
- **Stage 1** ✅ — debug/inspection: the compass's LOD line (under the
  fix toggle), `__island.lod()` / `lodAt` / `lodForce` / `lodForceTier`
  probe hooks (`lodProbe.ts`), dev force pins in the core, coverage
  systems described in the registry.
- **Stage 2** — foam as first MICRO consumer. Acceptance includes
  PERFORMANCE: outside the sphere the expensive foam texture work is
  actually skipped where safely possible, not computed and multiplied
  by zero. At ~166 m AGL: no lace, no fizz, no tiny whitecaps, no
  detailed swash grain — a large simple surf indication may remain as
  macro water look. **STOP for Joshua's visual verification after
  Stage 2, before any bathymetry/ring work.**
- **Stage 3** — ground cover fade goes 3D.
- **Later** — entity tracker with the first real population; coverage
  systems register constants; multiplayer relevance profiles.

Standing process rule: if a stage reveals the architecture doesn't
work as expected, or needs scope in another protected system, STOP AND
ASK before changing scope or pushing an incomplete acceptance result.
