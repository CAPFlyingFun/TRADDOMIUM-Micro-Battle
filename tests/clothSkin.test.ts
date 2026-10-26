/**
 * HER SKIN UNDER THE CLOTH (Joshua, 2026-10-23: "make that one a true soft body/cloth with simulation over the whole
 * thing… it would naturally adjust and look better in the game"). On small skinned stand-ins for her body -- a sphere
 * and a box, both split along seams the way her mesh is, each with two bones and a relative morph target, under a room
 * that scales them 100 to the metre -- a particle starts on its bound skin point plus its offset; its contact is on the
 * posed skin with an outward unit normal; a bone and a morph carry the contacts; a particle moved several triangles away,
 * across a seam, is walked to the true nearest point (checked by brute force); its pin stays on its own triangle; last
 * frame's contact is carried with her when she moves (`carried`, what the cloth's friction holds to); and 6,000
 * particles on a 20,000-triangle body are timed. Then SLOTS (`setOrder`): particles served in another order, or only
 * some of them, give slot for slot exactly what each particle gives in its own slot, and a particle keeps its carried
 * contact when its slot changes or it leaves and comes back; and a pin held by the room's own offset (`pinOffset`).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ClothSkin, symmetricArms } from '../src/sarahlab/clothSkin';
import { createContacts, type ClothBinding, type SkinContacts } from '../src/sarahlab/clothTypes';

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

/**
 * Where a particle is laid and pinned since alpha.121: its bound skin point in her shape now (morphs, no bones), out by
 * its offset along her normal there, then skinned by its triangle's corners' bones blended by its barycentrics -- as a
 * garment's own vertex is skinned, worked here with three's own matrices.
 */
function expectedSkinnedPin(mesh: THREE.SkinnedMesh, b: ClothBinding, i: number): THREE.Vector3 {
  const g = mesh.geometry, pos = g.getAttribute('position'), morphs = g.morphAttributes.position ?? [], inf = mesh.morphTargetInfluences ?? [];
  const SI = g.getAttribute('skinIndex'), SW = g.getAttribute('skinWeight');
  const local = (v: number) => {
    const p = new THREE.Vector3().fromBufferAttribute(pos, v);
    morphs.forEach((m, k) => { if (inf[k]) p.addScaledVector(new THREE.Vector3().fromBufferAttribute(m as THREE.BufferAttribute, v), inf[k]); });
    return p;
  };
  const c = [0, 1, 2].map((k) => local(b.tri[i * 3 + k]));
  const n = new THREE.Vector3().subVectors(c[1], c[0]).cross(new THREE.Vector3().subVectors(c[2], c[0])).normalize();
  const p = new THREE.Vector3();
  for (let k = 0; k < 3; k++) p.addScaledVector(c[k], b.bary[i * 3 + k]);
  if (n.dot(p) < 0) n.negate(); // outward: the sphere's middle is her local origin
  p.addScaledVector(n, b.offset[i]);
  const bind = p.clone().applyMatrix4(mesh.bindMatrix), sum = new THREE.Vector3(), m = new THREE.Matrix4();
  for (let k = 0; k < 3; k++) {
    const v = b.tri[i * 3 + k], share = b.bary[i * 3 + k];
    for (let j = 0; j < 4; j++) {
      const w = SW.getComponent(v, j) * share;
      if (!w) continue;
      const bone = SI.getComponent(v, j);
      m.multiplyMatrices(mesh.skeleton.bones[bone].matrixWorld, mesh.skeleton.boneInverses[bone]);
      sum.addScaledVector(bind.clone().applyMatrix4(m), w);
    }
  }
  return sum.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
}

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
  it('starts each particle on its bound skin point plus its offset along the outward normal, skinned as a garment vertex is, whatever order the file names the corners in', () => {
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g), tris = triangles(g);
    expect(distinctPositions(g)).toBeLessThan(g.getAttribute('position').count); // the seam and the poles are split
    const picks = [
      { t: 40, bary: [0.2, 0.3, 0.5] as [number, number, number], offset: 0.004 },
      { t: 101, bary: [0.6, 0.2, 0.2] as [number, number, number], offset: 0.002, order: [1, 2, 0] as [number, number, number] },
      { t: 333, bary: [0.1, 0.1, 0.8] as [number, number, number], offset: 0.003, order: [1, 0, 2] as [number, number, number] },
      { t: 500, bary: [1 / 3, 1 / 3, 1 / 3] as [number, number, number], offset: 0 },
    ];
    const binding = bindingOf(tris, picks), skin = new ClothSkin(b.mesh, binding);
    const check = (posed: boolean) => {
      const world = posedWorld(b.mesh), out = skin.initial(new Float32Array(binding.count * 3));
      picks.forEach((p, i) => {
        // her own skinning carries the whole place, offset and all (alpha.121); unposed that is the posed skin point
        // out along the posed normal exactly, and posed it stays within a hair of it on a triangle this size
        expect(at(out, i).distanceTo(expectedSkinnedPin(b.mesh, binding, i))).toBeLessThan(1e-3);
        expect(at(out, i).distanceTo(expectedPin(world, tris, binding, i, p.t, 100))).toBeLessThan(posed ? 1 : 1e-3);
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
    check(false);
    // and posed: the upper bone bent and the morph half on
    b.upper.rotation.set(0.4, 0, 0.3); b.mesh.morphTargetInfluences![0] = 0.5; b.root.updateMatrixWorld(true);
    check(true);
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

  it('carries last frame\'s contact with her: moved rigidly, the spot of skin under each particle goes with her while the contact is the new nearest point', () => {
    // `carried` is what the cloth's friction holds to (Joshua, 2026-10-24, GRIP at its top tearing the tee): the spot of
    // her each particle touched last frame, posed as she stands now -- not the nearest point, which moves with the cloth
    const g = new THREE.SphereGeometry(1, 24, 16), b = body(g), tris = triangles(g), nT = tris.length / 3;
    let seed = 5;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const picks: { t: number; bary: [number, number, number]; offset: number }[] = [];
    for (let i = 0; i < 40; i++) { const u = rand(), v = rand() * (1 - u); picks.push({ t: Math.floor(rand() * nT), bary: [u, v, 1 - u - v], offset: 0.003 }); }
    const binding = bindingOf(tris, picks), skin = new ClothSkin(b.mesh, binding), c = createContacts(binding.count);
    const cloth = skin.initial(new Float32Array(binding.count * 3));
    // the cloth slid over her by up to `by` each way, and kept on the outside of her (a local walk finds the true nearest
    // point from outside a convex body; from inside one it can stop on a face with a nearer one beside it)
    const slide = (by: number) => {
      const centre = toWorld(b, 0, 0, 0), p = new THREE.Vector3();
      for (let i = 0; i < binding.count; i++) {
        p.set(cloth[i * 3] + (rand() - 0.5) * by, cloth[i * 3 + 1] + (rand() - 0.5) * by, cloth[i * 3 + 2] + (rand() - 0.5) * by);
        p.sub(centre).setLength(100.3).add(centre);
        cloth.set([p.x, p.y, p.z], i * 3);
      }
    };
    slide(3); // a centimetre or so off their bound places

    // the first update after `initial` has no last contact: nothing of her is carried
    skin.update(cloth, c);
    for (let i = 0; i < binding.count; i++) expect(at(c.carried, i).distanceTo(at(c.point, i))).toBe(0);
    const was = c.point.slice();

    // her room turns and moves -- a rigid motion of all of her, world to world -- and the cloth goes with her and on
    // over her, some particles a triangle or more
    const from = b.mesh.matrixWorld.clone();
    b.root.position.add(new THREE.Vector3(4, -2, 7)); b.root.rotation.y += 0.35; b.root.rotation.x -= 0.2; b.root.updateMatrixWorld(true);
    const rigid = b.mesh.matrixWorld.clone().multiply(from.invert());
    for (let i = 0; i < binding.count; i++) cloth.set(at(cloth, i).applyMatrix4(rigid).toArray(), i * 3);
    slide(12);
    skin.update(cloth, c);
    const world = posedWorld(b.mesh);
    let apart = 0, worst = 0;
    for (let i = 0; i < binding.count; i++) {
      const carried = at(c.carried, i), point = at(c.point, i);
      worst = Math.max(worst, carried.distanceTo(at(was, i).applyMatrix4(rigid)));
      expect(bruteClosest(world, tris, at(cloth, i)).distanceTo(point)).toBeLessThan(1e-3); // the new nearest point
      if (carried.distanceTo(point) > 1) apart++;
    }
    expect(worst).toBeLessThan(1e-4); // last frame's contact, moved as she moved
    expect(apart).toBeGreaterThan(binding.count / 2); // and the contact went with the cloth, not with her

    // a particle that blows up is given its bound place, and carries nothing; next time that place is what is carried
    const bad = cloth.slice(); bad[0] = Number.NaN;
    skin.update(bad, c);
    expect(at(c.carried, 0).distanceTo(at(c.point, 0))).toBe(0);
    const boundPlace = at(c.point, 0);
    skin.update(cloth, c);
    expect(at(c.carried, 0).distanceTo(boundPlace)).toBeLessThan(1e-4);
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

/** A sphere body and `count` particles bound at seeded random places on it, each a little off her. */
function particlesOn(seed: number, count = 40) {
  const g = new THREE.SphereGeometry(1, 24, 16), b = body(g), tris = triangles(g), nT = tris.length / 3;
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const picks: { t: number; bary: [number, number, number]; offset: number }[] = [];
  for (let i = 0; i < count; i++) { const u = rand(), v = rand() * (1 - u); picks.push({ t: Math.floor(rand() * nT), bary: [u, v, 1 - u - v], offset: 0.002 + rand() * 0.003 }); }
  return { b, tris, picks, binding: bindingOf(tris, picks), rand };
}

/** The cloth slid over her by up to `by` each way, and kept on the outside of her (as the carried test above does). */
function slideOver(b: Body, cloth: Float32Array, by: number, rand: () => number): void {
  const centre = toWorld(b, 0, 0, 0), p = new THREE.Vector3();
  for (let i = 0; i < cloth.length / 3; i++) {
    p.set(cloth[i * 3] + (rand() - 0.5) * by, cloth[i * 3 + 1] + (rand() - 0.5) * by, cloth[i * 3 + 2] + (rand() - 0.5) * by);
    p.sub(centre).setLength(100.3).add(centre);
    cloth.set([p.x, p.y, p.z], i * 3);
  }
}

/** A by-particle array laid out by slot: slot s holds particle order[s]'s `width` numbers. */
function bySlot(src: Float32Array, order: ArrayLike<number>, width: number): Float32Array {
  const out = new Float32Array(order.length * width);
  for (let s = 0; s < order.length; s++) for (let k = 0; k < width; k++) out[s * width + k] = src[order[s] * width + k];
  return out;
}

/** 0..n-1 in a seeded random order. */
function shuffled(n: number, rand: () => number): Uint32Array {
  const o = new Uint32Array(n);
  for (let i = 0; i < n; i++) o[i] = i;
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = o[i]; o[i] = o[j]; o[j] = t; }
  return o;
}

const FIELDS = [['point', 3], ['normal', 3], ['standOff', 1], ['pinTarget', 3], ['carried', 3]] as const;

/** Every field of `got`, slot for slot over `order`, is exactly what `ref` (every particle in its own slot) says. */
function expectSlots(got: SkinContacts, ref: SkinContacts, order: ArrayLike<number>): void {
  for (const [k, w] of FIELDS) expect(got[k].subarray(0, order.length * w), k).toEqual(bySlot(ref[k], order, w));
}

const SENTINEL = 12345;
function sentinelContacts(n: number): SkinContacts {
  const c = createContacts(n);
  for (const [k] of FIELDS) c[k].fill(SENTINEL);
  return c;
}

describe('ClothSkin: slots and particles (setOrder), and the pin\'s own offset (pinOffset)', () => {
  it('serves a permuted order slot for slot exactly as every particle in its own slot is served, at the start and over two updates', () => {
    const { b, binding, rand } = particlesOn(5), n = binding.count;
    const ref = new ClothSkin(b.mesh, binding), perm = new ClothSkin(b.mesh, binding), order = shuffled(n, rand);
    perm.setOrder(order);
    expect(perm.slots).toBe(n);
    expect(ref.slots).toBe(n);

    const start = ref.initial(new Float32Array(n * 3));
    expect(perm.initial(new Float32Array(n * 3))).toEqual(bySlot(start, order, 3));
    // the pattern is the whole garment's, in binding order, whatever the slots
    expect(perm.restShape(new Float32Array(n * 3))).toEqual(ref.restShape(new Float32Array(n * 3)));

    const cloth = start.slice(), rc = createContacts(n), pc = createContacts(n);
    slideOver(b, cloth, 3, rand);
    ref.update(cloth, rc); perm.update(bySlot(cloth, order, 3), pc);
    expectSlots(pc, rc, order);

    // she moves -- a bone bends, the morph comes half on -- and the cloth slides on over her: now `carried` is last
    // update's contact carried with her, which is the particle's, wherever its slot is
    b.upper.rotation.set(0.3, 0, 0.2); b.mesh.morphTargetInfluences![0] = 0.5; b.root.updateMatrixWorld(true);
    slideOver(b, cloth, 12, rand);
    ref.update(cloth, rc); perm.update(bySlot(cloth, order, 3), pc);
    expectSlots(pc, rc, order);
    let apart = 0;
    for (let s = 0; s < n; s++) if (at(pc.carried, s).distanceTo(at(pc.point, s)) > 1) apart++;
    expect(apart).toBeGreaterThan(n / 2);
  });

  it('serves only the particles a partial order names (a subset, not a prefix), from a cloth array that many slots long, and writes nothing past them', () => {
    const { b, binding, rand } = particlesOn(9), n = binding.count;
    const sub = Uint32Array.from([31, 4, 17, 9, 22, 0, 38]), m = sub.length;
    const ref = new ClothSkin(b.mesh, binding), part = new ClothSkin(b.mesh, binding);
    part.setOrder(sub);
    expect(part.slots).toBe(m);

    const start = ref.initial(new Float32Array(n * 3)), partStart = part.initial(new Float32Array(n * 3).fill(SENTINEL));
    expect(partStart.subarray(0, m * 3)).toEqual(bySlot(start, sub, 3));
    expect(partStart.subarray(m * 3).every(x => x === SENTINEL)).toBe(true);

    const cloth = start.slice(), rc = createContacts(n), pc = sentinelContacts(n);
    const untouchedPast = (c: SkinContacts, slots: number) => { for (const [k, w] of FIELDS) expect(c[k].subarray(slots * w).every(x => x === SENTINEL), k).toBe(true); };
    slideOver(b, cloth, 3, rand);
    ref.update(cloth, rc); part.update(bySlot(cloth, sub, 3), pc);
    expectSlots(pc, rc, sub); untouchedPast(pc, m);
    b.upper.rotation.set(-0.25, 0, 0.1); b.root.updateMatrixWorld(true);
    slideOver(b, cloth, 12, rand);
    ref.update(cloth, rc); part.update(bySlot(cloth, sub, 3), pc);
    expectSlots(pc, rc, sub); untouchedPast(pc, m);

    // a cloth array shorter than the order serves only the slots it has
    const few = sentinelContacts(n);
    part.update(bySlot(cloth, sub, 3).subarray(0, 9), few);
    untouchedPast(few, 3);
    expect(few.point.subarray(0, 9).every(x => x !== SENTINEL)).toBe(true);
  });

  it('carries a particle\'s last contact with it when its slot changes between updates, and when it leaves the slots and comes back', () => {
    const { b, binding, rand } = particlesOn(13), n = binding.count;
    // ref: every particle in its own slot throughout. moved: reordered for the second update. gap: only some served in
    // the second update. skip: sits the second update out altogether.
    const [ref, moved, gap, skip] = [0, 1, 2, 3].map(() => new ClothSkin(b.mesh, binding));
    const cloth = ref.initial(new Float32Array(n * 3));
    for (const s of [moved, gap, skip]) s.initial(new Float32Array(n * 3));
    const [rc, mc, gc, sc] = [0, 1, 2, 3].map(() => createContacts(n));
    const moveHer = () => { b.root.rotation.y += 0.2; b.upper.rotation.x += 0.15; b.root.updateMatrixWorld(true); slideOver(b, cloth, 12, rand); };

    slideOver(b, cloth, 3, rand);
    ref.update(cloth, rc); moved.update(cloth, mc); gap.update(cloth, gc); skip.update(cloth, sc);
    const own = Array.from({ length: n }, (_, i) => i);
    for (const c of [mc, gc, sc]) expectSlots(c, rc, own); // all four agree, every particle in its own slot

    moveHer();
    const order = shuffled(n, rand), some = Uint32Array.from(shuffled(n, rand).subarray(0, n / 2));
    moved.setOrder(order); gap.setOrder(some);
    ref.update(cloth, rc); moved.update(bySlot(cloth, order, 3), mc); gap.update(bySlot(cloth, some, 3), gc);
    // the particle's last contact followed it to its new slot: carried as she moved, not this update's point
    expectSlots(mc, rc, order);
    let apart = 0;
    for (let s = 0; s < n; s++) if (at(mc.carried, s).distanceTo(at(mc.point, s)) > 1) apart++;
    expect(apart).toBeGreaterThan(n / 2);

    // everyone back in their own slots: a particle `gap` served last time is where `ref` has it; one it left out still
    // carries its contact from the first update, exactly as `skip`'s every particle does
    moveHer();
    gap.setOrder(null);
    ref.update(cloth, rc); gap.update(cloth, gc); skip.update(cloth, sc);
    const served = new Set(some);
    let left = 0;
    for (let i = 0; i < n; i++) {
      const want = served.has(i) ? rc : sc;
      if (!served.has(i)) left++;
      for (const [k, w] of FIELDS) expect(gc[k].subarray(i * w, i * w + w), `${k} of particle ${i}`).toEqual(want[k].subarray(i * w, i * w + w));
    }
    expect(left).toBe(n / 2);
    // and the two histories really did differ: what a left-out particle carries is not what `ref`'s carries
    let differ = 0;
    for (let i = 0; i < n; i++) if (!served.has(i) && at(sc.carried, i).distanceTo(at(rc.carried, i)) > 1e-3) differ++;
    expect(differ).toBeGreaterThan(n / 4);
  });

  it('holds a pin by pinOffset in place of the binding\'s offset, along her normal at its bound triangle, skinned or not, and leaves standOff and the contact alone', () => {
    for (const skinned of [true, false]) {
      const g = new THREE.SphereGeometry(1, 24, 16), tris = triangles(g), nT = tris.length / 3;
      let mesh: THREE.SkinnedMesh;
      if (skinned) mesh = body(g).mesh;
      else {
        // no skin attributes and no skeleton: the unskinned reckoning, under the same room
        mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
        const root = new THREE.Group();
        root.position.set(12, -7, 3); root.rotation.set(0.3, 0.7, -0.2); root.scale.setScalar(100);
        root.add(mesh); root.updateMatrixWorld(true);
      }
      const world = skinned ? posedWorld(mesh) : Array.from({ length: g.getAttribute('position').count }, (_, v) => new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'), v).applyMatrix4(mesh.matrixWorld));
      const pins = [0, 0.001, 0.006, -0.001, 0.003, 0.01], picks = pins.map((_, i) => ({ t: (i * 53 + 17) % nT, bary: [0.2, 0.3, 0.5] as [number, number, number], offset: 0.003 }));
      const binding = bindingOf(tris, picks), n = binding.count;
      // a rest clearance above the thickness, so standOff is the offset's own (0.3) and would show pinOffset's
      const skin = new ClothSkin(mesh, binding, { thickness: 0.15, restClearance: 1 });
      const plain = skin.initial(new Float32Array(n * 3)), cloth = plain.slice(), c0 = createContacts(n);
      skin.update(cloth, c0);
      const pattern = skin.restShape(new Float32Array(n * 3));

      expect(() => { skin.pinOffset = new Float32Array(n - 1); }).toThrow(RangeError);
      expect(skin.pinOffset).toBeNull();
      skin.pinOffset = Float32Array.from(pins);
      const hug = skin.initial(new Float32Array(n * 3)), c1 = createContacts(n);
      skin.update(cloth, c1);
      const scale = skin.worldScale;
      expect(scale).toBeCloseTo(100, 4);
      for (let i = 0; i < n; i++) {
        const along = faceNormal(world, tris, picks[i].t).multiplyScalar((pins[i] - binding.offset[i]) * scale);
        expect(at(hug, i).distanceTo(at(plain, i).add(along)), `${skinned ? 'skinned' : 'unskinned'} start ${i}`).toBeLessThan(1e-4);
        expect(at(c1.pinTarget, i).distanceTo(at(c0.pinTarget, i).add(along)), `${skinned ? 'skinned' : 'unskinned'} pin ${i}`).toBeLessThan(1e-4);
        expect(c0.standOff[i]).toBeCloseTo(0.3, 5);
      }
      // the contact and its clearance are the made tee's, and so is the pattern
      expect(c1.standOff).toEqual(c0.standOff);
      expect(c1.point).toEqual(c0.point);
      expect(c1.normal).toEqual(c0.normal);
      expect(skin.restShape(new Float32Array(n * 3))).toEqual(pattern);

      skin.pinOffset = null;
      expect(skin.initial(new Float32Array(n * 3))).toEqual(plain);
      const c2 = createContacts(n);
      skin.update(cloth, c2);
      expect(c2.pinTarget).toEqual(c0.pinTarget);
    }
  });

  it('refuses an order naming a particle outside the binding or longer than it, keeping the order it had; null puts every particle back in its own slot', () => {
    const { b, binding, rand } = particlesOn(21), n = binding.count;
    const skin = new ClothSkin(b.mesh, binding), ref = new ClothSkin(b.mesh, binding);
    const start = ref.initial(new Float32Array(n * 3)), keep = Uint32Array.from([5, 3, 1]);
    skin.setOrder(keep);
    expect(() => skin.setOrder(Uint32Array.from([0, n]))).toThrow(RangeError);
    expect(() => skin.setOrder(new Uint32Array(n + 1))).toThrow(RangeError);
    expect(skin.slots).toBe(3);
    expect(skin.initial(new Float32Array(9))).toEqual(bySlot(start, [5, 3, 1], 3));
    // the order is copied: the caller's array is its own again
    keep[0] = 7;
    expect(skin.initial(new Float32Array(9))).toEqual(bySlot(start, [5, 3, 1], 3));

    skin.setOrder(null);
    expect(skin.slots).toBe(n);
    expect(skin.initial(new Float32Array(n * 3))).toEqual(start);
    const cloth = start.slice(), rc = createContacts(n), sc = createContacts(n);
    slideOver(b, cloth, 3, rand);
    ref.update(cloth, rc); skin.update(cloth, sc);
    for (const [k] of FIELDS) expect(sc[k], k).toEqual(rc[k]);

    // no slots at all is an order too: nothing is served and nothing is written
    skin.setOrder(new Uint32Array(0));
    expect(skin.slots).toBe(0);
    const none = sentinelContacts(n);
    skin.update(cloth, none);
    for (const [k] of FIELDS) expect(none[k].every(x => x === SENTINEL), k).toBe(true);
  });
});

describe('her arms, the same on both sides (symmetricArms)', () => {
  // her skin weights put skin behind her right armpit on the arm and the same skin on her left on her trunk: the tee's
  // particles there were SLEEVE on one side only (Joshua, 2026-10-25: "the only place messed up is the model's right arm area")
  const at = (pts: number[][]) => ({ count: pts.length, getX: (i: number) => pts[i][0], getY: (i: number) => pts[i][1], getZ: (i: number) => pts[i][2] });
  it('takes an arm vertex whose mirror image is trunk for trunk, and leaves a true arm alone', () => {
    // a body 1.7 tall, its middle at x 0: pairs at ±0.15 (one side arm, the other trunk), a pair both arm, a lone arm vertex
    const pts = [[0, 0, 0], [0, 1.7, 0], [-0.3, 1, 0], [0.3, 1, 0], [-0.15, 1.3, -0.1], [0.15, 1.3, -0.1], [-0.25, 1.1, 0], [0.25, 1.1, 0], [-0.2, 0.9, 0.05]];
    const arm = Uint8Array.from([0, 0, 0, 0, 1, 0, 1, 1, 1]);
    const made = symmetricArms(arm, at(pts));
    expect(made).toBe(1);
    expect([...arm]).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1]);
  });
  it('does not take a vertex whose mirror image is far off (her mesh is not quite symmetric, but within 2 cm)', () => {
    const pts = [[0, 0, 0], [0, 1.7, 0], [-0.3, 1, 0], [0.3, 1, 0], [-0.15, 1.3, -0.1], [0.15, 1.36, -0.1]];
    const arm = Uint8Array.from([0, 0, 0, 0, 1, 0]);
    expect(symmetricArms(arm, at(pts))).toBe(0);
    expect(arm[4]).toBe(1);
  });
});
