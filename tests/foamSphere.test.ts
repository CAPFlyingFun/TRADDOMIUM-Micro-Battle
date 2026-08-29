/**
 * FOAM IS THE FIRST MICRO CONSUMER — the composition guards.
 *
 * A render test can say the water looks right; only reading the
 * emitted GLSL can say WHY, and these are the promises that a later
 * edit could quietly break without any frame going obviously wrong:
 *
 *   - the gate measures the WATER SURFACE, in three axes, from the
 *     queen — not the camera, not planar XZ, not the sheet's radius
 *   - the surface it measures is the one the swell displaced
 *   - the expensive foam samples sit INSIDE the branch, so distance
 *     buys real GPU work rather than a multiply by zero
 *   - the ordinary water — ripple octaves, colour, alpha, normal —
 *     sits OUTSIDE it, at every distance
 *   - the master's feather is the core's own constant, not a copy
 */
import { describe, expect, it } from 'vitest';
import { makeWaterLook } from '../src/world/waterLook';
import { microChunk } from '../src/world/lodShader';
import { DETAIL_FEATHER } from '../src/world/lod';

/**
 * The look loads its ripple and foam maps through three's
 * TextureLoader, which wants an <img>. This project runs its tests
 * without a DOM and stubs what it needs (see settings.test.ts), so
 * this is the smallest element that keeps the loader happy: it never
 * fires, the look keeps its flat and dark fallbacks, and the emitted
 * SOURCE — the only thing under test here — is identical either way.
 *
 * At module scope rather than in a hook: the suites below compile
 * their shaders while vitest is COLLECTING them, which happens before
 * any beforeAll runs.
 */
if (typeof (globalThis as { document?: unknown }).document === 'undefined') {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElementNS: () => ({
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    },
  });
}

/** Compile a wearer and hand back the source three.js would see. */
function shaderFor(swell: boolean): { vertex: string; fragment: string } {
  const look = makeWaterLook({
    green: 0, surf: 1, sink: true, ocean: true,
    edgeLo: 35, edgeHi: 95, midAt: 700, deepAt: 2600,
    texAmp: 0.4, anisotropy: 1,
    ...(swell
      ? { swell: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } }
      : { hole: { lo: 6800, hi: 8200 } }),
  });
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main(){\n#include <map_fragment>\n'
      + '#include <normal_fragment_maps>\n#include <lights_fragment_end>\n}',
  };
  const compile = look.material.onBeforeCompile as unknown as
    (s: typeof shader) => void;
  compile(shader);
  return { vertex: shader.vertexShader, fragment: shader.fragmentShader };
}

/** The body of the `if (micro > 0.0) { … }` branch. */
function branchBody(fragment: string): string {
  const from = fragment.indexOf('if (micro > 0.0) {');
  expect(from).toBeGreaterThan(-1);
  let depth = 0;
  let i = fragment.indexOf('{', from);
  const start = i + 1;
  for (; i < fragment.length; i++) {
    if (fragment[i] === '{') depth++;
    else if (fragment[i] === '}') {
      depth--;
      if (depth === 0) return fragment.slice(start, i);
    }
  }
  throw new Error('unterminated foam branch');
}

describe.each([['near sheet', true], ['far sheet', false]] as const)(
  'the foam gate — %s', (_name, swell) => {
    const { vertex, fragment } = shaderFor(swell);

    it('measures the rendered water surface in all three axes', () => {
      // The varying is the model matrix applied to the DISPLACED
      // vertex, which on the near sheet is the swell's own crest.
      expect(vertex).toContain('vRender = (modelMatrix * vec4(transformed, 1.0)).xyz');
      if (swell) {
        // …and the displacement happens before it is captured.
        expect(vertex.indexOf('transformed.y += lift'))
          .toBeLessThan(vertex.indexOf('vRender ='));
      }
      expect(fragment).toContain('distance(vRender, uLodQueen)');
    });

    it('does not fall back to any of the three wrong rulers', () => {
      const gate = fragment.slice(
        fragment.indexOf('float micro'), fragment.indexOf('float foam'),
      );
      expect(gate).not.toContain('vViewPosition'); // the camera's
      expect(gate).not.toContain('vSheet');        // the sheet's radius
      expect(gate).not.toContain('vWorld');        // planar, and float32-lossy
    });

    it('puts every expensive foam sample inside the branch', () => {
      const body = branchBody(fragment);
      for (const sample of [
        'uRipple, tiled(300.0)',  // the surf/speckle gate
        'uFoam, tiled(260.0)',    // the lace
        'uFoam, tiled(95.0)',     // the fizz
        'uRipple, tiled(700.0)',  // the open-water caps
      ]) expect(body).toContain(sample);
      // The derivative work that drives the texel safeguard, too.
      expect(body).toContain('dFdx(fizzUv)');
      expect(body).toContain('dFdx(speckUv)');
    });

    it('leaves the ordinary water outside it, at every distance', () => {
      const body = branchBody(fragment);
      // The four ripple octaves that make the surface move and shade.
      expect(body).not.toContain('rn0 +=');
      expect(body).not.toContain('gRn = mix(rn0, rn1, xf)');
      // Colour, the distance smear, and the alpha grading.
      expect(body).not.toContain('diffuseColor.rgb = col');
      expect(body).not.toContain('vec3 deepCol');
      expect(body).not.toContain('smoothstep(15.0, 320.0, depth)');
      // And the lighting normal, which lives in another include.
      expect(body).not.toContain('normal = normalize');
    });

    it('scales the whole foam contribution, mean floors included', () => {
      const body = branchBody(fragment);
      expect(body).toContain('foam *= micro');
      // The multiply is the LAST thing the branch does to foam, so
      // nothing — caps, wash, a mean-coverage floor — is added after
      // the sphere has had its say.
      expect(body.lastIndexOf('foam *= micro'))
        .toBeGreaterThan(body.lastIndexOf('foam = clamp'));
    });

    it('paints nothing when the gate is shut', () => {
      // foam starts at zero and the paint/alpha lines are outside the
      // branch, so a skipped fragment paints and grades with foam 0.
      expect(fragment).toContain('float foam = 0.0;');
      const paint = fragment.indexOf('mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam)');
      expect(paint).toBeGreaterThan(fragment.indexOf('foam *= micro'));
    });
  },
);

describe('the emitted gate', () => {
  it('bakes the core\'s own feather, so the two cannot drift', () => {
    expect(microChunk('vRender')).toContain(DETAIL_FEATHER.toFixed(3));
    expect(shaderFor(true).fragment).toContain(
      `uLodRadius * ${DETAIL_FEATHER.toFixed(3)}`,
    );
  });

  it('lets the debug force overrule the distance', () => {
    expect(shaderFor(true).fragment)
      .toContain('if (uLodMicroForce >= 0.0) micro = uLodMicroForce;');
  });

  it('binds the shared uniform objects rather than copies', () => {
    const look = makeWaterLook({
      green: 0, surf: 1, sink: true, ocean: true, edgeLo: 35, edgeHi: 95,
      midAt: 700, deepAt: 2600, texAmp: 0.4, anisotropy: 1,
    });
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>\n'
        + '#include <normal_fragment_maps>\n#include <lights_fragment_end>',
    };
    (look.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import('../src/world/lodShader').then((bridge) => {
      expect(shader.uniforms.uLodQueen).toBe(bridge.LOD_QUEEN_UNIFORM);
      expect(shader.uniforms.uLodRadius).toBe(bridge.LOD_RADIUS_UNIFORM);
      expect(shader.uniforms.uLodMicroForce).toBe(bridge.LOD_MICRO_FORCE_UNIFORM);
    });
  });
});
