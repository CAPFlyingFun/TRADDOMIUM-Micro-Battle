/**
 * THE SARAH LAB'S HUB ENTRY and every name the scene answers to. Pure: no
 * three, no DOM, so a probe and a test can read the names without a renderer.
 *
 * Joshua, 2026-10-07, on rebuilding Sarah from his base mannequin with a belly
 * slider and clothes grown from her body: "Good to test Sarah maybe in a
 * separate link in like a Dev menu I can play around with before placing live".
 * So nothing here is the game's Sarah: the lab loads `models/sarah-base.glb`,
 * which no other scene reads.
 */
import type { DevTool } from '../devtools/DevTool';

export const SARAH_LAB_SCENE_ID = 'lab:sarah';
export const SARAH_LAB_TOOL_ID = 'lab.sarah';
/** The lab's first model, v1, and the only place its path is written. */
export const SARAH_BASE_MODEL = 'models/sarah-base.glb';
/** Sarah v2 (Joshua, 2026-10-13): the newer master, arms down, outie navel modelled, five fingers rigged. */
export const SARAH_V2_MODEL = 'models/sarah-v2.glb';

/**
 * The models the lab can show, in the order MODEL cycles them (Joshua, 2026-10-13:
 * "add an option to switch between both models to compare"). v2 has no clothes yet.
 */
export const SARAH_LAB_MODELS = Object.freeze([
  Object.freeze({ id: 'v1', path: SARAH_BASE_MODEL }),
  Object.freeze({ id: 'v2', path: SARAH_V2_MODEL }),
]);

export function modelLine(index: number): string {
  return `MODEL · ${SARAH_LAB_MODELS[((index % SARAH_LAB_MODELS.length) + SARAH_LAB_MODELS.length) % SARAH_LAB_MODELS.length].id}`;
}

export const sarahLabTool: DevTool = {
  id: SARAH_LAB_TOOL_ID,
  title: 'Sarah Lab (base model)',
  description:
    "Sarah rebuilt from the base mannequin, to try before she goes live: the BUMP slider runs from twice full term (twins and more, her breasts growing with it) to "
    + 'nearly flat, its own weight sags the belly past full term, BOUNCE (or WALK) shows it and her breasts move, FINGERS curls all ten, MODEL switches between v1 and the newer v2 to compare, OUTFIT cycles the clothes grown from her body (a red tee over black leggings, a bikini, a swimsuit, none), and STAND, '
    + 'WALK and SIT pose her. Drag to turn round her, pinch or scroll to come closer. Not used by the story or the game.',
  sceneId: SARAH_LAB_SCENE_ID,
};

/** The HUD root's `data-role`: what a probe waits for. */
export const SARAH_LAB_HUD_ROLE = 'sarah-lab-hud';

export type SarahLabPose = 'stand' | 'walk' | 'sit' | 'tpose';

export const SARAH_LAB_ACTION = Object.freeze({
  back: 'sarahlab:back',
  stand: 'sarahlab:stand',
  walk: 'sarahlab:walk',
  sit: 'sarahlab:sit',
  tpose: 'sarahlab:tpose',
  turn: 'sarahlab:turn',
  bounce: 'sarahlab:bounce',
  outfit: 'sarahlab:outfit',
  model: 'sarahlab:model',
  refine: 'sarahlab:refine',
});

export const SARAH_LAB_FIELD = Object.freeze({
  status: 'sarahlab-status',
  bump: 'sarahlab-bump',
  fingers: 'sarahlab-fingers',
});

/** The flat morph target the bake writes (`scripts/bellyMorph.mjs`). */
export const BELLY_TARGET = 'belly';
/**
 * The bake's key sizes, largest first: how much bump each target leaves (the
 * full belly is the model itself, no target). Each smaller key is the same belly
 * shrunk, so the slider crossfades the two keys either side of it and every size
 * on the way is round (Joshua, 2026-10-07, with month-by-month photographs: "the
 * belly is not rounded like it should"). Past the model, 150% and 200% grow the same
 * belly deeper and lower, for twins and more ("can we make the belly stretch bigger
 * than the current max... and let it naturally sag more at the bottom").
 */
export const BELLY_KEYS: readonly (readonly [number, string | null])[] = [
  [2, 'belly200'], [1.5, 'belly150'], [1, null], [0.75, 'belly75'], [0.6, 'belly60'], [0.5, 'belly50'], [0.3, 'belly30'], [0.25, 'belly25'], [0, BELLY_TARGET],
];
/**
 * The clothes' material names (`scripts/growClothes.mjs`), and `shirtAthletic`, the
 * same tee fitted close to her (`scripts/fitAthleticTee.mjs`). `shirt` is the RELAXED
 * fit (Joshua, 2026-10-14: "preserve it as an optional Relaxed Fit and make the
 * improved version Athletic Fit").
 */
export const GARMENTS = ['shirt', 'leggings', 'bikini', 'swimsuit', 'shirtAthletic'] as const;
export type Garment = (typeof GARMENTS)[number];

/**
 * THE SKIN UNDER WORN CLOTHES IS NOT DRAWN (Joshua, 2026-10-14: "consider masking covered
 * skin if necessary to eliminate clipping, while preserving visible skin outside"). The
 * bake marks, on every body vertex, which garments cover it (`_CLOTH_COVER`, one bit per
 * garment in `GARMENTS` order). Skin a shown garment covers entirely cannot poke through
 * it, however the pose folds her. The modelled bikini is left out: its cut is not the
 * grown one the bits describe.
 */
export const MASKING_GARMENTS: readonly Garment[] = ['shirt', 'leggings', 'swimsuit', 'shirtAthletic'];
export function coverMask(shown: readonly Garment[]): number {
  let m = 0;
  for (const g of shown) if (MASKING_GARMENTS.includes(g)) m |= 1 << GARMENTS.indexOf(g);
  return m;
}
/** The leggings under the athletic tee, away from its hem, are not drawn while it is worn (`_UNDER_TOP`, `scripts/fitAthleticTee.mjs`). */
export const UNDER_TOP_GARMENT: Garment = 'shirtAthletic';
/** Keep skin at garment boundaries; remove only faces fully covered by one shown garment. */
export function uncoveredSkinIndices(indices: ArrayLike<number>, coverage: ArrayLike<number>, shown: number): Uint32Array {
  const kept: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (!(coverage[a] & coverage[b] & coverage[c] & shown)) kept.push(a, b, c);
  }
  return new Uint32Array(kept);
}

/**
 * THE OUTFITS the OUTFIT button cycles through, each the garments it shows (Joshua,
 * 2026-10-08: the red tee over black leggings, then "something simple like a bikini...
 * swimsuit... all one piece outfit"). Clothes that hang off the body (shirts that
 * flare, jackets, shorts) wait for a real second mesh.
 */
export const OUTFITS: readonly { readonly name: string; readonly garments: readonly Garment[] }[] = [
  { name: 'tee + leggings', garments: ['shirtAthletic', 'leggings'] },
  { name: 'bikini', garments: ['bikini'] },
  { name: 'swimsuit', garments: ['swimsuit'] },
  { name: 'none', garments: [] },
];
/**
 * THE ATHLETIC FIT IS THE TEE (Joshua, 2026-10-14: "keep Athletic Fit as the default
 * shirt; remove the old Relaxed Fit option once Athletic Fit is validated"). The grown
 * tee (`shirt`) stays in the file only for a model with no athletic tee yet (v2), which
 * wears it in its place.
 */
export function wornGarments(index: number, available: readonly Garment[]): Garment[] {
  const outfit = OUTFITS[((index % OUTFITS.length) + OUTFITS.length) % OUTFITS.length];
  return outfit.garments.map((g) => (g === 'shirtAthletic' && !available.includes(g) ? 'shirt' : g)).filter((g) => available.includes(g));
}
export function nextOutfit(index: number, _available: readonly Garment[] = []): number {
  return (index + 1) % OUTFITS.length;
}
export function outfitLine(index: number): string {
  return `OUTFIT · ${OUTFITS[((index % OUTFITS.length) + OUTFITS.length) % OUTFITS.length].name}`;
}

/**
 * The bump slider reads as how much bump there is. Each target's weight: the two
 * keys either side of the slider share it, every other target is 0.
 */
/** The bump slider's top: twice the model's own belly. */
export const BUMP_MAX_PERCENT = 200;

/**
 * SARAH v2'S CURVE, SWITCHABLE (Joshua, 2026-10-13: "If a curvature correction is
 * necessary at 100%, implement it as a separate, reversible shape refinement that can
 * be toggled for comparison"). Her master is 100% and is never reshaped; the bake
 * writes the corrected upper-belly curve at 100% as its own target, and the Lab's
 * CURVE button turns it on. Full at 100%, gone by 85% (the smaller sizes are built
 * from the master) and by 150% (the grown sizes carry the curve themselves).
 * v1 has no such target and the button is not shown for it.
 */
export const BELLY_REFINE_TARGET = 'bellyRefine';

/**
 * THE SEATED CORRECTIVE (Joshua, 2026-10-14: "if the lower belly still has a slight
 * point while sitting, try a subtle pose-specific corrective morph. Do not modify the
 * approved standing geometry"). `scripts/addSeatCorrective.mjs` bakes `bellySeat`,
 * which carries the bump's lower flanks forward over the thighs; it is on only while
 * she sits, scaled by how far into the sit she is (`seated`, 0..1, so a transition can
 * ease it). It is full from 90% to 110% and gone by 50% and by 150%: under 50% the
 * bump is too small to be covered, and past 150% the pelvis weighting
 * (`scripts/protectGrownBump.mjs`) already keeps the underside round, where this shape,
 * written on the 100% body, would flatten a facet into the bigger flank.
 * It is a shape, not soft tissue: nothing here answers to contact.
 */
export const SEAT_TARGET = 'bellySeat';

export function seatCorrectiveWeight(seated: number, bumpPercent: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0));
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const ease = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };
  return s * ease((b - 0.5) / 0.4) * (1 - ease((b - 1.1) / 0.4));
}

/**
 * SARAH v2's SEATED CORRECTIVE (Joshua, 2026-10-14: "As the legs bend upward, gradually
 * reduce the belly's downward tilt only as much as needed to avoid intersection... minimal
 * or no correction when standing"). `bellySeatV2` (scripts/sarahV2Correctives.mjs) eases
 * the lower half of her bump up and a little forward; seated it is nothing by 50%, all of
 * it at 100%, and grows on to twice that at 200%, where the bump hangs lowest. Standing it
 * is nothing at every size. v1 has no such target and ignores it.
 */
export const SEAT_V2_TARGET = 'bellySeatV2';
export function seatCorrectiveV2Weight(seated: number, bumpPercent: number): number {
  const s = Math.min(1, Math.max(0, Number.isFinite(seated) ? seated : 0));
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const u = Math.min(1, Math.max(0, (b - 0.5) / 0.5));
  return s * (b <= 1 ? u * u * (3 - 2 * u) : b);
}

export function refineWeight(on: boolean, bumpPercent: number): number {
  if (!on) return 0;
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  if (b <= 1) { const u = Math.min(1, Math.max(0, (b - 0.85) / 0.15)); return u * u * (3 - 2 * u); }
  return Math.max(0, 1 - (b - 1) / 0.5);
}

export function refineLine(on: boolean): string {
  return on ? 'CURVE · refined' : 'CURVE · as modelled';
}

export function bellyWeights(bumpPercent: number): Record<string, number> {
  const b = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 100;
  const out: Record<string, number> = {};
  for (const [, name] of BELLY_KEYS) if (name) out[name] = 0;
  for (let i = 0; i < BELLY_KEYS.length - 1; i += 1) {
    const [s0, n0] = BELLY_KEYS[i], [s1, n1] = BELLY_KEYS[i + 1];
    if (b > s0 || b < s1) continue;
    const f = (s0 - b) / (s0 - s1);
    if (n0) out[n0] = 1 - f;
    if (n1) out[n1] = f;
    break;
  }
  return out;
}

/**
 * Original bust at zero. Research-informed nominal volume targets are 1.30 at
 * belly 100 and an optional larger 1.55 at 200. Width is capped at +10%.
 * These are artistic shape targets, not measured anatomy or predictions.
 */
export const BREAST_TARGETS = Object.freeze({ small: 'breast0', big: 'breast100', bob: 'breastBob' });
/** Nominal volume target, not measured mesh volume or a medical prediction. */
export function breastVolumeRatio(bumpPercent: number): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  return p <= 100 ? 1 + 0.30 * p / 100 : 1.30 + 0.25 * (p - 100) / 100;
}
export function breastPercent(bumpPercent: number): number {
  return (breastVolumeRatio(bumpPercent) - 1) / 0.55 * 100;
}
/**
 * The breasts' own spring: lighter than the bump, so a little quicker and a little
 * looser. GAME TUNING.
 */
export const BREAST_SPRING = Object.freeze({ hz: 2.8, damping: 0.28, maxM: 0.012, maxAccel: 40 });
/** One step of the breasts' spring, in place (the same body motion as the bump's). */
export function stepBreastSpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number): BellySpring {
  return stepSpring(s, dt, upAccel, leftAccel, BREAST_SPRING);
}
/** How much of their spring's travel the breasts show (Joshua, 2026-10-08: "reduce the breast bounce by 55%"). GAME TUNING. */
export const BREAST_SWING = 0.45;
/** breastBob's weight: the spring's drop, bigger breasts swinging more. */
export function breastBobWeight(bumpPercent: number, s: BellySpring): number {
  return BREAST_SWING * breastVolumeRatio(bumpPercent) * (s.y / BELLY_MOTION.bobM);
}

export function breastWeights(bumpPercent: number): Record<string, number> {
  const b = breastPercent(bumpPercent);
  return {
    [BREAST_TARGETS.small]: 0,
    [BREAST_TARGETS.big]: b / 100,
  };
}

/** 0.075 mm per percent, capped at the baked 10.5 mm projection (140%). */
export function navelWeights(bumpPercent: number): Record<string, number> {
  const p=Math.min(BUMP_MAX_PERCENT,Math.max(0,Number.isFinite(bumpPercent)?bumpPercent:100));
  const out=Math.min(1,p/140);
  return {navelIn:0,navelOut:out};
}

/**
 * Sarah v2's outie arrives at 75% (Joshua, 2026-10-14: "starts protruding at
 * approximately 75% belly instead of 50%"). Her outie is modelled into the 100% master;
 * `navelFlat` (scripts/sarahV2Correctives.mjs) settles it into an ordinary navel. Fully
 * on to 75%, eased off by 100%, off past it, so the outie rises smoothly over the last
 * quarter and stays as modelled through 200%. A model without the target ignores it.
 */
export const NAVEL_FLAT_TARGET = 'navelFlat';
export const NAVEL_OUT_FROM_PERCENT = 75;
export function navelFlatWeight(bumpPercent: number): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  const t = Math.min(1, Math.max(0, (p - NAVEL_OUT_FROM_PERCENT) / (100 - NAVEL_OUT_FROM_PERCENT)));
  return 1 - t * t * (3 - 2 * t);
}

export function bumpLine(bumpPercent: number): string {
  const p = Math.round(Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)));
  const breasts = ` · bust volume target ${breastVolumeRatio(p).toFixed(2)}×`;
  if (p === 100) return `BUMP 100% · as modelled${breasts}`;
  if (p === 0) return `BUMP 0% · nearly flat${breasts}`;
  return (p > 100 ? `BUMP ${p}% · past full term` : `BUMP ${p}%`) + breasts;
}

/**
 * HOW FAR EACH FINGER JOINT BENDS AT A FULL CURL, degrees, knuckle first (Joshua,
 * 2026-10-08: "add finger limits and try and make sure the fingers bend
 * realistically"). It used to be 80° at every joint, so a fist bent each finger 240°
 * into its own palm, and the thumb half that at all three joints, its base included.
 * BIOLOGICAL SHAPE, eased for a mesh: a hand's knuckle flexes to about 90°, the middle
 * joint 100°, the tip 70°; these stop short of that so a fist closes without the
 * fingertips driving through the palm. The thumb's base barely bends (it swings), so
 * most of its fold is in the two joints past it. Nothing bends backward: the slider
 * runs 0 to 100% and a bend is never below zero.
 */
export const FINGER_LIMITS_DEG = Object.freeze({ finger: [70, 90, 55], thumb: [25, 45, 60] });
/** How much the thumb's fold leans into the palm as well as across it toward the little finger. */
export const THUMB_TO_PALM = 0.6;

/** One finger joint's bend, radians, for a curl percent: never backward, never past its limit. */
export function fingerBend(curlPercent: number, jointInChain: number, thumb: boolean): number {
  const limits = thumb ? FINGER_LIMITS_DEG.thumb : FINGER_LIMITS_DEG.finger;
  const limit = limits[Math.min(limits.length - 1, Math.max(0, jointInChain))];
  const curl = Math.min(100, Math.max(0, Number.isFinite(curlPercent) ? curlPercent : 0)) / 100;
  return curl * limit * (Math.PI / 180);
}

export function fingersLine(curlPercent: number): string {
  const p = Math.round(Math.min(100, Math.max(0, curlPercent)));
  return p === 0 ? 'FINGERS · open' : p === 100 ? 'FINGERS · fist' : `FINGERS · ${p}% curled`;
}

export function statusLine(loaded: boolean, failed: boolean, garments: readonly string[], hasBelly: boolean, model = 0): string {
  const m = SARAH_LAB_MODELS[((model % SARAH_LAB_MODELS.length) + SARAH_LAB_MODELS.length) % SARAH_LAB_MODELS.length];
  if (failed) return `${m.path} did not load`;
  if (!loaded) return `loading Sarah ${m.id}…`;
  const g = garments.length ? `${garments.length} garment${garments.length === 1 ? '' : 's'}` : 'no clothes in this file yet';
  return `${m.id === 'v1' ? 'base model' : `model ${m.id}`} · ${hasBelly ? 'belly slider' : 'no belly slider'} · ${g}`;
}

// ------------------------------------------------------------ the bump's weight

/**
 * THE BUMP HAS WEIGHT (Joshua, 2026-10-07: "add a weight with the belly so it can
 * move and kind of jiggle, but not like jello... it could still tilt the belly
 * downward like 1-3° to look heavy"). The bake writes three motion targets
 * (`scripts/bellyMorph.mjs`), each the full bump moved with its edges held:
 * `bellyTilt` pitches it front-down by `BELLY_MOTION.tiltRad`, `bellyBob` drops it
 * and `bellySway` moves it to her left by `BELLY_MOTION.bobM`. A renderer drives
 * them with `stepBellySpring` and `bellyMotionWeights`; all of it scales with the
 * bump, so a flat belly does not move at all.
 */
export const BELLY_MOTION = Object.freeze({
  tilt: 'bellyTilt',
  bob: 'bellyBob',
  sway: 'bellySway',
  /** bellyTilt at weight 1, radians (the bake's MOTION_TILT_RAD): a true 20° turn */
  tiltRad: (20 * Math.PI) / 180,
  /** bellyBob and bellySway at weight 1, metres (the bake's MOTION_BOB_M) */
  bobM: 0.01,
});

/**
 * The spring: a mass that lags the body and settles. GAME TUNING, chosen to read
 * as heavy rather than as jelly: a low, slow bounce (2.2 Hz) damped so the second
 * swing is about a third of the first (ζ 0.32), and never more than 1.5 cm.
 */
export const BELLY_SPRING = Object.freeze({ hz: 2.2, damping: 0.32, maxM: 0.015, maxAccel: 40 });
/**
 * The weight slider's tilt, degrees front-down, from 0 to this. It was 3°; Joshua
 * asked for more on the big sizes (2026-10-07: "maybe just add a tilt in the belly
 * direction downwards like 10° or so"). A belly smaller than the model's tilts in
 * proportion; the model's and bigger tilt by the slider's degrees.
 */
export const BELLY_TILT_MAX_DEG = 10;
/**
 * Past the model's own belly the weight tilts it by itself (Joshua, 2026-10-07: "no
 * tilt until 100% then 200% = 20°"): rising evenly from none at 100% to 20° at 200%,
 * a fifth of a degree for every percent over 100. The WEIGHT slider adds to it, from 0.
 */
export const SIZE_TILT_DEG_PER_PERCENT = 0.2;
export function sizeTiltDeg(bumpPercent: number): number {
  const p = Math.min(BUMP_MAX_PERCENT, Math.max(100, Number.isFinite(bumpPercent) ? bumpPercent : 100));
  return (p - 100) * SIZE_TILT_DEG_PER_PERCENT;
}
/** Each centimetre the bump drops also pitches it this many tilt-target weights: it swings, not slides. */
const BOUNCE_TILT = 0.25 * (0.1 / ((20 * Math.PI) / 180)); // the same swing as before the tilt target became 20°

/** The bump's displacement from where it hangs, metres (y down, x to her left), and how fast. */
export interface BellySpring { y: number; vy: number; x: number; vx: number }
export const restingBellySpring = (): BellySpring => ({ y: 0, vy: 0, x: 0, vx: 0 });

/**
 * One step of the spring, in place. `upAccel` and `leftAccel` are the body's own
 * acceleration there (m/s², up and to her left): the bump lags it, so the body
 * rising throws the bump down and a step to the left throws it right. Substeps of
 * at most 1/240 s keep it stable on a slow frame; a jump (a pose change, a
 * teleport) is clamped rather than flung.
 */
export function stepBellySpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number): BellySpring {
  return stepSpring(s, dt, upAccel, leftAccel, BELLY_SPRING);
}

interface SpringTuning { readonly hz: number; readonly damping: number; readonly maxM: number; readonly maxAccel: number }
function stepSpring(s: BellySpring, dt: number, upAccel: number, leftAccel: number, tune: SpringTuning): BellySpring {
  const w = 2 * Math.PI * tune.hz, c = 2 * tune.damping * w;
  const clampA = (a: number) => (Number.isFinite(a) ? Math.max(-tune.maxAccel, Math.min(tune.maxAccel, a)) : 0);
  const ay = clampA(upAccel), ax = clampA(leftAccel);
  const total = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), 0.1);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const h = total / steps;
  for (let k = 0; k < steps && h > 0; k += 1) {
    s.vy += (-w * w * s.y - c * s.vy + ay) * h;
    s.vx += (-w * w * s.x - c * s.vx - ax) * h;
    s.y += s.vy * h;
    s.x += s.vx * h;
    const m = tune.maxM;
    if (Math.abs(s.y) > m) { s.y = Math.sign(s.y) * m; s.vy = 0; }
    if (Math.abs(s.x) > m) { s.x = Math.sign(s.x) * m; s.vx = 0; }
  }
  return s;
}

/**
 * A walk's own bounce, as the acceleration of the body: the hips rise and fall
 * twice a stride, about 2 cm either way (BIOLOGICAL SHAPE: the centre of mass
 * travels some 4 to 5 cm in a walking step), eased to WALK_BOUNCE_M. The lab's walk
 * turns joints and never lifts the body, so it adds this; a body that really moves
 * feeds its own.
 */
/**
 * How far the walk lifts the body each step, metres, for the springs to feel. 2 cm
 * is about a real walk's; it threw the bump about too much to look at (Joshua,
 * 2026-10-08: "the bounce is a little too much while walking... maybe lower 60%
 * less"), so 40% of it. GAME TUNING.
 */
export const WALK_BOUNCE_M = 0.02 * 0.4;

export function walkBounceAccel(phase: number, strideSeconds: number): number {
  if (!(strideSeconds > 0)) return 0;
  const w = (4 * Math.PI) / strideSeconds; // two steps a stride
  return -w * w * WALK_BOUNCE_M * Math.cos(4 * Math.PI * phase);
}

/** How much of the spring's travel the bump shows. GAME TUNING. */
export const BELLY_SWING = 0.45;

/** The three motion targets' weights for a bump size, a resting tilt and the spring. */
export function bellyMotionWeights(bumpPercent: number, tiltDeg: number, s: BellySpring): Record<string, number> {
  // a bigger belly is heavier: it tilts and swings by its size, the model's own being 1
  const size = Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)) / 100;
  const tilt = Math.min(BELLY_TILT_MAX_DEG, Math.max(0, tiltDeg)) * (Math.PI / 180);
  const bob = s.y / BELLY_MOTION.bobM;
  // how much it swings: grows with the bump to full term and NO further, at half the
  // spring's travel (Joshua, 2026-10-08: "the belly especially past 100% is too
  // exaggerated... lower even more"). A bigger belly is heavier, which moves less.
  const swing = BELLY_SWING * Math.min(1, size);
  return {
    [BELLY_MOTION.tilt]: (Math.min(1, size) * tilt + sizeTiltDeg(bumpPercent) * (Math.PI / 180)) / BELLY_MOTION.tiltRad + swing * BOUNCE_TILT * bob,
    [BELLY_MOTION.bob]: swing * bob,
    [BELLY_MOTION.sway]: swing * (s.x / BELLY_MOTION.bobM),
  };
}

/**
 * A REAL T-POSE FOR EITHER MASTER (Joshua, 2026-10-14: "make T-pose a real T-pose by
 * rotating at the shoulders"). v1 is modelled in a T, so its bind pose already is one;
 * v2 is modelled arms-down, so zeroing every turn left her standing. Each upper arm is
 * turned at its shoulder, in the bind pose's world frame, from the direction it was
 * modelled in to straight out to its side and level: about 90 degrees for v2, nothing for
 * v1. v2's armpits follow a raised arm through their weights (sarahV2Correctives.mjs).
 */
export interface TPoseJoint { readonly x: number; readonly y: number; readonly z: number }
export interface TPoseTurn { readonly joint: number; readonly ax: number; readonly ay: number; readonly az: number; readonly radians: number }
export function tPoseTurns(bind: readonly TPoseJoint[], arms: readonly { shoulder: number; elbow: number; out: 1 | -1 }[]): TPoseTurn[] {
  const turns: TPoseTurn[] = [];
  for (const { shoulder, elbow, out } of arms) {
    const s = bind[shoulder], e = bind[elbow];
    if (!s || !e) continue;
    const v = [e.x - s.x, e.y - s.y, e.z - s.z], l = Math.hypot(v[0], v[1], v[2]);
    if (!l) continue;
    const u = [v[0] / l, v[1] / l, v[2] / l], t = [out, 0, 0];
    const c = [u[1] * t[2] - u[2] * t[1], u[2] * t[0] - u[0] * t[2], u[0] * t[1] - u[1] * t[0]], sin = Math.hypot(c[0], c[1], c[2]), cos = u[0] * t[0] + u[1] * t[1] + u[2] * t[2];
    if (sin < 1e-6) continue;
    turns.push({ joint: shoulder, ax: c[0] / sin, ay: c[1] / sin, az: c[2] / sin, radians: Math.atan2(sin, cos) });
  }
  return turns;
}
