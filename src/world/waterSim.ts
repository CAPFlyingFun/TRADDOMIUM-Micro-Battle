/**
 * VIRTUAL-PIPES SHALLOW WATER over a patch of the real island.
 *
 * Mei, Decaudin & Hu, "Fast Hydraulic Erosion Simulation and
 * Visualization on GPU" (PG'07) — steps 1, 2 and 5 of their five, and
 * deliberately not 3 and 4.
 *
 * WHY HALF THE PAPER. Their steps 3 and 4 erode the terrain and carry
 * the sediment. We must not: this island is surveyed Kauaʻi and the
 * whole point of the elevation pipeline is that it stays surveyed.
 * Dropping them is not a compromise either — the paper's own stated
 * weakness ("difficulties in simulating the erosion process on very
 * flat terrain", which is every coastal plain on this island) lives
 * entirely inside the two steps we skip.
 *
 * THE MODEL. Four virtual pipes per cell join it to its von Neumann
 * neighbours. Each pipe accelerates on the difference in SURFACE
 * height — bed + water, not bed — so water climbs nothing, settles
 * flat in a basin, and spills at the lowest rim on its own. That is
 * the whole reason a pool finds its own outlet without being told
 * where one is.
 *
 * WHY THE SCALING STEP IS NOT OPTIONAL. A cell can be asked for more
 * water than it holds by four pipes that each looked at it alone; left
 * alone that writes a negative depth and the grid detonates within a
 * few hundred steps. Every outflow from a cell is scaled by one factor
 * K so the four together take at most what is there. The paper flags
 * this as a source of instability in its own right, since scaling one
 * cell's outflow does not adjust its neighbours' inflow — hence the
 * conservative timestep rather than the largest CFL allows.
 *
 * SIZED FROM THEIR TABLE 1, not from optimism. Cycles per second is
 * not frame rate: each cycle advances the world by dt, so simulated
 * seconds per wall second is CPS x dt. On their 2007 GPU that is
 * 403 x 0.002 = 0.81 at 256^2, and 59 x 0.0005 = 0.03 at 1024^2 — the
 * larger grids are interactive to watch and nowhere near real time.
 * Only 256^2 runs at the speed a player stands in. So: 256^2, and the
 * cell size is what buys the detail — at 1 m a 5.5 m stream is five
 * cells across, where Beyond Extinction's 10 m cells could not hold
 * one at all.
 *
 * UNITS ARE THE GAME'S. One world unit is a centimetre, so gravity is
 * 981 and not 9.81, and a "1 m cell" is 100. Nothing here is in
 * metres; see CLAUDE.md on what true scale costs when it is assumed.
 */

/** Gravity in world units per second squared (9.81 m/s²). */
export const G = 981;

export interface SimOpts {
  /** Cells per side. 256 unless a test wants something small. */
  readonly n: number;
  /** World units per cell. 100 is one metre. */
  readonly cell: number;
  /**
   * Seconds per step.
   *
   * MEASURED, not taken from the paper. Their Table 1 halves dt every
   * time the grid doubles because their domain is fixed; ours is fixed
   * at 1 m a cell instead, so the number had to be swept here. At 1 m
   * the solver is stable from 0.004 all the way to 0.8, but stability
   * is not the bar — above 0.1 the ANSWER changes (a pooled depth of
   * 706 becomes 1435). It converges at 0.02, 0.05 and 0.1 alike, so
   * 0.02 sits an easy factor of five inside the range that agrees.
   *
   * That is what makes this affordable on a CPU: real time needs
   * 1/0.02 = 50 steps a second, which for 256² is 3.3 M cell updates
   * a second — not the 16 M a frame that dt = 0.004 would have cost.
   */
  readonly dt: number;
  /** Flux kept per step. 1 is frictionless; below ~0.9 water crawls. */
  readonly damping: number;
  /** Depth below which a cell is dry to everything downstream. */
  readonly dryDepth: number;
}

export const DEFAULTS: SimOpts = {
  n: 256,
  cell: 100,
  dt: 0.02,
  damping: 0.995,
  dryDepth: 0.05,
};

/**
 * One patch of water over a fixed bed.
 *
 * The bed is sampled once and never written — this is not an erosion
 * model and the island is not ours to move.
 */
export class WaterSim {
  readonly n: number;
  readonly cell: number;
  readonly opts: SimOpts;
  /** Terrain height per cell, world units. Written once, then read. */
  readonly bed: Float32Array;
  /** Water column height per cell, world units. */
  readonly depth: Float32Array;
  /** Outflow volume per second through each of the four pipes. */
  private readonly fl: Float32Array;
  private readonly fr: Float32Array;
  private readonly ft: Float32Array;
  private readonly fb: Float32Array;
  /** Scratch, so a step allocates nothing. */
  private readonly next: Float32Array;

  constructor(opts: Partial<SimOpts> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.n = this.opts.n;
    this.cell = this.opts.cell;
    const cells = this.n * this.n;
    this.bed = new Float32Array(cells);
    this.depth = new Float32Array(cells);
    this.fl = new Float32Array(cells);
    this.fr = new Float32Array(cells);
    this.ft = new Float32Array(cells);
    this.fb = new Float32Array(cells);
    this.next = new Float32Array(cells);
  }

  index(cx: number, cy: number): number {
    return cy * this.n + cx;
  }

  /** Fill the bed from any height function. Called once at build. */
  fillBed(height: (cx: number, cy: number) => number): void {
    for (let cy = 0; cy < this.n; cy++) {
      for (let cx = 0; cx < this.n; cx++) this.bed[this.index(cx, cy)] = height(cx, cy);
    }
  }

  /** Surface = bed + water. The only height the pipes ever compare. */
  surface(i: number): number {
    return this.bed[i] + this.depth[i];
  }

  /** Add (or with a negative rate, remove) water. Never goes below dry. */
  rain(rate: number, seconds: number, where?: (cx: number, cy: number) => boolean): void {
    const add = rate * seconds;
    for (let cy = 0; cy < this.n; cy++) {
      for (let cx = 0; cx < this.n; cx++) {
        if (where && !where(cx, cy)) continue;
        const i = this.index(cx, cy);
        this.depth[i] = Math.max(0, this.depth[i] + add);
      }
    }
  }

  /** Total water in the patch, in cubic world units. Tests watch this. */
  volume(): number {
    let v = 0;
    for (let i = 0; i < this.depth.length; i++) v += this.depth[i];
    return v * this.cell * this.cell;
  }

  /**
   * One step of the pipe model.
   *
   * @param drainEdge whether the patch rim lets water out. On, the
   *   patch behaves like a piece cut from a bigger island; off, it is
   *   a bathtub and every test of "where does it settle" is answered
   *   by the walls instead of the terrain.
   */
  step(drainEdge = true): void {
    const { n, cell, opts } = this;
    const { dt, damping } = opts;
    const area = cell * cell;
    // The paper's A/l with A = cell² and l = cell, folded to `cell`.
    const accel = dt * G * cell;

    // 1. Accelerate each pipe on the SURFACE difference.
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = this.index(cx, cy);
        const here = this.surface(i);
        this.fl[i] = cx > 0
          ? Math.max(0, this.fl[i] * damping + accel * (here - this.surface(i - 1))) : 0;
        this.fr[i] = cx < n - 1
          ? Math.max(0, this.fr[i] * damping + accel * (here - this.surface(i + 1))) : 0;
        this.ft[i] = cy > 0
          ? Math.max(0, this.ft[i] * damping + accel * (here - this.surface(i - n))) : 0;
        this.fb[i] = cy < n - 1
          ? Math.max(0, this.fb[i] * damping + accel * (here - this.surface(i + n))) : 0;

        // 2. THE SCALING STEP. Four pipes each decided alone; together
        //    they can ask for more than the cell holds. One factor for
        //    all four, so the cell empties at worst exactly.
        const out = (this.fl[i] + this.fr[i] + this.ft[i] + this.fb[i]) * dt;
        const have = this.depth[i] * area;
        if (out > have) {
          const k = out > 0 ? have / out : 0;
          this.fl[i] *= k; this.fr[i] *= k; this.ft[i] *= k; this.fb[i] *= k;
        }
      }
    }

    // 3. Move the water: inflow from the neighbours' pipes that point
    //    at us, outflow through our own.
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) {
        const i = this.index(cx, cy);
        let inflow = 0;
        if (cx > 0) inflow += this.fr[i - 1];
        if (cx < n - 1) inflow += this.fl[i + 1];
        if (cy > 0) inflow += this.fb[i - n];
        if (cy < n - 1) inflow += this.ft[i + n];
        const outflow = this.fl[i] + this.fr[i] + this.ft[i] + this.fb[i];
        const d = this.depth[i] + (dt * (inflow - outflow)) / area;
        this.next[i] = d > 0 ? d : 0;
      }
    }
    this.depth.set(this.next);

    // 4. The rim, if it is open. A ring one cell wide loses what it
    //    would have sent into the patch that is not simulated.
    if (drainEdge) {
      for (let c = 0; c < n; c++) {
        this.depth[this.index(c, 0)] = 0;
        this.depth[this.index(c, n - 1)] = 0;
        this.depth[this.index(0, c)] = 0;
        this.depth[this.index(n - 1, c)] = 0;
      }
    }
  }

  /**
   * Water speed at a cell, world units per second.
   *
   * Flux is a volume rate through a pipe of width `cell` and height
   * `depth`, so dividing by that face area gives a speed. Thin water
   * would divide by nearly nothing, so the depth is floored — a film
   * two hundredths of a unit deep does not get to report a metre a
   * second.
   */
  velocity(cx: number, cy: number): { vx: number; vz: number } {
    const i = this.index(cx, cy);
    const face = this.cell * Math.max(this.depth[i], this.opts.dryDepth);
    const vx = ((this.fr[i] - this.fl[i]) + (cx > 0 ? this.fr[i - 1] : 0)
      - (cx < this.n - 1 ? this.fl[i + 1] : 0)) / (2 * face);
    const vz = ((this.fb[i] - this.ft[i]) + (cy > 0 ? this.fb[i - this.n] : 0)
      - (cy < this.n - 1 ? this.ft[i + this.n] : 0)) / (2 * face);
    return { vx, vz };
  }
}
