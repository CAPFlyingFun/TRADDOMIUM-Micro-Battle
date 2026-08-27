import * as THREE from 'three';
import { groundHeight, terrainHeight, reliefScale } from './heightfield';
import { toLocal } from './origin';
import { world } from './coords';
import { WaterSim, DEFAULTS } from './waterSim';

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
 * Real hydrology's own split: a channel carries baseflow from the
 * groundwater of its whole catchment, plus stormflow when it rains.
 * This is the first half, and it is a MODELLING CONSTANT rather than a
 * measurement, which is worth being straight about.
 *
 * It has to be, because real rain cannot feed this window. Kauaʻi's
 * rivers are fed by catchments kilometres across; the simulated window
 * is 256 m. At a real 5 mm/hr, a cell gains 0.00014 units a second —
 * four orders of magnitude under what a channel needs. So this stands
 * in for the upstream catchment the window cannot see, and the honest
 * name for it is baseflow rather than rain.
 *
 * SWEPT, not chosen. Against the surveyed network, measured as "does
 * any water land within 5 m of where the survey says a river is":
 *
 *   0.4 -> 4/8 on course, 14% of cells wet
 *   0.8 -> 6/8,           24%
 *   1.5 -> 8/8,           38%     <- the knee
 *   3.0 -> 8/8,           62%
 *
 * 1.5 is the whole network wet for sixty per cent of the flooding.
 * Past it the extra water goes onto hillsides, not into channels.
 */
const BASEFLOW = 1.5;
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
/** Rain falls on cells above this quantile of the window's own bed. */
const FEED_ABOVE = 0.5;

export class IslandWater {
  private readonly sim = new WaterSim({ n: N, cell: CELL, dt: DEFAULTS.dt, soak: SOAK });
  private readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly depthAttr: Float32Array;
  /** Drawn ground under each cell — static until the window moves. */
  private readonly base = new Float32Array(N * N);
  /** Feed rate per cell, from the survey. Static until the window moves. */
  private readonly feed = new Float32Array(N * N);
  private centreX = 0;
  private centreZ = 0;
  private carry = 0;
  /** Millimetres an hour, from the weather service. */
  private precipitation = 0;
  /** Whether the window has been placed at all. */
  private placed = false;

  constructor(private readonly scene: THREE.Scene) {
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(this.depthAttr, 1));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));
    this.mesh = new THREE.Mesh(geometry, this.material());
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  private material(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.14, metalness: 0.1,
      transparent: true, side: THREE.DoubleSide,
      // LIFTED toward the camera. The surface is drawn on the same
      // triangle the ground is, so where the water is a film the two
      // are coplanar and the tie has to be broken somewhere.
      polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -6,
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n attribute float depth;\n varying float vDepth;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n vDepth = depth;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n varying float vDepth;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            if (vDepth < ${DRAWN.toFixed(4)}) discard;
            // Ramped over centimetres: a stream here is tens of units
            // deep, and a ramp built for an ocean paints every one of
            // them the same flat nothing.
            float t = clamp(vDepth / 60.0, 0.0, 1.0);
            diffuseColor.rgb = mix(vec3(0.60, 0.84, 0.86), vec3(0.05, 0.24, 0.55), t * t);
            diffuseColor.a = mix(0.62, 0.97, t);
          }`);
    };
    return material;
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
    // RAIN ON THE UPPER CATCHMENT of this window, and nothing else.
    //
    // Not every cell: a window fed evenly fills like a bathtub and the
    // terrain never gets to decide anything (Beyond Extinction's
    // WaterLab spent four releases learning that). The high ground
    // sheds, the low ground collects, and where it collects is the
    // answer we are asking the solver for.
    const sorted = Float32Array.from(this.sim.bed).sort();
    const mark = sorted[Math.floor(sorted.length * FEED_ABOVE)];
    for (let i = 0; i < this.feed.length; i++) {
      // The sea is not a catchment. Below the waterline the ocean
      // already owns the surface and rain on it is just noise.
      // Stored as a MASK; the rate is applied per step so the weather
      // can move it without re-walking 65,536 cells every frame.
      this.feed[i] = this.sim.bed[i] >= mark && this.sim.bed[i] > 0 ? 1 : 0;
    }
  }

  /** Seat the window against the floating origin. */
  place(): void {
    const seat = toLocal(world(this.centreX, this.centreZ));
    this.mesh.position.set(seat.lx, 0, seat.lz);
  }

  /** Advance the water and lift the surface onto the drawn ground. */
  update(dt: number): void {
    if (!this.placed) return;
    const step = this.sim.opts.dt;
    const owed = dt / step + this.carry;
    const steps = Math.min(Math.floor(owed), 120);
    this.carry = owed - Math.floor(owed);
    const rate = Math.min(MAX_FEED, BASEFLOW + STORM_PER_MM * this.precipitation);
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.feed.length; i++) {
        if (this.feed[i] > 0) this.sim.depth[i] += rate * step;
      }
      this.sim.step(true);
    }
    const relief = reliefScale();
    for (let i = 0; i < this.depthAttr.length; i++) {
      const d = this.sim.depth[i];
      this.depthAttr[i] = d;
      this.pos[i * 3 + 1] = this.base[i] + d * relief;
    }
    const g = this.mesh.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('depth').needsUpdate = true;
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
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
