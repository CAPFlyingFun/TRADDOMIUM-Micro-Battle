/** Downloaded chapter assets stay available for playback without a second transfer. */
const assets = new Map<string, {url: string; bytes: number}>();
export function cachedAsset(path: string) { return assets.get(path); }
export function cacheAsset(path: string, blob: Blob) {
  const previous = assets.get(path);
  if (previous) URL.revokeObjectURL(previous.url);
  assets.set(path, {url: URL.createObjectURL(blob), bytes: blob.size});
}
export function clearAssetCache() {
  for (const asset of assets.values()) URL.revokeObjectURL(asset.url);
  assets.clear();
}