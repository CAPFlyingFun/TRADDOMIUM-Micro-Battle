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

const gltfLoader = new GLTFLoader();
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

/** Prefix a public-folder path with the deployed base (`./` on Pages, `/` in dev). */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\/+/, '')}`;
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
