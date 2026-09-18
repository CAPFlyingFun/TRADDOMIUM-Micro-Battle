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
  { master: 'Jack-Lab.glb', out: 'jack.glb', who: 'Jack Bennett' },
  { master: 'Sarah-Lab.glb', out: 'sarah.glb', who: 'Sarah Bennett' },
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
