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
 * THE BEHAVIOUR UNION IS THE WHOLE VOCABULARY. TCS's brain had eight
 * states and its lesson is on the union: "the temptation to add a state
 * per species is how an FSM becomes an if-ladder". Three media need
 * three more words than land does — a worm burrows and surfaces, a fly
 * takes off, flies, hovers and lands — and that is the list. Which
 * words a species may use is a property of its MEDIUM
 * (`BEHAVIOURS_BY_MEDIUM`), so a worm can never be told to fly and an
 * intent that tries is a bug the test catches, not a state the game has.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { WorldPoint } from '../world/coords';
import type { CreatureId, Medium } from './species';

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
  | 'land';    // air: descending onto the ground or a plant

export const BEHAVIOURS: readonly Behaviour[] = Object.freeze([
  'idle', 'wander', 'feed', 'rest', 'flee', 'burrow', 'surface', 'takeoff', 'fly', 'hover', 'land',
]);

/** The words a medium allows. A species uses no behaviour outside its medium's list. */
const SOIL_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee', 'burrow', 'surface']);
const PLANT_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee']);
const AIR_BEHAVIOURS: readonly Behaviour[] = Object.freeze(['idle', 'wander', 'feed', 'rest', 'flee', 'takeoff', 'fly', 'hover', 'land']);

export const BEHAVIOURS_BY_MEDIUM: Readonly<Record<Medium, readonly Behaviour[]>> = Object.freeze({
  soil: SOIL_BEHAVIOURS,
  plant: PLANT_BEHAVIOURS,
  air: AIR_BEHAVIOURS,
});

export function behaviourAllowed(medium: Medium, behaviour: Behaviour): boolean {
  return BEHAVIOURS_BY_MEDIUM[medium].includes(behaviour);
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
  /** The 16 m cell it was generated in (`world/objects/cells.ts` key). It may have walked out of it. */
  readonly cellKey: string;
  /** Where it is, on the plane. Replaced, never mutated in place (`coords.translate`). */
  at: WorldPoint;
  /** The body's reference point above mean sea level, world units: under the ground for a burrowed worm, above it for a fly. */
  height: number;
  /** Actor convention: ahead is (sin heading, cos heading). Radians, wrapped into (−π, π]. */
  heading: number;
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
  /** Where in the think cycle it starts, 0..1, so a cell's creatures do not all think on the same frame. */
  readonly phase: number;
  readonly behaviour?: Behaviour;
  readonly hostId?: string | null;
  /** Starting needs, 0..1, so a population does not all get hungry together. */
  readonly hunger?: number;
  readonly fatigue?: number;
}

/** A creature at rest at its spawn: idle, nothing targeted, needs as given, tier far until the simulation places it. */
export function newCreature(options: NewCreatureOptions): CreatureState {
  return {
    id: options.id,
    species: options.species,
    cellKey: options.cellKey,
    at: options.at,
    height: options.height,
    heading: options.heading,
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
    hostId: options.hostId ?? null,
    tier: 'far',
    phase: options.phase - Math.floor(options.phase),
  };
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
