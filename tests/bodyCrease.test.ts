/**
 * HER CREASE, ON HER (`sarahlab/bodyCrease.ts`): the repair `view/creaseRelax.ts` works out is measured on her shape as
 * the GPU sums it (attributes plus weighted morphs) and written into the attributes so that the sum draws it. Here, on a
 * small sheet standing where her crease is: a fold made only by a MORPH is found and untangled; the normal written is
 * the repaired one less the morphs' normal offsets, so the shader's sum points where the repair says; `lift` puts every
 * value back bit for bit; an answer is laid again at once for the same shape, and not for another; the morphs that move
 * every frame are not part of the shape; nothing is laid while the room has the repair off; and the zone is her chest.
 * (No `Worker` under the test runner: the page works it out, the same arithmetic the worker runs.)
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BodyCrease, inSarahCreaseZone, SARAH_V2_CREASE_ZONE, unitBefore } from '../src/sarahlab/bodyCrease';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from '../src/sarahlab/faceRig';

/** Rest metres to her geometry's units. */
const geom = (x: number, y: number, z: number): [number, number, number] =>
  [(x - FACE_REST_OFFSET[0]) / FACE_REST_SCALE, (y - FACE_REST_OFFSET[1]) / FACE_REST_SCALE, (z - FACE_REST_OFFSET[2]) / FACE_REST_SCALE];

const N = 24, STEP = 0.002;

/** A sheet facing +z at her crease's height, a morph `fold` that drags one row up past the next two, and a still morph `spring`. */
function sheet(): THREE.Mesh {
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], fold: number[] = [], foldN: number[] = [], spring: number[] = [];
  for (let i = 0; i < N; i += 1) for (let j = 0; j < N; j += 1) {
    pos.push(...geom(-0.024 + i * STEP, 1.18 + j * STEP, 0.06)); nrm.push(0, 0, 1);
    const dragged = j === 12 && i > 3 && i < N - 4;
    fold.push(0, dragged ? 2.5 * STEP / FACE_REST_SCALE : 0, 0); foldN.push(dragged ? 0.3 : 0, 0, 0);
    spring.push(0, 0, 0.0001);
  }
  for (let i = 0; i + 1 < N; i += 1) for (let j = 0; j + 1 < N; j += 1) {
    const a = i * N + j, b = (i + 1) * N + j, c = (i + 1) * N + j + 1, d = i * N + j + 1;
    idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  g.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(fold), 3), new THREE.BufferAttribute(new Float32Array(spring), 3)];
  g.morphAttributes.normal = [new THREE.BufferAttribute(new Float32Array(foldN), 3), new THREE.BufferAttribute(new Float32Array(N * N * 3), 3)];
  g.morphTargetsRelative = true;
  const m = new THREE.Mesh(g);
  m.morphTargetDictionary = { fold: 0, spring: 1 };
  m.morphTargetInfluences = [0, 0];
  return m;
}

const arrays = (m: THREE.Mesh) => ({
  P: (m.geometry.getAttribute('position').array as Float32Array).slice(),
  N: (m.geometry.getAttribute('normal').array as Float32Array).slice(),
});
const base = (m: THREE.Mesh) => arrays(m);

describe('her crease, on her', () => {
  it('looks at her chest and upper belly, and nowhere else', () => {
    expect(inSarahCreaseZone(...geom(0.08, 1.2, 0.08))).toBe(true);
    expect(inSarahCreaseZone(...geom(-0.06, 1.22, 0.05))).toBe(true);
    expect(inSarahCreaseZone(...geom(0, 1.0, 0.1))).toBe(false); // her navel
    expect(inSarahCreaseZone(...geom(0, 1.5, 0.05))).toBe(false); // her throat
    expect(inSarahCreaseZone(...geom(0, 1.2, -0.12))).toBe(false); // her back
    expect(inSarahCreaseZone(...geom(0.3, 1.2, 0))).toBe(false); // her arm
    expect(SARAH_V2_CREASE_ZONE.scale).toBe(FACE_REST_SCALE);
  });

  it('finds the unit normal that, with the morphs\' offsets added, points where it should', () => {
    const out = [0, 0, 0];
    for (const [t, d] of [[[0, 0, 1], [0.3, -0.2, 0.1]], [[0, 0.6, 0.8], [0, 0, 0]], [[1, 0, 0], [-0.9, 0.3, 0]], [[0, 1, 0], [0.2, 0.9, -0.3]]] as const) {
      unitBefore(t[0], t[1], t[2], d[0], d[1], d[2], out);
      expect(Math.hypot(...out)).toBeCloseTo(1, 9);
      const s = [out[0] + d[0], out[1] + d[1], out[2] + d[2]], l = Math.hypot(...s);
      for (let c = 0; c < 3; c += 1) expect(s[c] / l).toBeCloseTo(t[c], 9);
    }
    // an offset longer than a unit, across the normal wanted: no unit attribute does it, so t - D, which with D added
    // is exactly t wherever the attribute goes on as given
    unitBefore(0, 0, 1, 1.5, 0, 0, out);
    expect(out).toEqual([-1.5, 0, 1]);
    // ...and one longer than a unit AGAINST it, where the unit root would point the sum backwards: t - D too
    unitBefore(0, 0, 1, 0.3, 0, -1.4, out);
    expect(out[0]).toBeCloseTo(-0.3, 9); expect(out[1]).toBeCloseTo(0, 9); expect(out[2]).toBeCloseTo(2.4, 9);
  });

  it('lays nothing on a shape with nothing wrong, and keeps the attributes as they were', () => {
    const m = sheet(), b = base(m), crease = new BodyCrease(['spring']);
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(false);
    crease.request();
    expect(crease.last?.vertices.length).toBe(0);
    expect(arrays(m)).toEqual(b);
  });

  it('untangles a fold only a morph makes, and the summed normal is the repaired one', () => {
    const m = sheet(), b = base(m), crease = new BodyCrease(['spring']);
    m.morphTargetInfluences![0] = 1;
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(false);
    crease.request();
    const r = crease.last!;
    expect(r.found.folds).toBeGreaterThan(0);
    expect(r.left.folds).toBe(0);
    expect(r.vertices.length).toBeGreaterThan(0);
    const now = arrays(m), dn = m.geometry.morphAttributes.normal![0];
    for (let k = 0; k < r.vertices.length; k += 1) {
      const v = r.vertices[k];
      for (let c = 0; c < 3; c += 1) expect(now.P[3 * v + c]).toBeCloseTo(b.P[3 * v + c] + r.offset[3 * k + c], 6);
      if (Number.isNaN(r.normal[3 * k])) continue;
      // the attribute is UNIT here (the morph's offsets are short), and what the shader sums from it (attribute + weight
      // x morph normal) points along the repaired normal
      const at = [0, 1, 2].map((c) => now.N[3 * v + c]);
      expect(Math.hypot(...at)).toBeCloseTo(1, 5);
      const s = [0, 1, 2].map((c) => at[c] + dn.getComponent(v, c)), l = Math.hypot(...s);
      for (let c = 0; c < 3; c += 1) expect(s[c] / l).toBeCloseTo(r.normal[3 * k + c], 5);
    }
    // ...and lifting it puts back every value exactly
    crease.lift();
    expect(arrays(m)).toEqual(b);
  });

  it('lays the same answer again at once for the same shape, and not for another', () => {
    const m = sheet(), b = base(m), crease = new BodyCrease(['spring']);
    m.morphTargetInfluences![0] = 1;
    crease.relay(m, 'k', b.P, b.N);
    crease.request();
    const laid = arrays(m), first = crease.last;
    crease.lift();
    // her spring moved, nothing else: the same shape to her crease
    m.morphTargetInfluences![1] = 0.7;
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(true);
    expect(crease.last).toBe(first);
    expect(arrays(m)).toEqual(laid);
    // summed again unchanged: what is laid stays, untouched (nothing to upload)
    const version = (m.geometry.getAttribute('position') as THREE.BufferAttribute).version;
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(true);
    expect((m.geometry.getAttribute('position') as THREE.BufferAttribute).version).toBe(version);
    // her shape fields changed: the room rewrote her attributes whole from her approved shape (as bodyShapeView does), and
    // nothing is laid on the new shape until it is worked out
    (m.geometry.getAttribute('position').array as Float32Array).set(b.P); (m.geometry.getAttribute('normal').array as Float32Array).set(b.N);
    expect(crease.relay(m, 'k2', b.P, b.N)).toBe(false);
    expect(arrays(m)).toEqual(b);
    // back to the first shape: laid again at once
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(true);
    expect(arrays(m)).toEqual(laid);
    // the fold half as deep (a morph, so her attributes were not rewritten): what was laid comes off exactly
    m.morphTargetInfluences![0] = 0.5;
    expect(crease.relay(m, 'k', b.P, b.N)).toBe(false);
    expect(arrays(m)).toEqual(b);
  });

  it('looks for the fold on her shape as her bones carry it: a fold her build\'s bones undo is no fold', () => {
    // her build moves skin on different bones apart in rest space for the moved bones to bring back together: here the
    // morph drags a row up past its neighbours, and the bones (the shift) carry that row back down again
    const m = sheet(), b = base(m), crease = new BodyCrease(['spring']);
    m.morphTargetInfluences![0] = 1;
    const dragged = m.geometry.morphAttributes.position![0];
    crease.shift = (_mesh, vertices) => Float32Array.from(Array.from(vertices).flatMap((v) => [0, -dragged.getY(v), 0]));
    crease.relay(m, 'k', b.P, b.N);
    crease.request();
    expect(crease.last?.found.folds).toBe(0);
    expect(crease.last?.vertices.length).toBe(0);
    expect(arrays(m)).toEqual(b);
    // ...and with no shift the same rest shape is the fold the repair untangles
    const again = new BodyCrease(['spring']);
    again.relay(m, 'k', b.P, b.N);
    again.request();
    expect(again.last!.found.folds).toBeGreaterThan(0);
  });

  it('works an answer out but lays nothing while the room has the repair off', () => {
    const m = sheet(), b = base(m), crease = new BodyCrease(['spring']);
    m.morphTargetInfluences![0] = 1;
    crease.enabled = false;
    crease.relay(m, 'k', b.P, b.N);
    crease.request();
    expect(crease.last?.found.folds).toBeGreaterThan(0);
    expect(arrays(m)).toEqual(b);
  });
});
