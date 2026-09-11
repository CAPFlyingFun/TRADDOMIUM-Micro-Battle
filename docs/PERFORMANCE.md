# Measured performance baselines

Numbers measured on Joshua's phone, from the Creature Lab's stress test
(`src/lab/stressTest.ts`, STRESS on the bench). Each baseline is a run of
the same seeded test: one random creature a second into the one-metre
room through the normal systems, the count recorded as the five-second
rolling average falls through 45 / 30 / 20 / 10 fps.

**This file records what was MEASURED and what follows from it
arithmetically. It is not a plan.** Priorities and the work that comes
out of these numbers live on Trello. A baseline is never edited once
recorded — a re-measurement is a new baseline with a new letter, because
the point of keeping them is to see what a change did.

A baseline is only comparable to another at the SAME build, viewport,
detail rung and rig mode. The report prints all of those in its
CONDITIONS block for exactly that reason; if two runs disagree there,
they are two different experiments.

---

## Baseline A — Full Rig / No Creature Collision

The project's first real creature-density measurement, and the reference
every optimisation is measured against.

| | |
|---|---|
| **Date** | 2026-09-10T20:04:15Z |
| **Build** | `1.0.0-alpha.41` · `03842e4` |
| **Device** | Joshua's phone, landscape |
| **Viewport** | 810 × 374 css px |
| **Rigs** | ALL — one animated skeleton per creature |
| **Detail rung** | medium |
| **Predation** | OFF |
| **Camera** | free, the bench viewpoint, observer |
| **Spawn rate** | 1 creature/s, seeded |
| **Creature–creature collision** | none (no such system exists) |

### What it measured

| | |
|---|---|
| **Sustained at 30+ fps** | **52 creatures** |
| Total placed | 178 |
| Duration | 193.1 s |
| Average FPS | 26.3 |
| Average frame time | 38.1 ms |
| Lowest FPS (5 s average) | 9.7 |
| Worst single frame | 143 ms |
| Final FPS | 9.7 |
| FPS after the 10 s hold | 9.7 |
| Ending | held under 10 fps for 5 s — a real breaking point |

By species: queen 44, aphid 38, worker 33, earthworm 32, housefly 31.

| threshold | creatures | at |
|---|---|---|
| below 45 fps | 48 | 52 s |
| below 30 fps | 52 | 56 s |
| below 20 fps | 71 | 75 s |
| below 10 fps | 167 | 172 s |

### What follows from it

**The marginal cost of one full-rig creature is 0.52 ms of frame time.**

| leg | Δcreatures | Δframe time | ms per creature | Δt |
|---|---|---|---|---|
| 45 → 30 | 4 | 11.11 ms | 2.78 | **4 s** |
| 30 → 20 | 19 | 16.67 ms | 0.88 | 19 s |
| 20 → 10 | 96 | 50.00 ms | **0.52** | 97 s |

Only the last leg is a trustworthy slope. The 45 and 30 crossings are
**four seconds apart — less than one five-second window**, so they are
two points on the same ramp as the average fills, not two independent
measurements. The 2.78 ms/creature that falls out of them is an artifact
of the window and must not be quoted as a cost. (This is the same
property the module's own tests pin: a cliff in the instantaneous rate is
a ramp in the five-second average.)

Fitting the trustworthy leg gives

```
frame time (ms) = 13.0 + 0.521 × creatures
```

which reproduces both of its endpoints exactly, and says the empty bench
costs about **13 ms** — roughly 77 fps if the phone were not capped at
60.

**The phone beats that line below about 70 creatures.** It predicts 24.9
fps at 52 where 30 was measured, and 26.3 fps at 48 where 45 was
measured. So there is real slack in the frame under ~70 creatures — work
overlapping rather than queueing — and the line describes the *loaded*
regime only. Read 52 as the measured 30 fps ceiling, not 39.

**230 full-rig creatures is out by a factor of four.** The line puts
230 at 133 ms, or 7.5 fps. Joshua's multiplayer target of 10 players ×
(20 ants + 3 companions) cannot be met with a skeleton apiece on this
phone, and no plausible tuning of the rigs closes a 4× gap. The target
has to be met by drawing most of the crowd as something cheaper — which
is what Baseline B is for.

### What Baseline A does NOT measure

- **Creature–creature collision or avoidance.** No such system exists in
  `creatures/`. Every number here is AI, senses, movement, terrain
  contact and drawing, with bodies free to overlap.
- **Which half of the machine the time went to.** The run predates the
  report's `WHERE THE FRAME WENT` block, so the split between the
  simulation tick and the creature renderer is unknown for this run. It
  is the first thing Baseline B answers.
- **The rig pool's growth cost.** At RIGS: ALL the Lab lends a new
  skeleton every time a creature lands, which clones a template once a
  second. The 143 ms worst frame is very likely one of those clones. It
  is about 0.02% of a five-second window at these rates, so it does not
  move the thresholds — but it should disappear at RIGS: RUNG, where the
  pools are fixed, and if the worst frame does *not* fall there, the
  cloning was not the cause and something else is hitching.

---

## Baseline B — Rung Rigs / Impostors

The run that settled the design question. Same room, same seed, same
spawn rate, same viewport as A; RIGS: RUNG instead of ALL.

| | |
|---|---|
| **Date** | 2026-09-10T21:16:23Z |
| **Build** | `1.0.0-alpha.42` · `1f320dd` |
| **Viewport** | 810 × 374 css px |
| **Rigs** | RUNG (medium) — 13 skeletons, the rest impostors |
| **Predation** | **NORMAL** — ⚠️ differs from A, see the caveat |
| **Spawn rate** | 1 creature/s, seeded |

### What it measured

| | |
|---|---|
| **Sustained at 30+ fps** | **400 creatures — and never fell below 30** |
| Total placed | 400 |
| Duration | 415.0 s |
| Average FPS | 60.1 |
| Average frame time | 16.6 ms |
| Lowest FPS (5 s average) | 59.5 |
| Worst single frame | 49 ms |
| FPS after the 10 s hold | 60.1 |
| Ending | the run's own 400 ceiling — **NOT a breaking point** |

Drawn at the end: 13 full rigs, 332 impostors, **55 not drawn**. By
species: aphid 96, queen 89, worker 79, earthworm 75, housefly 61.

### The 55

Not frustum culling — `FaunaView` does none in this path. They are
**earthworms underground**. `FaunaView.drawn()` refuses to draw a
burrower deeper than `BURROW_HIDE` (0.3) body-lengths below the ground
with no cutaway open, and of the five species only the earthworm has a
non-null `burrow` spec. 75 worms were placed; about 55 were deep at the
end. Correct behaviour that was invisible in the numbers, which is why
alpha.43 makes the report account for every creature.

### What follows from it

**The cost is the skeletons, and nothing else is close.** Baseline A
broke at 178 creatures carrying 178 skeletons. Baseline B carried 400 at
a locked 60 fps with 13. Every other variable was the same.

That answers the fork Baseline B existed to decide, and it answers it at
the top of the table rather than the bottom: **the impostor ladder is the
answer to the multiplayer target.** 230 nearby creatures is not merely
reachable — B passed 230 without the frame rate moving, and Joshua's own
screenshot at 339 creatures reads 60.1 fps.

**Where B's real limit is remains unknown.** Nothing degraded: the lowest
five-second average across the whole run was 59.5 fps, and the run
stopped because the test's own 400-creature ceiling stopped it. The
phone was never loaded. Alpha.43 removes that ceiling and ramps the
spawn rate so a run can reach whatever the actual limit is.

### Two caveats that limit what B may be compared against

**1. Predation was NORMAL, where A's was OFF.** `startStress()` sets it
off at the start of every run, but the PREDATION button was not refused
mid-run, and `conditions()` was evaluated when the REPORT was written
rather than when the run began — so a tap during the run rewrote the
record silently. This does not invalidate B; predation on is strictly
*more* AI work, so 400-at-60 was achieved against a harder test than A's.
But it means A and B are not matched on that axis, and it is a flaw in
the instrument rather than in the run. Alpha.43 refuses the room-holding
toggles mid-run and snapshots the conditions at the START.

**2. `creature drawing` in the frame split is CPU only, and the label
oversold it.** That number is the scene's stopwatch around
`FaunaView.update()` — posing rigs and filling impostor matrices. The GPU
cost of actually rendering skinned meshes happens later, inside the
render call, and therefore lands in `everything else` along with the
terrain, the sky and the wait for vsync. So B's "0.8 ms of creature
drawing" means 0.8 ms of CPU creature work, NOT that 345 bodies cost
0.8 ms to put on screen. Reading it the other way would badly
underestimate what a rig costs. Alpha.43 relabels it.

With that understood, the useful reading of B's split is: at 400
creatures the CPU spends 0.8 ms updating them and 0.5 ms simulating them,
against a 16.6 ms frame that is mostly waiting for vsync. Neither the
simulation nor the creature update is anywhere near being the limit. At the medium rung the pools are earthworm 2, aphid 5, housefly
4, queen 1, worker 1 — **13 animated skeletons**, and everything past
them is a twenty-triangle impostor.

The measurement that matters is the marginal cost per creature past those
13. Call it *sim + impostor*; Baseline A's 0.52 ms is *sim + rig*. The
difference between them is what demoting one creature to an impostor
actually saves.

What the answer implies, at 30 fps (33.3 ms) with 13.0 ms of bench and
6.8 ms of rung rigs:

| if sim + impostor is | the crowd at 30 fps is |
|---|---|
| 0.03 ms | ~464 |
| 0.05 ms | ~284 |
| 0.10 ms | ~148 |
| 0.20 ms | ~81 |
| 0.30 ms | ~58 |
| 0.52 ms | ~39 — *worse than Baseline A* |

**The fork this decides.** If B lands near the top of that table, the
cost is the skeletons and the impostor ladder is the answer to the
multiplayer target. If B lands near the bottom — barely better than A's
52 — then the cost is the SIMULATION, not the drawing, and no amount of
impostor work will help: the AI and sensing tick is where the budget has
to be found instead. The report's `WHERE THE FRAME WENT` block answers
this directly rather than by algebra.

## Baseline D — the actual ceiling *(pending: alpha.43, ramped, no ceiling)*

B never loaded the phone, so the number everyone wants is still unknown.
Alpha.43 ramps the spawn rate — 1/s for the first ten seconds of
spawning, 2/s for the next ten, 3/s for the next, and so on (Joshua,
2026-09-10) — and raises the run's ceiling from 400 to 10,000, so a run
ends on the under-10-fps rule rather than on a guard.

The ramp costs precision and the report says so: at rate *N* the
five-second window sees 5*N* arrivals, so a threshold's creature count is
only good to about ±5*N*. At 40/s that is ±200. Each crossing prints the
rate in force.

Cumulative creatures after *k* ten-second brackets is 5*k*(*k*+1) — so
about 210 by 60 s and 550 by 100 s, against the 400 seconds B took to
reach 400.

## Baseline C — species alone *(pending: five runs, one species each)*

Same room, same spawn rate, one species at a time, to find which creature
is the expensive one.

Two of the five are worth calling out in advance:

- **Worms are the control.** `FaunaView` hides a burrower by its depth,
  so a worms-only run draws almost nothing while simulating everything.
  Its slope is close to the pure simulation cost per creature — the `s`
  that both other baselines are carrying invisibly. This is the most
  informative of the five, not the least.
- **Aphids should be the worst at RIGS: ALL.** The aphid rig is 30,947
  triangles against the fly's 25,635 and the worm's 3,144
  (`fauna/FaunaView.POOL_SIZES`). If triangle count dominates, the aphid
  run breaks first by a wide margin; if it does not, the cost is not in
  the geometry.

A cheap species may reach the run's 400-creature ceiling before it ever
falls under 10 fps. That ends the run with `ceiling — NOT a breaking
point`, which is an answer ("more than 400"), not a failure.

---

## The LOD ladder (alpha.44) — what changed under every baseline after B

Baselines A and B were measured with TWO representations: a full rig or
an impostor. Alpha.44 puts a third between them, so **no baseline before
it is comparable to one after it** on anything but the totals.

| | radius | what it costs |
|---|---|---|
| LOD0 | inside 0.45 m | full rig, animated every frame |
| LOD1 | out to 0.85 m | the real mesh, re-posed 4×/s instead of 60×/s |
| LOD2 | beyond | the 20-triangle impostor |

The middle tier's budget is `REDUCED_PER_FULL` = 2 × the full budget,
and that number is **a guess until the bench replaces it**. A frozen rig
still costs its draw call and its skinned geometry on the GPU and saves
only the per-frame CPU posing, so it is cheaper than a full rig and not
free. Nothing has measured how much cheaper.

The pools grew to hold both tiers: 117 clones at medium against 11, and
**22.7 ms of load time against 1.7 ms** (measured in
`tests/faunaView.test.ts`, printed on every run). A one-time cost.

### The Lab's own geometry — closed (alpha.45)

The LOD centre is the viewer, and the bench viewpoint used to stand
**1.00 m** from the centre of a 1 m room. So of that room's floor:

| viewpoint | to middle | framed | inside 0.45 m | inside 0.85 m |
|---|---|---|---|---|
| ~~(62, +48, 62)~~ *was* | 1.00 m | 96.5% | **0.0%** | 23.3% |
| (45, +38, 45) | 0.74 m | 87.8% | 7.2% | 53.3% |
| (40, +34, 40) | 0.66 m | 84.2% | 13.6% | 64.2% |
| **(34, +28, 34)** *now* | 0.56 m | 77.0% | **23.2%** | **78.7%** |
| (30, +24, 30) | 0.49 m | 69.3% | 29.9% | 87.9% |

Framing is the frustum test against the real lens — 60° vertical at
932 × 430, so 103° across — not an estimate. Both columns are computed
over a 400 × 400 lattice of the floor.

Not one square centimetre of the bench was inside LOD0 from where the
observer stood. **That is the rule working, and the fix is never to move
the centre** — the LOD centre is the CAMERA, which is what the player
sees, in first person, in third and in observer mode, so in play the
radius rides with the eye and covers a proper bubble around whatever the
player is looking at. It was the Creature Lab's BENCH CAMERA that was
unusual, in standing outside the thing it was looking at.

So the bench moved. `FREE_START` now stands IN the room at 0.56 m from
the middle, which puts 79% of the floor on a real mesh and 23% on a full
rig, and costs 20 points of framing — you cannot stand inside a
one-metre room and still see all four of its corners through a 103°
lens. For a bench whose subject is the near tiers that is the better
half of the trade; the stick reaches the rest.

## What alpha.45 changed, and why B and D still are not comparable

Joshua, 2026-09-10, at 1,077 insects: *"LOD still not correct and
rendering as a procedural too close… the room is a 1 meter block and
from the camera center needs to be the center of the sphere… where do
you have it?"*

**The centre was already the camera** and is unchanged:
`CreatureLabScene` reads the eye off the ACTIVE camera
(`camera.position`, follow or free) and `FaunaView.update` squares every
creature's distance from it in 3D, height included. Four things were
actually wrong, in descending order of what he could see:

1. **The budget was binding, and nothing said so.** 13 full rigs and 26
   frozen ones is the whole of medium's capacity, so with hundreds of
   bodies inside LOD0's radius the fortieth-nearest drew as an
   ellipsoid at any distance. The counts printed bare. They now print
   against their caps — `13/13 rigs · 25/26 reduced` — with the demand
   under them, `inside 412 at LOD0 · 998 at LOD1`. A count with no cap
   beside it cannot tell "nothing nearer to draw" from "nothing left to
   give", and those are opposite diagnoses.
2. **Rank churned.** The two radii are hysteretic; RANK was not. With
   400 bodies inside one radius and 13 rigs, nobody crosses a boundary
   and the nearest 13 are a different 13 every frame — a fade out and a
   fade in each time, so a stable crowd shimmers. A holder now sorts
   from `HOLD_ADVANTAGE` (0.8) of its distance: a challenger has to be a
   fifth nearer to take its place.
3. **LOD1 holders were unprotected.** `spare()` tested `rigged === 1`,
   so a body wearing the FROZEN mesh was filed with the ones fading out
   and could lose its clone to a claimant standing further away — a
   priority inversion in the one direction the ladder guarantees. Latent
   at a pool equal to the budget; live the moment either moves.
4. **The lending walked a prefix.** It served `list[0 … fulls+reduceds]`
   rather than every marked body, and the marks are not always that
   prefix: `wantsFull` reaches to `LOD0_OUT` for a body that already
   holds a rig and only to `LOD0_IN` for one that does not, so a holder
   slightly further out can be marked after a nearer body is passed
   over. The mark was spent and no mesh was lent against it.

And two things changed that move the numbers:

- **The pool grows to demand.** It was cut to the whole ladder's size
  for EVERY species up front — five pools' worth of skeletons for a
  frame that can only lend one pool's. It now warms to `POOL_WARM` and
  builds `POOL_GROWTH_PER_FRAME` more when an animal asks for one it
  cannot have, to the same ceiling. A body therefore waits a few frames
  for its mesh after a cold start, then `FADE_S` to arrive.
- **RIGS cycled RUNG → ×2 → ×4 → ALL, for about a day.** See below: it
  was the wrong answer to the right complaint.

**LOD1's cheap material is still not built.** Joshua asked for a 64×64
texture on the middle tier; alpha.44 and .45 ship only the frozen-bones
half, which is the CPU half. A frozen rig still costs its draw call and
its full skinned geometry on the GPU, so `REDUCED_PER_FULL` = 2 remains
a guess, and by Baseline A's own slope the ceiling on TOTAL meshes is
the GPU's, not the poser's.


## alpha.46 — the bench has no budget

Joshua, 2026-09-11: *"Remove any limits because it is a stress test, and
if you keep adding rules, how can I actually get the correct numbers?"*

He is right and the ×2/×4 multiplier alpha.45 added was the wrong shape
of fix — a new rule layered on a limit that should not have been on a
bench in the first place. **A bench that stops handing out rigs at 13
measures 13.** The phone never gets asked.

So the Creature Lab now runs `FaunaView.setUncapped(true)` for as long as
it is open: no full-rig budget, no middle-tier budget, no pool ceiling.
RIGS is back to two positions and chooses only which QUESTION is asked:

| | what it measures |
|---|---|
| **RIGS: ALL** | one animated skeleton per drawn body, distance ignored — Baselines A and C's question |
| **RIGS: LOD** | the three tiers decided by the radii ALONE — full rig inside 0.45 m, frozen mesh to 0.85 m, impostor past it |

Neither has a budget. A run ends because the frame rate ended it.

**Why this is the measurement that was wanted all along:** uncapped runs
price the TIERS. Run ALL and you get the marginal cost of a full rig.
Run LOD from the same viewpoint and the difference is what the frozen
mesh and the impostor save. Those three numbers let any budget be
computed — including the one the game should ship with. A capped run
gives none of them: it flattens at the cap and reports a frame rate
about a bench that had stopped filling up.

The game keeps its budgets. **Measure uncapped, then choose a cap.**

### The limits that are left, and why they are visible

Two ceilings remain, and neither has ever bound: `MAX_CREATURES`
(10,000) and `LAB_CAPACITY` (12,000 per species, which is also the
impostor cap and the simulation's `far` cut). They are not free to
raise — the five impostor meshes preallocate instance matrices at that
size, about 3.8 MB — so they stay until a run actually reaches one.

What changed is that they can no longer hide. The report's `not drawn`
line splits three ways:

```
  not drawn           186
    underground       186   (burrowers below BURROW_HIDE — correct, not a limit)
    past a cap          0   (impostor cap — A LIMIT if this is not zero)
    cut far             0   (the simulation's own cut — A LIMIT if this is not zero)
```

Baseline B's missing 55 were the first line. If either of the other two
is ever non-zero, the run hit a ceiling and its numbers are about the
ceiling. The ending already says when `MAX_CREATURES` stopped a run
rather than the frame rate.


### The rung is the player's now

Joshua, 2026-09-11, reading `detail medium` in a report taken on a phone
set to high: *"should be on High to match settings not medium."* The
bench hardcoded `medium`, so every number it printed named a rung he does
not play at. It now reads `settings.detail` through `detailFor`, the same
call `PerformanceWorldScene` makes, and a probe or a test with no
settings to read still gets `medium`.

What the rung does on this bench is **nothing**, and the report says so:
uncapped, it sizes no rig budget, and `LAB_SPECIES_TABLE` already
flattens every population cap to `LAB_CAPACITY` at every rung. It is a
condition a run was taken under, not a lever on the number. The line
reads `detail  high   (the player's setting; caps nothing on this bench)`
so it cannot be mistaken for one.

## Baseline C-ALL — the first uncapped full-rig run *(alpha.45, ramped)*

| | |
|---|---|
| **Date** | 2026-09-11T00:50:32Z |
| **Build** | `1.0.0-alpha.45` · `a2a7d55` |
| **Viewport** | 810 × 374 css px |
| **Rigs** | ALL — one animated skeleton per drawn body |
| **Detail** | medium (hardcoded; alpha.46 reads the player's) |
| **Predation** | OFF |
| **Camera** | the moved bench viewpoint, 0.56 m from the middle |

| | |
|---|---|
| **Sustained at 30+ fps** | **77 creatures** (± 20, arriving at 4/s) |
| Total placed | 230 |
| Duration | 78.2 s |
| Average FPS | 32.1 · 31.1 ms |
| Lowest FPS (5 s) | 7.9 |
| Worst single frame | 158 ms |
| Ending | held under 10 fps for 5 s — **a real breaking point** |

Drawn at the end: **198 full rigs**, 0 reduced, 0 impostors, 37 not
drawn. Inside LOD0: 135. Inside LOD1: 198 — every drawn body was within
0.85 m, which is what moving the bench into the room bought.

Crossings: 45 → 56 (34 s, ±15 at 3/s) · 30 → 77 (39 s, ±20 at 4/s) ·
20 → 89 (42 s, ±20 at 4/s) · 10 → 198 (63 s, ±30 at 6/s).

### The finding that matters, and it is not the headline

```
WHERE THE FRAME WENT (mean per frame)
  creature drawing    1.4 ms
  everything else    29.8 ms   (terrain, sky, UI, present, and the sim)
  sim tick            0.2 ms
```

**Posing 198 skinned rigs costs 1.4 ms of CPU.** The frame is 31 ms. The
other 29.8 ms is not the creature renderer's stopwatch — it is the GPU
submitting and skinning those meshes, plus present and vsync.

That reframes the whole ladder. **LOD1 as built saves the 1.4 ms and
nothing else**, because freezing the bones skips the posing and changes
not one thing about the draw: same mesh, same triangle count, same
material, same skinned vertex shader. Its ceiling is therefore about 4%
of this frame.

What the 29.8 ms responds to is FEWER OR CHEAPER DRAWS — which is the
impostor, and which is the half of LOD1 that is still unbuilt: a
decimated mesh with a 64×64 material. `REDUCED_PER_FULL = 2` was always
labelled a guess; this says the honest opening value for LOD1-as-shipped
is close to **1**, and that the middle tier does not earn its place until
its geometry and material get cheaper.

**The run to do next is the same seed at RIGS: LOD.** Same crowd, same
viewpoint, most bodies on the middle tier or as impostors. The difference
between 31 ms and whatever that reads is the real price of the ladder,
and it is a number neither of us can guess from here.


## alpha.47 — the ladder Joshua respecified, from his own measurement

Joshua, 2026-09-11, after Baseline C-ALL: *"do full model and everything
from 0-0.3m, from 0.3-0.5m, the texture will be a solid matching color
but model still there and animated… from 0.5-0.6 it will fade to
procedural and over 0.6m is procedural same solid color, no model or
animation."*

|  | what is drawn |
|---|---|
| 0 – 0.3 m | the full model, its own textures, animated every frame |
| 0.3 – 0.5 m | the same model, **still animated**, in the species' solid colour |
| 0.5 – 0.6 m | that flat model crossfades to the impostor, **by distance** |
| over 0.6 m | the impostor, in the same solid colour |

**Why the middle tier changed sides.** It used to keep the textures and
freeze the bones. His own run priced that: **1.3 ms of a 31 ms frame for
198 skinned rigs.** The frame is not the posing. So the tier now gives up
the TEXTURE and keeps the MOTION, which puts the saving on the fragment
side where the other 29.6 ms is, and keeps the thing that makes an ant
read as alive. The old tier's ceiling was 4% of the frame.

The solid colour is `LOOK[species].colour` — the number the impostor is
already built from — so the two far tiers match by construction. The flat
material is `MeshLambertMaterial`, the impostor's own class: lit, so
"light decides what shows" still holds, and with no map to sample. Where
a material alpha-tests (a fly's wing is a shaped cutout on a quad) the
same map drives the same cutout, or the wings would become cardboard;
everything else gets no texture at all, which is the saving.

Both coats are built when a clone is and the tier only rebinds
`mesh.material`. Swapping a reference is free; swapping a material's
`map` is a shader recompile and a hitch.

**The crossfade is distance, not time.** `meshShare(d²)` is 1 at 0.5 m,
0 at 0.6 m and a straight ramp between; the impostor draws `1 - share`.
A timed fade had to be started, held and finished, and it ran at the
wrong moment whenever a body crossed a line while something else was
deciding tiers. A ramp is simply true every frame. The one latching
boundary left is the texture line, which keeps its two numbers.

### What to run next

The same seeded run at **RIGS: LOD**. Baseline C-ALL is the control: 231
bodies, 199 of them full textured models, 31.0 ms. The LOD run draws the
same crowd with most of it solid-coloured or procedural. **The gap
between 31.0 ms and whatever that reads is the ladder's whole worth** —
and if it is small, the answer is not more tiers, it is fewer triangles.


### The bench viewpoint, recomputed for the 0.3 / 0.5 / 0.6 ladder

The bench viewpoint is a function of the radii, so tightening them moved
it for the third time. At (34, 34) — chosen for the 0.45 / 0.85 ladder —
**0.0%** of the floor was inside the new near radius, which is the same
failure as the original perch at 1.00 m, one rung in.

| viewpoint | to middle | framed | textured (0.3 m) | solid (0.5 m) | any model (0.6 m) |
|---|---|---|---|---|---|
| ~~(62, +48, 62)~~ | 1.00 m | 96.5% | 0.0% | — | — |
| ~~(34, +28, 34)~~ | 0.56 m | 77.0% | **0.0%** | 29.0% | 41.4% |
| (28, +24, 28) | 0.46 m | 66.4% | 6.5% | 38.4% | 52.1% |
| (24, +20, 24) | 0.39 m | 59.2% | 12.0% | 45.7% | 60.2% |
| **(20, +16, 20)** *now* | 0.32 m | 52.2% | **16.6%** | 53.0% | 68.3% |
| (16, +13, 16) | 0.26 m | 45.7% | 19.3% | 59.7% | 76.0% |

Framing is the frustum test against the real lens — 60° vertical at
932 × 430, so 103° across — over a 400 × 400 lattice of the floor, not an
estimate. **When a radius changes, recompute this and move the bench.**
