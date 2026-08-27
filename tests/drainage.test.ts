import { describe, expect, it } from 'vitest';
import { channels, flowAccumulation } from '../src/world/drainage';

describe('D8 drainage', () => {
  it('accumulates downhill — the foot of a ramp carries everything', () => {
    const n = 16;
    const bed = new Float32Array(n * n);
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) bed[cy * n + cx] = 1000 - cy * 10;
    const acc = flowAccumulation(bed, n);
    let top = 0; let foot = 0;
    for (let cx = 0; cx < n; cx++) { top += acc[cx]; foot += acc[(n - 1) * n + cx]; }
    expect(foot).toBeGreaterThan(top * 5);
  });

  it('finds a valley floor and not its walls', () => {
    // A V running down +y: the crease should carry the water.
    const n = 32;
    const bed = new Float32Array(n * n);
    const mid = (n - 1) / 2;
    for (let cy = 0; cy < n; cy++) {
      for (let cx = 0; cx < n; cx++) bed[cy * n + cx] = 2000 - cy * 8 + Math.abs(cx - mid) * 20;
    }
    const mask = channels(bed, n, 0.01);
    let onCrease = 0; let onWall = 0;
    for (let cy = 2; cy < n - 2; cy++) {
      if (mask[cy * n + Math.round(mid)]) onCrease++;
      if (mask[cy * n + 2]) onWall++;
    }
    expect(onCrease).toBeGreaterThan(n / 2);
    expect(onWall).toBe(0);
  });

  it('conserves: every cell counts itself once', () => {
    const n = 12;
    const bed = new Float32Array(n * n);
    for (let i = 0; i < bed.length; i++) bed[i] = 500 - (i % n) * 3 - Math.floor(i / n) * 2;
    const acc = flowAccumulation(bed, n);
    for (let i = 0; i < acc.length; i++) expect(acc[i]).toBeGreaterThanOrEqual(1);
  });
});
