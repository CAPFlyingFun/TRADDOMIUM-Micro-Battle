import * as THREE from 'three';
import { toLocal } from './origin';
import { world } from './coords';
import { reliefScale, terrainHeight } from './heightfield';
import { insideLake, lakeShape, lakesNear } from './lakes';

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

  // One pass to find which grid points are water, a second to stitch
  // the quads whose four corners all are. A quad with a dry corner is
  // dropped rather than clipped: at this spacing the loss is a sliver
  // at the bank, and the alternative is a clipper.
  const wet = new Uint8Array(cols * rows);
  const seat = new Int32Array(cols * rows).fill(-1);
  const points: number[] = [];
  const depths: number[] = [];
  let deepest = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = box.minX + c * step;
      const z = box.minZ + r * step;
      if (!insideLake(at, x, z)) continue;
      wet[r * cols + c] = 1;
      seat[r * cols + c] = points.length / 3;
      const deep = Math.max(0, box.level - terrainHeight(x, z));
      if (deep > deepest) deepest = deep;
      points.push(x - centreX, 0, z - centreZ);
      depths.push(deep);
    }
  }

  const faces: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = a + 1;
      const d = a + cols;
      const e = d + 1;
      if (!wet[a] || !wet[b] || !wet[d] || !wet[e]) continue;
      // Wound for a +Y normal, so the surface is lit from above.
      faces.push(seat[a], seat[d], seat[b]);
      faces.push(seat[b], seat[d], seat[e]);
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

export class LakeWater {
  private readonly drawn = new Map<number, Drawn>();
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
      mesh.renderOrder = 1;
      mesh.visible = this.shownAll;
      this.scene.add(mesh);
      this.drawn.set(index, { at: index, mesh, cx, cz, level: box.level });
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
  }

  update(dt: number): void {
    this.seconds += dt;
    this.clock.value = this.seconds;
  }

  /** How many surfaces exist right now — for the probes. */
  get shown(): number {
    return this.drawn.size;
  }

  /** Hide or show every surface this owns — see __island.showWater. */
  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const it of this.drawn.values()) it.mesh.visible = on;
  }

  /** Remembered, so surfaces built after the toggle honour it too. */
  private shownAll = true;

  dispose(): void {
    for (const lake of this.drawn.values()) {
      this.scene.remove(lake.mesh);
      lake.mesh.geometry.dispose();
    }
    this.drawn.clear();
    this.material.dispose();
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2c6f7a,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
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
