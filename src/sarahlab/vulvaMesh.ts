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
  bead: 0.004, lipWall: 0.008, wombWall: 0.003, wombMeet: 65, wallSkin: 0xd09a88, wallPink: 0xc0646e, pleats: 4, pleatDepth: 0.22, cervix: 0.025, cervixShut: 0.006, womb: 0.13, wombRadius: 0.065,
  /** BIOLOGICAL SHAPE (Joshua's estimate, to tune): how far the area bulges out at the full opening (metres; a half sphere,
   * its last `bulgeFoot` share easing onto her skin), and how it
   * grows with the opening (power of the open share: 1 straight, more later) */
  bulge: 0.05, bulgeEase: 1.3, bulgeFoot: 0.25,
  /** GAME TUNING: passes evening the opening's edge round its outline */
  edgeSmooth: 6,
  /** GAME TUNING: how much the bear trap's corners at its hinges are rounded (0 a sharp lens, 1 an oval) */
  hingeRound: 0.3,
  /** GAME TUNING: how much more her skin is evened round the opening at its ends, where the jaws hinge, as it opens */
  hingeSmooth: 1.2,
  /**
   * THE LIPS (Joshua, 2026-10-31: "the vagina should look like the lips... you also have the mouth animated that can open
   * and close"): as her mouth is made -- her own skin, shaped round and opened, the inside painted where it shows. Each
   * outer lip a rounded rise `rise` metres high and `width` metres across beside the split, its edge `tuck` metres in
   * where the two meet (the groove), flattening `flatten` of the way as it stretches open; and from the edge in
   * `inner` metres her skin turns the colour of the inside (a tint on her own skin, as her lips' inner edge is),
   * darkest right at the edge. Its crest stands `crest` metres back from the edge; opening, the edge curls `roll` metres
   * on down into the opening, so the lip's inner face shows (see `lipHeight`)
   */
  rise: 0.015, crest: 0.006, width: 0.028, tuck: 0.0008, flatten: 0.3, inner: 0.005, roll: 0, maxTip: 1.2, edgeRound: 0.35,
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
  readonly bake: VulvaBake;
  /** read her shape (and her baby's push) back onto the area if either changed; true when it did */
  sync(): boolean;
  /** her own skin back (false) or the rebuilt area (true): for comparing the two */
  show(on: boolean): void;
  /** the rebuilt area's triangles drawn over it, for looking at the mesh itself */
  wire(on: boolean): void;
  /** how open (0 closed .. 1 a 10 cm circle, crowning): slit, then oval, then round, the area doming out round it */
  setOpen(open: number): void;
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
  let open = 0, openApplied = -1, wantOpen = 0, dressed = false, dressedLips = 0;

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
      if (m < KL) c3.copy(skinC).lerp(pinkC, ss(0, 1, m / (KL - 1)));
      else if (m < KB) c3.copy(pinkC);
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
    h *= taper;
    const closed = 1 - smooth(0, 0.3, open), opening = smooth(0, 0.15, open);
    const tuck = L.tuck * smooth(c, 0, d) * closed * taper;
    const curl = L.roll * (1 - d / c) ** 2 * (d < c ? 1 : 0) * opening * smooth(1, 0.6, t);
    return h - tuck - curl;
  };
  const sculptLips = (at: Float32Array, n: Float32Array) => {
    // dressed, as much of the lips' shape as shows through what is over them (VULVA DETAIL: 0 her own skin's shape
    // exactly, 1 all of it); what is painted on her lies over it as it does on the rest of her
    const amp = dressed ? dressedLips : 1;
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
    for (let k = 0; k < KL; k++) {
      const f = k / (KL - 1);
      for (let j = 0; j < M; j++) { wv.fromArray(wallDir, j * 3); pt.fromArray(rim, j * 3).addScaledVector(wv, wallIn * f); put(k, j, pt); }
    }
    for (let b = 0; b < KB - KL; b++) {
      const phi = ((b + 1) / (KB - KL)) * Math.PI;
      for (let j = 0; j < M; j++) {
        oj.fromArray(out, j * 3);
        // (a half round bulging in toward the middle: from the wall's foot, in by `bead`, back out a bead's width deeper)
        wv.fromArray(wallDir, j * 3);
        pt.fromArray(rim, j * 3).addScaledVector(wv, wallIn + rb - rb * Math.cos(phi)).addScaledVector(oj, -rb * Math.sin(phi));
        put(KL + b, j, pt);
        if (b === KB - KL - 1) pt.toArray(startOf, j * 3);
      }
    }
    ctr.addScaledVector(inward, wallIn + 2 * rb);
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
    (tubeGeom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    tubeGeom.computeVertexNormals();
  }



  let posVersion = -1, pushVersion = -1, shown = true, poseSig = NaN;
  /** her womb (setWomb) and the bone that carries it */
  let womb: WombShape | null = null, wombBone = -1, wombFloor: number[] = [];
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
    if (tube.morphTargetInfluences !== body.morphTargetInfluences) tube.morphTargetInfluences = body.morphTargetInfluences;
    if (wireMesh) wireMesh.visible = mesh.visible;
    return changed;
  };
  const api: VulvaPatch = {
    mesh, tube, bake, sync, solo: false,
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
      const rimSize = { restAcross: dm(jl, jr), restAlong: dm(jb, jf), posedAcross: wd(jl, jr), posedAlong: wd(jb, jf), heldTo, legNear: legNear.length, blocker, bulge: bulgeNow, lipMaxMm: +(lipMax * 1000).toFixed(1), lipCount, uScale, edgeDistMaxMm: +(Math.max(...Array.from(edgeDist).filter((x) => x < 1)) * 1000).toFixed(1) };
      const rimRest = new THREE.Vector3(); for (let j = 0; j < M; j++) rimRest.x += rim[j * 3] / M, rimRest.y += rim[j * 3 + 1] / M, rimRest.z += rim[j * 3 + 2] / M;
      rimRest.applyMatrix4(meshToRest);
      const lastW = new THREE.Vector3().fromArray(tubeWant, ((K - 1) * M) * 3).applyMatrix4(meshToRest), cx0 = new THREE.Vector3().fromArray(tubeWant, ((KB + KC + KX) * M) * 3).applyMatrix4(meshToRest);
      const wombDbg = { floor: wombFloor, centre: womb?.centre.toArray().map((x) => +x.toFixed(3)), axis: womb?.axis.toArray().map((x) => +x.toFixed(3)), rimRest: rimRest.toArray().map((x) => +x.toFixed(3)), wombRing0: cx0.toArray().map((x) => +x.toFixed(3)), top: lastW.toArray().map((x) => +x.toFixed(3)), bone: wombBone };
      return { wombDbg, rimSize, uScale, sScale, pelvisBoneGiven: pelvisBone, pelvis: body.skeleton.bones[pelvis]?.name, pelvisIndex: pelvis, restPos: bad(restPos), restNrm: bad(restNrm), rim: bad(rim), pos: bad(pos), tau: bad(tau), colQ: bad(colQ), body: bad((g.getAttribute('position') as THREE.BufferAttribute).array), O: O.toArray(), tA: tA.toArray(), nO: nO.toArray(), across: across.toArray(), perMetre, open };
    },
    get open() { return wantOpen; },
    setOpen(o: number) { wantOpen = Number.isFinite(o) ? Math.max(0, Math.min(1, o)) : 0; open = dressed ? 0 : wantOpen; sync(); },
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
      dressed = on; mesh.material = on ? dressedMat : patchMat; open = on ? 0 : wantOpen; openApplied = -1; sync();
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
    dispose() { mesh.removeFromParent(); wireMesh?.removeFromParent(); tube.removeFromParent(); geom.dispose(); tubeGeom.dispose(); tubeMat.dispose(); wombMat.dispose(); },
  };
  sync();
  return api;
}
