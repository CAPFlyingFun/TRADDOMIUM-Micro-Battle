import * as THREE from 'three';
import { toLocal } from './origin';
import { baseLand, reliefScale } from './heightfield';
import { hydro, hydroTile, type Hydro, type Lake, type River } from './hydro';
import { hdTilesNear, hdTileIndex, HD_TILE, HD_STEP } from './kauaiHd';
import { SPAN } from './kauai';
import { clockUniform, waterMaterial } from './waterLook';
import { world, type WorldPoint } from './coords';

/**
 * THE WATER, DRAWN WHERE THE SURVEY SAYS IT IS.
 *
 * Every version of this before it invented the water: derive a drainage
 * network from the terrain, guess a width from the discharge, carve a
 * bed to put it in, then spend three days explaining why the bed and
 * the water and the ground disagreed. They disagreed because there were
 * three descriptions of one thing and every one of them drifted.
 *
 * There is one description now and nobody here owns it. `hydro.ts`
 * carries USGS NHDPlus HR — the surveyed rivers and lakes of the real
 * island, with their real widths and their real water-surface
 * elevations — and this draws exactly that, flat, at the level the
 * survey states. The shoreline is not drawn at all: the terrain rises
 * through the surface and the depth test cuts it, which is what makes
 * the edge follow the ground for free.
 *
 * THAT ONLY WORKS BECAUSE THE ISLAND IS REAL NOW. Measured on the HD
 * grid with the smoothing off, 70.3% of the network is already below
 * the ground it belongs to, median half a metre — the valleys are
 * genuinely there, so the water genuinely sits in them. On the blurred
 * 54.7 m island the same water was a median 13.63 m underground and had
 * to be dug out of an eighty-metre burial, which is the whole reason a
 * carve was ever invented.
 *
 * STREAMED BY BE'S OWN TILES, which the bake already tagged every run
 * and lake with. The worst tile on the island is 3,204 points — about
 * six thousand triangles — so a tile is one mesh, built once when she
 * first comes near and kept for the scene's life.
 */

/** How far out the water is worth having geometry for. */
const REACH = 200_000;

/**
 * Surveyed channel width is the WATER, not the valley, and drawing
 * exactly that leaves the terrain nothing to clip: the ribbon ends in
 * its own straight edge instead of on the bank. Drawn half again as
 * wide, so the depth test decides the shoreline everywhere.
 *
 * It cannot put water on dry land — past the real edge the ground has
 * risen through the surface and the fragments are already behind it.
 */
const OVER = 1.5;

/** Nothing narrower than this reads as water at all. */
const MIN_HALF = 60;

/**
 * Columns of vertices across a run.
 *
 * Two would be enough to DRAW the ribbon and is what this started with,
 * but the shading needs the ground: depth is sampled per vertex and
 * interpolated between them, so a two-column strip can only ever fade
 * linearly from bank to bank. The bed under it is a smootherstep bowl.
 * Five columns follows the bowl closely enough that the shallows read
 * as shallows, and costs a few thousand triangles on the worst tile.
 */
const ACROSS = 5;

interface Tile {
  readonly mesh: THREE.Mesh;
  /** Where the geometry was built about, in world units. */
  readonly at: { x: number; z: number };
}

/** One tile's rivers and lakes as a single flat surface. */
function build(
  data: Hydro, rivers: readonly River[], lakes: readonly Lake[],
  cx: number, cz: number,
): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const idx: number[] = [];
  const rise: number[] = [];
  const flow: number[] = [];

  for (const river of rivers) {
    if (river.count < 2) continue;
    const base = pos.length / 3;
    for (let i = 0; i < river.count; i++) {
      const p = river.first + i;
      const x = data.x[p], z = data.z[p];
      // The tangent from the neighbours, so the ribbon does not kink at
      // every station; the ends borrow the segment beside them.
      const a = river.first + Math.max(0, i - 1);
      const b = river.first + Math.min(river.count - 1, i + 1);
      let tx = data.x[b] - data.x[a], tz = data.z[b] - data.z[a];
      const len = Math.hypot(tx, tz);
      if (len < 1e-6) { tx = 1; tz = 0; } else { tx /= len; tz /= len; }
      const half = Math.max(MIN_HALF, (data.width[p] / 2) * OVER);
      const y = data.level[p];
      for (let k = 0; k < ACROSS; k++) {
        const u = (k / (ACROSS - 1)) * 2 - 1;
        const wx = x + -tz * half * u;
        const wz = z + tx * half * u;
        pos.push(wx - cx, y, wz - cz);
        // THE ONE THING HERE THAT ASKS THE GROUND. `baseLand` already
        // carries the bed, so this IS the depth — there is no profile
        // to reconstruct and nothing to keep in step. Every previous
        // version of this file carried four numbers and rebuilt the
        // trench in the shader, which is how the water and the land
        // ended up disagreeing about where the shore was.
        rise.push(y - baseLand(wx, wz));
        flow.push(tx, tz);
      }
    }
    for (let i = 0; i < river.count - 1; i++) {
      for (let k = 0; k < ACROSS - 1; k++) {
        const q = base + i * ACROSS + k;
        idx.push(q, q + 1, q + ACROSS, q + 1, q + ACROSS + 1, q + ACROSS);
      }
    }
  }

  for (const lake of lakes) {
    // Ring 0 is the shore and the rest are islands standing out of it.
    // three.js triangulates the pair together, so a lake with a rock in
    // it comes out as water with a hole rather than water over a rock.
    const shore = lake.firstRing;
    const outer: THREE.Vector2[] = [];
    for (let v = 0; v < data.ringCount[shore]; v++) {
      const at = data.ringFirst[shore] + v;
      outer.push(new THREE.Vector2(data.vertX[at], data.vertZ[at]));
    }
    if (outer.length < 3) continue;
    const holes: THREE.Vector2[][] = [];
    for (let r = 1; r < lake.ringCount; r++) {
      const ring = lake.firstRing + r;
      const loop: THREE.Vector2[] = [];
      for (let v = 0; v < data.ringCount[ring]; v++) {
        const at = data.ringFirst[ring] + v;
        loop.push(new THREE.Vector2(data.vertX[at], data.vertZ[at]));
      }
      if (loop.length >= 3) holes.push(loop);
    }
    const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
    const all = [outer, ...holes].flat();
    const base = pos.length / 3;
    for (const v of all) {
      pos.push(v.x - cx, lake.level, v.y - cz);
      rise.push(lake.level - baseLand(v.x, v.y));
      // Standing water goes nowhere, so its ripple only breathes.
      flow.push(0, 0);
    }
    for (const f of faces) idx.push(base + f[0], base + f[1], base + f[2]);
  }

  if (idx.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('rise', new THREE.Float32BufferAttribute(rise, 1));
  geometry.setAttribute('flowx', new THREE.Float32BufferAttribute(flow.filter((_, i) => i % 2 === 0), 1));
  geometry.setAttribute('flowz', new THREE.Float32BufferAttribute(flow.filter((_, i) => i % 2 === 1), 1));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  return geometry;
}

/** Where a tile's geometry is measured from — its own centre. */
function tileCentre(tile: number): { x: number; z: number } {
  const span = (HD_TILE - 1) * HD_STEP;
  const col = Math.floor(tile / 8), row = tile % 8;
  return {
    x: (col + 0.5) * span - SPAN / 2,
    z: (row + 0.5) * span - SPAN / 2,
  };
}

export class WaterSurface {
  private readonly group = new THREE.Group();
  private readonly tiles = new Map<number, Tile>();
  private readonly material: THREE.MeshStandardMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.material = waterMaterial();
    this.group.renderOrder = 2;
    this.scene.add(this.group);
  }

  /** Drawn tiles, for the probes. */
  get shown(): number {
    return this.tiles.size;
  }

  /** Build whatever water is near her, once. */
  follow(at: WorldPoint): void {
    const data = hydro();
    if (!data) return;
    for (const tile of hdTilesNear(at.wx, at.wz, REACH)) {
      if (this.tiles.has(tile)) continue;
      const here = hydroTile(tile);
      if (!here || (here.rivers.length === 0 && here.lakes.length === 0)) {
        // Remembered as empty so an island of dry tiles is not
        // re-examined every time she crosses one.
        this.tiles.set(tile, { mesh: new THREE.Mesh(), at: tileCentre(tile) });
        continue;
      }
      const centre = tileCentre(tile);
      const geometry = build(data, here.rivers, here.lakes, centre.x, centre.z);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.frustumCulled = false;
      this.tiles.set(tile, { mesh, at: centre });
      this.group.add(mesh);
    }
    this.place();
  }

  /** Move the ripple on. Seconds of game time. */
  update(dt: number): void {
    clockUniform.value += dt;
  }

  /** Re-seat every tile after a rebase, and follow the relief dial. */
  place(): void {
    const times = reliefScale();
    for (const { mesh, at } of this.tiles.values()) {
      if (!mesh.geometry.getAttribute('position')) continue;
      const seat = toLocal(world(at.x, at.z));
      mesh.position.set(seat.lx, 0, seat.lz);
      mesh.scale.y = times;
    }
  }

  dispose(): void {
    for (const { mesh } of this.tiles.values()) mesh.geometry.dispose();
    this.tiles.clear();
    this.material.dispose();
    this.scene.remove(this.group);
  }
}

/** Which tile a point sits in, for anything that wants to ask. */
export function waterTileAt(x: number, z: number): number {
  const span = (HD_TILE - 1) * HD_STEP;
  const col = Math.min(7, Math.max(0, Math.floor((x + SPAN / 2) / span)));
  const row = Math.min(7, Math.max(0, Math.floor((z + SPAN / 2) / span)));
  return hdTileIndex(col, row);
}
