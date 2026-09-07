/**
 * The creatures' public surface. `fauna/` (the renderer), `perf/` (the
 * HUD) and the integration pass import from here; the files behind it
 * are the module's own.
 */
export {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, MM_PER_UNIT, assertSpeciesTable, isCreatureId,
  rigScale, speciesProblems, unitsOfMm,
} from './species';
export type {
  BurrowSpec, CreatureId, CreatureModel, CreatureNeeds, CreaturePace, CreaturePopulation, CreatureSenses,
  CreatureSpecies, Diet, FlightSpec, Medium, Temperament,
} from './species';
export { AIRBORNE, BEHAVIOURS, BEHAVIOURS_BY_MEDIUM, TIERS, behaviourAllowed, clamp01, newCreature } from './state';
export type { Behaviour, CreatureState, NewCreatureOptions, Tier } from './state';
export { NO_BURROW_EDITOR, burrowGate } from './terrainEdit';
export type { BurrowEditor, BurrowGate } from './terrainEdit';
export type {
  CreatureCost, CreatureCounts, CreatureSimulation, CreatureWeather, CreatureWorld, Disturbance,
} from './world';
