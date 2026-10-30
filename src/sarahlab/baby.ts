/**
 * HER BABY (Joshua, 2026-10-29: "if I had a baby model, could we shrink it and really allow the baby to grow in size...
 * is the baby connected to the mother from the umbilical cord, and is in the womb with fluid?"; the model: "for web
 * lower to 2K and actually in the womb, no textures since you won't see it anyway").
 *
 * The Meshy newborn re-proportioned to a newborn's (head about a quarter of its length, legs about a third), curled into
 * a fetal pose that is baked in as its rest, simplified and packed untextured (`.scratch/baby`, local): one skinned mesh,
 * its rig kept for kicks later. It sits in her womb -- the egg fitted inside each approved belly size (`WOMB_FIT`) and
 * tipped by BABY WEIGHT as the baby-weight shapes were baked -- head down, its back to her front and left, the way most
 * babies settle by week 28.
 *
 * Its size comes from the week her belly stands for, and the chart: Orange Parenting's fetal size chart (Hadlock), weeks
 * 12 to 41, length and weight with the 10th to 90th percentile. 0% is week 12, 100% week 40, a straight line between
 * (Joshua: "0% ≈ weeks 0-12; 0-100% ≈ weeks 12-40 linear; 100% = week 40"); past 100% the weeks run on to 42 at 200% --
 * a bigger baby, the chart carried on its last week's growth. BABY WEIGHT picks the 10th percentile at -100, the average
 * at 0, the 90th at +100.
 */
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------------------- chart

/** One week of the chart: length (cm; crown-rump before week 14, crown-heel after), weight (g): average, 10th, 90th. MEASURED (Hadlock, via Orange Parenting). */
export interface ChartWeek { readonly week: number; readonly cm: number; readonly crownRump: boolean; readonly g: number; readonly lo: number; readonly hi: number }
const W = (week: number, cm: number, g: number, lo: number, hi: number): ChartWeek => ({ week, cm, crownRump: week < 14, g, lo, hi });
export const FETAL_CHART: readonly ChartWeek[] = Object.freeze([
  W(12, 5.4, 14, 10, 20), W(13, 6.7, 23, 17, 31), W(14, 14.7, 43, 31, 60), W(15, 16.7, 70, 51, 94),
  W(16, 18.6, 100, 74, 133), W(17, 20.4, 140, 105, 184), W(18, 22.2, 190, 142, 250), W(19, 24.0, 240, 179, 317),
  W(20, 25.7, 300, 224, 400), W(21, 27.4, 360, 269, 479), W(22, 29.0, 430, 320, 567), W(23, 30.6, 500, 372, 658),
  W(24, 32.2, 600, 449, 794), W(25, 33.7, 700, 522, 930), W(26, 35.1, 800, 598, 1066), W(27, 36.6, 900, 671, 1202),
  W(28, 37.6, 1000, 748, 1338), W(29, 39.3, 1150, 862, 1533), W(30, 40.5, 1300, 975, 1733), W(31, 41.8, 1500, 1125, 1995),
  W(32, 43.0, 1700, 1275, 2261), W(33, 44.1, 1900, 1424, 2527), W(34, 45.3, 2100, 1574, 2793), W(35, 46.3, 2380, 1787, 3173),
  W(36, 47.3, 2620, 1965, 3493), W(37, 48.3, 2860, 2145, 3813), W(38, 49.3, 3100, 2322, 4133), W(39, 50.1, 3290, 2468, 4387),
  W(40, 51.0, 3460, 2595, 4617), W(41, 51.8, 3600, 2700, 4800),
]);

/** The model's crown-rump as a share of its crown-heel (as re-proportioned): turns the chart's early crown-rump into a length. MEASURED on the model. */
export const MODEL_CROWN_RUMP = 0.652;

/** The week her belly stands for: 0% week 12, 100% week 40, on to 42 at 200%. */
export function weekForBump(bumpPercent: number): number {
  const b = Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 0);
  return b <= 100 ? 12 + 28 * (b / 100) : 40 + 2 * (Math.min(200, b) - 100) / 100;
}

export interface BabySize {
  readonly week: number;
  /** crown-heel length, cm */
  readonly cm: number;
  /** weight, g: at BABY WEIGHT, and the week's average */
  readonly g: number;
  readonly avg: number;
}

/** The chart at a (fractional) week and BABY WEIGHT (-100 10th percentile, 0 average, +100 90th); past week 41, its last week's growth carried on. */
export function babySize(week: number, weightPercent = 0): BabySize {
  const c = FETAL_CHART, first = c[0], last = c[c.length - 1], prev = c[c.length - 2];
  const len = (r: ChartWeek) => (r.crownRump ? r.cm / MODEL_CROWN_RUMP : r.cm);
  const at = (f: (r: ChartWeek) => number): number => {
    if (!(week > first.week)) return f(first);
    if (week >= last.week) return f(last) + (f(last) - f(prev)) * (week - last.week);
    const i = Math.floor(week - first.week), t = week - first.week - i;
    return f(c[i]) + (f(c[i + 1]) - f(c[i])) * t;
  };
  const w = Math.min(100, Math.max(-100, Number.isFinite(weightPercent) ? weightPercent : 0)) / 100;
  const avg = at((r) => r.g), g = w < 0 ? avg + w * (avg - at((r) => r.lo)) : avg + w * (at((r) => r.hi) - avg);
  return { week, cm: at(len), g, avg };
}

/** How much bigger the model is drawn for its weight against the week's average: a fourth root (a heavier baby is mostly plumper, a little longer). GAME TUNING. */
export const WEIGHT_SIZE_POWER = 0.25;

/** grams as "1.70 kg (3 lb 12 oz)", or "300 g (10.6 oz)" under a kilogram */
export function weighs(g: number): string {
  const oz = g / 28.3495;
  if (g < 1000) return `${Math.round(g)} g (${oz.toFixed(1)} oz)`;
  const whole = Math.round(oz);
  return `${(g / 1000).toFixed(2)} kg (${Math.floor(whole / 16)} lb ${whole % 16} oz)`;
}

/** The baby's line: its week, length and weight now. */
export function babyLine(bumpPercent: number, weightPercent: number): string {
  const s = babySize(weekForBump(bumpPercent), weightPercent);
  return `week ${s.week.toFixed(s.week % 1 < 0.05 || s.week % 1 > 0.95 ? 0 : 1)} · ${s.cm.toFixed(1)} cm (${(s.cm / 2.54).toFixed(1)} in) · ${weighs(s.g)}`;
}

// ------------------------------------------------------------------------------------------------------------- womb

/**
 * The egg fitted inside each approved belly size (`.scratch/compare/womb.py`): centre (y, z) in her rest metres, half
 * width a, half height b along its forward tilt, half depth d, fuller at the bottom by egg. MEASURED (fitted to her belly).
 */
export const WOMB_FIT: Readonly<Record<number, { cy: number; cz: number; a: number; b: number; d: number; tilt: number; egg: number }>> = Object.freeze({
  25: { cy: 0.9761, cz: 0.0010, a: 0.1853, b: 0.1063, d: 0.0767, tilt: 0.1820, egg: 0 },
  50: { cy: 0.9900, cz: 0.0235, a: 0.1143, b: 0.1244, d: 0.0990, tilt: 0.3511, egg: 0 },
  75: { cy: 1.0000, cz: 0.0428, a: 0.1167, b: 0.1402, d: 0.1180, tilt: 0.4630, egg: 0 },
  100: { cy: 1.0147, cz: 0.0606, a: 0.1413, b: 0.1613, d: 0.1359, tilt: 0.5216, egg: 0 },
  125: { cy: 1.0127, cz: 0.0834, a: 0.1375, b: 0.1637, d: 0.1585, tilt: 0.6442, egg: 0.1018 },
  150: { cy: 1.0148, cz: 0.1061, a: 0.1355, b: 0.1671, d: 0.1812, tilt: 0.7340, egg: 0.2523 },
  175: { cy: 1.0203, cz: 0.1311, a: 0.1357, b: 0.1713, d: 0.2066, tilt: 0.8000, egg: 0.4483 },
  200: { cy: 1.0232, cz: 0.1492, a: 0.1404, b: 0.1787, d: 0.2305, tilt: 0.8000, egg: 0.5000 },
});

export interface Womb {
  /** centre, rest metres */
  readonly centre: THREE.Vector3;
  /** across (her left), along its long axis (up, tipped forward), forward */
  readonly ex: THREE.Vector3; readonly eu: THREE.Vector3; readonly ev: THREE.Vector3;
  readonly a: number; readonly b: number; readonly d: number; readonly egg: number;
}

/**
 * Her womb at a belly size and BABY WEIGHT, as the baby-weight shapes were baked (womb5.py): its bottom stays seated in
 * her pelvis and its back against her spine; heavier tips it forward and down, deeper and fuller below; lighter tips it a
 * little back. Below 25% the 25% egg, shrunk toward its seat.
 */
export function wombAt(bumpPercent: number, weightPercent = 0): Womb {
  const b = Math.min(200, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 0));
  const keys = [25, 50, 75, 100, 125, 150, 175, 200];
  const lo = keys.filter((k) => k <= b).pop() ?? 25, hi = keys.find((k) => k >= b) ?? 200;
  const t = hi === lo ? 0 : (b - lo) / (hi - lo), A = WOMB_FIT[lo], B = WOMB_FIT[hi];
  const f = Object.fromEntries((Object.keys(A) as (keyof typeof A)[]).map((k) => [k, A[k] + (B[k] - A[k]) * t])) as typeof A;
  const shrink = b < 25 ? 0.45 + 0.55 * (b / 25) : 1;
  const sag = Math.min(1, Math.max(-1, (Number.isFinite(weightPercent) ? weightPercent : 0) / 100));
  const frame = (tilt: number) => [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)), new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt))];
  const [, eu0] = frame(f.tilt);
  const c0 = new THREE.Vector3(0, f.cy, f.cz);
  const pivot = c0.clone().addScaledVector(eu0, -f.b * (1 + f.egg * 0.5));
  const tip = (sag > 0 ? 0.22 : 0.10) * sag;
  const a = f.a * shrink, bb = f.b * (1 + 0.06 * sag) * shrink, d = f.d * (1 + 0.12 * sag) * shrink, egg = Math.min(0.8, Math.max(0, f.egg + 0.35 * sag));
  const [ex, eu, ev] = frame(f.tilt + tip);
  const centre = pivot.clone().addScaledVector(eu, bb * (1 + egg * 0.5)).addScaledVector(ev, d - f.d * shrink);
  return { centre, ex, eu, ev, a, b: bb, d, egg };
}

/** The egg's surface along a unit direction (x across, u along, v forward) from its centre: fuller below its middle. */
export function wombRadius(w: Pick<Womb, 'a' | 'b' | 'd' | 'egg'>, x: number, u: number, v: number): number {
  const bu = w.b * (1 - w.egg * Math.min(1, Math.max(-1, u)) * 0.5);
  return 1 / Math.sqrt((x / w.a) ** 2 + (u / bu) ** 2 + (v / w.d) ** 2);
}

// --------------------------------------------------------------------------------------------------------- placement

export const BABY_MODEL = 'models/sarah-baby.glb';
/** The packed model's crown-heel length in its own units (re-proportioned, before the curl). MEASURED on the model. */
export const BABY_MODEL_LENGTH = 1.5448;
/** How far round from straight forward its back faces, toward her left: the commonest settling (left occiput anterior). GAME TUNING. */
export const BACK_TO_LEFT_RAD = Math.PI / 4;

/**
 * The curl's own frame, measured on the loaded model (its rest is the curl): its middle, its long axis (the largest of
 * its spread, pointing to its head end), its back (the model's -z made square to that), and its size along each.
 */
export interface CurlFrame { readonly centre: THREE.Vector3; readonly long: THREE.Vector3; readonly back: THREE.Vector3; readonly side: THREE.Vector3; readonly size: THREE.Vector3 }

/** The curl's frame from its points (x y z, model units) and a point at its head (to say which end is which). */
export function curlFrame(points: ArrayLike<number>, head: THREE.Vector3): CurlFrame {
  const n = Math.floor(points.length / 3);
  const c = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.x += points[i * 3], c.y += points[i * 3 + 1], c.z += points[i * 3 + 2];
  c.divideScalar(Math.max(1, n));
  // the spread's largest axis, by power iteration on its covariance
  const C = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const x = points[i * 3] - c.x, y = points[i * 3 + 1] - c.y, z = points[i * 3 + 2] - c.z;
    C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z;
  }
  const long = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 64; k++) long.set(C[0] * long.x + C[1] * long.y + C[2] * long.z, C[1] * long.x + C[3] * long.y + C[4] * long.z, C[2] * long.x + C[4] * long.y + C[5] * long.z).normalize();
  if (head.clone().sub(c).dot(long) < 0) long.negate();
  const back = new THREE.Vector3(0, 0, -1);
  back.addScaledVector(long, -back.dot(long)).normalize();
  const side = new THREE.Vector3().crossVectors(long, back).normalize();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity), q = new THREE.Vector3(), r = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    q.set(points[i * 3] - c.x, points[i * 3 + 1] - c.y, points[i * 3 + 2] - c.z);
    r.set(q.dot(side), q.dot(long), q.dot(back)); lo.min(r); hi.max(r);
  }
  const mid = lo.clone().add(hi).multiplyScalar(0.5);
  const centre = c.clone().addScaledVector(side, mid.x).addScaledVector(long, mid.y).addScaledVector(back, mid.z);
  return { centre, long, back, side, size: hi.sub(lo) };
}

export interface BabyPlace { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly scale: number }

/**
 * Where the baby is drawn, in her rest metres: the curl's middle on `at` (the sac's middle), its head down her womb's
 * long axis (tipped forward with her belly, and by BABY WEIGHT), its back to her front and left; scaled to the chart.
 * `fitInSac` then keeps all of it inside the sac.
 */
export function babyPlace(bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: { readonly centre: THREE.Vector3; readonly axis: THREE.Vector3 }, backToLeft = BACK_TO_LEFT_RAD): BabyPlace {
  const s = babySize(weekForBump(bumpPercent), weightPercent);
  const scale = (s.cm / 100 / BABY_MODEL_LENGTH) * Math.pow(s.g / s.avg, WEIGHT_SIZE_POWER);
  // its long axis (head end) down the sac's; its back to her front and left
  const down = womb.axis.clone().negate();
  const back = new THREE.Vector3(Math.sin(backToLeft), 0, Math.cos(backToLeft));
  back.addScaledVector(down, -back.dot(down)).normalize();
  const side = new THREE.Vector3().crossVectors(down, back).normalize();
  const target = new THREE.Matrix4().makeBasis(side, down, back), own = new THREE.Matrix4().makeBasis(curl.side, curl.long, curl.back);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(target.multiply(own.transpose()));
  const position = womb.centre.clone().sub(curl.centre.clone().multiplyScalar(scale).applyQuaternion(quaternion));
  return { position, quaternion, scale };
}

// ------------------------------------------------------------------------------------- her womb, from her own skin

/**
 * HER WOMB AS HER BELLY HOLDS IT (Joshua, 2026-10-29: "Sac forms to baby > womb forms to sac > belly skin forms to
 * womb"). Not a fitted egg: her belly's own skin, whatever her sliders have made it, less the tissue over the womb, is the
 * womb's front; behind, it stops in front of her spine; its top (the fundus) rises with the weeks -- at her pubic bone at
 * week 12, her navel at 20, under her ribs at term -- and it is only as wide as a womb grows. The sac lines it; the baby
 * is kept inside the sac, all of it, its head too. All in her rest metres.
 */
export const WOMB_TISSUE_M = 0.010;       // skin, fat and muscle over the womb at the front. GAME TUNING
export const WOMB_WALL_M = 0.008;         // the womb's own wall, outside the sac. GAME TUNING
export const WOMB_BACK_Z = -0.055;        // in front of her spine (rest metres), at her waist. GAME TUNING
/** lower down, in her pelvis, it reaches further back toward her sacrum: [y, back z] (rest metres). BIOLOGICAL SHAPE, GAME TUNING */
export const WOMB_BACK: readonly (readonly [number, number])[] = [[0.80, -0.105], [0.86, -0.095], [0.94, -0.07], [1.0, WOMB_BACK_Z]];
export const womBackAt = (y: number): number => lerpTable(WOMB_BACK, y, 1);
export const WOMB_FLOOR_Y = 0.81;         // deep in her pelvis, where its bottom (and at term the baby's head) sits. GAME TUNING
/** the fundus (top) and the half width by week: [week, top y (m), half width (m)]. BIOLOGICAL SHAPE (fundal height), GAME TUNING (her body) */
export const FUNDUS: readonly (readonly [number, number, number])[] = [[12, 0.895, 0.045], [16, 0.950, 0.075], [20, 1.010, 0.100], [28, 1.115, 0.125], [36, 1.215, 0.140], [40, 1.230, 0.145], [42, 1.240, 0.150]];
const NT = 36, NP = 48;

export interface WombShape {
  /** the sac's middle (rest metres) */
  readonly centre: THREE.Vector3;
  /** the sac's radius from the middle on a grid over the sphere: polar angle from +y (NT rows), round from +z toward +x (NP) */
  readonly r: Float32Array;
  /** its long axis (the largest of its spread, pointing up her body) */
  readonly axis: THREE.Vector3;
  /** her skin's nearest distance from the middle in each cell (Infinity where her belly's skin is not that way) */
  readonly skin: Float32Array;
}

const lerpTable = (t: readonly (readonly number[])[], x: number, col: number): number => {
  if (x <= t[0][0]) return t[0][col];
  for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const a = t[i - 1], b = t[i], k = (x - a[0]) / (b[0] - a[0]); return a[col] + (b[col] - a[col]) * k; }
  return t[t.length - 1][col];
};
const binOf = (dx: number, dy: number, dz: number): [number, number] => {
  const th = Math.acos(Math.max(-1, Math.min(1, dy))), ph = Math.atan2(dx, dz);
  return [(th / Math.PI) * (NT - 1), (((ph / (2 * Math.PI)) + 1) % 1) * NP];
};

/** The sac's radius along a unit direction (bilinear on its grid). */
export function sacRadius(w: WombShape, dx: number, dy: number, dz: number): number {
  const [ft, fp] = binOf(dx, dy, dz);
  const t0 = Math.min(NT - 2, Math.floor(ft)), a = ft - t0, p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP, b = fp - Math.floor(fp);
  const R = w.r;
  return (R[t0 * NP + p0] * (1 - b) + R[t0 * NP + p1] * b) * (1 - a) + (R[(t0 + 1) * NP + p0] * (1 - b) + R[(t0 + 1) * NP + p1] * b) * a;
}

/**
 * Her womb's sac from her belly's skin (points in rest metres: the front of her belly and its sides, as drawn now) at a
 * week: inside the skin by the tissue, inside its cap (pelvic floor, fundus, a womb's width, in front of her spine), the
 * two joined softly so no crease shows, and smoothed.
 */
export function wombFromSkin(skin: ArrayLike<number>, week: number): WombShape {
  const top = lerpTable(FUNDUS, week, 1), half = lerpTable(FUNDUS, week, 2), n = Math.floor(skin.length / 3);
  // her skin's front at mid-height, near her middle: how deep the womb may be
  const midY = (WOMB_FLOOR_Y + top) / 2;
  let front = WOMB_BACK_Z + 0.04;
  for (let i = 0; i < n; i++) if (Math.abs(skin[i * 3]) < 0.03 && Math.abs(skin[i * 3 + 1] - midY) < 0.03) front = Math.max(front, skin[i * 3 + 2]);
  const centre = new THREE.Vector3(0, midY, (WOMB_BACK_Z + front - WOMB_TISSUE_M) / 2);
  const hy = (top - WOMB_FLOOR_Y) / 2, back = 0.25, fwd = Math.max(0.02, front - WOMB_TISSUE_M - centre.z);
  /** how far along a direction (going back) the womb's back wall is: where it meets z = womBackAt(y) */
  const backWall = (dy: number, dz: number): number => {
    if (dz >= -1e-6) return Infinity;
    let lo = 0, hi = 0.6;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (centre.z + m * dz > womBackAt(centre.y + m * dy)) lo = m; else hi = m; }
    return lo;
  };
  // the skin less its tissue, per direction: the nearest skin point in each cell
  const skinR = new Float32Array(NT * NP).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = skin[i * 3] - centre.x, y = skin[i * 3 + 1] - centre.y, z = skin[i * 3 + 2] - centre.z, r = Math.hypot(x, y, z);
    if (r < 1e-6) continue;
    const [ft, fp] = binOf(x / r, y / r, z / r), k = Math.round(ft) * NP + (Math.floor(fp + 0.5) % NP);
    skinR[k] = Math.min(skinR[k], r - WOMB_TISSUE_M);
  }
  const skinRaw = skinR.map((x) => x + WOMB_TISSUE_M);
  // cells the skin does not reach next to ones it does (where her belly's skin ends, under her breasts and at her
  // sides; above its middle: below, her pelvis is room, not a gap) take their neighbours' nearest: no gap for the sac to spike through
  for (let pass = 0; pass < 4; pass++) {
    const next = skinR.slice();
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
      if (Number.isFinite(skinR[t * NP + p]) || t > NT / 2) continue;
      let m = Infinity;
      for (const [dt, dp] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const tt = t + dt; if (tt < 0 || tt >= NT) continue;
        m = Math.min(m, skinR[tt * NP + ((p + dp + NP) % NP)]);
      }
      next[t * NP + p] = m;
    }
    skinR.set(next);
  }
  const r = new Float32Array(NT * NP), soft = 0.012;
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
    const th = (t / (NT - 1)) * Math.PI, ph = (p / NP) * 2 * Math.PI;
    const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
    // the cap: an egg, half height to floor and fundus, a womb's width, flat to her spine behind, as deep as her skin in front
    const egg = 1 / Math.sqrt((dx / half) ** 2 + (dy / hy) ** 2 + (dz / (dz < 0 ? back : fwd)) ** 2), wall = backWall(dy, dz);
    const cap = Number.isFinite(wall) ? -soft * Math.log(Math.exp(-egg / soft) + Math.exp(-Math.max(0.005, wall) / soft)) : egg;
    const sk = skinR[t * NP + p];
    // soft minimum of the two: they meet without a crease
    // (the skin cell holds skin less tissue: the womb's own wall comes off too, so the sac is inside all three)
    r[t * NP + p] = Number.isFinite(sk) ? -soft * Math.log(Math.exp(-cap / soft) + Math.exp(-Math.max(0.005, sk - WOMB_WALL_M) / soft)) : cap;
  }
  // smoothed (each cell toward its neighbours, never past where it started: never further out than the skin allows)
  const tmp = new Float32Array(r.length);
  for (let pass = 0; pass < 6; pass++) {
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
      const tu = Math.max(0, t - 1), td = Math.min(NT - 1, t + 1), pl = (p + NP - 1) % NP, pr = (p + 1) % NP;
      const avg = (r[tu * NP + p] + r[td * NP + p] + r[t * NP + pl] + r[t * NP + pr]) / 4;
      tmp[t * NP + p] = Math.min(r[t * NP + p], 0.5 * r[t * NP + p] + 0.5 * avg);
    }
    r.set(tmp);
  }
  // at its top and bottom every column meets in one point: they take one radius there (the least of them, so never past
  // her skin), eased into the rows next to it
  for (const [pole, next] of [[0, 1], [NT - 1, NT - 2]] as const) {
    let m = Infinity; for (let p = 0; p < NP; p++) m = Math.min(m, r[pole * NP + p]);
    for (let p = 0; p < NP; p++) { r[pole * NP + p] = m; r[next * NP + p] = Math.min(r[next * NP + p], 0.5 * r[next * NP + p] + 0.5 * m); }
  }
  // its long axis: the largest spread of its surface (area-weighted by sin of the polar angle)
  const C = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
    const th = (t / (NT - 1)) * Math.PI, ph = (p / NP) * 2 * Math.PI, rr = r[t * NP + p], k = Math.sin(th) + 1e-3;
    const x = rr * Math.sin(th) * Math.sin(ph), y = rr * Math.cos(th), z = rr * Math.sin(th) * Math.cos(ph);
    C[0] += k * x * x; C[1] += k * x * y; C[2] += k * x * z; C[3] += k * y * y; C[4] += k * y * z; C[5] += k * z * z;
  }
  const axis = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 64; k++) axis.set(C[0] * axis.x + C[1] * axis.y + C[2] * axis.z, C[1] * axis.x + C[3] * axis.y + C[4] * axis.z, C[2] * axis.x + C[4] * axis.y + C[5] * axis.z).normalize();
  if (axis.y < 0) axis.negate();
  return { centre, r, axis, skin: skinRaw };
}

/** How much of the sac the baby may fill: a little fluid round it at term. GAME TUNING. */
export const SAC_FILL = 0.985;

/**
 * Keep the baby inside the sac, all of it: its points (model units, a sample is plenty) as `place` puts them push it
 * back in where they stand past the sac, a few passes; a baby too big to fit by moving is curled smaller (its scale),
 * never let through the wall. Returns the move (rest metres) and the scale to draw it at.
 */
export function fitInSac(points: ArrayLike<number>, place: BabyPlace, w: WombShape, settleOnly = false): { move: THREE.Vector3; scale: number } {
  const n = Math.floor(points.length / 3), base = place.position.clone().sub(w.centre);
  // its points about its own placed origin, turned
  const local: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) local.push(new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).applyQuaternion(place.quaternion));
  // it scales about the curl's middle: where that middle sits (relative to the sac's), it stays
  const mid = new THREE.Vector3(); for (const q of local) mid.add(q); mid.divideScalar(Math.max(1, n));
  const p = new THREE.Vector3(), push = new THREE.Vector3();
  /** how far its worst point is past the sac at `scale`, moved by `move`; and the push that brings the worst ones in */
  const measure = (scale: number, move: THREE.Vector3): number => {
    push.set(0, 0, 0); let worst = -Infinity;
    for (const q of local) {
      p.copy(q).sub(mid).multiplyScalar(scale).add(mid.clone().multiplyScalar(place.scale)).add(base).add(move);
      const r = p.length();
      if (r < 1e-9) continue;
      const over = r - sacRadius(w, p.x / r, p.y / r, p.z / r) * SAC_FILL;
      worst = Math.max(worst, over);
      if (over > 0) push.addScaledVector(p, over / r);
    }
    return worst;
  };
  /** the best place for it at `scale`: pushed in from where it is past the sac, a few dozen small steps */
  const settle = (scale: number): { move: THREE.Vector3; worst: number } => {
    const move = new THREE.Vector3();
    let worst = measure(scale, move);
    for (let k = 0; k < 40 && worst > 0; k++) {
      const len = push.length();
      if (len < 1e-12) break;
      const step = push.clone().multiplyScalar(-Math.min(worst, 0.01) / len);
      move.add(step);
      const next = measure(scale, move);
      if (next > worst) { move.sub(step); break; }
      worst = next;
    }
    return { move, worst };
  };
  const toPlace = (scale: number, move: THREE.Vector3) => move.clone().add(mid.clone().multiplyScalar(place.scale - scale));
  // as big as the chart says, if it fits; else the largest that does (curled tighter), by halving the difference
  let best = settle(place.scale);
  if (settleOnly || best.worst <= 5e-4) return { move: toPlace(place.scale, best.move), scale: place.scale };
  let lo = place.scale * 0.4, hi = place.scale, bestScale = lo;
  best = settle(lo);
  for (let k = 0; k < 7; k++) {
    const mid2 = (lo + hi) / 2, t = settle(mid2);
    if (t.worst <= 5e-4) { lo = mid2; best = t; bestScale = mid2; } else hi = mid2;
  }
  return { move: toPlace(bestScale, best.move), scale: bestScale };
}

/**
 * The tilts tried (radians from upright, in her sagittal plane; positive tips its top forward): a belly that bulges low
 * and slopes back under her breasts holds a baby leaning back at the top, a high round one holds it upright or forward.
 * The one whose worst point stands least past the sac wins, then is sized. GAME TUNING (the range), MEASURED (the need).
 */
export const FIT_TILTS = [-0.87, -0.7, -0.52, -0.35, -0.17, 0, 0.17, 0.35, 0.52].map((x) => x);

export interface BabyFit { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly scale: number; readonly squeezed: number; readonly tilt: number }

/** How far `points` placed by `place` (and moved by `move`) stand past the sac at worst (rest metres; negative: inside). */
export function worstPast(points: ArrayLike<number>, place: BabyPlace, w: WombShape): number {
  const q = new THREE.Vector3(); let worst = -Infinity;
  for (let i = 0; i < points.length / 3; i++) {
    q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position).sub(w.centre);
    const r = q.length();
    if (r > 1e-9) worst = Math.max(worst, r - sacRadius(w, q.x / r, q.y / r, q.z / r) * SAC_FILL);
  }
  return worst;
}

/**
 * The baby in her womb: head down, leaning the way her belly holds it best (`FIT_TILTS`, each scored once, the best one
 * sized); its middle in the sac's; all of it inside the sac, as big as the chart says or as near as the sac allows
 * (`squeezed`: its scale against the chart's).
 */
export function fitBaby(points: ArrayLike<number>, bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: WombShape): BabyFit {
  let bestTilt = 0, bestScore = Infinity, bestPlace: BabyPlace | null = null;
  for (const t of FIT_TILTS) {
    const p = babyPlace(bumpPercent, weightPercent, curl, { centre: womb.centre, axis: new THREE.Vector3(0, Math.cos(t), Math.sin(t)) });
    // scored where a few steps of pushing leave it, at the chart's size
    const f = fitInSac(points, p, womb, true);
    const score = worstPast(points, { ...p, position: p.position.clone().add(f.move) }, womb);
    if (score < bestScore - 1e-4) { bestScore = score; bestTilt = t; bestPlace = p; }
  }
  const p = bestPlace as BabyPlace, f = fitInSac(points, p, womb);
  return { position: p.position.clone().add(f.move), quaternion: p.quaternion, scale: f.scale, squeezed: f.scale / p.scale, tilt: bestTilt };
}

// ------------------------------------------------------------------------------- the baby first, her belly round it

/**
 * THE ORDER, AS JOSHUA PUT IT (2026-10-30: "the belly adjusting to the baby as in real life the skin changes with the
 * baby, not the baby to the skin"): the baby is the chart's size, always; the sac is grown round it where it needs more
 * room than her womb gives; the womb's wall round the sac; and her belly's skin, less nothing, is pushed out where the
 * womb and its tissue would stand past it. Where everything fits (most sizes), nothing moves.
 */

/**
 * How much room the baby placed so would ask of her: each point past the sac, by how far -- four times as much where her
 * belly cannot give it (under her breasts, down at her groin, out at her flanks) as where it can.
 */
export function roomNeeded(points: ArrayLike<number>, place: BabyPlace, w: WombShape): number {
  const q = new THREE.Vector3(); let total = 0;
  for (let i = 0; i < points.length / 3; i++) {
    q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position);
    const rel = q.clone().sub(w.centre), r = rel.length();
    if (r < 1e-9) continue;
    const over = r - sacRadius(w, rel.x / r, rel.y / r, rel.z / r) * SAC_FILL;
    if (over > 0) total += over * over * (1 + 3 * (1 - pushZone(q.x, q.y)));
  }
  return total;
}

/** The baby at the chart's size, leaning the way her belly holds it best, its middle pushed toward room: never shrunk. */
export function placeBaby(points: ArrayLike<number>, bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: WombShape): BabyFit {
  let bestTilt = 0, bestScore = Infinity, best: BabyPlace | null = null;
  for (const t of FIT_TILTS) {
    const p = babyPlace(bumpPercent, weightPercent, curl, { centre: womb.centre, axis: new THREE.Vector3(0, Math.cos(t), Math.sin(t)) });
    const f = fitInSac(points, p, womb, true);
    const placed = { ...p, position: p.position.clone().add(f.move) };
    const score = roomNeeded(points, placed, womb);
    if (score < bestScore - 1e-5) { bestScore = score; bestTilt = t; best = placed; }
  }
  const p = best as BabyPlace;
  return { position: p.position, quaternion: p.quaternion, scale: p.scale, squeezed: 1, tilt: bestTilt };
}

/**
 * How far the baby stands past the sac in each cell (its points as placed, all of them, each against the sac in its own
 * direction, with a little fluid round it): zero where it is inside.
 */
export function babyPast(points: ArrayLike<number>, place: BabyPlace, w: WombShape): Float32Array {
  const past = new Float32Array(NT * NP), q = new THREE.Vector3();
  for (let i = 0; i < points.length / 3; i++) {
    q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position).sub(w.centre);
    const r = q.length();
    if (r < 1e-9) continue;
    const over = r / SAC_FILL - sacRadius(w, q.x / r, q.y / r, q.z / r);
    if (over <= 0) continue;
    // to all four cells the sac's radius there is blended from: then the grown sac clears it whatever the blend
    const [ft, fp] = binOf(q.x / r, q.y / r, q.z / r), t0 = Math.min(NT - 2, Math.floor(ft)), p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP;
    for (const k of [t0 * NP + p0, t0 * NP + p1, (t0 + 1) * NP + p0, (t0 + 1) * NP + p1]) past[k] = Math.max(past[k], over);
  }
  return past;
}

/** The sac grown round the baby by how far it stands past it (`babyPast`): the growth spread smoothly round where it is, so it swells rather than bumps; no growth, no change. */
export function growSac(w: WombShape, past: Float32Array): WombShape {
  const grow = past.slice(), tmp = new Float32Array(grow.length);
  for (let pass = 0; pass < 6; pass++) {
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
      let sum = 0, n = 0;
      for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; sum += grow[tt * NP + ((p + dp + NP) % NP)]; n++; }
      tmp[t * NP + p] = Math.max(past[t * NP + p], sum / n);
    }
    grow.set(tmp);
  }
  const r = new Float32Array(w.r.length);
  for (let k = 0; k < r.length; k++) r[k] = w.r[k] + grow[k];
  return { ...w, r };
}

/** HER BELLY'S PUSH: how far her skin must move out in each cell (rest metres), spread smoothly; and where her skin is. */
export interface BellyPush { readonly centre: THREE.Vector3; readonly out: Float32Array; readonly skin: Float32Array; readonly most: number }

/** Where the womb (the sac, its wall) and the tissue over it would stand past her skin, how far: spread so it swells, not dents. */
export function bellyPush(w: WombShape): BellyPush {
  const raw = new Float32Array(NT * NP);
  for (let k = 0; k < raw.length; k++) if (Number.isFinite(w.skin[k])) raw[k] = Math.max(0, w.r[k] + WOMB_WALL_M + WOMB_TISSUE_M - w.skin[k]);
  const out = raw.slice(), tmp = new Float32Array(raw.length);
  for (let pass = 0; pass < 16; pass++) {
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
      let sum = 0, n = 0;
      for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; sum += out[tt * NP + ((p + dp + NP) % NP)]; n++; }
      tmp[t * NP + p] = Math.max(raw[t * NP + p], sum / n);
    }
    out.set(tmp);
  }
  let most = 0; for (const x of out) most = Math.max(most, x);
  return { centre: w.centre.clone(), out, skin: w.skin, most };
}

const gridAt = (g: Float32Array, dx: number, dy: number, dz: number): number => {
  const [ft, fp] = binOf(dx, dy, dz);
  const t0 = Math.min(NT - 2, Math.floor(ft)), a = ft - t0, p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP, b = fp - Math.floor(fp);
  const v = [g[t0 * NP + p0], g[t0 * NP + p1], g[(t0 + 1) * NP + p0], g[(t0 + 1) * NP + p1]];
  if (!v.every(Number.isFinite)) return Math.min(...v.filter(Number.isFinite), Infinity);
  return (v[0] * (1 - b) + v[1] * b) * (1 - a) + (v[2] * (1 - b) + v[3] * b) * a;
};

/** Where on her the push may fall (rest metres): full between, fading over each pair. GAME TUNING (her anatomy). */
export const PUSH_ZONE = Object.freeze({ low: [0.84, 0.96] as const, high: [1.10, 1.23] as const, side: [0.13, 0.24] as const });
const ss01 = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How much of the push may fall at a point of her (rest metres): 1 on her belly, 0 off it. */
export const pushZone = (x: number, y: number): number => ss01(PUSH_ZONE.low[0], PUSH_ZONE.low[1], y) * (1 - ss01(PUSH_ZONE.high[0], PUSH_ZONE.high[1], y)) * (1 - ss01(PUSH_ZONE.side[0], PUSH_ZONE.side[1], Math.abs(x)));

/**
 * The push at a point of her (rest metres): straight out from the womb's middle by the cell's amount -- on her belly's
 * skin and on what she wears just over it, fading to nothing a few centimetres inside it and a few outside (her breasts,
 * her arms, anything further out is not her belly). `out` gets it; returns false where there is none.
 */
export function pushAt(f: BellyPush, x: number, y: number, z: number, out: THREE.Vector3): boolean {
  const dx = x - f.centre.x, dy = y - f.centre.y, dz = z - f.centre.z, r = Math.hypot(dx, dy, dz);
  if (r < 1e-6 || f.most <= 0) return false;
  const ux = dx / r, uy = dy / r, uz = dz / r, amount = gridAt(f.out, ux, uy, uz);
  if (!(amount > 1e-5)) return false;
  const have = gridAt(f.skin, ux, uy, uz);
  if (!Number.isFinite(have)) return false;
  const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // and only her belly: none below her pubic bone (her thighs, her groin), under her breasts, or out at her flanks and arms
  const zone = pushZone(x, y);
  const k = zone * ss(have - 0.08, have - 0.01, r) * (1 - ss(have + 0.03, have + 0.07, r));
  if (k <= 0) return false;
  out.set(ux, uy, uz).multiplyScalar(amount * k);
  return true;
}
