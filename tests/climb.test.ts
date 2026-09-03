/**
 * SHE CLIMBS THE TREE SHE CANNOT WALK THROUGH.
 *
 * The collision (v0.0.154) and the climbing are the same fact about a
 * trunk seen from two sides, and these check the join between them —
 * plus the promise the whole design rests on: THAT NOTHING ON THE
 * GROUND CHANGED. Climbing is only worth having if walking about the
 * island is exactly what it was.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { loadIsland } from './support/island';
import { geoToWorld } from '../src/world/geo';
import { groundHeight } from '../src/world/heightfield';
import { world } from '../src/world/coords';
import { TrunkField, ringFactor, trunkProfile } from '../src/world/trunkSolid';
import {
  FOOTING, GRIP_REACH, WORLD_UP, aimFor, alongSurface, isClimbing, perchOn,
} from '../src/ant/climb';
import { gripUp, spinAbout } from '../src/ant/surfaceGrip';

const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
const BODY = 18;

function oneTree(at = WAILUA) {
  const spec = { height: 2400, girth: 96, seed: 0x7ee5 };
  const profile = trunkProfile(spec, 12);
  const foot = groundHeight(at.wx, at.wz) - 30;
  return new TrunkField([{
    id: 'test', at: world(at.wx, at.wz), foot, scale: 2222,
    cos: 1, sin: 0, profile,
    reach: profile.widest * 2222 + 10, top: foot + 2222,
  }]);
}

/** The trunk's radius at a height, measured off the field itself. */
function barkAt(trunks: TrunkField, y: number): number {
  let r = 0;
  while (trunks.depthAt(WAILUA.wx + r, y, WAILUA.wz) > 0 && r < 1000) r += 0.5;
  return r;
}

describe('the ground is untouched', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('finds no perch in open country, so nothing changes', () => {
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    expect(perchOn({ x: WAILUA.wx, y: g, z: WAILUA.wz }, null)).toBeNull();
    expect(perchOn(
      { x: WAILUA.wx, y: g, z: WAILUA.wz }, oneTree(geoToWorld({
        lat: 22.06, lon: -159.40,
      })),
    )).toBeNull();
  });

  it('aims her at world up when she is on nothing', () => {
    expect(aimFor(null)).toEqual(WORLD_UP);
    expect(isClimbing(WORLD_UP)).toBe(false);
  });

  it('leaves a walking step exactly as it was', () => {
    // alongSurface is in the movement path for EVERY step she takes,
    // climbing or not. On the ground it must remove nothing at all.
    const step = { x: 3, y: 0, z: -7 };
    expect(alongSurface(step, WORLD_UP)).toEqual(step);
  });
});

describe('and the bark is a floor', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('takes hold when she is pressed against a trunk', () => {
    // Exactly where the collision leaves her: her body radius off the
    // bark, which is the only place she can ever be when she meets one
    // on foot. If the grip reach did not clear that she could never
    // take hold of anything she had just walked into.
    const trunks = oneTree();
    const y = groundHeight(WAILUA.wx, WAILUA.wz) + 100;
    const bark = barkAt(trunks, y);
    const perch = perchOn(
      { x: WAILUA.wx + bark + BODY, y, z: WAILUA.wz }, trunks,
    );
    expect(perch).not.toBeNull();
    expect(GRIP_REACH).toBeGreaterThan(BODY);
  });

  it('seats her on the surface, facing out of it', () => {
    const trunks = oneTree();
    const y = groundHeight(WAILUA.wx, WAILUA.wz) + 100;
    const bark = barkAt(trunks, y);
    const perch = perchOn(
      { x: WAILUA.wx + bark + BODY, y, z: WAILUA.wz }, trunks,
    )!;
    // Her attitude goal points out along the trunk's radius…
    expect(perch.up.x).toBeGreaterThan(0.9);
    expect(Math.abs(perch.up.y)).toBeLessThan(0.2);
    // …and she is seated on the bark, not floating off it.
    expect(Math.abs(perch.at.x - (WAILUA.wx + bark))).toBeLessThan(3);
  });

  it('a forward push becomes a climb once she is on the bark', () => {
    // THE POINT OF THE WHOLE DESIGN. The stick still means "forward
    // relative to the camera"; the surface decides what that does.
    const bark = { x: 1, y: 0, z: 0 };
    const walk = alongSurface({ x: 0, y: 0, z: 40 }, WORLD_UP);
    expect(walk.y).toBe(0);
    const climb = alongSurface({ x: 0, y: 0, z: 40 }, { x: 0, y: 0, z: 1 });
    // Pushing straight at a wall whose normal is +z: the step goes to
    // nothing rather than through it.
    expect(Math.hypot(climb.x, climb.y, climb.z)).toBeLessThan(1e-9);
    // Pushing ALONG a trunk whose bark faces +x climbs it.
    const up = alongSurface({ x: 0, y: 0, z: 40 }, bark);
    expect(up.z).toBeCloseTo(40, 9);
  });

  it('rolls onto the trunk rather than snapping onto it', () => {
    // The goal switches outright — there is no blend anywhere in
    // climb.ts — and the rate limit is what makes that a movement.
    const bark = { x: 1, y: 0, z: 0 };
    let up = WORLD_UP;
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      up = gripUp(up, bark, 1 / 30);
      seen.push(up.y);
    }
    // Still on its way after a frame, and each frame a step not a jump.
    expect(seen[0]).toBeGreaterThan(0.8);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeLessThan(seen[i - 1]);
    }
    expect(isClimbing(seen.map((y) => ({ x: 0, y, z: 0 }))[3])).toBe(true);
  });
});


describe('she is never seated inside the earth', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('a perch may reach below the ground, but she may not go there', () => {
    // Joshua, v0.0.156: "when I was going from the ground to the tree
    // or tree to ground, I dipped under the ground."
    //
    // A trunk is sunk below the surface so it never stands on air where
    // the drawn mesh dips, and FOOTING deliberately lets the grip reach
    // a few centimetres under so the very bottom of a tree can still be
    // held. That reach is the RIGHT behaviour and the dip was the seat
    // following it down. The grip may go below the ground; she may not.
    expect(FOOTING).toBeGreaterThan(0);

    const trunks = oneTree();
    const floor = groundHeight(WAILUA.wx, WAILUA.wz);
    // At the very foot, where the buried stub is still grippable.
    const bark = barkAt(trunks, floor);
    const perch = perchOn(
      { x: WAILUA.wx + bark + BODY, y: floor, z: WAILUA.wz }, trunks,
    );
    expect(perch).not.toBeNull();
    // The perch itself is allowed to sit a little under…
    expect(perch!.at.y).toBeGreaterThan(floor - FOOTING - 1);
  });

  it('refuses a perch on the buried stub well below the ground', () => {
    // Walking DOWN a trunk used to carry on into the dirt and round the
    // bottom cap onto the underside — the probe found her 80 cm under
    // the forest floor with her up pointing at the ground.
    const trunks = oneTree();
    const floor = groundHeight(WAILUA.wx, WAILUA.wz);
    const deep = floor - 60;
    const bark = barkAt(trunks, deep);
    expect(perchOn(
      { x: WAILUA.wx + bark + BODY, y: deep, z: WAILUA.wz }, trunks,
    )).toBeNull();
  });
});


describe('the two signs, and the surface she sits on', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('crosses facing x up for the step, the way the ground does', () => {
    // THE SHIPPED CONVENTION, not a choice. On the ground a view of 0
    // with `across` at +1 moves her -x:
    //     sin(view - PI/2) * 1 === -1
    // and facing x up reproduces it, while up x facing is its
    // negation. Crossed the wrong way the stick pushed her the wrong
    // way the moment she left the ground — "both joystick and camera
    // left and right are inverted".
    const view = 0;
    const groundAcross = Math.sin(view - Math.PI / 2);
    expect(groundAcross).toBeCloseTo(-1, 9);

    const facing = { x: Math.sin(view), y: 0, z: Math.cos(view) };
    const up = WORLD_UP;
    const side = {
      x: facing.y * up.z - facing.z * up.y,
      y: facing.z * up.x - facing.x * up.z,
      z: facing.x * up.y - facing.y * up.x,
    };
    expect(side.x).toBeCloseTo(groundAcross, 9);
  });

  it('turns her the way her heading turns, about her own up', () => {
    // On the ground her heading FOLLOWS the view: heading + swing. A
    // right-handed turn about world up by the same swing has to be the
    // identical motion, or a drag left swings her right.
    const swing = 0.3;
    const before = { x: Math.sin(0), y: 0, z: Math.cos(0) };
    const after = { x: Math.sin(swing), y: 0, z: Math.cos(swing) };
    const spun = spinAbout(before, WORLD_UP, swing);
    expect(spun.x).toBeCloseTo(after.x, 9);
    expect(spun.z).toBeCloseTo(after.z, 9);
  });

  it('seats her on the FLATS of the trunk, not the ring through its corners', () => {
    // Joshua: "ant is floating just about the tree trunk." The drawn
    // trunk is a polygon whose flats are tangent to the limb's circle,
    // so a profile taken through the CORNERS sits ringFactor above the
    // flat she is actually over — 3.5% of the radius at twelve sides,
    // about a third of her own height on a real trunk. She collides
    // with the corners and stands on the flats.
    const spec = { height: 2400, girth: 96, seed: 0x7ee5 };
    const corners = trunkProfile(spec, 12, true);
    const flats = trunkProfile(spec, 12, false);
    expect(ringFactor(12)).toBeCloseTo(1.0353, 4);
    for (let i = 0; i < flats.r.length; i++) {
      expect(corners.r[i]).toBeCloseTo(flats.r[i] * ringFactor(12), 9);
      expect(flats.r[i]).toBeLessThan(corners.r[i]);
    }
    // And the gap is the float he saw: about a centimetre on a trunk
    // whose radius is 40 cm.
    const float = 40 - 40 / ringFactor(12);
    expect(float).toBeGreaterThan(1);
    expect(float).toBeLessThan(2);
  });

  it('uses the seat profile for depth, so a perch lands on the flats', () => {
    const spec = { height: 2400, girth: 96, seed: 0x7ee5 };
    const at = WAILUA;
    const foot = groundHeight(at.wx, at.wz) - 30;
    const one = {
      id: 't', at: world(at.wx, at.wz), foot, scale: 2222,
      cos: 1, sin: 0,
      profile: trunkProfile(spec, 12, true),
      seat: trunkProfile(spec, 12, false),
      reach: 400, top: foot + 2222,
    };
    const ringed = new TrunkField([{ ...one, seat: undefined }]);
    const seated = new TrunkField([one]);
    const y = groundHeight(at.wx, at.wz) + 100;
    // The seat profile is the thinner tree, so the same point is LESS
    // deep in it — which is what stops her riding above the bark.
    expect(seated.depthAt(at.wx + 30, y, at.wz))
      .toBeLessThan(ringed.depthAt(at.wx + 30, y, at.wz));
  });
});
