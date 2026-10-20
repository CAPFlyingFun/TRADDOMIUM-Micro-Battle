/**
 * THE ONLY LOADER IN THE CODEBASE (ARCHITECTURE §2.5).
 *
 * Every model and texture comes through here so that one place knows the
 * deployed base path, one place retries, and one place decides what a
 * missing asset looks like. A scene that constructs its own GLTFLoader
 * has escaped the choke point and will 404 on GitHub Pages the first time
 * the project path differs from `/`.
 *
 * Failure is loud and visible, not silent: after the retries the caller's
 * placeholder is returned tagged `userData.isPlaceholder = true`, and the
 * exact URL that was expected is logged, so a wrong path is a thing you
 * can see in the world and read in the console.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { LoadMeter } from './loadMeter';

const gltfLoader = new GLTFLoader();
// The ant rigs (v0's queen, TCS's worker) are meshopt-compressed and a
// bare GLTFLoader refuses them outright ("setMeshoptDecoder must be
// called before loading compressed files"); the three wild rigs never
// needed it. The decoder ships inside three — no served wasm — and an
// uncompressed file is unaffected by its presence.
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const textureLoader = new THREE.TextureLoader();

/** Backoff between attempts, in ms: 0.5 s, 1 s, 2 s. */
const BACKOFF_MS = [500, 1000, 2000] as const;

export interface LoadModelOptions {
  /** Attempts after the first. Default 3, matching BACKOFF_MS. */
  readonly retries?: number;
  /**
   * Count the bytes into this meter as they arrive, under the model's path (`loadMeter.ts`). The model is then
   * fetched by `fetchBytes` and handed to the same GLTFLoader parse, so measuring it never downloads it twice.
   */
  readonly meter?: LoadMeter;
  /** Called once, when every byte of the model is in and only parsing is left: the moment to start the next download. */
  readonly onDownloaded?: () => void;
  /** Cancels the load: it rejects with an AbortError, and is neither retried nor replaced by the placeholder. */
  readonly signal?: AbortSignal;
}

export interface Assets {
  assetUrl(path: string): string;
  loadModel(
    path: string,
    placeholderFactory: () => THREE.Object3D,
    options?: LoadModelOptions,
  ): Promise<THREE.Object3D>;
  loadTexture(path: string): Promise<THREE.Texture | null>;
  assetBytes(path: string): number | null;
}

/**
 * Prefix a public-folder path with the deployed base (`./` on Pages, `/`
 * in dev) AND STAMP IT WITH THE FILE'S OWN CONTENT REVISION.
 *
 * The revision is the fix for a cache bug that cost a device pass.
 * Vite content-hashes everything it BUNDLES — `index-ByLXqhBP.js` is a
 * name no cache has ever seen — but `public/` is copied verbatim and
 * keeps a stable path, so a phone may go on serving the
 * `models/sarah.glb` it already has. On 2026-09-19 Joshua's device
 * showed the new build stamp and the old badge at the same time, because
 * `__BUILD_COMMIT__` rides in the hashed bundle and the GLB did not.
 * Code and art from different releases, with the version line insisting
 * all was well.
 *
 * `__PUBLIC_REV__` is a per-file content hash built by `vite.config.ts`
 * (see its header for why per-file and not per-commit: the alternative
 * re-downloads 52 MB of island for one changed model). A path with no
 * entry — dev, vitest, a file added after the build — simply gets no
 * query string, so this can never produce a URL that does not resolve.
 *
 * Read defensively, like `ui/buildInfo.ts` reads its stamps: the define
 * does not exist under a bare `tsc` or a runner that does not replace
 * it, and a missing constant must cost a query string, not the asset.
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.replace(/^\/+/, '');
  const url = `${base.endsWith('/') ? base : `${base}/`}${clean}`;
  return `${url}${revisionOf(clean)}`;
}

/** `?r=<hash>` for a known file, '' for anything else. Never throws. */
function revisionOf(path: string): string {
  try {
    const rev = __PUBLIC_REV__[path];
    return typeof rev === 'string' && rev.length > 0 ? `?r=${rev}` : '';
  } catch {
    return '';
  }
}

/**
 * What `path` costs to load, in decoded bytes -- a `.gltf` with every buffer it names -- or null for a file the build
 * did not see (`__PUBLIC_SIZE__`, `vite.config.ts`). Never throws.
 */
export function assetBytes(path: string): number | null {
  try {
    const bytes = __PUBLIC_SIZE__[path.replace(/^\/+/, '')];
    return typeof bytes === 'number' && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function loadModel(
  path: string,
  placeholderFactory: () => THREE.Object3D,
  options: LoadModelOptions = {},
): Promise<THREE.Object3D> {
  const url = assetUrl(path);
  const attempts = 1 + (options.retries ?? BACKOFF_MS.length);
  let lastError: unknown;
  const { meter, signal } = options;
  const clean = path.replace(/^\/+/, '');
  meter?.expect(clean, assetBytes(clean));
  let told = false;
  const downloaded = () => { if (!told) { told = true; meter?.downloaded(clean); options.onDownloaded?.(); } };
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (signal?.aborted) throw abortError();
      const gltf = meter || signal || options.onDownloaded ? await loadMetered(clean, url, meter, signal, downloaded) : await gltfLoader.loadAsync(url);
      downloaded();
      return gltf.scene;
    } catch (error) {
      if (signal?.aborted || (error as Error)?.name === 'AbortError') { meter?.drop(clean); throw error; }
      lastError = error;
      meter?.restart(clean);
      if (attempt < attempts - 1) {
        await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      }
    }
  }
  console.error(`[assets] model not loaded after ${attempts} attempts; expected it at ${url}`, lastError);
  const placeholder = placeholderFactory();
  placeholder.userData.isPlaceholder = true;
  placeholder.userData.expectedUrl = url;
  return placeholder;
}

export async function loadTexture(path: string): Promise<THREE.Texture | null> {
  const url = assetUrl(path);
  try {
    return await textureLoader.loadAsync(url);
  } catch (error) {
    console.error(`[assets] texture not loaded; expected it at ${url}`, error);
    return null;
  }
}

export const assets: Assets = { assetUrl, loadModel, loadTexture, assetBytes };

/**
 * The model fetched by us and parsed by GLTFLoader, so every byte is counted once, as it arrives. A `.glb` is one
 * fetch; a `.gltf` is its JSON and then each external buffer it names, which GLTFLoader asks for as it parses --
 * those requests come here too (`parser.loadBuffer`, replaced for this one parse) at the same URL GLTFLoader would
 * have used, so the browser's cache serves them exactly as before. Images embedded in buffer views come with them;
 * an external image would still go to GLTFLoader's own loader (none of the meter's models has one).
 */
async function loadMetered(path: string, url: string, meter: LoadMeter | undefined, signal: AbortSignal | undefined, downloaded: () => void): Promise<GLTF> {
  const resourcePath = THREE.LoaderUtils.extractUrlBase(url);
  const isGlb = /\.glb$/i.test(path);
  const ownBytes = isGlb ? assetBytes(path) : null;
  // every byte of the model is in once the count reaches what the build says it costs (a gltf asks for its buffers
  // as it parses, so no single request knows when the last one has landed); the parse's end says so at the latest
  const total = assetBytes(path);
  let got = 0;
  const count = (n: number, source: string) => { meter?.progress(path, n, source); got += n; if (total !== null && got >= total) downloaded(); };
  const main = await fetchBytes(url, ownBytes, (n) => count(n, url), signal);
  if (main.cached) meter?.cached(path, url);
  if (isGlb) downloaded();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  loader.register((parser) => {
    const original = parser.loadBuffer.bind(parser);
    parser.loadBuffer = (index: number) => {
      const def = parser.json.buffers?.[index] as { uri?: string } | undefined;
      if (!def?.uri || def.uri.startsWith('data:')) return original(index);
      const bufferUrl = THREE.LoaderUtils.resolveURL(def.uri, resourcePath);
      const own = assetBytes(`${dir}${decodeURIComponent(def.uri)}`);
      return fetchBytes(bufferUrl, own, (n) => count(n, bufferUrl), signal).then((fetched) => {
        if (fetched.cached) meter?.cached(path, bufferUrl);
        return fetched.buffer;
      });
    };
    return { name: 'TRADDOMIUM_metered_buffers' };
  });
  return loader.parseAsync(main.buffer, resourcePath);
}

/**
 * One response, streamed into ONE buffer sized from what the build says the file weighs, so a 66 MB shirt never sits
 * in memory as a list of chunks AND a copy of them -- the thing a phone runs out of first. `onBytes` hears each chunk.
 * `cached` is the browser's own word (Resource Timing: nothing crossed the network) where it gives one.
 */
export async function fetchBytes(url: string, expected: number | null, onBytes: (bytes: number) => void, signal?: AbortSignal): Promise<{ buffer: ArrayBuffer; cached: boolean }> {
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const reader = response.body?.getReader();
  let buffer: ArrayBuffer;
  if (!reader) {
    buffer = await response.arrayBuffer();
    onBytes(buffer.byteLength);
  } else {
    const header = Number(response.headers.get('content-length'));
    // a compressed response's length is the compressed size, not what the stream will hand over
    const sized = expected ?? (!response.headers.get('content-encoding') && header > 0 ? header : 0);
    let out = new Uint8Array(sized > 0 ? sized : 1 << 20), at = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (at + value.byteLength > out.byteLength) {
        const grown = new Uint8Array(Math.max(out.byteLength * 2, at + value.byteLength));
        grown.set(out.subarray(0, at));
        out = grown;
      }
      out.set(value, at);
      at += value.byteLength;
      onBytes(value.byteLength);
    }
    buffer = at === out.byteLength ? out.buffer : out.buffer.slice(0, at);
  }
  return { buffer, cached: servedFromCache(response.url || url) };
}

function servedFromCache(url: string): boolean {
  try {
    const absolute = new URL(url, globalThis.location?.href).href;
    const entries = performance.getEntriesByName(absolute) as PerformanceResourceTiming[];
    const last = entries[entries.length - 1];
    // nothing crossed the network (0), or only headers did (a 304 revalidation: GitHub Pages' cache lasts ten minutes,
    // then asks again) -- either way the body came off this device
    return !!last && last.decodedBodySize > 0 && last.transferSize < last.encodedBodySize;
  } catch {
    return false;
  }
}

function abortError(): Error {
  const error = new Error('The load was cancelled');
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
