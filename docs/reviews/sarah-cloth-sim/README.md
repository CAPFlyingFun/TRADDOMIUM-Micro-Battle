# The cloth tee experiment (alpha.117)

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

The dials open **weighty and form-fitting**, as asked:

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
