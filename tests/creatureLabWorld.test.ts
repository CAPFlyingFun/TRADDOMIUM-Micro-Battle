/**
 * The Creature Lab's world: a bounded metre, a block whose top is the
 * ground, a bumpy patch, a real puddle, plants the resource layer knows,
 * resources the brains can find, disturbances that expire, and five
 * deterministic spawns each on a surface its medium allows.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BLOCK, BLOCK_CLEARANCE, BUMP, CREATURE_SPECIES, DISTURB_HOLD_S, EARTHWORM, HOUSEFLY, LAB_CREATURE_IDS, LAB_FLOOR, LAB_HALF,
  LAB_PLANTS, LAB_SITES, LAB_SIZE, LITTER_CORNER, PUDDLE, PUDDLE_EDGE, QUEEN, WORKER, createLabWorld, floorAt, isLand, labSpawns,
  nearestSite, newCreature, onBlock, puddleDepthAt, unitsOfMm,
} from '../src/creatures';
import { hostPlantOf } from '../src/creatures/intent';
import { distance, world } from '../src/world/coords';
import { HONEYDEW_HOST_FAMILIES } from '../src/world/ecology/resources';
import { SEA_LEVEL } from '../src/world/heightfield';
import { OBJECT_FAMILIES } from '../src/world/objects/families';

describe('the box', () => {
  it('is a metre a side on the origin, a metre above the sea, and the bounds say so with a margin', () => {
    const lab = createLabWorld();
    expect(LAB_SIZE).toBe(100);
    expect(LAB_HALF).toBe(50);
    expect(LAB_FLOOR).toBeGreaterThan(SEA_LEVEL);
    expect(lab.inBounds(world(0, 0))).toBe(true);
    expect(lab.inBounds(world(50, -50))).toBe(true);
    expect(lab.inBounds(world(50.01, 0))).toBe(false);
    expect(lab.inBounds(world(0, -50.01))).toBe(false);
    expect(lab.inBounds(world(48, 0), 5)).toBe(false);
    expect(lab.inBounds(world(44, 0), 5)).toBe(true);
    expect(lab.inBounds(world(NaN, 0))).toBe(false);
  });

  it('the floor is flat, the block\'s top is the ground over its footprint and nothing else is, and the ground is finite everywhere inside', () => {
    const lab = createLabWorld();
    expect(lab.groundAt(world(40, 10))).toBe(LAB_FLOOR);
    expect(lab.groundAt(world(0, 0))).toBe(LAB_FLOOR + BLOCK.height);
    expect(lab.groundAt(world(BLOCK.size / 2, BLOCK.size / 2))).toBe(LAB_FLOOR + BLOCK.height);
    expect(lab.groundAt(world(BLOCK.size / 2 + 0.01, 0))).toBe(LAB_FLOOR);
    expect(onBlock(world(-10, 10))).toBe(true);
    expect(onBlock(world(-10.01, 10))).toBe(false);
    // A cliff at the edge: the normal tips over.
    expect(lab.normalAt(world(40, 10)).ny).toBeCloseTo(1, 12);
    expect(lab.normalAt(world(BLOCK.size / 2, 0)).ny).toBeLessThan(0.1);
    for (let x = -50; x <= 50; x += 2.5) {
      for (let z = -50; z <= 50; z += 2.5) expect(Number.isFinite(lab.groundAt(world(x, z)))).toBe(true);
    }
    expect(Number.isNaN(lab.groundAt(world(NaN, 0)))).toBe(true);
  });

  it('the patch is uneven within ±5 mm, deterministic, and flat ground all round it', () => {
    const lab = createLabWorld();
    const other = createLabWorld();
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -1; x <= 1; x += 0.05) {
      for (let z = -1; z <= 1; z += 0.05) {
        const at = world(BUMP.at.wx + x * BUMP.size / 2, BUMP.at.wz + z * BUMP.size / 2);
        const g = lab.groundAt(at);
        expect(g).toBe(other.groundAt(at));
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(LAB_FLOOR - BUMP.amplitude - 1e-9);
    expect(hi).toBeLessThanOrEqual(LAB_FLOOR + BUMP.amplitude + 1e-9);
    expect(hi - lo).toBeGreaterThan(BUMP.amplitude);
    expect(lab.groundAt(world(BUMP.at.wx + BUMP.size / 2 + 1, BUMP.at.wz))).toBe(LAB_FLOOR);
  });

  it('the habitat is grassland everywhere, in the classifier\'s shape', () => {
    const lab = createLabWorld();
    for (const at of [world(0, 0), world(-49, 49), world(30, -30)]) {
      expect(lab.habitatAt(at).kind).toBe('grassland');
      expect(lab.habitatAt(at).elevation).toBe(LAB_FLOOR);
    }
  });
});

describe('the puddle', () => {
  it('is a dish five millimetres deep at its centre, nothing at its rim, full to the floor, never the sea', () => {
    const lab = createLabWorld();
    expect(lab.water).not.toBeNull();
    expect(puddleDepthAt(PUDDLE.at)).toBe(PUDDLE.depth);
    expect(lab.water.freshDepthAt(PUDDLE.at)).toBe(0.5);
    expect(lab.water.freshDepthAt(world(PUDDLE.at.wx + PUDDLE.radius, PUDDLE.at.wz))).toBe(0);
    expect(lab.water.freshDepthAt(world(0, 0))).toBe(0);
    const half = world(PUDDLE.at.wx + PUDDLE.radius / 2, PUDDLE.at.wz);
    expect(lab.water.freshDepthAt(half)).toBeCloseTo(PUDDLE.depth * 0.75, 12);
    // The ground is the dish and the water fills it to the floor: the surface a fly measures from is the floor's level.
    expect(lab.groundAt(PUDDLE.at)).toBeCloseTo(LAB_FLOOR - PUDDLE.depth, 12);
    expect(floorAt(lab, PUDDLE.at)).toBeCloseTo(LAB_FLOOR, 12);
    expect(lab.water.isSeaAt(PUDDLE.at)).toBe(false);
    expect(lab.water.isSeaAt(world(-50, -50))).toBe(false);
    // Dry is dry: the puddle is not land, its bank is.
    expect(isLand(lab, PUDDLE.at)).toBe(false);
    expect(isLand(lab, PUDDLE_EDGE)).toBe(true);
    expect(isLand(lab, world(0, 0))).toBe(true);
  });

  it('the nearest water is the nearest point of the rim, from outside and from inside, within the radius asked', () => {
    const lab = createLabWorld();
    const out = world(PUDDLE.at.wx + 20, PUDDLE.at.wz);
    const edge = lab.water.nearestWater(out, 100);
    expect(edge).not.toBeNull();
    expect(edge!.distance).toBeCloseTo(15, 12);
    expect(edge!.at.wx).toBeCloseTo(PUDDLE.at.wx + PUDDLE.radius, 12);
    expect(edge!.at.wz).toBeCloseTo(PUDDLE.at.wz, 12);
    expect(lab.water.nearestWater(out, 10)).toBeNull();
    const inside = world(PUDDLE.at.wx, PUDDLE.at.wz + 2);
    const rim = lab.water.nearestWater(inside, 100);
    expect(rim!.distance).toBeCloseTo(3, 12);
    expect(rim!.at.wz).toBeCloseTo(PUDDLE.at.wz + PUDDLE.radius, 12);
    expect(lab.water.nearestWater(PUDDLE.at, 100)!.distance).toBeCloseTo(PUDDLE.radius, 12);
    expect(lab.water.nearestWater(out, 0)).toBeNull();
    // The water-edge site stands on the bank, half a unit off the rim.
    expect(distance(PUDDLE_EDGE, PUDDLE.at)).toBeCloseTo(PUDDLE.radius + 0.5, 9);
  });
});

describe('the plants and the resources', () => {
  it('five plants of families the objects and the resource layer know, each with an id its cell can find', () => {
    const lab = createLabWorld();
    expect(LAB_PLANTS.map((p) => p.family)).toEqual(['grass', 'flower', 'broadleaf', 'shrub', 'fern']);
    for (const p of LAB_PLANTS) {
      expect(OBJECT_FAMILIES).toContain(p.family);
      expect(p.id).toMatch(/^[a-z]+:-?\d+,-?\d+:\d+$/);
      expect(lab.inBounds(p.at)).toBe(true);
      expect(onBlock(p.at)).toBe(false);
      const m = /^[^:]+:(-?\d+),(-?\d+):/.exec(p.id!)!;
      expect(lab.plantsOf(Number(m[1]), Number(m[2]))).toContain(p);
    }
    expect(lab.plants).toBe(LAB_PLANTS);
    // A cell with nothing is generated and empty, never "not yet".
    expect(lab.plantsOf(40, 40)).toEqual([]);
    expect(lab.resourcesOf(40, 40)).toEqual({ cx: 40, cz: 40, sites: [] });
  });

  it('the aphid\'s host is a family the aphid sits on and the layer offers honeydew hosts at', () => {
    const broadleaf = LAB_PLANTS.find((p) => p.family === 'broadleaf')!;
    expect(APHID.population.hosts).toContain('broadleaf');
    expect(HONEYDEW_HOST_FAMILIES).toContain('broadleaf');
    const aphid = labSpawns().find((s) => s.species === 'aphid')!;
    expect(aphid.hostId).toBe(broadleaf.id);
    expect(hostPlantOf(newCreature(aphid), createLabWorld())).toBe(broadleaf);
  });

  it('offers nectar, seed, sap, litter, a honeydew host, a water edge and a protein test carrion, each findable by the brains', () => {
    const lab = createLabWorld();
    const kinds = LAB_SITES.map((s) => s.kind).sort();
    expect(kinds).toEqual(['carrion', 'honeydew-host', 'litter', 'nectar', 'sap', 'seed', 'water-edge']);
    for (const s of LAB_SITES) {
      expect(lab.inBounds(s.at)).toBe(true);
      expect(nearestSite(lab, world(0, 0), [s.kind], LAB_SIZE * 2)).toBe(s);
      expect(s.id).toMatch(/^[a-z-]+:-?\d+,-?\d+:\d+$/);
    }
    // The worm's litter is in its corner; the worker's protein is the carrion.
    expect(nearestSite(lab, LITTER_CORNER, EARTHWORM.needs.eats, 1)!.kind).toBe('litter');
    expect(WORKER.needs.eats).toContain('carrion');
    expect(nearestSite(lab, world(0, 0), ['carrion'], LAB_SIZE)).not.toBeNull();
    // The flower's nectar is at its head, the sap on the broadleaf's stem, and the water edge on the bank.
    const nectar = LAB_SITES.find((s) => s.kind === 'nectar')!;
    const flower = LAB_PLANTS.find((p) => p.family === 'flower')!;
    expect(nectar.at).toBe(flower.at);
    expect(nectar.above).toBe(flower.size);
    expect(nectar.ownerId).toBe(flower.id);
    expect(LAB_SITES.find((s) => s.kind === 'water-edge')!.at).toBe(PUDDLE_EDGE);
    expect(isLand(lab, PUDDLE_EDGE)).toBe(true);
    // Every kind a lab animal eats is offered here, so nobody starves in the box.
    for (const id of LAB_CREATURE_IDS) {
      for (const kind of CREATURE_SPECIES[id].needs.eats) expect(kinds, `${id} eats ${kind}`).toContain(kind);
    }
  });
});

describe('disturbances and the sky', () => {
  it('a disturbance stands for its hold on the lab\'s clock and then goes; calm drops them; the camera is one only while switched on', () => {
    const lab = createLabWorld();
    expect(lab.disturbances()).toEqual([]);
    const tap = { at: world(10, 10), height: LAB_FLOOR, radius: 2 };
    lab.disturb(tap);
    expect(lab.disturbances()).toEqual([tap]);
    lab.advance(DISTURB_HOLD_S / 2);
    expect(lab.disturbances()).toEqual([tap]);
    lab.advance(DISTURB_HOLD_S / 2 + 1e-9);
    expect(lab.disturbances()).toEqual([]);
    lab.disturb(tap, 10);
    lab.disturb({ ...tap, at: world(-10, 0) }, 10);
    expect(lab.disturbances()).toHaveLength(2);
    const eye = { at: world(0, 0), height: LAB_FLOOR + 30, radius: 20 };
    lab.setCameraDisturbance(eye);
    expect(lab.disturbances()).toHaveLength(3);
    expect(lab.disturbances()).toContain(eye);
    lab.calm();
    expect(lab.disturbances()).toEqual([eye]);
    lab.setCameraDisturbance(null);
    expect(lab.disturbances()).toEqual([]);
    // The list is stable between changes: no allocation per read.
    lab.disturb(tap);
    const a = lab.disturbances();
    expect(lab.disturbances()).toBe(a);
    // A bad dt does not move the clock.
    lab.advance(NaN);
    lab.advance(-5);
    expect(lab.disturbances()).toEqual([tap]);
  });

  it('the sky defaults to calm daylight and can be set', () => {
    const lab = createLabWorld();
    expect(lab.weather()).toEqual({ rainMmHr: 0, windX: 0, windZ: 0, night: false });
    const rain = { rainMmHr: 3, windX: 0, windZ: 0, night: true };
    lab.setWeather(rain);
    expect(lab.weather()).toBe(rain);
    expect(createLabWorld({ weather: null }).weather()).toBeNull();
    expect(createLabWorld({ weather: rain }).weather()).toBe(rain);
  });
});

describe('soft containment', () => {
  it('an inward target lies toward the middle, inside the box, clear of the block, and never past the origin', () => {
    const lab = createLabWorld();
    const clear = BLOCK.size / 2 + BLOCK_CLEARANCE;
    for (const at of [world(48, 48), world(-49, 0), world(0, 49), world(30, -45), world(12, 0), world(3, 2)]) {
      const t = lab.inwardTarget(at);
      expect(lab.inBounds(t), JSON.stringify(at)).toBe(true);
      expect(onBlock(t), JSON.stringify(at)).toBe(false);
      expect(Math.max(Math.abs(t.wx), Math.abs(t.wz))).toBeGreaterThanOrEqual(clear - 1e-9);
      // Never further from the middle than it started — unless it started inside the block's clearance, when it is put on the clearance.
      expect(distance(t, world(0, 0))).toBeLessThanOrEqual(Math.max(distance(at, world(0, 0)), clear * Math.SQRT2) + 1e-9);
      // Same ray: the cross product with the direction to the origin is nothing.
      expect(Math.abs(at.wx * t.wz - at.wz * t.wx)).toBeLessThan(1e-6);
    }
    // A quarter of the box by default, from the far corner along the diagonal.
    const corner = lab.inwardTarget(world(48, 48));
    expect(distance(corner, world(48, 48))).toBeCloseTo(LAB_HALF / 2, 9);
    // On the origin, or nowhere: a spot clear of the block.
    expect(onBlock(lab.inwardTarget(world(0, 0)))).toBe(false);
    expect(onBlock(lab.inwardTarget(world(NaN, NaN)))).toBe(false);
    expect(lab.inwardTarget(world(40, 0), 5)).toEqual(world(35, 0));
  });
});

describe('the five', () => {
  it('spawn deterministically: the same five in the same places with the same needs, fresh each time, round-tripping JSON', () => {
    const a = labSpawns();
    const b = labSpawns();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.map((s) => s.species)).toEqual(LAB_CREATURE_IDS);
    expect(new Set(a.map((s) => s.id)).size).toBe(5);
    for (const s of a) expect(s.id).toMatch(new RegExp(`^${s.species}:-?\\d+,-?\\d+:0$`));
  });

  it('each stands on a surface its medium allows, inside the box, off the water, and its cell key is its own', () => {
    const lab = createLabWorld();
    const spawns = labSpawns();
    for (const s of spawns) {
      expect(lab.inBounds(s.at), s.id).toBe(true);
      expect(isLand(lab, s.at), s.id).toBe(true);
      expect(s.cellKey).toBe(`${Math.floor(s.at.wx / 1600)},${Math.floor(s.at.wz / 1600)}`);
      expect(Number.isFinite(s.height)).toBe(true);
    }
    const by = (id: string) => spawns.find((s) => s.species === id)!;
    const ground = (s: { at: { wx: number; wz: number } }) => lab.groundAt(world(s.at.wx, s.at.wz));
    // The ants stand on the floor beside the block, not on it.
    for (const id of ['queen', 'worker'] as const) {
      const s = by(id);
      expect(s.height).toBe(ground(s));
      expect(s.height).toBe(LAB_FLOOR);
      expect(onBlock(s.at)).toBe(false);
      expect(distance(s.at, BLOCK.at)).toBeLessThan(BLOCK.size);
      expect(s.behaviour).toBe('idle');
    }
    // The worm is in its band under the litter corner, burrowing.
    const worm = by('earthworm');
    const under = unitsOfMm(EARTHWORM.burrow!.underMm);
    const half = unitsOfMm(EARTHWORM.burrow!.boreMm) / 2;
    expect(worm.at).toEqual(LITTER_CORNER);
    expect(worm.height).toBeLessThanOrEqual(ground(worm) - half);
    expect(worm.height).toBeGreaterThanOrEqual(ground(worm) - under);
    expect(worm.behaviour).toBe('burrow');
    // The aphid is on its host's stem, between the foot and the tip.
    const aphid = by('aphid');
    const broadleaf = LAB_PLANTS.find((p) => p.family === 'broadleaf')!;
    expect(aphid.at).toBe(broadleaf.at);
    expect(aphid.height).toBeGreaterThan(ground(aphid));
    expect(aphid.height).toBeLessThanOrEqual(ground(aphid) + broadleaf.size);
    // The fly is perched on the flower's head, idle, over the floor.
    const fly = by('housefly');
    const flower = LAB_PLANTS.find((p) => p.family === 'flower')!;
    expect(fly.at).toBe(flower.at);
    expect(fly.height).toBe(ground(fly) + flower.size);
    expect(fly.height).toBeGreaterThanOrEqual(floorAt(lab, fly.at));
    expect(fly.behaviour).toBe('idle');
    // Needs start below every threshold, so nobody goes looking for food on the first think.
    for (const s of spawns) {
      const species = CREATURE_SPECIES[s.species];
      expect(s.hunger!).toBeLessThan(species.needs.feedAt);
      expect(s.fatigue!).toBeLessThan(species.needs.restAt);
    }
    // And `newCreature` takes each as it stands.
    for (const s of spawns) {
      const c = newCreature(s);
      expect(c.species).toBe(s.species);
      expect(c.lengthMm).toBe(CREATURE_SPECIES[s.species].lengthMm);
    }
    expect(QUEEN.medium).toBe('ground');
    expect(HOUSEFLY.medium).toBe('air');
  });
});
