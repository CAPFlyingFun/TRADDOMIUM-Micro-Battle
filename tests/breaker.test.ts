/**
 * WATER CANNOT HOLD A WAVE TALLER THAN ITSELF.
 *
 * Stage C measured the hole: Green's law grew the procedural swell
 * until a 1.85 m crest stood over half a metre of water. Stage D is
 * the envelope that stops it, and these are its four promises —
 *
 *   BOUNDED   the surface never stands taller than 0.39 of the depth,
 *             anywhere, at any time, in either sea
 *   OFFSHORE  deep water is arithmetically untouched
 *   SMOOTH    no crease, no ring, no wall: the envelope and its slope
 *             are continuous across the whole shore
 *   STILL     it is a function of the BED, not of the wave standing on
 *             it, so it cannot breathe at wave rate
 *
 * — plus the fifth that everything in this module lives by: the GPU
 * computes the same envelope as the CPU.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BREAKER_AMPLITUDE, BREAK_SOFTNESS, SHOAL_CAP, breakerAmplitudeAt, brokenAt,
  greenShoalAt, resetSwell, seaSwellAt, shoalAt, shoalChunk, swellAmplitude,
  tickSwell,
} from '../src/world/seaSwell';
import { breaksAt } from '../src/world/surf';
import { useFixedSea, useProceduralSea } from '../src/world/liveSea';

afterEach(() => { useFixedSea(); resetSwell(); });

/**
 * PINNED. `useProceduralSea()` seeds itself from the wall clock, so a
 * bare call grows a different field every run and these thresholds
 * would drift with it. Stage C's own generation is the one every
 * measurement in this file is written against.
 */
const GENERATION = { worldSeed: 20260829, nowMs: 0 } as const;

const SEAS: [string, () => void][] = [
  ['the shipped sea', () => useFixedSea()],
  ['the procedural sea', () => { useProceduralSea(GENERATION); }],
];

/** Every depth the shore offers, in world units (centimetres). */
const shoreDepths = (): number[] => {
  const out: number[] = [];
  for (let d = 0; d <= 400; d += 1) out.push(d);
  for (let d = 405; d <= 3000; d += 5) out.push(d);
  return out;
};

describe('BOUNDED — the surface cannot stand taller than the water', () => {
  for (const [name, install] of SEAS) {
    it(`holds ${name} under 0.39 of the depth, everywhere, always`, () => {
      resetSwell(); install();
      let worst = 0;
      for (let step = 0; step < 40; step++) {
        tickSwell(0.37);
        for (const d of shoreDepths()) {
          const y = Math.abs(seaSwellAt(d * 13.7, -d * 9.1, d));
          const limit = breakerAmplitudeAt(d);
          expect(y).toBeLessThanOrEqual(limit + 1e-9);
          if (limit > 0) worst = Math.max(worst, y / limit);
        }
      }
      // And it is not slack: somewhere in the surf the sea really does
      // ride the line, which is what a saturated inner surf zone does.
      expect(worst).toBeGreaterThan(0.55);
    });
  }

  for (const [name, install] of SEAS) {
    it(`can only ever LOWER ${name}, never raise it`, () => {
      // Worth stating as its own promise, because it settles a whole
      // family of questions without a screenshot: the envelope is a
      // soft MINIMUM, so every crest is at most as tall as it was.
      // Nothing downstream that keys off surface height — the camera
      // being washed, the keel clamping a trough into the sand, the
      // underwater tint — can be made to happen MORE often by it.
      resetSwell(); install();
      for (const d of shoreDepths()) {
        expect(shoalAt(d)).toBeLessThanOrEqual(greenShoalAt(d) + 1e-12);
      }
    });
  }

  it('is the hole Stage C measured, closed', () => {
    resetSwell(); useProceduralSea(GENERATION);
    // 0.5 m of water. Before the envelope this stood at 1.85 m.
    const amp = swellAmplitude() * shoalAt(50);
    expect(amp).toBeLessThanOrEqual(BREAKER_AMPLITUDE * 50);
    expect(amp / 100).toBeLessThan(0.2);          // metres
    // The uncapped shoaling still WANTS the impossible wave — the
    // envelope is what refuses it, not a quieter Green's law.
    expect(swellAmplitude() * greenShoalAt(50) / 100).toBeGreaterThan(1.5);
  });
});

describe('OFFSHORE — the deep sea is not touched', () => {
  for (const [name, install] of SEAS) {
    it(`leaves ${name} as Green's law wrote it`, () => {
      resetSwell(); install();
      // Seven metres — the reference depth, where the table's
      // amplitudes are the honest ones. The taller procedural sea is
      // already within a third of a percent here; the shipped one
      // within a thousandth.
      expect(shoalAt(700) / greenShoalAt(700)).toBeGreaterThan(0.99);
      // Twenty-six metres and deeper, nothing measurable is happening.
      for (const d of [2_600, 10_000]) {
        expect(shoalAt(d) / greenShoalAt(d)).toBeGreaterThan(0.9999);
        expect(brokenAt(d)).toBeLessThan(1e-4);
      }
    });
  }

  it('DOES bite by three metres in the procedural sea, and should', () => {
    // Not a leak — physics. The generated sea's peak crest is 0.95 m,
    // so its HEIGHT is 1.9 m, and 1.9 m of wave in 3 m of water is at
    // four fifths of the breaking limit. A wave that close to breaking
    // is supposed to be losing height.
    resetSwell(); useProceduralSea(GENERATION);
    const suppression = 1 - shoalAt(300) / greenShoalAt(300);
    expect(suppression).toBeGreaterThan(0.001);
    expect(suppression).toBeLessThan(0.35);
    // The shipped sea, a quarter the height, barely notices the same
    // depth — which is the whole reason it looked fine before.
    resetSwell(); useFixedSea();
    expect(1 - shoalAt(300) / greenShoalAt(300)).toBeLessThan(0.02);
  });

  it('costs under 2% of the height until the limit is close', () => {
    // The soft minimum's whole justification: it must not be a quiet
    // global attenuation. At a fifth of the limit it is nearly exact.
    const green = 1.5;
    const limit = green * 5;
    const soft = (green * limit) / (green ** BREAK_SOFTNESS + limit ** BREAK_SOFTNESS)
      ** (1 / BREAK_SOFTNESS);
    expect(soft / green).toBeGreaterThan(0.98);
  });
});

describe('SMOOTH — no crease, no ring, no wall', () => {
  const STEP = 0.5;
  /**
   * The sharpest bend in the crest-height profile across the shore —
   * the second difference, which is what a visible ring is made of. A
   * hard branch makes this jump at the depth where the branch flips.
   */
  const bend = (f: (d: number) => number): number => {
    let worst = 0;
    for (let d = 1; d < 600; d += STEP) {
      worst = Math.max(worst,
        Math.abs(f(d + STEP) - 2 * f(d) + f(d - STEP)) / (STEP * STEP));
    }
    return worst;
  };

  for (const [name, install] of SEAS) {
    it(`makes ${name}'s shore SMOOTHER than it already was`, () => {
      resetSwell(); install();
      const A0 = swellAmplitude();
      const capped = (d: number) => A0 * shoalAt(d);
      const uncapped = (d: number) => A0 * greenShoalAt(d);
      const clamped = (d: number) => Math.min(uncapped(d), breakerAmplitudeAt(d));
      // THE ACTUAL QUESTION. The shore already bends — the swash taper
      // is the steepest thing on it and Stage D did not touch it. What
      // matters is that the envelope does not add to that, and it does
      // not: it takes the top off the shoaling, so the profile it
      // leaves is gentler than the one it replaced AND gentler than
      // the hard clamp that was the obvious alternative.
      expect(bend(capped)).toBeLessThan(bend(uncapped));
      expect(bend(capped)).toBeLessThan(bend(clamped));
      // No step anywhere: crest height changes by under a millimetre
      // per half-centimetre of depth, across the whole shore.
      for (let d = 1; d < 600; d += STEP) {
        expect(Math.abs(capped(d + STEP) - capped(d))).toBeLessThan(1);
      }
    });
  }
});

describe('STILL — the envelope reads the bed, never the wave on it', () => {
  it('does not move as the sea runs', () => {
    resetSwell(); useProceduralSea(GENERATION);
    const first = shoreDepths().map(shoalAt);
    for (let i = 0; i < 50; i++) tickSwell(1.7);
    expect(shoreDepths().map(shoalAt)).toEqual(first);
  });

  it('so a queen holding station feels no beat from the cap', () => {
    // Same spot, same bed, a full minute: the depth limit contributes
    // nothing periodic. What is left moving is the swell itself.
    resetSwell(); useProceduralSea(GENERATION);
    const shoal = shoalAt(120);
    for (let i = 0; i < 600; i++) {
      tickSwell(1 / 60);
      expect(shoalAt(120)).toBe(shoal);
    }
  });
});

describe('the surf zone is defined by what the depth took', () => {
  it('is nothing offshore and nearly everything at the beach', () => {
    resetSwell(); useProceduralSea(GENERATION);
    expect(brokenAt(5_000)).toBeLessThan(1e-5);
    expect(brokenAt(40)).toBeGreaterThan(0.5);
    expect(brokenAt(15)).toBeGreaterThan(0.7);
  });

  it('rises as the water shallows, without reversing', () => {
    for (const [, install] of SEAS) {
      resetSwell(); install();
      let previous = 0;
      for (let d = 400; d >= 36; d -= 2) {
        const now = brokenAt(d);
        expect(now).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = now;
      }
    }
  });

  it('still agrees with the depth a wave would need', () => {
    // brokenAt and breaksAt are two readings of one idea: the cap
    // bites exactly where the water is shallower than the wave needs.
    resetSwell(); useProceduralSea(GENERATION);
    for (const d of [40, 80, 150, 400, 1_500]) {
      const needs = breaksAt(d);
      if (needs > d) expect(brokenAt(d)).toBeGreaterThan(0.01);
      else expect(brokenAt(d)).toBeLessThan(0.2);
    }
  });
});

describe('the GPU computes the same envelope', () => {
  for (const [name, install] of SEAS) {
    it(`bakes ${name}'s own numbers into the chunk`, () => {
      resetSwell(); install();
      const glsl = shoalChunk();
      // The pieces the CPU function is made of, read back out of the
      // emitted code. This catches a constant drifting apart on one
      // side; it cannot catch the EXPRESSION being restructured, which
      // is what the shape assertions below are for.
      const num = (re: RegExp) => {
        const m = glsl.match(re);
        expect(m, `${re} in\n${glsl}`).toBeTruthy();
        return Number(m![1]);
      };
      const peak = num(/max\(depth, 0\.0\) \/ ([\d.]+)/);
      const limitK = num(/float breakLimit = ([\d.]+) \*/);
      const cap = num(/0\.25\), 1\.0, ([\d.]+)\)/);
      const softness = num(/pow\(green, ([\d.]+)\)/);
      expect(peak).toBeCloseTo(swellAmplitude(), 3);
      expect(limitK).toBeCloseTo(BREAKER_AMPLITUDE, 4);
      expect(cap).toBeCloseTo(SHOAL_CAP, 4);
      expect(softness).toBeCloseTo(BREAK_SOFTNESS, 4);
      expect(glsl).toContain(`pow(softSum, ${(-1 / BREAK_SOFTNESS).toFixed(4)})`);
      expect(glsl).toContain('green * breakLimit * pow(softSum');

      // And the formula those numbers describe IS shoalAt.
      for (const d of [0, 5, 20, 50, 120, 300, 700, 4_000]) {
        const green = Math.min(SHOAL_CAP, Math.max(1,
          (700 / Math.max(d, 30)) ** 0.25))
          * (() => {
            const t = Math.min(1, Math.max(0, (d - 6) / (34 - 6)));
            return t * t * (3 - 2 * t);
          })();
        const breakLimit = (limitK * Math.max(d, 0)) / peak;
        const softSum = green ** softness + breakLimit ** softness;
        const shoal = softSum > 0
          ? green * breakLimit * softSum ** (-1 / softness) : 0;
        // Six figures, not nine: the peak is baked to four decimals,
        // which is a relative error of about 5e-7 on a 95 cm sea and
        // an order of magnitude finer than the float32 the GPU will
        // hold it in anyway.
        expect(shoal).toBeCloseTo(shoalAt(d), 6);
      }
    });
  }

  it('re-bakes when the sea is swapped', () => {
    resetSwell(); useFixedSea();
    const shipped = shoalChunk();
    useProceduralSea(GENERATION);
    const generated = shoalChunk();
    expect(generated).not.toBe(shipped);
    expect(generated).toContain(swellAmplitude().toFixed(4));
  });
});
