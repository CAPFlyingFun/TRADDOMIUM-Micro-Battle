/**
 * THE REGIME — the envelope a procedural sea will be generated inside.
 *
 * Nothing here makes a wave. What these guard is that the four
 * statistics NDBC reports are turned into an envelope correctly, that
 * the same inputs always give the same ocean, and above all that the
 * energy arithmetic is the right arithmetic: significant height is
 * defined from VARIANCE, and the tempting `A = Hs/2` overstates a sea
 * by 41%.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeaObservation } from '../src/weather/ndbc';
import {
  BROAD_SPREAD_DEG, NARROW_SPREAD_DEG, SEA_CACHE_GOOD_MS, SEA_REFRESH_MS,
  TYPICAL_SEA, energyAmplitude, seaSeed, significantFor, sourceFor,
  toSeaRegime, towardFrom, varianceFor, wrapDeg, type SeaObservation,
} from '../src/weather/seaState';

const OBS = parseSeaObservation(readFileSync('tests/fixtures/51208.rss', 'utf8'))!;
const NOW = OBS.observedAt + 5 * 60 * 1000; // five minutes later
const SEED = 1234;

describe('the energy arithmetic', () => {
  it('is variance, not half the significant height', () => {
    const Hs = 1.3;
    // Hs = 4*sqrt(m0), and one sinusoid has variance A^2/2.
    expect(varianceFor(Hs)).toBeCloseTo((Hs / 4) ** 2, 12);
    expect(energyAmplitude(Hs)).toBeCloseTo(Hs / (2 * Math.SQRT2), 12);
    // The trap, stated as a number: Hs/2 carries 41% too much sea.
    const naive = Hs / 2;
    const implied = 4 * Math.sqrt(naive * naive / 2);
    expect(implied / Hs).toBeCloseTo(1.4142, 3);
  });

  it('round-trips a budget back to the height it stands for', () => {
    for (const Hs of [0.4, 1.3, 2.7, 6]) {
      expect(significantFor(varianceFor(Hs))).toBeCloseTo(Hs, 12);
    }
  });

  it('an energy-matched pair spends exactly the budget', () => {
    const Hs = 1.3;
    const m0 = varianceFor(Hs);
    // Any split obeying A1^2 + A2^2 = 2*m0 reproduces the sea.
    const a1 = Math.sqrt(0.7 * 2 * m0);
    const a2 = Math.sqrt(0.3 * 2 * m0);
    expect(significantFor((a1 * a1 + a2 * a2) / 2)).toBeCloseTo(Hs, 12);
  });
});

describe('direction', () => {
  it('turns NDBC\'s FROM into TMB\'s TOWARD', () => {
    expect(towardFrom(81)).toBe(261);
    expect(towardFrom(261)).toBe(81);
    expect(towardFrom(0)).toBe(180);
    expect(towardFrom(350)).toBe(170);
  });

  it('wraps rather than running off the compass', () => {
    expect(wrapDeg(-10)).toBe(350);
    expect(wrapDeg(730)).toBe(10);
  });
});

describe('the regime from the real observation', () => {
  const regime = toSeaRegime(OBS, SEED, NOW);

  it('carries the whole measured energy as the MACRO budget', () => {
    // Joshua's correction: the ant-scale meso waves are additional
    // local character, NOT a slice taken out of what the buoy measured.
    expect(significantFor(regime.varianceM2)).toBeCloseTo(OBS.significantWaveHeightM, 9);
  });

  it('centres the period on DPD and the heading on MWD turned around', () => {
    expect(regime.dominantPeriodS).toBe(6);
    expect(regime.towardDeg).toBe(261);
  });

  it('reads the sea\'s breadth from APD/DPD, not as a second wave', () => {
    // 4.8/6 = 0.8 — between a JONSWAP peak and a fully developed sea,
    // so a moderately broad wind sea rather than a clean swell.
    expect(regime.periodSpread).toBeGreaterThan(0.4);
    expect(regime.periodSpread).toBeLessThan(0.8);
    expect(regime.directionSpreadDeg).toBeGreaterThan(NARROW_SPREAD_DEG);
    expect(regime.directionSpreadDeg).toBeLessThan(BROAD_SPREAD_DEG);
    // Narrow seas group hardest; this one is broad, so it groups less.
    expect(regime.grouping).toBeCloseTo(1 - regime.periodSpread, 12);
  });

  it('is live, and remembers when it was measured', () => {
    expect(regime.source).toBe('live');
    expect(regime.observedAt).toBe(OBS.observedAt);
  });
});

describe('breadth across the range of seas', () => {
  const withPeriods = (dpd: number, apd: number): SeaObservation =>
    ({ ...OBS, dominantPeriodS: dpd, averagePeriodS: apd });

  it('a clean swell is narrow and tightly directional', () => {
    const r = toSeaRegime(withPeriods(14, 13.2), SEED, NOW); // ratio 0.94
    expect(r.periodSpread).toBe(0);
    expect(r.directionSpreadDeg).toBe(NARROW_SPREAD_DEG);
    expect(r.grouping).toBe(1);
  });

  it('a confused wind sea is broad and fans wide', () => {
    const r = toSeaRegime(withPeriods(5, 3.4), SEED, NOW); // ratio 0.68
    expect(r.periodSpread).toBe(1);
    expect(r.directionSpreadDeg).toBe(BROAD_SPREAD_DEG);
    expect(r.grouping).toBe(0);
  });

  it('never believes a mean period past the peak', () => {
    // A spectrum's mean cannot sit beyond its own peak; a feed saying
    // so is clamped rather than turned into a negative spread.
    const r = toSeaRegime(withPeriods(6, 9), SEED, NOW);
    expect(r.averagePeriodS).toBe(6);
    expect(r.periodSpread).toBe(0);
  });
});

describe('freshness', () => {
  it('is measured on the OBSERVATION, not on the download', () => {
    expect(sourceFor(OBS, OBS.observedAt + 60_000)).toBe('live');
    expect(sourceFor(OBS, OBS.observedAt + SEA_REFRESH_MS * 3)).toBe('cached');
    expect(sourceFor(OBS, OBS.observedAt + SEA_CACHE_GOOD_MS + 1)).toBe('fallback');
    expect(sourceFor(null, NOW)).toBe('fallback');
  });

  it('tolerates a clock a little behind the buoy', () => {
    expect(sourceFor(OBS, OBS.observedAt - 60_000)).toBe('live');
  });

  it('falls back to the typical sea, with no observation time', () => {
    const stale = toSeaRegime(OBS, SEED, OBS.observedAt + SEA_CACHE_GOOD_MS + 1);
    expect(stale.source).toBe('fallback');
    expect(stale.observedAt).toBeNull();
    expect(stale.dominantPeriodS).toBe(TYPICAL_SEA.dominantPeriodS);
    // The fallback runs through the very same conversion, so offline
    // and live can never take different code paths.
    expect(stale.towardDeg).toBe(towardFrom(TYPICAL_SEA.meanFromDeg));
  });
});

describe('deterministic seeding', () => {
  it('same world, station and observation — same ocean', () => {
    expect(seaSeed(SEED, '51208', OBS.observedAt))
      .toBe(seaSeed(SEED, '51208', OBS.observedAt));
    expect(toSeaRegime(OBS, SEED, NOW).seed).toBe(toSeaRegime(OBS, SEED, NOW).seed);
  });

  it('a different world, station or reading is a different ocean', () => {
    const base = seaSeed(SEED, '51208', OBS.observedAt);
    expect(seaSeed(SEED + 1, '51208', OBS.observedAt)).not.toBe(base);
    expect(seaSeed(SEED, '51209', OBS.observedAt)).not.toBe(base);
    expect(seaSeed(SEED, '51208', OBS.observedAt + 1)).not.toBe(base);
  });

  it('is a 32-bit unsigned integer, so it can seed anything', () => {
    for (const t of [0, 1, OBS.observedAt, 2 ** 40]) {
      const s = seaSeed(SEED, '51208', t);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it('spreads: consecutive readings do not land near each other', () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 500; i++) seeds.add(seaSeed(SEED, '51208', OBS.observedAt + i * 1800_000));
    expect(seeds.size).toBe(500);
  });
});

describe('what Stage A deliberately does NOT do', () => {
  /**
   * The CODE, without the prose. These files talk about Math.random
   * and about seaSwell at length — saying why they do not use them —
   * so a naive grep over the whole text fails on its own commentary.
   */
  const code = (path: string): string => readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const SOURCE = code('src/weather/seaState.ts') + code('src/weather/ndbc.ts');

  it('never reaches for Math.random — the sea must be reproducible', () => {
    expect(SOURCE).not.toMatch(/Math\s*\.\s*random/);
  });

  it('does not touch the ocean the game is drawing', () => {
    // The regime is data. If Stage A ever imported seaSwell the
    // layering would have collapsed and a reading could reach a wave.
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*(seaSwell|Ocean|waterLook|surf)['"]/);
    expect(SOURCE).not.toMatch(/\bWAVES\b/);
  });

  it('keeps the stripper honest', () => {
    // If the stripper silently ate everything the two guards above
    // would pass on an empty string, which is the classic way a
    // negative test stops testing anything.
    expect(SOURCE).toMatch(/export function toSeaRegime/);
    expect(SOURCE).toMatch(/export function parseSeaObservation/);
    expect(SOURCE.length).toBeGreaterThan(1500);
  });
});
