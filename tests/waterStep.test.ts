import { describe, expect, it } from 'vitest';
import { WaterSim } from '../src/world/waterSim';

/** Same patch, same water, different timestep. */
function pooled(dt: number): number {
  const sim = new WaterSim({ n: 48, cell: 100, dt });
  sim.fillBed((cx, cy) => 3000 - cx * 30 + Math.sin(cy / 4) * 200);
  sim.rain(100, 1);
  const seconds = 80;
  for (let s = 0; s < Math.round(seconds / dt); s++) sim.step(false);
  let deepest = 0;
  for (let i = 0; i < sim.depth.length; i++) deepest = Math.max(deepest, sim.depth[i]);
  return deepest;
}

describe('the timestep', () => {
  it('gives the same answer anywhere inside the converged range', () => {
    // Stability is not the bar — this solver survives dt = 0.8. The bar
    // is agreement: above 0.1 the pooled depth doubles, which is a
    // different simulation wearing the same name.
    const a = pooled(0.02);
    const b = pooled(0.05);
    const c = pooled(0.1);
    expect(Math.abs(b - a) / a).toBeLessThan(0.02);
    expect(Math.abs(c - a) / a).toBeLessThan(0.02);
  }, 120000);

  it('stays finite even when driven far past that range', () => {
    // Not an endorsement of dt = 0.8; a guard that a mis-set dial
    // degrades the answer rather than filling the grid with NaN.
    const sim = new WaterSim({ n: 32, cell: 100, dt: 0.8 });
    sim.fillBed((cx) => 3000 - cx * 40);
    sim.rain(200, 1);
    for (let s = 0; s < 500; s++) sim.step(false);
    for (let i = 0; i < sim.depth.length; i++) {
      expect(Number.isFinite(sim.depth[i])).toBe(true);
    }
  }, 120000);
});
