import { describe, expect, it } from 'vitest';
import { bakeGrain, grain, octave } from '../src/world/groundTexture';

describe('the grain tiles seamlessly', () => {
  // A seam is the one defect that only shows up on a real device, as a
  // grid printed across the whole island, so it is pinned here instead.
  it('reads the same value at both edges of one octave', () => {
    for (const y of [0, 0.13, 0.5, 0.77]) {
      expect(octave(0, y, 8, 1)).toBeCloseTo(octave(1, y, 8, 1), 12);
      expect(octave(y, 0, 8, 1)).toBeCloseTo(octave(y, 1, 8, 1), 12);
    }
  });

  it('reads the same value at both edges of the whole stack', () => {
    for (const y of [0, 0.31, 0.62, 0.94]) {
      expect(grain(0, y)).toBeCloseTo(grain(1, y), 12);
      expect(grain(y, 0)).toBeCloseTo(grain(y, 1), 12);
    }
  });

  it('wraps at the corners too', () => {
    expect(grain(0, 0)).toBeCloseTo(grain(1, 1), 12);
  });
});

describe('the grain is worth having', () => {
  it('actually varies — a constant field would leave the ground flat', () => {
    const at = [];
    for (let i = 0; i < 40; i++) at.push(grain(i / 40, (i * 7 % 40) / 40));
    const low = Math.min(...at);
    const high = Math.max(...at);
    expect(high - low).toBeGreaterThan(0.15);
  });

  it('stays inside the unit range, so it cannot blow out the colours', () => {
    for (let i = 0; i < 200; i++) {
      const v = grain((i % 20) / 20, Math.floor(i / 20) / 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is the same every boot — the island must not shimmer between loads', () => {
    expect(grain(0.42, 0.17)).toBe(grain(0.42, 0.17));
  });
});

describe('baking', () => {
  it('fills every pixel opaque', () => {
    const pixels = bakeGrain(16);
    expect(pixels.length).toBe(16 * 16 * 4);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(255);
  });

  it('centres near white, so it modulates the ground rather than dyeing it', () => {
    const pixels = bakeGrain(32);
    let total = 0;
    for (let i = 1; i < pixels.length; i += 4) total += pixels[i];
    const mean = total / (32 * 32) / 255;
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(1.05);
  });
});
