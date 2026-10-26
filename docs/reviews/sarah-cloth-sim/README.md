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
  - **GRIP**: how much it holds on her skin. Since alpha.120 it holds mostly up and down her, and a fifth as much across.
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

## alpha.120: GRIP holds up and down, the seated navel dot, and the fitted tee's detail

Joshua, 2026-10-24, from his phone, on alpha.119: "grip when the slider is at max starts ripping up the outfit and does weird stuff about 3s after I adjust the slider… I would make grip instead how fast the animation moves vertically, with small changes to horizontally… with only a max of 20% loss horizontally". His screenshots also showed the dark dot on her lower belly while she sits.

### GRIP (`11-grip.jpg`)

- **Why it tore.** Friction held each particle to "her skin's motion", but what it measured was the motion of the skin point *nearest* the particle. That point moves along with the particle, so when the particle slid, friction read the slide as her skin moving and made the particle repeat it, every frame, without fading. At the top of GRIP, cloth walked across her and tore within a few seconds. At 0.5 the echo still kept 99.6% of itself each frame.
- **The fix.** Friction now follows the spot of her skin each particle actually touched, carried along by her pose (`clothSkin.ts` keeps where on that triangle the contact was, and `clothSim.ts` holds to it).
  - In a test, a particle nudged once now stops, where before it slid 61 units.
  - A sheet on a sliding floor drifts less than 0.001 units over 44 units of travel.
- **GRIP now works mostly up and down her**, as asked:
  - `GRIP · up and down 0.50 · across 0.10`: the dial sets the friction up and down her, and a fifth of that applies across her.
  - "Up" is against gravity, laid on her skin.
  - Where her skin faces nearly straight up or down, the grip blends smoothly into the across value.
- `11-grip.jpg` shows GRIP at its top for 6 s each, seated, walking and standing. None of them tore.

### The seated dot (`10-navel-seated.jpg`)

- **What it was.** It was her navel, at 200%, coming up through the cloth by 3–6 mm, 4–5 mm from its tip. It showed most when seated and with NAVEL DETAIL at 100%.
- **Cause 1: the dome pushed the wrong way.** The dome over her navel added stand-off along her skin's normal. On the navel's flank that normal leans away from the navel, so the push shoved the cloth sideways, off her navel, and the cloth between two such particles crossed below the tip. Pushing harder made the hole wider. That is why a bigger offset never helped.
- **Cause 2: the dome was off-centre.** It was centred on the rings round her navel, while the tip stands about 5 mm off that centre.
- **The fix.** Within the dome, a floor square to the navel's own axis now stands in for her skin wherever it is higher. It is centred on the tip, flat across 9–13 mm (wider than the cloth's 11 mm spacing), and 0.5 mm above the tip.
  - Friction still follows her skin under the floor.
- **Measured** with a new probe, `navelGap()`, which poses every vertex of her body round the navel and reads the cloth above each one:
  - in 7 states (standing and seated, 100% and 200%, NAVEL DETAIL 0, AUTO and 100%, CLOSENESS 0.5 and 6 mm), the cloth now clears her navel by at least 1.3 mm;
  - before, it was 3–6 mm through, at 82–163 vertices.

### The fitted tee follows BREAST and NAVEL DETAIL (`12-fitted-detail.jpg`)

This is the regular tee, with the cloth off. It is what she opens in.

- **What the tee is made of.** Its navel is modelled in: a dome over her outie, 8–9 mm high at 100%. It has nothing at her nipples, because it bridges her bust about 9 mm off them.
- **NAVEL DETAIL settles the tee's own navel.**
  - Each frame the room poses a few of the tee's points round her navel (`skinPose.ts`) and fits the tee's smooth surface through them.
  - The shader (`clothDetail.ts`) moves the tee toward that surface by what NAVEL DETAIL hides: all of it at 0, none at 100%. Its shading follows.
  - The points were found once by `scripts/sarahV2Recovery/tee-detail.mjs`.
  - Her own navel under the tee is softened to match, as it is under paint and under the cloth.
- **BREAST DETAIL draws her nipples on the tee's surface**, as on the cloth.
- **AUTO comes from the tee's fabric** (fine jersey: breast 48%, navel 81%). The outfit editor now names it as "spandex tee".
- **Above about 115% the tee's own navel no longer sits over hers.** The tee's fitting shapes carry it up to 8 cm away by 200%, and by 200% her navel is below the hem, on the leggings.
  - So the settle stands down at those sizes. The leggings' detail then hides her navel.
  - At 150%, NAVEL DETAIL 0 leaves a soft bump at the hem.
- **Fixed on the way: a hole in the tee.**
  - At a low NAVEL DETAIL, the paint under the tee (the leggings over her navel) settled every garment's navel with her own, the fitted tee included.
  - Past 125% the tee's modelled navel stands above hers, so that settle pushed it into her and opened a hole.
  - The fitted tee's navel now follows only its own fit.

### Also

- The CLOTH probe's `strain()` counts only the rows being simulated.

### Still open

- **A few edges at one sleeve's edge.** Where the cloth is held softly at the sleeve, a few of its edges (particles 1003–1008) stand up to 13× their pattern length from the moment it is laid. The soft pins hold them to places the pattern does not agree with. Nothing shows in the renders. It is noted here so the number is not mistaken for a tear.
- **The skin sliver at the top of a 200% belly.** It has not shown at the new defaults.

## alpha.121: the neckline and sleeves when she sits (`13-sleeves-seated.jpg`)

Joshua, 2026-10-24, on alpha.120: "Everything you did seems to work, but around the top and sleeves, it's all messed up and jagged looking like something ripped it". His screenshot was seated at 200%. Standing, the neckline and sleeves were clean. Seated, with her arms forward, they looked torn. The problem has been there since the cloth tee first arrived; it shows most at 200%, and was not caused by alpha.120.

Three things caused it, and each is fixed:

- **The cloth was laid on her crumpled.** Every particle was laid (and its pin held) at its bound skin point, out along her posed skin's normal.
  - Her shoulder's skin folds and shears as her arms come forward. So a particle standing a sleeve's or a shoulder's width off her was carried crumpled, and its pin held it there. This is plain to see with her body hidden (`13`, middle row).
  - `clothSkin.ts` now lays and pins each particle the way a garment's own vertex is skinned:
    - its bound point in her current shape, before her bones, out by its offset along her normal there;
    - then skinned by its triangle's corners' bones, blended by where on the triangle it lies.
  - Unposed, that is the same place as before; it changes only once she moves.
- **Her arm went through the sleeve's front.** The front and back of the sleeve by her armpit were bound to her trunk, because her trunk was within 2 cm.
  - A particle bound to her trunk never touches her arm, so when her arm came forward it went through them.
  - The bake (`shirt-cloth.mjs`) now binds the sleeve within 4 cm of its edge to her arm wherever it lies over her arm.
  - The sleeve's hold eases from 0.35 at its edge to nothing 4 cm up, so the sleeve comes with her arm.
  - The side of the tee under her arm stays bound to her trunk, so it does not pinch between her arm and her side.
- **The neckline and sleeves kept every point of the modelled folds**, 2–3 mm apart where the cloth is 11 mm apart. That is the same fault that crumpled the hem in alpha.117.
  - The bake now lets points go along those edges as well: neckline 242 → 97 points, sleeves 146/126 → 105/87. It uses its own careful collapse, because the simplifier tore holes beside a sleeve.
  - The edges are then smoothed along themselves, as the hem is.

The bake is reproducible: two runs give byte-identical files.

### Checked

- **Seated at 200%, from her right and left:** the sleeves wrap her arms and the neckline is clean (`13`, top and bottom).
- **Standing at 100% and 200%, walking, and from the side and back:** as before.
- **The T-pose:** the tee rides up her with her arms raised, under the old binding and the new one alike.
- **Her navel at 200% seated:** the cloth still clears it (`navelGap` 3.4 mm).

### Left

- **The T-pose** crops the tee and crumples its back at the shoulders. The cloth has no collision with itself, and raising her arms pulls the sleeves up with the tee.
- **With her body hidden**, the sleeve on her near side still shows a fold behind her arm, both standing and seated. It cannot be seen with her body shown.

## alpha.122: an adjustable neckline (`14-neckline.jpg`)

Joshua, 2026-10-24: "can the neckline also be adjustable like the length so you can do U/V shape and select how deep up to turtleneck? I would set the deepest/lowest point between the breasts and top belly…"

The cloth tee has a **NECKLINE** slider under TEE LENGTH, from −100 to +100, and a **NECK SHAPE** button (U or V). Both work while CLOTH SIM is on.

- **Below 0, the collar rises up her neck.** The cloth file now carries 16 rows of cloth above the neckline, up to a level ring 2 cm under her chin. The slider shows a share of them, the way TEE LENGTH shows the rows below the hem: about −30 is a crew neck, −60 a mock neck, −100 a turtleneck.
  - The rows were laid as a film pulled over her from the neckline to the ring, kept 3 mm off her. They lie on her chest and shoulders and bridge the notch of her throat instead of following into it.
  - The collar's top edge is held to her the way the neckline as made is.
- **0 is the scoop as made.**
- **Above 0, the front is cut deeper,** to 12.6 cm below the scoop at +100: her breasts' lower crease, between her breasts and the top of her belly. The width at her shoulders stays as made, and the back is never cut.
  - **U** rounds in to its lowest point, so a deep U comes down between her breasts.
  - **V** runs straight from each shoulder point to its tip. A shallow V is a notch at the bottom of the scoop.

How it is done:

- **A smooth edge, not the cloth's triangles.** Every point of the tee's front records where it stands against the two curves. The material works the cut out at every pixel (`clothNeckline.ts`), so the edge is a smooth curve through the cloth rather than a zigzag along its 1 cm triangles.
- **What is cut away is not simulated.** The cut edge is held to her skin under it, the way the neckline as made is. Without that, a deep V hung in the air where the whole tee had bridged her breasts.
- **The simulation now runs only the particles shown.** The rows below the hem, the collar and the cut front switch in and out separately, so the cloth's particles run in compact slots (`ClothSkin.setOrder`). It is rebuilt at most once a frame while a slider moves.
- **The cost:** the tee as made is unchanged (5,252 points at TEE LENGTH 20%). A full turtleneck adds 1,552 points, about 30% more. A deep cut removes 50–150.

The bake is reproducible: two runs give byte-identical files.

### And the sleeves' edges (`15-sleeves.jpg`)

Joshua, on the first sheet of this: "Looks good, but these don't have a straight shoulder edge like all the rest". He had circled the sleeves from the side and in every seated view. Those edges were the same on alpha.121, and the fitted tee breaks up the same way when she sits. Here they were ragged because the sleeve's hem was pulled apart:

- **The hem was held in two directions.** Most of each hem was bound to her arm; the run under her arm, nearest her side, was bound to her side and held 3–4 cm off it. When her arm came forward the two holds pulled that corner apart, and the cloth there folded into teeth. Now the hem is held only where it is bound to her arm, fully (as the neckline is) and easing off 4 cm up the sleeve; the run under her arm hangs free between.
- **The tee's underarms passed through her arms** in the modelled tee, by up to 3.7 cm. The bake now moves every point that lies inside her out to her skin first (140 points).
- **Points in her armpit's hollow were bound along a triangle's plane far past its edges.** The bake now binds each point to a triangle it stands over where there is one nearby (908 such points down to 119).
- **A fully held point is never left inside her.** If her bones carry its hold into her, it is put back out on her skin.

Standing, a notch remains at the front of each armpit, where the cap sleeve's edge runs up into it. That is the light tee's own cut; the fitted tee has the same one, and its edge is clean now.

### Checked

- Standing at 100%, every setting from front and side; seated at 150%, V, U and turtleneck (`14`).
- Sleeves standing from the side and seated from both sides and close up, at the default CLOSENESS (`15`).
- `typecheck`, `relay:typecheck`, the tests, the build and `probe:sarahlab` all pass.

### Left

- **The neckline is not saved with an outfit.** Like TEE LENGTH and the cloth's dials, it is kept while you are in the room. Nothing of the cloth experiment is saved with an outfit yet.
- **The fitted (non-cloth) tee** has no neckline slider. It could take the same cut, deeper only.
- **At +100 V, seen from the side,** the far edge lifts a little off the hollow above her bust.

## alpha.129: the same on both sides, a crop top and a tank (`16`–`20`)

**Approved** (Joshua, 2026-10-26: "Go ahead and push").

Joshua, 2026-10-25: "on the current shirt, the only place messed up is the model's right arm area… the left is fine… how about fixing that first since it already can be a dress, but what you can do is make 0 like a cropped tank athletic top instead". He chose **TEE LENGTH 0 as a crop top, and a SLEEVES switch for tank or cap sleeve at any length**.

### Her right arm

The modelled tee is not symmetric under her right arm. Its outer layer folds back on itself behind her armpit, and its right sleeve's hem came out of the bake with 105 points to the left's 87, zigzagging in a clump. That hem is held to her arm, so the clump stood off her arm behind her right armpit: the torn-looking flap.

- **The bake mirrors the tee.** It cuts the sheet at her middle, keeps her left half, and mirrors it for her right (`--no-mirror` keeps the tee as modelled). Points within a millimetre of her middle are moved onto it first, so the cut leaves no slivers. Each sleeve now has 87 and 85 points along its hem.
- **Her arms are the same on both sides.** The bake and `clothSkin.ts` both take an arm vertex whose mirror image is trunk as trunk (`symmetricArms`; 538 of her vertices in the bake), the rule the body regions already use.
- A faint line shows down her front at 200%, where the knit's pattern meets its mirror image.

### TEE LENGTH and SLEEVES

- **TEE LENGTH** now runs from a crop top at 0% through the tee as made at 40% to mid-thigh at 100%. Every length the old slider reached is still on it: the old 0–100% is 40–100% now. The default is 52%, the old 20%.
  - Below 40% the hem rises smoothly toward the crop's. At 0% it stands about 4 cm under her breasts' crease at her sides (1.165 m), 2 cm lower at the centre front, as the pattern's crop line is.
- **SLEEVES** (under NECK SHAPE) switches between the cap sleeves as made and a **tank**. Its armhole runs from a 4 cm strap over her shoulder down to her side, 3 cm under her armpit.
- **Both edges are smooth curves through the cloth,** drawn the way the neckline is (`clothTrim.ts`). Each point of the tee records how far it stands above the hem as made, above the crop's hem and inside the armhole (`_TRIM`); the material cuts at every pixel.
  - The armhole's measure is smoothed over the cloth with the sleeve held outside it, so the sleeve is always cut whole and the edge is a curve.
  - The crop's measures are smoothed over the cloth too, with the hem as made held on its own line.
- **What is cut is not simulated.** A crop wears no rows below the hem.
- **Neither edge is held,** as the tee's own hem is not. Held as the neckline is, they tore: pulled onto her skin across the small of her back and up into her armpit, and, seated, where the skin under the armhole stretches. Free, they lie on her. A tank's cut-away side holds nothing, because the file held the sleeve to her arm.
- **Seated,** the fitted tee still stands in for a cloth tee with sleeves at 40% and above. A tank and a crop are worn seated as they are standing: a tank has no sleeves to tear, and the fitted tee is far longer than a crop.

### Cost

Points simulated at 73% (the stage's line):

| Setting | Points |
|---|---|
| Crop top, tank | 2,063 |
| Crop top, cap sleeves | 2,740 |
| 20%, tank | 2,847 |
| Tee as made (40%), tank | 3,989 |
| 52% (the default), tank | 4,539 |
| 52%, cap sleeves | 5,216 (5,252 before) |
| Mid-thigh, tank | 6,519 |

The file is 0.53 MB (0.48 MB before). The bake is reproducible: two runs give byte-identical files.

### Sheets

- `16-crop-tank.jpg`: TEE LENGTH 0–40%, tank and cap sleeves.
- `17-tank-lengths.jpg`: 52% and mid-thigh with the tank; the default tee from behind her right arm.
- `18-seated.jpg`: seated, crop top and 40% with the tank, crop top with cap sleeves.
- `19-belly.jpg`: belly 0% and 200%.
- `20-panel.jpg`: TEE LENGTH and SLEEVES in Outfit.

### Checked

- Standing at 73%: crop top with tank and cap sleeves, 20% (tank), 40% (tank), 52% (tank and cap sleeves), mid-thigh (tank). Front, side, back, three-quarter and behind her right arm.
- Seated: crop top (tank and cap sleeves) and 40% tank.
- Belly 0% and 200%: crop top and 40% tank; 200% 52% with cap sleeves.
- Edges opened more than 5 mm past their length: standing, none, except 2 and 4 at 200%; seated, 16–19 with the tank, and about 300 with the cap-sleeved crop.
- `typecheck`, the tests and the build pass. New tests: `clothTrim.test.ts`; the file's crop and tank, the length's split and the SLEEVES line in `sarahClothTee.test.ts`.

### Left

- The crop's hem and the back of the armholes are a little wavy, a few millimetres, where the cloth's own folds run.
- A crop with cap sleeves, seated, has the sleeves' old trouble: the caps ruffle under her arms.
- Nothing of the cloth experiment is saved with an outfit yet, SLEEVES included.
