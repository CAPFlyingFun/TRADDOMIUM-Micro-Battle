/**
 * HER BUTTOCKS PRESSED IN UNDER HER THIGHS IN A BIRTH POSITION (Joshua, 2026-10-31: "remove that double butt from the
 * front view, and make the whole hip/thigh seamless"; of the lobes left below her thighs seen from in front, "can that
 * area be flattened to the hips/thighs and curve with it?"). Reclined or squatting, her thighs come up and the lowest
 * part of each buttock -- the skin facing down, behind and below her vulva -- hung below the line of her thighs. Lying
 * back on her bottom, that is pressed up into one curve with her thigh.
 *
 * A shape field (bodyShapeView.ts), like birthThighs.ts: each such point is drawn in along its own normal, most where
 * it faces straight down, nothing at her middle, her sides, above her vulva or in front of it. Weighted 1 in a birth
 * pose, 0 else; her birth-pose smoothing (birthNormals.ts) then runs over the result. All in her rest frame (metres,
 * +x her left, +y up, +z her front).
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_SEAT_FIELD = 'shape:birthSeat';

/** GAME TUNING. */
export const BIRTH_SEAT = Object.freeze({
  /** how far her buttock's underside is drawn in (metres, at most) */
  depth: 0.0575,
  /** behind the middle of her vulva: where it starts, where it is all there, and how far back it goes (metres) */
  behindFrom: 0.03, behindFull: 0.07, behindTo: 0.24,
  /** above and below the middle of her vulva: where it is all there and where it is gone (metres) */
  upFull: 0.04, upTo: 0.1, downTo: -0.08,
  /** out from her middle: none within `midFrom`, all from `midFull`, all within `sideFull`, gone by `sideTo` (metres) */
  midFrom: 0.01, midFull: 0.035, sideFull: 0.11, sideTo: 0.16,
  /** how squarely down a point must face (its normal's y): starts at `faceFrom`, all of it by `faceFull` */
  faceFrom: 0, faceFull: -0.5,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The field, in her geometry's units: the points it moves and by how much (three a point). */
export function birthSeatField(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, toRest: THREE.Matrix4): { index: Uint32Array; pos: Float32Array; nrm: Float32Array } {
  const n = Math.floor(basePos.length / 3), rest = new Float32Array(n * 3), v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(toRest);
  for (let i = 0; i < n; i++) v.fromArray(basePos, i * 3).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return { index: new Uint32Array(0), pos: new Float32Array(0), nrm: new Float32Array(0) };
  // the middle of her vulva, on her skin
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180, my = c.y - 0.047 * Math.cos(m), mz = c.z + 0.047 * Math.sin(m);
  const toGeom = new THREE.Matrix3().setFromMatrix4(toRest).invert(), S = BIRTH_SEAT;
  const idx: number[] = [], pos: number[] = [], nr = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = Math.abs(rest[i * 3]), y = rest[i * 3 + 1], z = rest[i * 3 + 2], behind = mz - z, up = y - my;
    if (behind < S.behindFrom || behind > S.behindTo || up > S.upTo || up < S.downTo || x > S.sideTo || x < S.midFrom) continue;
    nr.fromArray(baseNrm, i * 3).applyMatrix3(nm).normalize();
    if (nr.y > S.faceFrom) continue;
    const w = smooth(S.behindFrom, S.behindFull, behind) * smooth(S.behindTo, S.behindTo - 0.04, behind) * smooth(S.upTo, S.upFull, up)
      * smooth(S.downTo, S.downTo + 0.03, up) * smooth(S.sideTo, S.sideFull, x) * smooth(S.midFrom, S.midFull, x) * smooth(S.faceFrom, S.faceFull, nr.y);
    if (w <= 0) continue;
    d.copy(nr).multiplyScalar(-S.depth * w).applyMatrix3(toGeom);
    idx.push(i); pos.push(d.x, d.y, d.z);
  }
  return { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: new Float32Array(pos.length) };
}
