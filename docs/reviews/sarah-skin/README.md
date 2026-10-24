# Sarah's skin: switch, upload, paint (alpha.123)

Joshua, 2026-10-24: "Can you compress all the images and add a button to switch between them, and maybe a simple
body texture uploaded/paint?"

The Sarah Lab has a new **FACE** section (rail, between Body and Outfit). This checkpoint holds her skin. Her face
and hair controls come later.

- **SKIN** steps through the skins:
  - ORIGINAL: the body file's own map, nothing downloaded.
  - AI 1254: ChatGPT's experimental pass.
  - BAZAART: Joshua's 2048 enhancement.
  - 4K UPSCALE.
  - UPLOAD, once there is one.

  Each candidate is fetched the first time it is chosen, and only one candidate is kept on the GPU at a time. The
  room remembers the choice. The line under SKIN gives what the choice costs on the GPU (the 4K is 85 MB, four times
  the others).
- **The files** are WebP at quality 90 made from his images: 0.23 to 0.66 MB, where the PNGs were 2.5 to 11.6 MB.
  Against the sources they measure 41 to 48 dB PSNR.
  - `public/models/skins/` holds them, plus the original as a WebP for the brush to start from under `?skin=ktx2`.
  - The approved body file is unchanged.
- **UPLOAD SKIN…** takes any picture from the phone and puts it on her as her atlas. A picture that is not square is
  flagged.
- **PAINT SKIN** paints on whichever skin she wears (`skinPaint.ts`).
  - The brush works in 3D on her rest surface, not in the image. Her atlas is hundreds of scattered islands, so a
    stroke runs across texture seams without a break.
  - The brush has eight swatches plus any colour, a size from 1 mm to 6 cm, strength, a soft or hard edge, erase
    (back to the skin underneath), undo, redo and clear.
  - SAVE PNG hands back the painted atlas, which UPLOAD SKIN puts back on her.
  - The brush paints on a copy at most 2048 square.
- **CLOTHES · HIDDEN** takes off what she wears, both the modelled garments and the painted clothes, while her skin
  is painted. Leaving FACE puts it all back.

Sheets:
- `01-skins.jpg`: the four skins.
- `02-paint.jpg`: strokes, a side view, then undo.
- `03-upload-portrait.jpg`: an upload, held upright, clothes hidden.
