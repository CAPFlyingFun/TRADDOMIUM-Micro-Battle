# The crease under her breasts (alpha.130, approved)

Joshua's request came in three messages on 2026-10-26:

1. "when I start to max out the breast size with everything at max, there is a gap between the breasts and belly which can look weird especially if wearing the bikini or cropped top with near max/or max breast size… Try maxing everything out on the breast size and look at the base model to see how we can blend and merge that area smoother… might as well check the minimum size to see if any issues as well."
2. "noticed it mainly below belly 100% (between 0-100 when the breasts are bigger than the belly and stands out more), but I also believe greater than belly 100%."
3. On the first round of sheets, after circling the crease seen from below, the front crease line, the far breast in three-quarter view and the minimum's dark spot: "Looks good except for this spots I circled, can you make it look less obvious and blend it more?"

He approved the second round: "Looks good, go ahead and push it… I don't have to get it perfect as everyone is different."

## What was wrong

Her breast and belly shapes were each made on the approved body, and the room simply adds them up. Below belly 100%, or with a big bust, two shapes pull the skin under her breasts two ways at once. Measured on the summed shape, four things went wrong:

- **Folds.** The skin folds over itself: 655 folded edges at belly 0% with the default bust, and about 1,400 with every breast control at max.
- **Crossings.** The underside of the breast passes through her ribs, with 200 to 900 edge crossings.
- **Lighting at the crease.** Adding up each shape's lighting direction leaves the skin at the crease lit from the wrong side. Her approved body itself has 7 such points under her right breast, which show as specks at 100%.
- **Dents and ridges.** The shapes press small dents and ridges into the crease skin.

Two things this was not:

- **Not her texture.** With every map switched off, the marks were still there.
- **Not her paint.** But round 2 found a paint bug that made the first repair draw dark. Her body paint shader (`fabricMaterial.ts`) resized her lighting direction to unit length *before* her shapes added their part. That bent every repaired normal and left the dark smudge Joshua circled.

## The repair

It is live, in the room. Nothing in her files changes: the approved body is byte-for-byte as it was, and so are its maps.

- **`src/view/creaseRelax.ts`** holds the arithmetic, with no imports. It works inside a zone covering her chest and upper belly (`SARAH_V2_CREASE_ZONE`), in three steps:
  1. **Untangle.** It finds folds (neighbouring triangles bent past 110°, or turned over against the approved body) and crossings (an edge through a triangle). It relaxes those vertices and a ring round them, moving nothing more than 8 mm.
  2. **Blend.** Taubin smoothing rounds the crease without shrinking her, wherever the repair moved skin or the shapes left it sharper than on the approved body. It feathers over 8 rings and moves nothing more than 20 mm.
  3. **Shade.** Where anything moved, and where a normal strays further than it did on the approved body, it shades from the surface itself, smoothed and feathered.

  Where nothing is wrong, nothing changes.
- **`src/view/creaseWorker.ts`** runs it in a web worker. The extreme shapes take half a second to a second, and that never holds up a frame. Where no worker can start, the page does the same arithmetic itself.
- **`src/sarahlab/bodyCrease.ts`** connects the repair to her mesh:
  - It measures her shape as the GPU draws it: the attributes plus every weighted shape.
  - It writes the repair into her attributes, and takes it back off exactly when her shape changes.
  - It lays a shape it already knows straight away.
  - It works out a new shape once her sliders have been still for 120 ms, so dragging stays quick.
  - Normals are written so that, with her shapes' normal offsets added, they point where the repair says (`unitBefore`).
- **`fabricMaterial.ts`**: the paint shader now resizes the normal only where it softens a nipple under paint. That is the only place it changes the normal. Its cache key went from v10 to v11.

## Sheets

Each sheet shows before (her shapes as summed) on the left and after (repair + blend) on the right:

- `1-belly-0-and-50-default-bust.jpg`
- `2-size-max-belly-0.jpg`
- `3-all-breast-controls-max-belly-0.jpg`
- `4-all-breast-controls-max-belly-100.jpg`
- `5-bikini.jpg`
- `6-minimum-and-approved.jpg`

## Left as it is

- **Every breast control at max with belly 100–200%.** Some crossing is still left at the 20 mm limit. The top of the belly now rises in a soft mound between the breasts instead of being cut by them (sheet 4).
- **The minimum bust** is smoother, but it is still made by running the growth shape backwards. A real small-bust shape would need its own sculpted shape.
