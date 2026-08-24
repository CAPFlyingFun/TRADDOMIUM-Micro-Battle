import * as THREE from 'three';
import { toLocal } from './origin';
import { world } from './coords';
import { reliefScale, terrainHeight } from './heightfield';
import { insideLake, lakeShape, lakesNear } from './lakes';
import { pondCellsIn, pondLevel, type PondCell } from './pond';
import { inlandOwnerAt } from './waterOwnership';

/**
 * THE SURFACE OF A LAKE, over the bed that lakes.ts pressed for it.
 *
 * A LAKE IS NOT THE OCEAN and does not get the ocean's machinery. No
 * swell — a reservoir four hundred metres across has no fetch to build
 * one — no coastline mask, no radial grid following the camera. What it
 * has is a shape, a level, and a depth that varies across it, and the
 * depth is what makes it read as water rather than as a blue lid.
 *
 * TESSELLATED ON A GRID rather than triangulated from the ring, which
 * is the one decision worth explaining. Earcut over a shoreline gives a
 * surface whose only vertices are ON the shore — where the water is by
 * definition nothing deep — so every vertex would carry depth zero and
 * a depth-shaded lake would be uniformly, wrongly shallow. A grid puts
 * vertices in the middle, where the water is.
 *
 * STREAMED, like the terrain. All 111 at once would be a quarter of a
 * million triangles for water that is mostly on the other side of the
 * island; within two kilometres of her there are rarely more than two.
 *
 * FLOATING ORIGIN, the TerrainStream way: each lake's geometry is built
 * around ITS OWN centre in float64 and the mesh is seated with
 * `toLocal` on every rebase. The vertices stay under a kilometre and
 * nothing million-sized is ever handed to the GPU.
 */

/** How far from her a lake is worth drawing. The middle tier's reach. */
const REACH = 200_000;
/** Most quads across a lake, whatever its size. */
const STEPS = 32;
/** And never finer than this, so a small pond is not over-tessellated. */
const FINEST = 250;
/** Terrain sampling for the baked field: five metres, bounded per wet cell. */
const POND_FINEST = 500;
const POND_REACH = 50_000;
const POND_TRIANGLE_TARGET = 100_000;

interface CutPoint {
  x: number;
  z: number;
  depth: number;
}

/**
 * Clip one triangle first to a horizontal containment mask and then to the
 * final terrain. Boundary points are found on the actual predicates rather
 * than by dropping the whole triangle when one corner is dry.
 */
function clippedTriangle(
  triangle: readonly CutPoint[],
  allowed: (x: number, z: number) => boolean,
  level: number,
  bedAt: (x: number, z: number) => number,
): CutPoint[] {
  let polygon = [...triangle];
  const mask = polygon.map((p) => allowed(p.x, p.z));
  const next: CutPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ain = mask[i];
    const bin = mask[(i + 1) % polygon.length];
    if (ain) next.push(a);
    if (ain === bin) continue;
    let lo = a;
    let hi = b;
    let loIn = ain;
    // A dozen halvings puts a 5 m terrain tile's edge within 1.3 mm.
    for (let n = 0; n < 12; n++) {
      const mid = {
        x: (lo.x + hi.x) / 2,
        z: (lo.z + hi.z) / 2,
        depth: 0,
      };
      if (allowed(mid.x, mid.z) === loIn) lo = mid;
      else hi = mid;
    }
    const edge = {
      x: (lo.x + hi.x) / 2,
      z: (lo.z + hi.z) / 2,
      depth: 0,
    };
    edge.depth = level - bedAt(edge.x, edge.z);
    next.push(edge);
  }
  polygon = next;
  if (polygon.length < 3) return [];

  const held: CutPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const ain = a.depth > 0;
    const bin = b.depth > 0;
    if (ain) held.push(a);
    if (ain === bin) continue;
    let lo = a;
    let hi = b;
    let loIn = ain;
    for (let n = 0; n < 12; n++) {
      const mid = {
        x: (lo.x + hi.x) / 2,
        z: (lo.z + hi.z) / 2,
        depth: 0,
      };
      mid.depth = level - bedAt(mid.x, mid.z);
      if ((mid.depth > 0) === loIn) lo = mid;
      else hi = mid;
    }
    held.push({
      x: (lo.x + hi.x) / 2,
      z: (lo.z + hi.z) / 2,
      depth: 0,
    });
  }
  return held;
}

function addTop(
  polygon: readonly CutPoint[],
  topY: number,
  centreX: number,
  centreZ: number,
  points: number[],
  depths: number[],
  faces: number[],
): void {
  if (polygon.length < 3) return;
  const top = points.length / 3;
  for (const p of polygon) {
    points.push(p.x - centreX, topY, p.z - centreZ);
    depths.push(p.depth);
  }
  for (let i = 1; i < polygon.length - 1; i++) {
    faces.push(top, top + i, top + i + 1);
  }
}

interface Drawn {
  readonly at: number;
  readonly mesh: THREE.Mesh;
  /** The lake's own centre, in GLOBAL coordinates. */
  readonly cx: number;
  readonly cz: number;
  readonly level: number;
}

/**
 * A lake's surface as triangles, in coordinates relative to its centre.
 *
 * Returns null for a lake the grid cannot find any water in — a channel
 * narrower than one step. Better an absent lake than a stray triangle.
 */
export function tessellate(
  at: number,
  centreX: number,
  centreZ: number,
): { geometry: THREE.BufferGeometry; depth: number } | null {
  const box = lakeShape(at);
  const across = Math.max(box.maxX - box.minX, box.maxZ - box.minZ);
  const step = Math.max(FINEST, across / STEPS);
  const cols = Math.ceil((box.maxX - box.minX) / step) + 1;
  const rows = Math.ceil((box.maxZ - box.minZ) / step) + 1;

  const points: number[] = [];
  const depths: number[] = [];
  const faces: number[] = [];
  let deepest = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const x0 = box.minX + c * step;
      const z0 = box.minZ + r * step;
      const x1 = Math.min(box.maxX, x0 + step);
      const z1 = Math.min(box.maxZ, z0 + step);
      const point = (x: number, z: number): CutPoint => {
        const depth = box.level - terrainHeight(x, z);
        if (depth > deepest) deepest = depth;
        return { x, z, depth };
      };
      const a = point(x0, z0);
      const b = point(x1, z0);
      const d = point(x0, z1);
      const e = point(x1, z1);
      for (const triangle of [[a, d, b], [b, d, e]]) {
        addTop(
          clippedTriangle(
            triangle, (x, z) => insideLake(at, x, z)
              && inlandOwnerAt(x, z, false) === 'lake',
            box.level, terrainHeight,
          ),
          0, centreX, centreZ, points, depths, faces,
        );
      }
    }
  }
  if (!faces.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return { geometry, depth: deepest };
}

/** Build terrain-intersected surfaces and exterior edges from pond cells. */
export function tessellatePonds(
  cells: readonly PondCell[],
  centreX: number,
  centreZ: number,
  bedAt: (x: number, z: number) => number = terrainHeight,
  finest = POND_FINEST,
): THREE.BufferGeometry | null {
  const points: number[] = [];
  const depths: number[] = [];
  const faces: number[] = [];
  const perCell = Math.max(1, Math.floor(Math.sqrt(
    POND_TRIANGLE_TARGET / Math.max(1, cells.length * 2),
  )));
  for (const cell of cells) {
    const segments = Math.max(1, Math.min(
      Math.ceil(cell.size / finest), perCell,
    ));
    const step = cell.size / segments;
    const minX = cell.x - cell.size / 2;
    const minZ = cell.z - cell.size / 2;
    const allowed = (x: number, z: number) => pondLevel(x, z) === cell.level;
    for (let r = 0; r < segments; r++) {
      for (let c = 0; c < segments; c++) {
        const x0 = minX + c * step;
        const z0 = minZ + r * step;
        const x1 = x0 + step;
        const z1 = z0 + step;
        const point = (x: number, z: number): CutPoint => ({
          x, z, depth: cell.level - bedAt(x, z),
        });
        const a = point(x0, z0);
        const b = point(x1, z0);
        const d = point(x0, z1);
        const e = point(x1, z1);
        for (const triangle of [[a, d, b], [b, d, e]]) {
          addTop(
            clippedTriangle(triangle, allowed, cell.level, bedAt),
            cell.level, centreX, centreZ, points, depths, faces,
          );
        }
      }
    }
    // Only the field's true exterior gets a vertical edge. Equal-level
    // neighbours share one continuous surface and deliberately get none.
    const edge = (dx: number, dz: number) =>
      pondLevel(cell.x + dx * cell.size, cell.z + dz * cell.size) !== cell.level;
    const wall = (ax: number, az: number, bx: number, bz: number) => {
      for (let n = 0; n < segments; n++) {
        const t0 = n / segments;
        const t1 = (n + 1) / segments;
        let x0 = ax + (bx - ax) * t0;
        let z0 = az + (bz - az) * t0;
        let x1 = ax + (bx - ax) * t1;
        let z1 = az + (bz - az) * t1;
        let d0 = cell.level - bedAt(x0, z0);
        let d1 = cell.level - bedAt(x1, z1);
        if (d0 <= 0 && d1 <= 0) continue;
        if ((d0 > 0) !== (d1 > 0)) {
          let lx = x0; let lz = z0; let ld = d0;
          let hx = x1; let hz = z1;
          for (let i = 0; i < 12; i++) {
            const mx = (lx + hx) / 2;
            const mz = (lz + hz) / 2;
            const md = cell.level - bedAt(mx, mz);
            if ((md > 0) === (ld > 0)) { lx = mx; lz = mz; ld = md; }
            else { hx = mx; hz = mz; }
          }
          if (d0 > 0) { x1 = (lx + hx) / 2; z1 = (lz + hz) / 2; d1 = 0; }
          else { x0 = (lx + hx) / 2; z0 = (lz + hz) / 2; d0 = 0; }
        }
        const top = points.length / 3;
        points.push(x0 - centreX, cell.level, z0 - centreZ,
          x1 - centreX, cell.level, z1 - centreZ,
          x0 - centreX, cell.level - Math.max(0, d0), z0 - centreZ,
          x1 - centreX, cell.level - Math.max(0, d1), z1 - centreZ);
        depths.push(Math.max(0, d0), Math.max(0, d1), Math.max(0, d0), Math.max(0, d1));
        faces.push(top, top + 2, top + 1, top + 1, top + 2, top + 3);
      }
    };
    const x0 = minX;
    const z0 = minZ;
    const x1 = minX + cell.size;
    const z1 = minZ + cell.size;
    if (edge(-1, 0)) wall(x0, z0, x0, z1);
    if (edge(1, 0)) wall(x1, z1, x1, z0);
    if (edge(0, -1)) wall(x1, z0, x0, z0);
    if (edge(0, 1)) wall(x0, z1, x1, z1);
  }
  if (!faces.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  return geometry;
}

export class LakeWater {
  private readonly drawn = new Map<number, Drawn>();
  private pond: THREE.Mesh | null = null;
  private pondCentre = { x: 0, z: 0 };
  private pondCell = '';
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private readonly rippleMap: { value: THREE.Texture };
  private seconds = 0;

  constructor(private readonly scene: THREE.Scene) {
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.rippleMap = { value: flat };
    this.material = this.build();
  }

  /** Take the ripple map the ocean loaded — one texture, two waters. */
  wear(texture: THREE.Texture): void {
    this.rippleMap.value = texture;
  }

  /** Bring the nearby lakes into being and let the far ones go. */
  follow(at: { wx: number; wz: number }): void {
    const wanted = new Set(lakesNear(at.wx, at.wz, REACH));
    for (const [index, lake] of this.drawn) {
      if (wanted.has(index)) continue;
      this.scene.remove(lake.mesh);
      lake.mesh.geometry.dispose();
      this.drawn.delete(index);
    }
    for (const index of wanted) {
      if (this.drawn.has(index)) continue;
      const box = lakeShape(index);
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const cut = tessellate(index, cx, cz);
      if (!cut) continue;
      const mesh = new THREE.Mesh(cut.geometry, this.material);
        mesh.renderOrder = 2;
      mesh.visible = this.shownAll;
      this.scene.add(mesh);
      this.drawn.set(index, { at: index, mesh, cx, cz, level: box.level });
    }
    const decision = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (decision !== this.pondCell) {
      this.pondCell = decision;
      if (this.pond) {
        this.scene.remove(this.pond);
        this.pond.geometry.dispose();
        this.pond = null;
      }
      const cx = Math.round(at.wx / 50_000) * 50_000;
      const cz = Math.round(at.wz / 50_000) * 50_000;
      const cells = pondCellsIn(
        cx - POND_REACH, cz - POND_REACH, cx + POND_REACH, cz + POND_REACH,
      );
      const geometry = tessellatePonds(cells, cx, cz);
      if (geometry) {
        this.pond = new THREE.Mesh(geometry, this.material);
        this.pond.renderOrder = 3;
        this.pond.visible = this.shownAll;
        this.pondCentre = { x: cx, z: cz };
        this.scene.add(this.pond);
      }
    }
    this.place();
  }

  /**
   * Re-seat every surface against the current origin and the current
   * relief dial. The dial matters: `groundHeight` returns `relief × h`,
   * so a lake that did not scale with it would float above its own
   * valley the moment the dial moved — WATER_PORT.md 3c.
   */
  place(): void {
    const relief = reliefScale();
    for (const lake of this.drawn.values()) {
      const seat = toLocal(world(lake.cx, lake.cz));
      lake.mesh.position.set(seat.lx, lake.level * relief, seat.lz);
    }
    if (this.pond) {
      const seat = toLocal(world(this.pondCentre.x, this.pondCentre.z));
      this.pond.position.set(seat.lx, 0, seat.lz);
      this.pond.scale.y = relief;
    }
  }

  update(dt: number): void {
    this.seconds += dt;
    this.clock.value = this.seconds;
  }

  /** How many surfaces exist right now — for the probes. */
  get shown(): number {
    return this.drawn.size + (this.pond ? 1 : 0);
  }

  /** Hide or show every surface this owns — see __island.showWater. */
  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const it of this.drawn.values()) it.mesh.visible = on;
    if (this.pond) this.pond.visible = on;
  }

  /** Terrain smoothing moves banks, so every terrain-derived cut must move too. */
  invalidateTerrain(at: { wx: number; wz: number }): void {
    for (const lake of this.drawn.values()) {
      this.scene.remove(lake.mesh);
      lake.mesh.geometry.dispose();
    }
    this.drawn.clear();
    if (this.pond) {
      this.scene.remove(this.pond);
      this.pond.geometry.dispose();
      this.pond = null;
    }
    this.pondCell = '';
    this.follow(at);
  }

  /** Remembered, so surfaces built after the toggle honour it too. */
  private shownAll = true;

  dispose(): void {
    for (const lake of this.drawn.values()) {
      this.scene.remove(lake.mesh);
      lake.mesh.geometry.dispose();
    }
    this.drawn.clear();
    if (this.pond) {
      this.scene.remove(this.pond);
      this.pond.geometry.dispose();
      this.pond = null;
    }
    this.material.dispose();
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2c6f7a,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      depthTest: true,
      depthWrite: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      // The bed is only two metres under at most, and at the bank it is
      // no distance at all — so the surface and the ground are very
      // nearly coplanar exactly where the eye is drawn. Sunk rather
      // than lifted, so the bank wins the tie and the edge reads as a
      // shoreline. CONSTANT, not slope-scaled, for the reason
      // RiverWater's offset spells out: a factor runs away at grazing
      // angles, and a lake seen from an ant's eye is always grazing.
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 12,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.clock;
      shader.uniforms.uRipple = this.rippleMap;
      shader.uniforms.uSky = { value: new THREE.Color(0xa8cfe2).convertSRGBToLinear() };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float deep;
          varying float vDeep;
          varying vec3 vLake;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vDeep = deep;
          vLake = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vDeep;
          varying vec3 vLake;
          uniform sampler2D uRipple;
          uniform float uTime;
          uniform vec3 uSky;
          mat2 spin(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // Two octaves is enough for still water. The tiles are much
            // tighter than the ocean's — a reservoir ripples, it does
            // not swell — and the drift is slow, because a lake surface
            // that scrolls reads as a river.
            vec2 p = vLake.xz;
            vec3 chop = (texture2D(uRipple, p / 260.0 + uTime * vec2(0.006, 0.004)).xyz - 0.5)
              + (texture2D(uRipple, spin(2.4) * p / 95.0 - uTime * vec2(0.009, 0.005)).xyz - 0.5) * 0.7;
            normal = normalize(normal + vec3(chop.x, 0.0, chop.y) * 0.4);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // DEPTH IS THE WHOLE LOOK. Carried per vertex from the bed
            // the carve pressed, so the shallows at the bank really are
            // the shallows and the middle really is the middle.
            float shallow = 1.0 - smoothstep(8.0, 150.0, vDeep);
            diffuseColor.rgb = mix(
              vec3(0.014, 0.16, 0.22), vec3(0.14, 0.32, 0.31), shallow * shallow);
            // Gone entirely where there is no water left to draw, so
            // the edge is a waterline and not a cut polygon — but over
            // six centimetres rather than twelve, because the point of
            // the fade is to end the polygon on water rather than to
            // spend a hand's width of shallows being invisible.
            diffuseColor.a *= smoothstep(0.0, 6.0, vDeep);
            // The meniscus, as on the rivers: at an ant's eye the
            // bright curved rim is what says "edge of water" long
            // before the colour does.
            float rim = 1.0 - smoothstep(2.0, 26.0, vDeep);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.56, 0.55), rim * 0.7);
            diffuseColor.a = clamp(diffuseColor.a + rim * 0.3, 0.0, 1.0);
            // A single terrain-intersected sheet has no duplicated bottom
            // faces. Treat its back face as the underwater view instead:
            // it reads deeper and remains opaque enough to be a body.
            if (!gl_FrontFacing) {
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.005, 0.055, 0.11), 0.72);
              diffuseColor.a = max(diffuseColor.a, 0.82);
            }
            if (diffuseColor.a < 0.01) discard;
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float face = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, pow(1.0 - face, 5.0) * 0.5);
          }`);
    };

    return material;
  }
}
