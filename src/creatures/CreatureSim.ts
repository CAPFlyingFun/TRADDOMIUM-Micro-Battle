/**
 * THE SIMULATION — every resident creature, streamed by cell, capped by
 * the rung, tiered by distance, thought and moved; and, since the
 * Creature Lab, driven by whoever the control ledger says.
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
 * PLACED, NOT GENERATED (the Lab, 2026-09-09). A creature may also be
 * PLACED (`spawn`): handed in as the options `newCreature` takes, made
 * here, and kept for as long as the simulation lives — never evicted,
 * because no cell owns it, and never forgotten by a species switched
 * off, because no cell can make it again. The Lab's five are placed
 * (`labWorld.labSpawns`), and a Lab built over a grassland box does not
 * want the island's worms generated in the cells around it, so
 * `populate: false` runs a simulation that streams nothing and holds
 * only what was placed. Placed and generated creatures are one
 * population to the cap, the tiers, the brains and the legs: the Lab
 * uses the production simulation, not a second one (the brief, §35).
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
 * WHO DRIVES WHOM (Joshua's brief, §4, §5, §28, §33). The ledger
 * (`control.ts`) is the SESSION's book of which creature each player
 * holds; it is handed in (`control`) with a way to ask each player what
 * they want (`intentOf`), and this class OBEYS it — it never writes it.
 * Every update begins by reading the book (`syncControl`): a creature
 * it newly names is TAKEN OVER, one it no longer names is HANDED BACK,
 * and both are events with a cost paid on the event and nothing per
 * frame. A possessed creature is FULL tier whatever its distance, is
 * never let go by the cap (it sorts nearest of all) and never evicted
 * with its cell; its needs tick and its senses run — a possessed worm
 * still knows the flood is coming — but `think` is NOT called for it:
 * the brain writes no word, no target and no height while a player has
 * the body, so there is nothing for the player's thumbs to fight (§5).
 * It is moved by the ONE integrator the AI uses (`applyDemand`), with
 * the player's intent where the brain's would be, and its behaviour
 * WORD is derived from that intent (`wordFor`) so the renderer animates
 * it and the needs tick as they do for everyone. A sense that raises
 * the alarm also writes the brain's away point into `target`; that
 * point is cleared again at once, because a target is the brain's leash
 * and the brain is not driving — the alarm it raised stands, and the
 * player sees it on the overlay. On release the body gets a tiny,
 * controlled rethink from where it is (`handBack`): no target, its
 * behaviour clock run out, its target height where it stands, and a
 * think on the very next update. Nothing teleports, nothing resets a
 * need, and the state is the same object with the same id throughout —
 * possession changes control authority and nothing else.
 *
 * PER-FRAME ALLOCATION: a `WorldPoint` per creature that moved, the
 * arrays the selection pass rebuilds twice a second, and the ledger's
 * records once per possession EVENT. No closures, no per-creature
 * objects, no sort per frame, and one reused `MutableIntent` for every
 * possessed body.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import type { PlayerId } from '../actor/PlayerId';
import { NEUTRAL_INTENT, type Intent } from '../input/Intent';
import { distanceSquared, type WorldPoint } from '../world/coords';
import type { SoilPoint } from '../world/soilTypes';
import type { PlantSource } from '../world/ecology/resources';
import { isObjectRung } from '../world/objects/budget';
import { cellAt, cellCentre, cellKey, cellsWithin, distanceToCell, type ObjectCellId } from '../world/objects/cells';
import { mulberry32, stableSeed } from '../world/random';
import type { ControlLedger } from './control';
import { applyDemand, newMutableIntent, playerDemand, wordFor, type MutableIntent } from './demand';
import { CALM_WEATHER, hostPlantOf, senseAlarm, senseFlood, think, thinkDue, thinkPending, tickNeeds } from './intent';
import { move } from './locomotion';
import { hostCandidates, populateCreatures } from './population';
import {
  CREATURE_IDS, CREATURE_SPECIES, assertSpeciesTable, sizeRatio, speciesProblems, unitsOfMm, type CreatureId, type CreatureSpecies,
} from './species';
import { unitsOfMetres } from './finder';
import { newCreature, type CreatureState, type NewCreatureOptions, type Tier } from './state';
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
  /**
   * Whether the wild population is generated per cell from the seed and
   * the habitat. Default true, the island. False for a simulation whose
   * creatures are all placed (`spawn`) — the Lab: nothing streams in,
   * nothing is generated, and nothing is evicted.
   */
  readonly populate?: boolean;
  /**
   * The session's book of who drives whom (the header). Absent: every
   * body gets its brain, which is also what an empty ledger means
   * (observer mode, the brief's §29).
   */
  readonly control?: ControlLedger;
  /**
   * What a player wants, asked once per possessed body per update: the
   * Lab hands in the local player's demand, a server would hand in each
   * player's. Absent, or a player it has nothing for: the body stands
   * still (`NEUTRAL_INTENT`).
   */
  readonly intentOf?: (player: PlayerId) => Intent;
}

/** Per-species counts, with who is driven: what `CreatureCounts` will carry once the world's shape gains it (the integration pass). */
export interface CreatureSimCounts extends CreatureCounts {
  /** Residents of this species a player holds. Always FULL tier, and counted there too. */
  readonly possessed: number;
}

/** The cost line, with the player's share: what `CreatureCost` will carry once the world's shape gains it (the integration pass). */
export interface CreatureSimCost extends CreatureCost {
  /** Milliseconds spent reading the players' demands, deriving their words and moving the possessed bodies, wall-clock, for the HUD. */
  readonly demandMs: number;
  /** Bodies moved by a player's demand in the last update. */
  readonly demanded: number;
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
  /** Placed by `spawn`: owned by no cell, never evicted, kept through a switch-off. */
  readonly placed: CreatureState[];
  /** Every generated and placed creature, rebuilt when the cells or the placed change. */
  readonly all: CreatureState[];
  dirty: boolean;
  /** The simulated set: the nearest, up to the cap. */
  readonly kept: CreatureState[];
  readonly keptIds: Set<string>;
  /** The near tier's accumulated step and the burrower's travel since its last bore, by creature id. */
  readonly acc: Map<string, number>;
  readonly bore: Map<string, { from: SoilPoint; distance: number }>;
  /** A plant creature's host, resolved once at generation or placement. */
  readonly hosts: Map<string, PlantSource | null>;
  readonly rand: () => number;
  d2: Float64Array;
  order: Int32Array;
  far: number;
  near: number;
  full: number;
  possessed: number;
}

const NO_COST: CreatureSimCost = Object.freeze({ thinkMs: 0, moveMs: 0, demandMs: 0, thoughts: 0, demanded: 0 });

export class CreatureSim implements CreatureSimulation {
  readonly species: readonly CreatureSpecies[];
  readonly burrows: BurrowGate;

  private readonly world: CreatureWorld;
  private readonly seed: number;
  private readonly now: () => number;
  private readonly populate: boolean;
  private readonly control: ControlLedger | null;
  private readonly intentOf: ((player: PlayerId) => Intent) | null;
  private readonly runs: Run[];
  private readonly byId = new Map<CreatureId, Run>();
  /** Every generated and placed creature by its id: the lookup `creature` answers from and the book is matched against. */
  private readonly index = new Map<string, CreatureState>();
  /** The creature ids this simulation has read from the book so far — a mirror kept so a change in the book is an event here, not a scan. */
  private readonly held = new Set<string>();
  /** The one demand object every possessed body is moved by, reused (the header). */
  private readonly demand: MutableIntent = newMutableIntent();
  private rung: string;
  private readonly resident: CreatureState[] = [];
  private lastStreamKey: string | null = null;
  private lastSelectAt: WorldPoint | null = null;
  private sinceSelect = 0;
  private sinceRetry = 0;
  /** The book changed: the cap, the tiers and the counts are re-run on this update rather than at the next half second. */
  private reselect = false;
  private lastCost: CreatureSimCost = NO_COST;

  // Bound once: the world may be a class, and a method torn off it loses its `this`.
  private readonly habitatAt: (at: WorldPoint) => ReturnType<CreatureWorld['habitatAt']>;
  private readonly plantsOf: (cx: number, cz: number) => readonly PlantSource[] | null;
  private readonly groundAt: (at: WorldPoint) => number;

  constructor(options: CreatureSimOptions) {
    assertSpeciesTable();
    this.world = options.world;
    this.seed = options.seed | 0;
    this.now = options.now ?? (() => 0);
    this.populate = options.populate ?? true;
    this.control = options.control ?? null;
    this.intentOf = options.intentOf ?? null;
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
      placed: [],
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
      possessed: 0,
    }));
    for (const run of this.runs) this.byId.set(run.species.id, run);
  }

  setEnabled(species: CreatureId, enabled: boolean): void {
    const run = this.byId.get(species);
    if (run === undefined || run.enabled === enabled) return;
    run.enabled = enabled;
    if (!enabled) {
      // The generated are forgotten — the cell makes them again — and the placed are kept (the header).
      for (const cell of run.cells.values()) for (const c of cell.creatures) this.index.delete(c.id);
      run.cells.clear();
      run.pending = [];
      run.waiting.length = 0;
      run.all.length = 0;
      run.kept.length = 0;
      run.keptIds.clear();
      run.acc.clear();
      run.bore.clear();
      for (const [id] of run.hosts) if (!this.index.has(id)) run.hosts.delete(id);
      run.far = run.near = run.full = run.possessed = 0;
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

  /**
   * PLACE a creature (the header): made here from the options
   * `newCreature` takes, indexed, its host resolved if its species has
   * hosts, and kept for the life of the simulation. Returns the state —
   * the one object the renderer, the ledger and a test will see. Refuses
   * a species this simulation does not run and an id it already holds:
   * an id is a creature, and two of one would be the duplication the
   * brief forbids (§36). One the book already names is taken over on the
   * spot.
   */
  spawn(options: NewCreatureOptions): CreatureState {
    const run = this.byId.get(options.species);
    if (run === undefined) throw new Error(`creatures/CreatureSim: spawn of "${options.species}", a species this simulation does not run`);
    if (this.index.has(options.id)) throw new Error(`creatures/CreatureSim: spawn of "${options.id}", an id this simulation already holds`);
    const c = newCreature(options);
    run.placed.push(c);
    this.index.set(c.id, c);
    if (run.species.population.hosts !== null) run.hosts.set(c.id, c.hostId === null ? null : hostPlantOf(c, this.world));
    if (this.held.has(c.id)) this.takeOver(c);
    run.dirty = true;
    return c;
  }

  /** The creature with this id — generated or placed — or null: the lookup a ledger's record is resolved by. */
  creature(id: string): CreatureState | null {
    return this.index.get(id) ?? null;
  }

  update(focus: WorldPoint, dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const t0 = this.now();
    this.syncControl();
    this.stream(focus, step);
    this.sinceSelect += step;
    let dirty = this.reselect;
    for (const run of this.runs) if (run.dirty) dirty = true;
    const moved = this.lastSelectAt === null || distanceSquared(focus, this.lastSelectAt) >= SELECT_MOVED * SELECT_MOVED;
    if (dirty || moved || this.sinceSelect >= SELECT_EVERY_S) this.select(focus);
    if (step === 0) {
      this.lastCost = { thinkMs: 0, moveMs: Math.max(0, this.now() - t0), demandMs: 0, thoughts: 0, demanded: 0 };
      return;
    }

    const world = this.world;
    const control = this.control;
    const intentOf = this.intentOf;
    const disturbances = world.disturbances();
    const weather = world.weather() ?? CALM_WEATHER;
    let thoughts = 0;
    let thinkMs = 0;
    let demanded = 0;
    let demandMs = 0;
    for (const run of this.runs) {
      if (!run.enabled) continue;
      const species = run.species;
      const kept = run.kept;
      const hosted = species.population.hosts !== null;
      // The bore is the SPECIES' here and is scaled per animal below: a
      // 250 mm worm is thicker than a 120 mm one and cuts a wider tunnel.
      const speciesBore = species.burrow === null ? 0 : unitsOfMm(species.burrow.boreMm) / 2;
      for (let i = 0; i < kept.length; i += 1) {
        const c = kept[i];
        // The book is read live, per body: a possessed creature is full tier by `takeOver` and `select`, and this is the one place it matters.
        const controller = control === null ? null : control.controllerOf(c.id);
        if (c.tier === 'far' && controller === null) continue;
        let creatureDt = step;
        if (c.tier === 'near' && controller === null) {
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
        if (thinkPending(c, species)) {
          // THE FLOOD SENSE RUNS AT THINK CADENCE, NOT AT `senseAlarm`'S.
          // A camera can cross a worm between two thinks; a flood cannot,
          // and the question costs a walk of the water's whole shoreline
          // per creature. So it is asked once per think, just BEFORE the
          // think that acts on it, and its time is the think's on the
          // cost line: it is the part of deciding that reads the water.
          // Near and full tiers only, as everything in this loop is —
          // the far tier neither thinks nor drowns. A possessed body
          // senses at the same cadence and takes the accumulator the same
          // way, so its flood sense stays a think's cost and not a
          // frame's; the think itself is the brain's, and the brain is
          // not driving.
          const a = this.now();
          senseFlood(c, species, world);
          thinkDue(c, species);
          if (controller === null) {
            think(c, species, world, run.rand, weather, hosted ? run.hosts.get(c.id) ?? null : null);
            thoughts += 1;
          }
          thinkMs += this.now() - a;
        }
        const beforeAt = c.at;
        const beforeHeight = c.height;
        if (controller === null) {
          move(c, species, world, creatureDt);
        } else {
          const a = this.now();
          // A sense may have written the brain's away point (the header): the alarm stands, the leash does not.
          c.target = null;
          const host = hosted ? run.hosts.get(c.id) ?? null : null;
          const demand = playerDemand(c, species, intentOf === null ? NEUTRAL_INTENT : intentOf(controller), world, this.demand, host);
          const word = wordFor(c, species, demand, world, host);
          if (word !== c.behaviour) {
            c.behaviour = word;
            c.behaviourS = 0;
          }
          applyDemand(c, species, world, demand, creatureDt);
          demanded += 1;
          demandMs += this.now() - a;
        }
        // A tunnel includes descent, surfacing and fleeing, not only the
        // behaviour named "burrow" — and a possessed worm's tunnel goes
        // through the same gate as its brain's: no private door for a
        // player either. Sweep between submissions so the last frame
        // cannot leave a bead or a wall across the passage.
        const bore = speciesBore * sizeRatio(c, species);
        if (bore > 0) {
          const travelled = Math.hypot(c.at.wx - beforeAt.wx, c.at.wz - beforeAt.wz, c.height - beforeHeight);
          if (travelled > 0) {
            let pending = run.bore.get(c.id);
            if (!pending) {
              pending = { from: { at: beforeAt, height: beforeHeight }, distance: 0 };
              run.bore.set(c.id, pending);
            }
            pending.distance += travelled;
            if (pending.distance >= bore - 1e-9) {
              this.burrows.bore(species.canEditTerrain, c.at, c.height, bore, pending.from);
              // A refused/out-of-range edit must not later become a long
              // teleport cut when the detailed soil window reaches it.
              pending.from = { at: c.at, height: c.height };
              pending.distance = 0;
            }
          }
        }
      }
    }
    const total = this.now() - t0;
    this.lastCost = { thinkMs, moveMs: Math.max(0, total - thinkMs - demandMs), demandMs, thoughts, demanded };
  }

  /**
   * READ THE BOOK (the header). What it no longer names is handed back;
   * what it newly names is taken over. `held` mirrors the book's ids —
   * every id, whether or not this simulation holds a body for it — so
   * the two are in step exactly when they are the same size, and the
   * records are only ever asked for, and allocated, when they are not.
   */
  private syncControl(): void {
    const control = this.control;
    if (control === null) return;
    const held = this.held;
    if (held.size > 0) {
      for (const id of held) {
        if (control.isPossessed(id)) continue;
        held.delete(id);
        const c = this.index.get(id);
        if (c !== undefined) this.handBack(c);
        this.reselect = true;
      }
    }
    if (held.size !== control.size) {
      for (const record of control.records()) {
        if (held.has(record.creature)) continue;
        held.add(record.creature);
        const c = this.index.get(record.creature);
        if (c !== undefined) this.takeOver(c);
        this.reselect = true;
      }
    }
  }

  /**
   * A player takes the body: the brain's leash is dropped (a plain
   * forward would otherwise snap to a target the player never chose —
   * `demand.ts`, the arrive rule), its clock is run out, and it is full
   * tier from this frame. Its word, its needs, its host and its place are
   * left exactly as they are.
   */
  private takeOver(c: CreatureState): void {
    c.target = null;
    c.behaviourUntilS = 0;
    c.tier = 'full';
  }

  /**
   * The brain gets the body back where it stands (the brief, §5: "AI
   * resumes naturally from the creature's CURRENT location/state"): no
   * target, the behaviour clock expired so whatever word the player left
   * it in is DONE, the target height where the body is, and a think on
   * the next update — a tiny, controlled rethink. Needs, alarm, host and
   * place are untouched; the tier is re-read by distance at the reselect.
   */
  private handBack(c: CreatureState): void {
    const run = this.byId.get(c.species);
    c.target = null;
    c.behaviourUntilS = 0;
    c.targetHeight = c.height;
    c.sinceThink = run === undefined ? c.sinceThink : run.species.thinkS;
  }

  /** Does a cell hold a body the book names? Such a cell is not evicted, whatever the focus does. */
  private holdsPossessed(cell: Cell): boolean {
    const control = this.control;
    if (control === null || control.size === 0) return false;
    const creatures = cell.creatures;
    for (let i = 0; i < creatures.length; i += 1) if (control.isPossessed(creatures[i].id)) return true;
    return false;
  }

  /** Bring the cells inside each species' reach in, nearest first, a few a frame, and let the far ones go. */
  private stream(focus: WorldPoint, dt: number): void {
    if (!this.populate) return;
    const key = cellKey(cellAt(focus));
    if (key !== this.lastStreamKey) {
      this.lastStreamKey = key;
      for (const run of this.runs) {
        if (!run.enabled) continue;
        const reach = unitsOfMetres(run.species.population.reachM);
        for (const [k, cell] of run.cells) {
          if (distanceToCell(focus, cell.id) > reach * EVICT_BEYOND && !this.holdsPossessed(cell)) this.evict(run, k, cell);
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
      normalAt: (at) => {
        const n = this.world.normalAt(at);
        return { x: n.nx, y: n.ny, z: n.nz };
      },
      cellNormalAt: () => {
        const n = this.world.normalAt(cellCentre(id));
        return { x: n.nx, y: n.ny, z: n.nz };
      },
    });
    run.cells.set(cellKey(id), { id, creatures });
    for (const c of creatures) {
      this.index.set(c.id, c);
      // The book may name a body before its cell was here: the claim was kept, and it is honoured now.
      if (this.held.has(c.id)) this.takeOver(c);
    }
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
      this.index.delete(c.id);
      run.hosts.delete(c.id);
      run.acc.delete(c.id);
      run.bore.delete(c.id);
    }
    run.dirty = true;
  }

  /** The cap and the tiers: keep the nearest up to the cap, with hysteresis, the possessed first of all; tier the kept by distance, the possessed full. */
  private select(focus: WorldPoint): void {
    const control = this.control;
    const anyHeld = control !== null && control.size > 0;
    this.lastSelectAt = focus;
    this.sinceSelect = 0;
    this.reselect = false;
    this.resident.length = 0;
    for (const run of this.runs) {
      run.far = run.near = run.full = run.possessed = 0;
      if (!run.enabled) {
        run.kept.length = 0;
        run.keptIds.clear();
        continue;
      }
      if (run.dirty) {
        run.all.length = 0;
        for (const cell of run.cells.values()) for (const c of cell.creatures) run.all.push(c);
        for (const c of run.placed) run.all.push(c);
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
        const c = all[i];
        // A possessed body is nearer than anything: the cap never lets it go.
        if (anyHeld && control.isPossessed(c.id)) {
          d2[i] = -1;
        } else {
          const raw = distanceSquared(c.at, focus);
          d2[i] = keptIds.has(c.id) ? raw * KEEP_HYSTERESIS * KEEP_HYSTERESIS : raw;
        }
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
        let tier: Tier;
        if (anyHeld && control.isPossessed(c.id)) {
          tier = 'full';
          run.possessed += 1;
        } else {
          const d = Math.sqrt(distanceSquared(c.at, focus));
          const wasFull = c.tier === 'full';
          const wasNear = c.tier !== 'far';
          if (d < fullR * (wasFull ? TIER_HYSTERESIS : 1)) tier = 'full';
          else if (d < nearR * (wasNear ? TIER_HYSTERESIS : 1)) tier = 'near';
          else tier = 'far';
        }
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

  counts(species: CreatureId): CreatureSimCounts {
    const run = this.byId.get(species);
    if (run === undefined) return { resident: 0, byTier: { far: 0, near: 0, full: 0 }, cap: 0, possessed: 0 };
    return {
      resident: run.kept.length,
      byTier: { far: run.far, near: run.near, full: run.full },
      cap: this.capOf(run.species),
      possessed: run.possessed,
    };
  }

  cost(): CreatureSimCost {
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

  /** Every generated creature of a species, kept or not, for a test. Placed creatures are not generated and are not counted here. */
  generated(species: CreatureId): number {
    let n = 0;
    const run = this.byId.get(species);
    if (run !== undefined) for (const cell of run.cells.values()) n += cell.creatures.length;
    return n;
  }

  /** How many creatures of a species were placed by `spawn`, for a test and a HUD. */
  placed(species: CreatureId): number {
    return this.byId.get(species)?.placed.length ?? 0;
  }
}
