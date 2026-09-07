/**
 * WHAT A CREATURE MAY KNOW — the one read-only window the simulation
 * has on the world, and the shape the simulation shows the world in
 * return.
 *
 * A module mutates only state it owns; everything else is a typed
 * parameter in or a read-only query out (CLAUDE.md). The creatures own
 * their `CreatureState` and nothing else. The ground, the habitat, the
 * plants, the resources, the water and the weather all reach them
 * through this object, built by the integration pass from the real
 * systems — and because every method here is a READ, a creature cannot
 * move a rock, drain a pool or rain on itself, whatever its brain
 * decides. The only write a creature has toward the world is the
 * terrain-edit seam (`terrainEdit.ts`), and that is a separate
 * parameter, handed only to the simulation, so a test can prove it is
 * the only door.
 *
 * WATER IS THE WATER SYSTEM'S. `water` is the same `WaterQuery` the
 * resource layer asks (`world/ecology/resources.ts`): a fly looking for
 * a drink asks the freshwater model where the edge is, and never a
 * puddle the creatures invented. Null until the integration pass wires
 * it, and a null water means "no water known here", not "dry".
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { WorldPoint } from '../world/coords';
import type { Habitat } from '../world/habitat';
import type { Normal } from '../world/heightfield';
import type { CellResources, PlantSource, WaterQuery } from '../world/ecology/resources';
import type { CreatureId, CreatureSpecies } from './species';
import type { CreatureState, Tier } from './state';
import type { BurrowGate } from './terrainEdit';

/** The sky as a creature feels it. Read from the weather source; a creature never reads the source itself. */
export interface CreatureWeather {
  readonly rainMmHr: number;
  readonly windX: number;
  readonly windZ: number;
  /** Sun below the horizon. From the real clock through `world/weather/solar.ts`; nothing invents a time of day. */
  readonly night: boolean;
}

/**
 * Something a creature reacts to: the camera today (the free-fly eye is
 * the only thing moving through the world), the player's ant when she
 * arrives, another creature one day. A point, a height and how far its
 * presence is felt.
 */
export interface Disturbance {
  readonly at: WorldPoint;
  readonly height: number;
  /** World units. Added to the species' own alarm distance. */
  readonly radius: number;
}

export interface CreatureWorld {
  /** The ground's height at a point, world units above mean sea level. The live heightfield, HD where a tile is resident. */
  groundAt(at: WorldPoint): number;
  normalAt(at: WorldPoint): Normal;
  /** What belongs at a point — the same classifier the objects use, so a worm and a fern agree on what a wetland is. */
  habitatAt(at: WorldPoint): Habitat;
  /** The plants of a 16 m cell, by cell address. Null for a cell not generated. */
  plantsOf(cx: number, cz: number): readonly PlantSource[] | null;
  /** The resource sites of a cell. Null for a cell not generated or a resource layer not built. */
  resourcesOf(cx: number, cz: number): CellResources | null;
  readonly water: WaterQuery | null;
  weather(): CreatureWeather | null;
  disturbances(): readonly Disturbance[];
}

/** Per-species counts, the shape a HUD line reads. */
export interface CreatureCounts {
  /** Generated inside the reach: every tier. */
  readonly resident: number;
  readonly byTier: Readonly<Record<Tier, number>>;
  /** The rung's cap for this species — a maximum, never a quota; the HUD shows `resident/cap`. */
  readonly cap: number;
}

export interface CreatureCost {
  /** Milliseconds spent deciding and moving in the last update, wall-clock, for the HUD — never fed back into the simulation. */
  readonly thinkMs: number;
  readonly moveMs: number;
  /** Decisions made in the last update. */
  readonly thoughts: number;
}

/**
 * The simulation's public surface: what the integration pass constructs,
 * what the renderer and the HUD read. `CreatureSim` in this directory
 * implements it; nothing outside `creatures/` constructs a creature.
 */
export interface CreatureSimulation {
  /** Species in the table's order, whether or not any is enabled. */
  readonly species: readonly CreatureSpecies[];
  /** The gate every bore passes through. Read by a HUD for its counts; never called from outside. */
  readonly burrows: BurrowGate;
  /** Switch a species on or off. Off: its residents are dropped and nothing of it is generated; the world forgets nothing, because the population is a function of the cell. */
  setEnabled(species: CreatureId, enabled: boolean): void;
  isEnabled(species: CreatureId): boolean;
  /** The detail rung's caps, by rung name (`world/objects/budget.ts`). Changing it changes how many are simulated, never where they are. */
  setRung(rung: string): void;
  /**
   * Advance by `dt` simulation seconds around a focus: stream cells in
   * and out by each species' reach, re-tier by distance, think and move.
   * `dt` is the clamped simulation step, never raw wall-clock.
   */
  update(focus: WorldPoint, dt: number): void;
  /** Every resident creature, all species, all tiers. The array is the simulation's own; read it, never keep it past the frame. */
  creatures(): readonly CreatureState[];
  counts(species: CreatureId): CreatureCounts;
  cost(): CreatureCost;
}
