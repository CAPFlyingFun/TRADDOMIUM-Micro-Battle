/**
 * ONE SEA, AND THE SWAP THAT PROVES IT.
 *
 * Stage C's whole claim is that installing a generated wave table
 * moves the ENTIRE ocean — the surface the queen floats on, the
 * orbital current that carries her, the breaker depth the surf uses,
 * and the chunk the vertex shader is built from. If any one of those
 * kept reading the old table, the water she is drawn on and the water
 * she floats on would be different water, which is the exact disease
 * seaSwell exists to prevent.
 *
 * These are CPU-side; the shader half is guarded by asserting the
 * emitted chunk and uniform follow the table too.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SWELL_AMP_UNIFORM, activeWaves, isDefaultSea, resetSwell, restartSwellClock,
  seaOrbitalAt, seaSwellAt, swellAmplitude, swellChunk, swellReach,
  swellTime, swellUniformChunk, tickSwell,
} from '../src/world/seaSwell';
import { breaksAt } from '../src/world/surf';
import {
  DEFAULT_MESO_SCALE, liveField, seaFromQuery, seaMode, useFixedSea,
  useProceduralSea,
} from '../src/world/liveSea';
import { UNITS_PER_METRE } from '../src/world/kauai';

const DEEP = 10_000;

beforeEach(() => { resetSwell(); useFixedSea(); });
afterEach(() => { useFixedSea(); resetSwell(); });

describe('the shipped sea is the default', () => {
  it('starts as the built-in table and says so', () => {
    expect(isDefaultSea()).toBe(true);
    expect(seaMode()).toBe('fixed');
    expect(activeWaves()).toHaveLength(2);
    expect(liveField()).toBeNull();
  });

  it('needs the flag asked for — no query, no change', () => {
    expect(seaFromQuery('')).toBeNull();
    expect(seaFromQuery('?scene=island')).toBeNull();
    expect(seaFromQuery('?sea=nonsense')).toBeNull();
  });

  it('reads the four comparisons off the query', () => {
    expect(seaFromQuery('?sea=procedural')).toEqual({});
    expect(seaFromQuery('?sea=macro')).toEqual({ meso: false });
    expect(seaFromQuery('?sea=meso')).toEqual({ macro: false });
    expect(seaFromQuery('?sea=procedural&meso=0.6')).toEqual({ mesoScale: 0.6 });
  });

  it('comes back to the shipped sea exactly', () => {
    useProceduralSea();
    expect(isDefaultSea()).toBe(false);
    useFixedSea();
    expect(isDefaultSea()).toBe(true);
    expect(activeWaves().map((w) => w.amp)).toEqual([16, 6]);
  });

  it('resetSwell restores it too, so no test can leak a sea', () => {
    useProceduralSea();
    resetSwell();
    expect(isDefaultSea()).toBe(true);
  });
});

describe('installing the generated sea moves EVERYTHING', () => {
  it('changes the surface the queen floats on', () => {
    tickSwell(3.5);
    const before = seaSwellAt(1234, -567, DEEP);
    useProceduralSea();
    tickSwell(0);
    expect(seaSwellAt(1234, -567, DEEP)).not.toBe(before);
  });

  it('changes the orbital current that carries her', () => {
    tickSwell(3.5);
    const before = seaOrbitalAt(1234, -567, DEEP);
    useProceduralSea();
    tickSwell(0);
    const after = seaOrbitalAt(1234, -567, DEEP);
    expect(after.x).not.toBe(before.x);
  });

  it('changes the depth the surf decides to break in', () => {
    const before = breaksAt(200);
    useProceduralSea();
    expect(breaksAt(200)).not.toBe(before);
  });

  it('changes the chunk the vertex shader is built from', () => {
    const before = swellChunk();
    useProceduralSea();
    const after = swellChunk();
    expect(after).not.toBe(before);
    // One term per component, and the uniform array sized to match.
    const n = activeWaves().length;
    expect(swellUniformChunk()).toBe(`uniform float uWaveAmp[${n}];`);
    expect(after).toContain(`uWaveAmp[${n - 1}]`);
    expect(after).not.toContain(`uWaveAmp[${n}]`);
  });

  it('feeds the shader the very amplitudes the CPU is summing', () => {
    useProceduralSea();
    // The envelope is a function of the SEA'S clock, so the expected
    // value has to be read at the time the clock actually reached --
    // walk it there deliberately rather than assuming a dt.
    let now = 0;
    for (const t of [0, 12.5, 140]) {
      now = tickSwell(t - now);
      expect(now).toBeCloseTo(t, 9);
      const table = activeWaves();
      expect(SWELL_AMP_UNIFORM.value).toHaveLength(table.length);
      for (let i = 0; i < table.length; i++) {
        const w = table[i];
        const expected = w.amp * (w.envelope ? w.envelope(now) : 1);
        // The uniform is filled from liveAmp, which is what rawSwell
        // and seaOrbitalAt both read.
        expect(SWELL_AMP_UNIFORM.value[i]).toBeCloseTo(expected, 6);
      }
    }
  });
});

describe('rebuilding the water must not put the old sea back', () => {
  // THE BUG THIS EXISTS FOR. Installing a table and then rebuilding
  // the ocean -- which is the ONLY way the vertex shader can follow
  // it, because the chunk is baked at compile time -- used to restore
  // the shipped two waves, because Ocean's constructor called the
  // full reset. `?sea=procedural` then reported itself as on over an
  // ocean that was still the old sea, and every measurement taken
  // through the running game was measuring the wrong water.
  it('restarts the clock and the mesh, and leaves the table alone', () => {
    useProceduralSea();
    const table = activeWaves();
    tickSwell(9.5);
    restartSwellClock();
    expect(swellTime()).toBe(0);
    expect(activeWaves()).toBe(table);
    expect(isDefaultSea()).toBe(false);
    // And the uniform followed the clock back, so the shader and the
    // CPU are still summing the same amplitudes at t = 0.
    for (let i = 0; i < table.length; i++) {
      const w = table[i];
      expect(SWELL_AMP_UNIFORM.value[i])
        .toBeCloseTo(w.amp * (w.envelope ? w.envelope(0) : 1), 9);
    }
  });

  it('is not something Ocean does at all any more', () => {
    // Ocean cannot be constructed here (it wants a GL context), so the
    // contract is pinned at the source. It used to restart the clock,
    // which was right while the water was only ever built once a
    // scene — and became wrong at Stage F, where the water is rebuilt
    // MID-TRANSITION as a new buoy reading fades in. Restarting the
    // clock there would jump the phase of every wave in the ocean at
    // the exact moment a crossfade exists to hide a change. So the
    // mesh forgets its lattice and nothing else; starting the sea over
    // belongs to whoever starts the scene over.
    const strip = (f: string) => readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const ocean = strip('src/world/Ocean.ts');
    expect(ocean).toContain('clearSwellLattice()');
    expect(ocean).not.toContain('restartSwellClock');
    expect(ocean).not.toContain('resetSwell');
    // ...and the stripper did not simply eat the file.
    expect(ocean).toContain('class Ocean');
    // The scene is where a fresh sea now starts.
    expect(strip('src/scenes/IslandScene.ts')).toContain('restartSwellClock()');
  });
});

describe('the conversion into the game\'s units', () => {
  it('keeps omega, and scales the lengths by a hundred', () => {
    const built = useProceduralSea();
    const table = activeWaves();
    for (let i = 0; i < table.length; i++) {
      const c = built.components[i];
      const w = table[i];
      // Omega is scale-invariant: sqrt(9.81*k_m) === sqrt(981*k_cm).
      expect(w.omega).toBeCloseTo(c.omega, 12);
      expect(w.k).toBeCloseTo(c.k / UNITS_PER_METRE, 12);
      expect(w.amp).toBeCloseTo(c.amplitudeM * UNITS_PER_METRE, 9);
      // And the table it produced still obeys deep-water dispersion in
      // the game's own units and gravity.
      expect(w.omega * w.omega).toBeCloseTo(981 * w.k, 6);
    }
  });

  it('carries an envelope per component, so the sea groups', () => {
    useProceduralSea();
    const table = activeWaves();
    expect(table.every((w) => typeof w.envelope === 'function')).toBe(true);
    // The envelope is a pure multiplier about one.
    for (const w of table) {
      expect(w.envelope!(0)).toBeGreaterThan(0);
      expect(w.envelope!(0)).toBeLessThan(2);
    }
    // And it actually moves the amplitude the sea is using.
    tickSwell(0);
    const first = SWELL_AMP_UNIFORM.value.slice();
    tickSwell(90);
    expect(SWELL_AMP_UNIFORM.value).not.toEqual(first);
  });
});

describe('the four comparisons', () => {
  it('macro only drops the chop entirely', () => {
    const built = useProceduralSea({ meso: false });
    expect(built.components.every((c) => c.scale === 'macro')).toBe(true);
  });

  it('meso only drops the macro entirely', () => {
    const built = useProceduralSea({ macro: false });
    expect(built.components.every((c) => c.scale === 'meso')).toBe(true);
  });

  it('mesoScale moves the chop and leaves the macro alone', () => {
    const loud = useProceduralSea({ mesoScale: 1 });
    const quiet = useProceduralSea({ mesoScale: 0.25 });
    const macroOf = (f: NonNullable<ReturnType<typeof liveField>>) =>
      f.components.filter((c) => c.scale === 'macro').map((c) => c.amplitudeM);
    expect(macroOf(quiet)).toEqual(macroOf(loud));
    const mesoOf = (f: NonNullable<ReturnType<typeof liveField>>) =>
      f.components.filter((c) => c.scale === 'meso')
        .reduce((s, c) => s + c.amplitudeM, 0);
    expect(mesoOf(quiet)).toBeCloseTo(mesoOf(loud) * 0.25, 6);
  });

  it('opens conservatively, so the chop cannot own the ride', () => {
    expect(DEFAULT_MESO_SCALE).toBeLessThan(0.5);
    const built = useProceduralSea();
    const table = activeWaves();
    const accel = (scale: 'macro' | 'meso') => table
      .filter((_, i) => built.components[i].scale === scale)
      .reduce((s, w) => s + w.amp * w.omega * w.omega, 0) / 100;
    // The complaint was ACCELERATION. At the opening scale the slow
    // macro swell must not be shouted down by the chop.
    expect(accel('meso')).toBeLessThan(accel('macro') * 3);
  });
});

describe('the generated sea is deterministic', () => {
  it('same seed, same table, every time', () => {
    const once = useProceduralSea({ worldSeed: 7, nowMs: 0 }).components;
    const twice = useProceduralSea({ worldSeed: 7, nowMs: 0 }).components;
    expect(twice).toEqual(once);
  });

  it('reports a reach and an amplitude that follow the table', () => {
    useProceduralSea();
    expect(swellAmplitude()).toBeGreaterThan(0);
    expect(swellReach()).toBeCloseTo(swellAmplitude() * 2.2, 6);
  });
});
