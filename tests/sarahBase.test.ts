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
import { BELLY_KEYS, BELLY_TARGET, GARMENTS, SARAH_BASE_MODEL, bellyWeights, bumpLine, fingersLine, sarahLabTool, statusLine } from '../src/sarahlab/sarahLabTool';

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
    for (const p of mesh.listPrimitives()) expect(p.listTargets().length).toBe(BELLY_KEYS.length - 1);
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
    expect(sum(bellyWeights(150))).toBe(0);
    expect(bumpLine(100)).toMatch(/as modelled/);
    expect(bumpLine(0)).toMatch(/nearly flat/);
    expect(fingersLine(100)).toMatch(/fist/);
    expect(statusLine(true, false, ['shirt', 'leggings'], true)).toBe('base model · belly slider · shirt + leggings');
    expect(statusLine(false, true, [], false)).toMatch(/did not load/);
  });
});
