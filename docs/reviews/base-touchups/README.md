# Base body touch-ups: male base (Meshy) and Sarah v2

Review sheets for Joshua's 25 Oct request: touch up the male and female bases so their
skin and texture match, remove the horizontal line around the male's bladder, and
smooth the skin selectively (Sarah's crotch, under the breasts, top of the belly). The
sheets go region by region. Each shows the untouched body ("Before") above the touched
body ("After"), under the same studio light.

| Sheet | Region |
|---|---|
| `1-face.jpg` | Face and neck |
| `2-arms-hands.jpg` | Arms and hands |
| `3-chest.jpg` | Chest (Sarah: the under-breast crease) |
| `4-belly.jpg` | Belly (male: the brief line; Sarah: the middle seam) |
| `5-groin.jpg` | Groin and leg creases |
| `6-legs.jpg` | Legs, front and back |
| `7-feet.jpg` | Feet and toes |
| `8-back.jpg` | Back and seat |

**Status: approved** (Joshua, 25 Oct 16:16: "Good to push the updated textures").
Applied in alpha.127:

- **Sarah v2:** her game body, `public/models/sarah-v2-body-slim.glb`, wears the
  touched colour and normal maps. So does its KTX2 pilot. Her geometry is unchanged.
- **Male base:** archived as a starter for Jack and the other men. Nothing loads him yet.
  - original: `assets-archive/models/male-base-meshy.glb`
  - touched: `assets-archive/models/male-base-touched.glb`

Sarah's four mesh spots (below) are the next step, waiting on their own sheets.

## What changed

**Colour map, both bodies.** Meshy bakes shading into the colour map in hundreds of
small atlas patches, and their edges show on the skin. The edits are made on the
body's surface in 3D, not in the scattered atlas. For each texel:

- find where it sits on the body;
- detect colour steps the skin's shape doesn't explain;
- smooth those across the surface;
- give back the skin's own fine grain, measured inside each atlas patch so a patch edge
  carries nothing from its neighbour. A texel much stronger than the region's own grain
  is treated as a line, not a pore, and stays smooth.

Fine grain kept versus the original (mean pore contrast):

| Body | Grain kept | Colour step at patch edges |
|---|---|---|
| Male | about 90% | halved |
| Sarah | about 85% | more than halved |

Every texel not edited keeps its exact original bytes, including the gutters between
patches. Sarah's navel and nipples are untouched: the 2 cm around her navel is
byte-identical.

**Male mesh.** These are moulded seams in the mesh itself, removed by fitting the clean
skin on either side and projecting the seam onto that fit:

- the brief line (the line around the bladder);
- the sternum line;
- the ridge across the front of the neck;
- the two edges of the V-shaped panel on the back, with the lumps where they meet the spine;
- the shading line behind the knees;
- torn finger webbing and merged toes.

Every fit is bounded to 4 mm, and fitting only uses skin facing the same way, so an
armpit fit can't reach the inside of the arm. Skinning, UVs and the rig are unchanged.

**Sarah's mesh is not changed.** It is her approved body.

## Left for Joshua to decide (Sarah)

The colour map can't hide these, because they are shapes in her approved mesh. The
"geometry only" diagnostic renders (flat colour, flat normal map) show each one:

- **Neck-front seam.** The line across the base of the neck, where the head was joined on.
- **Line behind the knees.** A density/shading step in the mesh.
- **Bikini crease at the top of the seat.** The colour outline is faded; a slight crease
  is left.
- **Fuzzy fringe at the outer ends of the under-breast crease.** Very thin folded triangles.

The same kind of mesh fix the male got would remove each one. Joshua asked for it on
25 Oct, to be shown at belly 0, 50, 100, 150 and 200% before anything is pushed. Her
big-toe nail keeps a dark mark: nails are protected from the smoothing on purpose.

## Files and the run

- **Tools:** `scripts/baseTouchup/`, each listed in `scripts/MANUAL.md`. They need
  Python 3 with numpy, scipy, Pillow and OpenCV. The working folder is `$TOUCHUP_WORK`
  (default `.scratch/baseTouchup`).
- **Specs:** `art/humans/base-touchup/specs/`
  - `male-skin.json`, `sarah-skin.json`: colour and normal-map regions
  - `male-pleats.json`: the male's mesh seams
  - `art/humans/base-touchup/male/`: the two per-vertex fields `male-skin.json` reads
- **Sarah's approved maps:** `art/humans/base-touchup/sarah-v2/{base,normal}.png`.
  `scripts/sarahV2Recovery/body-slim.mjs` puts them on her slim body when it builds it
  from the archive. `assets-archive/models/sarah-v2-body.glb` stays byte for byte.
- **Male:** `assets-archive/models/male-base-meshy.glb` (Meshy's file as received) and
  `assets-archive/models/male-base-touched.glb` (the approved touch-up).

### The run, for one body (`<tag>` is `male` or `sarah`)

1. Dump the body and extract its textures:
   ```
   node scripts/baseTouchup/dump.mjs <body.glb> .scratch/baseTouchup/<tag>
   node scripts/baseTouchup/extract.mjs <body.glb> <tag>
   ```
2. Bake the per-texel maps and the chart ids:
   ```
   python3 scripts/baseTouchup/bake_maps.py <tag>
   python3 scripts/baseTouchup/charts.py <tag>
   ```
3. Touch up the colour and normal maps:
   ```
   python3 scripts/baseTouchup/touch.py <tag> art/humans/base-touchup/specs/<tag>-skin.json <outdir>
   ```
4. Mesh seams (male only so far):
   ```
   python3 scripts/baseTouchup/pleat.py <tag> art/humans/base-touchup/specs/<tag>-pleats.json
   ```
5. Write the touched GLB:
   ```
   node scripts/baseTouchup/write_glb.mjs <in.glb> <out.glb> pos=… nor=… base=… normal=…
   ```

The male's colour maps go into his GLB as JPEG q95. Sarah's go in as PNG, through
`body-slim.mjs`.
