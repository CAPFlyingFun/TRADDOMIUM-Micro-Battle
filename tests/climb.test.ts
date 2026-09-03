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
import { TrunkField, trunkProfile } from '../src/world/trunkSolid';
import {
  FOOTING, GRIP_REACH, WORLD_UP, aimFor, alongSurface, isClimbing, perchOn,
} from '../src/ant/climb';
import { gripUp } from '../src/ant/surfaceGrip';

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
