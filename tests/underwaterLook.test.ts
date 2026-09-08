/**
 * WHICH WATER THE EYE IS UNDER — the surface the look is keyed off, and
 * the two ways it could pick wrong.
 *
 * Joshua, 2026-09-08, from alpha.34: under inland flood water there was
 * no fog; under the sea there was. The scene's gate was "the bed is
 * below mean sea level", which is the sea's basin and nothing else, so
 * no pond could ever fog. `submergingSurface` asks both owners by the
 * router's rule — the bed decides. What is easy to get wrong is the two
 * edges: a helper that asked the inland water below MSL would let a
 * coastal window answer for the sea, and one that ignored the layer
 * toggles would fog under water nobody can see.
 */
import { describe, expect, it, vi } from 'vitest';
import { submergingSurface, underwaterLook } from '../src/sea/underwaterLook';
import { SEA_LEVEL } from '../src/world/heightfield';

/** A metre, in world units. */
const M = 100;

describe('the surface the eye can be under', () => {
  it('is the swell where the bed is the sea’s and the ocean is drawn', () => {
    const swell = vi.fn(() => SEA_LEVEL + 0.4 * M);
    const surface = submergingSurface(SEA_LEVEL - 6 * M, { on: true, surfaceAt: swell }, null);
    expect(surface).toBe(SEA_LEVEL + 0.4 * M);
    expect(swell).toHaveBeenCalledTimes(1);
    // A crest over her eye really does put her under: the height handed
    // on is the swell's, not the mean, so the look washes in with it.
    const eye = SEA_LEVEL + 0.2 * M;
    expect(underwaterLook((surface ?? Number.NaN) - eye)).not.toBeNull();
  });

  it('is the inland water’s surface where the bed is above MSL and the layer is drawn', () => {
    const bed = SEA_LEVEL + 300 * M;
    const pond = vi.fn(() => bed + 0.3 * M);
    const surface = submergingSurface(bed, { on: true, surfaceAt: () => SEA_LEVEL }, { on: true, surfaceAt: pond });
    expect(surface).toBe(bed + 0.3 * M);
    expect(pond).toHaveBeenCalledTimes(1);
    // An eye a hand's width under that pond is under water, which is
    // the whole of what alpha.34 was missing.
    expect(underwaterLook((surface ?? Number.NaN) - (bed + 0.1 * M))).not.toBeNull();
    // And above it is air, exactly as it is above the sea.
    expect(underwaterLook((surface ?? Number.NaN) - (bed + 0.5 * M))).toBeNull();
  });

  it('is nothing where there is no water to be under', () => {
    const bed = SEA_LEVEL + 300 * M;
    // No spot: the window holds no water here, or the eye is outside it.
    expect(submergingSurface(bed, { on: true, surfaceAt: () => SEA_LEVEL }, { on: true, surfaceAt: () => null })).toBeNull();
    // No owners at all — the water has not been built yet.
    expect(submergingSurface(bed, null, null)).toBeNull();
    expect(submergingSurface(SEA_LEVEL - 6 * M, null, null)).toBeNull();
    // An inland source that is registered but has nothing here does not
    // make the sea answer on a hillside, whatever the ocean says.
    expect(submergingSurface(bed, { on: true, surfaceAt: () => SEA_LEVEL + 5 * M }, null)).toBeNull();
  });

  it('has no surface under a layer that is switched off', () => {
    // A fog under water nobody can see is the fog claiming water that
    // is not there. The toggles gate each owner on its own side of the
    // bed, and one owner being off does not make the other answer.
    const bed = SEA_LEVEL + 300 * M;
    const pond = vi.fn(() => bed + 0.3 * M);
    const swell = vi.fn(() => SEA_LEVEL + 0.4 * M);
    expect(submergingSurface(bed, { on: true, surfaceAt: swell }, { on: false, surfaceAt: pond })).toBeNull();
    expect(submergingSurface(SEA_LEVEL - 6 * M, { on: false, surfaceAt: swell }, { on: true, surfaceAt: pond })).toBeNull();
    expect(submergingSurface(bed, { on: false, surfaceAt: swell }, { on: false, surfaceAt: pond })).toBeNull();
    // Off means not even asked: an owner that is hidden may have
    // cleared its lattice, and a read of it is a number about nothing.
    expect(pond).not.toHaveBeenCalled();
    expect(swell).not.toHaveBeenCalled();
  });

  it('asks the SEA below MSL even where an inland spot would also answer — the bed decides', () => {
    // The router's own rule, said again here rather than trusted from
    // three files away: a coastal inland window that overlaps the sea
    // must not answer for it. The inland source is not merely outvoted;
    // it is not consulted.
    const pond = vi.fn(() => SEA_LEVEL + 2 * M);
    const swell = vi.fn(() => SEA_LEVEL + 0.4 * M);
    const surface = submergingSurface(SEA_LEVEL - 0.5 * M, { on: true, surfaceAt: swell }, { on: true, surfaceAt: pond });
    expect(surface).toBe(SEA_LEVEL + 0.4 * M);
    expect(swell).toHaveBeenCalledTimes(1);
    expect(pond).not.toHaveBeenCalled();
    // And the line is MSL itself, on the router's side of it: a bed AT
    // sea level is not below it and belongs to the inland water.
    const shore = submergingSurface(SEA_LEVEL, { on: true, surfaceAt: swell }, { on: true, surfaceAt: pond });
    expect(shore).toBe(SEA_LEVEL + 2 * M);
    expect(swell).toHaveBeenCalledTimes(1);
  });

  it('does not flood the world on a reading that failed', () => {
    // A NaN ground compares false against MSL and is asked of the inland
    // water, as the router does; a NaN surface is above, not below.
    const pond = vi.fn(() => null);
    expect(submergingSurface(Number.NaN, { on: true, surfaceAt: () => SEA_LEVEL }, { on: true, surfaceAt: pond })).toBeNull();
    expect(pond).toHaveBeenCalledTimes(1);
    const bad = submergingSurface(SEA_LEVEL - 6 * M, { on: true, surfaceAt: () => Number.NaN }, null);
    expect(underwaterLook((bad ?? Number.NaN) - SEA_LEVEL)).toBeNull();
  });
});
