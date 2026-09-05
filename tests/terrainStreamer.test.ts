/**
 * RESIDENCY, AND THE THREE WAYS IT TURNS INTO A REQUEST STORM.
 *
 * The whole high-detail set is 33 MB in 64 files. What keeps that
 * affordable is a policy that asks for about nine tiles and then STOPS
 * asking — and every bug in that policy looks the same from the outside:
 * a phone downloading half a megabyte over and over while standing still.
 * So the tests are mostly about what it does NOT do.
 *
 *  1. It never re-requests a tile it already holds, however many frames
 *     go by.
 *  2. It never re-requests a tile that FAILED while the camera is still
 *     near it. A 404 retried every frame is a request storm produced by
 *     standing still.
 *  3. It never runs more than `maxInFlight` fetches at once.
 *
 * And the one that matters for how the ground looks: dropping a tile is
 * not losing ground. The coarse lattice answers underneath, always.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  COARSE_SAMPLES, HD_TILE_BYTES, HD_TILE_SAMPLES, HD_TILE_SPAN, hdTileName, hdTilesNear,
  type DemGrid, type HdTileId,
} from '../src/world/dem';

const HD_TILE_SAMPLE_COUNT = HD_TILE_SAMPLES * HD_TILE_SAMPLES;
import { Heightfield } from '../src/world/heightfield';
import { KEEP_REACH, MAX_RESIDENT, TerrainStreamer, WANT_REACH } from '../src/terrain/TerrainStreamer';
import { ISLAND_SPAN, world } from '../src/world/coords';

const flat = (side: number, decimetres: number): DemGrid => {
  const samples = new Int16Array(side * side);
  samples.fill(decimetres);
  return { side, samples };
};

/** Bytes a real tile decode will accept: the right length, all zeroes. */
const tileBytes = (): ArrayBuffer => new ArrayBuffer(HD_TILE_BYTES);

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function lab(over: Partial<{ maxInFlight: number; wantReach: number; keepReach: number }> = {}) {
  const field = new Heightfield(flat(COARSE_SAMPLES, -500));
  const asked: string[] = [];
  let resolveAll: (() => void)[] = [];
  const fetchTile = vi.fn((id: HdTileId) => {
    asked.push(hdTileName(id));
    return new Promise<ArrayBuffer>((resolve) => {
      resolveAll.push(() => resolve(tileBytes()));
    });
  });
  const streamer = new TerrainStreamer({ field, fetchTile, onError: () => {}, ...over });
  return {
    field,
    streamer,
    asked,
    fetchTile,
    /** Let every outstanding fetch land. */
    async settle(): Promise<void> {
      const pending = resolveAll;
      resolveAll = [];
      for (const r of pending) r();
      await flush();
      await flush();
    },
  };
}

describe('what it asks for', () => {
  it('asks for the tiles around the camera, and no more than it may at once', async () => {
    const { streamer, asked } = lab({ maxInFlight: 2 });
    streamer.update(world(0, 0));
    expect(asked.length).toBe(2);
    expect(streamer.status().inFlight).toBe(2);
    // Nine tiles are wanted around a point on a tile corner; two are in the air.
    expect(streamer.status().wanted).toBeGreaterThan(1);
  });

  it('makes the ground resident once a tile lands, and says which lattice answers', async () => {
    const { streamer, field, settle } = lab({ maxInFlight: 9 });
    const at = world(0, 0);
    expect(field.sample(at).detail).toBe('coarse');
    streamer.update(at);
    await settle();
    expect(streamer.status().resident).toBeGreaterThan(0);
    expect(field.sample(at).detail).toBe('hd');
  });

  it('never asks twice for a tile it already holds', async () => {
    const { streamer, fetchTile, settle } = lab({ maxInFlight: 9 });
    const at = world(0, 0);
    streamer.update(at);
    await settle();
    const afterFirst = fetchTile.mock.calls.length;
    for (let i = 0; i < 30; i += 1) streamer.update(at);
    await settle();
    expect(fetchTile.mock.calls.length).toBe(afterFirst);
  });

  it('never asks twice for a tile that failed, and stops asking altogether', async () => {
    const field = new Heightfield(flat(COARSE_SAMPLES, -500));
    const asked: string[] = [];
    const fetchTile = vi.fn(async (id: HdTileId) => {
      asked.push(hdTileName(id));
      throw new Error('404');
    });
    const errors: string[] = [];
    const streamer = new TerrainStreamer({ field, fetchTile, onError: (name) => errors.push(name) });
    const at = world(0, 0);

    // Enough turns for it to work through every tile it wants. It moves
    // ON to the others as each fails — that is right, and is not the same
    // thing as retrying one.
    for (let i = 0; i < 40; i += 1) {
      streamer.update(at);
      await flush();
      await flush();
    }
    const settled = asked.length;
    expect(settled).toBeGreaterThan(0);
    expect(errors.length).toBe(settled);
    // NOT ONE TILE ASKED FOR TWICE.
    expect(new Set(asked).size).toBe(settled);
    // And having tried them all, it has stopped: standing still is silent.
    for (let i = 0; i < 20; i += 1) {
      streamer.update(at);
      await flush();
    }
    expect(asked.length).toBe(settled);
    expect(streamer.status().failed).toBe(settled);

    // The ground is still there, at coarse detail.
    expect(Number.isFinite(field.heightAt(at))).toBe(true);
    expect(field.sample(at).detail).toBe('coarse');
  });
});

describe('what it lets go', () => {
  it('drops a tile the camera has left, and the coarse lattice answers there', async () => {
    const { streamer, field, settle } = lab({ maxInFlight: 9 });
    const home = world(0, 0);
    streamer.update(home);
    await settle();
    expect(field.sample(home).detail).toBe('hd');

    // Right across the island, well beyond the keep radius.
    streamer.update(world(ISLAND_SPAN / 2 - 1, ISLAND_SPAN / 2 - 1));
    expect(field.sample(home).detail).toBe('coarse');
    expect(Number.isFinite(field.heightAt(home))).toBe(true);
  });

  it('holds a tile the camera has merely left, so drifting over a boundary is not a re-download', async () => {
    // THE HYSTERESIS, and the step it takes to actually test it.
    //
    // An earlier version of this stepped 50,000 units and asserted no
    // extra fetch — but a tile span is 700,000, so 50,000 is a fourteenth
    // of one and `hdTilesNear` returns the SAME nine tiles at both ends.
    // Nothing was ever eviction-eligible, the keep radius was never
    // consulted, and setting KEEP_REACH equal to WANT_REACH — precisely
    // the breakage this test is named for — left the whole file green.
    //
    // A whole tile span is the smallest step that changes the wanted set
    // while the keep set still holds what was dropped from it. That
    // difference IS the hysteresis.
    const { streamer, fetchTile, asked, settle } = lab({ maxInFlight: 16 });
    streamer.update(world(0, 0));
    await settle();
    const home = [...asked];
    expect(home.length).toBeGreaterThan(0);

    // One tile span east: the wanted set genuinely moves off some of them.
    const away = world(HD_TILE_SPAN, 0);
    expect(hdTilesNear(away, WANT_REACH).map(hdTileName).sort())
      .not.toEqual(hdTilesNear(world(0, 0), WANT_REACH).map(hdTileName).sort());
    streamer.update(away);
    await settle();

    // Come back. Nothing that was held may have been asked for twice.
    streamer.update(world(0, 0));
    await settle();
    const counts = new Map();
    for (const name of asked) counts.set(name, (counts.get(name) ?? 0) + 1);
    const twice = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
    expect(twice).toEqual([]);
    expect(fetchTile.mock.calls.length).toBe(asked.length);
  });

  it('lets bytes still in the air go when it is disposed, without touching the field', async () => {
    const { streamer, field, settle } = lab({ maxInFlight: 9 });
    streamer.update(world(0, 0));
    streamer.dispose();
    await settle();
    expect(streamer.status().resident).toBe(0);
    expect(field.residentTiles()).toEqual([]);
    expect(field.sample(world(0, 0)).detail).toBe('coarse');
  });

  it('is inert after disposal', async () => {
    const { streamer, fetchTile } = lab();
    streamer.dispose();
    streamer.update(world(0, 0));
    expect(fetchTile).not.toHaveBeenCalled();
  });
});

describe('what it hands the heightfield', () => {
  it('repairs a tile before it becomes ground', async () => {
    // A tile full of NODATA would be refused by the heightfield outright,
    // so a streamer that skipped the repair would throw rather than
    // silently draw a pit — but it must not throw either.
    const field = new Heightfield(flat(COARSE_SAMPLES, -500));
    const holes = new Int16Array(HD_TILE_SAMPLE_COUNT);
    holes.fill(-4000);
    // A patch of holes the size of the worst real cluster, not a whole
    // empty tile: the fill spreads one ring a pass, so an entirely blank
    // 513-square would need 512 passes. The shipped files need under 20.
    for (let row = 4; row < 26; row += 1) {
      for (let col = 4; col < 26; col += 1) holes[row * HD_TILE_SAMPLES + col] = -32768;
    }
    const errors: unknown[] = [];
    const streamer = new TerrainStreamer({
      field,
      fetchTile: async () => holes.buffer.slice(0) as ArrayBuffer,
      onError: (_n, e) => errors.push(e),
      maxInFlight: 9,
    });
    streamer.update(world(0, 0));
    for (let i = 0; i < 60; i += 1) await flush();
    expect(errors).toEqual([]);
    // Every tile around the origin, not one: which of the nine is fetched
    // first is an ordering detail, and the point is that the ground under
    // the camera became high-detail without the repair throwing.
    expect(streamer.status().resident).toBe(9);
    expect(field.sample(world(0, 0)).detail).toBe('hd');
    expect(field.heightAt(world(0, 0))).toBeCloseTo(-40_000, 6);
  });
});

describe('what it costs to hold', () => {
  it('states a resident ceiling that matches the radii it actually keeps', () => {
    // The module's first comment said nine tiles and 4.7 MB, which is the
    // WANTED set. Residency is bounded by KEEP_REACH, not WANT_REACH, and
    // that square can touch four tiles on each axis. On a phone the number
    // that matters is the one actually held.
    const worst = Math.max(
      ...[0, HD_TILE_SPAN / 2, HD_TILE_SPAN / 3].map((offset) =>
        hdTilesNear(world(offset, offset), KEEP_REACH).length),
    );
    expect(worst).toBe(MAX_RESIDENT);
    expect(MAX_RESIDENT * HD_TILE_BYTES).toBeLessThan(9 * 1024 * 1024);
    // And the gap the hysteresis depends on is real.
    expect(KEEP_REACH).toBeGreaterThan(WANT_REACH);
  });
});
