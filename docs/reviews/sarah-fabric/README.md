# Sarah Lab: FABRIC editor, body regions and coverage templates (for review)

Joshua, 2026-10-20. Use the texture pack in the CLOTHES tab, with garment fabric and body paint kept separate. Then,
after the first paint renders: map the body into regions, and propose clothing coverage templates with adjustable
edges. This is a proposal to review before the full Clothing Builder. It is local only.

## What is in the CLOTHES tab now

**FABRIC · GARMENT FABRIC**
- Pick a garment she is wearing, then a family (Jersey, Athletic, Sweater, Ribbed, Pantyhose) and one of its 16 colours.
- Trim: MATCH, or its own family and colour.
- OPACITY (hosiery starts at 50%) and STITCH (0.5× to 2×).
- ORIGINAL puts the garment's own material back.
- Real garment geometry stays as it is, and her skin material is not touched.

**FABRIC · BODY PAINT**
- All clothing is hidden while painting. Leaving paint mode puts it back over the paint.
- Three layers, each with its own fabric.
- Tools:
  - BRUSH, ERASER, TAP A REGION, TURN HER.
  - Brush size in cm.
  - MIRROR L ↔ R, UNDO, REDO, RESET LAYER.
- Region buttons, each for BOTH SIDES / HER LEFT / HER RIGHT. With the eraser, a region button clears that region.
- SHOW REGIONS, the overlay in the region shots.
- Clothing templates, then dials to move their edges: WAISTBAND, LEG TOP, LEG LENGTH, HEM / BELLY, NECKLINE, SLEEVE.

## How it stays attached to her

- **The fabric pattern** is laid on by triplanar projection from her rest surface (the approved shape before any belly
  or fit field). It needs no UVs, has no seams, and rides every pose. As her belly grows the knit stretches with it,
  as real fabric does. The cost: at 190% the stitches read about 1.4× larger on the bump.
- **Paint is a weight at every body vertex**, held in a new attribute beside her approved data. It moves exactly as
  the vertices do, through every morph, shape field and bone. The skin texture is never changed; RESET returns the
  approved body.
- **Regions and templates are worked out once on her rest surface** and stored per vertex, never from her current
  world position:
  - Limbs come from her own skin weights: the bone that carries the vertex and where it sits along that bone.
  - The torso is divided by height on her trunk (hip joints to the base of the neck), front from back by its surface
    direction. Her skin weights give the belly to the pelvis bone and the breasts to the spine, so bones alone could
    not split the torso.
  - The head and neck are divided by distance from the neck's own axis.
  - All lines are fractions of her own skeleton, so the same map and templates fit Lena or anyone else on the same
    base model.
- **Template edges are smooth curves** around her, not the triangles' sawtooth. Brushing never reaches through to the
  opposite side of an arm or leg.

## Regions (24)

| Area | Regions |
|---|---|
| Head | face, scalp, neck |
| Torso | chest, upper back, belly, lower back, hips, seat, crotch |
| Arms, left and right | shoulder & upper arm, forearm, hand |
| Legs, left and right | upper thigh, knee, calf & ankle, foot |

## Templates (coverage masks, not 3D garments)

| Group | Templates |
|---|---|
| Leggings | full-length, capri, knee-length (each over-belly), under-belly |
| Shorts | athletic, mid-thigh, knee-length |
| Shirts | tank, sleeveless, short-sleeve tee, long-sleeve, crop, maternity tee (front hem dial) |
| Other | bodysuit, one-piece swimsuit, thigh-high stockings, crew socks |

Necklines are an opening around her neck rather than a straight cut, so a lower neckline is also wider: crew, scoop
and tank differ the way real ones do.

## Known limits, for the next pass

- **The tank top has no straps yet.** It reads as a bandeau, because the skin over her shoulder tops belongs to the
  arm regions. Straps need a band carried front-to-back over the shoulder. The sleeveless shirt is fine.
- **Necklines are square-ish.** The opening is round her neck in plan. A true scoop or V needs a front-depth curve,
  which is the next neckline dial.

- **Shirt trim:** the recovered shirts' edging is baked into their own texture, so it follows the shirt's fabric.
  Separate shirt trim comes with the new tee.
- **Template edits:** moving a dial rebuilds that layer from the template. Hand painting on a layer detaches it from
  its template, and UNDO steps back.
- **Region boundaries:** the lines (`MAP_LINES` in `bodyRegions.ts`) are tuned on Sarah at 100% from these shots.
  The flank seam and the face/neck line are the ones to check.
- **Outfit presets:** `OutfitConfig` (`fabricLibrary.ts`) is the JSON shape for saving an outfit: garments, fabric and
  colour ids, trim, opacity, stitch, and paint layers as per-vertex masks. There is no preset manager yet.

## Sheets

1. `1-regions.jpg`: the region map from the front, side and back, with SHOW REGIONS on.
2. `2-templates.jpg`: coverage templates and dials, painted in ribbed black and jersey red.
3. `3-garment-fabric.jpg`: garment fabric on the real tee and leggings, and the clothes back over the paint.
4. `4-portrait.jpg`: the panel held upright, in both modes.
5. `5-brush-layers.jpg`: layers, brush and eraser (from before the region map).
