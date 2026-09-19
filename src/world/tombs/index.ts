/**
 * The TOMBS laboratory, as a plan.
 *
 * `site.ts` says WHERE on the island, `types.ts` says what the pieces
 * are, `plan.ts` expands a small specification into them. The renderer
 * that draws it is `src/tombs/`.
 *
 * Pure: no three, no DOM, no storage, no network. This is core.
 */
export {
  TOMBS_GEO, TOMBS_GROUND_METRES, TOMBS_GROUND_UNITS, TOMBS_SITE, TOMBS_YAW, siteDrift,
} from './site';
export {
  box, holds, maxOf, minOf, overlaps, spanning, union, vec,
  type Box, type Doing, type Doorway, type Interaction, type LabLayout, type Lamp,
  type LightMode, type Person, type Pillar, type Ring, type Room, type RoomId, type Slab, type Surface, type Vec3,
} from './types';
export {
  ARRAY_SPINS, LAB_SPEC, planLab,
  type LabSpec, type OpeningKind, type OpeningSpec, type RoomSpec,
} from './plan';
