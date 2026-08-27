import * as THREE from 'three';
import { groundHeight, terrainHeight, reliefScale } from './heightfield';
import { toLocal } from './origin';
import { world } from './coords';
import type { Hydro } from './hydro';
import { WaterSim, DEFAULTS } from './waterSim';
import { feedFromSurvey } from './waterFeed';

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
 * FED FROM THE SURVEY, NOT FROM RAIN. Rain on every cell floods the
 * window into a bathtub (Beyond Extinction's WaterLab learned this and
 * it cost them four releases). The 1,121 surveyed NHDPlus runs already
 * say where Kauaʻi's water is and how big each reach is; injecting
 * there and letting the solver decide the rest is the division of
 * labour that has been missing all along:
 *
 *   the SURVEY says where a river is and how much comes down it
 *   the SOLVER says how wide it gets, how deep, and where it spills
 *
 * Nobody has to choose a width, a bank, or an edge — which is the
 * entire class of decision that produced every artefact in this file's
 * history.
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
const FEED_PER_ORDER = 32;

/*
 * WHY 32 AND WHY IT IS NOT THE RIGHT ANSWER.
 *
 * It shipped at 1.6, which was a number I chose rather than derived,
 * and tests/fullness.test.ts says what that bought: of a sample of
 * surveyed points, only 2 in 8 had any water within five metres. A
 * quarter of the network wet, and the rest of it dry ground with a
 * river drawn through it on the map.
 *
 * Swept: 12 -> 4/8, 20 -> 4/8, 32 -> 7/8, 40 -> 8/8. So 32 is most of
 * the network with less of the flood, and it is an interim.
 *
 * THE REASON IT COSTS A FLOOD. 40/order puts about 930 m³ into a 128 m
 * window, which is six centimetres of standing water averaged over
 * everything, channel and hillside alike. Water only concentrates
 * where the ground gives it somewhere to concentrate, and on this
 * island 29.7% of the surveyed network is BURIED — the terrain stands
 * above the water's own surveyed level, by a median of 0.56 m. Fed
 * there, water runs off the course and pools wherever the valley
 * floor happens to dip.
 *
 * So the rate is compensating for a missing channel, and no rate
 * fixes that: turn it up and the valley floods, turn it down and the
 * river is dry. The fix is a shallow bed cut along the surveyed
 * course. Measured on the HD grid: a 0.6 m bed holds 85.6% of the
 * network, 1.2 m holds 89.9%, 2.4 m holds 93.9% — against 70.3% with
 * no bed at all. With a groove to sit in, this rate comes back down.
 */

export class IslandWater {
  private readonly sim = new WaterSim({ n: N, cell: CELL, dt: DEFAULTS.dt });
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
  /** Whether the window has been placed at all. */
  private placed = false;

  constructor(private readonly scene: THREE.Scene, private readonly hydro: Hydro | null) {
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
    this.feed.fill(0);
    if (!this.hydro) return;
    // THE SURVEY, RASTERISED INTO THE WINDOW — courses and orders, and
    // nothing else about the rivers at all. No width, no bank, no
    // centreline geometry: those are the solver's business now, and
    // they are exactly the decisions that went wrong every previous
    // time somebody made them by hand. See waterFeed.ts.
    this.feed.set(feedFromSurvey(this.hydro, ox, oz, N, CELL, FEED_PER_ORDER));
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
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.feed.length; i++) {
        if (this.feed[i] > 0) this.sim.depth[i] += this.feed[i] * step;
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
