/**
 * The resource layer's public surface, in one place: the contract
 * (`resources.ts`), the pure derivation (`derive.ts`), the water adapter
 * (`waterQuery.ts`) and the streaming layer (`ResourceLayer.ts`).
 */
export type {
  CellResources, EcologyWorld, NearestWater, PlantSource, ResourceKind, ResourceSite, WaterQuery,
} from './resources';
export { plantSurfaceAt, type PlantSurface, type PlantVector } from './plantSurface';
export { HONEYDEW_HOST_FAMILIES, OFFERED_KINDS, RESOURCE_KINDS } from './resources';
export {
  FLOOR_LITTER_CM2, FLOOR_LITTER_FILL, FLOOR_LITTER_PER_SIDE, FOREST_FLOOR_ABOVE, HOST_PERCH_OF_SIZE,
  LEAF_COVER_OF_SIZE_SQUARED, MAX_SITES_PER_CELL, NECTAR_UL, PLANT_SITE_BUDGET, SAP_ABOVE, SAP_UL_PER_METRE,
  SEEDS_PER_HEAD, SEED_HEAD_VARIANT, WATER_EDGE_BUDGET, WATER_FRONTAGE_MM_PER_NEIGHBOUR, WATER_LATTICE_PER_SIDE,
  deriveCellResources, derivePlantSites, deriveWaterEdgeSites, fairShares, isPlantKind,
} from './derive';
export { waterQueryOf, type SpotSource } from './waterQuery';
export { EVICT_BEYOND, ResourceLayer, type ResourceCost, type ResourceLayerOptions } from './ResourceLayer';
