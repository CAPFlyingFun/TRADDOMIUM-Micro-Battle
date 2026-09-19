/**
 * BAKE JACK AND SARAH FROM THEIR MASTERS TO SOMETHING A PHONE CAN OPEN.
 *
 *     npm run bake:humans
 *
 * Reads the master GLBs — from `art/humans/` if they are there, else
 * straight from the GitHub release that holds them — and writes
 * `public/models/jack.glb` and `public/models/sarah.glb`.
 *
 * THE MASTERS ARE NEVER TOUCHED (Joshua, 2026-09-18: "Preserve the master
 * GLBs unchanged"). They live in the release `Jack_Sarah_Lab_Models_GLB`
 * and nowhere in this repository: 82 MB of art in git is 82 MB in every
 * clone forever, and the release already is a master store with a
 * checksum. This script is the only thing that reads them and it opens
 * them read-only.
 *
 * WHAT THE MASTERS COST, measured rather than assumed. The first pair is
 * what this script was written against; the second is the Lab2 pass, which
 * is what it reads now (both entries in HUMANS, below, say why):
 *
 *   Jack-Lab.glb    47.5 MB   102,613 tris   69 joints   2K + 2K + 4K PNG
 *   Sarah-Lab.glb   35.1 MB   103,108 tris   69 joints   2K + 2K + 4K PNG
 *   Jack-Lab2.glb   23.0 MB   198,474 tris   69 joints   2K + 2K + 4K PNG
 *   Sarah-Lab2.glb  13.9 MB   101,918 tris   35 joints   2K + 2K + 4K PNG
 *
 * That is 82 MB down the wire for the first pair and about 128 MB of
 * texture VRAM EACH once the PNGs are decompressed with their mip chains.
 * The triangles are not the problem and never were — 300,000 for the Lab2
 * pair is nothing beside the 5.5 M the insects already push at 31 ms
 * (`docs/PERFORMANCE.md`, Baseline C-ALL), and Jack's doubling arrives in
 * HALF the bytes. Texture memory is a cliff, not a slope: the tab is
 * killed, not slowed.
 *
 * MESHOPT, NOT DRACO, AND THAT IS THE ONE PLACE THIS DEPARTS FROM BEYOND
 * EXTINCTION. Joshua, 2026-09-18: "Look at how Beyond Extinction handles
 * the models which I think it used Dragon or something to make the models
 * smaller which is okay to compress." He remembered right — BE uses Draco
 * and self-hosts its decoder in `public/draco/`, and it takes the same two
 * masters to 4.41 MB (Jack) and 0.54 MB (Sarah).
 *
 * This repository already compresses its rigs, with the other one:
 * `src/assets/assets.ts` wires `MeshoptDecoder`, and `queen-winged.glb`
 * and `worker.glb` are `EXT_meshopt_compression + EXT_texture_webp +
 * KHR_mesh_quantization`. Using meshopt here ships NO NEW RUNTIME CODE —
 * no second decoder to host, no loader change, nothing to keep in step
 * with a three.js bump. Draco would be a whole extra decoder on the
 * critical path to save nothing meshopt does not.
 *
 * THE TEXTURE BUDGET IS PER MAP, because the maps are not worth the same.
 *
 *   colour            2048   what the eye actually reads
 *   normal            2048   the silhouette's detail lives here
 *   metallicRoughness 1024   low-frequency by nature: it says "skin is
 *                            not metal and is a bit rough" over broad
 *                            areas, and 4K of it was 85 MB of VRAM to
 *                            say so
 *
 * WebP everywhere, and the NORMAL MAP IS LOSSY HERE — which departs from
 * `bakeTextures.mjs`, deliberately and on a measurement.
 *
 * That file encodes normal maps losslessly, because lossy WebP is always
 * YUV 4:2:0 and a normal map keeps x and y in the chroma planes, which is
 * exactly what gets stored at half resolution. The rule is right for what
 * it was written about: a 1024 ripple map tiled across the whole sea,
 * where the artifact repeats and is read at a grazing angle.
 *
 * A character's normal map is not that, and the numbers say so. Jack's
 * 2048 master re-encoded, xy error measured against the master itself:
 *
 *   2048 lossless   4.72 MB   mean xy error 0.00 / 255
 *   2048 q95        1.20 MB   mean xy error 3.60 / 255
 *   1024 lossless   1.51 MB   mean xy error 4.66 / 255
 *   1024 q95        0.38 MB   mean xy error 6.65 / 255
 *
 * READ THE MIDDLE TWO ROWS TOGETHER. Halving the resolution costs MORE
 * accuracy than compressing lossily at full resolution, and costs more
 * bytes doing it — 1024 lossless is 1.26x the size of 2048 q95 and 1.29x
 * the error. So the honest saving here is the encoder, not the ruler:
 * keep 2048 and spend q95. It takes the normal map from 62% of the file
 * to 29% of it.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { authorSarah } from './authorSarah.mjs';
import { printBadge } from './printBadge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MASTERS = join(ROOT, 'art', 'humans');
const OUT = join(ROOT, 'public', 'models');
/** Where the occlusion bake is kept between runs. Derived from a master and
 * nothing else, so it is regenerated rather than tracked. */
const CACHE = join(MASTERS, 'cache');

/** Where the masters live when they are not on this disk. One release, one asset, one checksum. */
const RELEASE = 'https://github.com/CAPFlyingFun/TRADDOMIUM-Micro-Battle/releases/download/Jack_Sarah_Lab_Models_GLB/Jack.and.Sarah.Lab.glb.models.zip';

/** Master file → what the game asks the loader for. */
const HUMANS = [
  //
  // `badge` lifts the ID card round their neck onto its own material and
  // prints Joshua's TOMBS artwork on it — see `printBadge.mjs` for why a
  // 70x38-texel island cannot be fixed where it is. The SLAB is measured
  // per person, and the two scans are genuinely different: Jack's depth
  // histogram has a clean gap (chest to z 0.100, nothing to 0.108, badge
  // front at 0.110..0.113), so the slab alone isolates it; Sarah's has no
  // gap at all — her scan fused card, sleeve and clip into one 32 mm lump
  // welded to the cloth, and what separates hers is that the fill may only
  // grow within the card's own plane.
  //
  // JACK IS Lab2 (Joshua, 2026-09-19: "Here is Jack again, with all fingers
  // rigged"), and Lab1 is kept for the same reason Sarah's is.
  //
  // It is the SAME 69-BONE UniRig armature refitted to a new mesh — every
  // bone name and its place in the list is identical, and every one of the
  // 69 has moved, by up to 240 mm. Nothing here reads a bone by name, so
  // that costs nothing: `actor/humanSkeleton.measureHuman` finds the
  // seventeen joints it poses by MEASURING the bind pose, which is why it
  // was written that way.
  //
  // WHAT CHANGED, measured against Lab1:
  //
  //                        Lab1        Lab2
  //   file                 45.30 MB    22.97 MB
  //   triangles            102,613     198,474
  //   open edges           43.6%       15.9%
  //   influence sets       11          2
  //   influences/vertex    5.61        2.78
  //   FURTHEST INFLUENCE   1,328 mm    492 mm
  //   weight past set 0    6.80%       0.83%
  //
  // READ THE LAST THREE ROWS TOGETHER, because they are the arm that
  // exploded. Lab1 weighted vertices to bones A METRE AND A THIRD away and
  // spread them over forty-four influences, of which three.js reads four;
  // which four you got was the exporter's business, and 6.8% of the weight
  // was simply thrown away. Lab2 tops out at 492 mm, holds 99.17% of its
  // weight in the set three.js reads, and never puts less than 77% of a
  // vertex's weight there. The same welding story as Sarah's Lab2 — half
  // the file, twice the triangles, a third of the open edges — and unlike
  // hers it KEEPS THE FINGERS: 44 joints past |x| 0.55 m, the same as Lab1.
  //
  // THE BADGE IS A REAL CARD NOW, and that is what re-measured the slab.
  // Lab1's holder front was 61.9 x 95.5 mm; Lab2's printed face is
  // 50.2 x 85.9 mm — within half a millimetre of a CR80 ID card's 85.6 mm
  // height, which is the independent check that the frame is the card's
  // and not the slab's. It also has NO CLEAN DEPTH GAP, where Lab1 had one:
  // the shirt beside the card reaches z 0.1251 and the card's own front
  // runs 0.1260 to 0.1330, so 0.9 mm is all there is. That is Sarah's
  // situation rather than Lab1's, and it is `findCard`'s plane-gated fill
  // that separates them — the slab only has to bound it.
  //
  // zMin was swept: 0.1265 finds 81.7 mm, 0.1260 finds 85.9 mm, 0.1258
  // finds 90.0 mm and leaks into the clip. 0.1260 is the plateau — the
  // width reads 50.2 mm at every setting, and yMin, yMax and xHalf change
  // nothing there, which is what says the geometry is deciding.
  //
  // The art is drawn at aspect 0.678 and the face is 0.584, so it is
  // squeezed 14% narrower to fill the holder edge to edge (Joshua,
  // 2026-09-19 on the last one: "Don't trim it as it aligns with the badge
  // holder"). Lab1 needed 4%. The art was drawn for Lab1's oversized
  // holder; a redraw at 0.58 would need none.
  {
    master: 'Jack-Lab2.glb', out: 'jack.glb', who: 'Jack Bennett', panel: null, repair: false,
    badge: { art: 'art/humans/badge/jack-tombs.webp', slab: { zMin: 0.1260, yMin: 1.070, yMax: 1.170, xMid: 0.003, xHalf: 0.035 } },
  },
  // SARAH IS Lab2, AND Lab1 IS KEPT (Joshua, 2026-09-18: "go ahead and switch
  // to this one… it does look a lot better even the textures"). Meshy's second
  // pass fixes the thing every repair in this file was fighting: Lab1's atlas
  // is SHATTERED — 110,574 open edges against 99,375 shared, every triangle
  // its own island — and Lab2's is WELDED, 140,863 shared against 24,028 open.
  // Same detail (101,918 triangles against 103,108) in 13.88 MB rather than
  // 33.45, and THE LANYARD IS GEOMETRY rather than a cord painted onto the
  // shirt with a white halo bled down both sides of it.
  //
  // What it costs is hands: 8 joints past the wrist rather than 37, so four
  // per hand instead of about eighteen — no individual finger curl. Joshua's
  // call, and a cheap one for a woman standing at a console: "we don't need
  // all fingers rigged for either". Jack stays on his own master, which he
  // was happy with.
  //
  // Lab1 is NOT deleted. It is the only rig with real fingers, and the day
  // Sarah has to use her hands it is what a re-rig starts from.
  //
  // `panel` names the front-panel picture a body can be painted through, and
  // `repair` says whether the automatic lanyard pass runs. Sarah keeps the
  // panel — a flat front view is still the easiest thing to paint — and no
  // longer needs the repair, because there is no halo left to remove.
  //
  // `author` runs `authorSarah.mjs`: it replaces the lanyard and the top
  // with flat colour taken from the scan's own median plus a baked contact
  // shadow, and lifts the ID card onto its own material so the TOMBS
  // artwork on it is legible. It touches nothing above the collarbone —
  // the scan's face is better than anything procedural would put there.
  {
    master: 'Sarah-Lab2.glb', out: 'sarah.glb', who: 'Sarah Bennett', panel: 'sarah', repair: false, author: true,
    badge: { art: 'art/humans/badge/sarah-tombs.webp', slab: { zMin: 0.156, yMin: 1.050, yMax: 1.152, xMid: 0.005, xHalf: 0.040 } },
  },
];

/**
 * How far from a vertex a bone may be and still be believed, as a
 * fraction of the skeleton's own height.
 *
 * IT IS A FRACTION so it stays right for a re-export at another scale,
 * and 0.12 of Jack's 1.61 m joint span is 194 mm. The number was chosen
 * by rendering three of them, because both directions of getting it
 * wrong are real and they look nothing alike:
 *
 *   0.18  290 mm, 13.8% of weight re-spread. Kills the cross-body spray
 *         but leaves the shoulder seams torn: a deltoid vertex can still
 *         reach across the joint, and at 77 degrees that still splits.
 *   0.12  194 mm, 25.6% re-spread, 2,467 vertices rescued. Both arms
 *         hang clean. CHOSEN.
 *   0.09  145 mm, 48.7% re-spread, 8,682 rescued. WORSE than 0.18 — with
 *         half the weight discarded the skin goes rigid and a hole opens
 *         at the right shoulder. Pruning past the point where a joint
 *         has two bones to blend between does not clean a seam, it tears
 *         one.
 *
 * So this is not "as tight as possible". It is the width at which a
 * shoulder still has both of its bones and nothing has one from the far
 * side of the ribcage.
 */
const MAX_BIND_REACH = 0.12;

/**
 * Gather every influence set, discard the ones naming a bone further from
 * the vertex than `MAX_BIND_REACH` of the body's height, keep the four
 * strongest of the rest, renormalise, and write them back as set 0.
 *
 * Bone positions come from the skin's INVERSE BIND MATRICES, whose
 * inverse's translation is the bone's rest position in the same mesh
 * space `POSITION` is in — so the two are directly comparable, which is
 * the whole reason this can be done as arithmetic rather than as a guess.
 */
function pruneStrayInfluences(prim, doc, who) {
  const position = prim.getAttribute('POSITION');
  const skin = doc.getRoot().listSkins()[0];
  if (!position || !skin) return;
  const ibm = skin.getInverseBindMatrices();
  if (!ibm) return;

  const sets = [];
  for (let i = 0; ; i += 1) {
    const j = prim.getAttribute(`JOINTS_${i}`);
    const w = prim.getAttribute(`WEIGHTS_${i}`);
    if (!j || !w) break;
    sets.push([j, w]);
  }
  if (sets.length === 0) return;

  // Bone rest positions: the translation of the inverse of each IBM.
  const m = ibm.getArray();
  const bones = m.length / 16;
  const bone = new Float64Array(bones * 3);
  for (let b = 0; b < bones; b += 1) {
    const o = b * 16;
    const t = [m[o + 12], m[o + 13], m[o + 14]];
    bone[b * 3] = -(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2]);
    bone[b * 3 + 1] = -(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2]);
    bone[b * 3 + 2] = -(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2]);
  }
  let lo = Infinity, hi = -Infinity;
  for (let b = 0; b < bones; b += 1) {
    lo = Math.min(lo, bone[b * 3 + 1]);
    hi = Math.max(hi, bone[b * 3 + 1]);
  }
  const reach = (hi - lo) * MAX_BIND_REACH;

  const count = position.getCount();
  const outJ = new Uint16Array(count * 4);
  const outW = new Float32Array(count * 4);
  const p = [0, 0, 0];
  const pool = [];
  let dropped = 0, weightLost = 0, rescued = 0;

  for (let v = 0; v < count; v += 1) {
    position.getElement(v, p);
    pool.length = 0;
    let near = -1, nearD = Infinity;
    for (const [J, W] of sets) {
      const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
      J.getElement(v, je);
      W.getElement(v, we);
      for (let k = 0; k < 4; k += 1) {
        const w = we[k];
        if (!(w > 0)) continue;
        const b = je[k];
        const d = Math.hypot(p[0] - bone[b * 3], p[1] - bone[b * 3 + 1], p[2] - bone[b * 3 + 2]);
        if (d < nearD) { nearD = d; near = b; }
        if (d > reach) { dropped += 1; weightLost += w; continue; }
        pool.push([b, w]);
      }
    }
    if (pool.length === 0) {
      // EVERY INFLUENCE WAS REFUSED, so the rule has no opinion here and
      // must not pretend to one: the vertex keeps exactly what the master
      // gave it.
      //
      // This is not a formality. Sarah's ID CARD hangs on a lanyard out
      // in front of her chest, further from any bone than the reach — so
      // all 65 of its vertices land in this branch. Collapsing each onto
      // its own nearest bone would bind one corner of the card to the
      // spine and another to a clavicle and shear the card between them,
      // which is the one piece of this model that has already cost a day.
      // Where the rule cannot judge, it leaves well alone.
      for (const [J, W] of sets) {
        const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
        J.getElement(v, je);
        W.getElement(v, we);
        for (let k = 0; k < 4; k += 1) if (we[k] > 0) pool.push([je[k], we[k]]);
      }
      if (pool.length === 0) pool.push([near < 0 ? 0 : near, 1]);
      rescued += 1;
    }
    pool.sort((a, b2) => b2[1] - a[1]);
    let sum = 0;
    for (let k = 0; k < 4 && k < pool.length; k += 1) sum += pool[k][1];
    for (let k = 0; k < 4; k += 1) {
      const e = k < pool.length ? pool[k] : null;
      outJ[v * 4 + k] = e ? e[0] : 0;
      outW[v * 4 + k] = e && sum > 0 ? e[1] / sum : 0;
    }
  }

  prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setArray(outJ));
  prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setArray(outW));
  const mean = count > 0 ? weightLost / count : 0;
  console.log(`[bake:humans]   ${who}: skin pruned at ${(reach * 1000).toFixed(0)} mm reach — `
    + `${dropped.toLocaleString()} stray influences dropped over ${count.toLocaleString()} vertices, `
    + `${(mean * 100).toFixed(2)}% mean weight re-spread, ${rescued} vertices left as the master had them`);
}

/**
 * The size each map is worth. `undefined` leaves a map alone — there is
 * no entry here that grows one, because a bake may only ever spend less.
 */
const SIZES = { baseColorTexture: 2048, normalTexture: 2048, metallicRoughnessTexture: 1024 };

/**
 * WHAT THE BODY'S ROUGHNESS IS LIFTED TO, and why it is lifted at all.
 *
 * Joshua, 2026-09-18: "see how glossy the clothes and body looks?" It is,
 * and the map is why. Both masters carry ONE `BakedMaterial` over the
 * whole body, and its roughness channel is very nearly a single number —
 * measured on Sarah's, 97% of it lies between 0.4 and 0.7, the peak is
 * 0.5-0.6, and NOTHING is above 0.8:
 *
 *   0.4-0.5  23.8%      0.6-0.7  19.5%
 *   0.5-0.6  54.0%      0.7-0.8   0.3%      0.8-0.9  0.1%
 *
 * Cloth belongs around 0.85-0.95 and skin around 0.6-0.75, so a map that
 * says 0.55 everywhere puts the same broad specular highlight on a
 * cotton top as on a forearm — which on screen reads as latex. It is a
 * photogrammetry bake that never separated the two materials.
 *
 * SO THERE IS NOTHING TO PRESERVE, and the fix is a curve rather than a
 * mask: every value is raised by the exponent that lands THIS texture's
 * own mean on the target, which keeps the little variation the map does
 * carry in the right order while moving the whole body out of the
 * plastic band. Computed per texture, so it stays true if the art is
 * re-exported at a different level.
 *
 * METALNESS IS NOT TOUCHED. It averages 0.002 — nobody is metal — but it
 * peaks at 0.44 on the watch, the badge clip and the belt buckle, and
 * those are the one place the map is doing real work.
 *
 * 0.80 rather than 0.90: at 0.90 the cloth goes a shade flat, and 0.80
 * leaves jersey the trace of sheen jersey has. Both were rendered
 * (`npm run probe:humans`, shots/humans-5-sarah-rough0*.png) before this
 * number was chosen.
 */
const TARGET_ROUGHNESS = 0.8;

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

/**
 * Raise the roughness channel of every metallic-roughness map until its
 * mean sits on `TARGET_ROUGHNESS`, leaving metalness alone.
 *
 * glTF packs roughness in GREEN and metalness in BLUE, so this reads and
 * writes one channel of a three-channel image. The exponent is solved
 * from the texture's own mean — `mean ** k = target` — so a map that
 * already reads matte is barely touched and this one, which reads 0.55,
 * is moved where it needs to go.
 */
async function liftRoughness(doc, who) {
  for (const material of doc.getRoot().listMaterials()) {
    const tex = material.getMetallicRoughnessTexture();
    if (!tex) continue;
    const src = tex.getImage();
    if (!src) continue;
    const { data, info } = await sharp(Buffer.from(src)).raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += ch) { sum += data[i + 1]; n += 1; }
    const mean = sum / n / 255;
    if (!(mean > 0 && mean < 1)) continue;
    const k = Math.log(TARGET_ROUGHNESS) / Math.log(mean);
    // A lookup over the 256 values a byte can hold, rather than a power
    // per pixel: this runs over four million of them.
    const curve = new Uint8Array(256);
    for (let v = 0; v < 256; v += 1) curve[v] = Math.round(255 * (v / 255) ** k);
    for (let i = 0; i < data.length; i += ch) data[i + 1] = curve[data[i + 1]];
    const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/png');
    console.log(`[bake:humans]   ${who}: roughness mean ${mean.toFixed(3)} -> ${TARGET_ROUGHNESS.toFixed(2)} (curve ^${k.toFixed(3)}), metalness untouched`);
  }
}

// ---------------------------------------------------------------------------
// The front panel: a coherent picture of a body that has no coherent atlas
// ---------------------------------------------------------------------------

/**
 * THE PANEL — an orthographic front view of the chest, and the answer to a
 * question Joshua asked on 2026-09-18: "is there a way to retexture the model
 * and make your own UV image?"
 *
 * Yes, and this is it. Sarah's own atlas is about 103,000 PER-TRIANGLE
 * ISLANDS: two patches that touch in the image are unrelated scraps of body,
 * so nothing that works on pictures works on it. Painting it, cloning in it,
 * running an upscaler or an AI inpaint over it all bleed one island into the
 * next — measured, on an enhanced copy: 5.7% of texels inside islands changed
 * CLASS (29,485 shirt to skin, 12,160 cord to shirt) and every triangle came
 * back as a visible facet.
 *
 * So the chest is projected onto a plane. Each panel pixel GATHERS the nearest
 * front-facing texel to it, keeping the frontmost surface so the badge is not
 * sampled through to the shirt behind it, and what comes out is an ordinary
 * picture: the shirt one region, the lanyard one strip, the badge one
 * rectangle with its printing legible. In THAT, a repair is a repair.
 *
 * Two ways to use it, and the second is the point:
 *
 *  - `npm run bake:humans -- --panels` writes each panel to
 *    `art/humans/panels/<who>-front.png`. Paint that file however you like —
 *    any editor, any tool — save it beside the original as
 *    `<who>-front-edited.png`, and the next bake projects your changes onto
 *    the model. Only the pixels you CHANGED are written back, so nothing else
 *    is touched and nothing is softened by a round trip.
 *  - With no edited file, the bake runs the automatic repair below.
 *
 * The masters are never written. The panel is a lens, not a new asset.
 */
const PANEL = Object.freeze({ X0: -0.26, X1: 0.26, Y0: 0.92, Y1: 1.58, WIDE: 780 });
const PANEL_DIR = join(MASTERS, 'panels');

/** Per-texel position and normal, by rasterising the mesh into its own atlas. */
function texelMap(prim, S) {
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const IDX = prim.getIndices().getArray();
  const pos = new Float32Array(S * S * 3);
  const nrm = new Float32Array(S * S * 3);
  const ok = new Uint8Array(S * S);
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]];
    // glTF puts (0,0) at the TOP-LEFT, so the row is v*S. The body settled
    // this: that way her chest reads burgundy 81% of the time, flipped 57%.
    const ux = v.map((i) => UV[i * 2] * S);
    const uy = v.map((i) => UV[i * 2 + 1] * S);
    const x0 = Math.floor(Math.min(...ux)) - 1, x1 = Math.ceil(Math.max(...ux)) + 1;
    const y0 = Math.floor(Math.min(...uy)) - 1, y1 = Math.ceil(Math.max(...uy)) + 1;
    if ((x1 - x0) * (y1 - y0) > 40000) continue;
    const d = (uy[1] - uy[2]) * (ux[0] - ux[2]) + (ux[2] - ux[1]) * (uy[0] - uy[2]);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
      if (x < 0 || y < 0 || x >= S || y >= S) continue;
      let l0 = 1 / 3, l1 = 1 / 3, l2 = 1 / 3;
      if (Math.abs(d) > 1e-9) {
        l0 = ((uy[1] - uy[2]) * (x - ux[2]) + (ux[2] - ux[1]) * (y - uy[2])) / d;
        l1 = ((uy[2] - uy[0]) * (x - ux[2]) + (ux[0] - ux[2]) * (y - uy[2])) / d;
        l2 = 1 - l0 - l1;
        if (l0 < -0.35 || l1 < -0.35 || l2 < -0.35) continue;
      }
      const i = y * S + x;
      for (let k = 0; k < 3; k += 1) {
        pos[i * 3 + k] = l0 * P[v[0] * 3 + k] + l1 * P[v[1] * 3 + k] + l2 * P[v[2] * 3 + k];
        nrm[i * 3 + k] = l0 * N[v[0] * 3 + k] + l1 * N[v[1] * 3 + k] + l2 * N[v[2] * 3 + k];
      }
      const L = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
      nrm[i * 3] /= L; nrm[i * 3 + 1] /= L; nrm[i * 3 + 2] /= L;
      ok[i] = 1;
    }
  }
  return { pos, nrm, ok };
}

/** Which panel pixel a texel lands on, or null when it is not on the front. */
function panelPixelOf(map, i, PW, PH) {
  const { pos, nrm, ok } = map;
  if (!ok[i] || nrm[i * 3 + 2] < 0.10) return null;
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  if (x < PANEL.X0 || x > PANEL.X1 || y < PANEL.Y0 || y > PANEL.Y1 || z <= 0) return null;
  const fx = Math.round((x - PANEL.X0) / (PANEL.X1 - PANEL.X0) * (PW - 1));
  const fy = Math.round((PANEL.Y1 - y) / (PANEL.Y1 - PANEL.Y0) * (PH - 1));
  if (fx < 0 || fy < 0 || fx >= PW || fy >= PH) return null;
  return fy * PW + fx;
}

/** The picture itself: every pixel gathers the nearest front-facing texel. */
function buildPanel(img, map, S) {
  const PW = PANEL.WIDE;
  const PH = Math.round(PW * (PANEL.Y1 - PANEL.Y0) / (PANEL.X1 - PANEL.X0));
  const CELL = 4;
  const cols = Math.ceil(PW / CELL), rows = Math.ceil(PH / CELL);
  const bins = Array.from({ length: cols * rows }, () => []);
  const at = new Float32Array(S * S * 2);
  for (let i = 0; i < S * S; i += 1) {
    const p = panelPixelOf(map, i, PW, PH);
    if (p === null) continue;
    const fx = p % PW, fy = (p / PW) | 0;
    at[i * 2] = fx; at[i * 2 + 1] = fy;
    bins[Math.min(rows - 1, (fy / CELL) | 0) * cols + Math.min(cols - 1, (fx / CELL) | 0)].push(i);
  }
  const panel = Buffer.alloc(PW * PH * 3);
  const covered = new Uint8Array(PW * PH);
  for (let py = 0; py < PH; py += 1) for (let px = 0; px < PW; px += 1) {
    const c0 = (px / CELL) | 0, r0 = (py / CELL) | 0;
    let best = -1, bestD = Infinity, bestZ = -99;
    for (let ring = 1; ring <= 6 && best < 0; ring += 1)
    for (let dr = -ring; dr <= ring; dr += 1) for (let dc = -ring; dc <= ring; dc += 1) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      for (const i of bins[r * cols + c]) {
        const dx = at[i * 2] - px, dy = at[i * 2 + 1] - py;
        const dd = dx * dx + dy * dy;
        const z = map.pos[i * 3 + 2];
        // Nearest wins, but the FRONTMOST surface wins a tie: the badge stands
        // proud of the shirt and must not be sampled through.
        if (z > bestZ + 0.004 || (Math.abs(z - bestZ) <= 0.004 && dd < bestD)) { best = i; bestD = dd; bestZ = z; }
      }
    }
    if (best < 0) continue;
    const p = py * PW + px;
    covered[p] = 1;
    panel[p * 3] = img[best * 3]; panel[p * 3 + 1] = img[best * 3 + 1]; panel[p * 3 + 2] = img[best * 3 + 2];
  }
  return { panel, PW, PH, covered };
}

/**
 * The automatic repair, done in the panel where the cord is a SHAPE.
 *
 * Seed the cord where it is unambiguous — dark and unsaturated — then close
 * the holes the fringe bit out of it, so the strip becomes one object. Inside
 * it, anything that is not cord is the white bleed and is replaced by the cord
 * around it. In one ring outside it, pale pixels are the halo on the shirt and
 * are replaced by the shirt BEYOND the halo, never by the cord.
 */
function autoRepairPanel(panel, covered, PW, PH) {
  const lum = (d, p) => 0.2126 * d[p * 3] + 0.7152 * d[p * 3 + 1] + 0.0722 * d[p * 3 + 2];
  const sat = (d, p) => {
    const mx = Math.max(d[p * 3], d[p * 3 + 1], d[p * 3 + 2]);
    const mn = Math.min(d[p * 3], d[p * 3 + 1], d[p * 3 + 2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const disc = (src, r, erode) => {
    const dst = new Uint8Array(PW * PH);
    for (let y = 0; y < PH; y += 1) for (let x = 0; x < PW; x += 1) {
      let v = erode ? 1 : 0;
      for (let dy = -r; dy <= r && (erode ? v : !v); dy += 1) for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = x + dx, ny = y + dy;
        const inside = nx >= 0 && ny >= 0 && nx < PW && ny < PH && src[ny * PW + nx];
        if (erode) { if (!inside) { v = 0; break; } } else if (inside) { v = 1; break; }
      }
      dst[y * PW + x] = v;
    }
    return dst;
  };
  const seed = new Uint8Array(PW * PH);
  for (let p = 0; p < PW * PH; p += 1) if (covered[p] && lum(panel, p) < 55 && sat(panel, p) < 0.55) seed[p] = 1;
  const strip = disc(disc(seed, 4, false), 4, true);
  const ring = disc(strip, 3, false);
  for (let p = 0; p < PW * PH; p += 1) if (strip[p]) ring[p] = 0;
  const out = Buffer.from(panel);
  const median = (p, want, R, accept) => {
    const x = p % PW, y = (p / PW) | 0;
    const r = [], g = [], b = [];
    for (let dy = -R; dy <= R; dy += 1) for (let dx = -R; dx <= R; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= PW || ny >= PH) continue;
      const q = ny * PW + nx;
      if (!covered[q] || want[q] !== 1 || !accept(q)) continue;
      r.push(panel[q * 3]); g.push(panel[q * 3 + 1]); b.push(panel[q * 3 + 2]);
    }
    if (r.length < 6) return null;
    const m = (a) => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
    return [m(r), m(g), m(b)];
  };
  const notStrip = new Uint8Array(PW * PH);
  for (let p = 0; p < PW * PH; p += 1) notStrip[p] = strip[p] || ring[p] ? 0 : 1;
  let inside = 0, beside = 0;
  for (let p = 0; p < PW * PH; p += 1) {
    if (!strip[p] || !covered[p] || lum(panel, p) <= 80) continue;
    const m = median(p, strip, 9, (q) => lum(panel, q) < 55 && sat(panel, q) < 0.55);
    if (!m) continue;
    out[p * 3] = m[0]; out[p * 3 + 1] = m[1]; out[p * 3 + 2] = m[2]; inside += 1;
  }
  for (let p = 0; p < PW * PH; p += 1) {
    if (!ring[p] || !covered[p]) continue;
    if (!(sat(panel, p) < 0.34 && lum(panel, p) > 80)) continue;
    const m = median(p, notStrip, 11, (q) => lum(panel, q) > 25);
    if (!m) continue;
    out[p * 3] = m[0]; out[p * 3 + 1] = m[1]; out[p * 3 + 2] = m[2]; beside += 1;
  }
  return { fixed: out, inside, beside };
}

/**
 * Build the panel for one body, repair it (or take the repair Joshua painted),
 * and project ONLY WHAT CHANGED back onto the base colour. Writing the whole
 * panel back would replace good texels with a resampled copy of themselves and
 * soften everything it touched; writing the delta leaves the rest of her
 * exactly as the master has it.
 */
async function panelPass(doc, who, key, exportOnly, repair) {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const prim = prims.sort((a, b) => b.getAttribute('POSITION').getCount() - a.getAttribute('POSITION').getCount())[0];
  const tex = prim?.getMaterial()?.getBaseColorTexture();
  if (!prim || !tex || !prim.getAttribute('NORMAL') || !prim.getAttribute('TEXCOORD_0') || !prim.getIndices()) return;
  const [W, H] = tex.getSize();
  if (W !== H) return;
  const S = W;
  const { data: img } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const map = texelMap(prim, S);
  const { panel, PW, PH, covered } = buildPanel(img, map, S);

  if (exportOnly) {
    mkdirSync(PANEL_DIR, { recursive: true });
    const file = join(PANEL_DIR, `${key}-front.png`);
    await sharp(panel, { raw: { width: PW, height: PH, channels: 3 } }).png().toFile(file);
    console.log(`  ${who}: panel ${PW}x${PH} (${((PANEL.X1 - PANEL.X0) * 1000 / PW).toFixed(2)} mm a pixel) -> ${file}`);
    return;
  }

  const edited = join(PANEL_DIR, `${key}-front-edited.png`);
  let fixed;
  let note;
  if (!existsSync(edited) && !repair) {
    console.log(`  ${who}: panel available to paint, no automatic repair asked for`);
    return;
  }
  if (existsSync(edited)) {
    const { data, info } = await sharp(edited).resize(PW, PH, { kernel: 'nearest' }).removeAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== PW || info.height !== PH) return;
    fixed = data;
    note = `painted panel ${key}-front-edited.png`;
  } else {
    const auto = autoRepairPanel(panel, covered, PW, PH);
    fixed = auto.fixed;
    note = `auto: ${auto.inside} px inside the cord, ${auto.beside} px of halo beside it`;
  }
  const moved = new Uint8Array(PW * PH);
  let nMoved = 0;
  for (let p = 0; p < PW * PH; p += 1) {
    if (panel[p * 3] !== fixed[p * 3] || panel[p * 3 + 1] !== fixed[p * 3 + 1] || panel[p * 3 + 2] !== fixed[p * 3 + 2]) {
      moved[p] = 1; nMoved += 1;
    }
  }
  if (nMoved === 0) { console.log(`  ${who}: panel unchanged, base colour left as it is`); return; }
  const out = Buffer.from(img);
  const changed = new Uint8Array(S * S);
  let wrote = 0;
  for (let i = 0; i < S * S; i += 1) {
    const p = panelPixelOf(map, i, PW, PH);
    if (p === null || !moved[p]) continue;
    out[i * 3] = fixed[p * 3]; out[i * 3 + 1] = fixed[p * 3 + 1]; out[i * 3 + 2] = fixed[p * 3 + 2];
    changed[i] = 1; wrote += 1;
  }
  // Bleed one texel into the gutter so bilinear sampling at an island's edge
  // cannot pull the old fringe back onto the surface.
  for (let y = 1; y < S - 1; y += 1) for (let x = 1; x < S - 1; x += 1) {
    const i = y * S + x;
    if (map.ok[i] || changed[i]) continue;
    for (const j of [i - 1, i + 1, i - S, i + S]) if (changed[j]) {
      out[i * 3] = out[j * 3]; out[i * 3 + 1] = out[j * 3 + 1]; out[i * 3 + 2] = out[j * 3 + 2];
      break;
    }
  }
  tex.setImage(await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer());
  console.log(`  ${who}: ${note} — ${nMoved} panel px -> ${wrote} texels`);
}

/**
 * Read every baked model's bind pose out as `BindJoint[]` and write the
 * test fixture.
 *
 * The POSITION is the translation of the INVERSE of the inverse bind
 * matrix — the bone's rest place in the same mesh space the vertices are
 * in, which is what makes `measureHuman`'s rules arithmetic rather than
 * guesswork. Rounded to a micrometre so a re-bake of the same master
 * produces the same file and a diff means something.
 */
async function writeBindFixture() {
  // The BAKED models, which are meshopt-compressed and quantized, so the
  // reader needs the decoder: the fixture has to describe the bones the
  // game actually loads, and quantization moves them by a fraction of a
  // millimetre.
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const out = {
    _comment: 'Bind-pose joints of the two human masters, measured from public/models/*.glb by the'
      + ' inverse bind matrices. Checked in so tests/humanSkeleton.test.ts can assert against the REAL'
      + ' skeletons without loading 3 MB of GLB. Regenerate with `node scripts/bakeHumans.mjs --bind`'
      + ' after any re-bake: a new master moves every bone.',
  };
  for (const human of HUMANS) {
    const doc = await io.read(join(OUT, human.out));
    const skin = doc.getRoot().listSkins()[0];
    const joints = skin.listJoints();
    const index = new Map(joints.map((j, i) => [j, i]));
    const m = skin.getInverseBindMatrices().getArray();
    const round = (v) => Math.round(v * 1e6) / 1e6;
    out[human.out.replace(/\.glb$/, '')] = joints.map((joint, i) => {
      const o = i * 16;
      const t = [m[o + 12], m[o + 13], m[o + 14]];
      const parent = joint.getParentNode?.() ?? null;
      return {
        name: joint.getName(),
        parent: parent && index.has(parent) ? index.get(parent) : -1,
        x: round(-(m[o] * t[0] + m[o + 1] * t[1] + m[o + 2] * t[2])),
        y: round(-(m[o + 4] * t[0] + m[o + 5] * t[1] + m[o + 6] * t[2])),
        z: round(-(m[o + 8] * t[0] + m[o + 9] * t[1] + m[o + 10] * t[2])),
      };
    });
    console.log(`[bake:humans] ${human.who}: ${joints.length} bind joints read from ${human.out}`);
  }
  const file = join(ROOT, 'tests', 'fixtures', 'humanBind.json');
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`[bake:humans] wrote ${file}`);
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const missing = HUMANS.filter((h) => !existsSync(join(MASTERS, h.master)));
  if (missing.length > 0) {
    console.error(`[bake:humans] no masters in art/humans/ — ${missing.map((m) => m.master).join(', ')}`);
    console.error(`[bake:humans] fetch them once, then re-run:`);
    console.error(`[bake:humans]   mkdir -p art/humans && curl -sSL -o /tmp/h.zip "${RELEASE}" && unzip -o /tmp/h.zip -d art/humans`);
    const second = missing.filter((m) => /-Lab2\.glb$/.test(m.master)).map((m) => m.master);
    if (second.length > 0) {
      // SAY THE TRUE THING RATHER THAN THE HOPEFUL ONE. The release above
      // holds Jack-Lab.glb and Sarah-Lab.glb, the pair from 2026-09-18.
      // The Lab2 pass is what Joshua brought in afterwards and what the
      // bake now reads: until they are added to that release (or their
      // own), the command above CANNOT produce them, and a clone that
      // follows the instruction and still fails deserves to be told why.
      console.error('[bake:humans]');
      console.error(`[bake:humans] ${second.join(' and ')} ${second.length > 1 ? 'are' : 'is'} NOT in that release yet — the second`);
      console.error('[bake:humans] Meshy pass, with a welded atlas, a modelled lanyard and a real-size ID');
      console.error('[bake:humans] card. Ask Joshua for them, or add them to the release so this command');
      console.error('[bake:humans] is true again.');
    }
    process.exitCode = 1;
    return;
  }

  // `--bind` writes the fixture the skeleton tests read, from the BAKED
  // models — the same bytes the game loads. `tests/fixtures/humanBind.json`
  // has told the reader to run this since it was written; until now the
  // flag did not exist, which is the sort of gap that is only found by
  // someone who needs it. A new master moves every bone, so this is the
  // one command between a new scan and a test that still describes it.
  if (process.argv.includes('--bind')) {
    await writeBindFixture();
    return;
  }

  const PANELS_ONLY = process.argv.includes('--panels');
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  for (const human of HUMANS) {
    const from = join(MASTERS, human.master);
    const to = join(OUT, human.out);
    const before = statSync(from).size;
    const doc = await io.read(from);

    if (human.panel) await panelPass(doc, human.who, human.panel, PANELS_ONLY, human.repair === true);
    // `--panels` only exports the pictures to paint; it writes no model.
    if (PANELS_ONLY) continue;
    if (human.author) {
      console.log(`[bake:humans] ${human.who}: authoring the clothing and printing the badge`);
      await authorSarah(doc, {
        cacheDir: CACHE,
        stamp: `${human.master.replace(/\.glb$/, '')}-${before}`,
        log: (line) => console.log(`[bake:humans] ${line}`),
      });
    }
    // AFTER the clothing, never before: the occlusion bake is cached
    // against the master's own geometry, and lifting the card out first
    // would silently change what that cache is a bake OF.
    if (human.badge) {
      await printBadge(doc, human.badge, { root: ROOT, log: (line) => console.log(`[bake:humans]   ${human.who}: ${line}`) });
    }
    await liftRoughness(doc, human.who);

    // WHAT THE MAPS ARE WORTH, one slot at a time. `textureCompress` is
    // given a slot filter so the metallic-roughness map can be told a
    // different size from the colour it shares a material with.
    for (const [slot, size] of Object.entries(SIZES)) {
      await doc.transform(textureCompress({
        encoder: sharp,
        targetFormat: 'webp',
        slots: new RegExp(`^${slot}$`),
        resize: [size, size],
        resizeFilter: 'lanczos3',
        // The normal map gets the higher quality and not lossless: see
        // the header for the four encodings that were measured against
        // the master before this number was chosen.
        quality: slot === 'normalTexture' ? 95 : 82,
      }));
    }

    // THE INFLUENCE SETS THREE WILL NEVER READ, dropped before anything
    // spends bytes compressing them.
    //
    // Jack's master carries JOINTS_0..10 and WEIGHTS_0..10 — 44 influences
    // a vertex — and Sarah's carries four sets, 16. three.js reads exactly
    // ONE set: `GLTFLoader` maps JOINTS_0 to `skinIndex` and WEIGHTS_0 to
    // `skinWeight`, and the skinning shader takes four. Every other set is
    // 16 bytes a vertex of something the renderer cannot look at — on
    // Jack, ten of them across 105,478 vertices.
    //
    // THIS IS SAFE BECAUSE SET 0 IS ALREADY WHOLE. `quantize` renormalises
    // skin weights, so WEIGHTS_0 leaves the bake summing to 1.0000 on
    // every vertex (measured: 0 of 105,478 under 0.95, and
    // `normalizeSkinWeights()` is then a no-op). What the dropped sets
    // held was the difference between a 44-bone blend and its four
    // strongest bones — which is the approximation every engine on the
    // web already makes, and the one the ant rigs in `public/models/`
    // have shipped under since alpha.22: the queen and the housefly carry
    // 12 influences apiece and are drawn with four.
    //
    // The masters keep all of it. This is the web build.
    //
    // AND THE FOUR ARE CHOSEN, NOT INHERITED — which is the part this
    // block used to get wrong, silently, for as long as nothing moved.
    //
    // Dropping sets 1..10 and keeping set 0 is only right if set 0 holds
    // the four bones that should drive the vertex. It holds the four
    // STRONGEST, which is not the same thing. An auto-rigger fitted to a
    // photogrammetry scan sprays small weights across the skeleton, and
    // some of that spray lands on bones nowhere near the vertex: measured
    // on Jack, a single 77.5 degree turn of his left shoulder flung 5,141
    // vertices more than a quarter of a metre, and 4,601 of those carry
    // an influence from a bone HALF A METRE TO NINE TENTHS OF A METRE
    // away — cross-body, on a skeleton whose whole joint span is 1.37 m.
    // His arm did not bend; it burst into a spray of triangles.
    //
    // It never showed because nothing ever moved. Both masters ship in
    // their bind pose, and a stray weight on a bone that never turns is
    // invisible. The first pose this project ever applied found it.
    //
    // So the influences are gathered from EVERY set, the ones naming a
    // bone further than `MAX_BIND_REACH` are discarded as the noise they
    // are, and the four strongest of what remains are renormalised into
    // set 0. A vertex keeps its nearest bone whatever happens, so no
    // vertex is ever left unweighted and collapses to the origin.
    //
    // Sarah needs none of this — her master carries eight influences
    // rather than forty-four and poses cleanly — but the rule is applied
    // to both, because "the one that needed it" is not a property a bake
    // should have to know.
    //
    // RE-CHECKED ON JACK-Lab2 (2026-09-19), because that master is clean
    // enough to make the rule look redundant: 2 influence sets, nothing
    // reaching further than 492 mm, 99.17% of the weight already in the
    // set three.js reads. Baked both ways and rendered the same two
    // frames: the standing pose differs on 3.87% of its pixels and ALL OF
    // THEM ARE THE SILHOUETTE — a one-pixel edge round the head, arms and
    // hands, nothing torn and nothing inside the body. So on this master
    // the rule is very nearly a no-op, and that is an argument for keeping
    // it rather than against: it costs nothing here and it is the only
    // thing standing between the bake and the next master like Lab1.
    //
    // AND IT DOES NOT COST THE FINGERS, which was the one real worry —
    // Joshua's headline for this master is "with all fingers rigged", and
    // a top-four cut is exactly what drops a finger's small weight. Of
    // the 17,330 hand-bone influences Jack's master holds over 5,805 hand
    // vertices, set 0 alone would ship 16,329 and the prune ships 16,355.
    // It ships MORE of them, because three.js reads four influences
    // whatever we do and the prune is the only step that picks which
    // four on purpose.
    for (const prim of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
      pruneStrayInfluences(prim, doc, human.who);
      for (const name of prim.listSemantics()) {
        if (/^(JOINTS|WEIGHTS)_([1-9]\d*)$/.test(name)) prim.setAttribute(name, null);
      }
    }

    await doc.transform(
      dedup(),
      // Weld before anything quantizes: quantization snaps positions to a
      // grid, and welding after it would fuse vertices the artist meant to
      // keep apart.
      weld(),
      // Reorder for the GPU's post-transform cache, quantize
      // (`KHR_mesh_quantization`, which the ant rigs already carry) and
      // encode `EXT_meshopt_compression` — the three steps the ant rigs
      // went through, in the one call that owns them.
      //
      // MEDIUM, NOT HIGH. The high level quantizes positions to 14 bits
      // over the whole bounding box; on a body two metres tall that is a
      // 0.12 mm lattice, which is fine, and it also drops skin weights to
      // 8 bits, which is not: these rigs carry the fingers, and a finger's
      // influence is exactly the small weight an 8-bit quantum rounds to
      // nothing.
      meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      prune(),
    );

    await io.write(to, doc);
    const after = statSync(to).size;
    const root = doc.getRoot();
    const tris = root.listMeshes().flatMap((m) => m.listPrimitives())
      .reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
    const joints = root.listSkins().map((s) => s.listJoints().length).join(', ');
    const tex = root.listTextures().map((t) => `${t.getSize()?.join('x') ?? '?'} ${t.getMimeType().replace('image/', '')}`);
    console.log(`[bake:humans] ${human.who}`);
    console.log(`[bake:humans]   ${human.master} ${mb(before)}  ->  ${human.out} ${mb(after)}   (${(before / after).toFixed(1)}x smaller)`);
    console.log(`[bake:humans]   ${Math.round(tris).toLocaleString()} triangles · ${joints} joints · ${tex.join(' · ')}`);
  }
}

await main();
