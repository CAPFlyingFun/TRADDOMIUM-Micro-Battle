/**
 * THE LEGS — pure integrators that carry a creature toward what its
 * brain chose, one `dt` at a time.
 *
 * Three ways of moving, one per medium, and every one of them the same
 * shape: turn toward the target at the species' turn rate, advance at
 * the pace the behaviour sets, and then settle the HEIGHT by the rule of
 * the medium — a walker stands on the ground, a burrower is held in its
 * band under it, a flier is eased toward its chosen height and never
 * past its ceiling. Nothing here decides anything: `intent.ts` chose the
 * target, the height and the word; this file only obeys them, and it
 * obeys them every frame while the brain speaks every `thinkS`.
 *
 * TURNING IS A RATE, NOT AN EASE. The donor worm's first cut eased its
 * heading by half the gap a second, which is fastest when the gap is
 * widest — a turning radius of four millimetres inside a six-millimetre
 * tube, and half its bones drawn through the wall of its own burrow.
 * `pace.turnRadS` is a hard angular limit and the turn radius is
 * pace over rate, which the species table can reason about.
 *
 * NEVER NaN. A `dt` that is not a positive finite number moves nothing;
 * a ground the world cannot price (non-finite) leaves the height alone;
 * and every write is clamped before it lands. A creature that cannot be
 * drawn is worse than one that stands still.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distance } from '../world/coords';
import { ahead, headingToward, turnToward } from './heading';
import { unitsOfMm, type CreatureSpecies } from './species';
import type { Behaviour, CreatureState } from './state';
import type { CreatureWorld } from './world';

/** Near enough to its target that it is THERE, as a fraction of a body length. GAME TUNING. */
const ARRIVE_LENGTHS = 0.25;
/**
 * How fast a plant creature DROPS when it flees downward, mm/s. A drop is
 * a fall, not a climb: an aphid lets go of the stem. BIOLOGICAL SHAPE — a
 * small insect falls through air at about a metre a second; the exact
 * figure does not matter at nine centimetres.
 */
export const DROP_MM_S = 1000;

/** The words in which a body is off the ground, as a switch a frame can afford. */
export function isAirborne(behaviour: Behaviour): boolean {
  switch (behaviour) {
    case 'takeoff':
    case 'fly':
    case 'hover':
    case 'land':
      return true;
    default:
      return false;
  }
}

/** The words in which a body is going somewhere — what tires it. */
export function isMoving(behaviour: Behaviour): boolean {
  switch (behaviour) {
    case 'wander':
    case 'flee':
    case 'burrow':
    case 'surface':
    case 'takeoff':
    case 'fly':
    case 'hover':
    case 'land':
      return true;
    default:
      return false;
  }
}

/**
 * The pace on the plane for a grounded behaviour, world units a second.
 * Feeding moves only to reach the food it was sent to; idling, resting
 * and hovering do not move at all — an animal that drifts while it eats
 * looks like it is skating.
 */
export function paceOf(state: CreatureState, species: CreatureSpecies): number {
  switch (state.behaviour) {
    case 'flee':
      return unitsOfMm(species.pace.fleeMmS);
    case 'wander':
    case 'burrow':
      return unitsOfMm(species.pace.wanderMmS);
    case 'feed':
      return state.target === null ? 0 : unitsOfMm(species.pace.wanderMmS);
    default:
      return 0;
  }
}

/** Has it reached its target, within a quarter of a body length? True with no target. */
export function arrived(state: CreatureState, species: CreatureSpecies): boolean {
  if (state.target === null) return true;
  return distance(state.at, state.target) <= ARRIVE_LENGTHS * unitsOfMm(species.lengthMm);
}

/**
 * Turn toward the target and advance `pace * dt` along the heading,
 * never past the target. Returns the distance moved on the plane. With
 * no target it goes where it is pointed.
 */
function stepToward(state: CreatureState, species: CreatureSpecies, pace: number, dt: number): number {
  const target = state.target;
  const maxTurn = species.pace.turnRadS * dt;
  if (target === null) {
    if (!(pace > 0)) return 0;
    const step = pace * dt;
    state.at = ahead(state.at, state.heading, step);
    return step;
  }
  if (!Number.isFinite(target.wx) || !Number.isFinite(target.wz)) return 0;
  const remaining = distance(state.at, target);
  state.heading = turnToward(state.heading, headingToward(state.at, target), maxTurn);
  if (!(pace > 0) || remaining <= 0) return 0;
  const step = pace * dt;
  const arriveWithin = Math.max(step, ARRIVE_LENGTHS * unitsOfMm(species.lengthMm));
  if (remaining <= arriveWithin) {
    // Close enough to take the last step straight, rather than orbit a
    // target inside its own turning circle.
    state.at = target;
    return remaining;
  }
  state.at = ahead(state.at, state.heading, step);
  return step;
}

/** `value` moved toward `wanted` by at most `maxStep`. */
function approach(value: number, wanted: number, maxStep: number): number {
  const gap = wanted - value;
  if (!(maxStep > 0)) return value;
  if (Math.abs(gap) <= maxStep) return wanted;
  return value + (gap > 0 ? maxStep : -maxStep);
}

/** The climb angle for a vertical change over a planar one: straight up or down when it did not move on the plane. */
function pitchOf(dHeight: number, dPlane: number): number {
  if (dHeight === 0) return 0;
  if (dPlane <= 0) return dHeight > 0 ? Math.PI / 2 : -Math.PI / 2;
  return Math.atan2(dHeight, dPlane);
}

/**
 * WALK: on the ground, or along a plant. A ground creature's height is
 * the ground's. A plant creature's is eased toward its chosen perch
 * height (its `targetHeight`, never below the ground) at its own pace —
 * an aphid climbs a stem as fast as it walks along one.
 */
export function walk(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const moved = stepToward(state, species, paceOf(state, species), dt);
  const ground = world.groundAt(state.at);
  if (!Number.isFinite(ground)) return moved;
  const before = state.height;
  if (species.medium === 'plant') {
    const wanted = Number.isFinite(state.targetHeight) ? Math.max(ground, state.targetHeight) : ground;
    const fleeing = state.behaviour === 'flee';
    // Down in a flee is a drop; everything else is a climb at its own pace.
    const mmS = fleeing && wanted < state.height ? DROP_MM_S : fleeing ? species.pace.fleeMmS : species.pace.wanderMmS;
    state.height = Math.max(ground, approach(state.height, wanted, unitsOfMm(mmS) * dt));
  } else {
    state.height = ground;
  }
  state.pitch = pitchOf(state.height - before, moved);
  return moved;
}

/**
 * BURROW: on the plane like a walk, and in height held to the band under
 * the surface — from `underMm` below the ground up to half a bore below
 * it, so the tube it leaves never breaks the surface. `surface` and
 * `feed` ease it up to the ground and no higher; `flee` sends it to the
 * bottom of the band. The band is re-read where it stands every frame,
 * so a worm travelling level under a slope has the ground come down to
 * meet it and is held under, following the contour, rather than left
 * standing in the air — the donor's measured bug.
 */
export function burrow(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const spec = species.burrow;
  if (spec === null) return walk(state, species, world, dt);
  const moved = stepToward(state, species, paceOf(state, species), dt);
  const ground = world.groundAt(state.at);
  if (!Number.isFinite(ground)) return moved;
  const bottom = ground - unitsOfMm(spec.underMm);
  const top = ground - unitsOfMm(spec.boreMm) / 2;
  const up = state.behaviour === 'surface' || state.behaviour === 'feed';
  let wanted: number;
  if (up) wanted = ground;
  else if (state.behaviour === 'flee') wanted = bottom;
  else wanted = Number.isFinite(state.targetHeight) ? Math.min(top, Math.max(bottom, state.targetHeight)) : (top + bottom) / 2;
  const rate = unitsOfMm(state.behaviour === 'flee' ? species.pace.fleeMmS : species.pace.wanderMmS) * dt;
  const before = state.height;
  let height = approach(state.height, wanted, rate);
  height = up ? Math.min(ground, height) : Math.min(top, Math.max(bottom, height));
  state.height = height;
  state.pitch = pitchOf(height - before, moved);
  return moved;
}

/**
 * FLY: the airborne words. Cruise toward the target on the plane; ease
 * the height toward the chosen one at the climb rate, kept inside the
 * cruise band over the ground under it and never past the ceiling;
 * landing descends onto the ground. Hovering holds. The pitch is the
 * climb angle, from the vertical velocity — a renderer reads it, never a
 * mode.
 */
export function fly(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const spec = species.flight;
  if (spec === null) return walk(state, species, world, dt);
  const cruise = unitsOfMm(spec.cruiseMmS);
  const climb = unitsOfMm(spec.climbMmS);
  const pace = state.behaviour === 'hover' ? 0 : cruise;
  const moved = stepToward(state, species, pace, dt);
  const ground = world.groundAt(state.at);
  if (!Number.isFinite(ground)) return moved;
  const ceiling = ground + unitsOfMm(spec.ceilingMm);
  const lo = Math.min(ceiling, ground + unitsOfMm(spec.cruiseMm[0]));
  const hi = Math.min(ceiling, ground + unitsOfMm(spec.cruiseMm[1]));
  let wanted: number;
  if (state.behaviour === 'land') wanted = ground;
  else wanted = Number.isFinite(state.targetHeight) ? Math.min(hi, Math.max(lo, state.targetHeight)) : lo;
  const before = state.height;
  const height = Math.min(ceiling, Math.max(ground, approach(state.height, wanted, climb * dt)));
  state.height = height;
  state.pitch = pitchOf(height - before, moved);
  return moved;
}

/**
 * One frame of movement for any creature, by its medium and its word.
 * Returns the distance moved on the plane — what the burrow gate's
 * cadence is counted in.
 */
export function move(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  if (species.medium === 'soil') return burrow(state, species, world, dt);
  if (species.medium === 'air' && isAirborne(state.behaviour)) return fly(state, species, world, dt);
  return walk(state, species, world, dt);
}
