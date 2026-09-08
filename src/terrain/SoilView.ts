/** Bounded, disposable rendering cache. SparseSoil alone owns the soil. */
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
}
const MAX_TILES = 36;
const BUILDS_PER_UPDATE = 2;
const tileKey = (tile: SoilTile): string => `${tile.tx},${tile.tz}`;
/** Only the tile's four rim roles affect its geometry when the window moves. */
const rimRole = (tile: SoilTile, window?: SoilCutWindow): number => window
  ? Number(tile.tx === window.minTx) | (Number(tile.tx === window.maxTx - 1) << 1)
    | (Number(tile.tz === window.minTz) << 2) | (Number(tile.tz === window.maxTz - 1) << 3)
  : 0;

export class SoilView {
  readonly group = new THREE.Group();
  private readonly soil: SparseSoil;
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private readonly drawnHeightAt?: (at: WorldPoint) => number | null;
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
    const centre = soilTileAt(at);
    const window: SoilCutWindow | undefined = depth > 0 ? {
      minTx: centre.tx - 3, maxTx: centre.tx + 3, minTz: centre.tz - 3, maxTz: centre.tz + 3,
    } : undefined;
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
    let built = 0;
    for (const tile of selected) {
      const key = tileKey(tile), old = this.residents.get(key);
      if (old?.tile.revision === tile.revision) continue;
      if (built === BUILDS_PER_UPDATE) continue;
      built++;
      const rim = rimRole(tile, window), frontier = frontierOf(tile);
      const seam = this.drawnHeightAt ? { edges: frontier, drawnHeightAt: this.drawnHeightAt } : undefined;
      const data = meshSoilTile(this.soil, tile.tx, tile.tz, depth, window, seam);
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

  private select(at: WorldPoint, window?: SoilCutWindow): SoilTile[] {
    if (!window) return this.soil.tilesNear(at, 25).slice(0, MAX_TILES);
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
