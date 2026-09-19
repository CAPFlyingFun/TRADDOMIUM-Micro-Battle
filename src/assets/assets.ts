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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

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
}

export interface Assets {
  assetUrl(path: string): string;
  loadModel(
    path: string,
    placeholderFactory: () => THREE.Object3D,
    options?: LoadModelOptions,
  ): Promise<THREE.Object3D>;
  loadTexture(path: string): Promise<THREE.Texture | null>;
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

export async function loadModel(
  path: string,
  placeholderFactory: () => THREE.Object3D,
  options: LoadModelOptions = {},
): Promise<THREE.Object3D> {
  const url = assetUrl(path);
  const attempts = 1 + (options.retries ?? BACKOFF_MS.length);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const gltf = await gltfLoader.loadAsync(url);
      return gltf.scene;
    } catch (error) {
      lastError = error;
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

export const assets: Assets = { assetUrl, loadModel, loadTexture };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
