import * as THREE from 'three';
import { toLocal } from './origin';
import { reliefScale } from './heightfield';
import { channelDepth, flowData, type Flow } from './flow';

/**
 * THE SURFACE OF EVERY STREAM THE ISLAND MAKES FOR ITSELF.
 *
 * Drawn through `flow.ts`'s stations — the same rows the collision index
 * is built from, so what is wet and what is blue are one thing by
 * construction rather than by two implementations staying in step.
 *
 * NO SPLINE. The bake's stations are one grid cell apart and already
 * follow the steepest descent of the ground they came from; smoothing
 * them would move the water off the valley floor it was derived from,
 * which is the exact fault this whole rebuild exists to remove.
 */

/**
 * How far a stream is worth drawing — the transition tier's reach.
 *
 * MEASURED, over three releases of blaming the wrong thing. A channel
 * can only read as a channel while the valley holding it is resolved,
 * and past the transition tier it is not: a vertex every 3,125 units
 * cannot show a metre-wide trench, so the ribbon stretches away at a
 * grazing angle and paints a flat stripe with a dead-straight near
 * edge. The water stops where its channel stops being visible.
 */
const REACH = 20_000;
const FADE_FROM = 13_000;
/** The ribbon stops just short of the channel edge, for the alpha fade. */
const EDGE = 0.98;

/**
 * HOW HIGH THE SURFACE RIDES OVER THE VALLEY FLOOR, as a fraction of
 * the channel's depth.
 *
 * NOTHING IS CARVED any more, so the water has no hole to sit in — its
 * surface has to sit ON the ground the bake found the channel in. At
 * exactly the floor elevation the ribbon and the terrain are coplanar
 * and fight for the depth test; worse, the ground between grid samples
 * carries up to 94 cm of procedural ripple (heightfield's OCTAVES), so
 * half the ribbon would be under the hillside it is lying on.
 *
 * Half a channel depth puts the surface clear of most of that ripple
 * while leaving the taller bumps standing proud — which is not an
 * artefact, it is what a shallow Kauai creek looks like. Stones in the
 * stream, and a real depth anywhere the water is deeper than they are.
 */
const RIDE = 0.5;

interface Drawn { readonly mesh: THREE.Mesh; readonly cx: number; readonly cz: number; }

/** One reach as a triangle strip, positions relative to (cx, 0, cz). */
export function buildReach(
  flow: Flow, first: number, count: number, cx: number, cz: number,
): THREE.BufferGeometry | null {
  if (count < 2) return null;
  const positions = new Float32Array(count * 2 * 3);
  const deep = new Float32Array(count * 2);
  // ACROSS THE CHANNEL, AS OUR OWN ATTRIBUTE. `vUv` looked like the
  // obvious thing to read in the fragment shader and is not declared at
  // all unless the material carries a map — three.js gates it behind
  // USE_UV, so the program failed to link and every stream came out
  // untextured black. Ours is always there.
  const across = new Float32Array(count * 2);
  const uvs = new Float32Array(count * 2 * 2);
  let along = 0;
  for (let i = 0; i < count; i++) {
    const p = first + i;
    const x = flow.x[p], z = flow.z[p];
    const y = flow.y[p] + channelDepth(flow.width[p]) * RIDE;
    const back = first + Math.max(0, i - 1);
    const fore = first + Math.min(count - 1, i + 1);
    let dx = flow.x[fore] - flow.x[back];
    let dz = flow.z[fore] - flow.z[back];
    const run = Math.hypot(dx, dz);
    if (run < 1e-6) { dx = 1; dz = 0; } else { dx /= run; dz /= run; }
    const half = (flow.width[p] / 2) * EDGE;
    if (i > 0) {
      along += Math.hypot(x - flow.x[p - 1], z - flow.z[p - 1]);
    }
    for (const side of [-1, 1]) {
      const v = i * 2 + (side + 1) / 2;
      positions[v * 3] = x - cx + -dz * half * side;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z - cz + dx * half * side;
      deep[v] = channelDepth(flow.width[p]);
      across[v] = side < 0 ? 0 : 1;
      uvs[v * 2] = along / 800;
      uvs[v * 2 + 1] = (side + 1) / 2;
    }
  }
  const faces: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const a = i * 2;
    faces.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('deep', new THREE.Float32BufferAttribute(deep, 1));
  geometry.setAttribute('across', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(faces);
  // FLAT +Y NORMALS, written rather than computed: computeVertexNormals
  // shades each quad facet visibly through transparent water, and a
  // stream's real slope is metres over kilometres, which is flat.
  const normals = new Float32Array(count * 2 * 3);
  for (let v = 0; v < count * 2; v++) normals[v * 3 + 1] = 1;
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return geometry;
}

export class FlowWater {
  private readonly drawn = new Map<number, Drawn>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private lastCell = '';
  private shownAll = true;

  constructor(private readonly scene: THREE.Scene) {
    this.material = this.build();
  }

  get shown(): number { return this.drawn.size; }

  setVisible(on: boolean): void {
    this.shownAll = on;
    for (const d of this.drawn.values()) d.mesh.visible = on;
  }

  private build(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      // ROUGH AND DIM, because the first version came back nearly
      // white. A smooth standard material under the island's sun blows
      // out to a pale sheet at every angle, which reads as plastic
      // rather than as water; the colour work below then has nothing
      // left to say.
      color: 0x1d4a5c, transparent: true, opacity: 0.72,
      roughness: 0.62, metalness: 0.0, depthWrite: false,
      side: THREE.DoubleSide,
    });
    // A river lies close over its own bed for its whole length, so
    // pushing its fragments DEEPER lets the bed win the depth test and
    // freckle through the surface. Lifted toward the camera instead.
    material.polygonOffset = true;
    material.polygonOffsetFactor = 0;
    material.polygonOffsetUnits = -8;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.clock = this.clock;
      shader.vertexShader =
        `attribute float deep;\nattribute float across;\n`
        + `varying float vDeep;\nvarying float vAcross;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vDeep = deep;\n  vAcross = across;');
      shader.fragmentShader =
        `uniform float clock;\nvarying float vDeep;\nvarying float vAcross;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', `#include <color_fragment>
        // Shallow at the bank, dark down the thread — the cross-channel
        // shape the strip has no vertices for.
        float edge = abs(vAcross - 0.5) * 2.0;
        float body = vDeep * max(0.0, 1.0 - edge * edge);
        float shallow = 1.0 - smoothstep(20.0, 400.0, body);
        diffuseColor.rgb = mix(vec3(0.014, 0.10, 0.15), vec3(0.10, 0.28, 0.30),
                               shallow * shallow);
        diffuseColor.a *= mix(0.55, 1.0, 1.0 - shallow);
        // Fade out where the channel stops being resolved, so the cut
        // is not a pop.
        diffuseColor.a *= 1.0 - smoothstep(${FADE_FROM}.0, ${REACH}.0, length(vViewPosition));
      `);
    };
    return material;
  }

  update(dt: number): void { this.clock.value += dt; }

  /** Bring the nearby reaches into being and let the far ones go. */
  follow(at: { wx: number; wz: number }): void {
    const flow = flowData();
    if (!flow) return;
    const cell = `${Math.round(at.wx / 50_000)}:${Math.round(at.wz / 50_000)}`;
    if (cell === this.lastCell) { this.place(); return; }
    this.lastCell = cell;

    const wanted = new Set<number>();
    for (let r = 0; r < flow.reaches.length; r++) {
      const reach = flow.reaches[r];
      for (let i = 0; i < reach.count; i += 4) {
        const p = reach.first + i;
        if (Math.abs(flow.x[p] - at.wx) < REACH && Math.abs(flow.z[p] - at.wz) < REACH) {
          wanted.add(r); break;
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
      const { first, count } = flow.reaches[index];
      let cx = 0, cz = 0;
      for (let i = 0; i < count; i++) { cx += flow.x[first + i]; cz += flow.z[first + i]; }
      cx /= count; cz /= count;
      const geometry = buildReach(flow, first, count, cx, cz);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.renderOrder = 1;
      mesh.visible = this.shownAll;
      this.scene.add(mesh);
      this.drawn.set(index, { mesh, cx, cz });
    }
    this.place();
  }

  /** Re-seat against the floating origin and the relief dial. */
  place(): void {
    const relief = reliefScale();
    for (const reach of this.drawn.values()) {
      const seat = toLocal({ wx: reach.cx, wz: reach.cz });
      reach.mesh.position.set(seat.lx, 0, seat.lz);
      reach.mesh.scale.y = relief;
    }
  }

  dispose(): void {
    for (const reach of this.drawn.values()) {
      this.scene.remove(reach.mesh);
      reach.mesh.geometry.dispose();
    }
    this.drawn.clear();
    this.material.dispose();
  }
}
