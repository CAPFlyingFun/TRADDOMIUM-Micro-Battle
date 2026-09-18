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
 * WHAT THE MASTERS COST, measured rather than assumed:
 *
 *   Jack-Lab.glb    47.5 MB   102,613 tris   69 joints   2K + 2K + 4K PNG
 *   Sarah-Lab.glb   35.1 MB   103,108 tris   69 joints   2K + 2K + 4K PNG
 *
 * That is 82 MB down the wire and about 128 MB of texture VRAM EACH once
 * the PNGs are decompressed with their mip chains. The triangles are not
 * the problem and never were — 205,000 for the pair is nothing beside the
 * 5.5 M the insects already push at 31 ms (`docs/PERFORMANCE.md`,
 * Baseline C-ALL). Texture memory is a cliff, not a slope: the tab is
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
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MASTERS = join(ROOT, 'art', 'humans');
const OUT = join(ROOT, 'public', 'models');

/** Where the masters live when they are not on this disk. One release, one asset, one checksum. */
const RELEASE = 'https://github.com/CAPFlyingFun/TRADDOMIUM-Micro-Battle/releases/download/Jack_Sarah_Lab_Models_GLB/Jack.and.Sarah.Lab.glb.models.zip';

/** Master file → what the game asks the loader for. */
const HUMANS = [
  { master: 'Jack-Lab.glb', out: 'jack.glb', who: 'Jack Bennett', lanyard: false },
  // Sarah is the one wearing an ID on a cord, and the only one whose base
  // colour is repaired. The flag is DELIBERATELY a fact about the master
  // rather than something the bake works out: the first version of this
  // looked for "the black, unsaturated thing on the chest", found 35,884
  // texels of Jack's dark clothing and repainted 5,572 of them. A detector
  // that cannot tell a lanyard from a dark shirt does not get to decide.
  { master: 'Sarah-Lab.glb', out: 'sarah.glb', who: 'Sarah Bennett', lanyard: true },
];

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
// The lanyard's white fringe
// ---------------------------------------------------------------------------

/**
 * How far off the cord the fringe reaches, in metres, and how wide a
 * neighbourhood the repair reads. Both EARNED at the probe rather than
 * guessed: 8 mm and 16 mm removed 18% of the fringe and touched nothing on
 * the badge, where 4 mm removed 13% and clipped it.
 */
const FRINGE_REACH = 0.008;
const FRINGE_READ = 0.016;
/** How far off the local tangent plane a neighbour may lie and still count. */
const FRINGE_SHEET = 0.005;
/** Brighter than this is not lanyard. A black cord is nowhere near it. */
const FRINGE_BRIGHT = 105;
/** And this much of what surrounds a texel must actually BE cord. */
const FRINGE_NEED = 0.07;

/**
 * REPAIR THE WHITE FRINGE ALONG SARAH'S LANYARD — in 3D, because the atlas
 * cannot be painted.
 *
 * Joshua, 2026-09-18: "around her neck where the lanyard hangs, the textures
 * are like messed up in a few spots and behind her badge, is a white patch on
 * her shirt. Any chance to fix it by tweaking the image?"
 *
 * WHY NOT BY TWEAKING THE IMAGE. Her texture is not a picture of a person; it
 * is ~103,000 PER-TRIANGLE ISLANDS, so two patches that touch in the atlas are
 * unrelated scraps of body. Any spatially coherent edit — an AI repaint, a
 * clone brush, an upscaler — bleeds one island into its neighbour, which is
 * how "sharpen the borders" turns every triangle into a visible facet. That
 * was measured on an enhanced copy of this very texture: 5.7% of texels inside
 * islands changed CLASS (29,485 shirt to skin, 12,160 cord to shirt) and the
 * fringe got slightly worse.
 *
 * So the repair is done where the model is coherent: SPACE. Every texel is
 * given the position and normal of the surface it covers, and a neighbour
 * means "near it on her body", never "near it in the picture". Two conditions
 * do the work:
 *
 *  - A neighbour must lie on the SAME SHEET (within a few mm of the local
 *    tangent plane). The badge is a flat card standing ~10 mm proud of the
 *    shirt, so a plain 3D ball around it is mostly SHIRT — which made the
 *    badge read as a bright outlier against burgundy and very nearly painted
 *    it out. The sheet test keeps the badge's neighbours on the badge.
 *  - The colour a texel is repaired WITH must be cord: dark AND unsaturated.
 *    Burgundy is dark too (luminance about 52), and when it was allowed into
 *    that pool the repair painted dark burgundy nicks across her collar.
 *
 * WHAT IT DOES NOT DO, stated plainly: it removes about a fifth of the fringe.
 * The fringe runs the whole length of the cord, so locally it IS the surface
 * and no outlier test can see all of it. Removing the rest means repainting
 * the cord as an object, which is a bigger job than a bake step.
 *
 * WHO IT RUNS ON IS A FACT ABOUT THE MASTER, not a guess. Only Sarah wears
 * the ID, and `HUMANS[].lanyard` says so — because the first version of this
 * asked the texture instead, found 35,884 texels of Jack's dark clothing
 * answering to "black and unsaturated on the chest", and repainted 5,572 of
 * them.
 */
async function repairLanyard(doc, who) {
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  const prim = prims.sort((a, b) => b.getAttribute('POSITION').getCount() - a.getAttribute('POSITION').getCount())[0];
  if (!prim) return;
  const material = prim.getMaterial();
  const tex = material?.getBaseColorTexture();
  const uvAttr = prim.getAttribute('TEXCOORD_0');
  const nAttr = prim.getAttribute('NORMAL');
  if (!tex || !uvAttr || !nAttr || !prim.getIndices()) return;

  const [W, H] = tex.getSize();
  if (W !== H) return;
  const S = W;
  const { data: img } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw()
    .toBuffer({ resolveWithObject: true });

  // Every texel learns which piece of her it covers. glTF puts (0,0) at the
  // TOP-LEFT, so the row is v*S — the one convention that had to be right, and
  // the body itself settled it: with v*S her chest reads burgundy 81% of the
  // time, flipped only 57%.
  const P = prim.getAttribute('POSITION').getArray();
  const N = nAttr.getArray();
  const UV = uvAttr.getArray();
  const IDX = prim.getIndices().getArray();
  const pos = new Float32Array(S * S * 3);
  const nrm = new Float32Array(S * S * 3);
  const ok = new Uint8Array(S * S);
  for (let t = 0; t < IDX.length; t += 3) {
    const v = [IDX[t], IDX[t + 1], IDX[t + 2]];
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

  const lum = (i) => 0.2126 * img[i * 3] + 0.7152 * img[i * 3 + 1] + 0.0722 * img[i * 3 + 2];
  const sat = (i) => {
    const mx = Math.max(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]);
    const mn = Math.min(img[i * 3], img[i * 3 + 1], img[i * 3 + 2]);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const onChest = (i) => {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    return y > 0.96 && y < 1.52 && z > 0 && Math.abs(x) < 0.22;
  };
  // THE CORD IS FOUND BY ITS OWN COLOUR, not by a box drawn by hand: it is the
  // only black, UNSATURATED thing on the front of her chest.
  const seed = [];
  for (let i = 0; i < S * S; i += 1) {
    if (ok[i] && onChest(i) && lum(i) < 30 && sat(i) < 0.45) seed.push(i);
  }
  if (seed.length < 500) {
    console.log(`  ${who}: no lanyard found, base colour left as it is`);
    return;
  }
  const bucket = (a, cell) => {
    const g = new Map();
    for (const i of a) {
      const k = `${Math.floor(pos[i * 3] / cell)},${Math.floor(pos[i * 3 + 1] / cell)},${Math.floor(pos[i * 3 + 2] / cell)}`;
      let e = g.get(k); if (!e) { e = []; g.set(k, e); } e.push(i);
    }
    return g;
  };
  const around = (g, cell, i, fn) => {
    const cx = Math.floor(pos[i * 3] / cell), cy = Math.floor(pos[i * 3 + 1] / cell), cz = Math.floor(pos[i * 3 + 2] / cell);
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      const e = g.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (e) for (const j of e) if (fn(j) === false) return;
    }
  };
  const sgrid = bucket(seed, FRINGE_REACH);
  const RE2 = FRINGE_REACH * FRINGE_REACH;
  const roi = [];
  for (let i = 0; i < S * S; i += 1) {
    if (!ok[i] || !onChest(i)) continue;
    let hit = false;
    around(sgrid, FRINGE_REACH, i, (j) => {
      const ax = pos[j * 3] - pos[i * 3], ay = pos[j * 3 + 1] - pos[i * 3 + 1], az = pos[j * 3 + 2] - pos[i * 3 + 2];
      if (ax * ax + ay * ay + az * az <= RE2) { hit = true; return false; }
      return true;
    });
    if (hit) roi.push(i);
  }
  const grid = bucket(roi, FRINGE_READ);
  const R2 = FRINGE_READ * FRINGE_READ;
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  const out = Buffer.from(img);
  const changed = new Uint8Array(S * S);
  let fixed = 0;
  for (const i of roi) {
    if (lum(i) <= FRINGE_BRIGHT) continue;
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const js = [];
    around(grid, FRINGE_READ, i, (j) => {
      const ax = pos[j * 3] - pos[i * 3], ay = pos[j * 3 + 1] - pos[i * 3 + 1], az = pos[j * 3 + 2] - pos[i * 3 + 2];
      if (ax * ax + ay * ay + az * az > R2) return true;
      if (Math.abs(ax * nx + ay * ny + az * nz) > FRINGE_SHEET) return true;
      js.push(j); return true;
    });
    if (js.length < 10) continue;
    const cord = js.filter((j) => lum(j) < 40 && sat(j) < 0.5);
    if (cord.length < 8 || cord.length / js.length < FRINGE_NEED) continue;
    out[i * 3] = med(cord.map((j) => img[j * 3]));
    out[i * 3 + 1] = med(cord.map((j) => img[j * 3 + 1]));
    out[i * 3 + 2] = med(cord.map((j) => img[j * 3 + 2]));
    changed[i] = 1; fixed += 1;
  }
  // Bleed one texel into the gutter so bilinear sampling at an island's edge
  // cannot pull the old fringe back onto the surface.
  for (let y = 1; y < S - 1; y += 1) for (let x = 1; x < S - 1; x += 1) {
    const i = y * S + x;
    if (ok[i] || changed[i]) continue;
    for (const j of [i - 1, i + 1, i - S, i + S]) if (changed[j]) {
      out[i * 3] = out[j * 3]; out[i * 3 + 1] = out[j * 3 + 1]; out[i * 3 + 2] = out[j * 3 + 2];
      break;
    }
  }
  tex.setImage(await sharp(out, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer());
  console.log(`  ${who}: lanyard fringe — cord ${seed.length} texels, ${roi.length} within reach, ${fixed} repaired`);
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const missing = HUMANS.filter((h) => !existsSync(join(MASTERS, h.master)));
  if (missing.length > 0) {
    console.error(`[bake:humans] no masters in art/humans/ — ${missing.map((m) => m.master).join(', ')}`);
    console.error(`[bake:humans] fetch them once, then re-run:`);
    console.error(`[bake:humans]   mkdir -p art/humans && curl -sSL -o /tmp/h.zip "${RELEASE}" && unzip -o /tmp/h.zip -d art/humans`);
    process.exitCode = 1;
    return;
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  for (const human of HUMANS) {
    const from = join(MASTERS, human.master);
    const to = join(OUT, human.out);
    const before = statSync(from).size;
    const doc = await io.read(from);

    if (human.lanyard) await repairLanyard(doc, human.who);
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
    for (const prim of doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives())) {
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
