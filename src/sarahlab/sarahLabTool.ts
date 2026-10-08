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
/** The only file the lab loads, and the only place it is used. */
export const SARAH_BASE_MODEL = 'models/sarah-base.glb';

export const sarahLabTool: DevTool = {
  id: SARAH_LAB_TOOL_ID,
  title: 'Sarah Lab (base model)',
  description:
    "Sarah rebuilt from the base mannequin, to try before she goes live: the BUMP slider runs from twice full term (twins and more, her breasts growing with it) to "
    + 'nearly flat, WEIGHT tilts the bump down 0 to 10° and BOUNCE (or WALK) shows it move, FINGERS curls all ten, SHIRT and LEGGINGS show the clothes grown from her body, and STAND, '
    + 'WALK and SIT pose her. Drag to turn round her, pinch or scroll to come closer. Not used by the story or the game.',
  sceneId: SARAH_LAB_SCENE_ID,
};

/** The HUD root's `data-role`: what a probe waits for. */
export const SARAH_LAB_HUD_ROLE = 'sarah-lab-hud';

export type SarahLabPose = 'stand' | 'walk' | 'sit';

export const SARAH_LAB_ACTION = Object.freeze({
  back: 'sarahlab:back',
  stand: 'sarahlab:stand',
  walk: 'sarahlab:walk',
  sit: 'sarahlab:sit',
  shirt: 'sarahlab:shirt',
  leggings: 'sarahlab:leggings',
  turn: 'sarahlab:turn',
  bounce: 'sarahlab:bounce',
});

export const SARAH_LAB_FIELD = Object.freeze({
  status: 'sarahlab-status',
  bump: 'sarahlab-bump',
  fingers: 'sarahlab-fingers',
  weight: 'sarahlab-weight',
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
  [2, 'belly200'], [1.5, 'belly150'], [1, null], [0.75, 'belly75'], [0.5, 'belly50'], [0.25, 'belly25'], [0, BELLY_TARGET],
];
/** The clothes' material names (`scripts/growClothes.mjs`). */
export const GARMENTS = ['shirt', 'leggings'] as const;
export type Garment = (typeof GARMENTS)[number];

/**
 * The bump slider reads as how much bump there is. Each target's weight: the two
 * keys either side of the slider share it, every other target is 0.
 */
/** The bump slider's top: twice the model's own belly. */
export const BUMP_MAX_PERCENT = 200;

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
 * THE BREASTS FOLLOW THE BUMP (Joshua, 2026-10-07: belly 50% with breasts 25%, 100%
 * with 50%, 150% with 75%, 200% with 100%): half the bump's percent. The model's own
 * breasts are 50%; the bake's `breast0` and `breast100` are the two ends.
 */
export const BREAST_TARGETS = Object.freeze({ small: 'breast0', big: 'breast100' });
export function breastPercent(bumpPercent: number): number {
  return Math.min(BUMP_MAX_PERCENT, Math.max(0, Number.isFinite(bumpPercent) ? bumpPercent : 100)) / 2;
}
export function breastWeights(bumpPercent: number): Record<string, number> {
  const b = breastPercent(bumpPercent);
  return {
    [BREAST_TARGETS.small]: b < 50 ? (50 - b) / 50 : 0,
    [BREAST_TARGETS.big]: b > 50 ? (b - 50) / 50 : 0,
  };
}

export function bumpLine(bumpPercent: number): string {
  const p = Math.round(Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)));
  const breasts = ` · breasts ${Math.round(breastPercent(p))}%`;
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

export function statusLine(loaded: boolean, failed: boolean, garments: readonly string[], hasBelly: boolean): string {
  if (failed) return 'models/sarah-base.glb did not load';
  if (!loaded) return 'loading Sarah…';
  const g = garments.length ? garments.join(' + ') : 'no clothes in this file';
  return `base model · ${hasBelly ? 'belly slider' : 'no belly slider'} · ${g}`;
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
  const w = 2 * Math.PI * BELLY_SPRING.hz, c = 2 * BELLY_SPRING.damping * w;
  const clampA = (a: number) => (Number.isFinite(a) ? Math.max(-BELLY_SPRING.maxAccel, Math.min(BELLY_SPRING.maxAccel, a)) : 0);
  const ay = clampA(upAccel), ax = clampA(leftAccel);
  const total = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), 0.1);
  const steps = Math.max(1, Math.ceil(total / (1 / 240)));
  const h = total / steps;
  for (let k = 0; k < steps && h > 0; k += 1) {
    s.vy += (-w * w * s.y - c * s.vy + ay) * h;
    s.vx += (-w * w * s.x - c * s.vx - ax) * h;
    s.y += s.vy * h;
    s.x += s.vx * h;
    const m = BELLY_SPRING.maxM;
    if (Math.abs(s.y) > m) { s.y = Math.sign(s.y) * m; s.vy = 0; }
    if (Math.abs(s.x) > m) { s.x = Math.sign(s.x) * m; s.vx = 0; }
  }
  return s;
}

/**
 * A walk's own bounce, as the acceleration of the body: the hips rise and fall
 * twice a stride, about 2 cm either way (BIOLOGICAL SHAPE: the centre of mass
 * travels some 4 to 5 cm in a walking step). The lab's walk turns joints and
 * never lifts the body, so it adds this; a body that really moves feeds its own.
 */
export function walkBounceAccel(phase: number, strideSeconds: number): number {
  if (!(strideSeconds > 0)) return 0;
  const w = (4 * Math.PI) / strideSeconds; // two steps a stride
  return -w * w * 0.02 * Math.cos(4 * Math.PI * phase);
}

/** The three motion targets' weights for a bump size, a resting tilt and the spring. */
export function bellyMotionWeights(bumpPercent: number, tiltDeg: number, s: BellySpring): Record<string, number> {
  // a bigger belly is heavier: it tilts and swings by its size, the model's own being 1
  const size = Math.min(BUMP_MAX_PERCENT, Math.max(0, bumpPercent)) / 100;
  const tilt = Math.min(BELLY_TILT_MAX_DEG, Math.max(0, tiltDeg)) * (Math.PI / 180);
  const bob = s.y / BELLY_MOTION.bobM;
  return {
    [BELLY_MOTION.tilt]: (Math.min(1, size) * tilt + sizeTiltDeg(bumpPercent) * (Math.PI / 180)) / BELLY_MOTION.tiltRad + size * BOUNCE_TILT * bob,
    [BELLY_MOTION.bob]: size * bob,
    [BELLY_MOTION.sway]: size * (s.x / BELLY_MOTION.bobM),
  };
}

export function weightLine(tiltDeg: number): string {
  const d = Math.min(BELLY_TILT_MAX_DEG, Math.max(0, tiltDeg));
  return d === 0 ? 'WEIGHT · no tilt' : `WEIGHT · tilts ${d.toFixed(1)}° down`;
}
