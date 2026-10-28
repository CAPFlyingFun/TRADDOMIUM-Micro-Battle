# The new tee smoothed over her belly at every size (local, awaiting review)

Joshua, 2026-10-28, from his phone at 0%, 41% and 67% belly and a side view of a big belly: "Please check these belly
sizes as the front and side show creases… see if it can be smoother." Nothing here is pushed.

## What was wrong

These two problems happened on every slider drag:

- **The cut depended on the path the slider took.** Each step of the drag was measured from the step before. The
  points it measured stood off her skin along her normals, so every change of her shape was magnified. Dragging from
  73% down to 0% left the front and hem lumpy. The same tee put on fresh at 0% was smoother. Over 60° folds: 92 dragged
  against 65 fresh.
- **The cut followed every dip of her skin.** Under her bust, at the waist between belly and hip, and down the underside
  of her belly, her skin stretches into hollows that a tee spans. Measured on her skin, the fabric grew with those
  hollows and stood off her as folds. At a big belly, the front was cut three times its pattern and hung as a sack with
  a lip at the hem.

## Round 2 (Joshua, 2026-10-28: three spots circled)

He circled three spots in round 1:

- 41%: the lower belly.
- 67%: a crease across the belly, with the hem tucked under.
- 100% side: the round shape was lost.

His ask: "make sure the shirt retains the 100% belly rounded shape and make sure the bottom edge and side isn't
folded, unless it's a shadow."

**The cause.** Round 1's hang began where her skin turns past level. The lower half of a round belly faces down too,
and the tee covers it. So the tee was cut too short there: it creased across her belly, pulled the hem in under it,
and flattened its curve.

**The fix:**

- **Hang.** The hang now starts only where her skin faces well down (`HANG_FROM` −0.4, wholly by `HANG_TO` −0.9).
- **Smoothing.** Her shape is smoothed further before it is read (`FIT_SMOOTHING` 150, about 15 cm). Without that,
  the hem under her belly read the crease above her thighs and rippled. These settings were picked by comparing 7
  variants on her: no hang, three hang ranges, and 20, 60 and 150 smoothing passes.
- **Recut rate.** While the slider is dragged, the tee is recut at most every 0.12 s, because a recut takes 40–100 ms.
  The last recut always lands once she stops changing.

## Round 3 (Joshua, 2026-10-28: "the new 100% looks good, but the 200% is wrong… the last 200% was good")

Round 1's hang (from level) suited a very big belly. Round 2's hang (from 0.4 down) suited 100%. Each edge now takes
round 2's range, eased toward round 1's (`HANG_BIG_FROM` 0, `HANG_BIG_TO` −0.35) as her skin under it grows from 2 to
2.5 times the tee as tailored (`HANG_GROWN_FROM` and `HANG_GROWN_TO`).

That stretch, measured on her:

- **100%:** up to 2.0 under her belly, so 100% keeps round 2's cut.
- **150%:** 2.3 to 2.6.
- **200%:** 2.5 to 3.

Folds over 60° after round 3, slider dragged from 73%:

| Belly | Folds |
| --- | --- |
| 0% | 71 |
| 41% | 69 |
| 67% | 68 |
| 100% | 66 |
| 200% | 96 (round 1: 119, round 2: 73) |

At 200% the hem rounds under her belly the way it did in round 1.

Checks:

- 91 garment tests pass, including a new one for the eased hang.
- The full suite passes: 4,569.
- typecheck, relay:typecheck, build and probe:boot pass.

The sheets now show round 1, round 2 and now.

## The fix (`garmentCloth.ts`, `roomGarment.ts`, `clothSkin.ts`)

- **Measured from the shape it was tailored from.** Every cut is measured against her 0% design (`tailoredShape`), on
  her skin points rather than points carried off it. The tee's size now depends only on her shape now: the same at 41%
  however the slider got there.
- **Her shape smoothed before it is read.** It is smoothed over the tee's own sheet first (`FIT_SMOOTHING`, 60 passes of
  Taubin smoothing, which does not shrink). A hollow narrower than that reads as the span the cloth takes across it.
- **Hanging under her belly.** Where her skin faces down, an edge takes her stretch across her but not down her
  (`HANG_FROM` 0, `HANG_TO` −0.35). The tee hangs from the widest place instead of growing down the underside.

## Measured (portrait phone view 430×932, slider dragged from 73% in 4% steps)

| Belly | Folds over 60°, alpha.134 | Round 1 | Now |
| --- | --- | --- | --- |
| 0% | 75 | 63 | 70 |
| 41% | 75 | 68 | 69 |
| 67% | 75 | 68 | 67 |
| 100% | 90 | 71 | 67 |
| 200% | 109 | 119 | 73 |

**Belly shape.** At 100% and 200% the tee keeps her belly's round shape from the side, and the hem drapes under the
belly instead of standing out as a lip or tucking in.

**Room as it opens (73%).** It opens smooth: the back has no band, and OUTFIT still switches to the sim tee.

**Skin and contact.** No torso skin shows through. The only skin the check finds in front of the tee is her forearms,
which hang outside it. Nothing of the tee sinks into her beyond 1 mm behind her arm.

**Checks.**

- 90 garment tests pass, 7 of them new.
- The full suite passes: 4,568 tests.
- typecheck, relay:typecheck, build and probe:boot all pass.

## Sheets

1. `1-front-0-41-67.jpg`: front at 41%, 67% and 100%: alpha.134, round 1, now.
2. `2-side-67-100-200.jpg`: side at 67%, 100% and 200%: alpha.134, round 1, now.
