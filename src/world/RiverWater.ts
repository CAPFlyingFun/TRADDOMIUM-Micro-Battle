import * as THREE from 'three';
import { toLocal } from './origin';
import { world } from './coords';
import { reliefScale } from './heightfield';
import type { Hydro } from './hydro';
import { channelDepth, riverPointLevels } from './rivers';

/**
 * THE SURFACE OF EVERY RIVER — 1,121 ribbons of moving water.
 *
 * Beyond Extinction solved most of this the hard way and wrote it down,
 * so three of its decisions are ported deliberately:
 *
 *  CENTRIPETAL CATMULL-ROM over [x, y, z, width] as one four-channel
 *  spline — position and width interpolated together, so a reach that
 *  narrows into a bend narrows THROUGH the bend. Centripetal (α = ½)
 *  rather than uniform because uniform Catmull-Rom overshoots on the
 *  uneven spacing NHDPlus vertices actually have, and an overshooting
 *  river visits places the river does not go.
 *
 *  DIRECTION BY CENTRAL DIFFERENCE, no miter mathematics. The resample
 *  is fine enough that the perpendicular turns smoothly on its own.
 *
 *  NEGATIVE POLYGON OFFSET — the opposite sign to the lakes and the
 *  ocean, and BE's comment explains the trap: a river lies close over
 *  its own bed for its whole length, so pushing its fragments DEEPER
 *  (the sign that stops the sea shimmering against the reef shelf)
 *  lets the bed win the depth test and freckle through the surface.
 *  Rivers are lifted toward the camera instead.
 *
 * And one of its constraints does not apply and is not ported: BE split
 * every reach per streaming tile and needed ghost vertices to stitch
 * the seams. Our reaches are whole. Junctions where two reaches meet
 * are covered by the wider trunk rather than stitched.
 *
 * ELEVATIONS COME LEVELLED from rivers.ts — already forced monotonic
 * downstream — so the surface never porpoises uphill.
 *
 * FLOATING ORIGIN: geometry is built with x/z relative to the reach's
 * own centroid in float64 and seated with `toLocal` on every rebase.
 * The vertex Y is the ABSOLUTE water elevation (float32 is sub-unit
 * out to the summit's 155,000) so the relief dial can be applied as
 * `mesh.scale.y` — a sloped surface cannot take the dial as a single
 * position the way a flat lake can.
 */

/** How far from her a river is worth drawing. The middle tier's reach. */
const REACH = 200_000;
/** Resample target along the spline, world units. Six real metres. */
const STEP = 600;
/** The ribbon stops just short of the channel edge — see the alpha fade. */
const EDGE = 0.98;

interface Drawn {
  readonly mesh: THREE.Mesh;
  readonly cx: number;
  readonly cz: number;
}

/** Centripetal Catmull-Rom on one four-channel point row. */
function spline(
  points: Float64Array, out: number[],
): void {
  const rows = points.length / 4;
  if (rows < 2) return;
  const at = (i: number, c: number) => points[Math.max(0, Math.min(rows - 1, i)) * 4 + c];
  for (let i = 0; i < rows - 1; i++) {
    // Knots from PLANAR spacing, α = ½ — the centripetal family.
    const knot = (a: number, b: number) => Math.max(
      Math.hypot(at(b, 0) - at(a, 0), at(b, 2) - at(a, 2)), 1e-4,
    ) ** 0.5;
    const t0 = 0;
    const t1 = t0 + knot(i - 1, i);
    const t2 = t1 + knot(i, i + 1);
    const t3 = t2 + knot(i + 1, i + 2);
    const span = Math.hypot(at(i + 1, 0) - at(i, 0), at(i + 1, 2) - at(i, 2));
    const steps = Math.max(1, Math.round(span / STEP));
    for (let s = i === 0 ? 0 : 1; s <= steps; s++) {
      const t = t1 + ((t2 - t1) * s) / steps;
      for (let c = 0; c < 4; c++) {
        // Barry–Goldman, one channel at a time.
        const p0 = at(i - 1, c);
        const p1 = at(i, c);
        const p2 = at(i + 1, c);
        const p3 = at(i + 2, c);
        const a1 = t1 - t0 > 0 ? p0 + ((p1 - p0) * (t - t0)) / (t1 - t0) : p1;
        const a2 = t2 - t1 > 0 ? p1 + ((p2 - p1) * (t - t1)) / (t2 - t1) : p2;
        const a3 = t3 - t2 > 0 ? p2 + ((p3 - p2) * (t - t2)) / (t3 - t2) : p3;
        const b1 = t2 - t0 > 0 ? a1 + ((a2 - a1) * (t - t0)) / (t2 - t0) : a2;
        const b2 = t3 - t1 > 0 ? a2 + ((a3 - a2) * (t - t1)) / (t3 - t1) : a3;
        out.push(t2 - t1 > 0 ? b1 + ((b2 - b1) * (t - t1)) / (t2 - t1) : b1);
      }
    }
  }
}

/**
 * One reach as a triangle strip, positions relative to (cx, 0, cz).
 *
 * Water level must stay monotonic AFTER the spline too: Catmull-Rom
 * can locally overshoot in Y where the drop is uneven, and an
 * overshoot on a river profile is a ripple of uphill water. Clamped
 * along the resampled row.
 */
export function buildReach(
  stations: Float64Array, cx: number, cz: number,
): THREE.BufferGeometry | null {
  const smooth: number[] = [];
  spline(stations, smooth);
  const rows = smooth.length / 4;
  if (rows < 2) return null;

  // Re-impose the levelling the spline may have bent.
  const downhill = smooth[1] >= smooth[(rows - 1) * 4 + 1];
  if (downhill) {
    for (let i = 1; i < rows; i++) {
      if (smooth[i * 4 + 1] > smooth[(i - 1) * 4 + 1]) {
        smooth[i * 4 + 1] = smooth[(i - 1) * 4 + 1];
      }
    }
  } else {
    for (let i = rows - 2; i >= 0; i--) {
      if (smooth[i * 4 + 1] > smooth[(i + 1) * 4 + 1]) {
        smooth[i * 4 + 1] = smooth[(i + 1) * 4 + 1];
      }
    }
  }

  const positions = new Float32Array(rows * 2 * 3);
  const deep = new Float32Array(rows * 2);
  const uvs = new Float32Array(rows * 2 * 2);
  let along = 0;
  for (let i = 0; i < rows; i++) {
    const x = smooth[i * 4];
    const y = smooth[i * 4 + 1];
    const z = smooth[i * 4 + 2];
    const width = smooth[i * 4 + 3];
    // Central difference for the axis, ends falling back one-sided.
    const back = Math.max(0, i - 1);
    const fore = Math.min(rows - 1, i + 1);
    let dx = smooth[fore * 4] - smooth[back * 4];
    let dz = smooth[fore * 4 + 2] - smooth[back * 4 + 2];
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) { dx = 1; dz = 0; } else { dx /= run; dz /= run; }
    const half = (width / 2) * EDGE;
    if (i > 0) {
      along += Math.hypot(x - smooth[(i - 1) * 4], z - smooth[(i - 1) * 4 + 2]);
    }
    for (const side of [-1, 1]) {
      const v = i * 2 + (side + 1) / 2;
      positions[v * 3] = x - cx + -dz * half * side;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z - cz + dx * half * side;
      // The CENTRE depth of the channel here. The strip has no centre
      // vertex — two per station — so the cross-channel shaping is the
      // fragment shader's job: it scales this by a profile of v, which
      // is exactly the carve's own shape seen from above.
      deep[v] = channelDepth(width);
      // u runs downstream in arc length, v across. The shader scrolls u.
      uvs[v * 2] = along / 800;
      uvs[v * 2 + 1] = (side + 1) / 2;
    }
  }

  const faces: number[] = [];
  for (let i = 0; i < rows - 1; i++) {
    const a = i * 2;
    faces.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(faces);
  // FLAT +Y NORMALS, written rather than computed — another ported BE
  // lesson: computeVertexNormals on a long thin strip shades each quad
  // facet visibly through the transparent water, and a river's real
  // slope is metres over kilometres, which is flat to any eye.
  const normals = new Float32Array(rows * 2 * 3);
  for (let v = 0; v < rows * 2; v++) normals[v * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export class RiverWater {
  private readonly drawn = new Map<number, Drawn>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private readonly rippleMap: { value: THREE.Texture };
  private seconds = 0;
  private lastCell = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hydro: Hydro,
  ) {
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.rippleMap = { value: flat };
    this.material = this.build();
  }

  wear(texture: THREE.Texture): void {
    this.rippleMap.value = texture;
  }

  /** Bring the nearby reaches into being and let the far ones go. */
  follow(at: { wx: number; wz: number }): void {
    // Re-decide only when she has crossed into a new decision cell —
    // the wanted-set walk over 1,121 reaches is not free.
    const cell = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (cell === this.lastCell) {
      // STILL RE-SEAT. The early return skips the 1,121-reach walk,
      // not the origin: a putAt teleport inside one decision cell still
      // moves the floating origin, and ribbons seated against the old
      // one drew the Wainiha sixty metres off its own trench. The
      // review caught it; LakeWater never had the bug only because its
      // follow() ends in place() unconditionally.
      this.place();
      return;
    }
    this.lastCell = cell;

    const levels = riverPointLevels();
    if (!levels) return;
    const wanted = new Set<number>();
    for (let r = 0; r < this.hydro.rivers.length; r++) {
      const river = this.hydro.rivers[r];
      // Near enough if any point's box distance is inside the reach.
      for (let i = 0; i < river.count; i += 4) {
        const p = river.first + i;
        if (Math.abs(this.hydro.x[p] - at.wx) < REACH
          && Math.abs(this.hydro.z[p] - at.wz) < REACH) {
          wanted.add(r);
          break;
        }
      }
    }

    for (const [index, reach] of this.drawn) {
      if (wanted.has(index)) continue;
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
      this.drawn.delete(index);
    }
    for (const index of wanted) {
      if (this.drawn.has(index)) continue;
      const river = this.hydro.rivers[index];
      const stations = new Float64Array(river.count * 4);
      let cx = 0;
      let cz = 0;
      for (let i = 0; i < river.count; i++) {
        const p = river.first + i;
        stations[i * 4] = this.hydro.x[p];
        stations[i * 4 + 1] = levels[p];
        stations[i * 4 + 2] = this.hydro.z[p];
        stations[i * 4 + 3] = this.hydro.width[p];
        cx += this.hydro.x[p];
        cz += this.hydro.z[p];
      }
      cx /= river.count;
      cz /= river.count;
      const geometry = buildReach(stations, cx, cz);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      this.drawn.set(index, { mesh, cx, cz });
    }
    this.place();
  }

  /** Re-seat against the origin and the relief dial. */
  place(): void {
    const relief = reliefScale();
    for (const reach of this.drawn.values()) {
      const seat = toLocal(world(reach.cx, reach.cz));
      reach.mesh.position.set(seat.lx, 0, seat.lz);
      // The dial, as a scale: vertex Y is absolute water elevation.
      reach.mesh.scale.y = relief;
    }
  }

  update(dt: number): void {
    this.seconds += dt;
    this.clock.value = this.seconds;
  }

  get shown(): number {
    return this.drawn.size;
  }

  dispose(): void {
    for (const reach of this.drawn.values()) {
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
    }
    this.drawn.clear();
    this.material.dispose();
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0x2e6b64,
      roughness: 0.24,
      metalness: 0.06,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      // LIFTED, not sunk — see the class comment. The opposite sign to
      // the ocean and the lakes, and it is BE's lesson, not a typo.
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.clock;
      shader.uniforms.uRipple = this.rippleMap;
      shader.uniforms.uSky = { value: new THREE.Color(0xa8cfe2).convertSRGBToLinear() };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float deep;
          varying float vDeep;
          varying vec2 vFlow;`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>
          vFlow = uv;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vDeep = deep;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vDeep;
          varying vec2 vFlow;
          uniform sampler2D uRipple;
          uniform float uTime;
          uniform vec3 uSky;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // The ripple scrolls DOWNSTREAM: u is arc length along the
            // reach, so -u drift is water going the way the river goes,
            // every reach, with no per-reach direction anywhere. Two
            // octaves, offset rates, so the repeat never reads.
            vec3 chop = (texture2D(uRipple, vFlow * vec2(1.0, 0.6) - vec2(uTime * 0.11, 0.0)).xyz - 0.5)
              + (texture2D(uRipple, vFlow * vec2(2.3, 1.4) - vec2(uTime * 0.19, 0.02)).xyz - 0.5) * 0.6;
            normal = normalize(normal + vec3(chop.x, 0.0, chop.y) * 0.35);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // ACROSS the channel: deep tint midstream, glass at the
            // banks. v runs 0..1 bank to bank.
            float mid = 1.0 - abs(vFlow.y * 2.0 - 1.0);
            float body = vDeep * (0.35 + 0.65 * mid);
            float shallow = 1.0 - smoothstep(6.0, 120.0, body);
            diffuseColor.rgb = mix(
              vec3(0.016, 0.13, 0.17), vec3(0.13, 0.28, 0.24), shallow * shallow);
            diffuseColor.a *= smoothstep(0.0, 0.5, mid) * 0.95 + 0.05;
            if (diffuseColor.a < 0.02) discard;
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float face = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, pow(1.0 - face, 5.0) * 0.45);
          }`);
    };

    return material;
  }
}
