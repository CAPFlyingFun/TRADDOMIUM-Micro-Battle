/**
 * WHAT BELONGS AT A PLACE — the first of the three questions the world
 * objects answer separately (Joshua, 2026-09-06): habitat says what
 * belongs here; the populator says which objects exist; the detail rung
 * says how many of them this device draws. This file is the first
 * question and nothing else.
 *
 * KAUAʻI DECIDES, NOT AN ELEVATION RAMP. The terrain colours by height
 * and slope and the map by height alone, and both are honest stand-ins
 * for a ground that has no textures yet — but two places at one height
 * on this island are routinely different worlds: Hanalei's taro flats
 * and the Mānā plain are both two metres up and one is a wetland and
 * the other a dry grassland; the Napali cliffs and Kōkeʻe are both high
 * and one is bare rock and the other is forest. So the inputs are, in
 * order of how much they are trusted:
 *
 *   1. THE LANDCOVER RASTER (`landcover.ts`) — ESA WorldCover, satellite,
 *      real. It says forest, grass, shrub, bare, wetland, water, and how
 *      dense the canopy is, at 146 m. This is the one input that knows
 *      what actually grows there, and every other input only refines it.
 *   2. DISTANCE TO THE SEA (`coast.ts`) — what makes a beach a beach.
 *   3. ELEVATION AND SLOPE — from the COARSE survey, through a
 *      `Heightfield` that is never handed a tile, so the answer is the
 *      same on every device (see `islandChannels` for why the streamed
 *      field cannot be used for anything that must be deterministic).
 *   4. THE DRAINAGE — `isChannel`, world-fixed, for banks and for
 *      keeping objects out of watercourses.
 *
 * WHAT IS A SEAM AND NOT AN INPUT: rainfall by position and soil. The
 * repo has a global weather model with one wetness dial and no rainfall
 * map, and no soil data at all. `HabitatSources` has typed slots for
 * both, `null` today, and the classifier reads them when they are there.
 * Pretending to a moisture map by deriving one from elevation would be
 * a second answer to a question the weather model has said it will
 * answer with a `WorldPoint` sampler when it can.
 *
 * THE KIND IS A LABEL; THE NUMBERS ARE THE DECISION. A `Habitat` carries
 * one `kind` — beach, grassland, shrubland, forest, wetland, rocky,
 * ridge, sea — for anything that wants a word (a HUD, a test, a spawn
 * description), and a set of 0..1 factors that the populator actually
 * multiplies densities by. Two neighbouring cells with different kinds
 * have nearly the same factors, which is what stops a habitat boundary
 * from being a fence.
 *
 * THE THRESHOLDS ARE GAME TUNING, informed by the ESA classes and the
 * island's shape, and say so. The one measured fact they lean on is the
 * survey's own: the raster's class shares and where it puts forest.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import type { WorldPoint } from './coords';
import { UNITS_PER_METRE, type DemGrid } from './dem';
import { Heightfield, SEA_LEVEL } from './heightfield';
import { type CoverMix, Landcover } from './landcover';
import { coastField, type CoastField } from './coast';

export type HabitatKind =
  | 'sea'
  | 'beach'
  | 'grassland'
  | 'shrubland'
  | 'forest'
  | 'wetland'
  | 'rocky'
  | 'ridge';

export const HABITAT_KINDS: readonly HabitatKind[] = Object.freeze([
  'sea', 'beach', 'grassland', 'shrubland', 'forest', 'wetland', 'rocky', 'ridge',
]);

/**
 * What belongs at one place. Every factor is 0..1 and every one is
 * consumed by the populator as a multiplier, so a habitat is a
 * continuous thing with a name attached rather than a name with rules
 * hung off it.
 */
export interface Habitat {
  readonly kind: HabitatKind;
  /** Forest presence: tree cover weighted by canopy density. */
  readonly forest: number;
  /** Open grass presence. */
  readonly grass: number;
  /** Shrub presence. */
  readonly shrub: number;
  /** Exposed rock: steepness and bare ground together. */
  readonly bare: number;
  /** Standing or moving fresh water nearby: banks, wetlands, river corridors. */
  readonly wet: number;
  /**
   * How much of the ground here the survey calls open water — the lakes
   * and reservoirs the heightfield cannot see (a reservoir's surface is
   * dry land to a DEM). Nothing grows where this is high.
   */
  readonly lake: number;
  /** 1 at the waterline, fading to 0 by `COAST_REACH`. */
  readonly coast: number;
  /** Altitude exposure: 0 on the lowland, 1 at the summit plateau. */
  readonly exposure: number;
  /** Ground height, world units above MSL, from the coarse survey. */
  readonly elevation: number;
  /** Slope, degrees, from the coarse survey. */
  readonly slopeDegrees: number;
  /** Distance to the sea, world units. */
  readonly coastDistance: number;
  /** Whether this point is on a watercourse the island's drainage marks. */
  readonly channel: boolean;
  /**
   * Rainfall, mm a year, when a rainfall map exists; null until then.
   * The seam, not a fact: nothing reads it yet and nothing invents it.
   */
  readonly rainfallMmYear: number | null;
}

/** What the sea is, as a habitat: nothing grows. */
export const SEA_HABITAT: Habitat = Object.freeze({
  kind: 'sea' as HabitatKind,
  forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 1, coast: 1, exposure: 0,
  elevation: -1, slopeDegrees: 0, coastDistance: 0, channel: false, rainfallMmYear: null,
});

/**
 * The island's inputs, handed in rather than fetched (§2.1: a module
 * mutates only what it owns, and this owns nothing but a lookup).
 */
export interface HabitatSources {
  readonly landcover: Landcover;
  /** The repaired coarse survey. A private `Heightfield` is built over it and never given a tile. */
  readonly coarse: DemGrid;
  readonly isChannel: (at: WorldPoint) => boolean;
  /** Optional: a rainfall sampler, mm a year. Null until the weather field exists. */
  readonly rainfallAt?: ((at: WorldPoint) => number) | null;
}

/** Sand runs this far inland from the waterline, at most. GAME TUNING: Kauaʻi's beaches are 20–80 m deep. */
export const COAST_REACH = 80 * UNITS_PER_METRE;
/** Above this the ground is too high to be a beach whatever the distance says: a sea cliff is not sand. */
export const BEACH_CEILING = 10 * UNITS_PER_METRE;
/** Where altitude exposure starts and where it saturates: Kōkeʻe to the Alakaʻi plateau. GAME TUNING. */
export const EXPOSURE_FROM = 700 * UNITS_PER_METRE;
export const EXPOSURE_FULL = 1_300 * UNITS_PER_METRE;
/** Inside this distance of the sea the raster's water class is the sea, not a lake. One and a bit landcover pixels. */
export const LAKE_FROM_COAST = 200 * UNITS_PER_METRE;
/** Slopes at which bare rock starts to show and at which nothing else can hold on. Degrees; the terrain's own 32/58. */
export const ROCK_FROM = 32;
export const ROCK_FULL = 58;

/** A smoothstep, the one curve every threshold here is made of. */
function smooth(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

export class HabitatMap {
  private readonly landcover: Landcover;
  private readonly ground: Heightfield;
  private readonly coast: CoastField;
  private readonly isChannel: (at: WorldPoint) => boolean;
  private readonly rainfallAt: ((at: WorldPoint) => number) | null;

  constructor(sources: HabitatSources) {
    this.landcover = sources.landcover;
    // THE COARSE GROUND ONLY. `Heightfield` over the repaired grid with no
    // tile ever added is bilinear at 54.7 m everywhere, forever, on every
    // device — which is exactly the determinism a habitat needs and the
    // streamed field cannot promise.
    this.ground = new Heightfield(sources.coarse);
    this.coast = coastField(sources.coarse);
    this.isChannel = sources.isChannel;
    this.rainfallAt = sources.rainfallAt ?? null;
  }

  /** The coast field, for a probe that wants to print a distance. */
  get coastField(): CoastField {
    return this.coast;
  }

  /** What belongs here. Allocates one small object; call per cell, not per blade. */
  at(at: WorldPoint): Habitat {
    if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return SEA_HABITAT;
    const elevation = this.ground.heightAt(at);
    if (elevation < SEA_LEVEL) return SEA_HABITAT;
    const slopeDegrees = this.ground.slopeDegrees(at);
    const coastDistance = this.coast.distanceAt(at);
    const mix = this.landcover.mixAt(at);
    const channel = this.isChannel(at);
    const rainfallMmYear = this.rainfallAt === null ? null : this.rainfallAt(at);
    return classify(mix, elevation, slopeDegrees, coastDistance, channel, rainfallMmYear);
  }
}

/**
 * The raster's mix with the SEA taken out of it.
 *
 * Near the shore the landcover's water class is the ocean — its 10 m
 * coastline is generous around the reefs and a 146 m pixel straddles
 * the waterline — so a point the heightfield says is dry land can read
 * as 70% water and 30% grass. That 30% is the whole of what the survey
 * knows about the ground there, and it should count as the whole
 * ground, not as a third of one: renormalising over the land classes
 * is what stops every coastal cell from reading as nothing. Inland the
 * water weight is kept, because there it is a lake the DEM cannot see.
 *
 * A pixel the survey calls entirely water on ground the DEM calls land
 * is the backshore — sand, naupaka, a little grass — and gets that.
 */
function landMix(raw: CoverMix, coastDistance: number): CoverMix {
  const inland = smooth(LAKE_FROM_COAST, LAKE_FROM_COAST * 2.5, coastDistance);
  if (inland >= 1 || raw.water <= 0) return raw;
  const land = raw.tree + raw.shrub + raw.grass + raw.bare + raw.wetland;
  // How much of the water weight is sea: all of it at the shore, none inland.
  const sea = raw.water * (1 - inland);
  const water = raw.water - sea;
  if (land < 0.05) {
    // The backshore fringe, GAME TUNING.
    return { tree: 0, shrub: 0.2 * (1 - water), grass: 0.3 * (1 - water), bare: 0.5 * (1 - water), water, wetland: 0, canopy: 0, river: raw.river };
  }
  const scale = (land + sea) / land;
  return {
    tree: raw.tree * scale, shrub: raw.shrub * scale, grass: raw.grass * scale, bare: raw.bare * scale,
    wetland: raw.wetland * scale, water, canopy: raw.canopy, river: raw.river,
  };
}

/**
 * The rules, as one pure function of the inputs so a test can hand it
 * a mix and a slope and read the answer.
 */
export function classify(
  raw: CoverMix,
  elevation: number,
  slopeDegrees: number,
  coastDistance: number,
  channel: boolean,
  rainfallMmYear: number | null,
): Habitat {
  const mix = landMix(raw, coastDistance);
  // FACTORS FIRST — continuous, from the inputs — and the kind is read
  // off them afterwards. Nothing below reads the kind to decide a factor.
  const steep = smooth(ROCK_FROM, ROCK_FULL, slopeDegrees);
  const exposure = smooth(EXPOSURE_FROM, EXPOSURE_FULL, elevation);
  const coast = 1 - smooth(0, COAST_REACH, coastDistance);
  // Sand needs to be low as well as near: the top of a sea cliff is
  // next to the sea and is not a beach.
  const sand = coast * (1 - smooth(0, BEACH_CEILING, elevation));

  // Trees hold on to less of a slope than grass does, and none of a cliff.
  const forest = mix.tree * (0.35 + 0.65 * mix.canopy) * (1 - steep) * (1 - 0.6 * sand);
  const shrub = (mix.shrub + 0.25 * mix.tree * (1 - mix.canopy)) * (1 - 0.7 * steep);
  // Open grass: the grass class, plus the floor of thin forest, thinned
  // by rock and by sand — beach grass is a fringe, not a lawn.
  const grass = (mix.grass + 0.3 * mix.shrub + 0.15 * mix.tree * (1 - mix.canopy)) * (1 - 0.8 * steep) * (1 - 0.75 * sand);
  // Bare rock is the steep ground the survey shows as bare, plus what
  // slope alone makes bare, plus a little of any high exposed ridge.
  const bare = Math.min(1, mix.bare * 0.8 + steep + 0.35 * exposure * smooth(12, 30, slopeDegrees));
  // Wet: the survey's wetlands and river corridors, and the drainage's own
  // channels — a bank is wet on both sides of the line. The channel adds
  // to the FACTOR (reeds and stones along a stream) but does not on its
  // own make the KIND a wetland: a 54.7 m drainage cell across a dry
  // pasture is a gully, and calling it a marsh would paint 2.7% of the
  // island's land as swamp on the strength of a slope analysis.
  const surveyedWet = Math.min(1, mix.wetland + 0.8 * mix.river);
  const wet = Math.min(1, surveyedWet + (channel ? 0.4 : 0)) * (1 - steep);

  let kind: HabitatKind;
  if (sand > 0.5 && forest < 0.45) kind = 'beach';
  else if (steep > 0.5 || mix.bare > 0.5) kind = 'rocky';
  else if (surveyedWet > 0.4 && steep < 0.5) kind = 'wetland';
  else if (exposure > 0.6 && (slopeDegrees > 15 || mix.tree < 0.5)) kind = 'ridge';
  else if (forest > 0.45) kind = 'forest';
  else if (shrub > 0.3 || (mix.tree > 0.2 && forest <= 0.45)) kind = 'shrubland';
  else kind = 'grassland';

  // THE RASTER'S WATER NEAR THE SHORE IS THE SEA. Its 10 m coastline is
  // generous around the reefs and its pixels are 146 m, so a land point
  // within a pixel or two of the waterline reads as mostly water — and
  // treating that as a lake put nothing at all on any coastal cell.
  // Inland, a water pixel is a reservoir or a pond the DEM cannot see,
  // and that is the only thing `lake` is for.
  const lake = mix.water;
  return { kind, forest, grass, shrub, bare, wet, lake, coast, exposure, elevation, slopeDegrees, coastDistance, channel, rainfallMmYear };
}
