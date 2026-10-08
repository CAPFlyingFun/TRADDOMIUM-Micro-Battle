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
import { BELLY_KEYS, BELLY_MOTION, BELLY_SPRING, BELLY_TARGET, bellyMotionWeights, breastWeights, fingerBend, FINGER_LIMITS_DEG, restingBellySpring, stepBellySpring, walkBounceAccel, GARMENTS, SARAH_BASE_MODEL, bellyWeights, bumpLine, fingersLine, sarahLabTool, statusLine } from '../src/sarahlab/sarahLabTool';

async function load() {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(`public/${SARAH_BASE_MODEL}`);
  const mesh = doc.getRoot().listMeshes()[0];
  return { doc, mesh };
}

describe('the base mannequin (public/models/sarah-base.glb)', () => {
  it('carries the belly target on every primitive, and a shirt and leggings by material', async () => {
    const { mesh } = await load();
    const names0 = (mesh.getExtras() as { targetNames?: string[] }).targetNames ?? [];
    for (const [, name] of BELLY_KEYS) if (name) expect(names0).toContain(name);
    expect(names0).toContain(BELLY_TARGET);
    const names = mesh.listPrimitives().map((p) => p.getMaterial()?.getName());
    for (const g of GARMENTS) expect(names).toContain(g);
    for (const name of [BELLY_MOTION.tilt, BELLY_MOTION.bob, BELLY_MOTION.sway]) expect(names0).toContain(name);
    // the four sizes and the three motions, on every primitive, so the clothes move with her
    for (const name of ['breast0', 'breast100']) expect(names0).toContain(name);
    // the six sizes, the three motions and the two breast ends, on every primitive, so the clothes move with her
    for (const p of mesh.listPrimitives()) expect(p.listTargets().length).toBe(BELLY_KEYS.length - 1 + 3 + 2);
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
    // the breasts at half the bump: 25% at 50, the model's own at 100, 100% at 200
    expect(breastWeights(50)).toEqual({ breast0: 0.5, breast100: 0 });
    expect(breastWeights(100)).toEqual({ breast0: 0, breast100: 0 });
    expect(breastWeights(150)).toEqual({ breast0: 0, breast100: 0.5 });
    expect(breastWeights(200)).toEqual({ breast0: 0, breast100: 1 });
    expect(bumpLine(150)).toMatch(/breasts 75%/);
    expect(bumpLine(100)).toMatch(/as modelled/);
    expect(bumpLine(0)).toMatch(/nearly flat/);
    expect(fingersLine(100)).toMatch(/fist/);
    expect(statusLine(true, false, ['shirt', 'leggings'], true)).toBe('base model · belly slider · shirt + leggings');
    expect(statusLine(false, true, [], false)).toMatch(/did not load/);
  });
});
