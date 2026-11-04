/**
 * Metered loading (src/assets/assets.ts `loadModel` with a meter; Joshua, 2026-10-20: "use the existing loading
 * pipeline instead of downloading the same assets twice"). The bytes are fetched once, counted as they stream, and
 * handed to GLTFLoader's own parse -- a .gltf's external buffers included, which GLTFLoader asks for as it parses.
 * The totals come from the build's size manifest, which counts a .gltf with every buffer it names.
 *
 * (The character room's own opening -- which outfit files it fetched first -- moved with the room to the Character
 * Builder on 2026-11-04, and its tests with it.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { assetBytes, fetchBytes, loadModel } from '../src/assets/assets';
import { LoadMeter } from '../src/assets/loadMeter';
import * as THREE from 'three';

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
    expect(assetBytes('models/jack.glb')).toBe(statSync('public/models/jack.glb').size);
    for (const file of readdirSync('public/models').filter((f) => f.endsWith('.gltf'))) {
      const path = `models/${file}`;
      const json = JSON.parse(readFileSync(`public/${path}`, 'utf8')) as { buffers: { uri?: string }[] };
      const parts = new Set(json.buffers.filter((b) => b.uri).map((b) => `public/models/${b.uri}`));
      expect(assetBytes(path)).toBe(statSync(`public/${path}`).size + [...parts].reduce((sum, p) => sum + statSync(p).size, 0));
    }
    expect(assetBytes('models/no-such-file.glb')).toBeNull();
  });
});
