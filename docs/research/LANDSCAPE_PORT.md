# Landscaping: what Beyond Extinction and Thronemound have, and what TMB builds

The audit Trello card 31 asked for, written 2026-09-01 as the first
landmark trees went in (v0.0.149). Numbers are measured from the
repositories unless marked otherwise. Both other projects were read as
REFERENCE ONLY: TMB is the authority for its own scale, controls,
collision, density, LOD, planner and rules, and nothing below is a port
of a system.

## The five questions, answered in order

### 1. Where does the placement data come from?

**Real, and baked.** Beyond Extinction ships four 384×384 rasters over
the same 56 km square as the height tiles
(`artifacts/beyond-extinction/public/assets/terrain/kauai/veg/`):
`landcover.png` (ESA WorldCover 10 m classes), `canopy.png` (tree canopy
cover 0–255), `river.png` (river-corridor intensity), `water.png`
(binary). One pixel is 146 m. TMB already bakes three of them into
`public/kauai-veg.bin` (`scripts/bakeVeg.py`, 442,380 bytes); the water
mask is derivable from the class and is not baked.

Measured over the square: 54.3% water, 28.9% tree, 14.0% grass, 2.0%
shrub; mean canopy over land 167/255. Two spawn regions, by their own
coordinates: Wailua Forest reads TREE with canopy above 0.8, Kōloa
Fields reads GRASS. `tests/landcover.test.ts` pins all of that against
the real file.

BE's `KauaiTrees.ts` uses exactly these planes as intended by the
raster README: class picks tree vs shrub vs open, canopy sets density,
water and river masks exclude. That is the same win `hydro.json` was,
and the same reason TMB places from the raster rather than inventing a
distribution.

**What was wrong in TMB.** `src/world/landcover.ts` carried the magic
number typed as the four letters in file order; a little-endian read
returns them reversed, so `decodeVeg` threw on the real file from the
day it was written. Nothing noticed because nothing called `loadVeg` —
the ground-cover scatter was never instantiated by the shipped scene.
Fixed in v0.0.149; the constant is now derived from the bytes.

### 2. Is anything sized around BE's mesh?

Yes, and none of it transfers. BE's Kauaʻi forest is streamed in
300 m cells with candidate sites 8.2 m apart, built within 1,050 m of
the player, kept to 2,600 m, drawn to 900 m with a dithered fade, at
most two cells built per frame (`KauaiTrees.ts` constants). Its species
table is in metres for a human eye (palm 13 m, conifer 14 m, a 2.6 m
understory bush). Its "other map" forest (`islandBillboardTrees.ts`,
`islandTrees.ts`, `islandFoliage.ts`) is sized in a fictional island's
units with `1 m = 6.4/1.8` world units and elevation bands as fractions
of a `HEIGHT_SCALE`. None of those numbers mean anything at 1 unit =
1 cm, and TMB takes none of them.

### 3. Billboards

BE draws its Kauaʻi trees as one camera-facing photo quad each, a
stand per InstancedMesh, billboarded and wind-swayed in the vertex
shader. From standing height that is the right call and it is why BE
runs on a phone. From a centimetre off the ground it is a painted flat:
a queen flies UNDER the lowest bough and PAST the trunk at a few
metres, and a quad seen from below is a strip turning to face her.

So TMB's near tier is geometry BE never had to build. What it is NOT is
Thronemound's tree: TCS's `tree.ts` is a climbable landmark at 1:1000
with a 64-sided near level, six photographed barks with normal maps and
a collision profile skinned from the same skeleton — a tree she stands
on. TMB's queen never touches one, so TMB's `treeMesh.ts` keeps TCS's
IDEAS (limbs, chains skinned as one tube, the polygon circumscribing
the limb's circle, boughs in a golden spiral, both levels tessellating
the same wood) and drops everything that served climbing: two levels
of 12 and 6 sides, flat vertex colour, no textures, no twigs, no solid.
Measured: 1,736 triangles near, 344 far.

Impostors are the right tool PAST the honest ground — beyond 200 m,
where the terrain itself is drawn at 31 m steps — and that is Stage 3.

### 4. Scale

Position is ×100 (BE metres to TMB centimetres) and a tree is the same
tree. What changes meaning:

| | BE (human camera) | TMB (a 1 cm queen, flying) |
| --- | --- | --- |
| A 26 m tree | 26 units on the fictional map, 26 m on Kauaʻi | 2,600 units |
| Draw distance | 900 m, dithered | 200 m (`TRANSITION_REACH`), where the ground stops being honest |
| Instances in view | thousands of quads | about 160 in full jungle within 200 m, two draw calls |
| What it is for | scenery | a hazard the route planner goes round |
| Density | ESA canopy × 1.45, sites 8.2 m apart | one per 20.48 m lattice cell at canopy × 0.6 — about one per 780 m² in jungle |

The density is deliberately far below Kauaʻi's real stem density. This
tier is the trunks she steers round and the landmarks she navigates by,
not the forest; the tiers that make the island READ as wooded (bush,
sapling, canopy) are the LOD card's Stage 3 and are gated on Joshua's
go. Thronemound's `forest.ts` made the same split on the same
measurement: "the giants CANNOT be the forest".

### 5. The relief dial and the floating origin

Both apply exactly as they do to the ground cover. Trees are placed in
WORLD coordinates from a lattice cell (`lm:cx,cz`) and drawn relative
to the corner of the cell she is in, re-seated with `toLocal` on every
rebase — no local position is ever stored. Their feet are read from
`groundHeight` at fill time and re-read when the relief dial moves or
an HD tile lands (chained inside the scene's existing `onHdTile`
callback, which is a single slot). Nothing writes the terrain.

## What TMB already had, what is reused as an idea, what is new

**Already in TMB, used as-is:** the baked rasters and `coverAt`; the
hazard type and its has-a-top split (`hazards.ts`); the route planner
with its 160-vertex bound; the scene's hazard list and the probe doors
`addHazard`/`routePlan`; the ground cover's stable integer hash (now
shared as `stableHash.ts`); chunk-global addressing and `toLocal`;
`groundHeight`, `isLandWatercourse`, the slope idiom from `spawn.ts`;
the terrain's tier reaches.

**Reused as ideas, from reference:** BE — placement from the three
raster planes, keep-out of rivers and water, per-cell instanced stands.
TCS — the jittered grid (one plant per cell, thrown inside it, squared
height draw), the limb skeleton and its skinning rules, landmarks
before forest.

**Written for TMB:** `landmarks.ts` (placement in centimetres, the
corridor walk that shows the planner at most eight trunks per leg and
counts the rest), `treeMesh.ts` (two-level vertex-coloured bake),
`LandmarkStand.ts` (two instanced meshes following her by lattice
cell), the planner's per-leg `HazardSource`, and the probe.

**Not done, on purpose:** collision — she passes through a trunk under
manual control, because nothing in TMB stops her flying through
anything yet (`MASTERROADMAP.md` §7.5 parks stun and bounce until
surfaces exist). The hazard list `{id, at, radius}` is the input a
future trunk check would read. The map draws the bent route but not
the trees. Trees past the eight-per-leg cap can be crossed, and the
readout marks the leg when that happened. Inland lakes are invisible
to a 146 m raster. Bush/sapling/canopy tiers, impostors past 200 m,
and turning the ground cover on are Stage 3.

## Sequencing

Card 31 said "after water", because BE had a keep-trees-out-of-rivers
rule and anything scattered has to know where the rivers are before it
is placed. TMB's channels are baked island-wide at boot
(`bakeIslandChannels`) and the placement asks `isLandWatercourse`, so
the order is satisfied; the raster's own river-corridor plane is the
second, coarser guard.
