import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HYDRO_BYTES, decodeHydro, hydroFaults, type Hydro,
} from '../src/world/hydro';
import { forgetHydro, hydro, useHydro } from '../src/world/water';
import { SPAN, UNITS_PER_METRE } from '../src/world/kauai';
import { heightAt, type HeightGrid } from '../src/world/kauai';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const baked = read('public/kauai-hydro.bin');
const decoded: Hydro = decodeHydro(baked);

describe('the baked hydrography', () => {
  it('is the file the loader thinks it is', () => {
    // HYDRO_BYTES is the loading bar's maximum, and the bake rewrites it.
    // If these part company the bar counts past its own total, which is a
    // bug we have already shipped once.
    expect(baked.byteLength).toBe(HYDRO_BYTES);
  });

  it('holds the whole of Kauaʻi’s drainage', () => {
    expect(decoded.rivers).toHaveLength(1121);
    expect(decoded.x).toHaveLength(49_665);
    expect(decoded.lakes).toHaveLength(111);
  });

  it('passes its own fault check', () => {
    expect(hydroFaults(decoded)).toEqual([]);
  });

  it('lands inside the island, in world units', () => {
    const half = SPAN / 2;
    let far = 0;
    for (let i = 0; i < decoded.x.length; i++) {
      if (Math.abs(decoded.x[i]) > half || Math.abs(decoded.z[i]) > half) far++;
    }
    expect(far).toBe(0);
    // And genuinely SPREAD over it, rather than collapsed near the origin
    // — which is what a botched unit conversion looks like from here.
    let low = Infinity;
    let high = -Infinity;
    for (const v of decoded.x) { if (v < low) low = v; if (v > high) high = v; }
    expect(high - low).toBeGreaterThan(SPAN * 0.8);
  });

  it('carries real river widths, not Beyond Extinction’s 96-metre hack', () => {
    // BE floors its carve at a 96 m channel because ITS mesh samples every
    // 36.5 m. TMB's near lattice is 8 units, so the real widths survive —
    // and if this ever reads in the thousands, that hack has been ported.
    const widths = [...decoded.width].sort((a, b) => a - b);
    const median = widths[widths.length >> 1];
    expect(median / UNITS_PER_METRE).toBeGreaterThan(4);
    expect(median / UNITS_PER_METRE).toBeLessThan(8);
    expect(widths[widths.length - 1] / UNITS_PER_METRE).toBeLessThan(50);
  });

  it('knows which reaches reach the sea, and what they are called', () => {
    expect(decoded.rivers.filter((r) => r.toOcean)).toHaveLength(140);
    const named = decoded.rivers.filter((r) => r.name);
    expect(named.length).toBeGreaterThan(200);
    // Interned names must survive the round trip through the blob.
    expect(named.every((r) => (r.name as string).length > 0)).toBe(true);
    expect(decoded.rivers.some((r) => /Wailua/i.test(r.name ?? ''))).toBe(true);
  });

  it('gives every lake a shore and a waterline above the sea', () => {
    for (const lake of decoded.lakes) {
      expect(lake.rings[0].count).toBeGreaterThanOrEqual(3);
      expect(lake.level).toBeGreaterThan(0);
      expect(lake.level).toBeLessThan(1600 * UNITS_PER_METRE);
    }
    // Two of the hundred and eleven have islands in them.
    expect(decoded.lakes.filter((l) => l.rings.length > 1)).toHaveLength(2);
  });
});

describe('the rivers are on the island we actually built', () => {
  // THE CHECK A UNIT CONVERSION CANNOT PASS BY ACCIDENT. The hydrography
  // and the height grid come from the same DEM by different routes; if the
  // frames agree, the elevation under a river point matches the elevation
  // the river carries. An offset, an axis swap or a sign flip destroys the
  // agreement instantly, while still producing perfectly plausible numbers.
  const raw = readFileSync('public/kauai-1025.bin');
  const grid = new Int16Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  ) as HeightGrid;

  /** Every nth point — the full 49,665 is slow and says nothing more. */
  const STRIDE = 7;
  const under: number[] = [];
  const carried: number[] = [];
  for (let i = 0; i < decoded.x.length; i += STRIDE) {
    under.push(heightAt(grid, decoded.x[i], decoded.z[i]));
    carried.push(decoded.y[i]);
  }

  it('puts every river point on dry land', () => {
    const wet = under.filter((h) => h <= 0).length;
    expect(wet / under.length).toBeLessThan(0.02);
  });

  it('agrees with the island about how high the water is', () => {
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const mu = mean(under);
    const mv = mean(carried);
    let cov = 0;
    let vu = 0;
    let vv = 0;
    for (let i = 0; i < under.length; i++) {
      const a = under[i] - mu;
      const b = carried[i] - mv;
      cov += a * b; vu += a * a; vv += b * b;
    }
    expect(cov / Math.sqrt(vu * vv)).toBeGreaterThan(0.99);
  });

  it('AND THE CHECK HAS TEETH — the corner mistake fails it', () => {
    // The specific bug this whole verification exists for. TMB's grid is
    // addressed from the CENTRE; had it been addressed from a corner, the
    // conversion would need a +SPAN/2 that nobody would notice missing,
    // because a river a kilometre off still reads as a plausible river.
    // Shift the points that far and the agreement must collapse — if it
    // survives, the test above is measuring nothing.
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const moved: number[] = [];
    for (let i = 0; i < decoded.x.length; i += STRIDE) {
      moved.push(heightAt(grid, decoded.x[i] + SPAN / 2, decoded.z[i]));
    }
    const mu = mean(moved);
    const mv = mean(carried);
    let cov = 0;
    let vu = 0;
    let vv = 0;
    for (let i = 0; i < moved.length; i++) {
      const a = moved[i] - mu;
      const b = carried[i] - mv;
      cov += a * b; vu += a * a; vv += b * b;
    }
    expect(cov / Math.sqrt(vu * vv)).toBeLessThan(0.5);
  });

  it('sits close to the valley floor, not on the ridge above it', () => {
    // The grid samples every 54.6 m and a river runs along the bottom of a
    // valley narrower than that, so the grid reads a little HIGH almost
    // everywhere. A little. Tens of metres, not hundreds.
    const gap = under.map((h, i) => (h - carried[i]) / UNITS_PER_METRE);
    const sorted = [...gap].sort((a, b) => a - b);
    expect(Math.abs(sorted[sorted.length >> 1])).toBeLessThan(10);
    expect(Math.abs(sorted[Math.floor(sorted.length * 0.95)])).toBeLessThan(60);
  });
});

describe('refusing a file it cannot trust', () => {
  it('rejects one that does not start with TMBH', () => {
    const wrong = baked.slice(0);
    new DataView(wrong).setUint32(0, 0xdeadbeef, true);
    expect(() => decodeHydro(wrong)).toThrow(/TMBH/);
  });

  it('rejects a version it does not know', () => {
    const wrong = baked.slice(0);
    new DataView(wrong).setUint16(4, 99, true);
    expect(() => decodeHydro(wrong)).toThrow(/version 99/);
  });

  it('rejects one that arrived short', () => {
    // The failure that otherwise shows up as a river through the sea.
    expect(() => decodeHydro(baked.slice(0, baked.byteLength - 64)))
      .toThrow(/bytes and is/);
  });

  it('rejects a header whose counts do not describe the file', () => {
    const wrong = baked.slice(0);
    new DataView(wrong).setUint32(12, 49_664, true);
    expect(() => decodeHydro(wrong)).toThrow(/bytes and is/);
  });

  it('rejects something that is not a file at all', () => {
    expect(() => decodeHydro(new ArrayBuffer(8))).toThrow(/not a file/);
  });
});

describe('the island holds one set of water', () => {
  it('hands back what it was given, and nothing before that', () => {
    // NULLABLE ON PURPOSE. The island lab boots straight into the world
    // and the probes do not wait for the menu, so anything that assumes
    // the hydrography is present fails exactly where we test.
    forgetHydro();
    expect(hydro()).toBeNull();
    useHydro(decoded);
    expect(hydro()?.rivers).toHaveLength(1121);
    forgetHydro();
    expect(hydro()).toBeNull();
  });
});
