/**
 * The creatures' public surface. `fauna/` (the renderer), `perf/` (the
 * HUD), the Creature Lab and the integration pass import from here; the
 * files behind it are the module's own.
 */
export {
  APHID, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, LAB_CREATURE_IDS, MM_PER_UNIT, QUEEN, UNMEASURED_SPINE_UNITS,
  WORKER, assertSpeciesTable, isCreatureId, paceRatio, rigScale, sizeRatio, speciesProblems, unitsOfMm,
} from './species';
export type {
  BurrowSpec, CreatureId, WildCreatureId, CreatureModel, CreatureNeeds, CreaturePace, CreaturePopulation, CreatureSenses,
  CreatureSpecies, Diet, FlightSpec, Medium, Temperament,
} from './species';
export {
  AIRBORNE, AIR_WORDS, BEHAVIOURS, BEHAVIOURS_BY_MEDIUM, TIERS, behaviourAllowed, behaviourAllowedFor, clamp01, newCreature,
} from './state';
export type { Behaviour, CreatureState, NewCreatureOptions, Tier } from './state';
export { NO_BURROW_EDITOR, burrowGate } from './terrainEdit';
export type { BurrowEditor, BurrowGate } from './terrainEdit';
export type {
  CreatureCost, CreatureCounts, CreatureSimulation, CreatureWeather, CreatureWorld, Disturbance,
} from './world';
export { CELL_HECTARES, drawLengthMm, expectedCount, hostCandidates, populateCreatures, siteCount } from './population';
export type { PopulateCreaturesOptions } from './population';
export {
  ALARM_FLEES_AT, CALM_WEATHER, FLOOD_CLOSING, FLOOD_THREAT, GROUND_IDLE_S, GROUND_WANDER_LENGTHS, HOST_WALK_LENGTHS, RAINING_MM_HR,
  hostPlantOf, isLand, nearestSite, senseAlarm, senseFlood, think, thinkDue, thinkPending, tickNeeds,
} from './intent';
export {
  ARRIVE_LENGTHS, DROP_MM_S, arrived, burrow, floorAt, fly, isAirborne, isMoving, isSprinting, locomotionOf, move, paceOf, pitchOf,
  walk,
} from './locomotion';
export type { Locomotion } from './locomotion';
export { applyDemand, demandOf, newMutableIntent, playerDemand, wordFor } from './demand';
export type { MutableIntent } from './demand';
export { ControlLedger } from './control';
export type { ControlAuthority, Possession } from './control';
export {
  APHID_PERCH_FRACTION, BLOCK, BLOCK_CLEARANCE, BUMP, DISTURB_HOLD_S, INWARD_DISTANCE, LAB_CAPACITY, LAB_CLIMBABLES, LAB_FLOOR,
  LAB_HABITAT, LAB_HALF, LAB_PLANTS, LAB_SEED, LAB_SITES, LAB_SIZE, LAB_SPECIES_TABLE, LAB_WATER, LITTER_CORNER, PILLAR,
  PILLAR_BOX, PROTEIN_SPOT, PUDDLE, PUDDLE_EDGE, SLAB, SLAB_BOX, createLabWorld, labFloorAt, labGroundAt, labInBounds,
  labInwardTarget, labNormalAt, labSpawns, labStressSpawn, onBlock, puddleDepthAt,
} from './labWorld';
export type { LabWorld, LabWorldOptions } from './labWorld';
// --- Creature Lab D: surfaces (walls and undersides) ---
export {
  FACE_NORMALS, FACE_TOLERANCE, MAX_EDGES_PER_STEP, SURFACE_SKIN, WORLD_UP, aheadOn, aimOnSurface, cross, dot, faceIndexUnder, faceUnder,
  faceWord, floorOverBoxes, headingOn, normalize, rightOn, rotateBetween, routeAround, signedAngleAbout, surfaceStep, tangentBasis,
  tangentOf, vec3,
} from './surface';
export type { Climbable, FaceHit, FaceWord, MutableVec3, SurfaceBody, Vec3 } from './surface';
export { wrapHeading } from './heading';
export {
  GROUND_CLEARANCE, MIN_STANDOFF, UNDER_GROUND, VIEW_LENGTHS, VIEW_RISE,
  isUnderground, metresOfUnits, nearestSighting, sightings, standoffOf, unitsOfMetres, viewpointFor,
} from './finder';
export type { FinderSighting, SightingOptions, Viewpoint, ViewpointOptions } from './finder';
export { CELLS_PER_UPDATE, CreatureSim, EVICT_BEYOND, NEAR_STEP_S } from './CreatureSim';
export type { CreatureSimCost, CreatureSimCounts, CreatureSimOptions } from './CreatureSim';
// --- B2: the ground brain, the predation policy, containment, and the three species' researched behaviour (intent.ts, world.ts) ---
export type { CreaturePolicy, DisturbanceSource, PredationPolicy } from './world';
export {
  CARBOHYDRATE_OR_DRINK, DROP_CHANCE_DEFAULT, GROUND_FORAGE_LENGTHS, GROUND_HOME_RANGE, HOST_FLEE_LENGTHS, HOST_FLEE_WALK_MM, LOOM,
  PROTEIN_AT, PROTEIN_OR_DRINK, SEVERE_ALARM_FRACTION, TAKEOFF_WIND_MAX,
  beginTakeoff, contactMmOf, containTarget, creatureById, digDiscountOf, digPaceFactor, dropChanceOf, homeOf, isPredator,
  nearestDisturbance, nearestDisturbanceGap, nearestHostInSight, nearestPrey, predationOf, preyOf, routeTarget, takeoffWeatherAllows,
} from './intent';
