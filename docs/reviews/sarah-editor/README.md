# Sarah Lab: the outfit editor reorganised (2026-10-22, local, for review)

Joshua, 2026-10-22: "When I open the default outfit, I can change the bottoms, but the top doesn't appear to be
selected or easily editable. When entering BODY PAINT, the shirt still appears." He also asked for a portrait-first
editor, clear outfit operations, and the breast and navel detail shared between BODY and BODY PAINT.

This is separate from alpha.107 (pushed as 73c18f1). None of it is committed.

## What was wrong (checked against the code)

ChatGPT's reading was right.

- **The default top wasn't selectable.** The default outfit ("painted tee + leggings") is two paint layers, with no
  garment meshes:
  - layer 1 is the leggings;
  - layer 2 is the tee.

  GARMENT FABRIC lists meshes only, so it was empty. BODY PAINT opened on "Paint layer 1", which is the leggings. So the
  bottoms could be edited, and the top was an unnamed "Paint layer 2".
- **The shirt stayed on in BODY PAINT.** Entering it hid the garment meshes and took off the drape and the cleavage
  bridge, but every paint layer stayed drawn.
- **The breast slider seemed to do nothing.** The detail was set per paint layer, and the panel opened on the leggings
  layer. The breast slider had nothing to act on there; the navel slider did, because the leggings cover her navel.
  Under the tee layer the breast control always worked (sheet 3).

## What changed

**SELECT.** What she has on is listed as pieces.

- Each paint layer is named by what its style makes: TOP, BOTTOM, ONE-PIECE or LEGWEAR, or PAINT when it was painted by
  hand.
- Each modelled garment is listed by its kind.
- + NEW PIECE starts a piece on an empty layer.
- The default outfit opens with TOP selected, and both its pieces are fully editable.

**DESIGN.** Only the controls that apply to the selected piece:

- STYLE (any clothing template) and the edges that style offers: neckline, sleeves, waistband, hem, length;
- fabric family, colour, cover and stitch;
- a garment's trim;
- REMOVE PIECE (tap twice).

ISOLATE shows the selected piece on its own.

**BODY PAINT.** Brush, eraser, fill region, turn her, mirror, undo and redo, clear layer, and regions.

- While painting, her body shows. Garment meshes, the other paint layers, the drape and the bridge are all hidden
  (THIS LAYER).
- ALL PAINT shows the other paint layers again.
- CLEAR BODY hides the layer being painted too.
- Nothing is deleted. Leaving BODY PAINT, folding the editor or switching to another tab puts every piece back.

**SAVE.** The outfit operations:

- It names what is being edited: a built-in outfit, a shared outfit, a personal outfit, or a new one. A CHANGED mark
  shows when it differs from what was put on.
- SAVE CHANGES overwrites a shared or personal outfit, after a second tap to confirm. A built-in outfit is never
  overwritten: SAVE AS NEW keeps your version.
- SAVE AS NEW, SHARED adds it to the library, which any character can wear.
- SAVE AS NEW, PERSONAL saves it as one character's clothes. Her saved body is not touched.
- NEW OUTFIT starts from a blank body, from any built-in outfit, or from any shared outfit.
- The shared outfit list (EDIT, and ✕ tapped twice) moved here from the CHARACTERS panel.
- SAVE ALL / BODY / CLOTHES, LOAD, EXPORT and IMPORT stay in BODY › CHARACTERS.

**BREAST & NAVEL DETAIL.** One setting for the whole outfit, shown in both the BODY tab and the editor.

- Each control has its own AUTO or MANUAL state, and a RESET TO AUTO button that appears when it is manual.
- AUTO comes from each piece's own fabric and construction, using the tracker's formula. Where pieces overlap, the one
  that hides most decides, exactly as the shader does.
- MANUAL applies to every piece over that detail.
- The effect is local: the nipples and areolae, and her navel's own flattening morph. It acts only where paint is.
  Bare skin and the approved body are unchanged (sheet 4, bottom row).
- The setting is saved with the clothes, never with the body:
  - a body-only load does not change it;
  - a character's detail on a shared outfit is saved as one of her overrides;
  - older saves read as AUTO.

## Sheets

1. `1-portrait-editor.jpg`: TOP and BOTTOM selected; BODY PAINT with only the top layer, then CLEAR BODY; back to
   DESIGN with everything restored; the SAVE workspace (430 × 932).
2. `2-sarah-casual.jpg`: the default outfit with the top in red jersey and the bottoms in charcoal athletic knit,
   saved as the shared outfit "Sarah Casual". The original is put back, then Sarah Casual again (390 × 844).
3. `3-detail-0-to-100.jpg`: BREAST and NAVEL at 0, 25, 50, 75 and 100%, at 100% belly, close up, in plain white.
4. `4-detail-auto-size-bare.jpg`:
   - breast detail at breast size +30;
   - AUTO under five fabrics;
   - bare skin with BREAST at 0% and 100%, which look the same.
5. `5-navel-belly-sizes.jpg`: navel 0% and 100% at 50% and 160% belly.
6. `6-body-and-paint-in-sync.jpg`:
   - breast set in BODY shows in BODY PAINT;
   - navel set in BODY PAINT shows in BODY;
   - RESET TO AUTO on the breast leaves the navel manual.
7. `7-landscape.jpg`: DESIGN, BODY PAINT and ISOLATE in landscape.
8. `8-small-phone.jpg`: a 375 × 667 phone. Folding the sheet shows her outfit whole.

## Checked

- typecheck and relay typecheck pass.
- 3,854 tests pass, including new ones for:
  - detail saving: AUTO or MANUAL, through files, as overrides on a shared outfit, and untouched by a body-only save;
  - "changed" detection;
  - Sarah Casual leaving the original alone;
  - every template being named TOP, BOTTOM, ONE-PIECE or LEGWEAR.
- The build, probe:sarahlab and probe:boot pass.
- No model file changed. The approved body, the morphs, the KTX2 pilot (normal map still PNG) and the archive are as
  in alpha.107.

## Not done yet

- **Accessories.** They are not offered, because there are none yet.
- **The belly-curve experiment.** It is kept for later, optional and off by default, as asked.
