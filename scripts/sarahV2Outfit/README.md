# Sarah v2's outfit: white tank, grey maternity leggings

What Joshua asked for (2026-10-16/17): a white knit tank top over grey knit maternity
leggings, in two styles he can switch between with OUTFIT in the Sarah Lab:

- **over the belly** (`leggings`): a high, level panel that covers the bump at every size;
- **under the belly** (`leggingsLow`): a U scoop under the bump, following his yellow outline.

The fabric is drawn at true size: the white knit is one tile per 2" × 2", the grey one tile
per 1" × 1". The leggings sit skin-tight, like body paint, and the tank stands a little off
her. His approved body (`sarah-v2-body.glb`, commit `2b9adfc`) is the source and is never
reshaped: everything here is cloth.

Joshua pushed this himself as **experimental, good enough for now** (2026-10-17) and asked
for the work to continue from here.

## Build

```
sh scripts/sarahV2Outfit/build.sh            # about 15 minutes; intermediates in .scratch/outfit
cp .scratch/outfit/a8.glb public/models/sarah-v2-body.glb
node scripts/packSarah.mjs public/models/sarah-v2-body.glb
```

The build always starts from the clothes-free body at `2b9adfc` (or `SRC=<file>`). Never
run it on a body that already wears the outfit.

## The steps, and what each one is for

| step | file | why |
|---|---|---|
| grow | `grow.mjs` → `scripts/growClothes.mjs` | grows each garment from her skin, carrying all 43 shapes. `TANK` (cut) and `UNDER` / `LEGGINGS_OVER_BELOW_TIP` (rises) live in `growClothes.mjs`. The low leggings are grown first and renamed; their skin-cover bit is kept as bit 5. |
| islands | `islands.mjs` | keeps the tank's largest piece. |
| dress | `dress.mjs`, `fabricUV.mjs` | per-side cylindrical fabric UVs in true-size tiles, plus the knit texture. |
| rebind | `rebind.mjs` | pushes cloth out to clearance as a **smoothed field** (one point's push shared with its neighbours, so a crease cannot tear), removes the ~3,000 **folds at rest** that growing along normals leaves in the crotch and groin, then binds every point to the skin under it with all shapes. |
| untangle | `untangle.mjs` | relaxes each shape's offsets where neighbouring triangles fold over (the approved body itself folds ~1,700 triangles in the groin at 0%). Capped at 6 mm; a wider setting pulled the low leggings inside her thighs. |
| bridge | `bridge.mjs` | cloth lifts **out of** crevices only (never in) at the small belly sizes; with `BRIDGE_HULL` the tank also spans the dip at her navel. |
| normals | `normals.mjs` | **the fix for the dark slits in the groin creases**: every normal shape is recomputed from the cloth's own faces at that shape. The old ones still faced the floor where the cloth was tucked under her belly at 100%. |
| trim | `trim.mjs` | a bound band along each open edge, laid at that edge's own height off her, its line and facing eased along the edge so it does not ripple. |

## Where it stands (alpha.97, pushed 2026-10-17)

Done and in the Lab:
- `sarah-v2-body.glb` now wears the outfit (39 MB packed, up from 19 MB: three garments x 43 shapes plus trims).
  OUTFIT on v2: `tee + leggings` shows the tank over the high leggings, `top + low leggings` the tank over the
  under-the-belly ones. v1 is untouched (its outfits are unchanged; the low-leggings outfit is skipped on v1).
- The skin under each worn garment is masked, the low leggings included (cover bit 5).
- Trims show with their garment; the high leggings' waistband trim hides under the tank.
- **Groin creases are clean on both leggings at every size.** The dark tears were not holes: the cloth's normal
  shapes were stale (fixed by `normals.mjs`), and growing cloth along normals left ~3,000 folded edges at rest in the
  crotch and groin (fixed in `rebind.mjs`).
- **Tank hem**: one level, continuous hem round the hips (`TANK.hemFront` / `hemBack` in `growClothes.mjs`) instead of
  one that dipped toward the waistband and broke into flaps; its band no longer ripples (`trim.mjs`).
- **Cleavage seam at 0.5x bust**: gone with the smoothed clearance push.

Measured (`bumpw.mjs`, front centreline, her navel at quarter height):

| | her skin | leggings | tank |
|---|---|---|---|
| 100% | 36 mm tall, 15.4 mm high | 38 mm | 42 mm |
| 200% | 36 mm, 26.0 mm high | 38 mm | 46 mm |

In side-by-side renders (her skin / tank) the navel and nipples DO read clearly bigger through the tank than on
her skin, more than the centreline numbers suggest: the tank stands 7 mm off her, 12-16 mm over the leggings on the
bump, and a small bump through cloth grows by about twice that.

Tried on 2026-10-17, all left in `rebind.mjs` but OFF by default (each env setting turns one back on):
- `DEFLATE_MIN`: draw the cloth in toward its own smoothed surface over small bumps. Made the bump lower but WIDER.
- `SMALL_BUMP_MIN`: hold the tank its clearance off her *smoothed* skin over real bumps. Barely changed the navel and
  broke the hem.
- `BIND_UNDER`: bind each tank point to the skin straight beneath it rather than the nearest. No measurable change.
The next thing to try (started, not finished): bring the tank in, `shirt:0.004:leggings:0.0015` in `build.sh` (4 mm
off her, 5.5 mm over the leggings) instead of `shirt:0.007:leggings:0.005`. A maternity tank hugs the bump; the
inflation scales with that distance. Check the leggings never show through it.

## Still to do (in order)

0. **Navel and nipples under the tank read bigger than hers** (Joshua, 2026-10-17: make sure they are not exaggerated from her normal proportions). See the table above; target: within a few mm of her skin's size through each layer.
1. **Tank at 0% belly**: the navel still reads as a soft dimple. A tank should mostly bridge it.
   The `BRIDGE_HULL` lift helps; widening its smoothing or applying it to `navelFlat` too is the next try.
2. **Tank hem at 200%**: the hem rides up under the bump at the front and a strip of leggings shows. Probably wants a lower front hem at the big sizes only (a shape, not the cut).
3. **Low leggings**: a small speck of skin can show at the right groin at 0% in the scratch renderer.
   In the Lab the low leggings now mask the skin under them (bit 5), which should hide it; check on the phone.
4. **The 0% crease under the belly** is a clean line now but a little hard. That is the approved body's shape; do not change the body.
5. **File size**: 39 MB for the phone. Worth checking load time; trims and the two leggings could be split into their own file later.
6. **Next big piece**: the Clothing and Body Paint Designer, reusing the ribbon and binding modules here and in `scripts/sarahV2ProcBikini/`.

## Next tasks (Joshua, 2026-10-17, from his phone on the deployed alpha.97)

Start from the latest `main` (`git pull`); alpha.97 or later is the base.

1. **Sliders and clothing.** The ARMS slider reads 90° but her arms stay down while standing. BELLY TILT and some
   other sliders seem to do nothing, or the clothes don't follow the new size. Check every control on v2-body,
   with each outfit:
   - BUMP, the BELLY SHAPE fields (tilt, height, width, depth, upper/lower) and the breast fields;
   - ARMS, plus WALK and SIT.
   Find which drive the body but not the garments or trims. The body-shape fields are lifted off the GPU and
   applied on the CPU (`src/view/bodyShapeView.ts`). Make sure the garment and `*Trim` primitives are lifted
   and driven too, and that every shape the body has is carried by every garment primitive.
2. **Bikini bottom.** It looked fine in screenshots but on the phone the green print has rough, jagged edges and
   the side ties are messy. Redo it procedurally, like the approved top (`scripts/sarahV2ProcBikini/`): smooth
   ribbon edges, its fabric painted on her skin inside them. Keep the current bottom's shape, cleaned up.
   Joshua can draw the exact outline if wanted. The top is approved; don't touch it.
3. **The navel under clothes (the main one).** While the tank and/or leggings are worn, her navel's round front
   (height and width) should be **60% smaller**, and its depth (how far it stands out) **30% less**. With no
   clothes or with the bikini she stays exactly as approved.
   - Build it as new shapes that are off by default. Don't change the approved body or any approved shape.
   - The navel's size comes from several shapes at once (`navelOut`, `navelFlat`, the belly keys). So one added
     shape won't hold at every size: check 0, 50, 100, 140 and 200%.
   - The garments must carry the new shapes too (rebuild with `build.sh` from a body that has them).
   - The Lab turns them on only while a garment that covers the navel is worn.
   - Compare skin vs. through-the-tank renders at each size.
   Bringing the tank closer (see above) helps too.

## Rules that came with it

- Do not change the approved body or its morphs.
- No push without Joshua's explicit OK after he sees rendered screenshots (his 2026-10-17 OK covered this push only).
