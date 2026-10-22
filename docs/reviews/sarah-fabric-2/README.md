# Sarah Lab: body-paint coverage refinement + detail through paint (for review)

Joshua, 2026-10-20: one focused pass on coverage accuracy and smooth edges, using his 4×4 reference sheet. Also, new:
soften nipple and navel detail under painted fabric, adjustable, in Body Paint only. Local only.

## Coverage fixes

- **Hips, pelvis, seat, crotch.** Every lower garment now covers whatever skin lies below its waistband on her trunk
  and legs, whichever region that skin falls in. The gaps at the outer hips came from skin the map gives to the thigh
  bones, which the old rule skipped. Tops reach the hips' sides the same way.
- **Waistbands, hems and necklines wrap round her.** Each vertex now knows where it stands around her (front centre 1,
  back centre 0, sides 0.5), and every line blends its front and back heights by that.
  - Before, the front height stopped and the back height started at a seam, which is what cut the notches at her sides.
  - Under-belly leggings now dip under the bump at the front, curve round the hips and rise across the back.
- **Smooth edges.** The soft edge is about 2 cm, wider than her triangles, so it is a clean line across them instead of
  a staircase along them. It is still a defined edge, not a blur.
- **Neck.** Skin at the base of the neck that the neck bone carries toward the shoulders is covered like the shoulders,
  which removes the small notches at the back neckline.
- **Gloss.** Painted fabric now uses its own roughness instead of her skin's: jersey 0.92, athletic 0.72, sweater 0.97,
  ribbed 0.9, nylon 0.6. It is never metallic, and under paint her skin's normal map (pores) gives way. Garment fabric
  uses the same values.
- **Sheer.** Painted hosiery is mixed by perceived amount, so 50% reads as half-covered skin rather than a faint tint.

Everything stays attached as before. The map, coordinates and templates are computed once on her rest surface and
stored per vertex, so they ride every morph, slider and pose. Nothing in her model, navel, clothing meshes or morphs
changed.

## Detail through paint (new)

- **Where:** BODY PAINT → DETAIL THROUGH PAINT. It affects painted areas only.
- **Controls:**
  - BREAST DETAIL THROUGH PAINT, default 45% (cut by 55%).
  - NAVEL DETAIL THROUGH PAINT, default 80%.
  - Presets: THIN (70 / 95), MEDIUM (45 / 80), THICK (20 / 50).
- **Nipples:**
  - Found on her own surface: the strongest bump close to each breast's most forward point, within a window out from
    her midline and between the underbust and collarbones.
  - Under each one, the breast itself is fitted with a smooth quadric surface from a ring of skin round the areola. The
    detail is what stands above that fit, so the breast's dome is kept exactly and only nipple and areola are softened.
  - The shader removes the chosen share of that detail and its normal, scaled by how much paint covers the vertex,
    before skinning, so it holds in every pose and at every size.
- **Navel:**
  - Its shape is flattened by her own `navelFlat` morph, toward flat by (1 − NAVEL DETAIL) × the paint covering it.
  - The skin relief there fades by the same share.
- **Bare skin, the bikini and the base body never change.** All of it scales by the paint at each vertex. The bare
  before/after check shows only her idle motion, at the edges.

## Sheets

1. `1-before-now.jpg`: the three outfits Joshua circled, BEFORE and NOW.
2. `2-views.jpg`: full leggings + short-sleeve tee, under-belly leggings + crop, mid-thigh shorts + sleeveless; front,
   45°, side and rear, in contrasting cyan and green.
3. `3-belly-sizes-sit.jpg`: 0, 50, 150 and 200% at 45° and rear, and sitting.
4. `4-detail-through-paint.jpg`: breast/navel detail at 100% (off), MEDIUM (default) and THICK.
5. `5-detail-sizes-poses.jpg`: the default across belly 0–200%, breast size −20/+20, and stand, walk, sit and T-pose.

## Still open

- The tank top still has no straps.
- Necklines are square in plan.
- Region and template lines are tuned on Sarah. They are fractions of her own skeleton, so they should carry to Lena,
  but that is unchecked.
