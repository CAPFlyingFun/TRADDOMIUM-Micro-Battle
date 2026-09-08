/**
 * The creatures' public surface. `fauna/` (the renderer), `perf/` (the
 * HUD) and the integration pass import from here; the files behind it
 * are the module's own.
 */
export {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, MM_PER_UNIT, assertSpeciesTable, isCreatureId,
  rigScale, sizeRatio, speciesProblems, unitsOfMm,
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
export { CELL_HECTARES, drawLengthMm, expectedCount, hostCandidates, populateCreatures, siteCount } from './population';
export type { PopulateCreaturesOptions } from './population';
export {
  ALARM_FLEES_AT, CALM_WEATHER, FLOOD_CLOSING, FLOOD_THREAT, HOST_WALK_LENGTHS, RAINING_MM_HR, hostPlantOf, isLand, nearestSite,
  senseAlarm, senseFlood, think, thinkDue, thinkPending, tickNeeds,
} from './intent';
export { arrived, burrow, fly, isAirborne, isMoving, move, paceOf, walk } from './locomotion';
export { wrapHeading } from './heading';
export {
  GROUND_CLEARANCE, MIN_STANDOFF, UNDER_GROUND, VIEW_LENGTHS, VIEW_RISE,
  isUnderground, metresOfUnits, nearestSighting, sightings, standoffOf, unitsOfMetres, viewpointFor,
} from './finder';
export type { FinderSighting, SightingOptions, Viewpoint, ViewpointOptions } from './finder';
export { CELLS_PER_UPDATE, CreatureSim, EVICT_BEYOND, NEAR_STEP_S } from './CreatureSim';
export type { CreatureSimOptions } from './CreatureSim';
