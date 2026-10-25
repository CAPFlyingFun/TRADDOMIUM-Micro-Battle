/**
 * SARAH FOR THE STORY PLAYER (Joshua, 2026-10-24: his saved Sarah from the Sarah Lab, in TMB-Story's 3D "Watch").
 *
 *     node scripts/sarahV2Recovery/story-sarah.mjs [--out public/models/sarah-v2-story.glb] [--shots shots] [--no-shots]
 *                                                  [--one-material] [--dump raw.json] [--from raw.json] [--no-build]
 *
 * Writes ONE light, self-contained, skinned GLB of Sarah exactly as the Lab draws her -- SARAH_LOOK (`sarahLook.ts`):
 * the v2 body at 73%, NAVEL +20, the painted charcoal leggings, the fitted light spandex tee in athletic swatch 8, her
 * hair -- BAKED FROM THE RUNNING LAB. It builds the game, serves it, opens the character room with `?bake=story`, waits
 * for her to be in and dressed, and asks the room itself (`bakeForStory` in SarahLabScene.ts, `storyBake.ts`) to draw
 * every vertex of her through her own materials and read back what they computed: shape (morphs, CPU shape fields, the
 * fabric's vertex softening, the fitted tee's world-space navel settle), colour (the leggings' paint over her skin, the
 * tee's dye) and light (the normal she is finally lit with). Nothing of that is re-implemented here; this file only
 * assembles what the GPU gave back.
 *
 * THE FILE, started from `sarah-v2-body-slim.glb` itself, so her skeleton's nodes, the skin, its inverse bind matrices
 * and her geometry's units are the body file's to the byte (the face rig, `faceRig.ts`, is measured in them):
 *
 *   sarahBody  first in the scene's order (the story player takes the first skinned mesh it finds as her body). Its
 *              first primitive's material keeps the name `Material_0`, which is what the face rig is laid on.
 *              Positions and normals as captured; her colour baked over her own UVs (paint and all) as a 2048² WebP;
 *              her surface (roughness, and the leggings' matte where they are painted) as a 1024² metallic-roughness
 *              WebP; her normal map baked from the light the Lab draws her with (her own map, laid flat under the
 *              leggings as the fabric lays it), 2048², scale 1. Her PAINTED islands are a second primitive on the same
 *              vertices (`sarahPaint`, its own colour texture, the same surface and normal maps): her atlas's islands
 *              touch, and a texture's smaller mip levels average across a touch, which drew light seams down the
 *              leggings from any distance (`paintSplit` in storyBake.ts). `--one-material` keeps one primitive.
 *   sarahTee   positions and normals as captured (the fitted tee's navel settle in), its dye as COLOR_0 (linear, alpha
 *              1) on a white base colour, roughness and metalness as its fragment stage arrived at them, its normal map
 *              baked as the body's is (her nipples and navel drawn through it at the Lab's BREAST and NAVEL DETAIL).
 *   sarahHair  the hair file's own geometry, attributes, texture bytes and material, unchanged. (The Lab lights its
 *              cards' back faces with the front's normal, `patchHairMaterial`; plain three.js turns it, and the
 *              curtain's back faces come out dark. A player that wants the Lab's hair lays the same patch on.)
 *
 * Each part that SIT reshapes carries one morph target, `storySeat`: what the room's SIT changes in its morph weights
 * (`seatDelta`), weight 0, named in the mesh's `extras.targetNames` so three's GLTFLoader puts it in
 * `morphTargetDictionary`. No other morph target, no underscore attribute, no bikini. The body node's extras say what
 * she is (`storySarah`).
 *
 * It fails loudly when the bake is not what it claims: her head and her hair must come back exactly where the files have
 * them, nothing may be NaN, every vertex must have been drawn, the normals must be sound, her body's colour must cover
 * its UV islands, read the right way up against her own skin map, with the leggings charcoal and her skin her skin; the
 * baked normal maps must give her own maps back where nothing acts on the light, be flatter under the leggings and
 * carry the relief over her nipples; and the written file must read back with three parts, 68 joints and the body
 * file's inverse bind matrices to the byte.
 * Then it renders the file with plain three.js (no game code) into shots/story-sarah-*.png.
 *
 * Deterministic: the room's clock is held and her springs reset for the bake, the GPU work is the same work every time,
 * and the encoders are deterministic; the summary prints the file's SHA-256 to compare two runs by.
 *
 * `--dump` keeps the raw bake (JSON, about 120 MB) and `--from` assembles from a kept one without a browser; `--no-build`
 * serves the dist/ already built. About a minute and a half on a software renderer (SwiftShader), most of it the build
 * and the room opening.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(`--${name}`);
const OUT = path.resolve(ROOT, option('out', 'public/models/sarah-v2-story.glb'));
const SHOTS = path.resolve(ROOT, option('shots', 'shots'));
const DUMP = option('dump', '');
const FROM = option('from', '');
const BODY = path.join(ROOT, 'public/models/sarah-v2-body-slim.glb');
const TEE = path.join(ROOT, 'public/models/sarah-v2-spandex-lite.glb');
const HAIR = path.join(ROOT, 'public/models/sarah-v2-hair.glb');
const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--disable-dev-shm-usage'];
/** Her geometry units to rest metres (faceRig.ts's FACE_REST_SCALE / FACE_REST_OFFSET: bone 0's world times its inverse bind). */
const REST_SCALE = 0.89974678, REST_OFFSET = [0, 0.8002533, -0.0340415];
const restY = (gy) => REST_SCALE * gy + REST_OFFSET[1];
/** Above this (rest metres) nothing of her moves: no morph, no shape field, no paint touches her head. */
const HEAD_FROM = 1.45;

const started = Date.now();
const log = (m) => console.log(`[story-sarah ${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${m}`);
let failures = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
  return ok;
}

function chromiumPath() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  return import('playwright').then(({ chromium }) => {
    if (existsSync(chromium.executablePath())) return undefined;
    const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const linked = browsers ? path.join(browsers, 'chromium') : null;
    if (linked && existsSync(linked)) return linked;
    throw new Error('no Chromium found; this script never runs `playwright install`');
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. THE BAKE, from the running room

async function bakeInTheRoom() {
  const { chromium } = await import('playwright');
  const { build, preview } = await import('vite');
  if (!flag('no-build')) { log('building'); await build({ root: ROOT, logLevel: 'error' }); }
  const server = await preview({ root: ROOT, preview: { host: '127.0.0.1', port: 4201, strictPort: false, open: false }, logLevel: 'error' });
  const browser = await chromium.launch({ executablePath: await chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 932, height: 430 } });
    let pageErrors = 0;
    page.on('pageerror', (e) => { pageErrors++; log(`page error: ${e.message}`); });
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || t.startsWith('[story bake]')) log(`console ${m.type()}: ${t.slice(0, 400)}`); });
    await page.goto(`${server.resolvedUrls.local[0]}?open=CharacterRoom&bake=story`);
    log('waiting for her to be in, dressed and her cloth tee laid (minutes on a software renderer)');
    await page.waitForFunction(() => globalThis.__sarahLabStory?.ready?.() === true, null, { timeout: 900_000, polling: 1000 });
    log('she is ready: baking (the room draws every vertex of her through her own materials)');
    const raw = await page.evaluate((splitPaint) => globalThis.__sarahLabStory.bake({ splitPaint }), !flag('one-material'), { timeout: 0 });
    if (pageErrors) throw new Error(`${pageErrors} page error(s) during the bake`);
    return raw;
  } finally {
    await browser.close();
    await server.httpServer.close();
  }
}

const raw = FROM ? JSON.parse(readFileSync(FROM, 'utf8')) : await bakeInTheRoom();
if (DUMP) { writeFileSync(DUMP, JSON.stringify(raw)); log(`raw bake kept in ${DUMP}`); }

const bytesOf = (b64) => new Uint8Array(Buffer.from(b64, 'base64'));
const f32 = (b64) => new Float32Array(bytesOf(b64).buffer);
const u16 = (b64) => new Uint16Array(bytesOf(b64).buffer);
const u32 = (b64) => new Uint32Array(bytesOf(b64).buffer);

log(`the room drew: ${raw.drawn.join(', ')}`);
log(`facts: ${JSON.stringify({ ...raw.facts, drawn: undefined, teeDetail: raw.facts.teeDetail ? 'laid' : null })}`);
const parts = raw.parts.map((p) => ({
  ...p,
  position: f32(p.capture.position), normal: f32(p.capture.normal), normalLength: f32(p.capture.normalLength),
  albedo: p.capture.albedo ? f32(p.capture.albedo) : null, surface: p.capture.surface ? f32(p.capture.surface) : null,
  uvs: p.uv ? f32(p.uv) : null, colours: p.colour ? { size: p.colour.size, data: f32(p.colour.data) } : null,
  jointArray: p.joints ? u16(p.joints) : null, weightArray: p.weights ? f32(p.weights) : null, indexArray: p.index ? u32(p.index) : null,
  seat: p.morph.seat ? { position: f32(p.morph.seat.position), normal: p.morph.seat.normal ? f32(p.morph.seat.normal) : null, max: p.morph.seat.max, targets: p.morph.seat.targets } : null,
}));
for (const p of parts) {
  const m = p.materialFacts, maps = Object.entries(m.maps).filter(([, t]) => t).map(([k, t]) => `${k} ${t.name || '(unnamed)'} ${t.width}x${t.height}`);
  log(`  ${p.role.padEnd(7)} ${p.name}|${p.material}|${p.vertices}: side ${m.side}, roughness ${m.roughness}, metalness ${m.metalness}, colour ${m.colour?.map((x) => x.toFixed(3)).join(',')}, normalScale ${m.normalScale?.join(',') ?? '-'}, fabric ${m.fabric}, vertexColors ${m.vertexColors}, alphaTest ${m.alphaTest}; maps: ${maps.join('; ') || 'none'}`);
  log(`          rest skin spread ${p.skin.restSpread.toExponential(2)} over ${p.skin.restBones} bones; bindMode ${p.skin.bindMode}; bindMatrix ${p.skin.bindMatrix.every((x, i) => Math.abs(x - (i % 5 === 0 ? 1 : 0)) < 1e-9) ? 'identity' : p.skin.bindMatrix.map((x) => +x.toFixed(4)).join(',')}; seat ${p.seat ? `${p.seat.targets.join('+')} max ${p.seat.max.toExponential(2)}` : 'none'}`);
}
const body = parts.find((p) => p.role === 'body'), hairs = parts.filter((p) => p.role === 'hair'), garments = parts.filter((p) => p.role === 'garment');
if (!body || hairs.length !== 1) throw new Error(`expected her body and one hair mesh among ${parts.map((p) => p.name)}`);

// ---------------------------------------------------------------------------------------------------------------------
// 2. THE BAKE MATCHES THE FILES WHERE NOTHING MOVES HER

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const elements = (accessor) => {
  const n = accessor.getCount(), size = accessor.getElementSize(), out = new Float32Array(n * size), el = new Array(size);
  for (let i = 0; i < n; i++) { accessor.getElement(i, el); for (let c = 0; c < size; c++) out[i * size + c] = el[c]; }
  return out;
};
const bodyDoc = await io.read(BODY), teeDoc = await io.read(TEE), hairDoc = await io.read(HAIR);
const bodyPrimSource = bodyDoc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).find((p) => p.getMaterial()?.getName() === 'Material_0');
const hairPrimSource = hairDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const teePrimSource = teeDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const sourceOf = (p) => (p.role === 'body' ? bodyPrimSource : p.role === 'hair' ? hairPrimSource : teePrimSource);

log('checks on the capture');
{
  const src = elements(bodyPrimSource.getAttribute('POSITION')), srcN = elements(bodyPrimSource.getAttribute('NORMAL'));
  let n = 0, worst = 0, worstN = 0, lenWorst = 0;
  for (let i = 0; i < body.vertices; i++) {
    if (restY(src[i * 3 + 1]) <= HEAD_FROM) continue;
    n++;
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(body.position[i * 3 + c] - src[i * 3 + c]));
    const l = Math.hypot(srcN[i * 3], srcN[i * 3 + 1], srcN[i * 3 + 2]) || 1;
    worstN = Math.max(worstN, Math.hypot(body.normal[i * 3] - srcN[i * 3] / l, body.normal[i * 3 + 1] - srcN[i * 3 + 1] / l, body.normal[i * 3 + 2] - srcN[i * 3 + 2] / l));
    lenWorst = Math.max(lenWorst, Math.abs(body.normalLength[i] - l));
  }
  check(n > 1000 && worst < 1e-4, `(a) her head and neck above ${HEAD_FROM} m (${n} vertices) come back where the body file has them: worst ${worst.toExponential(2)} geometry units`);
  check(worstN < 1e-3 && lenWorst < 1e-2, `(a) ...and lit by the file's own normals there: worst direction ${worstN.toExponential(2)}, raw length off by ${lenWorst.toExponential(2)}`);
}
for (const h of hairs) {
  const src = elements(hairPrimSource.getAttribute('POSITION'));
  let worst = 0;
  for (let i = 0; i < src.length; i++) worst = Math.max(worst, Math.abs(h.position[i] - src[i]));
  check(src.length === h.position.length && worst < 1e-4, `(b) her hair (${h.vertices} vertices) comes back where its file has it: worst ${worst.toExponential(2)}`);
}
for (const p of parts) {
  const arrays = [p.position, p.normal, p.normalLength, p.albedo, p.surface, p.seat?.position, p.seat?.normal].filter(Boolean);
  const bad = arrays.reduce((s, a) => s + a.reduce((t, x) => t + (Number.isFinite(x) ? 0 : 1), 0), 0);
  check(bad === 0, `(c) ${p.name}: no NaN or infinity in what was captured`);
  const missing = Object.entries(p.capture.missing).filter(([, v]) => v > 0);
  check(missing.length === 0, `(c) ${p.name}: every vertex drawn in every pass (${Object.entries(p.capture.missing).map(([k, v]) => `${k} ${v}`).join(', ')} missing)`);
  let lo = Infinity, hi = 0, unit = 0;
  for (let i = 0; i < p.vertices; i++) {
    lo = Math.min(lo, p.normalLength[i]); hi = Math.max(hi, p.normalLength[i]);
    unit = Math.max(unit, Math.abs(Math.hypot(p.normal[i * 3], p.normal[i * 3 + 1], p.normal[i * 3 + 2]) - 1));
  }
  check(lo > 0.2 && hi < 5 && unit < 1e-2, `(d) ${p.name}: normals sound (raw lengths ${lo.toFixed(3)}..${hi.toFixed(3)}, unit within ${unit.toExponential(1)})`);
  check(p.skin.restSpread < 1e-5 && p.skin.bones === 68, `${p.name}: one rest matrix for every weighted bone (spread ${p.skin.restSpread.toExponential(1)}), 68 joints`);
  // the room's own attributes are the file's (three keeps a glTF's vertex order)
  const s = sourceOf(p);
  const same = (name, mine, tolerance) => {
    const a = s.getAttribute(name);
    if (!a || !mine) return !a && !mine;
    const ref = elements(a);
    if (ref.length !== mine.length) return false;
    for (let i = 0; i < ref.length; i++) if (Math.abs(ref[i] - mine[i]) > tolerance) return false;
    return true;
  };
  const sameIndex = (() => { const ref = s.getIndices()?.getArray(); return !!ref && ref.length === p.indexArray.length && ref.every((v, i) => v === p.indexArray[i]); })();
  check(same('TEXCOORD_0', p.uvs, 1e-6) && same('JOINTS_0', p.jointArray, 0) && same('WEIGHTS_0', p.weightArray, 1e-6) && sameIndex,
    `${p.name}: the room's uv, joints, weights and whole index are its file's`);
}
for (const g of garments) {
  const s = g.surface, rough = [], metal = [];
  for (let i = 0; i < g.vertices; i++) { rough.push(s[i * 3]); metal.push(s[i * 3 + 1]); }
  g.roughness = rough.reduce((a, b) => a + b, 0) / rough.length;
  g.metalness = metal.reduce((a, b) => a + b, 0) / metal.length;
  const spread = (xs, m) => Math.max(...xs.map((x) => Math.abs(x - m)));
  check(spread(rough, g.roughness) < 0.02 && spread(metal, g.metalness) < 0.02, `${g.name}: one roughness (${g.roughness.toFixed(3)}) and metalness (${g.metalness.toFixed(3)}) all over, as its fabric lays them`);
  let lo = [1, 1, 1], hi = [0, 0, 0];
  for (let i = 0; i < g.vertices; i++) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], g.albedo[i * 3 + c]); hi[c] = Math.max(hi[c], g.albedo[i * 3 + c]); }
  log(`  ${g.name}: linear albedo r ${lo[0].toFixed(3)}..${hi[0].toFixed(3)} g ${lo[1].toFixed(4)}..${hi[1].toFixed(4)} b ${lo[2].toFixed(4)}..${hi[2].toFixed(4)}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. HER BODY'S TEXTURES

const encodeRGB = (rgba, size, opts) => sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: size, height: size, channels: 4 } }).removeAlpha().webp(opts).toBuffer();
/**
 * A mesh's triangles over its texture, S texels square, on the CPU the way the GPU rasterises them: a texel belongs to a
 * triangle when its centre is inside. `visit(texel, a, b, c, w0, w1, w2)` with the corners and the centre's weights.
 */
function raster(uv, index, S, visit) {
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    const ax = uv[a * 2] * S, ay = uv[a * 2 + 1] * S, bx = uv[b * 2] * S, by = uv[b * 2 + 1] * S, cx = uv[c * 2] * S, cy = uv[c * 2 + 1] * S;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(S - 1, Math.ceil(Math.max(ay, by, cy))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(S - 1, Math.ceil(Math.max(ax, bx, cx))); x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area, w2 = 1 - w0 - w1;
        if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
        visit(y * S + x, a, b, c, w0, w1, w2);
      }
    }
  }
}
/** A texel of a normal map as a unit vector. */
function texelNormal(data, i, channels) {
  const x = data[i * channels] / 127.5 - 1, y = data[i * channels + 1] / 127.5 - 1, z = data[i * channels + 2] / 127.5 - 1, l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
const degreesBetween = (p, q) => (Math.acos(Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2]))) * 180) / Math.PI;
const stats = (xs) => { const sorted = Float64Array.from(xs).sort(); return { n: xs.length, mean: xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length), p99: sorted[Math.floor(0.99 * (sorted.length - 1))] ?? 0 }; };
let bodyHead = null;
const albedo = { size: raw.body.albedo.width, rgba: bytesOf(raw.body.albedo.rgba), covered: bytesOf(raw.body.albedo.covered) };
/** Her painted islands' own colour texture, when the bake split them off (`paintSplit`), and their triangles. */
const paint = raw.body.paint ? {
  rgba: bytesOf(raw.body.paint.albedo.rgba), covered: bytesOf(raw.body.paint.albedo.covered),
  skinTriangles: u32(raw.body.paint.skinTriangles), paintTriangles: u32(raw.body.paint.paintTriangles),
} : null;
/** What she looks like over her whole atlas, for the checks: each texel from the texture that holds its island. */
const colour = (() => {
  if (!paint) return albedo;
  const rgba = albedo.rgba.slice(), covered = albedo.covered.slice();
  for (let i = 0; i < covered.length; i++) if (!albedo.covered[i] && paint.covered[i]) { rgba.set(paint.rgba.subarray(i * 4, i * 4 + 4), i * 4); covered[i] = 1; }
  return { size: albedo.size, rgba, covered };
})();
const surface = { size: raw.body.surface.width, rgba: bytesOf(raw.body.surface.rgba), covered: bytesOf(raw.body.surface.covered) };
log('checks on her body\'s colour');
{
  const S = albedo.size, uv = body.uvs, island = new Uint8Array(S * S), head = new Uint8Array(S * S);
  const srcPos = elements(bodyPrimSource.getAttribute('POSITION'));
  raster(uv, body.indexArray, S, (i, a, b, c, w0, w1, w2) => {
    island[i] = 1;
    // the head's texels, kept a little inside its triangles (an edge texel's value is the sampler's blend)
    if (restY(srcPos[a * 3 + 1]) > HEAD_FROM && restY(srcPos[b * 3 + 1]) > HEAD_FROM && restY(srcPos[c * 3 + 1]) > HEAD_FROM && w0 > 0.02 && w1 > 0.02 && w2 > 0.02) head[i] = 1;
  });
  bodyHead = head;
  let inside = 0, holes = 0, unfilled = 0;
  for (let i = 0; i < S * S; i++) if (island[i]) { inside++; if (!colour.covered[i]) holes++; if (colour.rgba[i * 4 + 3] === 0) unfilled++; }
  check(inside > 0.2 * S * S && holes / inside < 0.01, `(e) the colour covers her UV islands: ${(100 * holes / inside).toFixed(3)}% of ${inside} island texels missed by the GPU`);
  check(unfilled === 0, `(e) ...and after the dilation every island texel has a colour (${unfilled} without)`);
  if (paint) {
    let both = 0;
    for (let i = 0; i < S * S; i++) if (albedo.covered[i] && paint.covered[i]) both++;
    check(both === 0 && paint.skinTriangles.length + paint.paintTriangles.length === body.indexArray.length,
      `(e) her painted islands (${paint.paintTriangles.length / 3} triangles) baked apart from her skin's (${paint.skinTriangles.length / 3}), no texel in both`);
  }
  // the right way up and the right colours: against her own skin map, on her head, where only the skin map colours her
  const mapTexture = bodyPrimSource.getMaterial().getBaseColorTexture();
  const skin = await sharp(Buffer.from(mapTexture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (skin.info.width !== S || skin.info.height !== S) throw new Error(`her skin map is ${skin.info.width}x${skin.info.height}, the bake ${S}x${S}`);
  let diff = 0, flipped = 0, n = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    if (!head[i]) continue;
    const j = (S - 1 - y) * S + x;
    for (let c = 0; c < 3; c++) { diff += Math.abs(albedo.rgba[i * 4 + c] - skin.data[i * 4 + c]); flipped += Math.abs(albedo.rgba[j * 4 + c] - skin.data[i * 4 + c]); }
    n += 3;
  }
  check(n > 30000 && diff / n < 3 && flipped / n > 3 * (diff / n), `(e) her head's colour is her skin map's, the right way up: mean ${(diff / n).toFixed(2)} levels off (upside down it would be ${(flipped / n).toFixed(1)})`);
  // a shin (painted leggings) and a forearm (bare skin): the front-most vertex of each
  const pick = (yFrom, yTo, side) => {
    let best = -1, z = -Infinity;
    for (let i = 0; i < body.vertices; i++) {
      const ry = restY(srcPos[i * 3 + 1]), rx = REST_SCALE * srcPos[i * 3];
      if (ry < yFrom || ry > yTo || (side === 'arm' ? Math.abs(rx) < 0.18 : Math.abs(rx) > 0.16 || Math.abs(rx) < 0.04)) continue;
      const rz = REST_SCALE * srcPos[i * 3 + 2];
      if (rz > z) { z = rz; best = i; }
    }
    return best;
  };
  const texel = (rgba, i) => {
    const x = Math.min(S - 1, Math.floor(uv[i * 2] * S)), y = Math.min(S - 1, Math.floor(uv[i * 2 + 1] * S)), o = (y * S + x) * 4;
    return [rgba[o], rgba[o + 1], rgba[o + 2]];
  };
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const shin = pick(0.3, 0.45, 'leg'), arm = pick(0.95, 1.1, 'arm');
  const shinColour = texel(colour.rgba, shin), armColour = texel(colour.rgba, arm), armSkin = texel(skin.data, arm);
  check(shin >= 0 && luma(shinColour) < 90 && Math.max(...shinColour) - Math.min(...shinColour) < 50, `(e) a shin (vertex ${shin}) is the leggings' dark charcoal: sRGB ${shinColour.join(',')}`);
  check(arm >= 0 && luma(armColour) > 100 && armColour[0] > armColour[2] && armColour.every((c, k) => Math.abs(c - armSkin[k]) < 12), `(e) a forearm (vertex ${arm}) is her skin: sRGB ${armColour.join(',')} (her skin map there ${armSkin.join(',')})`);
}

log('checks on her normal maps');
for (const p of parts) {
  if (!p.normalMap) continue;
  const S = p.normalMap.width, baked = bytesOf(p.normalMap.rgba);
  const own = (p.role === 'body' ? bodyPrimSource : teePrimSource).getMaterial().getNormalTexture();
  const source = await sharp(Buffer.from(own.getImage())).raw().toBuffer({ resolveWithObject: true });
  if (source.info.width !== S) throw new Error(`${p.name}'s own normal map is ${source.info.width} wide, the bake ${S}`);
  const ch = source.info.channels, flat = [0, 0, 1];
  if (p.role === 'body') {
    // her head: nothing acts on the light there (face off, no paint), so the bake must give her own map back
    const head = [], legsBaked = [], legsOwn = [];
    for (let i = 0; i < S * S; i++) {
      if (bodyHead[i]) head.push(degreesBetween(texelNormal(baked, i, 4), texelNormal(source.data, i, ch)));
      // under the painted leggings the fabric lays her pores flat (fabricMaterial.ts): the bake must be flatter there
      const a = i * 4, l = 0.2126 * colour.rgba[a] + 0.7152 * colour.rgba[a + 1] + 0.0722 * colour.rgba[a + 2];
      if (colour.covered[i] && l < 80 && Math.abs(colour.rgba[a + 2] - colour.rgba[a]) < 40) { legsBaked.push(degreesBetween(texelNormal(baked, i, 4), flat)); legsOwn.push(degreesBetween(texelNormal(source.data, i, ch), flat)); }
    }
    const h = stats(head), lb = stats(legsBaked), lo = stats(legsOwn);
    check(h.n > 30000 && h.mean < 1 && h.p99 < 4, `${p.name}: on her head the baked normal map is her own: ${h.mean.toFixed(2)}° mean, ${h.p99.toFixed(2)}° at the 99th percentile, over ${h.n} texels`);
    check(lb.n > 100000 && lb.mean < 0.6 * lo.mean, `${p.name}: under the leggings it is laid flatter, as the fabric draws it: ${lb.mean.toFixed(2)}° from flat (her own map ${lo.mean.toFixed(2)}°), ${lb.n} texels`);
  } else {
    // a garment: where no detail is drawn through it, the bake is its own map; over a nipple, it carries the relief
    const detail = raw.facts.teeDetail, rest = p.skin.rest;
    const spots = [...(detail?.nipples ?? []), ...(detail?.navel ? [detail.navel] : [])];
    const settle = detail?.settle ?? null;
    const world = (i) => { const x = p.position[i * 3], y = p.position[i * 3 + 1], z = p.position[i * 3 + 2]; return [rest[0] * x + rest[4] * y + rest[8] * z + rest[12], rest[1] * x + rest[5] * y + rest[9] * z + rest[13], rest[2] * x + rest[6] * y + rest[10] * z + rest[14]]; };
    const W = Array.from({ length: p.vertices }, (_, i) => world(i));
    const far = [], near = [];
    raster(p.uvs, p.indexArray, S, (i, a, b, c, w0, w1, w2) => {
      const q = [0, 1, 2].map((k) => w0 * W[a][k] + w1 * W[b][k] + w2 * W[c][k]);
      const d = (s) => Math.hypot(q[0] - s.center[0], q[1] - s.center[1], q[2] - s.center[2]);
      const nearest = Math.min(...spots.map(d), Infinity), toSettle = settle ? d(settle) : Infinity;
      const angle = degreesBetween(texelNormal(baked, i, 4), texelNormal(source.data, i, ch));
      if (nearest > 4 && toSettle > 8 && w0 > 0.05 && w1 > 0.05 && w2 > 0.05) far.push(angle);
      if (spots.length && Math.min(...(detail?.nipples ?? []).map(d), Infinity) < 0.6) near.push(angle);
    });
    const f = stats(far), n = stats(near);
    check(f.n > 50000 && f.mean < 1.5 && f.p99 < 6, `${p.name}: away from her detail the baked normal map is its own: ${f.mean.toFixed(2)}° mean, ${f.p99.toFixed(2)}° at the 99th percentile, over ${f.n} texels`);
    if (detail?.nipples?.length) check(n.n > 20 && n.mean > 2, `${p.name}: over her nipples it carries the relief the Lab draws through it: ${n.mean.toFixed(2)}° mean over ${n.n} texels`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. THE FILE

log('assembling the file');
const doc = bodyDoc, rootOf = doc.getRoot(), buffer = rootOf.listBuffers()[0];
const skin = rootOf.listSkins()[0];
const sourceIBM = Buffer.from(elements(skin.getInverseBindMatrices()).buffer).toString('hex');
const bodyNode = rootOf.listNodes().find((n) => n.getMesh() && n.getSkin());
const armature = rootOf.listNodes().find((n) => n.listChildren().includes(bodyNode));
const bodyMeshDoc = bodyNode.getMesh();
const acc = (type, array, normalized = false) => doc.createAccessor().setType(type).setArray(array).setNormalized(normalized).setBuffer(buffer);
/** Unit-range floats as normalized signed 16-bit (KHR_mesh_quantization): 1/32767 of a geometry unit is 27 µm on her. */
const snorm16 = (a) => { const out = new Int16Array(a.length); for (let i = 0; i < a.length; i++) { const v = Math.max(-1, Math.min(1, a[i])); out[i] = Math.round(v * 32767); } return out; };
const unorm16 = (a) => { const out = new Uint16Array(a.length); for (let i = 0; i < a.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, a[i])) * 65535); return out; };
const inUnitRange = (a) => a.every((x) => x >= -1 && x <= 1);
const jointsAccessor = (j) => (Math.max(...j) < 256 ? acc('VEC4', Uint8Array.from(j)) : acc('VEC4', Uint16Array.from(j)));
function storySeatOn(prim, mesh, part) {
  if (!part.seat) { mesh.setExtras({}); mesh.setWeights([]); return false; }
  const target = doc.createPrimitiveTarget('storySeat').setAttribute('POSITION', acc('VEC3', part.seat.position));
  if (part.seat.normal) target.setAttribute('NORMAL', acc('VEC3', part.seat.normal));
  prim.addTarget(target);
  mesh.setExtras({ targetNames: ['storySeat'] });
  mesh.setWeights([0]);
  return true;
}

// her body: the one primitive the room draws (the bikini's are not), no morph targets, no underscore attributes
const bodyPrim = bodyMeshDoc.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0');
for (const p of bodyMeshDoc.listPrimitives()) if (p !== bodyPrim) { bodyMeshDoc.removePrimitive(p); p.dispose(); }
for (const t of bodyPrim.listTargets()) { bodyPrim.removeTarget(t); t.dispose(); }
for (const s of bodyPrim.listSemantics()) if (s.startsWith('_')) bodyPrim.setAttribute(s, null);
if (!inUnitRange(body.position)) throw new Error('her body left the [-1, 1] range its file is quantized in');
bodyPrim.setAttribute('POSITION', acc('VEC3', snorm16(body.position), true));
bodyPrim.setAttribute('NORMAL', acc('VEC3', snorm16(body.normal), true));
bodyMeshDoc.setName('sarahBody');
bodyNode.setName('sarahBody');
storySeatOn(bodyPrim, bodyMeshDoc, body);
const bodyMat = bodyPrim.getMaterial(), bf = body.materialFacts;
doc.createExtension(EXTTextureWebP).setRequired(true);
const albedoWebp = await encodeRGB(albedo.rgba, albedo.size, { quality: 90, smartSubsample: true, effort: 6 });
// roughness and metalness are numbers, not colours: lossless, so no chroma subsampling mixes one channel into another
const surfaceWebp = await encodeRGB(surface.rgba, surface.size, { lossless: true, effort: 6 });
bodyMat.setBaseColorTexture(doc.createTexture('sarahBody-albedo').setImage(new Uint8Array(albedoWebp)).setMimeType('image/webp'));
bodyMat.setBaseColorFactor([1, 1, 1, 1]);
const usesRM = !!(bf.maps.roughnessMap || bf.maps.metalnessMap);
bodyMat.setMetallicRoughnessTexture(doc.createTexture('sarahBody-surface').setImage(new Uint8Array(surfaceWebp)).setMimeType('image/webp'));
bodyMat.setRoughnessFactor(1).setMetallicFactor(1);
/** A baked normal map, as WebP near-lossless: every channel at full resolution (a lossy WebP would subsample X and Y). */
const normalTexture = async (name, b) => doc.createTexture(name).setImage(new Uint8Array(await encodeRGB(bytesOf(b.rgba), b.width, { nearLossless: true, quality: 60, effort: 6 }))).setMimeType('image/webp');
let normalNote = 'none (the Lab draws none)';
if (body.normalMap) {
  bodyMat.setNormalTexture(await normalTexture('sarahBody-normal', body.normalMap));
  // baked divided by the room's normalScale, so the file's is 1 (GLTFLoader makes it (1, -1) again, as it did for the room)
  bodyMat.setNormalScale(1);
  normalNote = `baked from the Lab's shading over her own (${body.normalMap.width}², ${body.normalMap.turned} of ${body.indexArray.length / 3} triangles drawn turned)`;
} else bodyMat.setNormalTexture(null);
bodyMat.setDoubleSided(bf.side === 'double').setAlphaMode('OPAQUE').setEmissiveFactor([0, 0, 0]);
// her painted islands, baked apart (`paintSplit` in storyBake.ts): the same vertices -- the very same accessors, and the
// same storySeat -- drawn by a second primitive with their own colour texture, so no mip level of either texture mixes
// paint with skin. `Material_0` keeps her skin, her head with it, and stays first.
let paintNote = 'one primitive (--one-material)';
if (paint) {
  bodyPrim.setIndices(acc('SCALAR', paint.skinTriangles));
  const paintMat = doc.createMaterial('sarahPaint').setBaseColorFactor([1, 1, 1, 1])
    .setBaseColorTexture(doc.createTexture('sarahPaint-albedo').setImage(new Uint8Array(await encodeRGB(paint.rgba, albedo.size, { quality: 90, smartSubsample: true, effort: 6 }))).setMimeType('image/webp'))
    .setMetallicRoughnessTexture(bodyMat.getMetallicRoughnessTexture()).setRoughnessFactor(1).setMetallicFactor(1)
    .setNormalTexture(bodyMat.getNormalTexture()).setNormalScale(bodyMat.getNormalScale())
    .setDoubleSided(bodyMat.getDoubleSided()).setAlphaMode('OPAQUE');
  // the same samplers as her skin's, so the surface and normal maps are one texture each in the file, and one upload
  const sameSampler = (to, from) => to && from && to.setMagFilter(from.getMagFilter()).setMinFilter(from.getMinFilter()).setWrapS(from.getWrapS()).setWrapT(from.getWrapT()).setTexCoord(from.getTexCoord());
  sameSampler(paintMat.getBaseColorTextureInfo(), bodyMat.getBaseColorTextureInfo());
  sameSampler(paintMat.getMetallicRoughnessTextureInfo(), bodyMat.getMetallicRoughnessTextureInfo());
  sameSampler(paintMat.getNormalTextureInfo(), bodyMat.getNormalTextureInfo());
  const paintPrim = doc.createPrimitive().setMaterial(paintMat).setIndices(acc('SCALAR', paint.paintTriangles));
  for (const semantic of bodyPrim.listSemantics()) paintPrim.setAttribute(semantic, bodyPrim.getAttribute(semantic));
  for (const t of bodyPrim.listTargets()) {
    const twin = doc.createPrimitiveTarget(t.getName());
    for (const semantic of t.listSemantics()) twin.setAttribute(semantic, t.getAttribute(semantic));
    paintPrim.addTarget(twin);
  }
  bodyMeshDoc.addPrimitive(paintPrim);
  paintNote = `two primitives: Material_0 (${paint.skinTriangles.length / 3} triangles, her skin) and sarahPaint (${paint.paintTriangles.length / 3}, her painted islands), one set of vertices`;
}

// each garment: its own node, its own mesh, its own material, colour per vertex
const garmentNodes = [];
for (const g of garments) {
  const name = g.material === 'shirtSpandexLite' ? 'sarahTee' : `sarah${g.material[0].toUpperCase()}${g.material.slice(1)}`;
  if (!inUnitRange(g.position)) throw new Error(`${name} left the [-1, 1] range`);
  const colour = new Float32Array(g.vertices * 4);
  for (let i = 0; i < g.vertices; i++) { colour[i * 4] = g.albedo[i * 3]; colour[i * 4 + 1] = g.albedo[i * 3 + 1]; colour[i * 4 + 2] = g.albedo[i * 3 + 2]; colour[i * 4 + 3] = 1; }
  const gf = g.materialFacts;
  const material = doc.createMaterial(g.material).setBaseColorFactor([1, 1, 1, 1])
    .setRoughnessFactor(+g.roughness.toFixed(4)).setMetallicFactor(+g.metalness.toFixed(4)).setDoubleSided(gf.side === 'double').setAlphaMode('OPAQUE');
  if (g.normalMap) material.setNormalTexture(await normalTexture(`${name}-normal`, g.normalMap)).setNormalScale(1);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', acc('VEC3', snorm16(g.position), true))
    .setAttribute('NORMAL', acc('VEC3', snorm16(g.normal), true))
    .setAttribute('TEXCOORD_0', acc('VEC2', g.uvs))
    .setAttribute('COLOR_0', acc('VEC4', unorm16(colour), true))
    .setAttribute('JOINTS_0', jointsAccessor(g.jointArray))
    .setAttribute('WEIGHTS_0', acc('VEC4', g.weightArray))
    .setIndices(acc('SCALAR', g.vertices <= 65535 ? Uint16Array.from(g.indexArray) : Uint32Array.from(g.indexArray)))
    .setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  storySeatOn(prim, mesh, g);
  garmentNodes.push(doc.createNode(name).setMesh(mesh).setSkin(skin));
  g.nodeName = name;
}

// her hair: its file's own, unchanged
const hairNode = (() => {
  const h = hairs[0], s = hairPrimSource, sm = s.getMaterial(), hf = h.materialFacts;
  check(hf.alphaTest === sm.getAlphaCutoff() && hf.side === 'double' && sm.getDoubleSided() && Math.abs(hf.roughness - sm.getRoughnessFactor()) < 1e-6,
    `her hair's material in the room is its file's (alpha test ${hf.alphaTest}, ${hf.side}-sided, roughness ${hf.roughness})`);
  const t = sm.getBaseColorTexture();
  const material = doc.createMaterial('sarahHair').setBaseColorFactor(sm.getBaseColorFactor()).setBaseColorTexture(doc.createTexture('sarah-hair').setImage(new Uint8Array(t.getImage())).setMimeType(t.getMimeType()))
    .setRoughnessFactor(sm.getRoughnessFactor()).setMetallicFactor(sm.getMetallicFactor()).setAlphaMode(sm.getAlphaMode()).setAlphaCutoff(sm.getAlphaCutoff()).setDoubleSided(sm.getDoubleSided());
  const prim = doc.createPrimitive().setMaterial(material).setIndices(acc('SCALAR', s.getIndices().getArray().slice()));
  for (const semantic of s.listSemantics()) {
    const a = s.getAttribute(semantic);
    prim.setAttribute(semantic, acc(a.getType(), a.getArray().slice(), a.getNormalized()));
  }
  const mesh = doc.createMesh('sarahHair').addPrimitive(prim);
  storySeatOn(prim, mesh, h);
  return doc.createNode('sarahHair').setMesh(mesh).setSkin(skin);
})();

// her body first, then her clothes and her hair, then the skeleton
{
  const others = armature.listChildren().filter((n) => n !== bodyNode);
  for (const n of armature.listChildren()) armature.removeChild(n);
  for (const n of [bodyNode, ...garmentNodes, hairNode, ...others]) armature.addChild(n);
}
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { return 'unknown'; } })();
const shape = (() => { try { return JSON.parse(raw.facts.shape).shape ?? {}; } catch { return {}; } })();
bodyNode.setExtras({
  storySarah: {
    version: 1, look: raw.facts.look, bump: raw.facts.bump / 100, navel: shape.navel ?? 0, skin: raw.facts.skin?.worn ?? 'original',
    tee: 'fitted light tee (cloth sim off)', seatMorph: 'storySeat', face: 'faceRig v2 on Material_0', commit,
    // her painted islands are the body's second primitive (material sarahPaint), on the same vertices and the same storySeat
    ...(paint ? { paint: 'sarahPaint' } : {}),
  },
});
await doc.transform(prune({ keepAttributes: true, keepLeaves: true, keepExtras: true }));
doc.createExtension(KHRMeshQuantization).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const fileBytes = readFileSync(OUT);
const sha = createHash('sha256').update(fileBytes).digest('hex');

// ---------------------------------------------------------------------------------------------------------------------
// 5. THE FILE READS BACK AS IT WAS MEANT

log('checks on the written file');
{
  const back = await io.read(OUT), r = back.getRoot();
  const meshNodes = r.listNodes().filter((n) => n.getMesh());
  check(meshNodes.length === parts.length, `(f) ${meshNodes.length} skinned parts (${meshNodes.map((n) => n.getName()).join(', ')}), ${parts.length} expected`);
  const skins = r.listSkins();
  check(skins.length === 1 && skins[0].listJoints().length === 68 && meshNodes.every((n) => n.getSkin() === skins[0]), `(f) one skin of 68 joints, every part on it`);
  check(Buffer.from(elements(skins[0].getInverseBindMatrices()).buffer).toString('hex') === sourceIBM, '(f) inverse bind matrices byte-identical to sarah-v2-body-slim.glb');
  const firstSkinned = (() => { let found = null; const walk = (n) => { if (found) return; if (n.getMesh() && n.getSkin()) { found = n; return; } n.listChildren().forEach(walk); }; r.listScenes()[0].listChildren().forEach(walk); return found; })();
  check(firstSkinned?.getName() === 'sarahBody' && firstSkinned.getMesh().listPrimitives()[0].getMaterial().getName() === 'Material_0', `(f) the first skinned mesh in the scene is ${firstSkinned?.getName()}, material ${firstSkinned?.getMesh().listPrimitives()[0].getMaterial().getName()}`);
  const prims = meshNodes.flatMap((n) => n.getMesh().listPrimitives());
  check(prims.every((p) => p.listSemantics().every((s) => !s.startsWith('_')) && p.listTargets().every((t) => t.getName() === 'storySeat')), '(f) no underscore attributes, no morph target but storySeat');
  const back0 = elements(meshNodes.find((n) => n.getName() === 'sarahBody').getMesh().listPrimitives()[0].getAttribute('POSITION'));
  let worst = 0;
  for (let i = 0; i < back0.length; i++) worst = Math.max(worst, Math.abs(back0[i] - body.position[i]));
  check(worst < 2e-5, `(f) her body's positions survive the file to ${worst.toExponential(2)} geometry units`);
}

// what each part costs in the file: its accessors' compressed buffer views and its textures' images
const summary = (() => {
  const glb = fileBytes, jsonLength = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const viewBytes = (v) => { const view = json.bufferViews[v]; return view.extensions?.EXT_meshopt_compression?.byteLength ?? view.byteLength; };
  return json.nodes.filter((n) => n.mesh !== undefined).map((n) => {
    const mesh = json.meshes[n.mesh], views = new Set(), images = new Set();
    let triangles = 0;
    const positions = new Set();
    for (const p of mesh.primitives) {
      positions.add(p.attributes.POSITION);
      triangles += json.accessors[p.indices].count / 3;
      for (const a of [...Object.values(p.attributes), p.indices, ...(p.targets ?? []).flatMap((t) => Object.values(t))]) views.add(json.accessors[a].bufferView);
      const m = json.materials[p.material];
      for (const info of [m.pbrMetallicRoughness?.baseColorTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture, m.normalTexture].filter(Boolean)) {
        const tex = json.textures[info.index];
        images.add(tex.extensions?.EXT_texture_webp?.source ?? tex.source);
      }
    }
    const geometry = [...views].reduce((s, v) => s + viewBytes(v), 0), textures = [...images].reduce((s, i) => s + viewBytes(json.images[i].bufferView), 0);
    const vertices = [...positions].reduce((sum, a) => sum + json.accessors[a].count, 0);
    return { name: n.name, vertices, triangles, geometry, textures };
  });
})();
log(`wrote ${path.relative(ROOT, OUT)}`);
for (const s of summary) console.log(`  ${s.name.padEnd(10)} ${String(s.vertices).padStart(7)} vertices ${String(s.triangles).padStart(7)} triangles  ${(s.geometry / 1024).toFixed(0).padStart(5)} KB geometry + ${(s.textures / 1024).toFixed(0).padStart(5)} KB textures`);
console.log(`  total ${(statSync(OUT).size / 1024).toFixed(0)} KB · sha256 ${sha}`);
console.log(`  body: ${paintNote}`);
console.log(`  body normal map: ${normalNote}; body surface ${usesRM ? 'baked from the Lab\'s roughness/metalness maps and paint' : 'baked (the Lab has no maps there)'}; commit ${commit}`);

// ---------------------------------------------------------------------------------------------------------------------
// 6. WHAT IT LOOKS LIKE, with plain three.js and nothing of the game

if (!flag('no-shots')) {
  const { chromium } = await import('playwright');
  mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: await chromiumPath(), args: CHROMIUM_ARGS });
  try {
    const page = await browser.newPage({ viewport: { width: 720, height: 960 } });
    page.on('pageerror', (e) => { failures++; log(`viewer page error: ${e.message}`); });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log(`viewer ${m.type()}: ${m.text().slice(0, 300)}`); });
    const HTML = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#30343c}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(720, 960);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x30343c);
scene.add(new THREE.HemisphereLight(0xe8eef6, 0x5a5f68, 1.3));
const sun = new THREE.DirectionalLight(0xfff2e2, 2.2); sun.position.set(1.5, 2.8, 2.2); scene.add(sun);
const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/story.glb');
scene.add(gltf.scene);
const skinned = []; gltf.scene.traverse((o) => { if (o.isSkinnedMesh) { o.frustumCulled = false; skinned.push(o); } });
const camera = new THREE.PerspectiveCamera(30, 720 / 960, 0.05, 50);
window.__story = {
  info: () => skinned.map((m) => ({ name: m.name, material: m.material.name, vertices: m.geometry.attributes.position.count, morphs: Object.keys(m.morphTargetDictionary ?? {}), vertexColors: m.material.vertexColors, maps: ['map', 'normalMap', 'roughnessMap'].filter((k) => m.material[k]) })),
  shot: (yaw, y, distance, targetY, fov, seat) => {
    for (const m of skinned) { const k = m.morphTargetDictionary?.storySeat; if (k !== undefined) m.morphTargetInfluences[k] = seat; }
    camera.fov = fov; camera.updateProjectionMatrix();
    camera.position.set(Math.sin(yaw) * distance, y, Math.cos(yaw) * distance);
    camera.lookAt(0, targetY, 0);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
window.__storyReady = true;
</script>`;
    await page.route('http://story.test/**', (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/' || url.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
      if (url.pathname === '/story.glb') return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fileBytes });
      if (url.pathname.startsWith('/three/')) {
        const file = path.join(ROOT, 'node_modules', url.pathname.slice(1));
        if (existsSync(file)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(file) });
      }
      return route.fulfill({ status: 404, body: '' });
    });
    await page.goto('http://story.test/');
    await page.waitForFunction(() => globalThis.__storyReady === true, null, { timeout: 300_000 });
    const info = await page.evaluate(() => globalThis.__story.info());
    log(`three.js reads: ${info.map((m) => `${m.name}|${m.material}|${m.vertices}${m.morphs.length ? ` morphs ${m.morphs}` : ''}${m.vertexColors ? ' vertex colours' : ''} maps ${m.maps.join('+') || '-'}`).join('; ')}`);
    check(info[0]?.name.startsWith('sarahBody') && info[0].material === 'Material_0' && info.filter((m) => m.morphs.includes('storySeat')).length >= 2, 'three.js finds her body first, on Material_0, and storySeat by name');
    const views = [
      ['front', 0, 1.0, 2.5, 0.88, 42, 0], ['side', Math.PI / 2, 1.0, 2.5, 0.88, 42, 0], ['three-quarter', 0.6, 1.1, 2.5, 0.88, 42, 0],
      ['head', 0.35, 1.58, 0.75, 1.55, 30, 0], ['torso', 0.35, 1.25, 1.1, 1.12, 34, 0], ['legs', 0.5, 0.7, 1.3, 0.5, 34, 0], ['seat-front', 0, 1.0, 2.5, 0.88, 42, 1], ['seat-side', Math.PI / 2, 1.0, 2.5, 0.88, 42, 1],
    ];
    for (const [name, yaw, y, distance, targetY, fov, seat] of views) {
      const data = await page.evaluate((a) => globalThis.__story.shot(...a), [yaw, y, distance, targetY, fov, seat]);
      const file = path.join(SHOTS, `story-sarah-${name}.png`);
      writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
      log(`  ${path.relative(ROOT, file)}`);
    }
  } finally { await browser.close(); }
}

if (failures) { console.error(`[story-sarah] ${failures} check(s) FAILED`); process.exit(1); }
log('every check passed');
