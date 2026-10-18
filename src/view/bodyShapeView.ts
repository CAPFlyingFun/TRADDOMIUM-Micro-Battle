/**
 * A BODY'S SHAPE FIELDS, APPLIED ON THE CPU (`scripts/sarahV2Shape.mjs` writes them as morph
 * targets named `shape:<control>`).
 *
 * They are lifted out of the mesh at load, BEFORE its first draw: three.js packs every morph
 * target of a mesh into one float texture (on Sarah v2, 116k vertices × 23 shapes is already
 * some 85 MB), and a body's proportions do not change from frame to frame, so there is no
 * reason to pay GPU memory for twelve more. Instead each field is kept sparse (only the
 * vertices it moves) and Σ weight × field is added to the rest shape when a control moves,
 * once, in a few milliseconds. Skinning, the belly and breast shapes, the springs and every
 * pose then work on that rest shape exactly as before.
 *
 * All weights zero puts the original rest shape back bit for bit, so a body of approved
 * values is the approved body.
 */
import * as THREE from 'three';

interface Field { readonly index: Uint32Array; readonly pos: Float32Array; readonly nrm: Float32Array | null }

export interface ShapeFields {
  readonly fields: ReadonlyMap<string, Field>;
  readonly basePos: Float32Array;
  readonly baseNrm: Float32Array | null;
  /** the weights last applied, so an unchanged set does nothing */
  last: string;
}

export const SHAPE_FIELD_PREFIX = 'shape:';

/** Lift `shape:*` morph targets out of a mesh (call before it is first drawn). Null when it has none. */
export function liftShapeFields(mesh: THREE.Mesh): ShapeFields | null {
  const geom = mesh.geometry as THREE.BufferGeometry, dict = mesh.morphTargetDictionary;
  if (!dict) return null;
  const names = Object.keys(dict).filter((n) => n.startsWith(SHAPE_FIELD_PREFIX));
  if (!names.length) return null;
  const mp = geom.morphAttributes.position ?? [], mn = geom.morphAttributes.normal ?? [];
  const fields = new Map<string, Field>();
  for (const name of names) {
    const k = dict[name], a = mp[k], b = mn[k] ?? null;
    const idx: number[] = [], pos: number[] = [], nrm: number[] = [];
    for (let i = 0; i < a.count; i += 1) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const nx = b ? b.getX(i) : 0, ny = b ? b.getY(i) : 0, nz = b ? b.getZ(i) : 0;
      if (x === 0 && y === 0 && z === 0 && nx === 0 && ny === 0 && nz === 0) continue;
      idx.push(i); pos.push(x, y, z); nrm.push(nx, ny, nz);
    }
    fields.set(name, { index: Uint32Array.from(idx), pos: Float32Array.from(pos), nrm: b ? Float32Array.from(nrm) : null });
  }
  // the mesh keeps every other target, in order, renumbered
  const keep = Object.entries(dict).filter(([n]) => !n.startsWith(SHAPE_FIELD_PREFIX)).sort((p, q) => p[1] - q[1]);
  geom.morphAttributes.position = keep.map(([, k]) => mp[k]);
  if (mn.length) geom.morphAttributes.normal = keep.map(([, k]) => mn[k]);
  const was = mesh.morphTargetInfluences ?? [];
  mesh.morphTargetDictionary = Object.fromEntries(keep.map(([n], i) => [n, i]));
  mesh.morphTargetInfluences = keep.map(([, k]) => was[k] ?? 0);
  // the rest shape as plain floats (a quantized file stores it as normalized integers), so it can take fine moves
  const toFloat = (name: 'position' | 'normal') => {
    const attr = geom.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!attr) return null;
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i += 1) { out[i * 3] = attr.getX(i); out[i * 3 + 1] = attr.getY(i); out[i * 3 + 2] = attr.getZ(i); }
    geom.setAttribute(name, new THREE.BufferAttribute(out.slice(), 3));
    return out;
  };
  const basePos = toFloat('position')!, baseNrm = toFloat('normal');
  return { fields, basePos, baseNrm, last: '' };
}

/**
 * Rest shape = original + Σ weight × field; weights by field name, missing ones zero.
 * Recovered clothing leaves normal sums raw until GPU normal morphs are added,
 * so CPU fit residuals and native GPU deltas cancel before shader normalization.
 */
export function applyShapeFields(mesh: THREE.Mesh, shape: ShapeFields, weights: Readonly<Record<string, number>>, options: { normalizeNormals?: boolean } = {}): void {
  const normalizeNormals = options.normalizeNormals ?? true;
  const live = [...shape.fields.keys()].map((n) => [n, Number.isFinite(weights[n]) ? weights[n] : 0] as const).filter(([, w]) => w !== 0);
  const key = live.map(([n, w]) => `${n}:${w.toFixed(5)}`).join('|') + (normalizeNormals ? '' : '|raw-normals');
  if (key === shape.last) return;
  shape.last = key;
  const geom = mesh.geometry as THREE.BufferGeometry;
  const pos = geom.getAttribute('position') as THREE.BufferAttribute, P = pos.array as Float32Array;
  P.set(shape.basePos);
  const nrmAttr = shape.baseNrm ? (geom.getAttribute('normal') as THREE.BufferAttribute) : null, N = nrmAttr ? (nrmAttr.array as Float32Array) : null;
  if (N && shape.baseNrm) N.set(shape.baseNrm);
  const touched = new Uint8Array(N ? pos.count : 0);
  for (const [name, w] of live) {
    const f = shape.fields.get(name)!;
    for (let k = 0; k < f.index.length; k += 1) {
      const i = f.index[k] * 3;
      P[i] += w * f.pos[k * 3]; P[i + 1] += w * f.pos[k * 3 + 1]; P[i + 2] += w * f.pos[k * 3 + 2];
      if (N && f.nrm) { N[i] += w * f.nrm[k * 3]; N[i + 1] += w * f.nrm[k * 3 + 1]; N[i + 2] += w * f.nrm[k * 3 + 2]; touched[f.index[k]] = 1; }
    }
  }
  if (N && normalizeNormals) for (let v = 0; v < touched.length; v += 1) if (touched[v]) { const i = v * 3, l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  pos.needsUpdate = true;
  if (nrmAttr) nrmAttr.needsUpdate = true;
}
