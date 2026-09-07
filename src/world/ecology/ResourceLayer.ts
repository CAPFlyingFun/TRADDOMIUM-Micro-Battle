/**
 * THE RESOURCE LAYER — the resident set of derived cells around a
 * focus, streamed in nearest first and let go when far, with the water's
 * edges kept current and everything else derived once.
 *
 * What `flora/WorldObjects` is to the populator, this is to `derive.ts`:
 * the thing that decides WHICH cells are derived and holds the answers,
 * against a pure function that decides WHAT they hold. It owns its
 * residents and its clock and nothing else; the world reaches it as one
 * read-only `EcologyWorld`, and it mutates nothing it did not make.
 *
 * ─── two clocks, deliberately ────────────────────────────────────────
 *
 * `update` takes the SIMULATION dt — the clamped step, the one the
 * creatures move by — and accumulates it into its own seconds, which
 * are what the water refresh interval is counted in. The cost is
 * measured on an INJECTED `now`, wall-clock, that defaults to a clock
 * that always reads zero: core may not read the browser's clock, and a
 * cost readout that the simulation cannot see cannot feed back into it
 * (ARCHITECTURE §2.4). The integration pass hands `performance.now`
 * in, bound, from the edge.
 *
 * ─── what is refreshed and what is not ───────────────────────────────
 *
 * Rain moves the water and the flowers do not move. So a resident
 * cell's plant sites are derived ONCE, when the cell arrives, and kept
 * as the same objects for as long as it is resident — a creature that
 * holds a site holds a site — while its water-edge sites are re-derived
 * every `waterRefreshS` simulation seconds, a few cells an update,
 * oldest first, so the cost of a refresh is spread across frames rather
 * than spent in one. A cell's plant sites and its water sites are
 * bounded separately (`derive.ts`) for exactly this reason: a refresh
 * cannot change which flowers exist.
 *
 * ─── waiting for the plants ──────────────────────────────────────────
 *
 * A cell whose `plantsOf` is null is not derived: the objects have not
 * generated it, and deriving it empty would cache "no flowers here" for
 * a meadow. It stays pending, is asked again each update (one lookup),
 * and is derived the update its plants appear. The objects' bubble and
 * this one are streamed by the same `cellsWithin`, so a cell inside this
 * radius is normally inside theirs; where it is not, `pending()` says
 * so and nothing pretends.
 *
 * Pure: no three, no DOM. `src/world/` is core.
 */
import type { WorldPoint } from '../coords';
import { cellAt, cellKey, cellsWithin, distanceToCell, type ObjectCellId } from '../objects/cells';
import { derivePlantSites, deriveWaterEdgeSites } from './derive';
import { RESOURCE_KINDS, type CellResources, type EcologyWorld, type ResourceKind, type ResourceSite } from './resources';

export interface ResourceLayerOptions {
  readonly world: EcologyWorld;
  /** The world seed (`objects/seed.ts`). Folded into every hash. */
  readonly seed: number;
  /** New cells derived per `update`, nearest first; and, separately, resident cells whose water is refreshed per update. Default 2. */
  readonly cellsPerUpdate?: number;
  /** Simulation seconds between re-derivations of a cell's water-edge sites. Default 10. */
  readonly waterRefreshS?: number;
  /** A wall clock in milliseconds, for `cost` only. Default: a clock that reads zero, because core may not read the browser's. */
  readonly now?: () => number;
}

/** What an update costs, wall-clock, for a HUD — never fed back into the simulation. */
export interface ResourceCost {
  readonly meanMs: number;
  readonly peakMs: number;
}

/** Cells farther than this multiple of the radius are let go. GAME TUNING: hysteresis so a focus on a cell line does not churn. */
export const EVICT_BEYOND = 1.25;

interface Resident extends ObjectCellId {
  readonly key: string;
  /** Derived once, kept as the same objects while resident. */
  readonly plantSites: readonly ResourceSite[];
  /** Plant sites and the current water-edge sites together: what `sitesOf` hands out. */
  cell: CellResources;
  /** Layer seconds at which the water-edge sites were last derived. */
  waterAtS: number;
}

export class ResourceLayer {
  private readonly ecology: EcologyWorld;
  private readonly seed: number;
  private readonly cellsPerUpdate: number;
  private readonly waterRefreshS: number;
  private readonly now: () => number;

  /** Insertion order is derivation order: the oldest resident is found first. */
  private readonly resident = new Map<string, Resident>();
  /** Cells inside the radius not yet resident, nearest first, rebuilt when the focus crosses a cell line. */
  private wanted: ObjectCellId[] = [];
  private focusCx = Number.NaN;
  private focusCz = Number.NaN;
  private lastRadius = Number.NaN;
  private simS = 0;

  private updates = 0;
  private totalMs = 0;
  private peakMs = 0;

  constructor(options: ResourceLayerOptions) {
    const cells = options.cellsPerUpdate ?? 2;
    const refresh = options.waterRefreshS ?? 10;
    if (!Number.isInteger(cells) || cells < 1) throw new Error(`ResourceLayer: cellsPerUpdate must be a positive integer, got ${cells}`);
    if (!(Number.isFinite(refresh) && refresh > 0)) throw new Error(`ResourceLayer: waterRefreshS must be positive, got ${refresh}`);
    this.ecology = options.world;
    this.seed = options.seed;
    this.cellsPerUpdate = cells;
    this.waterRefreshS = refresh;
    this.now = options.now ?? (() => 0);
  }

  /**
   * Advance by `dt` simulation seconds around `focus`: let go of cells
   * beyond `radius × EVICT_BEYOND`, derive up to `cellsPerUpdate` new
   * cells inside `radius` nearest first, and refresh the water-edge
   * sites of up to `cellsPerUpdate` resident cells whose refresh is due.
   */
  update(focus: WorldPoint, radius: number, dt: number): void {
    const t0 = this.now();
    if (Number.isFinite(dt) && dt > 0) this.simS += dt;
    const at = cellAt(focus);
    if (at.cx !== this.focusCx || at.cz !== this.focusCz || radius !== this.lastRadius) {
      this.focusCx = at.cx;
      this.focusCz = at.cz;
      this.lastRadius = radius;
      this.evict(focus, radius);
      // `cellsWithin` allocates and sorts; it is called when the focus
      // has crossed a cell line or the radius changed, not every frame.
      const all = cellsWithin(focus, radius);
      this.wanted = all.filter((id) => !this.resident.has(cellKey(id)));
    }
    this.stream();
    this.refreshWater();
    const ms = this.now() - t0;
    this.updates += 1;
    this.totalMs += ms;
    if (ms > this.peakMs) this.peakMs = ms;
  }

  /** The sites of a resident cell, or null for one that is not. */
  sitesOf(cx: number, cz: number): CellResources | null {
    return this.resident.get(`${cx},${cz}`)?.cell ?? null;
  }

  /**
   * The nearest resident site of any of `kinds` within `radius` of `at`,
   * or null. Scans resident cells whose square is within the radius and
   * allocates nothing: the answer is the site object itself.
   */
  nearest(at: WorldPoint, kinds: readonly ResourceKind[], radius: number): ResourceSite | null {
    if (kinds.length === 0 || !(radius >= 0) || !Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return null;
    let best: ResourceSite | null = null;
    let bestD2 = radius * radius;
    for (const r of this.resident.values()) {
      if (distanceToCell(at, r) > radius) continue;
      const sites = r.cell.sites;
      for (let i = 0; i < sites.length; i += 1) {
        const s = sites[i];
        if (!kinds.includes(s.kind)) continue;
        const dx = s.at.wx - at.wx;
        const dz = s.at.wz - at.wz;
        const d2 = dx * dx + dz * dz;
        if (d2 > bestD2) continue;
        if (best !== null && d2 === bestD2) continue;
        best = s;
        bestD2 = d2;
      }
    }
    return best;
  }

  /** Sites per kind across every resident cell, every kind named even when zero — the shape a HUD line reads. */
  counts(): Readonly<Record<ResourceKind, number>> {
    const out = zeroCounts();
    for (const r of this.resident.values()) {
      for (const s of r.cell.sites) out[s.kind] += 1;
    }
    return out;
  }

  residentCells(): number {
    return this.resident.size;
  }

  /** Cells inside the radius not yet derived — including those waiting for their plants. */
  pending(): number {
    return this.wanted.length;
  }

  get cost(): ResourceCost {
    return { meanMs: this.updates === 0 ? 0 : this.totalMs / this.updates, peakMs: this.peakMs };
  }

  resetCost(): void {
    this.updates = 0;
    this.totalMs = 0;
    this.peakMs = 0;
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  private evict(focus: WorldPoint, radius: number): void {
    const beyond = radius * EVICT_BEYOND;
    for (const r of this.resident.values()) {
      if (distanceToCell(focus, r) > beyond) this.resident.delete(r.key);
    }
  }

  /** Derive up to `cellsPerUpdate` wanted cells, nearest first, leaving the ones whose plants are not generated for next time. */
  private stream(): void {
    if (this.wanted.length === 0) return;
    let derived = 0;
    const left: ObjectCellId[] = [];
    for (const id of this.wanted) {
      if (derived >= this.cellsPerUpdate) {
        left.push(id);
        continue;
      }
      const plants = this.ecology.plantsOf(id.cx, id.cz);
      if (plants === null) {
        left.push(id);
        continue;
      }
      const key = cellKey(id);
      const plantSites = derivePlantSites(id.cx, id.cz, plants, this.ecology, this.seed);
      const water = deriveWaterEdgeSites(id.cx, id.cz, this.ecology.water, this.seed);
      this.resident.set(key, {
        cx: id.cx, cz: id.cz, key, plantSites,
        cell: joined(id, plantSites, water),
        waterAtS: this.simS,
      });
      derived += 1;
    }
    this.wanted = left;
  }

  /** Re-derive the water-edge sites of up to `cellsPerUpdate` resident cells whose refresh is due, oldest first. */
  private refreshWater(): void {
    const water = this.ecology.water;
    if (water === null) return;
    let done = 0;
    for (const r of this.resident.values()) {
      if (done >= this.cellsPerUpdate) break;
      if (this.simS - r.waterAtS < this.waterRefreshS) continue;
      r.cell = joined(r, r.plantSites, deriveWaterEdgeSites(r.cx, r.cz, water, this.seed));
      r.waterAtS = this.simS;
      done += 1;
    }
  }
}

function joined(id: ObjectCellId, plantSites: readonly ResourceSite[], water: readonly ResourceSite[]): CellResources {
  return { cx: id.cx, cz: id.cz, sites: water.length === 0 ? plantSites : plantSites.concat(water) };
}

function zeroCounts(): Record<ResourceKind, number> {
  const out = {} as Record<ResourceKind, number>;
  for (const kind of RESOURCE_KINDS) out[kind] = 0;
  return out;
}
