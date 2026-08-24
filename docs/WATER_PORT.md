# Porting Beyond Extinction's water

**Status:** the shared-frame bridge is active on the Beyond island foundation branch. The ant game now validates imported hydrography against the shared origin-centred Kauaʻi frame and expresses Beyond's river draw distances through one explicit metres-to-centimetres boundary. The remaining rendering work stays deliberately staged.
**Verdict:** agree — port and adapt, do not rebuild. The hydrography alone is
worth it, and four of the five adaptations are mechanical. The fifth is not,
and is the reason this document exists.

Everything below was checked against the two repositories rather than taken
on trust. Where the incoming analysis was right it says so; where it was
incomplete, the gaps are in §3 and they are the parts that will bite.

---

## 1. What was verified

**Same island, same frame, same centre.** `scripts/bakeKauai.py` reads BE's
own `A1`…`H8` Terrarium tiles — 8×8, A1 north-west, columns west→east, rows
north→south. TMB's `heightAt` indexes with `(x + SPAN/2) / STEP`, so world
x/z run **−2,800,000 … +2,800,000**, centred at zero; BE's `HALF_WORLD` is
28,000 with the same centring. The origins coincide. That matters more than
it sounds: had TMB's grid been corner-addressed, every river would have
landed 28 km out to sea, and the conversion would still have "looked right".

**The unit conversion really is a single multiply.**

| | BE | TMB |
|---|---|---|
| 1 world unit | 1 m | 1 cm |
| 56 km island | 56,000 | 5,600,000 |
| conversion | — | **× 100, horizontal and vertical alike** |

**The hydrography is real and it is good.** `hydro.json`, 2.2 MB, USGS
NHDPlus HR, baked to world metres:

| | |
|---|---|
| river polylines | **1,121** (140 reaching the ocean, 264 named) |
| centreline points | **49,665**, as `[x, elevation, z, width]` |
| widths | min 2.5 m · **median 5.5 m** · max 36.2 m |
| lakes | **111**, each with a baked waterline `y`, a ring and holes |
| extent | x −25,195…25,108, z −18,793…19,413 — inside the island |
| elevations | 0 … 1,547 m |

We are not rediscovering where Kauaʻi's rivers are. That is the whole
argument for porting, and it holds.

**The 96 m channel really is a rendering hack, and its own code says so.**
`kauaiCarveCore.ts` floors the carve radius at 48 m and explains why: BE's
mesh samples every 36.5 m, so a narrower trench "falls between vertices and
mutes to nothing". Quantified against the data above, that floor is **17×
the median river**. Ported blind into TMB it would draw a 5.5 m stream
9,600 units wide. Do not port it.

## 2. What ports cleanly

The hydrography itself; river connectivity and ordering; baked widths; lake
rings, holes and waterlines; the spline smoothing; riverbed material
selection; the ocean's sum-of-sines swell (deliberately written so CPU
buoyancy and the vertex shader evaluate the *same* function — that
discipline is worth keeping verbatim); coast masking; depth-based colour and
Fresnel; the `waterLevelAt(x, z)` idea of water as a queryable surface
rather than a decal; and every hard-won lesson about seams, z-fighting and
floating plates.

## 3. What does NOT port, and why

These are the parts the incoming analysis did not cover. They are the work.

### 3a. TMB cannot carve a river into terrain more than ~20 m away

**This is the big one.** BE had one terrain resolution: 36.5 m, everywhere.
TMB has four, and they are nothing like each other:

| tier | units per vertex | reaches |
|---|---|---|
| fine cells | **8** (8 cm) | ~15 m |
| coarse cells | 32 | ~20 m |
| transition | **312.5** | 200 m |
| middle | 3,125 | 2 km |
| backdrop | 43,750 | the island |

Close in, TMB is **456× finer than BE** — a median 5.5 m river is 550 units
across, sixty-nine vertices in the fine tier. We can carve a real channel at
its real width, which BE never could.

Twenty metres out, that collapses. The transition tier's vertices are 312.5
units apart, so a 550-unit river spans **less than two of them**; by the
middle tier it is a fifth of one. A carve there does not narrow gracefully,
it disappears — which is precisely the "floating plates" failure BE
documented, arriving one tier further out instead of everywhere.

So the architecture has to be two things at once:

- **Near (inside the cell tiers):** carve the channel, walk down into it,
  fill it with water. A real trench.
- **Far:** a river ribbon laid on the terrain surface. No carve, no trench,
  purely visual — and it must not z-fight the ground it lies on.

**The handover between them is the hard problem of this port**, and BE
solves nothing here because BE never had it. Budget for it accordingly.

### 3b. The carve must be a function, never baked into the grid

BE bakes into tile heights (`carveTileHeights`). TMB must not, and cannot:
the height grid is 1025² over 5,600,000 units — **5,463 units (54.6 m) per
sample**. A 5.5 m river cannot be written into a 54.6 m grid at all.

The carve belongs inside `terrainHeight()` in `heightfield.ts`, evaluated at
query time. That is not a workaround, it is the better design: it is the one
function that feeds the mesh builder, `groundHeight`, the camera's floor
clamp and the flight telemetry's terrain sampling, so all four agree about
the riverbed automatically instead of by four separate arrangements.

The cost is that it is now on a hot path. `terrainHeight` is called per
vertex on every cell rebuild, on every ground query, and up to ~190 times a
frame by the touchdown solver. **49,665 centreline points need a spatial
index** — a uniform grid over the island, bucketed by chunk, resolved to the
few segments that can possibly be within a carve radius. Measure it before
believing it; add it to `probe:lod`.

### 3c. The relief dial multiplies the ground and will not multiply the water

`groundHeight` returns `relief * height`, where `relief` is a live setting.
Sea level survives that untouched (`relief × 0 = 0`), which is why the
current ocean plane has never noticed. **Lake waterlines and river surfaces
will not.** A lake baked at 27.8 m is 2,780 units at 1× and 5,560 at 2×, and
if the water does not scale with the valley it sits in, it floats above the
island or vanishes inside it the moment the dial moves.

Every water elevation goes through the same multiplier, at one named place.

### 3d. `KauaiWaterSim` is a lab pilot, not a shipped system

Its own header says so: *"this is the WaterLab pilot… the island-scale
version bakes an offline steady state"*. It is a 256² virtual-pipes
shallow-water sim at 10 m a cell, living in `WaterLabScene`. Inherit the
idea and the reading it came from; do not schedule it as though it were
proven in the field.

It also sits awkwardly with §3b: a shallow-water sim wants a **mutable bed**
it can own, and TMB's bed is a pure function. If we ever want it, it runs on
its own patch grid and reports back, rather than editing the island.

### 3f. Lakes DO need the carve — the island has no room for them

Phase 3 was specified as "no carve needed, they already sit in basins".
They do not, and the measurement is not close:

| | |
|---|---|
| median lake width | **130 m** |
| height-grid sample spacing | **55 m** |
| lakes whose terrain sits ABOVE their own waterline | **72 of 111** |

A lake two or three samples across has no basin in a grid this coarse —
the hollow is averaged flat, and the waterline ends up buried in a
hillside by a median of eighty centimetres. Drawn as flat polygons at
their stated level, most of the hundred and eleven would be underground.

**The good news is that lakes are the easy half of the carve.** A river
is 5.5 m across and cannot survive the transition tier's 312.5-unit
vertex spacing (§3a); a lake is 130 m across and gets forty vertices
there. The tier-handover problem that makes rivers hard simply does not
arise, so the lake carve is a clean first outing for the machinery
rivers will reuse: the spatial index, the point-in-polygon test, and
the rule that a carve is a function inside `terrainHeight` (§3b) rather
than a bake.

Two things the lake carve settled that rivers will inherit:

- **The floor is absolute, never relative.** A cut of "two metres below
  the existing ground" digs a trench in a hilltop and leaves the lake
  still buried in it. The bed is set to `waterline − depth` and taken as
  a MINIMUM against the existing ground, so a carve can only ever lower
  the island. There is a test that walks a grid over every lake to say
  so.
- **The cost is real but small.** 200,000 `terrainHeight` calls went
  from 52 ms to 75 ms with the lakes indexed — and the index is what
  keeps it to that, because the answer for almost every point on the
  island is "no lake here" and has to be one array read.

### 3e. Ship the hydrography as a binary, not as JSON

2.2 MB of JSON would roughly double the download and lands on a loading
screen that already reports honest bytes and an ETA. 49,665 points as packed
integers — x/z as int32 centimetres, width and elevation as int16 — is
around **400 KB**. `kauai-1025.bin` already sets the pattern, `LoadPlan`
already has the job slot, and `fetchBytes` already reports progress.

*(While in there: `bakeKauai.py`'s docstring still describes a 1:1000 world
where "one real metre is one in-world millimetre". That era is over — one
unit is a centimetre. The output is unaffected; the comment lies.)*

## 4. The floating-origin law, from day one

Non-negotiable, and the reason the ground texture stopped tearing:

```
hydro database        →  GLOBAL TMB coordinates, float64
water logic, queries  →  GLOBAL, float64
toLocal()             →  the one conversion
rendered river/lake   →  small local coordinates
```

River ribbons are long, thin and axis-aligned to nothing — exactly the shape
that shows quantisation as a visible kink. No water geometry is built in
world coordinates. No exceptions.

## 5. Ant gameplay is a new layer, not a ported one

Keep the interface — `waterLevelAt`, depth, flow direction, surface,
river/lake/ocean classification. Throw away BE's human numbers: a 1.3 m
swim depth is 130 body lengths for a queen.

The thresholds want designing against real ant biology, not scaled-down
human ones. Ants are largely unwettable and ride surface tension, so a
queen's first encounter with a puddle is not wading — it is **being held on
the meniscus**, which is a different mechanic and a better one. That
research goes on the card, not here.

**The survival invariant applies:** a bar may only move if there is a way to
move it back. Drowning must not become a live drain until getting out
exists. Thirst already exists as a stat, so **drinking is the natural first
gameplay use of water** — and it is small, testable, and gives the whole
system a reason to exist before anything can kill her.

## 6. Phasing

1. **Bake and load** the hydrography to binary in TMB units. Prove it lands
   on the right island: overlay the polylines on the spawn map and look.
2. **Ocean upgrade** — swell, coast mask, depth colour, Fresnel, and a
   `seaHeightAt(x, z, t)` that the CPU and the shader share. Self-contained,
   visible immediately, and it touches nothing else.
3. **Lakes** — carved basins and drawn surfaces. The original line here
   said "111 static polygons at baked waterlines, no carve needed, they
   already sit in basins". They do not; see §3f. Lakes turned out to be
   the right place to build the carve machinery rivers will reuse.
4. **River ribbons** — DONE (v0.47.0). All 1,121 reaches, streamed
   within the middle tier's reach, centripetal Catmull-Rom over
   [x, y, z, width] with the levelling re-imposed after the spline, flat
   +Y normals and the NEGATIVE polygon offset — all three ported BE
   lessons. Elevations forced monotonic downstream at load.
5. **River carve** — DONE (v0.47.0), resolution-gated: `terrainHeight`
   carries the trench (channel at true width, depth 0.12×width clamped
   0.3–2.5 m, bank grade 0.8); `farHeight` — used by the distance tiers
   through `dryLand` — does not, because 312.5-unit vertices cannot hold
   a 550-unit channel. Segment bucket index over 48,544 segments:
   +55 % on `terrainHeight` for random points (~0.5 µs absolute).
6. **Water queries** — DONE (v0.47.0). `waterBodyAt` answers sea, lake
   or river with level and flow; compared in the DRAWN frame (the
   review caught the raw-vs-sea mix), returned raw.
7. **Drinking** — DONE (v0.47.0): thirst drains (~30 min, zeroed for
   the claustral founding state by the caste table) and a held
   contextual DRINK refills in 5 s at any water's edge. **Currents** —
   DONE: rivers carry her at √slope-shaped speed (0.1–1.5 m/s),
   grip-scaled by her own draft. Wading is the grip model itself.
   STILL AHEAD: the meniscus (surface tension is the dominant force at
   her scale), drowning (needs a way back out first), swimming.

Landscaping is a separate audit (`KauaiTrees.ts`, `islandTrees.ts`,
`islandBillboardTrees.ts`, `islandFoliage.ts`, `BerryBushes.ts` all exist in
the same BE engine) and should follow the same shape: verify first, then
port what fits.
