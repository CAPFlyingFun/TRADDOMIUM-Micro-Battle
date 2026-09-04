# TASK 01 — Main Menu + Full-Island Spawn Map + Respawn Foundation

## Goal

Create the first real front door and repeatable core loop for
**TRADDOMIUM: Micro Battle!**

The player should be able to:

```text
Launch game
   ↓
Main Menu
   ↓
New Colony
   ↓
Full Kauaʻi map
   ↓
Choose a spawn REGION
   ↓
Game chooses one safe candidate inside that region
   ↓
Spawn young winged Fire Ant Queen
   ↓
Walk / fly / explore
   ↓
Die or restart
   ↓
Return to spawn flow
```

This is intentionally a foundation task. Do not add predators, combat, brood,
nest building, multiplayer, or live weather here.

Weather is Task 02.

---

## 1. Main Menu

On game load, do NOT immediately place the Queen into the world.

Show a simple polished menu first.

Suggested first version:

```text
TRADDOMIUM
Micro Battle!

[ CONTINUE COLONY ]   disabled until save/continue exists
[ NEW COLONY ]
[ SETTINGS ]
```

For now:

- `NEW COLONY` opens the spawn map.
- `SETTINGS` opens the existing game settings in an appropriate menu form.
- `CONTINUE COLONY` may be visible but disabled with a clear "Coming soon" or
  equivalent state until save data exists.
- Avoid building account/login/multiplayer UI yet.

The menu must work on:
- iPhone portrait/landscape as appropriate to current game orientation
- mobile browser / installed PWA
- desktop browser

Keep controls large enough for touch without recreating the oversized-button
problem the HUD previously had.

---

## 2. Full-Island Spawn Map

When `NEW COLONY` is selected, show the WHOLE island of Kauaʻi on one map.

The map should be based on the game's existing Kauaʻi world/heightfield data
rather than depending on a remote map image.

Important:

- The map is a 2D overview.
- It represents the full true-scale island.
- Spawn locations are stored in GLOBAL/WORLD coordinates.
- Do not store spawn locations relative to the current floating origin.
- The spawn map itself does not need the full 3D world rendered underneath it.

Suggested map layers for v1:

```text
ocean / island silhouette
terrain/elevation coloring
spawn-region markers
selected-region highlight
basic legend
```

A small north indicator is useful.

The user should be able to tap/click a region marker and see:

```text
Region name
Environment
Approx. elevation
Difficulty placeholder
Short description

[ SPAWN HERE ]
```

Weather is NOT shown yet. Task 02 adds that.

---

## 3. Spawn Regions, Not Single Exact Spawn Points

Create approximately **30 visible spawn regions** around the island.

Each visible region should contain about **3–5 hidden candidate spawn points**.

Example:

```text
South Coast Grasslands
        ↓
candidate A
candidate B
candidate C
candidate D
```

The player chooses the REGION.

The game randomly selects one valid candidate from that region.

Reason:

- avoids every player spawning on one exact coordinate
- works better for future multiplayer
- gives variation between restarts
- makes spawn camping harder later

Target total:

```text
~30 regions
x 3–5 candidates each
≈ 90–150 candidate coordinates
```

Do NOT hand-create all 150 immediately if that slows the task down.

A good v1 may start with 30 regions and 3 candidates each, then expand.

---

## 4. Spawn Environment Distribution

Use the existing terrain band system as the first approximation of environments.

Current terrain bands include:

```text
reef
sand
grass
jungle
cliff
mountain
snow
```

These are currently mostly elevation-driven terrain bands, not a final ecological
biome system. That is okay for this task.

Suggested first distribution:

```text
COAST / BEACH
6 regions

OPEN LOWLAND / GRASS
8 regions

JUNGLE / FOREST
7 regions

FOOTHILL / CLIFF COUNTRY
5 regions

HIGH MOUNTAIN
4 regions

TOTAL
30 regions
```

Do not create normal Fire Ant spawn regions in the snow/highest summit texture.
🤣 A debug-only snow spawn is fine if useful for testing, but it should not be
presented as a normal gameplay option.

The exact 30 may be adjusted after inspecting the real heightfield so they are
well distributed around the actual landmass.

---

## 5. Candidate Validation

Every candidate should be validated before it is accepted.

Minimum v1 checks:

```text
✓ on land / above water
✓ terrain exists
✓ slope is below a safe threshold
✓ enough flat clearance for the Queen
✓ not inside a cliff/fold
✓ local streamed terrain can be built around the position
✓ Queen can be placed on the same groundHeight surface that is rendered
```

Future checks, NOT required now:

```text
not inside another colony
not near enemy structure
not inside predator nest
not recently spawn-camped
```

If a stored candidate becomes invalid after terrain changes, the system should
reject it rather than blindly spawning the Queen there.

---

## 6. Spawn Execution and Floating Origin

Spawning must use the true-scale global coordinate system correctly.

Correct architecture:

```text
selected candidate
GLOBAL X/Z
   ↓
set / re-seat floating origin near that location
   ↓
stream local terrain around GLOBAL X/Z
   ↓
place Queen from GLOBAL position
   ↓
convert to LOCAL render position
   ↓
snap camera
```

Do not:

```text
store THREE.Object3D.position as the permanent spawn coordinate
```

The Queen's authoritative location must remain global/float64.

The newly spawned location should become a good test of the floating-origin
architecture because the player can now start on opposite sides of the island
without traveling there manually.

---

## 7. Spawn Orientation

The Queen should not always face the same arbitrary world direction.

For v1, use one of these simple strategies:

1. region-defined preferred heading
2. face inland for coastal starts
3. face toward a nearby navigable area
4. safe default if no heading is defined

Keep the heading in world-space radians/degrees and convert normally through the
existing camera/player system.

---

## 8. Respawn Foundation

Build enough death/restart plumbing to test the loop.

Before a colony has been founded:

```text
Young Queen dies
   ↓
Death screen
   ↓
[ CHOOSE NEW START ]
   ↓
Spawn map
```

Do NOT wipe future colony logic into this design.

Long-term rule:

```text
BEFORE colony exists:
death can lead to a new Queen / new colony start

AFTER colony exists:
death of controlled ant should normally return control to another living
colony ant, not erase the colony
```

For this task, only the pre-colony restart path needs to work.

A temporary debug `Kill Queen` or `Restart` option is acceptable for testing.

---

## 9. Map Data Structure

Use a clean reusable data shape.

Example concept:

```ts
interface SpawnRegion {
  id: string;
  name: string;
  environment: 'coast' | 'grass' | 'jungle' | 'foothill' | 'mountain';
  description: string;
  difficulty: number;
  markerX: number; // map-normalized or map display coordinate
  markerY: number;
  candidates: SpawnCandidate[];
}

interface SpawnCandidate {
  globalX: number;
  globalZ: number;
  heading?: number;
}
```

The exact implementation can differ.

The important distinction is:

- marker position = UI/map presentation
- candidate globalX/globalZ = authoritative world location

Do not confuse the two.

---

## 10. Suggested UI Flow

```text
BOOT
  ↓
MAIN MENU

NEW COLONY
  ↓
FULL KAUAI MAP

tap:
"North Shore Jungle"

panel:
🌿 North Shore Jungle
Environment: Jungle
Elevation: Low / Mid
Difficulty: ★★☆
Description: Wet lowland vegetation near the coast.

[ SPAWN HERE ]
  ↓
candidate validation
  ↓
loading transition
  ↓
Queen appears
```

Keep the first version simple and responsive.

No giant animation system is needed for the menu.

---

## 11. Debug / Development Tools

Add a lightweight way to test all regions rapidly.

Useful debug features:

```text
Spawn Region dropdown
Teleport/Respawn here
Current GLOBAL X/Z
Current terrain/environment
Current elevation
Candidate validity
```

This can remain development-only.

A test mode that automatically attempts every candidate and reports invalid
locations would be very useful.

Example:

```text
Spawn audit
30 regions
94 candidates

92 valid
2 invalid
```

---

## 12. Acceptance Criteria

Task 01 is complete when:

- Game opens to a real main menu instead of immediately spawning the Queen.
- `NEW COLONY` opens a full-island Kauaʻi map.
- Approximately 30 spawn regions are visible and selectable.
- Regions are distributed among coast, grass/open lowland, jungle/forest,
  foothill/cliff, and mountain environments.
- Each region has multiple candidate spawn positions.
- Spawn positions use GLOBAL world coordinates.
- Choosing a region correctly relocates the floating origin and streams terrain.
- The Queen spawns on the actual rendered ground, not a different height surface.
- Starting at widely separated locations around Kauaʻi works.
- Camera initializes correctly after every spawn.
- A pre-colony death/restart can return to the spawn map.
- Mobile touch and desktop mouse controls both work.
- Existing walking/flight behavior still works after spawning.
- No weather API is introduced yet.

---

## 13. Do Not Expand This Task Into

Do NOT add these here:

```text
predators
AI insects
combat
brood
nest building
multiplayer
accounts
chat
live weather
radar
real biome simulation
full save-game system
```

Small hooks/interfaces for future systems are fine.

The goal is:

> Make TRADDOMIUM start like a real game and make spawning anywhere on the
> true-scale island trustworthy.
