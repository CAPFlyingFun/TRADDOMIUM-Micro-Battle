/**
 * THE PROCEDURAL GARMENT AS CLOTH, ON HER (`garment/garmentCloth.ts`, Stage 2b): `weightless` (gravity off for the frame
 * and put back after it), `drawLift` (the drawn sheet lifted along its normals while the simulation is untouched), the
 * neckline held by `settle` (pin 1 within PIN_IN of the opening along the cloth, easing to 0 at PIN_OUT), the body
 * pieces (`trunkOnly`) pushed out of the arm capsules a frame is handed, and cloth a cut brings back (Stage 3) laid
 * level with the cloth round it -- moved as it has moved from where it is bound, and once settled bound there (the
 * unworn cloth bound at `settle` as the worn cloth round it moved), so a restart lays it there too.
 *
 * The body is a skinned open cylinder 15 cm round, standing upright in a room 100 units to the metre. The garment is a
 * sewn TUBE built here to the `SewnGarment` contract -- 24 particles round, ten rows, 2 cm off her -- with its top
 * opening named the neck and its bottom the hem, and its pattern lengths those it is laid at. It is bound to her by a
 * brute-force nearest-triangle search (not `bind.ts`): what is under test is the cloth, not the binding.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GarmentCloth, HUG_CLEARANCE, HUG_STRETCH, type GarmentClothOptions } from '../src/sarahlab/garment/garmentCloth';
import type { Capsules } from '../src/sarahlab/clothSim';
import type { ClothBinding } from '../src/sarahlab/clothTypes';
import type { SewnGarment } from '../src/sarahlab/garment/types';

const FRAME = 1 / 60;
/** garmentCloth.ts's neckline band, metres along the cloth (not exported): held fully within PIN_IN, nothing past PIN_OUT. */
const PIN_IN = 0.012, PIN_OUT = 0.03;

const AROUND = 24, R_BODY = 0.15, R_CLOTH = 0.17;
/** Row heights, metres, neck first: close together under the neck so the band's ramp has rows in it. */
const ROWS = [0.25, 0.24, 0.23, 0.21, 0.17, 0.12, 0.06, 0, -0.06, -0.12];

interface Body { root: THREE.Group; mesh: THREE.SkinnedMesh; upper: THREE.Bone }

/**
 * An upright skinned open cylinder (two bones, split at y = 0), scaled 100 to the metre; `groove` (metres) presses a
 * hollow that deep, 12 cm wide, down its front (+z), as the hollow between her breasts is.
 */
function cylinderBody(groove = 0): Body {
  const g = new THREE.CylinderGeometry(R_BODY, R_BODY, 0.8, groove > 0 ? 96 : 32, 16, true);
  const pos = g.getAttribute('position'), n = pos.count;
  if (groove > 0) {
    for (let v = 0; v < n; v++) {
      const x = pos.getX(v), z = pos.getZ(v), a = Math.atan2(x, z), w = Math.abs(a) < 0.4 ? 0.5 + 0.5 * Math.cos((Math.PI * a) / 0.4) : 0;
      const r = R_BODY - groove * w, k = r / Math.hypot(x, z);
      pos.setXYZ(v, x * k, pos.getY(v), z * k);
    }
    g.computeVertexNormals();
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const t = THREE.MathUtils.clamp((pos.getY(v) + 0.1) / 0.2, 0, 1);
    si[v * 4] = 0; si[v * 4 + 1] = 1; sw[v * 4] = 1 - t; sw[v * 4 + 1] = t;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.scale.setScalar(100);
  const lower = new THREE.Bone(), upper = new THREE.Bone();
  lower.add(upper);
  root.add(lower, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([lower, upper]));
  return { root, mesh, upper };
}

/** The tube's particles, body-local metres. */
function tubePoints(): Float32Array {
  const p = new Float32Array(ROWS.length * AROUND * 3);
  ROWS.forEach((y, r) => {
    for (let m = 0; m < AROUND; m++) {
      const th = (2 * Math.PI * m) / AROUND + 0.05;
      p.set([R_CLOTH * Math.sin(th), y, R_CLOTH * Math.cos(th)], (r * AROUND + m) * 3);
    }
  });
  return p;
}

/** The tube sewn: welded round its seam, its triangles facing out, its openings the neck (top) and the hem (bottom). */
function tube(points: Float32Array): SewnGarment {
  const count = ROWS.length * AROUND, id = (r: number, m: number) => r * AROUND + (m % AROUND);
  const tri: number[] = [];
  for (let r = 0; r < ROWS.length - 1; r++) for (let m = 0; m < AROUND; m++) {
    const a = id(r, m), b = id(r, m + 1), c = id(r + 1, m), d = id(r + 1, m + 1);
    tri.push(a, c, b, b, c, d);
  }
  // wind them outward: the first triangle's normal against its centroid's way out from the axis
  const P = (i: number) => new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
  const n = new THREE.Triangle(P(tri[0]), P(tri[1]), P(tri[2])).getNormal(new THREE.Vector3());
  const c0 = P(tri[0]).add(P(tri[1])).add(P(tri[2])).divideScalar(3).setY(0);
  if (n.dot(c0) < 0) for (let t = 0; t < tri.length; t += 3) { const s = tri[t + 1]; tri[t + 1] = tri[t + 2]; tri[t + 2] = s; }
  const triangles = Uint32Array.from(tri);
  const keys = new Set<number>(), edges: number[] = [];
  for (let t = 0; t < tri.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = tri[t + k], b = tri[t + (k + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b);
    if (!keys.has(lo * count + hi)) { keys.add(lo * count + hi); edges.push(lo, hi); }
  }
  const edgeRest = new Float32Array(edges.length / 2);
  for (let e = 0; e < edgeRest.length; e++) edgeRest[e] = P(edges[e * 2]).distanceTo(P(edges[e * 2 + 1]));
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { uv[i * 2] = (i % AROUND) / AROUND; uv[i * 2 + 1] = points[i * 3 + 1]; }
  const row = (r: number) => Uint32Array.from({ length: AROUND }, (_, m) => id(r, m));
  return {
    pieces: ['body'], count, particlePiece: new Uint16Array(count), onSeam: new Uint8Array(count),
    triangles, trianglePiece: new Uint16Array(triangles.length / 3), edges: Uint32Array.from(edges), edgeRest,
    vertexParticle: Uint32Array.from({ length: count }, (_, i) => i), vertexPiece: new Uint16Array(count), uv,
    renderTriangles: triangles.slice(),
    openings: [{ particles: row(0), edges: ['body:neck'] }, { particles: row(ROWS.length - 1), edges: ['body:hem'] }],
  };
}

/** Each particle bound to the nearest body triangle (brute force), at its barycentric place and its height off it. */
function bindTo(mesh: THREE.SkinnedMesh, points: Float32Array): ClothBinding {
  const g = mesh.geometry, pos = g.getAttribute('position'), T = Array.from(g.index!.array), n = points.length / 3;
  const tri = new Uint32Array(n * 3), bary = new Float32Array(n * 3), offset = new Float32Array(n);
  const V = (v: number) => new THREE.Vector3().fromBufferAttribute(pos, v), t3 = new THREE.Triangle(), q = new THREE.Vector3(), bc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = new THREE.Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
    let best = -1, bestD = Infinity;
    for (let t = 0; t < T.length; t += 3) {
      t3.set(V(T[t]), V(T[t + 1]), V(T[t + 2]));
      if (t3.getArea() < 1e-12) continue;
      t3.closestPointToPoint(p, q);
      const d = q.distanceToSquared(p);
      if (d < bestD) { bestD = d; best = t; }
    }
    t3.set(V(T[best]), V(T[best + 1]), V(T[best + 2]));
    t3.closestPointToPoint(p, q);
    t3.getBarycoord(q, bc);
    const nrm = t3.getNormal(new THREE.Vector3());
    tri.set([T[best], T[best + 1], T[best + 2]], i * 3);
    bary.set([bc.x, bc.y, bc.z], i * 3);
    offset[i] = Math.abs(p.clone().sub(q).dot(nrm));
  }
  return { count: n, tri, bary, offset };
}

interface Rig { body: Body; sewn: SewnGarment; binding: ClothBinding; points: Float32Array }
function rig(groove = 0): Rig {
  const body = cylinderBody(groove), points = tubePoints();
  return { body, sewn: tube(points), binding: bindTo(body.mesh, points), points };
}

function garment(r: Rig, extra?: Partial<GarmentClothOptions>): GarmentCloth {
  return new GarmentCloth({
    body: r.body.mesh, sewn: r.sewn, binding: r.binding, trunkOnly: new Uint8Array(r.sewn.count).fill(1), armBones: [],
    settings: { substeps: 4 }, standOff: 0.15, material: new THREE.MeshBasicMaterial(), unitsPerMetre: 100, ...extra,
  });
}

const meanY = (x: Float32Array, n: number) => { let s = 0; for (let i = 0; i < n; i++) s += x[i * 3 + 1]; return s / n; };
const rowOf = (i: number) => Math.floor(i / AROUND);
function allFinite(a: Float32Array): boolean { for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false; return true; }

describe('GarmentCloth on a synthetic sewn tube over a skinned cylinder', () => {
  it('lays every particle where it was bound, world units, and draws one vertex per pattern point', () => {
    const r = rig(), gc = garment(r);
    expect(gc.positions.length).toBe(r.sewn.count * 3);
    let worst = 0;
    for (let i = 0; i < r.sewn.count; i++) {
      const want = new THREE.Vector3(r.points[i * 3], r.points[i * 3 + 1], r.points[i * 3 + 2]).multiplyScalar(100);
      worst = Math.max(worst, want.distanceTo(new THREE.Vector3(gc.positions[i * 3], gc.positions[i * 3 + 1], gc.positions[i * 3 + 2])));
    }
    expect(worst).toBeLessThan(1e-3);
    expect(gc.mesh.geometry.getAttribute('position').count).toBe(r.sewn.vertexParticle.length);
    const s = gc.stats();
    expect(s.particles).toBe(r.sewn.count);
    expect(s.edges).toBe(r.sewn.edgeRest.length);
    // laid at its pattern lengths: no edge stretched or slack
    const st = gc.strain();
    expect(st.edges).toBe(r.sewn.edgeRest.length);
    expect(st.min * gc.simSettings.restScale).toBeCloseTo(1, 3);
    expect(st.max * gc.simSettings.restScale).toBeCloseTo(1, 3);
  });

  it('weightless: the frame steps with no gravity, and her gravity is put back after it', () => {
    const r = rig(), light = garment(r), heavy = garment(r), n = r.sewn.count;
    const g0 = light.simSettings.gravity, was = [...g0];
    const y0 = meanY(light.positions, n);
    light.weightless = true;
    for (let f = 0; f < 20; f++) {
      light.frame(FRAME);
      // the same array, the same values: nothing of the setting is lost
      expect(light.simSettings.gravity).toBe(g0);
      expect([...light.simSettings.gravity]).toEqual(was);
      heavy.frame(FRAME);
    }
    expect(was).toEqual([0, -981, 0]);
    const dropLight = meanY(light.positions, n) - y0, dropHeavy = meanY(heavy.positions, n) - y0;
    // weightless it only draws itself to its pattern (its bends resting flat ease the tube a hair): under a millimetre
    // in a third of a second, where her weight takes it down more than ten centimetres
    expect(Math.abs(dropLight)).toBeLessThan(0.2);
    expect(dropHeavy).toBeLessThan(-5);
    expect(allFinite(light.positions)).toBe(true);

    // and once it is off again, the next frames fall
    light.weightless = false;
    for (let f = 0; f < 10; f++) light.frame(FRAME);
    expect(meanY(light.positions, n) - y0).toBeLessThan(dropLight - 0.5);
  });

  it('drawLift moves the drawn sheet along its own unit normals by that much, and leaves the simulation as it was', () => {
    const r = rig(), plain = garment(r), lifted = garment(r, { drawLift: 0.5 });
    for (let f = 0; f < 6; f++) { plain.frame(FRAME); lifted.frame(FRAME); }
    // the simulation is the same, bit for bit
    expect(Array.from(lifted.positions)).toEqual(Array.from(plain.positions));
    const P0 = plain.mesh.geometry.getAttribute('position').array as Float32Array, N0 = plain.mesh.geometry.getAttribute('normal').array as Float32Array;
    const P1 = lifted.mesh.geometry.getAttribute('position').array as Float32Array, N1 = lifted.mesh.geometry.getAttribute('normal').array as Float32Array;
    expect(Array.from(N1)).toEqual(Array.from(N0));
    const vp = r.sewn.vertexParticle, x = lifted.positions;
    let outward = 0;
    for (let v = 0; v < vp.length; v++) {
      const q = vp[v] * 3, o = v * 3;
      const n = new THREE.Vector3(N1[o], N1[o + 1], N1[o + 2]);
      expect(n.length()).toBeCloseTo(1, 5);
      for (let k = 0; k < 3; k++) {
        expect(P0[o + k]).toBeCloseTo(x[q + k], 5); // no lift: drawn where it is
        expect(P1[o + k] - x[q + k]).toBeCloseTo(0.5 * N1[o + k], 5);
      }
      if (n.dot(new THREE.Vector3(x[q], 0, x[q + 2])) > 0) outward++;
    }
    // the tube faces out, so the lift is away from her
    expect(outward).toBe(vp.length);
  });

  it('settle holds the neckline band: pin 1 within PIN_IN of the opening along the cloth, easing to 0 at PIN_OUT', () => {
    const r = rig(), gc = garment(r), n = r.sewn.count;
    gc.weightless = true;
    for (let f = 0; f < 10; f++) gc.frame(FRAME);
    // before settle nothing is pinned
    const pinOf = () => (gc as unknown as { pin: Float32Array }).pin;
    expect(pinOf().every((p) => p === 0)).toBe(true);
    gc.settle();
    const pin = pinOf();
    expect(pin.length).toBe(n);
    for (let i = 0; i < n; i++) {
      const d = ROWS[0] - ROWS[rowOf(i)]; // the shortest way along the cloth to the neck is straight up its column
      const want = d <= PIN_IN ? 1 : d >= PIN_OUT ? 0 : 1 - (d - PIN_IN) / (PIN_OUT - PIN_IN);
      expect(pin[i]).toBeCloseTo(want, 3);
    }
    // the rows: 0 and 1 cm held, 2 cm at 5/9, 4 cm and beyond free
    expect(pin[0]).toBe(1);
    expect(pin[AROUND]).toBe(1);
    expect(pin[2 * AROUND]).toBeCloseTo(5 / 9, 3);
    expect(pin[3 * AROUND]).toBe(0);
    expect(pin[9 * AROUND]).toBe(0);
    // settling does not move the cloth
    expect(allFinite(gc.positions)).toBe(true);
  });

  it('after settle, with her weight back on it, the neck stays where it settled and the rest of the tube drops', () => {
    const r = rig(), gc = garment(r), free = garment(r), n = r.sewn.count;
    gc.weightless = true;
    for (let f = 0; f < 10; f++) gc.frame(FRAME);
    const settledAt = gc.positions.slice();
    gc.settle();
    expect(Array.from(gc.positions)).toEqual(Array.from(settledAt));
    gc.weightless = false;
    for (let f = 0; f < 30; f++) { gc.frame(FRAME); free.frame(FRAME); }
    let neckMove = 0, hemDrop = 0, freeNeckDrop = 0;
    for (let i = 0; i < n; i++) {
      const row = rowOf(i);
      if (row === 0) {
        neckMove = Math.max(neckMove, Math.hypot(gc.positions[i * 3] - settledAt[i * 3], gc.positions[i * 3 + 1] - settledAt[i * 3 + 1], gc.positions[i * 3 + 2] - settledAt[i * 3 + 2]));
        freeNeckDrop += (r.points[i * 3 + 1] * 100 - free.positions[i * 3 + 1]) / AROUND;
      }
      if (row === ROWS.length - 1) hemDrop += (settledAt[i * 3 + 1] - gc.positions[i * 3 + 1]) / AROUND;
    }
    // (0.6 mm here: the binding is taken against the skin contacts of the frame BEFORE the last step -- see the
    // known-bug test below -- and the weightless tube was still easing a hair when it settled)
    expect(neckMove).toBeLessThan(0.1);
    // the hem hangs off the held neck, so it can only go down as far as the fabric gives: it moved down, but by far
    // less than the unheld garment fell
    expect(hemDrop).toBeGreaterThan(0.2);
    expect(hemDrop).toBeLessThan(freeNeckDrop / 2);
    // an unsettled garment's neck is not held: it fell with the rest
    expect(freeNeckDrop).toBeGreaterThan(2);
  });

  it('pushes its body pieces (trunkOnly) out of the arm capsules a frame is handed, and only those', () => {
    // a capsule 3 units round standing up through the tube's wall at its +z side (the tube is 17 units round)
    const cap: Capsules = { count: 1, a: Float32Array.from([0, -20, 17]), b: Float32Array.from([0, 30, 17]), radius: Float32Array.from([3]) };
    const r = rig(), body = garment(r), sleeves = garment(r, { trunkOnly: new Uint8Array(r.sewn.count) });
    for (let f = 0; f < 5; f++) { body.frame(FRAME, cap); sleeves.frame(FRAME, cap); }
    expect(body.stats().capsuleContacts).toBeGreaterThan(0);
    expect(sleeves.stats().capsuleContacts).toBe(0);
    const toAxis = (x: Float32Array, i: number) => Math.hypot(x[i * 3], x[i * 3 + 2] - 17);
    let inside = 0;
    for (let i = 0; i < r.sewn.count; i++) {
      expect(toAxis(body.positions, i)).toBeGreaterThanOrEqual(3 - 1e-3);
      if (toAxis(sleeves.positions, i) < 2.9) inside++;
    }
    // the unmasked tube went straight through it
    expect(inside).toBeGreaterThan(0);
    // a frame with no capsules pushes nobody
    body.frame(FRAME);
    expect(body.stats().capsuleContacts).toBe(0);
  });

  // `settle` reads her skin under the particles as they lie now before binding them (it once bound with the contacts
  // of the frame before, and a garment settled while still sliding had its neck snapped back by that frame's slide).
  it('settled while still sliding, the neck is held where it settled, not where it was a frame before', () => {
    const r = rig(), gc = garment(r);
    for (let f = 0; f < 10; f++) gc.frame(FRAME); // falling, not yet settled
    const settledAt = gc.positions.slice();
    gc.settle();
    gc.weightless = true;
    gc.frame(FRAME);
    let worst = 0;
    for (let i = 0; i < AROUND; i++) worst = Math.max(worst, Math.abs(gc.positions[i * 3 + 1] - settledAt[i * 3 + 1]));
    expect(worst).toBeLessThan(0.1);
  });

  // Stage 3: a cut that brings cloth back after the garment has settled lays it as the cloth round it lies and binds it
  // there (`join`): laid and held where it was tailored, a band brought back met the settled cloth stretched and folded.
  it('cloth a cut brings back after settling is laid as the cloth round it lies, and bound to her there', () => {
    const r = rig(), n = r.sewn.count, KEPT = 5, SLID = 3;
    const cutAt = (rows: number) => ({ keep: Float32Array.from({ length: n }, (_, v) => (rowOf(v) < rows ? 1 : -1)), neck: new Float32Array(n).fill(Infinity) });
    const gc = garment(r, { cuts: cutAt(KEPT) });
    gc.weightless = true;
    for (let f = 0; f < 10; f++) gc.frame(FRAME);
    // the worn cloth slides SLID units down her and settles there; the rest keeps the binding it was tailored with
    const sim = (gc as unknown as { sim: { positions: Float32Array } }).sim, worn = gc.active;
    expect(worn).toBe((KEPT + 1) * AROUND);
    for (let i = 0; i < worn; i++) sim.positions[i * 3 + 1] -= SLID;
    gc.settle();
    const tailoredY = (i: number) => r.points[i * 3 + 1] * 100;
    // how far the worn cloth's last row now stands from where it was tailored: the slide, and the hair it eased
    let moved = 0;
    for (let i = KEPT * AROUND; i < (KEPT + 1) * AROUND; i++) moved += (gc.positions[i * 3 + 1] - tailoredY(i)) / AROUND;
    expect(Math.abs(moved + SLID)).toBeLessThan(0.3);
    // all of it worn again: the rows that come back start that far from where they were tailored, as the cloth above
    const before = gc.strain();
    gc.setCut(cutAt(ROWS.length));
    gc.layOut();
    expect(gc.active).toBe(n);
    let off = 0;
    for (let i = (KEPT + 1) * AROUND; i < n; i++) off = Math.max(off, Math.abs(gc.positions[i * 3 + 1] - (tailoredY(i) + moved)));
    expect(off).toBeLessThan(0.05);
    // nothing between the cloth that stayed and the cloth that came back stretched or squeezed (laid where they were
    // tailored, the rows that came back would have stood SLID over the row above them: half their length), and the
    // cloth as a whole no more strained than before
    const E = r.sewn.edges, P = gc.positions;
    let seam = 0;
    for (let e = 0; e < E.length; e += 2) {
      const a = E[e], b = E[e + 1];
      if (Math.min(rowOf(a), rowOf(b)) !== KEPT || Math.max(rowOf(a), rowOf(b)) !== KEPT + 1) continue;
      const len = Math.hypot(P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]) / (r.sewn.edgeRest[e / 2] * 100);
      seam = Math.max(seam, Math.abs(len - 1));
    }
    expect(seam).toBeLessThan(0.03);
    const st = gc.strain();
    expect(st.max).toBeLessThanOrEqual(before.max + 1e-6);
    expect(st.min).toBeGreaterThanOrEqual(before.min - 1e-6);
    // and bound where it came back: laid again where it is bound, it lands there, not where it was tailored
    gc.restart();
    off = 0;
    for (let i = (KEPT + 1) * AROUND; i < n; i++) off = Math.max(off, Math.abs(gc.positions[i * 3 + 1] - (tailoredY(i) + moved)));
    expect(off).toBeLessThan(0.05);
  });

  // Stage 3: a cut neckline is held to her skin (a hug) -- but not pulled down into a hollow it crosses (`easeHug`): held
  // to the skin under each particle, the edge across the hollow between her breasts was stretched into it in teeth.
  it('a cut neckline is held to her, and let off where it crosses a hollow it would have to stretch into', () => {
    const GROOVE = 0.04, r = rig(GROOVE), n = r.sewn.count;
    // all of it worn; the neckline cut along the top row (signed metres under it)
    const cuts = { keep: new Float32Array(n).fill(1), neck: Float32Array.from({ length: n }, (_, v) => ROWS[0] - ROWS[rowOf(v)]) };
    const gc = garment(r, { cuts });
    gc.weightless = true;
    for (let f = 0; f < 5; f++) gc.frame(FRAME);
    gc.settle();
    const hug = (gc as unknown as { hug: Float32Array | null }).hug;
    expect(hug).not.toBeNull();
    // the top row (held fully): round her, held at the hug's clearance; over the hollow's middle, let off well past it
    const close = HUG_CLEARANCE, angle = (i: number) => (2 * Math.PI * (i % AROUND)) / AROUND + 0.05;
    let away = 0, over = Infinity;
    for (let i = 0; i < AROUND; i++) {
      const a = Math.atan2(Math.sin(angle(i)), Math.cos(angle(i)));
      if (Math.abs(a) > 0.8) away = Math.max(away, Math.abs(hug![i] - close));
      if (Math.abs(a) < 0.15) over = Math.min(over, hug![i]);
    }
    expect(away).toBeLessThan(1e-6);
    expect(over).toBeGreaterThan(close + 0.01);
    // held where the hug puts it, no edge round the top row is longer than HUG_STRETCH of its length (and a hair)
    for (let f = 0; f < 3; f++) gc.frame(FRAME);
    const x = gc.positions, k = gc.simSettings.restScale;
    let worst = 0;
    for (let i = 0; i < AROUND; i++) {
      const j = (i + 1) % AROUND, d = Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]);
      const rest = Math.hypot(r.points[j * 3] - r.points[i * 3], r.points[j * 3 + 1] - r.points[i * 3 + 1], r.points[j * 3 + 2] - r.points[i * 3 + 2]) * 100 * k;
      worst = Math.max(worst, d / rest);
    }
    expect(worst).toBeLessThan(HUG_STRETCH + 0.02);
  });

  it('before it has settled, cloth a cut brings back is laid as the cloth round it lies and keeps the binding it was tailored with', () => {
    const r = rig(), n = r.sewn.count, KEPT = 5, SLID = 3;
    const cutAt = (rows: number) => ({ keep: Float32Array.from({ length: n }, (_, v) => (rowOf(v) < rows ? 1 : -1)), neck: new Float32Array(n).fill(Infinity) });
    const gc = garment(r, { cuts: cutAt(KEPT) });
    const sim = (gc as unknown as { sim: { positions: Float32Array } }).sim, worn = gc.active;
    for (let i = 0; i < worn; i++) sim.positions[i * 3 + 1] -= SLID;
    gc.setCut(cutAt(ROWS.length));
    gc.layOut();
    let off = 0;
    for (let i = (KEPT + 1) * AROUND; i < n; i++) off = Math.max(off, Math.abs(gc.positions[i * 3 + 1] - (r.points[i * 3 + 1] * 100 - SLID)));
    expect(off).toBeLessThan(0.05);
    gc.restart();
    off = 0;
    for (let i = 0; i < n; i++) off = Math.max(off, Math.abs(gc.positions[i * 3 + 1] - r.points[i * 3 + 1] * 100));
    expect(off).toBeLessThan(1e-3);
  });
});
