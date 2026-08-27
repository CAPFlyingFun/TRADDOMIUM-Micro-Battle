import { describe, expect, it } from 'vitest';
import { WaterSim } from '../src/world/waterSim';

/** A small patch, so a few thousand steps is still milliseconds. */
const small = () => new WaterSim({ n: 32, cell: 100, dt: 0.004 });

function run(sim: WaterSim, steps: number, drainEdge = false): void {
  for (let s = 0; s < steps; s++) sim.step(drainEdge);
}

describe('the pipe model over a fixed bed', () => {
  it('never writes a negative depth, however hard it is fed', () => {
    // The scaling step is what this is really testing: four pipes each
    // deciding alone can ask a cell for more than it holds.
    const sim = small();
    sim.fillBed((cx, cy) => 4000 - cx * 60 - cy * 20);
    sim.rain(200, 1);
    run(sim, 2000);
    for (let i = 0; i < sim.depth.length; i++) {
      expect(sim.depth[i]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(sim.depth[i])).toBe(true);
    }
  });

  it('conserves water when the rim is shut', () => {
    const sim = small();
    sim.fillBed((cx, cy) => 3000 - cx * 40 - cy * 40);
    sim.rain(50, 1);
    const before = sim.volume();
    run(sim, 1500);
    // Nothing is added and nothing may leave. The depths are float32
    // and the volume is half a billion cubic units, so the bar is a
    // RELATIVE one — an absolute tolerance here is a test of IEEE 754,
    // not of the solver. Measured drift over 1,500 steps: 1.4e-8.
    const drift = Math.abs(sim.volume() - before) / before;
    expect(drift).toBeLessThan(1e-6);
  });

  it('runs downhill — water leaves the high ground for the low', () => {
    const sim = small();
    // A clean ramp: high at cx = 0, low at cx = 31.
    sim.fillBed((cx) => 5000 - cx * 100);
    sim.rain(30, 1);
    run(sim, 3000);
    const half = sim.n / 2;
    let high = 0; let low = 0;
    for (let cy = 0; cy < sim.n; cy++) {
      for (let cx = 0; cx < sim.n; cx++) {
        const d = sim.depth[sim.index(cx, cy)];
        if (cx < half) high += d; else low += d;
      }
    }
    expect(low).toBeGreaterThan(high * 3);
  });

  it('pools in a basin and settles FLAT — the property none of the drawn water had', () => {
    // A bowl. Water poured in must find one level, because the pipes
    // compare bed+water and not bed. This is the whole reason to run a
    // simulation rather than to draw a ribbon.
    const sim = small();
    const mid = (sim.n - 1) / 2;
    sim.fillBed((cx, cy) => {
      const r = Math.hypot(cx - mid, cy - mid);
      return 1000 + r * r * 4;
    });
    sim.rain(40, 1, (cx, cy) => Math.hypot(cx - mid, cy - mid) < 8);
    run(sim, 6000);
    // Every wet cell should share one surface height.
    const wet: number[] = [];
    for (let i = 0; i < sim.depth.length; i++) {
      if (sim.depth[i] > 1) wet.push(sim.surface(i));
    }
    expect(wet.length).toBeGreaterThan(20);
    const lo = Math.min(...wet); const hi = Math.max(...wet);
    // Within a centimetre of level across the whole pool.
    expect(hi - lo).toBeLessThan(1);
  });

  it('spills at the lowest rim rather than over the high one', () => {
    // A bowl with one notch cut in the +x wall. Water must leave there.
    const sim = small();
    const mid = (sim.n - 1) / 2;
    sim.fillBed((cx, cy) => {
      const r = Math.hypot(cx - mid, cy - mid);
      let h = 1000 + r * r * 6;
      // The notch: a saddle on the +x side, low enough that a filling
      // bowl reaches it before it reaches any other part of the rim.
      if (cy > mid - 2 && cy < mid + 2 && cx > mid) h = Math.min(h, 1240);
      return h;
    });
    sim.rain(60, 1, (cx, cy) => Math.hypot(cx - mid, cy - mid) < 6);
    // RIM SHUT, deliberately. With it open the patch drains completely
    // and the measurement is zero against zero — which passes nothing
    // and proves nothing. Closed, the water that escapes the bowl is
    // still in the grid to be counted.
    run(sim, 6000, false);
    let plusX = 0; let minusX = 0;
    for (let cy = 0; cy < sim.n; cy++) {
      for (let cx = 0; cx < sim.n; cx++) {
        const d = sim.depth[sim.index(cx, cy)];
        if (cx > mid + 8) plusX += d;
        if (cx < mid - 8) minusX += d;
      }
    }
    expect(plusX).toBeGreaterThan(minusX * 5);
  });
});
