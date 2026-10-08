/**
 * SARAH'S BASE MANNEQUIN, as the Sarah Lab loads it (`public/models/sarah-base.glb`).
 *
 * Joshua, 2026-10-07: a belly slider "from this max size to almost flat", and
 * clothes for her, tried in a dev menu "before placing live". The bake adds the
 * `belly` morph target (scripts/bellyMorph.mjs) and grows a shirt and leggings
 * from her skin (scripts/growClothes.mjs). This pins what the lab depends on.
 */
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as labTool from '../src/sarahlab/sarahLabTool';
import { BELLY_KEYS, BELLY_MOTION, BELLY_SPRING, BELLY_TARGET, bellyMotionWeights, breastBobWeight, breastWeights, BREAST_SPRING, stepBreastSpring, fingerBend, FINGER_LIMITS_DEG, restingBellySpring, stepBellySpring, walkBounceAccel, GARMENTS, SARAH_BASE_MODEL, bellyWeights, bumpLine, fingersLine, sarahLabTool, statusLine } from '../src/sarahlab/sarahLabTool';

async function load() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(`public/${SARAH_BASE_MODEL}`);
  const mesh = doc.getRoot().listMeshes()[0];
  return { doc, mesh };
}

describe('the base mannequin (public/models/sarah-base.glb)', () => {
  it('bakes a normal bust at zero and real growth to twice the original, on body and garments', async () => {
    const { mesh } = await load();
    const names = (mesh.getExtras() as { targetNames: string[] }).targetNames;
    const body = mesh.listPrimitives().find((p) => !GARMENTS.includes(p.getMaterial()?.getName() as typeof GARMENTS[number]))!;
    const normal = body.listTargets()[names.indexOf('breast0')].getAttribute('POSITION')!;
    const grown = body.listTargets()[names.indexOf('breast100')].getAttribute('POSITION')!;
    const v = [0, 0, 0];
    let shrink = 0, depth = 0;
    for (let i = 0; i < normal.getCount(); i += 1) {
      normal.getElement(i, v); shrink = Math.max(shrink, Math.hypot(...v));
      grown.getElement(i, v); depth = Math.max(depth, v[2]);
    }
    expect(shrink).toBeLessThan(0.0002);
    expect(depth).toBeGreaterThan(0.06);
    for (const p of mesh.listPrimitives().filter((p) => ['shirt', 'swimsuit'].includes(p.getMaterial()?.getName() ?? ''))) {
      const t = p.listTargets()[names.indexOf('breast100')].getAttribute('POSITION')!;
      let most = 0;
      for (let i = 0; i < t.getCount(); i += 1) { t.getElement(i, v); most = Math.max(most, v[2]); }
      expect(most).toBeGreaterThan(0.05);
    }
  }, 60000);
  it('carries the belly target on every primitive, and a shirt and leggings by material', async () => {
    const { mesh } = await load();
    const names0 = (mesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
    for (const [, name] of BELLY_KEYS) if (name) expect(names0).toContain(name);
    expect(names0).toContain(BELLY_TARGET);
    const names = mesh.listPrimitives().map((p) => p.getMaterial()?.getName());
    for (const g of GARMENTS) expect(names).toContain(g);
    const body = mesh.listPrimitives().find((p) => p.getMaterial()?.getName() === 'Material_0')!;
    const cover = body.getAttribute('_CLOTH_COVER')!;
    expect(cover.getCount()).toBe(body.getAttribute('POSITION')!.getCount());
    const bits = [...cover.getArray()!];
    for (let g = 0; g < GARMENTS.length; g += 1) expect(bits.some((b) => b & (1 << g))).toBe(true);
    expect(bits.some((b) => b === 0)).toBe(true);
    for (const name of [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway]) expect(names0).toContain(name);
    // the four sizes and the three motions, on every primitive, so the clothes move with her
    for (const name of ['breast0', 'breast100', 'breastBob', 'navelIn', 'navelOut']) expect(names0).toContain(name);
    // the six sizes, the three motions, the two breast ends and the breasts' bounce, on every primitive, so the clothes move with her
    for (const p of mesh.listPrimitives()) expect(p.listTargets().length).toBe(BELLY_KEYS.length - 1 + 3 + 3 + 2);
  }, 60000);

  it('the flat key draws the bump in by several centimetres and leaves the back, the bust and the legs alone', async () => {
    const { doc, mesh } = await load();
    const body = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION')!.getCount() > a.getAttribute('POSITION')!.getCount() ? p : a));
    // by name: the targets are stored 75%, 50%, 25%, flat, and [0] is the 75% one
    const flatAt = ((mesh.getExtras() as { targetNames?: string[] }).targetNames ?? []).indexOf(BELLY_TARGET);
    const P = body.getAttribute('POSITION')!, T = body.listTargets()[flatAt].getAttribute('POSITION')!;
    // the mesh node may carry quantization's scale: read sizes through it
    const node = doc.getRoot().listNodes().find((n) => n.getMesh() === mesh)!;
    const s = node.getWorldMatrix()[5];
    let lo = Infinity, hi = -Infinity;
    const v = [0, 0, 0], d = [0, 0, 0];
    for (let i = 0; i < P.getCount(); i += 1) { P.getElement(i, v); lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
    const metres = 1.7 / ((hi - lo) * s);
    let deepest = 0, backMoved = 0, highMoved = 0, lowMoved = 0;
    for (let i = 0; i < P.getCount(); i += 1) {
      P.getElement(i, v); T.getElement(i, d);
      const dz = -Math.hypot(d[0], d[2]) * s * metres, moved = Math.hypot(...d) * s * metres;
      const y = (v[1] - lo) * s * metres; // height off the floor, metres
      deepest = Math.min(deepest, dz);
      if (moved > 0.002) {
        // the bump's sides wrap round the waist a little behind the centre line;
        // the back itself (8 cm and more behind it) never moves
        if (v[2] * s * metres < -0.08) backMoved += 1;
        if (y > 1.3) highMoved += 1; // the bust and up
        if (y < 0.7) lowMoved += 1; // the legs
      }
    }
    expect(deepest).toBeLessThan(-0.05);
    expect(backMoved).toBe(0);
    expect(highMoved).toBe(0);
    expect(lowMoved).toBe(0);
  }, 60000);
});

describe("the bump's weight (motion targets)", () => {
  it('tilts, bobs and sways the bump alone: the back, the bust and the legs hold still', async () => {
    const { doc, mesh } = await load();
    const body = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION')!.getCount() > a.getAttribute('POSITION')!.getCount() ? p : a));
    const names = (mesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
    const P = body.getAttribute('POSITION')!;
    const s = doc.getRoot().listNodes().find((n) => n.getMesh() === mesh)!.getWorldMatrix()[5];
    let lo = Infinity, hi = -Infinity;
    const v = [0, 0, 0], d = [0, 0, 0];
    for (let i = 0; i < P.getCount(); i += 1) { P.getElement(i, v); lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
    const metres = 1.7 / ((hi - lo) * s);
    for (const name of [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway]) {
      const T = body.listTargets()[names.indexOf(name)].getAttribute('POSITION')!;
      let most = 0, stray = 0;
      for (let i = 0; i < P.getCount(); i += 1) {
        P.getElement(i, v); T.getElement(i, d);
        const moved = Math.hypot(...d) * s * metres, y = (v[1] - lo) * s * metres;
        most = Math.max(most, moved);
        if (moved > 0.001 && (v[2] * s * metres < -0.08 || y > 1.3 || y < 0.7)) stray += 1;
      }
      expect(most, name).toBeGreaterThan(0.005);
      // a bounce or a sway is a centimetre; the tilt is a true 20° turn of the whole bump
      expect(most, name).toBeLessThan(name === BELLY_MOTION.tilt ? 0.12 : 0.04);
      expect(stray, name).toBe(0);
      // the lab reads the bake's sizes from BELLY_MOTION: they must be the same numbers
      if (name !== BELLY_MOTION.tilt) expect(most, name).toBeCloseTo(BELLY_MOTION.bobM, 3);
    }
  }, 60000);
});

describe('the bump\'s spring', () => {
  it('lags a jolt and settles like a weight, not a jelly: the second swing is a fraction of the first', () => {
    const s = restingBellySpring();
    s.vy = 0.3;
    const ys: number[] = [];
    for (let k = 0; k < 240; k += 1) { stepBellySpring(s, 1 / 60, 0, 0); ys.push(s.y); }
    const first = Math.max(...ys.slice(0, 20));
    // the opposite swing, then the next same-side peak
    const firstAt = ys.indexOf(first);
    const back = Math.min(...ys.slice(firstAt, firstAt + 30));
    expect(first).toBeGreaterThan(0.004);
    expect(first).toBeLessThanOrEqual(BELLY_SPRING.maxM);
    expect(-back / first).toBeLessThan(0.45);
    expect(-back / first).toBeGreaterThan(0.15);
    // four seconds on, it has stopped
    expect(Math.abs(s.y)).toBeLessThan(0.0002);
  });

  it('throws the bump against the body: rising drops it, a step left swings it right; a jump is clamped', () => {
    const s = restingBellySpring();
    stepBellySpring(s, 0.05, 5, 5);
    expect(s.y).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(0);
    const t = restingBellySpring();
    stepBellySpring(t, 0.05, 1e6, Number.NaN);
    expect(Math.abs(t.y)).toBeLessThanOrEqual(BELLY_SPRING.maxM);
    expect(t.x).toBe(0);
  });

  it('scales with the bump: a flat belly carries no weight, and the slider tilts a full one by its degrees', () => {
    const s = restingBellySpring();
    s.y = 0.01; s.x = 0.005;
    for (const w of Object.values(bellyMotionWeights(0, 3, s))) expect(w).toBe(0);
    const still = bellyMotionWeights(100, 3, restingBellySpring());
    expect(still[BELLY_MOTION.tilt]).toBeCloseTo((3 * Math.PI) / 180 / BELLY_MOTION.tiltRad, 6);
    expect(still[BELLY_MOTION.bob]).toBe(0);
    const half = bellyMotionWeights(50, 2, restingBellySpring());
    expect(half[BELLY_MOTION.tilt]).toBeCloseTo((0.5 * 2 * Math.PI) / 180 / BELLY_MOTION.tiltRad, 6);
    // up to 10°, and a bigger belly tilts by the slider's degrees, not twice them
    const ten = (10 * Math.PI) / 180 / BELLY_MOTION.tiltRad;
    expect(bellyMotionWeights(100, 99, restingBellySpring())[BELLY_MOTION.tilt]).toBeCloseTo(ten, 6);
    // past 100% the size tilts it by itself, evenly to 20° at 200%, on top of the slider
    const deg = (d: number) => (d * Math.PI) / 180 / BELLY_MOTION.tiltRad;
    expect(bellyMotionWeights(100, 0, restingBellySpring())[BELLY_MOTION.tilt]).toBe(0);
    expect(bellyMotionWeights(150, 0, restingBellySpring())[BELLY_MOTION.tilt]).toBeCloseTo(deg(10), 6);
    expect(bellyMotionWeights(200, 0, restingBellySpring())[BELLY_MOTION.tilt]).toBeCloseTo(deg(20), 6);
    expect(bellyMotionWeights(200, 10, restingBellySpring())[BELLY_MOTION.tilt]).toBeCloseTo(deg(30), 6);
  });

  it('lets the breasts bounce on a spring of their own, lighter and quicker, as big as they are', () => {
    const s = restingBellySpring(), b = restingBellySpring();
    s.vy = 0.3; b.vy = 0.3;
    let peakS = 0, peakB = 0, tS = 0, tB = 0;
    for (let k = 1; k <= 60; k += 1) {
      stepBellySpring(s, 1 / 120, 0, 0); stepBreastSpring(b, 1 / 120, 0, 0);
      if (s.y > peakS) { peakS = s.y; tS = k; }
      if (b.y > peakB) { peakB = b.y; tB = k; }
    }
    expect(tB).toBeLessThan(tS); // quicker
    expect(peakB).toBeLessThanOrEqual(BREAST_SPRING.maxM);
    const lifted = restingBellySpring(); lifted.y = 0.01;
    expect(breastBobWeight(200, lifted)).toBeCloseTo((2 / 1.5) * breastBobWeight(100, lifted), 6);
    expect(breastBobWeight(0, lifted)).toBeGreaterThan(0);
  });

  it("adds a walk's bounce, two a stride", () => {
    expect(walkBounceAccel(0, 1)).toBeLessThan(0);
    expect(walkBounceAccel(0.25, 1)).toBeGreaterThan(0);
    expect(walkBounceAccel(0.5, 1)).toBeCloseTo(walkBounceAccel(0, 1), 9);
    expect(walkBounceAccel(0.3, 0)).toBe(0);
  });
});

describe("Sarah's fingers in the lab", () => {
  it('bend each joint only toward the palm and only as far as a hand can: never backward, never past its limit', () => {
    const deg = (r: number) => (r * 180) / Math.PI;
    for (const thumb of [false, true]) {
      const limits = thumb ? FINGER_LIMITS_DEG.thumb : FINGER_LIMITS_DEG.finger;
      limits.forEach((limit, k) => {
        expect(fingerBend(0, k, thumb)).toBe(0);
        expect(deg(fingerBend(100, k, thumb))).toBeCloseTo(limit, 6);
        expect(deg(fingerBend(50, k, thumb))).toBeCloseTo(limit / 2, 6);
        expect(fingerBend(-40, k, thumb)).toBe(0); // no bending back
        expect(deg(fingerBend(250, k, thumb))).toBeCloseTo(limit, 6); // no bending past
      });
    }
    // a fist no longer folds a finger 240° into its own palm, and the thumb's base barely bends
    expect(FINGER_LIMITS_DEG.finger.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(220);
    expect(FINGER_LIMITS_DEG.thumb[0]).toBeLessThan(FINGER_LIMITS_DEG.thumb[1]);
  });
});

describe('every belly size (no spikes)', () => {
  it('stretches no edge of the skin at any key: a vertex left behind draws a spike', async () => {
    const { mesh } = await load();
    const body = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION')!.getCount() > a.getAttribute('POSITION')!.getCount() ? p : a));
    const P = body.getAttribute('POSITION')!, I = body.getIndices()!.getArray()!;
    const n = P.getCount(), v = [0, 0, 0];
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) { P.getElement(i, v); base.set(v, i * 3); }
    for (const t of body.listTargets()) {
      const T = t.getAttribute('POSITION')!;
      const fin = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) { T.getElement(i, v); for (let k = 0; k < 3; k += 1) fin[i * 3 + k] = base[i * 3 + k] + v[k]; }
      const len = (a: Float32Array, i: number, j: number) => Math.hypot(a[i * 3] - a[j * 3], a[i * 3 + 1] - a[j * 3 + 1], a[i * 3 + 2] - a[j * 3 + 2]);
      let stretched = 0;
      for (let f = 0; f < I.length; f += 3) {
        for (const [i, j] of [[I[f], I[f + 1]], [I[f + 1], I[f + 2]], [I[f + 2], I[f]]]) {
          // 0.04 bake units is about 3.4 cm on her
          if (len(fin, i, j) > 0.04 && len(fin, i, j) > 4 * len(base, i, j)) stretched += 1;
        }
      }
      expect(stretched, t.getName()).toBe(0);
    }
  }, 60000);
});

describe('the Sarah Lab', () => {
  it('hides only triangles fully inside a visible garment and restores all skin when undressed', () => {
    const cut = (labTool as unknown as { uncoveredSkinIndices: (indices: Uint16Array, coverage: Uint8Array, shown: number) => Uint32Array }).uncoveredSkinIndices;
    expect(cut).toBeTypeOf('function');
    const indices = new Uint16Array([0, 1, 2, 2, 3, 4, 3, 4, 5]);
    const coverage = new Uint8Array([1, 1, 1, 2, 2, 2]);
    expect([...cut(indices, coverage, 1)]).toEqual([2, 3, 4, 3, 4, 5]);
    expect([...cut(indices, coverage, 2)]).toEqual([0, 1, 2, 2, 3, 4]);
    expect([...cut(indices, coverage, 3)]).toEqual([2, 3, 4]);
    expect([...cut(indices, coverage, 0)]).toEqual([...indices]);
  });
  it('is a dev tool of its own, reading only the base model', () => {
    expect(sarahLabTool.sceneId).toBe('lab:sarah');
    expect(SARAH_BASE_MODEL).toBe('models/sarah-base.glb');
  });
  it('reads the bump slider as how much bump there is', () => {
    const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum(bellyWeights(100))).toBe(0);
    expect(bellyWeights(0)).toMatchObject({ belly: 1, belly25: 0 });
    expect(bellyWeights(75)).toMatchObject({ belly75: 1, belly50: 0 });
    expect(bellyWeights(62.5).belly75).toBeCloseTo(0.5);
    expect(bellyWeights(62.5).belly50).toBeCloseTo(0.5);
    // past the model: 150% is its own key, 175% halfway to 200%, and it stops at 200%
    expect(bellyWeights(150)).toMatchObject({ belly150: 1, belly200: 0, belly75: 0 });
    expect(bellyWeights(175).belly200).toBeCloseTo(0.5);
    expect(bellyWeights(125).belly150).toBeCloseTo(0.5);
    expect(bellyWeights(500)).toMatchObject({ belly200: 1, belly150: 0 });
    expect(bumpLine(160)).toMatch(/past full term/);
    // Original model at zero belly, then +50% at 100 and +100% at 200.
    expect(breastWeights(0)).toEqual({ breast0: 0, breast100: 0 });
    expect(breastWeights(50)).toEqual({ breast0: 0, breast100: 0.25 });
    expect(breastWeights(100)).toEqual({ breast0: 0, breast100: 0.5 });
    expect(breastWeights(150)).toEqual({ breast0: 0, breast100: 0.75 });
    expect(breastWeights(200)).toEqual({ breast0: 0, breast100: 1 });
    expect(breastWeights(-10)).toEqual(breastWeights(0));
    expect(breastWeights(300)).toEqual(breastWeights(200));
    expect(breastWeights(Number.NaN)).toEqual(breastWeights(100));
    expect(bumpLine(0)).toMatch(/breasts 1.00×/);
    expect(bumpLine(100)).toMatch(/breasts 1.50×/);
    expect(bumpLine(200)).toMatch(/breasts 2.00×/);
    expect(bumpLine(100)).toMatch(/as modelled/);
    expect(bumpLine(0)).toMatch(/nearly flat/);
    expect(fingersLine(100)).toMatch(/fist/);
    expect(statusLine(true, false, ['shirt', 'leggings'], true)).toBe('base model · belly slider · 2 garments');
    expect(statusLine(false, true, [], false)).toMatch(/did not load/);
  });
});

describe('the pregnant sit lays the hands palm-down on any rig', () => {
  it("reads each rig's own palms: the toon's face forward (no turn), the mannequin's face down (a quarter turn)", async () => {
    const { bindPalmRoll } = await import('../src/actor/humanSeated');
    const { measureHuman } = await import('../src/actor/humanSkeleton');
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const roll = async (file: string) => {
      const doc = await io.read(file);
      const joints = doc.getRoot().listSkins()[0].listJoints();
      const bind = joints.map((j) => { const m = j.getWorldMatrix(); const p = j.getParentNode(); return { x: m[12], y: m[13], z: m[14], parent: p ? joints.indexOf(p as never) : -1 }; });
      const me = measureHuman(bind as never);
      return [me.joints.wristL, me.joints.wristR].map((w) => (bindPalmRoll(bind as never, w) * 180) / Math.PI);
    };
    // Joshua, 2026-10-08: "the palms and hands are facing outwards, not inwards like normal"
    for (const d of await roll('public/models/sarah.glb')) expect(Math.abs(d)).toBeLessThan(10);
    for (const d of await roll(`public/${SARAH_BASE_MODEL}`)) expect(Math.abs(d - 90)).toBeLessThan(15);
  }, 60000);
});
