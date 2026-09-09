/**
 * THE LEGS — the AI's door to the one integrator.
 *
 * Until the Creature Lab this file held the three pure integrators —
 * walk, burrow, fly — and `move`, the dispatch by medium and word. The
 * Lab's rule (Joshua's brief, §3: the AI and the player "must not be two
 * separate movement systems") put ONE integrator under both, and that
 * integrator, with the rules it obeys, is `demand.ts`: `demandOf` says
 * what the brain wants in the one movement shape (`input/Intent.ts`)
 * and `applyDemand` is the one place a body is moved. What is left here
 * is the shape the brain, the simulation and the tests call:
 *
 *   move(state, species, world, dt)   the body, by its own medium and word
 *   walk / burrow / fly               the same, with the way of moving named
 *
 * each of which is exactly `applyDemand(demandOf())`. THE AI MOVES AS
 * IT DID: `tests/creatureDemand.test.ts` holds this path to a verbatim
 * copy of the old legs for ten minutes of each medium, and the old
 * tests of this file pass unchanged.
 *
 * WHY THE RULES LEFT. `floorAt`, `paceOf`, `arrived`, the airborne and
 * moving words, the drop rate and the pitch used to be defined here;
 * the integrator has to read them and this file has to call the
 * integrator, and a module cycle between the legs and the demand was
 * the only other way to keep them. They are re-exported below under
 * their old names, so every import of a rule from the legs still holds
 * (`intent.ts`, the renderer through `index.ts`, the tests).
 *
 * Nothing here decides anything: `intent.ts` chose the target, the
 * height and the word; the demand obeys them, every frame, while the
 * brain speaks every `thinkS`.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { applyDemand, demandOf } from './demand';
import type { CreatureSpecies } from './species';
import type { CreatureState } from './state';
import type { CreatureWorld } from './world';

export {
  ARRIVE_LENGTHS, DROP_MM_S, arrived, floorAt, isAirborne, isMoving, isSprinting, locomotionOf, paceOf, pitchOf,
} from './demand';
export type { Locomotion } from './demand';

/**
 * WALK: on the ground, or along a plant. A ground creature's height is
 * the ground's. A plant creature's is eased toward its chosen perch
 * height (its `targetHeight`, never below the ground) at its own pace —
 * an aphid climbs a stem as fast as it walks along one.
 */
export function walk(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  return applyDemand(state, species, world, demandOf(state, species, world, dt, 'walk'), dt, 'walk');
}

/**
 * BURROW: on the plane like a walk, and in height held to the band under
 * the surface — from `underMm` below the ground up to half a bore below
 * it, so the tube it leaves never breaks the surface. `surface` and
 * `feed` ease it up to the ground and no higher; `flee` sends it to the
 * bottom of the band. A species with no burrow spec walks.
 */
export function burrow(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  return applyDemand(state, species, world, demandOf(state, species, world, dt, 'burrow'), dt, 'burrow');
}

/**
 * FLY: the airborne words. Cruise toward the target on the plane; ease
 * the height toward the chosen one at the climb rate, kept inside the
 * cruise band over the FLOOR under it and never past the ceiling;
 * landing descends onto the floor. Hovering holds. A species with no
 * flight spec walks.
 */
export function fly(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  return applyDemand(state, species, world, demandOf(state, species, world, dt, 'fly'), dt, 'fly');
}

/**
 * One frame of movement for any creature, by its medium and its word.
 * Returns the distance moved on the plane — what the burrow gate's
 * cadence is counted in.
 */
export function move(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, dt: number): number {
  return applyDemand(state, species, world, demandOf(state, species, world, dt), dt);
}
