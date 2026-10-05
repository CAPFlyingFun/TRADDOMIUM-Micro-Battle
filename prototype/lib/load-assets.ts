import {assetUrl} from './asset-url';
import {cacheAsset, cachedAsset} from './asset-cache';

export interface StartupAsset {path: string; bytes: number}
export interface LoadingProgress {loaded: number; total: number}
export function formatLoadingProgress({loaded, total}: LoadingProgress) {
  const safe = Math.min(Math.max(loaded, 0), total);
  const mb = (bytes: number) => (bytes / 1_000_000).toFixed(1);
  return `${mb(safe)}MB/${mb(total)}MB (${(total ? safe / total * 100 : 0).toFixed(1)}%)`;
}

/** Counts response-body bytes, not files, estimates or elapsed time. */
export async function loadAssetBatch(
  assets: StartupAsset[],
  report: (progress: LoadingProgress) => void,
  signal: AbortSignal,
  fetchAsset: typeof fetch = fetch,
) {
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  let loaded = 0, next = 0;
  const batch = new AbortController();
  const cancel = () => batch.abort();
  signal.addEventListener('abort', cancel, {once: true});
  if (signal.aborted) batch.abort();
  const publish = () => report({loaded, total});
  publish();
  async function download(asset: StartupAsset) {
    if (batch.signal.aborted) throw new DOMException('Loading cancelled', 'AbortError');
    const cached = cachedAsset(asset.path);
    if (cached?.bytes === asset.bytes) { loaded += cached.bytes; publish(); return; }
    const request = new AbortController();
    const abort = () => request.abort();
    batch.signal.addEventListener('abort', abort, {once: true});
    const timeout = setTimeout(abort, 30_000);
    try {
      const response = await fetchAsset(assetUrl(asset.path, false), {signal: request.signal});
      if (!response.ok) throw new Error(`${asset.path}: HTTP ${response.status}`);
      const chunks: BlobPart[] = [];
      let bytes = 0;
      const reader = response.body?.getReader();
      if (reader) {
        try {
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            chunks.push(new Uint8Array(value));
            bytes += value.byteLength; loaded += value.byteLength;
            if (bytes > asset.bytes) throw new Error(`Asset size changed: ${asset.path}`);
            publish();
          }
        } finally { reader.releaseLock(); }
      } else {
        const data = await response.arrayBuffer();
        chunks.push(data); bytes = data.byteLength; loaded += bytes; publish();
      }
      if (batch.signal.aborted) throw new DOMException('Loading cancelled', 'AbortError');
      if (bytes !== asset.bytes) throw new Error(`Incomplete asset: ${asset.path}`);
      cacheAsset(asset.path, new Blob(chunks, {type: response.headers.get('Content-Type') || 'application/octet-stream'}));
    } finally {
      clearTimeout(timeout);
      batch.signal.removeEventListener('abort', abort);
    }
  }
  try {
    await Promise.all(Array.from({length: Math.min(4, assets.length)}, async () => {
      while (next < assets.length) await download(assets[next++]);
    }));
  } catch (error) { batch.abort(); throw error; }
  finally { signal.removeEventListener('abort', cancel); }
}