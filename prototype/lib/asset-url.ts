import {cachedAsset} from './asset-cache';
/** Local assets stay within the candidate's mount path, including GitHub Pages. */
export function assetUrl(path: string, useCached = true): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  const cached = useCached ? cachedAsset(path) : undefined;
  if (cached) return cached.url;
  return `${import.meta.env?.BASE_URL || './'}${path.slice(1)}`;
}