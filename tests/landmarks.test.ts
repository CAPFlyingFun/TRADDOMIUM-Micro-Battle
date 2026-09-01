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
  GRASS, SHRUB, TREE, VEG_BYTES, coverAt, decodeVeg, forgetVeg,
} from '../src/world/landcover';
import {
  CORRIDOR, GIRTH_OF_HEIGHT, HEIGHT_RANGE, LEAST_HEIGHT, MOST_PER_LEG, PITCH, SHORE,
  STEEPEST, TRUNK_OF_HEIGHT, cellOf, landmarksIn, landmarksNear, offLeg,
  slopeAt, treeHazardsAlong,
} from '../src/world/landmarks';
import { ROUTE_DEFAULTS, planRoute } from '../src/ant/routePlanner';
import { ringAround as ring } from '../src/ant/hazards';
import type { WorldPoint } from '../src/world/coords';

const WAILUA = geoToWorld({ lat: 22.043, lon: -159.395 });
const KOLOA = geoToWorld({ lat: 21.907, lon: -159.470 });
const HANALEI = geoToWorld({ lat: 22.185, lon: -159.470 });

function vegBytes(): ArrayBuffer {
  const buf = readFileSync('public/kauai-veg.bin');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/** The real header over invented planes: forest everywhere, full canopy. */
function everywhereForest(): ArrayBuffer {
  const real = vegBytes();
  const fake = real.slice(0);
  const planes = new Uint8Array(fake, 12);
  const plane = (VEG_BYTES - 12) / 3;
  planes.fill(TREE, 0, plane);
  planes.fill(255, plane, plane * 2);
  planes.fill(0, plane * 2);
  return fake;
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

describe('the trees one leg is planned against', () => {
  beforeAll(() => { loadIsland(); decodeVeg(vegBytes()); }, 120000);
  afterAll(() => { forgetVeg(); });

  /** A leg through the forest that certainly passes trees. */
  function forestLeg(): { from: WorldPoint; to: WorldPoint } {
    const trees = landmarksNear(WAILUA, 40_000);
    expect(trees.length).toBeGreaterThan(1);
    const first = trees[0].at;
    const last = trees[trees.length - 1].at;
    return {
      from: { wx: first.wx - 3_000, wz: first.wz - 3_000 },
      to: { wx: last.wx + 3_000, wz: last.wz + 3_000 },
    };
  }

  it('finds every tree inside the corridor and none outside it', () => {
    const { from, to } = forestLeg();
    const along = treeHazardsAlong(from, to, 1_000);
    const byHand = landmarksIn(
      Math.min(from.wx, to.wx) - CORRIDOR, Math.min(from.wz, to.wz) - CORRIDOR,
      Math.max(from.wx, to.wx) + CORRIDOR, Math.max(from.wz, to.wz) + CORRIDOR,
    ).filter((t) => offLeg(t.at, from, to) <= CORRIDOR);
    expect(along.considered).toBe(byHand.length);
    expect(along.hazards.map((h) => h.id).sort()).toEqual(byHand.map((t) => t.id).sort());
  });

  it('shows the planner the trunk, top null, nearest the line first', () => {
    const { from, to } = forestLeg();
    const along = treeHazardsAlong(from, to);
    expect(along.hazards.length).toBeGreaterThan(0);
    let last = -1;
    for (const h of along.hazards) {
      expect(h.top).toBeNull();
      expect(h.kind).toBe('obstacle');
      expect(h.label).toBe('tree');
      const tree = landmarksNear(h.at, 1)[0];
      expect(tree).toBeDefined();
      expect(h.radius).toBeCloseTo(tree.trunk, 6);
      const off = offLeg(h.at, from, to);
      expect(off).toBeGreaterThanOrEqual(last);
      last = off;
    }
  });

  it('caps what one leg is shown, and counts what it dropped', () => {
    const { from, to } = forestLeg();
    const all = treeHazardsAlong(from, to, 1_000);
    const capped = treeHazardsAlong(from, to, 2);
    expect(capped.hazards).toHaveLength(Math.min(2, all.considered));
    expect(capped.dropped).toBe(all.considered - capped.hazards.length);
    expect(capped.considered).toBe(all.considered);
    expect(MOST_PER_LEG).toBe(8);
  });

  it('and the corridor is wide enough for a detour corner to swing', () => {
    // A corner sits one ring reach off the line; the leg out of it can
    // graze a tree one reach further. The widest ring: a 30 m trunk plus
    // the margin, pushed to the octagon's corner.
    const tallest = { id: 't', at: { wx: 0, wz: 0 }, radius: 3_000 * TRUNK_OF_HEIGHT, top: null, kind: 'obstacle' as const };
    const corners = ring(tallest, ROUTE_DEFAULTS.margin, ROUTE_DEFAULTS.sides);
    const reach = Math.max(...corners.map((c) => Math.hypot(c.wx, c.wz)));
    expect(reach).toBeLessThan(430);
    expect(CORRIDOR).toBeGreaterThanOrEqual(2 * reach);
  });

  it('reads nothing at all before the raster lands', () => {
    forgetVeg();
    expect(landmarksNear(WAILUA, 30_000)).toHaveLength(0);
    expect(treeHazardsAlong(WAILUA, { wx: WAILUA.wx + 10_000, wz: WAILUA.wz }).considered).toBe(0);
    decodeVeg(vegBytes());
  });
});

describe('a dense stand does not stall the planner', () => {
  beforeAll(() => { loadIsland(); decodeVeg(everywhereForest()); }, 120000);
  afterAll(() => { forgetVeg(); });

  it('plans a 600 m leg through full forest, routed and never blocked', () => {
    const from = { wx: WAILUA.wx, wz: WAILUA.wz };
    const to = { wx: WAILUA.wx + 60_000, wz: WAILUA.wz };
    const along = treeHazardsAlong(from, to);
    expect(along.considered).toBeGreaterThan(MOST_PER_LEG);
    expect(along.hazards).toHaveLength(MOST_PER_LEG);
    const began = performance.now();
    const plan = planRoute(from, to, along.hazards, 55);
    const ms = performance.now() - began;
    expect(plan.report.blocked).toBe(false);
    expect(plan.legs.length).toBeGreaterThanOrEqual(1);
    // No leg passes through a trunk it was shown.
    let at: WorldPoint = from;
    for (const leg of plan.legs) {
      for (const h of along.hazards) {
        expect(offLeg(h.at, at, leg.to)).toBeGreaterThan(h.radius);
      }
      at = leg.to;
    }
    console.log(`600 m through full forest: ${along.considered} trees in the corridor,`
      + ` ${plan.legs.length} legs, planned in ${ms.toFixed(1)} ms`);
  });

  it('and asks per leg, so a chain is one corridor at a time', () => {
    const stops: WorldPoint[] = [1, 2, 3, 4, 5].map((i) => ({
      wx: WAILUA.wx + i * 20_000, wz: WAILUA.wz + (i % 2) * 8_000,
    }));
    let at: WorldPoint = WAILUA;
    for (const stop of stops) {
      const along = treeHazardsAlong(at, stop);
      expect(along.hazards.length).toBeLessThanOrEqual(MOST_PER_LEG);
      at = stop;
    }
  });
});
