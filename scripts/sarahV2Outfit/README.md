# Sarah v2's outfit: white tank, grey maternity leggings

## Where it stands (alpha.99 candidate, 2026-10-20)

Joshua's corrections to alpha.98, from his circled screenshots. The approved body
(`sarah-v2-body.glb`, SHA256 `47e990f0…`), the bikini top, the shirt defaults and his approved
navel are unchanged; the body is never hidden under clothes.

- **High leggings** (`leggings-fit.mjs`): corrected at every native belly key
  (0/25/30/50/60/75/100/150/200), so the lumpy native in-between shapes no longer show; a smooth
  top edge, no groin shelf, and at least 1.2 mm off her at every key (tested).
- **Low leggings** (`leggings-low-build.mjs`): their own fitted garment, copied byte for byte out
  of the approved body and fitted like the high ones, so the waistband no longer digs into her
  belly at 140–200%.
- **Shirt hems**: the spandex hem clears the high leggings; the relaxed shirt's rear flare is reduced.
- **Fitted (spandex) shirts** (`shirt-fine-fit.mjs`, both rises):
  - *The folds down her sides* (100–160%): each fit's own surface and shading are smoothed over her belly,
    except his approved navel.
  - *"3 bellybuttons"*: between two fits the shirt is their blend, and it held each fit's navel at
    part strength where her navel was at that fit, 4–5 cm apart, and none where her navel was. Each
    fit's navel is measured as a relief over the thin plate of the cloth round it; between fits, both
    come back out of the blend, and one, the approved one, goes in where hers is.
  - *Her navel poking through*: small lifts keep the cloth off her, and her skin round her navel is
    kept 0.3 mm under the cloth's surface so the outie's tip cannot come up between cloth points.
    The approved 150% fit itself had the tip 0.09 mm through; there the cloth moves out by
    0.7 mm at most, and the fit's normals are kept.
  - The fine fit lives in `shape:fineFit<key>` fields every 10% to 100% and every 5% past it
    (`SHIRT_FINE_FIT_KEYS`), blended like fit keys. `tests/sarahV2FittedShirtNavel.test.ts` checks her
    navel is under both shirts every 5% from 100% to 200%.
  - With the high leggings, the shirt also stays over the leggings the Lab draws under its hem band;
    before this, they came through at her front at 160–180%.

## Where it stood (alpha.98 recovery release, 2026-10-18)

The approved preview source is now integrated into the **live Sarah Lab, MODEL · v2-body**.
This is a reconstruction from the preserved fitting source, not a claim that the missing
old candidate GLB/commit was recovered. The complete recovery archive remains on
`recovery/sarah-v2-approved-work-2026-10-18` (commit `535029c`).

- **Protected source:** `public/models/sarah-v2-body.glb` is unchanged byte for byte:
  SHA256 `47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42`.
  All original body shapes and approved bikini-top primitives remain in that file.
  v1 geometry and posing behavior are unchanged.
- **Sliders:** v2 ARMS starts at 0°, works in STAND/WALK/SIT, supports both/left/right,
  and T-POSE sets/synchronizes 90°. All recovered garments carry the native 43 fields
  and bind to the body's live skeleton. Belly tilt and belly/breast controls update
  the clothes immediately. Native arm animation continues until ARMS is overridden.
- **Outfits:** relaxed + high leggings, relaxed + low leggings, bikini, none, spandex + high leggings, spandex + low leggings. Imported shirts load one
  variant at a time. Default shirt lengths are unchanged; there is no length slider.
- **Shirts:** the saved shoulder clearance, back-edge cleanup, fitted-bust shape,
  softer spandex hem, local spot repair, and final normal-only navel transition are
  baked from the preserved source. Relaxed fabric has no forced navel displacement.
  Spandex retains the closer-fit impression. Original approved100 position/normal/UV
  buffers survive the transfer unchanged; fitted keyframes are at0/50/100/150/200.
  Native belly keys25/30/60/75 still contribute their own curvature between those fits.
- **Leggings:** recovered high-rise lower-belly corrections are additive; original
  base, 43 native targets, skinning, and full topology are retained. A per-vertex signed
  hem field follows skinning and keeps covered pants behind the active shirt. Low-rise
  leggings remain the native garment. No body compression or global shirt inflation.
- **Bikini bottom:** continuous cloth with three openings and rounded edge bindings,
  low front center and raised hips/back. It is a separate skinned garment, not body paint.
  Approved100 construction is preserved, all43 shape/pose bindings follow the live body,
  and default size keys0..200 pass vertex/triangle-center clearance checks. Extreme
  belly-height/fullness combinations at nonconvex source folds can retain up to1.64mm
  clipping; see `scripts/sarahV2Recovery/bikini/verification-report.json`.
- **Clothing-only storage precision:** delta positions use a2^-20 local-unit lattice,
  delta normals2^-17. Rest positions/normals/UVs/indices and body data stay exact.
  The all-vertex absolute endpoint error is below0.000184cm (0.00184mm). This saves
  about23% of shirt transfer size. The approved GLBs are packaged losslessly as standard
  external glTF files with56 shared content-addressed buffers, each below4MiB, to fit
  GitHub upload limits. All decoded accessors and textures match the generated GLBs exactly. Each shirt payload remains large (66–72MB),
  so the loader keeps only the active variant rather than loading all four together.
- **Normal composition:** imported shirt CPU normal residuals are left unnormalized
  until retained GPU normal morphs are added; the shader normalizes the final sum.
  Premature CPU normalization caused a false dimple/under-bust crease at0/50 and is fixed.

### Rebuild and verify

`node scripts/sarahV2Recovery/shirt-bind.mjs --snapshots .scratch/recovered-fits --out-dir .scratch/strict-shirts`
creates strict garment-only GLBs. `quantizeShirtAsset` in the same module applies and
checks the clothing-only storage budget. Metadata is embedded in each garment. `shirt-package.mjs` repackages the accepted GLBs
into the deployed `.gltf` + shared buffer files without changing any decoded values.
`leggings-build.mjs` and `leggings-hem.mjs` rebuild the separate high-rise garment;
`bikini/build.mjs` rebuilds the continuous bottom. Their headers document arguments.
The original Meshy input and frozen fit modules are preserved in the recovery branch's
multipart archive; run its `restore_archives.py` to restore them. Offline fitting should
pass `nativeOutfitPreview:true` to `buildSarahLabScene` to avoid recursively loading the
outputs it is generating. No build script rewrites the approved body file.

`node scripts/sarahV2Recovery/review.mjs` renders the actual runtime at0/50/100/200,
front/direct-side/45°, for both shirts with both rises and for the bikini. Set
`PLAYWRIGHT_CHROMIUM` to an installed Chromium path where needed. Review sheets are in
`docs/reviews/sarah-v2-alpha98/`. Local gate: typecheck and relay typecheck pass;3775 tests pass (3 skipped),16
binding/packaging tests pass; build and boot probe pass. Runtime review has zero
console/page errors,15 working body controls,41 interpolation samples, and12 arm/pose
checks. Results and known limits are recorded with the release review.

## Next tasks

1. Device review of alpha.98, especially first shirt load time and memory on iPhone.
2. Shirt-length sliders remain **pending and separate**: independent fits, front-only
   extension option, preserve defaults and belly clearance. Do not add without Joshua's
   next instruction.
3. Optional later work: bounded collision improvements for the documented extreme
   bikini folds, raised-arm Meshy fabric folds, and garment memory/transfer optimization. Do not alter approved body,
   bikini top, shirt defaults, or approved navel shape.
4. Full cloth simulation is not implemented. This release uses fitted morph/skin
   deformation; physics experiments remain a separate feature.

The historical notes below describe the approved trials, rejected approaches, and
recovery process. New release status above supersedes older “runtime pending” notes.


What Joshua asked for (2026-10-16/17): a white knit tank top over grey knit maternity
leggings, in two styles he can switch between with OUTFIT in the Sarah Lab:

- **over the belly** (`leggings`): a high, level panel that covers the bump at every size;
- **under the belly** (`leggingsLow`): a U scoop under the bump, following his yellow outline.

The fabric is drawn at true size: the white knit is one tile per 2" × 2", the grey one tile
per 1" × 1". The leggings sit skin-tight, like body paint, and the tank stands a little off
her. His approved body (`sarah-v2-body.glb`, commit `2b9adfc`) is the source and is never
reshaped: everything here is cloth.

Joshua pushed this himself as **experimental, good enough for now** (2026-10-17) and asked
for the work to continue from here.

## Build

```
sh scripts/sarahV2Outfit/build.sh            # about 15 minutes; intermediates in .scratch/outfit
cp .scratch/outfit/a8.glb public/models/sarah-v2-body.glb
node scripts/packSarah.mjs public/models/sarah-v2-body.glb
```

The build always starts from the clothes-free body at `2b9adfc` (or `SRC=<file>`). Never
run it on a body that already wears the outfit.

## The steps, and what each one is for

| step | file | why |
|---|---|---|
| grow | `grow.mjs` → `scripts/growClothes.mjs` | grows each garment from her skin, carrying all 43 shapes. `TANK` (cut) and `UNDER` / `LEGGINGS_OVER_BELOW_TIP` (rises) live in `growClothes.mjs`. The low leggings are grown first and renamed; their skin-cover bit is kept as bit 5. |
| islands | `islands.mjs` | keeps the tank's largest piece. |
| dress | `dress.mjs`, `fabricUV.mjs` | per-side cylindrical fabric UVs in true-size tiles, plus the knit texture. |
| rebind | `rebind.mjs` | pushes cloth out to clearance as a **smoothed field** (one point's push shared with its neighbours, so a crease cannot tear), removes the ~3,000 **folds at rest** that growing along normals leaves in the crotch and groin, then binds every point to the skin under it with all shapes. |
| untangle | `untangle.mjs` | relaxes each shape's offsets where neighbouring triangles fold over (the approved body itself folds ~1,700 triangles in the groin at 0%). Capped at 6 mm; a wider setting pulled the low leggings inside her thighs. |
| bridge | `bridge.mjs` | cloth lifts **out of** crevices only (never in) at the small belly sizes; with `BRIDGE_HULL` the tank also spans the dip at her navel. |
| normals | `normals.mjs` | **the fix for the dark slits in the groin creases**: every normal shape is recomputed from the cloth's own faces at that shape. The old ones still faced the floor where the cloth was tucked under her belly at 100%. |
| trim | `trim.mjs` | a bound band along each open edge, laid at that edge's own height off her, its line and facing eased along the edge so it does not ripple. |

## Historical status (alpha.98 candidate, LOCAL ONLY, 2026-10-17)

**Preservation authorized (Oct17 local / Oct18 UTC):** Joshua approved pushing
all recovered work, explicitly including shirts and leggings. The preservation
branch is `recovery/sarah-v2-approved-work-2026-10-18`; it tracks all recovered
working sources and `recovery/sarah-v2-2026-10-18/` contains the original archives,
current working/render snapshot, human-readable review sheets and hash inventory.
Fresh preservation checks: typecheck/build passed, the full suite passed
3,752 tests (3 skipped), and 38 focused clothing tests passed. All backup
archives and working snapshot entries were hash/CRC verified.
This is a preservation checkpoint, not an alpha.98 deployment or a claim to have
recovered the missing runtime/model. Do not merge it as a substitute release.

**Continuous bikini bottom refinement (Oct18 UTC, LOCAL / review only):**
Joshua requested a natural garment in five views after the higher-hip placement
trial: curved low front, higher sides/back, smooth binding and a continuous
back-to-crotch-to-front panel. The old trial merely projected the legacy mesh,
so it retained ragged edges and collapsed its lower back connection. Preserve
that trial as history; do not build more corrections on its pinched topology.

`.scratch/bikini-garment-working/` adds `bottom.js`, opt-in only. It makes a
connected cloth surface with exactly three openings (waist and two legs), sewn
shared vertices between curved waist, front, back and crotch grids, and separate
rounded edge binding. The static fitted panel is 5,759 vertices / 11,136 faces.
The waist design is 87.5 cm at the front center, 101 cm on the sides and 104 cm
at center back in this posed reference (not a body edit). Material is a plain
rough green fabric with subtle sheen; old ragged ties are absent in this trial.
Cloth surface target offset is 1.6 mm; round binding radius is 0.65 mm. Back
fitting bridges the cleft locally. Geometry is smoothed and checked against
actual posed skin triangles, never used to reshape skin.

`shots/bikini-garment-review/` holds actual matched 100% belly T-pose renders
at front, direct side, direct back, 45° front and 45° back, a close-up, checks
and the five-view sheet. Native body arrays/indices/posed vertices and bikini
top geometry/visibility remain exact. The source GLB SHA256 remains
47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42.
Two focused tests pass, including continuous topology/three boundary loops and
actual collider fitting with immutable input. Final static checks found no
penetrating cloth vertices, triangle centers or binding vertices: minimum
clearances 1.600 mm / 1.149 mm / 0.325 mm respectively. These are sampled static
checks, not proof of collision safety during motion or at other belly values.
The harness hides only the separate legacy bottom and adds the trial garment;
no production runtime/source GLB was edited. The alpha.98 candidate is still
missing. This is an alpha.97 body-reference shape review, not release recovery.
Typecheck and build pass. The full suite passed 3,751 tests (3 skipped), with
one 5-second timeout in the existing soilView test. The isolated file rerun
passed all 21 tests without source changes (timed-out case: 1.786 seconds).
No clean second full-suite run is claimed. No push or Trello mutation.
Detailed checks are recorded in the review bundle.

**Higher-hip bikini placement concept (Oct18 UTC, LOCAL / default-off):**
Joshua approved the local navel shading comparison, then requested front/side/back
bikini views and drew a yellow guide: higher hip sides, low front center beneath
the belly, with the side band rising toward the back. The approved alpha.98
procedural bottom is still missing. `.scratch/bikini-placement-reference/` renders
the older alpha.97 bottom at 100%, in T-pose so the arms do not hide the ties.
`.scratch/bikini-hip-rise-trial/` is a separate static placement concept using that
older asset. It does not recreate or replace the missing approved bottom.

The trial holds the front center and low crotch, raises the upper sides about
5.8 cm and the rear band up to 8 cm, and fits the moved panel to actual posed skin
triangles. Source buffers, body geometry and bikini top remain unchanged. It is
off by default and invoked only by this static review harness. The legacy source
fabric/tie roughness and full pose/interpolation validation remain unresolved;
this is placement feedback, not a release-ready procedural bikini. Three focused
tests cover the smooth field, immutable/default-off behavior and actual triangle
collider clearance. `shots/bikini-hip-rise-trial/` contains the matched front,
side and back renders, geometry checks and before/trial comparison.
No push, release integration or Trello mutation.

**Current recovery status and local navel-transition trial (Oct18 UTC):**
Workspace maintenance removed the unpublished checkout and its localalpha.98
commit7b1c08c. Git main is stillbcd63ef (alpha.97). The saved spot-review bundle
restored the imported shirt sources, Meshy source GLB and approved screenshots;
it does NOT contain the entire unpublished runtime or candidate body asset
SHA25667ff41d30d75ee155d4edc696ebb65c7e987eac8155396089b5535ebbdb9fdc8.
Do not treat the current clone as that release candidate or push a rollback.
The alpha.97 model's SHA256 is47e990f0f28097efca488b4274f2cac0e0fa588904bc2c10cb00695600897f42.

The restored100% bare navel measurements and existing hybrid metrics match the
previous review exactly. The old and freshly rendered front navel crop at
pixelsx730..870,y315..425 of the matching1600x1000 close camera is pixel-identical.
Full body/native pants hashes differ, so this is a LOCAL navel comparison only,
not a claim to have restored or reverified the whole approved outfit candidate.
The approved body/GLB is not edited or rebuilt to approximate the missing file.

Joshua requested a softer ring-to-bump transition while preserving the center
and overall projection. `.scratch/tank-navel-transition-working/` keeps the saved
spot copy intact and adds `navel-transition.js`, default-off. It blends only
outer front normals in the0.65..2.4cm annulus around the existing navel, using
projected triangle-area-weighted Gaussian samples and C2 fades. The central
0.65cm core, every position, all topology/UV/materials and all outside normals
remain exact. No shirt displacement or body change is applied. A first narrow
kernel was visually negligible; the final trial uses a1.2cm kernel, sigma.45cm
and maximum blend.65. This changes shading, not the approved physical profile.
The final trial changes5632 outer normals by at most3.107degrees;1189 sampled
central-core vertices keep their normals exactly. Every surface position and
view-only body/leggings/camera/light stamp stays identical within the trial.
Only the explicit100% Spandex/high standing preview invokes the trial API.

`shots/navel-transition-review/` holds actual matched front/direct-side/45°
navel before/after views, region snapshots, metrics and the comparison sheet.
All33 focused tests pass. Typecheck and build pass on restoredmain; the full
suite rerun at two workers passes3752 tests (3 skipped), after three initial
5-second timeouts while rendering concurrently. The source/geometry checks
and fresh results are recorded with the review.
Nothing committed/pushed; Trello unchanged. Full candidate recovery remains a
separate release blocker even if Joshua likes this local visual refinement.


**Circled Spandex abdomen spot — local review ready (Oct18 UTC):**
Joshua spotted a dark fold on her right, screen-left of the navel at100%.
Actual triangle sections at worldXY(-8.5,98.5)cm found the inner sheet overtaking
outer fabric by0.996mm; the body lies4.45mm behind the outer surface there.
The crossing starts in the broad hybrid background fit and increases slightly in
the contour trial. The approved central navel is outside this repair.

`.scratch/tank-spot-working/` preserves the preceding soft-hem copy and adds
`repairSpandexSpot` (defaultfalse, Spandex/high/100%/non-bare only). `inner-spot.js`
moves39 hidden inner vertices inward, max2.069mm, within a3cm front-only patch,
with C2 fades and protected navel/hem. Front triangle coverage is mandatory;
back sheets sharingXY and uncovered regions remain exact. Edge/interior samples
and an independent staggered0.75mm raster confirm387 prior overlaps become zero
across4692 valid probes. No new/worsened sampled body or pants contacts.

That repair alone left a sharp outer shading crease. `spot-shading.js` softens
79 outer normals only in the same bounded patch toward averaged actual body
normals. Every outer position, allXY, body, bikini, leggings, navel geometry,
source indices/UVs/materials and shirt lengths remain exact. The approved navel's
front close-up pixels remain identical. The physical hem and its softened edge
are protected. A faint natural fabric fold remains; this is not a whole-shirt
flattening or a general cloth-collision solution.

`shots/tank-spot-review/` includes matching actual100% front/direct-side/45°
bikini/body, Relaxed/high and corrected Spandex/high views, close-ups and the
focused `spot-before-after.png`. Root inspected the actual images and verified
geometry/camera/light stamps, source hashes and protected buffers. Typecheck,
3766 tests (3 skipped), build and30 focused tests pass. The first inner repair
incorrectly selected back sheets; the final front-only regression is covered by
a test. The earlier soft-hem and contour previews remain preserved. This is an
ignored static standing preview; no live integration or other-size validation
is implied. No commit/push or Trello write.

**Final Spandex hem appearance review — awaiting approval (Oct18 UTC):**
Joshua identified the strong lower hem band as the remaining visual distraction.
Root compared original/normal-map-off/untextured actual renders: the band persists
without textures. Near the source hem, normals turn from down/forward to nearly
horizontal over a narrow rolled strip, producing the strong highlight.

`.scratch/tank-hem-soft-working/` copies the preceding100% contour trial and adds
`softSpandexHem` (defaultfalse, Spandex/non-bare only). `hem-shading.js` changes
normals only in the source bottom-hem strip.05–1.8cm, with C2 fades and maxblend.8,
toward actual body normals averaged at five worldXY taps. The physicalrim≤.05cm,
navel core3.5cm and all normals outside the selected field remain exact. The back
fades out. Positions, silhouettes, lengths, UVs, indices and materials never change.
This runs after the final hem weld, preserving all existing clearance checks.

`shots/tank-hem-soft-review/` has final100% bikini/body, Relaxed/high and softened
Spandex/high front/direct-side/45° sheets, lower-belly closeups and hem before/after.
Identical view/lighting settings; geometry stamps exactly match the preceding
trial for every view. The central navel close-up pixels are identical.14,852 hem
normals change with zero outside/core/position/index/UV/material errors. The bright
band is softer in all three views; its fixed front-region peak mean luminance
falls180.6→168.6. Body, high leggings, navel and all shape/fit code stay unchanged.
Typecheck,3766 tests (3 skipped),build and24 focused tests pass. No commit/push or
Trello write. This remains an isolated standing preview; live imported-shirt
integration, other-size contour interpolation, length sliders and physics remain
pending. Prior previews are retained.

**100% contour-preservation trial — awaiting Joshua's review (Oct18 UTC):**
The requested bikini/Relaxed-high/Spandex-high comparison uses the same lighting,
cameras and scale. Body and high-pants geometry are identical across the clothed
cases; the flatter appearance came from uneven shirt stand-off, not body volume.
At worldY105cm, the old fitted shirt's radial gap was2.1mm on the centerline versus
10.6–13.1mm at30–60 degrees. The max-smoothed radial fit/lower refit and the approved
closer central hybrid produced that mismatch; the latest hem pass was not its
main cause. Stage-by-stage triangle sections are retained with the review.

`.scratch/tank-shape-preserve-working/` copies the preceding working fit and adds
one default-off `preserveBellyContour` experiment, gated to Spandex/high/100% only.
It reduces excess flank stand-off toward6mm using actual body/garment/pants rays,
with an8mm inward cap, a locked3.5cm navel core and smooth fades outside that core.
The existing hem safety pass still follows it. Body, leggings, approved navel
helpers, Relaxed drape, shoulders/back, neckline and default lengths stay unchanged.
Full-strength flank gap mean improves from11.96mm to6.17mm and variance from
.07884 to.002052cm². Across the entire fade region, mean decreases12.78→8.71mm,
while variance increases.07854→.10233cm² because the edges remain protected; those
figures are recorded rather than hidden. This is a bounded fit trial, not a claim
of a uniform whole-shirt offset or physics.

`shots/tank-shape-100-review/` contains matching100% front/side/45° and close views,
three-way before/after sheets, a fitted-shirt before/after, measurements and ZIP.
Root verified12,427 central navel positions exact, every shirt vertex height exact,
body stamps and all high-pants positions exact, plus no new/worsened sampled skin
failures and zero sampled hem failures. Typecheck,3766 tests (3 skipped),build and
22 focused tests pass. Previous approved preview remains preserved. The new trial
is only100%; other-size interpolation/live integration is still pending and must
not be inferred from this review. Nothing committed/pushed; no Trello write.

**Latest focused correction — awaiting Joshua's visual approval:**
`.scratch/tank-high-hem-working/` preserves the approved fit and adds a default-off
`highHemCorrection` trial for the imported shirts with high leggings only.
The high leggings ease outward across the lower abdomen at worldY82–94cm, with
C2 fades82–84/90–94cm and an8mm cap. The groin atY≤82cm keeps its original positions
and normals exactly. The initial broader fade introduced12 skin contacts at200%;
the narrower fade preserves their original clearance. The belly/body asset and all
approved shape keys are unchanged. Normals follow the same radial deformation's
inverse-transpose Jacobian, including existing morph normals and skinning; the
rejected face-delta method's new shading seams are removed.

The shirt hem correction is radial and limited to the bottom3cm of source fabric
(full strength through1.5cm), capped at10mm. Every shirt vertex retains its height;
default lengths stay unchanged. The approved central navel (including the±20mm
profile guides) is protected inside2.5cm, with the existing3.5cm fade. Relaxed
retains its approved drape and skips the navel pass. Existing shoulder/back cleanup,
bikini, low leggings, source neckline and fit routines remain unchanged.

At150%, retained whole pants triangles crossed the approved navel where it meets
the hem. A finer high-pants fragment visibility mask now follows the actual shirt
edge in this small front region: cos(theta)≥.7, navel XY radius3.5cm, hem..hem+3cm.
Its1024 angular cells bound actual triangle/edge/vertex coverage; CPU checks and
shader use the same Float32 cell bounds. The numeric tolerance is.0001cm, with no
neighbor padding. Actual150% boundary spread is.0235mm and extra lowering below
boundary minima is.00923mm. Skin checks use the full affected pants mesh; hem
checks use the visible pants after index/fragment masking. Full physical cloth
collision remains pending.

`shots/tank-high-hem-review/` contains42 fresh actual images: both shirts with high
leggings at0/50/100/150/200%, front/direct side/45°, plus100/200% lower-belly/groin/hem
close-ups. Lighting and camera settings match. View-only geometry stamps stay
unchanged. All scoped sampled skin/hem checks pass at.25mm/.5mm minimum clearance;
protected body/navel, heights and outside-region positions remain unchanged.
The approved body stamps match the preceding fresh-session review at common sizes.
Both fits also pass the frozen-time sequence25/75/100/125/150/175/100%; the repeated
100% source/posed/morph/index state matches exactly. Continuous-field tests cross
grid-cell boundaries. These checks cover standing previews and sampled surface
points; pose-wide/runtime validation remains pending.

Review sheets: `spandex-five-size-review.png`, `relaxed-five-size-review.png`,
`spandex-closeups.png`, `relaxed-closeups.png`, and100% before/after sheets. The
review ZIP includes raw images, measurements, checks, reproduction scripts and the
Meshy source GLB. `validation.json` records the frozen source hashes and results.
Typecheck,3766 tests (3 skipped),build and19 focused preview tests pass.
No commit, push or Trello write. Await explicit “Approved, push it.” Imported-shirt
live integration, independent/front-only length sliders and cloth motion remain
pending; current default lengths stay unchanged.

**Earlier visual verification:** Joshua approves the Relaxed drape correction,
shoulder clearance, rear neckline and both leggings. He has not approved a push.
The shirt-length slider remains **not implemented**, including independent lengths
and front-only extension; default lengths remain unchanged. Do not add it during
this verification request.

`shots/tank-final-body-review/` contains 24 fresh actual renders: bikini and approved
Spandex + low leggings at0/50/100/200%,each front/direct side/45degrees. Lighting,
camera target/distance/FOV,viewport and sheet crop are identical. All view-only
source/posed/morph/index stamps match before/after. The approved body asset SHA
matches; all fit/navel/contact/mask modules are byte-identical to the previous
snapshot. Fresh-session Spandex100 full-shirt/navel hashes match the approved fit.
No geometry changes made. Two view-only tests pass; the preceding full checks
(typecheck,3766 tests with3 skipped,build) remain passing with production code
unchanged. No new circular navel ridge or obvious bikini clipping was identified
in these standing views. Existing lower-edge faceting remains; the200% shirt hem
is above the exposed navel. This does not verify every pose or all-face collision.

Review sheets: `bikini-four-size-review.png`, `spandex-four-size-review.png`;
paired per-size sheets and raw images in `sarah-v2-final-bikini-spandex-review.zip`.
View-only reproduction is `.scratch/tank-final-body-review-preview/` and
`.scratch/tank-final-body-review-probe/`. Still static fits; live imported-outfit
integration, cross-style state resets and physics remain pending. No push or
Trello changes; await explicit “Approved, push it.”

**Approved Relaxed correction (preceding review):** `.scratch/tank-relaxed-drape-preview/`
restricts the approved closer navel corrective to **Spandex only**. The previous
shared call accidentally forced the same navel/circular patch onto Relaxed.
Relaxed now skips that pass entirely and keeps its original `fitRelaxed` drape;
no replacement navel, circular smoothing patch or body edit is added. The fit,
shoulder/back contact and leggings-mask modules are byte-identical. Spandex100
fresh-session full-shirt position and protected-navel hashes match the preceding approved
snapshot. Both rises have fresh 50/100/200% front/direct-side renders in
`shots/tank-relaxed-drape-review/`, with `relaxed-low-comparison.png`,
`relaxed-high-comparison.png` and `sarah-v2-relaxed-drape-review.zip` as deliverables.
Typecheck,3766 tests (3 skipped),build and two new branch-regression tests pass.
The regression reloads the preview before comparing Spandex against its fresh-session
baseline; a mixed-fit sequence produced a different snapshot. Cross-style live
state/reset behavior is still part of pending runtime integration validation.
This supersedes the Relaxed navel images in the preceding review; its Spandex
and back-edge approvals stand. Static fit preview only; no live integration or
physics added. Nothing pushed and Trello untouched.

**Joshua's approved navel baseline (latest decision):** keep the previous closer
fit in `.scratch/tank-hybrid-closer-preview/` unchanged. He prefers its softer
center and side profile; the later `.scratch/tank-hybrid-rim-preview/` trial is
rejected because its central ridge is more obvious and its side looks pointier.
Do not apply that trial or any optional final navel smoothing. No push until final
review and his explicit push approval.

Back-edge cleanup is complete in the local static preview
`.scratch/tank-backedge-layering-preview/`. The narrow shoulder-boundary taper,
central rear-neckline contact and bounded outer-sheet separation guard remove the
visible rear neckline embedding while retaining shoulder-top clearance. All 16
shirt/leggings/size combinations at 0/50/100/200% pass scoped sampled contact and
correction-induced layer checks; no new or worsened layer flags. The minimum
sampled strict-core face clearance is 0.258 mm against a 0.25 mm requirement.
Existing folds/armhole problems and inherited sheet crossings elsewhere are not
claimed fixed. Protected navel position hashes before/after contact match.

Final image QA also caught high-waist leggings showing through the closer shirt
at the navel. A high-leggings-only draw-index mask now hides covered pants faces
using conservative actual shirt coverage. Original indices are retained for exact
reset; shirt, body and leggings positions are unchanged. Low-rise is untouched.
The final review is `shots/tank-backedge-layering-review/`: 8 fresh high-rise pairs,
8 unchanged low-rise pairs plus bare/bikini and back comparisons reused from the
identical preceding back-edge snapshot, with provenance recorded per frame.
`back-edge-comparison.png`, `approved-navel-retained.png`, `outfits-100.png` and
`sarah-v2-final-fit-review.zip` are the review deliverables. Typecheck, 3766 tests
(3 skipped), build and 14 focused geometry tests pass. These are static fit
previews: imported-shirt live outfit integration and cloth physics remain pending.

Trello is read-only until an approved push; Joshua requests one summary then,
not updates after each local change. Nothing has been pushed.

Rejected trial (preserved for history): Joshua asks for a more defined main navel circle and a smoother outer
halo, retaining the peak and +/-10/20 mm guide heights. This is isolated in
`.scratch/tank-hybrid-rim-preview/`; previous fits are preserved. The center's
half-relief radius is measured from posed bare skin (7.25 mm in the 100% render),
with a bounded 0.397 mm inward core adjustment. C2 quintic profile segments and a
curvature-matched outer blend replace the prior C1 joins. The resulting profile
stays monotone; it adds no raised geometric ring. This is a visual trial, not a
claim that all shaded halo is gone. Root's 100% front/direct-side comparison and
actual skin/old/new mesh sections are in
`shots/tank-hybrid-rim-preview/navel-rim-review.png`; reproduction lives in
`.scratch/tank-hybrid-rim-probe/`. The four requested heights remain within
0.01 mm; tip offset stays 1.301 mm from bare skin. Sampled inner core faces remain
at least 0.352 mm clear, without sampled 0.25 mm violations. Four focused tests
pass; hashes confirm approved body/source GLB and previous closer-fit modules
unchanged. Shoulders are unchanged in this navel pass: the top clearance fix is
included, but the disclosed back boundary/layer cleanup remains pending.

Newest navel preview: Joshua asks for fabric about 50% closer to skin, with graph
heights 7.5 mm at along-belly +/-10 mm and 3 mm at +/-20 mm, maintaining a smooth
curve. `.scratch/tank-hybrid-closer-preview/` preserves the previous hybrid and
adds a C1 Hermite profile calibrated to those shared-tangent coordinates at 100%.
The surrounding stand-off is halved, fading broadly into unchanged fabric below
the chest rather than making an abrupt small circular depression. Actual bare skin
plus clearance remains a lower bound; no body or approved shape is edited.
Root-rendered 100% mesh sections measure 7.498/7.496 mm at -10/+10 mm and
3.000/2.999 mm at -20/+20 mm (all within 0.01 mm of the request). The outer tip
is 1.301 mm ahead of the actual bare navel; sampled inner core faces remain at
least 0.383 mm clear, with no sampled violations of the 0.25 mm minimum.
Three focused tests pass; protected body/source GLB hashes match. This is a
100% navel-shape preview only: other sizes/outfits and the wider lateral fabric
transition/faceting are not validated or cleaned up by this pass. No push.
Review image: `shots/tank-hybrid-closer-preview/closer-hybrid-review.png`.
Raw front/side renders, actual geometry and measurements are beside it;
`.scratch/tank-hybrid-closer-probe/` contains reproduction scripts.

Latest investigation: Joshua requests a hybrid based on v1's red athletic tee.
The reference is `scripts/fitAthleticTee.mjs`, not only `growClothes.mjs`.
The grown tee records `_SKIN_AT`; the athletic fitter follows that material
correspondence onto softened approved skin, with 95% trunk reach, a 4 mm nominal
inner-face offset and a 2.5 mm real-skin clearance check. It preserves separate
layers and carries skin shapes/weights; there is no separate navel dome in that
fitter. These millimetre settings describe v1, not a newly accepted v2 fit.
Recommended v2 experiment: use the actual posed bare navel as the absolute cloth
reference, apply a small clearance and narrowly soften sharp transitions. Preserve
the navel's local footprint/detail rather than broadening it into a mound. Do not
add its relief again atop the imported shirt baseline.

Joshua approved a local hybrid preview. `.scratch/tank-hybrid-preview/` now uses
actual posed bare skin (0.5 mm raster, at most 1 mm smoothing neighbourhood) and a
compact smooth maximum with the existing cloth baseline. Keeping that cloth floor
is essential: the first skin-following patch lowered the surrounding fabric and
created a circular depression; its diagnostic renders are preserved separately.
The corrected preview adds no synthetic navel height. At 100/150%, its rendered
outer tip is 1.233/1.236 mm ahead of the actual bare tip, versus approximately
9.96 mm in the old 100% dome preview. Sampled inner faces stay at least
0.337/0.330 mm from bare skin in the 18 mm navel core, with zero sampled points
below the 0.25 mm minimum. This is sampled local clearance, not an all-pose or
full-garment guarantee. Outside-field positions stay exact; shoulder helpers are
unchanged. Four focused tests and typecheck pass. Original v2-body and imported
Meshy GLB SHA256 checks pass; v1 and approved shapes were not edited.
Root-rendered front/side skin and hybrid comparisons at 100/150%, actual mesh
cross-section graphs and a full 100% outfit are in `shots/tank-hybrid-preview/`;
`hybrid-review.png` is the review image. Reproduction is in
`.scratch/tank-hybrid-probe/{probe.mjs,compose.py}`. These are static experiments,
not integrated outfits or cloth physics, and have not been pushed.

**Do not push until Joshua explicitly says “Approved, push it.”** No approval has been given
for this candidate. Main is still alpha.97 (`bcd63ef`). A workspace cleanup removed the earlier
unpublished alpha.98 checkout; this candidate reconstructs its documented behavior from main,
then adds the garment smoothing follow-up. It is not a byte-for-byte recovery of that checkout.

Separate from the alpha.98 outfit candidate, Joshua's imported Meshy tank is being fitted in
isolated static previews. The accepted Relaxed fit and first Spandex fit are preserved;
`.scratch/tank-spandex-rounded/` adds a bust-only correction that follows the approved body
more closely and preserves the original neckline rim and lower fit. Its front/side review
is in `shots/tank-spandex-rounded/`. These experiments are not integrated outfits and have
no cloth physics. The preview harness and rendered review are also retained in the review ZIP.
The four-size bust correction preserves the collar rim/lower fit and adds no new sampled
overlaps. A pre-existing upper transition overlap remains at 200%; that fit is not validated.
The follow-up center-chest dent correction is isolated in
`.scratch/tank-spandex-chest-smooth/`, with renders in `shots/tank-spandex-chest-smooth/`.
It eases only the small dip below the front neckline, retaining the broader cleavage and
rounded breast contours. Previous fit previews remain preserved.
The remaining rectangular lip was the source inner fabric sheet crossing the outer sheet:
the layers use different coarse triangles and lose separation during fitting. A local,
tapered inner-sheet correction of up to 3 mm removes that lip while leaving the exterior
fixed after the small valley correction. Both fabric sides remain rendered.
The root-run 0/50/100/200% review passes the local sheet-order checks (1,044 rays per
size) and body clearance, collar-rim and exterior preservation checks. No length control
or cloth simulation is implemented.

The latest Meshy preview, `.scratch/tank-spandex-lower-fit/`, refits the lower shirt
to the existing body with a small fabric gap. The old 98–105 cm snug/relaxed transition
created a lower-front shelf, while the relaxed back left a large flare. A shared
all-around radial fit now fades back into the preserved upper shirt over 108–116 cm.
The shirt stays separate from the body; all garment Y values, its length, and upper
positions at Y>=116 cm stay exact. A 0.8 mm inner-only thickness guard protects the
two fabric layers without changing the visible outer fit. Review renders are in
`shots/tank-spandex-lower-fit/`; earlier previews remain preserved.
The final root-run four-size review passes all 1,233 sampled lower-sheet rays per size,
with no final layer crossings and positive body clearance. The upper/chest geometry,
shirt height, body and source buffers remain unchanged. This is still a static preview.
The latest unchanged-fit comparison is `shots/tank-spandex-six-size/`: direct front/side
at 0/30/60/100/150/200%, with matching camera scale and separate comparison grids.

Joshua's next imported-shirt polish is isolated in `.scratch/tank-final-polish/`.
It retains the Spandex and older Relaxed fits and can show either with the high or
under-belly leggings. The requested garment-only navel target is now 40% diameter
and 75% relief (the production alpha.98 fields remain at their earlier 70% relief).
The marked shoulder and small upper-center chest dents receive local smoothing;
the neckline rim, hem height, approved body and source model buffers are protected.
Actual indexed outer-surface measurements, shell order and skin clearance are checked
separately. The completed root review in `shots/tank-final-review/` contains 26
front/side pairs: both shirts with both leggings at 0/50/100/200%, plus navel
80/100/150% and upper-fabric before/after close-ups. All source/protection checks,
sampled navel skin/shell clearance, and no-new/no-worsened upper/lower sheet checks pass.
At 100%, visible navel diameters measure approximately 37–40% and relief 75–76%
of the preceding fit. At 150%, the hem truncates the vertical measurement;
at 200%, the navel is outside the imported shirt and its garment correction is skipped.
Existing upper-fit limitations remain. Typecheck, tests and build pass. The
`final-shirt-review.zip` archive includes the reproducible preview harness.
These remain static experiments, with no imported-shirt production integration
or push approval.

Latest diagnostic after Joshua's black-skin/blue-fabric sketch: the measured 100% vertical
centerline graph exposes an error in the preview's reference frame. The bare navel
stands 10.535 mm above the local belly tangent; the current rounded-shirt tip stands
20.498 mm above that SAME tangent, or 9.963 mm beyond the actual bare tip. The preview
added full navel relief to an already offset fabric baseline. Preserving physical
projection should reference the actual skin tip, not add another full bump to the
existing shirt surface. Joshua's intended blue fabric curve spreads smoothly over
the real navel. `shots/navel-profile-graph/` contains measured curves plus a clearly
illustrative 2D smoothed-envelope proposal (not fitted, simulated or applied).
No model or preview geometry was changed for this graph. The prior rounded preview
below remains preserved but is NOT the final accepted navel fit. Next: review the
black/blue profile relationship, then use the actual body envelope/skin-tip reference
for a separate garment-only fit; remeasure and render before any push.

Latest imported-shirt preview (LOCAL ONLY): Joshua clarified **40% remaining navel
diameter (1 inch → 0.4 inch), with 100% of the bare body's outward projection**.
The first round quartic profile looked too pointed. `.scratch/tank-rounded-dome-preview/`
now uses a half-ellipsoid apex with a smooth rim blend; its base remains 14.4 mm and
its 100% relief remains approximately 10.535 mm. The actual 90%-height radius grew from
about 1.59 mm to 3.11 mm, making the tip broader without reducing depth. This supersedes
the preceding 75%-relief Meshy experiment only; production fields are not changed here.
The 0% innie is not turned into an outie.

The final frozen root harness is `.scratch/tank-round-review-v2/`, and the review is
`shots/tank-round-review-v2/`. It contains 26 actual front/direct-side pairs: both
imported fits with both leggings at 0/50/100/200%, bare/cloth navel views, pointed/rounded
comparison, 80/150% navel close-ups, and shoulder before/after views. At 150%, this
review retains full local dome coverage; at 200%, the navel is below the existing shirt
cut and the garment correction is skipped. Shirt length remains unchanged.

Only the shoulder tops receive skin contact correction: source |X| 8–25 cm/Y>137 cm,
with a Y fade to a strict core at 140 cm. A measured curvature allowance, capped at
2 mm, keeps the sampled fabric between vertices above skin. All 19 distinct enabled
review poses pass core vertex/face-probe checks; the minimum sampled core face gap is
0.2557 mm. An independent triangle-distance check samples 1,046 core points per fit at
100%, with none inside skin or below 0.25 mm. The shoulder pass leaves every position
outside its field exact, preserving the fitted chest/lower shirt. The separate local
navel correction is the only authorized change there. The approved body, original
Meshy GLB and ten protected previous/source files remain byte-identical. Typecheck,
3,766 tests (3 skipped), build, and 13 focused geometry/protection tests pass.

**Full-shirt collision is not implemented or accepted.** The broad contact attempt
splits embedded armhole points across opposite arm surfaces and makes unrelated
inner/outer sheets cross. A proposed outer-shell extraction also failed its topology
gate (59 boundary components, including 14 branched components); it was stopped before
changing a garment. Those diagnostics remain in `.scratch/tank-round-clearance/`.
The scoped top correction still flags a few back boundary layer rays around current
Y 138–139.5 cm and source |X| approximately 8 cm, adjacent to the correction mask.
These are exposed for review, not claimed repaired or hidden by a global clearance
claim. No runtime cloth simulation, imported-shirt integration, body rewrite or push.

- v2-body ARMS now overrides STAND, WALK and SIT, including the selected side's corrective;
  its default is 0°, T-POSE selects 90°, and the slider stays synchronized. v1 behavior is unchanged.
- The bottom is generated by `scripts/sarahV2ProcBikini/bottom.mjs`: measured legacy outline,
  pelvic front panel, skin-bound rear, inherited edge motion and small hip ties. The approved top
  and original body attributes/43 targets are untouched.
- Nine `shape:clothedNavel*` CPU fields are appended with zero defaults. The Lab interpolates
  them only while covering garments are worn. They target 40% width/height and 70% relief;
  bare and bikini keep the approved navel. `navel.mjs add` precedes growing garments;
  `navel.mjs cloth` retargets their fields after fitting and trims.
- Joshua's lower-belly/hip/groin roughness is partly in the approved body. Matching bare,
  textured, plain and recomputed-geometric-normal renders confirm the cloth adds real surface
  ripples, not only texture or stale normals. `fair.mjs` removes small garment ripples with
  welded Taubin fairing, capped at 5 mm for the tank and 4 mm for leggings, with an eased
  lower-torso mask. The navel, approved body, bikini and unrelated regions are excluded.
  It softens cloth; it does not remove the approved body's underlying anatomical crease.
- Trims are regenerated after fairing. Body protection was checked by comparing 668 accessor
  buffers against main: body attributes (except clothing cover bits), indices and first 43
  targets, plus all 12 approved top primitives, remained byte-identical before packing.
- Final packed asset: 36.2 MB, 42 primitives, 52 targets (23 GPU and 29 CPU fields).
  The same 668 protection checks also pass after packing. `npm run typecheck`, `npm test`
  (187 files / 3,766 tests passed; 1 file / 3 tests skipped) and `npm run build` pass.
  The rendered review covers 0/50/100/200%, front/direct side, both tank outfits, bare skin,
  bikini and their close-ups. The bottom's sewn side joins are checked at 0% and 200%.

Review command (actual Sarah Lab scene, no generated imagery):

```
PLAYWRIGHT_CHROMIUM=/path/to/chromium REVIEW_VALUES=0,50,100,200 \
  REVIEW_OUTFITS=0,1,2,4 REVIEW_MODES=full,navel,edges,groin \
  node scripts/probe-sarah-v2-outfit.mjs
```

Each PNG contains direct front and side views. `REVIEW_ASSET=/absolute/model.glb` selects
an intermediate without changing the shipped file; `REVIEW_MATERIALS=plain,geometric`
isolates positional folds from texture and additive normal shading. The probe never installs
a browser. Tests cover actual scene sliders/outfit transitions and pure corrective geometry.

### Previous deployed baseline (alpha.97)

Done and in the Lab:
- `sarah-v2-body.glb` now wears the outfit (39 MB packed, up from 19 MB: three garments x 43 shapes plus trims).
  OUTFIT on v2: `tee + leggings` shows the tank over the high leggings, `top + low leggings` the tank over the
  under-the-belly ones. v1 is untouched (its outfits are unchanged; the low-leggings outfit is skipped on v1).
- The skin under each worn garment is masked, the low leggings included (cover bit 5).
- Trims show with their garment; the high leggings' waistband trim hides under the tank.
- **Groin creases are clean on both leggings at every size.** The dark tears were not holes: the cloth's normal
  shapes were stale (fixed by `normals.mjs`), and growing cloth along normals left ~3,000 folded edges at rest in the
  crotch and groin (fixed in `rebind.mjs`).
- **Tank hem**: one level, continuous hem round the hips (`TANK.hemFront` / `hemBack` in `growClothes.mjs`) instead of
  one that dipped toward the waistband and broke into flaps; its band no longer ripples (`trim.mjs`).
- **Cleavage seam at 0.5x bust**: gone with the smoothed clearance push.

Measured (`bumpw.mjs`, front centreline, her navel at quarter height):

| | her skin | leggings | tank |
|---|---|---|---|
| 100% | 36 mm tall, 15.4 mm high | 38 mm | 42 mm |
| 200% | 36 mm, 26.0 mm high | 38 mm | 46 mm |

In side-by-side renders (her skin / tank) the navel and nipples DO read clearly bigger through the tank than on
her skin, more than the centreline numbers suggest: the tank stands 7 mm off her, 12-16 mm over the leggings on the
bump, and a small bump through cloth grows by about twice that.

Tried on 2026-10-17, all left in `rebind.mjs` but OFF by default (each env setting turns one back on):
- `DEFLATE_MIN`: draw the cloth in toward its own smoothed surface over small bumps. Made the bump lower but WIDER.
- `SMALL_BUMP_MIN`: hold the tank its clearance off her *smoothed* skin over real bumps. Barely changed the navel and
  broke the hem.
- `BIND_UNDER`: bind each tank point to the skin straight beneath it rather than the nearest. No measurable change.
The next thing to try (started, not finished): bring the tank in, `shirt:0.004:leggings:0.0015` in `build.sh` (4 mm
off her, 5.5 mm over the leggings) instead of `shirt:0.007:leggings:0.005`. A maternity tank hugs the bump; the
inflation scales with that distance. Check the leggings never show through it.

## Still to do (in order)

0. **Navel and nipples under the tank read bigger than hers** (Joshua, 2026-10-17: make sure they are not exaggerated from her normal proportions). See the table above; target: within a few mm of her skin's size through each layer.
1. **Tank at 0% belly**: the navel still reads as a soft dimple. A tank should mostly bridge it.
   The `BRIDGE_HULL` lift helps; widening its smoothing or applying it to `navelFlat` too is the next try.
2. **Tank hem at 200%**: the hem rides up under the bump at the front and a strip of leggings shows. Probably wants a lower front hem at the big sizes only (a shape, not the cut).
3. **Low leggings**: a small speck of skin can show at the right groin at 0% in the scratch renderer.
   In the Lab the low leggings now mask the skin under them (bit 5), which should hide it; check on the phone.
4. **The 0% crease under the belly** is a clean line now but a little hard. That is the approved body's shape; do not change the body.
5. **File size**: 39 MB for the phone. Worth checking load time; trims and the two leggings could be split into their own file later.
6. **Next big piece**: the Clothing and Body Paint Designer, reusing the ribbon and binding modules here and in `scripts/sarahV2ProcBikini/`.

## Historical task handoff (Joshua, 2026-10-17, from his phone on the deployed alpha.97)

Current priority: Joshua reviews `shots/bikini-garment-review/` (five angles at
100%) and the continuous bottom in `.scratch/bikini-garment-working/`. This
supersedes the old pinched placement concept for review only. Do not treat a
visual approval as permission to push, change the approved body, or integrate
against an older release. The approved alpha.98 candidate remains unavailable;
restore it exactly before release integration and full outfit regression.
After visual approval, bind the new additive/default-off garment to that exact
candidate and verify other poses and the complete 0–200% belly range before
claiming runtime readiness. The approved local navel shading, body, bikini top,
Relaxed drape, shirt lengths, soft hem and both leggings remain protected.
Length sliders remain pending. The recovery-branch push is authorized; update Trello once after verifying the
remote checkpoint. Any later release still requires restoration and verification
of the exact candidate, not substitution of this alpha.97 reference.

Historical rejected trial: The existing round-dome navel preview is not
approved: the measured 100% shirt tip is approximately 9.96 mm ahead of the actual
bare navel tip. `shots/navel-profile-graph/` documents that mismatch; its blue curve
is illustrative and was not applied. `.scratch/tank-round-review-v2/` remains the
preserved root-rendered source for the earlier shoulder/four-outfit review, not a
validated final navel fit. No push until Joshua explicitly says “Approved, push it.”

Remaining for this imported shirt:

1. Retain the approved shoulder/back cleanup and navel. Complete the focused
   high-legging/hem visual review above before any release integration.
   Inherited source folds/armhole issues still need pose validation.
2. A full-garment collision system needs a coherent cloth surface/binding. Current
   source inner/outer tessellations and embedded armholes fail that requirement.
3. Runtime outfit integration must carry every slider, trim and pose, including ARMS,
   and remain additive/default-off without changing any approved body or shape.
4. Adjustable length and lower-half cloth motion remain proposed, not implemented.

Previous Meshy-tank experiment: Joshua reviewed the local navel/upper-fabric polish in
`.scratch/tank-final-polish/`, with both Spandex and Relaxed shirts and both leggings.
The root review covers 0/50/100/200% front/direct side, navel close-ups at
80/100/150%, and before/after shoulder/chest close-ups. Earlier previews are preserved.
The 150% navel/hem junction remains a visual-review limitation; no shirt length control
has been added. No new belly or body shape is authorized by this garment pass.
After fit approval, validate
the upper cut/armholes and pose binding before adding the proposed lower-half cloth motion;
retain the stable upper shirt and controlled breast/belly expansion. No solver is implemented.
The isolated preview does not replace the production review/approval gate below.
Joshua also asked whether shirt length can be adjustable. Proposed behavior: a lower-section
LENGTH control, with the existing length as its default, keeping the upper fit stable.
This control has not been implemented; the current pass refits the lower shirt at its existing length.

The original three tasks below are implemented in the local alpha.98 candidate. Review the
new rendered 0/50/100/200% front/side sheets, navel skin/tank comparison and bikini edges,
then obtain the explicit push approval. The follow-up garment fairing is also local only.

Remaining after this candidate:

1. Joshua reviews the lower-torso smoothing. The broad 0% body crease remains approved geometry;
   any further body smoothing must be a new, default-off shape, never a rewrite of the body or keys.
2. Check tank hem coverage at 200% and the extreme shape sliders on the phone; those older
   fit limitations are not resolved by small-surface fairing.
3. Continue the clothing/body-paint designer only after this review; no new customizer scope here.

### Original acceptance criteria (implementation history)

Start from the latest `main` (`git pull`); alpha.97 or later is the base.

1. **Sliders and clothing.** The ARMS slider reads 90° but her arms stay down while standing. BELLY TILT and some
   other sliders seem to do nothing, or the clothes don't follow the new size. Check every control on v2-body,
   with each outfit:
   - BUMP, the BELLY SHAPE fields (tilt, height, width, depth, upper/lower) and the breast fields;
   - ARMS, plus WALK and SIT.
   Find which drive the body but not the garments or trims. The body-shape fields are lifted off the GPU and
   applied on the CPU (`src/view/bodyShapeView.ts`). Make sure the garment and `*Trim` primitives are lifted
   and driven too, and that every shape the body has is carried by every garment primitive.
2. **Bikini bottom.** It looked fine in screenshots but on the phone the green print has rough, jagged edges and
   the side ties are messy. Redo it procedurally, like the approved top (`scripts/sarahV2ProcBikini/`): smooth
   ribbon edges, its fabric painted on her skin inside them. Keep the current bottom's shape, cleaned up.
   Joshua can draw the exact outline if wanted. The top is approved; don't touch it.
3. **The navel under clothes (the main one).** While the tank and/or leggings are worn, her navel's round front
   (height and width) should be **60% smaller**, and its depth (how far it stands out) **30% less**. With no
   clothes or with the bikini she stays exactly as approved.
   - Build it as new shapes that are off by default. Don't change the approved body or any approved shape.
   - The navel's size comes from several shapes at once (`navelOut`, `navelFlat`, the belly keys). So one added
     shape won't hold at every size: check 0, 50, 100, 140 and 200%.
   - The garments must carry the new shapes too (rebuild with `build.sh` from a body that has them).
   - The Lab turns them on only while a garment that covers the navel is worn.
   - Compare skin vs. through-the-tank renders at each size.
   Bringing the tank closer (see above) helps too.

## Rules that came with it

- Do not change the approved body or its morphs.
- No push without Joshua's explicit OK after he sees rendered screenshots (his 2026-10-17 OK covered this push only).
