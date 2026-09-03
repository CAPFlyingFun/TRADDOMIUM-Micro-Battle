/**
 * THE LANDMARK TREES — placed from the real island, proved without a
 * renderer.
 *
 * Everything in landmarks.ts is pure, so the questions are asked here:
 * is the same tree in the same place twice, does it keep off water and
 * cliffs, does the planner get shown the right ones and no more than it
 * can afford.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadIsland } from './support/island';
import { geoToWorld } from '../src/world/geo';
import { groundHeight } from '../src/world/heightfield';
import { isLandWatercourse } from '../src/world/islandChannels';
import {
  GRASS, SHRUB, TREE, coverAt, decodeVeg, forgetVeg,
} from '../src/world/landcover';
import {
  GIRTH_OF_HEIGHT, HEIGHT_RANGE, LEAST_HEIGHT, PITCH, SHORE,
  STEEPEST, TRUNK_OF_HEIGHT, cellOf, landmarksIn, landmarksNear, slopeAt,
} from '../src/world/landmarks';

const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
const KOLOA = geoToWorld({ lat: 21.907, lon: -159.470 });
const HANALEI = geoToWorld({ lat: 22.185, lon: -159.470 });

function vegBytes(): ArrayBuffer {
  const buf = readFileSync('public/kauai-veg.bin');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('where the giants stand', () => {
  beforeAll(() => { loadIsland(); decodeVeg(vegBytes()); }, 120000);
  afterAll(() => { forgetVeg(); });

  it('is the same tree in the same cell every time, by id', () => {
    const a = landmarksNear(WAILUA, 30_000);
    const b = landmarksNear(WAILUA, 30_000);
    expect(a.length).toBeGreaterThan(0);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
    expect(a.map((t) => t.at)).toEqual(b.map((t) => t.at));
    for (const tree of a) expect(tree.id).toBe(`lm:${tree.cx},${tree.cz}`);
  });

  it('and a window is the same trees as the whole, cell by cell', () => {
    // Any window of the island can be grown on its own — the property
    // that lets the renderer and the planner each ask for what they
    // need without either growing the rest.
    const wide = landmarksIn(WAILUA.wx - 40_000, WAILUA.wz - 40_000, WAILUA.wx + 40_000, WAILUA.wz + 40_000);
    const narrow = landmarksIn(WAILUA.wx - 10_000, WAILUA.wz - 10_000, WAILUA.wx + 10_000, WAILUA.wz + 10_000);
    for (const tree of narrow) {
      expect(wide.find((t) => t.id === tree.id)).toEqual(tree);
    }
  });

  it('grows in Wailua Forest and not on Kōloa Fields', () => {
    expect(coverAt(WAILUA.wx, WAILUA.wz).kind).toBe(TREE);
    expect(coverAt(KOLOA.wx, KOLOA.wz).kind).toBe(GRASS);
    expect(landmarksNear(WAILUA, 30_000).length).toBeGreaterThan(0);
    // The pixel is 146 m and the fields are between forested hills, so
    // the rule is not "none near Kōloa" but "none on a grass pixel":
    // every tree that does stand near it stands on forest or scrub.
    const near = landmarksNear(KOLOA, 60_000);
    expect(near.length).toBeLessThan(landmarksNear(WAILUA, 60_000).length);
    for (const tree of near) {
      expect([TREE, SHRUB]).toContain(coverAt(tree.at.wx, tree.at.wz).kind);
    }
  });

  it('about one to a 30 m circle where the canopy is full', () => {
    // 20 m pitch at 0.6 presence over a full canopy: one per ~780 m², so
    // a 30 m disc (2,800 m²) holds three or four; the ground gates take
    // some. The number is what the device pass will see, so it is
    // pinned to a range rather than left to drift.
    const counts = [WAILUA, HANALEI].map((at) => landmarksNear(at, 3_000).length);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(8);
  });

  it('never stands in water, on a channel, on the shore or on a cliff', () => {
    for (const tree of landmarksNear(WAILUA, 60_000)) {
      expect(tree.ground).toBeGreaterThan(SHORE);
      expect(groundHeight(tree.at.wx, tree.at.wz)).toBeGreaterThan(SHORE);
      expect(isLandWatercourse(tree.at.wx, tree.at.wz)).toBe(false);
      expect(slopeAt(tree.at.wx, tree.at.wz)).toBeLessThanOrEqual(STEEPEST);
    }
  });

  it('is eighteen to thirty metres, with a trunk and a crown to match', () => {
    for (const tree of landmarksNear(WAILUA, 60_000)) {
      expect(tree.height).toBeGreaterThanOrEqual(LEAST_HEIGHT);
      expect(tree.height).toBeLessThanOrEqual(LEAST_HEIGHT + HEIGHT_RANGE);
      expect(tree.girth).toBeCloseTo(tree.height * GIRTH_OF_HEIGHT, 6);
      expect(tree.trunk).toBeCloseTo(tree.height * TRUNK_OF_HEIGHT, 6);
      expect(tree.crown).toBeGreaterThan(tree.trunk);
    }
  });

  it('and stands inside its own cell, never on the line', () => {
    for (const tree of landmarksNear(WAILUA, 60_000)) {
      const cell = cellOf(tree.at);
      expect(cell).toEqual({ cx: tree.cx, cz: tree.cz });
      const fx = tree.at.wx / PITCH - tree.cx;
      const fz = tree.at.wz / PITCH - tree.cz;
      expect(fx).toBeGreaterThan(0.1);
      expect(fx).toBeLessThan(0.9);
      expect(fz).toBeGreaterThan(0.1);
      expect(fz).toBeLessThan(0.9);
    }
  });
});
