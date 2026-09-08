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
  private readonly residents = new Map<string, Resident>();
  private depth = NaN;
  private surveyRevision = -1;
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
  get cost(): { tiles: number; triangles: number; pending: number } {
    return { tiles: this.ready.length, triangles: this.triangles, pending: this.pending };
  }

  update(at: WorldPoint, cutDepth: number, surveyRevision: number): void {
    const depth = Number.isFinite(cutDepth) ? Math.max(0, cutDepth) : 0;
    if (depth !== this.depth || surveyRevision !== this.surveyRevision) {
      this.clear();
      this.depth = depth;
      this.surveyRevision = surveyRevision;
    }
    // A shut section has no window, so it has no soil. The release above
    // is the whole of the work, and nothing below it runs or is held.
    if (depth === 0) return;
    const centre = soilTileAt(at);
    const window: SoilCutWindow = {
      minTx: centre.tx - 3, maxTx: centre.tx + 3, minTz: centre.tz - 3, maxTz: centre.tz + 3,
    };
    const selected = this.select(at, window);
    const wanted = new Set(selected.map(tileKey));
    // Pending tiles are prospective voxel neighbors, but a known skipped
    // column retains coarse terrain and must expose the adjoining bridge.
    const voxelNeighbors = new Set(wanted);
    for (const [key, resident] of this.residents) if (!resident.mesh) voxelNeighbors.delete(key);
    // Only exposed patch edges meet coarse terrain. Shared edges must not
    // grow fences through the continuous soil surface or its cavities.
    const frontierOf = (tile: SoilTile): number => this.drawnHeightAt
      ? Number(!voxelNeighbors.has(`${tile.tx - 1},${tile.tz}`)) | (Number(!voxelNeighbors.has(`${tile.tx + 1},${tile.tz}`)) << 1)
        | (Number(!voxelNeighbors.has(`${tile.tx},${tile.tz - 1}`)) << 2) | (Number(!voxelNeighbors.has(`${tile.tx},${tile.tz + 1}`)) << 3)
      : 0;
    for (const [key, resident] of this.residents) {
      // A former edge may become interior (or vice versa) even if its soil
      // revision is unchanged. Retire stale rim clipping before rebuilding.
      if (!wanted.has(key) || resident.rim !== rimRole(resident.tile, window)
        || (resident.mesh !== null && resident.frontier !== frontierOf(resident.tile))) {
        this.release(resident); this.residents.delete(key);
      }
    }
    const started = this.now();
    let built = 0, spent = 0, dearest = 0;
    for (const tile of selected) {
      const key = tileKey(tile), old = this.residents.get(key);
      if (old?.tile.revision === tile.revision) continue;
      // Nearest first, so what the observer is looking at arrives first,
      // and stop at the budget: the rest of this window waits a frame.
      if (built > 0 && spent + dearest > BUILD_BUDGET_MS) break;
      built++;
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
      if (old) this.release(old);
      // Remember skipped revisions too: expensive/incomplete columns are
      // retried only after their inputs change, and NEVER enter readyTiles.
      if (!data) {
        this.residents.set(key, { tile, rim, frontier, mesh: null, origin: null });
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
      this.group.add(mesh);
      this.residents.set(key, { tile, rim, frontier, mesh, origin: data.origin });
    }
    // A build can discover a skipped column after its neighbors were
    // checked (or built) this frame. Retire their obsolete frontier before
    // publishing any clipping; replacement still uses the next build ration.
    for (const [key, resident] of this.residents) {
      if (resident.mesh && resident.frontier !== frontierOf(resident.tile)) {
        this.release(resident); this.residents.delete(key);
      }
    }
    this.pending = selected.filter(tile => this.residents.get(tileKey(tile))?.tile.revision !== tile.revision).length;
    this.ready = [];
    this.triangles = 0;
    for (const resident of this.residents.values()) {
      if (!resident.mesh || !resident.origin) continue;
      const local = this.toLocal(resident.origin.at);
      resident.mesh.position.set(local.lx, resident.origin.height, local.lz);
      this.ready.push(resident.tile);
      this.triangles += resident.mesh.geometry.getAttribute('position').count / 3;
    }
  }

  dispose(): void { this.clear(); this.material.dispose(); }

  /** The window is the whole bound: 36 columns, nearest to the observer first. */
  private select(at: WorldPoint, window: SoilCutWindow): SoilTile[] {
    const tiles: SoilTile[] = [];
    for (let z = window.minTz; z < window.maxTz; z++) {
      for (let x = window.minTx; x < window.maxTx; x++) tiles.push(this.soil.tile(x, z));
    }
    const distance = (t: SoilTile): number => distanceSquared(soilTileCentre(t), at);
    return tiles.sort((a, b) => distance(a) - distance(b));
  }

  private release(resident: Resident): void {
    if (!resident.mesh) return;
    this.group.remove(resident.mesh);
    resident.mesh.geometry.dispose();
  }

  private clear(): void {
    for (const resident of this.residents.values()) this.release(resident);
    this.residents.clear();
    this.ready = [];
    this.pending = 0;
    this.triangles = 0;
  }
}
