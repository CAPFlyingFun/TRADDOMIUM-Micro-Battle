/**
 * Thirty regions are only useful if they are really there.
 *
 * A hand-typed spawn coordinate that happens to sit in the sea, on a
 * cliff, or six hundred metres above the band it claims is a bug the
 * player finds, not the developer. So the candidates are searched for
 * in the real heightfield and these hold the search honest.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  auditSpawns, CANDIDATES_PER_REGION, candidatesFor, chooseCandidate,
  forgetRegions, readyRegions, refuse, REGIONS,
} from '../src/world/spawn';
import { geoApart, geoToWorld, ISLAND_CENTRE, worldToGeo } from '../src/world/geo';
import { groundHeight, ISLAND_SPAN, useGrid } from '../src/world/heightfield';
import { decodeGrid, UNITS_PER_METRE, type HeightGrid } from '../src/world/kauai';
import { chunkAt, sameChunk, world } from '../src/world/coords';
import { MAP_SIZE, mapToWorld, worldToMap } from '../src/ui/islandMap';

const ASSET = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
let grid: HeightGrid;

beforeAll(() => {
  const file = readFileSync(ASSET);
  grid = decodeGrid(
    file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer,
  );
  useGrid(grid);
  forgetRegions();
});

describe('the geo transform', () => {
  it('round-trips', () => {
    for (const region of REGIONS) {
      const back = worldToGeo(geoToWorld(region.around));
      expect(back.lat).toBeCloseTo(region.around.lat, 9);
      expect(back.lon).toBeCloseTo(region.around.lon, 9);
    }
  });

  it('puts north at MINUS z, which is the easy one to mirror', () => {
    const north = geoToWorld({ lat: 22.2, lon: -159.5 });
    const south = geoToWorld({ lat: 21.9, lon: -159.5 });
    expect(north.wz).toBeLessThan(south.wz);
    const east = geoToWorld({ lat: 22.0, lon: -159.3 });
    const west = geoToWorld({ lat: 22.0, lon: -159.7 });
    expect(east.wx).toBeGreaterThan(west.wx);
  });

  it('keeps the whole island inside the world', () => {
    for (const region of REGIONS) {
      const at = geoToWorld(region.around);
      expect(Math.abs(at.wx), region.id).toBeLessThan(ISLAND_SPAN / 2);
      expect(Math.abs(at.wz), region.id).toBeLessThan(ISLAND_SPAN / 2);
    }
  });

  it('measures a real distance in world units', () => {
    // Hanalei to Poʻipū is about 37 km across the island.
    const across = geoApart({ lat: 22.204, lon: -159.501 }, { lat: 21.874, lon: -159.457 });
    const km = across / UNITS_PER_METRE / 1000;
    expect(km).toBeGreaterThan(30);
    expect(km).toBeLessThan(45);
  });

  it('has the island centre at the island centre', () => {
    const at = geoToWorld(ISLAND_CENTRE);
    expect(Math.hypot(at.wx, at.wz)).toBeLessThan(ISLAND_SPAN * 0.05);
  });
});

describe('the thirty regions', () => {
  it('are thirty, and distributed as designed', () => {
    const audit = auditSpawns();
    expect(audit.regions).toBe(30);
    expect(audit.byEnvironment).toEqual({
      coast: 6, grass: 8, jungle: 7, foothill: 5, mountain: 4,
    });
  });

  it('all have somewhere to stand', () => {
    const audit = auditSpawns();
    expect(audit.empty, `no candidates: ${audit.empty.join(', ')}`).toEqual([]);
  });

  it('have the candidates they advertise', () => {
    const audit = auditSpawns();
    expect(audit.thin, `short of candidates: ${audit.thin.join(', ')}`).toEqual([]);
    expect(audit.candidates).toBe(30 * CANDIDATES_PER_REGION);
  });

  it('have unique ids and names', () => {
    expect(new Set(REGIONS.map((r) => r.id)).size).toBe(REGIONS.length);
    expect(new Set(REGIONS.map((r) => r.name)).size).toBe(REGIONS.length);
  });

  it('put nobody on the summit snow', () => {
    // A fire ant does not found a colony in the snow. 🤣
    for (const region of readyRegions()) {
      for (const candidate of region.candidates) {
        const metres = groundHeight(candidate.at.wx, candidate.at.wz) / UNITS_PER_METRE;
        expect(metres, region.id).toBeLessThan(1250);
      }
    }
  });
});

describe('every candidate is somewhere she can actually be', () => {
  it('is on land, on a walkable slope, in its own band', () => {
    for (const region of readyRegions()) {
      for (const candidate of region.candidates) {
        expect(refuse(candidate.at, region.environment), region.id).toBeNull();
      }
    }
  });

  it('records the ground it was validated against', () => {
    // The height stored must be the DRAWN surface, or she arrives
    // inside a hill — the whole walked-equals-drawn business again.
    for (const region of readyRegions()) {
      for (const candidate of region.candidates) {
        expect(candidate.ground).toBeCloseTo(
          groundHeight(candidate.at.wx, candidate.at.wz), 6,
        );
      }
    }
  });

  it('is spread out inside its region, not piled in one thicket', () => {
    for (const region of readyRegions()) {
      const seen = region.candidates;
      for (let i = 0; i < seen.length; i++) {
        for (let j = i + 1; j < seen.length; j++) {
          const apart = Math.hypot(
            seen[i].at.wx - seen[j].at.wx, seen[i].at.wz - seen[j].at.wz,
          );
          expect(apart, region.id).toBeGreaterThan(1000);
        }
      }
    }
  });

  it('is near the region it belongs to', () => {
    for (const region of readyRegions()) {
      const centre = geoToWorld(region.around);
      for (const candidate of region.candidates) {
        const apart = Math.hypot(
          candidate.at.wx - centre.wx, candidate.at.wz - centre.wz,
        );
        // Under 4 km of the name on the map, or the name is a lie.
        expect(apart / UNITS_PER_METRE / 1000, region.id).toBeLessThan(4);
      }
    }
  });
});

describe('finding them is deterministic', () => {
  it('gives the same candidates every time', () => {
    // Two devices, two launches, one island. The variety comes from
    // CHOOSING among candidates, never from finding different ones.
    const first = candidatesFor(REGIONS[0]);
    const again = candidatesFor(REGIONS[0]);
    expect(again).toEqual(first);
  });

  it('varies which one is used, though', () => {
    const region = readyRegions()[0];
    const picks = new Set(
      [0, 0.3, 0.6, 0.95].map((roll) => chooseCandidate(region, roll)?.at.wx),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('never rolls off the end of the list', () => {
    const region = readyRegions()[0];
    for (const roll of [0, 0.5, 0.999999, 1]) {
      expect(chooseCandidate(region, roll)).not.toBeNull();
    }
  });
});

describe('spawns are global, not rendered', () => {
  it('addresses a candidate by the chunk that owns it', () => {
    for (const region of readyRegions()) {
      for (const candidate of region.candidates) {
        const owner = chunkAt(candidate.at);
        expect(sameChunk(chunkAt(world(candidate.at.wx, candidate.at.wz)), owner)).toBe(true);
      }
    }
  });
});

describe('the map is presentation, never a location', () => {
  it('round-trips a world point through map pixels', () => {
    for (const region of REGIONS) {
      const at = geoToWorld(region.around);
      const dot = worldToMap(at.wx, at.wz);
      const back = mapToWorld(dot.x, dot.y);
      expect(back.wx).toBeCloseTo(at.wx, 3);
      expect(back.wz).toBeCloseTo(at.wz, 3);
    }
  });

  it('puts every region inside the drawn map', () => {
    for (const region of REGIONS) {
      const at = geoToWorld(region.around);
      const dot = worldToMap(at.wx, at.wz);
      expect(dot.x, region.id).toBeGreaterThan(0);
      expect(dot.x, region.id).toBeLessThan(MAP_SIZE);
      expect(dot.y, region.id).toBeGreaterThan(0);
      expect(dot.y, region.id).toBeLessThan(MAP_SIZE);
    }
  });

  it('draws north at the top', () => {
    const north = geoToWorld({ lat: 22.2, lon: -159.5 });
    const south = geoToWorld({ lat: 21.9, lon: -159.5 });
    expect(worldToMap(north.wx, north.wz).y).toBeLessThan(worldToMap(south.wx, south.wz).y);
  });
});
