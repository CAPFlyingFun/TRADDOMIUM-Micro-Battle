/**
 * THE ISLAND'S FRESH WATER — one simulated window that walks with her,
 * drawn wearing the ocean's look.
 *
 * The NEAR tier of the two Joshua asked for (2026-09-06: "Do the
 * two-tier, dynamic near and surveyed ribbons far"). This half is the
 * dynamic one: a virtual-pipes shallow-water solver over a patch of the
 * real island, fed by rain from the weather and baseflow into the
 * channels the terrain's own drainage defines, with the water finding
 * its own pools, its own spills and its own way to the sea.
 *
 * WHY A WINDOW AND NOT AN ISLAND, in v0's numbers because they are still
 * the numbers: Kauaʻi is 56 km across, and at the 1 m cell that lets a
 * 5.5 m stream exist at all the whole island is 3.1 BILLION cells. The
 * paper's own Table 1 has a 4096² grid running at 0.0005x real time.
 * A 256 m window is 65,536 cells and measured 1.00x. Water she cannot
 * see does not need to be moving; water she is standing in does.
 *
 * WHERE THE WATER COMES FROM — and it is not springs on peaks. v0 tried
 * the obvious thing first and measured it failing: it injected water
 * onto the 1,121 surveyed river courses, on the reasoning that the
 * survey knows where Kauaʻi's rivers are. It does. But feeding a LINE is
 * not feeding a CATCHMENT, and 29.7% of those surveyed points are
 * BURIED — the terrain stands above the water's own recorded level — so
 * the water ran off the course and pooled where the ground actually
 * dips. Only two points in eight finished with any water within five
 * metres, and turning the rate up floods the valley instead.
 *
 * So: rain on the catchment, and the terrain does the routing. D8 flow
 * accumulation over the whole immutable island says which cells carry a
 * watercourse; those get BASEFLOW between showers, everything gets RAIN
 * while it is raining. That separation is why the island drains rather
 * than every slope staying permanently wet — the question Joshua asked
 * v0 and the reason `drainage.ts` exists.
 *
 * THE SURVEY IS THE CHECK, NOT THE INPUT. `world/water/hydro.ts` holds
 * the 1,121 surveyed runs; the far tier draws them and a test can ask
 * how much of the network the naturally-routed water lands on. If the
 * two disagree the answer is to report it, not to bend the island.
 *
 * ─── what this file owns, and what it must not ───────────────────────
 *
 * It owns a `WaterSim`, a mesh and the buffers between them. It does NOT
 * own the ground: the bed is read through a sampler and written nowhere.
 * `src/world/` is core and pure; this is the renderer that draws what
 * core computed, which is why the solver lives there and this lives here.
 */
import * as THREE from 'three';
import { world, type WorldPoint } from '../world/coords';
import { SEA_LEVEL, type Heightfield } from '../world/heightfield';
import { toLocal } from '../world/origin';
import type { SeaSwell } from '../world/sea/swell';
import { WaterSim, type WaterFeed } from '../world/water/sim';
import type { WaterSpot } from '../world/water/router';
import type { SeaTextures } from '../sea/SeaTextures';
import { makeInlandLook } from './inlandLook';
import type { WaterLook } from '../sea/waterLook';

/**
 * The window's cell, world units. One metre.
 *
 * NOT A RUNG'S TO CHANGE, for the same reason the ocean's near cell is
 * not: it is what lets a stream exist. Kauaʻi's median surveyed channel
 * is 5.5 m, so a 1 m cell gives it five cells across and a 2 m cell
 * gives it two — at which point a river is a row of disconnected pixels
 * and no amount of shading fixes it. What a rung moves is how FAR the
 * window reaches, which is `WINDOW_CELLS`.
 */
const CELL = 100;

/**
 * Cells a side, per detail rung — so the window costs what the rung
 * says, in the one currency it can spend: reach.
 *
 * The solver is O(n²) per step AND the mesh re-uploads n² vertices every
 * frame, because unlike the sea's sheets this water CHANGES — that is
 * the whole point of it. So the rung buys a square of ground:
 *
 *   ultra-high  384²  147,456 cells   384 m across
 *   high        256²   65,536 cells   256 m   — v0's, measured 1.00x
 *   medium      192²   36,864 cells   192 m
 *   low         128²   16,384 cells   128 m
 *   ultra-low    96²    9,216 cells    96 m
 *
 * HIGH IS v0's EXACTLY, because 256² at 1 m is the size v0 measured at
 * real time in a browser and the only number here with a measurement
 * behind it. The others are that square scaled; they are GAME TUNING
 * until Joshua's phone says otherwise, which is what the HUD's FRESH
 * line is for.
 */
const WINDOW_CELLS: Readonly<Record<string, number>> = Object.freeze({
  'ultra-low': 96,
  low: 128,
  medium: 192,
  high: 256,
  'ultra-high': 384,
});

/**
 * How far the camera may travel before the window re-anchors: an eighth
 * of it, as whole cells.
 *
 * The same trick and the same reason as the ocean's sheets — a recentre
 * that is a whole number of cells keeps every cell on one fixed world
 * lattice, so the water can be CARRIED across rather than resampled.
 * Interpolating a depth field is how you invent water that was never
 * there: a pool one cell wide becomes two cells of half a pool, every
 * recentre, forever.
 */
const RECENTRE_CELLS = 8;

/**
 * Depth below which a cell is not DRAWN, world units.
 *
 * Not the same as dry: the solver keeps its film and the query still
 * answers there. This is only about the mesh, and it exists because a
 * hillside after rain is covered in a millimetre of water that is
 * physically real and visually nothing — drawing it puts a sheet of
 * glass over the whole island. Two millimetres is v0's 1.5 rounded to
 * where the edge feather (`edgeLo` 1.5) has something to fade.
 */
const DRAWN_DEPTH = 2;

/**
 * Simulated seconds to run the window forward when it is first placed,
 * so a player who walks up to a river finds a river.
 *
 * TEN SECONDS IS NOT THE SETTLED STATE, and the comment that used to
 * stand here said it was. Measured at the shipped window and rate over
 * two marked channel cells (the table on the scene's
 * `BASEFLOW_PER_SECOND`), a valley floor goes on filling for five
 * MINUTES and equilibrates at 93% of the window under water; ten seconds
 * is a quarter of the way there. The old claim — same numbers at 10, 30
 * and 60 — held at one headwater site and was written as though it held
 * everywhere.
 *
 * TEN SECONDS IS RIGHT ANYWAY, for a reason that survives the
 * correction: IT IS WHAT A MOVING PLAYER SEES. The window re-anchors
 * every `RECENTRE_CELLS` metres and the strip ahead of her arrives dry,
 * so at the flying speed this scene allows no ground carries much more
 * than eight seconds of simulation before it leaves again. Priming to
 * ten puts the loading screen's water where travel keeps it. Priming to
 * the equilibrium would show her, once, a valley she can never reach
 * again by walking into it — and cost half a minute of loading to do it.
 *
 * SIXTY WAS THE FIRST ANSWER AND IT WAS MEASURED AT THE WRONG NUMBERS —
 * a looser channel threshold, a 128 m window. At what actually ships,
 * ten costs a sixth as much: 770 ms against 4.6 s at 256².
 *
 * IT HAPPENS BEHIND THE LOADING SCREEN, once, like the ocean's first
 * sheet fill and for the same reason: `prime` is called by the scene
 * while the loader is still up. Run on the first drawn frame it is a
 * stall the player sees — measured at 5.5 s before this moved, which the
 * HUD reported as `fresh pk 5527.8` and which no amount of comment
 * saying otherwise made untrue.
 *
 * A RECENTRE DOES NOT REPEAT IT. The window carries its water across and
 * only a thin strip of ground is new, so the strip fills on its own in
 * the seconds it takes to walk the next eight metres. Priming every
 * recentre would be a minute of simulation every eight metres, which is
 * the whole budget for a step nobody asked for.
 */
const WARM_UP_SECONDS = 10;

/** What the ocean's HUD line reports, in the same shape, for the same reason. */
export interface FreshCost {
  readonly meanMs: number;
  readonly peakMs: number;
  readonly wetCells: number;
  readonly cells: number;
}

export interface IslandWaterOptions {
  readonly field: Pick<Heightfield, 'heightAt' | 'revision'>;
  readonly swell: SeaSwell;
  readonly textures: SeaTextures;
  readonly detail: string;
  readonly octaves: number;
  /**
   * Whether a world point carries a watercourse — a WORLD-FIXED answer,
   * computed once over the whole island.
   *
   * World-fixed because accumulation over a moving window depends on
   * where its rim falls: v0 ran D8 over the window's own bed every
   * recentre, two windows one recentre apart disagreed on 16% of their
   * shared channel cells, and the rivers visibly morphed as the player
   * flew at them.
   */
  readonly isChannel: (at: WorldPoint) => boolean;
}

const now = (): number => performance.now();

export class IslandWater {
  readonly group = new THREE.Group();
  readonly sim: WaterSim;

  private readonly field: Pick<Heightfield, 'heightAt' | 'revision'>;
  private readonly look: WaterLook;
  private readonly mesh: THREE.Mesh;
  private readonly n: number;
  private readonly position: Float32Array;
  private readonly depthAttr: Float32Array;
  private readonly isChannel: (at: WorldPoint) => boolean;
  private channels: Uint8Array | null = null;
  private centre: WorldPoint | null = null;

  private warmed = false;
  private spentMs = 0;
  private frames = 0;
  private totalMs = 0;
  private peakMs = 0;

  constructor(options: IslandWaterOptions) {
    this.field = options.field;
    this.isChannel = options.isChannel;
    const n = WINDOW_CELLS[options.detail] ?? WINDOW_CELLS.medium;
    this.n = n;
    this.group.name = 'freshwater';

    this.sim = new WaterSim({ n, cell: CELL, dt: 0.02, damping: 0.995, soak: 0.3 });

    this.look = makeInlandLook({
      swell: options.swell,
      textures: options.textures,
      octaves: options.octaves,
    });

    const geometry = new THREE.BufferGeometry();
    this.position = new Float32Array(n * n * 3);
    this.depthAttr = new Float32Array(n * n);
    const normals = new Float32Array(n * n * 3);
    const flow = new Float32Array(n * n * 2);
    const half = (n * CELL) / 2;
    for (let cy = 0; cy < n; cy += 1) {
      for (let cx = 0; cx < n; cx += 1) {
        const i = cy * n + cx;
        this.position[i * 3] = cx * CELL - half;
        this.position[i * 3 + 2] = cy * CELL - half;
        normals[i * 3 + 1] = 1;
      }
    }
    const faces = new Uint32Array((n - 1) * (n - 1) * 6);
    let f = 0;
    for (let cy = 0; cy < n - 1; cy += 1) {
      for (let cx = 0; cx < n - 1; cx += 1) {
        const a = cy * n + cx;
        faces[f] = a; faces[f + 1] = a + n; faces[f + 2] = a + 1;
        faces[f + 3] = a + 1; faces[f + 4] = a + n; faces[f + 5] = a + n + 1;
        f += 6;
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('depth', new THREE.BufferAttribute(this.depthAttr, 1));
    geometry.setAttribute('flow', new THREE.BufferAttribute(flow, 2));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));

    this.mesh = new THREE.Mesh(geometry, this.look.material);
    // It rides the camera, so its bounding sphere always contains it and
    // a frustum test could never reject it — the same honest answer the
    // ocean's sheets give.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
  }

  /** How many cells this window is, per side. For a HUD and a test. */
  get cells(): number {
    return this.n;
  }

  /** How far it reaches from the camera, world units. */
  get reach(): number {
    return (this.n * CELL) / 2;
  }

  /**
   * Fill the window before anyone looks at it. Called ONCE, by the scene,
   * while the loading screen is still up.
   *
   * Without it the island is dry for the first ten seconds of every
   * session, which reads as the water being broken rather than as the
   * water arriving. With it on the first drawn frame instead, it is a
   * five-second freeze — measured, before this was moved here.
   */
  prime(at: WorldPoint, baseflowPerSecond: number): void {
    if (this.warmed) return;
    this.warmed = true;
    this.update(at, 0, 0, baseflowPerSecond);
    const feed: WaterFeed = { rainPerSecond: 0, baseflowPerSecond, channels: this.channels };
    // Whole seconds, so the solver's own per-call step cap cannot
    // silently swallow the request.
    for (let t = 0; t < WARM_UP_SECONDS; t += 1) this.sim.advance(1, feed);
    this.writeMesh();
    this.resetCost();
  }

  /**
   * Place the window, run the water, and rewrite the mesh from it.
   *
   * `dt` is SIMULATION seconds — the water stops when the world is
   * paused, for the same reason the sea's clock does.
   */
  update(at: WorldPoint, dt: number, rainPerSecond: number, baseflowPerSecond: number): void {
    const began = now();
    const revision = this.field.revision();
    const moved = this.centre === null
      || Math.abs(at.wx - this.centre.wx) >= RECENTRE_CELLS * CELL
      || Math.abs(at.wz - this.centre.wz) >= RECENTRE_CELLS * CELL;

    if (moved || this.channels === null) {
      this.sim.placeAt(at, (p) => this.field.heightAt(p), revision);
      // The channel mask is world-fixed but the WINDOW is not, so the
      // lookup has to be redone wherever the window lands. It is the
      // membership that is recomputed, never the accumulation.
      this.channels = this.sim.channelMask(this.isChannel);
      this.centre = at;
    } else {
      // Standing still, but an HD tile may have landed. The solver
      // decides whether that means anything; it is one comparison.
      this.sim.placeAt(this.centre as WorldPoint, (p) => this.field.heightAt(p), revision);
    }

    const feed: WaterFeed = { rainPerSecond, baseflowPerSecond, channels: this.channels };
    this.sim.advance(dt, feed);
    this.writeMesh();
    this.spentMs += now() - began;
  }

  /**
   * Rewrite the mesh's heights and depths from the grid.
   *
   * EVERY FRAME, unlike the ocean's sheets, and that is not waste — this
   * water changes, which is the entire reason it is simulated rather
   * than drawn. It is also the cost: n² positions and n² depths written
   * and re-uploaded, which is what the HUD's FRESH line exists to show
   * on a real phone.
   *
   * A DRY CELL IS DRAWN AT THE BED WITH ZERO DEPTH rather than skipped.
   * The index buffer is fixed, so a skipped vertex would have to be
   * moved somewhere — and anywhere is somewhere. At zero depth the edge
   * feather has already faded it to nothing, so it costs a vertex and
   * shows nobody anything.
   */
  private writeMesh(): void {
    const g = this.sim.grid();
    const n = this.n;
    for (let i = 0; i < n * n; i += 1) {
      const d = g.depth[i];
      const drawn = d >= DRAWN_DEPTH ? d : 0;
      this.position[i * 3 + 1] = g.bed[i] + drawn;
      this.depthAttr[i] = drawn;
    }
    const geometry = this.mesh.geometry;
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('depth') as THREE.BufferAttribute).needsUpdate = true;

    const centre = this.sim.isPlaced() ? this.windowCentre(g.origin) : null;
    if (centre !== null) {
      const seat = toLocal(centre);
      this.mesh.position.set(seat.lx, 0, seat.lz);
      this.look.setCentre(centre.wx, centre.wz);
    }
  }

  /** The window's middle, from the origin the solver reports. */
  private windowCentre(origin: WorldPoint): WorldPoint {
    const half = (this.n * CELL) / 2;
    return world(origin.wx + half, origin.wz + half);
  }

  /** Advance the ripple. Seconds; the ONE clock, as the sea's is. */
  tick(dt: number): void {
    this.look.clock.value += dt;
    this.frames += 1;
    this.totalMs += this.spentMs;
    this.peakMs = Math.max(this.peakMs, this.spentMs);
    this.spentMs = 0;
  }

  get cost(): FreshCost {
    return {
      meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames,
      peakMs: this.peakMs,
      wetCells: this.sim.isPlaced() ? this.sim.wetCells(DRAWN_DEPTH) : 0,
      cells: this.n * this.n,
    };
  }

  /** Forget the cost record — used after the load-time fill, as the ocean does. */
  resetCost(): void {
    this.spentMs = 0;
    this.frames = 0;
    this.totalMs = 0;
    this.peakMs = 0;
  }

  /**
   * The water at a point, for the router. `null` where this window has
   * none — which includes everywhere outside it.
   *
   * NOT BELOW SEA LEVEL. The router classifies by the bed and hands
   * sub-sea-level ground to the ocean; this is the same rule said on
   * this side of it, so a window that overlaps the coast cannot answer
   * for water the sea owns.
   */
  spotAt(at: WorldPoint): (WaterSpot & { readonly kind: 'fresh' }) | null {
    const spot = this.sim.spotAt(at);
    if (spot === null) return null;
    return this.field.heightAt(at) < SEA_LEVEL ? null : spot;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.look.material.dispose();
    this.group.clear();
  }
}
