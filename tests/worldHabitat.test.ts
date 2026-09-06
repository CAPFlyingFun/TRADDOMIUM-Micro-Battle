/**
 * What belongs where, checked against the island rather than against a
 * fixture that agrees with the classifier by construction.
 *
 * THE SITES ARE FOUND, NOT TYPED. A spawn region's centre is a place
 * Joshua named, not a surveyed beach or a surveyed cliff, so a test that
 * pinned "Hanalei Bay reads beach" at the region's centre would be
 * pinning where a lat/lon happened to land (it is forest, 560 m from the
 * water). Instead each site is searched for from the named centre —
 * "the nearest point to Hanalei Bay's centre that is within 40 m of the
 * sea and above it" — and the assertion is about THAT point. The search
 * is deterministic and the test fails if no such point exists, which is
 * the fact worth failing on.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { world, type WorldPoint } from '../src/world/coords';
import { COARSE_STEP, ISLAND_HALF_SPAN, UNITS_PER_METRE, decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { geoToWorld } from '../src/world/geo';
import { coastField } from '../src/world/coast';
import {
  BEACH_CEILING, COAST_REACH, HABITAT_KINDS, HabitatMap, SEA_HABITAT, classify, type Habitat, type HabitatKind,
} from '../src/world/habitat';
import { OPEN_SEA, decodeVeg, type CoverMix } from '../src/world/landcover';
import { islandChannels } from '../src/world/water/islandChannels';
import { SEA_LEVEL } from '../src/world/heightfield';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const M = UNITS_PER_METRE;

function bytes(file: string): ArrayBuffer {
  const b = readFileSync(path.join(ROOT, 'public', file));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const coarse = repairGrid(decodeCoarse(bytes('kauai-1025.bin'))).grid;
const channels = islandChannels(coarse);
const landcover = decodeVeg(bytes('kauai-veg.bin'));
const map = new HabitatMap({ landcover, coarse, isChannel: channels.isChannel });

/** Spiral out from a centre in 20 m steps until `want` is satisfied, or give up at `reach`. */
function findNear(centre: WorldPoint, reach: number, want: (h: Habitat, at: WorldPoint) => boolean): { at: WorldPoint; habitat: Habitat } | null {
  const step = 20 * M;
  for (let r = 0; r <= reach; r += step) {
    const ring = r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < ring; k += 1) {
      const a = (k / ring) * 2 * Math.PI;
      const at = world(centre.wx + r * Math.cos(a), centre.wz + r * Math.sin(a));
      const h = map.at(at);
      if (want(h, at)) return { at, habitat: h };
    }
  }
  return null;
}

const grassMix: CoverMix = { tree: 0, shrub: 0, grass: 1, bare: 0, water: 0, wetland: 0, canopy: 0, river: 0 };
const treeMix: CoverMix = { tree: 1, shrub: 0, grass: 0, bare: 0, water: 0, wetland: 0, canopy: 0.9, river: 0 };
const wetMix: CoverMix = { tree: 0.2, shrub: 0, grass: 0.2, bare: 0, water: 0, wetland: 0.6, canopy: 0.2, river: 0.3 };

describe('the coast field', () => {
  const coast = coastField(coarse);

  it('finds the sea where the heightfield puts it, and reaches the middle of the island', () => {
    // The raster says 54.3% of the square is water; the survey says
    // 51.4% of its samples are below sea level (the raster's 10 m coast
    // is a touch generous around the reefs). Either way, about half.
    expect(coast.seaSamples / (1025 * 1025)).toBeGreaterThan(0.48);
    expect(coast.seaSamples / (1025 * 1025)).toBeLessThan(0.58);
    // Waiʻaleʻale is the farthest ground from any coast: 14–18 km.
    expect(coast.farthest).toBeGreaterThan(12_000 * M);
    expect(coast.farthest).toBeLessThan(20_000 * M);
    expect(coast.distanceAt(world(ISLAND_HALF_SPAN, ISLAND_HALF_SPAN))).toBe(0);
    expect(coast.distanceAt(world(Number.NaN, 0))).toBe(0);
  });

  it('is smooth along a walk inland — no 54 m steps drawn onto the sand', () => {
    const from = geoToWorld({ lat: 22.204, lon: -159.501 });
    let prev = coast.distanceAt(from);
    for (let d = 1000; d <= 200_000; d += 1000) {
      const here = coast.distanceAt(world(from.wx, from.wz + d));
      // A 10 m step changes the distance by at most 10 m plus the chamfer's
      // own 8% and the interpolation's share of a cell.
      expect(Math.abs(here - prev)).toBeLessThan(2500);
      prev = here;
    }
  });

  it('agrees with the sea to within a sample: every point it calls 0 is below sea level, and land is never 0', () => {
    let seaZero = 0;
    let landZero = 0;
    for (let row = 0; row < 1025; row += 7) {
      for (let col = 0; col < 1025; col += 7) {
        const at = world(col * COARSE_STEP - ISLAND_HALF_SPAN, row * COARSE_STEP - ISLAND_HALF_SPAN);
        const h = coarse.samples[row * 1025 + col] * 10;
        const d = coast.distanceAt(at);
        if (h < SEA_LEVEL) seaZero += d === 0 ? 1 : 0;
        else if (d === 0) landZero += 1;
      }
    }
    expect(seaZero).toBeGreaterThan(5000);
    expect(landZero).toBe(0);
  });
});

describe('classify — the rules as a pure function', () => {
  it('reads a flat lowland pasture far from the sea as grassland', () => {
    const h = classify(grassMix, 50 * M, 3, 3000 * M, false, null);
    expect(h.kind).toBe('grassland');
    expect(h.grass).toBeGreaterThan(0.9);
    expect(h.forest).toBe(0);
    expect(h.coast).toBe(0);
  });

  it('reads the same pasture at the waterline as a beach, and a sea cliff as not a beach', () => {
    expect(classify(grassMix, 2 * M, 2, 10 * M, false, null).kind).toBe('beach');
    // The same distance but 40 m up: a cliff top, not sand.
    expect(classify(grassMix, 40 * M, 2, 10 * M, false, null).kind).not.toBe('beach');
    // Past COAST_REACH nothing is a beach.
    expect(classify(grassMix, 2 * M, 2, COAST_REACH * 1.5, false, null).kind).not.toBe('beach');
    expect(BEACH_CEILING).toBe(10 * M);
  });

  it('reads dense canopy as forest, and the same canopy on a cliff as rock', () => {
    const forest = classify(treeMix, 200 * M, 8, 5000 * M, false, null);
    expect(forest.kind).toBe('forest');
    expect(forest.forest).toBeGreaterThan(0.8);
    const cliff = classify(treeMix, 200 * M, 60, 5000 * M, false, null);
    expect(cliff.kind).toBe('rocky');
    expect(cliff.forest).toBe(0);
    expect(cliff.bare).toBe(1);
  });

  it('reads the survey\'s wetland as wetland, and a dry gully as a wet bank but not a marsh', () => {
    expect(classify(wetMix, 5 * M, 1, 2000 * M, false, null).kind).toBe('wetland');
    const gully = classify(grassMix, 60 * M, 4, 2000 * M, true, null);
    expect(gully.kind).toBe('grassland');
    expect(gully.wet).toBeGreaterThan(0.3);
    expect(gully.channel).toBe(true);
  });

  it('reads the high steep plateau as ridge, and high flat forest as forest — Kauaʻi has no treeline', () => {
    expect(classify(treeMix, 1400 * M, 30, 14000 * M, false, null).kind).toBe('ridge');
    expect(classify(treeMix, 1200 * M, 5, 8000 * M, false, null).kind).toBe('forest');
  });

  it('carries the rainfall seam through untouched and never invents it', () => {
    expect(classify(grassMix, 50 * M, 3, 3000 * M, false, null).rainfallMmYear).toBeNull();
    expect(classify(grassMix, 50 * M, 3, 3000 * M, false,9500).rainfallMmYear).toBe(9500);
  });

  it('keeps every factor inside 0..1 across the whole input space', () => {
    const mixes: CoverMix[] = [grassMix, treeMix, wetMix, OPEN_SEA,
      { tree: 0.3, shrub: 0.3, grass: 0.2, bare: 0.2, water: 0, wetland: 0, canopy: 0.5, river: 0.9 }];
    for (const mix of mixes) {
      for (let elev = 0; elev <= 1600 * M; elev += 200 * M) {
        for (let slope = 0; slope <= 80; slope += 10) {
          for (const coast of [0, 30 * M, 200 * M, 9000 * M]) {
            const h = classify(mix, elev, slope, coast, slope > 40, null);
            for (const key of ['forest', 'grass', 'shrub', 'bare', 'wet', 'coast', 'exposure'] as const) {
              expect(h[key], `${key} at ${elev}/${slope}/${coast}`).toBeGreaterThanOrEqual(0);
              expect(h[key], `${key} at ${elev}/${slope}/${coast}`).toBeLessThanOrEqual(1);
            }
            expect(HABITAT_KINDS).toContain(h.kind);
          }
        }
      }
    }
  });
});

describe('HabitatMap over the real island', () => {
  it('answers sea below sea level and for a non-finite point', () => {
    expect(map.at(world(ISLAND_HALF_SPAN * 2, 0))).toBe(SEA_HABITAT);
    expect(map.at(world(Number.NaN, 12))).toBe(SEA_HABITAT);
    expect(map.at(geoToWorld({ lat: 22.083, lon: -159.760 })).kind).toBe('sea');
  });

  it('has a beach on Hanalei Bay and at Polihale, within a short walk of their named centres', () => {
    for (const centre of [{ lat: 22.204, lon: -159.501 }, { lat: 22.083, lon: -159.760 }, { lat: 21.874, lon: -159.457 }]) {
      const beach = findNear(geoToWorld(centre), 2500 * M, (h) => h.kind === 'beach');
      expect(beach, `${centre.lat},${centre.lon}`).not.toBeNull();
      expect(beach!.habitat.coastDistance).toBeLessThan(COAST_REACH);
      expect(beach!.habitat.elevation).toBeGreaterThan(SEA_LEVEL);
      expect(beach!.habitat.coast).toBeGreaterThan(0.5);
      // A beach is not a forest and not a lawn.
      expect(beach!.habitat.forest).toBeLessThan(0.45);
      expect(beach!.habitat.grass).toBeLessThan(0.6);
    }
  });

  it('puts forest in the Wailua, Hanalei Valley and Wainiha — and at Kōkeʻe, 1,240 m up', () => {
    for (const centre of [{ lat: 22.043, lon: -159.395 }, { lat: 22.185, lon: -159.470 }, { lat: 22.190, lon: -159.556 }, { lat: 22.130, lon: -159.655 }]) {
      const h = map.at(geoToWorld(centre));
      expect(h.kind, `${centre.lat},${centre.lon}`).toBe('forest');
      expect(h.forest).toBeGreaterThan(0.7);
      expect(h.grass).toBeLessThan(0.2);
    }
    expect(map.at(geoToWorld({ lat: 22.130, lon: -159.655 })).exposure).toBeGreaterThan(0.9);
  });

  it('puts open ground at Kekaha, Kōloa and the Hāʻupu plain — grass-heavy, tree-poor', () => {
    for (const centre of [{ lat: 21.976, lon: -159.717 }, { lat: 21.907, lon: -159.470 }, { lat: 21.925, lon: -159.420 }]) {
      const h = map.at(geoToWorld(centre));
      expect(['grassland', 'shrubland'], `${centre.lat},${centre.lon}`).toContain(h.kind);
      expect(h.grass).toBeGreaterThan(0.6);
      expect(h.forest).toBeLessThan(0.3);
    }
  });

  it('finds bare rock on Waimea Canyon\'s walls and reads the Waiʻaleʻale plateau as ridge', () => {
    const wall = findNear(geoToWorld({ lat: 22.055, lon: -159.665 }), 3000 * M, (h) => h.kind === 'rocky');
    expect(wall).not.toBeNull();
    expect(wall!.habitat.bare).toBeGreaterThan(0.5);
    expect(wall!.habitat.forest).toBeLessThan(0.3);
    expect(wall!.habitat.slopeDegrees).toBeGreaterThan(30);
    const summit = map.at(geoToWorld({ lat: 22.070, lon: -159.500 }));
    expect(summit.kind).toBe('ridge');
    expect(summit.exposure).toBe(1);
  });

  it('has wetland on the Hanalei taro flats', () => {
    const taro = findNear(geoToWorld({ lat: 22.200, lon: -159.485 }), 3000 * M, (h) => h.kind === 'wetland');
    expect(taro).not.toBeNull();
    expect(taro!.habitat.wet).toBeGreaterThan(0.4);
  });

  it('is the same map twice — nothing about it depends on what streamed in', () => {
    const again = new HabitatMap({ landcover, coarse, isChannel: channels.isChannel });
    for (let i = 0; i < 500; i += 1) {
      const at = world(((i * 7919) % 5_000_000) - 2_500_000, ((i * 104_729) % 5_000_000) - 2_500_000);
      expect(again.at(at)).toEqual(map.at(at));
    }
  });

  it('covers the land in believable shares — forest is the largest, beach the smallest', () => {
    const counts: Partial<Record<HabitatKind, number>> = {};
    let land = 0;
    for (let row = 0; row < 1025; row += 5) {
      for (let col = 0; col < 1025; col += 5) {
        const h = map.at(world(col * COARSE_STEP - ISLAND_HALF_SPAN, row * COARSE_STEP - ISLAND_HALF_SPAN));
        if (h.kind === 'sea') continue;
        land += 1;
        counts[h.kind] = (counts[h.kind] ?? 0) + 1;
      }
    }
    const share = (k: HabitatKind): number => (counts[k] ?? 0) / land;
    // ESA says 63% of the island's LAND is tree class; canopy and slope
    // hand some of that to shrub and rock, so forest lands near half.
    expect(share('forest')).toBeGreaterThan(0.4);
    expect(share('forest')).toBeLessThan(0.6);
    expect(share('grassland')).toBeGreaterThan(0.15);
    expect(share('beach')).toBeLessThan(0.03);
    expect(share('rocky')).toBeGreaterThan(0.02);
    // The survey's WETLAND class is small on Kauaʻi — the Hanalei taro,
    // Hulēʻia, the Mānā remnants — and a gully alone is not a marsh.
    expect(share('wetland')).toBeGreaterThan(0.002);
    expect(share('ridge')).toBeGreaterThan(0.01);
    for (const kind of HABITAT_KINDS) if (kind !== 'sea') expect(share(kind)).toBeLessThan(0.7);
  });
});
