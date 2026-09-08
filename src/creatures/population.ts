/**
 * WHICH CREATURES EXIST IN A CELL — answered from the seed, the cell's
 * address, the habitat and the cell's plants, and from nothing else.
 *
 * THE SAME RULE THE OBJECTS FOLLOW (`world/objects/populate.ts`, Joshua,
 * 2026-09-06: "worldSeed + world cell coordinate + habitat →
 * deterministic object population"). A worm does not live where a random
 * number generator happened to be when the camera arrived; it lives
 * where its cell's hash puts it, and the hash is a property of the cell.
 * So this file has no `Math.random`, no state between calls, nothing read
 * from a neighbour, and no knowledge of the detail rung: the rung caps
 * how many of a cell's creatures are SIMULATED (`CreatureSim`), never how
 * many EXIST. The same cell asked on two phones, at two rungs, in two
 * orders, answers with the same animals in the same places.
 *
 * ─── how many ────────────────────────────────────────────────────────
 *
 * The species table gives a density per hectare per habitat kind. The
 * habitat is read at five points — the centre and the four quarter-points
 * of the cell — and the density averaged over them, the way the objects
 * blend five samples, so a cell whose quarters straddle a boundary reads
 * as the mix it is rather than snapping to whichever kind its centre
 * happens to fall in. That expectation, times the cell's 0.0256 ha, is
 * realised as a whole number by floor-plus-one-more-when-a-hash-beats-
 * the-fraction: an expectation of 10.24 gives ten worms in three cells
 * of four and eleven in the fourth, and the same cells every time.
 *
 * ─── where ───────────────────────────────────────────────────────────
 *
 * CLUMPING IS SITES, NOT NOISE. Each cell has a few hashed gathering
 * sites and every creature is hashed to one of them and thrown within a
 * radius of it; `population.clump` sets how few the sites are and how
 * tight the throw. An aphid colony (clump 0.9) is a handful of plants
 * with ten aphids each; worms (0.3) are spread through the soil. The
 * objects use a smooth patch field for the same job because they have
 * six thousand sites a cell; a dozen animals do not need a field.
 *
 * A HOST SPECIES LIVES ON ITS HOSTS. A species with `hosts` is placed AT
 * a host plant of the cell — the gathering sites ARE plants, chosen by
 * hash from the cell's plants of the host families — and records the
 * plant's id as `hostId`, so the brain can keep it on the plant and a
 * renderer can find the stem. Only a plant WITH an id is a host: the id
 * is what the creature carries, and a cosmetic blade (`ids: null` in the
 * objects' batches) has none to carry. A cell with no such plants holds
 * none of that species, whatever its density says. That is the honest
 * reading of "no aphids offshore": they are where their food is.
 *
 * ─── how big ─────────────────────────────────────────────────────────
 *
 * AND HOW LONG EACH ONE IS. A species' cited length is a typical animal,
 * not every animal (Joshua, 2026-09-08: the earthworm "should be based on
 * size and dynamic"), so each creature draws a body length from its
 * species' `lengthRangeMm` out of the same cell hash as its place, its
 * heading and its phase — one more question in its block, so the same
 * cell asked twice answers with the same worms at the same sizes, and
 * the worms that were already there did not move when the question was
 * added. `drawLengthMm` says what the distribution is and why it is not
 * uniform.
 *
 * NOTHING AT SEA. A creature whose spot the habitat calls sea or whose
 * ground is below sea level is not generated — the id it would have had
 * is skipped, not reused, so the ids of the rest do not shift when the
 * waterline runs through a cell.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { world, type WorldPoint } from '../world/coords';
import type { Habitat } from '../world/habitat';
import { SEA_LEVEL } from '../world/heightfield';
import type { PlantSource } from '../world/ecology/resources';
import { stableHash } from '../world/random';
import { CELL_SPAN, cellKey, cellOrigin, type ObjectCellId } from '../world/objects/cells';
import { wrapHeading } from './heading';
import { MM_PER_UNIT, unitsOfMm, type CreatureId, type CreatureSpecies } from './species';
import { newCreature, type CreatureState } from './state';

export interface PopulateCreaturesOptions {
  /** The world seed (`world/objects/seed.ts`). Folded into every hash. */
  readonly seed: number;
  /** What belongs at a point. Called five times per cell, plus once per creature to keep it out of the sea. */
  readonly habitatAt: (at: WorldPoint) => Habitat;
  /** The plants of a cell. A host species is placed on them; a ground species never reads them. Null: not generated yet. */
  readonly plantsOf: (cx: number, cz: number) => readonly PlantSource[] | null;
  /** The ground's height, world units above mean sea level. */
  readonly groundAt: (at: WorldPoint) => number;
}

/** A cell is 16 m square: 256 m², 0.0256 ha. The unit the table's densities are multiplied by. */
const CELL_METRES = (CELL_SPAN * MM_PER_UNIT) / 1000;
export const CELL_HECTARES = (CELL_METRES * CELL_METRES) / 10_000;

/**
 * Salts, one block per species, disjoint from the object families'
 * (`populate.ts` uses 0x100..0x5ff) so a worm and a tree in one cell
 * never share a number. Inside a block: creature n's questions at
 * `n * 16 + q`, site s's at `SITE + s * 16 + q`, and the cell's own at
 * the top.
 */
const SPECIES_SALT: Readonly<Record<CreatureId, number>> = Object.freeze({
  earthworm: 0x1_0000,
  aphid: 0x2_0000,
  housefly: 0x3_0000,
});
const SITE = 0x8000;
const CELL_Q = 0xfff0;
/** Per-creature questions. */
const Q = Object.freeze({ site: 0, r: 1, theta: 2, height: 3, heading: 4, phase: 5, hunger: 6, fatigue: 7, length: 8 });
/** Per-site questions. */
const SQ = Object.freeze({ x: 0, z: 1, plant: 2 });

/**
 * HOW LONG THIS ONE IS: a body length in millimetres, drawn from the
 * species' `lengthRangeMm` by one hashed 0..1 number.
 *
 * THE DRAW IS SKEWED SO ITS MEAN IS THE CITED LENGTH, and that is the
 * whole reason it is not a uniform draw. Uniform over the worm's
 * 120-250 mm averages 185 mm — a third bigger than the 150 mm the table
 * cites as the typical animal — and since every pace and every drawn rig
 * now scales with length, a uniform draw would quietly make the island's
 * worms a third longer and a third faster than the animal the sources
 * describe. So: `lo + (hi - lo) * u^k`, with
 *
 *     k = (hi - lo) / (L - lo) - 1
 *
 * where L is the cited length. E[u^k] is 1/(k+1), so the mean comes out
 * at lo + (hi - lo)/(k + 1) = L exactly, by construction rather than by
 * tuning. The worm's k is 130/30 - 1 = 3.33 and its mean 150 mm; the
 * aphid's is 1.5; the housefly's cited 6.5 mm sits ABOVE the middle of
 * its 4-8 mm range, so its k is 0.6 and the skew runs the other way.
 *
 * BIOLOGICAL SHAPE in the skew — a population holds many small
 * individuals and few giants, which is the shape a right-skewed draw has
 * — and MEASURED in what anchors it: the range and the mean are both the
 * table's cited sources, and the exponent between them is arithmetic,
 * not a number anybody picked.
 *
 * Guarded: a range that is not a range, or a cited length outside it
 * (`speciesProblems` refuses both), answers with a length inside the
 * range rather than a NaN body.
 */
export function drawLengthMm(species: CreatureSpecies, u01: number): number {
  const lo = species.lengthRangeMm[0];
  const hi = species.lengthRangeMm[1];
  const cited = species.lengthMm;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return Number.isFinite(cited) && cited > 0 ? cited : 1;
  const head = cited - lo;
  if (!(head > 0)) return lo;
  const k = (hi - lo) / head - 1;
  if (!Number.isFinite(k) || k < 0) return Math.min(hi, Math.max(lo, cited));
  const u = Number.isFinite(u01) ? Math.min(1, Math.max(0, u01)) : 0.5;
  return Math.min(hi, Math.max(lo, lo + (hi - lo) * Math.pow(u, k)));
}

/**
 * How far from its site a ground creature is thrown: the whole half-cell
 * at clump 0, the spot itself at clump 1. GAME TUNING: linear in the clump.
 */
function scatterRadius(species: CreatureSpecies): number {
  return (1 - species.population.clump) * CELL_SPAN * 0.5;
}

/** A host species gathers on the stem: within two body lengths of the plant's foot. GAME TUNING. */
export const HOST_SCATTER_LENGTHS = 2;

/** The cell inset sites are hashed into, so a site is never on the line. */
const SITE_INSET = 0.1;

/** Where on its host a plant creature perches, as a fraction of the plant's size: never the very foot, never the tip. GAME TUNING. */
export const PERCH_FRACTION: readonly [number, number] = Object.freeze([0.15, 0.9]) as readonly [number, number];

/**
 * The plants of a cell a host species may sit on: the host families,
 * with ids. Exported so the simulation can resolve a creature's `hostId`
 * back to its plant with the same filter the population used.
 */
export function hostCandidates(plants: readonly PlantSource[], species: CreatureSpecies): PlantSource[] {
  const hosts = species.population.hosts;
  if (hosts === null) return [];
  const out: PlantSource[] = [];
  for (let i = 0; i < plants.length; i += 1) {
    const p = plants[i];
    if (p.id !== null && hosts.includes(p.family)) out.push(p);
  }
  return out;
}

/** How many gathering sites a cell of `count` creatures has at the species' clump. At least one. */
export function siteCount(count: number, clump: number): number {
  return Math.max(1, Math.ceil(count * (1 - clump)));
}

/**
 * The expected number of this species in the cell: the table's density
 * averaged over the habitat samples, times the cell's area. Exported for
 * a test that wants the fraction.
 */
export function expectedCount(species: CreatureSpecies, samples: readonly Habitat[]): number {
  if (samples.length === 0) return 0;
  let density = 0;
  for (let i = 0; i < samples.length; i += 1) density += species.population.perHectare[samples[i].kind] ?? 0;
  return (density / samples.length) * CELL_HECTARES;
}

/**
 * Generate one cell's creatures of one species. Deterministic in
 * (`seed`, `cell`, what `habitatAt` answers, the cell's id-bearing host
 * plants, and the ground); allocates the states it returns and nothing
 * else that outlives the call.
 */
export function populateCreatures(
  cell: ObjectCellId,
  species: CreatureSpecies,
  options: PopulateCreaturesOptions,
): CreatureState[] {
  if (!Number.isInteger(cell.cx) || !Number.isInteger(cell.cz)) {
    throw new Error(`creatures/population: a cell address must be two integers, got ${cell.cx},${cell.cz}`);
  }
  const origin = cellOrigin(cell);
  const key = cellKey(cell);
  const cx = cell.cx;
  const cz = cell.cz;
  // The seed enters every hash through the salt, the way the objects do it.
  const seedSalt = Math.imul(options.seed | 0, 0x9e37_79b1) | 0;
  const salt = SPECIES_SALT[species.id] ^ seedSalt;

  // FIVE SAMPLES: the centre, then the quarter-points NW, NE, SW, SE.
  const q = CELL_SPAN * 0.25;
  const samples: Habitat[] = [
    options.habitatAt(world(origin.wx + 2 * q, origin.wz + 2 * q)),
    options.habitatAt(world(origin.wx + q, origin.wz + q)),
    options.habitatAt(world(origin.wx + 3 * q, origin.wz + q)),
    options.habitatAt(world(origin.wx + q, origin.wz + 3 * q)),
    options.habitatAt(world(origin.wx + 3 * q, origin.wz + 3 * q)),
  ];
  // A cell entirely at sea generates nothing, quickly — the objects' rule.
  // One whose centre is sea and whose quarter is beach is the wrack line,
  // and the flies of the wrack line live there.
  if (samples.every((h) => h.kind === 'sea')) return [];
  const expected = expectedCount(species, samples);
  if (!(expected > 0)) return [];
  const whole = Math.floor(expected);
  const count = whole + (stableHash(cx, cz, salt + CELL_Q) < expected - whole ? 1 : 0);
  if (count <= 0) return [];

  // THE SITES. Plants for a host species; hashed points for the rest.
  const sites = siteCount(count, species.population.clump);
  let hosts: PlantSource[] | null = null;
  if (species.population.hosts !== null) {
    const plants = options.plantsOf(cx, cz);
    if (plants === null) return [];
    const candidates = hostCandidates(plants, species);
    if (candidates.length === 0) return [];
    hosts = [];
    for (let s = 0; s < sites; s += 1) {
      hosts.push(candidates[Math.floor(stableHash(cx, cz, salt + SITE + s * 16 + SQ.plant) * candidates.length)]);
    }
  }
  const siteX = new Float64Array(sites);
  const siteZ = new Float64Array(sites);
  for (let s = 0; s < sites; s += 1) {
    if (hosts !== null) {
      siteX[s] = hosts[s].at.wx;
      siteZ[s] = hosts[s].at.wz;
    } else {
      siteX[s] = origin.wx + (SITE_INSET + (1 - 2 * SITE_INSET) * stableHash(cx, cz, salt + SITE + s * 16 + SQ.x)) * CELL_SPAN;
      siteZ[s] = origin.wz + (SITE_INSET + (1 - 2 * SITE_INSET) * stableHash(cx, cz, salt + SITE + s * 16 + SQ.z)) * CELL_SPAN;
    }
  }

  // THE SCATTER IS THE COLONY'S, NOT THE INDIVIDUAL'S: how tightly a
  // species gathers on a stem is a property of the species, and a spread
  // that changed with each aphid's own length would make a colony's shape
  // a function of who was drawn biggest. Sized by the cited length.
  const bodyLength = unitsOfMm(species.lengthMm);
  const scatter = hosts !== null ? HOST_SCATTER_LENGTHS * bodyLength : scatterRadius(species);
  const under = species.burrow === null ? 0 : unitsOfMm(species.burrow.underMm);
  const out: CreatureState[] = [];

  for (let n = 0; n < count; n += 1) {
    const base = salt + n * 16;
    const s = Math.floor(stableHash(cx, cz, base + Q.site) * sites);
    // Thrown about the site: uniform over the disc, never all at one radius.
    const r = scatter * Math.sqrt(stableHash(cx, cz, base + Q.r));
    const theta = stableHash(cx, cz, base + Q.theta) * Math.PI * 2;
    let wx = siteX[s] + Math.sin(theta) * r;
    let wz = siteZ[s] + Math.cos(theta) * r;
    // Born inside its own cell, so two cells never share a creature.
    wx = Math.min(origin.wx + CELL_SPAN - 1e-6, Math.max(origin.wx + 1e-6, wx));
    wz = Math.min(origin.wz + CELL_SPAN - 1e-6, Math.max(origin.wz + 1e-6, wz));
    const at = world(wx, wz);

    // NOTHING AT SEA, and nothing under it.
    const ground = options.groundAt(at);
    if (!Number.isFinite(ground) || ground < SEA_LEVEL) continue;
    if (options.habitatAt(at).kind === 'sea') continue;

    let height: number;
    let hostId: string | null = null;
    if (hosts !== null) {
      const plant = hosts[s];
      const f = PERCH_FRACTION[0] + (PERCH_FRACTION[1] - PERCH_FRACTION[0]) * stableHash(cx, cz, base + Q.height);
      height = ground + f * Math.max(0, plant.size);
      hostId = plant.id;
    } else if (species.burrow !== null) {
      height = ground - under;
    } else {
      height = ground;
    }

    const creature = newCreature({
      id: `${species.id}:${key}:${n}`,
      species: species.id,
      cellKey: key,
      at,
      height,
      heading: wrapHeading(stableHash(cx, cz, base + Q.heading) * Math.PI * 2),
      lengthMm: drawLengthMm(species, stableHash(cx, cz, base + Q.length)),
      phase: stableHash(cx, cz, base + Q.phase),
      behaviour: species.burrow !== null ? 'burrow' : 'idle',
      hostId,
      // Below the thresholds, so a cell does not all go looking for food on its first think.
      hunger: stableHash(cx, cz, base + Q.hunger) * species.needs.feedAt,
      fatigue: stableHash(cx, cz, base + Q.fatigue) * species.needs.restAt,
    });
    // Its think clock is offset by its phase — the donor's lesson: a
    // cell that thinks on one frame is a spike, not a load.
    creature.sinceThink = creature.phase * species.thinkS;
    out.push(creature);
  }
  return out;
}
