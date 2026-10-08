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
import { BELLY_TARGET, GARMENTS, SARAH_BASE_MODEL, bellyWeight, bumpLine, fingersLine, sarahLabTool, statusLine } from '../src/sarahlab/sarahLabTool';

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
    expect((mesh.getExtras() as { targetNames?: string[] }).targetNames).toContain(BELLY_TARGET);
    const names = mesh.listPrimitives().map((p) => p.getMaterial()?.getName());
    for (const g of GARMENTS) expect(names).toContain(g);
    for (const p of mesh.listPrimitives()) expect(p.listTargets().length).toBe(1);
  }, 60000);

  it('flattens the front of the bump by several centimetres and leaves the back, the bust and the legs alone', async () => {
    const { doc, mesh } = await load();
    const body = mesh.listPrimitives().reduce((a, p) => (p.getAttribute('POSITION')!.getCount() > a.getAttribute('POSITION')!.getCount() ? p : a));
    const P = body.getAttribute('POSITION')!, T = body.listTargets()[0].getAttribute('POSITION')!;
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
      const dz = d[2] * s * metres, moved = Math.hypot(...d) * s * metres;
      const y = (v[1] - lo) * s * metres; // height off the floor, metres
      deepest = Math.min(deepest, dz);
      if (moved > 0.002) {
        if (v[2] < 0) backMoved += 1;
        if (y > 1.3) highMoved += 1; // the bust and up
        if (y < 0.7) lowMoved += 1; // the legs
      }
    }
    expect(deepest).toBeLessThan(-0.06);
    expect(backMoved).toBe(0);
    expect(highMoved).toBe(0);
    expect(lowMoved).toBe(0);
  }, 60000);
});

describe('the Sarah Lab', () => {
  it('is a dev tool of its own, reading only the base model', () => {
    expect(sarahLabTool.sceneId).toBe('lab:sarah');
    expect(SARAH_BASE_MODEL).toBe('models/sarah-base.glb');
  });
  it('reads the bump slider as how much bump there is', () => {
    expect(bellyWeight(100)).toBe(0);
    expect(bellyWeight(0)).toBe(1);
    expect(bellyWeight(150)).toBe(0);
    expect(bumpLine(100)).toMatch(/as modelled/);
    expect(bumpLine(0)).toMatch(/nearly flat/);
    expect(fingersLine(100)).toMatch(/fist/);
    expect(statusLine(true, false, ['shirt', 'leggings'], true)).toBe('base model · belly slider · shirt + leggings');
    expect(statusLine(false, true, [], false)).toMatch(/did not load/);
  });
});
