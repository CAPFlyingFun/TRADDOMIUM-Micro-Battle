/**
 * WHAT A CREATURE IS, at rest between frames: one plain object per
 * animal, world coordinates, no three.
 *
 * Shared by the simulation (which is the only thing that writes it), the
 * renderer (which reads it every frame and never writes), a HUD (which
 * counts it) and, later, a server (which will own it: "creature state
 * should be able to be owned by the server later" — so nothing here is a
 * closure, a class with methods, or a reference into a renderer; it
 * serialises as it stands).
 *
 * A CREATURE CARRIES ITS OWN SIZE (Joshua, 2026-09-08, on the earthworm:
 * "it should be based on size and dynamic"). Before this, every one of
 * the forty worms in a forest was exactly the 150 mm the table cites and
 * they all moved at exactly the same millimetres a second, because the
 * pace was an absolute number and there was nowhere to put an
 * individual's size. `lengthMm` is that place: the population draws one
 * per animal from the species' range, and every pace and every
 * body-length measure is multiplied by `sizeRatio(state, species)`.
 *
 * THE BEHAVIOUR UNION IS THE WHOLE VOCABULARY. TCS's brain had eight
 * states and its lesson is on the union: "the temptation to add a state
 * per species is how an FSM becomes an if-ladder". Three media need
 * three more words than land does — a worm burrows and surfaces, a fly
 * takes off, flies, hovers and lands — and the fourth medium, the
 * ground an ant walks, adds two: `defend` (turn to face a threat and
 * hold) and `attack` (close on it at the burst). That is the list. Which
 * words a species may use is a property of its MEDIUM
 * (`BEHAVIOURS_BY_MEDIUM`), plus the air words for a ground species
 * that carries a flight spec (`behaviourAllowedFor`), so a worm can
 * never be told to fly, a worker cannot either, and an intent that tries
 * is a bug the test catches, not a state the game has. What is NOT here,
 * on purpose: `climb`. Surface traversal — a wall, an underside — is a
 * later phase of the Lab (Joshua's brief, §14), and a word with no body
 * rule behind it would be an unbuilt ability that looks built.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { WorldPoint } from '../world/coords';
import { CREATURE_SPECIES, type CreatureId, type CreatureSpecies, type Medium } from './species';
import { WORLD_UP, type Vec3 } from './surface';

export type Behaviour =
  | 'idle'     // standing, sitting, hanging on a stem
  | 'wander'   // going somewhere for no reason: the default
  | 'feed'     // at a resource or on a host, eating
  | 'rest'     // recovering fatigue; looks like idle, lasts longer
  | 'flee'     // moving away from a disturbance at the flee pace (a fly's flee is a takeoff)
  | 'burrow'   // soil: moving in the band under the surface
  | 'surface'  // soil: coming up and lying on the ground
  | 'takeoff'  // air: leaving a perch
  | 'fly'      // air: cruising toward a target
  | 'hover'    // air: holding over a spot before landing
  | 'land'     // air: descending onto the ground or a plant
  | 'defend'   // ground: facing a threat and holding — a stand, not a charge
  | 'attack';  // ground: closing on a target at the burst pace; only ever chosen where the Lab's predation option allows

export const BEHAVIOURS: readonly Behaviour[] = Object.freeze([
  'idle', 'wander', 'feed', 'rest', 'flee', 'burrow', 'surface', 'takeoff', 'fly', 'hover', 'land', 'defend', 'attack',
]);

/** The words a medium allows. A species uses no behaviour outside its medium's list (plus `AIR_WORDS` when it flies). */
const SOIL_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee', 'burrow', 'surface']);
const PLANT_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee']);
const AIR_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee', 'takeoff', 'fly', 'hover', 'land']);
const GROUND_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee', 'defend', 'attack']);

export const BEHAVIOURS_BY_MEDIUM: Readonly<Record<Medium, readonly Behaviour[]>> = Object.freeze({
  soil: SOIL_BEHAVIOURS,
  plant: PLANT_BEHAVIOURS,
  air: AIR_BEHAVIOURS,
  ground: GROUND_BEHAVIOURS,
});

/** The words a body uses only with wings: what a flight spec adds to a ground species' list. */
export const AIR_WORDS: readonly Behaviour[] = Object.freeze(['takeoff', 'fly', 'hover', 'land']);

/** Whether a MEDIUM allows a word. A species' own answer is `behaviourAllowedFor`, which knows about wings. */
export function behaviourAllowed(medium: Medium, behaviour: Behaviour): boolean {
  return BEHAVIOURS_BY_MEDIUM[medium].includes(behaviour);
}

/**
 * Whether THIS species may use a word: its medium's list, and the air
 * words when it carries a flight spec — the winged queen flies, the
 * worker does not, and the table's validator is what keeps a flight spec
 * off a soil or plant species. The brain throws on any other word.
 */
export function behaviourAllowedFor(species: CreatureSpecies, behaviour: Behaviour): boolean {
  if (behaviourAllowed(species.medium, behaviour)) return true;
  return species.flight !== null && AIR_WORDS.includes(behaviour);
}

/** Behaviours in which the body is off the ground and in the air. A renderer reads this; it never reads a mode enum. */
export const AIRBORNE: readonly Behaviour[] = Object.freeze(['takeoff', 'fly', 'hover', 'land']);

/**
 * How much of the simulation a creature gets, by distance from the focus
 * (`species.population.nearM` / `fullM`):
 *
 *   far   a resident. It exists, it counts, it is drawn as an impostor if
 *         at all; it does not think or move.
 *   near  thinks every `thinkS` and moves at the near rate.
 *   full  thinks every `thinkS` and moves every frame.
 */
export type Tier = 'far' | 'near' | 'full';

export const TIERS: readonly Tier[] = Object.freeze(['far', 'near', 'full']);

export interface CreatureState {
  /** `species:cx,cz:n` — stable for the same world, the way a tree's id is. */
  readonly id: string;
  readonly species: CreatureId;
  /**
   * This individual's body length, mm. Its species' cited length is the
   * REFERENCE, not the rule: the pace, the arrive radius and every other
   * distance measured in bodies are scaled by the ratio of the two
   * (`sizeRatio`, in `species.ts`). Set once, by the draw that made it;
   * a body does not change length while it is alive.
   */
  readonly lengthMm: number;
  /** The 16 m cell it was generated in (`world/objects/cells.ts` key). It may have walked out of it. */
  readonly cellKey: string;
  /** Where it is, on the plane. Replaced, never mutated in place (`coords.translate`). */
  at: WorldPoint;
  /** The body's reference point above mean sea level, world units: under the ground for a burrowed worm, above it for a fly. */
  height: number;
  /**
   * Actor convention: ahead is (sin heading, cos heading) ON THE SURFACE
   * THE BODY STANDS ON — on the ground, in the air and under it, the
   * horizontal plane; on a wall or a ceiling, that face, the heading
   * carried onto it by the one rule in `surface.ts` (`aheadOn`).
   * Radians, wrapped into (−π, π].
   */
  heading: number;
  /**
   * WHICH WAY THE FEET POINT: the unit normal of the surface the body
   * stands on. `WORLD_UP` on the ground, in the air, under the soil and
   * on a stem — everywhere it used to be implied, so nothing that ran
   * before surfaces existed reads a different number — and a wall's or
   * a ceiling's normal while a climber is on one (Joshua's brief, §14;
   * Creature Lab D). Replaced, never mutated in place, as `at` is; a
   * plain triple, so it serialises as it stands.
   */
  up: Vec3;
  /** Climb angle, radians: up is positive. A worm nosing up to the surface, a fly climbing. */
  pitch: number;
  behaviour: Behaviour;
  /** Seconds in the current behaviour. */
  behaviourS: number;
  /** How long the current behaviour was chosen to last, seconds; the brain thinks again when it runs out. */
  behaviourUntilS: number;
  /** Seconds since the last decision — see `species.thinkS`. */
  sinceThink: number;
  /** Where it is going, if anywhere, and how high. */
  target: WorldPoint | null;
  targetHeight: number;
  /** 0..1 each. Needs climb; feeding and resting bring them down; alarm decays. */
  hunger: number;
  fatigue: number;
  alarm: number;
  /**
   * How far the nearest edge of fresh water was when the flood watch was
   * last set, WORLD UNITS on the plane, or -1 for "none within reach"
   * (`FLOOD_THREAT` in `intent.ts`). The flood sense re-measures from the
   * same spot and reads the difference: an edge that is a solver cell
   * nearer than it was is water coming this way. A plain number and not
   * a point, so it serialises as it stands and a save from a phone means
   * the same thing on a server; -1 rather than null for the same reason,
   * and because -1 can never be a distance.
   */
  waterEdge: number;
  /**
   * WHERE `waterEdge` was measured from, or null exactly when `waterEdge`
   * is -1. The sense re-measures from THIS point and not from the
   * creature's current one, because a distance that shrank cannot say
   * who moved: a fly flying to a water-edge site to drink would read the
   * edge as closing at every think and spook itself forever. Measured
   * from where the watch was set, the edge only reads closer when the
   * WATER came. A plain world point, the way `at` is — the creature's
   * own `at` at the time, which is replaced and never mutated, so it can
   * be held rather than copied — so it serialises as `at` does.
   */
  waterEdgeFrom: WorldPoint | null;
  /** The plant or resource site it is on or heading for (`tree:cx,cz:site`, `nectar:cx,cz:site`), else null. */
  hostId: string | null;
  tier: Tier;
  /** A per-creature phase in [0, 1): where in a stride, a wingbeat or a peristaltic wave it is. GAME TUNING seed for the renderer. */
  readonly phase: number;
}

export interface NewCreatureOptions {
  readonly id: string;
  readonly species: CreatureId;
  readonly cellKey: string;
  readonly at: WorldPoint;
  readonly height: number;
  readonly heading: number;
  /** Unit normal of the surface at the spawn point; omitted for ground-up. */
  readonly up?: Vec3;
  /** This individual's body length, mm. Omitted: the species' cited length, which is the animal the table describes. */
  readonly lengthMm?: number;
  /** Where in the think cycle it starts, 0..1, so a cell's creatures do not all think on the same frame. */
  readonly phase: number;
  readonly behaviour?: Behaviour;
  readonly hostId?: string | null;
  /** Starting needs, 0..1, so a population does not all get hungry together. */
  readonly hunger?: number;
  readonly fatigue?: number;
}

/**
 * A creature at rest at its spawn: idle, nothing targeted, needs as
 * given, tier far until the simulation places it.
 *
 * A length that is not offered is the species' cited one, so a creature
 * built by hand — a test, a probe, a save written before individuals had
 * sizes — is the animal the table describes and moves at the table's
 * pace, which is what every caller that predates the draw expects.
 */
export function newCreature(options: NewCreatureOptions): CreatureState {
  const cited = CREATURE_SPECIES[options.species].lengthMm;
  const wanted = options.lengthMm ?? cited;
  return {
    id: options.id,
    species: options.species,
    lengthMm: Number.isFinite(wanted) && wanted > 0 ? wanted : cited,
    cellKey: options.cellKey,
    at: options.at,
    height: options.height,
    heading: options.heading,
    up: options.up === undefined ? WORLD_UP : {
      x: options.up.x,
      y: options.up.y,
      z: options.up.z,
    },
    pitch: 0,
    behaviour: options.behaviour ?? 'idle',
    behaviourS: 0,
    behaviourUntilS: 0,
    sinceThink: 0,
    target: null,
    targetHeight: options.height,
    hunger: clamp01(options.hunger ?? 0),
    fatigue: clamp01(options.fatigue ?? 0),
    alarm: 0,
    waterEdge: -1,
    waterEdgeFrom: null,
    hostId: options.hostId ?? null,
    tier: 'far',
    phase: options.phase - Math.floor(options.phase),
  };
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
