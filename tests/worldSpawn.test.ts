/**
 * THIRTY PLACES TO BEGIN, AND WHETHER THE ISLAND ACTUALLY HAS THEM.
 *
 * The regions are hand-placed by real geography; the candidates are
 * searched for in the shipped survey. So the interesting failure is not
 * "the code threw" — it is "Hāʻupu Ridge has no walkable ground in its
 * band any more", which is silent, and which a re-bake of the
 * heightfield or a moved elevation band can cause at any time.
 *
 * That is what most of this file checks, against the REAL bytes rather
 * than a fixture: a region with no candidates is a name on a map that
 * cannot be played, and v0 shipped exactly that twice before its audit
 * caught it.
 *
 * The geography checks come first, because if the transform is mirrored
 * then every candidate below is on the wrong coast and still passes
 * every band check — the failure mode with no symptom.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { ISLAND_SPAN, world, type WorldPoint } from '../src/world/coords';
import { UNITS_PER_METRE, decodeCoarse } from '../src/world/dem';
import { repairGrid } from '../src/world/demRepair';
import { ISLAND_CENTRE, ISLAND_CENTRE_WORLD, geoApart, geoToWorld, worldToGeo } from '../src/world/geo';
import { Heightfield, SEA_LEVEL } from '../src/world/heightfield';
import {
  CANDIDATES_PER_REGION, REGIONS, SpawnSites, chooseCandidate,
} from '../src/world/spawn';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let field: Heightfield;
let sites: SpawnSites;
beforeAll(() => {
  const bytes = readFileSync(path.join(ROOT, 'public', 'kauai-1025.bin'));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  field = new Heightfield(repairGrid(decodeCoarse(buffer)).grid);
  sites = new SpawnSites(field);
});

const metres = (units: number): number => units / UNITS_PER_METRE;

describe('the geographic fit, re-measured against the shipped survey', () => {
  it('anchors on the land’s own bounding-box centre', () => {
    // ISLAND_CENTRE_WORLD is not a chosen number — it is where the land
    // in this bake actually is. Re-derive it here so a re-baked
    // heightfield cannot move the island out from under thirty regions
    // while every one of them still passes its band check.
    const half = ISLAND_SPAN / 2;
    const step = ISLAND_SPAN / 1024;
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    for (let r = 0; r <= 1024; r += 1) {
      const wz = -half + r * step;
      for (let c = 0; c <= 1024; c += 1) {
        const wx = -half + c * step;
        if (field.heightAt(world(wx, wz)) <= SEA_LEVEL) continue;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wz < minZ) minZ = wz;
        if (wz > maxZ) maxZ = wz;
      }
    }
    // Half a probe step of tolerance: the box is measured on a lattice.
    expect(Math.abs((minX + maxX) / 2 - ISLAND_CENTRE_WORLD.wx)).toBeLessThan(step);
    expect(Math.abs((minZ + maxZ) / 2 - ISLAND_CENTRE_WORLD.wz)).toBeLessThan(step);

    // Real Kauaʻi is 41.7 km from Kīlauea Point to Makahuena Point. This
    // is what says the bake is equirectangular at true scale, which is
    // the assumption the whole lat/lon transform rests on.
    expect(metres(maxZ - minZ) / 1000).toBeGreaterThan(41);
    expect(metres(maxZ - minZ) / 1000).toBeLessThan(42.5);
  });

  it('puts NORTH at −wz, which is the one sign that mirrors the island', () => {
    const north = geoToWorld({ lat: ISLAND_CENTRE.lat + 0.1, lon: ISLAND_CENTRE.lon });
    const south = geoToWorld({ lat: ISLAND_CENTRE.lat - 0.1, lon: ISLAND_CENTRE.lon });
    expect(north.wz).toBeLessThan(south.wz);

    const east = geoToWorld({ lat: ISLAND_CENTRE.lat, lon: ISLAND_CENTRE.lon + 0.1 });
    const west = geoToWorld({ lat: ISLAND_CENTRE.lat, lon: ISLAND_CENTRE.lon - 0.1 });
    expect(east.wx).toBeGreaterThan(west.wx);
  });

  it('round-trips a coordinate back to itself', () => {
    for (const region of REGIONS) {
      const back = worldToGeo(geoToWorld(region.around));
      expect(back.lat, region.id).toBeCloseTo(region.around.lat, 9);
      expect(back.lon, region.id).toBeCloseTo(region.around.lon, 9);
    }
  });

  it('measures a real distance the way a map would', () => {
    // Hanalei Bay to Poʻipū Shore is about 37 km across the island.
    const across = geoApart({ lat: 22.204, lon: -159.501 }, { lat: 21.874, lon: -159.457 });
    expect(metres(across) / 1000).toBeGreaterThan(34);
    expect(metres(across) / 1000).toBeLessThan(40);
  });

  it('places every region ON the island, not in the sea beside it', () => {
    // A region centre may legitimately fall on water — several are bays —
    // but it must not be far out to sea, which is what a mis-fitted
    // transform produces and what nothing else here would notice.
    const far: string[] = [];
    for (const region of REGIONS) {
      const at = geoToWorld(region.around);
      if (Math.hypot(at.wx - ISLAND_CENTRE_WORLD.wx, at.wz - ISLAND_CENTRE_WORLD.wz) > 3_500_000) {
        far.push(region.id);
      }
    }
    expect(far).toEqual([]);
  });
});

describe('the thirty regions', () => {
  it('is thirty, with unique ids and no empty prose', () => {
    expect(REGIONS.length).toBe(30);
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(30);
    for (const r of REGIONS) {
      expect(r.name.length, r.id).toBeGreaterThan(2);
      expect(r.description.length, r.id).toBeGreaterThan(20);
      expect(r.difficulty, r.id).toBeGreaterThanOrEqual(1);
      expect(r.difficulty, r.id).toBeLessThanOrEqual(3);
    }
  });

  it('offers a coast to start on, which is the whole point of asking', () => {
    // Joshua's reason for wanting this at all: the fixed spawn was 17 km
    // from water and he could not get to the ocean to test it.
    const coast = REGIONS.filter((r) => r.environment === 'coast');
    expect(coast.length).toBeGreaterThanOrEqual(4);
  });
});

describe('what the island actually offers', () => {
  it('FINDS SOMEWHERE TO STAND IN EVERY REGION', () => {
    // The audit. A region with no candidates is a name on the map that
    // cannot be played, and it fails silently: the map still draws it.
    const empty = sites.regions().filter((r) => r.candidates.length === 0).map((r) => r.id);
    expect(empty).toEqual([]);
  });

  it('keeps candidates above water, in band, and off the cliffs', () => {
    for (const region of sites.regions()) {
      for (const candidate of region.candidates) {
        expect(sites.refuse(candidate.at, region.environment), `${region.id} @ ${candidate.at.wx},${candidate.at.wz}`)
          .toBeNull();
        expect(candidate.ground, region.id).toBeGreaterThan(SEA_LEVEL);
        expect(Number.isFinite(candidate.heading), region.id).toBe(true);
      }
    }
  });

  it('spreads a region’s candidates out instead of stacking them in one thicket', () => {
    for (const region of sites.regions()) {
      const { candidates } = region;
      for (let i = 0; i < candidates.length; i += 1) {
        for (let j = i + 1; j < candidates.length; j += 1) {
          const apart = Math.hypot(
            candidates[i].at.wx - candidates[j].at.wx,
            candidates[i].at.wz - candidates[j].at.wz,
          );
          expect(apart, `${region.id} ${i}/${j}`).toBeGreaterThanOrEqual(40_000);
        }
      }
    }
  });

  it('keeps no more than the four it promises', () => {
    for (const region of sites.regions()) {
      expect(region.candidates.length, region.id).toBeLessThanOrEqual(CANDIDATES_PER_REGION);
    }
  });

  it('IS DETERMINISTIC — two searches of the same survey agree exactly', () => {
    // The variation between restarts is meant to come from choosing among
    // candidates, never from finding different ones. Two devices that
    // disagree here disagree about where a saved colony is.
    const again = new SpawnSites(field);
    for (const region of REGIONS) {
      const a = sites.region(region.id);
      const b = again.region(region.id);
      expect(a, region.id).not.toBeNull();
      expect(b?.candidates).toEqual(a?.candidates);
    }
  });

  it('refuses for the RIGHT reason, so an audit can say which', () => {
    // Deep ocean south of the island, 1,549 m down: underwater, whatever
    // band is asked for. NOT world(-2_400_000, 0), which reads as open
    // sea and is in fact Polihale at +2.5 m — the western shore is much
    // further out than it looks, and this test asserted the opposite
    // until the heightfield was asked.
    expect(sites.refuse(world(0, 2_790_000), 'coast')).toBe('underwater');
    // High ground asked for a beach: in the survey, out of the band.
    expect(sites.refuse(world(0, 0), 'coast')).toBe('wrong-band');
    // And that same beach IS a coast: 2.5 m sits inside the 1–14 m band.
    expect(sites.refuse(world(-2_400_000, 0), 'coast')).toBeNull();
  });

  it('answers the same region object for the same id', () => {
    expect(sites.region('hanalei-bay')?.name).toBe('Hanalei Bay');
    expect(sites.region('not-a-place')).toBeNull();
  });
});

describe('choosing among the candidates', () => {
  const region = () => {
    const r = sites.region('poipu');
    if (r === null) throw new Error('poipu missing');
    return r;
  };

  it('reaches every candidate across the roll, and none outside it', () => {
    const r = region();
    const seen = new Set<WorldPoint>();
    for (let i = 0; i < 1000; i += 1) {
      const picked = chooseCandidate(r, i / 1000);
      expect(picked).not.toBeNull();
      seen.add(picked!.at);
    }
    expect(seen.size).toBe(r.candidates.length);
  });

  it('does not fall off the end at a roll of exactly 1', () => {
    // Math.random() never returns 1, but a caller passing a fraction can.
    // Off by one here is `undefined` reaching the world as a spawn point.
    const r = region();
    expect(chooseCandidate(r, 1)).toBe(r.candidates[r.candidates.length - 1]);
    expect(chooseCandidate(r, 0)).toBe(r.candidates[0]);
    expect(chooseCandidate(r, -5)).toBe(r.candidates[0]);
  });

  it('says null rather than throwing when a region has nothing', () => {
    expect(chooseCandidate({ ...REGIONS[0], candidates: [] }, 0.5)).toBeNull();
  });
});
