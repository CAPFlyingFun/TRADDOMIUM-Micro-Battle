/**
 * SARAH v2's BIKINI (Joshua, 2026-10-15: "bring the V1 bikini into V2... the biggest
 * priority is making the bra fit correctly across the full 0.5x-2.0x breast-size range,
 * including independent width, height, depth, spacing, position, droop, and fullness").
 *
 * The same modelled bikini v1 wears (`art/humans/outfits/bikini-string-meshy.glb`), fitted
 * by the same fitter (`scripts/fitMeshyBikini.mjs`), onto `sarah-v2-body.glb` as a new
 * primitive and material, `bikini`. The body primitive is not touched.
 *
 * Every vertex of the fabric is bound to the point of skin under it: that point's bone
 * weights and its displacement in EVERY shape the body has, the GPU's (belly sizes,
 * breastGrow, the springs, the seat correctives) and the body-shape fields the Lab
 * applies on the CPU (`shape:*`, which the Lab lifts off the bikini's mesh the same way it
 * does the body's). So the cups take the breast's own shape at any size and under any
 * control, the band rides the ribcage under it, the string between the cups rides the
 * skin of her sternum, and the brief rides her hips and pelvis. With `followNormals` the
 * fabric's few millimetres of clearance are carried along the skin's turned normal in
 * each shape, so a cup keeps its gap when droop tips the breast or size swells it.
 *
 * Run after `sarahV2Shape.mjs`, then pack:
 *   node scripts/sarahV2Bikini.mjs public/models/sarah-v2-body.glb [out.glb]
 *   node scripts/packSarah.mjs <out>
 */
import { fitMeshyBikini } from './fitMeshyBikini.mjs';

/** Her breast's tip is looked for here: above the 100% bump, which on v2 reaches past the breasts below 1.2 m. */
export const TIP_BOX = [0.06, 0.15, 1.21, 1.36];
/**
 * v2's breast is shorter from tip to crease than v1's (5.7 cm against 8.2 at her bind
 * shape), so the cups are scaled down from v1's 0.33 to sit on it as v1's sit on hers.
 * The brief sits a little higher (its top at 0.94 m, v1's 0.915), where v2's hips are,
 * otherwise as v1 wears it (Joshua kept this fit over a tipped or painted-on brief).
 * The halter above them keeps v1's scale (`strapScale`), so its knot still sits at her
 * nape. GAME TUNING, against renders.
 */
export const PLACE_V2 = { bottom: { part: 0, scale: 0.43, topY: 0.94, contactM: 0.035, triangles: 20000, ease: 12, easeM: 0.009 }, top: { part: 1, scale: 0.27, strapScale: 0.33, contactM: 0.05, triangles: 40000, ease: 3, easeM: 0.005 } };
export const MESHY_BIKINI = 'art/humans/outfits/bikini-string-meshy.glb';

export async function sarahV2Bikini(src, dst = src, { log = console.log } = {}) {
  await fitMeshyBikini(MESHY_BIKINI, src, { log, create: true, followNormals: true, out: dst, tipBox: TIP_BOX, place: PLACE_V2 });
}

if (process.argv[1]?.endsWith('sarahV2Bikini.mjs')) await sarahV2Bikini(process.argv[2], process.argv[3] ?? process.argv[2]);
