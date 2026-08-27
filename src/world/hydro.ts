/**
 * THE REAL RIVERS AND LAKES OF KAUAʻI.
 *
 * Not derived, not guessed, not simulated: USGS NHDPlus HR, the surveyed
 * hydrography of the actual island, baked to TMB units by
 * `scripts/bakeHydro.py`. 1,121 runs, 264 of them with names people use
 * — Hanalei River, Anahola Stream, Wailua — Strahler order 1 to 5, 140
 * reaching the sea, and 111 lakes as rings at a measured waterline.
 *
 * WHAT THIS REPLACES. The island used to work out its own waterways:
 * sample the drawn ground, fill its pits, route steepest descent,
 * accumulate rainfall, trace the channels that came out. Sound
 * mathematics, and it was solving the wrong island — a 54.7 m grid
 * blurred with a 100 m kernel, whose valleys are not where Kauaʻi's
 * are. Measured against this file, that blur alone puts the ground
 * 13.28 m out and leaves only 21% of river points within 5 m of their
 * own terrain, against 88% unblurred.
 *
 * So there is nothing left to derive, and — more to the point — nothing
 * left to DISAGREE. A derived network drifts every time the terrain
 * dial moves. A surveyed one does not: the river is where the river is,
 * and if the ground stops matching it, the ground is what is wrong.
 *
 * The topology comes free and is worth as much as the geometry. Every
 * run carries its Strahler order and whether it reaches the ocean, so
 * "this water connects to that water" is a fact in the file rather than
 * something a renderer has to be trusted not to break.
 */
import { pullBuffer } from './fetchBytes';
import { UNITS_PER_METRE } from './kauai';

/** One surveyed run of water, from a source or junction to the next. */
export interface River {
  /** Its name where it has one — 264 of them do. */
  readonly name: string | null;
  /** Strahler order: 1 is a headwater trickle, 5 the Wailua. */
  readonly order: number;
  /** Whether this run ends in the sea rather than in another run. */
  readonly toOcean: boolean;
  /** BE's own 8×8 terrain split, col * 8 + row, or 255 if unplaced. */
  readonly tile: number;
  /** First point index, and how many, into the shared arrays. */
  readonly first: number;
  readonly count: number;
}

/** Standing water: a shoreline ring, any islands in it, and a level. */
export interface Lake {
  readonly name: string | null;
  /** The surveyed waterline, in raw units at relief 1. */
  readonly level: number;
  readonly tile: number;
  /** First ring index; ring 0 is the shore, the rest are holes. */
  readonly firstRing: number;
  readonly ringCount: number;
}

export interface Hydro {
  readonly rivers: readonly River[];
  readonly lakes: readonly Lake[];
  /** Per point, parallel arrays. Units, relief 1. */
  readonly x: Int32Array;
  readonly z: Int32Array;
  /** The water surface at this point — already monotonic downstream. */
  readonly level: Int32Array;
  /** Surveyed channel width, units. Median about 3.6 m. */
  readonly width: Uint16Array;
  /** Ring table: where each ring's vertices start, and how many. */
  readonly ringFirst: Uint32Array;
  readonly ringCount: Uint32Array;
  /** Ring vertices, units. */
  readonly vertX: Int32Array;
  readonly vertZ: Int32Array;
}

const MAGIC = 0x484d4254;      // 'TMBH'
const VERSION = 1;
const HEADER = 32;

/**
 * The bake writes 0xFF for a run it could not place on a tile. Kept as a
 * named constant because 255 is also a perfectly good tile index in a
 * world with more than 64 of them, and a future reader should not have
 * to guess which this is.
 */
export const NO_TILE = 255;

export function decodeHydro(buffer: ArrayBuffer): Hydro {
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== MAGIC) throw new Error('not a TMBH file');
  const version = head.getUint16(4, true);
  if (version !== VERSION) throw new Error(`TMBH version ${version}, expected ${VERSION}`);
  const riverCount = head.getUint32(8, true);
  const pointCount = head.getUint32(12, true);
  const lakeCount = head.getUint32(16, true);
  const ringTotal = head.getUint32(20, true);
  const vertTotal = head.getUint32(24, true);
  const nameBytes = head.getUint32(28, true);

  let at = HEADER;
  // NAMES FIRST, because everything else refers to them by ordinal and a
  // half-built table is the kind of bug that shows up as a river called
  // "undefined" three weeks later.
  const nameAt = at + riverCount * 16 + pointCount * 16
    + lakeCount * 16 + ringTotal * 8 + vertTotal * 8;
  const expected = nameAt + nameBytes;
  if (buffer.byteLength !== expected) {
    throw new Error(`TMBH is ${buffer.byteLength} bytes, expected ${expected}`);
  }
  const names: string[] = nameBytes > 0
    ? new TextDecoder().decode(new Uint8Array(buffer, nameAt, nameBytes))
      .split('\0').slice(0, -1)
    : [];
  const named = (id: number) => (id < 0 ? null : names[id] ?? null);

  const rivers: River[] = [];
  for (let i = 0; i < riverCount; i++, at += 16) {
    rivers.push({
      first: head.getUint32(at, true),
      count: head.getUint32(at + 4, true),
      order: head.getUint8(at + 8),
      toOcean: head.getUint8(at + 9) === 1,
      tile: head.getUint8(at + 10),
      name: named(head.getInt16(at + 12, true)),
    });
  }

  const x = new Int32Array(pointCount);
  const z = new Int32Array(pointCount);
  const level = new Int32Array(pointCount);
  const width = new Uint16Array(pointCount);
  for (let i = 0; i < pointCount; i++, at += 16) {
    x[i] = head.getInt32(at, true);
    z[i] = head.getInt32(at + 4, true);
    level[i] = head.getInt32(at + 8, true);
    width[i] = head.getUint16(at + 12, true);
  }

  const lakes: Lake[] = [];
  for (let i = 0; i < lakeCount; i++, at += 16) {
    lakes.push({
      firstRing: head.getUint32(at, true),
      ringCount: head.getUint32(at + 4, true),
      level: head.getInt32(at + 8, true),
      tile: head.getUint8(at + 12),
      name: named(head.getInt16(at + 14, true)),
    });
  }

  const ringFirst = new Uint32Array(ringTotal);
  const ringCount = new Uint32Array(ringTotal);
  for (let i = 0; i < ringTotal; i++, at += 8) {
    ringFirst[i] = head.getUint32(at, true);
    ringCount[i] = head.getUint32(at + 4, true);
  }

  const vertX = new Int32Array(vertTotal);
  const vertZ = new Int32Array(vertTotal);
  for (let i = 0; i < vertTotal; i++, at += 8) {
    vertX[i] = head.getInt32(at, true);
    vertZ[i] = head.getInt32(at + 4, true);
  }

  return { rivers, lakes, x, z, level, width, ringFirst, ringCount, vertX, vertZ };
}

/** Metres of real Kauaʻi, for anything that wants to talk in them. */
export function metres(units: number): number {
  return units / UNITS_PER_METRE;
}

/** The hydrography's own asset, and what the loading bar declares. */
export const HYDRO_FILE = 'kauai-hydro.bin';

let loaded: Hydro | null = null;
/** Runs and lakes grouped by BE's 8×8 tile, so a scene can stream them. */
let byTile: Map<number, { rivers: River[]; lakes: Lake[] }> | null = null;

/** Hand the module the decoded hydrography. */
export function useHydro(data: Hydro): void {
  loaded = data;
  byTile = new Map();
  const bucket = (tile: number) => {
    let t = byTile!.get(tile);
    if (!t) { t = { rivers: [], lakes: [] }; byTile!.set(tile, t); }
    return t;
  };
  // A run the bake could not place still has to be DRAWN, or a stretch
  // of river silently goes missing and nothing in the scene can tell
  // you which. Unplaced work is filed under the tile its first point
  // falls in rather than dropped.
  for (const r of data.rivers) bucket(r.tile === NO_TILE ? tileOf(data.x[r.first], data.z[r.first]) : r.tile).rivers.push(r);
  for (const l of data.lakes) {
    const v = data.ringFirst[l.firstRing];
    bucket(l.tile === NO_TILE ? tileOf(data.vertX[v], data.vertZ[v]) : l.tile).lakes.push(l);
  }
}

/** Which of the 64 tiles a world point falls in. */
function tileOf(x: number, z: number): number {
  const half = 2_800_000;
  const col = Math.min(7, Math.max(0, Math.floor(((x + half) / (half * 2)) * 8)));
  const row = Math.min(7, Math.max(0, Math.floor(((z + half) / (half * 2)) * 8)));
  return col * 8 + row;
}

/** The loaded hydrography, or null before useHydro. */
export function hydro(): Hydro | null {
  return loaded;
}

/** Everything to draw for one tile. */
export function hydroTile(tile: number): { rivers: River[]; lakes: Lake[] } | null {
  return byTile?.get(tile) ?? null;
}

/** Forget it all — for tests and for leaving the island. */
export function forgetHydro(): void {
  loaded = null;
  byTile = null;
}

/** Fetch and decode the hydrography. */
export async function loadHydro(
  onProgress?: (done: number, total: number) => void,
  url = HYDRO_FILE,
): Promise<Hydro> {
  const buffer = await pullBuffer(url, () => {}, (done) => onProgress?.(done, 0));
  return decodeHydro(buffer);
}
