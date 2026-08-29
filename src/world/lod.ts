/**
 * THE MASTER LOD CORE — one answer to "how far is this from her, and
 * what detail has it earned".
 *
 * Every distance-graded system in the game had been inventing its own
 * ruler: the terrain material measured a 3D radius from the queen, the
 * foam measured texels per pixel, the ground cover counted planar
 * chunks — and each new system would have added another. This module is
 * the one ruler. It owns:
 *
 *   - the ANCHOR: the queen's authoritative 3D position, world coords
 *   - TRUE 3D DISTANCE from that anchor — dx² + dy² + dz², all three
 *   - the DETAIL DIAL and the radius it means (25% = 2.5 m … 200% = 20 m)
 *   - the MICRO detail feather (full inside 0.7R, gone by R)
 *   - CATEGORY PROFILES, tier evaluation, and hysteresis
 *
 * And deliberately nothing else. Consumers decide what a tier MEANS —
 * this module never touches a mesh, a material or a texture, and it
 * imports no renderer. The shader bridge (terrainMaterial's uniforms),
 * the debug tooling and any future entity scheduler live in their own
 * files and READ from here; growing those into this file is how a core
 * becomes a god-object, and the boundary is on purpose.
 *
 * THE SPHERE, NOT THE CIRCLE. Distance is Euclidean in all three axes:
 * a queen 166 m above the beach is 166 m from that beach's foam and
 * grass, not zero metres because her shadow touches it. The planar
 * mistake shipped once already — an early detail fade measured X/Z only
 * and altitude quietly handed her more region than the dial promised —
 * and tests/lod.test.ts exists so it cannot ship twice.
 *
 * DETAIL DISTANCE IS NOT WORLD COVERAGE. This module answers "how much
 * detail should this receive". It does not answer "what part of the
 * world needs to exist" — terrain streaming, HD tile availability and
 * ocean sheet coverage stay planar on purpose, because the ground under
 * a high-flying queen must exist to be landed on however far away it
 * is. A coverage system may REGISTER here (class 'coverage') so the
 * debug view can see it; it is not asked to go spherical.
 *
 * TWO GATES, LESSER WINS. The master radius says what detail the player
 * has earned; the screen-space texel safeguards (terrainMaterial's
 * footprint fades, the foam's texel knees) say what a pixel can
 * physically resolve. Whichever wants LESS detail wins, always. Neither
 * replaces the other: distance without the safeguard smears grazing
 * angles, the safeguard without distance let altitude redefine the
 * dial.
 *
 * COORDINATES. Everything here is WORLD coordinates, float64, where
 * precision at 5.6 million units costs nothing (origin.ts). The anchor
 * carries a wy the planar WorldPoint type deliberately lacks, because
 * the sphere needs it; a LocalPoint cannot be passed by accident
 * because the field names do not fit. Distances are therefore invariant
 * under an origin rebase by construction — both ends of the subtraction
 * live in the frame that never moves.
 */
import { UNITS_PER_METRE } from './kauai';

/** How the anchor is read back: world coordinates, all three axes. */
export interface LodAnchor {
  readonly wx: number;
  readonly wy: number;
  readonly wz: number;
}

/**
 * What a category IS, and the word is a contract:
 *
 *   micro     expensive ant-scale detail, hard-bounded by the Detail
 *             sphere — fine relief, foam fizz and lace, grass blades.
 *             Gate on detailFraction(); outside the sphere it is GONE,
 *             not merely cheap.
 *   macro     visible beyond the sphere in cheaper forms — trees,
 *             rocks, nests, insects, other players. Owns its own tier
 *             ladder, which may reach kilometres.
 *   coverage  "what world must exist" systems — terrain tiers, HD
 *             tiles, ocean sheets. Registered for the debug view;
 *             their planar windows are correct and stay theirs.
 */
export type LodClass = 'micro' | 'macro' | 'coverage';

/** One rung of a category's ladder. `upTo` is world units of 3D
 *  distance; the last rung may be Infinity. */
export interface LodTier {
  readonly name: string;
  readonly upTo: number;
}

export interface LodProfile {
  readonly name: string;
  readonly cls: LodClass;
  /** Nearest first, strictly increasing upTo. */
  readonly tiers: readonly LodTier[];
  /** Fraction of a boundary reclaimed before stepping back to a finer
   *  tier. Default HYSTERESIS. */
  readonly hysteresis?: number;
}

/** What tierAt hands back: which rung, and how far into the feather
 *  toward the next (0 solidly this tier, 1 at the boundary). */
export interface TierRead {
  readonly index: number;
  readonly tier: LodTier;
  readonly fade: number;
}

/** Metres of Detail radius per unit of the settings dial. */
export const METRES_PER_DIAL = 10;

/**
 * Where the MICRO feather begins, as a fraction of the radius. Full
 * detail inside 0.7R, smoothly gone by R — at 200% that is Joshua's
 * table exactly: full to 14 m, fading to 20 m, nothing past it.
 */
export const DETAIL_FEATHER = 0.7;

/** Fraction of a boundary reclaimed before a tier steps back finer. */
export const HYSTERESIS = 0.08;
/** …but never less than this, so a tight boundary still cannot
 *  flicker. Half a metre. */
export const HYSTERESIS_FLOOR = 50;

/** Fraction of a tier's span that feathers toward the next. */
const TIER_FEATHER = 0.3;

/** How much of a fresh speed reading joins the smoothed one. */
const SPEED_BLEND = 0.2;

let anchorX = 0;
let anchorY = 0;
let anchorZ = 0;
let anchorSet = false;
/** Smoothed, because per-frame differencing of a walking ant jitters. */
let speed = 0;

/** The dial as set; radius derives. Defaults match the uniform's
 *  pre-lod default (dial 1 = 10 m) so nothing moves until settings
 *  load, exactly as before. */
let dial = 1;
let radius = METRES_PER_DIAL * UNITS_PER_METRE;

const profiles = new Map<string, LodProfile>();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
}

/**
 * The scene calls this once a frame with her WORLD position — wy
 * included, which is her rendered y unchanged: the origin rebases in
 * x and z only, so height is the one axis the two frames share.
 */
export function setAnchor(wx: number, wy: number, wz: number, dt = 0): void {
  if (anchorSet && dt > 0) {
    const step = Math.hypot(wx - anchorX, wy - anchorY, wz - anchorZ) / dt;
    speed += (step - speed) * SPEED_BLEND;
  }
  anchorX = wx;
  anchorY = wy;
  anchorZ = wz;
  anchorSet = true;
}

export function anchor(): LodAnchor {
  return { wx: anchorX, wy: anchorY, wz: anchorZ };
}

/**
 * How fast the anchor is moving, world units a second, smoothed.
 * Streaming consumers lead their windows by speed × latency so
 * Auto-Ant cannot outrun a load — see leadDistance.
 */
export function anchorSpeed(): number {
  return speed;
}

/** How far she will travel while something takes `seconds` to arrive. */
export function leadDistance(seconds: number): number {
  return speed * Math.max(0, seconds);
}

/** True 3D distance from the anchor, squared — the comparison form.
 *  Prefer this in any loop; take the root only for display or fades. */
export function distanceSqTo(wx: number, wy: number, wz: number): number {
  const dx = wx - anchorX;
  const dy = wy - anchorY;
  const dz = wz - anchorZ;
  return dx * dx + dy * dy + dz * dz;
}

/** True 3D distance from the anchor. All three axes, always. */
export function distanceTo(wx: number, wy: number, wz: number): number {
  return Math.sqrt(distanceSqTo(wx, wy, wz));
}

/**
 * THE DIAL, in the slider's own units: 0.25 → 2.5 m of radius, 2 →
 * 20 m. The floor is a hair above zero rather than one — `Math.max(1,
 * dial)` shipped once and silently pinned the bottom three settings
 * (see tests/detailRadius.test.ts, which still stands guard).
 */
export function setDetailDial(value: number): void {
  dial = Math.max(0.01, value);
  radius = dial * METRES_PER_DIAL * UNITS_PER_METRE;
}

export function detailDial(): number {
  return dial;
}

/** The Detail radius, world units. What the slider means. */
export function detailRadius(): number {
  return radius;
}

/**
 * THE MICRO GATE: how much expensive ant-scale detail this distance
 * has earned. 1 inside DETAIL_FEATHER of the radius, 0 at the radius,
 * smooth between — a hard budget wearing a soft edge.
 */
export function detailFraction(dist: number): number {
  return 1 - smoothstep(radius * DETAIL_FEATHER, radius, dist);
}

/**
 * A category says what it is once; the debug view and any scheduler
 * find every category here. Re-registering a name replaces it, so a
 * rebuilt scene does not stack ghosts.
 */
export function registerProfile(profile: LodProfile): void {
  profiles.set(profile.name, profile);
}

export function profileFor(name: string): LodProfile | undefined {
  return profiles.get(name);
}

/** Every registered profile, for the debug surface. A copy. */
export function profilesSnapshot(): LodProfile[] {
  return [...profiles.values()];
}

/**
 * Which rung of a profile's ladder this distance sits on.
 *
 * WITH MEMORY, AND THE MEMORY IS THE POINT. Pass the previous index
 * and boundaries become one-way doors with a return margin: stepping
 * COARSER happens the moment the boundary is crossed (detail must
 * never overstay its budget), but stepping FINER again asks for the
 * boundary minus the hysteresis margin, so an object drifting at
 * exactly 20 m does not flicker between two tiers at frame rate.
 * Without a previous index it is the raw, margin-free answer.
 */
export function tierAt(
  profile: LodProfile, dist: number, prevIndex = -1,
): TierRead {
  const tiers = profile.tiers;
  const last = tiers.length - 1;
  const h = profile.hysteresis ?? HYSTERESIS;
  const margin = (i: number) =>
    Math.max(HYSTERESIS_FLOOR, tiers[i].upTo * h);

  let index: number;
  if (prevIndex >= 0 && prevIndex <= last) {
    index = prevIndex;
    // Finer only past the margin; coarser the moment it is due.
    while (index > 0 && dist < tiers[index - 1].upTo - margin(index - 1)) index--;
    while (index < last && dist > tiers[index].upTo) index++;
  } else {
    index = 0;
    while (index < last && dist > tiers[index].upTo) index++;
  }

  // The transition amount, over the last stretch of this tier — the
  // common language for a consumer that crossfades. One that pops may
  // simply ignore it.
  const tier = tiers[index];
  let fade = 0;
  if (Number.isFinite(tier.upTo)) {
    const from = index > 0 ? tiers[index - 1].upTo : 0;
    const span = tier.upTo - from;
    fade = span > 0
      ? smoothstep(tier.upTo - span * TIER_FEATHER, tier.upTo, dist)
      : 1;
  }
  return { index, tier, fade };
}

/** A clean slate — scene teardown and the tests' fresh start. */
export function resetLod(): void {
  anchorX = 0;
  anchorY = 0;
  anchorZ = 0;
  anchorSet = false;
  speed = 0;
  dial = 1;
  radius = METRES_PER_DIAL * UNITS_PER_METRE;
  profiles.clear();
}
