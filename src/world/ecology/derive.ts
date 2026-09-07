/**
 * WHERE THE RESOURCES ARE — derived, per 16 m cell, from the plants that
 * stand there and the water that runs there. Nothing is placed.
 *
 * Joshua, 2026-09-07: "Begin giving the ecosystem actual resources
 * before the Queen arrives. Do NOT build the complete ant survival
 * economy yet." So this file answers one question — what does this
 * cell OFFER — and answers it the way the objects answer theirs: as a
 * pure function of the cell's address, the world seed, the plants the
 * populator put there and the water the water system reports. Ask
 * twice, on two phones, in any order, and the sites are the same sites.
 * No `Math.random`; every number that varies from site to site is a
 * `stableHash` of the site's own place (`random.ts`).
 *
 * ─── one rule per kind ───────────────────────────────────────────────
 *
 *   nectar         every `flower`; at the head (above = the plant's size)
 *   seed           every `grass` whose variant is the seed head; at the head
 *   sap            every `tree`; a wound low on the trunk
 *   litter         every `leaf` object, on the ground — and, in forest,
 *                  a sparse hashed lattice of FLOOR sites, so a forest
 *                  floor has litter where no leaf object was drawn
 *   honeydew-host  every plant of a family an aphid colony sits on
 *                  (`HONEYDEW_HOST_FAMILIES`, the aphid's own host list)
 *   water-edge     a dry point of a cell-local lattice beside a wet one,
 *                  asked of the REAL water and never of a decoration
 *
 * Fruit and carrion are named in `resources.ts` and derived by nothing
 * here: a fruit tree is a family the plants do not have yet, and a
 * carcass is a creature that has died, which is a later milestone. An
 * unbuilt kind yields no sites rather than a placeholder site — the
 * honesty rule applied to the ground.
 *
 * ─── the plants are strings ──────────────────────────────────────────
 *
 * `PlantSource.family` is a string, matched by name, because the plant
 * families are a sibling module arriving in parallel with this one and
 * the contract (`resources.ts`) was written before either. A family this
 * file does not name (`reed`, `coastal`) yields nothing, silently: a reed
 * offers an ant no nectar and no sap, and that is the right answer, not
 * an error.
 *
 * ─── the water is not the plants ─────────────────────────────────────
 *
 * Rain moves the water and the flowers do not move, so the water-edge
 * sites are derived by their own function (`deriveWaterEdgeSites`) that
 * the layer can call alone every few seconds, and they have their OWN
 * share of the cell's budget (below). `deriveCellResources` is the two
 * together, for a caller that wants one answer.
 *
 * ─── the budget ──────────────────────────────────────────────────────
 *
 * A grassland cell holds twelve thousand blades and every one of them is
 * a honeydew host, and no creature will ever visit twelve thousand
 * sites. `MAX_SITES_PER_CELL` (96) bounds a cell, and the bound is kept
 * BY KIND so one kind cannot crowd out the rest — the rule, precisely:
 *
 *   - `WATER_EDGE_BUDGET` (16) of the 96 is RESERVED for water-edge,
 *     because water-edge is re-derived alone when the water moves. Had
 *     it shared the plants' budget, a shower that raised the water would
 *     have changed the other kinds' shares and so changed which flowers
 *     exist — the very thing a refresh must not do.
 *   - the other `PLANT_SITE_BUDGET` (80) is shared among the plant kinds
 *     present by MAX-MIN FAIRNESS (`fairShares`): every kind present
 *     gets an equal share or all it has, whichever is less, and what a
 *     small kind leaves unused is passed to the larger ones, round by
 *     round, until the budget is spent. So five kinds present each keep
 *     16; one flower among ten thousand blades keeps its one nectar site
 *     and the hosts take the 79 that remain. A kind present in the
 *     input is always present in the output.
 *   - WITHIN a kind, the sites kept are the ones with the LOWEST hashed
 *     rank, a property of the site's own place, so the kept sixteen
 *     blades are spread over the cell, are the same sixteen on every
 *     phone, and do not shift when a neighbour is thinned.
 *
 * ─── what is what ────────────────────────────────────────────────────
 *
 * MEASURED / BIOLOGICAL SHAPE / GAME TUNING, per line, as everywhere
 * (ARCHITECTURE §7). Nothing in this file is measured on the island;
 * the one biological shape is the nectar range and it says so.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { world, type WorldPoint } from '../coords';
import { UNITS_PER_METRE } from '../dem';
import { CELL_SPAN, cellCentre, cellOrigin } from '../objects/cells';
import { stableHash } from '../random';
import {
  HONEYDEW_HOST_FAMILIES,
  type CellResources, type EcologyWorld, type PlantSource, type ResourceKind, type ResourceSite, type WaterQuery,
} from './resources';

export { HONEYDEW_HOST_FAMILIES };

const M = UNITS_PER_METRE;

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/** The most sites a cell may hold, all kinds together. GAME TUNING: what a creature could ever be asked to choose among. */
export const MAX_SITES_PER_CELL = 96;
/** Of those, reserved for water-edge, which is re-derived alone (see the header). GAME TUNING. */
export const WATER_EDGE_BUDGET = 16;
/** The rest, shared max-min-fairly among the plant kinds present. */
export const PLANT_SITE_BUDGET = MAX_SITES_PER_CELL - WATER_EDGE_BUDGET;

/** The grass variant that is a seed head. The plants' own convention (variant 2), matched by number as the family is by name. */
export const SEED_HEAD_VARIANT = 2;

/**
 * Nectar a flower head holds, µl. BIOLOGICAL SHAPE: standing crops of
 * floral nectar are commonly reported from a few tenths of a microlitre
 * to a few microlitres per flower (Kearns & Inouye 1993, Techniques for
 * Pollination Biologists; Corbet 2003, Apidologie 34:1-10), and this is
 * that range. GAME TUNING: a head here draws uniformly across it, and a
 * plant is one head to this layer until its family says otherwise.
 */
export const NECTAR_UL: readonly [number, number] = Object.freeze([0.1, 5]) as readonly [number, number];
/** Seeds a grass head carries. GAME TUNING. Integers: a seed is a thing carried whole. */
export const SEEDS_PER_HEAD: readonly [number, number] = Object.freeze([5, 40]) as readonly [number, number];
/** Where a sap wound sits on the trunk, world units above the ground. GAME TUNING: low, where an ant reaches it. */
export const SAP_ABOVE: readonly [number, number] = Object.freeze([5, 40]) as readonly [number, number];
/** Sap a tree offers, µl per metre of its height. GAME TUNING: a bigger tree, a bigger wound. */
export const SAP_UL_PER_METRE = 20;
/** A leaf object's litter, cm² of cover, as a fraction of its size squared. GAME TUNING. */
export const LEAF_COVER_OF_SIZE_SQUARED = 0.5;
/** The forest floor's own litter lattice: sites a side over the cell (25 sites, 3.2 m apart). GAME TUNING. */
export const FLOOR_LITTER_PER_SIDE = 5;
/** The chance a floor site holds litter, per unit of the habitat's forest factor. GAME TUNING: sparse. */
export const FLOOR_LITTER_FILL = 0.5;
/** A floor site's litter, cm² of cover. GAME TUNING: a few leaves' worth. */
export const FLOOR_LITTER_CM2: readonly [number, number] = Object.freeze([50, 300]) as readonly [number, number];
/** A cell is forest floor when the habitat's forest factor at its centre exceeds this. GAME TUNING; the brief's line. */
export const FOREST_FLOOR_ABOVE = 0.5;
/** Where an aphid colony sits, as a fraction of the host's size up its stem. GAME TUNING. */
export const HOST_PERCH_OF_SIZE = 0.6;
/** The water lattice: samples a side over the cell (64 samples, 2 m apart). GAME TUNING: the coarsest lattice that finds a stream. */
export const WATER_LATTICE_PER_SIDE = 8;
/** Frontage a water-edge site offers per wet neighbour, mm. GAME TUNING. */
export const WATER_FRONTAGE_MM_PER_NEIGHBOUR = 200;

/** The kinds this file derives from plants, in the order their sites are emitted. */
const PLANT_KINDS: readonly PlantKind[] = Object.freeze(['nectar', 'seed', 'sap', 'litter', 'honeydew-host']);
type PlantKind = 'nectar' | 'seed' | 'sap' | 'litter' | 'honeydew-host';

/**
 * Salts, one block per kind, disjoint from the object families' (which
 * use 0x100-0x5ff) so a resource and a blade at the same place never
 * share a number. The seed enters every salt through `seedSalt`.
 */
const SALT: Readonly<Record<PlantKind | 'floor' | 'water', number>> = Object.freeze({
  nectar: 0x1000, seed: 0x2000, sap: 0x3000, litter: 0x4000, 'honeydew-host': 0x5000, floor: 0x6000, water: 0x7000,
});
const Q = Object.freeze({ rank: 0, amount: 1, above: 2, occupy: 3, jx: 4, jz: 5 });

/** The seed as a salt, the objects' own mix (`populate.ts`), so a seed of zero is still a seed. */
function seedSaltOf(seed: number): number {
  return Math.imul(seed | 0, 0x9e37_79b1) | 0;
}

function lerp(range: readonly [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/** A world coordinate as the integer a hash takes: the nearest centimetre. Finite in, finite out; the caller has checked. */
function quantise(v: number): number {
  return Math.round(v) | 0;
}

function assertCell(cx: number, cz: number): void {
  if (!Number.isInteger(cx) || !Number.isInteger(cz)) {
    throw new Error(`world/ecology: a cell address must be two integers, got ${cx},${cz}`);
  }
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/**
 * Max-min fair shares of `budget` over kinds holding `counts` sites: each
 * kind gets the smaller of an equal share and all it has; what the small
 * kinds leave is shared again among the kinds still short, until the
 * budget is spent or every kind is satisfied. When fewer sites remain
 * than kinds are short, the remainder goes one each in kind order, so
 * the sum is exactly the budget or the total, whichever is less.
 *
 * Exported for the test that holds the rule to its words.
 */
export function fairShares(counts: readonly number[], budget: number): number[] {
  const out = new Array<number>(counts.length).fill(0);
  let remaining = Math.max(0, Math.floor(budget));
  let open: number[] = [];
  for (let i = 0; i < counts.length; i += 1) if (counts[i] > 0) open.push(i);
  while (remaining > 0 && open.length > 0) {
    const share = Math.floor(remaining / open.length);
    if (share === 0) {
      for (const i of open) {
        if (remaining === 0) break;
        out[i] += 1;
        remaining -= 1;
      }
      break;
    }
    const still: number[] = [];
    for (const i of open) {
      const give = Math.min(counts[i] - out[i], share);
      out[i] += give;
      remaining -= give;
      if (out[i] < counts[i]) still.push(i);
    }
    open = still;
  }
  return out;
}

/**
 * Candidates for one kind: parallel arrays, not objects, because a
 * grassland cell offers twelve thousand host candidates and keeps
 * sixteen, and building twelve thousand sites to throw them away was
 * most of what a derivation would cost.
 */
interface Bucket {
  readonly index: number[];
  readonly rank: number[];
}

function bucket(): Bucket {
  return { index: [], rank: [] };
}

/**
 * The `k` candidates of lowest rank, as their indices in ascending
 * order. A bounded sorted insert rather than a full sort: once the kept
 * list is full, a candidate ranked above its last is rejected in one
 * comparison, and with uniform ranks that is nearly all of them.
 */
function keepLowest(b: Bucket, k: number): number[] {
  const n = b.index.length;
  if (k >= n) return b.index;
  if (k <= 0) return [];
  const best: number[] = []; // positions into the bucket, by rank ascending
  for (let p = 0; p < n; p += 1) {
    const r = b.rank[p];
    if (best.length === k && r >= b.rank[best[k - 1]]) continue;
    let lo = 0;
    let hi = best.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (b.rank[best[mid]] <= r) lo = mid + 1;
      else hi = mid;
    }
    best.splice(lo, 0, p);
    if (best.length > k) best.pop();
  }
  const kept = best.map((p) => b.index[p]);
  kept.sort((a, c) => a - c);
  return kept;
}

// ---------------------------------------------------------------------------
// The plants' sites
// ---------------------------------------------------------------------------

/** A forest-floor litter site the lattice rolled: not a plant, so it carries its own place. */
interface FloorSite {
  readonly at: WorldPoint;
  readonly amount: number;
}

/**
 * The sites the PLANTS of a cell offer — everything but water-edge —
 * derived from `plants` and, for the forest floor, from the habitat.
 * Deterministic in (`cx`, `cz`, `seed`, the plants, what `habitatAt`
 * answers); reads nothing else. `plants` is the populator's list for
 * the cell in the populator's order; the layer hands it in so that a
 * cell whose plants are not generated yet can WAIT rather than be
 * derived empty and cached that way.
 */
export function derivePlantSites(
  cx: number,
  cz: number,
  plants: readonly PlantSource[],
  ecology: EcologyWorld,
  seed: number,
): ResourceSite[] {
  assertCell(cx, cz);
  const seedSalt = seedSaltOf(seed);
  const key = `${cx},${cz}`;
  const n = plants.length;
  const buckets: Readonly<Record<PlantKind, Bucket>> = {
    nectar: bucket(), seed: bucket(), sap: bucket(), litter: bucket(), 'honeydew-host': bucket(),
  };
  const offer = (kind: PlantKind, index: number, qx: number, qz: number): void => {
    buckets[kind].index.push(index);
    buckets[kind].rank.push(stableHash(qx, qz, (SALT[kind] ^ seedSalt) + Q.rank));
  };

  for (let i = 0; i < n; i += 1) {
    const p = plants[i];
    // A plant nowhere offers nothing: a NaN would otherwise hash to a
    // number and stand a site at NaN,NaN, which no creature could reach
    // and every distance test would answer false about.
    if (!Number.isFinite(p.at.wx) || !Number.isFinite(p.at.wz)) continue;
    const qx = quantise(p.at.wx);
    const qz = quantise(p.at.wz);
    switch (p.family) {
      case 'flower': offer('nectar', i, qx, qz); break;
      case 'grass': if (p.variant === SEED_HEAD_VARIANT) offer('seed', i, qx, qz); break;
      case 'tree': offer('sap', i, qx, qz); break;
      case 'leaf': offer('litter', i, qx, qz); break;
      default: break;
    }
    if (HONEYDEW_HOST_FAMILIES.includes(p.family)) offer('honeydew-host', i, qx, qz);
  }

  // THE FOREST FLOOR. Leaf objects are drawn where the detail rung can
  // afford them; litter is where the trees are. So a cell the habitat
  // calls forest rolls its own sparse lattice of floor sites, from the
  // cell's address and the seed and nothing else, and a worm finds
  // litter under the canopy whether or not a leaf was drawn there.
  const floor: FloorSite[] = [];
  const centre = ecology.habitatAt(cellCentre({ cx, cz }));
  if (centre.forest > FOREST_FLOOR_ABOVE) {
    const sides = FLOOR_LITTER_PER_SIDE;
    const pitch = CELL_SPAN / sides;
    const origin = cellOrigin({ cx, cz });
    const salt = SALT.floor ^ seedSalt;
    const fill = FLOOR_LITTER_FILL * Math.min(1, centre.forest);
    for (let iz = 0; iz < sides; iz += 1) {
      for (let ix = 0; ix < sides; ix += 1) {
        // Global lattice indices, as the objects use: the site's numbers are its own.
        const gx = cx * sides + ix;
        const gz = cz * sides + iz;
        if (stableHash(gx, gz, salt + Q.occupy) >= fill) continue;
        const jx = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jx);
        const jz = 0.1 + 0.8 * stableHash(gx, gz, salt + Q.jz);
        const at = world(origin.wx + (ix + jx) * pitch, origin.wz + (iz + jz) * pitch);
        // Nothing rots on the sea: the one place the floor asks its own ground.
        if (ecology.habitatAt(at).kind === 'sea') continue;
        floor.push({ at, amount: lerp(FLOOR_LITTER_CM2, stableHash(gx, gz, salt + Q.amount)) });
        offer('litter', n + floor.length - 1, gx, gz);
      }
    }
  }

  const counts = PLANT_KINDS.map((k) => buckets[k].index.length);
  let total = 0;
  for (const c of counts) total += c;
  const shares = total <= PLANT_SITE_BUDGET ? counts : fairShares(counts, PLANT_SITE_BUDGET);

  const out: ResourceSite[] = [];
  for (let k = 0; k < PLANT_KINDS.length; k += 1) {
    const kind = PLANT_KINDS[k];
    const kept = keepLowest(buckets[kind], shares[k]);
    for (const i of kept) out.push(i < n ? plantSite(kind, key, i, plants[i], seedSalt) : floorSite(key, i, floor[i - n]));
  }
  return out;
}

/** One site from one plant. The amount and the height come from the rule for the kind; the hashes from the plant's own place. */
function plantSite(kind: PlantKind, key: string, index: number, p: PlantSource, seedSalt: number): ResourceSite {
  const qx = quantise(p.at.wx);
  const qz = quantise(p.at.wz);
  const salt = SALT[kind] ^ seedSalt;
  // A size that is not a size is no size: the site still stands (the
  // plant is real), it just offers by the floor of its rule.
  const size = Number.isFinite(p.size) && p.size > 0 ? p.size : 0;
  const at = world(p.at.wx, p.at.wz);
  const id = `${kind}:${key}:${index}`;
  switch (kind) {
    case 'nectar':
      return { id, kind, at, above: size, amount: lerp(NECTAR_UL, stableHash(qx, qz, salt + Q.amount)), ownerId: p.id };
    case 'seed': {
      const span = SEEDS_PER_HEAD[1] - SEEDS_PER_HEAD[0] + 1;
      return { id, kind, at, above: size, amount: SEEDS_PER_HEAD[0] + Math.floor(stableHash(qx, qz, salt + Q.amount) * span), ownerId: p.id };
    }
    case 'sap':
      return { id, kind, at, above: lerp(SAP_ABOVE, stableHash(qx, qz, salt + Q.above)), amount: SAP_UL_PER_METRE * (size / M), ownerId: p.id };
    case 'litter':
      return { id, kind, at, above: 0, amount: LEAF_COVER_OF_SIZE_SQUARED * size * size, ownerId: p.id };
    case 'honeydew-host':
      return { id, kind, at, above: HOST_PERCH_OF_SIZE * size, amount: size, ownerId: p.id };
  }
}

function floorSite(key: string, index: number, f: FloorSite): ResourceSite {
  return { id: `litter:${key}:${index}`, kind: 'litter', at: f.at, above: 0, amount: f.amount, ownerId: null };
}

// ---------------------------------------------------------------------------
// The water's sites
// ---------------------------------------------------------------------------

const NO_SITES: readonly ResourceSite[] = Object.freeze([]);

/**
 * The accessible edges of fresh water in a cell, asked of the water
 * system and of nothing else.
 *
 * A LATTICE, CELL-LOCAL. `WATER_LATTICE_PER_SIDE` samples a side over
 * the cell, two metres apart, at positions that are a function of the
 * cell's address — so the same cell asks the same points on every phone
 * and the answer differs only when the water does. A sample is WET when
 * the water reports fresh depth over it; a DRY sample beside a wet one
 * (north, south, east or west) is an edge, and it offers frontage in
 * proportion to how many of its four neighbours are wet. The neighbours
 * of a sample on the cell's edge lie in the next cell, and they are
 * asked too (one ring of apron samples): a river along a cell line is
 * still a river, and a bank must not lose its edge to the arithmetic of
 * where a cell ends.
 *
 * NEVER AT SEA. Salt is not a drink, and the sea's own edge is the
 * beach, which is not this. A sample the query calls sea is skipped
 * whatever its neighbours, and a sea neighbour is not a wet one — the
 * query's `freshDepthAt` is zero there by construction.
 *
 * NOTHING WITHOUT A WATER. A null water is "no water known", not "dry",
 * and the honest answer to it is no sites: a layer built before the
 * water loads has no edges, and gets them on its next refresh.
 *
 * At most `WATER_EDGE_BUDGET` sites, the lowest ranks kept, by the same
 * rule the plants' kinds are bounded by. The ids use the lattice slot,
 * so a site that survives a refresh keeps its id.
 */
export function deriveWaterEdgeSites(cx: number, cz: number, water: WaterQuery | null, seed: number): readonly ResourceSite[] {
  assertCell(cx, cz);
  if (water === null) return NO_SITES;
  const sides = WATER_LATTICE_PER_SIDE;
  const pitch = CELL_SPAN / sides;
  const origin = cellOrigin({ cx, cz });
  const apron = sides + 2;
  const wet = new Uint8Array(apron * apron);
  for (let iz = -1; iz <= sides; iz += 1) {
    for (let ix = -1; ix <= sides; ix += 1) {
      const at = world(origin.wx + (ix + 0.5) * pitch, origin.wz + (iz + 0.5) * pitch);
      // `> 0`, not `!== 0`: a NaN depth is not wet.
      wet[(iz + 1) * apron + (ix + 1)] = water.freshDepthAt(at) > 0 ? 1 : 0;
    }
  }
  const salt = SALT.water ^ seedSaltOf(seed);
  const candidates = bucket();
  const frontage = new Uint8Array(sides * sides);
  for (let iz = 0; iz < sides; iz += 1) {
    for (let ix = 0; ix < sides; ix += 1) {
      const a = (iz + 1) * apron + (ix + 1);
      if (wet[a] === 1) continue;
      const wetNeighbours = wet[a - 1] + wet[a + 1] + wet[a - apron] + wet[a + apron];
      if (wetNeighbours === 0) continue;
      const at = world(origin.wx + (ix + 0.5) * pitch, origin.wz + (iz + 0.5) * pitch);
      if (water.isSeaAt(at)) continue;
      const gx = cx * sides + ix;
      const gz = cz * sides + iz;
      const slot = iz * sides + ix;
      candidates.index.push(slot);
      candidates.rank.push(stableHash(gx, gz, salt + Q.rank));
      frontage[slot] = wetNeighbours;
    }
  }
  if (candidates.index.length === 0) return NO_SITES;
  const key = `${cx},${cz}`;
  const kept = keepLowest(candidates, WATER_EDGE_BUDGET);
  const out: ResourceSite[] = [];
  for (const slot of kept) {
    const ix = slot % sides;
    const iz = (slot - ix) / sides;
    out.push({
      id: `water-edge:${key}:${slot}`,
      kind: 'water-edge',
      at: world(origin.wx + (ix + 0.5) * pitch, origin.wz + (iz + 0.5) * pitch),
      above: 0,
      amount: frontage[slot] * WATER_FRONTAGE_MM_PER_NEIGHBOUR,
      ownerId: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cell
// ---------------------------------------------------------------------------

/**
 * Everything a cell offers: the plants' sites and the water's, in that
 * order. Pure and deterministic in (`cx`, `cz`, `seed`, what `ecology`
 * answers): the same inputs give the same sites, whatever was asked
 * before and whatever the neighbours hold. A cell whose plants are not
 * generated (`plantsOf` null) is derived as if it had none; the layer
 * (`ResourceLayer.ts`) waits for the plants instead, and this door is
 * for a caller that wants the answer now.
 */
export function deriveCellResources(cx: number, cz: number, ecology: EcologyWorld, seed: number): CellResources {
  assertCell(cx, cz);
  const plants = ecology.plantsOf(cx, cz) ?? [];
  const sites = derivePlantSites(cx, cz, plants, ecology, seed);
  const water = deriveWaterEdgeSites(cx, cz, ecology.water, seed);
  return { cx, cz, sites: water.length === 0 ? sites : sites.concat(water) };
}

/** Whether a kind is one this file derives from plants (as opposed to the water, or not at all yet). */
export function isPlantKind(kind: ResourceKind): kind is PlantKind {
  return (PLANT_KINDS as readonly ResourceKind[]).includes(kind);
}
