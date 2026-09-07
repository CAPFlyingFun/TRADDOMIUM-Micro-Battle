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
import {
  FOAM_FAR, FOAM_NEAR, LIT_HI, LIT_LO, MAX_OCTAVES, SHEEN_NIGHT_FLOOR, SHEEN_REFERENCE, SKY_GAIN, WASH_FLOOR,
  makeWaterLook, rippleChunk,
} from '../src/sea/waterLook';
import { HORIZON_CLEAR, skyLook, type Rgb, type SkyLook } from '../src/sky/skyLook';
import type { SunPosition } from '../src/world/weather/solar';
import { FAIR, visibilityFor, type WeatherNow } from '../src/world/weather/weather';

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

/**
 * NOTHING AT TRUE-SCALE RANGE GOES TO THE GPU RAW (CLAUDE.md), and this
 * file is where the sea keeps that promise.
 *
 * Kauaʻi is 5,600,000 units across with the origin in its middle, so on
 * a real coast a world coordinate is a couple of MILLION. A float32
 * there resolves in quarter-units, and the shader was being handed three
 * such numbers: the wave phase, every ripple texture coordinate, and the
 * distance to the far sheet's hole — the last two through a varying, so
 * a number that size was INTERPOLATED across triangles kilometres wide.
 * Quantised phase is a faceted surface, a quantised texture coordinate
 * is a stepped one, and quantised alpha is banding; together they are
 * the washboard Joshua photographed at Polihale on 2026-09-05, and
 * `npm run probe:shot` recreates it from the numbers in his HUD.
 *
 * The fix in all three places is the same and is EXACT rather than an
 * approximation: the sheet's centre is known on the CPU, so subtract it
 * there in float64 and hand the shader the remainder. What these tests
 * check is that the two halves still add back up to the whole — because
 * a centre reduced with the wrong arithmetic does not look broken. It
 * looks like water somewhere else.
 */
describe('no world coordinate reaches the shader raw', () => {
  /** Polihale, where the washboard was photographed. */
  const COAST = { wx: -2_182_400, wz: -477_600 };
  const HOLE_BAND = { lo: 6800, hi: 8200 };

  /** GLSL's `mat2(c, -s, s, c)` is COLUMN-major, so this is its action. */
  const rrot = (a: number, x: number, y: number): { x: number; y: number } => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: c * x + s * y, y: -s * x + c * y };
  };

  it('carries no varying holding a world position', () => {
    // `vWorld = vLocal + uCentre` was the single worst line: a float32
    // sum in the millions, computed per vertex and then INTERPOLATED.
    const { shader } = compile({ hole: HOLE_BAND });
    expect(shader.vertexShader).not.toMatch(/\bvWorld\b/);
    expect(shader.fragmentShader).not.toMatch(/\bvWorld\b/);
  });

  it('spells `rrot` the way the CPU-side reduction assumes it is spelled', () => {
    // If this convention changes, `fillOct` rotates one way and the
    // shader the other, and every ripple lands on a different texel —
    // which reads as "the water looks a bit different" and nothing else.
    const { shader } = compile();
    expect(shader.fragmentShader).toContain('mat2 rrot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }');
  });

  it('reduces each ripple octave against the sheet and lands on the SAME TEXEL as the world sample did', () => {
    // The identity: a wrapping texture does not notice a whole number of
    // tiles, so `mod` may be applied to the centre alone — provided it
    // comes AFTER the rotation, because rotating a reduced position is
    // not the same as reducing a rotated one. That ordering is the whole
    // correctness of the change and it is what this measures.
    const { look, shader } = compile();
    look.setCentre(COAST.wx, COAST.wz);
    const offsets = shader.uniforms.uOct.value as THREE.Vector2[];
    const taps = rippleTaps(rippleChunk(MAX_OCTAVES, false));
    expect(taps).toHaveLength(MAX_OCTAVES);
    expect(offsets).toHaveLength(MAX_OCTAVES);

    taps.forEach((tap, i) => {
      const rot = Number(/rrot\(([-\d.]+)\)/.exec(tap)?.[1]);
      const tile = Number(/\)\s*\/\s*([\d.]+)/.exec(tap)?.[1]);
      expect(Number.isFinite(rot) && Number.isFinite(tile)).toBe(true);
      expect(tap).toContain(`uOct[${i}]`);
      // Two points in the sheet, one of them off-centre in both axes.
      for (const [lx, lz] of [[0, 0], [-6_140, 3_970]]) {
        const was = rrot(rot, COAST.wx + lx, COAST.wz + lz); // what v0 sampled
        const now = rrot(rot, lx, lz); // what the shader sees now
        const withOffset = { x: now.x + offsets[i].x, y: now.y + offsets[i].y };
        // The two differ by a whole number of tiles in each axis, so the
        // wrapping lookup is the same texel. Whole to a part in 10^9.
        for (const axis of ['x', 'y'] as const) {
          const tiles = (was[axis] - withOffset[axis]) / tile;
          expect(Math.abs(tiles - Math.round(tiles))).toBeLessThan(1e-9);
        }
      }
      // And the reduction actually happened: the offset is inside one
      // tile. Two million units divided down to under a thousand is the
      // entire point, and a `mod` that quietly did nothing would still
      // satisfy the identity above.
      expect(offsets[i].x).toBeGreaterThanOrEqual(0);
      expect(offsets[i].x).toBeLessThan(tile);
      expect(offsets[i].y).toBeGreaterThanOrEqual(0);
      expect(offsets[i].y).toBeLessThan(tile);
    });
  });

  it('re-derives the wave phases from the sheet’s centre, in float64, every time it moves', () => {
    // A centre moved without its phases draws the sea of a different
    // coast — which is why `setCentre` is the only door and the uniform
    // is read-only from outside. This is that promise, checked.
    const swell = new SeaSwell({ groundAt: () => -4000 });
    const { look, shader } = compile({ swell });
    const phases = shader.uniforms.uWavePhase.value as number[];
    look.setCentre(COAST.wx, COAST.wz);
    expect(shader.uniforms.uWavePhase.value).toEqual(swell.centrePhases(COAST.wx, COAST.wz));
    // Reduced to one turn — the reduction is what keeps float32 out of
    // the tens of thousands of radians a real coast would otherwise be.
    for (const p of shader.uniforms.uWavePhase.value as number[]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2);
    }
    // A DIFFERENT COAST IS A DIFFERENT PHASE. Without this, a
    // `centrePhases` that returned zeros would pass everything above.
    look.setCentre(COAST.wx + 137_000, COAST.wz);
    expect(shader.uniforms.uWavePhase.value).not.toEqual(phases);
  });

  it('hands the far sheet its hole as an offset, so the GPU never subtracts two millions', () => {
    const { look, shader } = compile({ hole: HOLE_BAND });
    look.setCentre(COAST.wx, COAST.wz);
    look.setHole(COAST.wx + 4_000, COAST.wz - 1_250);
    const local = shader.uniforms.uHoleLocal.value as THREE.Vector2;
    expect(local.x).toBeCloseTo(4_000, 9);
    expect(local.y).toBeCloseTo(-1_250, 9);
    // Set in either order, and the answer is the same: both setters
    // refresh it, which is the only reason they can be called separately.
    const { look: other, shader: otherShader } = compile({ hole: HOLE_BAND });
    other.setHole(COAST.wx + 4_000, COAST.wz - 1_250);
    other.setCentre(COAST.wx, COAST.wz);
    expect((otherShader.uniforms.uHoleLocal.value as THREE.Vector2).x).toBeCloseTo(local.x, 9);
    expect((otherShader.uniforms.uHoleLocal.value as THREE.Vector2).y).toBeCloseTo(local.y, 9);
    // And the shader measures the band in that frame, not the island's.
    expect(shader.fragmentShader).toContain('distance(vLocal, uHoleLocal)');
  });

  it('still hands `uCentre` over whole, and that is deliberate', () => {
    // THE ONE WORLD POSITION LEFT, and it is honest to say why it stays.
    // `tiled()` reduces it with a `mod` on the GPU, so a float32 near
    // 2.2e6 does cost precision there — but `uCentre` is a UNIFORM, one
    // value for the whole mesh, so the loss is a constant sub-texel
    // shift of a tiling texture rather than something that varies across
    // it. Nothing steps, nothing bands, nobody can see it. The failures
    // above were all PER-VERTEX or per-fragment, which is the difference
    // that matters. Pinned so a future reader does not "fix" it, and so
    // that if `tiled()` ever starts feeding something that varies, this
    // test is the note explaining what changed.
    const { shader } = compile();
    expect(shader.fragmentShader).toContain('vec2 tiled(float T) { return (vLocal + mod(uCentre, vec2(T))) / T; }');
    expect(shader.uniforms.uCentre).toBeDefined();
  });
});

/**
 * THE SEA UNDER THE ISLAND'S SKY (the lighting polish, 2026-09-07).
 *
 * The look was accepted under one constant noon, and two lines in the
 * shader had been written as if noon were permanent: a constant sky
 * colour added as emissive at every hour, and a foam opacity lift with
 * no light term. Together they drew a bright rim along the shoreline at
 * night in Joshua's phone shot. The fix reads the scene's own lights —
 * so what has to be proved here is the other half of the claim: that by
 * DAY nothing moved. The sheen's gain is pinned to reproduce the old
 * constant at a clear noon to a millionth, and the foam gate is
 * evaluated against the sky model at every daytime state it produces
 * and required to be exactly one.
 *
 * The one deliberate change to the daytime look — the wash riding the
 * crest — is pinned as a floor and a ceiling rather than as a picture.
 */
describe('the sea under the island’s sky', () => {
  const DEG = Math.PI / 180;
  const sun = (elevationDeg: number): SunPosition => ({
    elevation: elevationDeg * DEG, azimuth: Math.PI, declination: 0, equationOfTimeMinutes: 0,
  });
  const weather = (over: Partial<WeatherNow> = {}): WeatherNow => ({ ...FAIR, ...over });
  const CLEAR = weather({ cloud: 0.1 });
  const CLOUDY = weather({ cloud: 0.7, visibilityM: visibilityFor(0, 0.7) });
  const OVERCAST = weather({ sky: 'cloudy', cloud: 0.95, visibilityM: visibilityFor(0, 0.95) });
  const SHOWER = weather({ sky: 'rain', rainMmHr: 10, cloud: 0.95, visibilityM: visibilityFor(10, 0.95) });
  const NOON = sun(80);
  const NIGHT = sun(-30);

  /** An sRGB triple into three's working space, the way `SkyView.srgb` does it. */
  const linear = (c: Rgb): THREE.Color => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
  /** Rec. 709 luminance, the weights the shader inlines (three r185 has no GLSL `luminance()`). */
  const lum = (c: THREE.Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const smoothstep = (lo: number, hi: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    return t * t * (3 - 2 * t);
  };
  /**
   * The two lights as the shader reads them: three folds a light's
   * intensity into its colour (`WebGLLights`: `skyColor.copy(color)
   * .multiplyScalar(intensity)`, and the same for the sun).
   */
  const skyColorOf = (look: SkyLook): THREE.Color => linear(look.hemisphereSky).multiplyScalar(look.hemisphereIntensity);
  const sunColorOf = (look: SkyLook): THREE.Color => linear(look.sunColour).multiplyScalar(look.sunIntensity);
  /** The shader's `lit`, in TS: the same formula on the same numbers. */
  const litOf = (look: SkyLook): number => smoothstep(LIT_LO, LIT_HI, lum(skyColorOf(look)) + lum(sunColorOf(look)));
  const luminanceOf = (look: SkyLook): number => lum(skyColorOf(look)) + lum(sunColorOf(look));

  describe('the sheen follows the sky', () => {
    it('adds the scene’s hemisphere light, gained — and the constant only where there is no sky to follow', () => {
      const { shader } = compile();
      const glsl = shader.fragmentShader;
      expect(glsl).toContain('#if NUM_HEMI_LIGHTS > 0');
      expect(glsl).toContain(`vec3 skyLit = max(hemisphereLights[0].skyColor * uSkyGain, uSky * ${SHEEN_NIGHT_FLOOR.toFixed(2)});`);
      // The floor is a fraction of the noon sheen well under the rim bar, and above nothing.
      expect(SHEEN_NIGHT_FLOOR).toBeGreaterThan(0);
      expect(SHEEN_NIGHT_FLOOR).toBeLessThan(0.25);
      expect(glsl).toContain('vec3 skyLit = uSky;');
      expect(glsl).toContain('totalEmissiveRadiance += skyLit * min(fres, 0.85) * 0.5;');
      // The constant is no longer what the emissive reads directly.
      expect(glsl).not.toMatch(/totalEmissiveRadiance \+= uSky\b/);
      // The gain reaches the shader as the uniform the line names, and it
      // is the exported ratio, not a second copy of it.
      expect(glsl).toContain('uniform vec3 uSkyGain;');
      const gain = shader.uniforms.uSkyGain.value as THREE.Vector3;
      expect(gain.x).toBe(SKY_GAIN.r);
      expect(gain.y).toBe(SKY_GAIN.g);
      expect(gain.z).toBe(SKY_GAIN.b);
    });

    it('is BE’s sheen at a clear noon, to a millionth — and within 1/255 on the screen', () => {
      // The claim that makes this a polish and not a new look. The sky
      // writes HORIZON_CLEAR at intensity 1.0 at a clear noon (skyLook's
      // own test pins both); gained, that must be the constant the sheen
      // was tuned to.
      const { shader } = compile();
      const sheen = shader.uniforms.uSky.value as THREE.Color;
      const horizon = linear(HORIZON_CLEAR);
      expect(Math.abs(SKY_GAIN.r * horizon.r - sheen.r)).toBeLessThan(1e-6);
      expect(Math.abs(SKY_GAIN.g * horizon.g - sheen.g)).toBeLessThan(1e-6);
      expect(Math.abs(SKY_GAIN.b * horizon.b - sheen.b)).toBeLessThan(1e-6);
      // End to end, through the sky model rather than the constant it
      // happens to write: the light the scene actually carries at noon.
      const noon = skyColorOf(skyLook(CLEAR, NOON));
      const skyLit = new THREE.Color(noon.r * SKY_GAIN.r, noon.g * SKY_GAIN.g, noon.b * SKY_GAIN.b);
      expect(Math.abs(skyLit.r - sheen.r)).toBeLessThan(1e-6);
      expect(Math.abs(skyLit.g - sheen.g)).toBeLessThan(1e-6);
      expect(Math.abs(skyLit.b - sheen.b)).toBeLessThan(1e-6);
      // And on an 8-bit screen: the sheen's largest possible contribution
      // is skyLit * 0.85 * 0.5, so convert that to sRGB and count.
      const was = sheen.clone().multiplyScalar(0.425).convertLinearToSRGB();
      const now = skyLit.clone().multiplyScalar(0.425).convertLinearToSRGB();
      for (const axis of ['r', 'g', 'b'] as const) {
        expect(Math.abs(was[axis] - now[axis]) * 255).toBeLessThan(1);
      }
    });

    it('keeps the fallback constant BIT-IDENTICAL to what v0 built, double conversion and all', () => {
      // `new THREE.Color(hex)` has converted from sRGB since r152, so the
      // `.convertSRGBToLinear()` v0 put on top is a second application of
      // the transfer. The sea was accepted with it. The look is what is
      // protected, so the expression is kept — and this pin exists so a
      // reader who spots the double conversion finds the reason before
      // "fixing" the sea a third brighter.
      const { shader } = compile();
      const sheen = shader.uniforms.uSky.value as THREE.Color;
      const asBuilt = new THREE.Color(SHEEN_REFERENCE).convertSRGBToLinear();
      expect(sheen.r).toBe(asBuilt.r);
      expect(sheen.g).toBe(asBuilt.g);
      expect(sheen.b).toBe(asBuilt.b);
      const once = new THREE.Color(SHEEN_REFERENCE);
      expect(sheen.b).toBeLessThan(once.b);
      // And no other scene sees a different constant: two wearers, one
      // colour, so the fallback is the same sheen everywhere.
      expect(compile({ ocean: false }).shader.uniforms.uSky.value).toBe(sheen);
    });

    it('dims with the sky, which is the whole reason', () => {
      const noon = skyColorOf(skyLook(CLEAR, NOON));
      const night = skyColorOf(skyLook(CLEAR, NIGHT));
      // The gain is a fixed ratio, so the sheen's luminance is the sky
      // light's, scaled: at night a small fraction of noon's.
      expect(lum(night) / lum(noon)).toBeLessThan(0.02);
      expect(lum(night)).toBeGreaterThan(0);
    });
  });

  describe('the foam’s opacity follows its light', () => {
    const litLine = (glsl: string): RegExpExecArray | null =>
      /float lit = smoothstep\(([\d.]+), ([\d.]+), dot\(hemisphereLights\[0\]\.skyColor \+ directionalLights\[0\]\.color, vec3\(0\.2126, 0\.7152, 0\.0722\)\)\);/.exec(glsl);

    it('gates the ALPHA lift on the scene’s lights, and leaves the foam’s colour to three', () => {
      const { shader } = compile();
      const glsl = shader.fragmentShader;
      // The gate, with the thresholds this module exports rather than a
      // number typed twice.
      const gate = litLine(glsl);
      expect(gate, 'the lit gate is not in the shader').not.toBeNull();
      if (gate === null) return;
      expect(Number(gate[1])).toBe(LIT_LO);
      expect(Number(gate[2])).toBe(LIT_HI);
      // Guarded on BOTH lights existing, and lit in full otherwise: a
      // scene with no sky light is the look as it was, not a dark one.
      expect(glsl).toContain('#if NUM_HEMI_LIGHTS > 0 && NUM_DIR_LIGHTS > 0');
      expect(glsl).toContain('float lit = 1.0;');
      // three r185 has no GLSL luminance helper; the weights are inlined.
      expect(glsl).not.toMatch(/\bluminance\(/);
      // The lift, gated.
      expect(glsl).toContain('diffuseColor.a = mix(diffuseColor.a, 0.95, foam * lit);');
      // THE FOAM'S COLOUR IS NOT TOUCHED. It is diffuse, three lights it,
      // and a light term here would darken it twice. Pinned as the exact
      // literal so nobody "fixes" it.
      expect(glsl).toContain('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);');
      // Declared before it is read.
      expect(glsl.indexOf('float lit = smoothstep')).toBeLessThan(glsl.indexOf('foam * lit'));
    });

    it('is EXACTLY 1.0 at every daytime state the sky model produces, so the daytime look is the accepted one', () => {
      // Evaluated through the sky model, the same formula in TS: clear,
      // cloudy, overcast, a shower, and the sun on the horizon all sit
      // above LIT_HI, so the gate is one and the alpha line is the line
      // it was. The luminances are pinned too, so a change to a palette
      // that moved one toward the gate shows up here first.
      const clearNoon = skyLook(CLEAR, NOON);
      const cloudyNoon = skyLook(CLOUDY, NOON);
      const overcastNoon = skyLook(OVERCAST, NOON);
      const showerNoon = skyLook(SHOWER, NOON);
      const lowSun = skyLook(CLEAR, sun(-2));
      for (const look of [clearNoon, cloudyNoon, overcastNoon, showerNoon, lowSun]) {
        expect(litOf(look)).toBe(1);
        expect(luminanceOf(look)).toBeGreaterThan(LIT_HI);
      }
      expect(luminanceOf(clearNoon)).toBeCloseTo(1.50, 1);
      expect(luminanceOf(cloudyNoon)).toBeCloseTo(1.01, 1);
      expect(luminanceOf(overcastNoon)).toBeCloseTo(0.64, 1);
      expect(luminanceOf(lowSun)).toBeCloseTo(0.51, 1);
    });

    it('is nothing at night — the rim in the phone shot', () => {
      // A clear night reads a hair above LIT_LO — a tenth of a percent of
      // the lift, which is nothing without a hard edge. An overcast
      // night is under it: exactly zero.
      const night = skyLook(CLEAR, NIGHT);
      expect(luminanceOf(night)).toBeCloseTo(0.024, 2);
      expect(litOf(night)).toBeLessThan(0.002);
      expect(litOf(skyLook(OVERCAST, NIGHT))).toBe(0);
      expect(litOf(skyLook(SHOWER, NIGHT))).toBe(0);
    });

    it('eases through twilight rather than switching', () => {
      // The sky model is continuous in elevation, and the gate is a
      // smoothstep on it, so the foam's opacity must ease: no half-degree
      // of sun moves it more than a tenth, and it never comes back down
      // as the sun rises.
      let last = 0;
      for (let e = -30; e <= 20; e += 0.5) {
        const lit = litOf(skyLook(CLEAR, sun(e)));
        expect(lit, `lit at ${e}°`).toBeGreaterThanOrEqual(last - 1e-12);
        expect(Math.abs(lit - last), `lit step at ${e}°`).toBeLessThan(0.1);
        last = lit;
      }
      expect(last).toBe(1);
    });
  });

  describe('the wash breathes', () => {
    const washTerm = (glsl: string): RegExpExecArray | null =>
      /\* mix\(([\d.]+), 1\.0, smoothstep\(-0\.6, 0\.4, crest\)\);/.exec(glsl);

    it('rides the crest between WASH_FLOOR and all of itself, in the sea only', () => {
      const sea = compile({ ocean: true }).shader.fragmentShader;
      const term = washTerm(sea);
      expect(term, 'the wash does not ride the crest').not.toBeNull();
      if (term === null) return;
      expect(Number(term[1])).toBe(WASH_FLOOR);
      // On the wash and nothing else: the depth band and the texture
      // weights it had are the ones it has.
      expect(sea).toMatch(/float wash = smoothstep\(170\.0 \* 1\.000, 95\.0 \* 1\.000, depth\)\s*\* \(lace \* 0\.85 \+ fizz \* 0\.35\) \* pale\s*\* mix\(/);
      // `crest` is the breaker's, declared before the wash reads it.
      expect(sea.indexOf('float crest = ')).toBeLessThan(sea.indexOf('float wash = '));
      // And a pond has no wash to breathe: the whole block is the sea's.
      const pond = compile({ ocean: false }).shader.fragmentShader;
      expect(pond).not.toMatch(/float wash/);
      expect(washTerm(pond)).toBeNull();
    });

    it('keeps more than half of today’s wash in a trough and all of it under a crest', () => {
      // The floor is the dial for how much the coastline breathes. Above
      // a half so the band never empties — the shore is still drawn as a
      // rim of wash — and below one, or nothing would move.
      expect(WASH_FLOOR).toBe(0.55);
      expect(WASH_FLOOR).toBeGreaterThan(0.5);
      expect(WASH_FLOOR).toBeLessThan(1);
      const factor = (crest: number): number => WASH_FLOOR + (1 - WASH_FLOOR) * smoothstep(-0.6, 0.4, crest);
      expect(factor(-1)).toBe(WASH_FLOOR);
      expect(factor(1)).toBe(1);
      let last = 0;
      for (let c = -1; c <= 1.0001; c += 0.05) {
        const f = factor(c);
        expect(f).toBeGreaterThanOrEqual(last);
        last = f;
      }
    });
  });

  describe('the waterline is still a feather', () => {
    it('discards ONCE, at the invisible threshold, after the edge fade — never as a hard cut', () => {
      // A hard discard at a threshold cut the waterline like scissors;
      // the sea fades out through `edge` and the discard only drops what
      // is already invisible. Every wearer, both sheets.
      const wearers = [
        compile(),
        compile({ ocean: false }),
        compile({ swellRim: { rimLo: 6000, rimHi: 7800, alphaLo: 6800, alphaHi: 8200 } }),
        compile({ hole: { lo: 6800, hi: 8200 } }),
      ];
      for (const { shader } of wearers) {
        const glsl = shader.fragmentShader;
        expect(glsl.match(/\bdiscard;/g)).toHaveLength(1);
        expect(glsl).toContain('if (diffuseColor.a < 0.01) discard;');
        expect(glsl.indexOf('diffuseColor.a *= edge;')).toBeGreaterThan(0);
        expect(glsl.indexOf('diffuseColor.a *= edge;')).toBeLessThan(glsl.indexOf('discard;'));
      }
    });
  });
});
