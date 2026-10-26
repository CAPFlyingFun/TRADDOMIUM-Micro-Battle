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

**Sarah's four mesh spots: approved** (Joshua, 25 Oct: "finish the 4 things, the other
part you saw that needs fixing… then render finally screenshots and it's all good, you can
push at once"). Applied in alpha.128: see "Sarah's mesh spots" below.

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

## Sarah's mesh spots (alpha.128)

The colour map couldn't hide these in alpha.127, because they are shapes in her mesh.
"Geometry only" renders (flat colour, flat normal map) show each one.

- **Neck-front seam**, the line across the base of the neck where the head was joined on:
  ROUNDED in the mesh, and its line taken out of the normal and colour maps. A soft
  highlight is left at the bottom of the notch.
- **Line behind the knees**: rounded in the mesh, and out of both maps.
- **Fuzzy fringe along the under-breast crease** (very thin folded triangles): rounded.
- **Bikini crease at the top of the seat**: no mesh change; this one is colour. The dark
  V it left is smoothed in the colour map.
- **Pale patch under her right breast**, found while doing these, and already in the
  alpha.127 maps: one small atlas patch looked lighter than the skin round it. The
  touch-up gives the skin's grain back measured inside each patch, and a patch's own
  edge carries the bake's seam, so the edge rim came back as "grain". The chest's
  grain now fades out over 4 texels at a patch edge (`edge_grain_px`).

**How the mesh is rounded.** A seam's band is smoothed by small Laplacian steps
(`pleat.py` `"mode": "fillet"`), each vertex capped at 3-4 mm, and the shading normals
turn by exactly as much as the surface does, so the band's edge shows no step. Then:

- **Held clear of her clothes.** A rounded seam moves skin out as well as in, and she
  wears fitted clothes over these places. `garment_clearance.py` poses the body, the
  bikini top (in her file), the bikini bottom and the fitted light tee at belly 0, 50,
  100, 150 and 200%, and measures along her normals: no fixed vertex may come closer to
  a garment than 0.3 mm or than it already was. 11 vertices gave back some or all of
  their move to pass. Least clearance after: 0.32 mm.
- **Every belly size.** The morph targets are deltas added to these positions, so the
  one fix carries through all of them.
- **Where it is stored.** `art/humans/base-touchup/sarah-v2/mesh-fix.json`: 4,863 of her
  115,710 vertices (neck 1,958; under-breast 1,772; knees 1,133), largest move 5.2 mm,
  stored on her file's own int16 grid. `body-slim.mjs` writes them into the slim body.
  Nothing between knee and chest moves: her navel, belly and the bikini areas are
  untouched, and so are her morph targets, the bikini and every other primitive.
- **The archive.** `assets-archive/models/sarah-v2-body.glb` stays byte for byte.

Her big-toe nail keeps a dark mark: nails are protected from the smoothing on purpose.

## Files and the run

- **Tools:** `scripts/baseTouchup/`, each listed in `scripts/MANUAL.md`. They need
  Python 3 with numpy, scipy, Pillow and OpenCV. The working folder is `$TOUCHUP_WORK`
  (default `.scratch/baseTouchup`).
- **Specs:** `art/humans/base-touchup/specs/`
  - `male-skin.json`, `sarah-skin.json`: colour and normal-map regions
  - `male-pleats.json`, `sarah-pleats.json`: the mesh seams
  - `art/humans/base-touchup/male/`: the two per-vertex fields `male-skin.json` reads
- **Sarah's approved maps and mesh fix:** `art/humans/base-touchup/sarah-v2/`
  (`base.png`, `normal.png`, `mesh-fix.json`). `scripts/sarahV2Recovery/body-slim.mjs`
  puts them on her slim body when it builds it from the archive.
  `assets-archive/models/sarah-v2-body.glb` stays byte for byte.
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
4. Mesh seams:
   ```
   python3 scripts/baseTouchup/pleat.py <tag> art/humans/base-touchup/specs/<tag>-pleats.json
   ```
5. Write the touched GLB (male; Sarah's is below):
   ```
   node scripts/baseTouchup/write_glb.mjs <in.glb> <out.glb> pos=… nor=… base=… normal=…
   ```

The male's colour maps go into his GLB as JPEG q95. Sarah's go in as PNG, through
`body-slim.mjs`.

### Sarah's mesh fix

Her positions are quantized, so her fix is a list of vertices on her file's own grid
rather than a rewritten file. From the repo, with `W` a scratch folder (this reproduces
`mesh-fix.json` byte for byte):

```
node scripts/sarahV2Recovery/body-slim.mjs --out $W/slim-nofix.glb --mesh-fix none
node scripts/baseTouchup/dump.mjs $W/slim-nofix.glb $W/sarah
TOUCHUP_WORK=$W python3 scripts/baseTouchup/pleat.py sarah art/humans/base-touchup/specs/sarah-pleats.json
for s in s0:belly=1 s50:belly50=1 s100: s150:belly150=1 s200:belly200=1; do
  for g in body:$W/slim-nofix.glb bottom:public/models/sarah-v2-bottom.glb tee:public/models/sarah-v2-spandex-lite.glb; do
    node scripts/baseTouchup/posed.mjs ${g#*:} $W/posed/${g%%:*} ${s%%:*} ${s#*:}
  done
done
TOUCHUP_WORK=$W python3 scripts/baseTouchup/garment_clearance.py sarah $W/posed s0,s50,s100,s150,s200
node scripts/baseTouchup/mesh_fix.mjs $W/slim-nofix.glb $W/sarah/new-pos.bin $W/sarah/new-nor.bin art/humans/base-touchup/sarah-v2/mesh-fix.json
node scripts/sarahV2Recovery/body-slim.mjs && node scripts/sarahV2Recovery/body-ktx2.mjs
```
