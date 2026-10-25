# Sarah v2's hair (waiting for his approval)

Joshua, 2026-10-24: "Start with one face and one hairstyle for Sarah v2. Use our existing Sarah references and assets
where they help... Check that the hair follows her head cleanly, avoids obvious clipping through her shoulders or
shirt, and performs well on my iPhone."

The reference is TMB-Story's character sheet (`assets/source/sarah-sheet.png`): copper-auburn wavy hair, a middle
parting with curtain bangs framing her face, and a ponytail tied with a black elastic at the back of her head, about
level with her eyes, falling in loose waves between her shoulder blades.

`scripts/sarahV2Recovery/hair-bake.mjs` writes `public/models/sarah-v2-hair.glb`: one skinned mesh on her own skeleton
(the body file's joints, in their order), one material, and one texture made in the script. The bake is
deterministic. The room binds the hair to her as it binds every recovered garment, and the FACE section's **HAIR**
turns it off and on. CLOTHES · HIDDEN and the outfit editor leave it on.

- **The cap** is built on rays from the middle of her head.
  - Its rows run from her hairline to the tie, so every strand of the texture runs toward the elastic.
  - It is fuller over the crown and above her ears and gathered at the tie.
  - The hairline is a smooth curve. Vertex alpha cuts it through the triangles, not along their edges.
  - Two shells of loose strands lie a few millimetres over it, so the light catches strands and not a smooth shell.
- **The ponytail** is an opaque core with 44 clumps of strand cards in loose waves, flaring a little at the ends.
  - Its path holds every point clear of her head, neck and back, and the tee over it.
  - It is weighted to her head at the elastic and gives way to her neck and upper back down its length, so a turned or
    lowered head never drives it into her back.
- **The curtain** is two layers of locks from her middle parting, lying on the cap at the root, over each temple and
  down in front of her ears to her jaw.
  - Each lock is two crossed cards, so it has width from the front as well as the side.
  - They are held off her face.
- **The elastic** is a small torus, dark through its vertex colour.
- **Lighting**: every card is lit by the normal of the volume it belongs to, on both sides (`hairMaterial.ts`), so a
  lock shades as one round thing.

## Cost

| | |
|---|---|
| Download | 0.79 MB (the texture is WebP, 200 KB; as PNG it would be 1.3 MB) |
| Triangles | 28,020 |
| Vertices | 17,012 |
| Draw calls | 1 |
| Texture | 1024², about 5 MB on the GPU with its mipmaps |

The material is alpha-tested, not blended, so there is no sorting and no transparency overdraw cost beyond the test.
It still needs a check on his iPhone.

## Sheets, at 72%, in her tee and leggings

- `01-head-views.jpg`: front, three-quarter, side and back.
- `02-stand-walk-sit.jpg`: standing, walking and sitting, from the front, three-quarter, side and behind.
