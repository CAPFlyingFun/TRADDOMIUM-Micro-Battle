# Sarah Lab: the Character Studio look, light and dark (alpha.114)

Joshua, 2026-10-23, after trying ChatGPT's Character Studio preview:
- "Use the new UI look, but let's keep both themes like a dark/light color."
- "we could have little screenshots for the outfit which is a cool idea."

## Why the preview was 110 MB and its breast slider spoiled the shirt

Both problems have the same cause: the preview opens Sarah in the old modelled spandex shirt.
- That shirt is 81 MB on its own.
- It is one of the modelled clothes Joshua asked on 2026-10-22 to keep but not load.
- It was fitted at five belly sizes, before the breast sliders existed, so it has no fit that follows them.

The room opens in the painted tee instead. There is nothing to download for it, and it follows every breast shape.

## What the room took from the preview

**The layout (`studioLayout.ts`):**
- A rail of sections:
  - BODY;
  - OUTFIT;
  - FABRIC;
  - BUILD;
  - POSE;
  - LIBRARY.
- An inspector that shows the open section under its title.
- The stage, where she is framed.
- Placement:
  - Landscape: the rail is on the left and the inspector on the right.
  - Upright: the rail is along the bottom and the inspector is a sheet above it.
- FOLD, or tapping the open section again, tucks the inspector away (landscape) or down to its title (upright).
- The old floating panel and the upright tabs (`uprightTabs.ts`) are retired.
- Every control keeps its `data-action`.

**Two themes (`studioTheme.ts`):**
- LIGHT is the preview's look and the default.
- DARK is the room's old colours.
- Every panel reads its colours from the theme. The 3D stage's backdrop and floor follow the theme too.
- The choice is remembered on the device.

**Outfit cards with pictures:**
- OUTFIT › WEAR shows every outfit she can wear as a card with a picture of her in it.
  - The built-in outfits' pictures are baked by `npm run bake:outfits` into `public/sarahlab/outfits/`, about 4 KB each.
  - A shared outfit's picture is taken when it is saved.
  - A tap on a card puts that outfit on.
- LIBRARY shows saved characters as cards with their picture. A tap loads her; the ✕ deletes her after a second tap.
- Pictures go into the save as small JPEGs (168 × 224). Imported files are checked: only a small base64 JPEG, WebP or PNG is kept.

**Custom colour (`fabricTint.ts`):**
- A seventeenth swatch is the phone's colour picker, in FABRIC and in BUILD.
- The colour dyes the family's White swatch in linear light, so the knit keeps its weave.
- It is saved with the outfit, and it stays when the fabric family changes.

**Camera and other controls:**
- FRONT / ¾ / SIDE / BACK camera angles, a whole-figure button and TURN float under her.
- PHOTO (▣) saves what the stage shows at full resolution. It opens the share sheet where there is one, and downloads otherwise.
- Quick sizes 0 / 50 / 100 / 150 / 200 % sit under the bump slider.
- UNDO and REDO cover her body (size and shape). A slider drag counts as one step.

## What the room did not take

- Remote model loading from GitHub.
- The modelled spandex shirt as the default.
- A second, separate save book: there is still one book, and saved characters and outfits are where they were.

## Sheets

1. `1-landscape-light.jpg`: BODY, OUTFIT cards, FABRIC with a custom red, and LIBRARY with a saved character.
2. `2-landscape-dark-and-colour.jpg`: DARK OUTFIT, POSE at the SIDE angle, the colour row with the custom swatch picked, and a shared outfit saved with its own card.
3. `3-portrait.jpg`: upright OUTFIT, FABRIC with a custom blue, folded, and DARK BODY.
4. `4-outfit-pictures.jpg`: the seven baked built-in pictures.

## Checks

- UNDO/REDO: 150% → UNDO gives 100% → REDO gives 150%.
- PHOTO: the file saved is the stage only, with no controls on it.
- The full test suite, typecheck, relay typecheck, build and probe:sarahlab are in the commit message.
