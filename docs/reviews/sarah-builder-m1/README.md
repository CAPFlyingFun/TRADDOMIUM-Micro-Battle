# Sarah Lab: clothing builder, milestone 1 (alpha.113)

Joshua, 2026-10-23: "a simple clothing and fabric builder inside Character Creation... keep the first milestone small: make one editable strip or bikini strap that attaches correctly, survives the sliders and animations, saves and reloads, and works well on mobile. Show me that working before expanding to panels and more advanced tools."

## What there is

**CLOTHES → BUILD** (`strapBuilder.ts`) has:
- **Pieces:**
  - + STRIP: a flat band, such as a bikini strap or trim.
  - + CORD: a round string.
- **EDIT POINTS / MOVE CAMERA:**
  - In EDIT, one finger edits and two fingers still turn and zoom.
  - In CAMERA, one finger turns her.
- **Tools:**
  - ADD: tap her for a point, or drag across her to draw a path.
  - MOVE: drag a handle along her skin.
  - The selected point has a large gold handle, the first point is green, and the rest are small dots.
- **Point controls:** step to the previous or next point; nudge X (across her), Y (up and down her) and Z (off her skin); BRIDGE TO NEXT, so the stretch to the next point spans straight instead of following her skin; DELETE POINT.
- **Shape:** width, thickness, clearance off her skin, LOOP and EDGING, and fabric from the pack (family and colour).
- **Edits:** UNDO, REDO, MIRROR COPY (the same strap on her other side), DELETE PIECE.
- **Motion:** PLAY or PAUSE her animation, run it at 1×, ½× or ¼×, and STEP it a frame at a time.

## How it works

**Attachment** (`bodySurface.ts`):
- Every point is a triangle of her body and barycentric weights in it, snapped once and never searched for again.
- Each frame the point is read off her posed body: morphs (including their normals), sliders and bones.
- Between points that follow her skin and are more than 4 cm apart, the path along her skin is walked once, at rest.

**Mesh** (`strapMesh.ts`):
- A centripetal Catmull-Rom curve runs through the anchors, resampled every 3 mm.
- A strip has a real thickness and flat-shaded faces; a cord is a round tube.
- The mesh stands CLEARANCE off her skin.

**Edging:** a strip with EDGING wears its family's trim strip, stitched edges and all, laid along its length, so the edging follows the strap's own curve. Painted clothes are different: their edge is where the paint's coverage crosses one half on her skin, and the recovered garments' edging is baked into their textures.

**Saves** (`strapData.ts`, `characterSaves.ts`):
- The data only (pieces, points, attachments, fabric, settings) goes into the outfit and character saves as `built`.
- The mesh is made from that data.
- Imported files are read defensively.
- Pieces built on another model are refused.

## Sheets

1. `1-strip-landscape.jpg`: a strip drawn across her belly.
   - It is shown at 100%, 200%, WALK and SIT.
   - It was saved as a shared outfit, deleted, and the save put back on.
   - A close-up at 200% shows the edging.
2. `2-cord-portrait.jpg`: held upright, three taps make a cord across her chest. With the sheet folded, the cord is on her.

## Not in this milestone

- Rotating or scaling a whole piece, and selecting all its points.
- Panels.
- Highlighting where a strap intersects, stretches or floats.
- OBJ/GLB export.
