/**
 * THE FIRST SHADOW — one sun, one depth map, one square of ground that
 * follows the camera. The numbers, and the rules for when it is worth
 * casting at all.
 *
 * Joshua, 2026-09-07: "add the SMALLEST practical first shadow — one
 * sun/directional shadow + a small camera-relevant region + quality-
 * tier control + measured cost. Near-camera shadows are what matter at
 * ant scale. Do not add CSM. Do not expect sun shadows when the sun is
 * below the horizon. Integrate with Detail Quality. High must stay a
 * viable mobile rung."
 *
 * So: no cascades, no second map, no shadow beyond the square. An ant
 * lives inside a few metres of ground, and a shadow map spent on the
 * far hills would be texels spent where she cannot see them. The map
 * is an orthographic square of `2 · reach` a side, centred under the
 * camera and looking down the sun's own direction; `SkyView` places it
 * and moves it in whole texels so it does not shimmer as she walks.
 *
 * ─── the rungs ────────────────────────────────────────────────────────
 *
 * `SHADOW_RUNGS` is keyed by the detail rung's NAME, exactly as
 * `RainView`'s `RAIN_CAPS` and `world/objects/budget.ts` are, so the
 * rung stays a lens: the same sun, more or fewer texels under it. A
 * test pins the keys against `DETAIL_TIERS`. The map size is a CAP,
 * not a quota — three may hold it down to the device's largest texture
 * — and 0 is no shadow at all, which is what the two rungs under
 * `medium` get: a phone on `low` is there because it has no frame to
 * spare, and a depth pass is a second render of everything nearby.
 *
 *   rung         map      reach    texel     what it buys
 *   ultra-low       0        —       —       nothing: no depth pass
 *   low             0        —       —       nothing
 *   medium        512    2.5 m   0.98 cm    a soft blob under the ant
 *   high         1024      4 m   0.78 cm    an ant's legs, a blade's edge
 *   ultra-high   2048      8 m   0.78 cm    the same texel, twice as far
 *
 * All GAME TUNING. `high` at 1024 texels is what Joshua's phone runs and
 * is the largest any mobile rung may ask for; a test holds every mobile
 * rung at or under it. The reach is small on purpose: an ant is a unit
 * long, and a 0.78 cm texel is what it takes for her own shadow to have
 * legs.
 *
 * ─── when there is a shadow ───────────────────────────────────────────
 *
 * Three things take the shadow away, and each is continuous where it
 * can be, because a shadow that popped in at sunrise would be the first
 * thing a screenshot showed:
 *
 *   THE NIGHT. `skyLook`'s night key light is 0.06 — moon and skyglow,
 *   not a sun. Below `SHADOW_SUN_MIN` the light casts nothing: there is
 *   no sun to cast it. This one is a switch, and it is safe as a
 *   switch because the elevation fade below has already taken the
 *   shadow to zero long before the intensity crosses it.
 *
 *   THE LOW SUN. The map's square is measured across the sun's view;
 *   on the ground it stretches by 1/sin(elevation), so at the +6°
 *   floor the key light is held to (`LIGHT_FLOOR`) each texel is ten
 *   times as long as it is wide and the shadow is a smear. The shadow
 *   fades from full at `SHADOW_FULL_ABOVE_DEG` to nothing at the floor,
 *   and since the look's key light NEVER comes from under the floor,
 *   "the sun is below the horizon" and "the shadow is gone" are the
 *   same fact.
 *
 *   THE CLOUD. An overcast sky has no hard shadow — the light comes
 *   from everywhere. `skyLook` already turns the sun down and the sky
 *   up under cover (its `gloom`), and the shadow follows the same
 *   number: its strength is `1 − gloom`, so a shower washes it out and
 *   a clearing brings it back at the same pace as the light itself.
 *
 * Both fades land on `shadow.intensity`, which three mixes toward
 * unshadowed per fragment (`mix(1.0, shadow, intensity)`), a uniform
 * and not a define: no shader is rebuilt as the day goes by. And when
 * the result would be invisible — intensity zero, or the sun gone —
 * the light stops CASTING, so the depth pass is not paid for a shadow
 * nobody could see. That is most of an overcast day on Kauaʻi.
 *
 * Pure: no three, no DOM. A texel size is a number.
 */
import { LIGHT_FLOOR, type SkyLook } from './skyLook';

/** What a rung affords: a map, and the square of ground it covers. */
export interface ShadowSpec {
  /** Texels a side of the depth map. 0 is no shadow at all. GAME TUNING, a cap. */
  readonly mapSize: number;
  /** Half the width of the camera-following square, in world units (centimetres). GAME TUNING. */
  readonly reach: number;
}

/** 100 world units to the metre, as everywhere: one unit is a centimetre. */
const M = 100;
const DEG = Math.PI / 180;

/** No map, no square: what the rungs under `medium` get, and what `shadowFor` never returns for a known rung above them. */
export const NO_SHADOW: ShadowSpec = Object.freeze({ mapSize: 0, reach: 0 });

/**
 * The shadow each detail rung affords, keyed by the rung's NAME so
 * `sky/` need not import the ladder. A test pins the keys against
 * `DETAIL_TIERS`, the sizes monotone, and every mobile rung at or
 * under 1024.
 */
export const SHADOW_RUNGS: Readonly<Record<string, ShadowSpec>> = Object.freeze({
  'ultra-low': NO_SHADOW,
  low: NO_SHADOW,
  medium: Object.freeze({ mapSize: 512, reach: 2.5 * M }),
  high: Object.freeze({ mapSize: 1024, reach: 4 * M }),
  'ultra-high': Object.freeze({ mapSize: 2048, reach: 8 * M }),
});

/** The shadow for a rung named by the detail ladder. An unknown name is `medium`, as the rain's cap is. */
export function shadowFor(rung: string): ShadowSpec {
  return SHADOW_RUNGS[rung] ?? SHADOW_RUNGS.medium;
}

/**
 * The sun intensity under which the light casts nothing: the night key
 * light is 0.06 and no sun is 0.06. A clear day is 1.15 and full
 * overcast at noon is 0.175, which is under this too — and under cover
 * the fade has already made the shadow invisible. GAME TUNING.
 */
export const SHADOW_SUN_MIN = 0.2;

/** The shadow is at full strength from this sun elevation up. GAME TUNING. */
export const SHADOW_FULL_ABOVE_DEG = 15;
/** …and gone at the key light's floor, where the square on the ground is ten texels long for every one wide. */
export const SHADOW_GONE_AT_DEG = LIGHT_FLOOR / DEG;

/**
 * How far the sampling point is pushed along the surface normal before
 * the depth compare, in texels. 1.5 texels is what it takes to clear
 * the depth's own staircase on a slope (GAME TUNING; three's guidance
 * is "about a texel"). In world units this comes to 1.2–1.5 cm at
 * every rung — deliberately more than the 0.25-unit spacing a float32
 * has at the island's coastal coordinates (2.8 million units from the
 * origin), so wherever the render frame's rebase has left the eye, no
 * acne can come from the depth being quantised coarser than the bias.
 */
export const NORMAL_BIAS_TEXELS = 1.5;

/** One texel of the map on the ground, in world units, seen square on. 0 when there is no map. */
export function shadowTexel(spec: ShadowSpec): number {
  return spec.mapSize > 0 ? (2 * spec.reach) / spec.mapSize : 0;
}

/** The normal bias for a rung, in world units: `NORMAL_BIAS_TEXELS` of its texel. */
export function shadowNormalBias(spec: ShadowSpec): number {
  return shadowTexel(spec) * NORMAL_BIAS_TEXELS;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 at `from`, 1 at `to`, straight between — `skyLook`'s ramp, for the same reason: nothing here may snap. */
const ramp = (x: number, from: number, to: number): number => clamp01((x - from) / (to - from));

/**
 * How much of the shadow the sun's height allows, 0..1: nothing at the
 * key light's floor, everything from `SHADOW_FULL_ABOVE_DEG` up. Takes
 * the LOOK's elevation — already held to the floor — so that after
 * sunset it is exactly zero and not merely small.
 */
export function shadowElevationFade(sunElevation: number): number {
  return ramp(sunElevation / DEG, SHADOW_GONE_AT_DEG, SHADOW_FULL_ABOVE_DEG);
}

/**
 * The shadow's strength this frame: the height fade, washed out by the
 * cloud. This is what goes on `shadow.intensity`.
 */
export function shadowIntensityFor(look: SkyLook): number {
  return shadowElevationFade(look.sunElevation) * clamp01(1 - look.gloom);
}

/**
 * Whether the light should CAST this frame: there is a map, there is a
 * sun, and the shadow would be visible. The depth pass is the whole
 * cost, and it is not paid for a shadow no one could see.
 */
export function shadowCasts(spec: ShadowSpec, look: SkyLook): boolean {
  return spec.mapSize > 0 && look.sunIntensity > SHADOW_SUN_MIN && shadowIntensityFor(look) > 0;
}
