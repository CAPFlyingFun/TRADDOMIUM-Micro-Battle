# Sarah Lab body paint, third pass: waistbands, the 17 styles, detail by material (for review)

Joshua, 2026-10-20, with the TRADDOMIUM Fabric & Clothing Tracker workbook:

- Shorts and leggings still sit too low around the upper hips and rear. Fix the seat and pelvis coverage, the
  waistlines and the leg openings first, then show fresh comparisons.
- Compare the tracker's 17 styles with the templates and add the practical ones.
- Base breast and navel detail on fabric thickness and garment structure, with the sliders as overrides.

Everything here is local only.

## 1. Waistbands at the hips and rear (QA Q01, Q02)

**What was wrong.** I measured her rest surface. On her trunk (0 at the hip joints, 1 at the base of the neck), her
seat is fullest at about 0.06, the small of her back is at about 0.41, and her hips are widest at about −0.08. The
low-rise templates put the back waistband at 0.12, which cut across the top of her seat. The waistband also blended
straight from front to back, so at the sides it sat halfway, below the tops of her hips.

**What it is now.** Each waistband has three heights: the middle of the front, over the hips, and the middle of the
back. The curve between them is eased, so it is level where it crosses each height and has no corners.

| Rise | Front | Hips | Back | Used by |
|---|---|---|---|---|
| Under the bump | −0.02 | 0.26 | 0.33 | under-belly leggings, short shorts, mid-thigh shorts, bike shorts |
| Over the bump | 0.48 | 0.40 | 0.40 | over-belly leggings, capri, knee-length leggings, knee shorts |

- **Under-bump styles:** the band holds its low front height across the width of the bump, then rises behind the bump
  over the hips (`riseFrontWidth`). This makes a U under the bump that doesn't climb its sides, and it covers the whole
  seat at the back.
- **Dials:** WAISTBAND (FRONT) moves the front on its own. The new HIPS & BACK RISE dial moves the hips and back
  together.
- **Short shorts:** their legs now end at 0.12 instead of 0.10, so the hem sits just below the fold of her seat.
- **Nothing else changed.** Her model, navel, clothing meshes and morphs are all untouched.

**Sheets**
- `1-before-now-hips-rear.jpg`: under-belly leggings, short shorts and mid-thigh shorts, BEFORE and NOW, at 45°, side
  and rear.
- `2-now-four-views.jpg`: all five bottoms, front, 45°, side and rear.
- `3-belly-0-200-sit.jpg`: belly 0% and 200%, and sitting, BEFORE and NOW.

## 2. The tracker's 17 styles

| ID | Style | Now |
|---|---|---|
| C01 | Full bodysuit | **Added:** neck to wrists and ankles. |
| C02 | Over-belly leggings | Have it (renamed from "Full-length leggings"). New rise. |
| C03 | Under-belly leggings | Have it. Fixed, see 1. |
| C04 | Capri leggings | Have it. |
| C05 | Bike shorts | **Added:** under-bump rise, legs to 0.36. |
| C06 | Short shorts | Have it (renamed from "Athletic shorts"). Fixed, see 1. |
| C07 | Mid-thigh shorts | Have it. Fixed, see 1. |
| C08 | Tank top | **Straps added.** See below. |
| C09 | Short-sleeve tee | Have it. |
| C10 | 3/4-sleeve tee | **Added:** sleeves to the forearm. |
| C11 | Long-sleeve top | Have it. |
| C12 | Crop top | Have it. |
| C13 | Bandeau / off-shoulder | **Bandeau added**, with a straight top edge and a lower band behind; its top moves on the NECKLINE / TOP EDGE dial. The off-shoulder sleeve band is not done yet. |
| C14 | Utility vest / jacket | **Not added.** Your tracker says a real mesh is preferred and paint shouldn't be the only design. It belongs with Lena's outfit. |
| C15 | Stockings / socks | Have thigh-high and crew. **Added knee-high socks.** |
| C16 | Bra / sports bra | **Sports bra added**, with straps, a band under the bust and a scoop back. A structured bra is available as a detail material (see 3), but not as a coverage shape: cups need a curved top edge that the template lines can't draw yet. |
| C17 | One-piece swimsuit | **Fixed and given straps.** Two things were wrong with the one-pieces (swimsuit and leotard): the top reached down her legs, and the lower part filled her shoulders. Now the leg openings are where the swimsuit's own legs end, and the neckline and straps decide everything above the hem. |

Also still there: knee-length leggings, knee shorts, sleeveless shirt, maternity tee, and the leotard (renamed
"Long-sleeve leotard").

**How straps work.** A strap sits a set distance out from her neck's axis, measured sideways in neck radii. On
Sarah, the top of the shoulder runs from 0 at the neck to about 2 where her arm begins. Inside the straps the neckline
is open down to its depth, front and back. Outside them, above the armhole, she is bare.
- Tank: straps from 1.0 to 1.55.
- Sports bra: 0.85 to 1.5, wider.
- Swimsuit: 0.98 to 1.45.

All three stop short of about 1.6, where her arm's and back's skin interleave.

The straps' edges are about 1.4 cm soft, close to the other edges' 2 cm.

**Sheet**
- `4-new-styles.jpg`: tank with bike shorts, sports bra with under-belly leggings, bandeau with short shorts, 3/4 tee
  with over-belly leggings, swimsuit, full bodysuit, leotard, knee-high socks. The bandeau and the 3/4 tee are shown
  front and side. This is the version you marked up; sheet 7 shows the touch-ups.

## 2b. Touch-ups after your marked review (2026-10-21)

1. **Bra side profiles were square.** The armhole was a rectangle: a vertical line at the strap's outer edge met a
   horizontal line at the armhole's depth in a right angle. That corner is what read as a boxy cup side on the tank,
   sports bra and swimsuit.
   - The armhole now sweeps round from the strap down to the underarm, with a corner rounded about 8 cm.
   - The neckline's corners inside the straps are rounded too, so the front is a scoop.
   - The bandeau's top edge now runs high over the cups and curves down under the arms, instead of running straight
     round her.
2. **One strap was not like the other.** I measured it: her skin weights are not symmetric at the shoulder blades.
   Near one blade the back's skin is carried by the arm bone, at the other by the spine, so the back of each strap
   landed on different kinds of skin on the two sides.
   - Where a vertex is arm skin and its mirror image within 2 cm is torso, the body map now treats it as torso.
     On the tank, the left/right mismatches at the shoulders are gone. The check still reports some mismatches, but
     those are vertices elsewhere whose nearest mirror match is at a different height, not real differences.
   - Where arm skin meets the back at the armhole, a sleeveless garment treats it as the torso it sits on.
   - Lone vertices that disagree with all their neighbours along a template's edge are cleaned up. Clean edges are
     left exactly as they are.
3. **Leotard cut.** The leotard now has its own high-cut leg openings, following your marking:
   - At the front, the opening climbs in a curve from the crotch to over the hip.
   - At the back, it stays high across her seat and narrows to the middle.
   - The line is measured outward from her midline, because the openings go round her legs.
   - It sits just above where her legs part, so no strip runs down her inner thighs.
   - A LEG CUT HEIGHT dial moves it. The swimsuit keeps its own straight openings.

Also checked with her arms raised (T-pose), since straps are where raised arms show problems.

## 2c. Final touch-up pass (2026-10-21, after your second review)

1. **Leotard cut.** It was spreading onto the tops of her thighs: the leg line rose slowly away from the crotch
   (eased in), so the panel stayed low across the groin.
   - Now the line leaves the crotch steeply and flattens as it reaches the hip (eased out). The cut climbs at once in a
     clean arc, like your reference.
   - The strip between her legs is about 4 cm wide.
   - The edge's softness is measured square to the line, so the steep part is as clean as the rest.
   - The back rises the same way: a high back that narrows to the middle.
   - Left and right are the same by construction, since the line is measured from her midline.
   - The swimsuit is unchanged.
2. **Sports bra back corners.** The fringe was where her armpit's back skin is carried by the arm bone: the bra
   covered the torso skin beside it but not that skin.
   - Sleeveless garments now treat skin no further out from her neck than just past the strap as the torso it sits
     on, so the armhole closes over it.
   - Her actual arm stands further out and stays bare, so there are no bands on the upper arms.
   - The shoulder edges also now have a 1.4 cm soft edge, close to the other edges' 2 cm.

**Sheets**
- `9-leotard.jpg`: the leotard BEFORE and NOW (front, 45°, side, rear) and in T-pose.
- `10-leotard-closeups.jpg`: the front hip and crotch, and the rear hip and seat, BEFORE and NOW.
- `11-sports-bra-back.jpg`: the sports bra from behind, standing and in T-pose, BEFORE and NOW.
- `11b-sports-bra-corners.jpg`: close-up of the strap corners, BEFORE and NOW.
- `12-final-check.jpg`: tank, sports bra, swimsuit, bandeau and leotard together, plus the sports bra in T-pose, to
  check that nothing else moved.

## 3. Detail through paint, by material (Material Detail Formula sheet)

Each paint layer now has its own detail setting, with three modes:

- **AUTO (the default).** Uses a material row from your tracker:
  - the garment's construction, if its template has one (sports bra, swimsuit);
  - otherwise the fabric family's row (jersey → fine jersey, athletic → athletic knit, sweater → chunky sweater,
    ribbed → ribbed knit, pantyhose → sheer nylon);
  - or any row you pick from the DETAIL MATERIAL list.
- **OVERRIDE.** Your slider values. Moving a slider, or pressing THIN, MEDIUM or THICK, switches to it.
- **OFF.** Her detail is unchanged under that layer.

The formula is yours, as written: visibility = clamp(round(base − 15 × (thickness − 0.45) − 25 × (structure − 0.20)), 0, 100) for the breast, and the same with 10 and 12 for the navel. The table and formula are in
`src/sarahlab/detailMaterials.ts`. Every value can be edited, and a test pins your sheet's results.

| Row | Breast % | Navel % |
|---|---|---|
| Fine jersey | 48 | 81 |
| Athletic knit | 50 | 85 |
| Chunky sweater | 9 | 41 |
| Ribbed knit | 34 | 71 |
| Sheer nylon | 95 | 100 |
| Swimsuit / bikini | 92 | 99 |
| Sports bra | 41 | 90 |
| Structured bra | 0 | 89 |
| Body paint medium / thin / thick | 45 / 79 / 9 | 80 / 100 / 44 |

**Calibration notes, nothing changed for them:**
- The formula puts the sports bra at 41%. Your note said "around 50%". Raising its base breast value to 59 would give
  50%.
- The thin and thick rows come out at 79/100 and 9/44, not the 70/95 and 20/50 they were named after, because the
  formula adjusts their bases again. The THIN / MEDIUM / THICK buttons still set exactly 70/95, 45/80 and 20/50 as
  overrides.

**Where layers overlap,** the one that hides the most decides, scaled by how much of that layer covers each vertex.

**What it never changes:** bare skin, the bikini, the base body, and the breasts' own shape. Only the nipple and areola
relief is removed, measured against a smooth fit of each breast.

**Sheets**
- `5-detail-by-material.jpg`: bust and navel under one leotard layer: OFF, then AUTO from swimsuit, athletic knit,
  fine jersey, sports bra, chunky sweater and structured bra.
- `6-panel.jpg`: the panel in AUTO.
- `7-touch-ups.jpg`: the tank, sports bra, swimsuit, bandeau and leotard before (as you marked them) and now, plus the
  tank and sports bra in T-pose.
- `8-touch-up-closeups.jpg`: close-ups of the cup sides at 45° and of the straps from behind, before and now.

## Saved outfits

`OutfitConfig` now records, for each layer, its detail setting and the template and dial values it came from, beside
its fabric and mask.

## 2d. Leotard, traced from your marked lines (2026-10-21)

- **Front:** your red line from the close-ups is traced straight onto her skin. Every vertex of her approved body was
  projected through the same camera as the close-up you marked. Each vertex the camera sees face-on near your line is
  marked by which side of it it falls, with a soft edge of about 5 screen pixels.
  - The mark belongs to the vertex, so the edge stays on the same skin at every belly size and in every pose.
  - The crotch is as wide as the gap between the tops of her thighs.
  - The edge runs along the creases at the tops of her thighs, with nothing on the thighs and no holes in the crotch.
  - The data is in `src/sarahlab/leotardStencil.ts`. It is used only on the body it was traced on.
- **Why tracing:** a crease is a fold. Her thigh's skin just below it sits as high up her body as her groin's just
  above, so no edge worked out from heights could follow it. Those attempts either spilled onto the tops of her
  thighs or left the crease walls bare.
- **Sides:** out over her hips, the template's own curved line takes over, rising to the top of the hip where it meets
  the back. The trace hands over to it gradually.
- **Back:** unchanged from the version you approved. A narrow strip runs up the cleft and curves out over the upper
  buttocks into the top edge.
- **Thighs from behind:** where her thighs meet below the crotch, skin facing sideways stays bare, so the colour stops
  at the crotch.
- **Symmetry:** the template is symmetric. The traced front follows your drawing, which is close to symmetric.

**Sheets** (front, 45° and back, zoomed, checked in your order: 0%, then 100%, then 200%)
- `18-leotard-0pct.jpg`
- `19-leotard-100pct.jpg`
- `20-leotard-200pct.jpg`

## Still open

- **Sports bra back.** The outer top corners are much cleaner. A very small notch remains where the strap meets the
  top of each shoulder.

- **Necklines.** They are a shaped opening, not a true scoop or V curve.
- **Off-shoulder sleeve band.** Not done.
- **Structured bra coverage shape.** Not done.
- **Lena.** The lines are fractions of her own skeleton, measured on Sarah. Unchecked on Lena.
- **Bikini refinements.** Recorded separately for a later pass (Trello 257).
