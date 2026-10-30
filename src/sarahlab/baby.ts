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
export function weekForBump(bumpPercent: number, babies = 1): number {
  const b = Math.min(200, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 0));
  const t = BUMP_WEEKS[Math.round(babies)] ?? BUMP_WEEKS[1];
  for (let i = 1; i < t.length; i++) if (b <= t[i][0]) { const [b0, w0] = t[i - 1], [b1, w1] = t[i]; return w0 + (w1 - w0) * (b - b0) / (b1 - b0); }
  return t[t.length - 1][1];
}

/**
 * The week her belly stands for, by how many babies are in it: [belly %, week]. A twin belly runs ahead of a single
 * baby's -- it measures what a full-term one does by about week 32 -- and twins are born around 36-37 weeks, triplets
 * around 33-35 (Joshua, 2026-10-30: "the babies slow down in size so more can fit in the same area"). So the same belly
 * holds twins at an earlier week, each smaller. BIOLOGICAL SHAPE (fundal height, delivery), GAME TUNING (the lines).
 */
export const BUMP_WEEKS: Readonly<Record<number, readonly (readonly [number, number])[]>> = Object.freeze({
  1: [[0, 12], [100, 40], [200, 42]],
  2: [[0, 12], [100, 32], [150, 36], [200, 38]],
  3: [[0, 12], [100, 29], [150, 32.5], [200, 35]],
});

export interface BabySize {
  readonly week: number;
  /** crown-heel length, cm */
  readonly cm: number;
  /** weight, g: at BABY WEIGHT, and the week's average */
  readonly g: number;
  readonly avg: number;
}

/**
 * TWINS AND TRIPLETS grow as singletons do until the womb is shared, then slower: twins from about weeks 30-32 (some
 * 12% below a singleton by week 38), triplets from about 27-28 (some 10% below by 34: 1.9 kg at the 50th percentile,
 * against 2.1). [from week, share at week 40, the line carried on]. BIOLOGICAL SHAPE (twin and triplet growth curves:
 * The Bump/ACOG; triplet EFW, Associates in Advanced Maternal-Fetal Medicine), GAME TUNING (the straight line).
 */
export const MULTIPLE_GROWTH: Readonly<Record<number, readonly [number, number]>> = Object.freeze({ 2: [31, 0.84], 3: [28, 0.78] });
/** A twin's or triplet's share of a singleton's weight at a week (1 for one baby). */
export function multipleShare(week: number, babies = 1): number {
  const m = MULTIPLE_GROWTH[Math.round(babies)];
  if (!m) return 1;
  const [from, at40] = m;
  return week <= from ? 1 : 1 - (1 - at40) * Math.min(1, (week - from) / (40 - from));
}

/** The chart at a (fractional) week and BABY WEIGHT (-100 10th percentile, 0 average, +100 90th); past week 41, its last week's growth carried on. Each of twins or triplets weighs its share (`multipleShare`) and is drawn that much smaller. */
export function babySize(week: number, weightPercent = 0, babies = 1): BabySize {
  const c = FETAL_CHART, first = c[0], last = c[c.length - 1], prev = c[c.length - 2];
  const len = (r: ChartWeek) => (r.crownRump ? r.cm / MODEL_CROWN_RUMP : r.cm);
  const at = (f: (r: ChartWeek) => number): number => {
    if (!(week > first.week)) return f(first);
    if (week >= last.week) return f(last) + (f(last) - f(prev)) * (week - last.week);
    const i = Math.floor(week - first.week), t = week - first.week - i;
    return f(c[i]) + (f(c[i + 1]) - f(c[i])) * t;
  };
  const w = Math.min(100, Math.max(-100, Number.isFinite(weightPercent) ? weightPercent : 0)) / 100;
  const avg = at((r) => r.g), single = w < 0 ? avg + w * (avg - at((r) => r.lo)) : avg + w * (at((r) => r.hi) - avg);
  const share = multipleShare(week, babies);
  // a twin's length: the singleton's, by the same root its weight is drawn by
  return { week, cm: at(len) * Math.pow(share, WEIGHT_SIZE_POWER), g: single * share, avg: avg * share };
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

export const BABIES_NAME: Readonly<Record<number, string>> = Object.freeze({ 1: 'ONE', 2: 'TWINS', 3: 'TRIPLETS' });

/** The baby's line: its week, length and weight now (each, for twins or triplets). */
export function babyLine(bumpPercent: number, weightPercent: number, babies = 1): string {
  const s = babySize(weekForBump(bumpPercent, babies), weightPercent, babies);
  return `${babies > 1 ? `${BABIES_NAME[babies] ?? babies} · ` : ''}week ${s.week.toFixed(s.week % 1 < 0.05 || s.week % 1 > 0.95 ? 0 : 1)} · ${babies > 1 ? 'each ' : ''}${s.cm.toFixed(1)} cm (${(s.cm / 2.54).toFixed(1)} in) · ${weighs(s.g)}`;
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
export function babyPlace(bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: { readonly centre: THREE.Vector3; readonly axis: THREE.Vector3 }, backToLeft = BACK_TO_LEFT_RAD, babies = 1): BabyPlace {
  const s = babySize(weekForBump(bumpPercent, babies), weightPercent, babies);
  // (cm already carries a twin's share; the weight's own root is against the week's average for so many)
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
  /**
   * how much her belly can give that way (0..1): how far her DEPTH field moves her skin out there against where it moves
   * it most -- 0 behind, below and wherever her skin is not. Absent: 1 wherever there is skin.
   */
  readonly give?: Float32Array;
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
export function wombFromSkin(skin: ArrayLike<number>, week: number, backShift = 0, depth?: ArrayLike<number>): WombShape {
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
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (centre.z + m * dz > womBackAt(centre.y + m * dy) - backShift) lo = m; else hi = m; }
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
  // how far her DEPTH field moves her skin out in each cell (the most of its points there), against the most anywhere
  let give: Float32Array | undefined;
  if (depth && depth.length >= n * 3) {
    give = new Float32Array(NT * NP);
    let most = 0;
    for (let i = 0; i < n; i++) {
      const x = skin[i * 3] - centre.x, y = skin[i * 3 + 1] - centre.y, z = skin[i * 3 + 2] - centre.z, r = Math.hypot(x, y, z);
      if (r < 1e-6) continue;
      const out = (depth[i * 3] * x + depth[i * 3 + 1] * y + depth[i * 3 + 2] * z) / r;
      const [ft, fp] = binOf(x / r, y / r, z / r), k = Math.round(ft) * NP + (Math.floor(fp + 0.5) % NP);
      give[k] = Math.max(give[k], out); most = Math.max(most, out);
    }
    if (most > 0) for (let k = 0; k < give.length; k++) give[k] = Math.max(0, give[k] / most);
  }
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
  return { centre, r, axis, skin: skinRaw, give };
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
export interface BellyPush {
  readonly centre: THREE.Vector3; readonly out: Float32Array; readonly skin: Float32Array;
  /** the dome's height at its crown (rest metres): 0, nothing moves */
  readonly most: number;
  /** the dome: its crown's height (y), and the point behind her it swells away from */
  readonly crownY: number; readonly pivot: THREE.Vector3;
  /** its half widths (rest metres) and how far it sags below her pubic bone's usual edge */
  readonly across: number; readonly up: number; readonly sag: number;
}

/**
 * THE DOME (Joshua, 2026-10-30, of twins: "the belly from the front view looks too wide and flat... keep it more
 * smooth/rounded and not so wide"): her belly grows as one rounded swell -- tallest at its middle, falling away toward
 * her sides, ribs and pubic bone like a bell -- away from a point behind her, so mostly forward. Its half widths
 * (rest metres) across and up, how far behind her belly's middle it swells from, and how much of the dome a need must
 * stand in to set its height (needs further out it rounds over). GAME TUNING.
 */
export const DOME = Object.freeze({ across: 0.12, up: 0.15, pivotBack: 0.32, sets: 0.5 });
/** The dome's share at a point of her (0..1). */
export const domeAt = (f: Pick<BellyPush, 'crownY' | 'across' | 'up'>, x: number, y: number): number => Math.exp(-((x / f.across) ** 2) - (((y - f.crownY) / f.up) ** 2));

/**
 * Where the womb (the sac, its wall) and the tissue over it would stand past her skin, how far -- and then THE HYBRID
 * (Joshua, 2026-10-30: "a Hybrid belly of the approved shape + the baby's belly shape deformation as it is too lumpy"):
 * her approved belly grown by one rounded dome (`DOME`), not a bump over every knee and head -- the dome as low as it can
 * be and still clear every need, so the babies stay inside her and her belly stays one rounded belly. Left and right
 * alike, whichever side a baby lies on.
 */
export function bellyPush(w: WombShape, babies = 1): BellyPush {
  const raw = new Float32Array(NT * NP);
  for (let k = 0; k < raw.length; k++) if (Number.isFinite(w.skin[k])) raw[k] = Math.max(0, w.r[k] + WOMB_WALL_M + WOMB_TISSUE_M - w.skin[k]);
  // her belly grows evenly, left and right, whichever side a baby lies on
  for (let t = 0; t < NT; t++) for (let p = 1; p < NP / 2; p++) {
    const a = t * NP + p, b = t * NP + ((NP - p) % NP), m = Math.max(raw[a], raw[b]); raw[a] = m; raw[b] = m;
  }
  // the dome: as low as it can be and still clear every need, seen along each need's own direction
  // more than one: the dome on her belly only, her pubic area and hips left as they are (their sag is the BABY WEIGHT
  // shapes', carried heavy -- SarahLabScene's carriedWeight)
  const firm = babies >= 2 ? 1 : 0, across = DOME.across, up = DOME.up, sag = -firm * FIRM_LIFT;
  const crownY = w.centre.y, pivot = new THREE.Vector3(0, crownY, w.centre.z - DOME.pivotBack), dir = new THREE.Vector3(), at = new THREE.Vector3(), n = new THREE.Vector3();
  const shape = { crownY, across, up };
  let most = 0;
  for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
    const k = t * NP + p, need = raw[k];
    if (!(need > 0) || !Number.isFinite(w.skin[k])) continue;
    const th = (t / (NT - 1)) * Math.PI, ph = (p / NP) * 2 * Math.PI;
    dir.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
    at.copy(w.centre).addScaledVector(dir, w.skin[k]);
    const d = domeAt(shape, at.x, at.y) * pushZone(at.x, at.y, 0, at.z, sag, firm);
    if (d < DOME.sets) continue;   // a need out toward her edges is the dome's to round over, not to raise it for
    n.copy(at).sub(pivot).normalize();
    most = Math.max(most, need / (d * Math.max(0.3, n.dot(dir))));
  }
  // never more than half again the largest need: a dome, not a tower
  let largest = 0; for (const x of raw) largest = Math.max(largest, x);
  most = Math.min(most, 1.5 * largest);
  const out = raw;
  return { centre: w.centre.clone(), out, skin: w.skin, most, crownY, pivot, across, up, sag };
}

const gridAt = (g: Float32Array, dx: number, dy: number, dz: number): number => {
  const [ft, fp] = binOf(dx, dy, dz);
  const t0 = Math.min(NT - 2, Math.floor(ft)), a = ft - t0, p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP, b = fp - Math.floor(fp);
  const v = [g[t0 * NP + p0], g[t0 * NP + p1], g[(t0 + 1) * NP + p0], g[(t0 + 1) * NP + p1]];
  if (!v.every(Number.isFinite)) return Math.min(...v.filter(Number.isFinite), Infinity);
  return (v[0] * (1 - b) + v[1] * b) * (1 - a) + (v[2] * (1 - b) + v[3] * b) * a;
};

/** Where on her the push may fall (rest metres): full between, fading over each pair. GAME TUNING (her anatomy). */
export const PUSH_ZONE = Object.freeze({ low: [0.84, 0.96] as const, high: [1.10, 1.23] as const, side: [0.18, 0.30] as const, back: [-0.11, -0.03] as const });
const ss01 = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
/** How much of the push may fall at a point of her (rest metres): 1 on her belly, 0 off it. */
export const pushZone = (x: number, y: number, most = 0, z = 1, sag = 0, firm = 0): number => ss01(PUSH_ZONE.low[0] - sag, PUSH_ZONE.low[1] - sag, y) * (1 - ss01(PUSH_ZONE.high[0], PUSH_ZONE.high[1], y)) * (1 - ss01(PUSH_ZONE.side[0] - firm * FIRM_NARROW, Math.min(PUSH_SIDE_MOST, PUSH_ZONE.side[1] - firm * FIRM_NARROW + PUSH_SIDE_GROW * most), Math.abs(x))) * ss01(PUSH_ZONE.back[0], PUSH_ZONE.back[1], z);
/** More than one baby: the push kept off her pubic area (its lower edge lifted) and her hips (its sides drawn in). Rest metres. GAME TUNING. */
export const FIRM_LIFT = 0.06, FIRM_NARROW = 0.05;
/** However big the push, it is gone by here out at her sides (rest metres): well inside what is laid. GAME TUNING. */
export const PUSH_SIDE_MOST = 0.36;
/** A bigger push fades out over more of her flank (metres of fade per metre of push), so it rounds her sides, not cuts them. GAME TUNING. */
export const PUSH_SIDE_GROW = 0;

/**
 * The push at a point of her (rest metres): straight out from the womb's middle by the cell's amount -- on her belly's
 * skin and on what she wears just over it, fading to nothing a few centimetres inside it and a few outside (her breasts,
 * her arms, anything further out is not her belly). `out` gets it; returns false where there is none.
 */
export function pushAt(f: BellyPush, x: number, y: number, z: number, out: THREE.Vector3): boolean {
  if (!(f.most > 0)) return false;
  const dx = x - f.centre.x, dy = y - f.centre.y, dz = z - f.centre.z, r = Math.hypot(dx, dy, dz);
  if (r < 1e-6) return false;
  const have = gridAt(f.skin, dx / r, dy / r, dz / r);
  if (!Number.isFinite(have)) return false;
  const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // on her belly's skin and what she wears just over it; only her belly (the zone), as the dome falls away
  const k = domeAt(f, x, y) * pushZone(x, y, 0, z, f.sag, f.sag < 0 ? 1 : 0) * ss(have - 0.08, have - 0.01, r) * (1 - ss(have + 0.03, have + 0.07, r));
  if (k <= 1e-4) return false;
  out.set(x, y, z).sub(f.pivot).normalize().multiplyScalar(f.most * k);
  return true;
}

// ------------------------------------------------------------------------------------------ twins, triplets, and lie

/**
 * HOW EACH BABY LIES (Joshua, 2026-10-30: "more than one baby, the cord(s), positions, and kicks"). Head down (vertex,
 * most babies by week 36), breech (bottom down), or sideways (transverse, across her). AUTO is what is commonest: one
 * baby head down; twins the first (lowest) head down and the second breech; triplets two head down low, side by side, and
 * the third breech above them in front (of the layouts measured, the one her belly holds with least growth).
 */
export type Lie = 'head' | 'breech' | 'side';
export const LIE_NAME: Readonly<Record<Lie, string>> = Object.freeze({ head: 'head down', breech: 'breech', side: 'sideways' });
export const AUTO_LIES: Readonly<Record<number, readonly Lie[]>> = Object.freeze({ 1: ['head'], 2: ['head', 'breech'], 3: ['head', 'head', 'breech'] });

/**
 * Where in her womb each of so many babies starts (rest metres from its middle: x her left): the first (the one to be
 * born first) lowest, on her right; the second higher, on her left; a third across the top. GAME TUNING.
 */
export const BABY_SPOTS: Readonly<Record<number, readonly (readonly [number, number, number])[]>> = Object.freeze({
  1: [[0, 0, 0]],
  2: [[-0.02, -0.065, -0.015], [0.02, 0.065, 0.035]],
  3: [[-0.06, -0.05, -0.01], [0.06, -0.05, -0.01], [0, 0.07, 0.07]],
});

/** The axes a baby's long axis is tried along for a lie (its head toward -axis), each tipped a little. */
function lieAxes(lie: Lie, x: number): THREE.Vector3[] {
  if (lie === 'side') {
    // across her: its head toward the side it is nearer (her left for one in the middle)
    const toLeft = x >= 0 ? 1 : -1;
    return [0, 0.25, -0.25].map((t) => new THREE.Vector3(-toLeft * Math.cos(t), Math.sin(t), 0));
  }
  const up = lie === 'head' ? 1 : -1;
  return FIT_TILTS.map((t) => new THREE.Vector3(0, Math.cos(t), Math.sin(t)).multiplyScalar(up));
}

/** A placed baby's body as an ellipsoid (its curl's box, a little inside it): for keeping babies out of one another. */
export interface BabyBody { readonly centre: THREE.Vector3; readonly axes: readonly THREE.Vector3[]; readonly half: readonly number[] }
export function babyBody(place: BabyPlace, curl: CurlFrame): BabyBody {
  const centre = curl.centre.clone().multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position);
  const axes = [curl.side, curl.long, curl.back].map((a) => a.clone().applyQuaternion(place.quaternion));
  const half = [curl.size.x, curl.size.y, curl.size.z].map((v) => v * place.scale * 0.42);
  return { centre, axes, half };
}

/**
 * THEM ALL TOGETHER (Joshua, 2026-10-30: "keep the approved body shape, see if the womb area could be any bigger to allow
 * more room without changing the belly shape much"). The babies -- one, two or three -- are PACKED: moved and turned all
 * together, not laid one after another, until they fill her womb the way real ones do (a head in the hollow of another's
 * knees, a back along a back), with as little of any of them past her womb's wall as can be and none inside another.
 * Where some must still stand past the wall, it is where her belly can give (`WombShape.give`: her DEPTH), never through
 * her spine, her pelvic floor or under her ribs.
 */

/**
 * A curled baby's body as a solid (its curl's model units, about the curl's middle): a grid of small cubes, each holding
 * how deep inside the body its middle is (0 outside) -- found from its skin's points, everything the outside cannot reach
 * being inside. What keeps one baby out of another, nested into its hollows as they lie, not kept off by them.
 */
export interface BabySolid { readonly min: THREE.Vector3; readonly cube: number; readonly dims: readonly [number, number, number]; readonly deep: Float32Array }
/** The solid's cube, in the model's units (about a centimetre at term). GAME TUNING. */
export const SOLID_CUBE = 0.03;
export function babySolid(points: ArrayLike<number>, curl: CurlFrame, cube = SOLID_CUBE): BabySolid {
  const n = Math.floor(points.length / 3), lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity), q = new THREE.Vector3();
  for (let i = 0; i < n; i++) { q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).sub(curl.centre); lo.min(q); hi.max(q); }
  const min = lo.subScalar(2 * cube), nx = Math.ceil((hi.x - min.x) / cube) + 2, ny = Math.ceil((hi.y - min.y) / cube) + 2, nz = Math.ceil((hi.z - min.z) / cube) + 2;
  const at = (x: number, y: number, z: number) => (z * ny + y) * nx + x, cells = nx * ny * nz;
  // its skin
  const skin = new Uint8Array(cells);
  for (let i = 0; i < n; i++) {
    const x = Math.floor((points[i * 3] - curl.centre.x - min.x) / cube), y = Math.floor((points[i * 3 + 1] - curl.centre.y - min.y) / cube), z = Math.floor((points[i * 3 + 2] - curl.centre.z - min.z) / cube);
    skin[at(x, y, z)] = 1;
  }
  // the outside: all the outside can reach without crossing its skin
  const out = new Uint8Array(cells), queue = new Int32Array(cells);
  let head = 0, tail = 0;
  out[0] = 1; queue[tail++] = 0;
  while (head < tail) {
    const c = queue[head++], x = c % nx, y = Math.floor(c / nx) % ny, z = Math.floor(c / (nx * ny));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
      const k = at(X, Y, Z);
      if (out[k] || skin[k]) continue;
      out[k] = 1; queue[tail++] = k;
    }
  }
  // how deep each cube inside is: its distance from the outside (two sweeps over the grid, each cube from its neighbours)
  const deep = new Float32Array(cells);
  for (let k = 0; k < cells; k++) deep[k] = out[k] ? 0 : Infinity;
  const steps: [number, number, number, number][] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) steps.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);
  const fwd = steps.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0)))), back = steps.filter((s) => !fwd.includes(s));
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const k = at(x, y, z); if (!deep[k]) continue;
      for (const [dx, dy, dz, d] of fwd) { const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue; deep[k] = Math.min(deep[k], deep[at(X, Y, Z)] + d); }
    }
    for (let z = nz - 1; z >= 0; z--) for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) {
      const k = at(x, y, z); if (!deep[k]) continue;
      for (const [dx, dy, dz, d] of back) { const X = x + dx, Y = y + dy, Z = z + dz; if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue; deep[k] = Math.min(deep[k], deep[at(X, Y, Z)] + d); }
    }
  }
  // in the model's units, from its skin (a skin cube's middle is about half a cube in)
  for (let k = 0; k < cells; k++) deep[k] = Number.isFinite(deep[k]) && deep[k] > 0 ? (deep[k] - 0.5) * cube : 0;
  return { min, cube, dims: [nx, ny, nz], deep };
}
/** How deep a point (model units, about the curl's middle) is inside the solid (model units; 0 outside), blended between cubes. */
export function solidDeep(b: BabySolid, x: number, y: number, z: number): number {
  const [nx, ny, nz] = b.dims;
  const fx = (x - b.min.x) / b.cube - 0.5, fy = (y - b.min.y) / b.cube - 0.5, fz = (z - b.min.z) / b.cube - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= nx - 1 || y0 >= ny - 1 || z0 >= nz - 1) return 0;
  const u = fx - x0, v = fy - y0, w = fz - z0, D = b.deep, k = (z0 * ny + y0) * nx + x0, sy = nx, sz = nx * ny;
  const c00 = D[k] * (1 - u) + D[k + 1] * u, c10 = D[k + sy] * (1 - u) + D[k + sy + 1] * u;
  const c01 = D[k + sz] * (1 - u) + D[k + sz + 1] * u, c11 = D[k + sz + sy] * (1 - u) + D[k + sz + sy + 1] * u;
  return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
}

/** The points a packing is scored on (its curl's model units, about the curl's middle): this many, spread evenly over the baby. GAME TUNING. */
export const PACK_POINTS = 220;
const packSamples = new WeakMap<object, Float32Array>();
function packSample(points: ArrayLike<number>, curl: CurlFrame): Float32Array {
  const hit = packSamples.get(points as object);
  if (hit) return hit;
  const n = Math.floor(points.length / 3), k = Math.min(PACK_POINTS, n), out = new Float32Array(k * 3), d = new Float32Array(n).fill(Infinity);
  // farthest-point sampling, from the point furthest from its middle
  let pick = 0, far = -1;
  for (let i = 0; i < n; i++) { const r = Math.hypot(points[i * 3] - curl.centre.x, points[i * 3 + 1] - curl.centre.y, points[i * 3 + 2] - curl.centre.z); if (r > far) { far = r; pick = i; } }
  for (let j = 0; j < k; j++) {
    out[j * 3] = points[pick * 3] - curl.centre.x; out[j * 3 + 1] = points[pick * 3 + 1] - curl.centre.y; out[j * 3 + 2] = points[pick * 3 + 2] - curl.centre.z;
    let next = 0, best = -1;
    for (let i = 0; i < n; i++) {
      const e = Math.hypot(points[i * 3] - points[pick * 3], points[i * 3 + 1] - points[pick * 3 + 1], points[i * 3 + 2] - points[pick * 3 + 2]);
      if (e < d[i]) d[i] = e;
      if (d[i] > best) { best = d[i]; next = i; }
    }
    pick = next;
  }
  packSamples.set(points as object, out);
  return out;
}

/** A radial grid's radius along a direction (bilinear), for grids that are not a womb. */
const radialAt = (r: Float32Array, dx: number, dy: number, dz: number): number => {
  const [ft, fp] = binOf(dx, dy, dz);
  const t0 = Math.min(NT - 2, Math.floor(ft)), a = ft - t0, p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP, b = fp - Math.floor(fp);
  return (r[t0 * NP + p0] * (1 - b) + r[t0 * NP + p1] * b) * (1 - a) + (r[(t0 + 1) * NP + p0] * (1 - b) + r[(t0 + 1) * NP + p1] * b) * a;
};

/**
 * What a packing weighs (GAME TUNING): a point past her womb's wall costs as the square of how far, more by `PACK_STIFF`
 * where her belly cannot give; a point inside another baby by `PACK_APART`; a baby lying further from its lie than
 * `LIE_CONE_DEG` by `PACK_LIE`; and each a little by how high it floats (`PACK_SETTLE`: they settle).
 */
export const PACK_STIFF = 8, PACK_APART = 10, PACK_LIE = 0.5, PACK_SETTLE = 0, LIE_CONE_DEG = 50;
/** How willing a packing is, early on, to take a step that weighs a little more (so it is not stuck in the first hollow it finds). GAME TUNING. */
export const PACK_WARMTH = 1e-4;
/** How deep into one another two babies may press before it counts (rest metres: they are soft). GAME TUNING. */
export const PACK_SOFT = 0.004;

interface Pose { c: THREE.Vector3; q: THREE.Quaternion }
export interface Packing {
  readonly fits: BabyFit[];
  /** how far the furthest point stands past the wall where her belly is (rest metres; negative inside) */
  readonly over: number;
  /** ... and where she is not (behind, below, under her ribs) */
  readonly hard: number;
  /** how deep the deepest point stands inside another baby */
  readonly inside: number;
  readonly energy: number;
}

/** How far a placed baby's furthest point stands past the sac's wall: where her belly's skin is that way, and where it is not. */
export function pastWall(points: ArrayLike<number>, place: BabyPlace, w: WombShape): { belly: number; inside: number } {
  const q = new THREE.Vector3(); let belly = -Infinity, inside = -Infinity;
  for (let i = 0; i < points.length / 3; i++) {
    q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position).sub(w.centre);
    const r = q.length();
    if (r < 1e-9) continue;
    const over = r - sacRadius(w, q.x / r, q.y / r, q.z / r) * SAC_FILL;
    if (Number.isFinite(gridAt(w.skin, q.x / r, q.y / r, q.z / r))) belly = Math.max(belly, over); else inside = Math.max(inside, over);
  }
  return { belly, inside };
}

/**
 * What standing past her womb's wall costs at a point (rest metres): as the square of how far, more by `PACK_STIFF` where
 * her belly cannot give. Worked out once a womb on a grid of small cubes round it and blended between them (a packing
 * asks it hundreds of thousands of times); straight from the womb outside the grid.
 */
interface WallField { readonly min: THREE.Vector3; readonly cube: number; readonly dims: readonly [number, number, number]; readonly cost: Float32Array }
const wallFields = new WeakMap<WombShape, WallField>();
function wallAt(w: WombShape, x: number, y: number, z: number): number {
  const dx = x - w.centre.x, dy = y - w.centre.y, dz = z - w.centre.z, r = Math.hypot(dx, dy, dz);
  if (r < 1e-9) return 0;
  const over = r - sacRadius(w, dx / r, dy / r, dz / r) * SAC_FILL;
  if (over <= 0) return 0;
  const g = w.give ? radialAt(w.give, dx / r, dy / r, dz / r) : 1;
  return over * over * (1 + PACK_STIFF * (1 - Math.min(1, Math.max(0, g))));
}
function wallField(w: WombShape): WallField {
  const hit = wallFields.get(w);
  if (hit) return hit;
  let most = 0; for (const r of w.r) most = Math.max(most, r);
  const half = most + 0.05, cube = 0.008, n = Math.ceil((2 * half) / cube) + 1;
  // each cube worked out the first time it is asked for (a packing only ever goes near a few of them)
  const min = w.centre.clone().subScalar(half), cost = new Float32Array(n * n * n).fill(NaN);
  const f: WallField = { min, cube, dims: [n, n, n], cost };
  wallFields.set(w, f);
  return f;
}
function wallCost(f: WallField, w: WombShape, x: number, y: number, z: number): number {
  const [nx, ny, nz] = f.dims, fx = (x - f.min.x) / f.cube, fy = (y - f.min.y) / f.cube, fz = (z - f.min.z) / f.cube;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= nx - 1 || y0 >= ny - 1 || z0 >= nz - 1) return wallAt(w, x, y, z);
  const u = fx - x0, v = fy - y0, t = fz - z0, C = f.cost, k = (z0 * ny + y0) * nx + x0, sy = nx, sz = nx * ny;
  if (C[k] !== C[k] || C[k + 1] !== C[k + 1] || C[k + sy] !== C[k + sy] || C[k + sy + 1] !== C[k + sy + 1] || C[k + sz] !== C[k + sz] || C[k + sz + 1] !== C[k + sz + 1] || C[k + sz + sy] !== C[k + sz + sy] || C[k + sz + sy + 1] !== C[k + sz + sy + 1]) {
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const c = k + dz * sz + dy * sy + dx;
      if (C[c] === C[c]) continue;
      C[c] = wallAt(w, f.min.x + (x0 + dx) * f.cube, f.min.y + (y0 + dy) * f.cube, f.min.z + (z0 + dz) * f.cube);
    }
  }
  const c00 = C[k] * (1 - u) + C[k + 1] * u, c10 = C[k + sy] * (1 - u) + C[k + sy + 1] * u;
  const c01 = C[k + sz] * (1 - u) + C[k + sz + 1] * u, c11 = C[k + sz + sy] * (1 - u) + C[k + sz + sy + 1] * u;
  return (c00 * (1 - v) + c10 * v) * (1 - t) + (c01 * (1 - v) + c11 * v) * t;
}

/** A tiny seeded random source, so a packing is the same every time it is asked for. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (rnd: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());

/** A fit as its curl's middle and its turn. */
function poseOf(f: BabyPlace, curl: CurlFrame): Pose {
  return { c: curl.centre.clone().multiplyScalar(f.scale).applyQuaternion(f.quaternion).add(f.position), q: f.quaternion.clone() };
}

/**
 * The babies packed in her womb at the chart's size for so many (times `shrink`), each lying as asked: from a few starts
 * (and from `warm`, a packing a moment ago, when given), moved and turned a little at a time, keeping every step that
 * weighs less, a few hundred steps a baby. `over`: how far the furthest point of any stands past the wall (rest metres;
 * negative inside); `inside`: how deep the deepest stands in another.
 */
export function packBabies(points: ArrayLike<number>, solid: BabySolid, bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: WombShape, lies: readonly Lie[], shrink = 1, opts: { warm?: readonly BabyFit[]; effort?: number; seed?: number } = {}): Packing {
  const n = lies.length, sample = packSample(points, curl), m = sample.length / 3;
  const s0 = babyPlace(bumpPercent, weightPercent, curl, { centre: womb.centre, axis: new THREE.Vector3(0, 1, 0) }, BACK_TO_LEFT_RAD, n).scale, s = s0 * shrink;
  const field = wallField(womb), cone = Math.cos((LIE_CONE_DEG * Math.PI) / 180), sideCone = Math.cos(((LIE_CONE_DEG - 10) * Math.PI) / 180);   // sideways: across her, left to right
  const floorY = womb.centre.y - sacRadius(womb, 0, -1, 0);
  const qi = new THREE.Quaternion(), v = new THREE.Vector3(), h = new THREE.Vector3(), bk = new THREE.Vector3();
  // each baby's points as placed (rest metres)
  const turn = new THREE.Matrix4(), t3 = turn.elements;
  const place = (p: Pose, out: Float32Array) => {
    turn.makeRotationFromQuaternion(p.q);
    for (let i = 0; i < m; i++) {
      const x = sample[i * 3] * s, y = sample[i * 3 + 1] * s, z = sample[i * 3 + 2] * s;
      out[i * 3] = t3[0] * x + t3[4] * y + t3[8] * z + p.c.x; out[i * 3 + 1] = t3[1] * x + t3[5] * y + t3[9] * z + p.c.y; out[i * 3 + 2] = t3[2] * x + t3[6] * y + t3[10] * z + p.c.z;
    }
  };
  /** its own weight: past the wall, its lie, how high it floats */
  const own = (p: Pose, at: Float32Array, lie: Lie): number => {
    let e = 0;
    for (let i = 0; i < m; i++) e += wallCost(field, womb, at[i * 3], at[i * 3 + 1], at[i * 3 + 2]);
    h.copy(curl.long).applyQuaternion(p.q);
    const pen = lie === 'head' ? Math.max(0, cone + h.y) : lie === 'breech' ? Math.max(0, cone - h.y) : Math.max(0, sideCone - Math.abs(h.x));
    // its back a little toward her front, as most settle (never against its lie)
    bk.copy(curl.back).applyQuaternion(p.q);
    return e + PACK_LIE * pen * pen + 0.002 * PACK_LIE * Math.max(0, -bk.z) ** 2 + PACK_SETTLE * (p.c.y - floorY);
  };
  /** how deep `at` (one baby's points) stands inside the baby posed `p`, squared, summed; and the deepest */
  let deepest = 0;
  // (the solid's reach from its middle: a point further than this from a baby is not in it)
  let solidReach = 0;
  { const [nx, ny, nz] = solid.dims; for (const c of [solid.min, solid.min.clone().add(new THREE.Vector3(nx, ny, nz).multiplyScalar(solid.cube))]) solidReach = Math.max(solidReach, c.length()); }
  const rot = new THREE.Matrix4(), e3 = rot.elements, reach2 = (solidReach * s) ** 2;
  const into = (at: Float32Array, p: Pose): number => {
    // into its own frame (its turn undone, its size taken off): one matrix, its rows by hand
    rot.makeRotationFromQuaternion(qi.copy(p.q).invert());
    const cx = p.c.x, cy = p.c.y, cz = p.c.z;
    let e = 0;
    // (every other point: plenty to keep two apart)
    for (let i = 0; i < m; i += 2) {
      const x = at[i * 3] - cx, y = at[i * 3 + 1] - cy, z = at[i * 3 + 2] - cz;
      if (x * x + y * y + z * z > reach2) continue;
      const pen = solidDeep(solid, (e3[0] * x + e3[4] * y + e3[8] * z) / s, (e3[1] * x + e3[5] * y + e3[9] * z) / s, (e3[2] * x + e3[6] * y + e3[10] * z) / s) * s - PACK_SOFT;
      if (pen > 0) { e += pen * pen; if (pen > deepest) deepest = pen; }
    }
    return e;
  };
  const pair = (a: number, b: number, poses: Pose[], ats: Float32Array[]) => PACK_APART * (into(ats[a], poses[b]) + into(ats[b], poses[a]));

  /** the starts: as asked (`warm`), the commonest spots for so many, and some of them turned and shifted */
  const rnd = seeded(opts.seed ?? 7);
  const starts: Pose[][] = [];
  if (opts.warm && opts.warm.length === n) starts.push(opts.warm.map((f) => poseOf(f, curl)));
  const spots = BABY_SPOTS[n] ?? BABY_SPOTS[1];
  const restarts = opts.warm ? 1 : n === 1 ? 2 : 3;
  for (let r = 0; r < restarts; r++) {
    const set: Pose[] = [];
    for (let b = 0; b < n; b++) {
      const sp = spots[b] ?? [0, 0, 0], jitter = r === 0 ? 0 : 0.03;
      const at = new THREE.Vector3(sp[0] + jitter * gauss(rnd), sp[1] + jitter * gauss(rnd), sp[2] + jitter * gauss(rnd)).add(womb.centre);
      const axis = lieAxes(lies[b], sp[0])[r === 0 ? (lies[b] === 'side' ? 0 : FIT_TILTS.indexOf(0)) : Math.floor(rnd() * (lies[b] === 'side' ? 3 : FIT_TILTS.length))];
      const p = babyPlace(bumpPercent, weightPercent, curl, { centre: at, axis }, (b % 2 ? -1 : 1) * BACK_TO_LEFT_RAD + (r === 0 ? 0 : (rnd() - 0.5) * 1.5), n);
      set.push({ c: at, q: p.quaternion });
    }
    starts.push(set);
  }
  if (n === 1 && lies[0] === 'head' && !opts.warm) { const f = placeBaby(points, bumpPercent, weightPercent, curl, womb); starts.unshift([poseOf(f, curl)]); }

  const steps = Math.round((opts.effort ?? 1) * 400 * n);
  let bestPoses: Pose[] = starts[0], bestE = Infinity;
  for (const start of starts) {
    const poses = start.map((p) => ({ c: p.c.clone(), q: p.q.clone() }));
    const ats = poses.map((p) => { const a = new Float32Array(m * 3); place(p, a); return a; });
    const owns = poses.map((p, b) => own(p, ats[b], lies[b]));
    const pairs = new Float64Array(n * n);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs[a * n + b] = pair(a, b, poses, ats);
    let total = owns.reduce((x, y) => x + y, 0) + pairs.reduce((x, y) => x + y, 0);
    const trial = new Float32Array(m * 3), dq = new THREE.Quaternion(), ax = new THREE.Vector3();
    for (let it = 0; it < steps; it++) {
      const b = it % n, k = 1 - it / steps, cur = poses[b];
      const next: Pose = { c: cur.c.clone(), q: cur.q.clone() };
      if (rnd() < 0.55) next.c.add(v.set(gauss(rnd), gauss(rnd), gauss(rnd)).multiplyScalar(0.001 + 0.012 * k));
      else { ax.set(gauss(rnd), gauss(rnd), gauss(rnd)).normalize(); dq.setFromAxisAngle(ax, gauss(rnd) * (0.02 + 0.25 * k)); next.q.premultiply(dq).normalize(); }
      place(next, trial);
      const o = own(next, trial, lies[b]);
      let d = o - owns[b];
      const saved = ats[b]; ats[b] = trial; poses[b] = next;
      const np: number[] = [];
      for (let a = 0; a < n; a++) if (a !== b) { const lo = Math.min(a, b), hi = Math.max(a, b), e = pair(lo, hi, poses, ats); np.push(e); d += e - pairs[lo * n + hi]; }
      if (d < 0 || (k > 0.15 && rnd() < Math.exp(-d / (PACK_WARMTH * k * k * (opts.warm ? 0.2 : 1))))) {
        owns[b] = o; total += d; ats[b] = saved; ats[b].set(trial);
        let j = 0; for (let a = 0; a < n; a++) if (a !== b) { pairs[Math.min(a, b) * n + Math.max(a, b)] = np[j++]; }
      } else { ats[b] = saved; poses[b] = cur; }
    }
    if (total < bestE) { bestE = total; bestPoses = poses.map((p) => ({ c: p.c.clone(), q: p.q.clone() })); }
  }
  const fits: BabyFit[] = bestPoses.map((p) => {
    h.copy(curl.long).applyQuaternion(p.q);
    return { position: p.c.clone().sub(curl.centre.clone().multiplyScalar(s).applyQuaternion(p.q)), quaternion: p.q, scale: s, squeezed: shrink, tilt: Math.atan2(-h.z, -h.y) };
  });
  // how it came out: the furthest of all of each past the wall where her belly is (all its points) and where she is not
  // (behind, below, under her ribs: inside her, unseen, but not to be more than a little), the deepest one in another
  let over = -Infinity, hard = -Infinity;
  for (const f of fits) { const w = pastWall(points, f, womb); over = Math.max(over, w.belly); hard = Math.max(hard, w.inside); }
  deepest = 0;
  const ats = bestPoses.map((p) => { const a = new Float32Array(m * 3); place(p, a); return a; });
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) if (a !== b) into(ats[a], bestPoses[b]);
  return { fits, over, hard, inside: deepest, energy: bestE };
}

/** The babies packed (`packBabies`) where nothing else is wanted of them: the chart's size times `shrink`. */
export function placeBabies(points: ArrayLike<number>, bumpPercent: number, weightPercent: number, curl: CurlFrame, womb: WombShape, lies: readonly Lie[], shrink = 1): BabyFit[] {
  return packBabies(points, babySolid(points, curl), bumpPercent, weightPercent, curl, womb, lies, shrink).fits;
}


/** Each of several babies' own sac: round it, with a little fluid, its own middle (rest metres). */
export function sacAround(points: ArrayLike<number>, place: BabyPlace, curl: CurlFrame): WombShape {
  const centre = curl.centre.clone().multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position);
  const reach = new Float32Array(NT * NP), q = new THREE.Vector3();
  for (let i = 0; i < points.length / 3; i++) {
    q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(place.scale).applyQuaternion(place.quaternion).add(place.position).sub(centre);
    const r = q.length();
    if (r < 1e-9) continue;
    const [ft, fp] = binOf(q.x / r, q.y / r, q.z / r), t0 = Math.min(NT - 2, Math.floor(ft)), p0 = Math.floor(fp) % NP, p1 = (p0 + 1) % NP;
    for (const k of [t0 * NP + p0, t0 * NP + p1, (t0 + 1) * NP + p0, (t0 + 1) * NP + p1]) reach[k] = Math.max(reach[k], r / 0.93);
  }
  // rounded over its folds (never inside where it reaches)
  const r = reach.slice(), tmp = new Float32Array(r.length);
  for (let pass = 0; pass < 10; pass++) {
    for (let t = 0; t < NT; t++) for (let p = 0; p < NP; p++) {
      let sum = 0, k = 0;
      for (let dt = -1; dt <= 1; dt++) for (let dp = -1; dp <= 1; dp++) { const tt = t + dt; if (tt < 0 || tt >= NT) continue; sum += r[tt * NP + ((p + dp + NP) % NP)]; k++; }
      tmp[t * NP + p] = Math.max(reach[t * NP + p], sum / k);
    }
    r.set(tmp);
  }
  return { centre, r, axis: new THREE.Vector3(0, 1, 0), skin: new Float32Array(NT * NP).fill(Infinity) };
}

/** How far any of the babies stands past the womb, per cell (the largest of `babyPast` over them). */
export function babiesPast(points: ArrayLike<number>, places: readonly BabyPlace[], w: WombShape): Float32Array {
  const out = new Float32Array(NT * NP);
  for (const p of places) { const one = babyPast(points, p, w); for (let k = 0; k < out.length; k++) out[k] = Math.max(out[k], one[k]); }
  return out;
}

/**
 * HOW MUCH SMALLER, AT MOST (Joshua, 2026-10-30: "can we just scale the babies a little bit smaller? How much off would
 * that be realistically?"): a tenth -- 51 cm to 46 cm at term, still a healthy newborn near the 10th percentile; twins and
 * triplets run that much smaller anyway. Only where they do not fit as they are, and only as much as they need. GAME TUNING.
 */
export const SHRINK_MOST = 0.10;
/**
 * AUTO DEPTH (Joshua, 2026-10-30, of whether her DEPTH control should make room: "yes... which should automatically give
 * the needed space for more babies"): what room the babies still need after that comes from her own approved DEPTH shape,
 * added to hers, up to this (percent of DEPTH) -- her belly deeper, never wider, never lower, her pubic area and hips as
 * they are. Past even this the last of it is the dome (`bellyPush`). GAME TUNING.
 */
export const AUTO_DEPTH_MOST = 45;
/** How far past her womb's wall the furthest point of a baby may stand and still fit (rest metres): within the fluid. GAME TUNING. */
export const FIT_TOLERANCE = 0.002;
/** ...and inside her, where there is no belly to see it (behind, below, under her ribs). GAME TUNING. */
export const FIT_TOLERANCE_INSIDE = 0.008;

/**
 * THE BALANCE (Joshua, 2026-10-30: "the middle bottom of the belly... is like a balancing scale. If only one and closer to
 * the body, would be closer to 0°, if the baby moves midway... about 7-8°, if the baby is all the way forward, will do max
 * tilt"): the most her belly sags (degrees on her TILT scale, on its sag shape) for so many babies all the way forward.
 */
export const BALANCE_MOST_DEG: Readonly<Record<number, number>> = Object.freeze({ 1: 15, 2: 25, 3: 35 });
/** The weight that sags her as far as the balance says (g): a baby at term. Lighter, less; heavier, no more. BIOLOGICAL SHAPE. */
export const BALANCE_FULL_G = 3460;

/**
 * How far her belly sags for where her babies lie (degrees): how far forward in her womb their middle (all of them,
 * together) sits -- against her spine 0, at the front of her womb all of it -- times the most for so many, times how heavy
 * they are against a baby at term (no more than all).
 */
export function balanceDeg(fits: readonly BabyPlace[], curl: CurlFrame, womb: WombShape, grams: number): number {
  const n = fits.length;
  if (!n) return 0;
  let z = 0;
  for (const f of fits) z += curl.centre.clone().multiplyScalar(f.scale).applyQuaternion(f.quaternion).add(f.position).z;
  z /= n;
  const back = womb.centre.z - sacRadius(womb, 0, 0, -1), front = womb.centre.z + sacRadius(womb, 0, 0, 1);
  const forward = Math.min(1, Math.max(0, (z - back) / Math.max(1e-3, front - back)));
  return forward * (BALANCE_MOST_DEG[Math.min(3, n)] ?? BALANCE_MOST_DEG[3]) * Math.min(1, Math.max(0, grams / BALANCE_FULL_G));
}

export interface HerBabies {
  readonly fits: BabyFit[]; readonly womb: WombShape; readonly push: BellyPush;
  /** how much smaller than the chart they are drawn (1: as the chart) */
  readonly shrink: number;
  /** AUTO DEPTH: percent of DEPTH added to hers */
  readonly depth: number;
  /** THE BALANCE: degrees of sag */
  readonly balance: number;
  /** how far past her womb's wall the furthest of them stands (rest metres) as packed, before the dome */
  readonly over: number;
}

/**
 * Her babies, their womb and her belly (Joshua's plan, 2026-10-30): her approved belly as it is; the babies at the chart's
 * size, packed together (`packBabies`). If they do not fit: a little smaller first, up to `SHRINK_MOST` (her belly left
 * exactly as approved); then her own DEPTH deepened, as little as fits them (`AUTO_DEPTH_MOST` at most); the last of it,
 * if any, the dome. Then THE BALANCE from where they lie. `skin` is her belly's skin as drawn (`depth`: each point's move
 * for one unit of her DEPTH field, `unit` that field's weight per percent); `warm`, the packing a moment ago.
 */
export function babiesInHer(points: ArrayLike<number>, all: ArrayLike<number>, solid: BabySolid, bumpPercent: number, weightPercent: number, curl: CurlFrame, skin: ArrayLike<number>, depth: ArrayLike<number> | null, unit: number, lies: readonly Lie[], warm?: readonly BabyFit[]): HerBabies {
  const n = lies.length, week = weekForBump(bumpPercent);
  const roomAt = (pct: number): WombShape => {
    if (!pct || !depth) return wombFromSkin(skin, week, 0, depth ?? undefined);
    const k = pct * unit, moved = new Float32Array(skin.length);
    for (let i = 0; i < moved.length; i++) moved[i] = skin[i] + k * depth[i];
    return wombFromSkin(moved, week, 0, depth);
  };
  type Try = Packing & { room: WombShape; pct: number; shrink: number };
  const tryAt = (pct: number, shrink: number, from?: readonly BabyFit[], effort = 1): Try => {
    const room = roomAt(pct);
    return { ...packBabies(points, solid, bumpPercent, weightPercent, curl, room, lies, shrink, { warm: from, effort }), room, pct, shrink };
  };
  // (inside her, only their size can help; at her belly, her DEPTH can too)
  const fits = (t: Try) => t.over <= FIT_TOLERANCE && t.hard <= FIT_TOLERANCE_INSIDE, fitsBelly = (t: Try) => t.over <= FIT_TOLERANCE;
  let best = tryAt(0, 1, warm && warm.length === n ? warm : undefined, warm ? 0.6 : 1);
  // a fresh look too when warm (a packing a moment ago may be the wrong one for the size now)
  if (warm && !fits(best)) { const fresh = tryAt(0, 1); if (fresh.energy < best.energy) best = fresh; }
  if (!fits(best)) {
    const smallest = tryAt(0, 1 - SHRINK_MOST, best.fits, 0.6);
    if (fits(smallest)) {
      let lo = smallest, hi = 1;
      for (let k = 0; k < 4; k++) { const mid = (lo.shrink + hi) / 2, t = tryAt(0, mid, lo.fits, 0.4); if (fits(t)) lo = t; else hi = mid; }
      best = lo;
    } else {
      if (fitsBelly(smallest)) best = smallest;
      else {
        const deepest = tryAt(AUTO_DEPTH_MOST, 1 - SHRINK_MOST, smallest.fits, 0.6);
        if (!fitsBelly(deepest)) best = deepest.over < smallest.over ? deepest : smallest;
        else {
          let lo = 0, hi = deepest;
          for (let k = 0; k < 5; k++) { const mid = (lo + hi.pct) / 2, t = tryAt(mid, 1 - SHRINK_MOST, hi.fits, 0.4); if (fitsBelly(t)) hi = t; else lo = mid; }
          best = hi;
        }
      }
    }
  }
  // whatever still stands past the wall, the dome makes room for
  const womb = growSac(best.room, babiesPast(all, best.fits, best.room));
  const grams = n * babySize(weekForBump(bumpPercent, n), weightPercent, n).g * best.shrink ** 3;
  return { fits: best.fits, womb, push: bellyPush(womb, n), shrink: best.shrink, depth: best.pct, balance: balanceDeg(best.fits, curl, best.room, grams), over: best.over };
}

// -------------------------------------------------------------------------------------------------- in their fluid

/**
 * IN THEIR FLUID (Joshua, 2026-10-30: "when we get to actually the babies moving and the actual fluid sac, things will
 * look more realistic with the fluid like a damper"). A baby does not ride its mother's belly rigidly: it floats in its
 * sac's fluid, nearly as dense as itself, so it lags her motion a little and comes back slowly, never springing -- and
 * it is never quite still. Each baby is a mass in fluid (`FLUID`, stepped like her belly's with `stepMass`, its travel
 * the room it has round it) plus a slow drift and turn of its own. All of it within the room it was packed with.
 */
export const FLUID = Object.freeze({
  /** how much of what her body does a baby feels against its fluid (it is all but as light as the fluid: a share) */
  share: 0.45,
  /** its spring back to its place, and how damped: slow, and settling without a swing (the fluid). GAME TUNING */
  hz: 0.9, damping: 0.95,
  /** of the room round it, how much it may travel; and never more than this (rest metres) */
  roomShare: 0.6, mostM: 0.006,
  /** its drift: how far (rest metres) and how far it turns (radians), over these periods (seconds); each baby its own */
  driftM: 0.0015, driftRad: 0.022, driftS: [6.3, 7.9, 5.4],
});

/** How much room each baby has round it, as packed (rest metres): how far its furthest point stands inside the wall. */
export function floatRoom(points: ArrayLike<number>, fits: readonly BabyPlace[], womb: WombShape): number[] {
  return fits.map((f) => { const w = pastWall(points, f, womb); return Math.max(0, -Math.max(w.belly, w.inside)); });
}

/** A baby's mass in its fluid, for its room (rest metres): `stepMass`'s tune; `gain` the share of her body's motion it feels. */
export function floatTune(roomM: number, float = 100): { hz: number; damping: number; maxM: number; gain: number } {
  const k = floatShare(float);
  return { hz: FLUID.hz, damping: FLUID.damping, maxM: Math.min(FLUID.mostM * k, Math.max(0, roomM) * Math.min(0.9, FLUID.roomShare * k)), gain: FLUID.share * k };
}
/** BABY FLOAT (0..200%) as a share: 0 still, 1 as tuned, 2 twice as much. */
export const floatShare = (float: number): number => Math.min(200, Math.max(0, Number.isFinite(float) ? float : 100)) / 100;

/**
 * A baby's own drift at a time (seconds), the `index`th of them, with so much room: a small slow wander (`move`, rest
 * metres) and turn (`axis`, `angle` radians) -- no two babies in step, nothing where there is no room, by BABY FLOAT.
 * Smooth in time.
 */
export function floatDrift(seconds: number, index: number, roomM: number, move: THREE.Vector3, axis: THREE.Vector3, float = 100): number {
  const room = Math.min(1, Math.max(0, roomM) / 0.004) * floatShare(float), T = FLUID.driftS, p = index * 2.1;
  const w = (k: number) => (2 * Math.PI * seconds) / T[(index + k) % T.length];
  move.set(Math.sin(w(0) + p), 0.6 * Math.sin(w(1) * 0.83 + 1.3 * p), Math.sin(w(2) * 1.17 + 0.7 * p)).multiplyScalar(FLUID.driftM * room);
  axis.set(Math.sin(w(1) * 0.61 + p), Math.cos(w(2) * 0.53 + 2 * p), 0.5 * Math.sin(w(0) * 0.71)).normalize();
  return FLUID.driftRad * room * Math.sin(w(2) * 0.9 + p);
}

/**
 * How much amniotic fluid each sac holds by week (ml): rising to about 800 by week 34, then falling slowly to term and
 * past. BIOLOGICAL SHAPE (amniotic fluid volume by gestational age, the usual curve).
 */
export const FLUID_ML: readonly (readonly [number, number])[] = [[12, 60], [16, 200], [20, 400], [28, 700], [34, 830], [38, 780], [40, 700], [42, 500]];
export const fluidMl = (week: number): number => lerpTable(FLUID_ML, week, 1);

/**
 * What her belly carries with so many babies against with one at the same size (1 for one): babies and fluid, each sac
 * its own. More to carry is a heavier, more damped belly (softBody's `bellyTune`) -- her approved one-baby belly as it is.
 */
export function carriedShare(bumpPercent: number, weightPercent: number, babies: number): number {
  if (babies <= 1) return 1;
  const one = babySize(weekForBump(bumpPercent), weightPercent).g + fluidMl(weekForBump(bumpPercent));
  const wk = weekForBump(bumpPercent, babies), many = babies * (babySize(wk, weightPercent, babies).g + fluidMl(wk));
  return one > 0 ? many / one : 1;
}

// ------------------------------------------------------------------------------------------------ kicks and moves

/**
 * KICKS AND MOVES (Joshua, 2026-10-30: "the kicks and baby movements since they are related and maybe a simple collision
 * between another baby and the womb lining to allow some movements and flexibility like real babies"). Now and then each
 * baby moves: a KICK (a leg shoots out and folds back), a PUNCH (an arm), a STRETCH (arms, legs and back all at once,
 * slowly) or a ROLL (it turns a little about its own length and settles back). A foot or hand that reaches past her
 * womb's lining is not let through it: the lining gives, and her belly shows the kick from outside. One that reaches into
 * another baby nudges it, and the fluid takes it up.
 */
export type MoveKind = 'kick' | 'punch' | 'stretch' | 'roll';
export interface MoveSpec {
  /** seconds to reach the move, held there, and to fold back (the fluid slows the way back) */
  readonly rise: number; readonly hold: number; readonly fall: number;
  /** how likely, of all moves */
  readonly share: number;
}
export const MOVES: Readonly<Record<MoveKind, MoveSpec>> = Object.freeze({
  kick: { rise: 0.16, hold: 0.07, fall: 0.6, share: 0.5 },
  punch: { rise: 0.2, hold: 0.05, fall: 0.5, share: 0.2 },
  stretch: { rise: 0.9, hold: 0.5, fall: 1.3, share: 0.15 },
  roll: { rise: 1.2, hold: 0.4, fall: 1.6, share: 0.15 },
});
/** How often a baby moves at BABY KICKS 100% (seconds between, on average); and a kick's chance of a second straight after. GAME TUNING. */
export const MOVE_EVERY_S = 10, MOVE_SOONEST_S = 2, KICK_AGAIN = 0.35;
/** How far her belly may show a kick out (rest metres), and how wide (rest metres). GAME TUNING. */
export const KICK_MOST_M = 0.02, KICK_WIDE_M = 0.045;

/** How far into a move it is at `t` seconds since it began (0..1, smooth both ways); 0 once it is over. */
export function moveEnvelope(kind: MoveKind, t: number): number {
  const m = MOVES[kind];
  if (!(t > 0)) return 0;
  const ease = (u: number) => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };
  if (t < m.rise) return ease(t / m.rise);
  if (t < m.rise + m.hold) return 1;
  return 1 - ease((t - m.rise - m.hold) / m.fall);
}
export const moveLength = (kind: MoveKind): number => MOVES[kind].rise + MOVES[kind].hold + MOVES[kind].fall;

/** BABY KICKS (0..200%) as a share of how often: 0 never, 1 as tuned, 2 twice as often. */
export const kicksShare = (kicks: number): number => Math.min(200, Math.max(0, Number.isFinite(kicks) ? kicks : 100)) / 100;

/**
 * The next move a baby makes, from a random source: which, and how long until it (seconds) -- a while, on average
 * `MOVE_EVERY_S` over the share, never sooner than `MOVE_SOONEST_S`; after a kick, sometimes another straight away.
 * `Infinity` when BABY KICKS is 0.
 */
export function nextMove(rnd: () => number, kicks: number, after?: MoveKind): { kind: MoveKind; inS: number } {
  const share = kicksShare(kicks);
  if (!(share > 0)) return { kind: 'kick', inS: Infinity };
  if (after === 'kick' && rnd() < KICK_AGAIN) return { kind: 'kick', inS: 0.5 + 0.6 * rnd() };
  let r = rnd(), kind: MoveKind = 'kick';
  for (const k of Object.keys(MOVES) as MoveKind[]) { if (r < MOVES[k].share) { kind = k; break; } r -= MOVES[k].share; }
  return { kind, inS: MOVE_SOONEST_S + (-Math.log(Math.max(1e-6, 1 - rnd())) * MOVE_EVERY_S) / share };
}

/** The baby's bones a move uses (the packed model's names): each side's leg and arm, top to tip; its back and head. */
export const BABY_BONES = Object.freeze({
  leg: { left: ['Bone_010', 'Bone_009', 'Bone_008', 'Bone_007'], right: ['Bone_015', 'Bone_014', 'Bone_013', 'Bone_012'] },
  arm: { left: ['Bone_022', 'Bone_021', 'Bone_020', 'Bone_019'], right: ['Bone_027', 'Bone_026', 'Bone_025', 'Bone_024'] },
  back: ['Bone_001', 'Bone_005', 'Bone_004'], neck: 'Bone_018',
});

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tQ = new THREE.Quaternion(), tP = new THREE.Quaternion(), tR = new THREE.Quaternion();
/** Turn a bone (in the world) so the way to its child goes `share` of the way toward `to` (unit). */
export function turnToward(bone: THREE.Object3D, child: THREE.Object3D, to: THREE.Vector3, share: number): void {
  bone.getWorldPosition(tA); child.getWorldPosition(tB);
  const from = tB.sub(tA);
  if (from.lengthSq() < 1e-16 || !(share > 0)) return;
  tR.setFromUnitVectors(from.normalize(), to).slerp(tQ.identity(), 1 - Math.min(1, share)) ;
  bone.getWorldQuaternion(tQ).premultiply(tR);
  if (bone.parent) bone.parent.getWorldQuaternion(tP).invert(); else tP.identity();
  bone.quaternion.copy(tP.multiply(tQ));
  bone.updateMatrixWorld(true);
}

export interface MoveFrame {
  /** the baby's long axis toward its head, its front (where its face and belly are), its left: in the world */
  readonly long: THREE.Vector3; readonly front: THREE.Vector3; readonly left: THREE.Vector3;
  /** the way out of her womb from the baby (world, unit): where a kick goes */
  readonly out: THREE.Vector3;
}

/**
 * Pose a baby's limbs for a move `k` of the way in (0..1), from its curl (every bone first back to `rest`). `side` picks
 * the leg or arm. Returns the bone at the tip that moved (the toe or the hand), or null (a roll moves no limb).
 */
export function poseMove(bones: ReadonlyMap<string, THREE.Bone>, rest: ReadonlyMap<string, THREE.Quaternion>, kind: MoveKind, side: 'left' | 'right', k: number, f: MoveFrame): THREE.Bone | null {
  for (const [name, q] of rest) { const b = bones.get(name); if (b) b.quaternion.copy(q); }
  const root = bones.get('Bone_000'); root?.updateMatrixWorld(true);
  if (!(k > 0) || kind === 'roll') return null;
  const limb = (chain: readonly string[], to: THREE.Vector3, reach: number, straighten: number): THREE.Bone | null => {
    const [a, b, c, tip] = chain.map((n) => bones.get(n));
    if (!a || !b || !c) return null;
    turnToward(a, b, to, reach * k);
    // the joint below straightens toward the line of the one above
    b.getWorldPosition(tA); a.getWorldPosition(tB); const along = tA.sub(tB).normalize().clone();
    turnToward(b, c, along, straighten * k);
    return tip ?? c;
  };
  const v = new THREE.Vector3();
  // (as far as asked: the lining stops it -- the scene holds the move short where it would reach past)
  if (kind === 'kick') return limb(BABY_BONES.leg[side], v.copy(f.out).multiplyScalar(0.85).addScaledVector(f.long, -0.3).addScaledVector(f.left, side === 'left' ? 0.15 : -0.15).normalize(), 0.8, 0.9);
  if (kind === 'punch') return limb(BABY_BONES.arm[side], v.copy(f.out).multiplyScalar(0.8).addScaledVector(f.front, 0.25).addScaledVector(f.long, 0.15).normalize(), 0.7, 0.85);
  // a stretch: both legs and arms part of the way, its back and head arched back
  let tipBone: THREE.Bone | null = null;
  for (const s of ['left', 'right'] as const) {
    tipBone = limb(BABY_BONES.leg[s], v.copy(f.long).multiplyScalar(-1).addScaledVector(f.out, 0.4).normalize(), 0.35, 0.5) ?? tipBone;
    limb(BABY_BONES.arm[s], v.copy(f.long).multiplyScalar(0.6).addScaledVector(f.left, s === 'left' ? 0.6 : -0.6).normalize(), 0.3, 0.5);
  }
  for (const n of [...BABY_BONES.back, BABY_BONES.neck]) {
    const b = bones.get(n); if (!b) continue;
    b.getWorldQuaternion(tQ).premultiply(tR.setFromAxisAngle(f.left, -0.1 * k));
    if (b.parent) b.parent.getWorldQuaternion(tP).invert(); else tP.identity();
    b.quaternion.copy(tP.multiply(tQ)); b.updateMatrixWorld(true);
  }
  return tipBone;
}

/** How far a roll turns a baby about its length at the height of it (radians). GAME TUNING. */
export const ROLL_RAD = 0.3;

/**
 * Where a foot or hand (rest metres, the womb's frame) meets her womb's lining: how far past it it reaches (rest metres;
 * 0 inside), the point on her skin there and the way out. Her belly shows that much of a kick, no more than `KICK_MOST_M`.
 */
export function kickOnSkin(w: WombShape, tip: THREE.Vector3, pad: number, at: THREE.Vector3, out: THREE.Vector3): number {
  const d = tip.clone().sub(w.centre), r = d.length();
  if (r < 1e-9) return 0;
  out.copy(d).divideScalar(r);
  const lining = sacRadius(w, out.x, out.y, out.z) * SAC_FILL, skin = gridAt(w.skin, out.x, out.y, out.z);
  if (!Number.isFinite(skin)) return 0;
  const past = r + pad - lining;
  at.copy(w.centre).addScaledVector(out, skin);
  // a foot or hand at the lining shows through it a little before it reaches past (her lining and skin are soft)
  return Math.min(KICK_MOST_M, Math.max(0, past + KICK_FELT_M));
}
/** How near the lining a foot or hand already shows on her belly (rest metres). GAME TUNING. */
export const KICK_FELT_M = 0.006;

/** How far a point (rest metres, the womb's frame) with so much round it stands past her womb's lining (rest metres; negative inside). */
export function liningPast(w: WombShape, p: THREE.Vector3, pad: number): number {
  const dx = p.x - w.centre.x, dy = p.y - w.centre.y, dz = p.z - w.centre.z, r = Math.hypot(dx, dy, dz);
  if (r < 1e-9) return -Infinity;
  return r + pad - sacRadius(w, dx / r, dy / r, dz / r) * SAC_FILL;
}

// ------------------------------------------------------------------------------------- the cord and the placenta

/**
 * THE CORD AND THE PLACENTA (Joshua, 2026-10-30: "more than one baby, the cord(s), positions, and kicks"; "I would then
 * actually do the cord and birth before the clothing"). Each baby has its own placenta, a thick disc on her womb's lining
 * where it has room (high on the wall, never low: a low one is a complication, not the commonest), and its own cord from
 * the placenta's middle to its navel: soft, longer than the way between, so it loops; floating in the fluid; kept inside
 * her womb and out of every baby (its own navel excepted where it leaves it), and carried by the babies as they move.
 */
/** The cord's length by week (cm): about 30 at 20 weeks, 55 to 60 at term. BIOLOGICAL SHAPE. */
export const CORD_CM: readonly (readonly [number, number])[] = [[12, 8], [16, 16], [20, 32], [28, 45], [34, 52], [40, 56], [42, 58]];
export const cordLength = (week: number): number => lerpTable(CORD_CM, week, 1) / 100;
/** The cord's radius by week (rest metres): about 1.5 cm across at term. BIOLOGICAL SHAPE. */
export const cordRadius = (week: number): number => 0.0075 * Math.min(1, Math.max(0.3, (week - 8) / 30));
/** The placenta by week: [week, radius, thickness] (rest metres): about 22 cm across and 2.5 thick at term. BIOLOGICAL SHAPE. */
export const PLACENTA: readonly (readonly [number, number, number])[] = [[12, 0.035, 0.008], [20, 0.07, 0.015], [28, 0.09, 0.02], [40, 0.11, 0.025], [42, 0.112, 0.026]];
export const placentaSize = (week: number): { radius: number; thick: number } => ({ radius: lerpTable(PLACENTA, week, 1), thick: lerpTable(PLACENTA, week, 2) });

/** The ways from her womb's middle a placenta is tried (unit, rest frame): high on the wall all round, and the top. */
export const PLACENTA_SPOTS: readonly THREE.Vector3[] = Object.freeze((() => {
  const out: THREE.Vector3[] = [new THREE.Vector3(0, 1, 0)];
  for (const y of [0.3, 0.6, 0.85]) for (let a = 0; a < 8; a++) { const ph = (a / 8) * 2 * Math.PI + Math.PI, s = Math.sqrt(1 - y * y); out.push(new THREE.Vector3(s * Math.sin(ph), y, s * Math.cos(ph))); }
  return out;
})());

export interface PlacentaSpot { readonly at: THREE.Vector3; readonly normal: THREE.Vector3; readonly radius: number; readonly thick: number }
/**
 * Where each baby's placenta sits (rest metres): of `PLACENTA_SPOTS`, the one where the babies leave the lining most room
 * (within its disc), nearest the baby it feeds, not on another's; on the lining, its thickness into the womb as far as the
 * room allows. `navels`: each baby's navel. The disc's `normal` faces into her womb.
 */
export function placentaSpots(points: ArrayLike<number>, fits: readonly BabyPlace[], womb: WombShape, week: number, navels: readonly THREE.Vector3[]): PlacentaSpot[] {
  // (twins' and triplets' each a little smaller: they share her womb)
  const one = placentaSize(week), k0 = Math.sqrt(multipleShare(week, fits.length)), size = { radius: one.radius * k0, thick: one.thick }, q = new THREE.Vector3(), placed: THREE.Vector3[] = [];
  // the babies' points as placed, once
  const all: THREE.Vector3[] = [];
  for (const f of fits) for (let i = 0; i < points.length / 3; i += 2) all.push(q.set(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]).multiplyScalar(f.scale).applyQuaternion(f.quaternion).add(f.position).sub(womb.centre).clone());
  const roomAt = (d: THREE.Vector3): number => {
    let room = Infinity;
    const R = sacRadius(womb, d.x, d.y, d.z) * SAC_FILL, cone = Math.cos(Math.min(0.6, size.radius / Math.max(0.05, R)));
    for (const p of all) { const r = p.length(); if (r < 1e-9 || p.dot(d) / r < cone) continue; room = Math.min(room, sacRadius(womb, p.x / r, p.y / r, p.z / r) * SAC_FILL - r); }
    return room;
  };
  const rooms = PLACENTA_SPOTS.map(roomAt);
  return fits.map((_, b) => {
    let best = 0, bestScore = -Infinity;
    PLACENTA_SPOTS.forEach((d, k) => {
      const R = sacRadius(womb, d.x, d.y, d.z) * SAC_FILL, at = womb.centre.clone().addScaledVector(d, R);
      // not where another's is
      if (placed.some((p) => p.distanceTo(at) < 1.6 * size.radius)) return;
      // (and rather on her back wall than her front, as about half are -- and out of the way of seeing her babies)
      const score = Math.min(rooms[k], size.thick * 2) - 0.25 * (navels[b] ? at.distanceTo(navels[b]) : 0) - 0.03 * d.z;
      if (score > bestScore) { bestScore = score; best = k; }
    });
    const d = PLACENTA_SPOTS[best], R = sacRadius(womb, d.x, d.y, d.z) * SAC_FILL, at = womb.centre.clone().addScaledVector(d, R);
    placed.push(at);
    return { at, normal: d.clone().negate(), radius: size.radius, thick: Math.max(0.004, Math.min(size.thick, Number.isFinite(rooms[best]) ? Math.max(0.004, rooms[best]) : size.thick)) };
  });
}

/** A baby's body in its fluid for the cord: its solid, where it is and how it is turned (the holder's frame), its curl's middle. */
export interface CordBody { readonly solid: BabySolid; readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion; readonly scale: number; readonly curlCentre: THREE.Vector3 }

/** The cord's own pull and its fluid (GAME TUNING): how fast its swing dies (per second kept), and its weight in the fluid (m/s²). */
export const CORD_FLUID = Object.freeze({ keep: 0.08, sink: 0.6, passes: 10, nodes: 28 });

/**
 * A CORD: a chain of points (rest metres) from its placenta to its baby's navel, as long as the week says, stepped like a
 * rope in fluid (each point carrying on as it was going, slowed by the fluid; each link kept its length; its two ends
 * held; kept inside the womb and out of the babies). `points` is its shape, three a point.
 */
export class Cord {
  readonly points: Float32Array;
  private readonly was: Float32Array;
  length: number; radius: number;
  constructor(length: number, radius: number, readonly n = CORD_FLUID.nodes) {
    this.points = new Float32Array(n * 3); this.was = new Float32Array(n * 3); this.length = length; this.radius = radius;
  }
  /** Laid afresh from `a` to `b`: an arc bowed toward `toward`, as long as the cord (so it starts with no pull). */
  lay(a: THREE.Vector3, b: THREE.Vector3, toward: THREE.Vector3): void {
    const n = this.n, mid = a.clone().add(b).multiplyScalar(0.5), bow = toward.clone().sub(mid);
    if (bow.lengthSq() < 1e-8) bow.set(0, 0, 1);
    bow.normalize();
    const curve = (h: number, t: number, out: THREE.Vector3) => { const c = mid.clone().addScaledVector(bow, h); return out.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t); };
    const arc = (h: number) => { let s = 0; const p = new THREE.Vector3(), q = a.clone(); for (let k = 1; k <= 32; k++) { curve(h, k / 32, p); s += p.distanceTo(q); q.copy(p); } return s; };
    let lo = 0, hi = this.length;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (arc(m) < this.length) lo = m; else hi = m; }
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) { curve(lo, i / (n - 1), p); this.points.set([p.x, p.y, p.z], i * 3); }
    this.was.set(this.points);
  }
  /** One step: `a` (its placenta) and `b` (the navel) held; inside `womb` (its middle moved by `offset`), out of `bodies` (the last, `own`, not near its navel). */
  step(dt: number, a: THREE.Vector3, b: THREE.Vector3, womb: WombShape, offset: THREE.Vector3, bodies: readonly CordBody[], own = -1): void {
    const n = this.n, P = this.points, W = this.was, h = Math.min(0.05, Math.max(0, dt)), keep = Math.pow(CORD_FLUID.keep, h), seg = this.length / (n - 1);
    for (let i = 1; i < n - 1; i++) for (let c = 0; c < 3; c++) {
      const o = i * 3 + c, v = (P[o] - W[o]) * keep; W[o] = P[o]; P[o] += v - (c === 1 ? CORD_FLUID.sink * h * h : 0);
    }
    const p = new THREE.Vector3(), q = new THREE.Vector3(), local = new THREE.Vector3(), inv = bodies.map((bd) => bd.quaternion.clone().invert());
    const centre = womb.centre.clone().add(offset);
    for (let pass = 0; pass < CORD_FLUID.passes; pass++) {
      P.set([a.x, a.y, a.z], 0); P.set([b.x, b.y, b.z], (n - 1) * 3);
      // each link its length
      for (let i = 0; i < n - 1; i++) {
        p.fromArray(P, i * 3); q.fromArray(P, (i + 1) * 3);
        const d = q.clone().sub(p), L = d.length();
        if (L < 1e-9) continue;
        const fix = d.multiplyScalar((L - seg) / L / 2), wa = i === 0 ? 0 : 1, wb = i + 1 === n - 1 ? 0 : 1, sum = wa + wb || 1;
        p.addScaledVector(fix, (2 * wa) / sum); q.addScaledVector(fix, (-2 * wb) / sum);
        p.toArray(P, i * 3); q.toArray(P, (i + 1) * 3);
      }
      for (let i = 1; i < n - 1; i++) {
        p.fromArray(P, i * 3);
        // inside her womb
        const d = p.clone().sub(centre), r = d.length();
        if (r > 1e-9) { const lim = sacRadius(womb, d.x / r, d.y / r, d.z / r) * SAC_FILL - this.radius; if (r > lim) p.copy(centre).addScaledVector(d, lim / r); }
        // out of every baby: along the way its body thins (its depth's slope), by how deep, plus its own thickness
        bodies.forEach((bd, k) => {
          if (k === own && i > n - 4) return;
          local.copy(p).sub(bd.position).applyQuaternion(inv[k]).divideScalar(bd.scale).sub(bd.curlCentre);
          const deep = solidDeep(bd.solid, local.x, local.y, local.z) * bd.scale + this.radius;
          if (solidDeep(bd.solid, local.x, local.y, local.z) <= 0 && deep <= this.radius) return;
          const e = bd.solid.cube, g = new THREE.Vector3(
            solidDeep(bd.solid, local.x + e, local.y, local.z) - solidDeep(bd.solid, local.x - e, local.y, local.z),
            solidDeep(bd.solid, local.x, local.y + e, local.z) - solidDeep(bd.solid, local.x, local.y - e, local.z),
            solidDeep(bd.solid, local.x, local.y, local.z + e) - solidDeep(bd.solid, local.x, local.y, local.z - e));
          if (g.lengthSq() < 1e-12) g.copy(local).normalize().negate();
          g.negate().normalize().applyQuaternion(bd.quaternion);
          p.addScaledVector(g, Math.min(deep, 0.02));
        });
        p.toArray(P, i * 3);
      }
    }
  }
}

/**
 * The cord drawn: a tube round its points (the geometry made by `cordTube`, laid again each frame), its three vessels
 * winding round it as a real cord's do -- two arteries and a vein, a turn every few centimetres.
 */
export const CORD_RINGS = 64, CORD_SIDES = 10;
export function cordTube(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), verts = (CORD_RINGS + 1) * CORD_SIDES;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
  const index: number[] = [];
  for (let r = 0; r < CORD_RINGS; r++) for (let s = 0; s < CORD_SIDES; s++) {
    const a = r * CORD_SIDES + s, b = r * CORD_SIDES + ((s + 1) % CORD_SIDES), c = a + CORD_SIDES, d = b + CORD_SIDES;
    index.push(a, c, b, b, c, d);
  }
  g.setIndex(index);
  return g;
}
export function layCordTube(g: THREE.BufferGeometry, points: ArrayLike<number>, radius: number): void {
  const n = Math.floor(points.length / 3);
  if (n < 2) return;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const P = g.getAttribute('position') as THREE.BufferAttribute, N = g.getAttribute('normal') as THREE.BufferAttribute, C = g.getAttribute('color') as THREE.BufferAttribute;
  const at = new THREE.Vector3(), tan = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3(), o = new THREE.Vector3();
  nrm.set(0, 1, 0);
  const len = curve.getLength();
  for (let r = 0; r <= CORD_RINGS; r++) {
    const t = r / CORD_RINGS;
    curve.getPointAt(t, at); curve.getTangentAt(t, tan).normalize();
    // carried along without twisting (each ring's frame from the one before)
    nrm.addScaledVector(tan, -nrm.dot(tan));
    if (nrm.lengthSq() < 1e-8) nrm.set(tan.y, -tan.x, 0);
    nrm.normalize(); bin.crossVectors(tan, nrm);
    const turn = (t * len) / 0.035 * 2 * Math.PI;
    for (let s = 0; s < CORD_SIDES; s++) {
      const ang = (s / CORD_SIDES) * 2 * Math.PI, k = r * CORD_SIDES + s;
      o.copy(nrm).multiplyScalar(Math.cos(ang)).addScaledVector(bin, Math.sin(ang));
      P.setXYZ(k, at.x + o.x * radius, at.y + o.y * radius, at.z + o.z * radius); N.setXYZ(k, o.x, o.y, o.z);
      // the vessels: a vein (blue) and two arteries (red) winding round the pale jelly
      const v = (ang - turn) / (2 * Math.PI), f = (x: number) => Math.max(0, Math.cos(2 * Math.PI * (v - x)) - 0.55) / 0.45;
      const vein = f(0), art = Math.max(f(1 / 3), f(2 / 3));
      C.setXYZ(k, 0.86 - 0.35 * vein - 0.1 * art, 0.86 - 0.3 * vein - 0.45 * art, 0.9 - 0.05 * vein - 0.45 * art);
    }
  }
  P.needsUpdate = true; N.needsUpdate = true; C.needsUpdate = true;
  g.computeBoundingSphere();
}

/** The placenta drawn: a lens laid on her womb's lining round its spot, following the lining's curve, thickest at its middle. */
export const PLACENTA_RINGS = 10, PLACENTA_SIDES = 28;
export function placentaGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), per = 1 + PLACENTA_RINGS * PLACENTA_SIDES;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(per * 2 * 3), 3));
  const index: number[] = [], ring = (r: number, s: number) => 1 + (r - 1) * PLACENTA_SIDES + (s % PLACENTA_SIDES);
  for (const [face, flip] of [[0, false], [per, true]] as const) {
    for (let s = 0; s < PLACENTA_SIDES; s++) { const a = face, b = face + ring(1, s), c = face + ring(1, s + 1); index.push(...(flip ? [a, c, b] : [a, b, c])); }
    for (let r = 1; r < PLACENTA_RINGS; r++) for (let s = 0; s < PLACENTA_SIDES; s++) {
      const a = face + ring(r, s), b = face + ring(r, s + 1), c = face + ring(r + 1, s), d = face + ring(r + 1, s + 1);
      index.push(...(flip ? [a, b, c, b, d, c] : [a, c, b, b, c, d]));
    }
  }
  g.setIndex(index);
  return g;
}
export function layPlacenta(g: THREE.BufferGeometry, spot: PlacentaSpot, womb: WombShape): void {
  const P = g.getAttribute('position') as THREE.BufferAttribute, per = 1 + PLACENTA_RINGS * PLACENTA_SIDES;
  const out = spot.normal.clone().negate(), side = new THREE.Vector3(0, 1, 0).cross(out);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  side.normalize();
  const up = new THREE.Vector3().crossVectors(out, side), d = new THREE.Vector3();
  const R0 = sacRadius(womb, out.x, out.y, out.z), half = spot.radius / Math.max(0.05, R0);
  const lay = (k: number, ang: number, rho: number) => {
    // the way to it from her womb's middle: tipped from the spot's by its share of the disc's angle
    const a = rho * half;
    d.copy(out).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a) * Math.cos(ang)).addScaledVector(up, Math.sin(a) * Math.sin(ang)).normalize();
    const lining = sacRadius(womb, d.x, d.y, d.z) + 0.5 * WOMB_WALL_M, thick = spot.thick * Math.sqrt(Math.max(0, 1 - rho * rho));
    P.setXYZ(k, womb.centre.x + d.x * lining, womb.centre.y + d.y * lining, womb.centre.z + d.z * lining);
    P.setXYZ(k + per, womb.centre.x + d.x * (lining - thick), womb.centre.y + d.y * (lining - thick), womb.centre.z + d.z * (lining - thick));
  };
  lay(0, 0, 0);
  for (let r = 1; r <= PLACENTA_RINGS; r++) for (let s = 0; s < PLACENTA_SIDES; s++) lay(1 + (r - 1) * PLACENTA_SIDES + s, (s / PLACENTA_SIDES) * 2 * Math.PI, r / PLACENTA_RINGS);
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}
