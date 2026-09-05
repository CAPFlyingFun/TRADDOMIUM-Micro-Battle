/**
 * THE SEA'S SWELL, AND THE ONE GAP v0 LEFT IN ITS OWN PROOF.
 *
 * This module is carried from v0 almost unchanged, on the audit's
 * instruction: §14 puts it on the protected list and §5 proved the
 * ocean pipeline byte-identical across the whole window in which it was
 * blamed for a regression it did not cause. So most of what is pinned
 * here is that the ACCEPTED SEA is still the accepted sea — the two
 * components Joshua signed off, and the numbers they produce.
 *
 * THE NEW TEST IS THE FORMULA IDENTITY, NUMERICALLY.
 *
 * The CPU sums the waves in TypeScript; the GPU sums them in GLSL that
 * this module PRINTS from the same table. If those two ever describe
 * different waves, the renderer draws water somewhere the ant is not —
 * which is the exact disease the module exists to prevent, and which is
 * invisible until someone is floating in the wrong place.
 *
 * v0 held the SHOALING half to that standard: `breaker.test.ts` regexes
 * the constants back out of the emitted GLSL, re-implements the formula
 * in TypeScript and compares. But the SWELL half — the wave sum itself —
 * was only ever asserted by substring (`expect(glsl).toContain('sw +=')`),
 * and no test in the suite ever evaluated a line of the shader. A
 * formula wrong on both sides identically, or a table printed with the
 * wrong sign, would have passed everything v0 had.
 *
 * So this parses the emitted GLSL, evaluates it as the GPU would, and
 * requires it to match the CPU to the millimetre, over many points and
 * many instants.
 */
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import {
  BREAKER_AMPLITUDE, DEFAULT_WAVES, KEEL, REFERENCE_DEPTH, SHOAL_CAP, SWASH_HI, SWASH_LO,
  SeaSwell, greenShoalAt, heaveGain, wave,
} from '../src/world/sea/swell';

/** Deep water, so nothing is shoaled or clamped unless a test asks for it. */
const DEEP = 4000;

/** A sea over a flat bed, which is what a headless caller gets. */
const seaOverFlatBed = (depth = DEEP): SeaSwell =>
  new SeaSwell({ groundAt: () => -depth });

describe('the accepted sea is still the accepted sea', () => {
  it('is Joshua’s two components, at the wavelengths and headings he signed off', () => {
    // The table the bare URL ran in v0 and that passed device
    // acceptance. The live NOAA sea was always behind a flag, so THIS
    // is the ocean he means when he says he likes it.
    expect(DEFAULT_WAVES).toHaveLength(2);
    const [swell, windSea] = DEFAULT_WAVES;
    expect((2 * Math.PI) / swell.k).toBeCloseTo(360, 6);
    expect((2 * Math.PI) / windSea.k).toBeCloseTo(210, 6);
    expect(swell.amp).toBe(16);
    expect(windSea.amp).toBe(6);
  });

  it('produces the numbers the rest of the game was tuned against', () => {
    const sea = seaOverFlatBed();
    // 16 + 6, and the reach is that times the shoaling cap.
    expect(sea.amplitude()).toBeCloseTo(22, 6);
    expect(sea.reach()).toBeCloseTo(48.4, 6);
    // 1.47 s — the number the camera's patience and the underwater
    // hysteresis were both swept against.
    expect(sea.period()).toBeCloseTo(1.47, 2);
  });

  it('runs each wave at the speed physics gives its wavelength', () => {
    // Deep-water dispersion: the longer swell must genuinely outrun the
    // shorter wind sea, or they never separate into sets.
    const [swell, windSea] = DEFAULT_WAVES;
    const speed = (w: typeof swell): number => w.omega / w.k;
    expect(speed(swell)).toBeGreaterThan(speed(windSea));
    expect(swell.omega).toBeCloseTo(Math.sqrt(981 * swell.k), 9);
  });
});

describe('the shore is where waves grow', () => {
  it('grows them toward the shore rather than fading them out', () => {
    // v0 got this backwards twice and Joshua caught it twice.
    const sea = seaOverFlatBed();
    const offshore = sea.shoalAt(REFERENCE_DEPTH);
    const inshore = sea.shoalAt(120);
    expect(inshore).toBeGreaterThan(offshore);
  });

  it('never lets a wave stand taller than the water it is in', () => {
    // McCowan's limit: the surface may stand at most 0.39 of the depth
    // from mean. Left uncapped, Green's law put a 1.85 m crest over half
    // a metre of water — not a big wave, an impossible one.
    const sea = seaOverFlatBed();
    for (const depth of [10, 25, 50, 100, 200, 400, 700]) {
      const stands = sea.shoalAt(depth) * sea.amplitude();
      expect(stands).toBeLessThanOrEqual(BREAKER_AMPLITUDE * depth + 1e-9);
    }
  });

  it('is smooth across the whole shore — measurably smoother than the hard min it replaced', () => {
    // A hard `min` of the two limits is a CREASE: the shoreline would
    // carry a ring at the depth where the branch flips, and crossing it
    // the sea would change slope in a step. The soft minimum exists to
    // remove that, so the honest test is a COMPARISON against the thing
    // it replaced — an absolute threshold would only be measuring the
    // curve's own curvature, which a smoothstep has by design.
    const sea = seaOverFlatBed();
    const peak = sea.amplitude();
    const bend = (f: (d: number) => number): number => {
      let worst = 0;
      for (let d = 40; d <= 900; d += 1) worst = Math.max(worst, Math.abs(f(d - 1) - 2 * f(d) + f(d + 1)));
      return worst;
    };
    //
    // MEASURED PAST THE SWASH. Both curves share the swash taper, whose
    // smoothstep has real curvature by design and peaks at depth 7-11 —
    // include it and it dominates both readings and hides the thing
    // being tested. Past depth 40, where the branch actually flips, the
    // hard minimum's crease is at depth 93 and the soft one is 40 times
    // smoother.
    const hard = bend((d) => Math.min(greenShoalAt(d), (BREAKER_AMPLITUDE * d) / peak));
    const soft = bend((d) => sea.shoalAt(d));
    expect(soft).toBeLessThan(hard / 10);
  });

  it('flattens in the swash so the feathered waterline is untouched', () => {
    expect(greenShoalAt(SWASH_LO)).toBe(0);
    expect(greenShoalAt(SWASH_LO - 1)).toBe(0);
    expect(greenShoalAt(SWASH_HI)).toBeGreaterThan(1);
  });

  it('caps the growth so it cannot run away over a reef', () => {
    for (let d = 1; d <= 2000; d += 7) expect(greenShoalAt(d)).toBeLessThanOrEqual(SHOAL_CAP + 1e-9);
  });

  it('keeps a trough off the bed', () => {
    // Without the keel a shoaled wave in shallow water drives the sheet
    // through the sand — wrong, and a z-fight.
    const sea = seaOverFlatBed();
    const depth = 40;
    let lowest = Infinity;
    for (let t = 0; t < 4; t += 1 / 60) {
      sea.tick(1 / 60);
      for (let x = 0; x < 400; x += 7) lowest = Math.min(lowest, sea.heightAt(world(x, 0), depth));
    }
    expect(lowest).toBeGreaterThanOrEqual(-(depth - KEEL) - 1e-9);
  });
});

describe('THE FORMULA IDENTITY: the GPU sums exactly what the CPU sums', () => {
  /**
   * Parse the emitted vertex chunk back into numbers, the way v0's
   * `breaker.test.ts` does for the shoaling half. If the printer and
   * the summer ever disagree, these coefficients stop matching the
   * table and the evaluation below stops matching the CPU.
   */
  function componentsFromGlsl(glsl: string): { dx: number; dz: number; k: number; omega: number }[] {
    const re = /worldXZ\.x \* (-?[\d.]+) \+ worldXZ\.y \* (-?[\d.]+)\) \* ([\d.]+) - ([\d.]+) \* uTime/g;
    const out: { dx: number; dz: number; k: number; omega: number }[] = [];
    for (const m of glsl.matchAll(re)) {
      out.push({ dx: Number(m[1]), dz: Number(m[2]), k: Number(m[3]), omega: Number(m[4]) });
    }
    return out;
  }

  it('evaluates the emitted GLSL and matches the CPU to the millimetre', () => {
    const sea = seaOverFlatBed();
    const parsed = componentsFromGlsl(sea.swellChunk());
    expect(parsed).toHaveLength(DEFAULT_WAVES.length);

    for (let step = 0; step < 40; step += 1) {
      sea.tick(0.037);
      const uTime = sea.now();
      const amps = sea.ampUniform.value;
      for (const [wx, wz] of [[0, 0], [137, -412], [-2503, 991]]) {
        // What the vertex shader would compute for `sw`.
        let sw = 0;
        parsed.forEach((c, i) => {
          sw += amps[i] * Math.cos((wx * c.dx + wz * c.dz) * c.k - c.omega * uTime);
        });
        // The CPU's own answer is that sum times the shoaling envelope.
        //
        // TO THE PRECISION THE SHADER CARRIES, and no further: the
        // literals are printed at six and eight decimals because that is
        // about what a float32 holds, so exact equality is not available
        // and demanding it would be testing `toFixed`.
        const shoal = sea.shoalAt(DEEP);
        expect(sea.heightAt(world(wx, wz), DEEP)).toBeCloseTo(sw * shoal, 3);
      }
    }
  });

  it('holds that identity across the whole island, to a bound the design already accepts', () => {
    // THE ERROR GROWS WITH DISTANCE FROM THE ORIGIN, and it is worth
    // knowing by how much. The phase is position x wavenumber, and the
    // wavenumber is a printed literal carrying about seven significant
    // digits — which is what a float32 holds, so printing more would not
    // help. Measured: 8.8e-5 units at the origin, 1.1e-2 at 1 km,
    // 2.4e-1 — 2.4 mm — at the island's edge, growing linearly.
    //
    // That is acceptable, and the reason is a number the design already
    // lives with: the CPU bilerps four lattice corners while the GPU
    // rasterises two planar triangles, and those disagree mid-quad by up
    // to 4.9 units by construction. The literal rounding is twenty times
    // smaller than a disagreement the sea already accepts.
    //
    // If it ever needs to be smaller, the fix is not more decimals — it
    // is to phase the waves against the floating origin rather than
    // against world zero, so the coordinate handed to the shader stays
    // small. Noted here rather than done, because nothing yet needs it.
    const sea = seaOverFlatBed();
    sea.tick(1.7);
    const parsed = componentsFromGlsl(sea.swellChunk());
    const amps = sea.ampUniform.value;
    const uTime = sea.now();
    const shoal = sea.shoalAt(DEEP);
    let worst = 0;
    for (const d of [0, 1e3, 1e4, 1e5, 1e6, 2.8e6]) {
      for (let i = 0; i < 40; i += 1) {
        const wx = d + i * 37;
        const wz = -d * 0.5 + i * 11;
        let sw = 0;
        parsed.forEach((c, j) => {
          sw += amps[j] * Math.cos((wx * c.dx + wz * c.dz) * c.k - c.omega * uTime);
        });
        worst = Math.max(worst, Math.abs(sea.heightAt(world(wx, wz), DEEP) - sw * shoal));
      }
    }
    // Well inside the lattice disagreement the design accepts, and far
    // inside anything an ant could feel.
    expect(worst).toBeLessThan(0.5);
  });

  it('emits a gradient that matches the surface it is the gradient of', () => {
    // `swSlope` drives the lighting normal. A sign error there lights
    // every wave from the wrong side and nothing else notices.
    const sea = seaOverFlatBed();
    sea.tick(1.234);
    const parsed = componentsFromGlsl(sea.swellChunk());
    const amps = sea.ampUniform.value;
    const uTime = sea.now();
    const at = world(220, -140);
    let slopeX = 0;
    let slopeZ = 0;
    parsed.forEach((c, i) => {
      const ph = (at.wx * c.dx + at.wz * c.dz) * c.k - c.omega * uTime;
      slopeX += c.dx * (-amps[i] * c.k * Math.sin(ph));
      slopeZ += c.dz * (-amps[i] * c.k * Math.sin(ph));
    });
    // Against a central difference of the CPU surface, with the shoal
    // factored out (it is constant at a constant depth).
    const shoal = sea.shoalAt(DEEP);
    const h = 0.05;
    const dx = (sea.heightAt(world(at.wx + h, at.wz), DEEP) - sea.heightAt(world(at.wx - h, at.wz), DEEP)) / (2 * h);
    const dz = (sea.heightAt(world(at.wx, at.wz + h), DEEP) - sea.heightAt(world(at.wx, at.wz - h), DEEP)) / (2 * h);
    expect(slopeX * shoal).toBeCloseTo(dx, 6);
    expect(slopeZ * shoal).toBeCloseTo(dz, 6);
  });

  it('keeps amplitude OUT of the baked source, because that is what moves', () => {
    // Wavenumber, heading and frequency are fixed within a generation
    // and are literals; amplitude is where wave groups live, so it must
    // be the uniform — and the uniform must be the CPU's own array.
    const sea = seaOverFlatBed();
    expect(sea.swellChunk()).toContain('uWaveAmp[0]');
    expect(sea.swellChunk()).not.toContain('16.00');
    const bound: Record<string, { value: unknown }> = {};
    sea.bindUniforms(bound);
    expect(bound.uWaveAmp).toBe(sea.ampUniform);
    expect(sea.swellUniformChunk()).toBe(`uniform float uWaveAmp[${DEFAULT_WAVES.length}];`);
  });

  it('bakes the shoaling envelope with the same constants the CPU uses', () => {
    // v0's own numeric cross-check, carried across: pull the four
    // constants back out of the GLSL and re-implement the soft minimum.
    const sea = seaOverFlatBed();
    const glsl = sea.shoalChunk();
    const limit = Number(/float breakLimit = ([\d.]+) \* max\(depth, 0\.0\) \/ ([\d.]+);/.exec(glsl)?.[1]);
    const peak = Number(/float breakLimit = [\d.]+ \* max\(depth, 0\.0\) \/ ([\d.]+);/.exec(glsl)?.[1]);
    const softness = Number(/pow\(green, ([\d.]+)\)/.exec(glsl)?.[1]);
    expect(limit).toBeCloseTo(BREAKER_AMPLITUDE, 4);
    expect(peak).toBeCloseTo(sea.amplitude(), 3);
    for (const d of [0, 5, 20, 50, 120, 300, 700, 4000]) {
      const green = Math.min(SHOAL_CAP, Math.max(1, Math.pow(REFERENCE_DEPTH / Math.max(d, 30), 0.25)))
        * smoothstep(SWASH_LO, SWASH_HI, d);
      const breakLimit = limit * Math.max(d, 0) / peak;
      const softSum = Math.pow(green, softness) + Math.pow(breakLimit, softness);
      const shoal = softSum > 0 ? green * breakLimit * Math.pow(softSum, -1 / softness) : 0;
      expect(shoal).toBeCloseTo(sea.shoalAt(d), 6);
    }
  });
});

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

describe('one sea, one clock', () => {
  it('advances only when ticked, and every query reads the same instant', () => {
    const sea = seaOverFlatBed();
    const at = world(150, 75);
    const before = sea.heightAt(at, DEEP);
    expect(sea.heightAt(at, DEEP)).toBe(before);
    sea.tick(0.5);
    expect(sea.heightAt(at, DEEP)).not.toBe(before);
    expect(sea.now()).toBeCloseTo(0.5, 9);
  });

  it('splits into a heave and a chop that add back up to the sea exactly', () => {
    // The camera reads the slow half. It is a SLICE of the surface, not
    // a second surface — so the two halves must reconstruct it.
    const sea = seaOverFlatBed();
    for (let i = 0; i < 20; i += 1) {
      sea.tick(0.083);
      const at = world(i * 91, -i * 37);
      expect(sea.heaveAt(at, DEEP) + sea.chopAt(at, DEEP)).toBeCloseTo(sea.heightAt(at, DEEP), 9);
    }
  });

  it('weights the camera’s half by period, so a long swell is followed and chop is not', () => {
    expect(heaveGain((2 * Math.PI) / 6)).toBeGreaterThan(0.95);
    expect(heaveGain((2 * Math.PI) / 1.518)).toBeLessThan(0.25);
  });

  it('restarts the clock without changing the sea', () => {
    const sea = seaOverFlatBed();
    sea.tick(9);
    sea.restartClock();
    expect(sea.now()).toBe(0);
    expect(sea.amplitude()).toBeCloseTo(22, 6);
    expect(sea.isDefaultSea()).toBe(true);
  });
});

describe('the current comes from the same waves as the surface', () => {
  it('nets to nothing over a cycle, which is what floating feels like', () => {
    // ONE COMPONENT, so "a cycle" is a real period rather than the
    // energy-weighted mean of two — over which neither wave completes a
    // whole turn and a residual is arithmetic, not physics.
    const sea = seaOverFlatBed();
    const only = wave(360, 16, 90);
    sea.setTable([only]);
    const at = world(0, 0);
    const period = (2 * Math.PI) / only.omega;
    const steps = 4000;
    const dt = period / steps;
    let sumX = 0;
    let peak = 0;
    for (let i = 0; i < steps; i += 1) {
      sea.tick(dt);
      const u = sea.orbitalAt(at, DEEP).x;
      sumX += u * dt;
      peak = Math.max(peak, Math.abs(u));
    }
    // The drift over a full cycle is a rounding error beside the speed
    // the water reaches within it.
    expect(peak).toBeGreaterThan(10);
    expect(Math.abs(sumX)).toBeLessThan(peak * period * 1e-3);
  });

  it('runs forward under a crest and backward under a trough', () => {
    const sea = seaOverFlatBed();
    // One component only, so crest and flow direction are unambiguous.
    sea.setTable([wave(360, 16, 90)]); // running toward +x
    let crestFlow = 0;
    let troughFlow = 0;
    let highest = -Infinity;
    let lowest = Infinity;
    for (let x = 0; x < 360; x += 2) {
      const at = world(x, 0);
      const h = sea.heightAt(at, DEEP);
      if (h > highest) { highest = h; crestFlow = sea.orbitalAt(at, DEEP).x; }
      if (h < lowest) { lowest = h; troughFlow = sea.orbitalAt(at, DEEP).x; }
    }
    expect(crestFlow).toBeGreaterThan(0);
    expect(troughFlow).toBeLessThan(0);
  });

  it('grows with the shoaling, so the water really shoves in the shallows', () => {
    const sea = seaOverFlatBed();
    const peak = (depth: number): number => {
      let most = 0;
      for (let x = 0; x < 400; x += 3) most = Math.max(most, Math.abs(sea.orbitalAt(world(x, 0), depth).x));
      return most;
    };
    expect(peak(120)).toBeGreaterThan(peak(REFERENCE_DEPTH));
  });
});

describe('the mesh the renderer draws, not the curve behind it', () => {
  it('samples the chords once a lattice is registered', () => {
    // Floating on the analytic curve while the sheet is drawn on chords
    // is why she "seems too low in the wave" — sunk into a trough the
    // mesh never dug.
    const sea = seaOverFlatBed();
    sea.tick(0.4);
    const at = world(35, 35);
    const analytic = sea.heightAt(at, DEEP);
    sea.setLattice({ ox: 0, oz: 0, cell: 70 });
    const chord = sea.heightAt(at, DEEP);
    expect(chord).not.toBeCloseTo(analytic, 6);
    // Mid-cell the chord cuts the crest: strictly inside the curve's range.
    sea.clearLattice();
    expect(sea.heightAt(at, DEEP)).toBeCloseTo(analytic, 9);
  });

  it('agrees with the curve exactly ON a lattice vertex', () => {
    const sea = seaOverFlatBed();
    sea.tick(0.9);
    const at = world(140, 210); // a multiple of the cell
    const analytic = sea.heightAt(at, DEEP);
    sea.setLattice({ ox: 0, oz: 0, cell: 70 });
    expect(sea.heightAt(at, DEEP)).toBeCloseTo(analytic, 6);
  });

  it('asks the injected ground for each corner’s own column, not one depth for all four', () => {
    // What the shader does: each vertex carries its own water column.
    const asked: WorldPoint[] = [];
    const sea = new SeaSwell({
      groundAt: (at) => {
        asked.push(at);
        return -DEEP;
      },
    });
    sea.setLattice({ ox: 0, oz: 0, cell: 70 });
    sea.heightAt(world(35, 35), DEEP);
    expect(asked).toHaveLength(4);
    expect(new Set(asked.map((a) => `${a.wx},${a.wz}`)).size).toBe(4);
  });
});

describe('swapping the sea', () => {
  it('rebuilds the material only when the SHAPE changes, not when amplitudes move', () => {
    const sea = seaOverFlatBed();
    const version = sea.tableVersion();
    // Same shape, different amplitude: a uniform, not a recompile.
    sea.setTable([wave(360, 20, 245), wave(210, 8, 222)]);
    expect(sea.tableVersion()).toBe(version);
    // A different number of components is a different program.
    sea.setTable([wave(360, 16, 245)]);
    expect(sea.tableVersion()).toBeGreaterThan(version);
  });

  it('falls back to the accepted sea when handed nothing', () => {
    const sea = seaOverFlatBed();
    sea.setTable([wave(500, 9, 10)]);
    expect(sea.isDefaultSea()).toBe(false);
    sea.setTable(null);
    expect(sea.isDefaultSea()).toBe(true);
    expect(sea.amplitude()).toBeCloseTo(22, 6);
  });

  it('lets an owner answer how tall the sea may stand, for crossfades', () => {
    // Summing two generations' peaks would advertise a crest half again
    // taller than the water can reach, and would JUMP when the second
    // joined — measured at 18% in three metres of water.
    const sea = seaOverFlatBed();
    sea.setPeakSource(() => 30);
    expect(sea.amplitude()).toBe(30);
    sea.setPeakSource(null);
    sea.setTable(null);
    expect(sea.amplitude()).toBeCloseTo(22, 6);
  });
});
