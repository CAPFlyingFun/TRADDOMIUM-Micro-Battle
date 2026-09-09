/**
 * The surface frame (`creatures/surface.ts`): a heading on a face means
 * ONE thing to every reader, the flat case is the old convention to the
 * bit, an edge carries the frame by one rotation, and the face under
 * the feet is found exactly.
 *
 * The step, the aim, the flier's floor and the way round are Creature
 * Lab D's leaf and are tested where they are built.
 */
import { describe, expect, it } from 'vitest';
import { ahead, wrapHeading } from '../src/creatures/heading';
import {
  FACE_NORMALS, WORLD_UP, aheadOn, cross, dot, faceUnder, faceWord, headingOn, rightOn, rotateBetween, signedAngleAbout, tangentOf,
  vec3, type Climbable, type MutableVec3, type Vec3,
} from '../src/creatures/surface';
import { world } from '../src/world/coords';

const X: Vec3 = FACE_NORMALS[0];
const NX: Vec3 = FACE_NORMALS[1];
const Y: Vec3 = FACE_NORMALS[2];
const NY: Vec3 = FACE_NORMALS[3];
const Z: Vec3 = FACE_NORMALS[4];
const NZ: Vec3 = FACE_NORMALS[5];

function v(): MutableVec3 {
  return { x: 0, y: 0, z: 0 };
}

function near(a: Vec3, b: Vec3, digits = 12): void {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
  expect(a.z).toBeCloseTo(b.z, digits);
}

const HEADINGS = [0, 0.3, -1.1, Math.PI / 2, -Math.PI / 2, 2.9, Math.PI, -2.2];

describe('the flat case is the actor convention to the bit', () => {
  it('aheadOn(WORLD_UP, h) is (sin h, 0, cos h) exactly, and rightOn is (−cos h, 0, sin h)', () => {
    for (const h of HEADINGS) {
      const a = aheadOn(WORLD_UP, h, v());
      expect(a.x).toBe(Math.sin(h));
      expect(a.y).toBe(0);
      expect(a.z).toBe(Math.cos(h));
      const step = ahead(world(10, 20), h, 3);
      expect(step.wx).toBe(10 + a.x * 3);
      expect(step.wz).toBe(20 + a.z * 3);
      const r = rightOn(WORLD_UP, a, v());
      near(r, vec3(-Math.cos(h), 0, Math.sin(h)));
    }
  });

  it('headingOn inverts aheadOn on every face, and reads a non-tangent direction by its tangent part', () => {
    for (const up of FACE_NORMALS) {
      for (const h of HEADINGS) {
        const a = aheadOn(up, h, v());
        expect(wrapHeading(headingOn(up, a) - h)).toBeCloseTo(0, 12);
        // Push it off the face: the answer is the same.
        const off = vec3(a.x + up.x * 0.7, a.y + up.y * 0.7, a.z + up.z * 0.7);
        expect(wrapHeading(headingOn(up, off) - h)).toBeCloseTo(0, 12);
      }
    }
    expect(headingOn(WORLD_UP, WORLD_UP)).toBe(0);
    expect(headingOn(WORLD_UP, vec3(0, 0, 0))).toBe(0);
  });

  it('signedAngleAbout on the ground is wrapHeading(bearing − heading)', () => {
    for (const h of HEADINGS) {
      for (const b of HEADINGS) {
        const from = aheadOn(WORLD_UP, h, v());
        const to = aheadOn(WORLD_UP, b, v());
        // Compared as a wrapped difference: at exactly half a turn both ±π name the same turn.
        expect(wrapHeading(signedAngleAbout(WORLD_UP, from, to) - wrapHeading(b - h))).toBeCloseTo(0, 10);
      }
    }
  });
});

describe('a heading on a face', () => {
  it('ahead is a unit tangent of the face, and a growing heading turns it about the face\'s up (a left turn everywhere)', () => {
    for (const up of FACE_NORMALS) {
      for (const h of HEADINGS) {
        const a = aheadOn(up, h, v());
        expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 12);
        expect(dot(a, up)).toBeCloseTo(0, 12);
        // d(ahead)/dh = up × ahead: the body turns left about its own feet.
        const d = 1e-6;
        const b = aheadOn(up, h + d, v());
        const rate = vec3((b.x - a.x) / d, (b.y - a.y) / d, (b.z - a.z) / d);
        near(rate, cross(up, a, v()), 5);
      }
    }
  });

  it('the ceiling\'s frame is the fixed half turn about +x: ahead(−y, h) = (sin h, 0, −cos h)', () => {
    for (const h of HEADINGS) near(aheadOn(NY, h, v()), vec3(Math.sin(h), 0, -Math.cos(h)));
  });

  it('a wall\'s frame carries +z along the wall and turns +x into the vertical', () => {
    // R(+y → +x) is a quarter turn about z: (x, y, z) → (y, −x, z).
    near(aheadOn(X, 0, v()), Z);
    near(aheadOn(X, Math.PI / 2, v()), NY);
    near(aheadOn(NX, Math.PI / 2, v()), Y);
    near(aheadOn(Z, 0, v()), NY);
    near(aheadOn(NZ, 0, v()), Y);
  });
});

describe('rotateBetween', () => {
  it('is the identity for coincident directions and takes from to to', () => {
    for (const from of FACE_NORMALS) {
      near(rotateBetween(from, from, vec3(0.3, -0.5, 0.8), v()), vec3(0.3, -0.5, 0.8));
      for (const to of FACE_NORMALS) near(rotateBetween(from, to, from, v()), to);
    }
  });

  it('carries the frame round an edge with one rotation, convex and concave alike', () => {
    // Walking east off the top: ahead +x becomes −y, straight down the east wall.
    near(rotateBetween(Y, X, X, v()), NY);
    // Walking north off the top onto the north wall.
    near(rotateBetween(Y, Z, Z, v()), NY);
    // Down the east wall onto the ceiling under it: −y becomes −x, inward under the slab.
    near(rotateBetween(X, NY, NY, v()), NX);
    // Into a wall from the floor (concave): −x becomes +y, up the wall.
    near(rotateBetween(Y, X, NX, v()), Y);
    // Up the pillar's east wall into the slab's underside: +y becomes +x, outward along the ceiling.
    near(rotateBetween(X, NY, Y, v()), X);
    // Along the edge: not turned at all.
    near(rotateBetween(Y, X, Z, v()), Z);
    near(rotateBetween(Y, X, NZ, v()), NZ);
  });

  it('preserves length, angles and the perpendicularity of ahead to up', () => {
    const froms = FACE_NORMALS;
    for (const from of froms) {
      for (const to of froms) {
        for (const h of HEADINGS) {
          const a = aheadOn(from, h, v());
          const carried = rotateBetween(from, to, a, v());
          expect(Math.hypot(carried.x, carried.y, carried.z)).toBeCloseTo(1, 12);
          expect(dot(carried, to)).toBeCloseTo(0, 12);
        }
      }
    }
  });

  it('the half turn is fixed for opposite directions, and is an involution', () => {
    const p = vec3(0.2, 0.3, 0.9);
    const once = rotateBetween(Y, NY, p, v());
    near(once, vec3(0.2, -0.3, -0.9));
    near(rotateBetween(NY, Y, once, v()), p);
    // from nearly ±x falls back to the z choice: still a half turn perpendicular to from.
    const q = rotateBetween(X, NX, vec3(0.5, 0.6, 0.7), v());
    expect(q.x).toBeCloseTo(-0.5, 12);
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(Math.hypot(0.5, 0.6, 0.7), 12);
  });
});

describe('faceUnder', () => {
  const pillar: Climbable = { id: 'pillar', min: vec3(-4, 99, -4), max: vec3(4, 112, 4) };
  const slab: Climbable = { id: 'slab', min: vec3(-10, 112, -10), max: vec3(10, 120, 10) };
  const boxes = [pillar, slab];

  it('finds the face whose plane, extent and normal the body is on, and nothing on the ground or in the air', () => {
    expect(faceUnder(world(0, 0), 120, Y, boxes)?.box.id).toBe('slab');
    expect(faceUnder(world(9.9, -9.9), 120, Y, boxes)?.normal).toBe(Y);
    expect(faceUnder(world(10, 3), 115, X, boxes)?.box.id).toBe('slab');
    expect(faceUnder(world(4, 0), 105, X, boxes)?.box.id).toBe('pillar');
    expect(faceUnder(world(-4, 0), 105, NX, boxes)?.box.id).toBe('pillar');
    expect(faceUnder(world(7, 7), 112, NY, boxes)?.box.id).toBe('slab');
    expect(faceUnder(world(0, -10), 118, NZ, boxes)?.box.id).toBe('slab');
    // On the floor, under the slab, and in the air over it: no face.
    expect(faceUnder(world(7, 7), 100, Y, boxes)).toBeNull();
    expect(faceUnder(world(0, 0), 130, Y, boxes)).toBeNull();
    // Off the slab's edge at the top's height: no face.
    expect(faceUnder(world(10.5, 0), 120, Y, boxes)).toBeNull();
    // The right plane but the wrong up: a body cannot stand on the top with its feet pointing east.
    expect(faceUnder(world(0, 0), 120, X, boxes)).toBeNull();
    expect(faceUnder(world(0, 0), 120, Y, [])).toBeNull();
  });

  it('a skin\'s worth off the plane is still on it', () => {
    expect(faceUnder(world(4 + 1e-6, 0), 105, X, boxes)?.box.id).toBe('pillar');
    expect(faceUnder(world(4 + 1e-3, 0), 105, X, boxes)).toBeNull();
  });

  it('names a face for a HUD', () => {
    expect(faceWord(Y)).toBe('on top');
    expect(faceWord(NY)).toBe('on ceiling');
    for (const n of [X, NX, Z, NZ]) expect(faceWord(n)).toBe('on wall');
  });
});

describe('tangentOf', () => {
  it('removes the component along up', () => {
    const t = tangentOf(X, vec3(3, 4, 5), v());
    near(t, vec3(0, 4, 5));
    near(tangentOf(NY, vec3(1, -7, 2), v()), vec3(1, 0, 2));
  });
});
