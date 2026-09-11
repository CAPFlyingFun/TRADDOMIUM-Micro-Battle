/**
 * The island stress bench's placement boundary.
 *
 * StressTest (in lab/stressTest.ts) owns the clock, seeded species draw and
 * report arithmetic. This module owns the one bit of island-specific
 * arithmetic: finding a point in the real island's ground inside the one
 * metre test circle. Keeping it free of Three and DOM makes the exact-radius
 * rule usable by scene code and by unit tests alike.
 */
import type { CreatureId } from '../creatures/species';
import { mulberry32 } from '../world/random';
import type { Habitat } from '../world/habitat';
import { world as worldPoint, type WorldPoint } from '../world/coords';
import { ISLAND_STRESS_SEED } from './islandStressSeed';

/** The requested diameter, in metres. */
export const ISLAND_STRESS_DIAMETER_METRES = 1;
/** The world uses centimetres, hence 50 world units is half a metre. */
export const ISLAND_STRESS_RADIUS_METRES = ISLAND_STRESS_DIAMETER_METRES / 2;
export const ISLAND_STRESS_RADIUS_UNITS = ISLAND_STRESS_RADIUS_METRES * 100;

/**
 * The deterministic species list used by the island. It is exported so the
 * scene and a report condition cannot accidentally drift apart.
 */
export const ISLAND_STRESS_SPECIES: readonly CreatureId[] = Object.freeze([
  'earthworm', 'aphid', 'housefly',
]);

export interface IslandStressGround {
  readonly groundAt: (at: WorldPoint) => number;
  readonly habitatAt: (at: WorldPoint) => Habitat;
}

/** A horizontal distance, in world units, from the captured bench centre. */
export function islandStressDistance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.wx - b.wx, a.wz - b.wz);
}

/**
 * A point is valid only when the island's own habitat classifier calls it
 * land and does not classify it as the impassable cliff band. Water includes
 * both the sea and inland lake classes (`kind === sea` is the common case;
 * `lake` catches raster water that happens to sit above the DEM's sea level).
 */
export function validIslandStressGround(at: WorldPoint, world: IslandStressGround): boolean {
  const habitat = world.habitatAt(at);
  if (habitat.kind === 'sea' || habitat.lake >= 0.5 || habitat.channel) return false;
  if (!Number.isFinite(world.groundAt(at))) return false;
  // Habitat's slope is sourced from the same coarse island survey as its
  // landcover decision. At ROCK_FULL the island is a cliff for this test.
  if (habitat.slopeDegrees >= 58) return false;
  return true;
}

/**
 * Project a requested point onto usable island ground while retaining the
 * one-metre circle around `centre`. The first candidate is the requested
 * point; the deterministic ring search is only a projection fallback for a
 * water pixel or a cliff. Returning null is explicit: a caller must not
 * silently put a body in water when a whole local circle is unusable.
 */
export function projectIslandStressPoint(
  centre: WorldPoint,
  requested: WorldPoint,
  world: IslandStressGround,
): WorldPoint | null {
  let dx = requested.wx - centre.wx;
  let dz = requested.wz - centre.wz;
  const distance = Math.hypot(dx, dz);
  if (distance > ISLAND_STRESS_RADIUS_UNITS) {
    const scale = ISLAND_STRESS_RADIUS_UNITS / distance;
    dx *= scale;
    dz *= scale;
  }
  const candidate = worldPoint(centre.wx + dx, centre.wz + dz);
  if (validIslandStressGround(candidate, world)) return candidate;

  // Search from the outside in so points remain as spread out as the exact
  // circle allows, then use a centre candidate as the last valid location.
  const radii = [1, 0.875, 0.75, 0.625, 0.5, 0.375, 0.25, 0.125, 0];
  const angle = Math.atan2(dz, dx);
  for (const fraction of radii) {
    const radius = ISLAND_STRESS_RADIUS_UNITS * fraction;
    const attempts = fraction === 0 ? 1 : 16;
    for (let i = 0; i < attempts; i += 1) {
      const a = angle + (i / attempts) * Math.PI * 2;
      const point = worldPoint(
        centre.wx + Math.cos(a) * radius,
        centre.wz + Math.sin(a) * radius,
      );
      if (validIslandStressGround(point, world)) return point;
    }
  }
  return null;
}

/**
 * Deterministic placement for the Nth body. `StressTest` chooses the species
 * with its own seeded stream; this separate stream means changing a terrain
 * projection never changes that report's species sequence.
 */
export function islandStressPoint(
  centre: WorldPoint,
  index: number,
  world: IslandStressGround,
): WorldPoint | null {
  const rand = mulberry32((ISLAND_STRESS_SEED ^ (index * 0x9e3779b9)) | 0);
  const radius = Math.sqrt(rand()) * ISLAND_STRESS_RADIUS_UNITS;
  const angle = rand() * Math.PI * 2;
  return projectIslandStressPoint(
    centre,
    worldPoint(centre.wx + Math.cos(angle) * radius, centre.wz + Math.sin(angle) * radius),
    world,
  );
}

/**
 * Construct a stable id for a body that exists only during one island run.
 * The `stress:` prefix also makes accidental persistence easy to identify in
 * diagnostics without changing the production creature id vocabulary.
 */
export function islandStressCreatureId(index: number, species: CreatureId): string {
  return `stress:${species}:${index}`;
}
