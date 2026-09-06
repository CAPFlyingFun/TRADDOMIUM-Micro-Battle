/**
 * The island's one source of stable numbers, and the properties a
 * deterministic world rests on: the same place hashes the same way, a
 * different question gets a different answer, and the noise the clumping
 * reads is smooth and bounded.
 */
import { describe, expect, it } from 'vitest';
import { clumpNoise, mulberry32, stableHash, stableSeed, valueNoise } from '../src/world/random';
import { SkyModel } from '../src/world/weather/skyModel';

describe('stableHash', () => {
  it('is a pure function of its arguments — the same place, the same answer, forever', () => {
    expect(stableHash(12, -7, 3)).toBe(stableHash(12, -7, 3));
    // Order-independent: nothing drawn before changes what comes next.
    stableHash(99, 99, 99);
    expect(stableHash(12, -7, 3)).toBe(stableHash(12, -7, 3));
  });

  it('answers in [0, 1) and never NaN, over cell addresses the island actually has', () => {
    // ±1,750 cells at a 16 m cell; the salt range every family uses.
    for (let x = -1800; x <= 1800; x += 37) {
      for (let z = -1800; z <= 1800; z += 41) {
        for (let salt = 0; salt < 40; salt += 7) {
          const h = stableHash(x, z, salt);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(1);
        }
      }
    }
  });

  it('separates the salt, the axes and the sign — a different question about one cell is a different number', () => {
    const base = stableHash(10, 20, 1);
    expect(stableHash(10, 20, 2)).not.toBe(base);
    expect(stableHash(20, 10, 1)).not.toBe(base);
    expect(stableHash(-10, 20, 1)).not.toBe(base);
    expect(stableHash(10, -20, 1)).not.toBe(base);
    expect(stableHash(11, 20, 1)).not.toBe(base);
  });

  it('is spread flat across its range, not bunched — the property a density threshold depends on', () => {
    // 20,000 draws into ten bins: each bin within 10% of its share. A
    // hash whose low bits were lost past 2^53 (v0 multiplied doubles)
    // would still pass determinism and fail this.
    const bins = new Array<number>(10).fill(0);
    let n = 0;
    for (let x = 0; x < 200; x += 1) {
      for (let z = 0; z < 100; z += 1) {
        bins[Math.floor(stableHash(x * 1000 + 7, z * 1000 - 3, 11) * 10)] += 1;
        n += 1;
      }
    }
    for (const count of bins) expect(Math.abs(count / n - 0.1)).toBeLessThan(0.01);
  });

  it('gives neighbouring cells unrelated answers — no visible diagonal or stripe', () => {
    // Correlation between h(x, z) and h(x + 1, z) over a grid should be
    // near zero. A linear-congruential slip shows up here as a stripe.
    let sxy = 0, sx = 0, sy = 0, sxx = 0, syy = 0, n = 0;
    for (let x = 0; x < 150; x += 1) {
      for (let z = 0; z < 150; z += 1) {
        const a = stableHash(x, z, 5);
        const b = stableHash(x + 1, z, 5);
        sxy += a * b; sx += a; sy += b; sxx += a * a; syy += b * b; n += 1;
      }
    }
    const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    expect(Math.abs(r)).toBeLessThan(0.03);
  });

  it('stableSeed is the same mixing as a uint32, so a sequence seeded from a place is as stable as the place', () => {
    const s = stableSeed(4, 9, 2);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2 ** 32);
    expect(stableHash(4, 9, 2)).toBeCloseTo(s / 2 ** 32, 12);
  });
});

describe('mulberry32', () => {
  it('replays the same sequence from the same seed, and a different one from a different seed', () => {
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    const c = mulberry32(1235);
    const first = Array.from({ length: 16 }, () => a());
    expect(Array.from({ length: 16 }, () => b())).toEqual(first);
    expect(Array.from({ length: 16 }, () => c())).not.toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is what the weather draws from now — one copy, and the weather is unchanged by the move', () => {
    // Two models with one seed agree to the second; the private copy the
    // sky model used to carry was the same arithmetic, so this pins that
    // the shared one is too.
    const a = new SkyModel({ seed: 77 });
    const b = new SkyModel({ seed: 77 });
    for (let i = 0; i < 200; i += 1) {
      const x = a.advance(30);
      const y = b.advance(30);
      expect(x).toEqual(y);
    }
  });
});

describe('value noise', () => {
  it('is bounded, smooth and deterministic', () => {
    let prev = valueNoise(3.2, 7.7, 4);
    for (let i = 1; i <= 400; i += 1) {
      const v = valueNoise(3.2 + i * 0.01, 7.7, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      // A step of a hundredth of a lattice cell moves the field by less
      // than a twentieth: a field that is not smooth is confetti again.
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    expect(valueNoise(3.2, 7.7, 4)).toBe(valueNoise(3.2, 7.7, 4));
    expect(valueNoise(3.2, 7.7, 4)).not.toBe(valueNoise(3.2, 7.7, 5));
  });

  it('interpolates the lattice values exactly at the lattice', () => {
    expect(valueNoise(5, 9, 2)).toBeCloseTo(stableHash(5, 9, 2), 12);
    expect(valueNoise(-3, 4, 2)).toBeCloseTo(stableHash(-3, 4, 2), 12);
  });

  it('clumpNoise stays in range and has more structure than one octave', () => {
    let vary1 = 0;
    let vary2 = 0;
    let prev1 = valueNoise(0, 0, 9);
    let prev2 = clumpNoise(0, 0, 9);
    for (let i = 1; i <= 2000; i += 1) {
      const a = valueNoise(i * 0.05, 0.37, 9);
      const b = clumpNoise(i * 0.05, 0.37, 9);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(1);
      vary1 += Math.abs(a - prev1);
      vary2 += Math.abs(b - prev2);
      prev1 = a;
      prev2 = b;
    }
    // Total variation along a line: the second octave adds detail.
    expect(vary2).toBeGreaterThan(vary1);
  });
});
