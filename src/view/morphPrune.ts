/**
 * MORPH TARGETS THAT MOVE NOTHING ARE NOT SENT TO THE GPU (Joshua, 2026-10-21: "save memory and download size").
 *
 * A glTF mesh's primitives share one list of morph targets, so every part of Sarah's file -- a bikini strap, a trim --
 * carries all of her body's shapes, most of them all zeros on that part. three.js lays every target of a geometry
 * into one float texture on the GPU (16 bytes per vertex per target per attribute), zeros and all. This drops, per
 * geometry, the targets whose every position (and normal) delta is zero, and the normal deltas altogether where none
 * of the kept targets bends a normal. What she looks like does not change: a zero target added at any weight is
 * nothing. Influences are found by name (`morphTargetDictionary`), so the dictionary is renumbered to match.
 *
 * Call it once, before the mesh is first drawn (as `liftShapeFields` is).
 */
import type * as THREE from 'three';

/** Below this a normal delta does not change the light on her (normals are unit length). */
const NORMAL_EPSILON = 1e-4;

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function moves(attr: Attr | undefined, epsilon: number): boolean {
  if (!attr) return false;
  for (let i = 0; i < attr.count; i += 1) {
    if (Math.abs(attr.getX(i)) > epsilon || Math.abs(attr.getY(i)) > epsilon || Math.abs(attr.getZ(i)) > epsilon) return true;
  }
  return false;
}

/** What was dropped, for the HUD and the tests. */
export interface MorphPrune { readonly before: number; readonly after: number; readonly normalsDropped: boolean }

export function dropIdleMorphs(mesh: THREE.Mesh): MorphPrune | null {
  const geom = mesh.geometry as THREE.BufferGeometry, dict = mesh.morphTargetDictionary;
  const mp = geom.morphAttributes.position, mn = geom.morphAttributes.normal;
  if (!dict || !mp?.length) return null;
  const keep: number[] = [];
  for (let k = 0; k < mp.length; k += 1) if (moves(mp[k], 0) || moves(mn?.[k], NORMAL_EPSILON)) keep.push(k);
  const bendsNormals = !!mn?.length && keep.some((k) => moves(mn[k], NORMAL_EPSILON));
  if (keep.length === mp.length && (bendsNormals || !mn?.length)) return { before: mp.length, after: mp.length, normalsDropped: false };
  if (!keep.length) {
    // nothing on this part moves at all: it is drawn as a plain mesh (three.js cannot build a morph shader for none)
    geom.morphAttributes = {};
    mesh.morphTargetDictionary = undefined;
    mesh.morphTargetInfluences = undefined;
    return { before: mp.length, after: 0, normalsDropped: !!mn?.length };
  }
  const was = mesh.morphTargetInfluences ?? [];
  const name = new Map(Object.entries(dict).map(([n, k]) => [k, n] as const));
  geom.morphAttributes.position = keep.map((k) => mp[k]);
  if (mn?.length) {
    if (bendsNormals) geom.morphAttributes.normal = keep.map((k) => mn[k]);
    else delete geom.morphAttributes.normal;
  }
  mesh.morphTargetDictionary = Object.fromEntries(keep.flatMap((k, i) => (name.has(k) ? [[name.get(k)!, i]] : [])));
  mesh.morphTargetInfluences = keep.map((k) => was[k] ?? 0);
  return { before: mp.length, after: keep.length, normalsDropped: !!mn?.length && !bendsNormals };
}

/** The GPU bytes three.js spends on a geometry's morph texture: vertices x targets x attributes x one RGBA float. */
export function morphTextureBytes(geom: THREE.BufferGeometry): number {
  const targets = geom.morphAttributes.position?.length ?? 0;
  if (!targets) return 0;
  const perVertex = 1 + (geom.morphAttributes.normal?.length ? 1 : 0) + (geom.morphAttributes.color?.length ? 1 : 0);
  return geom.getAttribute('position').count * targets * perVertex * 16;
}
