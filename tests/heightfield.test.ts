import { describe, expect, it } from 'vitest';
import { bandFor, DEFAULT_ISLAND, groundHeight } from '../src/world/heightfield';

describe('island heightfield', () => {
  it('is deterministic for the same seed', () => {
    for (const [x, z] of [
      [0, 0],
      [3.7, -12.2],
      [-25.01, 8.5],
    ]) {
      expect(groundHeight(x, z)).toBe(groundHeight(x, z));
    }
  });

  it('changes with the seed', () => {
    const a = groundHeight(5, 5, { ...DEFAULT_ISLAND, seed: 1 });
    const b = groundHeight(5, 5, { ...DEFAULT_ISLAND, seed: 2 });
    expect(a).not.toBe(b);
  });

  it('keeps the centre well above the waterline', () => {
    expect(groundHeight(0, 0)).toBeGreaterThan(DEFAULT_ISLAND.peak * 0.5);
  });

  it('is underwater everywhere on and beyond the rim', () => {
    const r = DEFAULT_ISLAND.radius;
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      for (const dist of [r, r * 1.2, r * 1.5]) {
        const h = groundHeight(Math.cos(angle) * dist, Math.sin(angle) * dist);
        // Exactly on the rim the dome is 0 up to float residue.
        expect(h).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('keeps falling past the rim so no shelf breaks the horizon', () => {
    const r = DEFAULT_ISLAND.radius;
    expect(groundHeight(r * 2, 0)).toBeLessThan(groundHeight(r * 1.2, 0));
  });

  it('keeps the same landform when the island is resized', () => {
    // Octaves are cycles across the island, not world-unit frequencies,
    // so scaling radius/peak/roughness together must scale the terrain
    // exactly — never re-roll it into different, finer-grained ground.
    const small = { radius: 100, peak: 10, roughness: 2, seed: 3 };
    const big = { radius: 200, peak: 20, roughness: 4, seed: 3 };
    for (const t of [0, 0.3, 0.62, 0.95]) {
      const a = groundHeight(small.radius * t, small.radius * t * 0.4, small);
      const b = groundHeight(big.radius * t, big.radius * t * 0.4, big);
      expect(b).toBeCloseTo(a * 2, 9);
    }
  });

  it('is big enough that a minute of walking stays inland', () => {
    // Guards the "huge tiny world" pillar: the ant walks ~6 units/s, so
    // a minute covers ~360 units and must not reach open water.
    const reach = 6 * 60;
    expect(reach).toBeLessThan(DEFAULT_ISLAND.radius);
    expect(groundHeight(0, reach)).toBeGreaterThan(0);
  });

  it('maps heights to the expected bands', () => {
    const peak = DEFAULT_ISLAND.peak;
    expect(bandFor(-1)).toBe('seabed');
    expect(bandFor(peak * 0.05)).toBe('sand');
    expect(bandFor(peak * 0.3)).toBe('grass');
    expect(bandFor(peak * 0.6)).toBe('forest');
    expect(bandFor(peak * 0.95)).toBe('rock');
  });
});
