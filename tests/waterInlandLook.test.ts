// @vitest-environment node
/**
 * INLAND WATER LOOKS LIKE THE OCEAN, WITHOUT THE WAVES.
 *
 * Joshua, 2026-09-06: "maybe the inland water, the same texture and look
 * as the ocean as v0 looked bland with no textures… made for the moment
 * like the ocean, just without the waves."
 *
 * Both halves of that are checkable and neither is obvious from reading
 * the call site, because v0's inland water ran the SAME material and
 * still looked bland — it passed `texAmp: 0.20` against the ocean's 0.4
 * and `green: 1` against its 0. Nothing was missing; two numbers were
 * turned down. A test that only checked "it builds a material" would
 * have passed on v0's version too, which is the reason this file asks
 * about the numbers instead.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SeaSwell } from '../src/world/sea/swell';
import type { SeaTextures } from '../src/sea/SeaTextures';
import { makeWaterLook } from '../src/sea/waterLook';
import { makeInlandLook } from '../src/water/inlandLook';

const STUB = {
  vertex: ['#include <common>', 'void main() {', '#include <begin_vertex>', '}'].join('\n'),
  fragment: [
    '#include <common>', 'void main() {', '#include <map_fragment>',
    '#include <normal_fragment_maps>', '#include <lights_fragment_end>', '}',
  ].join('\n'),
};

const swell = (): SeaSwell => new SeaSwell({ groundAt: () => -4000 });
const textures = (): SeaTextures => ({
  ripple: { value: new THREE.Texture() },
  foam: { value: new THREE.Texture() },
  anisotropy: 4,
  tier: 'medium',
  dispose: () => {},
} as unknown as SeaTextures);

function compile(look: { material: THREE.MeshStandardMaterial }) {
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: STUB.vertex, fragmentShader: STUB.fragment };
  (look.material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
  return shader;
}

/** The ocean's own arguments, as `OceanView` passes them. */
function oceanLook() {
  const tex = textures();
  return makeWaterLook({
    swell: swell(), ripple: tex.ripple, foam: tex.foam,
    green: 0, surf: 1, sink: true, edgeLo: 35, edgeHi: 95,
    midAt: 700, deepAt: 2_600, texAmp: 0.4, octaves: 4, advected: false,
  });
}

describe('inland water wears the ocean’s look', () => {
  const inland = () => makeInlandLook({ swell: swell(), textures: textures(), octaves: 4 });

  it('samples the ripple as HARD as the ocean does — the blandness, in one number', () => {
    // v0 passed texAmp 0.20 where the ocean passes 0.4, so the ripple
    // reached the colour at half strength. It is baked into the emitted
    // GLSL as a literal, so it can be read back out and compared rather
    // than taken on trust from the call site.
    const amp = (glsl: string): number => {
      const hit = /gRn[\s\S]{0,400}?\* (0\.\d+)/.exec(glsl);
      return hit === null ? Number.NaN : Number(hit[1]);
    };
    const mine = compile(inland()).fragmentShader;
    const sea = compile(oceanLook()).fragmentShader;
    // Whatever the ocean's ripple weight is, inland uses the same one.
    // Compared rather than hard-coded, so a future change to the sea's
    // own tuning drags the rivers along with it instead of silently
    // leaving them behind — which is how they fell behind the first time.
    expect(amp(mine)).toBe(amp(sea));
    expect(Number.isFinite(amp(mine))).toBe(true);
  });

  it('takes the ocean’s PALETTE too, with no green shift — the other bland number', () => {
    // v0 passed `green: 1`, the full inland green shift, which walks the
    // colour away from the blue the ocean's look was accepted at. It is
    // baked into three mix() calls as a literal, so it reads straight
    // back out of the shader.
    //
    // This exists because the texAmp test above does NOT catch it: with
    // green at 1 and texAmp at 0.4 the ripple is at full strength on the
    // wrong palette, and every other assertion in this file passes. Two
    // numbers made v0 bland and a test for one of them is half a test.
    const shift = (glsl: string): string[] =>
      [...glsl.matchAll(/mix\((?:shallowCol|midCol|deepCol),\s*vec3\([^)]*\),\s*([\d.]+)\)/g)].map((m) => m[1]);
    const mine = shift(compile(inland()).fragmentShader);
    expect(mine.length, 'the green mix is not in the shader at all').toBe(3);
    for (const g of mine) expect(Number(g)).toBe(0);
    // And the ocean's is the same zero, which is what "the same palette"
    // means — checked so this cannot pass by the mix disappearing.
    expect(shift(compile(oceanLook()).fragmentShader)).toEqual(mine);
  });

  it('runs the SAME ripple octaves as the ocean, not fewer', () => {
    // The other way to look bland: sample the texture fewer times. The
    // rung decides how many, and inland is handed the same rung.
    const taps = (glsl: string): number => (glsl.match(/texture2D\(uRipple,/g) ?? []).length;
    const mine = taps(compile(inland()).fragmentShader);
    const sea = taps(compile(oceanLook()).fragmentShader);
    expect(mine).toBeGreaterThan(0);
    // SAME NUMBER OF OCTAVES, and the same number of READS — which is
    // the stronger claim, because it says inland is not quietly paying
    // for something it cannot use. `advected` would double the reads to
    // crossfade two phases half an advection cycle apart, and the solver
    // reports no current to advect BY, so the two phases would sample
    // the same point: `mix(x, x, t)`, twice the cost, the same pixel.
    // It waits for the flow model. See `inlandLook`'s header.
    expect(inland().octaves).toBe(oceanLook().octaves);
    expect(inland().advected, 'advecting by a zero current is pure waste').toBe(false);
    expect(mine, 'inland is reading the texture more times than the sea').toBe(sea);
  });

  it('HAS NO WAVES — no swell displaces it and no breaker foam runs on it', () => {
    // "just without the waves". Two separate things had to be off, and
    // v0 got the second one wrong for eight versions: its fresh sheet ran
    // the Pacific's breaker block ungated, so foam fronts marched across
    // inland pools at 237 cm/s toward 245 degrees (audit F4).
    const sh = compile(inland());
    // No vertex displacement: the swell chunk is only emitted with a rim.
    expect(sh.vertexShader).not.toMatch(/uWaveAmp/);
    expect(sh.vertexShader).not.toMatch(/vSwell/);
    // And no breaker block in the fragment — that is `ocean: false`.
    expect(sh.fragmentShader).not.toMatch(/THE FOAM RIDES THE WAVE/);
    expect(sh.fragmentShader).not.toMatch(/uWaveAmp/);
    // The ocean, for contrast, has all of it — or this test is checking
    // that two empty strings match.
    const sea = compile(oceanLook());
    expect(sea.fragmentShader).toMatch(/uWaveAmp/);
  });

  it('LIFTS out of the ground instead of sinking into it', () => {
    // The ocean sinks in the depth buffer so near-coplanar shore terrain
    // wins the tie. A stream a centimetre deep must do the opposite: a
    // film lies ON the ground it is coplanar with, and sinking it hands
    // the whole sheet to the mud.
    expect(inland().material.polygonOffset).toBe(true);
    expect(inland().material.polygonOffsetUnits).toBeLessThan(0);
    expect(oceanLook().material.polygonOffsetUnits).toBeGreaterThan(0);
  });

  it('keeps its depth ramps INLAND-sized, which is not a copy of the ocean', () => {
    // The one deliberate departure from "the same as the ocean". A Kauaʻi
    // stream runs a median 0.3 m deep; handed the sea's 0.35..26 m colour
    // ramp, every river on the island would sit at the palest tint the
    // shader can make and read as pale nothing — the same blandness by
    // another route. The ramps are baked as literals, so read them back.
    const depths = (glsl: string): number[] =>
      [...glsl.matchAll(/smoothstep\((\d+\.\d), (\d+\.\d), depth\)/g)].map((m) => Number(m[2]));
    const mine = depths(compile(inland()).fragmentShader);
    const sea = depths(compile(oceanLook()).fragmentShader);
    expect(mine.length).toBeGreaterThan(0);
    expect(sea.length).toBeGreaterThan(0);
    // NOT COMPARED BAND FOR BAND, and not against the ocean's SHALLOWEST
    // either. The two shaders emit different numbers of depth ramps — the
    // ocean's breaker block carries one that `ocean: false` gates away —
    // and its shallowest is a surf gate rather than a colour ramp, so
    // either comparison would be measuring a river against the wrong
    // thing. The claim is about the FULL SCALE each water works over, so
    // that is what is measured: how deep does this water still care about?
    expect(Math.max(...mine), 'inland runs to metres where the sea runs to tens of them')
      .toBeLessThan(Math.max(...sea) / 5);
  });

  it('is lit by the same sky the ocean is — the sheen’s gain and the foam gate, and no wash to breathe', () => {
    // The lighting polish (2026-09-07) is in the ONE shader, so a river
    // at night gets the same fix the sea got: its sheen follows the
    // scene's hemisphere light and its foam goes opaque only where there
    // is light to make it so. The lines are compared to the sea's
    // verbatim, not re-asserted, so the two wearers cannot drift.
    const mine = compile(inland()).fragmentShader;
    const sea = compile(oceanLook()).fragmentShader;
    const sheen = (glsl: string): string | undefined =>
      /vec3 skyLit = max\(hemisphereLights\[0\]\.skyColor \* uSkyGain, uSky \* 0\.\d+\);/.exec(glsl)?.[0];
    const gate = (glsl: string): string | undefined => /float lit = smoothstep\([^\n]*\);/.exec(glsl)?.[0];
    const lift = (glsl: string): string | undefined => /diffuseColor\.a = mix\(diffuseColor\.a, 0\.95, [^\n]*\);/.exec(glsl)?.[0];
    expect(sheen(mine)).toBeDefined();
    expect(sheen(mine)).toBe(sheen(sea));
    expect(gate(mine)).toBeDefined();
    expect(gate(mine)).toBe(gate(sea));
    expect(lift(mine)).toBe('diffuseColor.a = mix(diffuseColor.a, 0.95, foam * lit);');
    expect(lift(mine)).toBe(lift(sea));
    // The wash rides the SWELL's crest, and a river has no swell: the
    // breathing shoreline is the sea's alone, behind the same gate that
    // keeps the breakers off a pond.
    expect(sea).toMatch(/smoothstep\(-0\.6, 0\.4, crest\)/);
    expect(mine).not.toMatch(/float crest\b/);
    expect(mine).not.toMatch(/float wash/);
  });
});
