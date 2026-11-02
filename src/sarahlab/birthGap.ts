/**
 * ROOM BETWEEN HER LEGS IN A BIRTH POSITION: A U, NOT A V, AT EVERY OPENING.
 *
 * Joshua, 2026-11-01: first "widen the pubic area and that region between the legs so there is more room... add/widen
 * 2.5cm on each side of the vagina" (some poses still took some of her inner thighs as her vulva opened); then, marking
 * his references ("there is a space... ours doesn't have a space or maybe there is, but it narrows down to small at the
 * front"), "when it's at 0% open, the leg shape goes up in like a V, but 100% it's not, it should be a U shape regardless
 * of the opening"; "set the total spacing between the thighs... at 11cm"; and then "try 7.25 cm instead".
 *
 * Standing, her inner thighs run up in a V to meet beside her vulva. In a birth pose her inner thighs under her vulva are held
 * `clear` (3.625 cm) out from her middle, 7.25 cm apart, whatever the opening:
 * at each height her inner thigh's own distance from her middle is measured on her (the skin facing her middle, out past
 * her vulva), and that side of her at that height moved straight out by what it lacks -- so the inner face of each thigh
 * stands up straight under her vulva, the sides of the U, and her skin from her lips' edge (`from`, all of it by `full`)
 * stretches across its top. Across her hip it eases to `outerKeep` of the move so her hips are not made much wider, gone by
 * `outerEnd` (her hands and arms are never touched); it fades down her thigh (her knees stay where they are), up over her
 * groin and behind her toward her buttocks.
 *
 * A shape field (bodyShapeView.ts), like birthThighs.ts. Weighted 1 in a birth pose, 0 else: her standing shape is
 * untouched, and her body file is never changed. All in her rest frame (metres, +x her left, +y up, +z her front).
 */
import * as THREE from 'three';
import { birthAreaCentre, BIRTH_AREA } from './birthArea';

export const BIRTH_GAP_FIELD = 'shape:birthGap';

/** GAME TUNING. */
export const BIRTH_GAP = Object.freeze({
  /** how far out from her middle her inner thighs stand under her vulva (metres): 7.25 cm between them (Joshua,
   * 2026-11-01: "11cm is too much and 3.5cm is not enough… try 7.25 cm instead"). The same at every opening: it is the
   * pose's, never the opening's */
  clear: 0.03625,
  /** across: her lips stay (within `from` of her middle), and all of it from `full` out (metres) -- at the height of her
   * vulva. Below it (her vulva's middle is the lowest of it: from `lipsDown` under it all of it is her thighs) only her
   * very middle stays: within `belowFrom`, all of it from `belowFull` */
  from: 0.015, full: 0.03, lipsDown: 0.01, belowFrom: 0.002, belowFull: 0.008,
  /** her inner thigh, measured: skin at least `full` out, facing her middle at least this much (its normal's turn toward
   * it, 0..1), from `measureFront` to `measureBack` metres behind the middle of her vulva, in steps of `step` up her */
  facing: 0.35, measureFront: -0.06, measureBack: 0.06, step: 0.005,
  /** across her hip: easing from `outerFrom` to `outerKeep` of it at `outerFull`, and gone from `outerTo` to `outerEnd` */
  outerFrom: 0.08, outerFull: 0.17, outerKeep: 0.6, outerTo: 0.19, outerEnd: 0.23,
  /** up and down from the middle of her vulva: all of it from `downFull` to `upFull`, gone by `downTo` and `upTo` (metres) */
  downTo: -0.24, downFull: -0.08, upFull: 0, upTo: 0.06,
  /** behind the middle of her vulva: all of it to `backFull`, gone by `backTo` (metres) */
  backFull: 0.05, backTo: 0.15,
});

const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** How much of the move at its height a point `x` across, `up` above and `behind` behind the middle of her vulva takes (0..1). */
export function birthGapShare(x: number, up: number, behind: number): number {
  const G = BIRTH_GAP, ax = Math.abs(x);
  if (ax >= G.outerEnd || up <= G.downTo || up >= G.upTo || behind >= G.backTo) return 0;
  const across = smooth(gapFrom(up), gapFull(up), ax) * (1 - (1 - G.outerKeep) * smooth(G.outerFrom, G.outerFull, ax)) * smooth(G.outerEnd, G.outerTo, ax);
  return across * smooth(G.downTo, G.downFull, up) * smooth(G.upTo, G.upFull, up) * smooth(G.backTo, G.backFull, behind);
}

/** what the last field was built from, for a probe: her inner thigh's points and the move at each height (cm) */
export const birthGapInfo: { inner: number; moved: number; needCm: Record<string, number> } = { inner: 0, moved: 0, needCm: {} };

/** where her lips end across (none of the move inside it) and where all of it is taken, at a height (metres) */
const below = (up: number) => smooth(0, -BIRTH_GAP.lipsDown, up);
const gapFrom = (up: number) => BIRTH_GAP.from + (BIRTH_GAP.belowFrom - BIRTH_GAP.from) * below(up);
const gapFull = (up: number) => BIRTH_GAP.full + (BIRTH_GAP.belowFull - BIRTH_GAP.full) * below(up);

interface GapFrame { rest: Float32Array; my: number; mz: number; inner: Uint8Array; need: (up: number) => number }

/** Her rest shape, the middle of her vulva, which of her points are her inner thighs, and the move each height needs. */
function gapFrame(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, toRest: THREE.Matrix4): GapFrame | null {
  const G = BIRTH_GAP, n = Math.floor(basePos.length / 3), rest = new Float32Array(n * 3), v = new THREE.Vector3(), nr = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(toRest);
  for (let i = 0; i < n; i++) v.fromArray(basePos, i * 3).applyMatrix4(toRest).toArray(rest, i * 3);
  const c = birthAreaCentre(rest);
  if (!c) return null;
  // the middle of her vulva, on her skin (as birthSeat.ts finds it)
  const m = (((BIRTH_AREA.front + BIRTH_AREA.back) / 2) * Math.PI) / 180, my = c.y - 0.047 * Math.cos(m), mz = c.z + 0.047 * Math.sin(m);
  // her inner thighs: skin out past her lips, facing her middle, round her vulva front to back, below its middle
  const inner = new Uint8Array(n), bins = Math.ceil((G.upFull - G.downTo) / G.step) + 1, near = new Float64Array(bins).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], ax = Math.abs(x), up = rest[i * 3 + 1] - my, behind = mz - rest[i * 3 + 2];
    // (her thighs' to keep the vulva area off: ALL her skin well under her vulva, out from her very middle, round it front
    // to back -- one solid piece, so the area's edge runs round it cleanly and does not run down her thighs in strips
    // between the points that happen to face her middle)
    if (up < -G.lipsDown * 1.5 && up > G.downTo && ax >= G.belowFull && ax <= G.outerFrom && behind >= G.measureFront && behind <= G.backTo) inner[i] = 1;
    if (ax < gapFull(up) || ax > G.outerFrom || up < G.downTo || up > G.upFull || behind < G.measureFront || behind > G.measureBack) continue;
    nr.fromArray(baseNrm, i * 3).applyMatrix3(nm).normalize();
    if (-Math.sign(x) * nr.x < G.facing) continue;
    const b = Math.round((up - G.downTo) / G.step); near[b] = Math.min(near[b], ax);
  }
  // (a height with none of her thigh measured takes its neighbours'; then each evened over three steps)
  for (let pass = 0; pass < bins; pass++) {
    let left = false;
    for (let b = 0; b < bins; b++) if (!Number.isFinite(near[b])) { const k = Math.min(near[b - 1] ?? Infinity, near[b + 1] ?? Infinity); if (Number.isFinite(k)) near[b] = k; else left = true; }
    if (!left) break;
  }
  const need = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    let s = 0, k = 0;
    for (let o = -1; o <= 1; o++) { const w = near[b + o]; if (w !== undefined && Number.isFinite(w)) { s += w; k++; } }
    need[b] = k ? Math.max(0, G.clear - s / k) : 0;
  }
  const at = (up: number) => { const f = Math.max(0, Math.min(bins - 1, (Math.min(G.upFull, up) - G.downTo) / G.step)), b = Math.floor(f), t = f - b; return need[b] + (need[Math.min(bins - 1, b + 1)] - need[b]) * t; };
  birthGapInfo.inner = inner.reduce((a, b) => a + b, 0); birthGapInfo.needCm = {};
  for (let up = G.downTo; up <= G.upFull + 1e-9; up += 0.02) birthGapInfo.needCm[(up * 100).toFixed(0)] = +(at(up) * 100).toFixed(2);
  return { rest, my, mz, inner, need: at };
}

/** The field, in her geometry's units: the points it moves and by how much (three a point), and how it turns their normals. */
export function birthGapField(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, toRest: THREE.Matrix4): { index: Uint32Array; pos: Float32Array; nrm: Float32Array } {
  const f = gapFrame(basePos, baseNrm, toRest);
  if (!f) return { index: new Uint32Array(0), pos: new Float32Array(0), nrm: new Float32Array(0) };
  const { rest, my, mz } = f, n = rest.length / 3, toGeom = new THREE.Matrix3().setFromMatrix4(toRest).invert();
  // the move across at a point of her rest frame (metres): her thigh's lack at that height, by the share there
  const move = (x: number, y: number, z: number) => f.need(y - my) * birthGapShare(x, y - my, mz - z) * Math.sign(x);
  const nToRest = new THREE.Matrix3().getNormalMatrix(toRest), nToGeom = new THREE.Matrix3().copy(nToRest).invert();
  const idx: number[] = [], pos: number[] = [], nrm: number[] = [], d = new THREE.Vector3(), nv = new THREE.Vector3(), g = new THREE.Vector3();
  const h = 0.002;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], up = y - my, share = birthGapShare(x, up, mz - z);
    if (share <= 0) continue;
    const s = f.need(up) * share * Math.sign(x);
    if (Math.abs(s) < 1e-6) continue;
    d.set(s, 0, 0).applyMatrix3(toGeom);
    idx.push(i); pos.push(d.x, d.y, d.z);
    // (and her normal turned as the move turns her skin -- moved and not turned, a strip of her inner thigh lit as though
    // it faced the other way: a white streak down it in LEGS APART, 2026-11-02). The move is across only (x by f), so
    // the skin's gradient F = I + e_x (grad f)^T, and a normal goes as F^-T n = n - grad f * n_x / (1 + df/dx)
    // (her very middle is not moved -- sign(x) -- so the gradient is taken on her own side of it)
    const side = Math.sign(x) || 1, xa = side > 0 ? Math.max(x, h) : Math.min(x, -h);
    g.set((move(xa + h, y, z) - move(xa - h, y, z)) / (2 * h), (move(x, y + h, z) - move(x, y - h, z)) / (2 * h), (move(x, y, z + h) - move(x, y, z - h)) / (2 * h));
    nv.fromArray(baseNrm, i * 3).applyMatrix3(nToRest).normalize();
    const k = nv.x / Math.max(0.2, 1 + g.x);
    nv.x -= g.x * k; nv.y -= g.y * k; nv.z -= g.z * k;
    // (as a change to her normal in her geometry's own units: turned there, made unit, less the one she has)
    nv.applyMatrix3(nToGeom).normalize();
    const bl = Math.hypot(baseNrm[i * 3], baseNrm[i * 3 + 1], baseNrm[i * 3 + 2]) || 1;
    nrm.push(nv.x - baseNrm[i * 3] / bl, nv.y - baseNrm[i * 3 + 1] / bl, nv.z - baseNrm[i * 3 + 2] / bl);
  }
  birthGapInfo.moved = idx.length;
  return { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: Float32Array.from(nrm) };
}

/**
 * Her points that are her inner thighs under her vulva (1): her thighs' skin, though her torso may carry it, so the vulva
 * area (vulvaMesh.ts) neither takes it nor opens over it.
 */
export function birthGapUnderMask(basePos: ArrayLike<number>, baseNrm: ArrayLike<number>, toRest: THREE.Matrix4): Uint8Array {
  const f = gapFrame(basePos, baseNrm, toRest);
  return f ? f.inner : new Uint8Array(Math.floor(basePos.length / 3));
}
