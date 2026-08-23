/**
 * KAUAʻI'S RIVERS AND LAKES, as the island actually has them.
 *
 * 1,121 river polylines and 111 lakes from USGS NHDPlus HR, by way of
 * Beyond Extinction's `hydro.json` and `scripts/bakeHydro.py`. Real
 * courses, real drainage-derived widths, real lake waterlines — nothing
 * here is invented, and the bake proves it: every one of the 49,665
 * centreline points lands on land, and its elevation correlates with
 * TMB's own height grid at 0.9990.
 *
 * GLOBAL COORDINATES, ALWAYS. Everything in this file is in the
 * island's real million-unit frame, in float64, exactly like the
 * heightfield it has to agree with. Nothing here goes near the GPU:
 * whoever draws a river runs it through `toLocal` first. A river ribbon
 * is long, thin and aligned to nothing, which is precisely the shape
 * that shows float32 quantisation as a visible kink — see origin.ts for
 * the version of this lesson that cost us the ground texture.
 *
 * ONE UNIT IS A CENTIMETRE here as everywhere else, so a median Kauaʻi
 * stream 5.5 metres across is 550 of them.
 *
 * THE POINTS ARE PARALLEL ARRAYS rather than objects. 49,665 points as
 * `{x, y, z, w}` records is 49,665 allocations and a pointer chase per
 * sample; as four typed arrays it is four views over the downloaded
 * buffer, built without copying or parsing anything. That matters
 * because the eventual carve asks this question from inside
 * `terrainHeight`, which is the hottest path in the world.
 */

import { pullBuffer } from './fetchBytes';
import { SPAN } from './kauai';

/** `TMBH`, little-endian, as the bake writes it. */
const MAGIC = 0x48424d54;
const VERSION = 1;
const HEADER = 32;

/** One river reach: a slice of the shared point arrays. */
export interface River {
  /** As USGS names it, or null. Most reaches are unnamed tributaries. */
  readonly name: string | null;
  /** Strahler stream order, 1 (headwater) to 5 (the Wailua). */
  readonly order: number;
  /** Whether this reach runs to the sea rather than into another. */
  readonly toOcean: boolean;
  /** First index into `x`/`z`/`y`/`width`. */
  readonly first: number;
  readonly count: number;
}

/** A closed ring of shoreline: a slice of the shared ring arrays. */
export interface Ring {
  readonly first: number;
  readonly count: number;
}

export interface Lake {
  readonly name: string | null;
  /** The baked waterline, in world units above the sea. */
  readonly level: number;
  /** Ring 0 is the outer shore; any others are islands in the lake. */
  readonly rings: readonly Ring[];
}

export interface Hydro {
  readonly rivers: readonly River[];
  readonly lakes: readonly Lake[];
  /** Centreline positions, world units. Shared by every river. */
  readonly x: Int32Array;
  readonly z: Int32Array;
  /** The water's own elevation at each point, world units. */
  readonly y: Int32Array;
  /** Full channel width there, world units. 250 to 3,620. */
  readonly width: Uint16Array;
  /** Lake shoreline positions, world units. Shared by every ring. */
  readonly ringX: Int32Array;
  readonly ringZ: Int32Array;
}

/**
 * How big the file is, worked out from its own header.
 *
 * The decoder computes every section's offset from the counts rather
 * than reading a table of offsets, so this doubles as the check that it
 * and the bake still agree about the layout: if they have drifted, the
 * total will not match the bytes that arrived, and it says so instead
 * of quietly reading a lake as a river.
 */
function measure(counts: {
  rivers: number; points: number; lakes: number;
  rings: number; ringPoints: number; names: number;
}): { at: Record<string, number>; total: number } {
  const round4 = (n: number) => n + ((4 - (n % 4)) % 4);
  let at = HEADER;
  const mark: Record<string, number> = {};
  const take = (key: string, bytes: number, align = false) => {
    mark[key] = at;
    at += bytes;
    if (align) at = round4(at);
  };
  take('rivers', counts.rivers * 16);
  take('lakes', counts.lakes * 20);
  take('rings', counts.rings * 8);
  take('x', counts.points * 4);
  take('z', counts.points * 4);
  take('y', counts.points * 4);
  take('width', counts.points * 2, true);
  take('ringX', counts.ringPoints * 4);
  take('ringZ', counts.ringPoints * 4);
  take('names', counts.names, true);
  return { at: mark, total: at };
}

/** Unpack the baked hydrography. Throws rather than half-reading it. */
export function decodeHydro(buffer: ArrayBuffer): Hydro {
  if (buffer.byteLength < HEADER) {
    throw new Error(`kauai-hydro.bin is ${buffer.byteLength} bytes, not a file`);
  }
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== MAGIC) {
    throw new Error('kauai-hydro.bin does not start with TMBH');
  }
  const version = head.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`kauai-hydro.bin is version ${version}, expected ${VERSION}`);
  }
  const counts = {
    rivers: head.getUint32(8, true),
    points: head.getUint32(12, true),
    lakes: head.getUint32(16, true),
    rings: head.getUint32(20, true),
    ringPoints: head.getUint32(24, true),
    names: head.getUint32(28, true),
  };
  const { at, total } = measure(counts);
  if (total !== buffer.byteLength) {
    throw new Error(
      `kauai-hydro.bin says it holds ${total} bytes and is ${buffer.byteLength}`,
    );
  }

  // ONE DECODER, TWO SHAPES. The small tables are records, because
  // there are a thousand of them and they are read once; the point
  // arrays are typed views over the buffer itself, because there are
  // fifty thousand and they are read forever.
  const text = new TextDecoder();
  const blob = new Uint8Array(buffer, at.names, counts.names);
  const nameAt = (from: number, length: number): string | null =>
    length === 0 ? null : text.decode(blob.subarray(from, from + length));

  const rivers: River[] = [];
  for (let i = 0; i < counts.rivers; i++) {
    const row = at.rivers + i * 16;
    rivers.push({
      first: head.getUint32(row, true),
      count: head.getUint32(row + 4, true),
      name: nameAt(head.getUint32(row + 8, true), head.getUint16(row + 12, true)),
      order: head.getUint8(row + 14),
      toOcean: head.getUint8(row + 15) === 1,
    });
  }

  const lakes: Lake[] = [];
  for (let i = 0; i < counts.lakes; i++) {
    const row = at.lakes + i * 20;
    const from = head.getUint32(row + 4, true);
    const howMany = head.getUint32(row + 8, true);
    const rings: Ring[] = [];
    for (let r = 0; r < howMany; r++) {
      const ring = at.rings + (from + r) * 8;
      rings.push({
        first: head.getUint32(ring, true),
        count: head.getUint32(ring + 4, true),
      });
    }
    lakes.push({
      level: head.getInt32(row, true),
      rings,
      name: nameAt(head.getUint32(row + 12, true), head.getUint16(row + 16, true)),
    });
  }

  return {
    rivers,
    lakes,
    x: new Int32Array(buffer, at.x, counts.points),
    z: new Int32Array(buffer, at.z, counts.points),
    y: new Int32Array(buffer, at.y, counts.points),
    width: new Uint16Array(buffer, at.width, counts.points),
    ringX: new Int32Array(buffer, at.ringX, counts.ringPoints),
    ringZ: new Int32Array(buffer, at.ringZ, counts.ringPoints),
  };
}

/**
 * A sanity pass the bake already runs, run again on what actually
 * arrived.
 *
 * The bake checks the island it built from; this checks the island the
 * player downloaded. They are the same check because they are meant to
 * be: a truncated or stale file is the failure mode that otherwise
 * shows up as a river through the middle of the sea.
 */
export function hydroFaults(hydro: Hydro): string[] {
  const wrong: string[] = [];
  const half = SPAN / 2;
  const points = hydro.x.length;
  if (hydro.z.length !== points || hydro.y.length !== points
    || hydro.width.length !== points) {
    wrong.push('the point arrays are different lengths');
  }
  for (const river of hydro.rivers) {
    if (river.count < 2) wrong.push('a river with fewer than two points');
    if (river.first + river.count > points) wrong.push('a river runs off the end');
    if (river.order < 1 || river.order > 5) wrong.push(`stream order ${river.order}`);
    if (wrong.length) break;
  }
  for (const lake of hydro.lakes) {
    if (!lake.rings.length) { wrong.push('a lake with no shore'); break; }
    if (lake.rings[0].count < 3) { wrong.push('a lake shore that is not a ring'); break; }
  }
  let off = 0;
  for (let i = 0; i < points; i++) {
    if (Math.abs(hydro.x[i]) > half || Math.abs(hydro.z[i]) > half) off++;
  }
  if (off) wrong.push(`${off} river points lie outside the island`);
  return wrong;
}

/**
 * WHAT THE BAKE WROTE, so the loading bar has an honest maximum.
 *
 * Not read from `Content-Length`, for the reason `loadGrid` documents at
 * length: that header counts what came down the WIRE, and a page host
 * gzips a file of integers to well under two thirds — this one to
 * 0.45 MB of 0.74 — so a bar built on it is handed more bytes than its
 * own total and counts straight past 100%.
 *
 * A hand-kept constant would rot the first time the hydrography was
 * re-baked, so it does not get to: `scripts/bakeHydro.py` reads this
 * line and refuses to write a file whose size disagrees with it. The
 * number is checked by the thing that decides it.
 */
export const HYDRO_BYTES = 740_016;

export async function loadHydro(
  onProgress?: (done: number, total: number) => void,
): Promise<Hydro> {
  const url = `${import.meta.env.BASE_URL}kauai-hydro.bin`;
  onProgress?.(0, HYDRO_BYTES);
  const buffer = await pullBuffer(
    url,
    () => {},
    (done) => onProgress?.(Math.min(done, HYDRO_BYTES), HYDRO_BYTES),
  );
  const hydro = decodeHydro(buffer);
  const wrong = hydroFaults(hydro);
  if (wrong.length) throw new Error(`kauai-hydro.bin: ${wrong.join('; ')}`);
  return hydro;
}
