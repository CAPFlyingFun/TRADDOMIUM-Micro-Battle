# Sarah's light spandex tee (alpha.116)

Joshua, 2026-10-23, after the painted red tee: "the neckline, and bottom hem. The top is more rounded and yours is more square... is there a way to use that shirt ChatGPT used, but then basically compress it/make it a lot less vertices and try and optimize it for speed, size, and quality?" Then: "Shirt length is good."

## What she wears now

The room opens in **Sarah · red spandex tee + charcoal leggings**:
- The tee is the modelled spandex tee ChatGPT recovered, made light.
- It is dyed her red (`#be0f2a`) on jersey.
- The over-belly leggings are painted under it in charcoal.

Its round scoop neck and its curved hem are the picture's. The painted crew neck and its straight hem were not.

The all-painted red tee is still a card in OUTFIT › WEAR.

## The light tee

`scripts/sarahV2Recovery/shirt-lite.mjs` writes `public/models/sarah-v2-spandex-lite.glb` from `assets-archive/models/sarah-v2-spandex-high.gltf`.

| | original | light |
|---|---|---|
| download | 81 MB | **4.3 MB** |
| vertices | 166,332 | 20,705 |
| triangles | 308,870 | 32,000 |
| belly-size fits, navel fits, shapes | 79 | the same 79, by the same names |

How it was made:

- **Simplified once, for every belly size.** meshoptimizer measures its error on the tee at 0, 50, 100, 150 and 200% and at two navel fits, not only at 100%. Triangles stay small where any size needs them and grow where the cloth is flat at every size.
- **Her navel's cloth is kept whole.** The cloth within 7 mm of her navel, at each of the 31 navel-fit sizes, is not simplified. The tee's one small bump over her navel is therefore the original's, and the navel test now holds the light tee to the same 0.2 mm cover as the originals.
- **Every kept point is an original point.** Its position, UV, bone weights and belly shapes are copied, not recomputed.
- **Measured.** At 0%, 100% and 200%, every original point lies within 1.2 mm of the light tee's surface, and 99% lie within 0.6 mm. The script refuses to write past 1.5 mm.
- **Stored small.** Shape offsets are 16-bit integers (a step of 0.03 mm), textures are 1024 px, and everything is meshopt-compressed.

## The bust no longer creases (`3-bust.jpg`)

Each of the tee's breast shapes had been copied from the one skin triangle a cloth point was bound to. Where the cloth bridges a hollow (the cleavage, the fold under each breast), it was bound to skin deep in the hollow. As the breasts grew, the hollow deepened, the cloth followed it in, and a crease formed across the bust.

`scripts/sarahV2Recovery/shirt-bust.mjs` lays every breast shape again:
- Each shape is smoothed over the cloth.
- Each cloth point is then held at least as far off her grown skin as it stands at rest.
- `shape:breastGrowMore` is laid on top of a fully grown `breastGrow`, the only way it is ever used.

Before, the shapes let the cloth up to 12.8 mm into her. Now they allow at most a millimetre or two, at a handful of points.

Each belly-size fit was made with her breasts at that size. The fit takes back whatever the new breast shapes changed at its own size, so with SIZE untouched every fit is exactly as approved.

## Sheets

1. `1-light-tee.jpg`: front, ¾, side and back at 100%, as the room opens.
2. `2-sizes.jpg`: 0, 50, 100, 150 and 200%.
3. `3-bust.jpg`: SIZE +80 before (the stored breast shapes) and now, and +100 from the front.
4. `4-poses.jpg`: sitting and walking.

## Left as it is

- A faint line remains under the bust at SIZE +100. It is a soft edge of light rather than a crease.
- Seen from the side while she sits, the inside of the neckline shows as a dark sliver. The original tee does the same.
- The sleeves are the tee's own cap sleeves. The picture's are a little longer.
