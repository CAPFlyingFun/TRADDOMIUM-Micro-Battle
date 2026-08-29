/**
 * THE SEA MOVES HER SIDEWAYS — the half that was missing.
 *
 * The salt-water query answered `flowX: 0, flowZ: 0`, and `wadeAt`
 * only carries her when the flow is non-zero, so the ocean heaved a
 * floating queen up and down and never carried her an inch. These
 * tests hold the restored surf to what it claims: orbital motion that
 * comes back where it started out deep, a breaking surge that does
 * not, and a net that is SHOREWARD over whole wave cycles.
 *
 * Run on the real island, through the same helper the water tests use,
 * because `shoreward` reads the drawn ground and a flat test plane has
 * no shore to run up.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadIsland } from './support/island';
import { groundHeight } from '../src/world/heightfield';
import {
  BACKWASH, BREAKER_INDEX, breaksAt, shoreward, surfFlowAt,
} from '../src/world/surf';
import {
  resetSwell, seaOrbitalAt, seaSwellAt, swellAmplitude, tickSwell,
} from '../src/world/seaSwell';

/**
 * A REAL PIECE OF COAST at about the depth asked for, found by
 * scanning rather than by naming a coordinate.
 *
 * Naming one was the first attempt and it was wrong twice over: a
 * lat/lon through `geoToWorld` landed six metres UP THE BEACH — the
 * probe reaches its fix through the game's own parser, which is not
 * this conversion — and the tests then measured a sea that was not
 * there and passed a zero as agreement. A scan cannot be stale, and it
 * insists on a shoreward vector, which is what the breaking half needs.
 */
function findDepth(want: number): { wx: number; wz: number; ground: number } {
  let best: { wx: number; wz: number; ground: number } | null = null;
  let closest = Infinity;
  for (let wx = -2_400_000; wx <= 2_400_000; wx += 40_000) {
    for (let wz = -2_400_000; wz <= 2_400_000; wz += 40_000) {
      const ground = groundHeight(wx, wz);
      if (ground >= 0) continue;
      const miss = Math.abs(-ground - want);
      if (miss >= closest) continue;
      if (!shoreward(wx, wz)) continue;
      closest = miss;
      best = { wx, wz, ground };
    }
  }
  if (!best) throw new Error(`no sea near ${want} units deep`);
  return best;
}

/**
 * Advect a drifter through the flow for a while and report where it
 * ended up, relative to the shore direction where it started. This is
 * the only honest way to ask "does the sea carry her in": the flow is
 * an oscillation, and one instant of it says nothing about the net.
 */
function drift(
  start: { wx: number; wz: number }, seconds: number, dt = 1 / 60,
): { along: number; x: number; z: number } {
  const up = shoreward(start.wx, start.wz) ?? { x: 0, z: 0 };
  let wx = start.wx;
  let wz = start.wz;
  resetSwell();
  for (let t = 0; t < seconds; t += dt) {
    tickSwell(dt);
    const ground = groundHeight(wx, wz);
    const surface = seaSwellAt(wx, wz, -ground);
    const depth = -ground + surface;
    if (depth <= 0) break;
    const flow = surfFlowAt(wx, wz, depth, surface);
    wx += flow.x * dt;
    wz += flow.z * dt;
  }
  const dx = wx - start.wx;
  const dz = wz - start.wz;
  return { along: dx * up.x + dz * up.z, x: dx, z: dz };
}

beforeAll(() => {
  loadIsland();
  resetSwell();
});

describe('the open sea', () => {
  it('has a real orbital current — she is not sitting still any more', () => {
    const deep = findDepth(700);
    resetSwell();
    let peak = 0;
    for (let i = 0; i < 200; i++) {
      tickSwell(1 / 60);
      const flow = seaOrbitalAt(deep.wx, deep.wz, 700);
      peak = Math.max(peak, Math.hypot(flow.x, flow.z));
    }
    // Her paddle is 2.6 units/s. The sea is an order more than that,
    // which is the point: an ant does not out-swim the ocean.
    expect(peak).toBeGreaterThan(20);
  });

  it('comes back where it started — a swell rocks, it does not tow', () => {
    const deep = findDepth(900);
    // Whole wave cycles: the orbit closes, so the net is a small
    // fraction of how far the water actually travelled each way.
    const travelled = (() => {
      resetSwell();
      let sum = 0;
      for (let i = 0; i < 600; i++) {
        tickSwell(1 / 60);
        const flow = seaOrbitalAt(deep.wx, deep.wz, 900);
        sum += Math.hypot(flow.x, flow.z) / 60;
      }
      return sum;
    })();
    const net = Math.hypot(drift(deep, 10).x, drift(deep, 10).z);
    expect(travelled).toBeGreaterThan(50);
    expect(net).toBeLessThan(travelled * 0.5);
  });
});

describe('the surf', () => {
  it('breaks where the wave height says it does, not at a constant', () => {
    // Breaker index: a wave breaks in water about its own height.
    expect(BREAKER_INDEX).toBeCloseTo(0.78, 6);
    // Deep water is not breaking; the shallows are.
    expect(breaksAt(1000)).toBeLessThan(1000);
    expect(breaksAt(40)).toBeGreaterThan(40);
    // And the depth it breaks in grows with the shoaled wave.
    expect(breaksAt(40)).toBeGreaterThan(2 * swellAmplitude());
  });

  it('runs up harder than it drains back', () => {
    expect(BACKWASH).toBeLessThan(1);
    const shallow = findDepth(50);
    const up = shoreward(shallow.wx, shallow.wz);
    expect(up).not.toBeNull();
    resetSwell();
    let inward = 0;
    let outward = 0;
    for (let i = 0; i < 600; i++) {
      tickSwell(1 / 60);
      const surface = seaSwellAt(shallow.wx, shallow.wz, -shallow.ground);
      const depth = -shallow.ground + surface;
      if (depth <= 0) continue;
      const flow = surfFlowAt(shallow.wx, shallow.wz, depth, surface);
      const along = flow.x * up!.x + flow.z * up!.z;
      if (along > 0) inward += along; else outward -= along;
    }
    // The surge toward the land beats the water going back out.
    expect(inward).toBeGreaterThan(outward);
  });

  it('carries a floating queen TOWARD the land over whole cycles', () => {
    const shallow = findDepth(60);
    const moved = drift(shallow, 12);
    expect(moved.along).toBeGreaterThan(0);
    // And it is a real distance, not a rounding error — she is an
    // ant, so tens of units is tens of body lengths.
    expect(moved.along).toBeGreaterThan(20);
  });

  it('still washes her in at the frame rate the phone actually runs', () => {
    // THE DEVICE IS NOT A TEST RIG. The probe's headless renderer
    // manages about 1.5 frames a second, which advances the swell 168
    // degrees a step: the flow it samples is aliased into noise and
    // the net drift it measures is meaningless in either direction.
    // The phone runs at about sixteen, which is twenty-four samples a
    // wave, and that is the number this asserts against — otherwise
    // the only evidence for shoreward drift would come from a rate
    // nobody plays at.
    const shallow = findDepth(60);
    for (const rate of [60, 30, 16]) {
      const moved = drift(shallow, 12, 1 / rate);
      expect(moved.along, `${rate} Hz`).toBeGreaterThan(20);
    }
  });

  it('has no rail against the open sea — swimming exists now', () => {
    // The pre-swimming build forbade any seaward component past ten
    // body lengths of water. Deep water must be free to push her out
    // as well as in, or the ocean is a funnel.
    const deep = findDepth(900);
    resetSwell();
    const up = shoreward(deep.wx, deep.wz) ?? { x: 1, z: 0 };
    let sawSeaward = false;
    for (let i = 0; i < 400; i++) {
      tickSwell(1 / 60);
      const surface = seaSwellAt(deep.wx, deep.wz, -deep.ground);
      const flow = surfFlowAt(deep.wx, deep.wz, -deep.ground + surface, surface);
      if (flow.x * up.x + flow.z * up.z < 0) sawSeaward = true;
    }
    expect(sawSeaward).toBe(true);
  });
});
