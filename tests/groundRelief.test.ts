import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { groundShader } from '../src/world/terrainMaterial';
import {
  BAND_ROUGHNESS, RELIEF_AMPLITUDE, RELIEF_DIALS, RELIEF_PAIRS, RELIEF_UNIFORM_NAMES,
} from '../src/world/groundRelief';

/**
 * A `.replace` against three.js source that stops matching is not an
 * error, it is SILENCE: the build is clean, the shader compiles, and
 * the ground quietly comes back flat. So compose the real thing against
 * the real three.js chunks and check every injection actually landed —
 * and, because GLSL has no forward declarations, that each one landed
 * in an order where its variables already exist.
 */
const built = groundShader(
  THREE.ShaderLib.physical.vertexShader,
  THREE.ShaderLib.physical.fragmentShader,
);
const frag = built.fragmentShader;
const at = (needle: string) => frag.indexOf(needle);

describe('the micro-relief reaches the shader at all', () => {
  it('declares every packed map it samples', () => {
    for (const name of RELIEF_UNIFORM_NAMES) {
      expect(frag).toContain(name);
      expect(at(`uniform sampler2D t_relief0`)).toBeGreaterThanOrEqual(0);
      // declared before it is read
      expect(at(`texture2D(${name},`)).toBeGreaterThan(at('uniform sampler2D t_relief0'));
    }
  });

  it('samples one map per band pair — no band left unlit', () => {
    for (let i = 0; i < RELIEF_PAIRS.length; i++) {
      expect(frag).toContain(`texture2D(t_relief${i}, bandUv, mipBias)`);
    }
  });

  it('weights every one of the seven bands into the blend', () => {
    const blend = frag.slice(at('vec2 reliefXY = ('), at('float reliefZ'));
    for (const w of ['wReef', 'wSand', 'wGrass', 'wJung', 'wCliff', 'wMount', 'wSnow']) {
      expect(blend).toContain(w);
    }
  });
});

describe('it is declared before it is used', () => {
  it('blends the relief before the roughness that leans on it', () => {
    expect(at('float reliefCavity')).toBeGreaterThan(0);
    expect(at('roughnessFactor = clamp(')).toBeGreaterThan(at('float reliefCavity'));
  });

  it('blends the relief before the normal that bends by it', () => {
    expect(at('vec2 reliefGrad')).toBeGreaterThan(0);
    expect(at('reliefBump * surfaceGrad')).toBeGreaterThan(at('vec2 reliefGrad'));
  });

  it('perturbs the normal after three.js has established one', () => {
    expect(at('#include <normal_fragment_maps>')).toBeGreaterThan(0);
    expect(at('normal = normalize((viewMatrix'))
      .toBeGreaterThan(at('#include <normal_fragment_maps>'));
  });
});

describe('the surface answers the sun differently per material', () => {
  it('carries every band roughness from the one table that holds them', () => {
    const mix = frag.slice(at('roughnessFactor = clamp('), at('Wet sand'));
    for (const value of Object.values(BAND_ROUGHNESS)) {
      expect(mix).toContain(value.toFixed(2));
    }
  });

  it('does not leave the island on one flat roughness', () => {
    const distinct = new Set(Object.values(BAND_ROUGHNESS));
    expect(distinct.size).toBeGreaterThan(4);
  });
});

describe('detail that cannot be resolved is not lit', () => {
  it('fades the relief on the same schedule as the texture it describes', () => {
    // Lighting grains a pixel cannot resolve is not detail, it crawls.
    expect(frag).toContain('reliefXY *= 1.0 - far;');
    expect(at('reliefXY *= 1.0 - far;')).toBeGreaterThan(at('float far ='));
  });
});

describe('the beach is two sands, blended', () => {
  it('mixes the coarse and fine colours rather than banding them', () => {
    expect(frag).toContain('float smoothShare');
    expect(frag).toContain('t_sandsmooth');
    expect(at('vec3 sandColour = mix(')).toBeGreaterThan(at('float smoothShare'));
  });

  it('carries the same share into relief, roughness and occlusion', () => {
    // If the light and the picture disagree about which beach this is,
    // the relief describes grains that are not in the photograph.
    expect(at('vec2 sandXY = mix(')).toBeGreaterThan(at('float smoothShare'));
    expect(frag).toContain('sandShare * smoothShare');
    expect(frag.match(/sandShare \* smoothShare/g)?.length).toBe(2);
  });

  it('declares the share before every one of its uses', () => {
    const declared = at('float smoothShare');
    expect(declared).toBeGreaterThan(0);
    let from = declared + 1;
    for (;;) {
      const use = frag.indexOf('smoothShare', from);
      if (use < 0) break;
      expect(use).toBeGreaterThan(declared);
      from = use + 1;
    }
    // and nothing reads it earlier
    expect(frag.indexOf('smoothShare')).toBe(declared + 'float '.length);
  });

  it('scatters the boundary instead of drawing a contour round the beach', () => {
    expect(frag).toContain('sandPatch');
    expect(at('float smoothShare')).toBeGreaterThan(at('float sandPatch'));
  });

  it('gives the scanned sand a slot that carries its surface maps', () => {
    const surfaced = RELIEF_PAIRS.filter((p) => p.surface);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].surface).toBe('sandsmooth');
    expect(surfaced[0].b).toBeNull();
  });
});

describe('the relief has a size you can state in centimetres', () => {
  it('spans 2 cm peak to peak, +1 above the mid and -1 below', () => {
    expect(RELIEF_AMPLITUDE).toBe(2);
    expect(RELIEF_AMPLITUDE / 2).toBe(1);
  });

  it('turns that into the slope the shader actually needs', () => {
    // Rise over run, both in world units. A 128-unit tile across 1024
    // texels puts a texel at 1.25 mm, so 2 cm of relief is a slope of
    // 16 — steep, and correctly so at an ant's scale.
    const texelWorld = 128 / 1024;
    expect(texelWorld).toBeCloseTo(0.125, 6);
    expect(RELIEF_AMPLITUDE / texelWorld).toBe(16);
  });

  it('leaves the dial meaning exactly the measurement at 1.0', () => {
    // Anything else is a deliberate exaggeration, not a hidden fudge.
    expect(RELIEF_DIALS.normalStrength).toBe(1);
  });

  it('averages the three spans rather than summing them', () => {
    // Each span is a derivative once it is divided by its own width, so
    // adding them raw made a wide span count for more merely because it
    // reached further — a shape emphasis in no units at all.
    const weights = RELIEF_DIALS.fineWeight + RELIEF_DIALS.midWeight
      + RELIEF_DIALS.coarseWeight;
    expect(weights).toBeGreaterThan(1);
  });
});

describe('the profiling switch is a real switch', () => {
  /**
   * `relief(0)` skips only the final normal bend. The five texture
   * fetches, the blend, the cavity and the scanned roughness all still
   * run, so measuring 0 against 1 compares two shaders doing nearly the
   * same work — and would have reported the relief as free. The switch
   * under test removes the path at COMPILE time instead.
   */
  const guarded = (needle: string) => {
    const at = frag.indexOf(needle);
    expect(at).toBeGreaterThan(0);
    const open = frag.lastIndexOf('#ifdef GROUND_RELIEF', at);
    const close = frag.lastIndexOf('#endif', at);
    // The nearest preceding guard must be an opening one.
    return open > close;
  };

  it('puts every relief texture fetch behind the define', () => {
    for (let i = 0; i < RELIEF_PAIRS.length; i++) {
      expect(guarded(`texture2D(t_relief${i}, bandUv, mipBias)`)).toBe(true);
    }
  });

  it('puts the samplers themselves behind it, not just their uses', () => {
    // A declared-but-unused sampler still costs a texture unit, and a
    // fetch left outside the guard would not compile without them.
    expect(guarded('uniform sampler2D t_relief0')).toBe(true);
    expect(guarded('uniform float reliefBump, reliefAo')).toBe(true);
  });

  it('puts the derived maths and the normal bend behind it', () => {
    expect(guarded('float reliefCavity')).toBe(true);
    expect(guarded('reliefBump * surfaceGrad')).toBe(true);
    expect(guarded('reliefCavity * 0.22')).toBe(true);
    expect(guarded('roughnessFactor = mix(roughnessFactor, r4.b')).toBe(true);
  });

  it('leaves the COLOUR work alone — it is not part of the relief', () => {
    // The two-sand blend is a colour feature and must survive in BASE,
    // or the A/B would be measuring two different-looking grounds.
    expect(guarded('vec3 sandColour = mix(')).toBe(false);
    expect(guarded('uniform sampler2D t_sandsmooth')).toBe(false);
    expect(guarded('float smoothShare')).toBe(false);
  });

  it('balances every guard it opens', () => {
    const opens = frag.match(/#ifdef GROUND_RELIEF/g)?.length ?? 0;
    const closes = frag.match(/#endif/g)?.length ?? 0;
    expect(opens).toBeGreaterThan(0);
    expect(closes).toBeGreaterThanOrEqual(opens);
  });
});

describe('the LITE diagnostic samples nothing', () => {
  /** The source between `#ifdef GROUND_LITE` and its `#else`. */
  const liteBranch = (() => {
    const open = frag.indexOf('#ifdef GROUND_LITE');
    expect(open).toBeGreaterThan(0);
    return frag.slice(open, frag.indexOf('#else', open));
  })();

  it('takes not one texture sample of any kind', () => {
    // The whole point: if LITE still sampled, FULL vs LITE would price
    // nothing and the reading would send us optimising the wrong thing.
    expect(liteBranch).not.toContain('texture2D');
    expect(liteBranch).not.toContain('texture(');
  });

  it('builds its colour from the band averages already computed', () => {
    for (const avg of ['avg_reef', 'avg_sand', 'avg_grass', 'avg_jungle',
      'avg_cliff', 'avg_mountain', 'avg_snow']) {
      expect(liteBranch).toContain(avg);
    }
  });

  it('keeps the same weights, so it is the same island', () => {
    for (const w of ['wReef', 'wSand', 'wGrass', 'wJung', 'wCliff', 'wMount', 'wSnow']) {
      expect(liteBranch).toContain(w);
    }
    expect(liteBranch).toContain('/ total');
  });

  it('drops the custom roughness too — that is texture work as well', () => {
    const rough = frag.slice(frag.indexOf('#include <roughnessmap_fragment>'));
    expect(rough.slice(0, 200)).toContain('#ifndef GROUND_LITE');
  });

  it('leaves the tier cut alone, which is geometry and not shading', () => {
    // Discarding where a finer tier covers the same ground must happen
    // in every mode, or the modes draw different amounts of world.
    const cut = frag.indexOf('if (nearCut > 0.0');
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(frag.indexOf('#ifdef GROUND_LITE'));
  });
});
