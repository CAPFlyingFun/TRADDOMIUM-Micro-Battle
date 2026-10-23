# Sarah Lab: crisp clothing edges, the shirt over her bump, the neckline slider (alpha.110)

Joshua, 2026-10-22 to 23, on the iPhone:

- "change the default as hybrid, but make the current as a backup";
- "add defined cloth edges as there are still frills and not like a solid line boundary of the clothing";
- "the sleeve has a small tear";
- "the shirt and leggings have a z-fight… underneath the belly… the leggings under the belly should win";
- then "the shirt still needs to be in front of the leggings… as there is a sharp edge";
- "around the busts, only the top/outside layer drawn";
- "make sure the sliders isn't taking more than what the slider says";
- "smooth the shape of the neckline, and there are some remaining color on her breasts".

## What changed

- **BELLY CURVE:** HYBRID is the default. CURRENT, the approved slider, is kept as the backup and labelled so.
- **Painted edges are drawn crisp**, at the line where the paint crosses one half (`fabricMaterial.ts`). Before, the soft fade between vertices was the edge. Several things made that line jagged, and each is fixed:
  - **The template ramp.** It is now a straight ramp, not an eased one. With an eased ramp the half-way line bent toward the triangles' own edges.
  - **The crew neckline's sides.** They used a ramp about 0.3 mm wide, which is a hard step. They now use the sideways ramp.
  - **Texture seams.** Her mesh splits about 11,400 points along its texture seams. The paint clean-up now treats both copies of a point as one, so the sleeve end no longer has a notch (`bodyPaint.ts`, `tests/bodyPaintSeams.test.ts`).
  - **Ramps wider than her triangles.** The sleeve end and a front opening now have ramps wider than her triangles there, which are 3–4 cm across on her upper arm and upper chest.
  - **Her front.** A neckline decides "her front" by where her skin is, in front of her neck or not (`forward`, in `bodyRegions.ts`). It no longer uses which way her skin faces, which flips from point to point across her upper chest and shoulder tops.
- **The shirt over her bump** (`tunicDrape.ts`):
  - In front, it hangs nearly straight down from her bump and is open underneath. From the front it covers her; from below, the leggings on her bump show under its hem.
  - Where it shows fully, it stands about 1.5 mm off her skin, so nothing she wears fights through it.
  - Skin it hangs clear of, and skin below its hem, keeps no shirt paint.
  - Its fading fringe lies on her skin, not out past her outline.
- **The neckline slider** (`paintTemplates.ts`):
  - A crew taken lower than a crew's depth becomes one smooth round scoop. It runs from its dip up to the crew's own opening round her neck.
  - Her shoulders stay covered at every setting. Before, below about 40% it opened past her shoulders.
  - U and V necks are unchanged.
- **The cleavage strip** (`cleavageBridge.ts`) is cut level, a hair under the neckline's lowest point. Its top can no longer stand above the paint's neckline on her breasts.
  - An attempt to leave the skin behind it bare ("only the outside layer") was tried and taken out. From above it left ragged holes.
  - With the strip under the neckline, everything seen there is the same shirt.
- **Room lighting:** the ground half of the sky light is brighter, and a soft fill light comes up from low in front, so what is under her belly can be seen.

## Sheets

1. `1-edges-before-after.jpg`: alpha.109 against the patch, tee and tank.
2. `2-tee-hangs-in-front.jpg`: 100% and 200% from the front, the side and below, plus 150% from below.
3. `3-neckline-slider-sweep.jpg`: the slider at 0/20/40/60/80/100%, from the front and from above. Rendered one fix before the final one.
4. `4-neckline-60-from-above-final.jpg`: 60% from above with the final fix.
5. `5-leotard-her-right.jpg`: the painted leotard from the front round to behind her right side.
6. `6-neckline-before.jpg`: the same sweep before this work.

## Still to watch

- **On her right upper chest** her triangles are a few centimetres across. A neckline's line can bend no finer than that there, so a slight wobble can show from above at 40–60%.
- **At 200%** her bump hangs about as low as the hem. There is little of the shirt left in front to hang open, so from below the shirt there is mostly its outside.

## Checked

- typecheck and relay typecheck pass.
- 3,862 tests pass, including the new seam test and a test that a lowered neckline keeps her shoulders covered.
- The build passes, and `probe:sarahlab` passes with no console errors.
- The renders above come from the built room.
