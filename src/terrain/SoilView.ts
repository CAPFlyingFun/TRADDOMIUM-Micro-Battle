/**
 * Bounded, disposable rendering cache. SparseSoil alone owns the soil.
 *
 * THE SECTION COSTS NOTHING WHEN IT IS SHUT. SOIL is an observer cutaway
 * and nothing else, so with no cut window there is no soil to mesh: a
 * closed view selects nothing, holds no resident, builds nothing and
 * draws nothing, and it releases everything it holds on the frame the
 * window closes.
 *
 * That is a correction, not a tuning. The selection used to fall back to
 * up to 36 edited columns near the observer whenever the depth was zero,
 * so every player carried a couple of hundred thousand triangles and two
 * columns of marching tetrahedra a frame for a cutaway they had never
 * opened — and a worm bumps those columns' revisions continuously,
 * because burrowing is what worms are for. Measured over 60 shut frames
 * against a soil carrying 300 worm strokes: 1,569 ms before, 0.3 ms
 * after. A phone that had been holding 60 fps read 23.
 *
 * The price, stated plainly: with the section shut the coarse sheet is
 * no longer clipped, so a tunnel mouth is no longer visible from the
 * surface. That is a real loss, and it is what the frame rate was being
 * spent on. A cheap surface-only mark can come back later as its own
 * thing; it is not worth meshing entire columns to get one as a side
 * effect.
 *
 * NOTHING IS SHOWN UNTIL THE WHOLE WINDOW IS READY (2026-09-08). The
 * view keeps two sets of columns. SHOWN is the last complete window: its
 * meshes are visible, and it is the ONLY set ever published through
 * `readyTiles`, so the coarse sheet is clipped over a column exactly
 * when a whole pit stands under it. STAGED is what the current window
 * still needs — entering columns, and replacements for a column whose
 * revision, rim role, frontier, cut depth or survey has changed. They
 * are built hidden and unpublished, and nothing in SHOWN is released,
 * hidden or unpublished while its replacement is not yet built. When
 * every wanted column is ready (`cost.pending` reaches 0) the two sets
 * change places in ONE update: what is no longer wanted is released,
 * the new meshes are shown, and the wanted set is published.
 *
 * Why: the far-rim hole in shots/cutaway-outside.png. Nearest-first, a
 * 4 ms frame at a time, the pit used to arrive from the focus outward,
 * and each published column bordering a column still in the queue had
 * neither a wall nor a bridge on that side — the neighbour was wanted,
 * so it was counted as soil that would be there. From above, the twelve
 * millimetres between the published floor and the neighbour's still
 * unclipped sheet read as sky: the void under the island, seen through
 * the missing wall. Nothing partial is published now, so there is no
 * frame in which a published column borders an unbuilt one, and Joshua's
 * ask — keep the old completed view until the new one is ready — is the
 * mechanism rather than a special case of it.
 *
 * The consequences, stated plainly: a depth change no longer clears —
 * the old pit stays, at its old depth, until the new one is whole; a
 * moved window keeps its old columns until the entering row is ready;
 * and a worm that keeps biting one column faster than a column builds
 * keeps the last whole pit on screen rather than a flickering one. GPU
 * memory doubles at the worst moment, a whole window replaced at once,
 * which is one of the two reasons the window's half-width is capped. A
 * SHUT section (depth 0) still releases everything, both sets, on the
 * frame it closes.
 */
import * as THREE from 'three';
import { distanceSquared, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as worldToLocal } from '../world/origin';
import { type SparseSoil, type SoilTile } from '../world/SparseSoil';
import { soilTileAt, soilTileCentre, type SoilPoint } from '../world/soilTypes';
import { meshSoilTile, type SoilCutWindow } from './soilMesh';

interface Resident {
  readonly tile: SoilTile;
  readonly rim: number;
  readonly frontier: number;
  /**
   * The cut and the survey this column was built against. The cut is a
   * lens on the soil, so a column at one depth says nothing about the
   * same soil at another; a resident carries its own inputs rather than
   * the view remembering one depth for all of them, because the SHOWN
   * set may stand at an old depth while the STAGED set is built at a
   * new one.
   */
  readonly depth: number;
  readonly survey: number;
  readonly origin: SoilPoint | null;
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> | null;
}
export interface SoilViewOptions {
  readonly soil: SparseSoil;
  readonly toLocal?: (at: WorldPoint) => LocalPoint;
  /** Render-only height of the actual coarse triangle at a patch boundary. */
  readonly drawnHeightAt?: (at: WorldPoint) => number | null;
  /**
   * The build budget's clock, in milliseconds. Injected only so a test
   * can spend a stated amount per column and pin the queue's behaviour
   * on a machine of any speed.
   */
  readonly now?: () => number;
}
/**
 * THE BUILD IS BUDGETED IN MILLISECONDS, NOT IN COLUMNS.
 *
 * A ration of columns cannot know what a column costs. Measured against
 * a soil carrying 300 worm strokes, one 3.2 cm column takes 26.9 ms
 * where a worm has dug and 7.8 ms where none has, and a whole 60 fps
 * frame is 16.7 ms — so the old ration of two was a dropped frame by
 * construction, every time a revision moved, which is every time a worm
 * takes a bite.
 *
 * GAME TUNING: 4 ms, about a quarter of a 60 fps frame, leaving the rest
 * for the terrain, the sea, the animals and the draw. The frame's FIRST
 * column always builds however dear it turns out to be, since a column
 * nothing can afford would otherwise never be built at all. A LATER one
 * starts only if what the frame has already spent, plus the dearest
 * column it has actually measured, still fits — an estimate rather than
 * a count, because the alternative is a 3 ms column dragging a 150 ms
 * column into the same frame on the grounds that the budget was not
 * quite gone yet.
 *
 * So the worst frame is one column, a heavily dug window arrives over
 * more frames instead of in fewer and longer ones, and the total work is
 * unchanged: it is spread, not saved. Making a single column itself
 * cheaper is soilMesh.ts's question, not this one's.
 */
const BUILD_BUDGET_MS = 4;
/**
 * THE WINDOW'S HALF-WIDTH IS THE CALLER'S. The section is ±halfTiles
 * columns around the focus. The default of 3 (36 columns, 19.2 cm a
 * side) is what the section always was; the scene passes one sized to
 * the selected worm, because the rim is sealed (soilMesh.ts) and a
 * tunnel that reaches it meets a wall, which is only right when that
 * wall stands beyond the animal and the burrow the player is looking at.
 *
 * GAME TUNING: the cap is 8 (256 columns, 51.2 cm a side), and it is
 * there for the phone's sake twice over. Measured 2026-09-08 on the
 * build box (node, a sloping survey, 298 strokes of a worm's burrow, a
 * 1.2 cm cut): a column costs 18-34 ms to mesh and about 9,500
 * triangles whether or not a worm has been through it — the cut floor
 * itself is a 1 mm isosurface, and that is where the triangles are. So
 * halfTiles 3 is 36 columns, 1.0 s of meshing and 370,000 triangles;
 * 6 is 144 columns, 3.2 s and 1.34 million; 8 is 256 columns, 5.2 s
 * and 2.29 million. Once for build time: every column is meshed on the
 * main thread inside the 4 ms budget, one column a frame since each one
 * overruns it, so a window arrives in as many frames as it has columns,
 * and five seconds of "Preparing soil view…" on a phone that is slower
 * than this box is the longest wait worth asking for. And once for
 * triangles: with the double-buffer above a replaced window briefly
 * holds two of everything, and 256 columns twice over is the ceiling
 * on what an observer's cutaway is allowed to cost the GPU. A wider
 * window is a soilMesh.ts question — a flat floor should not cost what
 * a burrow costs — not a bigger number here.
 */
const DEFAULT_HALF_TILES = 3;
const MAX_HALF_TILES = 8;
const tileKey = (tile: SoilTile): string => `${tile.tx},${tile.tz}`;
/** Only the tile's four rim roles affect its geometry when the window moves. */
const rimRole = (tile: SoilTile, window: SoilCutWindow): number =>
  Number(tile.tx === window.minTx) | (Number(tile.tx === window.maxTx - 1) << 1)
    | (Number(tile.tz === window.minTz) << 2) | (Number(tile.tz === window.maxTz - 1) << 3);

export class SoilView {
  readonly group = new THREE.Group();
  private readonly soil: SparseSoil;
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private readonly drawnHeightAt?: (at: WorldPoint) => number | null;
  private readonly now: () => number;
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  /** The last complete window: visible, and the only columns ever published. */
  private readonly shown = new Map<string, Resident>();
  /** Built for the current window, hidden and unpublished until the window is whole. */
  private readonly staged = new Map<string, Resident>();
  private ready: SoilTile[] = [];
  private pending = 0;
  private triangles = 0;

  constructor(options: SoilViewOptions) {
    this.soil = options.soil;
    this.toLocal = options.toLocal ?? worldToLocal;
    this.drawnHeightAt = options.drawnHeightAt;
    this.now = options.now ?? ((): number => performance.now());
    this.group.name = 'soil';
  }

  get readyTiles(): readonly SoilTile[] { return this.ready; }
  /** `pending` is the count of columns still to build for the WANTED window; the inspector's "Preparing soil view…" reads it. */
  get cost(): { tiles: number; triangles: number; pending: number } {
    return { tiles: this.ready.length, triangles: this.triangles, pending: this.pending };
  }

  update(at: WorldPoint, cutDepth: number, surveyRevision: number, halfTiles = DEFAULT_HALF_TILES): void {
    const depth = Number.isFinite(cutDepth) ? Math.max(0, cutDepth) : 0;
    // A shut section has no window, so it has no soil. The release is the
    // whole of the work, and nothing below it runs or is held — not the
    // shown pit, and not a replacement that was half way to being built.
    if (depth === 0) { this.clear(); return; }
    const half = Number.isFinite(halfTiles) ? Math.min(MAX_HALF_TILES, Math.max(1, Math.round(halfTiles))) : DEFAULT_HALF_TILES;
    const centre = soilTileAt(at);
    const window: SoilCutWindow = {
      minTx: centre.tx - half, maxTx: centre.tx + half, minTz: centre.tz - half, maxTz: centre.tz + half,
    };
    const selected = this.select(at, window);
    const wanted = new Map(selected.map(tile => [tileKey(tile), tile]));
    // A staged column the window has moved away from was never shown and
    // now never will be.
    for (const [key, resident] of this.staged) {
      if (!wanted.has(key)) { this.release(resident); this.staged.delete(key); }
    }
    // Pending tiles are prospective voxel neighbors, but a known skipped
    // column retains coarse terrain and must expose the adjoining bridge.
    // What is known is whichever column stands for the tile today: the
    // one staged for this window, else the one shown from the last.
    const voxelNeighbors = new Set(wanted.keys());
    for (const key of wanted.keys()) {
      const resident = this.staged.get(key) ?? this.shown.get(key);
      if (resident && !resident.mesh) voxelNeighbors.delete(key);
    }
    // Only exposed patch edges meet coarse terrain. Shared edges must not
    // grow fences through the continuous soil surface or its cavities.
    const frontierOf = (tile: SoilTile): number => this.drawnHeightAt
      ? Number(!voxelNeighbors.has(`${tile.tx - 1},${tile.tz}`)) | (Number(!voxelNeighbors.has(`${tile.tx + 1},${tile.tz}`)) << 1)
        | (Number(!voxelNeighbors.has(`${tile.tx},${tile.tz - 1}`)) << 2) | (Number(!voxelNeighbors.has(`${tile.tx},${tile.tz + 1}`)) << 3)
      : 0;
    // A column is current when every input its geometry read is what the
    // window wants today: the soil's revision, the cut, the survey, and
    // the two roles the window gives it. Anything less is a replacement
    // still to build, whichever set the stale column is sitting in.
    const current = (resident: Resident | undefined, tile: SoilTile): resident is Resident =>
      resident !== undefined && resident.tile.revision === tile.revision
        && resident.depth === depth && resident.survey === surveyRevision
        && resident.rim === rimRole(tile, window) && resident.frontier === frontierOf(tile);
    const settled = (tile: SoilTile): boolean => {
      const key = tileKey(tile);
      return current(this.staged.get(key), tile) || current(this.shown.get(key), tile);
    };
    // Retire a staged column its inputs have moved past. Nothing SHOWN is
    // touched here: a stale shown column stays on screen, and counts as
    // pending, until its replacement stands.
    const retireStaleStaged = (): void => {
      for (const [key, resident] of this.staged) {
        if (!current(resident, wanted.get(key)!)) { this.release(resident); this.staged.delete(key); }
      }
    };
    retireStaleStaged();
    const started = this.now();
    let built = 0, spent = 0, dearest = 0;
    for (const tile of selected) {
      if (settled(tile)) continue;
      // Nearest first, so what the observer is looking at arrives first,
      // and stop at the budget: the rest of this window waits a frame.
      if (built > 0 && spent + dearest > BUILD_BUDGET_MS) break;
      built++;
      const key = tileKey(tile);
      const rim = rimRole(tile, window), frontier = frontierOf(tile);
      const seam = this.drawnHeightAt ? { edges: frontier, drawnHeightAt: this.drawnHeightAt } : undefined;
      const data = meshSoilTile(this.soil, tile.tx, tile.tz, depth, window, seam);
      // Bill the attempt, not merely the result: a column that turns out
      // to be unmeshable still paid for the lattice scan that discovered
      // it. Read elapsed time SINCE THE FRAME BEGAN rather than summing
      // per-column deltas, so a coarse timer that reads one short column
      // as free cannot be added up to nothing.
      const before = spent;
      spent = this.now() - started;
      dearest = Math.max(dearest, spent - before);
      // Remember skipped revisions too: expensive/incomplete columns are
      // retried only after their inputs change, and NEVER enter readyTiles.
      if (!data) {
        this.staged.set(key, { tile, rim, frontier, depth, survey: surveyRevision, mesh: null, origin: null });
        voxelNeighbors.delete(key);
        continue;
      }
      voxelNeighbors.add(key);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `soil:${key}`;
      mesh.receiveShadow = true;
      // Hidden until the whole window is: it joins the group now so the
      // swap is a flag per mesh, not a scene-graph edit per column.
      mesh.visible = false;
      this.group.add(mesh);
      this.staged.set(key, { tile, rim, frontier, depth, survey: surveyRevision, mesh, origin: data.origin });
    }
    // A build can discover a skipped column after its neighbors were
    // checked (or built) this frame. Retire their obsolete frontier before
    // anything is counted ready; replacement still uses the next build ration.
    retireStaleStaged();
    this.pending = selected.filter(tile => !settled(tile)).length;
    if (this.pending === 0) this.swap(wanted);
    // The render boundary: every shown column is placed against today's
    // origin, every frame, whether or not anything changed above.
    for (const resident of this.shown.values()) {
      if (!resident.mesh || !resident.origin) continue;
      const local = this.toLocal(resident.origin.at);
      resident.mesh.position.set(local.lx, resident.origin.height, local.lz);
    }
  }

  dispose(): void { this.clear(); this.material.dispose(); }

  /**
   * THE ONE UPDATE IN WHICH THE PICTURE CHANGES. Everything wanted is
   * ready, so: release what the window has left behind, promote every
   * staged column over the shown one it replaces, and publish. Between
   * two swaps `readyTiles` is the same array, so the clip mask the
   * terrain builds from it is rebuilt only when the pit really moved.
   */
  private swap(wanted: ReadonlyMap<string, SoilTile>): void {
    let changed = false;
    for (const [key, resident] of this.shown) {
      if (!wanted.has(key)) { this.release(resident); this.shown.delete(key); changed = true; }
    }
    for (const [key, resident] of this.staged) {
      const old = this.shown.get(key);
      if (old) this.release(old);
      this.shown.set(key, resident);
      if (resident.mesh) resident.mesh.visible = true;
      changed = true;
    }
    this.staged.clear();
    if (!changed) return;
    this.ready = [];
    this.triangles = 0;
    for (const resident of this.shown.values()) {
      if (!resident.mesh) continue;
      this.ready.push(resident.tile);
      this.triangles += resident.mesh.geometry.getAttribute('position').count / 3;
    }
  }

  /** The window is the whole bound: (2 × halfTiles)² columns, nearest to the observer first. */
  private select(at: WorldPoint, window: SoilCutWindow): SoilTile[] {
    const ranked: { tile: SoilTile; range: number }[] = [];
    for (let z = window.minTz; z < window.maxTz; z++) {
      for (let x = window.minTx; x < window.maxTx; x++) {
        const tile = this.soil.tile(x, z);
        ranked.push({ tile, range: distanceSquared(soilTileCentre(tile), at) });
      }
    }
    // Ranked once, not in the comparator: at the cap this sorts 256
    // columns every frame, and a centre point built per comparison is a
    // few thousand allocations for an order that was already known.
    return ranked.sort((a, b) => a.range - b.range).map(r => r.tile);
  }

  private release(resident: Resident): void {
    if (!resident.mesh) return;
    this.group.remove(resident.mesh);
    resident.mesh.geometry.dispose();
  }

  private clear(): void {
    for (const resident of this.shown.values()) this.release(resident);
    for (const resident of this.staged.values()) this.release(resident);
    this.shown.clear();
    this.staged.clear();
    this.ready = [];
    this.pending = 0;
    this.triangles = 0;
  }
}
