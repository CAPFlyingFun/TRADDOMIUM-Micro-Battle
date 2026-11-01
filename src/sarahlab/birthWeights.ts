/**
 * HER MIDDLE KEPT WITH HER PELVIS IN A BIRTH POSITION (Joshua, 2026-10-30: "isolate the hips from the torso (set masks,
 * and regions) so that the belly/pubic, etc are not modified by the legs and hips... the belly and pubic area shouldn't
 * be pinching and the hips shouldn't either"). Her skin round her crotch is weighted partly to each thigh bone, so a
 * birth position's deep hip bend (RECLINE's thighs come 92 degrees forward) dragged her pubic area, her vulva and the
 * skin behind it in between her mound and her buttocks and squashed them shut.
 *
 * A MASK per side: how much of a point belongs to her torso rather than to that thigh, by where it lies from the hip
 * joint -- inside a cone round the thigh (the thigh itself) none, outside it (her belly, pubic area, crotch, buttocks)
 * all, a band between -- and her middle (her vulva and the skin behind it) all of it whatever the cone says. In a birth
 * position that share of each thigh bone's weight is handed to her pelvis; standing, she has exactly her own weights.
 * Her body file is untouched: only the weights she is drawn with change, and back again.
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

/** GAME TUNING. */
export const BIRTH_WEIGHTS = Object.freeze({
  /** how much of each thigh's say over the masked skin goes to her pelvis in a birth position (Joshua's look at RECLINE,
   * 2026-10-30: all of it opened her vulva but stretched her inner thighs into sheets; half keeps both) */
  share: 1,
  /* (0 since RECLINE opened to 80 degrees out, 50 up, 2026-10-31: her own weights then leave her belly, mound and vulva
   * smooth, and the mask only pinched her perineum; kept for a pose that needs it) */
  /** the thigh's cone, round the line from hip joint to knee: inside `inner` degrees all thigh, outside `outer` all torso */
  inner: 38, outer: 62,
  /** her middle (metres across, either side): within `middle` all torso, out to `middleFade` fading to the cone's say --
   * near her crotch only (within `middleNear`, fading out by `middleFar`; her thighs touch her middle all the way down) */
  middle: 0.03, middleFade: 0.06, middleNear: 0.06, middleFar: 0.12,
  /** and not her mound: all of it below `moundFrom` metres above the middle of her vulva, none above `moundTo` (her
   * belly's fold onto her thighs stays her own -- Joshua, 2026-10-31, of its ragged edge) */
  moundFrom: 0.02, moundTo: 0.045,
  /**
   * HER MOUND AND LOWER BELLY ARE HER TORSO'S (Joshua, 2026-10-31: "each hip and leg are separate, and the
   * torso/belly/pubic/vagina are all together"; his references, legs up and legs wide: the belly runs smoothly into the
   * mound and the vulva, no crease). Her skin there is partly weighted to her thighs, so a deep hip bend drew her mound
   * in under her belly's fold. Above her vulva, all of it handed to her pelvis -- from `pubicFrom` above its middle,
   * fully by `pubicTo` (metres) -- across her front out to `pubicWide` (fading by `pubicWideFade`), except her thigh
   * itself: inside `thighIn` degrees of the line from hip joint to knee none, outside `thighOut` all
   */
  pubic: 1, pubicFrom: 0.015, pubicTo: 0.05, pubicWide: 0.07, pubicWideFade: 0.11, thighIn: 30, thighOut: 60,
  /** whether the thigh cone is used at all (off: only her middle -- the skin round and behind her vulva -- is kept) */
  useCone: false,
  /** which of the older terms are used (the middle strip and the mound; both off since the leotard) */
  useMiddle: false, usePubic: false,
  /**
   * THE LEOTARD (Joshua, 2026-10-31: "think of the belly, torso and pubic area as a one piece swimsuit or leotard... and
   * the legs are separated from it", drawn over his references: the line runs from her hip down her groin crease to
   * beside her vulva). Each leg opening is a plane through a point `crotchHalf` metres out from her middle at her vulva
   * and a point `hipOut` metres out from her middle and `hipUp` metres above her vulva (her hip bone's front), running front to back: her skin on the
   * torso's side of it is carried by her pelvis, the leg's by its thigh, over a band `band` metres either side
   */
  crotchHalf: 0.035, hipOut: 0.14, hipUp: 0.12, band: 0.02,
  /** ...whole from her front to `backFrom` metres behind the middle of her vulva (7 cm past its back end, beyond her
   * anus), easing by `backFade` to `backShare` of it on her lower buttocks */
  backFrom: 0.1, backFade: 0.15, backShare: 0,
  /** behind her crotch the leg opening drops this many metres for every metre back (0: straight front to back) */
  backTilt: 0,
  /** and the cone only near the hip joint (metres): out to `coneNear` all of it, gone by `coneFar` */
  coneNear: 0.14, coneFar: 0.22,
  /**
   * her weights smoothed over her skin round her groin and under her hips and buttocks in a birth position (Joshua,
   * 2026-10-31: "finish smoothening these areas"): where her buttock's skin and her thigh's meet, their weights change
   * abruptly, so a deep hip bend drove the two skins through each other in a saw-tooth seam; blurred over her mesh, the
   * two bend together into one smooth fold. Within `blurNear` of her crotch (metres) all of it, none past `blurFar`;
   * `blurPasses` times, each `blurRate` of the way to its neighbours' mean
   */
  blurNear: 0.12, blurFar: 0.2, blurPasses: 0, blurRate: 0.5,
  /** and only below her navel (metres above the hip joints): her chest and arms are no thigh's */
  above: 0.2,
  /**
   * HER HIPS RESKINNED (Joshua, 2026-11-01, marking her regions on his reference: legs, and her pubic area, vulva,
   * between her legs and her buttock cheeks; "the bones are probably correct, but the skin doesn't match"). Meshy gave
   * nearly all of each buttock to its thigh and ran the thigh's weight up beside her vulva with a hard edge; lifting one
   * leg swung the whole buttock with it. Instead of masking that, her weights there are set again: torso (her pelvis)
   * on one side of each leg opening, leg (its thigh) on the other, handed over across a soft band. Each opening is the
   * plane through three points (from the middle of her vulva, metres; x out to her side): beside her crotch
   * `openCrotch`, the top of the groin crease in front `openFront`, and the fold under her buttock behind `openBack`;
   * the band is `bandFront` either side in front widening to `bandBack` behind; then `diffuse` passes even it over
   * her skin. Her standing shape is untouched (weights only move skin as she bends).
   */
  reskin: true,
  openCrotch: [0.065, 0, 0] as const, openFront: [0.13, 0.11, 0.04] as const, openBack: [0.09, -0.03, -0.12] as const,
  bandFront: 0.05, bandBack: 0.1, diffuse: 150,
  /** how far above the middle of her vulva the reskin reaches (metres): her waist, past the tops of her buttocks */
  reskinUp: 0.3,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface BirthWeights {
  /** hand `share` (0 none .. 1 all) of each thigh's weight in the mask to her pelvis; true when anything changed */
  /** `back`: how much of her lower buttocks goes to her pelvis too (0..1; the pose's: absent, `backShare`) */
  apply(share: number, back?: number): boolean;
  /** how many of her points the mask touches at all */
  readonly touched: number;
  /** how much of a point the mask hands to her pelvis (0..1, the larger side) */
  maskOf(i: number): number;
  /** how far a point of her rest shape lies on its leg's side of its leg opening (metres; less than 0 her torso's side,
   * -Infinity outside the reskin) */
  legDistance(i: number): number;
  readonly debug: Record<string, unknown>;
}

/**
 * The mask for `mesh` (her body), from its bind: `pelvis`, `thighL`/`thighR` and `kneeL`/`kneeR` are bone indices in its
 * skeleton; `toRest` takes her geometry to her rest frame (metres, +x her left). Null when it has no skin weights.
 */
export function createBirthWeights(mesh: THREE.SkinnedMesh, toRest: THREE.Matrix4, pelvis: number, thighL: number, thighR: number, kneeL: number, kneeR: number, indices?: ArrayLike<number>): BirthWeights | null {
  const g = mesh.geometry as THREE.BufferGeometry;
  const si = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined, sw = g.getAttribute('skinWeight') as THREE.BufferAttribute | undefined, pa = g.getAttribute('position');
  if (!si || !sw || !pa || (si as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || (sw as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
  const n = pa.count, B = BIRTH_WEIGHTS;
  // a bone's bind place in her geometry's frame: bindMatrixInverse * inverse(boneInverse) * origin
  // (her bones' bind matrices are not in her geometry's units; so the joint is found from her skin itself: the middle of
  // the points that bone carries most, weighted by how much -- for a thigh, the ring of skin round its top)
  const at = (b: number) => {
    const sum = new THREE.Vector3(), q = new THREE.Vector3(); let wsum = 0;
    for (let i = 0; i < pa.count; i++) for (let c = 0; c < 4; c++) if (si.getComponent(i, c) === b) { const w = sw.getComponent(i, c); if (w < 0.5) continue; q.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest); sum.addScaledVector(q, w * w); wsum += w * w; }
    return wsum > 0 ? sum.divideScalar(wsum) : sum;
  };
  const hip = [at(thighL), at(thighR)], knee = [at(kneeL), at(kneeR)], thighs = [thighL, thighR];
  const down = [knee[0].clone().sub(hip[0]).normalize(), knee[1].clone().sub(hip[1]).normalize()];
  const hipY = (hip[0].y + hip[1].y) / 2;
  // the middle of her birth area (as birthThighs.ts finds it)
  const restAll = new Float32Array(pa.count * 3), q = new THREE.Vector3();
  for (let i = 0; i < pa.count; i++) q.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest).toArray(restAll, i * 3);
  const cc = birthAreaCentre(restAll), mAng = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180;
  const crotch = cc ? new THREE.Vector3(0, cc.y - 0.047 * Math.cos(mAng), cc.z + 0.047 * Math.sin(mAng)) : new THREE.Vector3(0, hipY - 0.08, 0);
  // each leg opening's plane (it runs front to back, so in x and y only), its normal toward the leg
  const planes = [0, 1].map((side) => {
    const sx = Math.sign(hip[side].x) || (side === 0 ? 1 : -1);
    const ax = sx * B.crotchHalf, ay = crotch.y, bx = sx * B.hipOut, by = crotch.y + B.hipUp;
    let nx = by - ay, ny = -(bx - ax);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if ((knee[side].x - ax) * nx + (knee[side].y - ay) * ny < 0) { nx = -nx; ny = -ny; }
    return { ax, ay, nx, ny };
  });
  // her own weights, as plain numbers (a quantized file stores them as normalized integers), kept to come back to
  const ownI = new Uint16Array(n * 4), ownW = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) { ownI[i * 4 + c] = si.getComponent(i, c); ownW[i * 4 + c] = sw.getComponent(i, c); }
  // the mask, per side, for points weighted to that thigh at all
  const mask = new Float32Array(n * 2), maskBack = new Float32Array(n * 2), v = new THREE.Vector3(), d = new THREE.Vector3();
  // ---- the reskin: each point's side and how much of it is leg (0 torso .. 1 leg), in the region it reaches
  const legOf = new Float32Array(n), sideOf = new Int8Array(n), inReskin = new Uint8Array(n), legDist = new Float32Array(n).fill(-Infinity);
  if (B.reskin) {
    const openings = [0, 1].map((side) => {
      const sx = Math.sign(hip[side].x) || (side === 0 ? 1 : -1);
      const pt = (o: readonly number[]) => new THREE.Vector3(crotch.x + sx * o[0], crotch.y + o[1], crotch.z + o[2]);
      const A = pt(B.openCrotch), Bf = pt(B.openFront), C = pt(B.openBack);
      const nrm = new THREE.Vector3().subVectors(Bf, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
      if (new THREE.Vector3().subVectors(knee[side], A).dot(nrm) < 0) nrm.negate();
      return { sx, A, nrm };
    });
    const kneeY = Math.max(knee[0].y, knee[1].y);
    for (let i = 0; i < n; i++) {
      v.fromArray(restAll, i * 3);
      if (v.y > crotch.y + B.reskinUp || v.y < kneeY + 0.08) continue;
      // only skin her pelvis or a thigh carries
      let pw = 0; for (let c = 0; c < 4; c++) { const b = ownI[i * 4 + c]; if (b === pelvis || b === thighs[0] || b === thighs[1]) pw += ownW[i * 4 + c]; }
      if (pw < 0.05) continue;
      const side = v.x * openings[0].sx >= 0 ? 0 : 1, o = openings[side];
      const dist = new THREE.Vector3().subVectors(v, o.A).dot(o.nrm);
      const band = B.bandFront + (B.bandBack - B.bandFront) * smooth(crotch.z, crotch.z - 0.1, v.z);
      legOf[i] = smooth(-band, band, dist); sideOf[i] = side; inReskin[i] = 1; legDist[i] = dist;
    }
    // evened over her skin (by place: a seam's copies are one point), so the handover follows her surface
    if (indices && B.diffuse > 0) {
      const km = new Map<string, number>(), kOf = new Int32Array(n).fill(-1);
      for (let i = 0; i < n; i++) if (inReskin[i]) { const k = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`; let q = km.get(k); if (q === undefined) { q = km.size; km.set(k, q); } kOf[i] = q; }
      const KR = km.size, val = new Float32Array(KR), cnt = new Float32Array(KR), fixed = new Uint8Array(KR);
      for (let i = 0; i < n; i++) if (kOf[i] >= 0) { val[kOf[i]] += legOf[i]; cnt[kOf[i]]++; }
      for (let k = 0; k < KR; k++) { val[k] /= cnt[k] || 1; if (val[k] <= 0.001 || val[k] >= 0.999) fixed[k] = 1; }
      const nb: number[][] = Array.from({ length: KR }, () => []);
      for (let t = 0; t + 2 < indices.length; t += 3) for (let q = 0; q < 3; q++) { const a = kOf[indices[t + q]], b = kOf[indices[t + (q + 1) % 3]]; if (a >= 0 && b >= 0 && a !== b) { nb[a].push(b); nb[b].push(a); } }
      const next = new Float32Array(KR);
      for (let pass = 0; pass < B.diffuse; pass++) {
        for (let k = 0; k < KR; k++) { if (fixed[k] || !nb[k].length) { next[k] = val[k]; continue; } let m = 0; for (const o of nb[k]) m += val[o]; next[k] = 0.5 * val[k] + 0.5 * (m / nb[k].length); }
        val.set(next);
      }
      for (let i = 0; i < n; i++) if (kOf[i] >= 0) legOf[i] = val[kOf[i]];
    }
  }
  let touched = 0;
  for (let i = 0; i < n; i++) {
    v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(toRest);
    if (v.y > hipY + B.above) continue;
    let any = false;
    for (let s = 0; s < 2; s++) {
      let has = false;
      for (let c = 0; c < 4; c++) if (ownI[i * 4 + c] === thighs[s] && ownW[i * 4 + c] > 0) has = true;
      if (!has) continue;
      d.copy(v).sub(hip[s]);
      const ang = (Math.acos(Math.max(-1, Math.min(1, d.dot(down[s]) / (d.length() || 1)))) * 180) / Math.PI;
      const cone = smooth(B.inner, B.outer, ang) * smooth(B.coneFar, B.coneNear, d.length()), middle = smooth(B.middleFade, B.middle, Math.abs(v.x)) * smooth(B.middleFar, B.middleNear, v.distanceTo(crotch)) * smooth(crotch.y + B.moundTo, crotch.y + B.moundFrom, v.y);
      const pubic = B.pubic * smooth(crotch.y + B.pubicFrom, crotch.y + B.pubicTo, v.y) * smooth(B.pubicWideFade, B.pubicWide, Math.abs(v.x)) * smooth(B.thighIn, B.thighOut, ang);
      // (stored against the share the scene hands over, so that all of it goes to her pelvis)
      // (the leg opening as a leotard's, Joshua 2026-11-01: "the legs are still cutting into the torso... make sure we
      // have one for the hips/thighs/legs". Straight front to back, it cut each buttock lengthwise along its underside,
      // and the strip given to the thigh swung up into her as the hip bent. Behind her crotch it now drops `backTilt`
      // metres for every metre back, so it runs under her buttock along the fold where it meets her thigh)
      const pl = planes[s], dLeg = (v.x - pl.ax) * pl.nx + (v.y - pl.ay) * pl.ny - B.backTilt * Math.max(0, crotch.z - v.z);
      // (on her lower buttocks, well behind her vulva, only part of her skin goes to her pelvis: all of it there, a deep
      // hip bend left a shelf standing out of her, and none of it changed her front; shared, her buttock bends part way
      // with her thigh and is smoothed into the rest -- Joshua, 2026-10-31: "merge it with the rest")
      // (and how much of her lower buttocks goes too is the pose's: `apply`'s `back`)
      const inBand = smooth(B.band, -B.band, dLeg), front = smooth(crotch.z - B.backFade, crotch.z - B.backFrom, v.z);
      const m = Math.max(B.useCone ? cone : 0, B.useMiddle ? middle : 0, B.usePubic ? pubic : 0, inBand * front);
      mask[i * 2 + s] = m; maskBack[i * 2 + s] = Math.max(0, inBand - m);
      if (m > 0 || maskBack[i * 2 + s] > 0) any = true;
    }
    if (any) touched++;
  }
  // the blur's region, its points welded by place (a seam's vertices share one), their neighbours, and the bones there
  const blurW = new Float32Array(n), keyOf = new Int32Array(n).fill(-1), keyMap = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    v.fromArray(restAll, i * 3);
    if (v.y > hipY + B.above) continue;
    const bw = smooth(B.blurFar, B.blurNear, v.distanceTo(crotch));
    if (bw <= 0) continue;
    blurW[i] = bw;
    const k = `${Math.round(pa.getX(i) * 1e4)},${Math.round(pa.getY(i) * 1e4)},${Math.round(pa.getZ(i) * 1e4)}`;
    let id = keyMap.get(k); if (id === undefined) { id = keyMap.size; keyMap.set(k, id); } keyOf[i] = id;
  }
  const KB = keyMap.size, nbStart: number[] = [], nbList: number[] = [];
  const keyBlur = new Float32Array(KB), bones = new Map<number, number>();
  for (let i = 0; i < n; i++) if (keyOf[i] >= 0) { keyBlur[keyOf[i]] = Math.max(keyBlur[keyOf[i]], blurW[i]); for (let c = 0; c < 4; c++) if (ownW[i * 4 + c] > 0 && !bones.has(ownI[i * 4 + c])) bones.set(ownI[i * 4 + c], bones.size); }
  if (!bones.has(pelvis)) bones.set(pelvis, bones.size);
  {
    const sets: Set<number>[] = Array.from({ length: KB }, () => new Set<number>());
    if (indices) for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = keyOf[indices[t]], b = keyOf[indices[t + 1]], c = keyOf[indices[t + 2]];
      if (a >= 0 && b >= 0) { sets[a].add(b); sets[b].add(a); }
      if (b >= 0 && c >= 0) { sets[b].add(c); sets[c].add(b); }
      if (a >= 0 && c >= 0) { sets[a].add(c); sets[c].add(a); }
    }
    for (let k = 0; k < KB; k++) { nbStart.push(nbList.length); for (const o of sets[k]) nbList.push(o); }
    nbStart.push(nbList.length);
  }
  const NB = bones.size, boneOf = [...bones.keys()];
  let shareNow = 0, backNow = -1;
  const I = si.array as ArrayLike<number> & { [k: number]: number }, W = sw.array as ArrayLike<number> & { [k: number]: number };
  const normalized = sw.normalized, scale = normalized ? (W instanceof Uint8Array ? 255 : W instanceof Uint16Array ? 65535 : 1) : 1;
  return {
    touched,
    debug: { hip: hip.map((h) => h.toArray().map((x) => +x.toFixed(3))), knee: knee.map((h) => h.toArray().map((x) => +x.toFixed(3))), crotch: crotch.toArray().map((x) => +x.toFixed(3)), planes },
    legDistance: (i: number) => legDist[i],
    maskOf: (i: number) => B.reskin ? (inReskin[i] ? 1 - legOf[i] : 0) : Math.max(mask[i * 2] + maskBack[i * 2] * Math.max(0, backNow), mask[i * 2 + 1] + maskBack[i * 2 + 1] * Math.max(0, backNow)),
    apply(share: number, back: number = B.backShare): boolean {
      share = Math.max(0, Math.min(1, share)); back = Math.max(0, Math.min(1, back));
      if (share === shareNow && back === backNow) return false;
      shareNow = share; backNow = back;
      const w = [0, 0, 0, 0], ix = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        if (B.reskin) {
          if (!inReskin[i]) continue;
          // her pelvis's and thighs' share of the point, split again: leg to this side's thigh, the rest to her pelvis;
          // any other bone's weight kept; blended from her own by `share`
          const acc = new Map<number, number>();
          let pw = 0;
          for (let c = 0; c < 4; c++) { const b = ownI[i * 4 + c], wv = ownW[i * 4 + c]; if (wv <= 0) continue; if (b === pelvis || b === thighs[0] || b === thighs[1]) pw += wv; else acc.set(b, (acc.get(b) ?? 0) + wv); }
          const target = new Map(acc), th = thighs[sideOf[i]];
          target.set(th, (target.get(th) ?? 0) + pw * legOf[i]); target.set(pelvis, (target.get(pelvis) ?? 0) + pw * (1 - legOf[i]));
          const mix = new Map<number, number>();
          for (let c = 0; c < 4; c++) { const b = ownI[i * 4 + c], wv = ownW[i * 4 + c]; if (wv > 0) mix.set(b, (mix.get(b) ?? 0) + wv * (1 - share)); }
          for (const [b, wv] of target) mix.set(b, (mix.get(b) ?? 0) + wv * share);
          const top = [...mix].filter(([, wv]) => wv > 1e-5).sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((m, [, wv]) => m + wv, 0) || 1;
          for (let c = 0; c < 4; c++) { const e = top[c]; I[i * 4 + c] = e ? e[0] : 0; const wv = e ? e[1] / sum : 0; W[i * 4 + c] = normalized && scale > 1 ? Math.round(wv * scale) : wv; }
          continue;
        }
        const mL = mask[i * 2] + maskBack[i * 2] * back, mR = mask[i * 2 + 1] + maskBack[i * 2 + 1] * back;
        if (mL <= 0 && mR <= 0) { if (keyOf[i] >= 0) for (let c = 0; c < 4; c++) { I[i * 4 + c] = ownI[i * 4 + c]; W[i * 4 + c] = normalized && scale > 1 ? Math.round(ownW[i * 4 + c] * scale) : ownW[i * 4 + c]; } continue; }
        let moved = 0, pel = -1, low = 0;
        for (let c = 0; c < 4; c++) {
          ix[c] = ownI[i * 4 + c]; w[c] = ownW[i * 4 + c];
          const m = ix[c] === thighL ? mL : ix[c] === thighR ? mR : 0;
          if (m > 0) { const take = w[c] * Math.min(1, m * share); w[c] -= take; moved += take; }
          if (ix[c] === pelvis && ownW[i * 4 + c] > 0) pel = c;
        }
        if (pel < 0) { for (let c = 1; c < 4; c++) if (w[c] < w[low]) low = c; pel = low; moved += w[pel]; w[pel] = 0; ix[pel] = pelvis; }
        w[pel] += moved;
        const sum = w[0] + w[1] + w[2] + w[3] || 1;
        for (let c = 0; c < 4; c++) { I[i * 4 + c] = ix[c]; W[i * 4 + c] = normalized && scale > 1 ? Math.round((w[c] / sum) * scale) : w[c] / sum; }
      }
      // then blurred over her skin there, as much as the share says
      if (share > 0 && KB && indices) {
        const kw = new Float32Array(KB * NB), cnt = new Float32Array(KB);
        for (let i = 0; i < n; i++) {
          const k = keyOf[i]; if (k < 0) continue;
          for (let c = 0; c < 4; c++) { const wv = normalized && scale > 1 ? W[i * 4 + c] / scale : W[i * 4 + c]; if (wv > 0) { const bi = bones.get(I[i * 4 + c]); if (bi !== undefined) kw[k * NB + bi] += wv; } }
          cnt[k]++;
        }
        for (let k = 0; k < KB; k++) if (cnt[k] > 1) for (let b = 0; b < NB; b++) kw[k * NB + b] /= cnt[k];
        const next = new Float32Array(KB * NB);
        for (let pass = 0; pass < B.blurPasses; pass++) {
          for (let k = 0; k < KB; k++) {
            const s0 = nbStart[k], s1 = nbStart[k + 1], rate = B.blurRate * keyBlur[k] * share;
            if (s1 === s0 || rate <= 0) { for (let b = 0; b < NB; b++) next[k * NB + b] = kw[k * NB + b]; continue; }
            for (let b = 0; b < NB; b++) {
              let m = 0;
              for (let e = s0; e < s1; e++) m += kw[nbList[e] * NB + b];
              m /= s1 - s0;
              next[k * NB + b] = kw[k * NB + b] + rate * (m - kw[k * NB + b]);
            }
          }
          kw.set(next);
        }
        // back on every vertex of each point: its four strongest, summing to one
        const order = Array.from({ length: NB }, (_, b) => b);
        for (let i = 0; i < n; i++) {
          const k = keyOf[i]; if (k < 0) continue;
          order.sort((a, b) => kw[k * NB + b] - kw[k * NB + a]);
          let sum = 0; for (let c = 0; c < 4; c++) sum += kw[k * NB + order[c]] || 0;
          sum = sum || 1;
          for (let c = 0; c < 4; c++) { const b = order[c], wv = b !== undefined ? (kw[k * NB + b] || 0) / sum : 0; I[i * 4 + c] = b !== undefined ? boneOf[b] : 0; W[i * 4 + c] = normalized && scale > 1 ? Math.round(wv * scale) : wv; }
        }
      }
      si.needsUpdate = true; sw.needsUpdate = true;
      return true;
    },
  };
}
