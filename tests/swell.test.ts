import { describe, expect, it } from 'vitest';
import {
  SWELL, WAVES, foldAt, seaHeightAt, seaSlopeAt, swellGLSL,
} from '../src/world/swell';
import { UNITS_PER_METRE } from '../src/world/kauai';
import { ORIGIN_STEP } from '../src/world/origin';

describe('the swell', () => {
  it('is a calm day on a real coast, not a human swimmer’s compromise', () => {
    // BE shrank its swell to a tenth of a metre so a first-person human's
    // eye stayed above the crests. That is a fix for a camera, not a fact
    // about the sea, and WATER_PORT.md says not to inherit it.
    expect(SWELL / UNITS_PER_METRE).toBeGreaterThan(0.4);
    expect(SWELL / UNITS_PER_METRE).toBeLessThan(1.0);
    // Real ocean wavelengths, tens of metres.
    for (const wave of WAVES) {
      expect(wave.length / UNITS_PER_METRE).toBeGreaterThan(20);
      expect(wave.length / UNITS_PER_METRE).toBeLessThan(300);
      expect(Math.hypot(wave.dx, wave.dz)).toBeCloseTo(1, 4);
    }
  });

  it('never leaves the band the amplitudes allow', () => {
    let high = -Infinity;
    let low = Infinity;
    for (let t = 0; t < 40; t += 0.37) {
      for (let x = -60_000; x <= 60_000; x += 733) {
        const h = seaHeightAt(x, x * 0.6 - 4_000, t);
        if (h > high) high = h;
        if (h < low) low = h;
      }
    }
    expect(high).toBeLessThanOrEqual(SWELL);
    expect(low).toBeGreaterThanOrEqual(-SWELL);
    // And genuinely uses the band, rather than sitting flat.
    expect(high - low).toBeGreaterThan(SWELL);
  });

  it('moves — a sea that does not is a sheet of glass', () => {
    const still = seaHeightAt(1234, -5678, 0);
    const later = seaHeightAt(1234, -5678, 2.5);
    expect(Math.abs(later - still)).toBeGreaterThan(1);
  });

  it('reports a slope that matches its own height', () => {
    // Analytic against finite difference. If these ever part company the
    // waves shade as though lit from somewhere they are not.
    const step = 0.5;
    for (const [x, z, t] of [[0, 0, 0], [3_400, -1_200, 7.5], [-90_000, 45_000, 22]]) {
      const slope = seaSlopeAt(x, z, t);
      const byHand = {
        x: (seaHeightAt(x + step, z, t) - seaHeightAt(x - step, z, t)) / (2 * step),
        z: (seaHeightAt(x, z + step, t) - seaHeightAt(x, z - step, t)) / (2 * step),
      };
      expect(slope.x).toBeCloseTo(byHand.x, 5);
      expect(slope.z).toBeCloseTo(byHand.z, 5);
    }
  });

  it('stays gentle enough to be a sea rather than a cliff', () => {
    // The steepest the surface ever tilts. Past about a third the waves
    // would be breaking, which this model cannot represent.
    let steepest = 0;
    for (let t = 0; t < 12; t += 0.5) {
      for (let x = -40_000; x <= 40_000; x += 311) {
        const slope = seaSlopeAt(x, -x * 0.3, t);
        steepest = Math.max(steepest, Math.hypot(slope.x, slope.z));
      }
    }
    expect(steepest).toBeLessThan(0.25);
  });
});

describe('the floating origin does not move the sea', () => {
  // THE LAW, MADE TESTABLE. The shader is handed a SMALL local position
  // and a folded phase; the CPU is handed the real world position. They
  // must describe the same water, or the queen floats above a wave she
  // cannot see.
  function throughTheShader(
    localX: number, localZ: number, phase: Float32Array, t: number,
  ): number {
    let h = 0;
    WAVES.forEach((wave, i) => {
      const k = (2 * Math.PI) / wave.length;
      h += wave.height
        * Math.sin(k * (wave.dx * localX + wave.dz * localZ) + phase[i] - wave.speed * t);
    });
    return h;
  }

  it('folds an origin into a phase that reproduces the world exactly', () => {
    for (const origin of [0, ORIGIN_STEP, 1_024_000, -2_100_224, 2_764_800]) {
      const phase = foldAt(origin, -origin / 2);
      for (const [lx, lz] of [[0, 0], [512, -300], [-4_096, 4_096], [2_000, 900]]) {
        const world = seaHeightAt(origin + lx, -origin / 2 + lz, 6.25);
        expect(throughTheShader(lx, lz, phase, 6.25)).toBeCloseTo(world, 2);
      }
    }
  });

  it('holds the same water across a rebase, which is the point', () => {
    // She sits still in the world while the origin jumps under her. The
    // sea beneath her must not so much as ripple from that alone.
    const wx = 2_128_777;
    const wz = -913_456;
    const before = foldAt(2_128_000, -913_408);
    const after = foldAt(2_129_024, -912_384);
    const t = 11.5;
    const one = throughTheShader(wx - 2_128_000, wz + 913_408, before, t);
    const two = throughTheShader(wx - 2_129_024, wz + 912_384, after, t);
    expect(one).toBeCloseTo(two, 2);
    expect(one).toBeCloseTo(seaHeightAt(wx, wz, t), 2);
  });

  it('AND THE FOLD IS DOING THE WORK — drop it and the sea jumps', () => {
    // Negative control. Without the folded phase the shader would be
    // drawing the swell at the wrong place entirely, and the two checks
    // above would pass on any old arithmetic.
    const flat = new Float32Array(WAVES.length);
    const truth = seaHeightAt(2_128_777, -913_456, 11.5);
    const naive = throughTheShader(777, -48, flat, 11.5);
    expect(Math.abs(naive - truth)).toBeGreaterThan(SWELL * 0.2);
  });

  it('hands the shader nothing bigger than a turn', () => {
    // The entire reason this exists: what reaches float32 must be small.
    for (const origin of [0, 2_800_000, -2_800_000, 1_357_824]) {
      for (const value of foldAt(origin, -origin)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(2 * Math.PI);
      }
    }
  });
});

describe('the generated GLSL', () => {
  const glsl = swellGLSL();

  it('declares both functions the material asks for', () => {
    expect(glsl).toContain('float seaH(vec2 p, float t, vec3 phase)');
    expect(glsl).toContain('vec2 seaSlope(vec2 p, float t, vec3 phase)');
  });

  it('carries one term per wave, and reads the folded phase for each', () => {
    WAVES.forEach((_, i) => expect(glsl).toContain(`phase[${i}]`));
    expect(glsl.match(/sin\(/g)).toHaveLength(WAVES.length);
    expect(glsl.match(/cos\(/g)).toHaveLength(WAVES.length);
  });

  it('writes every constant as a float, which GLSL ES insists on', () => {
    // `3.0` is a float and `3` is an int, and GLSL ES will not promote
    // one to the other inside an expression — it fails to compile, the
    // material silently falls back, and the sea renders as a flat plate.
    // Strip the type names and the array subscripts first, or `vec2`
    // reads as the integer 2 (which is how this test failed the first
    // time it ran).
    const bare = glsl.replace(/\bvec[234]\b/g, 'V').replace(/phase\[\d\]/g, 'P');
    const literals = bare.match(/(?<![\w.])[-+]?\d[\d.]*(?:e[-+]?\d+)?/gi) ?? [];
    expect(literals.length).toBeGreaterThan(WAVES.length * 3);
    for (const literal of literals) expect(literal).toMatch(/[.e]/i);
  });

  it('is regenerated from the table, not pasted', () => {
    // A constant that appears in the source but not in WAVES would mean
    // someone hand-edited the shader and the CPU no longer agrees.
    for (const wave of WAVES) {
      expect(glsl).toContain(wave.height.toFixed(4));
    }
  });
});
