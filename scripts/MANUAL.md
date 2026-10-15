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
