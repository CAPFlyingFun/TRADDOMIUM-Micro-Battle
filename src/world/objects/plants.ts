/**
 * THE PLANTS OF A CELL, AS THE RESOURCE LAYER SEES THEM.
 *
 * `world/ecology/resources.ts` says what a resource is and that "a
 * resource is derived, not placed": nectar is a flower's, seeds are a
 * grass head's, litter is the forest floor's, a honeydew host is a
 * shrub something sits on. So the layer never asks for a position of
 * its own — it asks for the PLANTS, and this file is the one door from
 * a populated cell (`populate.ts`) to that question: which of a cell's
 * batches are plants, and each plant reduced to what a site is derived
 * from — its family, where it stands, how big it is, its variant (a
 * seed head, a flower's colour) and an id.
 *
 * EVERY PLANT HAS AN ID HERE, not only the major ones. A major family's
 * batch carries `family:cx,cz:site` already; a cosmetic family's does
 * not, because nothing in the renderer needs twenty thousand strings a
 * cell. The resource layer does need one — a site is addressed by the
 * plant it belongs to — so the same form is SYNTHESISED from the cell
 * and the plant's lattice slot, which is exactly what the populator
 * would have written had the family been major. Stable for the same
 * world, unique within it, and never null.
 *
 * BOUNDED BY RANK. A grassland cell holds up to twelve thousand blades
 * and nobody wants twelve thousand seed sources; the first
 * `PLANT_SOURCE_LIMIT` of each family BY RANK are returned — the same
 * order the renderer keeps blades in as distance and the cap thin them,
 * so the plants the layer knows are the plants the player can see, and
 * the set does not change when the limit is raised, only grows.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import { world } from '../coords';
import type { PlantSource } from '../ecology/resources';
import { OBJECT_FAMILIES, type ObjectFamily } from './families';
import type { CellPopulation, FamilyBatch } from './populate';

/** The families that are plants, in `OBJECT_FAMILIES` order: what the resource layer derives from. */
export const PLANT_FAMILIES: readonly ObjectFamily[] = Object.freeze(
  OBJECT_FAMILIES.filter((f) => f !== 'twig' && f !== 'stone' && f !== 'rock'),
);

/**
 * The most plants of one family one cell reports. GAME TUNING: enough
 * that a meadow has more seed heads and flowers than an ant could visit,
 * few enough that a 13x13 bubble of cells is not a hundred thousand
 * objects for the layer to index.
 */
export const PLANT_SOURCE_LIMIT = 160;

const PLANT_SET: ReadonlySet<ObjectFamily> = new Set(PLANT_FAMILIES);

/**
 * The plants of a cell for the families asked for, each family bounded
 * to its lowest-ranked `limitPerFamily`. Families that are not plants
 * are ignored; the output is in `OBJECT_FAMILIES` order and, within a
 * family, in ascending rank — the same for the same cell whatever order
 * the families were named in.
 */
export function plantSourcesOf(
  population: CellPopulation,
  families: readonly ObjectFamily[],
  limitPerFamily = PLANT_SOURCE_LIMIT,
): PlantSource[] {
  const wanted = new Set(families);
  const out: PlantSource[] = [];
  const { cx, cz } = population.cell;
  for (const family of OBJECT_FAMILIES) {
    if (!wanted.has(family) || !PLANT_SET.has(family)) continue;
    const batch = population.batches[family];
    if (batch.count === 0) continue;
    for (const i of lowestRanked(batch, limitPerFamily)) {
      out.push({
        family,
        at: world(batch.wx[i], batch.wz[i]),
        size: batch.size[i],
        id: batch.ids === null ? `${family}:${cx},${cz}:${batch.site[i]}` : batch.ids[i],
        variant: batch.variant[i],
      });
    }
  }
  return out;
}

/**
 * The indices of a batch's lowest-ranked `limit` objects, in ascending
 * rank; ties by site, so two equal ranks (a float32 hash can collide)
 * still come out in one order everywhere.
 */
function lowestRanked(batch: FamilyBatch, limit: number): number[] {
  const n = batch.count;
  const indices: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) indices[i] = i;
  indices.sort((a, b) => batch.rank[a] - batch.rank[b] || batch.site[a] - batch.site[b]);
  return limit < n ? indices.slice(0, Math.max(0, limit)) : indices;
}
