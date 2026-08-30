/**
 * THE INSTRUMENT THAT WAS MISSING.
 *
 * Joshua, after "I landed on it, settled below the water": "Add stats
 * first to show the distance to the nearest fresh or ocean water with
 * +/- markers. We have something already or that's not true?"
 *
 * We had half, and the half we had could not answer him — which is
 * what these tests are really pinning.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadIsland } from './support/island';
import { groundHeight } from '../src/world/heightfield';
import { geoToWorld } from '../src/world/geo';
import { nearestSea } from '../src/world/nearestWater';
import { readHeight } from '../src/ui/FlightHud';

/** Joshua's screenshot spot — a beach, so the sea is close. */
const BEACH = { lat: 22.10664908, lon: -159.30305567 };
/** Waiʻaleʻale, the middle of the island — the sea is a long way off. */
const INLAND = { lat: 22.0700, lon: -159.4980 };

describe('finding the sea', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('answers zero when she is already over it', () => {
    // Well offshore: ground below zero IS the sea.
    const at = geoToWorld({ lat: 22.30, lon: -159.30 });
    expect(groundHeight(at.wx, at.wz)).toBeLessThan(0);
    expect(nearestSea(at.wx, at.wz)?.range).toBe(0);
  });

  it('finds it close from a beach', () => {
    const at = geoToWorld(BEACH);
    const found = nearestSea(at.wx, at.wz);
    expect(found).not.toBeNull();
    // A beach is a beach: within a couple of kilometres, not thirty.
    expect(found!.range).toBeLessThan(200_000);
    console.log(`beach -> sea ${(found!.range / 100).toFixed(0)} m`
      + ` at ${Math.round((found!.bearing * 180) / Math.PI + 360) % 360}°`);
  }, 120000);

  it('and further from the middle of the island', () => {
    const inland = geoToWorld(INLAND);
    const beach = geoToWorld(BEACH);
    const far = nearestSea(inland.wx, inland.wz);
    const near = nearestSea(beach.wx, beach.wz);
    expect(far).not.toBeNull();
    expect(far!.range).toBeGreaterThan(near!.range);
    console.log(`inland -> sea ${(far!.range / 100_000).toFixed(2)} km`);
  }, 120000);

  it('and what it points at really is sea', () => {
    const at = geoToWorld(BEACH);
    const found = nearestSea(at.wx, at.wz)!;
    const x = at.wx + Math.sin(found.bearing) * found.range;
    const z = at.wz + Math.cos(found.bearing) * found.range;
    // At the reported range it is water; a little short of it, land.
    expect(groundHeight(x, z)).toBeLessThan(0);
    const back = 150;
    expect(groundHeight(
      at.wx + Math.sin(found.bearing) * (found.range - back),
      at.wz + Math.cos(found.bearing) * (found.range - back),
    )).toBeGreaterThanOrEqual(0);
  }, 120000);
});

describe('the readout can say UNDER, which it could not before', () => {
  it('formats a negative height as a negative', () => {
    expect(readHeight(-45)).toBe('-45 cm');
    expect(readHeight(-0.5)).toBe('-5.0 mm');
    expect(readHeight(7)).toBe('7.0 cm');
  });

  it('and AWL is no longer clamped at zero', () => {
    const hud = readFileSync('src/ui/FlightHud.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // THE BUG: `Math.max(0, now.awl)` made the one readout that could
    // have reported being under the water incapable of saying so.
    expect(hud).not.toContain('readHeight(Math.max(0, now.awl))');
    expect(hud).toContain('readHeight(now.awl)');
  });
});

describe('the scene composes the line', () => {
  const scene = () => readFileSync('src/scenes/IslandScene.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('signed against the DRAWN surface, not the queried one', () => {
    const body = scene();
    expect(body).toContain('const skin = this.water?.skinAt(here.wx, here.wz) ?? null;');
    expect(body).toContain('say(herY - skin.skin)');
  });

  it('with a range and bearing to each kind', () => {
    const body = scene();
    expect(body).toContain('this.water?.nearestFresh(here.wx, here.wz)');
    expect(body).toContain('nearestSea(here.wx, here.wz)');
  });

  it('on a cadence, because a ray march is not frame work', () => {
    const body = scene();
    expect(body).toContain('this.waterDue -= dt;');
    expect(body).toContain('if (this.waterDue > 0) return;');
  });
});
