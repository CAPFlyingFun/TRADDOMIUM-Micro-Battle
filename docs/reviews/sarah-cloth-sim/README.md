# The cloth tee experiment (alpha.117, alpha.118)

Joshua asked for this in three steps:

- 2026-10-23: "create another copy of that same shirt, but make that one a true soft body/cloth with simulation over the whole thing and I want to be able to see how much or little having a full soft body cloth fabric would be… if it's not a big performance loss, I'd say, do the soft body cloth as there would be no more trying to sync and match to each point to another point."
- Then: "let's also allow the shirt length to be adjustable… with where it's set as 0% and make 100% at mid-thigh."
- 2026-10-24: "test making the fabric more weighty (more gravity focused and less moving around), tight/form fitting (less space between body and shirt for a tighter fit), etc… Could potentially even add sliders to play with values in real time."

## Where it is

It lives in the Character Studio, under **Outfit**, while Sarah wears the light spandex tee (she opens in it).

- **CLOTH SIM · OFF (experiment)** turns it on. The first time, it downloads the cloth file (0.4 MB). The fitted tee is then hidden and the cloth tee is laid on her in its place. Tap it again to go back to the fitted tee.
- **TEE LENGTH** runs from 0% (the tee as made) to 100% (mid-thigh).
- **Seven dials**, each 0 to 100, act live:
  - **WEIGHT**: gravity, from a quarter of real to four times. The middle is real gravity.
  - **CALM**: how quickly it stops moving.
  - **FIT**: the pattern's size, from roomy to snug.
  - **CLOSENESS**: how far it keeps off her skin, from 6 mm to 0.5 mm.
  - **STRETCH**: how much it gives.
  - **GRIP**: how much it holds on her skin.
  - **QUALITY**: solver steps a frame. More steps are smoother and cost more.
- **LAY CLOTH AGAIN** puts the cloth back on her.
- **CLOTH DEFAULTS** puts the dials back.
- The stage's info line shows what the cloth costs every frame: `CLOTH · points · skin + cloth + draw = ms · steps · fps`.

In alpha.117 the dials opened **weighty and form-fitting**, as asked. Since alpha.119 they open at Joshua's own setting instead (below, under alpha.119):

| Dial | Default |
|---|---|
| WEIGHT | 1.5× gravity |
| CALM | damping 4.2/s |
| FIT | pattern 92% of the tee |
| CLOSENESS | 1.9 mm |
| STRETCH | up to 1.4× |
| GRIP | 0.8 |
| QUALITY | 8 steps a frame |

The `4-panel.jpg` sheet shows the panel.

## How it works

- **The file.** `scripts/sarahV2Recovery/shirt-cloth.mjs` writes `public/models/sarah-v2-spandex-cloth.glb` (0.40 MB):
  - The light tee's outer layer becomes one sheet of 5,160 particles: the shell is ray-cast to her body and the inner layer dropped.
  - Below the hem are 23 rows of 122 particles. They run down to mid-thigh, around her thighs' outline.
  - Each particle is bound to the skin under it.
  - The cloth is held at her neckline, and softly at the sleeves' edges.
- **Every frame**, `clothSkin.ts` poses her skin under each particle on the CPU (morphs, then bones). `clothSim.ts` then moves the cloth.
  - The solver is XPBD with small steps.
  - Each step applies stretch and bend, gravity, damping, a strain limit, her skin as a floor under each particle, and friction against her skin's own motion.
  - The sheet is drawn where the particles are. It is not skinned: the simulation is its pose.
- **Her shape and pose.** When her shape changes (belly, body sliders), the tee is cut again for her: the pattern follows her shape, so a 200% belly wears a tee made for it. A pose change, or any jump of more than 4 cm in one frame, lays the cloth on her again instead of flinging it.
- **Length.** Rows past TEE LENGTH are not simulated, posed or drawn. A short tee costs what a short tee should.

## Fixed before this push: the lopsided long tee

At 100% length, the first version hung long on her right side and short on her left (`sheet17` in the scratch run).

The bake took her **left thigh's bone for an arm**. Its rule was "more than 10 cm off her middle and above 0.7 m". Her left thigh bone stands 10.3 cm out at 0.89 m (her right is 9.6 cm), so it counted. Three things followed:
- The rows below the hem were cut around her right leg only.
- 197 particles over her left hip were treated as a sleeve.
- The cloth could never rest on her left thigh.

The rule now goes by her skeleton: an arm bone must hang from her chest. `tests/sarahClothTee.test.ts` checks that every arm bone hangs from her chest and that each side has the same number. That is 24 a side, 48 in all; before it was 49.

The rows below the hem also now keep the file's own pattern, hung from their point of the hem. They no longer carry a place that stands up to 10 cm off her thigh through a small skin triangle, which amplified any change in her shape.

## What it costs

These are measured in the headless test browser. It renders on the CPU (SwiftShader) at about one frame a second, so absolute numbers on a phone will be lower. **The CLOTH line on your phone is the real reading.**

| | particles | her skin | the cloth | drawing | total |
|---|---|---|---|---|---|
| tee as made (0%) | 5,160 | 7–11 ms | 9–13 ms | 0.4 ms | 16–24 ms |
| TEE LENGTH 50% | 6,624 | 8–11 ms | 11–13 ms | 0.5 ms | 20–25 ms |
| TEE LENGTH 100% | 7,966 | 11–16 ms | 14–17 ms | 0.6 ms | 25–34 ms |

In Node, the unit tests time the two halves alone:
- ClothSkin: 3.5 ms for 6,000 particles on a 20,000-triangle body.
- ClothSim: 9.3 ms for 6,000 particles at 8 steps.

**About half of the cost is not the cloth.** Finding her posed skin under each particle means posing her body on the CPU, which her GPU otherwise does for free.

The cheapest lever is QUALITY. The cloth's own share grows with its steps, so at 4 steps instead of 8 that share is about halved; her skin's share does not change. Fewer steps also make the cloth a little softer.

## Sheets

1. `1-cloth-tee.jpg`: the tee as made, at belly 100% (¾, front, back, side), 0%, 200%, sitting, and the belly slider dragged from 100 to 200%.
2. `2-length.jpg`: TEE LENGTH 50% and 100%, from the ¾ view, the front, the back and the side.
3. `3-dials.jpg`: one cloth with three settings: light and roomy, the default, heavy and snug.
4. `4-panel.jpg`: the panel.

## Rough edges, left for the phone

- **Walking has not been watched.** The test browser runs about one frame a second, so it can only show the cloth settled. Swing, lag and bounce while she walks are for the phone.
- **The cloth sits on her, never inside her, but only against her body.** It does not collide with itself. Her arms do not push it: a sleeve rides on her arm, and the body of the tee only feels her trunk and legs.
- **At 200% the tee rides up the belly**, as a real non-maternity tee would. The bottom of the belly can show under the hem. The fitted tee covers it, because it was fitted for that size.
- **Just after it is laid**, or after a big jump in her belly, the cloth needs a moment, a few dozen frames, to settle. On the phone that is under a second.

## alpha.118: one navel, her detail through the cloth, a straight hem

Joshua tested alpha.117 on his phone on 2026-10-24. "Very impressed... the simulation ran with no issues and actually seemed smoother." He found three problems:
- "there are two bellybuttons, the top is the real one, the bottom for some reason is fixed on the shirt and it shouldn't be";
- "the breast slider has no effect on the outfit… it still should have a visible effect", and "the bellybutton also doesn't appear with the slider… the overrides should be working";
- "the 0% shirt bottom hem/seams, was not straight but when I added more length, it did".

### One navel, hers (`5-one-navel.jpg`)

- **The second navel was the modelled tee's own.** Its navel impression was in the cloth's pattern, so the cloth carried a dimple of its own. When the cloth slid a little under gravity, that dimple moved below her real navel.
- **The dark dot was her real navel coming up through the cloth.** At 200% it stands proud, as an outie, and broke through between particles a centimetre apart.

The fix:
- The cloth file now marks the tee's navel zone (`_NAVEL`), and `clothShirt.ts` smooths the pattern flat there, so the tee carries no navel of its own.
- The file also names her navel and nipples by body vertex, each with an inner and an outer ring of skin round it. Every frame the room poses those, so it knows her smooth surface there (its normal and its curve, from the two rings) and how far each detail stands above it.
- Over a proud navel, the cloth keeps clear in a soft dome. The dome is measured from where each particle is on her *now*, because the cloth slides.

### BREAST and NAVEL DETAIL reach the cloth (`6-detail.jpg`)

- **The sliders now act on the cloth tee.** Before, they only ever acted on clothes painted on her.
- **The tee counts as a piece over her.** Its AUTO values come from its fabric (fine jersey: breast 48%, navel 81%), and MANUAL overrides them.
- **The detail is drawn in shading, from her real navel and nipples, by a patch on the tee's material (`clothDetail.ts`).** It tilts the shading around each spot and darkens an innie's dimple a little. A detail is smaller than the cloth's centimetre spacing, so it cannot be drawn as cloth shape.
- **The same sliders set how the cloth lies.** At 0, the cloth domes broadly over her nipples and her navel is softened under it, so neither shows. At 100%, it follows them.

### The hem (`7-hem.jpg`)

- **The old hem was too dense.** The first file kept every point of the modelled tee's fold at its hem: 327 points, some 0.1 mm apart, where the rest of the cloth is 11 mm apart. At 0% length those tiny edges crumpled.
- **The new hem matches the rest of the cloth.** It is thinned to the cloth's own spacing (94 points, about 12 mm apart, within 2 mm of the modelled hem) and smoothed along itself.
- **The hem keeps its weight.** It now has about a quarter as many points, and each one weighs 3.5 times a point above it, like a turned and stitched hem. Without that weight, the lighter tee rode up off a 200% belly.

### Also

The CLOTH line now starts with the frame's milliseconds and fps. Held upright, the line is cut short, and those were the part that was missing.

### Left as it is

- The fitted (non-cloth) light tee still ignores BREAST and NAVEL DETAIL. It carries its own modelled navel. It could share the cloth's shading if Joshua wants it to.
- At the top of a 200% belly, where the cloth crosses its sharpest curve, a sliver of skin can show between particles. A lower CLOSENESS, which leaves more gap, should hide it; that has not been checked yet.
- Creases can form when the belly is resized quickly. Joshua (2026-10-24): "don't read too much into the creases on belly size change as part of it could be physics working correctly".

## alpha.119: Joshua's setting as the default, and the tee re-cut at the right moment

### The defaults (`8-stretch.jpg`, `9-defaults.jpg`)

Joshua found his setting on his phone on 2026-10-24: "I found I believe the perfect setting that I would like to be used as the default for the cloth simulation". Asked about STRETCH, he said: "Stretch 50… I can always adjust per outfit's settings". The cloth now opens at:

| Dial | Default |
|---|---|
| TEE LENGTH | 20% |
| WEIGHT | 0.5× gravity |
| CALM | damping 12/s |
| FIT | pattern 85% of the tee |
| CLOSENESS | 0.5 mm |
| STRETCH | the middle: compliance 1e-6, up to 1.4× |
| GRIP | 0.5 |
| QUALITY | 8 steps a frame |

STRETCH is the only dial that is not at his setting.
- At his 0, the snug pattern cannot give. In the renders the tee rode up her when she sat, and above a 150% belly when she stood.
- At 50 it covers her in both (`8-stretch.jpg`: seated at 100% after walking).
- `9-defaults.jpg` shows the new defaults after walking 3 s, then switching pose. It covers 100% and 200% standing, and 200% and 100% seated.

### Creases after a belly change

- **The cause.** When the belly slider moved, the tee was cut again for her new shape at once, before her springs had followed the new size. On the next frame they did. That left the cloth's pattern one frame out of step with her, and the cloth took up the difference as crumples.
- **The fix.** A shape change now only marks the tee for a new cut. The cut is made on the cloth's next frame, after her springs have moved.
- Cutting inside LAY CLOTH AGAIN was tried first. It picked up her seated correction and cropped the tee when she sat, so it was taken out.
- The 200% → 50% side views no longer balloon.

### The seated spot and the navel

Joshua reported two things from his phone:
- seated: "no matter how far I say to offset, it still shows in this one spot";
- standing: the navel "still kept poking through, but better".

Neither showed in the renders at these defaults, taken after walking 3 s and then switching pose. They may have come from the early re-cut above, but that has not been confirmed. If either still shows with alpha.119, a screenshot with her pose and belly size will let me reproduce it.

### Also

- **Probe hooks.** The cloth probe (`?probe=cloth`) gained `animate(seconds)`, `hold(on)` and `look(yaw, pitch)`. With them the test browser can run her own frames (walk, springs, cloth) at a fixed step, between pictures.
- **Shared measurement.** Measuring her navel and nipples moved into `detailSpots.ts`, so that the fitted tee can share it.
- **`skinPose.ts`.** It poses a handful of her vertices on the CPU without the cloth. It is not used yet: it is for the fitted tee.

### Still open

- **The fitted (non-cloth) tee and BREAST/NAVEL DETAIL.** Work in progress. The fitted tee's shape differs from the cloth's:
  - it carries its own navel, a broad dome over her outie at 100%;
  - it has nothing at her nipples, because it bridges her bust about 8–10 mm off them.
  So its navel has to be taken back by the tee's own relief, not by hers.
- **The skin sliver at the top of a 200% belly.** It did not show at these defaults (`9-defaults.jpg`). It has not yet been checked more closely.
