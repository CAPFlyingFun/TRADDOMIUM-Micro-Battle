import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BABY_SKIN, createSkinUniforms, patchSkin, stepSkin } from '../src/sarahlab/babySkin';

describe("her baby's skin shows from its birth (babySkin.ts)", () => {
  it('comes in over `fadeS` and goes again, never past 0 or 1', () => {
    const u = createSkinUniforms();
    expect(u.skinShow.value).toBe(0);
    stepSkin(u, 1, BABY_SKIN.fadeS / 2); expect(u.skinShow.value).toBeCloseTo(0.5, 6);
    stepSkin(u, 1, BABY_SKIN.fadeS); expect(u.skinShow.value).toBe(1);
    stepSkin(u, 0, BABY_SKIN.fadeS / 4); expect(u.skinShow.value).toBeCloseTo(0.75, 6);
    stepSkin(u, 0, 10); expect(u.skinShow.value).toBe(0);
  });
  it('mixes its texture in from the plain colour in its fragment shader, the colour white so its skin is its own', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x123456 }), u = createSkinUniforms();
    patchSkin(m, u);
    expect(m.color.getHex()).toBe(0xffffff);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <common>\n#include <map_fragment>' };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.skinShow).toBe(u.skinShow);
    expect(shader.fragmentShader).toContain('mix( vec4( skinPlain, 1.0 ), skinTexel, skinShow )');
    expect(m.customProgramCacheKey()).toContain('babySkin');
  });
});
