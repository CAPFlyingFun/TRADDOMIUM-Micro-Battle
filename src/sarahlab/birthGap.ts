/**
 * MORE ROOM BETWEEN HER LEGS IN A BIRTH POSITION (Joshua, 2026-11-01: "widen the pubic area and that region between the
 * legs so there is more room so the gap between the upper thighs are a few more centimeters... add/widen 2.5cm on each
 * side of the vagina"; some poses still took some of her inner thighs as her vulva opened). Standing, her inner thighs
 * are about 2.4 cm apart at her vulva; posed, they close in over it and hold the opening back.
 *
 * A shape field (bodyShapeView.ts), like birthThighs.ts: each side of her, her upper thigh moved straight out from her
 * middle -- all of it on her leg's side of its leg opening (birthWeights.ts), easing to nothing over `ease` metres on her
 * torso's side, so the skin between her vulva and her leg stretches and her vulva itself does not move -- and across her
 * hip easing to `outerKeep` of it so her hips are not made much wider, gone by `outerEnd` (her hands and arms are never
 * touched). It fades out down her thigh (her knees stay where they are), up over her groin
 * and behind her toward her buttocks. Weighted 1 in a birth pose, 0 else: her standing shape is untouched, and her body
 * file is never changed. All in her rest frame (metres, +x her left, +y up, +z her front).
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_GAP_FIELD = 'shape:birthGap';

/** GAME TUNING. */
export const BIRTH_GAP = Object.freeze({
  /** how far each side moves out from her middle (metres, at most): 2.5 cm each side, 5 cm more between her thighs */
  shift: 0.025,
  /** how far onto her torso's side of each leg opening it eases to nothing (metres) */
  ease: 0.035,
  /** when her leg openings are not known: none within `from` of her middle (her vulva), all of it by `full` (metres) */
  from: 0.015, full: 0.055,
  /** across her hip: easing from `outerFrom` to `outerKeep` of it at `outerFull`, and gone from `outerTo` to `outerEnd` */
  outerFrom: 0.08, outerFull: 0.17, outerKeep: 0.4, outerTo: 0.19, outerEnd: 0.23,
  /** up and down from the middle of her vulva: all of it from `downFull` to `upFull`, gone by `downTo` and `upTo` (metres) */
  downTo: -0.24, downFull: -0.08, upFull: 0.03, upTo: 0.11,
  /** behind the middle of her vulva: all of it to `backFull`, gone by `backTo` (metres) */
  backFull: 0.05, backTo: 0.15,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * How far out (metres) a point `x` across, `up` above and `behind` behind the middle of her vulva is moved; `leg`, how far
 * it lies on its leg's side of its leg opening (metres, less than 0 her torso's; undefined: not known, so it goes by `x`).
 */
export function birthGapShift(x: number, up: number, behind: number, leg?: number): number {
  const G = BIRTH_GAP, ax = Math.abs(x);
  if (ax >= G.outerEnd || up <= G.downTo || up >= G.upTo || behind >= G.backTo) return 0;
  const inner = leg === undefined ? smooth(G.from, G.full, ax) : smooth(-G.ease, 0, leg);
  const across = inner * (1 - (1 - G.outerKeep) * smooth(G.outerFrom, G.outerFull, ax)) * smooth(G.outerEnd, G.outerTo, ax);
  const along = smooth(G.downTo, G.downFull, up) * smooth(G.upTo, G.upFull, up) * smooth(G.backTo, G.backFull, behind);
  return G.shift * across * along * Math.sign(x);
}

/** The field, in her geometry's units: the points it moves and by how much (three a point). */
export function birthGapField(basePos: ArrayLike<number>, toRest: THREE.Matrix4, legDistance?: (i: number) => number): { index: Uint32Array; pos: Float32Array; nrm: Float32Array } {
  const n = Math.floor(basePos.length / 3), rest = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) v.fromArray(basePos, i * 3).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return { index: new Uint32Array(0), pos: new Float32Array(0), nrm: new Float32Array(0) };
  // the middle of her vulva, on her skin (as birthSeat.ts finds it)
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180, my = c.y - 0.047 * Math.cos(m), mz = c.z + 0.047 * Math.sin(m);
  const toGeom = new THREE.Matrix3().setFromMatrix4(toRest).invert();
  const idx: number[] = [], pos: number[] = [], d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const s = birthGapShift(rest[i * 3], rest[i * 3 + 1] - my, mz - rest[i * 3 + 2], legDistance?.(i));
    if (Math.abs(s) < 1e-6) continue;
    d.set(s, 0, 0).applyMatrix3(toGeom);
    idx.push(i); pos.push(d.x, d.y, d.z);
  }
  return { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: new Float32Array(pos.length) };
}
