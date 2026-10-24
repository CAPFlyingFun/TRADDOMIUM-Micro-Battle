/**
 * HER SKIN UNDER THE CLOTH (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over the whole
 * thing… it would naturally adjust and look better in the game"). On small skinned stand-ins for her body -- a sphere
 * and a box, both split along seams the way her mesh is, each with two bones and a relative morph target, under a room
 * that scales them 100 to the metre -- a particle starts on its bound skin point plus its offset; its contact is on the
 * posed skin with an outward unit normal; a bone and a morph carry the contacts; a particle moved several triangles away,
 * across a seam, is walked to the true nearest point (checked by brute force); its pin stays on its own triangle; and
 * 6,000 particles on a 20,000-triangle body are timed.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ClothSkin } from '../src/sarahlab/clothSkin';
import { createContacts, type ClothBinding } from '../src/sarahlab/clothTypes';

interface Body { root: THREE.Group; mesh: THREE.SkinnedMesh; upper: THREE.Bone; geometry: THREE.BufferGeometry }

/**
 * A two-bone skinned body over `geometry`: the lower bone holds everything below `split - blend`, the upper bone (a
 * child pivoting at `pivot`) everything above `split + blend`, blended between. One relative morph target moves every
 * vertex by `morph`. The room holding it is scaled 100 to the metre, turned and moved, as the character room is.
 */
function body(geometry: THREE.BufferGeometry, { split = 0, blend = 0.2, pivot = new THREE.Vector3(0, 0.3, 0), morph = new THREE.Vector3(0.3, 0, 0), scale = 100 } = {}): Body {
  const pos = geometry.getAttribute('position'), n = pos.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), md = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const t = THREE.MathUtils.clamp((pos.getY(v) - (split - blend)) / (2 * blend), 0, 1);
    si[v * 4] = 0; si[v * 4 + 1] = 1; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t;
    md[v * 3] = morph.x; md[v * 3 + 1] = morph.y; md[v * 3 + 2] = morph.z;
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(md, 3)];
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.position.set(12, -7, 3); root.rotation.set(0.3, 0.7, -0.2); root.scale.setScalar(scale);
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

function triangles(g: THREE.BufferGeometry): number[] { return Array.from(g.index!.array); }

/** The nearest point of the whole posed surface to p, by trying every triangle. */
function bruteClosest(world: THREE.Vector3[], tris: number[], p: THREE.Vector3): THREE.Vector3 {
  const tri = new THREE.Triangle(), q = new THREE.Vector3(), best = new THREE.Vector3();
  let bestD = Infinity;
  for (let t = 0; t < tris.length; t += 3) {
    tri.set(world[tris[t]], world[tris[t + 1]], world[tris[t + 2]]);
    tri.closestPointToPoint(p, q);
    const d = q.distanceToSquared(p);
    if (d < bestD) { bestD = d; best.copy(q); }
  }
  return best;
}

/** Triangle t's outward unit normal from its own winding (three's sphere and box wind outward). */
function faceNormal(world: THREE.Vector3[], tris: number[], t: number): THREE.Vector3 {
  return new THREE.Triangle(world[tris[t * 3]], world[tris[t * 3 + 1]], world[tris[t * 3 + 2]]).getNormal(new THREE.Vector3());
}

/** A binding for particles on the given triangles, with the given bary and offset; `order` rotates or flips the triple. */
function bindingOf(tris: number[], picks: { t: number; bary: [number, number, number]; offset: number; order?: [number, number, number] }[]): ClothBinding {
  const n = picks.length, tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n);
  picks.forEach((p, i) => {
    const o = p.order ?? [0, 1, 2];
    for (let k = 0; k < 3; k++) { tri[i * 3 + k] = tris[p.t * 3 + o[k]]; bary[i * 3 + k] = p.bary[o[k]]; }
    offset[i] = p.offset;
  });
  return { count: n, tri, bary, offset };
}

/** Where a binding's particle i is expected to be pinned, computed here independently from three's posing. */
function expectedPin(world: THREE.Vector3[], tris: number[], b: ClothBinding, i: number, boundTri: number, scale: number): THREE.Vector3 {
  const p = new THREE.Vector3();
  for (let k = 0; k < 3; k++) p.addScaledVector(world[b.tri[i * 3 + k]], b.bary[i * 3 + k]);
  return p.addScaledVector(faceNormal(world, tris, boundTri), b.offset[i] * scale);
}

const at = (a: Float32Array, i: number) => new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

/** The triangle whose rest centroid is nearest `c`. */
function triangleNear(g: THREE.BufferGeometry, c: THREE.Vector3): number {
  const pos = g.getAttribute('position'), tris = triangles(g), m = new THREE.Vector3(), v = new THREE.Vector3();
  let best = -1, bestD = Infinity;
  for (let t = 0; t < tris.length / 3; t++) {
    m.set(0, 0, 0);
    for (let k = 0; k < 3; k++) m.add(v.fromBufferAttribute(pos, tris[t * 3 + k]));
    m.divideScalar(3);
    const d = m.distanceToSquared(c);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** How many distinct rest positions the geometry has (fewer than its vertices when it is split along seams). */
function distinctPositions(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute('position'), seen = new Set<string>();
  for (let v = 0; v < pos.count; v++) seen.add([pos.getX(v), pos.getY(v), pos.getZ(v)].map(x => x.toFixed(5)).join());
  return seen.size;
}

/** The world point of a body-local point, as her room places it (bones at rest). */
const toWorld = (b: Body, x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(b.mesh.matrixWorld);

describe('ClothSkin: her posed skin under every cloth particle', () => {
  it('starts each particle on its bound skin point plus its offset along the outward normal, whatever order the file names the corners in', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g), tris = triangles(g);
    expect(distinctPositions(g)).toBeLessThan(g.getAttribute('position').count); // the seam and the poles are split
    const picks = [
      { t: 40, bary: [0.2, 0.3, 0.5] as [number, number, number], offset: 0.004 },
      { t: 101, bary: [0.6, 0.2, 0.2] as [number, number, number], offset: 0.002, order: [1, 2, 0] as [number, number, number] },
      { t: 333, bary: [0.1, 0.1, 0.8] as [number, number, number], offset: 0.003, order: [1, 0, 2] as [number, number, number] },
      { t: 500, bary: [1 / 3, 1 / 3, 1 / 3] as [number, number, number], offset: 0 },
    ];
    const binding = bindingOf(tris, picks), skin = new ClothSkin(b.mesh, binding);
    const check = () => {
      const world = posedWorld(b.mesh), out = skin.initial(new Float32Array(binding.count * 3));
      picks.forEach((p, i) => {
        const want = expectedPin(world, tris, binding, i, p.t, 100);
        expect(at(out, i).distanceTo(want)).toBeLessThan(1e-3);
      });
      // the offset points out of her: each particle stands off its skin point away from the sphere's middle
      const centre = toWorld(b, 0, 0, 0);
      picks.forEach((p, i) => {
        if (p.offset === 0) return;
        const skinPoint = new THREE.Vector3();
        for (let k = 0; k < 3; k++) skinPoint.addScaledVector(world[binding.tri[i * 3 + k]], binding.bary[i * 3 + k]);
        expect(at(out, i).sub(skinPoint).dot(skinPoint.clone().sub(centre))).toBeGreaterThan(0);
      });
    };
    check();
    // and posed: the upper bone bent and the morph half on
    b.upper.rotation.set(0.4, 0, 0.3); b.mesh.morphTargetInfluences![0] = 0.5; b.root.updateMatrixWorld(true);
    check();
  });

  it('finds a seam-split triple by position when the file names a duplicate vertex rather than the triangle\'s own', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g), tris = triangles(g), pos = g.getAttribute('position');
    // a triangle touching the seam's u = 0 column, with that corner swapped for its u = 1 twin at the same place
    const W = 24 + 1;
    const t = tris.findIndex((_, k) => k % 3 === 0 && [tris[k], tris[k + 1], tris[k + 2]].some(x => x % W === 0 && Math.floor(x / W) === 8)) / 3;
    const corners = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    const swapped = corners.map(x => (x % W === 0 ? x + 24 : x));
    expect(swapped).not.toEqual(corners);
    for (let k = 0; k < 3; k++) expect(pos.getX(swapped[k])).toBeCloseTo(pos.getX(corners[k]), 6);
    const binding: ClothBinding = { count: 1, tri: Uint32Array.from(swapped), bary: Float32Array.from([0.3, 0.3, 0.4]), offset: Float32Array.from([0.005]) };
    const skin = new ClothSkin(b.mesh, binding), out = skin.initial(new Float32Array(3));
    const world = posedWorld(b.mesh), want = expectedPin(world, tris, binding, 0, t, 100);
    expect(at(out, 0).distanceTo(want)).toBeLessThan(1e-3);
  });

  it('puts every contact on the posed skin with a unit outward normal, and moves them with a bone and with a morph', () => {
    // the upper bone pivots at the middle and blends in over most of the sphere, so a bend turns its top over itself and
    // no triangle folds inside out (a narrow blend under a big bend does fold, and its triangles then truly face in)
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g, { pivot: new THREE.Vector3(0, 0, 0), blend: 0.6 }), tris = triangles(g);
    const nT = tris.length / 3, picks: { t: number; bary: [number, number, number]; offset: number }[] = [];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 60; i++) { const u = rand(), v = rand() * (1 - u); picks.push({ t: Math.floor(rand() * nT), bary: [u, v, 1 - u - v], offset: 0.003 + rand() * 0.004 }); }
    const binding = bindingOf(tris, picks), skin = new ClothSkin(b.mesh, binding, { thickness: 0.2 }), contacts = createContacts(binding.count);

    const run = () => {
      const cloth = skin.initial(new Float32Array(binding.count * 3));
      for (let k = 0; k < 3; k++) skin.update(cloth, contacts);
      const world = posedWorld(b.mesh), centre = toWorld(b, 0, 0, 0);
      for (let i = 0; i < binding.count; i++) {
        const p = at(contacts.point, i), n = at(contacts.normal, i);
        expect(bruteClosest(world, tris, p).distanceTo(p)).toBeLessThan(1e-3); // on her skin
        expect(bruteClosest(world, tris, at(cloth, i)).distanceTo(p)).toBeLessThan(1e-3); // and the nearest of it
        expect(n.length()).toBeCloseTo(1, 5);
        expect(n.dot(p.clone().sub(centre))).toBeGreaterThan(0);
        expect(contacts.standOff[i]).toBeCloseTo(0.2, 6);
      }
      return { cloth: cloth.slice(), point: contacts.point.slice(), pin: contacts.pinTarget.slice() };
    };

    const rest = run();
    // a bone: the upper half turns, so its contacts and pins move and the lower half's stay put
    b.upper.rotation.set(0.3, 0, 0); b.root.updateMatrixWorld(true);
    const bent = run();
    let movedUp = 0, movedLow = 0;
    for (let i = 0; i < binding.count; i++) {
      const y = new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), binding.tri[i * 3]).y;
      const moved = at(bent.pin, i).distanceTo(at(rest.pin, i));
      if (y > 0.7) { expect(moved).toBeGreaterThan(1); movedUp++; }
      if (y < -0.7) { expect(moved).toBeLessThan(1e-3); movedLow++; }
    }
    expect(movedUp).toBeGreaterThan(3); expect(movedLow).toBeGreaterThan(3);

    // a morph at 1: every vertex moves by its offset, so every pin and every contact moves by it, turned into the room
    b.upper.rotation.set(0, 0, 0); b.root.updateMatrixWorld(true);
    const shift = new THREE.Vector3(0.3, 0, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(b.mesh.matrixWorld));
    b.mesh.morphTargetInfluences![0] = 1;
    const cloth = rest.cloth.slice();
    for (let i = 0; i < binding.count; i++) { cloth[i * 3] += shift.x; cloth[i * 3 + 1] += shift.y; cloth[i * 3 + 2] += shift.z; }
    skin.update(cloth, contacts);
    for (let i = 0; i < binding.count; i++) {
      expect(at(contacts.pinTarget, i).distanceTo(at(rest.pin, i).add(shift))).toBeLessThan(1e-3);
      expect(at(contacts.point, i).distanceTo(at(rest.point, i).add(shift))).toBeLessThan(1e-3);
    }
  });

  it('walks a particle several triangles round a box, across the seams between its faces, to the true nearest point', () => {
    const g = new THREE.BoxGeometry(2, 2, 2, 6, 6, 6), b = body(g), tris = triangles(g);
    expect(distinctPositions(g)).toBeLessThan(g.getAttribute('position').count); // every face is its own piece
    const start = triangleNear(g, new THREE.Vector3(1, 0.05, -0.1));
    const binding = bindingOf(tris, [{ t: start, bary: [1 / 3, 1 / 3, 1 / 3], offset: 0.001 }]);
    const world = posedWorld(b.mesh);

    // the far side of the +z face, round the corner from +x: two faces and a dozen triangles away
    const target = toWorld(b, -0.4, 0.2, 1.12), want = bruteClosest(world, tris, target);
    const far = new ClothSkin(b.mesh, binding, { maxWalk: 64 }), c1 = createContacts(1);
    far.update(new Float32Array([target.x, target.y, target.z]), c1);
    expect(at(c1.point, 0).distanceTo(want)).toBeLessThan(1e-3);

    // at the default eight steps an update, it gets there over a few frames
    const skin = new ClothSkin(b.mesh, binding), c = createContacts(1), cloth = new Float32Array([target.x, target.y, target.z]);
    skin.update(cloth, c);
    const first = at(c.point, 0).distanceTo(want);
    for (let k = 0; k < 3; k++) skin.update(cloth, c);
    expect(at(c.point, 0).distanceTo(want)).toBeLessThan(1e-3);
    expect(first).toBeGreaterThan(1e-3); // eight steps were not enough on the first frame: the walk is bounded
    // the normal is the +z face's, turned into the room
    const nz = new THREE.Vector3(0, 0, 1).transformDirection(b.mesh.matrixWorld);
    expect(at(c.normal, 0).dot(nz)).toBeGreaterThan(0.999);

    // and across the sphere's u = 0 seam, posed
    const s = new THREE.SphereGeometry(1, 32, 16), sb = body(s), st = triangles(s);
    sb.upper.rotation.set(0.2, 0, 0.1); sb.root.updateMatrixWorld(true);
    // three's sphere: x = -cos(phi) sin(theta), z = sin(phi) sin(theta); the seam is phi = 0, at x = -1
    const sphere = (phi: number, r = 1) => new THREE.Vector3(-Math.cos(phi) * r, 0.05, Math.sin(phi) * r);
    const from = triangleNear(s, sphere(0.35)), sbind = bindingOf(st, [{ t: from, bary: [0.3, 0.3, 0.4], offset: 0.002 }]);
    const sskin = new ClothSkin(sb.mesh, sbind), sc = createContacts(1);
    const p = toWorld(sb, ...sphere(-0.6, 1.05).toArray() as [number, number, number]), pw = new Float32Array([p.x, p.y, p.z]);
    for (let k = 0; k < 4; k++) sskin.update(pw, sc);
    expect(at(sc.point, 0).distanceTo(bruteClosest(posedWorld(sb.mesh), st, p))).toBeLessThan(1e-3);
  });

  it('keeps every pin on its own bound triangle however far the particle wanders', () => {
    const g = new THREE.SphereGeometry(1, 32, 20), b = body(g), tris = triangles(g);
    const t = triangleNear(g, new THREE.Vector3(0.7, 0.4, 0.5));
    const binding = bindingOf(tris, [{ t, bary: [0.5, 0.25, 0.25], offset: 0.004 }]), skin = new ClothSkin(b.mesh, binding), c = createContacts(1);
    b.upper.rotation.set(0.3, 0.2, 0); b.root.updateMatrixWorld(true);
    // flung to the other side of her and walked there over several frames
    const away = toWorld(b, -0.7, -0.4, -0.5), cloth = new Float32Array([away.x, away.y, away.z]);
    for (let k = 0; k < 20; k++) skin.update(cloth, c);
    const world = posedWorld(b.mesh), pin = expectedPin(world, tris, binding, 0, t, 100);
    expect(at(c.pinTarget, 0).distanceTo(pin)).toBeLessThan(1e-3);
    expect(at(c.point, 0).distanceTo(pin)).toBeGreaterThan(100); // the contact went with the particle; the pin did not
    // a particle that has blown up is given its own bound place as its floor
    skin.update(new Float32Array([NaN, 0, 0]), c);
    expect(at(c.point, 0).distanceTo(pin)).toBeLessThan(1); // the skin point, under the offset pin
    expect(Number.isFinite(c.normal[0])).toBe(true);
  });

  it('serves 6,000 particles on a 20,000-triangle body each frame', () => {
    // her triangles are about 4.5 mm across; at 0.1 m round and 128 x 80 this sphere's are about the same, so a frame's
    // cloth motion costs the same number of steps here as on her
    const g = new THREE.SphereGeometry(0.1, 128, 80), b = body(g, { split: 0, blend: 0.02, pivot: new THREE.Vector3(0, 0.03, 0), morph: new THREE.Vector3(0.002, 0, 0) });
    const tris = triangles(g), nT = tris.length / 3;
    expect(nT).toBeGreaterThan(20000);
    const n = 6000, tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n);
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const t = Math.floor(rand() * nT), u = rand(), v = rand() * (1 - u);
      tri.set([tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]], i * 3); bary.set([u, v, 1 - u - v], i * 3); offset[i] = 0.002;
    }
    const built = performance.now();
    const skin = new ClothSkin(b.mesh, { count: n, tri, bary, offset }), contacts = createContacts(n);
    const buildMs = performance.now() - built;
    const cloth = skin.initial(new Float32Array(n * 3));
    b.mesh.morphTargetInfluences![0] = 0.5;
    const frames = 60;
    let total = 0, posed = 0;
    for (let f = 0; f < frames; f++) {
      b.upper.rotation.set(0.3 * Math.sin(f / 10), 0, 0.1 * Math.cos(f / 7)); b.root.updateMatrixWorld(true);
      for (let i = 0; i < n * 3; i++) cloth[i] += (rand() - 0.5) * 0.3; // a few millimetres of cloth motion a frame
      const ms = skin.update(cloth, contacts);
      if (f >= 5) { total += ms; posed += skin.posed; }
    }
    const mean = total / (frames - 5);
    console.log(`ClothSkin: ${n} particles on ${nT} triangles: ${mean.toFixed(2)} ms an update, ${Math.round(posed / (frames - 5))} vertices posed, built in ${buildMs.toFixed(1)} ms`);
    expect(mean).toBeLessThan(50);
    expect(skin.posed).toBeGreaterThan(0);
    for (let i = 0; i < n * 3; i++) expect(Number.isFinite(contacts.point[i]) && Number.isFinite(contacts.normal[i])).toBe(true);
  });

  it('builds over a body her size in reasonable time', () => {
    const g = new THREE.SphereGeometry(1, 400, 288), b = body(g);
    expect(g.getAttribute('position').count).toBeGreaterThan(115000);
    const tris = triangles(g), binding = bindingOf(tris, [{ t: 1000, bary: [0.2, 0.3, 0.5], offset: 0.001 }]);
    const t0 = performance.now(), skin = new ClothSkin(b.mesh, binding), ms = performance.now() - t0;
    console.log(`ClothSkin: built over ${g.getAttribute('position').count} vertices / ${tris.length / 3} triangles in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(10000);
    expect(skin.initial(new Float32Array(3)).every(Number.isFinite)).toBe(true);
  });
});
