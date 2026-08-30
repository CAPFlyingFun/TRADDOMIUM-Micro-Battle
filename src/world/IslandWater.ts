import * as THREE from 'three';
import { groundHeight, terrainHeight, reliefScale } from './heightfield';
import { toLocal } from './origin';
import { world } from './coords';
import { WaterSim, DEFAULTS } from './waterSim';
import { isWatercourse } from './islandChannels';
import { useWaterQuery, type WaterSpot } from './waterQuery';
import { surfFlowAt } from './surf';
import { makeWaterLook } from './waterLook';
import { seaSwellAt } from './seaSwell';

/**
 * THE ISLAND'S WATER — one simulated window that walks with her.
 *
 * The lab (`?scene=water`) proved the physics on a fixed patch. This
 * is the same solver with the two things a world needs and a lab does
 * not: it follows the player, and it is fed by the surveyed rivers
 * rather than by rain on everything.
 *
 * WHY A WINDOW AND NOT AN ISLAND. Kauaʻi is 56 km across. At the 1 m
 * cell that lets a 5.5 m stream exist at all, the whole island is 3.1
 * BILLION cells — and the paper's own Table 1 says a 4096² grid runs
 * at 0.0005× real time. A 256 m window is 65,536 cells and measured
 * 1.00× real time in the browser. Water she cannot see does not need
 * to be moving; water she is standing in does.
 *
 * RAIN ON THE CATCHMENT, AND THE TERRAIN DOES THE ROUTING — which is
 * how the lab worked, and the lab is the version that looked right.
 *
 * The first island build did the opposite: it injected water onto the
 * 1,121 surveyed river courses, on the reasoning that the survey knows
 * where Kauaʻi's rivers are. It does. But feeding a LINE is not the
 * same as feeding a CATCHMENT, and it fails in a way that reads as the
 * simulation being wrong when it is the input that is: 29.7% of those
 * surveyed points are buried — the terrain stands above the water's
 * own recorded level — so water put there runs straight off the course
 * and pools wherever the ground actually dips. Measured, only 2 points
 * in 8 finished with any water within five metres. Turning the rate up
 * to hide that floods the valley instead.
 *
 * The way out is NOT to cut the ground a channel to hold the survey.
 * That is terrain modification and it is forbidden (see CLAUDE.md,
 * "The terrain is not ours to move"); it is also the exact move that
 * every removed water system in this repo made just before it was
 * removed. The way out is to feed the way weather feeds an island —
 * over the high ground — and let the water find its own fills and its
 * own drainage, which is the one thing a shallow-water solver is
 * actually for.
 *
 * So the survey is not an input here at all. It is the CHECK: see
 * tests/fullness.test.ts, which asks how much of the surveyed network
 * the naturally-routed water lands on. That is a measurement of how
 * well the elevation model agrees with the hydrography, and if the two
 * disagree the answer is to report it, not to bend the island.
 *
 * DRAWN ON THE GROUND SHE SEES. The solver runs on `terrainHeight`,
 * the true field, at 1 m. The surface is drawn at `groundHeight`, the
 * height of the triangle actually rendered, plus the depth. So the
 * water cannot float over the visible ground or sink into it, whatever
 * tier the terrain happens to be drawn at — the failure that produced
 * the floating ribbons, the plateaus and the black bands. It costs a
 * little flatness in a pool where the mesh is coarse, and it buys the
 * one property none of the drawn-water attempts ever had.
 */

/** Cells a side. 256² measured 1.00× real time; see waterSim.ts. */
const N = 256;
/** World units per cell. 100 is a metre. */
const CELL = 100;
/** Re-centre once she is this far from the middle (world units). */
const RECENTRE = 6_400;
/** Depth below which water is not drawn. The sim keeps its film. */
const DRAWN = 1.5;
/**
 * Water put into a surveyed river cell, per second, per Strahler order.
 *
 * A rate rather than a level: the window drains at its rim, so each
 * reach finds its own steady depth against what is coming down it. An
 * order-5 trunk gets five times an order-1 trickle, which is the
 * cheapest honest reading of a Strahler number.
 */
/**
 * BASEFLOW — what keeps a river running when it is not raining.
 *
 * Groundwater seeping into the CHANNEL, fed only to the watercourse
 * cells of the island-wide drainage (islandChannels.ts). A MODELLING
 * CONSTANT standing in for the catchment a 256 m window cannot see —
 * real rain at 5 mm/hr feeds a cell 0.00014 units a second, four
 * orders under what a channel needs.
 *
 * RE-SWEPT for the world-fixed mask, whose watercourse bands are a
 * coarse node (~55 m) wide where the old per-window lines were 1 m —
 * many more fed cells, so much less per cell. Dry weather, against
 * the surveyed network ("water within 5 m of a surveyed point"):
 *
 *   0.3 -> 0/8 on course,  1.8% of cells wet
 *   0.8 -> 2/8,            7.5%
 *   2   -> 5/8,           15.4%     <- shipped (the knee)
 *   4   -> 5/8,           24.6%     (wetter, no more coverage)
 *   2 + storm 1.5 -> 8/8, 44.3%     (a shower reaches the rest)
 *
 * The reaches that stay dry in fair weather are ones where the
 * island's own drainage disagrees with the survey — a fact about the
 * elevation model, reported rather than carved away.
 */
const BASEFLOW = 2;
/**
 * Stormflow, per millimetre-per-hour of real precipitation.
 *
 * The weather is already modelled and already reports mm/hr, so a
 * shower should visibly swell the streams and a dry spell should let
 * them fall back. Scaled so heavy rain (about 20 mm/hr) roughly
 * doubles the flow rather than drowning the island.
 */
const STORM_PER_MM = 0.075;
/** However hard it rains, the valley does not become a lake. */
const MAX_FEED = 3.5;
/**
 * SOAK — the paper's fifth step, which the first island build skipped.
 *
 * Without it a fed island simply gets wetter: 38% of cells standing in
 * water, which reads as flood plain rather than as drainage. A flat
 * loss rate takes a film off a hillside in seconds and barely touches
 * a channel that is being fed, so what is left is the drainage.
 *
 * Swept against the same on-course measure:
 *
 *   soak 0    -> 8/8 on course, 38.0% of cells wet
 *   soak 0.3  -> 8/8,           29.3%     <- same coverage, less flood
 *   soak 0.8  -> 6/8,           15.1%     (starts drying the network)
 */
const SOAK = 0.3;
/** Storm rain falls on cells above this quantile of the window's bed. */
const FEED_ABOVE = 0.35;

export class IslandWater {
  private readonly sim = new WaterSim({ n: N, cell: CELL, dt: DEFAULTS.dt, soak: SOAK });
  private readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly depthAttr: Float32Array;
  /** Per-vertex current, world units a second — drives the skin's drift. */
  private readonly flowAttr: Float32Array;
  /** Drawn ground under each cell — static until the window moves. */
  private readonly base = new Float32Array(N * N);
  /** Watercourse cells — baseflow goes here, always. */
  private readonly course = new Uint8Array(N * N);
  /** Catchment cells — storm rain goes here, only while it rains. */
  private readonly catchment = new Uint8Array(N * N);
  private centreX = 0;
  private centreZ = 0;
  private carry = 0;
  /** Millimetres an hour, from the weather service. */
  private precipitation = 0;
  /** Whether the window has been placed at all. */
  private placed = false;
  /** The shared look's uniforms — assigned when material() builds it. */
  private clockRef!: { value: number };
  private centreRef!: { value: THREE.Vector2 };

  constructor(private readonly scene: THREE.Scene, private readonly anisotropy: number) {
    const span = N * CELL;
    const pos = new Float32Array(N * N * 3);
    const normals = new Float32Array(N * N * 3);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        const i = cy * N + cx;
        pos[i * 3] = cx * CELL - span / 2;
        pos[i * 3 + 2] = cy * CELL - span / 2;
        normals[i * 3 + 1] = 1;
      }
    }
    const faces = new Uint32Array((N - 1) * (N - 1) * 6);
    let f = 0;
    for (let cy = 0; cy < N - 1; cy++) {
      for (let cx = 0; cx < N - 1; cx++) {
        const a = cy * N + cx;
        faces[f++] = a; faces[f++] = a + N; faces[f++] = a + 1;
        faces[f++] = a + 1; faces[f++] = a + N; faces[f++] = a + N + 1;
      }
    }
    this.pos = pos;
    this.depthAttr = new Float32Array(N * N);
    this.flowAttr = new Float32Array(N * N * 2);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(this.depthAttr, 1));
    geometry.setAttribute('flow', new THREE.BufferAttribute(this.flowAttr, 2));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));
    this.mesh = new THREE.Mesh(geometry, this.material());
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // BELOW SEA LEVEL, THE SEA ANSWERS FIRST. It used to be asked only
    // where the fresh window had nothing, and that ordering hid a real
    // bug: the sim window follows HER everywhere, sea included, and in
    // rain its cells over the shelf carry a millimetre of rain film —
    // which then answered for "the water here" and quietly replaced a
    // twenty-metre ocean with a puddle. The flight floor, the landing,
    // and the AGL rail all inherited the seabed. Ground below zero IS
    // the sea, whatever else has pooled there; the window speaks for
    // fresh water on LAND.
    //
    // The sea's column includes the SWELL (seaSwell.ts, the one shared
    // surface): a crest deepens it, a trough shallows it, and because
    // floating rides depth, she rises and falls with the very waves
    // the near ocean sheet is drawing from the same table. Salt is
    // flagged so wading floats and drinking refuses.
    useWaterQuery((wx, wz) => {
      const g = groundHeight(wx, wz);
      if (g < 0) {
        // THE SEA MOVES SIDEWAYS TOO, and for a long time it did not:
        // this returned a flat zero current, and `wadeAt` only carries
        // her when the flow is non-zero, so a queen floating in the
        // surf heaved up and down and never went anywhere. surf.ts is
        // the horizontal half — orbital flow out deep, a breaking
        // surge in the shallows — read from the very wave table the
        // swell above comes from.
        const surface = seaSwellAt(wx, wz, -g);
        const depth = -g + surface;
        const flow = surfFlowAt(wx, wz, depth, surface);
        return { depth, flowX: flow.x, flowZ: flow.z, salt: true };
      }
      return this.spotAt(wx, wz);
    });
  }

  /**
   * The skin is Beyond Extinction's ocean, shared with our own ocean
   * sheet and green-shifted for fresh water — see waterLook.ts, which
   * is the single owner of every colour and constant.
   */
  private material(): THREE.MeshStandardMaterial {
    // `ocean: false` is the whole of this window's claim on the shared
    // look: a pond keeps the ordinary waterline foam a lake bank has,
    // and gives up the SWELL-driven breakers, which read seaSwell's
    // table and belong to the Pacific. See waterLook's `ocean`.
    const look = makeWaterLook({ green: 1, surf: 0.15, sink: false, ocean: false, edgeLo: 1.5, edgeHi: 8, midAt: 70, deepAt: 260, texAmp: 0.20, anisotropy: this.anisotropy });
    this.clockRef = look.clock;
    this.centreRef = look.centre;
    return look.material;
  }

  /** What the sky is doing, in mm/hr. Drives stormflow. */
  setWeather(precipitationMmHr: number): void {
    this.precipitation = Number.isFinite(precipitationMmHr) ? precipitationMmHr : 0;
  }

  /** Move the window if she has walked far enough from its middle. */
  follow(at: { wx: number; wz: number }): void {
    if (this.placed
      && Math.abs(at.wx - this.centreX) < RECENTRE
      && Math.abs(at.wz - this.centreZ) < RECENTRE) {
      this.place();
      return;
    }
    // SNAPPED TO THE CELL LATTICE so a move is a whole number of cells
    // and the water can be carried across rather than resampled. An
    // unsnapped window would need interpolation, and interpolating a
    // depth field is how you invent water that was never there.
    const nx = Math.round(at.wx / CELL) * CELL;
    const nz = Math.round(at.wz / CELL) * CELL;
    const shiftX = this.placed ? Math.round((nx - this.centreX) / CELL) : 0;
    const shiftZ = this.placed ? Math.round((nz - this.centreZ) / CELL) : 0;
    this.centreX = nx;
    this.centreZ = nz;

    if (this.placed && (shiftX !== 0 || shiftZ !== 0)) this.shiftWater(shiftX, shiftZ);
    else if (!this.placed) this.sim.depth.fill(0);
    this.placed = true;
    this.resample();
    this.place();
  }

  /** Carry the water that is still inside the window to its new cell. */
  private shiftWater(shiftX: number, shiftZ: number): void {
    const old = Float32Array.from(this.sim.depth);
    this.sim.depth.fill(0);
    for (let cy = 0; cy < N; cy++) {
      const sy = cy + shiftZ;
      if (sy < 0 || sy >= N) continue;
      for (let cx = 0; cx < N; cx++) {
        const sx = cx + shiftX;
        if (sx < 0 || sx >= N) continue;
        this.sim.depth[cy * N + cx] = old[sy * N + sx];
      }
    }
  }

  /** Re-read the bed, the drawn ground and the survey for this window. */
  private resample(): void {
    const span = N * CELL;
    const ox = this.centreX - span / 2;
    const oz = this.centreZ - span / 2;
    this.sim.fillBed((cx, cy) => terrainHeight(ox + cx * CELL, oz + cy * CELL));
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        this.base[cy * N + cx] = groundHeight(ox + cx * CELL, oz + cy * CELL);
      }
    }
    // TWO FEEDS, AND SEPARATING THEM IS THE POINT.
    //
    // Joshua asked whether the water would drain off the mountainside
    // once it got going. With one feed it never could: baseflow was
    // rain on the upper half of the window, permanently, so every
    // slope stayed wet forever. That is not an island, it is a
    // sprinkler.
    //
    // Real hydrology already separates them. Between storms a river
    // runs on BASEFLOW — groundwater seeping into the channel itself,
    // while the hillsides above it are dry. During a storm the whole
    // catchment sheds STORMFLOW, and afterwards the slopes drain and
    // soak away while the channel keeps running.
    //
    // So the course carries baseflow always, and the catchment carries
    // rain only while it is actually raining.
    //
    // THE CHANNELS ARE WORLD-FIXED NOW — looked up in the island-wide
    // accumulation (islandChannels.ts), which is D8 over the whole
    // coarse grid, baked once. They used to be D8 over THIS window's
    // own bed, recomputed per re-centre, and accumulation on a finite
    // moving window depends on where the rim falls: two windows one
    // re-centre apart disagreed on 16% of their shared channel cells,
    // and the rivers morphed as she flew at them (found by PR #2's
    // review — its diagnosis was right even though its fix carved).
    // Same terrain-decides rule, same D8; the only change is that it
    // is now the ISLAND's answer instead of the window's.
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        this.course[cy * N + cx] = isWatercourse(ox + cx * CELL, oz + cy * CELL) ? 1 : 0;
      }
    }
    const sorted = Float32Array.from(this.sim.bed).sort();
    const mark = sorted[Math.floor(sorted.length * FEED_ABOVE)];
    for (let i = 0; i < this.catchment.length; i++) {
      // The sea is not a catchment. Below the waterline the ocean
      // already owns the surface and rain on it is just noise.
      const land = this.sim.bed[i] > 0;
      this.catchment[i] = land && this.sim.bed[i] >= mark ? 1 : 0;
      if (!land) this.course[i] = 0;
    }
  }

  /** Seat the window against the floating origin. */
  place(): void {
    const seat = toLocal(world(this.centreX, this.centreZ));
    this.mesh.position.set(seat.lx, 0, seat.lz);
    this.centreRef.value.set(this.centreX, this.centreZ);
  }

  /** Advance the water and lift the surface onto the drawn ground. */
  update(dt: number): void {
    if (!this.placed) return;
    this.clockRef.value += dt;
    const step = this.sim.opts.dt;
    const owed = dt / step + this.carry;
    const steps = Math.min(Math.floor(owed), 120);
    this.carry = owed - Math.floor(owed);
    const storm = Math.min(MAX_FEED, STORM_PER_MM * this.precipitation);
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.course.length; i++) {
        // Baseflow into the watercourse, always.
        if (this.course[i]) this.sim.depth[i] += BASEFLOW * step;
        // Stormflow over the catchment, only while it rains — so the
        // slopes wet up in a shower and soak dry after it.
        if (storm > 0 && this.catchment[i]) this.sim.depth[i] += storm * step;
      }
      this.sim.step(true);
    }
    const relief = reliefScale();
    for (let i = 0; i < this.depthAttr.length; i++) {
      const d = this.sim.depth[i];
      // THE FRESH SHEET STANDS DOWN OVER THE SEA, and this is not
      // cosmetic. The window follows her everywhere, sea included, and
      // in rain its cells out there hold a millimetre of film: three
      // percent alpha — invisible — but it still WROTE DEPTH, and
      // being a film it is lifted toward the camera, so it silently
      // occluded the entire near ocean sheet. Every wave drawn for two
      // versions was hidden behind rain nobody could see, which is why
      // the sea looked like glass while the queen bobbed on swell she
      // could feel. Below sea level the ocean owns the water — the
      // same rule the query already follows (see the constructor).
      this.depthAttr[i] = this.base[i] < 0 ? 0 : d;
      this.pos[i * 3 + 1] = this.base[i] + d * relief;
      // AND THE SKIN DOES NOT DRIFT EITHER — the other half of the
      // same fault. Zeroing the gameplay current in `spotAt` while
      // this went on writing the raw solver velocity into the vertex
      // attribute would leave the surface advecting at exactly the
      // numbers that had just been rejected as a current: the ripple
      // octaves are scrolled along this vector, so the pond would
      // still LOOK like it was running at four metres a second. Water
      // that does not move her must not look like it is moving.
      //
      // The hydrology itself still runs — it is what decides where
      // water IS, and that was never in question. What it does not do,
      // until there is a stream model worth the name, is move
      // anything. NOT tied to wind either: a pond's skin drifting on a
      // breeze would be a second invented current in a better hat.
      this.flowAttr[i * 2] = 0;
      this.flowAttr[i * 2 + 1] = 0;
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('depth').needsUpdate = true;
    g.getAttribute('flow').needsUpdate = true;
  }

  /**
   * The full reading at a world point: drawn depth and current.
   *
   * BILINEAR on the depth, and that is not polish. The sim is 1 m
   * cells and she is one CENTIMETRE long; nearest-cell depth steps
   * half a metre at every cell border, and an ant floating across one
   * would pop like a piston. Interpolated, the surface she rides is
   * as continuous as the drawn sheet above her. Flow is nearest-cell —
   * a current does not need to be smooth to be believable.
   */
  spotAt(wx: number, wz: number): WaterSpot | null {
    if (!this.placed) return null;
    const span = N * CELL;
    const fx = (wx - (this.centreX - span / 2)) / CELL;
    const fy = (wz - (this.centreZ - span / 2)) / CELL;
    const cx = Math.floor(fx);
    const cy = Math.floor(fy);
    if (cx < 0 || cy < 0 || cx >= N - 1 || cy >= N - 1) return null;
    const tx = fx - cx;
    const ty = fy - cy;
    const d = this.sim.depth;
    const d00 = d[cy * N + cx];
    const d10 = d[cy * N + cx + 1];
    const d01 = d[(cy + 1) * N + cx];
    const d11 = d[(cy + 1) * N + cx + 1];
    const raw = (d00 * (1 - tx) + d10 * tx) * (1 - ty)
      + (d01 * (1 - tx) + d11 * tx) * ty;
    if (raw <= 0) return null;
    // FRESH WATER DOES NOT CARRY HER — for now, and deliberately.
    //
    // The solver's velocity is flux over depth, and depth goes to zero
    // at the edge of every pool: a millimetre of film with any flux at
    // all divides out to metres a second. Measured on Joshua's device,
    // 368 cm/s over 1.5 mm of water, and worse elsewhere — an ant
    // standing in a puddle swept at four metres a second. Reproduced
    // from the solver's own arithmetic: one step on a median 11.5°
    // Kauaʻi slope over a 1.5 mm film reports ~1,300 units/s, and a
    // film left to settle reports a steady ~4,000. That is a
    // singularity in the shallow-water scheme, not a current, and
    // capping it would only hide the same nonsense at a smaller
    // number.
    //
    // So inland water is still until it has a flow system of its own.
    // A real stream wants its own model — channel slope, a sane
    // velocity floor, and a depth below which water does not move a
    // body at all — and that is a piece of work, not a clamp. The
    // OCEAN's current is untouched: it comes from the wave table
    // (seaSwell.seaOrbitalAt) and the surf, on the other branch of
    // this very query, and none of this reaches it.
    return { depth: raw * reliefScale(), flowX: 0, flowZ: 0 };
  }

  /** Depth of water at a world point, or 0. For wading and drinking. */
  depthAt(wx: number, wz: number): number {
    if (!this.placed) return 0;
    const span = N * CELL;
    const cx = Math.round((wx - (this.centreX - span / 2)) / CELL);
    const cy = Math.round((wz - (this.centreZ - span / 2)) / CELL);
    if (cx < 0 || cy < 0 || cx >= N || cy >= N) return 0;
    return this.sim.depth[cy * N + cx];
  }

  /** Cells currently drawn as water. -1 means the survey never landed. */
  drawnCells(): number {
    let n = 0;
    for (let i = 0; i < this.sim.depth.length; i++) if (this.sim.depth[i] > DRAWN) n++;
    return n;
  }

  dispose(): void {
    useWaterQuery(null);
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
