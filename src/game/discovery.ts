/**
 * WHAT SHE HAS ACTUALLY SEEN.
 *
 * Kauaʻi is 56 km across and every metre of it comes out of a
 * heightfield that has been there since before the first frame. A map
 * drawn straight off that would hand the player a finished survey of a
 * place nobody has stood in — the island would be solved before she
 * left the beach. This mask is the memory that makes the map HERS: one
 * byte per 146 m cell, set when the queen comes within 2 km of it, and
 * never cleared. Fog is the default and discovery is the only thing
 * that lifts it.
 *
 * IT IS PURE, deliberately. Nothing here touches a canvas, a DOM node
 * or three.js — it is a grid of bytes and some arithmetic about
 * circles. The minimap and the full map both ask it the same question
 * and draw their own answers, and because the answer is a plain array
 * it can also be saved, tested, and one day merged with what a second
 * player saw.
 *
 * THE ENCODING LIVES HERE rather than in save.ts because it is the
 * mask's own business how it survives a round trip through text.
 * 147,456 cells written as JSON numbers is roughly 300 kB per slot and
 * five slots of that will not fit in a phone's localStorage. Run-length
 * coded and base64url'd, an hour of real exploring is a few hundred
 * characters. It comes back through `decodeDiscovery`, which reads a
 * string somebody could have edited by hand, so that function REFUSES
 * rather than repairs — the same posture save.ts takes, for the same
 * reason: a half-understood mask is worse than a fresh one because it
 * looks like it worked.
 *
 * THE ONE THING TO GET RIGHT. The reveal is a CIRCLE measured in world
 * units, not a square measured in cells. A square is what you get for
 * free from a bounding box, it is 27% larger than the disc it is
 * standing in for, and its corners reach 2.8 km — so the fog would peel
 * back in a diamond as she walked and the map would look like a
 * spreadsheet. The bounding box is here only as a scan limit; the test
 * inside it is `Math.hypot(dx, dz) <= REVEAL_RADIUS`.
 *
 * A cell is judged by its CENTRE, so the edge of the fog is quantised
 * to one 146 m cell: everything within `REVEAL_RADIUS` minus half a
 * cell diagonal is certainly known, nothing beyond `REVEAL_RADIUS` plus
 * that is, and the band between the two depends on where the disc
 * happened to land on the lattice. At two kilometres of reveal and 146
 * metres of cell that is a 5% ragged edge on a shape nobody can measure
 * through fog, and the alternative — revealing every cell the disc so
 * much as grazes — pushes the same error outward instead, which is the
 * worse direction to be wrong in on a discovery map.
 */
import { mapToWorld, worldToMap } from '../ui/islandMap';

/** Cells per side of the discovery mask. 768 / 384 = exactly 2 map px. */
export const DISCOVERY_CELLS = 384;

/** World units revealed around her — 2,000 m at 100 units per metre. */
export const REVEAL_RADIUS = 200_000;

/** One byte per cell, row-major, 0 unseen / 1 seen. */
export interface Discovery {
  readonly cells: Uint8Array;      // length DISCOVERY_CELLS ** 2
  readonly size: number;           // DISCOVERY_CELLS
  /** Bumped whenever a cell flips, so a renderer can skip redrawing. */
  revision: number;
}

/** Cells in a whole mask. Written out often enough to earn a name. */
const TOTAL = DISCOVERY_CELLS * DISCOVERY_CELLS;

/**
 * The longest string any honest mask can produce: the raw fallback,
 * base64url'd, plus room for the header.
 *
 * Checked BEFORE anything is decoded, because the point of the guard is
 * to refuse a megabyte of hostile text without first allocating a
 * megabyte to look at it.
 */
const MAX_TEXT = 32 + Math.ceil((TOTAL * 4) / 3);

/**
 * Column centres for one disc, reused between calls.
 *
 * `mapToWorld` returns a fresh WorldPoint, and calling it once per cell
 * would allocate six hundred objects every time she moves. One grid's
 * width covers every mask this module can build, and it grows rather
 * than overflowing if it is ever handed a wider one.
 */
let columns = new Float64Array(DISCOVERY_CELLS);

export function emptyDiscovery(): Discovery {
  return { cells: new Uint8Array(TOTAL), size: DISCOVERY_CELLS, revision: 0 };
}

/**
 * Reveal everything within REVEAL_RADIUS of a world point. Returns
 * cells newly seen.
 *
 * Scans the disc's bounding box and no more. The whole grid is 147,456
 * cells and the disc is about 590 of them, so walking the grid would be
 * 250 times the work for the same answer, every frame she moves.
 */
export function reveal(into: Discovery, wx: number, wz: number): number {
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) return 0;
  const size = into.size;

  // The transform is monotonic in both axes, so the world-space corners
  // of the box map straight to the cell-space corners.
  const low = worldToMap(wx - REVEAL_RADIUS, wz - REVEAL_RADIUS, size);
  const high = worldToMap(wx + REVEAL_RADIUS, wz + REVEAL_RADIUS, size);
  const x0 = Math.max(0, Math.floor(low.x));
  const x1 = Math.min(size - 1, Math.floor(high.x));
  const y0 = Math.max(0, Math.floor(low.y));
  const y1 = Math.min(size - 1, Math.floor(high.y));
  if (x1 < x0 || y1 < y0) return 0;

  const width = x1 - x0 + 1;
  if (width > columns.length) columns = new Float64Array(width);
  for (let cx = x0; cx <= x1; cx++) {
    columns[cx - x0] = mapToWorld(cx + 0.5, 0.5, size).wx;
  }

  let fresh = 0;
  for (let cy = y0; cy <= y1; cy++) {
    const dz = mapToWorld(0.5, cy + 0.5, size).wz - wz;
    if (Math.abs(dz) > REVEAL_RADIUS) continue;
    const row = cy * size;
    for (let cx = x0; cx <= x1; cx++) {
      if (into.cells[row + cx] !== 0) continue;
      if (Math.hypot(columns[cx - x0] - wx, dz) > REVEAL_RADIUS) continue;
      into.cells[row + cx] = 1;
      fresh++;
    }
  }

  // Once per call, not once per cell: the number is a cache key for a
  // renderer, and a cache key only has to CHANGE.
  if (fresh > 0) into.revision++;
  return fresh;
}

/** Has this world point been discovered? Out of bounds is false. */
export function seen(of: Discovery, wx: number, wz: number): boolean {
  if (!Number.isFinite(wx) || !Number.isFinite(wz)) return false;
  const at = worldToMap(wx, wz, of.size);
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.y);
  if (cx < 0 || cy < 0 || cx >= of.size || cy >= of.size) return false;
  return of.cells[cy * of.size + cx] !== 0;
}

/**
 * How much of the island is known, 0..1 — for the map's legend.
 *
 * Of the MASK, which is the whole square including open ocean, so
 * walking the entire coastline still reads as a small number. Counting
 * land only would mean asking the heightfield 147,456 questions, which
 * is a terrain bake rather than a legend; if the legend ever needs to
 * say "62% of Kauaʻi" it should divide by a land total baked once, not
 * change what this counts.
 */
export function fractionSeen(of: Discovery): number {
  if (of.cells.length === 0) return 0;
  let known = 0;
  for (let i = 0; i < of.cells.length; i++) {
    if (of.cells[i] !== 0) known++;
  }
  return known / of.cells.length;
}

/** `d1:384:<base64url>` — RLE varint runs, unseen first. */
export function encodeDiscovery(of: Discovery): string {
  const runs = runBytes(of.cells);
  // RLE can lose. A mask that alternates every cell costs one byte per
  // cell plus the empty leading unseen run, which is one byte MORE than
  // simply writing the grid out — so there is a raw form, under its own
  // tag, and the reader can tell them apart.
  return runs.length <= of.cells.length
    ? `d1:${of.size}:${toBase64url(runs)}`
    : `d1r:${of.size}:${toBase64url(of.cells)}`;
}

/** Null when malformed or the grid size disagrees. Never throws. */
export function decodeDiscovery(from: string | undefined): Discovery | null {
  if (typeof from !== 'string') return null;
  if (from.length === 0 || from.length > MAX_TEXT) return null;
  const parts = from.split(':');
  if (parts.length !== 3) return null;
  // A mask from a build with a different grid is not this mask at a
  // different resolution — it is another game's memory. Refuse it.
  if (parts[1] !== String(DISCOVERY_CELLS)) return null;
  const bytes = fromBase64url(parts[2]);
  if (bytes === null) return null;
  if (parts[0] === 'd1') return fromRuns(bytes);
  if (parts[0] === 'd1r') return fromRaw(bytes);
  return null;
}

/**
 * Run lengths as LEB128 varints, starting with an UNSEEN run.
 *
 * Starting with unseen rather than with a flag byte means the common
 * case — a fresh mask, or one hole in the fog — is two or three bytes,
 * and a mask that happens to begin at seen cell zero pays exactly one
 * byte for the empty run that says so.
 */
function runBytes(cells: Uint8Array): Uint8Array {
  const out: number[] = [];
  let value = 0;
  let run = 0;
  for (let i = 0; i < cells.length; i++) {
    const here = cells[i] !== 0 ? 1 : 0;
    if (here === value) {
      run++;
      continue;
    }
    putVarint(out, run);
    value = here;
    run = 1;
  }
  putVarint(out, run);
  return Uint8Array.from(out);
}

function putVarint(into: number[], value: number): void {
  let left = value;
  while (left >= 0x80) {
    into.push((left & 0x7f) | 0x80);
    left >>>= 7;
  }
  into.push(left);
}

/**
 * Runs back into a grid, refusing anything that does not fit it exactly.
 *
 * Three ways this is attacked and all three end in null: a varint that
 * never terminates before the bytes do, a run that reaches past the end
 * of the grid, and a stream that stops short — which is what a
 * truncated save looks like, and is the one that would otherwise pass
 * as a half-explored island.
 */
function fromRuns(bytes: Uint8Array): Discovery | null {
  const cells = new Uint8Array(TOTAL);
  let at = 0;
  let value = 0;
  let i = 0;
  while (i < bytes.length) {
    let run = 0;
    let shift = 0;
    for (;;) {
      if (i >= bytes.length) return null;
      const b = bytes[i++];
      run += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      // The longest honest run is the whole grid, 21 bits of it. Past
      // 28 the number stops being exact and starts being a way in.
      if (shift > 28) return null;
    }
    if (run > TOTAL - at) return null;
    if (value === 1) cells.fill(1, at, at + run);
    at += run;
    value = value === 0 ? 1 : 0;
  }
  if (at !== TOTAL) return null;
  return { cells, size: DISCOVERY_CELLS, revision: 1 };
}

function fromRaw(bytes: Uint8Array): Discovery | null {
  if (bytes.length !== TOTAL) return null;
  const cells = new Uint8Array(TOTAL);
  for (let i = 0; i < TOTAL; i++) cells[i] = bytes[i] !== 0 ? 1 : 0;
  return { cells, size: DISCOVERY_CELLS, revision: 1 };
}

/**
 * base64url by hand, rather than through `btoa`.
 *
 * `btoa` wants a latin1 string, which means building a 147,456
 * character one out of `String.fromCharCode` before encoding it, and
 * spreading an array that long into a call blows the stack. Doing it
 * here also means the DECODER decides what a valid character is, so a
 * meddled-with save is refused on our terms and not on whichever
 * characters a given engine's `atob` happens to tolerate.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64_INDEX = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) table[B64.charCodeAt(i)] = i;
  return table;
})();

function toBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const has2 = i + 1 < bytes.length;
    const has3 = i + 2 < bytes.length;
    const b = has2 ? bytes[i + 1] : 0;
    const c = has3 ? bytes[i + 2] : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    if (has2) out += B64[((b & 15) << 2) | (c >> 6)];
    if (has3) out += B64[c & 63];
  }
  return out;
}

/** Unpadded base64url to bytes, or null the moment it is not that. */
function fromBase64url(text: string): Uint8Array | null {
  const n = text.length;
  // A single leftover character cannot be part of any encoding.
  if (n % 4 === 1) return null;
  const bytes = new Uint8Array((n * 3) >> 2);
  let at = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const code = text.charCodeAt(i);
    const v = code < 128 ? B64_INDEX[code] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (acc >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, at);
}
