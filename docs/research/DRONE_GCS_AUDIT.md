# What the real ground control stations already solved

A read-only audit, 2026-08-31, at Joshua's instruction: "I would actually
pause before we tell Claude to invent the full terrain/obstacle planner
and have him inspect CanaryGC's mission optimization implementation
first. That could determine whether we adapt a proven MIT design or write
our own equivalent."

Nothing was copied into TMB. This is what is there, what is worth taking,
what is not, and what TMB already has that these do not.

## What was read

| Project | Licence | Commit | What was read |
| --- | --- | --- | --- |
| [CanaryGC](https://github.com/judahpaul16/canarygc) | MIT | `17a4c88` (2026-08-20) | `path-planning.ts` (354 lines, the whole optimizer), `landing-approach.ts`, `safety.ts` validation, `dem.ts` / `terrarium.ts`, `hazards.ts`, `takeoff-land.ts` |
| [DroneRoute](https://github.com/fcsonline/droneroute) | MIT | `2b27ac2` (2026-07-13) | `packages/shared/src/types.ts` — the mission and waypoint model |
| [Horus](https://github.com/Horus-Technologies/horus) | MIT | `4f1547d` (2025-06-19) | `GlobalPlanner.cpp`, `LocalPlanner.cpp`, `TrajectoryController.cpp`, `Search.cpp`. Found only because Joshua sent the link — it does not surface by search. |

CanaryGC is SvelteKit, not React — worth knowing before anyone plans a
component transplant. ADOS Mission Control was deliberately not read: it
is GPL-3.0-only, and reading it before writing TMB's own planner is the
one thing that could contaminate the licence position.

## The single best idea in CanaryGC

**Hazards come in two kinds, and which kind decides the whole response.**

- **Climbable** — an obstacle or building, which has a *top*. The leg is
  raised to `top + clearance`, capped at the ceiling. The route does not
  change.
- **Unclearable** — restricted airspace, or anything whose top is above
  the ceiling. You cannot climb over a legal boundary, so the leg detours
  horizontally.

That is the entire strategy, and it is why the optimizer is 354 lines
instead of a voxel planner. It translates to TMB exactly, and the
translation is not a metaphor:

| Drone | TMB |
| --- | --- |
| obstacle / building (has a top) | tree, rock, cliff, plant — **climbable** |
| restricted airspace | ocean, predator zone, hostile colony — **no top, never climbable** |
| altitude ceiling | her flight ceiling |
| home geofence | colony operating boundary |

The consequence is the useful part: **TMB does not need a 3D planner.**
A 2D detour plus a per-leg altitude covers everything on that list.

## The four things worth adopting

### 1. Detours are a visibility graph, not a grid search

`routeAround` buffers each hazard footprint outward from its centroid,
takes the ring corners as graph nodes, connects any pair whose straight
segment does not enter a hazard, and runs Dijkstra. About eighty lines.

For TMB this is the right shape rather than merely a convenient one: the
island is 5,600,000 units across and a rock is a few hundred units wide,
so a grid fine enough to see the rock has billions of cells. A corner
graph only ever holds the corners that exist.

The bound matters as much as the algorithm: `MAX_GRAPH_VERTICES = 160`,
because "a dense hazard field cannot stall the click". On a phone that
is not a nicety.

### 2. The planner never reorders, and it reports a diff

`optimizeMissionPath` keeps every waypoint in the operator's sequence.
It only inserts detour points, nudges a waypoint that sits *inside* a
no-fly zone back out of it, and raises altitudes. Then it returns:

```ts
{ addedWaypoints, movedWaypoints, raisedWaypoints, clearedLegs, changed }
```

The plan the player laid out is still their plan, and the machine says
what it did to it. TMB's map should say the same thing in a line:
"routed round 2 hazards · raised one leg to 4 m".

Fixed items — takeoff, land, RTL, loiter — are never moved, and landing
items are never raised. TMB needs the same exemption list the moment it
has more than one kind of waypoint.

### 3. The landing approach: the inbound leg may climb, the final may not

`pickApproach` is the best thing in the repository and it is better than
what I had sketched for TMB's Phase 3 (which was, roughly, "descend when
over the pin"):

- Candidate bearings in preference order — straight in from the
  vehicle's side first, then rotating ±30°, ±60° … 180° around the home
  point.
- The **inbound** leg may climb over hazards and terrain, up to the
  ceiling.
- The **final glide** may not climb at all, so anything poking into it
  rejects that corridor outright and the next bearing is tried.
- A taller approach fix moves *further out*, so the glide stays shallow:
  `distance = altitude × GLIDE_RATIO`.
- Clearance margins **taper to zero at the threshold**, "where descending
  through them is the landing itself".
- Restricted airspace rejects a corridor; controlled airspace only
  *warns*, because home may legitimately sit inside it.
- When every corridor is blocked it returns a default geometry with
  `clear: false` and warnings, rather than nothing.

Every one of those transfers. TMB's version reads: she may climb on the
way to the approach fix, she may not climb on final, a crest or a branch
in the glide kills that direction, and the 55 cm floor has to taper to
zero at touchdown or she can never land at all.

### 4. Mission validation is a list, not a boolean

`validateMission` returns `{ severity: 'error' | 'warning', index,
message }[]` — per waypoint, in order, with an interesting subtlety: a
zone only applies within its own vertical band, so a low waypoint is not
flagged for airspace whose floor is above it. TMB's equivalent is a
waypoint under a canopy versus over it.

## From Horus: three clocks, and a search that only ever looks nearby

Horus is real, MIT, ROS 2 and C++, and it is earlier-stage than its
description suggests. The honest reading:

**`GlobalPlanner` does not plan.** It publishes a *goal* on a 20 ms
timer from a hardcoded list, and the constructor actually wires up
`run_random`, which picks random reachable points. There is no global
route in this repository yet. The name is an intention.

**`LocalPlanner` is where the work is**, and it does something worth
copying: every **300 ms** it re-runs A* *from her current position* to
the goal, inside a **32-voxel cube centred on the drone**. The search is
bounded to a moving window rather than the map, which is the same
instinct as CanaryGC's 160-vertex cap and a better-shaped one — cost is
tied to how far she can see, not to how big the world is.

**`TrajectoryController` follows at 10 ms** with pure pursuit: the
furthest intersection of a lookahead sphere with the path.

So the architecture is three rates rather than two layers:

| Horus | rate | TMB |
| --- | --- | --- |
| GlobalPlanner (goal) | 20 ms | `MissionBrain` — already exists |
| LocalPlanner (replan) | 300 ms | **missing** |
| TrajectoryController (follow) | 10 ms | `Autopilot` per frame — already exists |

TMB has the ends and not the middle. The middle is exactly the thing
that stops one spider walking into a leg from re-deriving a route across
the island: keep the plan, re-run the short search.

Two smaller things worth taking. `clean_path` is string-pulling —
walk the path, keep the furthest node still in clear line of sight, drop
everything between — run twice "for certain edge cases". A visibility
graph already produces taut paths, but a *replanned* one will not, so
TMB will want this the moment the middle rate exists. And `run_search`
returns nothing at all when the start voxel is occupied, with the
comment "this means drone is in a wall and something is very wrong":
failing loudly rather than planning out of an impossible state.

What does not transfer is the voxel grid itself. TMB's world is
5,600,000 units across, its hazards are metres wide and mostly convex,
and the biggest one — the ocean — is not voxel-shaped at all. Corner
graphs over footprints are the right representation here; voxels are the
right one when the obstacles arrive as a point cloud, which is a problem
TMB does not have because it authored the island.

## From DroneRoute: the waypoint editor's data model

Its `Waypoint` carries per-item **overrides of mission globals**:

```ts
useGlobalSpeed, useGlobalHeight, useGlobalHeadingParam, useGlobalTurnParam
```

so the mission sets defaults and any single waypoint can opt out. That is
the ergonomics TMB's waypoint panel would otherwise have to invent.

Three fields in its `MissionConfig` are worth stealing outright:

- `takeOffSecurityHeight` — a real drone concept, and exactly the 1.0 m
  vertical lift Joshua asked for on 2026-08-31. v0.0.139 built it as
  `AUTOPILOT_DEFAULTS.launchAgl`; it is reassuring that the industry
  calls it something.
- `finishAction` — `goHome` / `noAction` / `autoLand` / `hover`. TMB
  currently only does `hover`, and does not ask.
- `RCLostAction` — `goBack` / `landing` / `hover`. This is precisely the
  question AP STANDBY answers, and the industry answer is that it is a
  *setting*, not a fixed behaviour.

Also `TurnMode` (coordinated turn versus stop-at-the-point, with a
damping distance) and `HeadingMode` (`followWayline` / `fixed` /
`towardPOI`). TMB's autopilot currently has one of each, hard-coded.

## What TMB already has that neither project does

This matters, because it decides how much is worth adopting.

- **Wind.** None of the three model it *at all* — the word does not
  appear in CanaryGC's planning code. `progressIn` (the crab-and-along
  arithmetic) and the altitude band search that prices candidate bands by
  the ground progress they buy have no counterpart in either repository.
  CanaryGC raises a leg to clear an obstacle; it never *lowers* one to
  find better air. That is TMB's own, it came from Joshua's brief, and it
  stays.
- **Reactive terrain.** CanaryGC samples terrain from DEM tiles at about
  25 m per pixel, for the approach only. TMB's lookahead runs every frame
  against the live heightfield at 54.7 m per sample with the HD tiles
  under it.
- **A time scale.** No ground control station has a ×10 — a real drone
  flies in real time. The substep planner, the streaming brake and the
  golden 1× versus 10× comparison are problems these projects never had.
- **Physiological endurance.** `maxBatteryMinutes` is a number in a
  config file. TMB's thirst and stamina are simulated, and they already
  divert her.

So the shape to adopt is the **route planning** layer. The flight layer
below it is further along here than in either project, and should not be
traded for theirs.

## What not to take

- **MAVLink, MSP, firmware dispatch, parameter writes.** TMB has no radio
  between the Queen's brain and her wings and does not want a pretend
  one.
- **Lat/lon and haversine.** This is the real porting hazard. Every
  distance in CanaryGC goes through `EARTH_M_PER_DEG_LAT` and
  `metersPerDegLon(lat)`; TMB is a flat 56 km world addressed in
  centimetres by `WorldPoint`. Porting the geodesy would import a
  coordinate bug and make the code slower — on a plane the visibility
  graph is simpler than theirs, not harder. Take the algorithm, delete
  the trigonometry.
- **Their margins.** 60 m airspace buffer, 100 m obstacle keep-out, 12 m
  building buffer, 12:1 glide, 800 m approach, 120 m ceiling. Those are
  drone-scale numbers for a machine a metre across. The Queen is 1.4 cm
  long and cruises at 70 cm/s. Every one has to be re-derived, and
  copying any of them would be the same class of mistake as the biome
  bands that survived the change to true scale.

## Licence position

CanaryGC and DroneRoute are both MIT: adapting code is allowed provided
the copyright notice and licence text travel with it. If any adapted code
lands in TMB, it needs `docs/THIRD_PARTY.md` carrying both notices.

Given the coordinate-system point above, the honest expectation is that
TMB writes its own equivalent *informed by* these rather than pasting
from them — the algorithms are short, the geodesy is most of the line
count, and the geodesy is the part TMB must not have. The value of the
audit is the design, and the design is free.

ADOS Mission Control is GPL-3.0-only. It should not be read by anyone
writing TMB's planner.

## What was built from this (v0.0.140)

Named in TMB's own terms, with the existing separation kept:

```
MissionBrain          WHERE she needs to go, and why        (exists)
  ↓
RoutePlanner          one destination → a list of legs      (new)
  ↓
Autopilot             fly ONE leg: track, band, arrival     (exists)
  ↓
FlightDemand → Flight the only thing that moves her         (exists)
```

- `src/ant/hazards.ts` — `Hazard = { at, radius, top: number | null }`.
  `top === null` is CanaryGC's restricted airspace: a predator zone, a
  hostile colony, ground she must not be over. No top means no climbing
  over it, and `clearable()` also demotes anything taller than the
  ceiling into that class, which is what makes the split a rule rather
  than a label.
- `src/ant/routePlanner.ts` — `planRoute(from, to, hazards, baseFloor)`
  returning legs plus the diff report. Visibility graph over buffered
  corners, Dijkstra, bounded at 160 vertices, flat-plane distances.
- `Autopilot.engage(at, floorAgl?)` — a leg's raise arrives as a
  MINIMUM the band search may not look below, never as a commanded
  altitude. Two systems entitled to name her height would fight.
- The map draws the plan as a solid track with a mark at every inserted
  corner, and replaces the dashed reference line when it bends.

Two things were learned building it that the audit could not have
predicted, both geometry and both found by tests that were right when I
assumed they were wrong:

- **Adjacent ring corners must be able to see each other.** The router's
  own nodes are footprint corners, so the segment between two of them IS
  an edge, and a midpoint-inside test at a point exactly on a boundary
  answers whichever way the arithmetic falls. Where it fell "inside",
  she could only ever go the long way round — a zone 30 m off her line
  drew an 83 m dog-leg when a 23 m one was open.
- **A segment can pass corner-to-corner straight through a polygon**
  crossing no edge *properly*, with its midpoint nowhere near — so an
  edges-and-midpoint test calls it clear. Rings placed on a circle line
  their corners up constantly, and a pen of sixteen overlapping hazards
  was strolled out of. Both are fixed by clipping the segment against
  the convex half-planes and asking whether any interval is *strictly*
  inside, which also drops the epsilon fudge the first fix needed.

CanaryGC has the same shape of test and, as far as reading it goes, the
same exposure — its `segmentEntersRing` is edges plus a midpoint. That
is not a criticism of it; it is what a careful audit is worth. The
design transferred, the implementation had to be earned.

### Still to come

- The hazard list ships EMPTY, and honestly: TMB has no trees with tops,
  no predators and no forbidden ground yet. The mechanism is live and
  `__island.addHazard` proves the chain end to end.
- Terrain is deliberately not in it. A ridge she cannot outclimb is a
  real gap and a real route problem, but it needs ground represented as
  a region rather than as a circle.
- The middle rate (Horus's 300 ms replan) is not built. The route is
  planned once, at the order.

The autopilot's existing per-frame lookahead already plays Horus's
`TrajectoryController` role. What TMB does not have is the middle rate —
see below — and that is the piece worth adding after the planner itself.

## Bottom line

Adapt the design, not the code. The two ideas that change what TMB would
have built are the **climbable-versus-unclearable split** (which removes
the need for a 3D planner) and the **inbound-climbs / final-does-not**
landing rule. Both are things I would have got wrong by inventing them,
and Joshua was right to stop and look first.
