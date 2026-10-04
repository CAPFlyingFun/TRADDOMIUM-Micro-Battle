/** Local assets stay within the candidate's mount path, including GitHub Pages. */
export function assetUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  return `${import.meta.env?.BASE_URL || './'}${path.slice(1)}`;
}