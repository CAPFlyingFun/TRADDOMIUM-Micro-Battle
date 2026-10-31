/**
 * HER INNER THIGHS, MADE ROOM IN A BIRTH POSITION (Joshua, 2026-10-30, choosing "both": her legs wider in the birth
 * poses AND her inner thighs flattened near her crotch in those poses only). Posed with her thighs up and open, her
 * skinning folds the flesh of each inner thigh in over her crotch, so the whole birth area sat at the bottom of a deep
 * V; in his references (women in labour, legs open) the area lies open and flat between the thighs.
 *
 * A shape field (bodyShapeView.ts): each inner-thigh point near her crotch drawn back into her thigh, along its own
 * normal, most a few centimetres out from her middle and nothing at her middle itself (the birth area, rebuilt in
 * vulvaMesh.ts, reads her shape back and so stays stitched) nor far down her thigh. Weighted 1 in a birth pose, 0 else.
 * All in her rest frame (metres, +x her left, +y up, +z her front).
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_THIGHS_FIELD = 'shape:birthThighs';

/** GAME TUNING. */
export const BIRTH_THIGHS = Object.freeze({
  /** how far an inner thigh draws back (metres, at most) */
  depth: 0.028,
  /** out to how far from the middle of her birth area it reaches (metres), and how far in the most is kept */
  reach: 0.14, full: 0.06,
  /** how far from her middle (across) it starts, and where it is all there (metres) */
  from: 0.012, by: 0.035,
  /** how squarely a point must face her middle to be inner thigh (its normal's turn toward the middle, 0..1) */
  facing: 0.15,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The field, in her geometry's units: the points it moves and by how much (three a point). */
export function birthThighsField(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, toRest: THREE.Matrix4): { index: Uint32Array; pos: Float32Array; nrm: Float32Array } {
  const n = Math.floor(basePos.length / 3), rest = new Float32Array(n * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(toRest);
  for (let i = 0; i < n; i++) v.fromArray(basePos, i * 3).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return { index: new Uint32Array(0), pos: new Float32Array(0), nrm: new Float32Array(0) };
  // the middle of her birth area: on her skin below the middle the cleft runs round
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180, py = c.y - 0.047 * Math.cos(m), pz = c.z + 0.047 * Math.sin(m);
  const toGeom = new THREE.Matrix3().setFromMatrix4(toRest).invert(), T = BIRTH_THIGHS;
  const idx: number[] = [], pos: number[] = [], nr = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], ax = Math.abs(x);
    if (ax < T.from) continue;
    const dist = Math.hypot(x, y - py, z - pz);
    if (dist > T.reach) continue;
    nr.fromArray(baseNrm, i * 3).applyMatrix3(nm).normalize();
    const turn = -nr.x * Math.sign(x);
    if (turn < T.facing) continue;
    const w = smooth(T.reach, T.full, dist) * smooth(T.from, T.by, ax) * smooth(T.facing, 0.6, turn);
    if (w <= 0) continue;
    // back into her thigh, along its own normal
    d.copy(nr).multiplyScalar(-T.depth * w).applyMatrix3(toGeom);
    idx.push(i); pos.push(d.x, d.y, d.z);
  }
  return { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: new Float32Array(pos.length) };
}
