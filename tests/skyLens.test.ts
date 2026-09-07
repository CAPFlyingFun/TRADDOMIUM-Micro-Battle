/**
 * RAIN ON THE GLASS — the exposure rule and the lens layer, measured on
 * the objects the renderer would draw and on the pool behind them, in
 * node with real three objects and no canvas:
 *
 *   the exposure is zero at level and below, begins gently above five
 *     degrees, climbs monotonically to thirty-five, rises with a head
 *     wind, ignores a crosswind, ignores a tailwind, reads NaN as dry
 *     and scales with the rain's strength
 *   the cap is the rung's, by name: every rung on the ladder, zero on
 *     ultra-low, never smaller up the ladder
 *   heavy rain looking up puts more drops on the glass over thirty
 *     seconds than light rain does, and never more than the cap
 *   zero exposure spawns nothing and lets the live drops die within
 *     their longest life; drops creep downward; the same seed draws the
 *     same rain
 *   update never allocates: the instance matrix array is one object
 *     across six hundred frames
 *   a splash seeds larger drops at once; a bad dt changes nothing; the
 *     aspect keeps a disc round; dispose lets go of everything
 *   the files import nothing from perf/, ui/, view/ or actor/, read no
 *     world coordinate and roll no dice
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DETAIL_TIERS } from '../src/assets/detailQuality';
import {
  FADE_FRACTION, LENS_CAPS, LENS_TICK_S, LIFE_MAX_S, LensView, MEDIUM_RADIUS_MAX, SMALL_RADIUS_MAX, SPAWN_PER_S, lensCapFor,
} from '../src/sky/LensView';
import { PITCH_BEGIN_DEG, PITCH_FULL_DEG, WIND_FULL, WIND_WEIGHT, lensExposure } from '../src/sky/lensExposure';
import { BOUNDARY_LAYER, DRIFT_MAX, FALL } from '../src/sky/RainView';

const DEG = Math.PI / 180;
const FRAME = 1 / 60;

/** A pose looking north (yaw 0: forward is (0, −1) in x, z), level unless told, in a shower unless told. */
const at = (over: Partial<Parameters<typeof lensExposure>[0]> = {}) =>
  lensExposure({ pitch: 0, yaw: 0, windX: 0, windZ: 0, strength: 1, ...over });

const mesh = (view: LensView): THREE.InstancedMesh => view.scene.getObjectByName('lensdrops') as THREE.InstancedMesh;
const matrixOf = (view: LensView, i: number): THREE.Matrix4 => {
  const m = new THREE.Matrix4();
  mesh(view).getMatrixAt(i, m);
  return m;
};
/** A drop's radius in screen heights: half the y scale, at age zero (no stretch yet). */
const radiusOf = (view: LensView, i: number): number => matrixOf(view, i).elements[5] / 2;
const yOf = (view: LensView, i: number): number => matrixOf(view, i).elements[13];

function run(view: LensView, seconds: number, strength: number, exposure: number, dt = FRAME): number {
  let peak = 0;
  for (let t = 0; t < seconds; t += dt) {
    view.update(strength, exposure, dt);
    peak = Math.max(peak, view.live);
  }
  return peak;
}

describe('when rain may reach the lens', () => {
  it('is dry at level and below, whatever the rain', () => {
    expect(at().exposure).toBe(0);
    expect(at({ pitch: -20 * DEG }).exposure).toBe(0);
    expect(at({ pitch: -89 * DEG }).upward).toBe(0);
    expect(at({ pitch: PITCH_BEGIN_DEG * DEG }).upward).toBe(0);
  });

  it('begins gently just above five degrees — no pop at the threshold — and is full at thirty-five', () => {
    const justAbove = at({ pitch: (PITCH_BEGIN_DEG + 1) * DEG });
    expect(justAbove.upward).toBeGreaterThan(0);
    expect(justAbove.upward).toBeLessThan(0.01);
    expect(at({ pitch: PITCH_FULL_DEG * DEG }).upward).toBeCloseTo(1, 9);
    expect(at({ pitch: 60 * DEG }).upward).toBe(1);
    expect(at({ pitch: 60 * DEG }).exposure).toBe(1);
  });

  it('climbs monotonically from five to thirty-five degrees', () => {
    let last = 0;
    for (let deg = PITCH_BEGIN_DEG; deg <= PITCH_FULL_DEG; deg += 0.5) {
      const now = at({ pitch: deg * DEG }).upward;
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(last).toBeCloseTo(1, 9);
  });

  it('rises with the wind blowing INTO the lens, by the streaks’ own drift', () => {
    // Looking north (−z); a wind blowing south (+z) comes at the face.
    const trade = 555;
    const head = at({ windZ: trade });
    expect(head.intoLens).toBeCloseTo((trade * BOUNDARY_LAYER) / WIND_FULL, 9);
    expect(head.exposure).toBeCloseTo(head.intoLens * WIND_WEIGHT, 9);
    // Turned to face south (yaw π), the same wind is on her back.
    expect(at({ yaw: Math.PI, windZ: trade }).intoLens).toBe(0);
    // Facing east (yaw −π/2: forward (1, 0)), a wind blowing west comes at the face.
    expect(at({ yaw: -Math.PI / 2, windX: -trade }).intoLens).toBeGreaterThan(0);
    // The wind adds to the sky and the sum is clamped.
    const both = at({ pitch: PITCH_FULL_DEG * DEG, windZ: trade });
    expect(both.exposure).toBe(1);
    // A hurricane cannot push the drift past the streaks' cap.
    expect(at({ windZ: 1e6 }).intoLens).toBeCloseTo(Math.min(1, DRIFT_MAX / WIND_FULL), 9);
  });

  it('puts the wind on the sky’s scale: WIND_FULL is the level-lens flux of a lens pitched to full', () => {
    expect(WIND_FULL).toBeCloseTo(FALL * Math.sin(PITCH_FULL_DEG * DEG), 9);
    expect(WIND_FULL).toBeLessThan(DRIFT_MAX);
  });

  it('reads a crosswind as nothing and a wind blowing away as nothing', () => {
    expect(at({ windX: 555 }).intoLens).toBe(0);
    expect(at({ windX: -555 }).intoLens).toBe(0);
    expect(at({ windZ: -555 }).intoLens).toBe(0);
    expect(at({ windZ: -555 }).exposure).toBe(0);
  });

  it('reads NaN as dry, everywhere', () => {
    const nan = lensExposure({ pitch: Number.NaN, yaw: Number.NaN, windX: Number.NaN, windZ: Number.NaN, strength: Number.NaN });
    expect(nan).toEqual({ exposure: 0, upward: 0, intoLens: 0 });
    expect(at({ pitch: 60 * DEG, strength: Number.NaN }).exposure).toBe(0);
    const badWind = at({ pitch: 60 * DEG, windX: Number.POSITIVE_INFINITY, windZ: Number.NaN });
    expect(badWind.intoLens).toBe(0);
    expect(badWind.exposure).toBe(1);
    for (const value of Object.values(badWind)) expect(Number.isFinite(value)).toBe(true);
  });

  it('scales with the rain’s strength, and a shower that has not arrived lands nothing', () => {
    const up = 60 * DEG;
    expect(at({ pitch: up, strength: 0.25 }).exposure).toBeCloseTo(0.25, 9);
    expect(at({ pitch: up, strength: 0 }).exposure).toBe(0);
    expect(at({ pitch: up, strength: 5 }).exposure).toBe(1);
    expect(at({ pitch: up, strength: -1 }).exposure).toBe(0);
  });
});

describe('the cap', () => {
  it('names every rung the ladder has, is zero on ultra-low and never smaller up the ladder', () => {
    let last = -1;
    for (const tier of DETAIL_TIERS) {
      expect(LENS_CAPS[tier], tier).toBeDefined();
      expect(LENS_CAPS[tier]).toBeGreaterThanOrEqual(last);
      last = LENS_CAPS[tier];
    }
    expect(LENS_CAPS['ultra-low']).toBe(0);
    expect(LENS_CAPS.low).toBeGreaterThan(0);
    expect(LENS_CAPS['ultra-high']).toBeLessThanOrEqual(28);
    expect(lensCapFor('nonsense')).toBe(LENS_CAPS.medium);
    expect(new LensView({ detail: 'low' }).cap).toBe(LENS_CAPS.low);
    expect(new LensView({ detail: 'high' }).detail).toBe('high');
  });

  it('is absent on ultra-low: nothing spawns, nothing splashes, nothing is drawn', () => {
    const view = new LensView({ detail: 'ultra-low' });
    expect(view.cap).toBe(0);
    run(view, 30, 1, 1);
    view.splash(4);
    expect(view.live).toBe(0);
    expect(view.spawned).toBe(0);
    expect(mesh(view).visible).toBe(false);
    expect(mesh(view).count).toBe(0);
    view.dispose();
  });

  it('rebuilds for another rung and keeps the drops that fit', () => {
    const view = new LensView({ detail: 'high' });
    view.splash(10);
    expect(view.live).toBe(10);
    const before = mesh(view);
    view.setDetail('low');
    expect(view.cap).toBe(LENS_CAPS.low);
    expect(view.detail).toBe('low');
    expect(view.live).toBe(LENS_CAPS.low);
    expect(mesh(view)).not.toBe(before);
    expect(mesh(view).instanceMatrix.array.length).toBe(LENS_CAPS.low * 16);
    expect(view.scene.children).toHaveLength(1);
    view.setDetail('ultra-high');
    expect(view.live).toBe(LENS_CAPS.low);
    expect(mesh(view).instanceMatrix.array.length).toBe(LENS_CAPS['ultra-high'] * 16);
    view.dispose();
  });
});

describe('the drops', () => {
  it('arrive more often in heavy rain looking up than in light rain, and never past the cap', () => {
    const heavy = new LensView({ detail: 'medium', seed: 7 });
    const light = new LensView({ detail: 'medium', seed: 7 });
    const heavyPeak = run(heavy, 30, 1, 1);
    const lightPeak = run(light, 30, 0.25, 0.25);
    expect(heavy.spawned).toBeGreaterThan(light.spawned);
    expect(light.spawned).toBeGreaterThan(0);
    expect(heavyPeak).toBeLessThanOrEqual(heavy.cap);
    expect(lightPeak).toBeLessThanOrEqual(light.cap);
    expect(heavy.live).toBeGreaterThan(0);
    expect(mesh(heavy).visible).toBe(true);
    expect(mesh(heavy).count).toBe(heavy.live);
    // The rate is the brief's: SPAWN_PER_S at full exposure in a real
    // shower, as a chance on the tick — a Poisson-ish 36 over 30 s with a
    // pool of 12 in the way, so a generous band rather than a number.
    expect(heavy.spawned).toBeGreaterThan(SPAWN_PER_S * 30 * 0.4);
    expect(heavy.spawned).toBeLessThan(SPAWN_PER_S * 30 * 1.6);
    heavy.dispose();
    light.dispose();
  });

  it('spawn nothing at zero exposure, and the live ones die within their longest life', () => {
    const view = new LensView({ detail: 'medium' });
    run(view, 30, 1, 0);
    expect(view.spawned).toBe(0);
    expect(view.live).toBe(0);
    run(view, 5, 1, 1);
    const seen = view.spawned;
    expect(view.live).toBeGreaterThan(0);
    // The rain stops reaching the glass: no more arrive, what is there fades and goes.
    run(view, LIFE_MAX_S + FRAME, 1, 0);
    expect(view.spawned).toBe(seen);
    expect(view.live).toBe(0);
    expect(mesh(view).visible).toBe(false);
    view.dispose();
  });

  it('creep downward, faster when bigger, and fade over the last third of a life', () => {
    const view = new LensView({ detail: 'medium' });
    view.splash(1);
    const y0 = yOf(view, 0);
    run(view, 0.5, 1, 0);
    expect(view.live).toBe(1);
    expect(yOf(view, 0)).toBeLessThan(y0);
    view.dispose();

    // A drop's alpha is 1 in the middle of its life and falls through the last third.
    const one = new LensView({ detail: 'medium' });
    one.splash(1);
    const alpha = (): number => (mesh(one).geometry.getAttribute('aAlpha').array as Float32Array)[0];
    run(one, 0.6, 1, 0);
    expect(alpha()).toBeCloseTo(1, 6);
    // The shortest splash life is 1.2 s; by 1.1 s every splash drop is in its last third.
    run(one, 0.5, 1, 0);
    if (one.live === 1) expect(alpha()).toBeLessThan(1 - FADE_FRACTION + 0.05);
    one.dispose();
  });

  it('draw the same rain from the same seed, and different rain from another', () => {
    const a = new LensView({ detail: 'medium', seed: 42 });
    const b = new LensView({ detail: 'medium', seed: 42 });
    const c = new LensView({ detail: 'medium', seed: 43 });
    for (const view of [a, b, c]) run(view, 10, 1, 1);
    expect(Array.from(mesh(a).instanceMatrix.array)).toEqual(Array.from(mesh(b).instanceMatrix.array));
    expect(a.spawned).toBe(b.spawned);
    expect(Array.from(mesh(c).instanceMatrix.array)).not.toEqual(Array.from(mesh(a).instanceMatrix.array));
    for (const view of [a, b, c]) view.dispose();
  });

  it('never allocate per frame: one instance-matrix array across six hundred updates', () => {
    const view = new LensView({ detail: 'high' });
    const before = mesh(view);
    const array = before.instanceMatrix.array;
    const alphas = before.geometry.getAttribute('aAlpha').array;
    for (let i = 0; i < 600; i += 1) view.update(1, 1, FRAME, 0.7);
    expect(mesh(view)).toBe(before);
    expect(mesh(view).instanceMatrix.array).toBe(array);
    expect(mesh(view).geometry.getAttribute('aAlpha').array).toBe(alphas);
    expect(view.live).toBeGreaterThan(0);
    for (let i = 0; i < view.live * 16; i += 1) expect(Number.isFinite(array[i])).toBe(true);
    expect(view.cost.live).toBe(view.live);
    expect(view.cost.meanMs).toBeGreaterThanOrEqual(0);
    expect(view.cost.peakMs).toBeGreaterThanOrEqual(view.cost.meanMs);
    view.resetCost();
    expect(view.cost.meanMs).toBe(0);
    expect(view.cost.peakMs).toBe(0);
    view.dispose();
  });

  it('tick on the accumulator, so the frame rate does not change the rain', () => {
    // The same 30 s at 60 fps and at 10 fps draw the same number of ticks.
    const fast = new LensView({ detail: 'medium', seed: 3 });
    const slow = new LensView({ detail: 'medium', seed: 3 });
    run(fast, 30, 1, 1, FRAME);
    run(slow, 30, 1, 1, LENS_TICK_S);
    expect(Math.abs(fast.spawned - slow.spawned)).toBeLessThanOrEqual(2);
    fast.dispose();
    slow.dispose();
  });
});

describe('the seams', () => {
  it('splash puts larger drops on the glass at once, as many as the pool has room for', () => {
    const view = new LensView({ detail: 'medium' });
    view.splash(4);
    expect(view.live).toBe(4);
    expect(view.spawned).toBe(4);
    expect(mesh(view).visible).toBe(true);
    expect(mesh(view).count).toBe(4);
    for (let i = 0; i < 4; i += 1) expect(radiusOf(view, i)).toBeGreaterThan(SMALL_RADIUS_MAX);
    // With radiusScale 1 they are medium drops; with the default they are larger.
    const plain = new LensView({ detail: 'medium' });
    plain.splash(4, 1);
    for (let i = 0; i < 4; i += 1) expect(radiusOf(plain, i)).toBeLessThanOrEqual(MEDIUM_RADIUS_MAX + 1e-6);
    // A splash bigger than the pool fills the pool and stops.
    const small = new LensView({ detail: 'low' });
    small.splash(100);
    expect(small.live).toBe(LENS_CAPS.low);
    small.splash(3);
    expect(small.live).toBe(LENS_CAPS.low);
    view.dispose();
    plain.dispose();
    small.dispose();
  });

  it('holds still on a dt of zero, negative or NaN', () => {
    const view = new LensView({ detail: 'medium' });
    run(view, 3, 1, 1);
    expect(view.live).toBeGreaterThan(0);
    const matrices = Array.from(mesh(view).instanceMatrix.array);
    const alphas = Array.from(mesh(view).geometry.getAttribute('aAlpha').array);
    const live = view.live;
    const spawned = view.spawned;
    const light = (mesh(view).material as THREE.ShaderMaterial).uniforms.uLight.value as number;
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) view.update(1, 1, dt, 0.1);
    expect(Array.from(mesh(view).instanceMatrix.array)).toEqual(matrices);
    expect(Array.from(mesh(view).geometry.getAttribute('aAlpha').array)).toEqual(alphas);
    expect(view.live).toBe(live);
    expect(view.spawned).toBe(spawned);
    expect((mesh(view).material as THREE.ShaderMaterial).uniforms.uLight.value).toBe(light);
    view.dispose();
  });

  it('keeps a disc round: the aspect narrows x by exactly the aspect', () => {
    const view = new LensView({ detail: 'medium' });
    view.resize(1864, 860);
    view.splash(1);
    let m = matrixOf(view, 0).elements;
    expect((m[0] * 1864) / 860).toBeCloseTo(m[5], 6);
    view.resize(860, 860);
    m = matrixOf(view, 0).elements;
    expect(m[0]).toBeCloseTo(m[5], 6);
    // A bad size is ignored.
    view.resize(0, 0);
    view.resize(Number.NaN, 860);
    m = matrixOf(view, 0).elements;
    expect(m[0]).toBeCloseTo(m[5], 6);
    view.dispose();
  });

  it('takes the light the scene sets, clamped, and draws with no depth and its own orthographic camera', () => {
    const view = new LensView({ detail: 'medium' });
    const material = mesh(view).material as THREE.ShaderMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.transparent).toBe(true);
    expect(mesh(view).frustumCulled).toBe(false);
    expect(view.camera).toBeInstanceOf(THREE.OrthographicCamera);
    expect(view.scene.background).toBeNull();
    view.update(1, 1, FRAME, 2);
    expect(material.uniforms.uLight.value).toBe(1);
    view.update(1, 1, FRAME, -1);
    expect(material.uniforms.uLight.value).toBe(0);
    view.update(1, 1, FRAME, Number.NaN);
    expect(material.uniforms.uLight.value).toBe(0);
    view.update(1, 1, FRAME);
    expect(material.uniforms.uLight.value).toBe(0);
    view.dispose();
  });

  it('dispose lets go of the geometry, the material and the mesh', () => {
    const view = new LensView({ detail: 'medium' });
    const instanced = mesh(view);
    const geometry = vi.spyOn(instanced.geometry, 'dispose');
    const material = vi.spyOn(instanced.material as THREE.Material, 'dispose');
    const meshGone = vi.spyOn(instanced, 'dispose');
    view.dispose();
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    expect(meshGone).toHaveBeenCalledTimes(1);
    expect(view.scene.children).toEqual([]);
    expect(view.live).toBe(0);
  });
});

describe('the boundary', () => {
  const ROOT = process.cwd();
  const files = ['LensView.ts', 'lensExposure.ts'].map((f) => [f, readFileSync(path.join(ROOT, 'src', 'sky', f), 'utf8')] as const);
  /** Comments blanked, so a docblock that names the rule cannot trip it. */
  const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('imports nothing from perf/, ui/, view/, actor/, session/ or net/, and world/ as types only', () => {
    const banned = /from\s*['"][^'"]*(^|\/)(perf|ui|view|actor|session|net)(\/|['"])/;
    for (const [file, src] of files) {
      expect(code(src), file).not.toMatch(banned);
      for (const m of code(src).matchAll(/\bimport\s+([^;]*?)\s+from\s*['"]([^'"]+)['"]/g)) {
        if (/(^|\/)world(\/|$)/.test(m[2])) expect(m[1], `${file}: ${m[0]}`).toMatch(/^type\b/);
      }
    }
  });

  it('reads no world coordinate and rolls no dice', () => {
    for (const [file, src] of files) {
      expect(code(src), `${file} reads a world coordinate`).not.toMatch(/\.w[xz]\b/);
      expect(code(src), `${file} uses Math.random`).not.toMatch(/Math\.random/);
      expect(code(src), `${file} reads the clock`).not.toMatch(/\bDate\.now\(/);
    }
  });
});
