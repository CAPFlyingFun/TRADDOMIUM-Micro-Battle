/**
 * THE MAP IS MADE OF THE GROUND, AND HAS TO STAY THAT WAY.
 *
 * Joshua, 2026-08-31: "Needs to look like when you pick the spawn
 * location… Maybe render a smaller HD version of the island with actual
 * textures for better quality." So the overview is baked from the same
 * seven ground maps the terrain is built from, blended by the same
 * weights.
 *
 * The same weights, written twice — once as GLSL inside
 * terrainMaterial.ts and once as numbers here, because a fragment
 * shader cannot be called from a canvas bake. Two copies of a table is
 * exactly the thing that drifts, so this reads the shader's own source
 * and refuses to let them disagree. Change the ground and the map
 * follows, or a test goes red explaining why.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BAND_EDGES, bandMix } from '../src/ui/islandRelief';

const shader = readFileSync('src/world/terrainMaterial.ts', 'utf8');

/** The band weights as the shader declares them, in metres. */
function glslEdges(): Map<string, number[]> {
  const found = new Map<string, number[]>();
  // `float wGrass = span(h, ${m(10)}, ${m(220)}, ${m(14)});`
  const spans = shader.matchAll(
    /float\s+w(\w+)\s*=\s*span\(h,\s*\$\{m\((-?[\d.]+)\)\},\s*\$\{m\((-?[\d.]+)\)\},\s*\$\{m\((-?[\d.]+)\)\}\)/g,
  );
  for (const hit of spans) {
    found.set(hit[1].toLowerCase(), [Number(hit[2]), Number(hit[3]), Number(hit[4])]);
  }
  return found;
}

describe('the map reads the ground\'s own band table', () => {
  it('finds the shader\'s spans at all — if this fails, the rest is vacuous', () => {
    const edges = glslEdges();
    expect(edges.size).toBeGreaterThanOrEqual(5);
    expect([...edges.keys()]).toEqual(
      expect.arrayContaining(['sand', 'grass', 'jung', 'cliff', 'mount']),
    );
  });

  it('and agrees with it, band for band', () => {
    const edges = glslEdges();
    // The shader abbreviates; this is the only place the two spellings
    // are reconciled.
    const named: Record<string, string> = {
      sand: 'sand', grass: 'grass', jungle: 'jung', cliff: 'cliff', mountain: 'mount',
    };
    for (const band of BAND_EDGES) {
      const key = named[band.name];
      if (!key) continue;             // reef and snow are not spans; see below
      const glsl = edges.get(key);
      expect(glsl, `${band.name} is missing from the shader`).toBeDefined();
      expect([band.lo, band.hi, band.feather], band.name).toEqual(glsl);
    }
  });

  it('and the two that are not spans still match their smoothsteps', () => {
    // reef is `1 - smoothstep(-3.5, 0.5, h)` and snow is
    // `smoothstep(1200, 1450, h)`. Both are open-ended, so they are
    // written here as a span with an impossible far edge; what has to
    // agree is where they turn over.
    expect(shader).toContain('float wReef  = 1.0 - smoothstep(${m(-3.5)}, ${m(0.5)}, h)');
    expect(shader).toContain('float wSnow  = smoothstep(${m(1200)}, ${m(1450)}, h)');
    const reef = BAND_EDGES[0];
    const snow = BAND_EDGES[BAND_EDGES.length - 1];
    expect(reef.name).toBe('reef');
    expect(snow.name).toBe('snow');
    // Their midpoints are the shader's midpoints.
    expect(reef.hi).toBeCloseTo((-3.5 + 0.5) / 2, 6);
    expect(snow.lo).toBeCloseTo((1200 + 1450) / 2, 6);
  });

  it('uses all seven maps, including the mountain the chart forgot', () => {
    // THE BUG THIS CAUGHT. The first version asked heightfield.bandFor,
    // which is a SIX-step chart abstraction with no `mountain` in it —
    // so everything above 1,150 m came out white, and Kauaʻi grew a
    // snowcap four hundred metres too low.
    expect(BAND_EDGES.map((b) => b.name)).toEqual(
      ['reef', 'sand', 'grass', 'jungle', 'cliff', 'mountain', 'snow'],
    );
    const high = bandMix(1_150);
    expect(high[5], 'mountain shows at 1,150 m').toBeGreaterThan(0);
    expect(high[6], 'and snow does not own it').toBeLessThan(high[5]);
  });
});

describe('what is showing at a given height', () => {
  const share = (metres: number, name: string): number =>
    bandMix(metres)[BAND_EDGES.findIndex((b) => b.name === name)];

  it('is reef under the sea', () => {
    expect(share(-40, 'reef')).toBeCloseTo(1, 6);
    expect(share(-4000, 'reef')).toBeCloseTo(1, 6);
  });

  it('is sand on a beach and grass on a lowland', () => {
    expect(share(2, 'sand')).toBeGreaterThan(share(2, 'grass'));
    expect(share(120, 'grass')).toBeGreaterThan(share(120, 'sand'));
    expect(share(120, 'grass')).toBeGreaterThan(share(120, 'jungle'));
  });

  it('is jungle up the valleys and rock near the top', () => {
    expect(share(450, 'jungle')).toBeGreaterThan(0.8);
    expect(share(850, 'cliff')).toBeGreaterThan(share(850, 'jungle'));
    expect(share(1_500, 'snow')).toBeGreaterThan(share(1_500, 'mountain'));
  });

  it('always sums to one, so no seam comes out dark', () => {
    // The shader's weights are hand-tuned overlaps rather than a
    // partition — they do NOT sum to one — and a blend that assumed
    // they did would darken every band edge on the island.
    for (const metres of [-5000, -10, -1, 0, 5, 11, 15, 210, 230, 690, 980, 1_260, 1_600]) {
      const total = bandMix(metres).reduce((a, b) => a + b, 0);
      expect(total, `${metres} m`).toBeCloseTo(1, 6);
    }
  });

  it('never goes negative, and never leaves a height unpainted', () => {
    for (let metres = -6_000; metres <= 2_000; metres += 7) {
      const mix = bandMix(metres);
      for (const share of mix) expect(share).toBeGreaterThanOrEqual(0);
      expect(mix.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });
});
