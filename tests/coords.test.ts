/**
 * The macro world is authoritative; the floating origin is a transform.
 *
 * These hold the property everything persistent will depend on: what
 * lives at a world position, and which chunk owns it, must not depend
 * on where the renderer happens to have put its origin. Nests, players,
 * creatures, food, death markers and saved objects are all addressed
 * this way, so if this drifts they drift with it — and silently, only
 * showing up after a reload or when two machines compare notes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  chunkAt, chunkKey, chunkOrigin, CHUNK_SPAN, local, sameChunk, world,
} from '../src/world/coords';
import { originAt, rebaseFor, setOrigin, toLocal, toWorld } from '../src/world/origin';
import { groundHeight, ISLAND_SPAN, terrainHeight, useGrid } from '../src/world/heightfield';
import { decodeGrid, type HeightGrid } from '../src/world/kauai';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
let grid: HeightGrid;

beforeEach(() => {
  if (!grid) {
    const file = readFileSync(ASSET);
    grid = decodeGrid(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
    );
  }
  useGrid(grid);
  setOrigin(0, 0);
});

/** A scatter of real places across the island. */
const SOMEWHERE = [
  world(0, 0),
  world(831_250, -1_968_750),
  world(-2_100_000, 640_500),
  world(ISLAND_SPAN / 2 - 7, -ISLAND_SPAN / 2 + 3),
  world(-511.5, 512.5),
];

describe('the ground does not move when the renderer does', () => {
  it('gives the same height at a world point from any origin', () => {
    for (const at of SOMEWHERE) {
      setOrigin(0, 0);
      const from = { terrain: terrainHeight(at.wx, at.wz), ground: groundHeight(at.wx, at.wz) };
      for (const seat of [world(1e6, -2e6), world(-2.5e6, 2.5e6), at]) {
        setOrigin(seat.wx, seat.wz);
        expect(terrainHeight(at.wx, at.wz)).toBe(from.terrain);
        expect(groundHeight(at.wx, at.wz)).toBe(from.ground);
      }
    }
  });

  it('puts a world point in the same chunk from any origin', () => {
    for (const at of SOMEWHERE) {
      setOrigin(0, 0);
      const owner = chunkAt(at);
      for (const seat of [world(1e6, -2e6), world(-2.5e6, 2.5e6)]) {
        setOrigin(seat.wx, seat.wz);
        expect(sameChunk(chunkAt(at), owner), chunkKey(owner)).toBe(true);
      }
    }
  });

  it('survives a walk that rebases repeatedly', () => {
    // The realistic version: she walks, the origin jumps under her
    // several times, and the ground she is standing on must not change.
    const at = world(831_250, -1_968_750);
    setOrigin(at.wx, at.wz);
    const was = groundHeight(at.wx, at.wz);
    const owner = chunkKey(chunkAt(at));
    for (let step = 0; step < 40; step++) {
      rebaseFor(at.wx + step * 900, at.wz + step * 700);
      expect(groundHeight(at.wx, at.wz)).toBe(was);
      expect(chunkKey(chunkAt(at))).toBe(owner);
    }
  });
});

describe('chunk addressing', () => {
  it('is derived from world position and nothing else', () => {
    expect(chunkAt(world(0, 0))).toEqual({ cx: 0, cz: 0 });
    expect(chunkAt(world(CHUNK_SPAN - 1, 0)).cx).toBe(0);
    expect(chunkAt(world(CHUNK_SPAN, 0)).cx).toBe(1);
    // Negative coordinates floor DOWNWARD, or two chunks share an id
    // either side of the origin and the island folds in half.
    expect(chunkAt(world(-1, 0)).cx).toBe(-1);
    expect(chunkAt(world(-CHUNK_SPAN, 0)).cx).toBe(-1);
    expect(chunkAt(world(-CHUNK_SPAN - 1, 0)).cx).toBe(-2);
  });

  it('round-trips a chunk to its corner and back', () => {
    for (const at of SOMEWHERE) {
      const id = chunkAt(at);
      expect(sameChunk(chunkAt(chunkOrigin(id)), id)).toBe(true);
    }
  });

  it('gives every chunk a distinct address', () => {
    const seen = new Set<string>();
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) seen.add(chunkKey({ cx, cz }));
    }
    expect(seen.size).toBe(49);
  });
});

describe('world and local are not interchangeable', () => {
  it('round-trips through the origin without loss', () => {
    setOrigin(831_488, -1_969_152);
    for (const at of SOMEWHERE) {
      const back = toWorld(toLocal(at));
      expect(back.wx).toBeCloseTo(at.wx, 6);
      expect(back.wz).toBeCloseTo(at.wz, 6);
    }
  });

  it('means something different at a different origin', () => {
    // The reason a LocalPoint must never be stored: the same rendered
    // position is a different PLACE once the origin moves, and nothing
    // about the value itself says so.
    const seat = local(100, 100);
    setOrigin(0, 0);
    const before = originAt();
    const first = toWorld(seat);
    setOrigin(1_000_000, 1_000_000);
    const after = originAt();
    const second = toWorld(seat);
    expect(second.wx).not.toBe(first.wx);
    // Measured against where the origin ACTUALLY sits, not where it was
    // asked to sit: it snaps to a lattice, so 1,000,000 seats at
    // 1,000,448. Asserting the asked-for number tests my arithmetic
    // rather than the transform.
    expect(second.wx - first.wx).toBeCloseTo(after.x - before.x, 6);
  });

  it('keeps rendered numbers small enough for float32 everywhere', () => {
    // What the transform is FOR. Walk the island, rebasing as she goes,
    // and nothing handed to the GPU may grow large enough to quantise.
    setOrigin(-ISLAND_SPAN / 2, 0);
    let worst = 0;
    for (let wx = -ISLAND_SPAN / 2; wx <= ISLAND_SPAN / 2; wx += 1500) {
      rebaseFor(wx, 0);
      worst = Math.max(worst, Math.abs(toLocal(world(wx, 0)).lx));
    }
    expect(worst).toBeLessThan(6000);
    // At that range a float32 still resolves far less than a millimetre.
    expect(Math.fround(worst + 0.002)).not.toBe(Math.fround(worst));
  });
});
