/**
 * THE SIMULATION — every resident creature, streamed by cell, capped by
 * the rung, tiered by distance, thought and moved.
 *
 * WHAT IT OWNS: the creature states, and nothing else. The world reaches
 * it as one read-only `CreatureWorld`; the only write it has toward the
 * ground is the burrow gate, and the gate refuses everything but a
 * species the table names as an editor. A server can construct this
 * class over the same world queries and run the same `update`, which is
 * why `now` is injected (for the HUD's cost line and nothing else) and
 * `dt` is taken as given: simulation seconds, never wall-clock.
 *
 * STREAMING, THE OBJECTS' WAY. Each species has a reach; the cells that
 * overlap it are generated nearest first, at most two a frame across all
 * species, and evicted a quarter-reach beyond it so a camera hovering on
 * a line does not generate and forget the same cell every frame. A host
 * species' cell whose plants are not there yet is not generated as
 * empty — that would be a cell the world had answered differently to —
 * but asked again a second later.
 *
 * CAPS ARE MAXIMUMS. A rung's cap is the most of a species this device
 * simulates, never how many exist: when the cells generate more, the
 * nearest are kept, and a creature already kept counts as fifteen
 * percent nearer than it is, so a newcomer must be genuinely closer to
 * take its place and the set does not flicker at the cap. A creature
 * beyond the cap is not dropped from the world; it waits in its cell,
 * frozen, and resumes where it stood when it is near again.
 *
 * TIERS. Far: exists, counts, nothing else. Near: thinks every `thinkS`
 * and moves at ten hertz, with the frames' `dt` accumulated so distance
 * is conserved. Full: thinks every `thinkS` and moves every frame. The
 * lines are the species' own, with ten percent of hysteresis.
 *
 * PER-FRAME ALLOCATION: a `WorldPoint` per creature that moved, and the
 * arrays the selection pass rebuilds twice a second. No closures, no
 * per-creature objects, no sort per frame.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distanceSquared, type WorldPoint } from '../world/coords';
import type { PlantSource } from '../world/ecology/resources';
import { isObjectRung } from '../world/objects/budget';
import { cellAt, cellKey, cellsWithin, distanceToCell, type ObjectCellId } from '../world/objects/cells';
import { mulberry32, stableSeed } from '../world/random';
import { CALM_WEATHER, senseAlarm, think, thinkDue, tickNeeds } from './intent';
import { move } from './locomotion';
import { hostCandidates, populateCreatures } from './population';
import {
  CREATURE_IDS, CREATURE_SPECIES, assertSpeciesTable, speciesProblems, unitsOfMm, type CreatureId, type CreatureSpecies,
} from './species';
import { unitsOfMetres } from './finder';
import type { CreatureState, Tier } from './state';
import { burrowGate, NO_BURROW_EDITOR, type BurrowEditor, type BurrowGate } from './terrainEdit';
import type { CreatureCost, CreatureCounts, CreatureSimulation, CreatureWorld } from './world';

export interface CreatureSimOptions {
  readonly world: CreatureWorld;
  /** The world seed (`world/objects/seed.ts`): the same island, the same animals. */
  readonly seed: number;
  /** The terrain-edit seam. Default: the unbuilt one, which changes nothing and says so. */
  readonly editor?: BurrowEditor;
  /** The detail rung's name. Default `medium`, as the objects' budget defaults. */
  readonly rung?: string;
  /** The species table, for a test that wants a smaller cap or a nearer tier. Default the three. */
  readonly species?: readonly CreatureSpecies[];
  /** A millisecond clock for the cost line only. Default a clock that never moves. */
  readonly now?: () => number;
}

/** The near tier moves at this step: ten hertz. GAME TUNING. */
export const NEAR_STEP_S = 0.1;
/** Cells generated per update, across all species, nearest first. GAME TUNING, the objects' own pacing. */
export const CELLS_PER_UPDATE = 2;
/** A cell is evicted beyond this many reaches. GAME TUNING: a quarter-reach of slack. */
export const EVICT_BEYOND = 1.25;
/** A kept creature counts as this fraction of its distance when the cap bites. GAME TUNING: the anti-flicker margin. */
export const KEEP_HYSTERESIS = 0.85;
/** A creature leaves a tier this far past the line it entered at. GAME TUNING. */
export const TIER_HYSTERESIS = 1.1;
/** The selection pass (cap and tiers) runs at least this often, and whenever the focus has moved `SELECT_MOVED`. */
const SELECT_EVERY_S = 0.5;
const SELECT_MOVED = 50;
/** How often a host species' cell with no plants yet is asked for again, seconds. */
const RETRY_WAITING_S = 1;

interface Cell {
  readonly id: ObjectCellId;
  readonly creatures: CreatureState[];
}

/** One species' residency. */
interface Run {
  readonly species: CreatureSpecies;
  enabled: boolean;
  readonly cells: Map<string, Cell>;
  /** Cells inside the reach not yet generated, nearest first. */
  pending: ObjectCellId[];
  /** Host-species cells whose plants were not there: asked again after `RETRY_WAITING_S`. */
  readonly waiting: ObjectCellId[];
  /** Every generated creature, rebuilt when the cells change. */
  readonly all: CreatureState[];
  dirty: boolean;
  /** The simulated set: the nearest, up to the cap. */
  readonly kept: CreatureState[];
  readonly keptIds: Set<string>;
  /** The near tier's accumulated step and the burrower's travel since its last bore, by creature id. */
  readonly acc: Map<string, number>;
  readonly bore: Map<string, number>;
  /** A plant creature's host, resolved once at generation. */
  readonly hosts: Map<string, PlantSource | null>;
  readonly rand: () => number;
  d2: Float64Array;
  order: Int32Array;
  far: number;
  near: number;
  full: number;
}

export class CreatureSim implements CreatureSimulation {
  readonly species: readonly CreatureSpecies[];
  readonly burrows: BurrowGate;

  private readonly world: CreatureWorld;
  private readonly seed: number;
  private readonly now: () => number;
  private readonly runs: Run[];
  private readonly byId = new Map<CreatureId, Run>();
  private rung: string;
  private readonly resident: CreatureState[] = [];
  private lastStreamKey: string | null = null;
  private lastSelectAt: WorldPoint | null = null;
  private sinceSelect = 0;
  private sinceRetry = 0;
  private lastCost: CreatureCost = Object.freeze({ thinkMs: 0, moveMs: 0, thoughts: 0 });

  // Bound once: the world may be a class, and a method torn off it loses its `this`.
  private readonly habitatAt: (at: WorldPoint) => ReturnType<CreatureWorld['habitatAt']>;
  private readonly plantsOf: (cx: number, cz: number) => readonly PlantSource[] | null;
  private readonly groundAt: (at: WorldPoint) => number;

  constructor(options: CreatureSimOptions) {
    assertSpeciesTable();
    this.world = options.world;
    this.seed = options.seed | 0;
    this.now = options.now ?? (() => 0);
    this.rung = options.rung ?? 'medium';
    this.burrows = burrowGate(options.editor ?? NO_BURROW_EDITOR);
    this.habitatAt = (at) => this.world.habitatAt(at);
    this.plantsOf = (cx, cz) => this.world.plantsOf(cx, cz);
    this.groundAt = (at) => this.world.groundAt(at);
    const table = options.species ?? CREATURE_IDS.map((id) => CREATURE_SPECIES[id]);
    for (const species of table) {
      const problems = speciesProblems(species);
      if (problems.length > 0) throw new Error(problems.join('\n'));
    }
    this.species = Object.freeze([...table]);
    this.runs = table.map((species, i) => ({
      species,
      enabled: true,
      cells: new Map(),
      pending: [],
      waiting: [],
      all: [],
      dirty: false,
      kept: [],
      keptIds: new Set(),
      acc: new Map(),
      bore: new Map(),
      hosts: new Map(),
      // One sequence per species from the seed, so two runs of one world decide alike.
      rand: mulberry32(stableSeed(this.seed, i, 0x7_c0de)),
      d2: new Float64Array(64),
      order: new Int32Array(64),
      far: 0,
      near: 0,
      full: 0,
    }));
    for (const run of this.runs) this.byId.set(run.species.id, run);
  }

  setEnabled(species: CreatureId, enabled: boolean): void {
    const run = this.byId.get(species);
    if (run === undefined || run.enabled === enabled) return;
    run.enabled = enabled;
    if (!enabled) {
      run.cells.clear();
      run.pending = [];
      run.waiting.length = 0;
      run.all.length = 0;
      run.kept.length = 0;
      run.keptIds.clear();
      run.acc.clear();
      run.bore.clear();
      run.hosts.clear();
      run.far = run.near = run.full = 0;
    }
    run.dirty = true;
    // Stream again from wherever the focus is next.
    this.lastStreamKey = null;
  }

  isEnabled(species: CreatureId): boolean {
    return this.byId.get(species)?.enabled ?? false;
  }

  setRung(rung: string): void {
    if (rung === this.rung) return;
    this.rung = rung;
    for (const run of this.runs) run.dirty = true;
  }

  /** The rung's cap for a species: a maximum. An unknown rung name reads as `medium`, as the objects' budget does. */
  private capOf(species: CreatureSpecies): number {
    return species.population.caps[isObjectRung(this.rung) ? this.rung : 'medium'];
  }

  update(focus: WorldPoint, dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const t0 = this.now();
    this.stream(focus, step);
    this.sinceSelect += step;
    let dirty = false;
    for (const run of this.runs) if (run.dirty) dirty = true;
    const moved = this.lastSelectAt === null || distanceSquared(focus, this.lastSelectAt) >= SELECT_MOVED * SELECT_MOVED;
    if (dirty || moved || this.sinceSelect >= SELECT_EVERY_S) this.select(focus);
    if (step === 0) {
      this.lastCost = { thinkMs: 0, moveMs: Math.max(0, this.now() - t0), thoughts: 0 };
      return;
    }

    const world = this.world;
    const disturbances = world.disturbances();
    const weather = world.weather() ?? CALM_WEATHER;
    let thoughts = 0;
    let thinkMs = 0;
    for (const run of this.runs) {
      if (!run.enabled) continue;
      const species = run.species;
      const kept = run.kept;
      const hosted = species.population.hosts !== null;
      const bore = species.burrow === null ? 0 : unitsOfMm(species.burrow.boreMm) / 2;
      for (let i = 0; i < kept.length; i += 1) {
        const c = kept[i];
        if (c.tier === 'far') continue;
        let creatureDt = step;
        if (c.tier === 'near') {
          const acc = (run.acc.get(c.id) ?? 0) + step;
          // Six sixtieths do not sum to a tenth in floating point: an epsilon keeps the near tier at ten hertz.
          if (acc < NEAR_STEP_S - 1e-6) {
            run.acc.set(c.id, acc);
            continue;
          }
          run.acc.set(c.id, 0);
          creatureDt = acc;
        }
        tickNeeds(c, species, creatureDt);
        senseAlarm(c, species, disturbances);
        if (thinkDue(c, species)) {
          const a = this.now();
          think(c, species, world, run.rand, weather, hosted ? run.hosts.get(c.id) ?? null : null);
          thinkMs += this.now() - a;
          thoughts += 1;
        }
        const travelled = move(c, species, world, creatureDt);
        // THE ONE DOOR TO THE GROUND: a burrower, burrowing, once per half-bore of travel, through the gate.
        if (bore > 0 && c.behaviour === 'burrow' && travelled > 0) {
          const since = (run.bore.get(c.id) ?? 0) + travelled;
          if (since >= bore) {
            run.bore.set(c.id, 0);
            this.burrows.bore(species.canEditTerrain, c.at, c.height, bore);
          } else {
            run.bore.set(c.id, since);
          }
        }
      }
    }
    const total = this.now() - t0;
    this.lastCost = { thinkMs, moveMs: Math.max(0, total - thinkMs), thoughts };
  }

  /** Bring the cells inside each species' reach in, nearest first, a few a frame, and let the far ones go. */
  private stream(focus: WorldPoint, dt: number): void {
    const key = cellKey(cellAt(focus));
    if (key !== this.lastStreamKey) {
      this.lastStreamKey = key;
      for (const run of this.runs) {
        if (!run.enabled) continue;
        const reach = unitsOfMetres(run.species.population.reachM);
        for (const [k, cell] of run.cells) {
          if (distanceToCell(focus, cell.id) > reach * EVICT_BEYOND) this.evict(run, k, cell);
        }
        run.pending = cellsWithin(focus, reach).filter((id) => !run.cells.has(cellKey(id)));
        run.waiting.length = 0;
      }
    }
    this.sinceRetry += dt;
    if (this.sinceRetry >= RETRY_WAITING_S) {
      this.sinceRetry = 0;
      for (const run of this.runs) {
        if (!run.enabled || run.waiting.length === 0) continue;
        for (const id of run.waiting) run.pending.push(id);
        run.waiting.length = 0;
      }
    }
    // ROUND-ROBIN across species, each taking its own nearest cell, so a
    // frame's budget is not spent twice on the first species in the table.
    let budget = CELLS_PER_UPDATE;
    let progress = true;
    while (budget > 0 && progress) {
      progress = false;
      for (const run of this.runs) {
        if (budget <= 0) break;
        if (!run.enabled || run.pending.length === 0) continue;
        const hosted = run.species.population.hosts !== null;
        while (run.pending.length > 0) {
          const id = run.pending.shift() as ObjectCellId;
          if (run.cells.has(cellKey(id))) continue;
          if (hosted && this.world.plantsOf(id.cx, id.cz) === null) {
            run.waiting.push(id);
            continue;
          }
          this.generate(run, id);
          budget -= 1;
          progress = true;
          break;
        }
      }
    }
  }

  private generate(run: Run, id: ObjectCellId): void {
    const creatures = populateCreatures(id, run.species, {
      seed: this.seed, habitatAt: this.habitatAt, plantsOf: this.plantsOf, groundAt: this.groundAt,
    });
    run.cells.set(cellKey(id), { id, creatures });
    if (run.species.population.hosts !== null && creatures.length > 0) {
      const plants = this.world.plantsOf(id.cx, id.cz);
      const byId = new Map<string, PlantSource>();
      if (plants !== null) for (const p of hostCandidates(plants, run.species)) if (p.id !== null) byId.set(p.id, p);
      for (const c of creatures) run.hosts.set(c.id, c.hostId === null ? null : byId.get(c.hostId) ?? null);
    }
    run.dirty = true;
  }

  private evict(run: Run, key: string, cell: Cell): void {
    run.cells.delete(key);
    for (const c of cell.creatures) {
      run.hosts.delete(c.id);
      run.acc.delete(c.id);
      run.bore.delete(c.id);
    }
    run.dirty = true;
  }

  /** The cap and the tiers: keep the nearest up to the cap, with hysteresis; tier the kept by distance. */
  private select(focus: WorldPoint): void {
    this.lastSelectAt = focus;
    this.sinceSelect = 0;
    this.resident.length = 0;
    for (const run of this.runs) {
      run.far = run.near = run.full = 0;
      if (!run.enabled) {
        run.kept.length = 0;
        run.keptIds.clear();
        continue;
      }
      if (run.dirty) {
        run.all.length = 0;
        for (const cell of run.cells.values()) for (const c of cell.creatures) run.all.push(c);
        run.dirty = false;
      }
      const all = run.all;
      const n = all.length;
      if (run.d2.length < n) {
        run.d2 = new Float64Array(Math.max(n, run.d2.length * 2));
        run.order = new Int32Array(run.d2.length);
      }
      const cap = this.capOf(run.species);
      const keptIds = run.keptIds;
      const d2 = run.d2;
      for (let i = 0; i < n; i += 1) {
        const raw = distanceSquared(all[i].at, focus);
        d2[i] = keptIds.has(all[i].id) ? raw * KEEP_HYSTERESIS * KEEP_HYSTERESIS : raw;
        run.order[i] = i;
      }
      let keep = n;
      if (n > cap) {
        run.order.subarray(0, n).sort((a, b) => d2[a] - d2[b]);
        keep = cap;
      }
      const kept = run.kept;
      kept.length = 0;
      for (let j = 0; j < keep; j += 1) kept.push(all[run.order[j]]);
      keptIds.clear();
      for (let j = 0; j < kept.length; j += 1) keptIds.add(kept[j].id);
      for (let i = 0; i < n; i += 1) if (!keptIds.has(all[i].id)) all[i].tier = 'far';

      const fullR = unitsOfMetres(run.species.population.fullM);
      const nearR = unitsOfMetres(run.species.population.nearM);
      for (let j = 0; j < kept.length; j += 1) {
        const c = kept[j];
        const d = Math.sqrt(distanceSquared(c.at, focus));
        const wasFull = c.tier === 'full';
        const wasNear = c.tier !== 'far';
        let tier: Tier;
        if (d < fullR * (wasFull ? TIER_HYSTERESIS : 1)) tier = 'full';
        else if (d < nearR * (wasNear ? TIER_HYSTERESIS : 1)) tier = 'near';
        else tier = 'far';
        c.tier = tier;
        if (tier === 'full') run.full += 1;
        else if (tier === 'near') run.near += 1;
        else run.far += 1;
        this.resident.push(c);
      }
    }
  }

  creatures(): readonly CreatureState[] {
    return this.resident;
  }

  counts(species: CreatureId): CreatureCounts {
    const run = this.byId.get(species);
    if (run === undefined) return { resident: 0, byTier: { far: 0, near: 0, full: 0 }, cap: 0 };
    return {
      resident: run.kept.length,
      byTier: { far: run.far, near: run.near, full: run.full },
      cap: this.capOf(run.species),
    };
  }

  cost(): CreatureCost {
    return this.lastCost;
  }

  /** How many cells of a species are generated, for a test. */
  cellCount(species: CreatureId): number {
    return this.byId.get(species)?.cells.size ?? 0;
  }

  /** How many cells of a species are waiting to be generated, for a test. */
  pendingCells(species: CreatureId): number {
    const run = this.byId.get(species);
    return run === undefined ? 0 : run.pending.length + run.waiting.length;
  }

  /** Every generated creature of a species, kept or not, for a test. */
  generated(species: CreatureId): number {
    let n = 0;
    const run = this.byId.get(species);
    if (run !== undefined) for (const cell of run.cells.values()) n += cell.creatures.length;
    return n;
  }
}
