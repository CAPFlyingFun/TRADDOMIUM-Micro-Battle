/**
 * WHICH OBJECTS EXIST IN A CELL — the second of the three questions,
 * answered from the seed, the cell's address and the habitat, and from
 * nothing else.
 *
 * Joshua, 2026-09-06: "worldSeed + world cell coordinate + habitat →
 * deterministic object population." That line is this file. Every
 * number an object has — where it stands, how tall, which way it leans,
 * how green — is a hash of its own site on a global lattice with the
 * world seed folded in, so a cell can be generated on its own, in any
 * order, on any phone, and be the same cell. No `Math.random`, no state
 * carried between calls, nothing read from a neighbour.
 *
 * ─── how a family is placed ──────────────────────────────────────────
 *
 * A JITTERED LATTICE, NOT NOISE, NOT POISSON. Each family has a
 * sub-lattice over the cell — grass at 110 sites a side, trees at 4 — and
 * every site rolls its own hash against the density the habitat allows
 * there. A site that passes stands somewhere inside its own square,
 * never on the line. This is v0's landmark trick and TCS's forest trick,
 * and it is chosen for the same reason both chose it: pure random
 * placement clumps and leaves bald patches by accident, and Poisson
 * sampling needs the neighbours it must not depend on. A lattice gives
 * every square its fair chance and the hash decides.
 *
 * CLUMPING IS A FIELD, NOT AN ACCIDENT. The density each site rolls
 * against is the habitat's, multiplied by a smooth patch field
 * (`random.clumpNoise`) at a wavelength per family — six metres for
 * grass, thirty for trees — so blades come in patches and trees in
 * stands, and the patches are the same patches for everyone. A floor on
 * the multiplier keeps a grassland from having bald acres.
 *
 * THE HABITAT IS READ FIVE TIMES A CELL, NOT ONCE A BLADE. Centre and
 * four corners, then blended bilinearly per site. A 146 m landcover
 * pixel changes across a 16 m cell by a little, and the blend carries
 * that little smoothly to the sites rather than snapping it at the cell
 * wall; reading it per site would be six thousand classifications a
 * cell for a difference no eye could find.
 *
 * NOTHING GROWS IN THE WATER. A site below sea level (from the corner
 * blend of the coarse ground), on the drainage's watercourse, or on a
 * pixel the survey calls open water gets nothing but stones and twigs —
 * and those only on a bank, not a lake.
 *
 * ─── identity ────────────────────────────────────────────────────────
 *
 * Major objects (`families.ts`) carry `family:cx,cz:site`. The site index
 * is the object's lattice slot, so the id does not shift when a
 * neighbour is thinned away or a delta removes one. A `WorldDelta` may
 * name an id and the populator leaves that object out; nothing writes
 * deltas yet, but the door is the id and the id is here.
 *
 * ─── the seven of the ecology pass (2026-09-07) ──────────────────────
 *
 * Joshua's brief — "Habitat decides WHAT, generation decides WHERE,
 * Detail Quality decides HOW MUCH" — adds fern, reed, flower, leaf
 * litter, shrub, broadleaf and coastal, and every one is placed by the
 * machinery above: its own lattice, its own salt block, its own patch
 * field, the same corner-blended factors. WHAT each follows:
 *
 *   fern       shade and damp — the forest factor, lifted by wet
 *   reed       fresh water's margins — wet, and the EDGE of a lake
 *              (where `lake` rises but is not yet open water); none on
 *              dry grassland, none on the sand
 *   flower     light and open ground — grass and shrub factors, not the
 *              forest interior, none on the sand or at sea
 *   leaf       the forest floor, some under shrubs
 *   shrub      shrubland and the forest EDGE; the brief's "sparse
 *              rocky/high plants" as a low density scaled by bare and
 *              exposure, never nothing
 *   broadleaf  the forest floor and the wet ground's herbs
 *   coastal    the beach and the backshore — the coast factor, gone
 *              by eighty metres inland
 *
 * and the grass gained a third variant: a SEED HEAD on about fifteen
 * percent of an open grassland's blades, which the resource layer reads
 * as seeds (`GRASS_SEED_HEAD`).
 *
 * A FAMILY THAT CANNOT BE HERE COSTS NOTHING. Each of the seven has a
 * short list of DRIVER factors its density is proportional to; when
 * every one of the five samples has them all at zero, the lattice is
 * not rolled at all. That is exact, not a heuristic: a blended factor
 * is a convex combination of the five samples', so a driver sum that is
 * zero at all five is zero at every site. It is what keeps a coastal
 * plant from costing an inland cell four hundred hashes, and a reed
 * from costing a dry one six hundred.
 *
 * ─── what is game tuning ─────────────────────────────────────────────
 *
 * Every density and every size range below is GAME TUNING, informed by
 * what the ESA classes mean and by Joshua's brief (short 5–15 cm,
 * medium 15–35, tall 35–60, very tall 60–100 cm blades; palms on a
 * beach, litter under trees, stones on the rocky ground) and by nothing
 * measured on a phone yet. The numbers are here so the HUD's counts and
 * his eye can argue with them in one place.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { world, type WorldPoint } from '../coords';
import { UNITS_PER_METRE } from '../dem';
import { BEACH_CEILING, type Habitat } from '../habitat';
import { clumpNoise, stableHash } from '../random';
import { CELL_SPAN, cellCentre, cellKey, cellOrigin, type ObjectCellId } from './cells';
import { FAMILY_SPECS, OBJECT_FAMILIES, type ObjectFamily } from './families';
import { NO_DELTAS, type WorldDelta } from './seed';

const M = UNITS_PER_METRE;
const CELL_M2 = (CELL_SPAN / M) * (CELL_SPAN / M);

/**
 * One family's objects in one cell, as parallel typed arrays: the shape
 * a renderer writes into an instance buffer without boxing anything.
 */
export interface FamilyBatch {
  readonly family: ObjectFamily;
  readonly count: number;
  /** World position, float64 — never a local coordinate (CLAUDE.md). */
  readonly wx: Float64Array;
  readonly wz: Float64Array;
  /** Height for grass and trees; longest axis for rocks, stones and twigs. World units. */
  readonly size: Float32Array;
  /** Width as a fraction of size (grass, trees), or thickness fraction (twigs). Rocks ignore it. */
  readonly girth: Float32Array;
  /** Rotation about +y, radians. */
  readonly spin: Float32Array;
  /**
   * Tilt off the family's rest pose, radians, and the direction it
   * tilts toward. The rest pose (up, along the slope, on the base) is the
   * renderer's, from the ground's normal; this is the departure from it.
   */
  readonly lean: Float32Array;
  readonly leanDir: Float32Array;
  /** 0..1, a palette knob the renderer turns into a colour. */
  readonly tint: Float32Array;
  /** 0..1, the thinning order: lower is kept longer as distance grows or the cap bites. */
  readonly rank: Float32Array;
  /**
   * Shape variant: trees 0 broad / 1 scrub / 2 palm; rocks and stones
   * 0..3; grass 0 blade / 1 broad blade / 2 seed head; flowers 0..3, the
   * head's colour; the rest 0.
   */
  readonly variant: Uint8Array;
  /** The site's index on the family's lattice — the object's slot, whatever is thinned. */
  readonly site: Uint32Array;
  /** Stable ids, major families only; null for cosmetic ones. */
  readonly ids: readonly string[] | null;
}

export interface CellPopulation {
  readonly cell: ObjectCellId;
  readonly key: string;
  /** The habitat at the cell's centre — a label for a HUD or a test. */
  readonly habitat: Habitat;
  readonly batches: Readonly<Record<ObjectFamily, FamilyBatch>>;
  /** Everything, all families. */
  readonly total: number;
}

export interface PopulateOptions {
  /** The world seed (`seed.ts`). Folded into every hash. */
  readonly seed: number;
  /** What belongs at a point. Called five times per cell. */
  readonly habitatAt: (at: WorldPoint) => Habitat;
  /** Removed major objects. Defaults to none. */
  readonly deltas?: WorldDelta;
  /**
   * Which families to generate; the rest come back empty. Default all.
   *
   * A cell ninety metres out never needs its six thousand grass sites
   * rolled — grass does not exist past thirty metres (`families.ts`) —
   * and rolling them anyway was 90% of a cell's cost. The families that
   * ARE generated are generated identically whether or not the others
   * were, which is what keeps this a streaming decision and not a
   * world one.
   */
  readonly families?: readonly ObjectFamily[];
}

/** Sites a side per family: the most of each thing a cell can hold, as a lattice. GAME TUNING. */
export const SITES_PER_SIDE: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 110, // 12,100 sites: 47 a square metre, a 14.5 cm pitch (doubled 2026-09-07, see densityPerM2)
  twig: 22,  // 484: 1.9 a square metre
  stone: 18, // 324: 1.3 a square metre
  rock: 5,   // 25: one per ten square metres at most
  tree: 4,   // 16: one per sixteen square metres at most
  // The ecology pass's seven: all far sparser than grass, and their
  // lattices sized so a full habitat fills its sites rather than
  // rolling past 1 (density × area per site ≤ 1 at the density cap).
  fern: 20,      // 400: 1.6 a square metre
  reed: 26,      // 676: 2.6 a square metre, a reed bed
  flower: 28,    // 784: 3.1 a square metre, a meadow in bloom
  leaf: 40,      // 1,600: 6.25 a square metre of litter
  shrub: 8,      // 64: one per four square metres at most — somebody, like a rock
  broadleaf: 20, // 400: 1.6 a square metre
  coastal: 20,   // 400: 1.6 a square metre of backshore
});

/** The patch field's wavelength per family, world units. GAME TUNING. */
const CLUMP_WAVELENGTH: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 6 * M,
  twig: 8 * M,
  stone: 10 * M,
  rock: 12 * M,
  tree: 30 * M,
  fern: 8 * M,
  reed: 5 * M,      // beds
  flower: 5 * M,    // drifts
  leaf: 4 * M,      // litter is nearly even; the field only breaks it up
  shrub: 14 * M,
  broadleaf: 7 * M,
  coastal: 9 * M,
});

/** How much a patch field can suppress a family: 0 means bald patches, 1 means no patches at all. */
const CLUMP_FLOOR: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 0.25, twig: 0.3, stone: 0.35, rock: 0.3, tree: 0.2,
  fern: 0.2, reed: 0.3, flower: 0.15, leaf: 0.5, shrub: 0.3, broadleaf: 0.25, coastal: 0.3,
});

/**
 * Salts, one per question, disjoint across families so a blade and a
 * tree at the same lattice index never share a number. Each family gets
 * a block of sixteen.
 */
const FAMILY_SALT: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 0x100, twig: 0x200, stone: 0x300, rock: 0x400, tree: 0x500,
  fern: 0x600, reed: 0x700, flower: 0x800, leaf: 0x900, shrub: 0xa00, broadleaf: 0xb00, coastal: 0xc00,
});
const Q = Object.freeze({ occupy: 0, jx: 1, jz: 2, size: 3, girth: 4, spin: 5, lean: 6, leanDir: 7, tint: 8, rank: 9, variant: 10, clump: 11 });

/** Tree shapes, as the renderer's variant indices name them. */
export const TREE_BROAD = 0;
export const TREE_SCRUB = 1;
export const TREE_PALM = 2;

/** Grass shapes. The seed head is what the resource layer reads as seeds. */
export const GRASS_BLADE = 0;
export const GRASS_BROAD = 1;
export const GRASS_SEED_HEAD = 2;
/** The share of an OPEN grassland's blades that carry a seed head. GAME TUNING; the brief's "~15%". */
export const SEED_HEAD_SHARE = 0.15;

/** How many head colours a flower can have; the renderer names them (white, yellow, red, violet). */
export const FLOWER_TINTS = 4;

/** The blended factors at a site: what the densities are computed from. */
interface Factors {
  forest: number; grass: number; shrub: number; bare: number; wet: number; lake: number;
  coast: number; exposure: number; elevation: number; channel: number;
}

/** Ground lower than this is not dry land: the swash zone, a puddle, the sea. */
const DRY_LAND_ABOVE = 0.3 * M;
/**
 * Below this blended height a site asks the habitat for its OWN ground
 * rather than trusting the corner blend. The blend is five samples of
 * a 54.7 m bilinear surface and can be a few decimetres off inside a
 * cell — nothing, except where the waterline runs through the cell and
 * a blade was found standing in the sea. It is only the coastal cells
 * that pay for the extra reads, and they are the ones that need them.
 */
const CHECK_GROUND_BELOW = 1.5 * M;

/**
 * Objects a square metre for each family, from the blended factors.
 * GAME TUNING throughout; the shape of each line is the brief's list
 * (§3: beach → driftwood and few blades; grassland → grass-heavy;
 * forest → trees and litter; rocky → stones, sparse grass; wet banks →
 * reeds and stones; ridges → sparse and short).
 */
function densityPerM2(family: ObjectFamily, f: Factors): number {
  const dry = f.elevation > DRY_LAND_ABOVE ? 1 : 0;
  const notLake = 1 - Math.min(1, f.lake * 2);
  // Sand, by the habitat's own rule (`classify`): the coast factor on
  // ground low enough to be a beach. `noSand` is 0 from the beach kind's
  // own threshold (sand > 0.5) inward, so the plants that are not the
  // beach's stop where the beach starts.
  const sand = f.coast * (1 - smoothstep(0, BEACH_CEILING, f.elevation));
  const noSand = 1 - Math.min(1, 2 * sand);
  switch (family) {
    case 'grass': {
      // DOUBLED on 2026-09-07 at Joshua's ask from the phone: "double the
      // grass density to be around 11K. Says it is like 5200 now. If 11K
      // works, can double again to be around 22K which is close to my
      // 25K limit." The lattice doubled with it (SITES_PER_SIDE), so a
      // full lawn still fills its sites rather than rolling past 1.
      const blades = 48 * f.grass + 10 * f.forest + 24 * f.shrub + 20 * f.wet;
      return Math.min(48, blades) * (1 - 0.9 * f.bare) * (1 - 0.5 * f.exposure) * (1 - f.channel) * notLake * dry;
    }
    case 'twig': {
      const litter = 1.6 * f.forest + 0.5 * f.shrub + 0.2 * f.grass + 0.6 * f.coast * (1 - f.forest) + 0.4 * f.wet;
      return Math.min(1.9, litter) * (1 - 0.8 * f.bare) * notLake * dry;
    }
    case 'stone': {
      const stones = 0.15 + 1.1 * f.bare + 0.35 * f.coast + 0.45 * f.wet + 0.2 * f.exposure;
      return Math.min(1.3, stones) * (1 - 0.5 * f.forest) * notLake * dry;
    }
    case 'rock': {
      const rocks = 0.002 + 0.045 * f.bare + 0.006 * f.coast + 0.006 * f.exposure + 0.004 * f.wet + 0.004 * f.forest;
      return Math.min(0.1, rocks) * notLake * dry;
    }
    case 'tree': {
      const trees = 0.022 * f.forest + 0.005 * f.shrub + 0.0015 * f.grass * (1 - f.coast) + 0.005 * f.coast * (1 - f.forest);
      return Math.min(0.0625, trees) * (1 - f.bare) * (1 - f.channel) * (1 - 0.5 * f.exposure) * notLake * dry;
    }
    // ── the ecology pass's seven. GAME TUNING, every line; the drivers
    // named here are the ones `driversOf` gates on. ──
    case 'fern': {
      // Shade and damp: the forest understory, thickest where it is wet
      // (Kauaʻi's wet forest floor is uluhe and hāpuʻu), and a few along
      // any wet ground. A frond a square metre is SPARSE for a real wet
      // forest, where uluhe is a continuous mat; the budget is a phone's.
      const ferns = 0.9 * f.forest + 0.7 * f.forest * f.wet + 0.25 * f.wet * (1 - f.coast);
      return Math.min(1.2, ferns) * (1 - 0.9 * f.bare) * (1 - 0.5 * f.exposure) * (1 - f.channel) * noSand * notLake * dry;
    }
    case 'reed': {
      // Fresh water's margins: the wet factor (surveyed wetland, a
      // river corridor, a channel's banks — on the bank, not in the
      // water) and the EDGE of a lake, where `lake` rises from nothing
      // and has not yet become open water. None on dry grassland, none
      // on the sand: salt is not a reed's water. Reeds want light, so
      // the canopy thins them.
      const margin = Math.min(1, 4 * f.lake) * notLake;
      const reeds = 2.3 * f.wet + 1.8 * margin;
      return Math.min(2.5, reeds) * (1 - 0.6 * f.forest) * (1 - f.bare) * (1 - f.channel) * noSand * notLake * dry;
    }
    case 'flower': {
      // Light and open ground: grassland and shrubland bloom, wet grass
      // a little more; the forest interior does not, nor the sand.
      const flowers = 2.5 * f.grass + 1.6 * f.shrub + 0.4 * f.wet * f.grass;
      return Math.min(2.5, flowers) * (1 - 0.85 * f.forest) * (1 - 0.8 * f.bare) * (1 - 0.6 * f.exposure) * (1 - f.channel) * noSand * notLake * dry;
    }
    case 'leaf': {
      // The forest floor: litter under the canopy, some under shrubs, a
      // little where thin forest meets grass. Six a square metre is the
      // lattice's whole room.
      const litter = 6.0 * f.forest + 1.5 * f.shrub + 0.3 * f.grass * f.forest;
      return Math.min(6.25, litter) * (1 - 0.9 * f.bare) * (1 - 0.5 * sand) * notLake * dry;
    }
    case 'shrub': {
      // Shrubland first; the forest EDGE (a half-open canopy, not the
      // interior); a few across grassland; and the brief's "sparse
      // rocky/high plants" — a low density on bare rock and the exposed
      // plateau, scaled by those factors and never quite nothing.
      const edge = 4 * f.forest * (1 - f.forest); // 1 where the canopy is half, 0 in the interior and in the open
      const shrubs = 0.12 * f.shrub + 0.05 * edge + 0.02 * f.grass + 0.015 * f.bare + 0.015 * f.exposure;
      return Math.min(0.25, shrubs) * (1 - 0.6 * f.forest) * (1 - 0.7 * f.bare) * (1 - f.channel) * (1 - 0.8 * sand) * notLake * dry;
    }
    case 'broadleaf': {
      // Broad-leaved ground plants: the forest floor's, and the wet
      // ground's (the taro flats' and stream banks' herbs); none on the sand.
      const broad = 1.1 * f.forest + 0.9 * f.wet * (1 - f.coast) + 0.3 * f.shrub * f.forest;
      return Math.min(1.5, broad) * (1 - 0.9 * f.bare) * (1 - 0.6 * f.exposure) * (1 - f.channel) * noSand * notLake * dry;
    }
    case 'coastal': {
      // The beach's own plant — a low naupaka-like spreader on the sand
      // and the backshore, thinning with the coast factor and gone by
      // eighty metres inland, where `coast` is 0 (`habitat.COAST_REACH`).
      const spreader = 0.8 * sand + 0.3 * f.coast * (1 - f.forest);
      return Math.min(1, spreader) * (1 - 0.8 * f.forest) * (1 - 0.7 * f.bare) * (1 - f.channel) * notLake * dry;
    }
  }
}

/**
 * The factors a family's density is PROPORTIONAL to: every term of its
 * `densityPerM2` carries one of them, so a zero sum is a zero density.
 * When the sum is zero at all five of a cell's samples it is zero at
 * every site (the blend is convex), and the lattice is skipped whole.
 * 1 for a family that can stand anywhere on dry land.
 */
function driversOf(family: ObjectFamily, f: Factors): number {
  switch (family) {
    case 'fern': case 'broadleaf': return f.forest + f.wet;
    case 'reed': return f.wet + f.lake;
    case 'flower': return f.grass + f.shrub;
    case 'leaf': return f.forest + f.shrub;
    case 'coastal': return f.coast;
    default: return 1;
  }
}

/** A smoothstep, the habitat's own curve, for the sand rule above. */
function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** The size range and shape of one object of a family at a site, from the same factors and its own hashes. */
function sizeOf(family: ObjectFamily, f: Factors, t: number, variant: number): number {
  switch (family) {
    case 'grass': {
      // How tall the grass here wants to be, 0 short .. 1 very tall:
      // open grassland and wet ground grow tall; forest floor, rock,
      // sand and the high plateau keep it short.
      const tall = Math.min(1, Math.max(0.05,
        0.2 + 0.5 * f.grass + 0.6 * f.wet - 0.4 * f.forest - 0.5 * f.exposure - 0.3 * f.bare - 0.2 * f.coast));
      const lo = (5 + 15 * tall) * M / 100;
      const hi = (15 + 85 * tall) * M / 100;
      // A seed head stands on a culm taller than the leaves around it:
      // the upper half of the range. The rest squared, so most blades
      // are short and a few stand up: a flat draw gives a lawn mown to
      // one height.
      if (variant === GRASS_SEED_HEAD) return lo + (hi - lo) * (0.5 + 0.5 * t);
      return lo + (hi - lo) * t * t;
    }
    case 'twig':
      return (5 + 55 * t * t) * M / 100;
    case 'stone':
      return (2 + 18 * t * t * t) * M / 100;
    case 'rock':
      return (25 + 225 * t * t * t) * M / 100;
    case 'tree':
      if (variant === TREE_PALM) return (6 + 8 * t) * M;
      if (variant === TREE_SCRUB) return (2.5 + 4.5 * t * t) * M;
      // Broad: 8–26 m, the canopy's density lifting the range.
      return (8 + 18 * t * t * (0.6 + 0.4 * f.forest)) * M;
    // ── the seven: the brief's ranges, GAME TUNING. ──
    case 'fern': return (20 + 40 * t * (0.6 + 0.4 * f.wet)) * M / 100; // 20–60 cm, the tallest where it is wet
    case 'reed': return (60 + 120 * t) * M / 100;                        // 60–180 cm
    case 'flower': return (8 + 32 * t * t) * M / 100;                    // 8–40 cm, most of them short
    case 'leaf': return (3 + 9 * t) * M / 100;                           // 3–12 cm along the leaf
    case 'shrub': return (40 + 110 * t * t) * M / 100;                   // 40–150 cm
    case 'broadleaf': return (15 + 35 * t) * M / 100;                    // 15–50 cm
    case 'coastal': return (20 + 40 * t) * M / 100;                      // 20–60 cm tall; wider than that
  }
}

/**
 * Which grass shape a blade takes. The broad blade keeps its fifteen
 * percent from before; the SEED HEAD is carved from the plain blades at
 * `SEED_HEAD_SHARE` of an open grassland's, fading in with the grass
 * factor so a habitat boundary is not a fence between headed and
 * headless lawn. The forest floor's short grass carries none.
 */
function grassVariant(f: Factors, roll: number): number {
  if (roll >= 0.85) return GRASS_BROAD;
  if (roll < SEED_HEAD_SHARE * smoothstep(0.2, 0.6, f.grass)) return GRASS_SEED_HEAD;
  return GRASS_BLADE;
}

/** Which variant an object of any family takes, from its own roll. */
function variantOf(family: ObjectFamily, f: Factors, roll: number): number {
  switch (family) {
    case 'tree': return treeVariant(f, roll);
    case 'grass': return grassVariant(f, roll);
    case 'twig': case 'stone': case 'rock': return Math.floor(roll * 4);
    case 'flower': return Math.floor(roll * FLOWER_TINTS);
    default: return 0;
  }
}

/** Which shape a tree here takes: palms on the sand, scrub on shrubland and the plateau, broad elsewhere. */
function treeVariant(f: Factors, roll: number): number {
  if (f.coast > 0.5 && f.forest < 0.6 && roll < 0.85) return TREE_PALM;
  if (f.exposure > 0.6 || (f.shrub > f.forest && roll < 0.8)) return TREE_SCRUB;
  if (f.forest < 0.3 && roll < 0.5) return TREE_SCRUB;
  return TREE_BROAD;
}

/**
 * The five habitat samples' factors, unpacked once per cell into flat
 * arrays so the per-site blend is arithmetic and not property lookups —
 * a cell is six thousand grass sites and the blend is most of what each
 * one costs.
 */
const FACTOR_KEYS = ['forest', 'grass', 'shrub', 'bare', 'wet', 'lake', 'coast', 'exposure', 'elevation', 'channel'] as const;

function unpack(c: readonly Habitat[]): Float64Array {
  // [sample][factor], samples in the order centre, NW, NE, SW, SE.
  const out = new Float64Array(5 * FACTOR_KEYS.length);
  for (let s = 0; s < 5; s += 1) {
    const h = c[s];
    for (let k = 0; k < FACTOR_KEYS.length; k += 1) {
      const key = FACTOR_KEYS[k];
      out[s * FACTOR_KEYS.length + k] = key === 'channel' ? (h.channel ? 1 : 0) : h[key];
    }
  }
  return out;
}

/**
 * Bilinear blend at (u, v) in the cell, 0..1 each way, with the centre
 * sample pulling the blend toward itself so a cell whose corners
 * straddle a pixel edge still reads its own middle correctly.
 */
function blend(packed: Float64Array, u: number, v: number, into: Factors): Factors {
  const wNW = (1 - u) * (1 - v);
  const wNE = u * (1 - v);
  const wSW = (1 - u) * v;
  const wSE = u * v;
  const wC = 4 * u * (1 - u) * v * (1 - v); // 1 at the centre, 0 at every edge
  const inv = 1 / (wNW + wNE + wSW + wSE + wC);
  const n = FACTOR_KEYS.length;
  const at = (k: number): number =>
    (packed[n + k] * wNW + packed[2 * n + k] * wNE + packed[3 * n + k] * wSW + packed[4 * n + k] * wSE + packed[k] * wC) * inv;
  into.forest = at(0);
  into.grass = at(1);
  into.shrub = at(2);
  into.bare = at(3);
  into.wet = at(4);
  into.lake = at(5);
  into.coast = at(6);
  into.exposure = at(7);
  into.elevation = at(8);
  into.channel = at(9);
  return into;
}

/**
 * Whether a family can stand anywhere in the cell: its drivers are
 * nonzero at at least one of the five samples. See `driversOf` for why
 * this is exact. Reads the packed samples straight, into the scratch
 * factors the caller lends.
 */
function canBeInCell(family: ObjectFamily, packed: Float64Array, into: Factors): boolean {
  const n = FACTOR_KEYS.length;
  for (let s = 0; s < 5; s += 1) {
    const o = s * n;
    into.forest = packed[o]; into.grass = packed[o + 1]; into.shrub = packed[o + 2]; into.bare = packed[o + 3];
    into.wet = packed[o + 4]; into.lake = packed[o + 5]; into.coast = packed[o + 6]; into.exposure = packed[o + 7];
    into.elevation = packed[o + 8]; into.channel = packed[o + 9];
    if (driversOf(family, into) > 0) return true;
  }
  return false;
}

/**
 * Generate one cell. Deterministic in (`options.seed`, `id`, what
 * `habitatAt` answers at five points); allocates the batches it returns
 * and nothing that outlives the call besides them.
 */
export function populateCell(id: ObjectCellId, options: PopulateOptions): CellPopulation {
  if (!Number.isFinite(id.cx) || !Number.isFinite(id.cz) || !Number.isInteger(id.cx) || !Number.isInteger(id.cz)) {
    throw new Error(`world/objects: a cell address must be two integers, got ${id.cx},${id.cz}`);
  }
  const deltas = options.deltas ?? NO_DELTAS;
  const origin = cellOrigin(id);
  const centre = cellCentre(id);
  const corners: Habitat[] = [
    options.habitatAt(centre),
    options.habitatAt(origin),
    options.habitatAt(world(origin.wx + CELL_SPAN, origin.wz)),
    options.habitatAt(world(origin.wx, origin.wz + CELL_SPAN)),
    options.habitatAt(world(origin.wx + CELL_SPAN, origin.wz + CELL_SPAN)),
  ];
  const habitat = corners[0];
  const key = cellKey(id);
  // The seed enters every hash through the salt: a different island, a
  // different world. (An integer mix, so a seed of zero is still a seed.)
  const seedSalt = Math.imul(options.seed | 0, 0x9e37_79b1) | 0;

  const batches: Partial<Record<ObjectFamily, FamilyBatch>> = {};
  let total = 0;
  const f: Factors = { forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0, elevation: 0, channel: 0 };

  // A cell entirely at sea generates nothing, quickly.
  const allSea = corners.every((h) => h.kind === 'sea');
  const packed = unpack(corners);
  const wanted = options.families === undefined ? null : new Set(options.families);

  for (const family of OBJECT_FAMILIES) {
    const sites = SITES_PER_SIDE[family];
    const room = sites * sites;
    const wx = new Float64Array(room);
    const wz = new Float64Array(room);
    const size = new Float32Array(room);
    const girth = new Float32Array(room);
    const spin = new Float32Array(room);
    const lean = new Float32Array(room);
    const leanDir = new Float32Array(room);
    const tint = new Float32Array(room);
    const rank = new Float32Array(room);
    const variant = new Uint8Array(room);
    const site = new Uint32Array(room);
    const major = FAMILY_SPECS[family].major;
    const ids: string[] | null = major ? [] : null;
    let count = 0;

    if (!allSea && (wanted === null || wanted.has(family)) && canBeInCell(family, packed, f)) {
      const pitch = CELL_SPAN / sites;
      const areaPerSite = CELL_M2 / room;
      const salt = FAMILY_SALT[family] ^ seedSalt;
      const perWave = 1 / CLUMP_WAVELENGTH[family];
      const floor = CLUMP_FLOOR[family];
      // Global lattice indices, so a site's numbers are its own and not
      // the cell's — two cells one apart share the lattice edge cleanly.
      const gx0 = id.cx * sites;
      const gz0 = id.cz * sites;
      for (let sz = 0; sz < sites; sz += 1) {
        for (let sx = 0; sx < sites; sx += 1) {
          const gx = gx0 + sx;
          const gz = gz0 + sz;
          const u = (sx + 0.5) / sites;
          const v = (sz + 0.5) / sites;
          blend(packed, u, v, f);
          // The patch field at the site's world position, not its lattice
          // index: a wavelength is a length.
          const px = origin.wx + (sx + 0.5) * pitch;
          const pz = origin.wz + (sz + 0.5) * pitch;
          const patch = floor + (1 - floor) * clumpNoise(px * perWave, pz * perWave, salt + Q.clump);
          const expected = densityPerM2(family, f) * areaPerSite * patch;
          if (expected <= 0) continue;
          if (stableHash(gx, gz, salt + Q.occupy) >= expected) continue;
          if (f.elevation < CHECK_GROUND_BELOW) {
            // The waterline is somewhere in this cell: ask the ground itself.
            const jx0 = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jx);
            const jz0 = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jz);
            const own = options.habitatAt(world(origin.wx + (sx + jx0) * pitch, origin.wz + (sz + jz0) * pitch));
            if (own.kind === 'sea' || own.elevation <= DRY_LAND_ABOVE) continue;
          }
          const slot = sz * sites + sx;
          if (ids !== null) {
            const oid = `${family}:${key}:${slot}`;
            if (deltas.isRemoved(oid)) continue;
            ids.push(oid);
          }
          // Thrown inside its own square, never on the line.
          const jx = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jx);
          const jz = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jz);
          const shape = variantOf(family, f, stableHash(gx, gz, salt + Q.variant));
          wx[count] = origin.wx + (sx + jx) * pitch;
          wz[count] = origin.wz + (sz + jz) * pitch;
          size[count] = sizeOf(family, f, stableHash(gx, gz, salt + Q.size), shape);
          girth[count] = girthOf(family, stableHash(gx, gz, salt + Q.girth), shape);
          spin[count] = stableHash(gx, gz, salt + Q.spin) * Math.PI * 2;
          lean[count] = leanOf(family, stableHash(gx, gz, salt + Q.lean), shape);
          leanDir[count] = stableHash(gx, gz, salt + Q.leanDir) * Math.PI * 2;
          tint[count] = stableHash(gx, gz, salt + Q.tint);
          rank[count] = stableHash(gx, gz, salt + Q.rank);
          variant[count] = shape;
          site[count] = slot;
          count += 1;
        }
      }
    }

    batches[family] = {
      family, count,
      wx: wx.subarray(0, count), wz: wz.subarray(0, count),
      size: size.subarray(0, count), girth: girth.subarray(0, count),
      spin: spin.subarray(0, count), lean: lean.subarray(0, count), leanDir: leanDir.subarray(0, count),
      tint: tint.subarray(0, count), rank: rank.subarray(0, count),
      variant: variant.subarray(0, count), site: site.subarray(0, count),
      ids,
    };
    total += count;
  }

  return { cell: id, key, habitat, batches: batches as Readonly<Record<ObjectFamily, FamilyBatch>>, total };
}

/** Width as a fraction of height (grass, trees) or of length (twigs). */
function girthOf(family: ObjectFamily, t: number, variant: number): number {
  switch (family) {
    case 'grass': return variant === 1 ? 0.05 + 0.04 * t : 0.018 + 0.02 * t; // 3–8 mm on a 20 cm blade
    case 'twig': return 0.03 + 0.04 * t;
    case 'stone': return 0.6 + 0.4 * t;
    case 'rock': return 0.55 + 0.45 * t;
    case 'tree': return variant === TREE_PALM ? 0.018 + 0.012 * t : 0.035 + 0.02 * t;
    // ── the seven. What "girth" scales is named per family; the renderer agrees. GAME TUNING. ──
    case 'fern': return 1.0 + 0.5 * t;        // the crown's spread over its height: wider than tall
    case 'reed': return 0.015 + 0.015 * t;    // blade width over height: 1–3 cm on a metre
    case 'flower': return 0.12 + 0.13 * t;    // the head's radius over the stem's height
    case 'leaf': return 0.4 + 0.25 * t;       // width over length
    case 'shrub': return 0.9 + 0.5 * t;       // the canopy's width over its height
    case 'broadleaf': return 0.5 + 0.3 * t;   // a leaf's width over the plant's reach
    case 'coastal': return 1.8 + 0.8 * t;     // spread over height: low and wide
  }
}

/**
 * How far off its REST POSE an object sits, radians. The rest pose is the
 * family's contact with the ground, which the renderer builds from the
 * ground's own normal (`flora/WorldObjects`): a blade grows up, a tree
 * grows up, a twig lies along the slope, a stone or a rock sits on its
 * base. What is rolled here is the small departure from that — a blade
 * leaning, a twig propped on a pebble, a rock not quite level.
 *
 * Joshua, from the phone (2026-09-06): "some objects are underground and
 * twigs aren't lying flat on the ground." Measured on the survey before
 * this: twigs took a uniform 0–90° off vertical (half of them steeper
 * than 45°), and stones and rocks a uniform 0–180° — and a rock turned
 * past a right angle has its top where its foot was, so seven in ten
 * rocks had more than half their body under the ground. A rock is not
 * rotated to lie any way up; it is rolled onto its base, like a dropped
 * one, and then spun about the normal.
 */
function leanOf(family: ObjectFamily, t: number, variant: number): number {
  switch (family) {
    case 'grass': return (t * t) * (18 * Math.PI / 180);
    case 'twig': return t * t * (8 * Math.PI / 180); // one end propped a little, most lying flat
    case 'stone': return t * (8 * Math.PI / 180);
    case 'rock': return t * (12 * Math.PI / 180);
    case 'tree': return variant === TREE_PALM ? t * (12 * Math.PI / 180) : t * t * (4 * Math.PI / 180);
    // ── the seven. Each grows up or lies flat like its nearest cousin above; this is the departure. GAME TUNING. ──
    case 'fern': return t * t * (10 * Math.PI / 180);
    case 'reed': return t * t * (15 * Math.PI / 180);     // a reed leans with the last wind
    case 'flower': return t * t * (12 * Math.PI / 180);
    case 'leaf': return t * t * (6 * Math.PI / 180);      // propped on a stalk or a pebble, like a twig
    case 'shrub': return t * t * (5 * Math.PI / 180);
    case 'broadleaf': return t * t * (8 * Math.PI / 180);
    case 'coastal': return t * (4 * Math.PI / 180);
  }
}

/** Whether a site's ground is dry land, by the rule the densities use. Exported for a test. */
export function isDryLand(elevation: number): boolean {
  return elevation > DRY_LAND_ABOVE;
}
