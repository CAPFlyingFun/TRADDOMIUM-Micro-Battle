/**
 * WHICH SEVEN KILOMETRES OF THE SURVEY ARE IN MEMORY RIGHT NOW.
 *
 * The high-detail set is 64 tiles and 33 MB. Downloading it at boot is
 * not a thing to do to a phone on cell data, and holding it all is 17
 * million samples of resident memory for an ant who can see a few
 * hundred metres. So the coarse grid — 2 MB, the whole island, always
 * resident — is the floor under everything, and the tiles that matter
 * arrive around wherever the camera is.
 *
 * THE POLICY IS DELIBERATELY DULL: fetch the tiles whose rectangles touch
 * a square of `reach` around the camera; drop the ones outside a larger
 * square, so a camera sitting on a tile boundary does not thrash a 526 KB
 * download every time it drifts a metre. Both radii are world distances,
 * not tile counts, because the tile grid is an artefact of how the survey
 * was cut and the camera does not care.
 *
 * WHAT THAT COSTS, counted rather than asserted: WANT_REACH is one tile
 * span, so the wanted square spans three tiles each way and at most NINE
 * tiles are ever asked for. Residency is bounded by KEEP_REACH, not by
 * WANT_REACH, and 1.5 tile spans can touch FOUR tiles each way — so up to
 * SIXTEEN tiles, 8.4 MB, can be resident at once. That is the number to
 * hold in mind for a phone, and it is what `MAX_RESIDENT` says out loud.
 *
 * NOTHING HERE DECIDES WHAT THE GROUND LOOKS LIKE. A tile that has not
 * arrived is not missing ground — the coarse lattice answers there, at 4x
 * coarser detail, and `Heightfield` says which answered. That is what
 * makes streaming safe to get wrong: the failure mode is soft ground, not
 * a hole.
 *
 * A FAILED TILE IS REMEMBERED AS FAILED. Without that, a 404 or a
 * truncated file is retried on every single update for as long as the
 * camera stands near it — a request storm produced by standing still.
 * The coarse grid covers it, and the console says so once.
 */
import { decodeHdTile, hdTileKey, hdTileName, hdTilesNear, type HdTileId } from '../world/dem';
import { repairGrid } from '../world/demRepair';
import { fetchHdTile } from '../assets/demSource';
import type { Heightfield } from '../world/heightfield';
import type { WorldPoint } from '../world/coords';

/**
 * How far around the camera a tile is wanted, in world units. One tile
 * span (7 km), so the square reaches into the neighbours and at most nine
 * tiles — 4.7 MB — are ever resident.
 */
export const WANT_REACH = 700_000;

/**
 * How far out a resident tile is kept. Larger than `WANT_REACH` on
 * purpose: the gap is the hysteresis that stops a camera drifting across
 * a boundary from re-downloading what it just dropped.
 */
export const KEEP_REACH = 1_050_000;

/**
 * The most tiles that can be resident at once, from KEEP_REACH: a square
 * of 1.5 tile spans either side touches 4 tiles on each axis. 16 x
 * 526,338 bytes = 8.4 MB. Pinned by a test so the reaches and this number
 * cannot drift apart.
 */
export const MAX_RESIDENT = 16;

/** Tiles fetched at once. Small: a phone's radio does better with a queue than a stampede. */
export const MAX_IN_FLIGHT = 2;

export interface TerrainStreamerOptions {
  readonly field: Heightfield;
  readonly wantReach?: number;
  readonly keepReach?: number;
  readonly maxInFlight?: number;
  /** Injected for tests, and so a probe can stream from disk. */
  readonly fetchTile?: (id: HdTileId) => Promise<ArrayBuffer>;
  readonly onError?: (name: string, error: unknown) => void;
}

export interface StreamerStatus {
  readonly resident: number;
  readonly inFlight: number;
  readonly wanted: number;
  readonly failed: number;
}

export class TerrainStreamer {
  private readonly field: Heightfield;
  private readonly wantReach: number;
  private readonly keepReach: number;
  private readonly maxInFlight: number;
  private readonly fetchTile: (id: HdTileId) => Promise<ArrayBuffer>;
  private readonly onError?: (name: string, error: unknown) => void;

  private readonly resident = new Set<string>();
  private readonly inFlight = new Set<string>();
  /** Aborts every download still in the air when the world goes away. */
  private readonly aborter = new AbortController();
  private readonly failed = new Set<string>();
  private wanted = 0;
  private disposed = false;

  constructor(options: TerrainStreamerOptions) {
    this.field = options.field;
    this.wantReach = options.wantReach ?? WANT_REACH;
    this.keepReach = options.keepReach ?? KEEP_REACH;
    this.maxInFlight = Math.max(1, options.maxInFlight ?? MAX_IN_FLIGHT);
    this.fetchTile = options.fetchTile ?? ((id) => fetchHdTile(id, { signal: this.aborter.signal }));
    this.onError = options.onError;
  }

  status(): StreamerStatus {
    return {
      resident: this.resident.size,
      inFlight: this.inFlight.size,
      wanted: this.wanted,
      failed: this.failed.size,
    };
  }

  /**
   * Ask for the tiles around a position and let go of the ones far
   * behind. Safe to call every frame: it starts no fetch it has already
   * started, and re-requests nothing it holds.
   */
  update(at: WorldPoint): void {
    if (this.disposed) return;
    const want = hdTilesNear(at, this.wantReach);
    this.wanted = want.length;

    const keep = new Set(hdTilesNear(at, this.keepReach).map(hdTileKey));
    for (const key of [...this.resident]) {
      if (keep.has(key)) continue;
      const id = idOfKey(key);
      if (id) this.field.dropTile(id);
      this.resident.delete(key);
    }
    // A tile that failed far away is worth trying again if we come back.
    for (const key of [...this.failed]) if (!keep.has(key)) this.failed.delete(key);

    for (const id of want) {
      if (this.inFlight.size >= this.maxInFlight) break;
      const key = hdTileKey(id);
      if (this.resident.has(key) || this.inFlight.has(key) || this.failed.has(key)) continue;
      this.begin(id, key);
    }
  }

  /**
   * Stop, and actually stop.
   *
   * Ignoring an in-flight download is not the same as cancelling it: a
   * scene that is torn down mid-stream would otherwise leave up to
   * `maxInFlight` half-megabyte transfers running to completion on a
   * phone's radio, for a world nobody is looking at. The signal is passed
   * to the fetch, so the socket closes with the scene.
   */
  dispose(): void {
    this.disposed = true;
    this.inFlight.clear();
    this.aborter.abort();
  }

  private begin(id: HdTileId, key: string): void {
    this.inFlight.add(key);
    void this.fetchTile(id)
      .then((buffer) => {
        // Dropped, evicted or disposed while it was in the air: the bytes
        // are simply let go rather than added to a field that moved on.
        if (this.disposed || !this.inFlight.has(key)) return;
        this.field.addTile(id, repairGrid(decodeHdTile(buffer)).grid);
        this.resident.add(key);
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        this.failed.add(key);
        const name = hdTileName(id);
        if (this.onError) this.onError(name, error);
        else console.warn(`[terrain] tile ${name} did not load; the coarse lattice covers it`, error);
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
  }
}

/** A residency key back to a tile id. The key IS the name, so this is `hdTileFromName` by another route. */
function idOfKey(key: string): HdTileId | null {
  const col = 'ABCDEFGH'.indexOf(key[0]);
  const row = Number(key[1]) - 1;
  if (col < 0 || !Number.isInteger(row) || row < 0 || row > 7) return null;
  return { col, row };
}
