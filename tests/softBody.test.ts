import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  bellyTune, bounceShare, breastTune, createJiggleUniforms, jiggleAt, jiggleWeights, patchJiggle, restingMass, stepMass,
  JIGGLE_SOURCES, UNITS_PER_METRE, type Mass, type MassTune,
} from '../src/sarahlab/softBody';
import { walkSwayAccel, WALK_SWAY_M } from '../src/sarahlab/sarahLabTool';

/** Kick a resting mass and run it for `seconds` at 60 fps; returns every frame's y. */
function ring(tune: MassTune, vy: number, seconds = 1.5): number[] {
  const m: Mass = restingMass(); m.vy = vy;
  const ys: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) { stepMass(m, 1 / 60, 0, 0, 0, tune); ys.push(m.y); }
  return ys;
}
const peak = (ys: number[]) => Math.max(...ys.map(Math.abs));
/** Seconds until the swing stays under 10% of its peak. */
function settle(ys: number[]): number {
  const p = peak(ys);
  let last = 0;
  ys.forEach((y, i) => { if (Math.abs(y) > 0.1 * p) last = i; });
  return (last + 1) / 60;
}

describe('soft body: the masses', () => {
  it('a kicked mass comes back to rest, and quickly -- not jelly', () => {
    const ys = ring(bellyTune(100), -0.3);
    expect(Math.abs(ys[ys.length - 1])).toBeLessThan(1e-4);
    expect(settle(ys)).toBeLessThan(0.6);
  });

  it('never leaves its cage, however hard it is thrown', () => {
    const t = bellyTune(100), m = restingMass();
    for (let i = 0; i < 120; i += 1) stepMass(m, 1 / 60, 1e6, -1e6, 1e6, t);
    expect(Math.hypot(m.x, m.y, m.z)).toBeLessThanOrEqual(t.maxM + 1e-9);
  });

  it('ignores a bad frame rather than exploding', () => {
    const m = restingMass();
    stepMass(m, NaN, NaN, Infinity, -Infinity, bellyTune(100));
    expect([m.x, m.y, m.z, m.vx, m.vy, m.vz].every(Number.isFinite)).toBe(true);
  });

  it('no bump, no belly motion', () => {
    expect(bellyTune(0).gain).toBe(0);
  });

  it('a bigger belly is tighter: past full term it swings less and settles sooner', () => {
    const at100 = bellyTune(100), at200 = bellyTune(200);
    expect(at200.hz).toBeGreaterThan(at100.hz);
    expect(peak(ring(at200, -0.3)) * at200.gain).toBeLessThan(peak(ring(at100, -0.3)) * at100.gain);
    expect(settle(ring(at200, -0.3))).toBeLessThanOrEqual(settle(ring(at100, -0.3)));
  });

  it('Firmness: firmer moves less on the skin, for the belly and for the breasts', () => {
    for (const tune of [(f: number) => bellyTune(100, f), (f: number) => breastTune(1.3, 0, f)]) {
      const soft = tune(0), firm = tune(100);
      expect(firm.hz).toBeGreaterThan(soft.hz);
      expect(peak(ring(firm, -0.3)) * firm.gain).toBeLessThan(peak(ring(soft, -0.3)) * soft.gain);
    }
  });

  it('Bounce: scales what shows, never the timing -- 0 still, 100 as tuned, 200 twice', () => {
    for (const tune of [(b: number) => bellyTune(100, 50, 0, b), (b: number) => breastTune(1.3, 0, 50, 'left', b)]) {
      expect(tune(0).gain).toBe(0);
      expect(tune(200).gain).toBeCloseTo(2 * tune(100).gain, 12);
      expect(tune(200).hz).toBe(tune(100).hz);
      expect(tune(200).damping).toBe(tune(100).damping);
    }
    expect(bellyTune(100).gain).toBe(bellyTune(100, 50, 0, 100).gain);
    expect(bounceShare(500)).toBe(2); expect(bounceShare(-5)).toBe(0); expect(bounceShare(NaN)).toBe(1);
  });

  it('more to carry (twins, triplets and their fluid) is slower and more damped; one is as approved', () => {
    expect(bellyTune(100, 50, 0, 100, 1)).toEqual(bellyTune(100));
    const heavy = bellyTune(100, 50, 0, 100, 1.6);
    expect(heavy.hz).toBeLessThan(bellyTune(100).hz); expect(heavy.damping).toBeGreaterThan(bellyTune(100).damping);
    expect(settle(ring(heavy, -0.3))).toBeLessThanOrEqual(settle(ring(bellyTune(100), -0.3)) + 0.1);
  });

  it('milk fills the breast out and firms it', () => {
    const empty = breastTune(1.3, 0), full = breastTune(1.3, 100);
    expect(full.hz).toBeGreaterThan(empty.hz);
    expect(full.gain).toBeLessThan(empty.gain);
  });

  it('the two sides are not quite twins', () => {
    expect(breastTune(1.3, 0, 50, 'right').hz).not.toBe(breastTune(1.3, 0, 50, 'left').hz);
  });
});

describe('soft body: the walk sway', () => {
  it('is one sway a stride, and as big as it says', () => {
    const stride = 1.1, w = (2 * Math.PI) / stride;
    expect(walkSwayAccel(0.25, stride)).toBeCloseTo(-w * w * WALK_SWAY_M, 9);
    expect(walkSwayAccel(0.75, stride)).toBeCloseTo(w * w * WALK_SWAY_M, 9);
    expect(walkSwayAccel(0.3, 0)).toBe(0);
  });
});

/** A strip of four vertices: two on her left, one on the midline, one on her right; the belly morph moves the first. */
function strip(): { geometry: THREE.BufferGeometry; dictionary: Record<string, number> } {
  const g = new THREE.BufferGeometry();
  const x = [0.1, 0.05, 0, -0.1];
  g.setAttribute('position', new THREE.Float32BufferAttribute(x.flatMap((v) => [v, 1, 0]), 3));
  const cm = JIGGLE_SOURCES.metres * UNITS_PER_METRE;
  const belly = new THREE.Float32BufferAttribute([0, cm, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3);
  const breast = new THREE.Float32BufferAttribute([0, 0, 0, 0, cm, 0, 0, cm, 0, 0, cm, 0], 3);
  g.morphAttributes.position = [belly, breast];
  return { geometry: g, dictionary: { [JIGGLE_SOURCES.belly]: 0, [JIGGLE_SOURCES.breast]: 1 } };
}

describe('soft body: the skin', () => {
  it('follows each mass by how far the motion morph moves that point, breasts split at the midline', () => {
    const { geometry, dictionary } = strip();
    const w = jiggleWeights(geometry, dictionary)!;
    expect(w).not.toBeNull();
    expect(w[0]).toBeCloseTo(UNITS_PER_METRE, 4); // 1 cm of morph per 1 cm of mass, in her units
    expect(w[3]).toBe(0);
    expect(w[4]).toBeCloseTo(UNITS_PER_METRE, 4); // well left: all left breast
    expect(w[5]).toBe(0);
    expect(w[7]).toBeCloseTo(w[8], 6); // on the midline, half and half
    expect(w[10]).toBe(0); expect(w[11]).toBeCloseTo(UNITS_PER_METRE, 4);
  });

  it('a mesh with neither motion morph gets nothing', () => {
    const { geometry } = strip();
    expect(jiggleWeights(geometry, { other: 0 })).toBeNull();
  });

  it('the CPU posers read what the shader draws', () => {
    const { geometry, dictionary } = strip();
    const uniforms = createJiggleUniforms();
    uniforms.belly.value.set(0.001, -0.004, 0.002);
    uniforms.breastL.value.set(0, 0.003, 0);
    const weights = jiggleWeights(geometry, dictionary)!, push = new Float32Array(weights.length);
    const j = { weights, uniforms, push }, out = { x: 0, y: 0, z: 0 };
    jiggleAt(j, 0, out);
    expect(out.y).toBeCloseTo(-0.004 * UNITS_PER_METRE, 6);
    jiggleAt(j, 1, out);
    expect(out.y).toBeCloseTo(0.003 * UNITS_PER_METRE, 6);
    // and the belly's push for the baby, added as it is
    push[1] = 0.02; jiggleAt(j, 0, out);
    expect(out.y).toBeCloseTo(0.02 - 0.004 * UNITS_PER_METRE, 6);
  });

  it('the push is its own attribute, added before skinning with the jiggle', () => {
    const material = new THREE.MeshStandardMaterial(), uniforms = createJiggleUniforms();
    patchJiggle(material, uniforms);
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '#include <common>\nvoid main(){\n#include <morphtarget_vertex>\n#include <skinning_vertex>\n}', fragmentShader: '' };
    material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('attribute vec3 babyPush;');
    expect(shader.vertexShader).toContain('transformed += babyPush');
  });

  it('the shader adds it after the morphs and before skinning, once, with its own program key', () => {
    const material = new THREE.MeshStandardMaterial(), uniforms = createJiggleUniforms();
    patchJiggle(material, uniforms);
    patchJiggle(material, uniforms);
    const shader = {
      uniforms: {} as Record<string, unknown>,
      vertexShader: '#include <common>\nvoid main(){\n#include <morphtarget_vertex>\n#include <skinning_vertex>\n}',
      fragmentShader: '',
    };
    material.onBeforeCompile(shader as never, undefined as never);
    const v = shader.vertexShader;
    expect(v.match(/attribute vec3 jiggle/g)?.length).toBe(1);
    expect(v.indexOf('transformed += babyPush + jiggle.x')).toBeGreaterThan(v.indexOf('#include <morphtarget_vertex>'));
    expect(v.indexOf('transformed += babyPush + jiggle.x')).toBeLessThan(v.indexOf('#include <skinning_vertex>'));
    expect(shader.uniforms.uJiggleBelly).toBe(uniforms.belly);
    expect(material.customProgramCacheKey()).toContain('jiggle');
  });
});
