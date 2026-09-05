/**
 * WHERE A COLONY CAN BEGIN — thirty regions around the real island.
 *
 * The player picks a REGION, not a point. The game then picks one of
 * several hidden candidates inside it, which keeps restarts varied,
 * stops every player landing on one coordinate, and makes spawn camping
 * harder the day there is anyone to camp it.
 *
 * REGIONS ARE HAND-PLACED BY REAL GEOGRAPHY; CANDIDATES ARE FOUND.
 * The names and the latitudes are Kauaʻi's own — Hanalei, Polihale,
 * Waimea Canyon, the Alakaʻi. Typing candidate coordinates by hand as
 * well would be inventing terrain that has to happen to be walkable, and
 * every re-bake of the heightfield would silently rot them. So each
 * region declares roughly where it is and what it should be, and the
 * candidates are SEARCHED for in the actual ground.
 *
 * The search is deterministic — same grid, same candidates, in the same
 * order, on every device and every launch. The variation between
 * restarts comes from choosing among them, not from finding different
 * ones.
 *
 * AND THE TERRAIN GETS A VOTE. Four of v0's regions were classified from
 * what the places are called rather than from what the heightfield has,
 * and its audit caught all four: Nounou Ridge is a 350-metre lowland
 * ridge and could not be foothill country, Makaleha genuinely is, and two
 * jungles sit under a hundred metres because on Kauaʻi rainforest starts
 * at the shoreline. The labels moved; the island did not. Those
 * corrections are carried across here rather than rediscovered.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT CHANGED COMING FROM v0, and why (CLAUDE.md: do not copy a v0 file
 * across "because it worked" — the modules were fine, the wiring was the
 * problem):
 *
 * THE HEIGHTFIELD IS INJECTED, NOT IMPORTED. v0 reached module-level
 * `terrainHeight`/`groundHeight` singletons, so this file could not be
 * asked about a different survey and its cache belonged to nobody. Here
 * the field is a constructor argument and the cache belongs to the
 * object holding it — the same shape `SeaSwell` and `SeaWater` already
 * have.
 *
 * ONE GROUND QUERY, NOT TWO. v0 validated against `groundHeight` (the
 * drawn triangle) as well as `terrainHeight` (the smooth source),
 * because a candidate checked against the wrong one puts her inside a
 * hill on arrival. v1's core has only the source: what the clipmap
 * actually draws is the renderer's business and core cannot see it. The
 * honest consequence is that a candidate can sit up to the clipmap's own
 * interpolation error off the drawn surface — centimetres on a plain,
 * more on a ridge — and the scene lifts an arriving camera clear of the
 * ground anyway. Worth revisiting the day something stands on it.
 *
 * Pure: no three, no DOM, no storage, no network. This is core.
 */
import { world, type WorldPoint } from './coords';
import { UNITS_PER_METRE } from './dem';
import { geoToWorld, type GeoPoint } from './geo';
import { SEA_LEVEL, type Heightfield } from './heightfield';

export type Environment = 'coast' | 'grass' | 'jungle' | 'foothill' | 'mountain';

export interface SpawnCandidate {
  /** GLOBAL. The authoritative location — never a render position. */
  readonly at: WorldPoint;
  /** World radians. Which way you face on arrival. */
  readonly heading: number;
  /** The ground under it, in world units. */
  readonly ground: number;
}

export interface SpawnRegion {
  readonly id: string;
  readonly name: string;
  readonly environment: Environment;
  readonly description: string;
  /** One to three. Static for now; weather may inform it later. */
  readonly difficulty: number;
  /** Roughly where it is on the real island. */
  readonly around: GeoPoint;
}

/** A region with its candidates worked out. */
export interface ReadyRegion extends SpawnRegion {
  readonly candidates: readonly SpawnCandidate[];
}

/**
 * What each environment means in elevation, in real metres.
 *
 * Kauaʻi's rainforest starts at the SHORELINE, not at altitude — Hanalei
 * Valley and Hulēʻia are jungle under a hundred metres. v0's jungle floor
 * was 170 m and it made two real jungles unfindable.
 */
const HEIGHTS: Readonly<Record<Environment, { readonly low: number; readonly high: number }>> = Object.freeze({
  coast: { low: 1, high: 14 },
  grass: { low: 12, high: 190 },
  jungle: { low: 120, high: 620 },
  foothill: { low: 420, high: 950 },
  mountain: { low: 900, high: 1250 },
});

/** How far from a region's centre the search will wander, in world units. */
const SEARCH_REACH = 260_000;

/** How many candidates each region keeps. */
export const CANDIDATES_PER_REGION = 4;

/**
 * The steepest ground you may start on, as a gradient.
 *
 * Starting on a cliff face is not fatal — nothing falls yet — but it
 * opens with the camera clamped into the dirt, which reads as a broken
 * game rather than a hard start.
 */
const MAX_SLOPE = 0.42;

/** How far apart two candidates in one region must be. */
const APART = 40_000;

/**
 * Sixty metres between probes.
 *
 * It was 120 in an early v0 draft, which is plenty on a coastal plain and
 * nowhere near enough on a ridge: Hāʻupu is a narrow spine and only a
 * handful of its spots sit in the band at all, so a coarse spiral walked
 * straight past most of them.
 */
const PROBE_STEP = 6_000;

/**
 * THE THIRTY. Coast six, open lowland eight, jungle seven, foothills
 * five, mountain four — and deliberately nothing on the summit itself,
 * which is not somewhere an ant starts a colony.
 */
export const REGIONS: readonly SpawnRegion[] = Object.freeze([
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
]);

/** Why a candidate was refused. Named rather than boolean, so an audit can say. */
export type Refusal = 'underwater' | 'too-steep' | 'wrong-band';

/**
 * WHERE THE ISLAND IS ASKED ABOUT ITSELF.
 *
 * Holds the survey and the answers it has already given. One object, so
 * two screens asking the same question get the same answer and the
 * search is paid for once.
 */
export class SpawnSites {
  private ready: ReadyRegion[] | null = null;
  /** The survey revision the search was run against. */
  private searchedAt = -1;

  constructor(private readonly field: Heightfield) {}

  /**
   * Why this point will not do, or null if it will.
   *
   * The slope is a central difference over eight metres. Narrower and it
   * reads the interpolation between two samples rather than the hill;
   * wider and a ridge crest averages out to flat.
   */
  refuse(at: WorldPoint, want: Environment): Refusal | null {
    const ground = this.field.heightAt(at);
    if (ground <= SEA_LEVEL) return 'underwater';

    const reach = 400;
    const dx = (this.field.heightAt(world(at.wx + reach, at.wz))
      - this.field.heightAt(world(at.wx - reach, at.wz))) / (2 * reach);
    const dz = (this.field.heightAt(world(at.wx, at.wz + reach))
      - this.field.heightAt(world(at.wx, at.wz - reach))) / (2 * reach);
    if (Math.hypot(dx, dz) > MAX_SLOPE) return 'too-steep';

    const metres = ground / UNITS_PER_METRE;
    const band = HEIGHTS[want];
    if (metres < band.low || metres > band.high) return 'wrong-band';

    return null;
  }

  /**
   * Search one region for places you can actually start.
   *
   * A deterministic outward spiral from the region's centre, so the same
   * grid always yields the same candidates in the same order — no seed,
   * no shuffle, nothing that could differ between two devices or two
   * launches.
   */
  candidatesFor(region: SpawnRegion): SpawnCandidate[] {
    const centre = geoToWorld(region.around);
    const found: SpawnCandidate[] = [];
    const rings = Math.ceil(SEARCH_REACH / PROBE_STEP);

    for (let ring = 0; ring <= rings && found.length < CANDIDATES_PER_REGION; ring += 1) {
      const points = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < points && found.length < CANDIDATES_PER_REGION; i += 1) {
        const angle = (i / points) * Math.PI * 2;
        const at = world(
          centre.wx + Math.cos(angle) * ring * PROBE_STEP,
          centre.wz + Math.sin(angle) * ring * PROBE_STEP,
        );
        if (this.refuse(at, region.environment) !== null) continue;
        // Spread them out, or four candidates sit in one thicket and the
        // variation the region exists for disappears.
        if (found.some((had) => Math.hypot(had.at.wx - at.wx, had.at.wz - at.wz) < APART)) continue;
        found.push({ at, heading: this.facing(at), ground: this.field.heightAt(at) });
      }
    }
    return found;
  }

  /**
   * Every region with its candidates, worked out once.
   *
   * Re-run when the SURVEY changes: a high-detail tile landing is new
   * ground, and a candidate found in the coarse lattice may sit on a
   * slope the HD tile knows about. Keyed on the field's own revision, so
   * nothing has to remember to invalidate this.
   */
  regions(): readonly ReadyRegion[] {
    const revision = this.field.revision();
    if (this.ready === null || this.searchedAt !== revision) {
      this.ready = REGIONS.map((region) => ({ ...region, candidates: this.candidatesFor(region) }));
      this.searchedAt = revision;
    }
    return this.ready;
  }

  /** One region by id, or null. */
  region(id: string): ReadyRegion | null {
    return this.regions().find((r) => r.id === id) ?? null;
  }

  /**
   * Which way you look on arrival: downhill.
   *
   * That points a coastal start inland-ish and a mountain start toward
   * the country below it. Better than a fixed bearing, and it needs no
   * per-region data that could be got wrong.
   */
  private facing(at: WorldPoint): number {
    const reach = 2_000;
    const dx = this.field.heightAt(world(at.wx + reach, at.wz))
      - this.field.heightAt(world(at.wx - reach, at.wz));
    const dz = this.field.heightAt(world(at.wx, at.wz + reach))
      - this.field.heightAt(world(at.wx, at.wz - reach));
    if (Math.hypot(dx, dz) < 1) return 0;
    return Math.atan2(-dx, -dz);
  }
}

/**
 * Pick one candidate. The variation between restarts lives here, and only
 * here: the candidates themselves are fixed.
 *
 * `roll` is a parameter rather than a call to `Math.random` inside,
 * because core is testable and a function that rolls its own dice is not.
 */
export function chooseCandidate(region: ReadyRegion, roll: number): SpawnCandidate | null {
  if (region.candidates.length === 0) return null;
  const clamped = Math.min(0.999_999, Math.max(0, roll));
  return region.candidates[Math.floor(clamped * region.candidates.length)] ?? null;
}
