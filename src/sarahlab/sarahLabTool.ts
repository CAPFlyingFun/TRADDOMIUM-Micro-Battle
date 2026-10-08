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
    "Sarah rebuilt from the base mannequin, to try before she goes live: the BUMP slider runs from full term to "
    + 'nearly flat, FINGERS curls all ten, SHIRT and LEGGINGS show the clothes grown from her body, and STAND, '
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
 * belly is not rounded like it should").
 */
export const BELLY_KEYS: readonly (readonly [number, string | null])[] = [
  [1, null], [0.75, 'belly75'], [0.5, 'belly50'], [0.25, 'belly25'], [0, BELLY_TARGET],
];
/** The clothes' material names (`scripts/growClothes.mjs`). */
export const GARMENTS = ['shirt', 'leggings'] as const;
export type Garment = (typeof GARMENTS)[number];

/**
 * The bump slider reads as how much bump there is. Each target's weight: the two
 * keys either side of the slider share it, every other target is 0.
 */
export function bellyWeights(bumpPercent: number): Record<string, number> {
  const b = Math.min(100, Math.max(0, bumpPercent)) / 100;
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

export function bumpLine(bumpPercent: number): string {
  const p = Math.round(Math.min(100, Math.max(0, bumpPercent)));
  return p === 100 ? 'BUMP 100% · as modelled' : p === 0 ? 'BUMP 0% · nearly flat' : `BUMP ${p}%`;
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
