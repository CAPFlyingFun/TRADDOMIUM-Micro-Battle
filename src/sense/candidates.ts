/**
 * WHAT THE WORLD OFFERS UP TO BE SENSED.
 *
 * Joshua, asking for the antennae: "since it knows objects and stuff,
 * will be easy for it even in daytime." That is exactly right, and this
 * file is where it is easy. Nothing is searched for. Every blade, twig,
 * stone and tree already exists as a function of the world seed, its
 * 16 m cell and the habitat, and every animal is already a row in the
 * simulation's list — so a sweep does not go looking, it ASKS.
 *
 * IT READS AND NEVER WRITES. The candidates come through two narrow
 * queries handed in by the scene rather than by importing the renderer
 * that owns them (`flora/WorldObjects`) or reaching into its private
 * residents. That keeps this module testable with two closures and
 * keeps the ownership rule intact: a module mutates only what it owns,
 * and everything else is a typed parameter in.
 *
 * TWO LISTS, ON TWO SCHEDULES, because the two kinds of thing move
 * differently. The world's OBJECTS do not move at all, so they are
 * gathered ONCE when the ping goes off — which matters, because a 16 m
 * cell holds several thousand sites and walking them every frame for
 * ten seconds would be the most expensive thing on the phone. The
 * ANIMALS move, so they are re-read every frame; there are at most a
 * couple of hundred and they are already in an array.
 *
 * Pure: no three, no DOM.
 */
import { distanceSquared, world, type WorldPoint } from '../world/coords';
import { CREATURE_SPECIES, unitsOfMm, type CreatureId, type CreatureState } from '../creatures';
import { OBJECT_FAMILIES, type ObjectFamily } from '../world/objects/families';
import { cellsWithin, type ObjectCellId } from '../world/objects/cells';
import type { CellPopulation } from '../world/objects/populate';
import type { SenseKind, SenseThing } from './senseTypes';

/**
 * GRASS IS NOT A THING, and leaving it out is the decision that makes
 * this feature usable rather than a green fog.
 *
 * A cell holds about six thousand blades and Joshua's own spot reads
 * eleven thousand; the ground cover is the ant's forest, not an object
 * anyone wants named. Look at the screenshots he sent: the labels are
 * TWIG, SPROUT, RESIN — things you would pick up — over a lawn that is
 * left alone. So grass is excluded here, at the source, rather than
 * being generated and then thrown away by a cap.
 */
export const SENSED_FAMILIES: readonly ObjectFamily[] = Object.freeze(
  OBJECT_FAMILIES.filter((f) => f !== 'grass'),
);

/**
 * The word each family's label prints. The family name upper-cased,
 * with one exception: `leaf` is LEAF LITTER in the world and a label
 * reading LEAF beside a `broadleaf` reading BROADLEAF would name two
 * different things almost the same way.
 */
export const FAMILY_WORDS: Readonly<Record<ObjectFamily, string>> = Object.freeze({
  grass: 'GRASS',
  twig: 'TWIG',
  stone: 'STONE',
  rock: 'ROCK',
  tree: 'TREE',
  fern: 'FERN',
  reed: 'REED',
  flower: 'FLOWER',
  leaf: 'LITTER',
  shrub: 'SHRUB',
  broadleaf: 'BROADLEAF',
  coastal: 'COASTAL',
});

/**
 * Which of the three groups a family belongs to — what the colour says
 * at a glance. `twig`, `stone`, `rock` and `leaf` litter are MATERIAL:
 * dead things an ant carries and builds with. The rest are PLANT:
 * living things that grow where the habitat puts them.
 */
export const FAMILY_KINDS: Readonly<Record<ObjectFamily, SenseKind>> = Object.freeze({
  grass: 'plant', twig: 'material', stone: 'material', rock: 'material', tree: 'plant',
  fern: 'plant', reed: 'plant', flower: 'plant', leaf: 'material', shrub: 'plant',
  broadleaf: 'plant', coastal: 'plant',
});

/** The word for each animal. Singular, because a label names ONE of them. */
export const CREATURE_WORDS: Readonly<Record<CreatureId, string>> = Object.freeze({
  earthworm: 'WORM',
  aphid: 'APHID',
  housefly: 'FLY',
  queen: 'QUEEN',
  worker: 'WORKER',
});

/** The two read-only queries the scene hands in. Neither may change anything. */
export interface ObjectSource {
  /** What is generated in a cell, or null where the streamer has not reached it. */
  populationAt(cell: ObjectCellId): CellPopulation | null;
  /** The ground under a point, world units above sea level — an object stands on it. */
  groundAt(at: WorldPoint): number;
}

/**
 * The unmoving things inside the radius, gathered once per ping.
 *
 * Capped, because a sweep near a fern bank could otherwise walk tens of
 * thousands of sites: `limit` stops the WALK, not just the result, so a
 * dense cell costs what it is allowed to and no more. The selection
 * afterwards (`select.ts`) is what decides which of these are shown; a
 * cap here is only a floor under the cost.
 */
export function objectThings(
  source: ObjectSource,
  origin: WorldPoint,
  radius: number,
  limit = 4_000,
): SenseThing[] {
  const out: SenseThing[] = [];
  if (!(radius > 0) || !Number.isFinite(origin.wx) || !Number.isFinite(origin.wz)) return out;
  const r2 = radius * radius;
  // Nearest cell first, so a cap that bites drops the far ones.
  for (const cell of cellsWithin(origin, radius)) {
    const population = source.populationAt(cell);
    if (population === null) continue;
    for (const family of SENSED_FAMILIES) {
      const batch = population.batches[family];
      if (batch === undefined || batch.count === 0) continue;
      const word = FAMILY_WORDS[family];
      const kind = FAMILY_KINDS[family];
      for (let i = 0; i < batch.count; i += 1) {
        if (out.length >= limit) return out;
        const dx = batch.wx[i] - origin.wx;
        const dz = batch.wz[i] - origin.wz;
        if (dx * dx + dz * dz > r2) continue;
        const at = world(batch.wx[i], batch.wz[i]);
        out.push({
          // The family, its cell and its index: stable while the world
          // is, and the same shape the objects' own ids take.
          id: `${family}:${cell.cx},${cell.cz}:${i}`,
          kind,
          name: word,
          at,
          height: source.groundAt(at),
          size: batch.size[i],
        });
      }
    }
  }
  return out;
}

/**
 * The animals inside the radius, re-read every frame because they move.
 *
 * A creature's size is its CITED body length (`creatures/species.ts`),
 * not a drawn extent: the fill is a stand-in for the animal, and the
 * animal is 150 mm of worm or 2.5 mm of aphid whatever the renderer is
 * doing with it this frame.
 */
export function creatureThings(
  creatures: readonly CreatureState[],
  origin: WorldPoint,
  radius: number,
): SenseThing[] {
  const out: SenseThing[] = [];
  if (!(radius > 0)) return out;
  const r2 = radius * radius;
  for (const c of creatures) {
    if (distanceSquared(c.at, origin) > r2) continue;
    const species = CREATURE_SPECIES[c.species];
    if (species === undefined) continue;
    out.push({
      id: c.id,
      kind: 'creature',
      name: CREATURE_WORDS[c.species],
      at: c.at,
      height: c.height,
      // THIS animal's length, not its kind's. A worm is drawn at the body
      // it grew (`creatures/sizeRatio`), so a fill scaled to the species
      // would sit inside a big one and swallow a small one.
      size: unitsOfMm(c.lengthMm),
    });
  }
  return out;
}
