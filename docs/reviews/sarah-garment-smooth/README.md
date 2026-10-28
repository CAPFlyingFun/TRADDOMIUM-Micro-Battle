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

## The fix (`garmentCloth.ts`, `roomGarment.ts`, `clothSkin.ts`)

- **Measured from the shape it was tailored from.** Every cut is measured against her 0% design (`tailoredShape`), on
  her skin points rather than points carried off it. The tee's size now depends only on her shape now: the same at 41%
  however the slider got there.
- **Her shape smoothed before it is read.** It is smoothed over the tee's own sheet first (`FIT_SMOOTHING`, 60 passes of
  Taubin smoothing, which does not shrink). A hollow narrower than that reads as the span the cloth takes across it.
- **Hanging under her belly.** Where her skin faces down, an edge takes her stretch across her but not down her
  (`HANG_FROM` 0, `HANG_TO` −0.35). The tee hangs from the widest place instead of growing down the underside.

## Measured (portrait phone view 430×932, slider dragged from 73% in 4% steps)

| Belly | Folds over 60° before | after |
| --- | --- | --- |
| 0% | 75 | 63 |
| 41% | 75 | 68 |
| 67% | 75 | 68 |
| 100% | 90 | 71 |
| 200% | 109 | 119 |

At 200% the count is about the same, but the folds have moved: the hem tucks in under her belly instead of standing
out as a lip.

- **Skin showing through:** none of her torso shows through the cloth. The only hits are her forearms, which hang
  outside the tee.
- **Cloth sinking into her:** at most one particle, 1 mm inside her, behind her arm.
- **Checks:** 90 garment tests (7 new for this cut), full suite of 4,568, typecheck, relay:typecheck, build and
  probe:boot all pass.

## Sheets

1. `1-front-0-41-67.jpg`: front at 0%, 41% and 67%, before and after.
2. `2-side-67-100-200.jpg`: side at 67%, 100% and 200%, before and after.
