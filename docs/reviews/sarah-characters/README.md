# Sarah Lab: character saves, the outfit library, RANDOMIZE, and three size cuts (2026-10-22)

Joshua, 2026-10-22: "work on all 3", meaning the three optimizations from Replit's audit. Also: "save outfits separately
from the body, or together... the option to save all, just the body, or just clothing", and "is there a body
randomize button... can lock down things you don't want to change". Then, while it was being built: "every slider
and slider group to support adjustable randomization ranges... group locks, such as BELLY and BREAST... outfits to
exist independently of characters... A personal outfit can reference a shared preset and store character-specific
overrides... Editing that character's copy should not unexpectedly change the shared original."

## Characters and outfits

The **CHARACTERS & OUTFITS** section is in the body controls. (Later the same day the shared outfit library moved to CLOTHES › EDIT OUTFIT › SAVE: see `docs/reviews/sarah-editor/`.)

- **SAVE ALL / SAVE BODY / SAVE CLOTHES** under a name (Sarah, Lena, ...).
  - The body is: the model, her bump (her starting size), every belly and breast shape control, CURVE, and her
    RANDOMIZE ranges and locks.
  - The clothes are: the outfit, every paint layer (its template and dials, or its hand-painted mask), fabric, colour,
    stitch, detail through paint, each modelled garment's fabric, and the shirt length.
  - Saving one part under a name keeps the other part that name already holds. LOAD puts on only what the save holds.
- **OUTFIT LIBRARY**: SAVE OUTFIT keeps what she wears as an outfit anyone can WEAR.
  - An outfit is paint and fabric on the shared base model, with no geometry or images of its own, so wearing it costs
    nothing extra.
  - When a character wears a library outfit and you change its colours, fabrics, detail, garments or length, SAVE
    CLOTHES keeps her clothes as **a reference to that outfit plus only her changes**. The library outfit itself is never
    touched.
  - Changing the outfit's make (another template, a moved dial, hand painting) saves her own whole outfit instead.
- **EXPORT / IMPORT**: one file holds every character and outfit. An imported name replaces the same name. Saves are
  kept on the device in between.
- Deleting asks twice: the first tap arms it.

The story clock that grows her bump from its starting value and later eases it back is the game's, and is not built
yet. The save holds the start it will grow from.

## RANDOMIZE

- **RANDOMIZE** picks every unlocked control from its own range.
- **🔒 on each control** (the bump too) keeps it exactly as set.
- **BELLY 🔒 and BREAST 🔒** hold a whole group. Unlocking a group gives back the single locks set inside it.
- **RANGES** shows each control's random range to change it. For example, Lena's bump at 0 to 40. Until a range is
  changed, the bump uses its whole slider and a shape control uses twice its natural variation either side of her
  approved value.
- **Saved with the body.** The ranges and locks are part of a body save.
- **Future controls.** A control added later (height, hips, waist, arms, face) gets a lock and a range with no other
  change (`src/actor/bodyRandom.ts`, `BODY_RANDOM_SPECS`).

## Size

| | before | now |
|---|---|---|
| Her body, as downloaded (gzip) | 14.8 MB | **12.0 MB** |
| With the KTX2 skin pilot (`?skin=ktx2`) | — | **9.5 MB** |
| Files shipped with the site | 434 MB | 158 MB (the KTX2 pilot file included) |

1. **Morph normals.** 43 morph-normal sets were full floats with values up to 2, so they cannot become 16-bit
   integers. They are rounded to steps of 1/1024 instead, under a tenth of a degree of light direction, and compress far
   better. The before and after renders differ only along her outline, from idle motion. `body-slim.mjs` checks every
   value within half a step.
2. **KTX2 pilot.** Open the room with `?skin=ktx2`. Her colour map is ETC1S: 3.0 MB to 0.5 MB, and about 21 MB of
   graphics memory to about 5. Her normal map stays PNG: encoded as UASTC it rendered in dark blotches in the headless
   test renderer, which needs a check on a real iPhone before it is used. The transcoder (`public/libs/basis/`, about
   260 KB) loads only when a KTX2 texture is used. The status line says "KTX2 skin" while it is in force.
3. **Archive.** 274 MB of files the room no longer requests moved from `public/` to `assets-archive/`, still in the
   repository:
   - the approved full body (unchanged, sha 47e990f0);
   - both fitted leggings;
   - the four modelled shirts and their 62 buffers.
   The scripts and tests that use them read them there. To offer the modelled outfits again, move them back.

## Sheets

- `1-randomize.jpg`: RANDOMIZE twice, then with BELLY locked.
- `2-controls.jpg`: the locks and ranges, and the saves panel.
- `3-ktx2-skin.jpg`: PNG skin next to the KTX2 colour pilot.
- `4-same-body.jpg`: the body before and after the morph-normal change.
