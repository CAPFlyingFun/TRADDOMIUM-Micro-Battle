/**
 * THE PROCEDURAL SEA — deterministic, on budget, and physically real.
 *
 * The generator's whole claim is that it makes an IRREGULAR sea out of
 * a statistical regime without either of the two failure modes: a
 * perfectly repeating cosine on one side, and noise-instead-of-water on
 * the other. These tests hold it to both, plus the properties that make
 * it usable at all — reproducibility, an energy budget it actually
 * spends, and dispersion that is not merely decorative.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSeaObservation } from '../src/weather/ndbc';
import {
  significantFor, toSeaRegime, type SeaObservation, type SeaRegime,
} from '../src/weather/seaState';
import {
  G_SI, GOLDEN, MACRO_COUNT, MAX_GROUP_DEPTH, MESO_COUNT,
  MESO_SIGNIFICANT_M, amplitudeAt, generateWaveField, groupEnvelope,
  significantAt, surfaceAt, varianceAt, wavelengthFor,
} from '../src/weather/waveField';

const OBS = parseSeaObservation(readFileSync('tests/fixtures/51208.rss', 'utf8'))!;
const NOW = OBS.observedAt + 60_000;
const REGIME = toSeaRegime(OBS, 1234, NOW);
const FIELD = generateWaveField(REGIME);

const macro = (f = FIELD) => f.components.filter((c) => c.scale === 'macro');
const meso = (f = FIELD) => f.components.filter((c) => c.scale === 'meso');
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** A regime with the knobs set by hand, for the sweeps. */
function regimeWith(over: Partial<SeaRegime>): SeaRegime {
  return { ...REGIME, ...over };
}

describe('determinism', () => {
  it('same regime, same ocean — every field, every component', () => {
    expect(generateWaveField(REGIME)).toEqual(generateWaveField(REGIME));
  });

  it('a different seed is a different ocean, not a shifted one', () => {
    const other = generateWaveField(regimeWith({ seed: REGIME.seed + 1 }));
    expect(other.components).not.toEqual(FIELD.components);
    // Different in the details, identical in what it was built to.
    expect(other.macroVarianceM2).toBe(FIELD.macroVarianceM2);
  });

  it('the surface itself replays exactly', () => {
    const a = generateWaveField(REGIME);
    const b = generateWaveField(REGIME);
    for (const t of [0, 3.7, 41.2, 600]) {
      expect(surfaceAt(a, 12.5, -8.25, t)).toBe(surfaceAt(b, 12.5, -8.25, t));
    }
  });

  it('rolls no dice after generation', () => {
    // Two evaluations of the same instant, far apart in call order.
    const first = surfaceAt(FIELD, 3, 4, 12.5);
    for (let i = 0; i < 100; i++) surfaceAt(FIELD, i, i, i);
    expect(surfaceAt(FIELD, 3, 4, 12.5)).toBe(first);
  });

  it('the source never reaches for Math.random in the frame loop', () => {
    const code = readFileSync('src/weather/waveField.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/Math\s*\.\s*random/);
    expect(code).toMatch(/export function generateWaveField/);
  });
});

describe('the component budget', () => {
  it('is small enough for a phone', () => {
    expect(FIELD.components).toHaveLength(MACRO_COUNT + MESO_COUNT);
    expect(FIELD.components.length).toBeLessThanOrEqual(6);
  });

  it('spends its irregularity on spread, not on count', () => {
    // Every macro component must differ in period, or they are one
    // wave drawn three times and the sea repeats.
    const periods = macro().map((c) => c.periodS);
    expect(new Set(periods.map((p) => p.toFixed(4))).size).toBe(periods.length);
    const headings = macro().map((c) => c.towardDeg);
    expect(new Set(headings.map((h) => h.toFixed(4))).size).toBe(headings.length);
    const phases = FIELD.components.map((c) => c.phase);
    expect(new Set(phases.map((p) => p.toFixed(6))).size).toBe(phases.length);
  });
});

describe('physical consistency', () => {
  it('derives wavelength from period, never independently', () => {
    for (const c of FIELD.components) {
      expect(c.wavelengthM).toBeCloseTo(wavelengthFor(c.periodS), 9);
      expect(c.k).toBeCloseTo((2 * Math.PI) / c.wavelengthM, 9);
      expect(c.omega).toBeCloseTo((2 * Math.PI) / c.periodS, 9);
    }
  });

  it('satisfies the deep-water dispersion relation', () => {
    // omega^2 = g*k is the whole reason L is not a free parameter.
    for (const c of FIELD.components) {
      expect(c.omega * c.omega).toBeCloseTo(G_SI * c.k, 6);
    }
  });

  it('gives the same omega in centimetres as in metres', () => {
    // The game runs at 1 unit = 1 cm with g = 981. If this did not
    // hold, Stage C's conversion would silently change the sea's speed.
    for (const c of FIELD.components) {
      const kCm = (2 * Math.PI) / (c.wavelengthM * 100);
      expect(Math.sqrt(981 * kCm)).toBeCloseTo(c.omega, 9);
    }
  });

  it('carries a unit propagation vector on TMB\'s compass', () => {
    for (const c of FIELD.components) {
      expect(Math.hypot(c.dirX, c.dirZ)).toBeCloseTo(1, 12);
    }
    // 0 deg is -z (north), 90 is +x (east).
    const north = generateWaveField(regimeWith({ towardDeg: 0, directionSpreadDeg: 0 }));
    expect(north.components[0].dirX).toBeCloseTo(0, 9);
    expect(north.components[0].dirZ).toBeCloseTo(-1, 9);
  });
});

describe('the energy budget', () => {
  it('spends the macro budget exactly, before modulation', () => {
    const base = macro().reduce((s, c) => s + (c.amplitudeM * c.amplitudeM) / 2, 0);
    // Within the envelope normalisation, which is measured rather than
    // assumed — see envelopeRms.
    expect(significantFor(base)).toBeCloseTo(REGIME.significantHeightM, 1);
  });

  it('averages to the observed significant height over time', () => {
    // The real claim: modulation reshapes the sea without inflating it.
    const samples: number[] = [];
    for (let t = 0; t < 4000; t += 2) samples.push(varianceAt(FIELD, t, 'macro'));
    expect(significantFor(mean(samples)))
      .toBeCloseTo(REGIME.significantHeightM, 2);
  });

  it('keeps the meso sea OUT of the buoy\'s budget', () => {
    // A 0.5 Hz Waverider cannot see centimetre chop, so local waves are
    // additional character — not a slice of what NDBC measured.
    const mesoVar = meso().reduce((s, c) => s + (c.amplitudeM * c.amplitudeM) / 2, 0);
    expect(significantFor(mesoVar)).toBeCloseTo(MESO_SIGNIFICANT_M, 1);
    expect(FIELD.macroVarianceM2).toBe(REGIME.varianceM2);
  });

  it('scales the local chop without touching the measured sea', () => {
    const quiet = generateWaveField(REGIME, { mesoScale: 0.5 });
    expect(quiet.macroVarianceM2).toBe(FIELD.macroVarianceM2);
    expect(quiet.mesoVarianceM2).toBeCloseTo(FIELD.mesoVarianceM2 * 0.25, 9);
  });

  it('grows with the sea, and vanishes with it', () => {
    const big = generateWaveField(toSeaRegime(
      { ...OBS, significantWaveHeightM: 4 } as SeaObservation, 1234, NOW));
    expect(significantAt(big, 100, 'macro'))
      .toBeGreaterThan(significantAt(FIELD, 100, 'macro'));
    const flat = generateWaveField(toSeaRegime(
      { ...OBS, significantWaveHeightM: 0 } as SeaObservation, 1234, NOW));
    expect(macro(flat)).toHaveLength(0);
  });
});

describe('no rogue waves', () => {
  it('bounds the surface by the reach it advertises', () => {
    let worst = 0;
    for (let t = 0; t < 1200; t += 0.37) {
      for (let x = 0; x < 60; x += 7) {
        worst = Math.max(worst, Math.abs(surfaceAt(FIELD, x, x * 0.3, t)));
      }
    }
    expect(worst).toBeLessThanOrEqual(FIELD.maxReachM + 1e-9);
    // And the reach is a sane multiple of the sea, not a cliff.
    expect(FIELD.maxReachM).toBeLessThan(REGIME.significantHeightM * 3);
  });

  it('never lets an envelope leave its band', () => {
    for (const c of FIELD.components) {
      for (let t = 0; t < 3000; t += 1.3) {
        const e = groupEnvelope(c, t);
        expect(e).toBeGreaterThanOrEqual(1 - c.groupDepth - 1e-12);
        expect(e).toBeLessThanOrEqual(1 + c.groupDepth + 1e-12);
      }
      expect(c.groupDepth).toBeLessThanOrEqual(MAX_GROUP_DEPTH);
    }
  });
});

describe('the period distribution', () => {
  it('centres on the dominant period, and is UNBIASED', () => {
    expect(mean(macro().map((c) => c.periodS)))
      .toBeCloseTo(REGIME.dominantPeriodS, 0);
    // Again the real claim: no lean across seeds, so the sea a player
    // gets is not systematically faster or slower than the buoy said.
    const all: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      all.push(...macro(generateWaveField(regimeWith({ seed }))).map((c) => c.periodS));
    }
    expect(mean(all)).toBeCloseTo(REGIME.dominantPeriodS, 1);
  });

  it('puts most of the energy nearest the peak', () => {
    const sorted = [...macro()].sort(
      (a, b) => Math.abs(a.periodS - REGIME.dominantPeriodS)
        - Math.abs(b.periodS - REGIME.dominantPeriodS));
    expect(sorted[0].amplitudeM).toBeGreaterThan(sorted[sorted.length - 1].amplitudeM);
  });

  it('spreads wider for a broad sea than for a clean swell', () => {
    const spreadOf = (periodSpread: number) => {
      const f = generateWaveField(regimeWith({ periodSpread }));
      const p = macro(f).map((c) => c.periodS);
      return Math.max(...p) - Math.min(...p);
    };
    expect(spreadOf(1)).toBeGreaterThan(spreadOf(0) * 2);
  });
});

describe('the direction distribution', () => {
  it('centres on the regime\'s heading, and is UNBIASED', () => {
    // Averaged as OFFSETS, because a naive mean of bearings breaks
    // across north.
    const offsets = (f = FIELD) => macro(f).map(
      (c) => ((c.towardDeg - REGIME.towardDeg + 540) % 360) - 180);
    // Three stratified samples on a 20-degree fan will not land dead
    // on the centre, and demanding that they do would be testing luck
    // rather than the generator: one degree of slack per component.
    expect(Math.abs(mean(offsets())))
      .toBeLessThan(REGIME.directionSpreadDeg / MACRO_COUNT);
    // The property that actually matters is that it does not LEAN.
    // Across many seeds the bias has to vanish.
    const all: number[] = [];
    for (let seed = 0; seed < 200; seed++) {
      all.push(...offsets(generateWaveField(regimeWith({ seed }))));
    }
    expect(Math.abs(mean(all))).toBeLessThan(1);
  });

  it('stays inside the fan the regime allows', () => {
    for (const c of macro()) {
      const off = ((c.towardDeg - REGIME.towardDeg + 540) % 360) - 180;
      expect(Math.abs(off)).toBeLessThanOrEqual(REGIME.directionSpreadDeg + 1e-9);
    }
  });

  it('fans wider for a confused sea than for a swell', () => {
    const fanOf = (directionSpreadDeg: number) => {
      const f = generateWaveField(regimeWith({ directionSpreadDeg }));
      const d = macro(f).map((c) => c.towardDeg);
      return Math.max(...d) - Math.min(...d);
    };
    expect(fanOf(28)).toBeGreaterThan(fanOf(4));
  });
});

describe('wave groups', () => {
  it('modulates over MANY seconds, not every crest', () => {
    const c = macro()[0];
    // Across one wave period the envelope must barely move; across a
    // minute it must have moved a lot. That ratio IS "grouping".
    let perWave = 0;
    let perMinute = 0;
    for (let t = 0; t < 600; t += c.periodS) {
      perWave = Math.max(perWave, Math.abs(groupEnvelope(c, t + c.periodS) - groupEnvelope(c, t)));
      perMinute = Math.max(perMinute, Math.abs(groupEnvelope(c, t + 60) - groupEnvelope(c, t)));
    }
    expect(perWave).toBeLessThan(perMinute / 4);
  });

  it('is smooth — no step a player could see', () => {
    const c = macro()[0];
    let worst = 0;
    for (let t = 0; t < 900; t += 1 / 60) {
      worst = Math.max(worst, Math.abs(groupEnvelope(c, t + 1 / 60) - groupEnvelope(c, t)));
    }
    // A frame may not move the envelope by a thousandth.
    expect(worst).toBeLessThan(1e-3);
  });

  it('groups harder in a narrow sea than a broad one', () => {
    const swing = (grouping: number) => {
      const f = generateWaveField(regimeWith({ grouping }));
      const seen: number[] = [];
      for (let t = 0; t < 3000; t += 5) seen.push(varianceAt(f, t, 'macro'));
      return Math.max(...seen) - Math.min(...seen);
    };
    expect(swing(1)).toBeGreaterThan(swing(0.1) * 2);
  });

  it('reports the amplitude the component is actually carrying', () => {
    // amplitudeAt is what a renderer or a query will ask; it must be
    // the base amplitude wearing the envelope, and nothing else.
    for (const c of FIELD.components) {
      for (const t of [0, 17.5, 233.1]) {
        expect(amplitudeAt(c, t)).toBeCloseTo(c.amplitudeM * groupEnvelope(c, t), 12);
      }
    }
  });

  it('a sea with no grouping is steady, not frozen', () => {
    const f = generateWaveField(regimeWith({ grouping: 0 }));
    for (const c of macro(f)) expect(groupEnvelope(c, 123.4)).toBe(1);
    // Still a moving sea: the components themselves travel.
    expect(surfaceAt(f, 5, 5, 0)).not.toBe(surfaceAt(f, 5, 5, 3));
  });

  it('gives each component its own envelope, off the integer rows', () => {
    // windField's lesson: a whole row collapses the field and makes two
    // signals agree far more than they should.
    for (const c of FIELD.components) {
      expect(Number.isInteger(c.noiseRow)).toBe(false);
    }
    expect(GOLDEN).toBeCloseTo(0.6180339887, 9);
    const rows = FIELD.components.map((c) => c.noiseRow);
    expect(new Set(rows).size).toBe(rows.length);
    // …and they genuinely differ at the same instant.
    const at = macro().map((c) => groupEnvelope(c, 137.5));
    expect(new Set(at.map((v) => v.toFixed(6))).size).toBeGreaterThan(1);
  });
});

describe('the surface it makes', () => {
  it('travels — a crest passes a fixed point', () => {
    const readings: number[] = [];
    for (let t = 0; t < 30; t += 0.25) readings.push(surfaceAt(FIELD, 0, 0, t));
    expect(Math.max(...readings) - Math.min(...readings)).toBeGreaterThan(0.2);
  });

  it('is continuous in time and in space', () => {
    let worstT = 0;
    let worstX = 0;
    for (let t = 0; t < 120; t += 1 / 60) {
      worstT = Math.max(worstT, Math.abs(
        surfaceAt(FIELD, 4, -2, t + 1 / 60) - surfaceAt(FIELD, 4, -2, t)));
    }
    for (let x = 0; x < 120; x += 0.05) {
      worstX = Math.max(worstX, Math.abs(
        surfaceAt(FIELD, x + 0.05, 0, 10) - surfaceAt(FIELD, x, 0, 10)));
    }
    // A frame, or five centimetres, may not jump the sea.
    expect(worstT).toBeLessThan(0.1);
    expect(worstX).toBeLessThan(0.1);
  });

  it('does not repeat on any short cycle', () => {
    // Different periods beat against each other; that is where sets
    // come from, and it is why the sea does not loop.
    const t0 = surfaceAt(FIELD, 0, 0, 0);
    let matches = 0;
    for (let t = 5; t < 400; t += 0.1) {
      if (Math.abs(surfaceAt(FIELD, 0, 0, t) - t0) < 1e-6) matches++;
    }
    expect(matches).toBeLessThan(5);
  });
});

describe('ready for overlapping generations', () => {
  it('carries an identity so two fields can coexist later', () => {
    const next = generateWaveField(
      regimeWith({ seed: REGIME.seed + 99 }), { generation: 1, bornAt: 480 });
    expect(next.generation).toBe(1);
    expect(next.bornAt).toBe(480);
    expect(FIELD.generation).toBe(0);
    // Stage B deliberately does NOT blend them; it only makes it possible.
    expect(next.components).not.toEqual(FIELD.components);
  });
});
