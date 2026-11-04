/** Add body-only CPU shape fields to an existing fitted garment. Native garment
 * morphs, authored clearance, wrinkles and skin weights remain authoritative.
 * Bind once on the shared approved geometry frame, never on a posed body.
 */
import * as THREE from 'three';
import type { ShapeFields } from '../view/bodyShapeView';
import { BodySurface } from './bodySurface';

type Field = ShapeFields['fields'] extends ReadonlyMap<string, infer F> ? F : never;
interface BoundGarment {
  tri: Uint32Array; bary: Float32Array; valid: Uint8Array;
  sources: Map<string, Field>; outputs: Map<string, Field>;
}

export class GarmentShapeTransfer {
  private readonly surface: BodySurface;
  private readonly triangles: Uint32Array;
  private readonly garments = new WeakMap<THREE.Mesh, BoundGarment>();
  private readonly dense: Float32Array;
  private readonly denseNormal: Float32Array;
  private readonly p = new THREE.Vector3();

  constructor(body: THREE.SkinnedMesh, rest: ShapeFields, private readonly maxDistance = 0.08) {
    // allIndices survives the room's optional index filtering. Skin is never hidden here.
    const indices = body.userData.allIndices as ArrayLike<number> | undefined;
    this.triangles = Uint32Array.from(indices ?? body.geometry.index?.array ?? []);
    this.surface = new BodySurface(body, this.triangles, rest.basePos);
    this.dense = new Float32Array(rest.basePos.length);
    this.denseNormal = new Float32Array(rest.basePos.length);
  }

  /** Only missing baby-weight / milk fields by default. Widen explicitly for a
   * future public body field after reviewing its interaction with authored fits.
   * Returning a changed source object replaces a previously transferred field.
   * Body and garment must use the same approved local frame (recovered garments do).
   */
  sync(mesh: THREE.Mesh, target: ShapeFields, source: ShapeFields,
    accept = (name: string) => name.startsWith('shape:baby:') || name.startsWith('shape:milk:')): { fields: ShapeFields; added: number } {
    const wanted = [...source.fields].filter(([name]) => accept(name));
    if (!wanted.length) return { fields: target, added: 0 };
    let binding = this.garments.get(mesh);
    if (!binding) {
      const n = target.basePos.length / 3;
      binding = { tri: new Uint32Array(n * 3), bary: new Float32Array(n * 3), valid: new Uint8Array(n), sources: new Map(), outputs: new Map() };
      for (let v = 0; v < n; v++) {
        this.p.fromArray(target.basePos, v * 3);
        const a = this.surface.closestRest(this.p, this.maxDistance);
        if (!a) continue;
        binding.valid[v] = 1;
        binding.tri.set(this.triangles.subarray(a.tri * 3, a.tri * 3 + 3), v * 3);
        binding.bary.set(a.bary, v * 3);
      }
      this.garments.set(mesh, binding);
    }
    const fields = new Map(target.fields);
    let changed = 0;
    for (const [name, field] of wanted) {
      const previous = binding.outputs.get(name), native = fields.get(name);
      if (native && native !== previous) continue;
      if (binding.sources.get(name) === field && native === previous) continue;
      this.dense.fill(0); this.denseNormal.fill(0);
      for (let k = 0; k < field.index.length; k++) {
        const v = field.index[k] * 3;
        this.dense.set(field.pos.subarray(k * 3, k * 3 + 3), v);
        if (field.nrm) this.denseNormal.set(field.nrm.subarray(k * 3, k * 3 + 3), v);
      }
      const index: number[] = [], positions: number[] = [], normals: number[] = [];
      for (let v = 0; v < binding.valid.length; v++) {
        if (!binding.valid[v]) continue;
        const o = v * 3;
        let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0;
        for (let c = 0; c < 3; c++) {
          const at = binding.tri[o + c] * 3, w = binding.bary[o + c];
          x += w * this.dense[at]; y += w * this.dense[at + 1]; z += w * this.dense[at + 2];
          nx += w * this.denseNormal[at]; ny += w * this.denseNormal[at + 1]; nz += w * this.denseNormal[at + 2];
        }
        if (x || y || z || nx || ny || nz) { index.push(v); positions.push(x, y, z); normals.push(nx, ny, nz); }
      }
      const transferred: Field = { index: Uint32Array.from(index), pos: Float32Array.from(positions), nrm: field.nrm ? Float32Array.from(normals) : null };
      fields.set(name, transferred); binding.sources.set(name, field); binding.outputs.set(name, transferred); changed++;
    }
    return { fields: changed ? { ...target, fields, last: '' } : target, added: changed };
  }
}
