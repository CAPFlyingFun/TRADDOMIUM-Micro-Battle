# Sarah: download and memory (2026-10-22)

Joshua, 2026-10-21: "how can we save memory and download size for the outfits... go ahead with the plan... I do
think we should try body paint for all the clothing".

## What changed

1. **The room opens on a slim copy of the approved body.** `sarah-v2-body.glb` is untouched (its SHA still starts
   `47e990f0`). `scripts/sarahV2Recovery/body-slim.mjs` writes `sarah-v2-body-slim.glb` from it without the parts the
   room no longer draws from it:
   - both rises of leggings and their trims, each replaced long ago by its own fitted file;
   - the grown tee and its trims, which the v2 body never wears.

   It keeps her body, the whole bikini, the skeleton, every morph target and every vertex in its order. The script
   decodes both files, compares every kept array, and refuses to write if any differs. **37.4 MB → 18.1 MB.**
2. **Shapes that move nothing are not sent to the graphics card** (`src/view/morphPrune.ts`). A glTF mesh's parts
   share one list of shapes, so every strap and trim carried all of her body's shapes, mostly zeros. On load, each
   part now drops the shapes that move nothing on it, and the lighting deltas where none bends a normal. A part where
   nothing moves at all draws as a plain mesh. She looks exactly the same.
3. **Painted outfits.** The white tee over grey leggings, in both rises, plus a swimsuit and a leotard, are now paint
   on her own skin (OUTFIT cycles to them).
   - They download nothing and carry no shapes of their own: the paint follows every belly and breast shape.
   - The room opens in the painted tee and leggings.
   - The modelled outfits are still in the OUTFIT cycle until you decide which to retire.
   - The bikini stays modelled: its cups and design are protected.

## The numbers

Download is what the room fetches for the outfit. Graphics memory is the morph-shape texture three.js keeps on the
graphics card, measured from the files the same way before and after. Shapes the room already lifts to the CPU at
load are not counted in either column.

| Outfit | Download before | Download now | Graphics memory before | Graphics memory now |
|---|---|---|---|---|
| None | 37.4 MB | 18.1 MB | 81 MB | 71 MB |
| Bikini | 39.1 MB | 19.7 MB | 114 MB | 94 MB |
| Relaxed tee + high leggings | 116.0 MB | 96.6 MB | 224 MB | 190 MB |
| Relaxed tee + low leggings | 112.7 MB | 93.4 MB | 220 MB | 182 MB |
| Spandex tee + high leggings | 126.9 MB | 107.6 MB | 234 MB | 198 MB |
| Spandex tee + low leggings | 123.7 MB | 104.3 MB | 230 MB | 190 MB |
| **Any painted outfit** | | **18.1 MB** | | **71 MB** |

A painted outfit adds about 1.4 MB of paint data per vertex layer set, and one fabric atlas per fabric family used
(about 1 MB each, fetched when first worn).

## Sheets

- `1-painted-0pct.jpg`: the painted tee with high and with low leggings at belly 0%, front, 45° and side.
- `2-painted-100-200pct.jpg`: the same at 100% and 200%.
- `3-modelled-still-work.jpg`: modelled outfits before and now, to show the shape clean-up changed nothing.

## Still open

- **Retiring modelled garments.** Once you are happy with the painted ones, the relaxed and spandex shirt files
  (66–77 MB each) and the leggings files can leave the OUTFIT cycle. A relaxed shirt hangs off her body, which paint
  cannot do; the painted tee is the fitted look.
- **Half-precision shapes on the graphics card** would halve the remaining 71 MB. That needs a change inside
  three.js's morph texture, so it is left for a separate, measured step.
- **Compressed skin textures (KTX2)** for her 2048 skin maps, tied to the quality setting.
