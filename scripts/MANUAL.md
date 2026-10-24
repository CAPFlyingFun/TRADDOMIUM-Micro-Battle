# scripts/

Every file in this directory is one of two things:

- **Wired.** A `"scripts"` entry in `package.json` names it, so
  `npm run <name>` is how it runs. `package.json` is the list of wired
  scripts; this file does not repeat it, so the two cannot drift.
- **Manual-only.** It is run by hand, and it is listed in this file
  under the `# Manual-only` heading below with one line saying what it
  does and how to invoke it.

`tests/scriptsWired.test.ts` fails when a file is neither, when an npm
script points at a file that no longer exists, when a manual-only
listing names a file that no longer exists, or when a file is listed as
manual-only but is wired after all.

## Why the rule exists

v0 accumulated 29 orphaned probes and nobody could tell which were dead
and which were load-bearing, so nothing could be deleted and nothing
could be trusted. The rule is ARCHITECTURE.md §2.12 and one of the
engineering invariants in CLAUDE.md: the answer to "is this script
alive?" must always be in one of two files.

## Adding a script

1. Prefer wiring. Add `"probe:<name>": "node scripts/probe-<name>.mjs"`
   (or a `bake:<name>`) to `package.json`. A probe that is wired is a
   probe someone can run without reading its source first.
2. List it here only when it is genuinely run by hand: a one-off bake
   whose arguments change every time, or a tool that needs something the
   repo does not ship. Say what it does and give the command.
3. A helper module that a wired script imports is never run on its own,
   so it cannot be wired; list it here with the name of the script that
   imports it, so the reason it exists is written down.

## The allow-list

Everything between the `# Manual-only` heading and the next heading is
the allow-list. Every `scripts/...` path written in that section counts
as listed, prose included, so a path is written there only to list it.

# Manual-only



- `scripts/sarahV2Recovery/review-details.mjs` — Sarah v2 recovery builder or manual verification probe; see the outfit README.
- `scripts/sarahV2Recovery/shirt-package.mjs` — Sarah v2 recovery builder or manual verification probe; see the outfit README.
- `scripts/sarahV2Recovery/shirt-package.test.mjs` — Sarah v2 recovery builder or manual verification probe; see the outfit README.
- `scripts/sarahV2Recovery/verify-sliders.mjs` — Sarah v2 recovery builder or manual verification probe; see the outfit README.
- `scripts/sarahV2Recovery/shirt-lite.mjs` — writes `public/models/sarah-v2-spandex-lite.glb`, the light spandex tee Sarah opens in, from the archived 81 MB modelled tee (Joshua, 2026-10-23): simplified for every belly size at once, her navel's cloth kept whole, the bust laid again; measures what it gave up and refuses past 1.5 mm. See `docs/reviews/sarah-light-tee/README.md`.
- `scripts/sarahV2Recovery/shirt-bust.mjs` — the bust laying `shirt-lite.mjs` uses: each breast shape smoothed over the cloth and held off her grown skin, so the SIZE and shape sliders no longer crease a modelled shirt.
- `scripts/sarahV2Recovery/shirt-bust.d.mts` — the types for `shirt-bust.mjs`, so `tests/sarahLightTee.test.ts` can try it on a toy.
- `scripts/sarahV2Recovery/shirt-cloth.mjs` — writes `public/models/sarah-v2-spandex-cloth.glb`, the CLOTH SIM experiment (Joshua, 2026-10-23): the light tee's outer layer as one sheet of about 5,000 particles, rows below its hem to mid-thigh for TEE LENGTH, each particle bound to the skin under it, held at the neckline and softly at the sleeves' edges; its hem thinned to the cloth's spacing; the tee's own navel zone marked, and her navel and nipples named by body vertex with rings of skin round them, for the room to follow. About ten seconds; deterministic. See `docs/reviews/sarah-cloth-sim/README.md`.
- `scripts/sarahV2Recovery/tee-detail.mjs` — names the fitted light tee's own navel for the room (Joshua, 2026-10-24: the regular tee "still ignores the two detail sliders"): points of its outer layer on her navel's axis and 30-50 mm round it, printed as the `SARAH_V2_LITE_TEE_NAVEL` constant `src/sarahlab/detailSpots.ts` holds, with the tee's navel and the settled tee's clearance over her at the reference. A second or two; deterministic. See `docs/reviews/sarah-cloth-sim/README.md`.

- `scripts/sarahV2Recovery/bikini/approvedBottom.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/build-report.json` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/build.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/anchorLarge.mjs` — rewrites only the bikini bottom's belly150/belly200 shapes so past 100% the bottom keeps its approved place on her pelvis and hips and moves only as far as it must to stay outside her (Joshua, 2026-10-18); then rerun `bikini/verify.mjs`.
- `scripts/sarahV2Recovery/bikini/collider.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/endpoints.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/morphs.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/verification-report.json` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/bikini/verify.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/leggings-build.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/leggings-hem.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/leggings-fit.mjs` — rewrites the high leggings' nine `shape:recoveryLeggings<key>` corrections (0/25/30/50/60/75/100/150/200: laid on her at small sizes, smooth top edge, clear of her both ways, normals for the raw sum) and re-bakes the cutoff fields; `--hem-only --hem-delta` re-bakes after a shirt hem change (Joshua, 2026-10-20).
- `scripts/sarahV2Recovery/leggings-low-build.mjs` — copies the native low leggings out of the approved body, byte for byte, into `sarah-v2-leggings-low.glb` with nine empty corrections for `leggings-fit.mjs` to fill (Joshua, 2026-10-20: the low waistband dug into her belly from ~140%).
- `scripts/sarahV2Recovery/shirt-hem-fit.mjs` — eases a shirt's own `shape:fitBelly<key>` hem: `--mode spandex` lifts it clear of the high leggings, `--mode relaxed` reduces the rear flare; writes a GLB for `shirt-package.mjs` and a hem delta for `leggings-fit.mjs` (Joshua, 2026-10-20).
- `scripts/sarahV2Recovery/shirt-fine-fit.mjs` — smooths a fitted (spandex) shirt's own `shape:fitBelly<key>` fits over her belly (the folds down her sides, his approved navel left as it is) and adds `shape:fineFit<key>` fields every 10% to 100% and every 5% past it: between fits the fits' two navels come out of the blend and one, the approved one, goes in where hers is, and small lifts keep the cloth and her outie's tip off her, so her navel shows as one small bump at every size (Joshua, 2026-10-20). `--leggings` for the shirt worn over the high leggings; then `shirt-package.mjs`.
- `scripts/sarahV2Recovery/body-slim.mjs` — writes `public/models/sarah-v2-body-slim.glb` from the approved `sarah-v2-body.glb` (left byte for byte; it lives in `assets-archive/models/` since 2026-10-22) without the leggings, low leggings and grown tee (and their trims) the room no longer draws from it, refusing to write unless every part it keeps decodes identical (Joshua, 2026-10-21: save download and memory). Its float morph normals are rounded to 1/1024 (they compress; 2026-10-22, after Replit's audit), checked to half a step: `node scripts/sarahV2Recovery/body-slim.mjs`.
- `scripts/sarahV2Recovery/body-ktx2.mjs` — writes `public/models/sarah-v2-body-slim-ktx2.glb`, the slim body with her colour map as KTX2 (ETC1S; her normal map stays PNG until UASTC is checked on a phone, `KTX2_MAPS=both`), geometry checked identical: the pilot the room loads with `?skin=ktx2` (2026-10-22). Run after `body-slim.mjs`: `node scripts/sarahV2Recovery/body-ktx2.mjs`.
- `scripts/sarahV2Recovery/belly-interpolation.mjs` — reads only: measures how far her bump moves between neighbouring approved belly keys (`BELLY_KEY_GAPS` in `src/sarahlab/bellyInterpolation.ts`, the belly curve experiment, 2026-10-22). `node scripts/sarahV2Recovery/belly-interpolation.mjs`.

**`assets-archive/`** (2026-10-22): files kept in the repository but no longer shipped with the site — the approved full `sarah-v2-body.glb` (the source every slim and fitted file is made from), both fitted leggings, the four modelled shirts and their 62 `sarah-v2-cloth-parts/` buffers. The room stopped offering the modelled tops and leggings once painted outfits arrived; to offer them again, move the files back under `public/models/`. The scripts and tests below read and write them there.
- `scripts/sarahV2Recovery/bikini/collider.d.mts` — the types for `bikini/collider.mjs`, so `tests/sarahV2RecoveredLeggings.test.ts` can measure the leggings' clearance with the same collider the fit scripts use.
- `scripts/sarahV2Recovery/review.html` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/review.js` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/review.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/shirt-bind.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.
- `scripts/sarahV2Recovery/shirt-bind.test.mjs` — Sarah v2 recovery builder, fitting audit, or manual runtime render probe; see `scripts/sarahV2Outfit/README.md`.

One entry is run by hand; the rest are helper modules, which cannot be
wired because they are never run on their own:

- `scripts/bakeStoryLab.py` — bakes the story's painted laboratory into
  `public/models/lab-story.glb` from `art/story/lab-night.jpg`: recovers
  the picture's camera, rebuilds the room as boxes and bakes the picture
  onto them (`src/storylab`). Manual because it needs Python 3 with numpy
  and OpenCV, which the repository does not ship:
  `python3 scripts/bakeStoryLab.py`.

- `scripts/probeWeather.mjs` — the canned Open-Meteo the world probes
  share: routes the island's weather request to a reply for the places
  asked for, so the live path runs with no way out to the internet and
  no console error. A module, not a command; every world probe calls
  `stubWeather(page)`.
- `scripts/probePng.mjs` — the PNG reader the pixel probes share
  (`probe-terrain`, `probe-ocean`, `probe-sky`). A module, not a command: it is here
  because two probes reading their own screenshots is two decoders, and
  the second one was written handling only RGBA and threw on the first
  RGB frame Playwright handed it.
- `scripts/probeSpawn.mjs` — the walk across the spawn map, shared by
  every probe that reaches the world through the front door
  (`probe-boot`, `probe-terrain`, `probe-ocean`). A module, not a
  command. It exists because NEW GAME now asks WHERE before it opens a
  world, so three probes gained the same step on the same day, and
  because it handles BOTH endings of that screen: an island to pick a
  region from, and the "Begin anyway" a build with no survey offers
  instead. There is deliberately no query parameter that skips the
  screen — a probe that can skip a step a player cannot is measuring a
  different program.
- `scripts/humanSurface.mjs` — a human master's surface, asked the two
  questions the bake needs: STANDOFF (how far it is from a texel straight
  into the body to the next surface — a lanyard lying on a shirt reads a
  few millimetres, the shirt itself reads the width of her torso) and
  OCCLUSION (how much of the hemisphere above a texel is open, which is
  what puts the contact shadow back once photographic shading has been
  replaced by flat colour). Also the rasteriser that says where every
  texel of the atlas is in space. A module, not a command; imported by
  the authoring pass below. Its occlusion bake is cached under
  `art/humans/cache/` keyed on the master's own size, because it takes
  about two minutes a body and depends on nothing else.
- `scripts/humanSurface.d.mts` — the types for that module, so
  `tests/humanSurface.test.ts` can import it. It exists because everything
  under `scripts/` is plain JS — these are run by `node`, not by vite, and
  a build step for a bake script is a build step nobody asked for.
- `scripts/authorSarah.mjs` — the authoring pass `npm run bake:humans`
  runs over Sarah: it replaces the lanyard and the top with flat colour
  taken from the scan's own median plus that baked contact shadow, and
  lifts the ID card onto its own material so the TOMBS artwork on it is
  legible (in the body's 2048 atlas the card's island is 70 by 38 texels,
  which is why the printing always read as mush). It touches nothing
  above the collarbone. A module, not a command; imported by the
  `bake:humans` script. Every threshold in it was measured on
  `Sarah-Lab2.glb` and is quoted with what it separates — it is an
  authoring pass for one body, not a general tool.
- `scripts/bakeBadge.mjs` — cuts the TOMBS card and clip out of Joshua's toon lanyard master (`art/humans/Badge-Toon.glb`) and bakes `public/models/badge.glb` in the frame the runtime hangs it by. Imported by `bakeHumans.mjs` (`npm run bake:humans`, or `-- --only=badge`).
- `scripts/smoothSeatWeights.mjs` — smooths the bone weights in space across the hips so a shirt's hem and the cloth under it fold together when a body sits. A module, imported by `bake:humans` for bodies with `smoothSeat`.
- `scripts/smoothArmpitWeights.mjs` — smooths the bone weights in space round both shoulders so the armpit folds, not tears, when the arms come down from the T. A module, imported by `bake:humans` for bodies with `smoothArmpits` (Sarah's base mannequin).
- `scripts/smoothCreaseWeights.mjs` — eases the bone weights along the skin of the crease under a pregnant bump so a stride folds it instead of tearing it. A module, imported by `bake:humans` for bodies with `smoothCrease` (Sarah's base mannequin).
- `scripts/smoothHandWeights.mjs` — eases the bone weights along the skin of both hands so a knuckle bends instead of breaking open. A module, imported by `bake:humans` for bodies with `smoothHands` (Sarah's base mannequin).
- `scripts/protectBumpWeights.mjs` — moves the thigh share of a pregnant bump's bone weights onto the pelvis, so the bump keeps its shape when she sits instead of swinging into her lap with the legs. A module, imported by `bake:humans` for bodies with `protectBump`; pinned by `tests/sarahBump.test.ts`.
- `scripts/rigFingers.mjs` — gives a mitten-rigged hand five four-jointed fingers, measured from the hand's own mesh (the fingers are found as the pieces the hand splits into when cut back from the tips), appended after the master's joints with the hand's weights shared out along them. A module, imported by `bake:humans` for bodies with `rigFingers`; pinned by `tests/sarahFingers.test.ts`.
- `scripts/bellyMorph.mjs` — adds the belly morph targets to a pregnant body: sizes from nearly flat to twice full term (deeper and lower, never wider), the weight's sag and the bob and sway a spring drives, and the breasts' two ends, all measured from the mesh itself, with matching normals. A module, imported by `bake:humans` for bodies with `bellyMorph` (Sarah's base mannequin); pinned by `tests/sarahBase.test.ts`.
- `scripts/paintGarment.mjs` — the garments' textures: a tee's fabric detail from an eight-view reference sheet (`art/humans/outfits/`), cut out by colour, fitted to the cloth row by row, its lighting taken out, baked as a colour texture and a normal map; swimwear's fabric and edge trim; and (`readBodySheet`) a sheet drawn on a whole body, fitted by the body's outline, for a garment's coverage and colours. A module, called by `growClothes.mjs`.
- `scripts/growClothes.mjs` — grows a fitted shirt and leggings from a body's own skin (copied, pushed out by the cloth's thickness, same bone weights, same belly morph), each its own primitive and material. A module, imported by `bake:humans` for bodies with `clothes`.
- `scripts/rebuildShirtHem.mjs` — replaces the shirt's lower panels with a continuous fabric tube and a curved sewn hem. Imported by `npm run bake:sarah-clothes`.
- `scripts/refineEarlyShirt.mjs` — brings the early shirt's upper abdomen closer to skin, flattens its front-to-side transition without moving the centre profile, and adds a 60% anchor that preserves the accepted larger shapes. Imported by `npm run bake:sarah-clothes`.
- `scripts/fitClothToSkin.mjs` — fits clothing over the complete skin mesh across the combined slider shapes, smooths seam movement weights, and fairs the final hem. Imported by `npm run bake:sarah-clothes`.
- `scripts/shirtFabric.mjs` — bakes the shirt's cotton jersey normal and roughness textures. Imported by `npm run bake:sarah-clothes`; its optional direct command is `node scripts/shirtFabric.mjs`.
- `scripts/printBadge.mjs` — prints a TOMBS ID card on the badge round
  Jack's or Sarah's neck. Both were scanned wearing a real lanyard, and in
  the body's 2048 atlas the card's UV island is about SEVENTY BY
  THIRTY-EIGHT TEXELS — at that size a logo is twenty texels wide, so
  better art placed there changes nothing. It lifts the card's triangles
  onto their own material and rebuilds their UVs from the card's own
  plane. The card is found by a DEPTH SLAB measured per person, and the
  two scans differ: Jack's has a clean gap behind the card, Sarah's fused
  card, sleeve and clip into one 32 mm lump welded to the cloth and needs
  a colour gate as well. A module, not a command; imported by the
  `bake:humans` script, which holds each person's slab.
- `scripts/clearShirtLogo.mjs` — paints out the "TOIARG" logo the scanner
  printed on Jack's polo where TOMBS was meant to be (Joshua, 2026-09-29:
  paint over it rather than repair the text). The letters and their halo
  are found in SPACE inside a box on the chest and refilled from the polo
  round them, gathered in 3D so the fill crosses UV seams; the colour,
  normal and roughness maps are all filled, because the roughness map
  printed the logo as a satin block of its own. A module, not a command;
  imported by the `bake:humans` script, which holds the box.
- `scripts/paintSarah.mjs` — paints Sarah's untextured `Sarah-Lab3.glb`
  from nothing: every texel coloured by where it sits on her body (skin,
  hair, top with its neckband, skirt, shoes, bands, the lanyard found by its
  shape along a measured path, card), and her face and front projected from
  the reference photograph she was made from (`art/humans/ref/`), each
  region taking the photograph only where its pixel is that material. The
  occlusion bake supplies the shading the photograph does not. A module, not
  a command; imported by the `bake:humans` script.
- `scripts/smoothLegWeights.mjs` — rebuilds Sarah's hip, knee and ankle
  skin weights from height with a smooth blend across each joint, because
  her Lab3 master was rigged with hard edges there and tore open along
  them as soon as a walk bent a knee or an ankle. A module, not a command;
  imported by the `bake:humans` script, run on the bodies whose entry asks
  for it.
- `scripts/relayHarness.mjs` — starts `wrangler dev --local` on a free
  port, waits for `/health`, and stops it again, cleaning up its Durable
  Object state. Imported by `npm run probe:relay`,
  `npm run probe:multiplayer` and `npm run probe:bot`, which all need a relay running on this
  machine and neither of which is testing that plumbing.

- `scripts/clearShirtBust.mjs` — adds local cloth ease at the outer bust for lowered-arm poses, with matching normals at every slider anchor.

- `scripts/swapSarahGarment.mjs` — copies named garments (with their painted textures) from a freshly rebaked `sarah-base.glb` into the shipped one and leaves every other primitive, the body and its approved belly included, exactly as it was. `node scripts/swapSarahGarment.mjs <rebaked.glb> <shipped.glb> bikini [shirt ...]`.
- `scripts/fitMeshyBikini.mjs` — fits the modelled string bikini (`art/humans/outfits/bikini-string-meshy.glb`, top and bottom) onto the shipped `sarah-base.glb` as its `bikini` primitive: simplified, placed, wrapped 3 mm off her skin, and bound to her skin weights and every shape (belly sizes, breasts, bob/sway springs). The body is untouched. Run after any rebake that regrows the bikini. `node scripts/fitMeshyBikini.mjs art/humans/outfits/bikini-string-meshy.glb public/models/sarah-base.glb`.
- `scripts/protectGrownBump.mjs` — lifts the thigh share of the bump onto the pelvis at every belly size (the 150% and 200% shapes as well as the bind body), so a big bump does not fold flat into her lap when she sits. Changes skin weights only, in place; positions and shapes are untouched. Run it, then `fitMeshyBikini.mjs` (which copies her weights), after any rebake of `sarah-base.glb`. `node scripts/protectGrownBump.mjs public/models/sarah-base.glb`.
- `scripts/addSeatCorrective.mjs` — adds the `bellySeat` shape to every primitive of `sarah-base.glb`: the bump's lower flanks carried forward over the thighs, which the Lab turns on only while she sits around 100% (`seatCorrectiveWeight`). Weight 0 is nothing, so standing geometry is untouched. Run after `protectGrownBump.mjs` and before `fitMeshyBikini.mjs`. `node scripts/addSeatCorrective.mjs public/models/sarah-base.glb`.
- `scripts/cleanArmWeights.mjs` — for an arms-down master (Sarah v2): frees the arm's skin below the shoulder of the spine, pelvis and thigh bones it hangs beside, and the chest and breasts of the upper-arm bones, so a raised arm neither drags the torso nor tears the breast. A module, imported by `bake:humans` for bodies with `armsDown`.
- `scripts/bellyV2.mjs` — Sarah v2's own belly, separate from v1's: her master is 100% and is never reshaped; 0–75% shrink from it and are faired into the body over the mapped belly area; 150–200% grow past it with the centre-line curve drawn toward v1's approved profiles (`V1_PROFILES`), the upper and lower belly re-drawn as quintic Hermite curves into the under-bust crease and down to the pubis, the groin anchored; 30% and 60% added as v1's; the 100% curve correction written as a separate target (`bellyRefine`) the Lab's CURVE button switches on. A module, imported by `bake:humans` for bodies with `bellyV2`.
- `scripts/roundBelly.mjs` — rounds and smooths a pregnant belly: each size moved halfway from its own side curve toward the curves traced from Joshua's 22–40 week reference photographs, then faired with the navel held; the approved 0–50% sizes keep their exact shape. A module, imported by `bake:sarah-clothes` (and `bake:humans` for bodies with `roundBelly`).
- `scripts/refineEarlyWaist.mjs` — narrows the front silhouette below 60% on skin and garments together, with an explicit halfway width at 30%; leaves height/depth and 60%+ unchanged.

- `scripts/smoothShirtUnderbust.mjs` — fills local under-bust hollows outward across shared cloth vertices, with matching normals at each belly anchor.
- `scripts/fitAthleticTee.mjs` — adds `shirtAthletic`, the Athletic Fit tee, to the shipped `sarah-base.glb` beside the Relaxed `shirt`: the grown tee re-fitted a few millimetres off her softened skin (creases bridged, the hollow between her shoulder blades spanned, neckline and hem eased, sleeves and armpits kept as cut), bound to her skin weights and every shape, held clear of her skin and the leggings at every belly size and seated, with each belly size's move eased across the cloth so it never steps under the bust. It also writes cover bit 4 on her body and `_UNDER_TOP` on the leggings for the Lab's skin masking. Her body and the Relaxed tee are untouched. Needs a rebake that carries `_SKIN_AT` (copy the shipped file, `npm run bake:sarah-clothes`), then: `node scripts/fitAthleticTee.mjs public/models/sarah-base.glb <rebaked.glb>` and `node scripts/packSarah.mjs public/models/sarah-base.glb`.
- `scripts/packSarah.mjs` — re-compresses `sarah-base.glb` after any script that edits it in place (EXT_meshopt_compression, float positions/normals/shapes to normalized 16-bit, float weights to 8-bit keeping all four, unused data pruned). `node scripts/packSarah.mjs public/models/sarah-base.glb`.
- `scripts/sarahV2Correctives.mjs` — additive correctives on the shipped `sarah-v2.glb` (the source master and the 100% body untouched): every belly shape faired across its falloff ring (normal direction only) so the bump joins her torso as one surface, then faded to nothing below her groin crease (the bump's own underside spared by its depth, the top of the groin easing with the small sizes so no pouch edge forms), so her pubis, groin, upper thighs and the front of her hips hold still across 0–200%; a `navelFlat` shape that settles her modelled outie into an ordinary navel, which the Lab holds on to 75% and eases off by 100% (`navelFlatWeight`); her knee weights eased across 15 cm each side so a seated bend spreads instead of crumpling (weights only); and a `bellySeatV2` shape that carries the lower bump up and forward over her thighs, which the Lab turns on only while she sits, growing with the bump (`seatCorrectiveV2Weight`). Stamps the file and refuses a second run. After any `bake:humans` that rewrites v2: `node scripts/sarahV2Correctives.mjs public/models/sarah-v2.glb` then `node scripts/packSarah.mjs public/models/sarah-v2.glb`.
- `scripts/sarahV2ArmWeights.mjs` — writes `sarah-v2-arms.glb`, the approved `sarah-v2.glb` with her armpits repaired for raised arms (the approved file is left untouched as the reference; the Lab's MODEL button reaches both). Her arm's share around each shoulder is re-solved as a smooth (harmonic) field across her skin, so it travels round the armpit instead of leaping the gap to her back, and two shapes, `armRaiseL`/`armRaiseR`, tuck the skin arm and torso share into the armpit as the arm rises (the Lab's ARMS slider and `armRaiseWeight`). Weights and two new shapes only: her rest shape and every approved shape are unchanged. `node scripts/sarahV2ArmWeights.mjs public/models/sarah-v2.glb public/models/sarah-v2-arms.glb` then `node scripts/packSarah.mjs public/models/sarah-v2-arms.glb`.
- `scripts/sarahV2Refine.mjs` — adds Sarah v2's refinement shapes to `sarah-v2-arms.glb`, after `sarahV2ArmWeights.mjs`: `bellyUpper`, the bump about 5% fuller and taller from the navel up (the lower belly held; the Lab weighs it by each size's own upper bump, `bellyUpperWeight`, the ratios stamped in the file as `bellyUpperScale`), and `breastGrow`, her own 0% breast scaled evenly in every direction so the bust grows the way the belly does and stays round from the front (the Lab uses it in place of `breast100` at the same volume targets, `breastWeightsFor`). Both carry normal changes. Stamps the file and refuses a second run. `node scripts/sarahV2Refine.mjs public/models/sarah-v2-arms.glb` then `node scripts/packSarah.mjs public/models/sarah-v2-arms.glb`.
- `scripts/sarahV2Shape.mjs` — writes `sarah-v2-body.glb`: the approved `sarah-v2-arms.glb` plus one body-shape field per control (belly height, width, depth, upper and lower fullness; breast width, height, depth, spacing, position, droop, upper and lower fullness; spacing is two fields, apart and together, the breasts turned round her chest about an axis inside the ribcage and held off her midline when closer), plus `breastGrowMore`, the bust's even growth past the slider's 1.55x for the manual SIZE control (to 2.0x), kept off her midline so the breasts meet instead of passing through each other; each a morph target `shape:<control>` at one unit (10%, 1 cm or 5°) except height, which is six fields written exactly at ±2 cm for the 100, 150 and 200% bumps (a shift is not linear; the Lab crossfades them, `bellyHeightWeights`), every belly field made from the bump itself (smoothed, so the navel keeps its shape) or around her own 0% breast so a belly field cannot reach the breasts nor a breast field the bump. The Lab lifts them out of the mesh at load and applies them on the CPU (`src/view/bodyShapeView.ts`, weights from `bodyShapeFieldWeights`), so they cost no GPU morph memory; all controls at their approved values draw the approved body. Stamps the size ratios it measures (`bellyShapeScale`, `bellyLowerScale`) and refuses a second run. `node scripts/sarahV2Shape.mjs public/models/sarah-v2-arms.glb assets-archive/models/sarah-v2-body.glb` then `node scripts/packSarah.mjs assets-archive/models/sarah-v2-body.glb`.
- `scripts/sarahV2Bikini.mjs` — puts v1's modelled bikini (`art/humans/outfits/bikini-string-meshy.glb`) on `sarah-v2-body.glb` as its own `bikini` primitive, through `fitMeshyBikini.mjs` with v2's options: the cups placed and printed on her breast, the halter kept at v1's scale, every fabric vertex bound to the skin under it, its bone weights and every shape the body has (GPU shapes and the CPU body-shape fields alike), its clearance carried along the skin's turned normal. The body primitive is untouched. Run after `sarahV2Shape.mjs`: `node scripts/sarahV2Bikini.mjs assets-archive/models/sarah-v2-body.glb` then `node scripts/packSarah.mjs assets-archive/models/sarah-v2-body.glb`.
- `scripts/sarahV2BikiniFinish.mjs` — the finishing pass `sarahV2Bikini.mjs` runs on its fit (a module, also runnable on a fitted file kept with part tags): rebinds any bikini vertex that the fitter tied to her arm (a hanging forearm passes close to her hip and breast), lays the side ties' bows against her hip, draws the cups' outer corners back onto her breast, and rebuilds the halter straps as taut bands solved over her skin. Changes the bikini primitive only.
- `scripts/sarahV2ProcBikini/build.mjs` and its modules `scripts/sarahV2ProcBikini/ribbon.mjs` (splines, laying a path on a surface, the flat ribbon), `scripts/sarahV2ProcBikini/skin.mjs` (her skin, landmarks, the fold), `scripts/sarahV2ProcBikini/bind.mjs` (binding a piece to her skin), `scripts/sarahV2ProcBikini/collar.mjs` (where a strap lies round her neck) — Sarah v2's PROCEDURAL bikini top (approved by Joshua, 2026-10-16), which replaces the fitted v1 cups, bridge, halter and bow in `sarah-v2-body.glb` (v1's bottom is kept). Each cup is a rounded triangle on three anchors found on her breast (the underside fold by skin concavity, the hem 1 cm up the breast from it), edged by a flat 2 x 0.5 mm ribbon laid on her skin by smoothed splines, its fabric her own skin triangles painted inside that edge; the bridge, a back strap (free from each cup to mid-side, on her round the back) and the halter cords (round the base of her neck where the badge's lanyard lies, `collar.mjs` ports `HumanBadge`'s measurement) are the same ribbon snapped centre-on-centre to the cup anchors, ending in a procedural bow. Every piece rides the skin under it (bones and every body shape) and moves as one along its length. `node scripts/sarahV2ProcBikini/build.mjs <src.glb> <tags.glb> assets-archive/models/sarah-v2-body.glb` then `node scripts/packSarah.mjs assets-archive/models/sarah-v2-body.glb`, where `<src.glb>` is the v2 body wearing v1's fitted bikini finished by `sarahV2BikiniFinish.mjs` (`keepCupShape`) and `<tags.glb>` the same fit written with its part tags (`fitMeshyBikini`'s `keepTags`). Every size is an env setting whose default is the approved value.
- `scripts/sarahV2Outfit/build.sh` and its steps `scripts/sarahV2Outfit/grow.mjs` (grows the garments through `growClothes.mjs`), `scripts/sarahV2Outfit/islands.mjs` (keeps the tank's largest piece), `scripts/sarahV2Outfit/dress.mjs` with `scripts/sarahV2Outfit/fabricUV.mjs` (true-size fabric UVs and the knit textures `scripts/sarahV2Outfit/knit-grey-1k.jpg`, `scripts/sarahV2Outfit/knit-white-1k.jpg`), `scripts/sarahV2Outfit/rebind.mjs` (smoothed clearance push, rest folds removed, bound to her skin), `scripts/sarahV2Outfit/untangle.mjs` (folds at each shape relaxed), `scripts/sarahV2Outfit/bridge.mjs` (cloth lifted out of crevices), `scripts/sarahV2Outfit/normals.mjs` (normal shapes from the cloth's own faces), `scripts/sarahV2Outfit/trim.mjs` (bound edges) and the check `scripts/sarahV2Outfit/bumpw.mjs` (her navel's size through each layer) — Sarah v2's outfit, a white tank over grey maternity leggings in two rises (`leggings` over the belly, `leggingsLow` under it), grown from the clothes-free approved `sarah-v2-body.glb` and written onto it with every body shape. `sh scripts/sarahV2Outfit/build.sh` (about fifteen minutes, intermediates in `.scratch/outfit`), then copy `a8.glb` over `assets-archive/models/sarah-v2-body.glb` and `node scripts/packSarah.mjs assets-archive/models/sarah-v2-body.glb`. `scripts/sarahV2Outfit/README.md` says what each step is for and what is still open.
