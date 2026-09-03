/**
 * THE GROUND AND THE BARK ARE ONE SURFACE.
 *
 * If that claim holds, climbing needs no mode: her up is the field's
 * gradient, and the gradient turns through a right angle at the foot
 * of a trunk all by itself. These check the claim rather than the
 * consequence — the walker is only as good as the field under it.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { loadIsland } from './support/island';
import { geoToWorld } from '../src/world/geo';
import { groundHeight } from '../src/world/heightfield';
import {
  GROUND, castFor, depthAt, normalAt, solidAt, unionOf,
} from '../src/world/solidField';
import { TrunkField, trunkProfile } from '../src/world/trunkSolid';
import { world } from '../src/world/coords';

const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });

/** One trunk, upright, seated on the ground where she is standing. */
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

describe('one signed field for everything solid', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  // WHO UNIONS WHAT IS THE CALLER'S DECISION, and these tests say so
  // by having to make it. It used to be implicit inside `depthAt`,
  // which quietly put the ground into every query — including the one
  // that looks for bark to grab, where it meant a queen standing beside
  // a trunk always found her own feet and could never take hold.
  const bothWith = (trunks: TrunkField) => unionOf(GROUND, trunks);

  it('is positive under the ground and negative in the air', () => {
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    expect(depthAt({ x: WAILUA.wx, y: g - 10, z: WAILUA.wz }, GROUND)).toBeCloseTo(10, 6);
    expect(depthAt({ x: WAILUA.wx, y: g + 10, z: WAILUA.wz }, GROUND)).toBeCloseTo(-10, 6);
    expect(solidAt({ x: WAILUA.wx, y: g - 1, z: WAILUA.wz }, GROUND)).toBe(true);
    expect(solidAt({ x: WAILUA.wx, y: g + 1, z: WAILUA.wz }, GROUND)).toBe(false);
  });

  it('points up on open ground', () => {
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    const up = normalAt({ x: WAILUA.wx, y: g, z: WAILUA.wz }, GROUND);
    // Kauai is not a billiard table, so this is "up, near enough".
    expect(up.y).toBeGreaterThan(0.9);
  });

  it('points SIDEWAYS on the side of a trunk', () => {
    // THE WHOLE MECHANISM, in one assertion. Nothing here knows what a
    // tree is; the normal turns because the field does.
    const trunks = oneTree();
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    // Out on the +x side, a metre up the trunk, just off the bark.
    const y = g + 100;
    const r = trunks.depthAt(WAILUA.wx, y, WAILUA.wz) ; // depth on the axis
    expect(r).toBeGreaterThan(0);
    const surface = WAILUA.wx + r - 0.5;
    const up = normalAt({ x: surface, y, z: WAILUA.wz }, trunks);
    expect(up.x).toBeGreaterThan(0.9);
    expect(Math.abs(up.y)).toBeLessThan(0.2);
  });

  it('turns through the join at the foot rather than jumping', () => {
    // Sample a short walk in toward the trunk at her standing height
    // and check the normal sweeps: no step bigger than the arc a
    // couple of centimetres of travel can justify.
    const trunks = oneTree();
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    const seen: number[] = [];
    for (let d = 200; d > 20; d -= 2) {
      const at = { x: WAILUA.wx + d, y: g + 2, z: WAILUA.wz };
      seen.push(normalAt(at, bothWith(trunks)).y);
    }
    // It starts up and ends tipped over.
    expect(seen[0]).toBeGreaterThan(0.9);
    expect(seen[seen.length - 1]).toBeLessThan(0.6);
    // And it got there without teleporting.
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i] - seen[i - 1])).toBeLessThan(0.75);
    }
  });

  it('casts onto the ground from above and reports the surface', () => {
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    const hit = castFor(
      { x: WAILUA.wx, y: g + 40, z: WAILUA.wz }, { x: 0, y: -1, z: 0 }, 80, GROUND,
    );
    expect(hit).not.toBeNull();
    expect(hit!.at.y).toBeCloseTo(g, 0);
    expect(hit!.up.y).toBeGreaterThan(0.9);
  });

  it('casts onto BARK sideways, which is the same call', () => {
    const trunks = oneTree();
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    const y = g + 100;
    const hit = castFor(
      { x: WAILUA.wx + 300, y, z: WAILUA.wz }, { x: -1, y: 0, z: 0 }, 400, trunks,
    );
    expect(hit).not.toBeNull();
    expect(hit!.up.x).toBeGreaterThan(0.9);
  });

  it('finds nothing in open air, and says so', () => {
    const g = groundHeight(WAILUA.wx, WAILUA.wz);
    expect(castFor(
      { x: WAILUA.wx, y: g + 5_000, z: WAILUA.wz }, { x: 0, y: -1, z: 0 }, 50, GROUND,
    )).toBeNull();
  });
});
