/**
 * The surface frame (`creatures/surface.ts`): a heading on a face means
 * ONE thing to every reader, the flat case is the old convention to the
 * bit, an edge carries the frame by one rotation, and the face under
 * the feet is found exactly.
 *
 * Creature Lab D's leaf, below the frame: the step that sticks — the
 * brief's §14 route over the Lab's slab and pedestal in both directions,
 * a strafe along a wall, an edge walked along, a diagonal off a corner,
 * no teleport, the flat case `planeStep` to the bit, no NaN — the aim
 * on a face and the way down from a ceiling, the flier's floor over a
 * box, and the way round the pedestal.
 */
import { describe, expect, it } from 'vitest';
import { ahead, wrapHeading } from '../src/creatures/heading';
import { LAB_CLIMBABLES, LAB_FLOOR, PILLAR_BOX, SLAB_BOX } from '../src/creatures/labWorld';
import {
  FACE_NORMALS, FACE_TOLERANCE, MAX_EDGES_PER_STEP, SURFACE_SKIN, WORLD_UP, aheadOn, aimOnSurface, cross, dot, faceUnder, faceWord,
  floorOverBoxes, headingOn, rightOn, rotateBetween, routeAround, signedAngleAbout, surfaceStep, tangentOf, vec3,
  type Climbable, type MutableVec3, type SurfaceBody, type Vec3,
} from '../src/creatures/surface';
import { translate, world, type WorldPoint } from '../src/world/coords';
import { mulberry32 } from '../src/world/random';

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

// ---------------------------------------------------------------------------
// Creature Lab D's leaf: the step, the aim, the flier's floor and the way round
// ---------------------------------------------------------------------------

const FLAT = (): number => LAB_FLOOR;
const TOP = LAB_FLOOR + 20;
const UNDER = LAB_FLOOR + 12;

function body(wx: number, wz: number, height: number, heading: number, up: Vec3 = WORLD_UP): SurfaceBody {
  return { at: world(wx, wz), height, heading, up };
}

/** The face word of an up, for a trail a test can read: g for the ground. */
function word(up: Vec3): string {
  if (up === WORLD_UP || (up.y > 0.5)) return 'g/top';
  if (up.y < -0.5) return 'ceiling';
  return up.x > 0.5 ? '+x' : up.x < -0.5 ? '-x' : up.z > 0.5 ? '+z' : '-z';
}

/**
 * Walk `n` steps of `step` along the request, collecting the ups the
 * body passes through (deduplicated in sequence), checking every step
 * that the body never moved further than the step, never NaN'd, and
 * that its ahead stays a unit tangent of its up.
 */
function walk(b: SurfaceBody, forward: number, strafe: number, step: number, n: number, boxes = LAB_CLIMBABLES, groundAt = FLAT): string[] {
  const trail: string[] = [word(b.up)];
  for (let i = 0; i < n; i += 1) {
    const px = b.at.wx;
    const py = b.height;
    const pz = b.at.wz;
    const moved = surfaceStep(b, forward, strafe, step, groundAt, boxes);
    expect(Number.isFinite(b.at.wx) && Number.isFinite(b.at.wz) && Number.isFinite(b.height) && Number.isFinite(b.heading)).toBe(true);
    expect(moved).toBeLessThanOrEqual(step * Math.min(1, Math.hypot(forward, strafe)) + 1e-9);
    // No teleport: the straight-line displacement is never more than the step (a wrap round an edge is shorter than the path).
    expect(Math.hypot(b.at.wx - px, b.height - py, b.at.wz - pz)).toBeLessThanOrEqual(step + 1e-6);
    const a = aheadOn(b.up, b.heading, v());
    expect(Math.abs(dot(a, b.up))).toBeLessThan(1e-9);
    const w = word(b.up);
    if (trail[trail.length - 1] !== w) trail.push(w);
  }
  return trail;
}

describe('surfaceStep: the §14 route on the Lab\'s slab and pedestal', () => {
  it('floor → into the pillar\'s east wall (heading up) → the underside (heading outward, up = −y) → out to the edge → up the slab\'s east wall → the top', () => {
    // From the floor east of the pillar, facing west (−x).
    const b = body(8, 0, LAB_FLOOR, -Math.PI / 2);
    const trail = walk(b, 1, 0, 0.05, 900);
    expect(trail).toEqual(['g/top', '+x', 'ceiling', '+x', 'g/top']);
    // On the top, walking west across it, with the top's own up.
    expect(b.up).toBe(WORLD_UP);
    expect(b.height).toBeCloseTo(TOP + SURFACE_SKIN, 9);
    expect(Math.abs(b.at.wx)).toBeLessThan(10);
    near(aheadOn(b.up, b.heading, v()), NX, 9);
  });

  it('carries the frame at each edge: into the wall the walk becomes a climb, onto the ceiling the climb becomes outward, off the edge the ceiling becomes a climb again', () => {
    const b = body(8, 0, LAB_FLOOR, -Math.PI / 2);
    // Walk until on the wall.
    while (b.up === WORLD_UP) surfaceStep(b, 1, 0, 0.05, FLAT, LAB_CLIMBABLES);
    expect(b.up).toBe(X);
    expect(b.at.wx).toBeCloseTo(PILLAR_BOX.max.x + SURFACE_SKIN, 12);
    near(aheadOn(b.up, b.heading, v()), Y, 9);
    const wallStart = b.height;
    // Up the wall at exactly the step a frame, never more.
    for (let i = 0; i < 20; i += 1) {
      const before = b.height;
      const moved = surfaceStep(b, 1, 0, 0.05, FLAT, LAB_CLIMBABLES);
      expect(moved).toBeCloseTo(0.05, 12);
      expect(b.height - before).toBeCloseTo(0.05, 12);
      expect(b.at.wx).toBeCloseTo(PILLAR_BOX.max.x + SURFACE_SKIN, 12);
    }
    expect(b.height).toBeCloseTo(wallStart + 1, 9);
    while (b.up === X) surfaceStep(b, 1, 0, 0.05, FLAT, LAB_CLIMBABLES);
    expect(b.up).toBe(NY);
    expect(b.height).toBeCloseTo(UNDER - SURFACE_SKIN, 12);
    near(aheadOn(b.up, b.heading, v()), X, 9);
    while (b.up === NY) surfaceStep(b, 1, 0, 0.05, FLAT, LAB_CLIMBABLES);
    expect(b.up).toBe(X);
    expect(b.at.wx).toBeCloseTo(SLAB_BOX.max.x + SURFACE_SKIN, 12);
    near(aheadOn(b.up, b.heading, v()), Y, 9);
  });

  it('the route back: across the top → off the west edge → down the west wall → onto the underside → inward to the pillar → down it → the floor', () => {
    const b = body(0, 0, TOP + SURFACE_SKIN, -Math.PI / 2);
    const trail = walk(b, 1, 0, 0.05, 1200);
    expect(trail).toEqual(['g/top', '-x', 'ceiling', '-x', 'g/top']);
    expect(b.up).toBe(WORLD_UP);
    expect(b.height).toBe(LAB_FLOOR);
    expect(b.at.wx).toBeLessThan(PILLAR_BOX.min.x - 1);
    near(aheadOn(b.up, b.heading, v()), NX, 9);
  });

  it('the whole loop, forward held: floor → pillar → underside → slab wall → top → slab wall → underside → pillar → floor, in a walk of the sunk pillar too', () => {
    const b = body(8, 0, LAB_FLOOR, -Math.PI / 2);
    const trail = walk(b, 1, 0, 0.05, 2400);
    expect(trail).toEqual(['g/top', '+x', 'ceiling', '+x', 'g/top', '-x', 'ceiling', '-x', 'g/top']);
    expect(b.height).toBe(LAB_FLOOR);
    expect(b.at.wz).toBeCloseTo(0, 6);
  });

  it('a strafe on a wall moves along the wall, and never off its plane', () => {
    const b = body(PILLAR_BOX.max.x + SURFACE_SKIN, 0, LAB_FLOOR + 5, -Math.PI / 2, X);
    near(aheadOn(b.up, b.heading, v()), Y, 9);
    const right = rightOn(b.up, aheadOn(b.up, b.heading, v()), v());
    // Right on the east wall, facing up: ahead × up = +y × +x = −z.
    near(right, NZ, 9);
    const z0 = b.at.wz;
    for (let i = 0; i < 10; i += 1) surfaceStep(b, 0, 1, 0.1, FLAT, LAB_CLIMBABLES);
    expect(b.at.wz).toBeCloseTo(z0 - 1, 9);
    expect(b.height).toBeCloseTo(LAB_FLOOR + 5, 12);
    expect(b.at.wx).toBeCloseTo(PILLAR_BOX.max.x + SURFACE_SKIN, 12);
    expect(b.up).toBe(X);
    // Strafing on round the pillar's corner: onto the −z wall, still going round.
    for (let i = 0; i < 40; i += 1) surfaceStep(b, 0, 1, 0.1, FLAT, LAB_CLIMBABLES);
    expect(b.up).toBe(NZ);
    expect(b.at.wz).toBeCloseTo(PILLAR_BOX.min.z - SURFACE_SKIN, 12);
    expect(b.height).toBeCloseTo(LAB_FLOOR + 5, 12);
  });

  it('walking along an edge is not turned; a diagonal off a corner crosses the earlier edge first', () => {
    // Along the top's east edge, heading north (+z), a hair inside: stays on the top.
    const along = body(SLAB_BOX.max.x - 1e-3, 0, TOP + SURFACE_SKIN, 0);
    for (let i = 0; i < 50; i += 1) surfaceStep(along, 1, 0, 0.1, FLAT, LAB_CLIMBABLES);
    expect(along.up).toBe(WORLD_UP);
    expect(along.heading).toBe(0);
    expect(along.at.wz).toBeCloseTo(5, 9);
    // Off the north-east corner on a diagonal that reaches the east edge first: onto the east wall, not the north.
    const corner = body(SLAB_BOX.max.x - 0.3, SLAB_BOX.max.z - 0.6, TOP + SURFACE_SKIN, Math.PI / 4);
    surfaceStep(corner, 1, 0, 0.5, FLAT, LAB_CLIMBABLES);
    expect(corner.up).toBe(X);
    expect(corner.at.wx).toBeCloseTo(SLAB_BOX.max.x + SURFACE_SKIN, 12);
    expect(corner.at.wz).toBeLessThan(SLAB_BOX.max.z);
    const other = body(SLAB_BOX.max.x - 0.6, SLAB_BOX.max.z - 0.3, TOP + SURFACE_SKIN, Math.PI / 4);
    surfaceStep(other, 1, 0, 0.5, FLAT, LAB_CLIMBABLES);
    expect(other.up).toBe(Z);
    // A step long enough to cross both: the first edge, then the second, round the corner onto the north wall going down.
    const both = body(SLAB_BOX.max.x - 0.3, SLAB_BOX.max.z - 0.6, TOP + SURFACE_SKIN, Math.PI / 4);
    surfaceStep(both, 1, 0, 1, FLAT, LAB_CLIMBABLES);
    expect(both.up).toBe(Z);
    expect(both.at.wz).toBeCloseTo(SLAB_BOX.max.z + SURFACE_SKIN, 12);
    expect(both.height).toBeLessThan(TOP);
  });

  it('heights never jump more than the step in one call, at every step size, over the whole loop', () => {
    for (const step of [0.01, 0.05, 0.3, 1.5]) {
      const b = body(8, 0, LAB_FLOOR, -Math.PI / 2);
      let worst = 0;
      for (let i = 0; i < Math.round(120 / step); i += 1) {
        const h = b.height;
        surfaceStep(b, 1, 0, step, FLAT, LAB_CLIMBABLES);
        worst = Math.max(worst, Math.abs(b.height - h));
      }
      // A wrap round an edge pulls the body out by the skin: a micron, never a millimetre.
      expect(worst, `step ${step}`).toBeLessThanOrEqual(step + 2 * SURFACE_SKIN);
      expect(b.height).toBeLessThanOrEqual(TOP + 1e-3);
      expect(b.height).toBeGreaterThanOrEqual(LAB_FLOOR - 1e-9);
    }
  });

  it('a wall that stands exactly on the ground is entered from the ground and left onto it, and a wall in the air wraps onto its underside', () => {
    const onFloor: Climbable = { id: 'crate', min: vec3(20, LAB_FLOOR, 20), max: vec3(24, LAB_FLOOR + 4, 24) };
    const b = body(18, 22, LAB_FLOOR, Math.PI / 2);
    const trail = walk(b, 1, 0, 0.05, 400, [onFloor]);
    expect(trail).toEqual(['g/top', '-x', 'g/top', '+x', 'g/top']);
    expect(b.height).toBe(LAB_FLOOR);
    // The slab alone, from its top: down the wall and onto the underside, and round again.
    const c = body(0, 0, TOP + SURFACE_SKIN, Math.PI / 2);
    const loop = walk(c, 1, 0, 0.05, 1200, [SLAB_BOX]);
    expect(loop).toEqual(['g/top', '+x', 'ceiling', '-x', 'g/top']);
  });
});

describe('surfaceStep: the flat case is planeStep to the bit', () => {
  /** `planeStep`'s arithmetic, copied: `ahead` with no strafe, the disc expression with one. */
  function planeStepCopy(at: WorldPoint, heading: number, forward: number, strafe: number, step: number): WorldPoint {
    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 1) {
      forward /= magnitude;
      strafe /= magnitude;
    }
    if (strafe === 0) return ahead(at, heading, forward * step);
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    return translate(at, (forward * sin - strafe * cos) * step, (forward * cos + strafe * sin) * step);
  }

  it('with no boxes, and with the Lab\'s boxes when none is touched, over a few thousand random steps', () => {
    const rand = mulberry32(77);
    const hilly = (at: WorldPoint): number => LAB_FLOOR + Math.sin(at.wx / 7) * 2 + Math.cos(at.wz / 5);
    for (const boxes of [[], LAB_CLIMBABLES]) {
      for (let i = 0; i < 3000; i += 1) {
        // Anywhere in the box but the block's neighbourhood.
        let wx = (rand() * 2 - 1) * 45;
        let wz = (rand() * 2 - 1) * 45;
        if (Math.abs(wx) < 13 && Math.abs(wz) < 13) wx += 20;
        const heading = (rand() * 2 - 1) * Math.PI;
        const forward = rand() < 0.3 ? 0 : (rand() * 2 - 1);
        const strafe = rand() < 0.5 ? 0 : (rand() * 2 - 1);
        const step = rand() * 0.5;
        const at = world(wx, wz);
        const b: SurfaceBody = { at, height: hilly(at), heading, up: WORLD_UP };
        const expected = planeStepCopy(at, heading, forward, strafe, step);
        const moved = surfaceStep(b, forward, strafe, step, hilly, boxes);
        if (step === 0 || (forward === 0 && strafe === 0)) {
          expect(b.at).toBe(at);
          expect(moved).toBe(0);
          continue;
        }
        expect(b.at.wx).toBe(expected.wx);
        expect(b.at.wz).toBe(expected.wz);
        expect(b.height).toBe(hilly(expected));
        expect(b.heading).toBe(heading);
        expect(b.up).toBe(WORLD_UP);
        expect(moved).toBeCloseTo(Math.min(1, Math.hypot(forward, strafe)) * step, 12);
      }
    }
  });

  it('a bad step, a bad request, a bad body or a bad ground moves nothing and never NaNs', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const b = body(8, 0, LAB_FLOOR, 0);
      expect(surfaceStep(b, 1, 0, bad, FLAT, LAB_CLIMBABLES)).toBe(0);
      expect(b.at).toEqual(world(8, 0));
    }
    const b = body(8, 0, LAB_FLOOR, 0);
    expect(surfaceStep(b, NaN, 0, 0.1, FLAT, LAB_CLIMBABLES)).toBe(0);
    expect(surfaceStep(b, 0, Infinity, 0.1, FLAT, LAB_CLIMBABLES)).toBe(0);
    expect(surfaceStep(b, 0, 0, 0.1, FLAT, LAB_CLIMBABLES)).toBe(0);
    expect(b.at).toEqual(world(8, 0));
    const lost = body(NaN, 0, LAB_FLOOR, 0);
    expect(surfaceStep(lost, 1, 0, 0.1, FLAT, LAB_CLIMBABLES)).toBe(0);
    const tipped = body(8, 0, LAB_FLOOR, 0, vec3(NaN, 1, 0));
    expect(surfaceStep(tipped, 1, 0, 0.1, FLAT, LAB_CLIMBABLES)).toBe(0);
    // A ground the world cannot price: the plane moves, the height is left alone.
    const dark = body(30, 30, 123, 0.3);
    const moved = surfaceStep(dark, 1, 0, 0.1, () => NaN, LAB_CLIMBABLES);
    expect(moved).toBeCloseTo(0.1, 12);
    expect(dark.height).toBe(123);
    expect(Number.isFinite(dark.at.wx)).toBe(true);
    // A step that would cross more edges than the guard allows stops at the last edge, on a surface, never inside a box.
    const tiny: Climbable = { id: 'grain', min: vec3(30, LAB_FLOOR, 30), max: vec3(30.01, LAB_FLOOR + 0.01, 30.01) };
    const g = body(29.9, 30.005, LAB_FLOOR, Math.PI / 2);
    surfaceStep(g, 1, 0, 5, FLAT, [tiny]);
    expect(Number.isFinite(g.at.wx) && Number.isFinite(g.height)).toBe(true);
    expect(MAX_EDGES_PER_STEP).toBe(4);
  });
});

describe('aimOnSurface', () => {
  it('on a top or a wall it is the target\'s direction projected onto the face, unit length; null when there is none', () => {
    const top = body(0, 0, TOP + SURFACE_SKIN, 0);
    const a = aimOnSurface(top, world(30, 0), LAB_FLOOR, LAB_CLIMBABLES, v());
    near(a!, X, 12);
    const wall = body(SLAB_BOX.max.x + SURFACE_SKIN, 0, LAB_FLOOR + 16, 0, X);
    const w = aimOnSurface(wall, world(SLAB_BOX.max.x, 0), LAB_FLOOR, LAB_CLIMBABLES, v());
    near(w!, NY, 12);
    const diag = aimOnSurface(wall, world(SLAB_BOX.max.x, 4), LAB_FLOOR + 12, LAB_CLIMBABLES, v());
    near(diag!, vec3(0, -Math.SQRT1_2, Math.SQRT1_2), 12);
    // Straight along the normal: no direction.
    expect(aimOnSurface(wall, world(SLAB_BOX.max.x + 5, 0), LAB_FLOOR + 16, LAB_CLIMBABLES, v())).toBeNull();
    expect(aimOnSurface(top, world(0, 0), LAB_FLOOR, LAB_CLIMBABLES, v())).toBeNull();
  });

  it('on the ceiling the way down is the pedestal: horizontal, at the nearest point of the pillar\'s footprint; at the pillar, or with nothing under it, the projection', () => {
    const under = body(7, 2, UNDER - SURFACE_SKIN, 0, NY);
    const a = aimOnSurface(under, world(30, 30), LAB_FLOOR, LAB_CLIMBABLES, v());
    // From (7, 2) the nearest point of the 8 cm pillar is (4, 2): due west.
    near(a!, NX, 12);
    const corner = body(9, -9, UNDER - SURFACE_SKIN, 0, NY);
    const c = aimOnSurface(corner, world(30, 30), LAB_FLOOR, LAB_CLIMBABLES, v());
    near(c!, vec3(-Math.SQRT1_2, 0, Math.SQRT1_2), 12);
    // At the pillar's wall already: the projection (which, for a target far off east, is east).
    const at = body(PILLAR_BOX.max.x + SURFACE_SKIN, 0, UNDER - SURFACE_SKIN, 0, NY);
    const p = aimOnSurface(at, world(30, 0), LAB_FLOOR, LAB_CLIMBABLES, v());
    near(p!, X, 12);
    // The slab alone, nothing holding it up: the projection.
    const alone = aimOnSurface(under, world(30, 30), LAB_FLOOR, [SLAB_BOX], v());
    near(alone!, vec3(23 / Math.hypot(23, 28), 0, 28 / Math.hypot(23, 28)), 12);
  });
});

describe('floorOverBoxes', () => {
  it('is the ground, or the highest box top under the point that is at or below the body', () => {
    expect(floorOverBoxes(world(0, 0), LAB_FLOOR + 30, LAB_FLOOR, LAB_CLIMBABLES)).toBe(TOP);
    expect(floorOverBoxes(world(0, 0), TOP + SURFACE_SKIN, LAB_FLOOR, LAB_CLIMBABLES)).toBe(TOP);
    expect(floorOverBoxes(world(9.99, -9.99), LAB_FLOOR + 30, LAB_FLOOR, LAB_CLIMBABLES)).toBe(TOP);
    // A fly under the slab keeps the floor; a fly beside it keeps the floor.
    expect(floorOverBoxes(world(7, 7), LAB_FLOOR + 5, LAB_FLOOR, LAB_CLIMBABLES)).toBe(LAB_FLOOR);
    expect(floorOverBoxes(world(12, 0), LAB_FLOOR + 30, LAB_FLOOR, LAB_CLIMBABLES)).toBe(LAB_FLOOR);
    // A hair over the pillar's top (inside the slab, which a flier may pass through): the pillar's top, inside its footprint only.
    expect(floorOverBoxes(world(0, 0), UNDER + 0.001, LAB_FLOOR, LAB_CLIMBABLES)).toBe(UNDER);
    expect(floorOverBoxes(world(6, 0), UNDER + 0.001, LAB_FLOOR, LAB_CLIMBABLES)).toBe(LAB_FLOOR);
    // Inside the pillar, a hair under its top: the pillar's top is above the body, so the floor.
    expect(floorOverBoxes(world(0, 0), UNDER - 0.001, LAB_FLOOR, LAB_CLIMBABLES)).toBe(LAB_FLOOR);
    // The water's surface as the ground answer is kept when it is higher.
    expect(floorOverBoxes(world(0, 0), LAB_FLOOR + 30, TOP + 5, LAB_CLIMBABLES)).toBe(TOP + 5);
    // A ground that is not a number: the box under the body is a floor; with none, the ground as given.
    expect(floorOverBoxes(world(0, 0), LAB_FLOOR + 30, NaN, LAB_CLIMBABLES)).toBe(TOP);
    expect(Number.isNaN(floorOverBoxes(world(30, 30), LAB_FLOOR + 30, NaN, LAB_CLIMBABLES))).toBe(true);
    expect(floorOverBoxes(world(0, 0), LAB_FLOOR + 30, LAB_FLOOR, [])).toBe(LAB_FLOOR);
  });
});

describe('routeAround', () => {
  const clearance = 0.4;

  it('a target with a clear straight line is the target itself; one across the pillar is a grown corner on the way', () => {
    const at = world(-15, 0);
    const clear = world(-15, 20);
    expect(routeAround(at, clear, LAB_FLOOR, clearance, LAB_CLIMBABLES)).toBe(clear);
    // Under the slab is walkable at floor height: the slab is not in the way, the pillar is.
    const across = world(15, 0);
    const way = routeAround(at, across, LAB_FLOOR, clearance, LAB_CLIMBABLES);
    expect(way).not.toBe(across);
    expect(Math.abs(way.wx)).toBeCloseTo(PILLAR_BOX.max.x + clearance, 12);
    expect(Math.abs(way.wz)).toBeCloseTo(PILLAR_BOX.max.z + clearance, 12);
    // The nearer side first: the western corners are the ones to walk to from the west.
    expect(way.wx).toBeLessThan(0);
    // From that corner the next leg is another corner, and from there the target is clear.
    const next = routeAround(way, across, LAB_FLOOR, clearance, LAB_CLIMBABLES);
    expect(next.wx).toBeCloseTo(PILLAR_BOX.max.x + clearance, 12);
    expect(next.wz).toBeCloseTo(way.wz, 12);
    expect(routeAround(next, across, LAB_FLOOR, clearance, LAB_CLIMBABLES)).toBe(across);
  });

  it('a target past a corner takes the corner that makes the shorter detour, both legs clear', () => {
    // From the south-west, to a point east of the pillar just inside its grown southern edge: the line clips the
    // south-east corner, and the one corner both of whose legs keep out of the grown square is that south-east one.
    const at = world(-6, -6);
    const target = world(6, -3);
    const way = routeAround(at, target, LAB_FLOOR, clearance, LAB_CLIMBABLES);
    expect(way.wz).toBeCloseTo(-(PILLAR_BOX.max.z + clearance), 12);
    expect(way.wx).toBeCloseTo(PILLAR_BOX.max.x + clearance, 12);
    expect(routeAround(way, target, LAB_FLOOR, clearance, LAB_CLIMBABLES)).toBe(target);
  });

  it('a body already inside the grown rectangle is sent to the nearest corner it can reach; a box not in the way at this height is walked under; boxes and points that are not numbers change nothing', () => {
    const inside = world(PILLAR_BOX.max.x + 0.1, 0);
    const way = routeAround(inside, world(-15, 0), LAB_FLOOR, clearance, LAB_CLIMBABLES);
    expect(Math.abs(way.wx)).toBeCloseTo(PILLAR_BOX.max.x + clearance, 12);
    expect(Math.abs(way.wz)).toBeCloseTo(PILLAR_BOX.max.z + clearance, 12);
    // On the slab's top, the pillar is under the feet and the slab is under them too: nothing is in the way up there.
    const top = world(-8, 0);
    const across = world(8, 0);
    expect(routeAround(top, across, TOP, clearance, LAB_CLIMBABLES)).toBe(across);
    // Under the slab, at floor height, from one side of the slab's footprint to the other beside the pillar: clear.
    const beside = world(-8, 7);
    const past = world(8, 7);
    expect(routeAround(beside, past, LAB_FLOOR, clearance, LAB_CLIMBABLES)).toBe(past);
    const target = world(15, 0);
    expect(routeAround(world(NaN, 0), target, LAB_FLOOR, clearance, LAB_CLIMBABLES)).toBe(target);
    expect(routeAround(world(-15, 0), target, LAB_FLOOR, NaN, LAB_CLIMBABLES).wx).toBeCloseTo(-PILLAR_BOX.max.x, 12);
    expect(routeAround(world(-15, 0), target, LAB_FLOOR, clearance, [])).toBe(target);
    expect(FACE_TOLERANCE).toBeLessThan(clearance);
  });
});
