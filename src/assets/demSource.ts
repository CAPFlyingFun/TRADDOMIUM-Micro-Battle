/**
 * THE SURVEY, FETCHED — the DEM's half of the one loader (ARCHITECTURE
 * §2.5).
 *
 * `assets.ts` loads models and textures through three's loaders; a DEM is
 * neither, so it comes down as bytes here. It still goes through
 * `assetUrl`, because the deployed base path is `/TRADDOMIUM-Micro-Battle/v1/`
 * and a hard-coded `/kauai-1025.bin` is a 404 on the only build Joshua
 * actually plays.
 *
 * WHAT IT COSTS, so nobody has to guess on a phone: the coarse grid is
 * 2,101,250 bytes and every tile is 526,338. The whole high-detail set is
 * 33 MB, which is why tiles stream rather than arriving at boot — see
 * `TerrainStreamer`. This module downloads what it is asked for and
 * decodes nothing it was not.
 *
 * PROGRESS IS REAL BYTES, not a timer. `onBytes` reports what has landed
 * against what `Content-Length` promised, so the loading bar is driven by
 * the download rather than by an animation pretending to be one. When the
 * server sends no length (a gzip stream can be one), the fraction is
 * withheld rather than invented: LoadProgress would rather show nothing
 * than a bar that fills and stalls.
 *
 * A SHORT FILE IS AN ERROR, HERE. The format is headerless, so length is
 * the only integrity check there is, and `dem.ts` throws on a wrong size.
 * Catching it at the fetch means the message names the URL rather than
 * the array.
 */
import { COARSE_BYTES, HD_TILE_BYTES, hdTileName, type HdTileId } from '../world/dem';
import { assetUrl } from './assets';

/** Where the survey lives in `public/`. */
export const COARSE_PATH = 'kauai-1025.bin';
export const HD_DIR = 'kauai-hd';

export const hdTilePath = (id: HdTileId): string => `${HD_DIR}/${hdTileName(id)}.bin`;

/** Attempts after the first, and the wait before each. Matches `assets.ts`. */
const BACKOFF_MS = [500, 1000, 2000] as const;

export interface FetchOptions {
  /** Bytes so far and the total, when the server said one. Called as the body arrives. */
  readonly onBytes?: (received: number, total: number | null) => void;
  readonly retries?: number;
  readonly signal?: AbortSignal;
  /** Injected for tests. Defaults to the global. */
  readonly fetchImpl?: typeof fetch;
}

/** The whole-island grid: 2 MB, always needed, the fallback under everything. */
export function fetchCoarseDem(options: FetchOptions = {}): Promise<ArrayBuffer> {
  return fetchExactly(COARSE_PATH, COARSE_BYTES, options);
}

/** One high-detail tile: 526 KB. */
export function fetchHdTile(id: HdTileId, options: FetchOptions = {}): Promise<ArrayBuffer> {
  return fetchExactly(hdTilePath(id), HD_TILE_BYTES, options);
}

/**
 * Download a file that must be exactly `expectedBytes` long.
 *
 * Retries a network failure; does NOT retry a wrong length, because a
 * server that answered with the wrong file will answer with it again and
 * the second failure only delays the message.
 */
export async function fetchExactly(path: string, expectedBytes: number, options: FetchOptions = {}): Promise<ArrayBuffer> {
  const url = assetUrl(path);
  const doFetch = options.fetchImpl ?? fetch;
  const attempts = 1 + (options.retries ?? BACKOFF_MS.length);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await doFetch(url, { signal: options.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await readBody(response, options.onBytes);
      if (buffer.byteLength !== expectedBytes) {
        // Not retried: the wrong file twice is still the wrong file.
        throw new WrongSizeError(url, expectedBytes, buffer.byteLength);
      }
      return buffer;
    } catch (error) {
      if (error instanceof WrongSizeError) throw error;
      if (options.signal?.aborted) throw error;
      lastError = error;
      if (attempt < attempts - 1) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }
  throw new Error(`dem: ${url} could not be fetched after ${attempts} attempts: ${String(lastError)}`);
}

export class WrongSizeError extends Error {
  constructor(readonly url: string, readonly expected: number, readonly got: number) {
    super(`dem: ${url} should be exactly ${expected} bytes and is ${got}; the format is headerless, so length is the only check there is`);
    this.name = 'WrongSizeError';
  }
}

/**
 * Read the body, reporting bytes as they land when the response can be
 * streamed. A response without a readable body (jsdom, some polyfills)
 * falls back to `arrayBuffer()` and reports once at the end — a correct
 * download with a coarser bar, rather than a failure.
 */
async function readBody(
  response: Response,
  onBytes?: (received: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const header = response.headers?.get?.('content-length');
  const total = header !== null && header !== undefined && header !== '' ? Number(header) : null;
  const knownTotal = total !== null && Number.isFinite(total) && total > 0 ? total : null;

  const body = response.body;
  if (!body || typeof body.getReader !== 'function' || !onBytes) {
    const buffer = await response.arrayBuffer();
    onBytes?.(buffer.byteLength, knownTotal ?? buffer.byteLength);
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    received += value.byteLength;
    onBytes(received, knownTotal);
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out.buffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
