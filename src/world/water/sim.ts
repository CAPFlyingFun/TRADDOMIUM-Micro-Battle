/**
 * VIRTUAL-PIPES SHALLOW WATER over a patch of the real island.
 *
 * Mei, Decaudin & Hu, "Fast Hydraulic Erosion Simulation and
 * Visualization on GPU" (PG'07) — steps 1, 2 and 5 of their five, and
 * deliberately not 3 and 4.
 *
 * WHY HALF THE PAPER, PERMANENTLY. Their steps 3 and 4 erode the bed and
 * carry the sediment, which means WRITING A HEIGHT every tick by
 * definition. This island is surveyed Kauaʻi and the whole point of the
 * elevation pipeline is that it stays surveyed (CLAUDE.md: "The terrain
 * is not ours to move"; carving has been tried four times in this
 * lineage and is out of v1 by Joshua's decision of 2026-09-04). Dropping
 * them is not a compromise either — the paper's own stated weakness,
 * "difficulties in simulating the erosion process on very flat terrain",
 * which is every coastal plain here, lives entirely inside the two steps
 * we skip.
 *
 * So the bed is an INPUT. This module reads it, floods it, and never
 * writes it; `tests/worldWaterSim.test.ts` copies the bed and compares
 * it byte for byte after thousands of steps, so the rule is a test
 * rather than a promise.
 *
 * THE MODEL. Four virtual pipes per cell join it to its von Neumann
 * neighbours. Each pipe accelerates on the difference in SURFACE height
 * — bed + water, never bed alone — so water climbs nothing, settles flat
 * in a basin, and spills at the lowest rim on its own. That is the whole
 * reason a pool finds its own outlet without being told where one is,
 * and it is the property a drawn ribbon of water can never have.
 *
 * WHY THE SCALING STEP IS NOT OPTIONAL. A cell can be asked for more
 * water than it holds by four pipes that each looked at it alone; left
 * alone that writes a negative depth and the grid detonates within a few
 * hundred steps. Every outflow from a cell is scaled by one factor K so
 * the four together take at most what is there. The paper flags this as
 * a source of instability in its own right, since scaling one cell's
 * outflow does not adjust its neighbours' inflow — hence the
 * conservative timestep below rather than the largest CFL allows.
 *
 * SIZED FROM THEIR TABLE 1, not from optimism. Cycles per second is not
 * frame rate: each cycle advances the world by dt, so simulated seconds
 * per wall second is CPS x dt. On their 2007 GPU that is 403 x 0.002 =
 * 0.81 at 256², and 59 x 0.0005 = 0.03 at 1024² — the larger grids are
 * interactive to watch and nowhere near real time. Only 256² runs at the
 * speed a player stands in, and v0 measured that window at 1.00x real
 * time in a browser. So: 256², and the cell size is what buys the detail
 * — at 1 m a 5.5 m stream is five cells across, where Beyond Extinction's
 * 10 m cells could not hold one at all.
 *
 * WHAT CHANGED FROM v0 (`src/world/waterSim.ts` on `legacy/v0-main`),
 * and why each change is a change rather than a preference:
 *
 *  - THE BED AND THE DEPTHS ARE PRIVATE. v0 exposed both as `readonly`
 *    fields, which stops reassignment and not one single write; its own
 *    window then reached in and wrote `sim.depth[i] += BASEFLOW * step`
 *    from outside. Here water enters through `step(feed)` and leaves
 *    through a read-only `grid()` view, so "a module mutates only state
 *    it owns" (CLAUDE.md) is enforced by the type rather than by manners.
 *  - THE WINDOW KNOWS WHERE IT IS. v0's solver was placeless and its
 *    world position lived in `IslandWater`, which is why the point query
 *    lived there too — and that file also owned the sea's branch of the
 *    query, so disposing the river took the ocean with it (the water
 *    audit's §13 B1). Here the patch owns its own origin, answers
 *    `spotAt` for its own cells as an ordinary `WaterSource<'fresh'>`,
 *    and knows nothing about the sea.
 *  - THE FEEDS ARE NAMED. `rainPerSecond` on everything and
 *    `baseflowPerSecond` into the channels are two fields of one
 *    `WaterFeed`, because keeping them apart is the reason the island
 *    drains between showers. See `WaterFeed`.
 *  - `dryDepth` IS GONE, with `velocity()`. Its only reader was the
 *    velocity divisor, and the fresh current is zero by decision (see
 *    `spotAt`). An option nobody reads is a lie about what the solver
 *    does; it comes back with the stream model that needs it.
 *  - GRAVITY IS IMPORTED. v0 declared `G = 981` here and again in
 *    `seaSwell.ts`; `sea/surf.ts` already refused to make that mistake a
 *    third time. One number, one home.
 *
 * UNITS ARE THE GAME'S. One world unit is a centimetre, so gravity is
 * 981 and not 9.81, a "1 m cell" is 100, and a depth of 2 is two
 * centimetres of water. Nothing here is in metres; see CLAUDE.md on what
 * true scale costs when it is assumed.
 *
 * Pure: no three, no DOM, no fetch, no clock of its own. `src/world/` is
 * core, so a headless authority can run the island's water.
 */
import { snapTo, world, type WorldPoint } from '../coords';
import { SEA_LEVEL } from '../heightfield';
import { G } from '../sea/swell';
import type { WaterSource, WaterSpot } from './router';

/**
 * Gravity, world units per second squared (9.81 m/s²).
 *
 * Re-exported from the sea's swell so that the pipe acceleration here
 * and the wave dispersion there cannot drift apart. `water/waterQuery.ts`
 * re-exports `WaterSpot` and `WaterSource` from `router.ts` for the same
 * reason: one definition, several doors.
 */
export { G as GRAVITY };

/**
 * A typed-array view with the writing taken off.
 *
 * The same memory, not a copy — a renderer reads 65,536 depths a frame
 * and must not pay for a clone — but `grid.depth[i] = 0` is a compile
 * error rather than a silent corruption of the solver's state. There is
 * no built-in `ReadonlyFloat32Array`; a readonly index signature is the
 * whole of what one would be for a reader.
 */
export interface ReadonlyFloats {
  readonly [index: number]: number;
  readonly length: number;
}

/**
 * The tuning of one patch of water.
 *
 * Every number carries its unit and the measurement that settled it.
 */
export interface WaterSimOptions {
  /** Cells per side. 256 unless a test wants something small. */
  readonly n: number;
  /** World units per cell. 100 is one metre. */
  readonly cell: number;
  /**
   * Seconds per step.
   *
   * MEASURED, not taken from the paper. Their Table 1 halves dt every
   * time the grid doubles because their domain is fixed; ours is fixed at
   * 1 m a cell instead, so the number had to be swept. At 1 m the solver
   * is stable from 0.004 all the way to 0.8, but stability is not the bar
   * — above 0.1 the ANSWER changes (a pooled depth of 706 becomes 1435).
   * It converges at 0.02, 0.05 and 0.1 alike, so 0.02 sits an easy factor
   * of five inside the range that agrees.
   *
   * That is what makes this affordable on a CPU: real time needs
   * 1/0.02 = 50 steps a second, which for 256² is 3.3 M cell updates a
   * second — not the 16 M a frame that dt = 0.004 would have cost.
   */
  readonly dt: number;
  /** Flux kept per step. 1 is frictionless; below ~0.9 water crawls. */
  readonly damping: number;
  /**
   * SOAK — depth removed per second, everywhere. The paper's step 5.
   *
   * Implemented as a flat SUBTRACTION rather than a proportional decay,
   * and the difference is the whole point. Proportional loss takes the
   * same fraction from a film and from a pool, so a hillside stays damp
   * forever and the island reads as a flood plain. A flat rate takes a
   * fixed depth from both: a film two units deep is gone in seconds, a
   * channel two hundred deep barely notices — and a channel that is being
   * fed does not notice at all.
   *
   * That is also the honest physics for this island. Kauaʻi is porous
   * volcanic soil; the dominant loss on a hillside is water going INTO
   * the ground, not off it. Sheet flow soaks away and the drainage keeps
   * running, which is what a real island looks like an hour after rain.
   *
   * See `SOAK` for the sweep that chose the shipped value.
   */
  readonly soak: number;
  /**
   * Whether the patch rim lets water out.
   *
   * On, the patch behaves like a piece cut from a bigger island: a ring
   * one cell wide loses what it would have sent into ground that is not
   * simulated. Off, it is a bathtub, and every question of "where does
   * this settle" is answered by the walls instead of by the terrain —
   * which is why the tests that measure a spill shut the rim, and the
   * world opens it.
   */
  readonly drainRim: boolean;
}

/**
 * SOAK, world units of depth per second.
 *
 * Swept in v0 against the surveyed hydrography ("water within 5 m of a
 * surveyed river point", 8 sample reaches, dry weather):
 *
 *   soak 0    -> 8/8 on course, 38.0% of cells standing in water
 *   soak 0.3  -> 8/8,           29.3%   <- shipped: same coverage, less flood
 *   soak 0.8  -> 6/8,           15.1%   (starts drying the network out)
 *
 * Without it a fed island simply gets wetter and reads as a flood plain;
 * v0's first island build skipped this step and looked exactly like that.
 */
export const SOAK = 0.3;

/**
 * BASEFLOW — what keeps a river running when it is not raining, in world
 * units of depth per second into each CHANNEL cell.
 *
 * A MODELLING CONSTANT, plainly: it stands in for the catchment a 256 m
 * window cannot see. Real rain at 5 mm/hr feeds a cell 0.00014 units a
 * second (`rainToUnitsPerSecond(5)`), four orders of magnitude under what
 * a channel needs, because a real river is not the rain that fell on the
 * river — it is the rain that fell on a valley and converged.
 *
 * v0's sweep, against the same on-course measure, with the world-fixed
 * channel mask (bands one coarse node — about 55 m — wide):
 *
 *   0.3 -> 0/8 on course,  1.8% of cells wet
 *   0.8 -> 2/8,            7.5%
 *   2   -> 5/8,           15.4%   <- shipped: the knee
 *   4   -> 5/8,           24.6%   (wetter, and no more coverage for it)
 *   2 + a shower -> 8/8,  44.3%
 *
 * The reaches that stay dry in fair weather are ones where the island's
 * own drainage disagrees with the survey. That is a fact about the
 * elevation model, and it is reported rather than carved away.
 *
 * Exported as the measured default; the caller owns the feed and may
 * pass anything. It is tuning inspired by hydrology, not measured
 * hydrology.
 */
export const BASEFLOW = 2;

/**
 * The shipped tuning. 256 x 1 m = a 256 m window, which is what measured
 * 1.00x real time; everything else is documented on `WaterSimOptions`.
 */
export const WATER_SIM_DEFAULTS: WaterSimOptions = Object.freeze({
  n: 256,
  cell: 100,
  dt: 0.02,
  damping: 0.995,
  soak: SOAK,
  drainRim: true,
});

/**
 * The most steps `advance` will run for one call: 120, or 2.4 simulated
 * seconds at the shipped dt.
 *
 * A frame that stalls owes the solver more time than it can pay for, and
 * the two ways out are to spend the frame catching up or to drop the
 * surplus. Dropping is right here: nobody audits this water as a ledger,
 * and a two-second hitch to make a puddle historically accurate is a
 * worse bug than the puddle being two seconds behind. v0's number.
 */
export const MAX_STEPS_PER_ADVANCE = 120;

/**
 * WHAT IS BEING PUT INTO THE WATER THIS STEP, and why it is two numbers
 * rather than one.
 *
 * Joshua asked v0 whether the water would drain off the mountainside
 * once it got going. With a single feed it never could: "baseflow" was
 * rain on the upper half of the window, permanently, so every slope
 * stayed wet forever. That is not an island, it is a sprinkler.
 *
 * Real hydrology already separates them. Between storms a river runs on
 * BASEFLOW — groundwater seeping into the channel itself, while the
 * hillsides above it are dry. During a storm the whole catchment sheds
 * stormflow, and afterwards the slopes drain and soak away while the
 * channel keeps running. So: baseflow into the channel cells always,
 * rain on everything only while it is actually raining. Between showers
 * the slopes soak dry and the drainage keeps running, which is the
 * behaviour he described.
 *
 * RAIN IS THE REAL RATE. `weather/rainToUnitsPerSecond` converts mm/hr —
 * the unit rain is measured and forecast in — into depth per second, and
 * that number is honest and small: 10 mm/hr is 0.000278 units a second,
 * a millimetre of water on the ground every six minutes. A caller that
 * wants a shower to swell the streams within a minute is asking for the
 * CATCHMENT, not for more rain (v0 multiplied mm/hr by 0.075 into its
 * catchment cells, about 2,700x the raw rate, and that factor was the
 * unseen valley wearing a hat). Scale it if you must, and say in the
 * caller that you are.
 */
export interface WaterFeed {
  /** Rain on EVERY cell, world units of depth per second. */
  readonly rainPerSecond: number;
  /** Baseflow into the channel cells only, world units of depth per second. */
  readonly baseflowPerSecond: number;
  /**
   * Which cells carry a watercourse: row-major, `n * n` long, 1 is a
   * channel. Null feeds no baseflow at all.
   *
   * Built by `WaterSim.channelMask` from a WORLD-FIXED answer — see the
   * note there on why this window must not run its own D8.
   */
  readonly channels: Uint8Array | null;
}

/** Fair weather over dry ground: nothing goes in. */
export const NO_FEED: WaterFeed = Object.freeze({
  rainPerSecond: 0,
  baseflowPerSecond: 0,
  channels: null,
});

/**
 * The solver's grid as a renderer needs to see it: where it is, how big
 * a cell is, and the two fields, read-only.
 *
 * A fresh object per call, deliberately. The arrays are the solver's own
 * and stay valid for its lifetime, but `origin` MOVES when the window
 * re-centres, and a renderer that cached one from last minute would draw
 * this minute's water at last minute's place — which is the floating-
 * origin family of bug that `coords.ts` exists to prevent.
 */
export interface WaterGrid {
  readonly n: number;
  readonly cell: number;
  /**
   * The world point cell (0,0) is SAMPLED AT — a lattice point, not the
   * corner of an area. Cell (cx, cy) sits at
   * `origin + (cx * cell, cy * cell)`.
   */
  readonly origin: WorldPoint;
  /** Terrain height per cell, world units. Read-only: the terrain is not ours to move. */
  readonly bed: ReadonlyFloats;
  /** Water column per cell, world units. Never negative. */
  readonly depth: ReadonlyFloats;
}

/**
 * One patch of water over a fixed bed, somewhere on the island.
 *
 * Answers `WaterSource<'fresh'>`, so the two-owner `WaterRouter` can hold
 * it beside the sea without either knowing the other exists.
 */
export class WaterSim implements WaterSource<'fresh'> {
  readonly opts: WaterSimOptions;
  readonly n: number;
  readonly cell: number;

  /** Terrain height per cell, world units. Written by `placeAt` and by nothing else, ever. */
  private readonly bed: Float32Array;
  /** Water column per cell, world units. */
  private readonly water: Float32Array;
  /** Outflow volume per second through each of the four pipes. */
  private readonly fl: Float32Array;
  private readonly fr: Float32Array;
  private readonly ft: Float32Array;
  private readonly fb: Float32Array;
  /** Scratch, so a step allocates nothing. */
  private readonly next: Float32Array;

  /** World position of cell (0,0). Meaningless until `placeAt`. */
  private ox = 0;
  private oz = 0;
  private placed = false;
  /**
   * The ground REVISION the bed was last read at, or -1 for never.
   *
   * v1 streams high-detail terrain in behind the player: `Heightfield`
   * takes a 13.67 m tile whenever one lands and `heightAt` prefers it
   * from that moment on. So the ordinary case is somebody standing
   * still while the ground under them is REPLACED — and a window that
   * only re-reads the bed when it MOVES keeps solving against the
   * coarse 54.7 m ground it was built on, for as long as they stand
   * there. The water would pool in valleys that are no longer where it
   * thinks they are.
   *
   * Found by the review pass, which measured it: a second `placeAt` at
   * the same centre made zero sampler calls and left the bed unchanged.
   * `OceanView` already re-anchors its sheets on this same revision;
   * this is the same idea in the same shape, and it is why the sampler
   * alone was never enough.
   */
  private bedRevision = -1;
  /** Fractional step left over from the last `advance`. */
  private carry = 0;

  constructor(options: Partial<WaterSimOptions> = {}) {
    this.opts = { ...WATER_SIM_DEFAULTS, ...options };
    if (!(this.opts.n >= 3) || !(this.opts.cell > 0) || !(this.opts.dt > 0)) {
      throw new Error('water/sim: n must be at least 3, and cell and dt must be positive');
    }
    this.n = this.opts.n;
    this.cell = this.opts.cell;
    const cells = this.n * this.n;
    this.bed = new Float32Array(cells);
    this.water = new Float32Array(cells);
    this.fl = new Float32Array(cells);
    this.fr = new Float32Array(cells);
    this.ft = new Float32Array(cells);
    this.fb = new Float32Array(cells);
    this.next = new Float32Array(cells);
  }

  /** Row-major index of a cell. No bounds check: the hot loops carry their own. */
  index(cx: number, cy: number): number {
    return cy * this.n + cx;
  }

  /** Where cell (cx, cy) is sampled, in world coordinates. */
  pointOf(cx: number, cy: number): WorldPoint {
    return world(this.ox + cx * this.cell, this.oz + cy * this.cell);
  }

  /** Whether the window has been placed on the island at all. */
  isPlaced(): boolean {
    return this.placed;
  }

  /** The grid as a renderer sees it. See `WaterGrid` on why it is fresh each call. */
  grid(): WaterGrid {
    return {
      n: this.n,
      cell: this.cell,
      origin: world(this.ox, this.oz),
      bed: this.bed,
      depth: this.water,
    };
  }

  /**
   * Put the window at a place and read the ground under it.
   *
   * SNAPPED TO THE CELL LATTICE, so a move is a whole number of cells and
   * the water already in the window can be CARRIED across rather than
   * resampled. An unsnapped window would need to interpolate a depth
   * field, and interpolating depths is how you invent water that was
   * never there — a pool one cell wide becomes two cells of half a pool,
   * every re-centre, forever.
   *
   * The bed is read through the sampler and written HERE and nowhere
   * else. `bedAt` is a query into the heightfield; this module never
   * hands anything back to it.
   */
  placeAt(centre: WorldPoint, bedAt: (at: WorldPoint) => number, revision = 0): void {
    if (!Number.isFinite(centre.wx) || !Number.isFinite(centre.wz)) {
      // BEFORE ANYTHING IS WRITTEN. The old order set the origin and the
      // placed flag and only then read the ground, so a sampler that
      // threw left the window marked placed with a half-written bed and
      // a NaN origin — which then poisons `pointOf` and asks the channel
      // predicate about NaN points forever after.
      throw new Error(`water/sim: placeAt was given ${centre.wx},${centre.wz}`);
    }
    const snapped = snapTo(centre, this.cell);
    const half = (this.n * this.cell) / 2;
    const nx = snapped.wx - half;
    const nz = snapped.wz - half;
    let moved = false;

    if (this.placed) {
      const shiftX = Math.round((nx - this.ox) / this.cell);
      const shiftZ = Math.round((nz - this.oz) / this.cell);
      // STILL, BUT THE GROUND MAY HAVE MOVED. See `bedRevision`: HD
      // tiles land under a standing player, so an unmoved window still
      // has to re-read the ground when the survey says it changed.
      if (shiftX === 0 && shiftZ === 0 && revision === this.bedRevision) return;
      moved = shiftX !== 0 || shiftZ !== 0;
      if (moved) this.carryWater(shiftX, shiftZ);
    } else {
      this.water.fill(0);
    }
    this.ox = nx;
    this.oz = nz;
    this.placed = true;
    const bedChanged = this.fillBed(bedAt);
    this.bedRevision = revision;
    // A same-window revision may be an underground soil edit whose roof
    // leaves every water-bed sample unchanged. Those pipes still describe
    // this grid; clearing them would erase the flow already under way.
    if (moved || bedChanged) {
      this.fl.fill(0);
      this.fr.fill(0);
      this.ft.fill(0);
      this.fb.fill(0);
    }
  }

  /**
   * A mask of this window's cells that carry a watercourse, from a
   * WORLD-FIXED answer.
   *
   * The predicate must not depend on where the window is. v0 ran D8 over
   * the window's own bed every re-centre, and accumulation on a finite
   * moving window depends on where the rim falls: two windows one
   * re-centre apart disagreed on 16% of their shared channel cells, and
   * the rivers visibly morphed as the player flew at them. The fix is
   * `drainage.ts` run ONCE over the whole immutable island, and this
   * method looking membership up.
   */
  channelMask(isChannel: (at: WorldPoint) => boolean): Uint8Array {
    const mask = new Uint8Array(this.n * this.n);
    for (let cy = 0; cy < this.n; cy += 1) {
      for (let cx = 0; cx < this.n; cx += 1) {
        const i = cy * this.n + cx;
        // NO BASEFLOW BELOW SEA LEVEL, and this is not a tuning choice —
        // it is the router's own classification, enforced where it can
        // be relied on rather than left to whoever writes the predicate.
        //
        // D8 accumulation over the whole island does exactly what it is
        // asked to and routes water downhill past the shoreline: the
        // review measured the island-wide mask putting 257,932 of its
        // 289,006 channel cells — 89.2% — on the SEABED, the deepest 3 km
        // down. v0 hit the same thing (84.3%) and answered it with a
        // separate `isLandWatercourse` predicate; a predicate is a thing
        // a caller can forget, and `router.ts` already says that ground
        // below sea level is the OCEAN'S to answer for. Freshwater
        // pouring onto the ocean floor is two owners in one cell, which
        // is the failure the router exists to prevent.
        //
        // The bed is this window's own reading of the ground, so this
        // costs nothing and cannot be got wrong from outside.
        mask[i] = this.bed[i] >= SEA_LEVEL && isChannel(this.pointOf(cx, cy)) ? 1 : 0;
      }
    }
    return mask;
  }

  /** Surface = bed + water. The only height the pipes ever compare. */
  surfaceOf(i: number): number {
    return this.bed[i] + this.water[i];
  }

  /** Total water in the patch, in cubic world units. Tests watch this. */
  volume(): number {
    let v = 0;
    for (let i = 0; i < this.water.length; i += 1) v += this.water[i];
    return v * this.cell * this.cell;
  }

  /** How many cells hold more than `depth` of water. For probes and the HUD. */
  wetCells(depth = 0): number {
    let n = 0;
    for (let i = 0; i < this.water.length; i += 1) if (this.water[i] > depth) n += 1;
    return n;
  }

  /**
   * Advance by `seconds` of world time, in whole steps of `opts.dt`.
   *
   * THE FIXED STEP IS THE SOLVER'S, not the frame's, and this is where
   * that is enforced: the dt above was swept for a reason and a variable
   * dt taken straight from a frame would walk the answer around with the
   * frame rate. The remainder is carried, so no time is lost to rounding
   * over a long session; the surplus above `MAX_STEPS_PER_ADVANCE` is
   * dropped, which is the one place time IS lost and is documented there.
   *
   * @returns how many steps actually ran.
   */
  advance(seconds: number, feed: WaterFeed = NO_FEED): number {
    // The finite check comes FIRST: `NaN > 0` is false, so testing the
    // sign first would swallow a NaN clock as "no time passed" — which is
    // the quietest possible way for a frame timer to break.
    if (!Number.isFinite(seconds)) throw new Error(`water/sim: seconds must be finite, got ${seconds}`);
    if (!this.placed || seconds <= 0) return 0;
    const owed = seconds / this.opts.dt + this.carry;
    const whole = Math.floor(owed);
    this.carry = owed - whole;
    const steps = Math.min(whole, MAX_STEPS_PER_ADVANCE);
    for (let s = 0; s < steps; s += 1) this.step(feed);
    return steps;
  }

  /**
   * One step of the pipe model: feed, accelerate, scale, move, soak,
   * drain the rim.
   *
   * The order is the paper's, and the scaling is inside the acceleration
   * pass so that a cell's four pipes are scaled together before anything
   * reads them.
   */
  step(feed: WaterFeed = NO_FEED): void {
    const { n, cell } = this;
    const { dt, damping } = this.opts;
    const area = cell * cell;
    // The paper's A/l with A = cell² and l = cell, folded to `cell`. A is
    // a constant cross-section, as the paper takes it, and this pairing
    // is what dt was swept against; changing one means re-sweeping both.
    const accel = dt * G * cell;
    const bed = this.bed;
    const water = this.water;

    this.pour(feed, dt);

    // 1. Accelerate each pipe on the SURFACE difference, and
    // 2. scale a cell's four outflows so together they take at most what
    //    the cell holds. Without this a cell goes negative and the grid
    //    detonates within a few hundred steps.
    for (let cy = 0; cy < n; cy += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        const i = cy * n + cx;
        const here = bed[i] + water[i];
        this.fl[i] = cx > 0
          ? Math.max(0, this.fl[i] * damping + accel * (here - (bed[i - 1] + water[i - 1])))
          : 0;
        this.fr[i] = cx < n - 1
          ? Math.max(0, this.fr[i] * damping + accel * (here - (bed[i + 1] + water[i + 1])))
          : 0;
        this.ft[i] = cy > 0
          ? Math.max(0, this.ft[i] * damping + accel * (here - (bed[i - n] + water[i - n])))
          : 0;
        this.fb[i] = cy < n - 1
          ? Math.max(0, this.fb[i] * damping + accel * (here - (bed[i + n] + water[i + n])))
          : 0;

        const out = (this.fl[i] + this.fr[i] + this.ft[i] + this.fb[i]) * dt;
        const have = water[i] * area;
        if (out > have) {
          const k = out > 0 ? have / out : 0;
          this.fl[i] *= k;
          this.fr[i] *= k;
          this.ft[i] *= k;
          this.fb[i] *= k;
        }
      }
    }

    // 3. Move the water: inflow from the neighbours' pipes that point at
    //    us, outflow through our own.
    for (let cy = 0; cy < n; cy += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        const i = cy * n + cx;
        let inflow = 0;
        if (cx > 0) inflow += this.fr[i - 1];
        if (cx < n - 1) inflow += this.fl[i + 1];
        if (cy > 0) inflow += this.fb[i - n];
        if (cy < n - 1) inflow += this.ft[i + n];
        const outflow = this.fl[i] + this.fr[i] + this.ft[i] + this.fb[i];
        const d = water[i] + (dt * (inflow - outflow)) / area;
        this.next[i] = d > 0 ? d : 0;
      }
    }
    water.set(this.next);

    // 4. SOAK — the paper's fifth step, and the one that separates a
    //    river from a wet island. Flat rate, so films go and channels
    //    stay. See `WaterSimOptions.soak`.
    if (this.opts.soak > 0) {
      const loss = this.opts.soak * dt;
      for (let i = 0; i < water.length; i += 1) {
        const d = water[i] - loss;
        water[i] = d > 0 ? d : 0;
      }
    }

    // 5. The rim, if it is open: a ring one cell wide loses what it would
    //    have sent into the island that is not simulated.
    if (this.opts.drainRim) {
      const last = n - 1;
      for (let c = 0; c < n; c += 1) {
        water[c] = 0;
        water[last * n + c] = 0;
        water[c * n] = 0;
        water[c * n + last] = 0;
      }
    }
  }

  /**
   * The water at a world point, or null where this patch has none.
   *
   * NULL MEANS DRY AND ZERO DEPTH IS NOT DRY (`waterQuery.ts`): a film a
   * millimetre deep is water — she can drink from it, it wets her — so
   * any positive depth answers, and no threshold is applied here. A
   * renderer may decline to DRAW a film; that is a look, not a fact, and
   * it belongs on the renderer's side of this door.
   *
   * BILINEAR ON BOTH FIELDS, and that is not polish. The grid is 1 m
   * cells and she is one centimetre long; nearest-cell depth steps half a
   * metre at a cell border and an ant floating across one would pop like
   * a piston.
   *
   * THE SURFACE IS MEASURED ON THIS GRID'S OWN BED, which is a promise to
   * the renderer as much as an answer to the caller: whatever draws this
   * water must stand its sheet on the SAME lattice, or the picture and
   * the physics part company. v0 drew on 100-unit chords over 8-unit
   * terrain and measured the drawn bed standing above the true ground by
   * +1.80 units at p95, +2.60 at p99 and +5.43 at worst over 5,329 inland
   * points — she was under the drawn skin at 43.3% of them and deeper
   * than her own body length at 17.3%, which is the whole of Joshua's "I
   * fall below the water inland" report (audit A5/F1).
   *
   * THE CURRENT IS ZERO, deliberately, and it is not laziness. The
   * solver's velocity is flux over depth, and depth goes to zero at the
   * edge of every pool: a millimetre of film with any flux at all divides
   * out to metres a second. Measured on Joshua's device, 368 cm/s over
   * 1.5 mm of water; reproduced from the solver's own arithmetic, one
   * step on a median 11.5° Kauaʻi slope over a 1.5 mm film reports about
   * 1,300 units/s and a settled film about 4,000. That is a singularity
   * in the scheme, not a current, and capping it would only hide the same
   * nonsense at a smaller number. Inland water is still until it has a
   * flow model of its own — channel slope, a velocity floor, and a depth
   * below which water moves nothing. The sea's current is untouched: it
   * comes from the wave table, on the other owner's side of the router.
   */
  spotAt(at: WorldPoint): (WaterSpot & { readonly kind: 'fresh' }) | null {
    if (!this.placed) return null;
    const n = this.n;
    const fx = (at.wx - this.ox) / this.cell;
    const fz = (at.wz - this.oz) / this.cell;
    const cx = Math.floor(fx);
    const cy = Math.floor(fz);
    // NOT-A-NUMBER IS OUTSIDE, and it takes saying so. Every comparison
    // against NaN is false, so `NaN < 0 || NaN >= n - 1` lets a NaN
    // straight through this guard; `bilinear` then reads `field[NaN]`,
    // gets undefined, and returns NaN — and `depth <= 0` is false for
    // NaN too, so the whole thing is handed back as a valid spot with a
    // NaN surface. `router.ts` promises `depth` is always above zero
    // where a spot exists, and `submersion` would pass that NaN to the
    // camera fog and the underwater look. Found by the review pass,
    // which measured exactly that answer coming back.
    if (!Number.isFinite(fx) || !Number.isFinite(fz)) return null;
    if (cx < 0 || cy < 0 || cx >= n - 1 || cy >= n - 1) return null;
    const tx = fx - cx;
    const tz = fz - cy;
    const i = cy * n + cx;
    const depth = bilinear(this.water, i, n, tx, tz);
    if (depth <= 0) return null;
    const bed = bilinear(this.bed, i, n, tx, tz);
    return { kind: 'fresh', surface: bed + depth, depth, flowX: 0, flowZ: 0 };
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * Read the ground into the bed. The one writer of `this.bed`.
   *
   * THROWS on a sample that is not finite. A single NaN spreads through
   * the surface differences into every neighbour and the whole window is
   * dead within a step, at which point the symptom is "the water
   * vanished" and the cause is a DEM hole three files away. The
   * heightfield already refuses an unrepaired grid for the same reason;
   * this is the second lock on the same door.
   */
  private fillBed(bedAt: (at: WorldPoint) => number): boolean {
    let changed = false;
    for (let cy = 0; cy < this.n; cy += 1) {
      for (let cx = 0; cx < this.n; cx += 1) {
        const h = bedAt(this.pointOf(cx, cy));
        if (!Number.isFinite(h)) {
          throw new Error(`water/sim: the ground at cell ${cx},${cy} read ${h}`);
        }
        const i = cy * this.n + cx;
        const before = this.bed[i];
        this.bed[i] = h;
        if (this.bed[i] !== before) changed = true;
      }
    }
    return changed;
  }

  /** Carry the water still inside the window to its new cell. Whole cells only. */
  private carryWater(shiftX: number, shiftZ: number): void {
    const n = this.n;
    this.next.set(this.water);
    this.water.fill(0);
    if (Math.abs(shiftX) >= n || Math.abs(shiftZ) >= n) return;
    for (let cy = 0; cy < n; cy += 1) {
      const sy = cy + shiftZ;
      if (sy < 0 || sy >= n) continue;
      for (let cx = 0; cx < n; cx += 1) {
        const sx = cx + shiftX;
        if (sx < 0 || sx >= n) continue;
        this.water[cy * n + cx] = this.next[sy * n + sx];
      }
    }
  }

  /**
   * Put this step's feed in: rain on everything, baseflow into the
   * channels. See `WaterFeed` on why those are two numbers.
   *
   * A non-finite rate throws rather than coercing to zero. A weather
   * source that has gone NaN is a bug to be told about, and a silent zero
   * reads as "it stopped raining".
   */
  private pour(feed: WaterFeed, dt: number): void {
    const rain = feed.rainPerSecond;
    const base = feed.baseflowPerSecond;
    if (!Number.isFinite(rain) || !Number.isFinite(base)) {
      throw new Error(`water/sim: feed rates must be finite, got rain ${rain} and baseflow ${base}`);
    }
    if (rain > 0) {
      const add = rain * dt;
      for (let i = 0; i < this.water.length; i += 1) this.water[i] += add;
    }
    const channels = feed.channels;
    if (base > 0 && channels !== null) {
      if (channels.length !== this.water.length) {
        throw new Error(
          `water/sim: the channel mask is ${channels.length} cells and the grid is ${this.water.length}`,
        );
      }
      const add = base * dt;
      for (let i = 0; i < this.water.length; i += 1) if (channels[i] !== 0) this.water[i] += add;
    }
  }
}

/** The four cells around a lattice square, mixed. `i` is the low corner. */
function bilinear(field: Float32Array, i: number, n: number, tx: number, tz: number): number {
  const v00 = field[i];
  const v10 = field[i + 1];
  const v01 = field[i + n];
  const v11 = field[i + n + 1];
  return (v00 * (1 - tx) + v10 * tx) * (1 - tz) + (v01 * (1 - tx) + v11 * tx) * tz;
}
