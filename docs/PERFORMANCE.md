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

## Baseline B — Rung Rigs / Impostors *(pending: same seeded run at RIGS: RUNG)*

**Run this on alpha.42 or later.** Alpha.41 — the build Baseline A was
measured on — could not count rigs against impostors, so a B measured on
it would not be comparable to A in the one dimension B exists to test.
Alpha.42 adds the DRAWN census (rigs and impostors at every threshold and
at the end) and the `WHERE THE FRAME WENT` split, and a POOL selector for
Baseline C.

Same room, same seed, same spawn rate, same viewport; RIGS: RUNG instead
of ALL. At the medium rung the pools are earthworm 2, aphid 5, housefly
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
