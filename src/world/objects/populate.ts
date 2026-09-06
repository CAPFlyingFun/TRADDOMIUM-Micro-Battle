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
 * sub-lattice over the cell — grass at 78 sites a side, trees at 4 — and
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
import type { Habitat } from '../habitat';
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
  /** Shape variant: trees 0 broad / 1 scrub / 2 palm; rocks and stones 0..3; grass 0..1 (blade / broad blade). */
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
  grass: 78, // 6,084 sites: 24 a square metre, a 20 cm pitch
  twig: 22,  // 484: 1.9 a square metre
  stone: 18, // 324: 1.3 a square metre
  rock: 5,   // 25: one per ten square metres at most
  tree: 4,   // 16: one per sixteen square metres at most
});

/** The patch field's wavelength per family, world units. GAME TUNING. */
const CLUMP_WAVELENGTH: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 6 * M,
  twig: 8 * M,
  stone: 10 * M,
  rock: 12 * M,
  tree: 30 * M,
});

/** How much a patch field can suppress a family: 0 means bald patches, 1 means no patches at all. */
const CLUMP_FLOOR: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 0.25, twig: 0.3, stone: 0.35, rock: 0.3, tree: 0.2,
});

/**
 * Salts, one per question, disjoint across families so a blade and a
 * tree at the same lattice index never share a number. Each family gets
 * a block of sixteen.
 */
const FAMILY_SALT: Readonly<Record<ObjectFamily, number>> = Object.freeze({
  grass: 0x100, twig: 0x200, stone: 0x300, rock: 0x400, tree: 0x500,
});
const Q = Object.freeze({ occupy: 0, jx: 1, jz: 2, size: 3, girth: 4, spin: 5, lean: 6, leanDir: 7, tint: 8, rank: 9, variant: 10, clump: 11 });

/** Tree shapes, as the renderer's variant indices name them. */
export const TREE_BROAD = 0;
export const TREE_SCRUB = 1;
export const TREE_PALM = 2;

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
  switch (family) {
    case 'grass': {
      const blades = 24 * f.grass + 5 * f.forest + 12 * f.shrub + 10 * f.wet;
      return Math.min(24, blades) * (1 - 0.9 * f.bare) * (1 - 0.5 * f.exposure) * (1 - f.channel) * notLake * dry;
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
  }
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
      // Squared, so most blades are short and a few stand up: a flat
      // draw gives a lawn mown to one height.
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

    if (!allSea && (wanted === null || wanted.has(family))) {
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
          const varRoll = stableHash(gx, gz, salt + Q.variant);
          const shape = family === 'tree' ? treeVariant(f, varRoll) : family === 'grass' ? (varRoll < 0.85 ? 0 : 1) : Math.floor(varRoll * 4);
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
  }
}

/** Whether a site's ground is dry land, by the rule the densities use. Exported for a test. */
export function isDryLand(elevation: number): boolean {
  return elevation > DRY_LAND_ABOVE;
}
