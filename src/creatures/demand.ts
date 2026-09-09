/**
 * THE DEMAND IS THE INTENT, AND THERE IS ONE INTEGRATOR.
 *
 * Joshua's Creature Lab brief, §3 and §42: "AI and the PLAYER must not
 * be two separate movement systems … PLAYER decides WHAT the creature
 * wants to do. AI decides WHAT the creature wants to do. The SAME
 * locomotion code decides HOW its body accomplishes it." This file is
 * both halves of that sentence for the animals:
 *
 *   demandOf(state, species, world, dt)            → Intent       the AI's half
 *   applyDemand(state, species, world, intent, dt) → units moved  the body's half
 *
 * `demandOf` reads the target and the word the brain wrote (`intent.ts`)
 * and says it in the ONE movement shape every actor in the game speaks
 * (`input/Intent.ts`): turn toward the target at the species' turn
 * rate, saturating at ±1; forward while the word has a pace and the
 * target is not reached; sprint when fleeing or attacking; a vertical
 * toward the height the medium wants; primary while feeding. A
 * possessing player's thumbs produce the same shape from a stick
 * (Joshua's brief, §19-§22), and the session's control ledger
 * (`control.ts`) says whose intent the body gets — so there is never a
 * second request for the AI to fight (§5). `applyDemand` is the ONE
 * place a creature's body is moved: it turns the heading by the
 * request, steps on the plane at the medium's pace (a flee pace when
 * sprinting), and settles the height by the medium's rule — a walker
 * stands on the ground, a burrower is held in its band, a flier is
 * kept above the floor and under its ceiling — with the vertical
 * request steering inside that band. `locomotion.ts` is the AI's door
 * to this file: `move` is `applyDemand(demandOf())`, and `walk`,
 * `burrow` and `fly` are the same with the way of moving named.
 *
 * THE AI DID NOT MOVE DIFFERENTLY. Every rule the old legs applied is
 * here with its arithmetic in the old order, and
 * `tests/creatureDemand.test.ts` runs a verbatim copy of the old
 * integrators beside this path for ten minutes of a walker, a burrower
 * and a flier and holds the two to a millionth of a unit. One thing
 * had to be arranged for that to be true: the old legs settled the
 * height AFTER the plane step, against the ground or the floor under
 * where the body LANDED — a burrower follows the contour that way, and
 * a fly crossing a bank has the floor step up under it. A demand is
 * decided before the body moves, so `demandOf` previews the plane step
 * with the SAME function the body uses (`planeStep`) and measures its
 * vertical against the height the medium wants THERE. The two places
 * the arithmetic could not be identical to the bit are named on the
 * code: a turn that reaches its bearing is `heading + (gap / maxTurn)
 * × maxTurn` rather than the bearing itself, and a vertical that reaches
 * its height is `height + (gap / step) × step` rather than the height —
 * an ulp either way, corrected the next frame because both are
 * re-aimed from the target every frame, and never a decision, because
 * the brain's thresholds are body lengths and seconds, not ulps.
 *
 * THE RULES THE LEGS USED TO HOLD live here now: the pace of a word
 * (`paceOf`), the floor a flier measures from (`floorAt`), the arrive
 * radius (`arrived`), the airborne and moving words, the drop rate, the
 * pitch. They moved from `locomotion.ts` on the day the player arrived
 * because the one integrator has to see them and the legs have to see
 * the integrator, and a cycle between the two files was the only other
 * shape; every name is still exported from `locomotion.ts`, so nothing
 * that imported a rule from the legs changed.
 *
 * WHAT A PLAYER GETS THAT THE AI DOES NOT ASK FOR. A fractional forward
 * is a fraction of the pace. A strafe sidesteps a body that has sides
 * (a walker, a flier); a worm has none and ignores it. A reverse walks
 * backward. The arrive rule — never past the target — applies only when
 * the request is a plain forward toward a target the state holds: a
 * target is a leash the brain set, and a controller that sidesteps or
 * reverses is not going to it. A target the player's controller does
 * not want is a target it clears. `vertical` climbs a stem, burrows and
 * surfaces inside the band the WORD allows (a soil body's band is set by
 * its word: `surface` and `feed` open the top of it to the ground, the
 * rest hold it under — a controller that wants the worm up says so with
 * the word, and the intent steers within it), and climbs or descends a
 * flier between the floor and its ceiling. `primary` and `secondary` are
 * not read here at all: they are the species' to interpret, and a body
 * does not move on a toggle.
 *
 * WHERE THE SPECIES INTERPRETS THEM (the Lab's possession, 2026-09-09).
 * Two helpers at the foot of this file are the player's half of the
 * sentence in the header, beside the AI's `demandOf`:
 *
 *   playerDemand(state, species, intent, world, out) → Intent   the toggles read
 *   wordFor(state, species, intent, world)           → Behaviour the word for it
 *
 * `playerDemand` folds the toggles that ARE movement into the axes — a
 * plant body's `secondary` is a drop, a winged body's aloft is a
 * descent — and `wordFor` derives the behaviour WORD a possessed body
 * is in from the request and where it stands, so a renderer that
 * animates by the word sees a walking ant walk and the needs tick as
 * they do for the AI. Neither moves anything: the body is still moved
 * by `applyDemand`, once, whoever asked.
 *
 * THE FLOOR A FLIER MEASURES FROM IS THE SURFACE UNDER IT (Joshua,
 * 2026-09-08, from the beach with the finder on: "it looks like the
 * flies are underwater still... do they have a ceiling on the fly that's
 * not making it fly above the water?"). `groundAt` is the heightfield,
 * and under the sea the heightfield is the SEABED; under a pond it is the
 * bed. A fly whose band was the bed plus twelve to sixty centimetres was
 * therefore held two metres under the sea off every beach, and the
 * ceiling that was meant to stop it climbing was what pinned it there.
 * `floorAt` is the one answer: the ground, or the water's surface where
 * water stands on it. Only the AIR reads it — a walker stands on the
 * ground, a burrower lives under it, and an aphid is not a boat.
 *
 * TURNING IS A RATE, NOT AN EASE. The donor worm's first cut eased its
 * heading by half the gap a second, which is fastest when the gap is
 * widest — a turning radius of four millimetres inside a six-millimetre
 * tube, and half its bones drawn through the wall of its own burrow.
 * `pace.turnRadS` is a hard angular limit and the turn radius is
 * pace over rate, which the species table can reason about. THE TURN
 * RATE IS THE SPECIES', deliberately: the pace scales with the body
 * because the measured law is a fraction of the body a second; there is
 * no such law for turning, and multiplying by the ratio would say a long
 * worm turns FASTER, which is the wrong way round. What a big worm gets
 * is the wider turning circle its speed implies.
 *
 * A PACE IS THE INDIVIDUAL'S, NOT THE SPECIES' (Joshua, 2026-09-08: the
 * earthworm "should be based on size and dynamic"). Every pace this file
 * reads out of the table is multiplied by `paceRatio(state, species)` —
 * the length ratio raised to the species' `paceExponent`, 1 for the
 * worm and 0.75 for an ant — and every distance measured in body lengths
 * by `sizeRatio`, the length ratio itself. The one rate here that does
 * NOT scale is the fall (`DROP_MM_S`): a body let go of a stem is
 * gravity's, not its own. A flight does not scale either: a hop is the
 * wing's, and the wing is not in the table's length.
 *
 * NEVER NaN. A `dt` that is not a positive finite number moves nothing;
 * a ground the world cannot price (non-finite) leaves the height alone;
 * an intent is clamped axis by axis before it is read; a vertical step
 * that is not a positive number moves the height not at all; and every
 * write is clamped before it lands. A creature that cannot be drawn is
 * worse than one that stands still.
 *
 * ALLOCATION. `demandOf` returns a fresh Intent and, when the body will
 * move, one preview point; `applyDemand` allocates the point the body
 * lands on and nothing else. Three small objects per moving creature
 * per frame against the one the old legs made — the same order of cost,
 * and no closures, no arrays, no per-creature objects that outlive the
 * frame.
 *
 * Pure: no three, no DOM. `src/creatures/` is core. It imports
 * `input/Intent.ts` — the one pure file in input/, the shape actor/ and
 * net/ already reach for — and nothing else of input/.
 */
import { clampAxis, NEUTRAL_INTENT, type Intent } from '../input/Intent';
import { distance, distanceSquared, translate, type WorldPoint } from '../world/coords';
import type { PlantSource, ResourceKind } from '../world/ecology/resources';
import { SEA_LEVEL } from '../world/heightfield';
import { CELL_SPAN } from '../world/objects/cells';
import { ahead, headingToward, wrapHeading } from './heading';
import { paceRatio, sizeRatio, unitsOfMm, type CreatureSpecies } from './species';
import { behaviourAllowedFor, type Behaviour, type CreatureState } from './state';
import type { CreatureWorld } from './world';

// ---------------------------------------------------------------------------
// The rules: what a word and a medium mean for a body
// ---------------------------------------------------------------------------

/** Near enough to its target that it is THERE, as a fraction of a body length. GAME TUNING. */
export const ARRIVE_LENGTHS = 0.25;
/**
 * How fast a plant creature DROPS when it flees downward, mm/s. A drop is
 * a fall, not a climb: an aphid lets go of the stem. BIOLOGICAL SHAPE — a
 * small insect falls through air at about a metre a second; the exact
 * figure does not matter at nine centimetres.
 */
export const DROP_MM_S = 1000;

/** The three ways a body moves, one per medium — the ground's is the walk, and a winged ground body flies when it is up. */
export type Locomotion = 'walk' | 'burrow' | 'fly';

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

/** The words in which a body is going somewhere — what tires it. A `defend` is a stand and does not. */
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
    case 'attack':
      return true;
    default:
      return false;
  }
}

/** Whether a word asks for the burst: a flee, or an attack, which is a flee pointed the other way. */
export function isSprinting(behaviour: Behaviour): boolean {
  return behaviour === 'flee' || behaviour === 'attack';
}

/**
 * The pace on the plane for a grounded behaviour, world units a second,
 * for THIS individual: the table's pace times its pace ratio. Feeding
 * moves only to reach the food it was sent to; idling, resting,
 * defending, surfacing and hovering do not move at all — an animal that
 * drifts while it eats looks like it is skating.
 */
export function paceOf(state: CreatureState, species: CreatureSpecies): number {
  const ratio = paceRatio(state, species);
  switch (state.behaviour) {
    case 'flee':
    case 'attack':
      return ratio * unitsOfMm(species.pace.fleeMmS);
    case 'wander':
      return ratio * unitsOfMm(species.pace.wanderMmS);
    case 'burrow':
      // Digging: the crawl over the dig discount (`digFactor`). The word is the whole distinction.
      return digFactor(state, species, 'burrow') * ratio * unitsOfMm(species.pace.wanderMmS);
    case 'feed':
      return state.target === null ? 0 : ratio * unitsOfMm(species.pace.wanderMmS);
    default:
      return 0;
  }
}

/**
 * Which way of moving a body is in now: under the ground for a soil
 * species; in the air for a winged one whose word is airborne; on the
 * ground otherwise. The dispatch the old `move` made, named so a caller
 * that wants one medium's rule can ask for it.
 */
export function locomotionOf(state: CreatureState, species: CreatureSpecies): Locomotion {
  if (species.medium === 'soil') return 'burrow';
  if (species.flight !== null && isAirborne(state.behaviour)) return 'fly';
  return 'walk';
}

/**
 * THE FLOOR under a point: what a flier stands on, hovers over and is
 * kept above — the ground, or the water's surface where water stands on
 * the ground.
 *
 *   - Over the SEA it is mean sea level (`SEA_LEVEL`), or the ground
 *     where the ground is higher — a beach the query calls sea because a
 *     swell reaches over it is still a beach. The swell itself is the
 *     renderer's: core knows the mean surface and not the wave on it, so
 *     a fly a hand over the mean surface is the honest answer core can
 *     give, and the cruise band (twelve centimetres and up) is more than
 *     a hand.
 *   - Over FRESH water it is the ground plus the water's depth over it,
 *     which is the pond's surface.
 *   - On dry ground it is the ground.
 *
 * The sea is asked of the water when there is one (its `isSeaAt` knows
 * the bed AND the sea owner's reach); with no water known, a bed below
 * mean sea level is the sea — the same rule the water's own query uses,
 * and on this island there is no dry ground below the line. A ground
 * the world cannot price (non-finite) is returned as it is, so a caller
 * that guards the ground guards the floor; and a depth that is not a
 * depth (NaN, negative) adds nothing, so the answer is never NaN where
 * the ground was not.
 */
export function floorAt(world: CreatureWorld, at: WorldPoint): number {
  const ground = world.groundAt(at);
  if (!Number.isFinite(ground)) return ground;
  const water = world.water;
  const sea = water !== null ? water.isSeaAt(at) : ground < SEA_LEVEL;
  if (sea) return Math.max(ground, SEA_LEVEL);
  const depth = water === null ? 0 : water.freshDepthAt(at);
  return depth > 0 ? ground + depth : ground;
}

/** This individual's body length, world units: the cited length at its own size. */
function bodyLength(state: CreatureState, species: CreatureSpecies): number {
  return sizeRatio(state, species) * unitsOfMm(species.lengthMm);
}

/** Has it reached its target, within a quarter of ITS OWN body length? True with no target. */
export function arrived(state: CreatureState, species: CreatureSpecies): boolean {
  if (state.target === null) return true;
  return distance(state.at, state.target) <= ARRIVE_LENGTHS * bodyLength(state, species);
}

/** The climb angle for a vertical change over a planar one: straight up or down when it did not move on the plane. */
export function pitchOf(dHeight: number, dPlane: number): number {
  if (dHeight === 0) return 0;
  if (dPlane <= 0) return dHeight > 0 ? Math.PI / 2 : -Math.PI / 2;
  return Math.atan2(dHeight, dPlane);
}

/** −1..1 of a ratio, with NaN as nothing: how much of a step a gap is, saturated. */
function saturate(value: number): number {
  if (!(value === value)) return 0;
  return value > 1 ? 1 : value < -1 ? -1 : value;
}

/** A way of moving the species does not have falls back to the walk, as the old legs did. */
function wayOf(species: CreatureSpecies, how: Locomotion): Locomotion {
  if (how === 'fly' && species.flight === null) return 'walk';
  if (how === 'burrow' && species.burrow === null) return 'walk';
  return how;
}

/**
 * The plane pace a way of moving uses for THIS body, world units a
 * second: the table's walk or flee by the pace ratio on the ground and
 * under it, the wing's cruise or burst in the air. The AI's `paceOf` is
 * this with the sprint read off the word, and the two agree by
 * construction: the same expression, in the same order.
 */
function planePace(state: CreatureState, species: CreatureSpecies, how: Locomotion, sprint: boolean): number {
  if (how === 'fly' && species.flight !== null) return unitsOfMm(sprint ? species.flight.burstMmS : species.flight.cruiseMmS);
  return digFactor(state, species, how) * paceRatio(state, species) * unitsOfMm(sprint ? species.pace.fleeMmS : species.pace.wanderMmS);
}

/**
 * NEW GROUND IS SLOW. A worm travelling an existing burrow, or crawling
 * on the surface, moves at its crawl; a worm DIGGING moves at the crawl
 * over the species' `burrow.digDiscount` — measured at 30-75x for
 * Lumbricus (Ruiz et al. 2015, 2017), set by the table (5, GAME TUNING,
 * the reason written beside it: a 1 m bench would otherwise show a worm
 * that never moves). The worm has no memory of its burrows yet, so the
 * WORD is the whole distinction: 'burrow' is digging, everything else in
 * the soil is travel. Every other species and every other way is 1.
 */
function digFactor(state: CreatureState, species: CreatureSpecies, how: Locomotion): number {
  if (how !== 'burrow' || species.burrow === null || state.behaviour !== 'burrow') return 1;
  const discount = species.burrow.digDiscount;
  return discount !== undefined && discount >= 1 ? 1 / discount : 1;
}

/**
 * THE TURN RATE OF A WAY: the flier's in the air (`flight.turnRadSAir` —
 * a fly's saccade, a queen's wind-steered arc), the body's own
 * everywhere else. One rule for the request's saturation and for the
 * step that honours it, so the AI's demand and the integrator agree.
 */
function turnRateOf(species: CreatureSpecies, how: Locomotion): number {
  return how === 'fly' && species.flight !== null ? species.flight.turnRadSAir : species.pace.turnRadS;
}

/**
 * THE STEP ON THE PLANE, shared by the preview and the move so the two
 * cannot differ by a bit: where a body with `heading` (already turned)
 * lands after `step` units of pace along `forward` and across `strafe`.
 * Returns the point itself when it does not move, the TARGET itself
 * when the arrive rule snaps to it — close enough to take the last step
 * straight, rather than orbit a target inside its own turning circle —
 * and a fresh point otherwise. The request is a direction on the unit
 * disc, not the unit square (the capsule's rule): full-ahead-and-full-
 * strafe is one pace, not 1.41 of them.
 */
function planeStep(
  state: CreatureState, species: CreatureSpecies, heading: number, forward: number, strafe: number, step: number,
): WorldPoint {
  const at = state.at;
  if (!(step > 0) || (forward === 0 && strafe === 0)) return at;
  const magnitude = Math.hypot(forward, strafe);
  if (magnitude > 1) {
    forward /= magnitude;
    strafe /= magnitude;
  }
  const target = state.target;
  if (target !== null && strafe === 0 && forward > 0 && Number.isFinite(target.wx) && Number.isFinite(target.wz)) {
    const remaining = distance(at, target);
    const arriveWithin = Math.max(forward * step, ARRIVE_LENGTHS * bodyLength(state, species));
    if (remaining <= arriveWithin) return target;
  }
  if (strafe === 0) return ahead(at, heading, forward * step);
  // v0's convention, the capsule's: ahead is (sin h, cos h); right is a quarter turn clockwise from it.
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return translate(at, (forward * sin + strafe * cos) * step, (forward * cos - strafe * sin) * step);
}

/**
 * How far a body's height may move this frame, world units, by the way
 * it is moving and the direction it is going: a plant climbs at its own
 * pace and DROPS at gravity's when it flees downward; a burrower rises
 * and sinks at its own pace; a flier climbs and descends at the wing's
 * climb rate; a walker's height is the ground's and has no step. Used
 * by both halves, so a demand's saturation and the body's step are the
 * same number.
 */
function verticalStep(state: CreatureState, species: CreatureSpecies, how: Locomotion, down: boolean, dt: number): number {
  const fleeing = state.behaviour === 'flee';
  if (how === 'fly' && species.flight !== null) return unitsOfMm(species.flight.climbMmS) * dt;
  if (how === 'burrow' && species.burrow !== null) {
    return paceRatio(state, species) * unitsOfMm(fleeing ? species.pace.fleeMmS : species.pace.wanderMmS) * dt;
  }
  if (species.medium === 'plant') {
    const mmS = fleeing && down ? DROP_MM_S : paceRatio(state, species) * (fleeing ? species.pace.fleeMmS : species.pace.wanderMmS);
    return unitsOfMm(mmS) * dt;
  }
  return 0;
}

/**
 * The height the medium's rule WANTS for this word at `at`, or NaN for
 * a rule that leaves the height alone (a ground the world cannot price,
 * or a walker whose height is simply the ground's and has no wish about
 * it). The brain chose `targetHeight`; this is what the medium makes of
 * it where the body stands — the band under a slope, the floor over a
 * pond, the stem over the ground.
 */
function wantedHeight(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, how: Locomotion, at: WorldPoint): number {
  if (how === 'fly' && species.flight !== null) {
    const spec = species.flight;
    const floor = floorAt(world, at);
    if (!Number.isFinite(floor)) return NaN;
    const ceiling = floor + unitsOfMm(spec.ceilingMm);
    const lo = Math.min(ceiling, floor + unitsOfMm(spec.cruiseMm[0]));
    const hi = Math.min(ceiling, floor + unitsOfMm(spec.cruiseMm[1]));
    if (state.behaviour === 'land') return floor;
    return Number.isFinite(state.targetHeight) ? Math.min(hi, Math.max(lo, state.targetHeight)) : lo;
  }
  if (how === 'burrow' && species.burrow !== null) {
    const spec = species.burrow;
    const ground = world.groundAt(at);
    if (!Number.isFinite(ground)) return NaN;
    const bottom = ground - unitsOfMm(spec.underMm);
    const top = ground - unitsOfMm(spec.boreMm) / 2;
    if (state.behaviour === 'surface' || state.behaviour === 'feed') return ground;
    if (state.behaviour === 'flee') return bottom;
    return Number.isFinite(state.targetHeight) ? Math.min(top, Math.max(bottom, state.targetHeight)) : (top + bottom) / 2;
  }
  if (species.medium === 'plant') {
    const ground = world.groundAt(at);
    if (!Number.isFinite(ground)) return NaN;
    return Number.isFinite(state.targetHeight) ? Math.max(ground, state.targetHeight) : ground;
  }
  return NaN;
}

// ---------------------------------------------------------------------------
// The AI's half
// ---------------------------------------------------------------------------

/**
 * WHAT THE BRAIN WANTS, as an Intent: the target and the word the brain
 * wrote, turned into the one movement shape. `how` names the way of
 * moving the demand is for; it defaults to the body's own, and the legs
 * pass it when a caller asked for one medium's rule by name.
 *
 * Turn: toward the target's bearing, as much of the turn rate as the gap
 * needs, saturating at ±1 — exactly the hard angular limit the old legs
 * applied. No target: no turn, the heading is held. A target that is not
 * a number: nothing at all, as before. Forward: 1 while the word has a
 * pace and there is somewhere to go (a moving word with no target goes
 * where it is pointed; one standing on its target does not move).
 * Sprint: fleeing or attacking. Vertical: the fraction of this frame's
 * vertical step that closes the gap to the height the medium wants
 * where the body will land, saturated. Primary: feeding. Secondary:
 * never, from this brain.
 */
export function demandOf(
  state: CreatureState,
  species: CreatureSpecies,
  world: CreatureWorld,
  dt: number,
  how: Locomotion = locomotionOf(state, species),
): Intent {
  if (!(dt > 0) || !Number.isFinite(dt)) return NEUTRAL_INTENT;
  const way = wayOf(species, how);
  const sprint = isSprinting(state.behaviour);
  const pace = way === 'fly'
    ? (state.behaviour === 'hover' ? 0 : planePace(state, species, way, sprint))
    : paceOf(state, species);

  let turn = 0;
  let forward = 0;
  const target = state.target;
  if (target === null) {
    forward = pace > 0 ? 1 : 0;
  } else if (Number.isFinite(target.wx) && Number.isFinite(target.wz)) {
    const maxTurn = turnRateOf(species, way) * dt;
    turn = saturate(wrapHeading(headingToward(state.at, target) - state.heading) / maxTurn);
    forward = pace > 0 && distance(state.at, target) > 0 ? 1 : 0;
  }

  // The vertical is measured where the body will LAND (the header): the
  // same turn and the same step the body's half is about to take.
  let vertical = 0;
  const heading = turn !== 0 ? wrapHeading(state.heading + turn * turnRateOf(species, way) * dt) : state.heading;
  const landing = forward > 0 ? planeStep(state, species, heading, forward, 0, pace * dt) : state.at;
  const wanted = wantedHeight(state, species, world, way, landing);
  if (Number.isFinite(wanted)) {
    const gap = wanted - state.height;
    if (gap !== 0) vertical = saturate(gap / verticalStep(state, species, way, gap < 0, dt));
  }

  return {
    forward, strafe: 0, turn, sprint, vertical,
    primary: state.behaviour === 'feed',
    secondary: false,
  };
}

// ---------------------------------------------------------------------------
// The body's half
// ---------------------------------------------------------------------------

/**
 * MOVE THE BODY BY A REQUEST — the one place a creature's `at`, `height`,
 * `heading` and `pitch` are written by movement. Returns the distance
 * moved on the plane, world units, which is what the burrow gate's
 * cadence is counted in.
 *
 * In order: the heading turns by `turn × turnRadS × dt`; the body steps
 * on the plane by the pace of its way of moving (`planeStep`); then the
 * height settles by the medium's rule with `vertical` steering it: a
 * walker to the ground, a plant body up or down its stem and never
 * below the ground, a burrower inside its word's band, a flier between
 * the floor and its ceiling. The pitch is the climb angle of what just
 * happened. `primary` and `secondary` are not read: a body does not move
 * on a toggle.
 */
export function applyDemand(
  state: CreatureState,
  species: CreatureSpecies,
  world: CreatureWorld,
  intent: Intent,
  dt: number,
  how: Locomotion = locomotionOf(state, species),
): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return 0;
  const way = wayOf(species, how);
  // Bound the request axis by axis, without building a second object. A worm has no sides.
  const turn = clampAxis(intent.turn);
  const forward = clampAxis(intent.forward);
  const strafe = way === 'burrow' ? 0 : clampAxis(intent.strafe);
  const vertical = clampAxis(intent.vertical);
  const sprint = intent.sprint === true;

  // THE TURN, a rate and not an ease (the header).
  if (turn !== 0) state.heading = wrapHeading(state.heading + turn * turnRateOf(species, way) * dt);

  // THE STEP ON THE PLANE.
  let moved = 0;
  if (forward !== 0 || strafe !== 0) {
    const step = planePace(state, species, way, sprint) * dt;
    const before = state.at;
    const after = planeStep(state, species, state.heading, forward, strafe, step);
    if (after !== before) {
      // Straight ahead the step IS the distance; a snap or a sidestep is measured.
      moved = strafe === 0 && after !== state.target ? Math.abs(forward * step) : distance(before, after);
      state.at = after;
    }
  }

  // THE HEIGHT, by the medium's rule where the body now stands, with the vertical steering inside it.
  const before = state.height;
  const lift = vertical !== 0 ? verticalStep(state, species, way, vertical < 0, dt) : 0;
  const risen = lift > 0 ? state.height + vertical * lift : state.height;
  if (way === 'fly' && species.flight !== null) {
    const floor = floorAt(world, state.at);
    if (Number.isFinite(floor)) state.height = Math.min(floor + unitsOfMm(species.flight.ceilingMm), Math.max(floor, risen));
  } else if (way === 'burrow' && species.burrow !== null) {
    const spec = species.burrow;
    const ground = world.groundAt(state.at);
    if (Number.isFinite(ground)) {
      // The band is re-read where it stands every frame, so a worm
      // travelling level under a slope has the ground come down to meet
      // it and is held under, following the contour, rather than left
      // standing in the air — the donor's measured bug. `underMm` and
      // `boreMm` are the SPECIES': where in the soil this KIND of animal
      // lives; how fast it gets through the band is its own. The words
      // `surface` and `feed` open the top of the band to the ground; the
      // rest hold the body under, so the tube it leaves never breaks the
      // surface.
      const bottom = ground - unitsOfMm(spec.underMm);
      const top = ground - unitsOfMm(spec.boreMm) / 2;
      const up = state.behaviour === 'surface' || state.behaviour === 'feed';
      state.height = up ? Math.min(ground, risen) : Math.min(top, Math.max(bottom, risen));
    }
  } else {
    const ground = world.groundAt(state.at);
    if (Number.isFinite(ground)) {
      // A plant body is eased up and down its stem and never below the
      // ground; down in a flee is a DROP at gravity's rate (`verticalStep`).
      // A ground body's height is the ground's, whatever the request.
      state.height = species.medium === 'plant' ? Math.max(ground, risen) : ground;
    }
  }
  state.pitch = pitchOf(state.height - before, moved);
  return moved;
}

// ---------------------------------------------------------------------------
// The player's half: what the species reads into a demand, and the word for it
// ---------------------------------------------------------------------------

/**
 * A demand a caller may write into — the seven fields, none optional and
 * none readonly — so `playerDemand` can fill one the caller keeps and a
 * frame allocates nothing. Assignable to `Intent`.
 */
export interface MutableIntent {
  forward: number;
  strafe: number;
  turn: number;
  sprint: boolean;
  vertical: number;
  primary: boolean;
  secondary: boolean;
}

/** A neutral demand to write into: what a simulation makes once and keeps. */
export function newMutableIntent(): MutableIntent {
  return { forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 0, primary: false, secondary: false };
}

/** Above the ground by more than this, a winged body is in the air, world units: a float's noise, not a height. */
const AIRBORNE_EPSILON = 1e-9;

/**
 * Is a winged body standing on the ground? It reads the GROUND and not
 * the floor: a fly held at a pond's surface by `applyDemand`'s clamp is
 * over the water and stays in the air's way of moving, which is what
 * keeps it from being walked onto the bed. A ground the world cannot
 * price falls back to the word it is in.
 */
function grounded(state: CreatureState, world: CreatureWorld): boolean {
  const ground = world.groundAt(state.at);
  if (!Number.isFinite(ground)) return !isAirborne(state.behaviour);
  return state.height <= ground + AIRBORNE_EPSILON;
}

/** On its host: within the plant's own size of the plant's foot, which is as far as a stem or a leaf reaches. Nothing with no host. */
function onHost(state: CreatureState, host: PlantSource | null): boolean {
  if (host === null) return false;
  const reach = Math.max(0, host.size);
  return distanceSquared(state.at, host.at) <= reach * reach;
}

/**
 * Is a resource site of one of `kinds` within `radius` of `at`? The
 * cells the circle touches, scanned the way the brain's `nearestSite`
 * scans them — but a yes or a no, so nothing is allocated, and nothing
 * here imports the brain: the brain imports the legs and the legs
 * import this file, and a third edge would close the cycle the header
 * says this file exists to avoid.
 */
function siteWithin(world: CreatureWorld, at: WorldPoint, kinds: readonly ResourceKind[], radius: number): boolean {
  if (kinds.length === 0 || !(radius > 0)) return false;
  const cx0 = Math.floor((at.wx - radius) / CELL_SPAN);
  const cx1 = Math.floor((at.wx + radius) / CELL_SPAN);
  const cz0 = Math.floor((at.wz - radius) / CELL_SPAN);
  const cz1 = Math.floor((at.wz + radius) / CELL_SPAN);
  const r2 = radius * radius;
  for (let cz = cz0; cz <= cz1; cz += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) {
      const cell = world.resourcesOf(cx, cz);
      if (cell === null) continue;
      const sites = cell.sites;
      for (let i = 0; i < sites.length; i += 1) {
        const site = sites[i];
        if (kinds.includes(site.kind) && distanceSquared(at, site.at) <= r2) return true;
      }
    }
  }
  return false;
}

/**
 * Is there something to eat where it stands? On its host plant, or
 * within a body length of a site of a kind it eats — the "already on
 * it" the brains use when they choose `feed`, so a possessed worker
 * feeds exactly where its AI would have.
 */
function atFood(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, host: PlantSource | null): boolean {
  if (onHost(state, host)) return true;
  return siteWithin(world, state.at, species.needs.eats, bodyLength(state, species));
}

/** Still: idle, or rest when the body is tired — the fatigue bar's way back (`wordFor`). */
function restOrIdle(state: CreatureState, species: CreatureSpecies): Behaviour {
  return state.fatigue >= species.needs.restAt ? 'rest' : 'idle';
}

/**
 * THE PLAYER'S DEMAND AS THE BODY IS MOVED BY IT. `applyDemand` reads the
 * axes and not the toggles — "a body does not move on a toggle" — and
 * `input/Intent.ts` says the toggles' MEANING is the species' to decide.
 * This is where the species decides it, for the two toggles that ARE
 * movement, and for the one thing a plant body does with no request:
 *
 *   secondary, a plant body           → vertical −1: the drop. With the
 *                                       word `flee` (`wordFor`) the fall
 *                                       is at gravity's rate (`DROP_MM_S`);
 *                                       the Lab's aphid controls say
 *                                       "DROP / EVADE" (the brief, §21).
 *   secondary, a winged body aloft    → vertical −1: come down to land.
 *   no vertical, a plant body OFF its → vertical −1: there is nothing
 *   host                                under it but the ground, so it
 *                                       comes down at its own climbing
 *                                       pace. On its host it holds its
 *                                       height, as the AI's does — the
 *                                       plant is not a surface yet, and
 *                                       the height on a stem is a
 *                                       remembered one.
 *
 * Everything else is copied through, bounded axis by axis (`clampAxis`)
 * and with an absent toggle read as not held, so what comes out is a
 * complete request whatever the producer left out. Written into `out`,
 * which the caller keeps, and returned: one object a frame, and the
 * simulation keeps exactly one. `primary` is copied and never read here:
 * feeding is a word (`wordFor`), and a word is not a movement.
 */
export function playerDemand(
  state: CreatureState,
  species: CreatureSpecies,
  intent: Intent,
  world: CreatureWorld,
  out: MutableIntent,
  host: PlantSource | null = null,
): Intent {
  out.forward = clampAxis(intent.forward);
  out.strafe = clampAxis(intent.strafe);
  out.turn = clampAxis(intent.turn);
  out.sprint = intent.sprint === true;
  out.primary = intent.primary === true;
  out.secondary = intent.secondary === true;
  let vertical = clampAxis(intent.vertical);
  if (species.medium === 'plant') {
    if (out.secondary) vertical = -1;
    else if (vertical === 0 && !onHost(state, host)) vertical = -1;
  } else if (out.secondary && species.flight !== null && !grounded(state, world)) {
    vertical = -1;
  }
  out.vertical = vertical;
  return out;
}

/**
 * THE WORD FOR A DEMAND — what a possessed body is DOING, so a renderer
 * that animates by the word (`fauna/`) sees a walking ant walk and a
 * landing fly land, and so the needs tick as they do for the AI (a
 * `feed` brings hunger down, a moving word tires). The brain is not
 * driving a possessed body and writes no word; this derives one from
 * the request and where the body stands, every frame, and every word is
 * one the species may use — a demand that produced another throws here
 * as the brain throws, because a worm in the air is a bug and not a
 * state (`tests/creaturePossession.test.ts` holds it for every species at
 * every corner of the intent).
 *
 * In order, per medium — the first rule that fits is the word:
 *
 *   soil    vertical down → `burrow`; up → `surface`; primary at litter,
 *           standing → `feed`; sprint and moving → `flee`; UP AT THE
 *           SURFACE (above the band's top) → `surface`, moving or not,
 *           because `surface` and `feed` are the words that hold a soil
 *           body up (`applyDemand`) and any other would pull it back
 *           under; moving → `burrow`; still → `idle`, or `rest`.
 *   winged  aloft (above the GROUND — `grounded`): descending, or
 *           secondary → `land`; moving or climbing → `fly`; still →
 *           `hover`. On the ground: vertical up → `takeoff`; else the
 *           ground's words below.
 *   ground, primary at food, standing → `feed`; a plant body's secondary
 *   plant   → `flee` (the drop); sprint and moving → `flee`; moving —
 *           a turn in place is moving, the legs are — → `wander`; still
 *           → `idle`, or `rest`.
 *
 * REST IS THE WAY BACK. Fatigue climbs on every moving word and comes
 * down only on `rest`, and a bar may only move if there is a way to move
 * it back (CLAUDE.md): a still body whose fatigue has reached the
 * species' `restAt` rests, and reads idle again once it has not. That is
 * the one word here the request did not ask for, and the one the brief's
 * list (still → idle) does not name — flagged as such.
 *
 * Feeding needs the body STILL: a walk across the food is a walk, and a
 * renderer working the mandibles on `feed` should not be doing it at
 * walking pace. `host` is the plant a plant body sits on when the caller
 * has it (the simulation caches it); null says none, or not known.
 */
export function wordFor(
  state: CreatureState,
  species: CreatureSpecies,
  intent: Intent,
  world: CreatureWorld,
  host: PlantSource | null = null,
): Behaviour {
  const word = wordOf(state, species, intent, world, host);
  if (!behaviourAllowedFor(species, word)) {
    throw new Error(`creatures/demand: ${species.id} (${species.medium}) was asked for "${word}", which its medium does not allow`);
  }
  return word;
}

function wordOf(state: CreatureState, species: CreatureSpecies, intent: Intent, world: CreatureWorld, host: PlantSource | null): Behaviour {
  const forward = clampAxis(intent.forward);
  const strafe = clampAxis(intent.strafe);
  const turn = clampAxis(intent.turn);
  const vertical = clampAxis(intent.vertical);
  const sprint = intent.sprint === true;
  const primary = intent.primary === true;
  const secondary = intent.secondary === true;
  const moving = forward !== 0 || strafe !== 0 || turn !== 0;

  const burrow = species.burrow;
  if (species.medium === 'soil' && burrow !== null) {
    if (vertical < 0) return 'burrow';
    if (vertical > 0) return 'surface';
    if (primary && !moving && atFood(state, species, world, host)) return 'feed';
    if (sprint && moving) return 'flee';
    const ground = world.groundAt(state.at);
    if (Number.isFinite(ground) && state.height > ground - unitsOfMm(burrow.boreMm) / 2) return 'surface';
    if (moving) return 'burrow';
    return restOrIdle(state, species);
  }

  if (species.flight !== null) {
    if (!grounded(state, world)) {
      if (vertical < 0 || secondary) return 'land';
      if (moving || vertical > 0) return 'fly';
      return 'hover';
    }
    if (vertical > 0) return 'takeoff';
  }

  if (primary && !moving && atFood(state, species, world, host)) return 'feed';
  if (species.medium === 'plant' && secondary) return 'flee';
  if (sprint && moving) return 'flee';
  if (moving) return 'wander';
  return restOrIdle(state, species);
}
