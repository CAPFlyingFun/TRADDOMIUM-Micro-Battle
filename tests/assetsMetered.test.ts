/**
 * Metered loading (src/assets/assets.ts `loadModel` with a meter; Joshua, 2026-10-20: "use the existing loading
 * pipeline instead of downloading the same assets twice"). The bytes are fetched once, counted as they stream, and
 * handed to GLTFLoader's own parse -- a .gltf's external buffers included, which GLTFLoader asks for as it parses.
 * The totals come from the build's size manifest, which counts a .gltf with every buffer it names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { assetBytes, fetchBytes, loadModel } from '../src/assets/assets';
import { LoadMeter } from '../src/assets/loadMeter';
import { recoveredPartPath, recoveredPartsFor, wornGarments, GARMENTS, RECOVERED_SHIRTS, OUTFITS, PAINTED_DEFAULT_OUTFIT, SARAH_DEFAULT_OUTFIT, SARAH_V2_BODY_MODEL, RECOVERED_GARMENTS, nextOutfit, type Garment } from '../src/sarahlab/sarahLabTool';
import * as THREE from 'three';

/**
 * What a model weighs wherever it is kept: the shipped site's manifest for what is in `public/`, and the same rule (a
 * .gltf is its JSON plus every buffer it names) read from `assets-archive/` for the modelled outfits moved out of the
 * site (Joshua, 2026-10-22, after Replit's audit). The comparisons below are of what the room USED to wait for.
 */
function bytesOf(path: string): number {
  const shipped = assetBytes(path);
  if (shipped !== null) return shipped;
  const file = `assets-archive/${path}`;
  if (!existsSync(file)) return NaN;
  if (!path.endsWith('.gltf')) return statSync(file).size;
  const json = JSON.parse(readFileSync(file, 'utf8')) as { buffers: { uri?: string }[] };
  const parts = new Set(json.buffers.filter((b) => b.uri).map((b) => `assets-archive/models/${b.uri}`));
  return statSync(file).size + [...parts].reduce((sum, q) => sum + statSync(q).size, 0);
}

/** A response that streams `bytes` in `chunk`-sized pieces. */
function streamed(bytes: Uint8Array, chunk: number, headers: Record<string, string> = {}): Response {
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(at, at + chunk)); at += chunk;
    },
  });
  return new Response(body, { status: 200, headers });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchBytes', () => {
  it('streams into one buffer, reporting every chunk, whether or not the size was known', async () => {
    const data = Uint8Array.from({ length: 10_000 }, (_, i) => i % 251);
    for (const expected of [10_000, null, 4_000]) {
      vi.stubGlobal('fetch', async () => streamed(data, 777));
      let heard = 0;
      const { buffer } = await fetchBytes('x.bin', expected, (n) => { heard += n; });
      expect(heard).toBe(10_000);
      expect(new Uint8Array(buffer)).toEqual(data);
    }
  });

  it('fails loudly on an HTTP error', async () => {
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }));
    await expect(fetchBytes('gone.bin', null, () => {})).rejects.toThrow(/404/);
  });
});

describe('loadModel with a meter', () => {
  it('parses a .gltf whose buffer is fetched through the meter, once, at the URL GLTFLoader would use', async () => {
    // one triangle, its positions in an external buffer
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const bin = new Uint8Array(positions.buffer);
    const json = new TextEncoder().encode(JSON.stringify({
      asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteLength: bin.byteLength }],
      buffers: [{ uri: 'tri-parts/tri.bin', byteLength: bin.byteLength }],
    }));
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { asked.push(String(url)); return streamed(String(url).includes('.bin') ? bin : json, 16); });
    const meter = new LoadMeter();
    meter.start('test');
    let told = 0;
    const scene = await loadModel('models/tri.gltf', () => new THREE.Object3D(), { meter, onDownloaded: () => { told++; } });
    expect(scene.userData.isPlaceholder).toBeUndefined();
    let mesh: THREE.Mesh | null = null;
    scene.traverse((n) => { if ((n as THREE.Mesh).isMesh) mesh = n as THREE.Mesh; });
    expect(mesh).not.toBeNull();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatch(/models\/tri-parts\/tri\.bin$/);
    const s = meter.snapshot();
    expect(s.received).toBe(json.byteLength + bin.byteLength);
    expect(s.phase).toBe('preparing'); // every byte in; the scene says when she is ready
    expect(told).toBe(1);
  });

  it('cancels without retrying or standing in a placeholder', async () => {
    const abort = new AbortController();
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => { abort.abort(); if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); return new Response(''); });
    const meter = new LoadMeter();
    meter.start('test');
    await expect(loadModel('models/x.glb', () => new THREE.Object3D(), { meter, signal: abort.signal })).rejects.toThrow();
    expect(meter.snapshot().received).toBe(0);
  });
});

describe('the size manifest', () => {
  it('weighs a .glb as its file and a .gltf as its JSON plus every buffer it names', () => {
    expect(assetBytes(SARAH_V2_BODY_MODEL)).toBe(statSync(`public/${SARAH_V2_BODY_MODEL}`).size);
    for (const file of readdirSync('public/models').filter((f) => f.endsWith('.gltf'))) {
      const path = `models/${file}`;
      const json = JSON.parse(readFileSync(`public/${path}`, 'utf8')) as { buffers: { uri?: string }[] };
      const parts = new Set(json.buffers.filter((b) => b.uri).map((b) => `public/models/${b.uri}`));
      expect(assetBytes(path)).toBe(statSync(`public/${path}`).size + [...parts].reduce((sum, p) => sum + statSync(p).size, 0));
    }
    expect(assetBytes('models/no-such-file.glb')).toBeNull();
  });
  it('ships none of the modelled outfits the room no longer offers (Joshua, 2026-10-22): they are kept in assets-archive', () => {
    for (const path of ['models/sarah-v2-body.glb', 'models/sarah-v2-leggings.glb', 'models/sarah-v2-leggings-low.glb', 'models/sarah-v2-relaxed-high.gltf', 'models/sarah-v2-spandex-low.gltf']) {
      expect(assetBytes(path), path).toBeNull();
      expect(existsSync(`assets-archive/${path}`), path).toBe(true);
    }
    expect(Number.isFinite(bytesOf('models/sarah-v2-relaxed-high.gltf'))).toBe(true);
  });
});

describe('the room opens with only what she has on', () => {
  const all = [...GARMENTS, ...RECOVERED_SHIRTS];
  it('fetches each outfit its own files and no others, the small ones first', () => {
    expect(recoveredPartsFor(wornGarments(0, all))).toEqual(['leggings', 'relaxed-high']);
    expect(recoveredPartsFor(wornGarments(1, all))).toEqual(['leggings-low', 'relaxed-low']);
    expect(recoveredPartsFor(wornGarments(2, all))).toEqual(['bottom']);
    expect(recoveredPartsFor(wornGarments(3, all))).toEqual([]);
    expect(recoveredPartsFor(wornGarments(4, all))).toEqual([]);
    expect(recoveredPartsFor(wornGarments(5, all))).toEqual(['leggings', 'spandex-high']);
    expect(recoveredPartsFor(wornGarments(6, all))).toEqual(['leggings-low', 'spandex-low']);
    // Sarah's new raglan tee (2026-10-27) and her red light spandex tee (2026-10-23): each the light tee's one small file
    // (the new tee wears its material), with the leggings painted under it
    for (const i of [7, 8]) {
      expect(recoveredPartsFor(wornGarments(i, all))).toEqual(['spandex-lite']);
      expect(OUTFITS[i].paint?.length).toBe(1);
    }
    expect(OUTFITS[7].procedural).toBe('raglan');
    expect(OUTFITS[8].procedural).toBeUndefined();
    // the painted outfits (Joshua, 2026-10-21) download nothing: they are paint on her own skin
    for (let i = 9; i < OUTFITS.length; i++) expect(OUTFITS[i].paint?.length ?? 0).toBeGreaterThan(0);
    for (let i = 9; i < OUTFITS.length; i++) expect(recoveredPartsFor(wornGarments(i, all))).toEqual([]);
    // seven modelled, the new tee and the light tee, then the painted ones: Sarah's own red tee and leggings (2026-10-23)
    // and the white tee's six
    expect(OUTFITS).toHaveLength(16);
  });

  it('cycles through the painted outfits, the light tee, the bikini and none on the slim v2 body, never the big modelled shirts and leggings', () => {
    // what the slim body file carries, plus every garment with its own file
    const slim: Garment[] = [...new Set<Garment>(['bikini', ...RECOVERED_GARMENTS, ...RECOVERED_SHIRTS])];
    const seen: number[] = [];
    for (let i = PAINTED_DEFAULT_OUTFIT, n = 0; n < OUTFITS.length; n++) { i = nextOutfit(i, slim); seen.push(i); }
    // the big modelled shirts and leggings are kept but not offered (Joshua, 2026-10-22): bikini, none, the light tee and
    // the painted ones (the light tee is the one outfit with both a garment and paint)
    expect([...new Set(seen)].sort((a, b) => a - b)).toEqual([2, 4, ...OUTFITS.map((o, i) => (o.paint ? i : -1)).filter((i) => i >= 0)]);
    expect(seen).toContain(SARAH_DEFAULT_OUTFIT);
  });

  it('downloads less than the four files it used to wait for, and every file has a size', () => {
    const opening = ['models/sarah-v2-body.glb', ...recoveredPartsFor(wornGarments(0, all)).map(recoveredPartPath)];
    const before = ['models/sarah-v2-body.glb', ...['bottom', 'leggings', 'relaxed-high', 'leggings-low'].map((p) => recoveredPartPath(p as never))];
    const sum = (paths: string[]) => paths.reduce((s, p) => s + bytesOf(p), 0);
    expect(Number.isFinite(sum(before))).toBe(true);
    expect(sum(before) - sum(opening)).toBe(bytesOf('models/sarah-v2-bottom.glb') + bytesOf('models/sarah-v2-leggings-low.glb'));
  });

  it('opens in the light spandex tee: the slim body and its one small file, under a fifth of what it used to wait for', () => {
    const opening = [SARAH_V2_BODY_MODEL, ...recoveredPartsFor(wornGarments(SARAH_DEFAULT_OUTFIT, all)).map(recoveredPartPath)];
    const before = ['models/sarah-v2-body.glb', ...['bottom', 'leggings', 'relaxed-high', 'leggings-low'].map((p) => recoveredPartPath(p as never))];
    const sum = (paths: string[]) => paths.reduce((s, p) => s + bytesOf(p), 0);
    expect(opening).toEqual(['models/sarah-v2-body-slim.glb', 'models/sarah-v2-spandex-lite.glb']);
    expect(sum(opening)).toBeLessThan(sum(before) / 5);
    // the light tee is a twentieth of the modelled tee it was made from
    expect(bytesOf('models/sarah-v2-spandex-lite.glb')).toBeLessThan(5 * 1024 * 1024);
    // the painted outfit still downloads nothing
    expect(recoveredPartsFor(wornGarments(PAINTED_DEFAULT_OUTFIT, all))).toEqual([]);
  });
});
