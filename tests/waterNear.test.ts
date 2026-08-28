import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { makeWaterLook } from '../src/world/waterLook';

/**
 * THE WATER AT THE WATERLINE.
 *
 * Shin-deep water over bright sand is nearly invisible from inside it
 * — the column you look through is a couple of centimetres of very
 * clear water — while the same water from several metres up looks
 * superb, because the slant path through it is long. So the fix is a
 * VIEWING-DISTANCE term, and its whole contract is that it changes
 * nothing at the distances that already looked right.
 */
// The look fetches its ripple map on construction, which node cannot
// do and which has nothing to do with what is under test.
THREE.TextureLoader.prototype.load = function stub() {
  return new THREE.Texture();
} as unknown as THREE.TextureLoader['load'];

function compiled(): string {
  const look = makeWaterLook({
    green: 0.5, surf: 0.5, edgeLo: 30, edgeHi: 90,
    midAt: 200, deepAt: 700, texAmp: 1, sink: false, anisotropy: 1,
  });
  const shader = {
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
    defines: {},
  };
  look.material.onBeforeCompile?.(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    null as unknown as THREE.WebGLRenderer,
  );
  return shader.fragmentShader;
}

/** The GLSL smoothstep, so the contract is checked in the same maths. */
const smoothstep = (lo: number, hi: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const closeUp = (d: number) => 1 - smoothstep(60, 250, d);
const boost = (d: number) => 1 + (1.9 - 1) * closeUp(d);

describe('the near-view opacity term', () => {
  it('is EXACTLY one at and beyond 2.5 m', () => {
    // Joshua: "by 2.5m away, make it exactly like now". Not nearly.
    expect(boost(250)).toBe(1);
    expect(boost(400)).toBe(1);
    expect(boost(10000)).toBe(1);
  });

  it('rises smoothly as she closes on it', () => {
    expect(boost(60)).toBeCloseTo(1.9, 6);
    expect(boost(150)).toBeGreaterThan(1);
    expect(boost(150)).toBeLessThan(1.9);
    // monotone all the way in
    for (let d = 250; d > 60; d -= 10) {
      expect(boost(d - 10)).toBeGreaterThanOrEqual(boost(d));
    }
  });
});

describe('it reaches the shader without disturbing the waterline', () => {
  const frag = compiled();

  it('is injected at all', () => {
    expect(frag).toContain('float closeUp');
    expect(frag).toContain('length(vViewPosition)');
  });

  it('multiplies BEFORE the waterline feather', () => {
    // The feather (edgeLo..edgeHi) is the fade Joshua asked me to
    // revert once already. Applying the boost first leaves the edge
    // exactly where it is; applying it after would widen the waterline.
    const boostAt = frag.indexOf('float closeUp');
    const edgeAt = frag.indexOf('diffuseColor.a *= edge;');
    expect(boostAt).toBeGreaterThan(0);
    expect(edgeAt).toBeGreaterThan(boostAt);
  });

  it('measures distance from the CAMERA, not from the shore', () => {
    // vWorld is world XZ and cameraPosition is render space — mixing
    // them silently measures from the wrong origin once the floating
    // origin has rebased. vViewPosition is already camera-relative.
    const line = frag.slice(frag.indexOf('float closeUp'), frag.indexOf('diffuseColor.a = min(0.95'));
    expect(line).toContain('vViewPosition');
    expect(line).not.toContain('vWorld');
  });
});
