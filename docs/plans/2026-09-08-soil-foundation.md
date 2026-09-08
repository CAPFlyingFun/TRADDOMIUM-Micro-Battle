# Shared soil foundation — alpha.27

Joshua authorised implementation after Claude's alpha.26 camera/worm pass.
Base: d1d793a47897073386dcc093e23af3f694e2af62. Reference: TCS island's
density soil, persistent world-addressed edits, and mesh-before-clip rule.
Trello parent: https://trello.com/c/72y7lNks (first worm validation only).

## Scope and contracts

Keep the surveyed Heightfield immutable. Add a pure subtractive soil field:
world-addressed capsule deltas sampled on a 1 mm lattice, positive density
for soil and negative for air. One authorised digging API, initially called
by worms through the existing gate. Swept bores join successive positions,
including vertical entry/exit. Water gets a read-only surface query.

Persist compact capsule deltas in the selected solo slot. Rendering streams
small columns around the observer; unloading a mesh never deletes a delta.
Voxel surfaces replace the coarse sheet only after their meshes are ready.
The cutaway is a view of the same density field, never a digging operation.
Provide a labelled soil control, a worm inspection jump, and a depth slider
usable by touch and mouse. Keep alpha.26 normal camera controls unchanged.

The first release is local solo soil. Multiplayer editing remains disabled
until the authoritative shared-world journal exists. No ant player, nest
planner, build/add-soil operation, erosion, or cave flooding is implied.
Bound saved deltas and visible mesh work; report a reached edit limit rather
than silently dropping tunnels. A larger chunk store is a later milestone.

### Task 1: Shared soil and creature integration (root)

Create `src/world/soilTypes.ts` and `SparseSoil.ts`. Export SoilPoint,
SoilStroke (seven-number capsule tuple), SoilEditsSave `{version:1,strokes}`,
defensive `readSoilEdits`, and MAX_SOIL_STROKES=8192. Coordinates are cm in
WorldPoint space, heights above sea level. Expose density/sample queries,
tile bounds/revisions, read-only surfaceAt, and deterministic snapshot.
Use a 0.1 cm lattice and 3.2 cm column tiles. Test immutable survey,
permissions, continuous/slope/vertical cuts, negative/far coordinates,
idempotence, streaming independence, bounded input, and save replay.
Extend the existing burrow seam with an optional previous SoilPoint. Track
actual 3D movement and sweep from the previous submission. Reset that
point on a refusal so entering the local detail window cannot submit a
long cut across the unsimulated gap.

### Task 2: Solo persistence (leaf)

Owned files: `src/session/` plus new `tests/soilSave.test.ts`.
Add optional `terrainEdits?: SoilEditsSave` to SessionSaveState and SoloSave.
Keep SoloSave version 2 (additive field; old saves must still load). Sanitize
through readSoilEdits, preserving valid camera data if edits are malformed.
LocalSoloSession.save keeps existing edits when omitted, saves supplied edits
when present (an explicit empty snapshot clears them), and leave/flush keeps
them. restorableStateOf returns them when present. Keep slots isolated and
unknown keys stripped. Avoid adding undefined keys to old save objects.
TDD: actual JSON/storage round trip, restart/replay, leave/flush retention,
legacy alpha.26 compatibility, invalid payload and separate-slot tests.
Run targeted session/save tests. Do not edit world/perf/renderer files or
commit/push; report exact changed files and tests to root.

### Task 3: Voxel renderer (leaf)

Owned files: new `src/terrain/SoilView.ts`, `src/terrain/soilMesh.ts`, and
targeted new mesh/view tests. Root owns the TerrainView clipping integration.
Mesh the sampled density with a crack-free global lattice, chunk-local GPU
positions, and natural lit brown soil. Render a bounded selection of nearby
edited columns. Rebuild only dirty columns; dispose evicted buffers. Include
the complete surface column before handing a tile to base-sheet clipping.
Cutaway depth lowers the visible soil ceiling in the mesher only. Report
ready tile rectangles and cost; never mutate soil. Verify closed cavity,
surface opening, adjoining tile seams, negative/far coordinates, cutaway
immutability, disposal, and unchanged meshes reused. Do not commit/push.

### Task 4: Integration, inspection, verification and release (root)

Construct one soil instance per world, restore before simulation, wire the
worm editor only for local authority, save it on existing save points, and
give water the changed surface without write access. TerrainView clips only
ready soil columns using a small local mask. Add the inspection controls and
honest applied-edit/limit readout. Preserve existing worm slope positioning.
Test actual browser rendering and saved-reload on desktop and mobile sized
viewports. Run typecheck, tests (bounded workers), build, relay typecheck.
Review integrated diff. Refresh main/Trello, increment version, commit and
push main per Joshua's standing instruction; verify CI/deploy and put the
first-validation card in Testing with Joshua's label.

## Validation log

- Baseline: 1,697 tests passed; two existing tests timed out under default
  parallel load. Both files passed with one worker before implementation.
- Final unit gate: `npm test -- --maxWorkers=2 --testTimeout=15000` —
  1,731 passed, 2 skipped (129 passed files, 1 skipped). Bounded workers
  and a 15-second limit accommodate the existing CPU-heavy survey tests
  on this shared runner; no production test configuration was relaxed.
- App typecheck, relay typecheck, production build and `git diff --check`
  passed. Existing main-bundle size advisory remains.
- Independent persistence and renderer reviews passed. Final review found
  an unchanged-bed water flow reset; a new regression reproduced it, then
  passed with pipe state retained when sampled bed values are identical.
- A real Chromium boot probe caught a missing shader condition parenthesis.
  Corrected it and added braces. Scoped re-review cleared both fixes.
- Added `probe:soil` to exercise actual built-game worm cuts, 932×430 touch
  controls, 1200×750 keyboard controls, surface restore and saved reload.
- The built-game soil probe passed touch buttons, keyboard depth control,
  surface restore, actual worm cuts and pause/save/reload, with a clean
  console. The first pause snapshot held six cuts and all saved cuts
  survived reopening. Screenshots exposed an outer cutaway rim gap and
  the separate coarse-triangle/survey residual in normal view; both are
  closed as render seams without changing soil authority.
- Rebuilt software Chromium screenshots verified the joined cutaway rim
  and normal-view seam. `probe:soil` passed native touch depth changes,
  keyboard depth changes, both viewport layouts, actual cuts, surface
  restoration and pause/save/reload with zero console/page errors.
- Renderer follow-up review found that an unmeshable selected column could
  suppress its neighbors’ bridges. The regression reproduced that case;
  known skips now expose neighboring seams and obsolete meshes retire
  before clipping. All 19 renderer tests and scoped re-review passed.
- Physical PC/phone frame time remains unmeasured. The software renderer's
  frame rate is only evidence that the loop runs, not device performance.
- Release tree gate after all renderer fixes: 1,740 tests passed, 2
  skipped across 130 files; command above, 145.67 seconds. Production
  build passed. The skipped-column fallback also passed its focused
  regression and re-review; ordinary rebuilt browser visuals/control
  and persistence checks passed before that isolated fallback fix.
