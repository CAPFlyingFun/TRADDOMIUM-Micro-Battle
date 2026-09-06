/**
 * THE LANDCOVER RASTER, FETCHED — the vegetation's half of the one
 * loader (ARCHITECTURE §2.5), shaped exactly like `demSource.ts` and for
 * the same reasons: it goes through `assetUrl` so it resolves under
 * `/TRADDOMIUM-Micro-Battle/v1/`, it streams bytes for the loading bar,
 * and a short file is an error here rather than a silently bare island.
 *
 * WHAT IT COSTS: 442,380 bytes, once, at world load. About sixty
 * kilobytes gzipped over the wire. It is decoded by `world/landcover.ts`,
 * which is core and may not fetch.
 */
import { VEG_BYTES } from '../world/landcover';
import { fetchExactly, type FetchOptions } from './demSource';

/** Where the raster lives in `public/`. Carried from v0 verbatim. */
export const VEG_PATH = 'kauai-veg.bin';

/** The three 384² planes: class, canopy, river corridor. */
export function fetchVeg(options: FetchOptions = {}): Promise<ArrayBuffer> {
  return fetchExactly(VEG_PATH, VEG_BYTES, options);
}
