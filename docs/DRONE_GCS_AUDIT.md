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
| Horus | — | — | **Not audited.** No repository matching the description (MIT, global planner + local planner + voxel map + trajectory follower) could be found by search. Auditing a same-named project would have been worse than saying so. |

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

- **Wind.** Neither optimizer models it *at all* — the word does not
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

## Proposed shape for the next phase

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

- `src/ant/hazards.ts` — `Hazard = { at: WorldPoint, radius: number, top:
  number | null }`. `top === null` is CanaryGC's restricted airspace: the
  ocean, a predator zone, a hostile colony. No top means no climbing over
  it.
- `src/ant/routePlanner.ts` — `planRoute(from, to, hazards, ceiling)`
  returning legs plus the diff report. Visibility graph over buffered
  corners, bounded, flat-plane distances.
- The map draws the plan and prints the report.

The autopilot's existing per-frame lookahead already plays the "local
planner" role in the global/local split, which is the one idea worth
keeping from the Horus description even though the repository could not
be found: the global plan should not be recomputed because one spider
walked into the leg.

## Bottom line

Adapt the design, not the code. The two ideas that change what TMB would
have built are the **climbable-versus-unclearable split** (which removes
the need for a 3D planner) and the **inbound-climbs / final-does-not**
landing rule. Both are things I would have got wrong by inventing them,
and Joshua was right to stop and look first.
