/**
 * HER BIRTH AREA, SHAPED (Joshua, 2026-10-30, with a close view of her model's 100% render: "can use more realistic
 * accuracy as well"). Her approved body has only a smooth strip there, about 1.5 cm wide and 4 cm long between the
 * creases of her thighs, at every size (measured against the unmodified sculpt). His reference shows a soft rounded mound
 * that ends, at its lower front, in a short cleft running down and under toward the back, with a soft fold either side.
 *
 * This shapes that: a field (a `shape:` field like her others, laid on the CPU, her approved file untouched) moving each
 * point of the area along its own normal -- in for the cleft, a little out for the folds either side, smooth all round,
 * nothing beyond the area -- the same at every belly size (it rides on whatever the belly shapes do to the area, and
 * they move it all but rigidly). Later the dilation opens out of this cleft.
 *
 * Measured in her REST frame (metres, +y up, +z her front, +x her left), from where the area is on her: the lowest
 * point of her middle between her thighs. Everything here is GAME TUNING, read from the reference.
 */
import * as THREE from 'three';

/** Two fields: the cleft (in), and the folds either side of it and the mound (out) -- the folds fuller only while nothing is worn over them. */
export const BIRTH_CLEFT_FIELD = 'shape:birthCleft', BIRTH_LIPS_FIELD = 'shape:birthLips';
export type BirthPart = 'cleft' | 'lips';
/** The folds' share while she wears something over them (a fitted bottom is about 3 mm off her skin). GAME TUNING. */
export const LIPS_COVERED = 0.3;

export const BIRTH_AREA = Object.freeze({
  /** the middle the cleft runs round (rest metres above and in front of her crotch's lowest point) */
  centreUp: 0.048, centreForward: 0.004,
  /** where the cleft runs, as angles round that middle (degrees; 0 straight down, + toward her front) */
  front: 44, back: -36,
  /** over how much of each end it fades in (degrees) */
  ease: 14,
  /**
   * the cleft: how deep (rest metres) and how wide (its half width, metres) -- a narrow crease where the two folds meet
   * (Joshua, 2026-10-30: "let each side touch"), the split itself drawn by its shading (`patchBirthShade`): her mesh there
   * has a vertex only every 2 to 4 mm either side of the middle line, too coarse to cut an open groove that is not jagged
   */
  depth: 0.0016, width: 0.0011,
  /** the folds either side, rounded like lips and meeting in the middle: how far out (metres), how far from the middle and how wide */
  fold: 0.0034, foldAt: 0.0038, foldWidth: 0.005,
  /** nothing further than this from her middle (metres), nor where the skin does not face out of the area */
  reach: 0.014, facing: 0.45,
  /** the mound above it a little rounder: how much (metres) and how wide (metres either side) */
  mound: 0.0012, moundWidth: 0.02,
  /** how many times the move is smoothed over her mesh */
  smoothPasses: 16,
});

/** how many times the turned normals are smoothed over her mesh. GAME TUNING. */
const BIRTH_NORMAL_PASSES = 3;

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The field: for her rest points and normals (metres, three a point), each moved point's index and its move (metres,
 * rest frame). `rest`'s crotch is found from the points themselves. Empty when there is no crotch to find.
 */
export function birthAreaField(rest: ArrayLike<number>, normals: ArrayLike<number>, part: BirthPart | 'both' = 'both'): { index: Uint32Array; move: Float32Array } {
  const n = Math.floor(rest.length / 3), A = BIRTH_AREA;
  // her crotch's lowest point on her middle: the lowest of the points within a few millimetres of it, near her centre front-to-back
  let low = -1, lowY = Infinity, zMid = 0, count = 0;
  for (let i = 0; i < n; i++) { const x = rest[i * 3]; if (Math.abs(x) < 0.003) { zMid += rest[i * 3 + 2]; count++; } }
  if (!count) return { index: new Uint32Array(0), move: new Float32Array(0) };
  zMid /= count;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    // between her thighs, under her pelvis: the middle's lowest point not on a leg (a leg's middle is not at x = 0)
    if (Math.abs(x) < 0.003 && Math.abs(z - zMid) < 0.06 && y < lowY && y > 0.5) { lowY = y; low = i; }
  }
  if (low < 0) return { index: new Uint32Array(0), move: new Float32Array(0) };
  const cy = rest[low * 3 + 1] + A.centreUp, cz = rest[low * 3 + 2] + A.centreForward;
  const deg = Math.PI / 180, idx: number[] = [], mv: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    if (Math.abs(x) > A.moundWidth) continue;
    const dy = y - cy, dz = z - cz, r = Math.hypot(dy, dz);
    if (r < 0.02 || r > 0.1) continue;
    // its skin must face out of the area (down, forward or back round the middle), not sideways (her inner thighs)
    const ny = normals[i * 3 + 1], nz = normals[i * 3 + 2], nx = normals[i * 3];
    // (eased in, not cut: a hard edge here ran along her folds' outer sides, and close up their outline was ragged)
    const facing = smooth(A.facing - 0.25, A.facing + 0.1, (ny * dy + nz * dz) / r);
    if (facing <= 0) continue;
    const ang = Math.atan2(dz, -dy) / deg;
    const along = smooth(A.back - A.ease, A.back + A.ease * 0.4, ang) * (1 - smooth(A.front - A.ease * 0.4, A.front + A.ease, ang));
    // the mound: above the cleft's front, a little rounder
    const mound = A.mound * Math.exp(-((x / A.moundWidth) ** 2) * 3) * smooth(A.front - 10, A.front + 6, ang) * (1 - smooth(A.front + 20, A.front + 40, ang));
    const u = Math.abs(x);
    let out = part === 'cleft' ? 0 : mound * facing;
    if (along > 0 && u < A.reach) {
      const cleft = part === 'lips' ? 0 : -A.depth * Math.exp(-((u / A.width) ** 2));
      const fold = part === 'cleft' ? 0 : A.fold * Math.exp(-(((u - A.foldAt) / A.foldWidth) ** 2));
      out += facing * along * (cleft + fold) * (1 - smooth(A.reach * 0.7, A.reach, u));
    }
    if (Math.abs(out) < 1e-6) continue;
    idx.push(i); mv.push(nx * out, ny * out, nz * out);
  }
  return { index: Uint32Array.from(idx), move: Float32Array.from(mv) };
}

/**
 * The field as one of her mesh's shape fields: points in its own units (`toRest` takes them to her rest frame), the move
 * back in its units -- and how her normals turn with it (the cleft is seen by its shading, not only its edge): each
 * moved point's and its neighbours' normal worked out again from her triangles, the change from her own kept.
 */
export function birthAreaShapeField(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, indices: ArrayLike<number>, toRest: THREE.Matrix4, part: BirthPart | 'both' = 'both'): { index: Uint32Array; pos: Float32Array; nrm: Float32Array } {
  const n = Math.floor(basePos.length / 3), rest = new Float32Array(n * 3), nrm = new Float32Array(n * 3), v = new THREE.Vector3();
  const lin = new THREE.Matrix3().setFromMatrix4(toRest), back = lin.clone().invert(), normalM = new THREE.Matrix3().getNormalMatrix(toRest);
  for (let i = 0; i < n; i++) {
    v.set(basePos[i * 3], basePos[i * 3 + 1], basePos[i * 3 + 2]).applyMatrix4(toRest); rest[i * 3] = v.x; rest[i * 3 + 1] = v.y; rest[i * 3 + 2] = v.z;
    v.set(baseNrm[i * 3], baseNrm[i * 3 + 1], baseNrm[i * 3 + 2]).applyMatrix3(normalM).normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z;
  }
  const f = birthAreaField(rest, nrm, part), moved = new Float32Array(n * 3), any = new Uint8Array(n);
  // the move smoothed over her mesh (each point toward its neighbours', a few passes): her mesh is fine along her middle
  // line and coarse either side of it, and the raw field drawn on it reads as a jagged crack
  // MOVED ALONG ONE SMOOTH WAY, NOT EACH POINT'S NORMAL (close up, her middle line's thin slivers each turned a different
  // way and folded over as she moved): straight out from the middle the cleft runs round, the same for points side by side
  const centre = birthAreaCentre(rest), along = new Float32Array(nrm);
  if (centre) for (let i = 0; i < n; i++) {
    const dy = rest[i * 3 + 1] - centre.y, dz = rest[i * 3 + 2] - centre.z, r = Math.hypot(dy, dz);
    if (r > 1e-6) { along[i * 3] = 0; along[i * 3 + 1] = dy / r; along[i * 3 + 2] = dz / r; }
  }
  const amount = new Float32Array(n), twin = new Map<string, number[]>();
  for (let k = 0; k < f.index.length; k++) { const i = f.index[k]; amount[i] = f.move[k * 3] * nrm[i * 3] + f.move[k * 3 + 1] * nrm[i * 3 + 1] + f.move[k * 3 + 2] * nrm[i * 3 + 2]; }
  {
    const near = new Map<number, Set<number>>(), add = (a: number, b: number) => { (near.get(a) ?? near.set(a, new Set()).get(a)!).add(b); };
    const wide = new Uint8Array(n); for (const i of f.index) wide[i] = 1;
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = indices[t], b = indices[t + 1], c = indices[t + 2];
      if (wide[a] || wide[b] || wide[c]) { add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b); }
    }
    // seam twins (one point, several vertices) count as one: each takes the others' neighbours
    twin.clear();
    for (const i of near.keys()) { const k = `${Math.round(basePos[i * 3] * 1e5)},${Math.round(basePos[i * 3 + 1] * 1e5)},${Math.round(basePos[i * 3 + 2] * 1e5)}`; (twin.get(k) ?? twin.set(k, []).get(k)!).push(i); }
    for (const group of twin.values()) if (group.length > 1) { const all = new Set<number>(); for (const i of group) for (const j of near.get(i)!) all.add(j); for (const i of group) near.set(i, all); }
    const next = new Float32Array(n);
    for (let pass = 0; pass < BIRTH_AREA.smoothPasses; pass++) {
      next.set(amount);
      for (const [i, ns] of near) { let sum = 0; for (const j of ns) sum += amount[j]; next[i] = 0.5 * amount[i] + 0.5 * (sum / Math.max(1, ns.size)); }
      amount.set(next);
    }
    // SEAM TWINS MOVE AS ONE (Joshua, 2026-10-30, close up: "it still appears like the skin is tearing"): her middle line
    // is an atlas seam, each point there two vertices; moved by different amounts, they parted by a hair and her skin
    // showed cracks. One amount for every vertex of a point (and one way, the radial one above).
    // (every vertex of her mesh at a moved point: a twin can sit outside the moved triangles' ring, and left behind it opens
    // the seam just the same)
    const everyAt = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { const k = `${Math.round(basePos[i * 3] * 1e5)},${Math.round(basePos[i * 3 + 1] * 1e5)},${Math.round(basePos[i * 3 + 2] * 1e5)}`; const g = everyAt.get(k); if (g) g.push(i); else everyAt.set(k, [i]); }
    for (const group of everyAt.values()) {
      if (group.length < 2) continue;
      const moving = group.filter((i) => near.has(i));
      if (!moving.length) continue;
      let a = 0;
      for (const i of moving) a += amount[i];
      a /= moving.length;
      for (const i of group) amount[i] = a;
    }
  }
  const lay = () => {
    for (let i = 0; i < n; i++) {
      if (Math.abs(amount[i]) < 1e-6) { moved[i * 3] = moved[i * 3 + 1] = moved[i * 3 + 2] = 0; continue; }
      v.set(along[i * 3] * amount[i], along[i * 3 + 1] * amount[i], along[i * 3 + 2] * amount[i]).applyMatrix3(back);
      moved[i * 3] = v.x; moved[i * 3 + 1] = v.y; moved[i * 3 + 2] = v.z; any[i] = 1;
    }
  };
  lay();
  // NO TRIANGLE FOLDED OVER (close up, her middle line's thin slivers turned inside out showed as pale specks): wherever
  // one would turn over, its points move less -- a few times, until none does
  {
    const where = (i: number, w: boolean, out: THREE.Vector3) => out.set(basePos[i * 3] + (w ? moved[i * 3] : 0), basePos[i * 3 + 1] + (w ? moved[i * 3 + 1] : 0), basePos[i * 3 + 2] + (w ? moved[i * 3 + 2] : 0));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
    const key = (i: number) => `${Math.round(basePos[i * 3] * 1e5)},${Math.round(basePos[i * 3 + 1] * 1e5)},${Math.round(basePos[i * 3 + 2] * 1e5)}`;
    const groupOf = new Map<string, number[]>();
    for (let i = 0; i < n; i++) if (any[i]) { const k = key(i); (groupOf.get(k) ?? groupOf.set(k, []).get(k)!).push(i); }
    for (let round = 0; round < 12; round++) {
      const ease = new Set<number>();
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const i = indices[t], j = indices[t + 1], k = indices[t + 2];
        if (!any[i] && !any[j] && !any[k]) continue;
        n0.subVectors(where(j, false, b), where(i, false, a)).cross(where(k, false, c).sub(a));
        n1.subVectors(where(j, true, b), where(i, true, a)).cross(where(k, true, c).sub(a));
        if (n0.dot(n1) <= 0.2 * n0.lengthSq()) { ease.add(i); ease.add(j); ease.add(k); }
      }
      if (!ease.size) break;
      for (const i of ease) for (const t of groupOf.get(key(i)) ?? [i]) amount[t] *= 0.6;
      lay();
    }
  }
  // the triangles touching a moved point, and every point of them: their normals turn
  const tris: number[] = [], touched = new Uint8Array(n);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2];
    if (any[a] || any[b] || any[c]) { tris.push(a, b, c); touched[a] = touched[b] = touched[c] = 1; }
  }
  // (a point on an atlas seam is several vertices in one place: the ones there share their triangles' normals)
  const key = (i: number) => `${Math.round(basePos[i * 3] * 1e5)},${Math.round(basePos[i * 3 + 1] * 1e5)},${Math.round(basePos[i * 3 + 2] * 1e5)}`;
  const sums = (withMove: boolean) => {
    const acc = new Map<string, THREE.Vector3>(), p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < tris.length; t += 3) {
      for (let k = 0; k < 3; k++) { const i = tris[t + k]; p[k].set(basePos[i * 3], basePos[i * 3 + 1], basePos[i * 3 + 2]); if (withMove) p[k].add(v.set(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2])); }
      const fn = e1.subVectors(p[1], p[0]).cross(e2.subVectors(p[2], p[0]));
      for (let k = 0; k < 3; k++) { const kk = key(tris[t + k]); (acc.get(kk) ?? acc.set(kk, new THREE.Vector3()).get(kk)!).add(fn); }
    }
    return acc;
  };
  // each fan's normal smoothed over its neighbours' a few times, before and after alike (close up, the folds' outer sides
  // read as torn: on her uneven mesh there, one sliver's fan turned a different way from the next and lit as a speck)
  const nearKey = new Map<string, Set<string>>();
  for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
    const a0 = key(tris[t + k]); const s0 = nearKey.get(a0) ?? nearKey.set(a0, new Set()).get(a0)!;
    s0.add(key(tris[t + (k + 1) % 3])); s0.add(key(tris[t + (k + 2) % 3]));
  }
  const soften = (acc: Map<string, THREE.Vector3>) => {
    for (const nv of acc.values()) nv.normalize();
    for (let pass = 0; pass < BIRTH_NORMAL_PASSES; pass++) {
      const next = new Map<string, THREE.Vector3>();
      for (const [kk, nv] of acc) { const m = nv.clone(); for (const o of nearKey.get(kk) ?? []) { const w = acc.get(o); if (w) m.add(w); } next.set(kk, m.normalize()); }
      for (const [kk, nv] of next) acc.get(kk)!.copy(nv);
    }
    return acc;
  };
  const before = soften(sums(false)), after = soften(sums(true));
  const idx: number[] = [], pos: number[] = [], nd: number[] = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    if (!touched[i]) continue;
    const kk = key(i), A = before.get(kk), B = after.get(kk);
    // only a point whose triangles are all here is worked out again (its fan is whole); its normal turned as its fan turned
    let dn = [0, 0, 0];
    if (A && B && A.lengthSq() > 0 && B.lengthSq() > 0) {
      const q = new THREE.Quaternion().setFromUnitVectors(a.copy(A).normalize(), b.copy(B).normalize());
      const own = new THREE.Vector3(baseNrm[i * 3], baseNrm[i * 3 + 1], baseNrm[i * 3 + 2]), turned = own.clone().applyQuaternion(q);
      dn = [turned.x - own.x, turned.y - own.y, turned.z - own.z];
    }
    if (!any[i] && Math.abs(dn[0]) + Math.abs(dn[1]) + Math.abs(dn[2]) < 1e-6) continue;
    idx.push(i); pos.push(moved[i * 3], moved[i * 3 + 1], moved[i * 3 + 2]); nd.push(dn[0], dn[1], dn[2]);
  }
  return { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: Float32Array.from(nd) };
}

/**
 * THE SPLIT, SEEN (Joshua, 2026-10-30: "more defined... more obvious split like lips"). Her mesh there is fine along her
 * middle line and coarse either side, so the cleft's depth alone stays soft; what reads as a split is its shading. Her
 * skin is darkened along the cleft's middle and a little into it, as a crease's own shadow (light and sheen alike, a little
 * warm) -- worked out in her skin's vertex shader from where each point is in her rest frame (her skin's material has no room for
 * another attribute), by `uBirthShade` (0 while anything is worn over it). GAME TUNING.
 */
export const BIRTH_SHADE = Object.freeze({ middle: 0.6, width: 0.0014, inner: 0.22, innerWidth: 0.0042, tint: [0.5, 0.4, 0.4] as const });

/** The middle her cleft runs round (rest metres: y, z), from her rest points; null with no crotch to find. */
export function birthAreaCentre(rest: ArrayLike<number>): { y: number; z: number } | null {
  const n = Math.floor(rest.length / 3);
  let zMid = 0, count = 0, lowY = Infinity, lowZ = 0;
  for (let i = 0; i < n; i++) if (Math.abs(rest[i * 3]) < 0.003) { zMid += rest[i * 3 + 2]; count++; }
  if (!count) return null;
  zMid /= count;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    if (Math.abs(x) < 0.003 && Math.abs(z - zMid) < 0.06 && y < lowY && y > 0.5) { lowY = y; lowZ = z; }
  }
  return Number.isFinite(lowY) ? { y: lowY + BIRTH_AREA.centreUp, z: lowZ + BIRTH_AREA.centreForward } : null;
}

/** How dark a point of her (rest metres) is on the split (0..1): what the shader works out, for tests and the CPU. */
export function birthShadeAt(x: number, y: number, z: number, centre: { y: number; z: number }): number {
  const A = BIRTH_AREA, S = BIRTH_SHADE, dy = y - centre.y, dz = z - centre.z, r = Math.hypot(dy, dz);
  if (r < 0.02 || r > 0.1) return 0;
  const ang = Math.atan2(dz, -dy) * 180 / Math.PI;
  const along = smooth(A.back - A.ease, A.back + A.ease * 0.4, ang) * (1 - smooth(A.front - A.ease * 0.4, A.front + A.ease, ang));
  const u = Math.abs(x);
  return along * Math.min(1, S.middle * Math.exp(-((u / S.width) ** 2)) + S.inner * Math.exp(-((u / S.innerWidth) ** 2)));
}

export interface BirthShadeUniforms {
  /** how much shows (0..1) */
  readonly shade: { value: number };
  /** the middle the cleft runs round (rest metres: x unused, y, z) */
  readonly centre: { value: THREE.Vector3 };
  /** her geometry to her rest frame (the same matrix the kicks use) */
  readonly rest: { value: THREE.Matrix4 };
}

const SHADED = new WeakSet<THREE.Material>();
/** Patch her skin's material to darken along the split by `birthShadeAt`, times `shade` (chains whatever patches it has). */
export function patchBirthShade(material: THREE.Material, u: BirthShadeUniforms): void {
  if (SHADED.has(material)) return;
  SHADED.add(material);
  const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey, t = BIRTH_SHADE.tint, A = BIRTH_AREA, S = BIRTH_SHADE;
  const f = (x: number) => x.toFixed(6);
  material.onBeforeCompile = function (shader, renderer) {
    previous?.call(this, shader, renderer);
    shader.uniforms.uBirthShade = u.shade; shader.uniforms.uBirthCentre = u.centre; shader.uniforms.uBirthRest = u.rest;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying float vBirthShade;
uniform float uBirthShade;
uniform vec3 uBirthCentre;
uniform mat4 uBirthRest;
float birthSmooth(float a, float b, float v) { float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBirthShade = 0.0;
if (uBirthShade > 0.0) {
  vec3 bp = (uBirthRest * vec4(position, 1.0)).xyz;
  float bdy = bp.y - uBirthCentre.y, bdz = bp.z - uBirthCentre.z, br = length(vec2(bdy, bdz));
  if (br > 0.02 && br < 0.1 && abs(bp.x) < 0.02) {
    float ang = degrees(atan(bdz, -bdy));
    float along = birthSmooth(${f(A.back - A.ease)}, ${f(A.back + A.ease * 0.4)}, ang) * (1.0 - birthSmooth(${f(A.front - A.ease * 0.4)}, ${f(A.front + A.ease)}, ang));
    float bu = abs(bp.x);
    vBirthShade = uBirthShade * along * min(1.0, ${f(S.middle)} * exp(-pow(bu / ${f(S.width)}, 2.0)) + ${f(S.inner)} * exp(-pow(bu / ${f(S.innerWidth)}, 2.0)));
  }
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBirthShade;')
      // after her lighting, not into her colour: a crease is in its own shadow, so its sheen goes too (tinted into her
      // colour alone, a lit crease turned pink)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.rgb *= mix(vec3(1.0), vec3(${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}), clamp(vBirthShade, 0.0, 1.0));`);
  };
  material.customProgramCacheKey = function () { return `${cacheKey ? cacheKey.call(this) : ''}|birthShade`; };
  material.needsUpdate = true;
}

/**
 * The two fields as she wears them: the cleft on its own, and the folds as the rest of the whole -- so both together are
 * exactly the whole shape, worked out (and kept from folding over) as one.
 */
export function birthAreaFields(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, indices: ArrayLike<number>, toRest: THREE.Matrix4): { cleft: ReturnType<typeof birthAreaShapeField>; lips: ReturnType<typeof birthAreaShapeField> } {
  const both = birthAreaShapeField(basePos, baseNrm, indices, toRest, 'both'), cleft = birthAreaShapeField(basePos, baseNrm, indices, toRest, 'cleft');
  const at = new Map<number, number>();
  cleft.index.forEach((i, k) => at.set(i, k));
  const idx: number[] = [], pos: number[] = [], nd: number[] = [];
  both.index.forEach((i, k) => {
    const c = at.get(i);
    idx.push(i);
    for (let d = 0; d < 3; d++) { pos.push(both.pos[k * 3 + d] - (c === undefined ? 0 : cleft.pos[c * 3 + d])); nd.push(both.nrm[k * 3 + d] - (c === undefined ? 0 : cleft.nrm[c * 3 + d])); }
    at.delete(i);
  });
  // a point the cleft moves and the whole does not: the folds take it back
  for (const [i, c] of at) { idx.push(i); for (let d = 0; d < 3; d++) { pos.push(-cleft.pos[c * 3 + d]); nd.push(-cleft.nrm[c * 3 + d]); } }
  return { cleft, lips: { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: Float32Array.from(nd) } };
}
