/**
 * WHERE A COLONY CAN BEGIN — thirty regions around the real island.
 *
 * The player picks a REGION, not a point. The game then picks one of
 * several hidden candidates inside it, which keeps restarts varied,
 * stops every player landing on one coordinate, and makes spawn camping
 * harder the day there is anyone to camp it.
 *
 * AND THE TERRAIN GETS A VOTE. Four of these were classified from what
 * the places are called rather than from what the heightfield has, and
 * the audit caught all four: Nounou Ridge is a 350-metre lowland ridge
 * and could not be foothill country, Makaleha genuinely is, and two
 * jungles sit under a hundred metres because on Kauaʻi rainforest
 * starts at the shoreline. The labels moved; the island did not.
 *
 * REGIONS ARE HAND-PLACED BY REAL GEOGRAPHY; CANDIDATES ARE FOUND.
 * The names and the latitudes are Kauaʻi's own — Hanalei, Polihale,
 * Waimea Canyon, the Alakaʻi. Typing candidate coordinates by hand as
 * well would be inventing terrain that has to happen to be walkable,
 * and every re-bake of the heightfield would silently rot them. So each
 * region declares roughly where it is and what it should be, and the
 * candidates are SEARCHED for in the actual ground and validated
 * against the surface the renderer draws.
 *
 * The search is deterministic — same grid, same candidates, every
 * device and every launch. The variation comes from choosing among
 * them, not from finding different ones.
 *
 * Every coordinate here is GLOBAL. Nothing in this file knows the
 * floating origin exists, and nothing should: a spawn point is a place
 * on Kauaʻi, not a place in this frame's render space.
 */
import { chunkAt, chunkKey, world, type WorldPoint } from './coords';
import { riverLevel } from './rivers';
import { lakeLevel } from './lakes';
import { geoToWorld, type GeoPoint } from './geo';
import { bandFor, groundHeight, terrainHeight } from './heightfield';
import { UNITS_PER_METRE } from './kauai';

export type Environment = 'coast' | 'grass' | 'jungle' | 'foothill' | 'mountain';

export interface SpawnCandidate {
  /** GLOBAL. The authoritative location — never a render position. */
  readonly at: WorldPoint;
  /** World radians. Which way she faces when she arrives. */
  readonly heading: number;
  readonly ground: number;
}

export interface SpawnRegion {
  readonly id: string;
  readonly name: string;
  readonly environment: Environment;
  readonly description: string;
  /** One to three stars. Static for now; weather may inform it later. */
  readonly difficulty: number;
  /** Roughly where it is on the real island. */
  readonly around: GeoPoint;
}

/**
 * What each environment means in elevation, in real metres.
 *
 * Read off the same band table the terrain paints with, so a region
 * called jungle lands on ground that is drawn as jungle.
 */
const HEIGHTS: Record<Environment, { low: number; high: number }> = {
  coast: { low: 1, high: 14 },
  grass: { low: 12, high: 190 },
  // Kauaʻi's rainforest starts at the shoreline, not at altitude —
  // Hanalei Valley and Hulēʻia are jungle at under a hundred metres.
  // This floor was 170 and it made two real jungles unfindable.
  jungle: { low: 120, high: 620 },
  foothill: { low: 420, high: 950 },
  mountain: { low: 900, high: 1250 },
};

/** How far from a region's centre the search will wander, in world units. */
const SEARCH_REACH = 260_000;

/** How many candidates each region keeps. */
export const CANDIDATES_PER_REGION = 4;

/**
 * The steepest ground she may start on, as a gradient.
 *
 * Spawning on a cliff face is not fatal — nothing falls in this game —
 * but it opens with the camera clamped into the dirt and her sliding,
 * which reads as a broken game rather than a hard start.
 */
const MAX_SLOPE = 0.42;

/** How far apart two candidates in one region must be. */
const APART = 40_000;

/**
 * THE THIRTY. Coast six, open lowland eight, jungle seven, foothills
 * five, mountain four — and deliberately nothing on the summit snow,
 * which is not somewhere a fire ant starts a colony.
 */
export const REGIONS: readonly SpawnRegion[] = [
  // ── Coast ───────────────────────────────────────────────────────
  { id: 'hanalei-bay', name: 'Hanalei Bay', environment: 'coast', difficulty: 1,
    around: { lat: 22.204, lon: -159.501 },
    description: 'A wide northern bay. Soft sand, driftwood, and rivers running out of the mountains.' },
  { id: 'polihale', name: 'Polihale Sands', environment: 'coast', difficulty: 2,
    around: { lat: 22.083, lon: -159.760 },
    description: 'The dry western shore under the cliffs. Hot, open, and a long way from anywhere.' },
  { id: 'poipu', name: 'Poʻipū Shore', environment: 'coast', difficulty: 1,
    around: { lat: 21.874, lon: -159.457 },
    description: 'The sunny south coast. Warm rock, low scrub, and reliable dry ground.' },
  { id: 'kealia', name: 'Keālia Strand', environment: 'coast', difficulty: 1,
    around: { lat: 22.113, lon: -159.310 },
    description: 'A long eastern beach with the trade wind at your back all day.' },
  { id: 'anini', name: 'ʻAnini Reef', environment: 'coast', difficulty: 1,
    around: { lat: 22.221, lon: -159.447 },
    description: 'Sheltered water behind a shallow reef. The calmest shoreline on the island.' },
  { id: 'mahaulepu', name: 'Māhāʻulepū', environment: 'coast', difficulty: 2,
    around: { lat: 21.883, lon: -159.412 },
    description: 'Wild southeastern coast. Limestone, wind, and very little cover.' },

  // ── Open lowland ────────────────────────────────────────────────
  { id: 'kekaha', name: 'Kekaha Plain', environment: 'grass', difficulty: 1,
    around: { lat: 21.976, lon: -159.717 },
    description: 'Flat, dry western grassland. Easy walking and long sight lines.' },
  { id: 'mana', name: 'Mānā Flats', environment: 'grass', difficulty: 1,
    around: { lat: 22.036, lon: -159.755 },
    description: 'Old wetland turned open plain. Level ground for a first colony.' },
  { id: 'koloa', name: 'Kōloa Fields', environment: 'grass', difficulty: 1,
    around: { lat: 21.907, lon: -159.470 },
    description: 'Gentle southern fields between the shore and the hills.' },
  { id: 'lihue', name: 'Līhuʻe Plain', environment: 'grass', difficulty: 1,
    around: { lat: 21.977, lon: -159.365 },
    description: 'Broad eastern lowland. Sheltered, green, and rarely dry for long.' },
  { id: 'kapaa', name: 'Kapaʻa Lowland', environment: 'grass', difficulty: 1,
    around: { lat: 22.077, lon: -159.339 },
    description: 'Coastal flats behind the dunes, with the mountains always in view.' },
  { id: 'kilauea-pasture', name: 'Kīlauea Pasture', environment: 'grass', difficulty: 2,
    around: { lat: 22.212, lon: -159.406 },
    description: 'Windward grazing land on the north shore. Wet, green, and exposed.' },
  { id: 'omao', name: 'ʻŌmaʻo Rise', environment: 'grass', difficulty: 2,
    around: { lat: 21.930, lon: -159.491 },
    description: 'Rolling ground above the south coast where the fields start to climb.' },
  { id: 'hanamaulu', name: 'Hanamāʻulu Flat', environment: 'grass', difficulty: 1,
    around: { lat: 21.998, lon: -159.348 },
    description: 'A sheltered eastern bowl. One of the kinder places to begin.' },

  // ── Jungle ──────────────────────────────────────────────────────
  { id: 'wailua-forest', name: 'Wailua Forest', environment: 'jungle', difficulty: 2,
    around: { lat: 22.043, lon: -159.395 },
    description: 'Dense river forest inland of the east coast. Wet leaf litter everywhere.' },
  { id: 'hanalei-valley', name: 'Hanalei Valley', environment: 'jungle', difficulty: 2,
    around: { lat: 22.185, lon: -159.470 },
    description: 'A deep green valley behind the bay. Rain most days, shelter under everything.' },
  { id: 'wainiha', name: 'Wainiha Jungle', environment: 'jungle', difficulty: 3,
    around: { lat: 22.190, lon: -159.556 },
    description: 'One of the wettest valleys anywhere. Thick, dark, and hard to cross.' },
  { id: 'kealia-forest', name: 'Keālia Forest', environment: 'jungle', difficulty: 2,
    around: { lat: 22.130, lon: -159.350 },
    description: 'Second-growth forest on the eastern slopes. Warm and close.' },
  { id: 'kalihiwai', name: 'Kalihiwai Ridge', environment: 'jungle', difficulty: 2,
    around: { lat: 22.190, lon: -159.420 },
    description: 'Wooded ridges cut by streams running north to the sea.' },
  { id: 'huleia', name: 'Hulēʻia Thicket', environment: 'jungle', difficulty: 2,
    around: { lat: 21.955, lon: -159.395 },
    description: 'Low river jungle in the southeast. Humid and quiet.' },
  { id: 'nounou', name: 'Nounou Ridge', environment: 'jungle', difficulty: 2,
    around: { lat: 22.045, lon: -159.365 },
    description: 'The Sleeping Giant. Wooded slopes with the whole east coast below.' },

  // ── Foothill and cliff ──────────────────────────────────────────
  { id: 'napali-rim', name: 'Nā Pali Rim', environment: 'foothill', difficulty: 3,
    around: { lat: 22.155, lon: -159.640 },
    description: 'The top of the great sea cliffs. Spectacular, and a long way down.' },
  { id: 'waimea-rim', name: 'Waimea Canyon Rim', environment: 'foothill', difficulty: 3,
    around: { lat: 22.055, lon: -159.665 },
    description: 'Red rock above the canyon. Dry, steep, and very open.' },
  { id: 'haupu', name: 'Hāʻupu Ridge', environment: 'foothill', difficulty: 3,
    around: { lat: 21.925, lon: -159.420 },
    description: 'A sharp ridge standing alone above the southern plain.' },

  { id: 'makaleha', name: 'Makaleha Heights', environment: 'foothill', difficulty: 3,
    around: { lat: 22.100, lon: -159.400 },
    description: 'Steep country below the interior. Water everywhere, footing nowhere.' },
  { id: 'kalalau-lookout', name: 'Kalalau Lookout', environment: 'foothill', difficulty: 3,
    around: { lat: 22.150, lon: -159.650 },
    description: 'High ground where the cloud pours over the rim and back again.' },

  // ── Mountain ────────────────────────────────────────────────────
  { id: 'kokee', name: 'Kōkeʻe Uplands', environment: 'mountain', difficulty: 3,
    around: { lat: 22.130, lon: -159.655 },
    description: 'Cool upland forest. Thin air for an ant and a long walk to the sea.' },
  { id: 'waialeale', name: 'Waiʻaleʻale Slopes', environment: 'mountain', difficulty: 3,
    around: { lat: 22.070, lon: -159.500 },
    description: 'The flank of one of the wettest places on earth. Rain is the normal condition.' },
  { id: 'kawaikini', name: 'Kawaikini Approach', environment: 'mountain', difficulty: 3,
    around: { lat: 22.055, lon: -159.495 },
    description: 'Below the summit itself. Steep, cold and almost always in cloud.' },
  { id: 'alakai', name: 'Alakaʻi Edge', environment: 'mountain', difficulty: 3,
    around: { lat: 22.115, lon: -159.600 },
    description: 'The rim of a high swamp. Waterlogged ground on top of a mountain.' },
];

/** Why a candidate was refused, for the audit to report. */
export type Refusal = 'underwater' | 'too-steep' | 'wrong-band' | 'no-surface';

export function refuse(at: WorldPoint, want: Environment): Refusal | null {
  const height = terrainHeight(at.wx, at.wz);
  if (height <= 0) return 'underwater';

  // FRESH water counts too. This check predates the lakes and rivers,
  // so 'underwater' meant only the sea — and a founding chamber dug at
  // the bottom of the Wailua is not a founding, it is a burial at sea
  // in fresh water. Inside a channel or under a lake's waterline is
  // refused for the same reason the ocean is.
  if (riverLevel(at.wx, at.wz) !== null) return 'underwater';
  const lake = lakeLevel(at.wx, at.wz);
  if (lake !== null && lake > height) return 'underwater';

  // The surface she will STAND on, which is the drawn triangle rather
  // than the smooth source — see heightfield. A candidate validated
  // against the wrong one puts her inside a hill on arrival.
  const drawn = groundHeight(at.wx, at.wz);
  if (!Number.isFinite(drawn)) return 'no-surface';

  const reach = 400;
  const dx = (groundHeight(at.wx + reach, at.wz) - groundHeight(at.wx - reach, at.wz))
    / (2 * reach);
  const dz = (groundHeight(at.wx, at.wz + reach) - groundHeight(at.wx, at.wz - reach))
    / (2 * reach);
  if (Math.hypot(dx, dz) > MAX_SLOPE) return 'too-steep';

  const metres = drawn / UNITS_PER_METRE;
  const band = HEIGHTS[want];
  if (metres < band.low || metres > band.high) return 'wrong-band';

  return null;
}

/**
 * Search a region for places she can actually start.
 *
 * A deterministic outward spiral from the region's centre, so the same
 * grid always yields the same candidates in the same order — no seed,
 * no shuffle, nothing that could differ between two devices.
 */
export function candidatesFor(region: SpawnRegion): SpawnCandidate[] {
  const centre = geoToWorld(region.around);
  const found: SpawnCandidate[] = [];
  // Sixty metres between probes. It was 120, which is plenty on a
  // coastal plain and not nearly enough on a ridge: Hāʻupu is a narrow
  // spine and only a handful of its spots sit in the band at all, so a
  // coarse spiral walked straight past most of them.
  const step = 6_000;
  const rings = Math.ceil(SEARCH_REACH / step);

  for (let ring = 0; ring <= rings && found.length < CANDIDATES_PER_REGION; ring++) {
    const points = ring === 0 ? 1 : ring * 8;
    for (let i = 0; i < points && found.length < CANDIDATES_PER_REGION; i++) {
      const angle = (i / points) * Math.PI * 2;
      const at = world(
        centre.wx + Math.cos(angle) * ring * step,
        centre.wz + Math.sin(angle) * ring * step,
      );
      if (refuse(at, region.environment)) continue;
      // Spread them out, or four candidates sit in one thicket and the
      // variation the region exists for disappears.
      if (found.some((had) => Math.hypot(had.at.wx - at.wx, had.at.wz - at.wz) < APART)) {
        continue;
      }
      found.push({ at, heading: facing(at), ground: groundHeight(at.wx, at.wz) });
    }
  }
  return found;
}

/**
 * Which way she looks on arrival.
 *
 * Downhill, which points a coastal start inland-ish and a mountain
 * start toward the country below it. Better than a fixed bearing, and
 * it needs no per-region data to get wrong.
 */
function facing(at: WorldPoint): number {
  const reach = 2_000;
  const dx = groundHeight(at.wx + reach, at.wz) - groundHeight(at.wx - reach, at.wz);
  const dz = groundHeight(at.wx, at.wz + reach) - groundHeight(at.wx, at.wz - reach);
  if (Math.hypot(dx, dz) < 1) return 0;
  return Math.atan2(-dx, -dz);
}

/** Everything the map and the audit need, worked out once. */
export interface ReadyRegion extends SpawnRegion {
  readonly candidates: readonly SpawnCandidate[];
}

let ready: ReadyRegion[] | null = null;

export function readyRegions(): ReadyRegion[] {
  if (!ready) {
    ready = REGIONS.map((region) => ({ ...region, candidates: candidatesFor(region) }));
  }
  return ready;
}

/** Forget the search — for tests, and for a re-baked heightfield. */
export function forgetRegions(): void {
  ready = null;
}

/**
 * Pick one. The variation between restarts lives here, and only here:
 * the candidates themselves are fixed.
 */
export function chooseCandidate(
  region: ReadyRegion, roll = Math.random(),
): SpawnCandidate | null {
  if (region.candidates.length === 0) return null;
  const at = Math.min(region.candidates.length - 1, Math.floor(roll * region.candidates.length));
  return region.candidates[at];
}

export interface Audit {
  readonly regions: number;
  readonly candidates: number;
  readonly empty: readonly string[];
  readonly thin: readonly string[];
  readonly byEnvironment: Record<Environment, number>;
}

/**
 * What the search actually found, so a region that quietly has nowhere
 * to stand shows up as a number rather than as a player's bad evening.
 */
export function auditSpawns(): Audit {
  const all = readyRegions();
  const byEnvironment = {
    coast: 0, grass: 0, jungle: 0, foothill: 0, mountain: 0,
  } as Record<Environment, number>;
  for (const region of all) byEnvironment[region.environment] += 1;
  return {
    regions: all.length,
    candidates: all.reduce((sum, region) => sum + region.candidates.length, 0),
    empty: all.filter((r) => r.candidates.length === 0).map((r) => r.id),
    thin: all.filter((r) => r.candidates.length > 0
      && r.candidates.length < CANDIDATES_PER_REGION).map((r) => r.id),
    byEnvironment,
  };
}

/** The chunk a candidate belongs to — the unit of streaming and saving. */
export function candidateChunk(candidate: SpawnCandidate): string {
  return chunkKey(chunkAt(candidate.at));
}

/** What the ground is called where she lands, for the map panel. */
export function bandAt(at: WorldPoint): string {
  return bandFor(groundHeight(at.wx, at.wz));
}
