/**
 * ClothSkin's garment additions (Stage 2b): `trunkOnly`, the garment's own word on which particles are its BODY (never
 * taking her arm as their floor) in place of the rule that reads it off the bound triangle; and `contactBinding`, a
 * particle's contact on her NOW as a binding, so a garment settled on her is bound where it lies. On a skinned sphere
 * split along its seams (three's SphereGeometry), in a room scaled 100 to the metre, turned and moved, as the character
 * room is: the upper bone carries the top half, and is "her arm" where the test says so.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ClothSkin } from '../src/sarahlab/clothSkin';
import { createContacts, type ClothBinding } from '../src/sarahlab/clothTypes';

interface Body { root: THREE.Group; mesh: THREE.SkinnedMesh; upper: THREE.Bone; geometry: THREE.BufferGeometry }

/** Two bones split at y = `split`: the lower everything below split - blend, the upper (pivot at `pivot`) everything above split + blend. */
function body(geometry: THREE.BufferGeometry, { split = 0, blend = 0.05, pivot = new THREE.Vector3(0, 0, 0) } = {}): Body {
  const pos = geometry.getAttribute('position'), n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const t = THREE.MathUtils.clamp((pos.getY(v) - (split - blend)) / (2 * blend), 0, 1);
    si[v * 4] = 0; si[v * 4 + 1] = 1; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.position.set(12, -7, 3); root.rotation.set(0.3, 0.7, -0.2); root.scale.setScalar(100);
  const lower = new THREE.Bone(), upper = new THREE.Bone();
  upper.position.copy(pivot);
  lower.add(upper);
  root.add(lower, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([lower, upper]));
  return { root, mesh, upper, geometry };
}

/** Every vertex as three poses it, in world space. */
function posedWorld(mesh: THREE.SkinnedMesh): THREE.Vector3[] {
  const n = mesh.geometry.getAttribute('position').count, out: THREE.Vector3[] = [];
  for (let v = 0; v < n; v++) out.push(mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  return out;
}

/** The nearest point of the whole posed surface to p, by trying every triangle. */
function bruteClosest(world: THREE.Vector3[], T: number[], p: THREE.Vector3): THREE.Vector3 {
  const tri = new THREE.Triangle(), q = new THREE.Vector3(), best = new THREE.Vector3();
  let bestD = Infinity;
  for (let t = 0; t < T.length; t += 3) {
    tri.set(world[T[t]], world[T[t + 1]], world[T[t + 2]]);
    tri.closestPointToPoint(p, q);
    const d = q.distanceToSquared(p);
    if (d < bestD) { bestD = d; best.copy(q); }
  }
  return best;
}

const tris = (g: THREE.BufferGeometry) => Array.from(g.index!.array);
const at = (a: Float32Array, i: number) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
/** A world point back into the body's own (rest) frame, bones at rest. */
const toLocal = (b: Body, p: THREE.Vector3) => p.clone().applyMatrix4(b.mesh.matrixWorld.clone().invert());
const toWorld = (b: Body, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(b.mesh.matrixWorld);

/** The triangle whose rest centroid is nearest `c` (body-local). */
function triangleNear(g: THREE.BufferGeometry, c: THREE.Vector3): number {
  const pos = g.getAttribute('position'), T = tris(g), m = new THREE.Vector3(), v = new THREE.Vector3();
  let best = -1, bestD = Infinity;
  for (let t = 0; t < T.length / 3; t++) {
    m.set(0, 0, 0);
    for (let k = 0; k < 3; k++) m.add(v.fromBufferAttribute(pos, T[t * 3 + k]));
    m.divideScalar(3);
    const d = m.distanceToSquared(c);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** One particle bound at the middle of triangle t, `offset` off it. */
function bindAt(g: THREE.BufferGeometry, t: number, offset = 0.01): ClothBinding {
  const T = tris(g);
  return { count: 1, tri: Uint32Array.from([T[t * 3], T[t * 3 + 1], T[t * 3 + 2]]), bary: Float32Array.from([1 / 3, 1 / 3, 1 / 3]), offset: Float32Array.from([offset]) };
}

/** Walk one particle held at `p` (world) for `updates` updates; its contact point, body-local. */
function contactAfter(b: Body, skin: ClothSkin, p: THREE.Vector3, updates = 30): THREE.Vector3 {
  const cloth = Float32Array.from([p.x, p.y, p.z]), out = createContacts(1);
  for (let k = 0; k < updates; k++) skin.update(cloth, out);
  return toLocal(b, at(out.point, 0));
}

describe('ClothSkin.trunkOnly: the garment says which particles are its body', () => {
  // the sphere's top half (y > 0) hangs from bone 1, which these tests call her arm; a triangle is the arm's when two of
  // its corners are, so the trunk reaches up to the row just above the equator (y ≈ 0.2) and no further
  const ARM = [1];

  it('by default a particle bound to her trunk never walks onto her arm, and one bound to her arm walks anywhere', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g);
    const trunkT = triangleNear(g, new THREE.Vector3(0.9, -0.3, 0.3)), armT = triangleNear(g, new THREE.Vector3(0.9, 0.3, 0.3));
    const top = toWorld(b, 0.1, 1.1, 0.1), bottom = toWorld(b, 0.1, -1.1, 0.1);

    const trunk = new ClothSkin(b.mesh, bindAt(g, trunkT), { armBones: ARM });
    expect(trunk.boundToArm(0)).toBe(false);
    expect(contactAfter(b, trunk, top).y).toBeLessThan(0.25); // held at the trunk's top edge

    const arm = new ClothSkin(b.mesh, bindAt(g, armT), { armBones: ARM });
    expect(arm.boundToArm(0)).toBe(true);
    expect(contactAfter(b, arm, bottom).y).toBeLessThan(-0.9); // walked down onto the trunk freely
  });

  it('trunkOnly 0 lets a particle bound to her trunk take her arm as its floor (a sleeve bound low on her)', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g);
    const trunkT = triangleNear(g, new THREE.Vector3(0.9, -0.3, 0.3));
    const skin = new ClothSkin(b.mesh, bindAt(g, trunkT), { armBones: ARM, trunkOnly: Uint8Array.from([0]) });
    // still bound to the trunk: the rule only changes where it may walk
    expect(skin.boundToArm(0)).toBe(false);
    const p = toWorld(b, 0.1, 1.1, 0.1), q = contactAfter(b, skin, p);
    expect(q.y).toBeGreaterThan(0.9);
    // and it found the true nearest skin there: the sphere's surface, under the particle
    expect(q.length()).toBeGreaterThan(0.97);
    expect(q.length()).toBeLessThan(1.001);
  });

  it('trunkOnly 1 keeps a particle bound to her ARM off every other arm triangle (a garment body piece bound under her arm)', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g);
    const armT = triangleNear(g, new THREE.Vector3(0.9, 0.3, 0.3));
    const skin = new ClothSkin(b.mesh, bindAt(g, armT), { armBones: ARM, trunkOnly: Uint8Array.from([1]) });
    expect(skin.boundToArm(0)).toBe(true);
    // pulled to the top of her arm it cannot follow: no step onto another arm triangle is allowed, so it keeps its own
    const there = toWorld(b, 0.1, 1.1, 0.1), q = contactAfter(b, skin, there);
    expect(q.y).toBeLessThan(0.5);
    // pulled down, it walks down off her arm onto the trunk, which it may
    expect(contactAfter(b, skin, toWorld(b, 0.1, -1.1, 0.1)).y).toBeLessThan(-0.9);
  });

  it('is per particle, in binding order; a shorter array, or no armBones at all, leaves the default rule', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g);
    const trunkT = triangleNear(g, new THREE.Vector3(0.9, -0.3, 0.3));
    const T = tris(g);
    const two: ClothBinding = {
      count: 2, tri: Uint32Array.from([...T.slice(trunkT * 3, trunkT * 3 + 3), ...T.slice(trunkT * 3, trunkT * 3 + 3)]),
      bary: new Float32Array(6).fill(1 / 3), offset: Float32Array.from([0.01, 0.01]),
    };
    const top = toWorld(b, 0.1, 1.1, 0.1);
    const cloth = Float32Array.from([...top.toArray(), ...top.toArray()]);
    const run = (skin: ClothSkin) => { const out = createContacts(2); for (let k = 0; k < 30; k++) skin.update(cloth, out); return [toLocal(b, at(out.point, 0)).y, toLocal(b, at(out.point, 1)).y]; };

    const [kept, free] = run(new ClothSkin(b.mesh, two, { armBones: ARM, trunkOnly: Uint8Array.from([1, 0]) }));
    expect(kept).toBeLessThan(0.25);
    expect(free).toBeGreaterThan(0.9);

    // one value for two particles is not an answer: both keep the rule read off their (trunk) triangle
    const [a1, a2] = run(new ClothSkin(b.mesh, two, { armBones: ARM, trunkOnly: Uint8Array.from([0]) }));
    expect(a1).toBeLessThan(0.25);
    expect(a2).toBeLessThan(0.25);

    // with no arm named there are no arm triangles to keep off: trunkOnly 1 changes nothing
    const [n1, n2] = run(new ClothSkin(b.mesh, two, { trunkOnly: Uint8Array.from([1, 1]) }));
    expect(n1).toBeGreaterThan(0.9);
    expect(n2).toBeGreaterThan(0.9);
  });
});

describe('ClothSkin.contactBinding: where the cloth lies on her now, as a binding', () => {
  /** n particles at random places 0.5 to 3 world units off the sphere (radius 100 world), in the body's own frame. */
  function scatter(b: Body, n: number, seed = 11): Float32Array {
    let s = seed;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(rand() * 2 - 1, rand() * 1.6 - 0.8, rand() * 2 - 1).normalize();
      const p = toWorld(b, ...(dir.multiplyScalar(1 + (0.5 + rand() * 2.5) / 100).toArray() as [number, number, number]));
      out.set(p.toArray(), i * 3);
    }
    return out;
  }

  /** A binding to somewhere on the sphere for each of n particles (where the walk starts from). */
  function startBinding(g: THREE.BufferGeometry, n: number): ClothBinding {
    const T = tris(g), t0 = triangleNear(g, new THREE.Vector3(1, 0, 0));
    const tri = new Uint32Array(n * 3);
    for (let i = 0; i < n; i++) tri.set(T.slice(t0 * 3, t0 * 3 + 3), i * 3);
    return { count: n, tri, bary: new Float32Array(n * 3).fill(1 / 3), offset: new Float32Array(n).fill(0.01) };
  }

  it('binds each particle to the triangle under it, barycentric weights on it, and its height off it in body-local units', () => {
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g), n = 40;
    const skin = new ClothSkin(b.mesh, startBinding(g, n));
    const cloth = scatter(b, n), out = createContacts(n);
    for (let k = 0; k < 20; k++) skin.update(cloth, out);
    const bind = skin.contactBinding(cloth);
    expect(bind.count).toBe(n);
    expect(bind.tri.length).toBe(n * 3);
    const T = tris(g), nV = g.getAttribute('position').count;
    const triSet = new Set<string>();
    for (let t = 0; t < T.length; t += 3) triSet.add([T[t], T[t + 1], T[t + 2]].join());
    for (let i = 0; i < n; i++) {
      // a real triangle of her, in its own corner order
      expect(triSet.has([bind.tri[i * 3], bind.tri[i * 3 + 1], bind.tri[i * 3 + 2]].join())).toBe(true);
      for (let k = 0; k < 3; k++) expect(bind.tri[i * 3 + k]).toBeLessThan(nV);
      const u = bind.bary[i * 3], v = bind.bary[i * 3 + 1], w = bind.bary[i * 3 + 2];
      expect(Math.min(u, v, w)).toBeGreaterThanOrEqual(0);
      expect(u + v + w).toBeCloseTo(1, 5);
      // the contact point this binding names is the one the update found
      const pos = g.getAttribute('position'), q = new THREE.Vector3();
      for (let k = 0; k < 3; k++) q.addScaledVector(new THREE.Vector3().fromBufferAttribute(pos, bind.tri[i * 3 + k]), bind.bary[i * 3 + k]);
      expect(toWorld(b, q.x, q.y, q.z).distanceTo(at(out.point, i))).toBeLessThan(1e-3);
      // 0.5 to 3 world units off a sphere of radius 100 world is 0.005 to 0.03 body-local (the room is 100 to the metre);
      // its flat faces lie up to about 0.008 inside the round sphere, so a particle is that much more off them
      expect(bind.offset[i]).toBeGreaterThan(0.004);
      expect(bind.offset[i]).toBeLessThan(0.04);
    }
  });

  it('a fresh ClothSkin over that binding lays every particle back where it lay, and carries it as she moves', () => {
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g, { blend: 0.6 }), n = 40;
    const skin = new ClothSkin(b.mesh, startBinding(g, n));
    const cloth = scatter(b, n, 5), out = createContacts(n);
    for (let k = 0; k < 20; k++) skin.update(cloth, out);
    const bind = skin.contactBinding(cloth);
    const again = new ClothSkin(b.mesh, bind), laid = again.initial(new Float32Array(n * 3));
    // A particle stands off its triangle along the face normal exactly when its nearest point is inside the face; when it
    // is on an edge or a corner, the binding keeps the contact point and the height along the normal, so it is laid a
    // little to the side of where it was (the faces turn about 11° from one to the next). Never far.
    let worst = 0, exact = 0;
    for (let i = 0; i < n; i++) {
      const d = at(laid, i).distanceTo(at(cloth, i));
      worst = Math.max(worst, d);
      if (d < 1e-3) exact++;
    }
    expect(worst).toBeLessThan(0.5);
    expect(exact).toBeGreaterThan(n / 4);

    // pose-free: bend her, and the laid particles go with her skin, still at their offsets off it
    b.upper.rotation.set(0.5, 0, 0); b.root.updateMatrixWorld(true);
    const bent = again.initial(new Float32Array(n * 3)), world = posedWorld(b.mesh), T = tris(g);
    let moved = 0, still = 0;
    for (let i = 0; i < n; i++) {
      const d = at(bent, i).distanceTo(at(laid, i));
      if (d > 1) moved++;
      // bound wholly below the blend (y < -0.6, the lower bone's alone): it did not move at all
      const low = [0, 1, 2].every((k) => new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), bind.tri[i * 3 + k]).y < -0.6);
      if (low) { expect(d).toBeLessThan(1e-3); still++; }
      // and it stands off her bent skin by about its bound height (world units: the offset × 100)
      const gap = bruteClosest(world, T, at(bent, i)).distanceTo(at(bent, i));
      expect(Math.abs(gap - bind.offset[i] * 100)).toBeLessThan(0.6);
    }
    expect(moved).toBeGreaterThan(5);
    expect(still).toBeGreaterThan(0);
  });

  it('a particle inside her skin is bound at minOffset, never below it; minOffset defaults to 0', () => {
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g), n = 3;
    const skin = new ClothSkin(b.mesh, startBinding(g, n));
    // two particles 2 world units INSIDE the sphere, one 2 outside
    const cloth = new Float32Array(n * 3);
    cloth.set(toWorld(b, 0.98, 0.1, 0.05).toArray(), 0);
    cloth.set(toWorld(b, 0.1, 0.05, 0.98).toArray(), 3);
    cloth.set(toWorld(b, 1.02 * 0.995, 1.02 * 0.0998, 0).toArray(), 6);
    const out = createContacts(n);
    for (let k = 0; k < 20; k++) skin.update(cloth, out);
    const plain = skin.contactBinding(cloth), floored = skin.contactBinding(cloth, 0.004);
    expect(plain.offset[0]).toBeGreaterThanOrEqual(0);
    expect(plain.offset[0]).toBeLessThan(1e-6);
    expect(plain.offset[1]).toBeLessThan(1e-6);
    expect(floored.offset[0]).toBeCloseTo(0.004, 6);
    expect(floored.offset[1]).toBeCloseTo(0.004, 6);
    // outside, it is its own height, the floor below it
    expect(plain.offset[2]).toBeGreaterThan(0.015);
    expect(floored.offset[2]).toBeCloseTo(plain.offset[2], 6);
    // the triangles and the places on them do not depend on the floor
    expect(Array.from(floored.tri)).toEqual(Array.from(plain.tri));
    expect(Array.from(floored.bary)).toEqual(Array.from(plain.bary));
  });

  it('is in slot order over the slots `setOrder` serves, and no longer than the cloth array holds', () => {
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g), n = 6;
    const skin = new ClothSkin(b.mesh, startBinding(g, n));
    const cloth = scatter(b, n, 3), out = createContacts(n);
    for (let k = 0; k < 20; k++) skin.update(cloth, out);
    const all = skin.contactBinding(cloth);
    // two slots, serving particles 4 and 1 from a two-particle cloth array
    skin.setOrder(Uint32Array.from([4, 1]));
    const sub = Float32Array.from([...cloth.subarray(12, 15), ...cloth.subarray(3, 6)]), out2 = createContacts(2);
    skin.update(sub, out2);
    const two = skin.contactBinding(sub);
    expect(two.count).toBe(2);
    expect(Array.from(two.tri.subarray(0, 3))).toEqual(Array.from(all.tri.subarray(12, 15)));
    expect(Array.from(two.tri.subarray(3, 6))).toEqual(Array.from(all.tri.subarray(3, 6)));
    expect(two.offset[0]).toBeCloseTo(all.offset[4], 5);
    expect(two.offset[1]).toBeCloseTo(all.offset[1], 5);
    // a cloth array of one particle gives a binding of one
    expect(skin.contactBinding(sub.subarray(0, 3)).count).toBe(1);
  });
});
