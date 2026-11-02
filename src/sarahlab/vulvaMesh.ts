/**
 * HER REBUILT VULVA, LAID ON HER (vulvaPatch.ts makes it; this draws it). The area is taken out of her body's draw (its
 * index list -- nothing of her file or her vertices changes) and drawn by a mesh of its own: her material, her
 * skeleton, her motion shapes, every point sampled from her skin where it lies. Her shape as it stands now (every field,
 * her build) is read back from her body each time it changes, so at rest the area is exactly her skin, only finer.
 */
import * as THREE from 'three';
import { bakeVulva, type VulvaBake } from './vulvaPatch';
import { JIGGLE_ATTRIBUTE, PUSH_ATTRIBUTE, patchJiggle } from './softBody';
import { birthAreaCentre } from './birthArea';
import { sacRadius, type WombShape } from './baby';

/**
 * GAME TUNING for the opening (Joshua's references, 2026-10-30: at crowning the whole area round the opening domes out
 * several centimetres, so the opening stands level with her thighs or in front of them, not sunk between them).
 */
export const VULVA_OPEN = Object.freeze({
  /**
   * which way the opening faces and the tube runs (degrees from straight down, toward her front, in her rest shape).
   * BIOLOGICAL SHAPE: standing, the vagina runs up and BACK at about 45 degrees, so its mouth faces down and forward;
   * reclined, that is toward whoever is in front of her (Joshua, 2026-10-30: "is the split angled the wrong direction?")
   */
  tilt: 40,
  /** GAME TUNING: how far out along her skin the opening's edge may walk, of the way to the area's own edge (so a
   * band of her skin is always left to give way between) */
  room: 0.75,
  /** GAME TUNING: the opening's edge kept `legClear` metres off her legs -- skin a thigh carries `legWeight` of or more,
   * within `legSlab` metres in or out of her skin's surface there (Joshua, 2026-10-31: "1cm to the thighs"; 2026-11-01,
   * her inner thighs held apart under her vulva by birthGap.ts: half a centimetre) */
  legClear: 0.005, legWeight: 0.5, legSlab: 0.05,
  /** GAME TUNING: her legs' skin is never the area's -- her leg's side of each leg opening (birthWeights.ts) and this many
   * metres in from it on her torso's side stay her own, so opening and bulging never take her inner thighs with them
   * (Joshua, 2026-11-01: "add a 1cm mask around the whole area so that way it doesn't remove the actual inside of the
   * thighs") */
  legMask: 0.01,
  /** BIOLOGICAL SHAPE: the canal's length (metres) and how far its deep end leans forward of straight up her body
   * (degrees) -- the curve of Carus */
  canal: 0.08, canalLean: 15,
  /**
   * THE BALLOON (Joshua, 2026-11-01: "the solid balloon skin that holds everything else in it", with his photographs of a
   * balloon's mouth open, half open and shut: "the skin folding over (inside/outside) as that slightly thicker edge").
   * One closed skin from the opening to the top of her womb: its mouth a rolled bead `bead` metres round (shown as it
   * opens: shut, the two sides of the bead lie together as the balloon's do), the canal (`canal` long) with `pleats`
   * soft folds down its walls `pleatDepth` of its width deep (smoothed out as it stretches open), the cervix (`cervix`
   * long, its own opening `cervixShut` metres across shut and the opening's full width at 100%: the dilation), and the
   * womb's bulb (`womb` long, `wombRadius` round), closed over at its top. BIOLOGICAL SHAPE, GAME TUNING
   */
  /**
   * THE LIPS AS A SOFT SHEET (Joshua, 2026-11-01: "making each side of vagina with a soft body, cloth simulation where it
   * naturally closes, but as it opens, it will stretch... the outside can be painted skin and the inside the pink... make
   * it somewhat stiff so it doesn't flap"; his reference at about 20% open: thick rounded lips folding over in a U into
   * the opening). Each lip a sheet of her own skin from `sheetFoot` metres out along her skin from the opening's edge,
   * rising to a rounded crest `rise` high, its nose `noseRound` of its height round, folding over and down its inner face
   * to the edge, where the balloon goes on. It keeps its cross-section's area as it stretches round the opening (thinner
   * and lower the wider it is, by the square root of the stretch), is evened round the opening `sheetSmooth` times so it
   * is one soft piece, and curls its nose in over the opening by `curl` of its roundness while it is starting to open.
   */
  sheet: false, sheetFoot: 0.022, noseRound: 0.42, curl: 0.55, sheetSmooth: 4, sheetLift: 0.0004,
  bead: 0.004, lipWall: 0.008,
  /** GAME TUNING: the balloon's rolled rim round the opening -- how round (metres, at full size), how far its middle stands
   * out of her (a share of that), and how many Taubin passes even the edge it is laid round */
  rimBead: 0.007, rimLift: 0.7, rimSmooth: 30, rimWeightReach: 6,
  /** GAME TUNING: the outer skin ring -- how round (metres), how far out from the rim, how far its middle stands out of
   * her skin (a share of that), and how many Taubin passes even its loop */
  outerRound: 0.005, outerGap: 0.012, outerLift: 0.2, outerSmooth: 30,
  /** GAME TUNING: how many waves round itself the rim's and the outer ring's loops keep (fewer: smoother) */
  loopWaves: 5, wombWall: 0.003, wombMeet: 35, wallSkin: 0xa87060, wallPink: 0xc0646e, pleats: 4, pleatDepth: 0.22, cervix: 0.025, cervixShut: 0.006, womb: 0.13, wombRadius: 0.065,
  /** BIOLOGICAL SHAPE (Joshua's estimate, to tune): how far the area bulges out at the full opening (metres; a half sphere,
   * its last `bulgeFoot` share easing onto her skin), and how it
   * grows with the opening (power of the open share: 1 straight, more later) */
  bulge: 0.05, bulgeEase: 1.3, bulgeFoot: 0.6,
  /** GAME TUNING: passes evening the opening's edge round its outline */
  edgeSmooth: 6,
  /** GAME TUNING: how much the bear trap's corners at its hinges are rounded (0 a sharp lens, 1 an oval) */
  hingeRound: 0.3,
  /** GAME TUNING: how much more her skin is evened round the opening at its ends, where the jaws hinge, as it opens */
  hingeSmooth: 1.2,
  /** GAME TUNING: how much of the opening's skin her pelvis carries as it opens (the rest her own skin's bones) */
  pelvisCarry: 0,
  /** GAME TUNING: wide open, how many more Taubin passes even the rim round itself, over what share of the rings, and how
   * much of the way it is drawn to a circle (Joshua, 2026-11-01: "not an even circle... make it look closer to one") */
  rimPasses: 40, rimRings: 0.3, rimRound: 1,
  /**
   * THE LIPS (Joshua, 2026-10-31: "the vagina should look like the lips... you also have the mouth animated that can open
   * and close"): as her mouth is made -- her own skin, shaped round and opened, the inside painted where it shows. Each
   * outer lip a rounded rise `rise` metres high and `width` metres across beside the split, its edge `tuck` metres in
   * where the two meet (the groove), flattening `flatten` of the way as it stretches open; and from the edge in
   * `inner` metres her skin turns the colour of the inside (a tint on her own skin, as her lips' inner edge is),
   * darkest right at the edge. Its crest stands `crest` metres back from the edge; opening, the edge curls `roll` metres
   * on down into the opening, so the lip's inner face shows (see `lipHeight`)
   */
  rise: 0.015, crest: 0.006, width: 0.028, tuck: 0.0008, flatten: 0.55, inner: 0.005, roll: 0, maxTip: 1.2, edgeRound: 0.35, beadRise: 0.006, beadW: 0.008, beadAt: 0.4,
  /** shut, how much of the inside's colour shows at the line where the lips meet (0..1; all of it once open 15%) */
  shutInside: 0.3,
  innerTint: [1.0, 0.6, 0.64] as const, edgeTint: [0.78, 0.42, 0.48] as const,
});

export interface VulvaPatch {
  readonly mesh: THREE.SkinnedMesh;
  /** whether something is worn over it (see setDressed) */
  readonly dressed: boolean;
  /** how wide the opening is held to by her legs (metres across), or null when they do not hold it */
  readonly heldTo: number | null;
  /** worn over (her clothes, modelled or painted on her): drawn with her own material exactly, her painted clothes and
   * all, its lips lying as her skin does and closed; bare, its own colours and shape */
  setDressed(on: boolean): void;
  /** dressed: how much of its lips' shape shows through (0 her own skin's shape .. 1 all of it; VULVA DETAIL) */
  setDressedLips(keep: number): void;
  /**
   * HER WOMB, THE BALLOON'S TOP (Joshua, 2026-11-01: "the solid balloon skin that holds everything else in it"; "focus on
   * the tube to the cervix and womb first"): her womb as baby.ts lays it round the sac (rest metres) and the bone that
   * carries it. The canal curves from the opening to the womb's lowest point, the cervix closes and opens there, and the
   * balloon's top is the womb's own wall. Null: a bulb of its own.
   */
  setWomb(womb: WombShape | null, bone?: number): void;
  /** the womb's part of the balloon seen through (as her womb's wall is while her baby is shown) or solid */
  seeWomb(through: boolean): void;
  /** the tube inside (pink) */
  readonly tube: THREE.SkinnedMesh;
  /** the lips' soft sheet (VULVA_OPEN.sheet) */
  readonly sheet: THREE.SkinnedMesh;
  readonly bake: VulvaBake;
  /** read her shape (and her baby's push) back onto the area if either changed; true when it did */
  sync(): boolean;
  /** her own skin back (false) or the rebuilt area (true): for comparing the two */
  show(on: boolean): void;
  /** the rebuilt area's triangles drawn over it, for looking at the mesh itself */
  wire(on: boolean): void;
  /** how open (0 closed .. 1 a 10 cm circle, crowning): slit, then oval, then round, the area doming out round it */
  setOpen(open: number): void;
  /** how far her pose alone opens her (0..1; Joshua, 2026-11-02: "the vagina naturally opens about 15% in a squat and 30%
   * in a Recline, because the skin pulls it open"): she is open at least this much, whatever the slider says */
  setNatural(open: number): void;
  /** how far open she is drawn now (the larger of the slider's and her pose's) */
  readonly drawnOpen: number;
  readonly open: number;
  /** read her skin weights again (they changed: birthWeights.ts) */
  resyncWeights(): void;
  /** drawn even while her body is not (a probe's look at the area on its own) */
  solo: boolean;
  noTube?: boolean;
  debug(): Record<string, unknown>;
  /** where her split is now (world) and the way it faces (a camera's yaw and pitch to look straight at it) */
  facing(): { at: THREE.Vector3; yaw: number; pitch: number };
  /** the way the opening faces and the way its long axis runs, in the world, as she is posed now */
  worldAxes(): { faces: number[]; along: number[] };
  dispose(): void;
}

/** Her body's value at a patch point: Σ weight × hers (three a point, `src`/`bary` of the bake). */
function sampleInto(out: Float32Array, from: ArrayLike<number>, size: number, src: Uint32Array, bary: Float32Array, n: number): void {
  for (let p = 0; p < n; p++) {
    const a = src[p * 3] * size, b = src[p * 3 + 1] * size, c = src[p * 3 + 2] * size, wa = bary[p * 3], wb = bary[p * 3 + 1], wc = bary[p * 3 + 2];
    for (let k = 0; k < size; k++) out[p * size + k] = wa * from[a + k] + wb * from[b + k] + wc * from[c + k];
  }
}
/** An attribute as plain floats, one entry a vertex (a quantized or interleaved one read through getX..getW). */
function floatsOf(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  const n = attr.count, s = attr.itemSize, out = new Float32Array(n * s);
  for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) out[i * s + k] = attr.getComponent(i, k);
  return out;
}

/**
 * A closed loop of `n` points (three numbers each, in `loop`) made smooth by keeping only its first `harmonics` waves
 * round itself: whatever notches or corners it had, it comes back a smooth closed curve through their average.
 */
export function smoothLoop(loop: Float32Array, n: number, harmonics: number): void {
  const out = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) {
    for (let k = 0; k <= harmonics && k <= n / 2; k++) {
      let a = 0, b = 0;
      for (let j = 0; j < n; j++) { const t = (2 * Math.PI * k * j) / n, v = loop[j * 3 + c]; a += v * Math.cos(t); b += v * Math.sin(t); }
      a *= (k === 0 ? 1 : 2) / n; b *= (k === 0 ? 1 : 2) / n;
      for (let j = 0; j < n; j++) { const t = (2 * Math.PI * k * j) / n; out[j * 3 + c] += a * Math.cos(t) + b * Math.sin(t); }
    }
  }
  loop.set(out);
}

/**
 * Cut the area out of `body` and lay the rebuilt one on her. `basePos`: her rest shape as approved (geometry units, before
 * any field); `meshToRest`: her geometry to her rest frame (metres). Null when the area could not be found.
 */
export function createVulvaPatch(body: THREE.SkinnedMesh, basePos: Float32Array, meshToRest: THREE.Matrix4, pelvisBone?: number, thighBones: readonly number[] = [], legSkin?: (i: number) => boolean): VulvaPatch | null {
  const g = body.geometry as THREE.BufferGeometry, index = g.index;
  if (!index) return null;
  const n = basePos.length / 3, rest = new Float32Array(basePos.length), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) v.fromArray(basePos, i * 3).applyMatrix4(meshToRest).toArray(rest, i * 3);
  const centre = birthAreaCentre(rest);
  if (!centre) return null;
  // one key a point: her seams' two (or more) vertices at one place are one point
  const keyOf = new Map<string, number>(), key = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(basePos[i * 3] * 1e4)},${Math.round(basePos[i * 3 + 1] * 1e4)},${Math.round(basePos[i * 3 + 2] * 1e4)}`;
    let id = keyOf.get(k);
    if (id === undefined) { id = keyOf.size; keyOf.set(k, id); }
    key[i] = id;
  }
  const all = (body.userData.allIndices as ArrayLike<number> | undefined) ?? index.array;
  // HER LEGS ARE NOT THE AREA'S (Joshua, 2026-11-01: "the pubic and vagina area is separate and shouldn't be cutting into
  // the thighs and making holes in it"; "add a 1cm mask around the whole area"): a point of her skin `legSkin` names (her
  // leg's side of its leg opening, and 1 cm in from it) stays hers and is never taken into the area
  let legKeys: Uint8Array | undefined;
  if (legSkin) { legKeys = new Uint8Array(keyOf.size); for (let i = 0; i < n; i++) if (legSkin(i)) legKeys[key[i]] = 1; }
  const bake = bakeVulva(rest, key, all, centre, legKeys);
  if (bake.count === 0 || bake.index.length === 0) return null;
  const P = bake.count;

  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(P * 3), nrm = new Float32Array(P * 3);
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  // her texture, from the piece of it each point is in
  const uvAttr = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (uvAttr) { const uv = new Float32Array(P * 2); sampleInto(uv, floatsOf(uvAttr), 2, bake.uvSrc, bake.uvBary, P); geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
  // her bones: the three points' weights summed, the four strongest kept
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  /** her weights sampled where each point lies (again whenever hers change: birthWeights.ts) */
  const sampleSkin = (outI: Uint16Array, outW: Float32Array) => {
    if (!si || !sw) return;
    const I = floatsOf(si), W = floatsOf(sw), acc = new Map<number, number>();
    outI.fill(0); outW.fill(0);
    for (let p = 0; p < P; p++) {
      acc.clear();
      for (let k = 0; k < 3; k++) {
        const s = bake.src[p * 3 + k], b = bake.bary[p * 3 + k];
        if (b <= 0) continue;
        for (let j = 0; j < 4; j++) { const w = W[s * 4 + j]; if (w > 0) acc.set(I[s * 4 + j], (acc.get(I[s * 4 + j]) ?? 0) + b * w); }
      }
      const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((m, [, w]) => m + w, 0) || 1;
      top.forEach(([bone, w], j) => { outI[p * 4 + j] = bone; outW[p * 4 + j] = w / sum; });
    }
  };
  if (si && sw) {
    const outI = new Uint16Array(P * 4), outW = new Float32Array(P * 4);
    sampleSkin(outI, outW);
    geom.setAttribute('skinIndex', new THREE.BufferAttribute(outI, 4));
    geom.setAttribute('skinWeight', new THREE.BufferAttribute(outW, 4));
  }
  // EVERYTHING ELSE HER SKIN CARRIES, read back the same way and kept live (Joshua, 2026-10-31: the leggings looked
  // ripped -- "we should have it automatically use the latest skin in real time"). Her default leggings are PAINTED on
  // her skin (fabricMaterial.ts: fabricPaint, fabricRest, ...); the area carries the paint as her skin does, read
  // through her texture's own copies of each point, and read again whenever one of them changes.
  const OWN = new Set(['position', 'normal', 'uv', 'skinIndex', 'skinWeight', 'color', JIGGLE_ATTRIBUTE, PUSH_ATTRIBUTE]);
  const extras: { name: string; from: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; version: number }[] = [];
  const readExtras = (): boolean => {
    let changed = false;
    for (const [name, a] of Object.entries(g.attributes)) {
      if (OWN.has(name) || name.startsWith('_')) continue;
      let e = extras.find((x) => x.name === name);
      const version = (a as THREE.BufferAttribute).version ?? 0;
      if (e && e.from === a && e.version === version) continue;
      const out = new Float32Array(P * a.itemSize);
      sampleInto(out, floatsOf(a), a.itemSize, bake.uvSrc, bake.uvBary, P);
      geom.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
      if (!e) { e = { name, from: a, version }; extras.push(e); } else { e.from = a; e.version = version; }
      changed = true;
    }
    return changed;
  };
  readExtras();
  // her springs (softBody.ts): the belly's and breasts' weights, and her baby's push, read back with her shape
  const jig = g.getAttribute(JIGGLE_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  if (jig) { const j = new Float32Array(P * 3); sampleInto(j, jig.array, 3, bake.src, bake.bary, P); geom.setAttribute(JIGGLE_ATTRIBUTE, new THREE.BufferAttribute(j, 3)); }
  const pushOf = () => g.getAttribute(PUSH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
  const push = new Float32Array(P * 3);
  if (pushOf()) geom.setAttribute(PUSH_ATTRIBUTE, new THREE.BufferAttribute(push, 3));
  // her motion shapes still on the GPU (her belly, her breasts...), sampled the same way
  for (const kind of ['position', 'normal'] as const) {
    const list = g.morphAttributes[kind];
    if (!list?.length) continue;
    geom.morphAttributes[kind] = list.map((m) => { const out = new Float32Array(P * 3); sampleInto(out, floatsOf(m), 3, bake.src, bake.bary, P); return new THREE.BufferAttribute(out, 3); });
  }
  geom.morphTargetsRelative = g.morphTargetsRelative;
  geom.setIndex(new THREE.BufferAttribute(bake.index, 1));

  // her material, copied so the area can carry its own colour (the lips' inside); kept in step with hers every frame
  const bodyMat = (Array.isArray(body.material) ? body.material[0] : body.material) as THREE.MeshStandardMaterial;
  // (her own material's shader is at the limit of what a vertex may carry; the area's is hers without the clothing it
  // never wears there, her springs kept so it moves with her skin round it)
  const patchMat = bodyMat.clone();
  patchMat.onBeforeCompile = () => {};
  patchMat.customProgramCacheKey = () => 'vulvaPatch';
  patchMat.vertexColors = true;
  const jigU = (body.userData as { jiggle?: { uniforms: Parameters<typeof patchJiggle>[1] } }).jiggle?.uniforms;
  if (jigU) patchJiggle(patchMat, jigU);
  // DRESSED, hers exactly -- every patch her own material carries (her painted clothes, her springs, her birth shade),
  // sharing its uniforms -- and no colour of the area's own: what is painted on her skin is painted on the area too
  const dressedMat = bodyMat.clone();
  dressedMat.onBeforeCompile = bodyMat.onBeforeCompile;
  dressedMat.customProgramCacheKey = bodyMat.customProgramCacheKey;
  dressedMat.vertexColors = false;
  const keepMat = () => {
    for (const mat of [patchMat, dressedMat]) {
      const a = mat as unknown as Record<string, unknown>, b = bodyMat as unknown as Record<string, unknown>;
      let changed = false;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'roughness', 'metalness', 'transparent', 'opacity', 'depthWrite', 'visible', 'side', 'wireframe']) if (a[k] !== b[k]) { a[k] = b[k]; changed = true; }
      if (!mat.color.equals(bodyMat.color)) { mat.color.copy(bodyMat.color); changed = true; }
      // her own material is patched again as she changes (a new garment painted on): the dressed one follows it
      if (mat === dressedMat && (dressedMat.onBeforeCompile !== bodyMat.onBeforeCompile || dressedMat.customProgramCacheKey !== bodyMat.customProgramCacheKey)) {
        dressedMat.onBeforeCompile = bodyMat.onBeforeCompile; dressedMat.customProgramCacheKey = bodyMat.customProgramCacheKey; changed = true;
      }
      if (changed) mat.needsUpdate = true;
    }
  };
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(P * 3).fill(1), 3));
  const mesh = new THREE.SkinnedMesh(geom, patchMat);
  mesh.name = 'sarahVulva';
  mesh.frustumCulled = false;
  mesh.castShadow = body.castShadow; mesh.receiveShadow = body.receiveShadow;
  mesh.position.copy(body.position); mesh.quaternion.copy(body.quaternion); mesh.scale.copy(body.scale);
  mesh.morphTargetDictionary = body.morphTargetDictionary;
  mesh.morphTargetInfluences = body.morphTargetInfluences;
  mesh.bind(body.skeleton, body.bindMatrix);
  mesh.userData.noGhost = false;
  body.parent?.add(mesh);
  // her body draws everything but the area
  const keep = bake.keep, full = Uint32Array.from(all);
  body.userData.allIndices = keep;
  g.setIndex(new THREE.BufferAttribute(Uint32Array.from(keep), 1));
  body.userData.coverMask = undefined;

  // ---- THE OPENING (Joshua's hoop, 2026-10-30): the split is the flattened end of a tube; opening it goes slit, oval,
  // round, the area domes out round it (his photos of crowning), and the tube runs on inside, pink.
  const M = bake.outline;
  let R = 0;
  for (let p = 0; p < P; p++) R = Math.max(R, bake.ring[p]);
  /** one vertex for each ring and column (any of a point's copies: they share the place) */
  const base: Int32Array = new Int32Array((R + 1) * M).fill(-1);
  for (let p = 0; p < P; p++) { const k = bake.ring[p] * M + bake.column[p]; if (base[k] < 0) base[k] = p; }
  /** each vertex: how far out along its column (0 the split, 1 her own skin at the edge), by distance laid out flat */
  const tau = new Float32Array(P);
  {
    const along = new Float32Array((R + 1) * M);
    for (let j = 0; j < M; j++) for (let k = 1; k <= R; k++) {
      const a = base[(k - 1) * M + j], b = base[k * M + j];
      along[k * M + j] = along[(k - 1) * M + j] + Math.hypot(bake.flat[a * 2] - bake.flat[b * 2], bake.flat[a * 2 + 1] - bake.flat[b * 2 + 1]);
    }
    for (let p = 0; p < P; p++) { const j = bake.column[p], total = along[R * M + j] || 1; tau[p] = along[bake.ring[p] * M + j] / total; }
  }
  /** each column: where along the split it starts (-1 the back tip .. 1 the front tip) and which side it opens to */
  const colQ = new Float32Array(M), colSide = new Int8Array(M);
  const sp = bake.split;
  for (let j = 0; j < M; j++) {
    const v = base[j], sv = bake.flat[v * 2 + 1];
    colQ[j] = sv >= sp.mid ? (sv - sp.mid) / (sp.front - sp.mid || 1) : (sv - sp.mid) / (sp.mid - sp.back || 1);
    colSide[j] = bake.lip[v];
  }
  // her rest frame's directions and size, in her geometry's units
  const lin = new THREE.Matrix3().setFromMatrix4(meshToRest), inv = lin.clone().invert();
  const across = new THREE.Vector3(1, 0, 0).applyMatrix3(inv).normalize();
  const perMetre = new THREE.Vector3(1, 0, 0).applyMatrix3(inv).length();
  const restPos = new Float32Array(P * 3), restNrm = new Float32Array(P * 3);
  let open = 0, openApplied = -1, wantOpen = 0, naturalOpen = 0, dressed = false, dressedLips = 0;

  // CARRIED BY HER PELVIS as it opens. Her skin there is weighted to her pelvis and both thighs, so a move laid on it in
  // her rest shape is turned by her thighs as well as her pelvis once she is posed -- every birth pose turns her thighs
  // a long way, and the two sides of an open ring went two ways. So the move is laid on in her PELVIS's frame: each
  // frame, a point's rest move is put through the inverse of its own bones' turn and then its pelvis's (her skin keeps
  // its own weights; closed, nothing moves and nothing is computed). The tube hangs from her pelvis alone.
  const skI = geom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, skW = geom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
  let pelvis = 0;
  if (pelvisBone !== undefined && pelvisBone >= 0) pelvis = pelvisBone;
  else if (skI && skW) {
    let jm = 0;
    for (let j = 0; j < M; j++) if (Math.abs(colQ[j]) < Math.abs(colQ[jm])) jm = j;
    let best = -1;
    for (let c = 0; c < 4; c++) if (skW.getComponent(base[jm], c) > best) { best = skW.getComponent(base[jm], c); pelvis = skI.getComponent(base[jm], c); }
  }
  /** the opening as laid on her rest shape: the area's points, its normals, how much each moved (0..1), the tube's points */
  const want = new Float32Array(P * 3), wantNrm = new Float32Array(P * 3), moved = new Float32Array(P);
  // the tube: one ring of points per column, from the split inward (carried by her pelvis alone)
  // (rings: the mouth's bead, the canal, the cervix, the womb -- one closed skin)
  // (rings: her lips' inner walls and the balloon's bead inside them, the canal, the cervix, the womb -- one closed skin)
  const KL = 4, KB = KL + 7, KC = 16, KX = 6, KW = 12, K = KB + KC + KX + KW, TV = K * M, tubeWant = new Float32Array(TV * 3);
  const tubeGeom = new THREE.BufferGeometry(), tubePos = new Float32Array(TV * 3);
  tubeGeom.setAttribute('position', new THREE.BufferAttribute(tubePos, 3));
  tubeGeom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TV * 3), 3));
  // darker the deeper in (no light reaches far down a canal): ring by ring from the mouth
  { const col = new Float32Array(TV * 3);
    // (the bead its own lighter pink, as the lips' inner edge; then darker down the canal, darkest past her cervix)
    // (her lips' inner walls start as her skin at their rounded edge and turn pink going in, as in Joshua's reference; the
    // balloon's bead a soft pink; then the canal's own colour, darker down it, darkest past her cervix)
    const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const skinC = new THREE.Color(VULVA_OPEN.wallSkin), pinkC = new THREE.Color(VULVA_OPEN.wallPink), canalC = new THREE.Color(0xa8505a), c3 = new THREE.Color();
    for (let m = 0; m < K; m++) {
      // (the rolled rim: her skin's colour where it comes out from under her skin, pink from over its top on in)
      if (m < KB) c3.copy(skinC).lerp(pinkC, ss(0.25, 0.55, m / (KB - 1)));
      else { const f = (m - KB) / (K - 1 - KB); c3.copy(pinkC).lerp(canalC, ss(0, 0.15, f)).multiplyScalar(1 - 0.75 * Math.pow(Math.min(1, f * 1.6), 0.7)); }
      for (let j = 0; j < M; j++) { const o = (m * M + j) * 3; col[o] = c3.r; col[o + 1] = c3.g; col[o + 2] = c3.b; }
    }
    tubeGeom.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  {
    const pi = geom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, pw = geom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (pi && pw) {
      const ti = new Uint16Array(TV * 4), tw = new Float32Array(TV * 4);
      for (let q = 0; q < TV; q++) { ti[q * 4] = pelvis; tw[q * 4] = 1; }
      tubeGeom.setAttribute('skinIndex', new THREE.BufferAttribute(ti, 4)); tubeGeom.setAttribute('skinWeight', new THREE.BufferAttribute(tw, 4));
    }
    for (const kind of ['position', 'normal'] as const) {
      const list = geom.morphAttributes[kind];
      if (!list?.length) continue;
      tubeGeom.morphAttributes[kind] = list.map((ma) => { const out = new Float32Array(TV * 3); for (let m = 0; m < K; m++) for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) out[(m * M + j) * 3 + c] = kind === 'position' ? ma.getComponent(base[j], c) : 0; return new THREE.BufferAttribute(out, 3); });
    }
    tubeGeom.morphTargetsRelative = geom.morphTargetsRelative;
    const ti: number[] = [];
    for (let m = 0; m + 1 < K; m++) for (let j = 0; j < M; j++) { const j2 = (j + 1) % M, a = m * M + j, b = m * M + j2, c = (m + 1) * M + j, d = (m + 1) * M + j2; ti.push(a, c, b, b, c, d); }
    tubeGeom.setIndex(ti);
    // (two parts: the canal and cervix, and the womb -- which is seen through while her baby is shown)
    const split = (KB + KC + KX - 1) * M * 6;
    tubeGeom.addGroup(0, split, 0); tubeGeom.addGroup(split, ti.length - split, 1);
  }
  const tubeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, vertexColors: true, envMapIntensity: 0.35 });
  const wombMat = tubeMat.clone();
  const tube = new THREE.SkinnedMesh(tubeGeom, [tubeMat, wombMat]);
  tube.name = 'sarahVagina';
  tube.frustumCulled = false; tube.castShadow = false; tube.receiveShadow = body.receiveShadow;
  tube.position.copy(body.position); tube.quaternion.copy(body.quaternion); tube.scale.copy(body.scale);
  tube.morphTargetDictionary = body.morphTargetDictionary; tube.morphTargetInfluences = body.morphTargetInfluences;
  tube.bind(body.skeleton, body.bindMatrix);
  body.parent?.add(tube);
  // ---- THE LIPS' SHEET (VULVA_OPEN.sheet): NS points across each column, from her skin over the lip into the opening
  // (its own grid: for each lip NRW rows along her split, hinge to hinge, each NS points straight across it -- 2026-11-01:
  // built on the area's columns, which fan out from her split, it zig-zagged)
  const NO = 9, NN = 9, NI = 3, NS = NO + NN + NI, NRW = 28, SV = 2 * NRW * NS;
  const sheetGeom = new THREE.BufferGeometry(), sheetPos = new Float32Array(SV * 3), sheetWant = new Float32Array(SV * 3);
  sheetGeom.setAttribute('position', new THREE.BufferAttribute(sheetPos, 3));
  sheetGeom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(SV * 3), 3));
  const sheetUv = new Float32Array(SV * 2), sheetCol = new Float32Array(SV * 3).fill(1);
  if (geom.getAttribute('uv')) sheetGeom.setAttribute('uv', new THREE.BufferAttribute(sheetUv, 2));
  sheetGeom.setAttribute('color', new THREE.BufferAttribute(sheetCol, 3));
  const sheetI = new Uint16Array(SV * 4), sheetW = new Float32Array(SV * 4);
  if (skI && skW) { sheetGeom.setAttribute('skinIndex', new THREE.BufferAttribute(sheetI, 4)); sheetGeom.setAttribute('skinWeight', new THREE.BufferAttribute(sheetW, 4)); }
  if (geom.getAttribute(JIGGLE_ATTRIBUTE)) sheetGeom.setAttribute(JIGGLE_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(SV * 3), 3));
  if (geom.getAttribute(PUSH_ATTRIBUTE)) sheetGeom.setAttribute(PUSH_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(SV * 3), 3));
  for (const kind of ['position', 'normal'] as const) {
    const list = geom.morphAttributes[kind];
    if (list?.length) sheetGeom.morphAttributes[kind] = list.map(() => new THREE.BufferAttribute(new Float32Array(SV * 3), 3));
  }
  sheetGeom.morphTargetsRelative = geom.morphTargetsRelative;
  { const ti: number[] = [];
    for (let sd = 0; sd < 2; sd++) for (let r = 0; r + 1 < NRW; r++) for (let a = 0; a + 1 < NS; a++) {
      const at = (rr: number, aa: number) => (sd * NRW + rr) * NS + aa, p0 = at(r, a), p1 = at(r + 1, a), p2 = at(r, a + 1), p3 = at(r + 1, a + 1);
      ti.push(p0, p2, p1, p1, p2, p3);
    }
    sheetGeom.setIndex(ti); }
  const sheetMat = patchMat.clone();
  sheetMat.customProgramCacheKey = () => 'vulvaSheet';
  sheetMat.side = THREE.DoubleSide; sheetMat.polygonOffset = true; sheetMat.polygonOffsetFactor = -1; sheetMat.polygonOffsetUnits = -1;
  if (jigU) patchJiggle(sheetMat, jigU);
  const sheet = new THREE.SkinnedMesh(sheetGeom, sheetMat);
  sheet.name = 'sarahLips';
  sheet.frustumCulled = false; sheet.castShadow = body.castShadow; sheet.receiveShadow = body.receiveShadow;
  sheet.position.copy(body.position); sheet.quaternion.copy(body.quaternion); sheet.scale.copy(body.scale);
  sheet.morphTargetDictionary = body.morphTargetDictionary; sheet.morphTargetInfluences = body.morphTargetInfluences;
  sheet.bind(body.skeleton, body.bindMatrix);
  body.parent?.add(sheet);
  // ---- THE OUTER SKIN RING (Joshua, 2026-11-02: "create another smoother ring the same skin color on the outside so it's
  // like: outside, outer skin ring; middle, body skin; inner, the pink balloon ring"): a soft round roll of her own skin
  // laid on her a little way out from the opening, round a smoothed loop, so the skin between it and the balloon's rim is
  // framed by two smooth rolls whatever its own triangles do. Her own material and texture.
  const KO = 10, OV = KO * M;
  const outerGeom = new THREE.BufferGeometry(), outerPos = new Float32Array(OV * 3);
  outerGeom.setAttribute('position', new THREE.BufferAttribute(outerPos, 3));
  outerGeom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(OV * 3), 3));
  const outerUv = new Float32Array(OV * 2);
  if (geom.getAttribute('uv')) outerGeom.setAttribute('uv', new THREE.BufferAttribute(outerUv, 2));
  outerGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(OV * 3).fill(1), 3));
  const outerI = new Uint16Array(OV * 4), outerW = new Float32Array(OV * 4);
  if (skI && skW) { outerGeom.setAttribute('skinIndex', new THREE.BufferAttribute(outerI, 4)); outerGeom.setAttribute('skinWeight', new THREE.BufferAttribute(outerW, 4)); }
  if (geom.getAttribute(JIGGLE_ATTRIBUTE)) outerGeom.setAttribute(JIGGLE_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(OV * 3), 3));
  if (geom.getAttribute(PUSH_ATTRIBUTE)) outerGeom.setAttribute(PUSH_ATTRIBUTE, new THREE.BufferAttribute(new Float32Array(OV * 3), 3));
  for (const kind of ['position', 'normal'] as const) {
    const list = geom.morphAttributes[kind];
    if (list?.length) outerGeom.morphAttributes[kind] = list.map(() => new THREE.BufferAttribute(new Float32Array(OV * 3), 3));
  }
  outerGeom.morphTargetsRelative = geom.morphTargetsRelative;
  { const ti: number[] = [];
    for (let a = 0; a + 1 < KO; a++) for (let j = 0; j < M; j++) { const j2 = (j + 1) % M, p0 = a * M + j, p1 = a * M + j2, p2 = (a + 1) * M + j, p3 = (a + 1) * M + j2; ti.push(p0, p2, p1, p1, p2, p3); }
    outerGeom.setIndex(ti); }
  const outerMat = patchMat.clone();
  outerMat.customProgramCacheKey = () => 'vulvaOuter';
  outerMat.side = THREE.DoubleSide;
  if (jigU) patchJiggle(outerMat, jigU);
  const outer = new THREE.SkinnedMesh(outerGeom, outerMat);
  outer.name = 'sarahOuterRing';
  outer.frustumCulled = false; outer.castShadow = body.castShadow; outer.receiveShadow = body.receiveShadow;
  outer.position.copy(body.position); outer.quaternion.copy(body.quaternion); outer.scale.copy(body.scale);
  outer.morphTargetDictionary = body.morphTargetDictionary; outer.morphTargetInfluences = body.morphTargetInfluences;
  outer.bind(body.skeleton, body.bindMatrix);
  body.parent?.add(outer);
  let outerLaid = false;
  const outerSrc = new Int32Array(M);
  /** each sheet point: the two of the area's points it lies between (its foot, the opening's edge) and how far (0 foot .. 1 edge) */
  const sheetFrom = new Int32Array(SV), sheetTo = new Int32Array(SV), sheetF = new Float32Array(SV), sheetFootN = new Float32Array(2 * NRW * 3);

  const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const O = new THREE.Vector3(), tA = new THREE.Vector3(), nO = new THREE.Vector3(), vv = new THREE.Vector3();
  const rim = new Float32Array(M * 3);
  // her body's weights (read again when they change) and the area's own, kept to come back to
  let bodyI: Float32Array | null = null, bodyW: Float32Array | null = null, bodySkinVersion = -1;
  const patchI = skI ? (skI.array as Uint16Array) : null, patchW = skW ? (skW.array as Float32Array) : null;
  let ownPI = patchI ? Uint16Array.from(patchI) : null, ownPW = patchW ? Float32Array.from(patchW) : null;
  const readBodySkin = () => {
    if (!si || !sw) return;
    if (bodyI && sw.version === bodySkinVersion) return;
    bodySkinVersion = sw.version; bodyI = floatsOf(si); bodyW = floatsOf(sw);
  };
  const wAcc = new Map<number, number>();
  /** the area's point p carried as her skin is at the place `at` (three of her vertices, three weights) */
  const weightsAt = (p: number, at: Float64Array) => {
    if (!patchI || !patchW || !bodyI || !bodyW) return;
    wAcc.clear();
    for (let k = 0; k < 3; k++) {
      const v = at[k], b = at[3 + k];
      if (b <= 0) continue;
      for (let j = 0; j < 4; j++) { const w = bodyW[v * 4 + j]; if (w > 0) wAcc.set(bodyI[v * 4 + j], (wAcc.get(bodyI[v * 4 + j]) ?? 0) + b * w); }
    }
    const top = [...wAcc].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((m, [, w]) => m + w, 0) || 1;
    for (let j = 0; j < 4; j++) { patchI[p * 4 + j] = top[j]?.[0] ?? 0; patchW[p * 4 + j] = top[j] ? top[j][1] / sum : 0; }
  };
  // ---- the layout's scale (its units a metre, across and along the split), measured once on her rest shape
  let uScale = 1, sScale = 1, scaled = false, painted = false;
  /** each column's length over her rest skin from the split, ring by ring (metres), measured once */
  let colMetres: Float32Array | null = null;
  /** the opening's width held back by her legs (metres across), or null when it is not */
  let heldTo: number | null = null, blocker: number[] = [], bulgeNow = 0, lipMax = 0, lipCount = 0;
  /** her skin near the area that her thighs carry now (vertices), worked out again when her weights change */
  let legNear: number[] = [], legNearVersion = -1;
  const findLegNear = () => {
    const w = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined, ix = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
    if (!w || !ix || !thighBones.length || w.version === legNearVersion) return;
    legNearVersion = w.version; legNear = [];
    const cy = (restPos[base[0] * 3 + 1]), mid = new THREE.Vector3();
    void cy;
    { let jm0 = 0; for (let j = 0; j < M; j++) if (Math.abs(colQ[j]) < Math.abs(colQ[jm0])) jm0 = j; mid.fromArray(rest, bake.src[base[jm0] * 3] * 3); }
    for (let i = 0; i < rest.length / 3; i++) {
      const dx = rest[i * 3] - mid.x, dy = rest[i * 3 + 1] - mid.y, dz = rest[i * 3 + 2] - mid.z;
      if (dx * dx + dy * dy + dz * dz > 0.18 * 0.18) continue;
      // (one leg's: skin her two thighs share is her middle, not a leg)
      let tl = 0, tr = 0;
      for (let c = 0; c < 4; c++) { const b = ix.getComponent(i, c), k = thighBones.indexOf(b); if (k < 0) continue; if (k % 2 === 0) tl += w.getComponent(i, c); else tr += w.getComponent(i, c); }
      // (and her skin kept out of the area as a leg's, `legSkin`: the opening keeps off all of it)
      if (Math.max(tl, tr) >= VULVA_OPEN.legWeight || legKeys?.[key[i]]) legNear.push(i);
    }
  };
  const measureScale = () => {
    if (scaled) return;
    scaled = true;
    let jl = -1, jb = 0, jf = 0;
    for (let j = 0; j < M; j++) { if (colSide[j] > 0 && (jl < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jl]))) jl = j; if (colQ[j] < colQ[jb]) jb = j; if (colQ[j] > colQ[jf]) jf = j; }
    const metres = (a: number, c: number) => Math.hypot(restPos[a * 3] - restPos[c * 3], restPos[a * 3 + 1] - restPos[c * 3 + 1], restPos[a * 3 + 2] - restPos[c * 3 + 2]) / perMetre;
    if (jl >= 0) { const k = Math.max(1, Math.round(R / 3)), a = base[jl], c = base[k * M + jl], m = metres(a, c); if (m > 1e-5) uScale = Math.hypot(bake.flat[a * 2] - bake.flat[c * 2], bake.flat[a * 2 + 1] - bake.flat[c * 2 + 1]) / m; }
    { const a = base[jb], c = base[jf], m = metres(a, c); if (m > 1e-5) sScale = Math.abs(bake.flat[a * 2 + 1] - bake.flat[c * 2 + 1]) / m; }
  };
  // ---- each point's distance from its lip's edge (metres, laid out flat), and its colour
  const edgeDist = new Float32Array(P);
  const colors = (geom.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
  let paintedAt = -1;
  const paintLips = () => {
    const L = VULVA_OPEN;
    // (shut, her lips meet skin to skin and only a thread of the inside shows at the line between them; the inside's
    // colour comes out with the opening -- Joshua, 2026-11-01: shut "sucks inward and it needs to go outside")
    const showing = L.shutInside + (1 - L.shutInside) * smooth(0, 0.15, open);
    for (let p = 0; p < P; p++) {
      // (measured over her rest skin along its column from the split, metres -- not through the flat layout, whose scale
      // is only as good as the area's outline: 2026-11-01, an outline notched by her thighs' mask read every point as
      // within 2 cm of the edge, and the lips rose as one flat plateau over the whole area)
      const r0 = base[bake.column[p]];
      const d = colMetres ? colMetres[bake.ring[p] * M + bake.column[p]] : Math.hypot(bake.flat[p * 2] - bake.flat[r0 * 2], bake.flat[p * 2 + 1] - bake.flat[r0 * 2 + 1]) / (uScale || 1);
      edgeDist[p] = d;
      const inner = smooth(L.inner * showing, 0, d) * showing, edge = smooth(L.inner * 0.35 * showing, 0, d) * showing;
      for (let c = 0; c < 3; c++) colors[p * 3 + c] = 1 + (L.innerTint[c] - 1) * inner + (L.edgeTint[c] - L.innerTint[c]) * edge;
    }
    const ca = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (ca) ca.needsUpdate = true;
  };
  const before = new Float32Array(P * 3);
  /** the lips' shape laid on `at` (along `n`), and `n` turned as the surface turned */
  /**
   * THE LIP'S PROFILE (Joshua's marked-up reference, 2026-10-31: "The skin is outwards like lips... almost look like
   * real lips or a mouth with no teeth"): how far out of her skin (metres) a point stands at `d` metres from the lip's
   * edge. A rounded crest `crest` metres back from the edge stands `rise` proud; behind it the lip falls away to her
   * skin by `width`; in front of it the lip rounds over (a quarter round) down to its edge. Closed, the edges tuck into
   * the groove the two crests make; opening, the edge curls on down into the opening, so the lip's inner face shows.
   */
  const lipHeight = (d: number, q: number, t: number): number => {
    const L = VULVA_OPEN, c = L.crest, H = L.rise * (1 - L.flatten * smooth(0.3, 1, open));
    const taper = Math.pow(Math.max(0, 1 - q * q), 0.35) * smooth(1, 0.7, t);
    let h = 0;
    if (d >= L.width) h = 0;
    else if (d >= c) { const u = (d - c) / (L.width - c); h = H * Math.cos((Math.PI / 2) * u) ** 2; }
    // (in front of the crest a flat top, and in its last `edgeRound` of the lip's height a rounded edge, standing out of her
    // skin: shut, the two lips meet as two rounded pillows -- Joshua, 2026-11-01: "the vagina lips when close should still
    // offset out some... it appears like 0% close sucks inward and it needs to go outside with that rounded edge")
    else { const r = Math.min(c, H * L.edgeRound); h = d >= r ? H : H - r + Math.sqrt(Math.max(0, r * r - (r - d) ** 2)); }
    // THE ROLLED EDGE (Joshua, 2026-11-01, of his photographs of a balloon's mouth open, half open and shut: "the skin
    // folding over (inside/outside) as that slightly thicker edge"; "try the roll like the balloon lip look"): along the
    // lip's very edge a round bead `beadRise` high and `beadW` across, its middle `beadAt` of its width in from the edge so
    // the edge itself is already turning down into the opening, where the canal's wall rolls on. It stays as the lip
    // stretches flatter, so open or shut the edge is one smooth thick roll.
    const bw = L.beadW, bc = bw * L.beadAt, br = bw - bc, bx = (d - bc) / br;
    const bead = d < bw ? L.beadRise * Math.sqrt(Math.max(0, 1 - bx * bx)) : 0;
    h = Math.max(h, bead);
    h *= taper;
    const closed = 1 - smooth(0, 0.3, open), opening = smooth(0, 0.15, open);
    const tuck = L.tuck * smooth(c, 0, d) * closed * taper;
    const curl = L.roll * (1 - d / c) ** 2 * (d < c ? 1 : 0) * opening * smooth(1, 0.6, t);
    return h - tuck - curl;
  };
  const sculptLips = (at: Float32Array, n: Float32Array) => {
    // dressed, as much of the lips' shape as shows through what is over them (VULVA DETAIL: 0 her own skin's shape
    // exactly, 1 all of it); what is painted on her lies over it as it does on the rest of her
    const amp = dressed ? dressedLips : (VULVA_OPEN.sheet ? 0 : 1);
    lipMax = 0; lipCount = 0;
    if (amp <= 0) return;
    const L = VULVA_OPEN;
    before.set(at);
    const away = new THREE.Vector3(), nn = new THREE.Vector3(), eps = 0.0005;
    for (let p = 0; p < P; p++) {
      const d = edgeDist[p], j = bake.column[p], q = Math.max(-1, Math.min(1, colQ[j]));
      if (d > L.width * 1.2 || tau[p] >= 1) continue;
      const h = amp * lipHeight(d, q, tau[p]);
      // shaded as shaped: her normal tipped by the profile's slope, away from the edge along her skin
      // (the round-over is upright at the very edge; its shading tipped at most this far, so the edge does not turn
      // side-on to the light and flash)
      const slope = Math.max(-L.maxTip, Math.min(L.maxTip, amp * (lipHeight(d + eps, q, tau[p]) - lipHeight(Math.max(0, d - eps), q, tau[p])) / (d > eps ? 2 * eps : d + eps)));
      const r = bake.ring[p], a = base[Math.max(0, r - 1) * M + j], c2 = base[Math.min(R, r + 1) * M + j];
      nn.fromArray(n, p * 3);
      if (a >= 0 && c2 >= 0 && a !== c2) {
        away.set(before[c2 * 3] - before[a * 3], before[c2 * 3 + 1] - before[a * 3 + 1], before[c2 * 3 + 2] - before[a * 3 + 2]);
        away.addScaledVector(nn, -away.dot(nn));
        if (away.lengthSq() > 1e-14) { away.normalize(); nn.addScaledVector(away, -slope).normalize(); }
      }
      const lift = h * perMetre; lipMax = Math.max(lipMax, h); lipCount++;
      at[p * 3] += n[p * 3] * lift; at[p * 3 + 1] += n[p * 3 + 1] * lift; at[p * 3 + 2] += n[p * 3 + 2] * lift;
      n[p * 3] = nn.x; n[p * 3 + 1] = nn.y; n[p * 3 + 2] = nn.z;
    }
  };
  /** the lips' sheet laid over the area as it lies now (`at`, `an`: the area's points and normals, laid out) */
  function laySheet(at: Float32Array, an: Float32Array, _cm: Float32Array): void {
    void _cm;
    const L = VULVA_OPEN, A = new THREE.Vector3(), B = new THREE.Vector3(), n = new THREE.Vector3(), t = new THREE.Vector3(), q = new THREE.Vector3(), w = new THREE.Vector3();
    // the opening's frame as it lies now: its middle, along her split (back to front), across it, out of her
    const C = new THREE.Vector3(); for (let j = 0; j < M; j++) C.x += at[base[j] * 3] / M, C.y += at[base[j] * 3 + 1] / M, C.z += at[base[j] * 3 + 2] / M;
    const along = tA.clone().normalize(), out = nO.clone().normalize(), side = new THREE.Vector3().crossVectors(out, along).normalize();
    if (side.dot(across) < 0) side.negate();
    // each lip's edge: the rim points on its side, by where they are along her split (the hinges, its two ends, shared)
    let sMin = Infinity, sMax = -Infinity;
    const sOf = new Float32Array(M);
    for (let j = 0; j < M; j++) { sOf[j] = w.fromArray(at, base[j] * 3).sub(C).dot(along); sMin = Math.min(sMin, sOf[j]); sMax = Math.max(sMax, sOf[j]); }
    const sides: number[][] = [[], []];
    // (the two ends of the opening along her split are both lips' -- the hinges -- so each lip runs the whole way: picked
    // by where her split's tips were, a wide opening's ends were not its tips, and a lip stopped short in a fan)
    let jLo = 0, jHi = 0;
    for (let j = 0; j < M; j++) { if (sOf[j] < sOf[jLo]) jLo = j; if (sOf[j] > sOf[jHi]) jHi = j; }
    for (let j = 0; j < M; j++) { const u = w.fromArray(at, base[j] * 3).sub(C).dot(side); if (j === jLo || j === jHi) { sides[0].push(j); sides[1].push(j); } else sides[u >= 0 ? 0 : 1].push(j); }
    for (const l of sides) l.sort((a, b) => sOf[a] - sOf[b]);
    // (each lip's rows are spaced evenly along its edge, not along her split: round a wide opening the edge runs nearly
    // across her split at its ends, and rows spaced by the split left one long triangle across the hole there)
    const arcs = sides.map((l) => { const c = new Float32Array(l.length); for (let k = 1; k < l.length; k++) c[k] = c[k - 1] + w.fromArray(at, base[l[k - 1]] * 3).distanceTo(q.fromArray(at, base[l[k]] * 3)); return c; });
    const rimAt = (sd: number, u: number, o: THREE.Vector3): number => {
      const l = sides[sd], c = arcs[sd];
      if (!l.length) { o.copy(C); return base[0]; }
      const want = u * c[c.length - 1];
      for (let k = 1; k < l.length; k++) if (want <= c[k]) {
        const a = l[k - 1], b = l[k], f = (want - c[k - 1]) / Math.max(1e-9, c[k] - c[k - 1]);
        o.fromArray(at, base[a] * 3).lerp(w.fromArray(at, base[b] * 3), f); return f < 0.5 ? base[a] : base[b];
      }
      o.fromArray(at, base[l[l.length - 1]] * 3); return base[l[l.length - 1]];
    };
    // her skin under a point: the area's nearest point to it, seen square on to the opening (the area is fine: mm apart)
    const nearestOn = (target: THREE.Vector3): number => {
      let best = 0, bd = Infinity;
      // (nearest in space: discounting the way out of her, the bulged skin round a wide opening read as nearer)
      for (let p = 0; p < P; p++) { const dx = at[p * 3] - target.x, dy = at[p * 3 + 1] - target.y, dz = at[p * 3 + 2] - target.z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = p; } }
      return best;
    };
    // the stretch round the opening: its outline now against her split's length shut
    let rimLen = 0; for (let j = 0; j < M; j++) rimLen += w.fromArray(at, base[j] * 3).distanceTo(q.fromArray(at, base[(j + 1) % M] * 3));
    const shutLen = 2 * Math.max(1e-6, (sMax - sMin)), stretch = Math.max(1, rimLen / shutLen);
    const curlNow = L.curl * smooth(0.03, 0.18, open) * (1 - smooth(0.3, 0.8, open)), lift = L.sheetLift * perMetre;
    const footW = L.sheetFoot * perMetre;
    const Af = new Float32Array(2 * NRW * 3), Bf = new Float32Array(2 * NRW * 3), Nf = new Float32Array(2 * NRW * 3), fromP = new Int32Array(2 * NRW), toP = new Int32Array(2 * NRW), Hr = new Float32Array(2 * NRW);
    for (let sd = 0; sd < 2; sd++) for (let r = 0; r < NRW; r++) {
      const k = sd * NRW + r, u = r / (NRW - 1), ends = Math.sin(Math.PI * u);
      toP[k] = rimAt(sd, u, B);
      // the foot: straight out across her split from the edge, on her skin
      const sgn = sd === 0 ? 1 : -1;
      // (narrower toward the hinges, the more so the wider it opens: round a wide opening the hinges' rows stand across it)
      // (out from the opening's middle as it opens, as a round opening's skin lies; straight across her split shut --
      // across her split the rows at a wide opening's ends ran along its edge and stood out as flaps)
      const radial = w.copy(B).sub(C); radial.addScaledVector(out, -radial.dot(out));
      const fdir = t.copy(side).multiplyScalar(sgn);
      if (radial.lengthSq() > 1e-12) fdir.lerp(radial.normalize(), smooth(0.05, 0.6, open)).normalize();
      q.copy(B).addScaledVector(fdir, footW * Math.pow(ends, 0.5 + 3 * open * (1 - smooth(0.05, 0.6, open))));
      const fp = nearestOn(q); fromP[k] = fp;
      A.fromArray(at, fp * 3);
      // (a foot that is not outward of the opening's edge -- round a wide opening the hinges' rows found her skin across
      // it, and the lip was drawn over the hole -- lies at the edge, and that row of the lip is flat)
      const outward = w.copy(B).sub(C); outward.addScaledVector(out, -outward.dot(out));
      const bad = A.distanceTo(B) > 1.6 * footW || (outward.lengthSq() > 1e-12 && w.copy(A).sub(B).dot(outward) < 0);
      if (bad) A.copy(q);
      B.toArray(Bf, k * 3); A.toArray(Af, k * 3);
      n.fromArray(an, fp * 3).normalize(); n.toArray(Nf, k * 3);
      Hr[k] = bad ? 0.3 * L.rise * perMetre * Math.pow(ends, 0.6 + 3 * open) / Math.sqrt(stretch) : L.rise * perMetre * Math.pow(ends, 0.6 + 3 * open) / Math.sqrt(stretch);
    }
    // the feet and the heights evened along each lip (her skin's points are picked one by one: a little jitter)
    { const tmp = new Float32Array(NRW * 3);
      for (let sd = 0; sd < 2; sd++) for (let pass = 0; pass < 8; pass++) {
        for (let r = 1; r < NRW - 1; r++) for (let c = 0; c < 3; c++) { const k = sd * NRW + r; tmp[r * 3 + c] = 0.25 * Af[(k - 1) * 3 + c] + 0.5 * Af[k * 3 + c] + 0.25 * Af[(k + 1) * 3 + c]; }
        for (let r = 1; r < NRW - 1; r++) for (let c = 0; c < 3; c++) Af[(sd * NRW + r) * 3 + c] = tmp[r * 3 + c];
      } }
    // (and its height: a row her skin's points read wrong is not a notch in the lip -- 2026-11-01, "the edges are not
    // smooth and ripped" at the full opening)
    { const tmp = new Float32Array(NRW);
      for (let sd = 0; sd < 2; sd++) for (let pass = 0; pass < 6; pass++) {
        for (let r = 1; r < NRW - 1; r++) { const k = sd * NRW + r; tmp[r] = 0.25 * Hr[k - 1] + 0.5 * Hr[k] + 0.25 * Hr[k + 1]; }
        for (let r = 1; r < NRW - 1; r++) Hr[sd * NRW + r] = tmp[r];
      } }
    for (let sd = 0; sd < 2; sd++) for (let r = 0; r < NRW; r++) {
      const k = sd * NRW + r;
      A.fromArray(Af, k * 3); B.fromArray(Bf, k * 3); n.fromArray(Nf, k * 3);
      t.copy(A).sub(B); t.addScaledVector(n, -t.dot(n));
      let W = t.length();
      if (W < 1e-6) { t.copy(side).multiplyScalar(sd === 0 ? 1 : -1); W = 1e-6; } else t.divideScalar(W);
      const H = Hr[k], rr = Math.min(H * L.noseRound, W * 0.45), ov = rr * curlNow;
      const xc = Math.max(0, Math.min(W - rr, rr - ov)), yc = H - rr;
      for (let a = 0; a < NS; a++) {
        let x: number, y: number, f: number;
        if (a < NO) { const u = a / (NO - 1); x = W + (xc - W) * u; y = H * (1 - Math.cos(Math.PI * u)) / 2; f = 0.6 * u; }
        else if (a < NO + NN) { const th = Math.PI / 2 + ((a - NO + 1) / NN) * Math.PI; x = xc + rr * Math.cos(th); y = yc + rr * Math.sin(th); f = 0.6 + 0.3 * ((a - NO + 1) / NN); }
        else { const u = (a - NO - NN + 1) / NI, x0 = xc, y0 = yc - rr; x = x0 * (1 - u); y = y0 * (1 - u); f = 0.9 + 0.1 * u; }
        const i = k * NS + a;
        q.copy(B).addScaledVector(t, x).addScaledVector(n, y + (a < NS - 1 ? lift : 0));
        q.toArray(sheetWant, i * 3);
        sheetFrom[i] = fromP[k]; sheetTo[i] = toP[k]; sheetF[i] = W > 1e-5 ? 1 - x / W : 1;
        const inside = smooth(0.62, 0.85, f);
        for (let c = 0; c < 3; c++) sheetCol[i * 3 + c] = 1 + (L.innerTint[c] - 1) * inside + (L.edgeTint[c] - L.innerTint[c]) * smooth(0.8, 1, f) * 0.6;
      }
    }
    // ITS TEXTURE, SMOOTH (Joshua, 2026-11-01: "texture them to look more natural and not like streaks"): her skin's
    // texture laid on each lip as one continuous piece -- from where its foot is to where its edge is, row by row, the two
    // evened along the lip -- so it stretches with the lip as skin does, rather than each point reading the texel under
    // it (which drew lines wherever two neighbours read different texels). One piece of her texture for the whole lip.
    const auv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined;
    if (auv) {
      const uF = new Float32Array(2 * NRW * 2), uR = new Float32Array(2 * NRW * 2);
      for (let sd = 0; sd < 2; sd++) {
        const mid = fromP[sd * NRW + Math.floor(NRW / 2)], fu = auv.getX(mid), fv = auv.getY(mid);
        const inPiece = (p: number) => Math.abs(auv.getX(p) - fu) + Math.abs(auv.getY(p) - fv) < 0.1;
        for (let r = 0; r < NRW; r++) {
          const k = sd * NRW + r, a = fromP[k], b = toP[k];
          uF[k * 2] = inPiece(a) ? auv.getX(a) : fu; uF[k * 2 + 1] = inPiece(a) ? auv.getY(a) : fv;
          uR[k * 2] = inPiece(b) ? auv.getX(b) : uF[k * 2]; uR[k * 2 + 1] = inPiece(b) ? auv.getY(b) : uF[k * 2 + 1];
        }
        const tmp = new Float32Array(NRW * 2);
        for (const arr of [uF, uR]) for (let pass = 0; pass < 8; pass++) {
          for (let r = 1; r < NRW - 1; r++) for (let c = 0; c < 2; c++) { const k = sd * NRW + r; tmp[r * 2 + c] = 0.25 * arr[(k - 1) * 2 + c] + 0.5 * arr[k * 2 + c] + 0.25 * arr[(k + 1) * 2 + c]; }
          for (let r = 1; r < NRW - 1; r++) for (let c = 0; c < 2; c++) arr[(sd * NRW + r) * 2 + c] = tmp[r * 2 + c];
        }
      }
      for (let k = 0; k < 2 * NRW; k++) for (let a = 0; a < NS; a++) {
        const i = k * NS + a, f = Math.max(0, Math.min(1, sheetF[i]));
        // (the nose and inner face, folded back over the edge, keep the edge's texel row: f past 1 is not read)
        for (let c = 0; c < 2; c++) sheetUv[i * 2 + c] = uF[k * 2 + c] + (uR[k * 2 + c] - uF[k * 2 + c]) * f;
      }
    }
    // its skinning and shapes: her skin's, between its foot and the edge
    const wAcc2 = new Map<number, number>();
    for (let k = 0; k < 2 * NRW; k++) { n.fromArray(Nf, k * 3); n.toArray(sheetFootN, k * 3); }
    for (let i = 0; i < SV; i++) {
      const a = sheetFrom[i], b = sheetTo[i], f = Math.max(0, Math.min(1, sheetF[i]));
      if (patchI && patchW) {
        wAcc2.clear();
        for (let c = 0; c < 4; c++) { const wa = patchW[a * 4 + c] * (1 - f), wb = patchW[b * 4 + c] * f; if (wa > 0) wAcc2.set(patchI[a * 4 + c], (wAcc2.get(patchI[a * 4 + c]) ?? 0) + wa); if (wb > 0) wAcc2.set(patchI[b * 4 + c], (wAcc2.get(patchI[b * 4 + c]) ?? 0) + wb); }
        const top = [...wAcc2].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((m2, [, ww]) => m2 + ww, 0) || 1;
        for (let c = 0; c < 4; c++) { sheetI[i * 4 + c] = top[c]?.[0] ?? 0; sheetW[i * 4 + c] = top[c] ? top[c][1] / sum : 0; }
      }
    }
    for (const kind of ['position', 'normal'] as const) {
      const src = geom.morphAttributes[kind], dst = sheetGeom.morphAttributes[kind];
      if (!src || !dst) continue;
      for (let m = 0; m < src.length; m++) { const sa = src[m], da = dst[m].array as Float32Array; for (let i = 0; i < SV; i++) { const f = Math.max(0, Math.min(1, sheetF[i])); for (let c = 0; c < 3; c++) da[i * 3 + c] = sa.getComponent(sheetFrom[i], c) * (1 - f) + sa.getComponent(sheetTo[i], c) * f; } dst[m].needsUpdate = true; }
    }
    sheetLaid = true;
  }
  let sheetLaid = false;
  /** the outer skin ring laid round the opening as it lies now (`at`, `an`: the area's points and normals) */
  function layOuter(at: Float32Array, an: Float32Array): void {
    const L = VULVA_OPEN, ro = L.outerRound * perMetre * smooth(0.02, 0.3, open);
    outerLaid = ro > 1e-6;
    if (!outerLaid) return;
    // the rim's middle and, round each column, the area's point `outerGap` out from the rim (as the opening lies now)
    const C = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let j = 0; j < M; j++) C.add(a.fromArray(at, base[j] * 3)); C.divideScalar(M);
    const want = L.outerGap * perMetre, loop = new Float32Array(M * 3), nl = new Float32Array(M * 3);
    for (let j = 0; j < M; j++) {
      a.fromArray(at, base[j] * 3);
      let best = base[j], bd = Infinity;
      for (let k = 1; k <= R; k++) { const v = base[k * M + j]; if (v < 0) continue; const d = Math.abs(b.fromArray(at, v * 3).distanceTo(a) - want); if (d < bd) { bd = d; best = v; } }
      outerSrc[j] = best;
      for (let c = 0; c < 3; c++) { loop[j * 3 + c] = at[best * 3 + c]; nl[j * 3 + c] = an[best * 3 + c]; }
    }
    // evened round itself (keeping its size), its normals too
    const tmp = new Float32Array(M * 3);
    for (let pass = 0; pass < L.outerSmooth; pass++) for (const lam of [0.6, -0.62]) {
      for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) tmp[j * 3 + c] = loop[j * 3 + c] + lam * (0.5 * (loop[((j + M - 1) % M) * 3 + c] + loop[((j + 1) % M) * 3 + c]) - loop[j * 3 + c]);
      loop.set(tmp);
    }
    smoothLoop(loop, M, L.loopWaves);
    for (let pass = 0; pass < 10; pass++) { for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) tmp[j * 3 + c] = 0.25 * nl[((j + M - 1) % M) * 3 + c] + 0.5 * nl[j * 3 + c] + 0.25 * nl[((j + 1) % M) * 3 + c]; nl.set(tmp); }
    const nn = new THREE.Vector3(), o = new THREE.Vector3(), q = new THREE.Vector3();
    for (let j = 0; j < M; j++) {
      nn.fromArray(nl, j * 3).normalize();
      o.fromArray(loop, j * 3).sub(C); o.addScaledVector(nn, -o.dot(nn)); if (o.lengthSq() < 1e-14) o.copy(across); o.normalize();
      for (let k = 0; k < KO; k++) {
        // (a round roll: from her skin inside the ring, over its top, back down to her skin outside it -- its ends under her skin)
        const phi = -0.15 * Math.PI + (1.3 * Math.PI * k) / (KO - 1);
        q.fromArray(loop, j * 3).addScaledVector(nn, ro * L.outerLift).addScaledVector(o, -ro * Math.cos(phi)).addScaledVector(nn, ro * Math.sin(phi));
        q.toArray(outerPos, (k * M + j) * 3);
      }
    }
    // her texture, weights and shapes from the point each column's ring is laid on, its weights evened round the ring
    const auv = geom.getAttribute('uv') as THREE.BufferAttribute | undefined, WR = L.rimWeightReach;
    // (one place of her texture for the whole ring -- her skin's tone, with no seam or band along it: read point by point
    // round the opening it crossed her texture's seams and came out in light and dark segments)
    let uv0 = 0, uv1 = 0;
    if (auv) { let jm = 0; for (let j = 0; j < M; j++) if (Math.abs(colQ[j]) < Math.abs(colQ[jm])) jm = j; uv0 = auv.getX(outerSrc[jm]); uv1 = auv.getY(outerSrc[jm]); }
    for (let j = 0; j < M; j++) {
      const acc = new Map<number, number>();
      if (patchI && patchW) for (let dj = -WR; dj <= WR; dj++) { const v = outerSrc[(j + dj + M) % M] * 4, g = 1 - Math.abs(dj) / (WR + 1); for (let c = 0; c < 4; c++) { const w = patchW[v + c] * g; if (w > 0) acc.set(patchI[v + c], (acc.get(patchI[v + c]) ?? 0) + w); } }
      const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((m2, [, w]) => m2 + w, 0) || 1;
      for (let k = 0; k < KO; k++) {
        const i = k * M + j;
        if (auv) { outerUv[i * 2] = uv0; outerUv[i * 2 + 1] = uv1; }
        for (let c = 0; c < 4; c++) { outerI[i * 4 + c] = top[c]?.[0] ?? 0; outerW[i * 4 + c] = top[c] ? top[c][1] / sum : 0; }
      }
    }
    for (const kind of ['position', 'normal'] as const) {
      const src = geom.morphAttributes[kind], dst = outerGeom.morphAttributes[kind];
      if (!src || !dst) continue;
      for (let m = 0; m < src.length; m++) { const sa = src[m], da = dst[m].array as Float32Array; for (let k = 0; k < KO; k++) for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) da[((k * M + j) * 3) + c] = sa.getComponent(outerSrc[j], c); dst[m].needsUpdate = true; }
    }
  }
  /** lay the opening on the rest shape just read (restPos) */
  function layOpen(): void {
    const pos = want;
    pos.set(restPos);
    // the split's frame: its middle, along it (back to front), out of her
    let jm = 0;
    for (let j = 0; j < M; j++) if (Math.abs(colQ[j]) < Math.abs(colQ[jm])) jm = j;
    O.fromArray(restPos, base[jm] * 3);
    let jb = 0, jf = 0;
    for (let j = 0; j < M; j++) { if (colQ[j] < colQ[jb]) jb = j; if (colQ[j] > colQ[jf]) jf = j; }
    tA.fromArray(restPos, base[jf] * 3).sub(vv.fromArray(restPos, base[jb] * 3));
    tA.addScaledVector(across, -tA.dot(across)).normalize();
    nO.crossVectors(across, tA).normalize();
    if (nO.dot(vv.fromArray(restNrm, base[jm] * 3)) < 0) nO.negate();
    // turned toward her front by the tube's angle: the way the opening faces and the way the tube runs in
    { const t = (VULVA_OPEN.tilt * Math.PI) / 180, front = tA.dot(new THREE.Vector3(0, 0, 1).applyMatrix3(inv)) >= 0 ? 1 : -1;
      const n2 = nO.clone().multiplyScalar(Math.cos(t)).addScaledVector(tA, front * Math.sin(t)), t2 = tA.clone().multiplyScalar(Math.cos(t)).addScaledVector(nO, -front * Math.sin(t));
      nO.copy(n2).normalize(); tA.copy(t2).normalize(); }
    // THE OPENING LIES IN HER SKIN (Joshua's references, 2026-10-30: "what you are doing is too much like a funnel that
    // sticks out"; like pinching a straw). The two lips' edges slide apart over her own skin -- slit, oval, round --
    // and the skin between each edge and her own skin at the area's edge gives way along its column, all of it laid
    // out flat and read back off her skin where it now lies. Nothing stands out of her; the tube goes in at the edge.
    const D = 0.1 * open;
    measureScale();
    // MEASURED OVER HER SKIN, NOT LAID OUT (2026-10-31: sizing it in the flat layout's units tore it at three quarters
    // open, its edge carried past the area's own edge). Each column is her skin from the split to the area's edge,
    // in metres; opening, its lip's edge walks out along it as far as the opening's edge is from where the column
    // starts, and the rest of the column gives way evenly between that and her own skin at the area's edge. Nothing
    // leaves the column, so nothing folds over and nothing is read from beyond the area.
    if (!colMetres) {
      colMetres = new Float32Array((R + 1) * M);
      for (let j = 0; j < M; j++) for (let k = 1; k <= R; k++) {
        const a = base[(k - 1) * M + j] * 3, c = base[k * M + j] * 3;
        colMetres[k * M + j] = colMetres[(k - 1) * M + j] + Math.hypot(restPos[a] - restPos[c], restPos[a + 1] - restPos[c + 1], restPos[a + 2] - restPos[c + 2]) / perMetre;
      }
    }
    const cm = colMetres;
    if (!painted || Math.abs(paintedAt - Math.min(open, 0.15)) > 1e-4) { paintLips(); painted = true; paintedAt = Math.min(open, 0.15); }
    const pv = new THREE.Vector3();
    findLegNear();
    // THE OPENING'S SIZE IS HER POSED SIZE (Joshua: a 10 cm circle). Each ring-and-column read off her skin as she
    // is posed now (her own bones and weights), and the opening's oval laid in her skin's plane there: across her
    // split and along it, seen square on. A column's lip edge goes out to where the column crosses that oval.
    body.skeleton.update();
    const posedNode = (k: number, out: THREE.Vector3) => {
      const v = base[k];
      out.set(0, 0, 0);
      for (let t = 0; t < 3; t++) {
        const w = bake.bary[v * 3 + t], src = bake.src[v * 3 + t];
        if (w <= 0) continue;
        // as drawn: her morph targets (the belly slider) and her bones
        body.getVertexPosition(src, pv);
        out.addScaledVector(pv, w);
      }
      return out;
    };
    let jl = -1, jr = -1;
    for (let j = 0; j < M; j++) { if (colSide[j] > 0 && (jl < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jl]))) jl = j; if (colSide[j] < 0 && (jr < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jr]))) jr = j; }
    const k3 = Math.max(1, Math.round(R / 3)), Op = posedNode(jm, new THREE.Vector3());
    const alongP = posedNode(jf, new THREE.Vector3()).sub(posedNode(jb, new THREE.Vector3())).normalize();
    const sideP = jl >= 0 && jr >= 0 ? posedNode(k3 * M + jl, new THREE.Vector3()).sub(posedNode(k3 * M + jr, new THREE.Vector3())) : across.clone();
    sideP.addScaledVector(alongP, -sideP.dot(alongP)).normalize();
    const nodeU = new Float32Array((R + 1) * M), nodeS = new Float32Array((R + 1) * M), tmp = new THREE.Vector3();
    for (let k = 0; k < (R + 1) * M; k++) {
      if (base[k] < 0) continue;
      posedNode(k, tmp).sub(Op);
      nodeU[k] = tmp.dot(sideP) / perMetre; nodeS[k] = tmp.dot(alongP) / perMetre;
    }
    const Lf = Math.abs(nodeS[jf]), Lb = Math.abs(nodeS[jb]);
    // HELD 1 CM OFF HER LEGS (Joshua, 2026-10-31: the opening "cuts into the legs... add a limit so it automatically
    // stops if it gets 1cm to the thighs/hips/inside legs until the legs spread more apart"). Her skin that her thighs
    // carry, as she is posed now, beside the opening: the nearest on each side across it sets how wide it may go.
    let room = Infinity;
    if (legNear.length && D > 0) {
      const nAx = new THREE.Vector3().crossVectors(sideP, alongP).normalize(), reach = Math.max(Lf, Lb) + 0.01 * perMetre;
      // each leg point as seen square on to the opening: the oval (half `a` across, half `c` along) must pass it by
      // legClear, so a <= (|u| - clear) / sqrt(1 - ((|s| - clear) / c)^2); points past its ends along do not hold it
      const cl = VULVA_OPEN.legClear, cHalf = Math.max(Math.max(Lf, Lb) / perMetre, D / 2);
      void reach;
      for (const i of legNear) {
        body.getVertexPosition(i, pv); pv.sub(Op);
        const sv = Math.abs(pv.dot(alongP)) / perMetre, nv = pv.dot(nAx) / perMetre, uv = Math.abs(pv.dot(sideP)) / perMetre;
        // (the same legs at every opening, so the widest it may go is one fixed width in a pose -- Joshua, 2026-11-01:
        // "keep that max width the same regardless of the opening" -- however far the bulge stands it out of her)
        if (Math.abs(nv) > VULVA_OPEN.legSlab) continue;
        const k = (sv - cl) / cHalf;
        if (k >= 1) continue;
        const a = (uv - cl) / Math.sqrt(1 - Math.max(0, k) ** 2);
        if (a < room) { room = Math.max(0, a); blocker = [+(uv * 100).toFixed(1), +(sv * 100).toFixed(1), +(nv * 100).toFixed(1), i]; }
      }
    }
    heldTo = Number.isFinite(room) && room < D / 2 ? room * 2 : null;
    const halfAcross = Math.min(D / 2, room);
    /** where along column j (metres from the split) its lip's edge now is */
    const edgeAt = (j: number) => {
      // A BEAR TRAP (Joshua, 2026-11-01: "think of it similar to a bear trap where open is the full 10cm in diameter and
      // it hinges at the top and bottom"): the two lips are two jaws hinged at the ends of her split. Their edges are two
      // arcs through the hinges -- a lens, sharp at the hinges, a slit shut and a circle at 100% -- the hinges moving
      // apart only as far as a 10 cm circle needs (from her split's own length, `L`, to the opening's half width). The
      // corners at the hinges are softened by `hingeRound` (a share of the way to the oval through the same points).
      const q = colQ[j], L = q >= 0 ? Lf : Lb, a = Math.max(1e-6, halfAcross), c = Math.max(L, L + (0.05 - L) * open, a) * 1.0001;
      const Rl = (c * c + a * a) / (2 * a), hr = VULVA_OPEN.hingeRound;
      const halfAt = (sAbs: number) => {
        if (sAbs >= c) return 0;
        const lens = Math.max(0, Math.sqrt(Math.max(0, Rl * Rl - sAbs * sAbs)) - (Rl - a)), oval = a * Math.sqrt(Math.max(0, 1 - (sAbs / c) ** 2));
        return lens + (oval - lens) * hr;
      };
      const rho = (k: number) => { const su = Math.abs(nodeS[k * M + j]); if (su >= c) return 2; const w = halfAt(su); return w > 1e-9 ? Math.abs(nodeU[k * M + j]) / w : 2; };
      // the outermost crossing: a column that wanders out of the oval and back in (over her lips' rounds) is opened
      // to where it leaves it for good, so the edge does not catch on a lip
      let next = rho(R);
      for (let k = R - 1; k >= 0; k--) {
        const r = rho(k);
        if (r < 1 && next >= 1) {
          const f = next > r ? Math.max(0, Math.min(1, (1 - r) / (next - r))) : 0;
          return Math.min(cm[k * M + j] + f * (cm[(k + 1) * M + j] - cm[k * M + j]), VULVA_OPEN.room * cm[R * M + j]);
        }
        next = r;
      }
      if (next >= 1) return 0;
      return VULVA_OPEN.room * cm[R * M + j];
    };
    /** the flat place on column j at m metres from the split */
    const onColumn = (j: number, m: number, out: number[]) => {
      let k = 0;
      while (k < R - 1 && cm[(k + 1) * M + j] < m) k++;
      const m0 = cm[k * M + j], m1 = cm[(k + 1) * M + j], f = m1 > m0 ? Math.max(0, Math.min(1, (m - m0) / (m1 - m0))) : 0;
      const a = base[k * M + j], c = base[(k + 1) * M + j];
      out[0] = bake.flat[a * 2] + (bake.flat[c * 2] - bake.flat[a * 2]) * f;
      out[1] = bake.flat[a * 2 + 1] + (bake.flat[c * 2 + 1] - bake.flat[a * 2 + 1]) * f;
    };
    const edges = new Float32Array(M);
    for (let j = 0; j < M; j++) edges[j] = edgeAt(j);
    // a clean edge: each column's crossing evened with its neighbours' round the outline (the columns are ragged on
    // her skin's own triangles, which show as teeth on the opening's edge)
    { const t = new Float32Array(M);
      for (let pass = 0; pass < VULVA_OPEN.edgeSmooth; pass++) {
        for (let j = 0; j < M; j++) t[j] = 0.25 * edges[(j + M - 1) % M] + 0.5 * edges[j] + 0.25 * edges[(j + 1) % M];
        for (let j = 0; j < M; j++) edges[j] = Math.min(t[j], VULVA_OPEN.room * cm[R * M + j]);
      } }
    const at = [0, 0];
    // each point carried by her bones as her skin is WHERE IT NOW LIES (so, posed, it stays on her skin: Joshua's
    // RECLINE of 2026-10-31 opens her thighs 80 degrees, and the two lips' skin is each thigh's as much as her pelvis's)
    if (patchI && patchW && ownPI && ownPW) { patchI.set(ownPI); patchW.set(ownPW); }
    readBodySkin();
    const smp = new Float64Array(6);
    const bp = g.getAttribute('position') as THREE.BufferAttribute, bn = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const BP = bp.array as Float32Array, BN = bn ? (bn.array as Float32Array) : null;
    const nr = new Float32Array(P * 3);
    for (let p = 0; p < P; p++) {
      const j = bake.column[p], w = Math.max(0, 1 - tau[p]);
      moved[p] = open > 0 ? w : 0;
      if (open <= 0 || w <= 0) continue;
      const total = cm[R * M + j], m = cm[bake.ring[p] * M + j], e = edges[j];
      onColumn(j, e + m * (1 - e / (total || 1)), at);
      bake.sampleFlat(at[0], at[1], smp);
      weightsAt(p, smp);
      // CARRIED BY HER PELVIS AS IT OPENS (2026-11-02, Joshua of LEGS APART at 100% from the side: "even your wireframe is
      // not smooth"): her skin round the opening, walked out onto skin her thighs carry, was carried by her thighs too --
      // posed with her thighs close, each side of the opening went its own way and the area crumpled. The opening is her
      // pelvis's: `pelvisCarry` of each point's weight handed to her pelvis, all of it at the opening's edge and none at
      // the area's own edge (so it meets her skin there as before), as much as it is open.
      if (patchI && patchW) {
        const k = VULVA_OPEN.pelvisCarry * w * w * smooth(0, 0.3, open);
        if (k > 0) {
          let slot = -1; for (let c = 0; c < 4; c++) if (patchI[p * 4 + c] === pelvis) slot = c;
          if (slot < 0) { let low = 0; for (let c = 1; c < 4; c++) if (patchW[p * 4 + c] < patchW[p * 4 + low]) low = c; slot = low; patchI[p * 4 + slot] = pelvis; patchW[p * 4 + slot] = 0; }
          for (let c = 0; c < 4; c++) patchW[p * 4 + c] *= 1 - k;
          patchW[p * 4 + slot] += k;
        }
      }
      for (let c = 0; c < 3; c++) {
        pos[p * 3 + c] = smp[3] * BP[smp[0] * 3 + c] + smp[4] * BP[smp[1] * 3 + c] + smp[5] * BP[smp[2] * 3 + c];
        if (BN) nr[p * 3 + c] = smp[3] * BN[smp[0] * 3 + c] + smp[4] * BN[smp[1] * 3 + c] + smp[5] * BN[smp[2] * 3 + c];
      }
    }
    // a clean edge: each ring evened round itself where it moved (each column reads her skin by its own path, and
    // neighbours land a little apart, which shows as teeth along the opening's edge); her own skin at the area's edge
    // does not move, and closed nothing is touched
    if (open > 0) {
      const G = (R + 1) * M, at3 = new Float32Array(G * 3), nx = new Float32Array(G * 3);
      for (let k = 0; k < G; k++) if (base[k] >= 0) for (let c = 0; c < 3; c++) at3[k * 3 + c] = pos[base[k] * 3 + c];
      const lam = 0.5 * smooth(0, 0.3, open);
      for (let pass = 0; pass < VULVA_OPEN.edgeSmooth; pass++) {
        nx.set(at3);
        for (let r = 0; r < R; r++) for (let j = 0; j < M; j++) {
          const k = r * M + j, a = r * M + ((j + M - 1) % M), b = r * M + ((j + 1) % M);
          if (base[k] < 0 || base[a] < 0 || base[b] < 0) continue;
          // (more at the hinges, top and bottom: the skin there is stretched round the jaws' ends -- Joshua, 2026-11-01:
          // "try smoothing around the whole vagina area (mainly top and bottom) as it opens")
          const w = Math.min(0.9, lam * moved[base[k]] * (1 + VULVA_OPEN.hingeSmooth * smooth(0.55, 0.95, Math.abs(colQ[j]))));
          for (let c = 0; c < 3; c++) nx[k * 3 + c] = at3[k * 3 + c] + w * (0.5 * (at3[a * 3 + c] + at3[b * 3 + c]) - at3[k * 3 + c]);
        }
        at3.set(nx);
      }
      // A SMOOTH RIM (Joshua, 2026-11-01: "work more on the opening at 100% to look smooth all around it and not jagged"):
      // wide open, the columns that walked out from her split's ends land unevenly round the opening and notched its
      // outline. The rings nearest the edge are evened round themselves again, more the wider it is, with a step back
      // out after each step in (Taubin's) so the opening keeps its size, the edge most and fading over `rimRings`.
      { const RR = Math.max(1, Math.round(R * VULVA_OPEN.rimRings)), passes = Math.round(VULVA_OPEN.rimPasses * smooth(0.2, 1, open));
        for (let pass = 0; pass < passes; pass++) for (const lamS of [0.5, -0.53]) {
          nx.set(at3);
          for (let r = 0; r < Math.min(R, RR); r++) {
            const fall = (1 - r / RR) ** 2;
            for (let j = 0; j < M; j++) {
              const k = r * M + j, a = r * M + ((j + M - 1) % M), b = r * M + ((j + 1) % M);
              if (base[k] < 0 || base[a] < 0 || base[b] < 0) continue;
              const w = lamS * fall * moved[base[k]];
              for (let c = 0; c < 3; c++) nx[k * 3 + c] = at3[k * 3 + c] + w * (0.5 * (at3[a * 3 + c] + at3[b * 3 + c]) - at3[k * 3 + c]);
            }
          }
          at3.set(nx);
        } }
      // ...and round: each rim point drawn toward a circle round the rim's middle in the opening's plane (its height out
      // of her kept), all of it wide open; the rings behind it carried along, less and less, over `rimRings`
      for (let p = 0; p < P; p++) { const k = bake.ring[p] * M + bake.column[p]; if (moved[p] > 0) for (let c = 0; c < 3; c++) pos[p * 3 + c] = at3[k * 3 + c]; }
    }
    // its normals: her skin's where each point now lies
    const nrm = wantNrm;
    nrm.set(restNrm);
    if (open > 0) for (let p = 0; p < P; p++) {
      if (moved[p] <= 0) continue;
      const x = nr[p * 3], y = nr[p * 3 + 1], z = nr[p * 3 + 2], l = Math.hypot(x, y, z) || 1;
      nrm[p * 3] = x / l; nrm[p * 3 + 1] = y / l; nrm[p * 3 + 2] = z / l;
    }
    // the lips: shaped on her as they lie now, round beside the split and tucked in where they meet
    sculptLips(pos, nrm);
    // THE OUTLET BULGES OUT AS IT OPENS (Joshua, 2026-11-01, of his crowning references: "as it opens, it also is
    // extended out... at the full 10cm open it is pushed out an additional 5cm"). The head pushes the soft tissue ahead
    // of it: midwives' "perineal bulging", the perineum stretching from about 3.7 to 6.1 cm (MDedge's report of the
    // UNM study). Every point of the area moves out the way the opening faces, most at the opening's edge and none at
    // the area's own edge, by `bulge` metres at the full opening.
    if (open > 0 && VULVA_OPEN.bulge > 0) {
      const H = VULVA_OPEN.bulge * Math.pow(open, VULVA_OPEN.bulgeEase), out = nO;
      for (let p = 0; p < P; p++) {
        if (tau[p] >= 1) continue;
        const j = bake.column[p], total = cm[R * M + j] || 1, m = cm[bake.ring[p] * M + j], e = edges[j];
        // A HALF SPHERE (Joshua, 2026-11-01: "the bulge should be shaped like a half sphere"): where the point now lies,
        // as a share of the way from the split to the area's edge (s), it stands on a sphere round the opening's middle
        // -- the opening its top, cut off where the head shows -- scaled so the opening's edge stands `bulge` out; the
        // last `bulgeFoot` of the way eases it onto her skin, so its foot is not a step
        const s = Math.max(0, Math.min(1, (e + m * (1 - e / total)) / total)), s0 = Math.min(0.95, e / total);
        const sphere = Math.sqrt(Math.max(0, 1 - s * s)) / Math.sqrt(1 - s0 * s0), foot = smooth(1, 1 - VULVA_OPEN.bulgeFoot, s);
        const h = H * Math.min(1, sphere) * foot * perMetre;
        pos[p * 3] += out.x * h; pos[p * 3 + 1] += out.y * h; pos[p * 3 + 2] += out.z * h;
      }
    }
    bulgeNow = open > 0 ? VULVA_OPEN.bulge * Math.pow(open, VULVA_OPEN.bulgeEase) : 0;
    // THE RIM MADE ROUND AS SHE IS POSED, last of all (after the lips and the bulge: done before them, they undid it)
    roundDbg = [];
    // (not where her legs hold it narrower than it would be: rounded there, its ends were drawn in so far its skin crowded
    // and tore -- LEGS APART, 2026-11-01 -- so held, it keeps the shape her legs allow)
    if (open > 0) { const round = VULVA_OPEN.rimRound * smooth(0.3, 1, open), held = heldTo !== null;
        if (round > 0 && patchI && patchW) for (let iter = 0; iter < 6; iter++) {
          // (round as she is POSED: each rim point carried by its own bones, as the GPU will carry it -- a circle laid in
          // her rest shape came out a rounded square once her thighs had turned their side of it -- the circle fitted
          // there, and each point's move taken back to her rest shape through the inverse of its own bones' turn)
          const sk = body.skeleton, bm = body.bindMatrix, bmi = body.bindMatrixInverse;
          const Tof = (pp: number, out: THREE.Matrix4) => {
            const acc = new THREE.Matrix4().set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0), tmpM = new THREE.Matrix4();
            for (let c = 0; c < 4; c++) { const w = patchW[pp * 4 + c]; if (w <= 0) continue; const bi = patchI[pp * 4 + c]; tmpM.multiplyMatrices(sk.bones[bi].matrixWorld, sk.boneInverses[bi]); for (let e = 0; e < 16; e++) acc.elements[e] += w * tmpM.elements[e]; }
            return out.multiplyMatrices(bmi, acc).multiply(bm);
          };
          const T = Array.from({ length: M }, () => new THREE.Matrix4()), Pp = new Float32Array(M * 3), d = new THREE.Vector3(), C = new THREE.Vector3();
          // (her shape's motion targets too -- her belly's slider is one -- as the GPU lays them before her bones)
          const mInf = body.morphTargetInfluences, mPos = geom.morphAttributes.position;
          for (let j2 = 0; j2 < M; j2++) {
            Tof(base[j2], T[j2]); d.fromArray(pos, base[j2] * 3);
            if (mInf && mPos) for (let m = 0; m < mPos.length; m++) { const w = mInf[m]; if (w) { d.x += w * mPos[m].getX(base[j2]); d.y += w * mPos[m].getY(base[j2]); d.z += w * mPos[m].getZ(base[j2]); } }
            d.applyMatrix4(T[j2]); d.toArray(Pp, j2 * 3); C.add(d);
          }
          C.divideScalar(M);
          // (the posed rim's own plane: its points' spread, the normal the least of it)
          const nP = new THREE.Vector3();
          for (let j2 = 0; j2 < M; j2++) { const a = new THREE.Vector3().fromArray(Pp, j2 * 3).sub(C), b = new THREE.Vector3().fromArray(Pp, ((j2 + 1) % M) * 3).sub(C); nP.add(a.cross(b)); }
          if (nP.lengthSq() < 1e-18) nP.copy(nO); nP.normalize();
          let mean = 0; const rr = new Float32Array(M);
          for (let j2 = 0; j2 < M; j2++) { d.fromArray(Pp, j2 * 3).sub(C); d.addScaledVector(nP, -d.dot(nP)); rr[j2] = d.length(); mean += rr[j2] / M; }
          // (the target: a circle; held by her legs, its own outline evened round -- an oval with no notches)
          const target = new Float32Array(M).fill(mean);
          if (held) { const tmp = Float32Array.from(rr), nx2 = new Float32Array(M); for (let pass = 0; pass < 40; pass++) { for (let j2 = 0; j2 < M; j2++) nx2[j2] = 0.25 * tmp[(j2 + M - 1) % M] + 0.5 * tmp[j2] + 0.25 * tmp[(j2 + 1) % M]; tmp.set(nx2); } target.set(tmp); }
          roundDbg.push(+(Math.min(...rr) / perMetre * 100).toFixed(2), +(Math.max(...rr) / perMetre * 100).toFixed(2));
          const RR = Math.max(1, Math.round(R * VULVA_OPEN.rimRings)), dv = new THREE.Vector3(), inv3 = new THREE.Matrix3();
          for (let j2 = 0; j2 < M; j2++) {
            if (rr[j2] < 1e-9) continue;
            d.fromArray(Pp, j2 * 3).sub(C); d.addScaledVector(nP, -d.dot(nP));
            dv.copy(d).multiplyScalar((target[j2] / rr[j2] - 1) * round);
            inv3.setFromMatrix4(T[j2]); if (Math.abs(inv3.determinant()) < 1e-12) continue; inv3.invert(); dv.applyMatrix3(inv3);
            for (let p2 = 0; p2 < P; p2++) { if (bake.column[p2] !== j2) continue; const r = bake.ring[p2]; if (r >= RR) continue; const f = (1 - r / RR) ** 2 * moved[p2]; pos[p2 * 3] += dv.x * f; pos[p2 * 3 + 1] += dv.y * f; pos[p2 * 3 + 2] += dv.z * f; }
          }
        } }
    if (VULVA_OPEN.sheet && !dressed) laySheet(pos, nrm, cm);
    // the canal hangs from the lips' edge as shaped (rolled in), so the two meet
    for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) rim[j * 3 + c] = pos[base[j] * 3 + c];
    // THE BALLOON: one skin from the opening's rim to the top of her womb (see VULVA_OPEN.bead)
    const C0 = vv.set(0, 0, 0);
    for (let j = 0; j < M; j++) C0.x += rim[j * 3] / M, C0.y += rim[j * 3 + 1] / M, C0.z += rim[j * 3 + 2] / M;
    const L = VULVA_OPEN, length = L.canal * perMetre;
    // THE CANAL CURVES UP TO HER WOMB (Joshua, 2026-10-31: "the birth tube is cutting to the backside... it needs to be
    // primarily straight down with a slight bend at the front"; the curve of Carus): it leaves the opening along its
    // axis (in, and back a little), then turns to run up her body leaning a little forward, toward her cervix. Each
    // ring is the opening's outline carried along that curve, turned with it.
    const inward = nO.clone().negate(), upG = new THREE.Vector3(0, 1, 0).applyMatrix3(inv).normalize(), fwdG = new THREE.Vector3(0, 0, 1).applyMatrix3(inv).normalize();
    const lean = (L.canalLean * Math.PI) / 180, deep = upG.clone().multiplyScalar(Math.cos(lean)).addScaledVector(fwdG, Math.sin(lean)).normalize();
    const ctr = C0.clone(), dir = new THREE.Vector3(), turn = new THREE.Quaternion(), off = new THREE.Vector3(), rad = new THREE.Vector3();
    // each rim point's way out from the middle of the opening, in the opening's plane (shut, a slit: straight across)
    const out = new Float32Array(M * 3), rimR = new Float32Array(M);
    let meanR = 0;
    for (let j = 0; j < M; j++) {
      rad.set(rim[j * 3] - C0.x, rim[j * 3 + 1] - C0.y, rim[j * 3 + 2] - C0.z); rad.addScaledVector(nO, -rad.dot(nO));
      rimR[j] = rad.length(); meanR += rimR[j] / M;
      if (rimR[j] < 1e-4 * perMetre) rad.copy(across).multiplyScalar(colSide[j] || 1);
      rad.normalize(); out[j * 3] = rad.x; out[j * 3 + 1] = rad.y; out[j * 3 + 2] = rad.z;
    }
    // each rim point's angle round the opening (for the folds)
    const ang = new Float32Array(M);
    { const tB = new THREE.Vector3().crossVectors(nO, across).normalize();
      for (let j = 0; j < M; j++) ang[j] = Math.atan2(out[j * 3] * tB.x + out[j * 3 + 1] * tB.y + out[j * 3 + 2] * tB.z, out[j * 3] * across.x + out[j * 3 + 1] * across.y + out[j * 3 + 2] * across.z); }
    // each column's way round an even circle (columns run round from behind her, as vulvaPatch.ts lays them): the deep
    // rings are round whatever the opening's shape, so shut (a slit) they do not fold flat
    const circ = new Float32Array(M * 3);
    { const behind = tA.clone().negate(), sideWay = across.clone().multiplyScalar(colSide[Math.floor(M / 4)] >= 0 ? 1 : -1);
      for (let j = 0; j < M; j++) { const t = (2 * Math.PI * j) / M; rad.copy(behind).multiplyScalar(Math.cos(t)).addScaledVector(sideWay, Math.sin(t)); circ[j * 3] = rad.x; circ[j * 3 + 1] = rad.y; circ[j * 3 + 2] = rad.z; } }
    const cj = new THREE.Vector3();
    const put = (m: number, j: number, p: THREE.Vector3) => { const o = (m * M + j) * 3; tubeWant[o] = p.x; tubeWant[o + 1] = p.y; tubeWant[o + 2] = p.z; };
    const pt = new THREE.Vector3(), oj = new THREE.Vector3();
    // 1. HER LIPS' INNER WALLS, THEN THE BEAD INSIDE THEM (Joshua, 2026-11-01, of his reference at about 20% open: her
    // lips stand out as two thick rounded flaps, each folding over at its edge and running straight back in as the wall
    // of the opening; "keep your balloon lip at the end, but place it on the inside of the outer skin"). From each lip's
    // rounded edge the wall runs straight in along the opening's axis `lipWall` metres, keeping the opening's outline;
    // at its foot the balloon's rolled bead stands in toward the middle, and the canal goes on from under it.
    const rb = L.bead * perMetre * smooth(0.02, 0.2, open), wallIn = L.lipWall * perMetre;
    // (each wall runs in square to her skin at its own edge -- not along the opening's tilted axis, which on one side of
    // the opening ran the wall out through her skin and hid it behind pink -- turning to the axis further in)
    const wallDir = new Float32Array(M * 3), wv = new THREE.Vector3();
    for (let j = 0; j < M; j++) {
      const p0 = base[j] * 3;
      wv.set(-nr[p0], -nr[p0 + 1], -nr[p0 + 2]);
      if (wv.lengthSq() < 1e-12) wv.copy(inward); else wv.normalize().lerp(inward, 0.3).normalize();
      wallDir[j * 3] = wv.x; wallDir[j * 3 + 1] = wv.y; wallDir[j * 3 + 2] = wv.z;
    }
    const startOf = new Float32Array(M * 3);
    void wallIn; void rb;
    // THE BALLOON'S ROLLED RIM, RIGHT AT THE EDGE (Joshua, 2026-11-02: "when you did the balloon end look before with that
    // thicker edging, it looked good... try placing it back slightly more outward right at the edge between skin and
    // inside so it has that smooth shape all around even from the side"). One thick round roll, `rimBead` round, laid
    // round a SMOOTHED copy of the opening's edge (evened round itself, a step back out after each step in so it keeps its
    // size) and standing a little out of her: it starts tucked under her skin just outside the edge, rolls over the edge
    // and down inside, where the canal goes on. Wherever the skin's own edge wanders, the roll is smooth over it.
    // (none shut: her lips meet over it, and a roll there drew a beaded line down her closed split)
    const rr = L.rimBead * perMetre * smooth(0.01, 0.25, open);
    const rimS = Float32Array.from(rim), tmpS = new Float32Array(M * 3);
    for (let pass = 0; pass < L.rimSmooth; pass++) for (const lam of [0.6, -0.62]) {
      for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) tmpS[j * 3 + c] = rimS[j * 3 + c] + lam * (0.5 * (rimS[((j + M - 1) % M) * 3 + c] + rimS[((j + 1) % M) * 3 + c]) - rimS[j * 3 + c]);
      rimS.set(tmpS);
    }
    // (and then only its broad shape kept: a notch where her split's ends meet came through the passes above as a V)
    smoothLoop(rimS, M, L.loopWaves);
    // (each point's way out from the opening's middle, evened round too)
    const oS = new Float32Array(M * 3);
    { const Cs = new THREE.Vector3(); for (let j = 0; j < M; j++) Cs.x += rimS[j * 3] / M, Cs.y += rimS[j * 3 + 1] / M, Cs.z += rimS[j * 3 + 2] / M;
      for (let j = 0; j < M; j++) { wv.fromArray(rimS, j * 3).sub(Cs); wv.addScaledVector(nO, -wv.dot(nO)); if (wv.lengthSq() < 1e-14) wv.fromArray(out, j * 3); wv.normalize(); wv.toArray(oS, j * 3); }
      for (let pass = 0; pass < 6; pass++) { for (let j = 0; j < M; j++) for (let c = 0; c < 3; c++) tmpS[j * 3 + c] = 0.25 * oS[((j + M - 1) % M) * 3 + c] + 0.5 * oS[j * 3 + c] + 0.25 * oS[((j + 1) % M) * 3 + c]; oS.set(tmpS); }
      for (let j = 0; j < M; j++) { wv.fromArray(oS, j * 3).normalize(); wv.toArray(oS, j * 3); } }
    const phi0 = -0.3 * Math.PI, phi1 = 1.5 * Math.PI, lift = L.rimLift * rr;
    for (let b = 0; b < KB; b++) {
      const phi = phi0 + (phi1 - phi0) * (b / (KB - 1));
      for (let j = 0; j < M; j++) {
        oj.fromArray(oS, j * 3);
        pt.fromArray(rimS, j * 3).addScaledVector(nO, lift).addScaledVector(oj, rr * Math.cos(phi)).addScaledVector(nO, rr * Math.sin(phi));
        put(b, j, pt);
        if (b === KB - 1) pt.toArray(startOf, j * 3);
      }
    }
    ctr.addScaledVector(inward, rr);
    // 2. THE CANAL: the opening's outline carried in along the curve, narrower inward at rest, as wide as the opening
    // once it is open; down its walls soft folds, smoothed out as it stretches; its last rings rounding toward a circle
    const rEnd = Math.max(L.cervixShut * perMetre / 2, meanR * (0.45 + 0.55 * smooth(0, 1, open)));
    for (let k = 0; k < KC; k++) {
      const m = KB + k, f = k / (KC - 1), narrow = 1 - 0.55 * smooth(0, 0.35, f);
      const scale = narrow + (1 - narrow) * smooth(0, 1, open);
      if (k > 0) { dir.copy(inward).lerp(deep, smooth(0.1, 0.75, f)).normalize(); ctr.addScaledVector(dir, length / (KC - 1)); }
      else dir.copy(inward);
      turn.setFromUnitVectors(inward, dir);
      // (round within its first third: a stretched canal is a tube, not the opening's outline carried in as flat walls)
      const round = smooth(0.05, 0.35, f), fold = L.pleatDepth * smooth(0.15, 0.8, f) * (1 - 0.7 * smooth(0, 1, open));
      for (let j = 0; j < M; j++) {
        oj.fromArray(out, j * 3);
        // (the outline, less the bead, toward a circle of the canal's end width)
        const rr = Math.max(0, rimR[j] * scale) * (1 - round) + rEnd * round;
        const r = rr * (1 + fold * Math.cos(L.pleats * ang[j]));
        cj.fromArray(circ, j * 3); oj.lerp(cj, round).normalize();
        off.copy(oj).multiplyScalar(r).applyQuaternion(turn);
        pt.copy(ctr).add(off);
        // (its first rings go on from where each bead ended, easing onto the canal's own shape)
        if (k === 0) { const o = j * 3; startOf[o] -= pt.x; startOf[o + 1] -= pt.y; startOf[o + 2] -= pt.z; }
        const ease = 1 - smooth(0, 0.4, f); pt.x += startOf[j * 3] * ease; pt.y += startOf[j * 3 + 1] * ease; pt.z += startOf[j * 3 + 2] * ease;
        put(m, j, pt);
      }
    }
    // 3. THE CERVIX: a neck, its own opening dilating with hers (shut, a few millimetres; at 100%, the opening's width)
    const rCx = Math.max(L.cervixShut * perMetre / 2, 0.05 * perMetre * open);
    if (womb) {
      // 3 and 4 WITH HER WOMB (Joshua, 2026-11-01: "make it 8cm and curve it so it all works like it's supposed to be"):
      // the canal (section 2) runs its own `canal` length on its curve from the opening; the cervix goes on from its end
      // up her body; and her womb's wall is the balloon's top, its lowest part drawn to meet the cervix -- out or in --
      // over `wombMeet` degrees round it, so the canal is always its own length whatever the womb's size.
      const toGeomM = new THREE.Matrix4().copy(meshToRest).invert(), m3 = new THREE.Matrix3().setFromMatrix4(meshToRest);
      const cxStep = (L.cervix * perMetre) / KX;
      for (let k = 0; k < KX; k++) {
        const m = KB + KC + k, f = (k + 1) / KX;
        dir.copy(deep); ctr.addScaledVector(dir, cxStep); turn.setFromUnitVectors(inward, dir);
        const r = rEnd + (rCx - rEnd) * smooth(0, 0.6, f);
        for (let j = 0; j < M; j++) { oj.fromArray(circ, j * 3); off.copy(oj).multiplyScalar(r).applyQuaternion(turn); pt.copy(ctr).add(off); put(m, j, pt); }
      }
      const F = ctr.clone().applyMatrix4(meshToRest), toF = F.clone().sub(womb.centre), dF = toF.length(), down = toF.normalize();
      const wr = (d: THREE.Vector3) => sacRadius(womb!, d.x, d.y, d.z) + L.wombWall;
      const rBottom = wr(down), meet = (L.wombMeet * Math.PI) / 180;
      const rAt = (d: THREE.Vector3) => wr(d) + (dF - rBottom) * smooth(meet, 0, Math.acos(Math.max(-1, Math.min(1, d.dot(down)))));
      const th0 = Math.asin(Math.min(0.85, rCx / perMetre / Math.max(1e-4, dF)));
      // (each ring's start lined up with the cervix's last ring, so the skin does not twist)
      const U = new THREE.Vector3().fromArray(circ, 0).applyQuaternion(turn).applyMatrix3(m3);
      U.addScaledVector(down, -U.dot(down)).normalize();
      const V = new THREE.Vector3().crossVectors(down, U).normalize();
      { const q4 = new THREE.Vector3().fromArray(circ, Math.floor(M / 4) * 3).applyQuaternion(turn).applyMatrix3(m3); if (q4.dot(V) < 0) V.negate(); }
      const dirW = new THREE.Vector3(), pW = new THREE.Vector3();
      for (let k = 0; k < KW; k++) {
        const m = KB + KC + KX + k, th = th0 + (Math.PI - th0) * (k / (KW - 1)), ct = Math.cos(th), st = Math.sin(th);
        for (let j = 0; j < M; j++) {
          const ph = (2 * Math.PI * j) / M;
          dirW.copy(down).multiplyScalar(ct).addScaledVector(U, st * Math.cos(ph)).addScaledVector(V, st * Math.sin(ph)).normalize();
          pW.copy(womb.centre).addScaledVector(dirW, rAt(dirW)); wombNear[k * M + j] = nearestSkin(pW);
          pW.applyMatrix4(toGeomM); put(m, j, pW);
        }
      }
      wombFloor = F.toArray().map((x) => +x.toFixed(3));
    } else {
    const cxStep = (L.cervix * perMetre) / KX;
    for (let k = 0; k < KX; k++) {
      const m = KB + KC + k, f = (k + 1) / KX;
      dir.copy(deep); ctr.addScaledVector(dir, cxStep); turn.setFromUnitVectors(inward, dir);
      // (from the canal's width it closes to its own opening by its middle, and holds it to her womb)
      const r = rEnd + (rCx - rEnd) * smooth(0, 0.5, f);
      for (let j = 0; j < M; j++) { oj.fromArray(circ, j * 3); off.copy(oj).multiplyScalar(r).applyQuaternion(turn); pt.copy(ctr).add(off); put(m, j, pt); }
    }
    // 4. THE WOMB: a bulb from the cervix, swelling to `wombRadius` and closed over at its top
    const wStep = (L.womb * perMetre) / KW, rW = L.wombRadius * perMetre;
    for (let k = 0; k < KW; k++) {
      const m = KB + KC + KX + k, f = (k + 1) / KW;
      ctr.addScaledVector(deep, wStep); turn.setFromUnitVectors(inward, deep);
      // (a rounded bulb: from the cervix's width, up to its widest a third of the way, round shut at the top)
      const swell = f < 0.35 ? Math.sin((f / 0.35) * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((f - 0.35) / 0.65) ** 2));
      const r = f < 0.35 ? rCx + (rW - rCx) * swell : rW * swell;
      for (let j = 0; j < M; j++) { oj.fromArray(circ, j * 3); off.copy(oj).multiplyScalar(r).applyQuaternion(turn); pt.copy(ctr).add(off); put(m, j, pt); }
    }
    }
    if (!dressed) layOuter(pos, nrm); else outerLaid = false;
    openApplied = open;
  }
  /** the opening (as laid on her rest shape) handed to the GPU, and the tube's bones */
  function poseOpen(): void {
    // the area lies on her skin, carried as her skin is there: nothing to turn
    pos.set(want); nrm.set(wantNrm); tubePos.set(tubeWant);
    if (skI) skI.needsUpdate = true;
    if (skW) skW.needsUpdate = true;
    // the tube's mouth carried as the lips' edge it hangs from, deeper in more and more by her pelvis alone
    const tI = tubeGeom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, tW = tubeGeom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
    if (tI && tW && patchI && patchW) {
      const a2 = tI.array as Uint16Array, b2 = tW.array as Float32Array;
      for (let m = 0; m < K; m++) {
        // (her lips' walls and the bead as the lips' edge is carried; the canal on in by her pelvis alone, within a few rings)
        const deep = m < KB ? 0 : smooth(0, 0.12, (m - KB) / (K - 1 - KB));
        for (let j = 0; j < M; j++) {
          const o = (m * M + j) * 4, v = base[j] * 4;
          let pel = -1;
          for (let c = 0; c < 4; c++) { a2[o + c] = patchI[v + c]; b2[o + c] = patchW[v + c] * (1 - deep); if (patchI[v + c] === pelvis) pel = c; }
          // (the rolled rim and the canal's mouth carried as the edge is round about each point -- its weights evened round
          // the ring -- so posed it stays one smooth roll and does not follow each column's own bones into notches)
          if (m < KB + 4) {
            const acc = new Map<number, number>(), WR = VULVA_OPEN.rimWeightReach;
            for (let dj = -WR; dj <= WR; dj++) { const vj = base[(j + dj + M) % M] * 4, g = 1 - Math.abs(dj) / (WR + 1); for (let c = 0; c < 4; c++) { const w = patchW[vj + c] * g; if (w > 0) acc.set(patchI[vj + c], (acc.get(patchI[vj + c]) ?? 0) + w); } }
            const top = [...acc].sort((x, y) => y[1] - x[1]).slice(0, 4), sum0 = top.reduce((mm, [, w]) => mm + w, 0) || 1;
            pel = -1;
            for (let c = 0; c < 4; c++) { a2[o + c] = top[c]?.[0] ?? 0; b2[o + c] = (top[c] ? top[c][1] / sum0 : 0) * (1 - deep); if (top[c] && top[c][0] === pelvis) pel = c; }
          }
          if (pel < 0) { let low = 0; for (let c = 1; c < 4; c++) if (b2[o + c] < b2[o + low]) low = c; pel = low; a2[o + pel] = pelvis; b2[o + pel] = 0; }
          b2[o + pel] += deep;
          const sum = b2[o] + b2[o + 1] + b2[o + 2] + b2[o + 3] || 1;
          for (let c = 0; c < 4; c++) b2[o + c] /= sum;
          // (her womb's wall carried as the nearest of her belly's skin is; failing that, by the bone that carries her baby)
          if (womb && m >= KB + KC + KX) {
            const near = wombNear[(m - KB - KC - KX) * M + j];
            if (near >= 0 && bodyI && bodyW) for (let c = 0; c < 4; c++) { a2[o + c] = bodyI[near * 4 + c]; b2[o + c] = bodyW[near * 4 + c]; }
            else if (wombBone >= 0) { a2[o] = wombBone; b2[o] = 1; for (let c = 1; c < 4; c++) { a2[o + c] = 0; b2[o + c] = 0; } }
          }
        }
      }
      tI.needsUpdate = true; tW.needsUpdate = true;
    }
    if (outerLaid) {
      for (const name of ['position', 'uv', 'skinIndex', 'skinWeight']) { const a = outerGeom.getAttribute(name) as THREE.BufferAttribute | undefined; if (a) a.needsUpdate = true; }
      outerGeom.computeVertexNormals();
    }
    if (sheetLaid) {
      sheetPos.set(sheetWant);
      for (const name of ['position', 'uv', 'color', 'skinIndex', 'skinWeight']) { const a = sheetGeom.getAttribute(name) as THREE.BufferAttribute | undefined; if (a) a.needsUpdate = true; }
      sheetGeom.computeVertexNormals();
      // (its foot lies on her skin and shades as her skin does there, easing into its own over the next point)
      const na = sheetGeom.getAttribute('normal') as THREE.BufferAttribute, nv = na.array as Float32Array;
      for (let k = 0; k < 2 * NRW; k++) for (let a = 0; a < 2; a++) {
        const i = (k * NS + a) * 3, wgt = a === 0 ? 1 : 0.5;
        for (let c = 0; c < 3; c++) nv[i + c] = nv[i + c] * (1 - wgt) + sheetFootN[k * 3 + c] * wgt;
        const l = Math.hypot(nv[i], nv[i + 1], nv[i + 2]) || 1; nv[i] /= l; nv[i + 1] /= l; nv[i + 2] /= l;
      }
      na.needsUpdate = true;
    }
    (tubeGeom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    tubeGeom.computeVertexNormals();
  }



  let posVersion = -1, pushVersion = -1, shown = true, poseSig = NaN;
  /** her womb (setWomb) and the bone that carries it */
  let womb: WombShape | null = null, wombBone = -1, wombFloor: number[] = [], roundDbg: number[] = [];
  /** each point of the womb's wall carried as the nearest of her skin is (her belly moves her womb with it, so the wall
   * stays under her skin as she bends -- 2026-11-01, carried by one bone it showed through her belly) */
  const wombNear = new Int32Array(KW * M).fill(-1);
  let torsoGrid: Map<string, number[]> | null = null;
  const GRID = 0.03;
  const nearestSkin = (p: THREE.Vector3): number => {
    if (!torsoGrid) {
      torsoGrid = new Map();
      for (let i = 0; i < n; i++) {
        const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
        if (Math.abs(x) > 0.18 || y < 0.68 || y > 1.4) continue;
        const k = `${Math.floor(x / GRID)},${Math.floor(y / GRID)},${Math.floor(z / GRID)}`;
        (torsoGrid.get(k) ?? torsoGrid.set(k, []).get(k)!).push(i);
      }
    }
    const cx = Math.floor(p.x / GRID), cy = Math.floor(p.y / GRID), cz = Math.floor(p.z / GRID);
    for (let reach = 1; reach <= 4; reach++) {
      let best = -1, bd = Infinity;
      for (let a = -reach; a <= reach; a++) for (let b = -reach; b <= reach; b++) for (let c = -reach; c <= reach; c++) {
        const l = torsoGrid.get(`${cx + a},${cy + b},${cz + c}`); if (!l) continue;
        for (const i of l) { const d = (rest[i * 3] - p.x) ** 2 + (rest[i * 3 + 1] - p.y) ** 2 + (rest[i * 3 + 2] - p.z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  let wireMesh: THREE.SkinnedMesh | null = null;
  const sync = (): boolean => {
    let changed = false;
    // her influences may have been handed a new array; the patch follows the one she draws with
    if (mesh.morphTargetInfluences !== body.morphTargetInfluences) { mesh.morphTargetInfluences = body.morphTargetInfluences; mesh.morphTargetDictionary = body.morphTargetDictionary; }
    const bp = g.getAttribute('position') as THREE.BufferAttribute, bn = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    // opened, the opening's size is measured on her as she is posed: a new pose lays it out again
    let sig = 0;
    if (open > 0) {
      for (const b of body.skeleton.bones) sig = sig * 1.0001 + b.quaternion.x * 3 + b.quaternion.y * 5 + b.quaternion.z * 7 + b.quaternion.w;
      // (and her belly: the slider is a morph)
      const inf = body.morphTargetInfluences; if (inf) for (let m = 0; m < inf.length; m++) sig += inf[m] * (m + 11);
    }
    if (open > 0 && Math.abs(sig - poseSig) > 1e-6) { poseSig = sig; openApplied = -1; }
    if (bp.version !== posVersion || openApplied !== open) {
      posVersion = bp.version;
      sampleInto(restPos, bp.array, 3, bake.src, bake.bary, P);
      if (bn) {
        sampleInto(restNrm, bn.array, 3, bake.src, bake.bary, P);
        for (let p = 0; p < P; p++) { const l = Math.hypot(restNrm[p * 3], restNrm[p * 3 + 1], restNrm[p * 3 + 2]) || 1; restNrm[p * 3] /= l; restNrm[p * 3 + 1] /= l; restNrm[p * 3 + 2] /= l; }
      }
      layOpen();
      changed = true;
    }
    if (changed) {
      poseOpen();
      (geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (geom.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
    }
    const bpush = pushOf();
    if (bpush && bpush.version !== pushVersion) {
      pushVersion = bpush.version;
      sampleInto(push, bpush.array, 3, bake.src, bake.bary, P);
      const a = geom.getAttribute(PUSH_ATTRIBUTE) as THREE.BufferAttribute | undefined;
      if (a) a.needsUpdate = true;
      changed = true;
    }
    keepMat();
    if (readExtras()) changed = true;
    mesh.visible = (body.visible || api.solo) && shown;
    // (the balloon is inside her, closed: it stays whole however shut she is)
    tube.visible = mesh.visible && !api.noTube;
    sheet.visible = mesh.visible && VULVA_OPEN.sheet && !dressed && sheetLaid;
    outer.visible = mesh.visible && !dressed && outerLaid && open > 0.02;
    if (outer.morphTargetInfluences !== body.morphTargetInfluences) outer.morphTargetInfluences = body.morphTargetInfluences;
    if (outerMat.map !== patchMat.map || !outerMat.color.equals(patchMat.color)) { outerMat.map = patchMat.map; outerMat.normalMap = patchMat.normalMap; outerMat.roughnessMap = patchMat.roughnessMap; outerMat.color.copy(patchMat.color); outerMat.needsUpdate = true; }
    if (sheet.morphTargetInfluences !== body.morphTargetInfluences) sheet.morphTargetInfluences = body.morphTargetInfluences;
    if (sheetMat.map !== patchMat.map || sheetMat.normalMap !== patchMat.normalMap || !sheetMat.color.equals(patchMat.color)) { sheetMat.map = patchMat.map; sheetMat.normalMap = patchMat.normalMap; sheetMat.roughnessMap = patchMat.roughnessMap; sheetMat.color.copy(patchMat.color); sheetMat.needsUpdate = true; }
    if (tube.morphTargetInfluences !== body.morphTargetInfluences) tube.morphTargetInfluences = body.morphTargetInfluences;
    if (wireMesh) wireMesh.visible = mesh.visible;
    return changed;
  };
  const api: VulvaPatch = {
    mesh, tube, sheet, bake, sync, solo: false,
    resyncWeights() {
      const a = geom.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, b = geom.getAttribute('skinWeight') as THREE.BufferAttribute | undefined;
      if (!a || !b) return;
      sampleSkin(a.array as Uint16Array, b.array as Float32Array); a.needsUpdate = true; b.needsUpdate = true;
      ownPI = Uint16Array.from(a.array as Uint16Array); ownPW = Float32Array.from(b.array as Float32Array); openApplied = -1; sync();
    },
    worldAxes() {
      const sk = body.skeleton, m4 = new THREE.Matrix4().multiplyMatrices(body.bindMatrixInverse, new THREE.Matrix4().multiplyMatrices(sk.bones[pelvis].matrixWorld, sk.boneInverses[pelvis])).multiply(body.bindMatrix);
      const f = nO.clone().transformDirection(m4).transformDirection(mesh.matrixWorld), g = tA.clone().transformDirection(m4).transformDirection(mesh.matrixWorld);
      return { faces: f.toArray().map((x) => +x.toFixed(3)), along: g.toArray().map((x) => +x.toFixed(3)) };
    },
    facing() {
      let jm = 0, jb = 0, jf = 0, jl = -1, jr = -1;
      for (let j = 0; j < M; j++) { if (Math.abs(colQ[j]) < Math.abs(colQ[jm])) jm = j; if (colQ[j] < colQ[jb]) jb = j; if (colQ[j] > colQ[jf]) jf = j; }
      for (let j = 0; j < M; j++) { if (colSide[j] > 0 && (jl < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jl]))) jl = j; if (colSide[j] < 0 && (jr < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jr]))) jr = j; }
      const w = (v: number) => { const o = new THREE.Vector3(); mesh.getVertexPosition(v, o); return mesh.localToWorld(o); };
      const kq = Math.round(R / 3), at = w(base[jm]), along = w(base[jf]).sub(w(base[jb])), side = w(base[kq * M + jl]).sub(w(base[kq * M + jr]));
      const nn = along.clone().cross(side).normalize(), hn = new THREE.Vector3();
      mesh.getVertexPosition(base[jm], hn); // her own normal there, carried: the sign
      const nw = new THREE.Vector3().fromArray(restNrm, base[jm] * 3).transformDirection(mesh.matrixWorld);
      if (nn.dot(nw) < 0) nn.negate();
      return { at, yaw: Math.atan2(nn.x, nn.z), pitch: Math.asin(Math.max(-1, Math.min(1, nn.y))) };
    },
    debug() {
      const bad = (a: ArrayLike<number>) => { let k = 0; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) k++; return k; };
      let jl = -1, jr = -1, jb = 0, jf = 0;
      for (let j = 0; j < M; j++) { if (colQ[j] < colQ[jb]) jb = j; if (colQ[j] > colQ[jf]) jf = j; if (colSide[j] > 0 && (jl < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jl]))) jl = j; if (colSide[j] < 0 && (jr < 0 || Math.abs(colQ[j]) < Math.abs(colQ[jr]))) jr = j; }
      const dm = (a: number, c: number) => +(Math.hypot(rim[a * 3] - rim[c * 3], rim[a * 3 + 1] - rim[c * 3 + 1], rim[a * 3 + 2] - rim[c * 3 + 2]) / perMetre).toFixed(4);
      const wp = (j: number) => { const o = new THREE.Vector3(); mesh.getVertexPosition(base[j], o); return mesh.localToWorld(o); };
      const wd = (a: number, c: number) => +wp(a).distanceTo(wp(c)).toFixed(4);
      const roundness = (() => { const ps = Array.from({ length: M }, (_, j) => wp(j)), C = ps.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(M), n = new THREE.Vector3();
        for (let j = 0; j < M; j++) n.add(ps[j].clone().sub(C).cross(ps[(j + 1) % M].clone().sub(C)));
        n.normalize(); const r = ps.map((p) => { const d = p.clone().sub(C); d.addScaledVector(n, -d.dot(n)); return d.length(); });
        let jump = 0; for (let j = 0; j < M; j++) jump = Math.max(jump, Math.abs(r[j] - 0.5 * (r[(j + M - 1) % M] + r[(j + 1) % M])));
        let off = 0; for (let j = 0; j < M; j++) { const d = ps[j].clone().sub(C); off = Math.max(off, Math.abs(d.dot(n))); }
        return { rMin: +Math.min(...r).toFixed(2), rMax: +Math.max(...r).toFixed(2), jump: +jump.toFixed(3), outOfPlane: +off.toFixed(2) }; })();
      const rimSize = { roundness, roundDbg, restAcross: dm(jl, jr), restAlong: dm(jb, jf), posedAcross: wd(jl, jr), posedAlong: wd(jb, jf), heldTo, legNear: legNear.length, blocker, bulge: bulgeNow, lipMaxMm: +(lipMax * 1000).toFixed(1), lipCount, uScale, edgeDistMaxMm: +(Math.max(...Array.from(edgeDist).filter((x) => x < 1)) * 1000).toFixed(1) };
      const rimRest = new THREE.Vector3(); for (let j = 0; j < M; j++) rimRest.x += rim[j * 3] / M, rimRest.y += rim[j * 3 + 1] / M, rimRest.z += rim[j * 3 + 2] / M;
      rimRest.applyMatrix4(meshToRest);
      const lastW = new THREE.Vector3().fromArray(tubeWant, ((K - 1) * M) * 3).applyMatrix4(meshToRest), cx0 = new THREE.Vector3().fromArray(tubeWant, ((KB + KC + KX) * M) * 3).applyMatrix4(meshToRest);
      let far = 0, farI = -1; { const c0 = new THREE.Vector3(); for (let j = 0; j < M; j++) c0.x += rim[j * 3] / M, c0.y += rim[j * 3 + 1] / M, c0.z += rim[j * 3 + 2] / M; for (let i = 0; i < SV; i++) { const d = Math.hypot(sheetWant[i * 3] - c0.x, sheetWant[i * 3 + 1] - c0.y, sheetWant[i * 3 + 2] - c0.z) / perMetre; if (d > far) { far = d; farI = i; } } }
      let pfar = 0, pfarI = -1; { const c1 = new THREE.Vector3(), v1 = new THREE.Vector3(); for (let j = 0; j < M; j++) { mesh.getVertexPosition(base[j], v1); c1.addScaledVector(v1, 1 / M); } for (let i = 0; i < SV; i++) { sheet.getVertexPosition(i, v1); const d = v1.distanceTo(c1) / perMetre; if (d > pfar) { pfar = d; pfarI = i; } } }
      const sheetDbg = { pfar: +pfar.toFixed(3), prow: Math.floor(pfarI / NS), pa: pfarI % NS, pbones: Array.from(sheetI.slice(pfarI * 4, pfarI * 4 + 4)), pw: Array.from(sheetW.slice(pfarI * 4, pfarI * 4 + 4)).map((x) => +x.toFixed(2)), from: sheetFrom[pfarI], to: sheetTo[pfarI], f: +sheetF[pfarI].toFixed(2), far: +far.toFixed(3), row: Math.floor(farI / NS), a: farI % NS, bones: Array.from(sheetI.slice(farI * 4, farI * 4 + 4)), w: Array.from(sheetW.slice(farI * 4, farI * 4 + 4)).map((x) => +x.toFixed(2)) };
      const wombDbg = { sheet: sheetDbg, floor: wombFloor, centre: womb?.centre.toArray().map((x) => +x.toFixed(3)), axis: womb?.axis.toArray().map((x) => +x.toFixed(3)), rimRest: rimRest.toArray().map((x) => +x.toFixed(3)), wombRing0: cx0.toArray().map((x) => +x.toFixed(3)), top: lastW.toArray().map((x) => +x.toFixed(3)), bone: wombBone };
      return { wombDbg, rimSize, uScale, sScale, pelvisBoneGiven: pelvisBone, pelvis: body.skeleton.bones[pelvis]?.name, pelvisIndex: pelvis, restPos: bad(restPos), restNrm: bad(restNrm), rim: bad(rim), pos: bad(pos), tau: bad(tau), colQ: bad(colQ), body: bad((g.getAttribute('position') as THREE.BufferAttribute).array), O: O.toArray(), tA: tA.toArray(), nO: nO.toArray(), across: across.toArray(), perMetre, open };
    },
    get open() { return wantOpen; },
    setOpen(o: number) { wantOpen = Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 0; open = dressed ? 0 : Math.max(wantOpen, naturalOpen); sync(); },
    setNatural(o: number) {
      const n = Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 0;
      if (Math.abs(n - naturalOpen) < 0.004 && !(n === 0 && naturalOpen !== 0)) return;
      naturalOpen = n; const was = open; open = dressed ? 0 : Math.max(wantOpen, naturalOpen); if (open !== was) sync();
    },
    get drawnOpen() { return open; },
    get dressed() { return dressed; },
    setWomb(w: WombShape | null, bone = -1) {
      if (w === womb && bone === wombBone) return;
      womb = w; wombBone = bone; openApplied = -1; posVersion = -1; sync();
    },
    seeWomb(through: boolean) {
      wombMat.transparent = through; wombMat.opacity = through ? 0.14 : 1; wombMat.depthWrite = !through; wombMat.needsUpdate = true;
    },
    get heldTo() { return heldTo; },
    setDressedLips(keep: number) {
      const k = Number.isFinite(keep) ? Math.max(0, Math.min(1, keep)) : 0;
      if (Math.abs(k - dressedLips) < 1e-3) return;
      dressedLips = k;
      if (dressed) { openApplied = -1; sync(); }
    },
    setDressed(on: boolean) {
      if (on === dressed) return;
      // dressed: drawn with her own material, lying as her skin does, closed (her clothes are over it)
      dressed = on; mesh.material = on ? dressedMat : patchMat; open = on ? 0 : Math.max(wantOpen, naturalOpen); openApplied = -1; sync();
    },
    show(on: boolean) {
      shown = on;
      body.userData.allIndices = on ? keep : full;
      g.setIndex(new THREE.BufferAttribute(Uint32Array.from(on ? keep : full), 1));
      sync();
    },
    wire(on: boolean) {
      if (on && !wireMesh) {
        wireMesh = new THREE.SkinnedMesh(geom, new THREE.MeshBasicMaterial({ color: 0x1060ff, wireframe: true, depthTest: false, transparent: true, opacity: 0.6 }));
        wireMesh.frustumCulled = false; wireMesh.renderOrder = 10;
        wireMesh.position.copy(mesh.position); wireMesh.quaternion.copy(mesh.quaternion); wireMesh.scale.copy(mesh.scale);
        wireMesh.morphTargetDictionary = mesh.morphTargetDictionary; wireMesh.morphTargetInfluences = mesh.morphTargetInfluences;
        wireMesh.bind(body.skeleton, body.bindMatrix);
        mesh.parent?.add(wireMesh);
      } else if (!on && wireMesh) { wireMesh.removeFromParent(); (wireMesh.material as THREE.Material).dispose(); wireMesh = null; }
      sync();
    },
    dispose() { mesh.removeFromParent(); wireMesh?.removeFromParent(); tube.removeFromParent(); sheet.removeFromParent(); outer.removeFromParent(); outerGeom.dispose(); outerMat.dispose(); geom.dispose(); tubeGeom.dispose(); tubeMat.dispose(); wombMat.dispose(); sheetGeom.dispose(); sheetMat.dispose(); },
  };
  sync();
  return api;
}
