/**
 * THE WATER'S SHADER, AND THE FOUR TEXTURE READS IT STOPPED DOING.
 *
 * The look is accepted and protected (CLAUDE.md), so most of what is
 * pinned here is that it still says what it said. The one real claim
 * this file has to prove is the change that makes the ocean cheaper
 * without changing a pixel:
 *
 *   v0 sampled each ripple octave TWICE — two copies of the pattern half
 *   an advection cycle apart, crossfaded, so a spatially varying current
 *   could not shear the texture into taffy. That is a RIVER's problem.
 *   The ocean's `flow` attribute is all zeros and always was, and with
 *   zero flow both phases sample the identical point: `mix(x, x, t)` is
 *   `x`. Eight texture reads a fragment, on the largest surface on
 *   screen, to compute what four compute exactly.
 *
 * So the identity is checked rather than asserted: the emitted GLSL is
 * parsed back into its taps and the one-phase form is required to be the
 * two-phase form's `rn0` with the advection set to zero — which is what
 * `vFlow == 0` makes it.
 *
 * THE SHADER IS INSPECTED BY RUNNING `onBeforeCompile` BY HAND against a
 * stub carrying the three.js include lines it patches. There is no
 * WebGL here and none is wanted: the question is what source the module
 * emits, and that is answerable without a GPU.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SeaSwell } from '../src/world/sea/swell';
import { FOAM_FAR, FOAM_NEAR, MAX_OCTAVES, makeWaterLook, rippleChunk } from '../src/sea/waterLook';

/** The include lines this module replaces. Anything else three emits is irrelevant here. */
const STUB_VERTEX = ['#include <common>', 'void main() {', '#include <begin_vertex>', '}'].join('\n');
const STUB_FRAGMENT = [
  '#include <common>',
  'void main() {',
  '#include <map_fragment>',
  '#include <normal_fragment_maps>',
  '#include <lights_fragment_end>',
  '}',
].join('\n');

interface Compiled {
  uniforms: Record<string, { value: unknown }>;
  vertexShader: string;
  fragmentShader: string;
}

const slot = (): { value: THREE.Texture } => ({ value: new THREE.Texture() });

function compile(over: Partial<Parameters<typeof makeWaterLook>[0]> = {}): {
  look: ReturnType<typeof makeWaterLook>;
  shader: Compiled;
} {
  const look = makeWaterLook({
    swell: new SeaSwell({ groundAt: () => -4000 }),
    ripple: slot(),
    foam: slot(),
    green: 0,
    surf: 1,
    sink: true,
    edgeLo: 35,
    edgeHi: 95,
    midAt: 700,
    deepAt: 2_600,
    texAmp: 0.4,
    advected: false,
    ...over,
  });
  const shader: Compiled = { uniforms: {}, vertexShader: STUB_VERTEX, fragmentShader: STUB_FRAGMENT };
  // three calls this with its own shader object; the module only ever
  // reads `uniforms` and rewrites the two sources.
  (look.material.onBeforeCompile as (s: Compiled) => void)(shader);
  return { look, shader };
}

/**
 * Every `texture2D(uRipple, …)` argument in a chunk, in order.
 *
 * PAREN-BALANCED, not a regex. A non-greedy `\)\)` looked right and was
 * not: the still form's argument contains `vec2(0.0)` and the moving
 * form's does not, so the two were being cut at different places and the
 * identity below compared two truncations.
 */
function rippleTaps(glsl: string): string[] {
  const taps: string[] = [];
  const OPEN = 'texture2D(uRipple,';
  for (let at = glsl.indexOf(OPEN); at >= 0; at = glsl.indexOf(OPEN, at + 1)) {
    let depth = 1;
    let i = at + OPEN.length;
    for (; i < glsl.length && depth > 0; i += 1) {
      if (glsl[i] === '(') depth += 1;
      else if (glsl[i] === ')') depth -= 1;
    }
    taps.push(glsl.slice(at + OPEN.length, i - 1).trim());
  }
  return taps;
}

describe('the ocean stopped sampling the same point twice', () => {
  it('emits one phase for still water and two for moving water', () => {
    expect(rippleTaps(rippleChunk(MAX_OCTAVES, false))).toHaveLength(MAX_OCTAVES);
    expect(rippleTaps(rippleChunk(MAX_OCTAVES, true))).toHaveLength(MAX_OCTAVES * 2);
  });

  it('emits the SAME taps, with the advection that is provably zero removed', () => {
    // The identity. Take the two-phase form's first-phase taps, replace
    // its advection term with the zero it holds when vFlow is zero, and
    // the one-phase form's taps must be exactly that. Not "similar":
    // identical text, so no constant, rotation, tile or scroll rate can
    // have moved on the way.
    const still = rippleTaps(rippleChunk(MAX_OCTAVES, false));
    const moving = rippleTaps(rippleChunk(MAX_OCTAVES, true));
    const firstPhase = moving.filter((_, i) => i % 2 === 0);
    expect(firstPhase.map((tap) => tap.replace(/\ba0\b/g, 'vec2(0.0)'))).toEqual(still);
  });

  it('shows why the advection is zero, in the source itself', () => {
    // The argument depends on `adv` being `vFlow` scaled, and on the
    // ocean's flow attribute being zeros (OceanView's lattice). If a
    // later edit gave `adv` a constant term the identity above would
    // still pass while the claim became false, so the derivation is
    // pinned too.
    const moving = rippleChunk(MAX_OCTAVES, true);
    expect(moving).toMatch(/vec2 adv = vFlow \* \(11\.1\);/);
    expect(moving).toMatch(/vec2 a0 = adv \* t0;/);
    expect(moving).toMatch(/vec2 a1 = adv \* t1;/);
    // And the still form takes no crossfade at all, rather than mixing
    // a value with itself at runtime.
    expect(rippleChunk(MAX_OCTAVES, false)).not.toMatch(/\bmix\(/);
    expect(rippleChunk(MAX_OCTAVES, false)).toMatch(/gRn = rn0;/);
  });

  it('halves the ripple reads in the compiled ocean fragment shader', () => {
    // The end-to-end version of the same claim, counted on the real
    // emitted fragment source rather than on the chunk.
    const still = rippleTaps(compile({ advected: false }).shader.fragmentShader);
    const moving = rippleTaps(compile({ advected: true }).shader.fragmentShader);
    // Both also sample uRipple twice outside the octave ladder — the
    // surf noise and the whitecap normals — so the difference is exactly
    // the four extra octave taps.
    expect(moving.length - still.length).toBe(MAX_OCTAVES);
  });
});

describe('the octave count is a dial, and it shows', () => {
  it('drops octaves from the FINE end, keeping the ones that read as water', () => {
    // The 100-unit octave is the one Joshua's map was authored at and
    // the two above it break the tiling; the 45 is near-field sparkle.
    // A tier that drops detail must drop the detail nobody can resolve.
    const four = rippleTaps(rippleChunk(4, false));
    for (const count of [1, 2, 3]) {
      expect(rippleTaps(rippleChunk(count, false))).toEqual(four.slice(0, count));
    }
  });

  it('clamps rather than emitting nonsense', () => {
    expect(rippleTaps(rippleChunk(0, false))).toHaveLength(1);
    expect(rippleTaps(rippleChunk(-3, false))).toHaveLength(1);
    expect(rippleTaps(rippleChunk(99, false))).toHaveLength(MAX_OCTAVES);
    expect(compile({ octaves: 99 }).look.octaves).toBe(MAX_OCTAVES);
    expect(compile({ octaves: 0 }).look.octaves).toBe(1);
  });
});

describe('the program cache key names everything the source depends on', () => {
  // three caches compiled programs against the MATERIAL's parameters and
  // cannot know what onBeforeCompile injected. In v0 that handed the near
  // ocean sheet the far sheet's program for three versions: no swell, and
  // the far sheet's HOLE — which follows the near sheet, so the near
  // sheet erased itself exactly where the player was standing.
  const keyOf = (over: Parameters<typeof compile>[0]): string =>
    (compile(over).look.material.customProgramCacheKey as () => string)();

  it('separates two tiers that differ only in octave count', () => {
    expect(keyOf({ octaves: 4 })).not.toBe(keyOf({ octaves: 2 }));
  });

  it('separates still water from advected water', () => {
    expect(keyOf({ advected: false })).not.toBe(keyOf({ advected: true }));
  });

  it('separates the near sheet from the far one', () => {
    const near = keyOf({ swellRim: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } });
    const far = keyOf({ hole: { lo: 6800, hi: 8200 } });
    expect(near).not.toBe(far);
  });

  it('separates the sea from fresh water', () => {
    expect(keyOf({ ocean: true })).not.toBe(keyOf({ ocean: false }));
  });

  it('gives two identical wearers the same key, or the cache would never hit', () => {
    expect(keyOf({ octaves: 3 })).toBe(keyOf({ octaves: 3 }));
  });
});

describe('the sea and the pond get different shaders', () => {
  it('gives the breaker block to the sea and not to fresh water', () => {
    // v0 ran this on both for eight versions, giving a pool on a
    // hillside breakers marching off the Pacific's own table.
    expect(compile({ ocean: true }).shader.fragmentShader).toMatch(/THE FOAM RIDES THE WAVE THAT MADE IT/);
    expect(compile({ ocean: false }).shader.fragmentShader).not.toMatch(/THE FOAM RIDES THE WAVE THAT MADE IT/);
  });

  it('binds the swell’s amplitudes only where the shader reads them', () => {
    // Binding a live ocean uniform onto a material whose program never
    // declares it leaves a value nobody reads and a reader nobody warned.
    const sea = compile({ ocean: true }).shader.uniforms;
    const pond = compile({ ocean: false }).shader.uniforms;
    const swellUniforms = Object.keys(sea).filter((k) => !(k in pond));
    expect(swellUniforms.length).toBeGreaterThan(0);
  });

  it('shares one amplitude array with the CPU, by reference', () => {
    // Half of why the drawn wave and the queried wave cannot disagree:
    // the shader's amplitude uniform IS the object the swell writes.
    const swell = new SeaSwell({ groundAt: () => -4000 });
    const { shader } = compile({ swell, ocean: true });
    const bound = Object.values(shader.uniforms).find((u) => u === (swell.ampUniform as unknown));
    expect(bound).toBe(swell.ampUniform);
  });
});

describe('the swell reaches the vertex shader from the module that owns it', () => {
  it('displaces the near sheet and leaves the far one flat', () => {
    const near = compile({ swellRim: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } });
    const far = compile({ hole: { lo: 6800, hi: 8200 } });
    expect(near.shader.vertexShader).toMatch(/transformed\.y \+= lift;/);
    expect(far.shader.vertexShader).not.toMatch(/transformed\.y \+=/);
  });

  it('keeps the trough off the bed with the swell’s own KEEL', () => {
    // Without it the sheet drives through the sand in the shallows, which
    // reads as z-fighting because it IS the sheet and the seabed trading
    // places. The number is the swell's, not a copy.
    const near = compile({ swellRim: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } });
    expect(near.shader.vertexShader).toMatch(/-max\(0\.0, depth - 4\.0\)/);
  });

  it('bakes the same table the CPU sums', () => {
    const swell = new SeaSwell({ groundAt: () => -4000 });
    const { shader } = compile({ swell, swellRim: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } });
    // Not a re-implementation: the chunk the swell prints, verbatim.
    expect(shader.vertexShader).toContain(swell.swellChunk().trim().split('\n')[0].trim());
    expect(shader.vertexShader).toContain(swell.shoalChunk().trim().split('\n')[0].trim());
  });
});

describe('the foam’s distance gate', () => {
  it('is a uniform pair with v0’s reach, not a baked constant', () => {
    const { look, shader } = compile();
    expect(look.foamNear.value).toBe(FOAM_NEAR);
    expect(look.foamFar.value).toBe(FOAM_FAR);
    expect(shader.uniforms.uFoamNear).toBe(look.foamNear as unknown);
    expect(shader.uniforms.uFoamFar).toBe(look.foamFar as unknown);
  });

  it('BRANCHES on it rather than multiplying by it', () => {
    // The point of an LOD rather than a fade: outside the reach the
    // fragment skips four texture samples, their derivatives and the
    // swell sum, instead of computing them and scaling them to nothing.
    const { shader } = compile();
    expect(shader.fragmentShader).toMatch(/if \(micro > 0\.0\) \{/);
    expect(shader.fragmentShader).toMatch(/foam \*= micro;/);
  });

  it('measures from the camera, which is the player in this build', () => {
    const { shader } = compile();
    expect(shader.fragmentShader).toMatch(/smoothstep\(uFoamNear, uFoamFar, length\(vViewPosition\)\)/);
  });
});

describe('the accepted look is still the accepted look', () => {
  it('keeps BE’s material constants', () => {
    const { look } = compile();
    const material = look.material;
    expect(material.color.getHex()).toBe(0x1a6389);
    expect(material.roughness).toBeCloseTo(0.18, 6);
    expect(material.metalness).toBeCloseTo(0.1, 6);
    expect(material.opacity).toBeCloseTo(0.63, 6);
    expect(material.transparent).toBe(true);
    // She swims; the sheet must exist from below.
    expect(material.side).toBe(THREE.DoubleSide);
  });

  it('sinks the ocean in the depth buffer and lifts inland water', () => {
    // The ocean sinks so near-coplanar shore terrain wins the tie; a
    // film lies ON the ground it is coplanar with, and sinking it hands
    // the whole sheet to the sand.
    expect(compile({ sink: true }).look.material.polygonOffsetUnits).toBe(12);
    expect(compile({ sink: false }).look.material.polygonOffsetUnits).toBe(-6);
  });

  it('keeps the waterline feather Joshua approved', () => {
    const { shader } = compile();
    expect(shader.fragmentShader).toMatch(/smoothstep\(35\.0, 95\.0, depth\)/);
  });

  it('keeps the close-up alpha term at exactly the distance it was tuned to', () => {
    // "by 2.5m away, make it exactly like now to get the best of both
    // worlds" — so it is 1.0 by 250 units, and every frame he approved
    // is bit-identical.
    const { shader } = compile();
    expect(shader.fragmentShader).toMatch(/smoothstep\(60\.0, 250\.0, length\(vViewPosition\)\)/);
  });

  it('reads the shared textures rather than loading its own', () => {
    // v0 loaded them per wearer: two copies for the ocean's two sheets,
    // three once inland water existed, and `dispose` could reach none of
    // them because they were closure-captured.
    const ripple = slot();
    const foam = slot();
    const a = compile({ ripple, foam });
    const b = compile({ ripple, foam });
    expect(a.shader.uniforms.uRipple).toBe(ripple as unknown);
    expect(b.shader.uniforms.uRipple).toBe(ripple as unknown);
    expect(a.shader.uniforms.uFoam).toBe(foam as unknown);
  });
});
