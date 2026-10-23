/**
 * WHERE A BUILT PIECE IS ON HER (Joshua, 2026-10-23: "snap points to her surface, then keep stable surface attachments
 * (no per-frame nearest-vertex search)"). On small skinned stand-ins for her body -- a sphere split along its seam like
 * her mesh is, and a box -- an anchor is re-made from its triangle as the bone and the morph move it; the closest-point
 * search agrees with a brute-force one and keeps to its reach; a strap walked between two points stays on the skin and
 * closes on its end; a mirrored point lands on the reflected one; and a tap finds the front surface under the finger,
 * zoomed in or not.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BodySurface, type SurfaceAnchor } from '../src/sarahlab/bodySurface';

/** A one-bone skinned mesh over `geometry`, every vertex on that bone, bound where `place` puts the mesh. */
function skinned(geometry: THREE.BufferGeometry, place?: (m: THREE.SkinnedMesh) => void) {
  const n = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) w[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  place?.(mesh);
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  return { mesh, bone };
}

function surfaceOf(geometry: THREE.BufferGeometry, place?: (m: THREE.SkinnedMesh) => void) {
  const { mesh, bone } = skinned(geometry, place);
  const triangles = Array.from(geometry.index!.array);
  const rest = Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
  return { mesh, bone, rest, triangles, surface: new BodySurface(mesh, triangles, rest) };
}

const corner = (rest: Float32Array, v: number) => new THREE.Vector3(rest[v * 3], rest[v * 3 + 1], rest[v * 3 + 2]);

/** The blend of a triangle's three rest corners, computed here independently. */
function blend(rest: Float32Array, triangles: number[], a: SurfaceAnchor): THREE.Vector3 {
  const [u, v, w] = a.bary;
  return corner(rest, triangles[a.tri * 3]).multiplyScalar(u)
    .add(corner(rest, triangles[a.tri * 3 + 1]).multiplyScalar(v))
    .add(corner(rest, triangles[a.tri * 3 + 2]).multiplyScalar(w));
}

/** The closest point of the rest surface to p over every triangle, with three's own triangle routine. */
function bruteClosest(rest: Float32Array, triangles: number[], p: THREE.Vector3): number {
  const t = new THREE.Triangle(), q = new THREE.Vector3();
  let best = Infinity;
  for (let i = 0; i < triangles.length; i += 3) {
    t.set(corner(rest, triangles[i]), corner(rest, triangles[i + 1]), corner(rest, triangles[i + 2]));
    if (t.getArea() === 0) continue;
    best = Math.min(best, t.closestPointToPoint(p, q).distanceTo(p));
  }
  return best;
}

/** A small deterministic random sequence, so a failure names the same points every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function someAnchors(count: number, triangleCount: number, seed = 7): SurfaceAnchor[] {
  const r = rng(seed), out: SurfaceAnchor[] = [];
  for (let i = 0; i < count; i++) {
    const u = r(), v = r() * (1 - u);
    out.push({ tri: Math.floor(r() * triangleCount), bary: [u, v, 1 - u - v] });
  }
  return out;
}

const expectClose = (a: THREE.Vector3, b: THREE.Vector3, tol: number) => expect(a.distanceTo(b)).toBeLessThan(tol);

describe('a surface anchor follows her', () => {
  it('sits at the blend of its rest corners in the bind pose, position and normal', () => {
    const { surface, rest, triangles } = surfaceOf(new THREE.SphereGeometry(1, 48, 32));
    const p = new THREE.Vector3(), n = new THREE.Vector3(), q = new THREE.Vector3();
    for (const a of someAnchors(200, surface.triangleCount)) {
      expect(surface.valid(a)).toBe(true);
      surface.evaluate(a, p, n);
      expectClose(p, blend(rest, triangles, a), 1e-6);
      expectClose(surface.restPoint(a, q), blend(rest, triangles, a), 1e-6);
      // the smoothed normal of a sphere points away from its middle
      expect(n.length()).toBeCloseTo(1, 6);
      expect(n.dot(p.clone().normalize())).toBeGreaterThan(0.995);
      // and the rest face normal is wound outward, as the mesh is
      expect(surface.restNormal(a, q).dot(p.clone().normalize())).toBeGreaterThan(0.99);
    }
  });

  it('moves and turns with the bone', () => {
    const { surface, bone, rest, triangles } = surfaceOf(new THREE.SphereGeometry(1, 48, 32));
    bone.position.set(0.5, -0.25, 2);
    bone.rotation.set(0.3, Math.PI / 2, -0.4);
    bone.updateMatrixWorld(true);
    const rot = new THREE.Matrix4().makeRotationFromEuler(bone.rotation);
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (const a of someAnchors(100, surface.triangleCount, 11)) {
      surface.evaluate(a, p, n);
      const expected = blend(rest, triangles, a).applyMatrix4(bone.matrix);
      expectClose(p, expected, 1e-5);
      // the normal turns with the bone and does not move with it
      const radial = blend(rest, triangles, a).normalize().applyMatrix4(rot);
      expect(n.dot(radial)).toBeGreaterThan(0.995);
    }
  });

  it('follows a morph target, at full and half influence', () => {
    const geometry = new THREE.SphereGeometry(1, 32, 24);
    const pos = geometry.getAttribute('position');
    const delta = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { delta[i * 3] = 0.25 * pos.getX(i); delta[i * 3 + 1] = 0.5 * pos.getY(i); delta[i * 3 + 2] = 0.25 * pos.getZ(i); }
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
    geometry.morphTargetsRelative = true;
    const { surface, mesh, rest, triangles } = surfaceOf(geometry);
    mesh.updateMorphTargets();
    const p = new THREE.Vector3();
    for (const influence of [1, 0.5]) {
      mesh.morphTargetInfluences![0] = influence;
      for (const a of someAnchors(50, surface.triangleCount, 3)) {
        const base = blend(rest, triangles, a);
        const expected = new THREE.Vector3(base.x * (1 + 0.25 * influence), base.y * (1 + 0.5 * influence), base.z * (1 + 0.25 * influence));
        expectClose(surface.evaluate(a, p), expected, 1e-6);
      }
    }
    // her rest shape is the approved one, whatever the sliders say
    const a = someAnchors(1, surface.triangleCount)[0];
    expectClose(surface.restPoint(a, p), blend(rest, triangles, a), 1e-6);
  });

  it('turns its normal with a morph\'s normals, as her shader does', () => {
    // a morph that tips every normal toward +y by the morph's influence (her belly's own morphs carry normals like this)
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    const nrm = geometry.getAttribute('normal');
    const delta = new Float32Array(nrm.count * 3), turn = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) turn[i * 3 + 1] = 2;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
    geometry.morphAttributes.normal = [new THREE.Float32BufferAttribute(turn, 3)];
    geometry.morphTargetsRelative = true;
    const { surface, mesh } = surfaceOf(geometry);
    mesh.updateMorphTargets();
    const p = new THREE.Vector3(), n0 = new THREE.Vector3(), n1 = new THREE.Vector3();
    for (const a of someAnchors(40, surface.triangleCount, 5)) {
      mesh.morphTargetInfluences![0] = 0; surface.evaluate(a, p, n0);
      mesh.morphTargetInfluences![0] = 1; surface.evaluate(a, p, n1);
      const expected = n0.clone().add(new THREE.Vector3(0, 2, 0)).normalize();
      expect(n1.dot(expected)).toBeGreaterThan(0.999);
    }
  });

  it('poses a vertex exactly as three does: two bones blended, a morph, bound off the origin', () => {
    const geometry = new THREE.SphereGeometry(1, 24, 16);
    const pos = geometry.getAttribute('position'), n = pos.count;
    const delta = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) delta[i * 3 + 1] = 0.3 * Math.max(0, pos.getY(i));
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
    geometry.morphTargetsRelative = true;
    // weights shared between two bones by height, and not summing to one, to read them exactly as three does
    const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const t = (pos.getY(i) + 1) / 2; index[i * 4 + 1] = 1; weight[i * 4] = 1 - t; weight[i * 4 + 1] = 0.9 * t; }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    mesh.position.set(0.4, -1, 0.2); mesh.rotation.set(0, 0.6, 0); mesh.scale.set(1.2, 0.8, 1);
    const root = new THREE.Bone(), tip = new THREE.Bone();
    tip.position.set(0, 1, 0); root.add(tip); mesh.add(root);
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([root, tip]));
    mesh.updateMorphTargets(); mesh.morphTargetInfluences![0] = 0.7;
    root.rotation.set(0.2, 0, -0.3); tip.rotation.set(0.5, 0.4, 0); tip.position.set(0.1, 1.2, 0);
    root.updateMatrixWorld(true);
    const triangles = Array.from(geometry.index!.array);
    const surface = new BodySurface(mesh, triangles, Float32Array.from(pos.array as ArrayLike<number>));
    const N = geometry.getAttribute('normal'), origin = new THREE.Vector3();
    const theirs = (v: number) => mesh.getVertexPosition(v, new THREE.Vector3());
    const theirNormal = (v: number) => mesh.applyBoneTransform(v, new THREE.Vector3(N.getX(v), N.getY(v), N.getZ(v))).sub(mesh.applyBoneTransform(v, origin.set(0, 0, 0))).normalize();
    const p = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let t = 0; t < surface.triangleCount; t += 7) {
      for (let k = 0; k < 3; k++) {
        const bary: [number, number, number] = [0, 0, 0];
        bary[k] = 1;
        const v = triangles[t * 3 + k];
        surface.evaluate({ tri: t, bary }, p, nrm);
        expectClose(p, theirs(v), 1e-5);
        expect(nrm.dot(theirNormal(v))).toBeGreaterThan(1 - 1e-6);
      }
    }
  });

  it('only names real triangles with finite weights, and reads awkward weights safely', () => {
    const { surface, rest, triangles } = surfaceOf(new THREE.BoxGeometry(2, 2, 2));
    expect(surface.valid({ tri: 0, bary: [1, 0, 0] })).toBe(true);
    expect(surface.valid({ tri: -1, bary: [1, 0, 0] })).toBe(false);
    expect(surface.valid({ tri: surface.triangleCount, bary: [1, 0, 0] })).toBe(false);
    expect(surface.valid({ tri: 0.5, bary: [1, 0, 0] })).toBe(false);
    expect(surface.valid({ tri: 0, bary: [NaN, 0, 1] })).toBe(false);
    expect(surface.valid({ tri: 0, bary: [Infinity, 0, 1] })).toBe(false);
    expect(surface.triangleCount).toBe(12);
    // negative weights are clamped and the rest renormalised: the point stays on her triangle
    const p = new THREE.Vector3();
    const t = 3, A = corner(rest, triangles[t * 3]), C = corner(rest, triangles[t * 3 + 2]);
    expectClose(surface.evaluate({ tri: t, bary: [2, -1, 2] }, p), A.clone().add(C).multiplyScalar(0.5), 1e-6);
    // nothing left at all: the middle of the triangle
    const mid = blend(rest, triangles, { tri: t, bary: [1 / 3, 1 / 3, 1 / 3] });
    expectClose(surface.evaluate({ tri: t, bary: [0, 0, 0] }, p), mid, 1e-6);
  });

  it('a triangle list with a corner past her vertices is not hers', () => {
    const { mesh, rest, triangles } = surfaceOf(new THREE.BoxGeometry(2, 2, 2));
    const surface = new BodySurface(mesh, [...triangles, 0, 1, 99999], rest);
    expect(surface.triangleCount).toBe(13);
    expect(surface.valid({ tri: 12, bary: [1, 0, 0] })).toBe(false);
    expect(surface.closestRest(new THREE.Vector3(0, 0, 5))).not.toBeNull();
  });
});

describe('the closest point of her rest shape', () => {
  it('agrees with a brute-force search over every triangle, near her, inside her and far off', () => {
    for (const geometry of [new THREE.SphereGeometry(1, 40, 30), new THREE.BoxGeometry(2, 1.4, 1, 3, 2, 2)]) {
      const { surface, rest, triangles } = surfaceOf(geometry);
      const r = rng(5), q = new THREE.Vector3();
      for (let i = 0; i < 150; i++) {
        const dir = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
        const p = dir.multiplyScalar([0.3, 0.9, 1.05, 1.6, 12][i % 5]);
        const a = surface.closestRest(p)!;
        expect(a).not.toBeNull();
        expect(surface.valid(a)).toBe(true);
        expect(a.bary[0] + a.bary[1] + a.bary[2]).toBeCloseTo(1, 9);
        for (const w of a.bary) expect(w).toBeGreaterThanOrEqual(0);
        expect(surface.restPoint(a, q).distanceTo(p)).toBeCloseTo(bruteClosest(rest, triangles, p), 5);
      }
    }
  });

  it('lands exactly on a flat face, and near the true sphere', () => {
    const box = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 4, 4, 4)).surface, q = new THREE.Vector3();
    expectClose(box.restPoint(box.closestRest(new THREE.Vector3(0.3, 0.2, 1.5))!, q), new THREE.Vector3(0.3, 0.2, 1), 1e-6);
    expectClose(box.restPoint(box.closestRest(new THREE.Vector3(0.3, -0.2, 0.9))!, q), new THREE.Vector3(0.3, -0.2, 1), 1e-6);
    const sphere = surfaceOf(new THREE.SphereGeometry(1, 64, 48)).surface;
    const p = new THREE.Vector3(0.4, 0.7, -0.9);
    expectClose(sphere.restPoint(sphere.closestRest(p)!, q), p.clone().normalize(), 0.01);
  });

  it('searches no further than it is asked to', () => {
    const { surface } = surfaceOf(new THREE.SphereGeometry(1, 40, 30));
    const p = new THREE.Vector3(0, 0, 1.5);
    expect(surface.closestRest(p, 0.3)).toBeNull();
    expect(surface.closestRest(p, 0.6)).not.toBeNull();
    expect(surface.closestRest(new THREE.Vector3(0, 0, 400), 10)).toBeNull();
    expect(surface.closestRest(new THREE.Vector3(0, 0, 400))).not.toBeNull();
    expect(surface.closestRest(new THREE.Vector3(NaN, 0, 0))).toBeNull();
  });
});

describe('a strap walked along her skin', () => {
  it('stays on the sphere, steps about `step` at a time and closes on its end', () => {
    const { surface } = surfaceOf(new THREE.SphereGeometry(1, 64, 48));
    const a = surface.closestRest(new THREE.Vector3(1, 0.1, 0))!, b = surface.closestRest(new THREE.Vector3(0, 0.3, 1))!;
    const step = 0.1, path = surface.pathBetween(a, b, step);
    const B = surface.restPoint(b, new THREE.Vector3()), q = new THREE.Vector3(), prev = surface.restPoint(a, new THREE.Vector3());
    expect(path.length).toBeGreaterThan(10);
    expect(path.length).toBeLessThan(20);
    let last = prev.distanceTo(B);
    for (const anchor of path) {
      surface.restPoint(anchor, q);
      expect(Math.abs(q.length() - 1)).toBeLessThan(0.005);
      const d = q.distanceTo(B);
      expect(d).toBeLessThan(last);
      expect(q.distanceTo(prev)).toBeLessThan(2 * step);
      last = d; prev.copy(q);
    }
    expect(last).toBeLessThanOrEqual(step + 1e-9);
  });

  it('goes round her rather than through her, even to the far side', () => {
    const { surface } = surfaceOf(new THREE.SphereGeometry(1, 64, 48));
    const a = surface.closestRest(new THREE.Vector3(0, 0, 1))!, b = surface.closestRest(new THREE.Vector3(0.05, 0.02, -1))!;
    const step = 0.08, path = surface.pathBetween(a, b, step);
    const B = surface.restPoint(b, new THREE.Vector3()), q = new THREE.Vector3();
    // half way round is pi long: about pi / step anchors, every one on the skin
    expect(path.length).toBeGreaterThan(30);
    for (const anchor of path) expect(Math.abs(surface.restPoint(anchor, q).length() - 1)).toBeLessThan(0.005);
    expect(surface.restPoint(path[path.length - 1], q).distanceTo(B)).toBeLessThanOrEqual(step + 1e-9);
  });

  it('turns a corner of the box along its faces', () => {
    const { surface } = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 4, 4, 4));
    const a = surface.closestRest(new THREE.Vector3(-0.5, 0.2, 1.2))!, b = surface.closestRest(new THREE.Vector3(1.2, -0.1, -0.6))!;
    const path = surface.pathBetween(a, b, 0.1), q = new THREE.Vector3();
    expect(path.length).toBeGreaterThan(15);
    for (const anchor of path) {
      surface.restPoint(anchor, q);
      expect(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z))).toBeCloseTo(1, 5);
    }
    expect(surface.restPoint(path[path.length - 1], q).distanceTo(surface.restPoint(b, new THREE.Vector3()))).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('arrives between any two points of the box that are not on opposite faces', () => {
    const { surface } = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 3, 3, 3));
    const r = rng(21), q = new THREE.Vector3(), A = new THREE.Vector3(), B = new THREE.Vector3();
    // the faces a point is on (two or three along an edge or at a corner), as axis * sign
    const faces = (p: THREE.Vector3) => [0, 1, 2].filter((k) => Math.abs(p.getComponent(k)) > 1 - 1e-6).map((k) => (k + 1) * Math.sign(p.getComponent(k)));
    let tried = 0;
    while (tried < 120) {
      const a = surface.closestRest(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(4))!;
      const b = surface.closestRest(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(4))!;
      surface.restPoint(a, A); surface.restPoint(b, B);
      if (faces(A).some((f) => faces(B).includes(-f))) continue;
      tried++;
      const path = surface.pathBetween(a, b, 0.1);
      const end = path.length ? surface.restPoint(path[path.length - 1], q) : A;
      expect(end.distanceTo(B)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('where a straight walk cannot get nearer (straight across from b on a flat face) it stops, still on the skin', () => {
    const { surface } = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 4, 4, 4));
    const a = surface.closestRest(new THREE.Vector3(0.5, 0.3, 1.2))!, b = surface.closestRest(new THREE.Vector3(0, 0, -1.2))!;
    const path = surface.pathBetween(a, b, 0.1), B = surface.restPoint(b, new THREE.Vector3()), q = new THREE.Vector3();
    const prev = surface.restPoint(a, new THREE.Vector3());
    let last = prev.distanceTo(B);
    // it walks to the middle of the near face, straight across from b, and stops there: no pile of anchors
    expect(path.length).toBeLessThan(10);
    for (const anchor of path) {
      const d = surface.restPoint(anchor, q).distanceTo(B);
      expect(d).toBeLessThan(last);
      expect(q.distanceTo(prev)).toBeGreaterThanOrEqual(0.025);
      expect(Math.max(Math.abs(q.x), Math.abs(q.y), Math.abs(q.z))).toBeCloseTo(1, 5);
      last = d; prev.copy(q);
    }
    expect(q.z).toBeCloseTo(1, 5);
  });

  it('is empty between two points closer than a step', () => {
    const { surface } = surfaceOf(new THREE.SphereGeometry(1, 32, 24));
    const a = surface.closestRest(new THREE.Vector3(0, 0, 1))!, b = surface.closestRest(new THREE.Vector3(0.05, 0, 1))!;
    expect(surface.pathBetween(a, b, 0.1)).toEqual([]);
    expect(surface.pathBetween(a, a, 0.1)).toEqual([]);
  });
});

describe('a point mirrored across her midline', () => {
  it('lands on the reflected point, about her own middle by default', () => {
    const q = new THREE.Vector3();
    const box = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 4, 4, 4)).surface;
    expectClose(box.restPoint(box.mirror(box.closestRest(new THREE.Vector3(0.6, 0.3, 1))!)!, q), new THREE.Vector3(-0.6, 0.3, 1), 1e-6);
    // standing off the origin, her middle is where she is, not where the origin is
    const shifted = new THREE.BoxGeometry(2, 2, 2, 4, 4, 4).translate(5, 0, 0);
    const moved = surfaceOf(shifted).surface;
    expectClose(moved.restPoint(moved.mirror(moved.closestRest(new THREE.Vector3(5.6, 0.3, 1))!)!, q), new THREE.Vector3(4.4, 0.3, 1), 1e-6);
    // and an explicit midline is used as given
    const sphere = surfaceOf(new THREE.SphereGeometry(1, 64, 48)).surface;
    const a = sphere.closestRest(new THREE.Vector3(0.5, 0.4, 0.75))!;
    const p = sphere.restPoint(a, new THREE.Vector3());
    expectClose(sphere.restPoint(sphere.mirror(a, 0)!, q), new THREE.Vector3(-p.x, p.y, p.z), 1e-5);
  });

  it('finds nothing when the reflection is beyond reach', () => {
    const box = surfaceOf(new THREE.BoxGeometry(2, 2, 2, 4, 4, 4)).surface;
    expect(box.mirror(box.closestRest(new THREE.Vector3(0.6, 0.3, 1))!, 10)).toBeNull();
  });
});

describe('a tap on her', () => {
  const W = 400, H = 300;
  /** The sphere at half size, two units along x, seen from five units in front. */
  function scene(segments: [number, number] = [64, 48]) {
    const s = surfaceOf(new THREE.SphereGeometry(1, ...segments), (m) => { m.position.set(2, 0, 0); m.scale.setScalar(0.5); });
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    camera.position.set(2, 0, 5); camera.lookAt(2, 0, 0);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    return { ...s, camera };
  }

  it('finds the front of her under the middle of the screen, and nothing off her', () => {
    const { surface, camera, mesh } = scene();
    expect(surface.pick(W / 2, H / 2)).toBeNull();
    surface.capture(camera, W, H);
    const hit = surface.pick(W / 2, H / 2)!;
    expect(hit).not.toBeNull();
    // local space: the front pole of the unit sphere, not the back one
    expectClose(hit.position, new THREE.Vector3(0, 0, 1), 0.01);
    expectClose(surface.evaluate(hit.anchor, new THREE.Vector3()), hit.position, 1e-5);
    expectClose(surface.restPoint(hit.anchor, new THREE.Vector3()), hit.position, 1e-5);
    // and it is under the finger: back on screen within a fraction of a pixel
    const s = hit.position.clone().applyMatrix4(mesh.matrixWorld).project(camera);
    expect(Math.abs((s.x * 0.5 + 0.5) * W - W / 2)).toBeLessThan(0.1);
    expect(Math.abs((0.5 - s.y * 0.5) * H - H / 2)).toBeLessThan(0.1);
    expect(surface.pick(5, 5)).toBeNull();
    expect(surface.pick(-500, -500)).toBeNull();
    surface.release();
    expect(surface.pick(W / 2, H / 2)).toBeNull();
  });

  it('just off her silhouette, takes the frontmost vertex within slop', () => {
    const { surface, camera, mesh, rest } = scene();
    surface.capture(camera, W, H);
    const v = new THREE.Vector3(), screen: { x: number; y: number; depth: number }[] = [];
    let right = -Infinity;
    for (let i = 0; i < rest.length / 3; i++) {
      v.copy(corner(rest, i)).applyMatrix4(mesh.matrixWorld).project(camera);
      const x = (v.x * 0.5 + 0.5) * W, y = (0.5 - v.y * 0.5) * H;
      screen.push({ x, y, depth: v.z });
      if (Math.abs(y - H / 2) < 1) right = Math.max(right, x);
    }
    // three pixels past her outline (a convex shape lies inside its vertices' outline), with eight pixels of slop
    const px = Math.max(...screen.map((s) => s.x)) + 3, py = H / 2, slop = 8;
    expect(px - right).toBeGreaterThanOrEqual(3);
    const hit = surface.pick(px, py, slop)!;
    expect(hit).not.toBeNull();
    expect([...hit.anchor.bary].sort()).toEqual([0, 0, 1]);
    const within = screen.map((s, i) => ({ ...s, i })).filter((s) => (s.x - px) ** 2 + (s.y - py) ** 2 <= slop * slop);
    const front = within.reduce((m, s) => (s.depth < m.depth ? s : m));
    expect(hit.position.distanceTo(corner(rest, front.i))).toBeLessThan(1e-6);
    expect(surface.pick(px, py, 1)).toBeNull();
  });

  it('zoomed in past every corner, still finds the triangle under the finger', () => {
    const geometry = new THREE.SphereGeometry(1, 8, 6);
    const { surface } = surfaceOf(geometry);
    const camera = new THREE.PerspectiveCamera(20, W / H, 0.1, 100);
    camera.position.set(0, 0, 3); camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    surface.capture(camera, W, H);
    const px = W / 2 + 60, py = H / 2 - 40;
    // no corner of her is anywhere near the finger
    const pos = geometry.getAttribute('position'), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).project(camera);
      if (v.z < -1 || v.z > 1) continue;
      expect(Math.hypot((v.x * 0.5 + 0.5) * W - px, (0.5 - v.y * 0.5) * H - py)).toBeGreaterThan(40);
    }
    const hit = surface.pick(px, py, 2)!;
    expect(hit).not.toBeNull();
    // three's own raycast against the same triangles agrees, front face first
    const plain = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    plain.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((px / W) * 2 - 1, 1 - (py / H) * 2), camera);
    const truth = ray.intersectObject(plain)[0];
    expectClose(hit.position, truth.point, 1e-5);
    expect(hit.position.z).toBeGreaterThan(0.5);
    expectClose(surface.evaluate(hit.anchor, new THREE.Vector3()), truth.point, 1e-5);
  });

  it('reads her as posed when the gesture began', () => {
    const { surface, camera, bone } = scene();
    // her bone has carried her a little to the right and up: the tap still lands on her front, in her own local space
    bone.position.set(0.3, 0.2, 0);
    bone.updateMatrixWorld(true);
    surface.capture(camera, W, H);
    const local = new THREE.Vector3(0.3, 0.2, 1);
    const world = local.clone().applyMatrix4(surface.mesh.matrixWorld).project(camera);
    const hit = surface.pick((world.x * 0.5 + 0.5) * W, (0.5 - world.y * 0.5) * H)!;
    expect(hit).not.toBeNull();
    expectClose(hit.position, local, 0.01);
    // the anchor names the same skin at rest: the front pole
    expectClose(surface.restPoint(hit.anchor, new THREE.Vector3()), new THREE.Vector3(0, 0, 1), 0.01);
  });
});

describe('the rest grid', () => {
  it('builds for about a hundred thousand triangles well under a second, and answers quickly', () => {
    const geometry = new THREE.SphereGeometry(1, 256, 200);
    const { mesh } = skinned(geometry);
    const triangles = geometry.index!.array, rest = Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
    const t0 = performance.now();
    const surface = new BodySurface(mesh, triangles, rest);
    const built = performance.now() - t0;
    expect(surface.triangleCount).toBeGreaterThan(100_000);
    expect(built).toBeLessThan(1000);
    const r = rng(9), p = new THREE.Vector3(), t1 = performance.now();
    for (let i = 0; i < 1000; i++) {
      p.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(0.9 + 0.2 * r());
      expect(surface.closestRest(p, 0.2)).not.toBeNull();
    }
    expect(performance.now() - t1).toBeLessThan(1000);
  });
});
