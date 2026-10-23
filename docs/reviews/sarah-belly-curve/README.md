# Sarah Lab: the belly curve experiment (2026-10-22, local, for review)

Joshua, 2026-10-22: "Investigate whether Sarah's belly can transition more smoothly across the complete 0–200% slider
range, especially at 0–20% and around 100%... Please distinguish easing the percentage values from improving the actual
morph interpolation." Then, while it was being built: "How about a hybrid of current approved and ease?"

None of this is committed. The approved slider is still the default, and no model file or morph target changed.

## What the approved slider does (measured)

Her bump is nine approved key shapes: 0, 25, 30, 50, 60, 75, 100, 150 and 200%. The slider crossfades between the two
keys either side of it in a straight line.

The table below is how far her bump's surface moves between neighbouring keys (`scripts/sarahV2Recovery/belly-interpolation.mjs`).
It is an RMS over the 7,555 vertices of the bump, in centimetres.

| keys | moves | per 100% of slider |
|---|---|---|
| 0 → 25% | 0.43 cm | **1.7** |
| 25 → 30% | 0.52 cm | 10.3 |
| 30 → 50% | 2.07 cm | 10.4 |
| 50 → 60% | 1.30 cm | 13.0 |
| 60 → 75% | 1.95 cm | 13.0 |
| 75 → 100% | 3.80 cm | **15.2** |
| 100 → 150% | 3.67 cm | **7.3** |
| 150 → 200% | 3.67 cm | 7.3 |

Two things in this table are what you noticed:

- **0–20% hardly changes.** The 25% key is almost the 0% shape, so the slider's first quarter moves her bump at a sixth
  of the pace of the rest. At 25% the pace jumps sixfold.
- **The pace halves at 100%.** It is 15.2 just below 100% and 7.3 just above. The direction of the change also turns
  there: past 100% the bump grows deeper and lower, and its sides draw in.

## The modes (BODY › BELLY CURVE, this session only)

All of them are only new weights for the same nine approved targets. Nothing new is downloaded or stored.

In every mode, 0%, 100% and 200% are the approved shapes exactly. The slider never runs backwards, and the same size
gives the same shape whether you come to it from above or from below.

| mode | the shapes on the way | the pace | what it changes |
|---|---|---|---|
| **CURRENT** | the approved crossfades | approved | nothing (the default) |
| **HYBRID** | the approved crossfades | halfway between approved and even, smoothed | **easing only**, by half |
| **EASED** | the approved crossfades | even below 100%, even above it, eased across 100% | **easing only** |
| **CONTINUOUS** | a smooth curve through every approved key | approved timing, smoothed | **the interpolation only** |
| **CONTINUOUS + EASED** | the smooth curve | even | both |

**EASING** changes only where on the slider each approved shape is reached.

- With EASED, slider 10, 20, 30, 50 and 75% show the approved 31, 41, 51, 67 and 85% shapes.
- With HYBRID, the same slider points show the approved 26, 32, 40, 59 and 80% shapes.
- Every shape you see is one the approved slider also shows somewhere.

**CONTINUOUS** changes the path between keys: a smooth curve through all nine, instead of straight lines with corners.

- Each key is still reached exactly.
- A smooth curve through a key where part of her surface turns back (her sides at 100%) must either slow down or swing
  slightly past. It is set to stay within 2.2 mm of the range between any two neighbouring keys, everywhere, at every
  size. The test fails above 2.5 mm.
- The cost is that it slows briefly at 100%.

## What the measurements say

This is graph 1, top right: the pace through the slider.

- **CURRENT:** 1.7 for 0–25%, then 10 → 13 → 15, then a drop to 7.3 at 100%.
- **EASED:** the flattest by far, 10.3 → 8.5 → 6.9, with no jumps anywhere.
- **HYBRID:**
  - 5.9 at 0–20%, which is over three times CURRENT's 1.7;
  - a softened rise at 25%;
  - no break at 100% (9.0–10.7 across it);
  - the rest close to the approved.
- **CONTINUOUS on its own improves little.** It smooths the corners, but with the keys at their approved positions the
  pace swings more than before (up to 19.7 near 85%). The 0–20% stays as quiet as CURRENT's.

So the measurements point to easing, not interpolation, as the useful lever. **HYBRID** is the moderate choice and
**EASED** the even one. CONTINUOUS is best judged by eye in the close-ups: the corner it removes is small.

## Sheets

1. `1-curves.png`:
   - which approved shape each slider position shows (easing only);
   - the pace of change in all five modes;
   - how far the front of her bump has come;
   - each key's weight, CURRENT against CONTINUOUS.
2. `2-sizes-all-modes.jpg`: side view at 0, 10, 20, 30, 50, 75, 90, 100, 110, 125, 150, 175 and 200%, in all five
   modes.
3. `3-closeup-25-30.jpg`: 20–35%, where the approved slider jumps.
4. `4-closeup-100.jpg`: 90–110%, where it halves its pace and turns.
5. `5-sweep.gif`: 0 → 200% in 2.5% steps, CURRENT, HYBRID and EASED side by side.

## Safeguards

- **Approved slider unchanged.** It is the default, and `bellyWeights(p)` is byte for byte what it was. A test checks
  every half percent.
- **No new geometry.** No morph target or body geometry changed, and no download changed.
- **Everything else follows the same curve.** The upper-belly weight and the belly shape controls (width, depth,
  upper, lower, height) take the same curve, so they stay matched to the bump.
- **Some things still follow the slider number.** The navel's outie timing (75–100%), the bust's growth, the seat
  corrective and the belly motion all still follow the slider, not the curve. Under EASED and HYBRID her outie still
  rises at slider 75–100%, where the bump shape is a little further along than in CURRENT.
- **Clothes, the drape and the paint follow the body,** because they ride on her morphs.
- **The setting is not saved,** and resets when the room is reopened.

## Checked

- typecheck passes.
- `tests/bellyInterpolation.test.ts` covers:
  - CURRENT unchanged;
  - 0, 100 and 200% exact in every mode, and every key exact in CONTINUOUS;
  - weights add to 1;
  - the slider never runs backwards, and gives the same result forwards and backwards;
  - the measured gaps match the file;
  - CONTINUOUS stays within 2.5 mm, measured at 2.2 mm.
- The renders are from the built room.
