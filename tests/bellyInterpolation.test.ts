/**
 * The belly curve experiment (Joshua, 2026-10-22): CONTINUOUS and EASED are only new weights for the nine approved
 * belly targets. The approved slider is untouched; 0, 100 and 200% are exact in every mode; the smooth path stays
 * within 2.5 mm of the range between neighbouring keys; the slider never runs backwards; and the measured gaps are the
 * file's.
 */
import { describe, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { BELLY_CURVES, BELLY_KEY_GAPS, BELLY_KNOTS, PATH_KNOTS, bellyKeyWeights, pathPosition } from '../src/sarahlab/bellyInterpolation';
import { BELLY_KEYS, BELLY_UPPER_SCALE, SARAH_V2_BODY_MODEL, bellyHeightWeights, bellyUpperWeight, bellyWeights, bodyShapeFieldWeights } from '../src/sarahlab/sarahLabTool';
import { defaultBodyShape } from '../src/actor/bodyShape';

const sizes = Array.from({ length: 401 }, (_, i) => i / 2);

describe('the belly curve experiment', () => {
  it('leaves the approved slider exactly as it was, and describes it exactly as a path', () => {
    for (const p of sizes) {
      expect(bellyWeights(p, 'approved')).toEqual(bellyWeights(p));
      const w = bellyKeyWeights(p, 'approved'), old = bellyWeights(p);
      for (const [s, name] of BELLY_KEYS) if (name) expect(w[BELLY_KNOTS.indexOf(s)]).toBeCloseTo(old[name], 12);
    }
  });
  it('reaches 0, 100 and 200% exactly in every mode, every approved key in CONTINUOUS, and always adds up to one', () => {
    for (const curve of BELLY_CURVES) {
      for (const p of [0, 100, 200]) bellyKeyWeights(p, curve).forEach((w, k) => expect(w).toBeCloseTo(BELLY_KNOTS[k] * 100 === p ? 1 : 0, 10));
      for (const p of sizes) expect(bellyKeyWeights(p, curve).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    for (const s of BELLY_KNOTS) bellyKeyWeights(s * 100, 'continuous').forEach((w, k) => expect(w).toBeCloseTo(BELLY_KNOTS[k] === s ? 1 : 0, 10));
    // the upper belly and the shape fields come along on the same curve, and agree with the approved ones at the ends
    for (const curve of BELLY_CURVES) for (const p of [0, 100, 200]) {
      expect(bellyUpperWeight(p, curve)).toBeCloseTo(bellyUpperWeight(p), 10);
      expect(bellyHeightWeights(2, p, curve)).toEqual(Object.fromEntries(Object.entries(bellyHeightWeights(2, p)).map(([k, v]) => [k, expect.closeTo(v, 10)])));
    }
    expect(Object.values(bodyShapeFieldWeights(defaultBodyShape(), 120, 'continuousEased')).every((v) => v === 0 || Object.is(v, -0))).toBe(true);
  });
  it('never runs the slider backwards, and gives the same shape for the same size coming and going', () => {
    for (const curve of BELLY_CURVES) {
      let last = -1;
      for (const p of sizes) { const u = pathPosition(p, curve); expect(u).toBeGreaterThanOrEqual(last - 1e-12); last = u; }
      const up = sizes.map((p) => bellyKeyWeights(p, curve)), down = [...sizes].reverse().map((p) => bellyKeyWeights(p, curve)).reverse();
      expect(down).toEqual(up);
    }
    expect(PATH_KNOTS[0]).toBe(0); expect(PATH_KNOTS[BELLY_KNOTS.indexOf(1)]).toBeCloseTo(1, 12); expect(PATH_KNOTS[BELLY_KNOTS.length - 1]).toBeCloseTo(2, 12);
    expect(BELLY_UPPER_SCALE.map(([s]) => BELLY_KNOTS.includes(s)).every(Boolean)).toBe(true);
  });

  it('measures the same gaps as the file, and the smooth path keeps her within 2.5 mm of the keys either side', async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(`public/${SARAH_V2_BODY_MODEL}`);
    const mesh = doc.getRoot().listMeshes().find((m) => ((m.getExtras()?.targetNames as string[] | undefined) ?? []).includes('belly200'))!;
    const names = mesh.getExtras().targetNames as string[], prim = mesh.listPrimitives()[0], targets = prim.listTargets();
    const n = prim.getAttribute('POSITION')!.getCount();
    const read = (name: string) => { const a = targets[names.indexOf(name)].getAttribute('POSITION')!, out = new Float64Array(n * 3), t = [0, 0, 0]; for (let i = 0; i < n; i++) { a.getElement(i, t); out.set(t, i * 3); } return out; };
    const upper = read('bellyUpper'), ratio = new Map(BELLY_UPPER_SCALE.map(([s, r]) => [s, r]));
    const byKnot = new Map(BELLY_KEYS.map(([s, name]) => [s, name]));
    const shapes = BELLY_KNOTS.map((s) => { const name = byKnot.get(s); const d = name ? read(name) : new Float64Array(n * 3); for (let i = 0; i < n * 3; i++) d[i] += ratio.get(s)! * upper[i]; return d; });
    const dist = (a: Float64Array, b: Float64Array, v: number) => Math.hypot(a[v * 3] - b[v * 3], a[v * 3 + 1] - b[v * 3 + 1], a[v * 3 + 2] - b[v * 3 + 2]);
    const last = shapes.length - 1;
    let most = 0; for (let v = 0; v < n; v++) most = Math.max(most, dist(shapes[0], shapes[last], v));
    const region: number[] = []; for (let v = 0; v < n; v++) if (dist(shapes[0], shapes[last], v) > 0.05 * most) region.push(v);
    const gaps = shapes.slice(1).map((s, k) => Math.sqrt(region.reduce((a, v) => a + dist(shapes[k], s, v) ** 2, 0) / region.length));
    gaps.forEach((g, k) => expect(g).toBeCloseTo(BELLY_KEY_GAPS[k], 5));
    // the smooth path, sampled every 0.5%: every coordinate of every bump vertex within 2.5 mm of the range of the two
    // approved keys either side of it
    const sample = region.filter((_, i) => i % 2 === 0);
    let worst = 0;
    for (const p of sizes) {
      const w = bellyKeyWeights(p, 'continuous'), b = p / 100;
      let k = 0; while (k < BELLY_KNOTS.length - 2 && b > BELLY_KNOTS[k + 1]) k++;
      for (const v of sample) for (let c = 0; c < 3; c++) {
        let x = 0; for (let j = 0; j < w.length; j++) x += w[j] * shapes[j][v * 3 + c];
        const lo = Math.min(shapes[k][v * 3 + c], shapes[k + 1][v * 3 + c]), hi = Math.max(shapes[k][v * 3 + c], shapes[k + 1][v * 3 + c]);
        worst = Math.max(worst, x - hi, lo - x);
      }
    }
    expect(worst).toBeLessThan(0.0025);
  }, 120000);
});
