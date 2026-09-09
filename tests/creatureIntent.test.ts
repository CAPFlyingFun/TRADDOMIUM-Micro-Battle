/**
 * The brain: every word it chooses is its medium's; the worm surfaces
 * for rain, night and litter and flees down; the aphid never leaves its
 * host; the fly never aims at the sea, is grounded by rain, is drawn to
 * a resource and takes off from a disturbance; needs climb and come
 * back; an alarm is noticed between thinks; a flood is noticed when its
 * edge is nearer than it was, or already underfoot, and fled the way a
 * disturbance is; the fly's heights hang from the water's surface where
 * water stands, dry land is dry, and a fly does not perch on water; and
 * a thousand seconds of any of them is finite.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BEHAVIOURS_BY_MEDIUM, CREATURE_IDS, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, QUEEN, WORKER, newCreature, unitsOfMm,
  type CreatureSpecies, type CreatureState, type CreatureWeather, type CreatureWorld, type Disturbance,
} from '../src/creatures';
import {
  ALARM_FLEES_AT, FLOOD_CLOSING, FLOOD_THREAT, GROUND_HOME_RANGE, GROUND_WANDER_LENGTHS, HOST_WALK_LENGTHS, RAINING_MM_HR, hostPlantOf,
  isLand, nearestSite, senseAlarm, senseFlood, think, thinkDue, thinkPending, tickNeeds,
} from '../src/creatures/intent';
import { unitsOfMetres } from '../src/creatures/finder';
import { floorAt, isAirborne, move } from '../src/creatures/locomotion';
import { HOST_FLEE_LENGTHS } from '../src/creatures/intent';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { CellResources, PlantSource, ResourceSite, WaterQuery } from '../src/world/ecology/resources';
import { SEA_HABITAT, type Habitat, type HabitatKind } from '../src/world/habitat';
import { SEA_LEVEL } from '../src/world/heightfield';
import { CELL_SPAN } from '../src/world/objects/cells';
import { mulberry32 } from '../src/world/random';
import { WATER_SIM_DEFAULTS } from '../src/world/water/sim';

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 0, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

/** Land west of the line, sea east of it. */
const SEA_EAST_OF = 2000;
const ground = (at: WorldPoint): number => (at.wx < SEA_EAST_OF ? 200 + Math.sin(at.wx / 300) * 10 + Math.cos(at.wz / 400) * 8 : -100);

interface Fake extends CreatureWorld {
  sky: CreatureWeather | null;
  list: Disturbance[];
  sites: ResourceSite[];
  plants: PlantSource[];
  /** The nest stand-in, when a test names one (`CreatureWorld.home`). */
  home?: WorldPoint;
}

/** The sea east of the line and nothing fresh anywhere: the water most of these tests stand beside. */
const SEA_ONLY: WaterQuery = { freshDepthAt: () => 0, isSeaAt: (at) => at.wx >= SEA_EAST_OF, nearestWater: () => null };

function fakeWorld(water: WaterQuery | null = SEA_ONLY): Fake {
  const w: Fake = {
    sky: null,
    list: [],
    sites: [],
    plants: [],
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => (at.wx < SEA_EAST_OF ? habitat('shrubland', ground(at)) : SEA_HABITAT),
    plantsOf: () => w.plants,
    resourcesOf: (cx, cz): CellResources | null => {
      const sites = w.sites.filter((s) => Math.floor(s.at.wx / CELL_SPAN) === cx && Math.floor(s.at.wz / CELL_SPAN) === cz);
      return { cx, cz, sites };
    },
    water,
    weather: () => w.sky,
    disturbances: () => w.list,
  };
  return w;
}

/**
 * A pond on the shrubland, `POND_DEPTH` over the ordinary ground: fresh
 * water STANDING ON LAND, which is what the heightfield, the habitat and
 * the old `isLand` all called dry. The sea is still east of the line.
 * Four metres wide and twelve long, so that from its centre a fly's
 * longest hop (3 m, `hopMm`) reaches the bank due west and is still
 * over water due north — the two draws the deterministic tests below
 * lean on, since a hop's distance is now derived from `hopS × cruise`
 * and clamped to `hopMm` rather than drawn from `hopMm` itself.
 */
const POND = Object.freeze({ x0: 1000, x1: 1400, z0: 600, z1: 1800 });
const POND_DEPTH = 30;
const inPond = (at: WorldPoint): boolean => at.wx >= POND.x0 && at.wx < POND.x1 && at.wz >= POND.z0 && at.wz < POND.z1;
function pondWorld(): Fake {
  return fakeWorld({
    freshDepthAt: (at) => (inPond(at) ? POND_DEPTH : 0),
    isSeaAt: (at) => at.wx >= SEA_EAST_OF,
    nearestWater: () => null,
  });
}

function spawn(species: CreatureSpecies, at: WorldPoint, hostId: string | null = null, phase = 0.3): CreatureState {
  const g = ground(at);
  const height = species.burrow !== null ? g - unitsOfMm(species.burrow.underMm) : hostId !== null ? g + 10 : g;
  const c = newCreature({
    id: `${species.id}:0,0:1`, species: species.id, cellKey: '0,0', at, height, heading: 0.4, phase,
    behaviour: species.burrow !== null ? 'burrow' : 'idle', hostId, hunger: 0.1, fatigue: 0.1,
  });
  c.sinceThink = c.phase * species.thinkS;
  return c;
}

/** One simulation step of a single creature, the way the simulation does it. Returns whether it thought. */
function step(c: CreatureState, species: CreatureSpecies, w: Fake, rand: () => number, dt: number, host?: PlantSource | null): boolean {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.list);
  let thought = false;
  if (thinkDue(c, species)) {
    think(c, species, w, rand, w.sky, host);
    thought = true;
  }
  move(c, species, w, dt);
  return thought;
}

function finite(c: CreatureState): void {
  for (const v of [c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm, c.behaviourS, c.behaviourUntilS, c.sinceThink]) {
    expect(Number.isFinite(v)).toBe(true);
  }
  if (c.target !== null) expect(Number.isFinite(c.target.wx) && Number.isFinite(c.target.wz)).toBe(true);
}

const SHRUB: PlantSource = { family: 'shrub', at: world(500, 500), size: 40, id: 'shrub:0,0:3', variant: 0 };

/**
 * THE RESEARCH'S APHID FEEDS FOR HOURS (feedS 15-60 min, Walker 2024;
 * Garzo 2002), so a ten-minute soak of the table's animal is a still
 * animal — correct, and useless for a test of walking. This one feeds
 * for seconds so the walks happen inside the soak; nothing else differs.
 */
const BRIEF_APHID: CreatureSpecies = { ...APHID, needs: { ...APHID.needs, feedS: [30, 120] as readonly [number, number] } };

describe('the vocabulary and a thousand seconds', () => {
  it('every species, fuzzed for 1,000 s with a seeded rand, uses only its medium words and changes behaviour without a disturbance', () => {
    for (const id of CREATURE_IDS) {
      const species = id === 'aphid' ? BRIEF_APHID : CREATURE_SPECIES[id];
      const w = fakeWorld();
      w.plants = [SHRUB];
      const rand = mulberry32(id.length * 977 + 3);
      const c = spawn(species, world(500, 500), species.population.hosts !== null ? SHRUB.id : null);
      const seen = new Set<string>();
      const dt = 1 / 30;
      // An act is a new word or a new target: a worm's fresh heading is an act, though the word stays `burrow`.
      let acts = 0;
      let lastWord = c.behaviour;
      let lastTarget = c.target;
      const wrongWords: string[] = [];
      let nonFinite = 0;
      for (let i = 0; i < 1000 * 30; i += 1) {
        step(c, species, w, rand, dt, species.population.hosts !== null ? SHRUB : null);
        if (!BEHAVIOURS_BY_MEDIUM[species.medium].includes(c.behaviour)) wrongWords.push(c.behaviour);
        if (i < 150 * 30 && (c.behaviour !== lastWord || c.target !== lastTarget)) acts += 1;
        lastWord = c.behaviour;
        lastTarget = c.target;
        seen.add(c.behaviour);
        if (![c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm].every(Number.isFinite)) nonFinite += 1;
      }
      expect(wrongWords, id).toEqual([]);
      expect(nonFinite, id).toBe(0);
      expect(acts, `${id} did nothing in its first two and a half minutes`).toBeGreaterThanOrEqual(2);
      expect(seen.size, id).toBeGreaterThanOrEqual(3);
      finite(c);
    }
  }, 60_000);
});

describe('the clocks and the alarm', () => {
  it('hunger climbs while not feeding and returns to nothing over the feed; fatigue climbs while moving and returns over the rest', () => {
    const c = spawn(HOUSEFLY, world(100, 100));
    c.behaviour = 'fly';
    c.hunger = 0;
    c.fatigue = 0;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.hunger).toBeCloseTo(10 * HOUSEFLY.needs.hungerPerS, 9);
    expect(c.fatigue).toBeCloseTo(10 * HOUSEFLY.needs.fatiguePerS, 9);
    c.behaviour = 'feed';
    c.behaviourUntilS = 10;
    c.hunger = 1;
    tickNeeds(c, HOUSEFLY, 5);
    expect(c.hunger).toBeCloseTo(0.5, 9);
    tickNeeds(c, HOUSEFLY, 50);
    expect(c.hunger).toBe(0);
    c.behaviour = 'rest';
    c.behaviourUntilS = 20;
    c.fatigue = 1;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.fatigue).toBeCloseTo(0.5, 9);
    c.behaviour = 'idle';
    const f = c.fatigue;
    tickNeeds(c, HOUSEFLY, 10);
    expect(c.fatigue).toBe(f);
  });

  it('thinkPending looks and thinkDue takes: the peek never consumes the accumulator', () => {
    const c = spawn(HOUSEFLY, world(100, 100), null, 0.1);
    expect(thinkPending(c, HOUSEFLY)).toBe(false);
    tickNeeds(c, HOUSEFLY, HOUSEFLY.thinkS);
    expect(thinkPending(c, HOUSEFLY)).toBe(true);
    expect(thinkPending(c, HOUSEFLY)).toBe(true);
    expect(thinkDue(c, HOUSEFLY)).toBe(true);
    expect(thinkPending(c, HOUSEFLY)).toBe(false);
  });

  it('thinkDue fires once per thinkS, honours the phase, and a long step earns one thought', () => {
    const c = spawn(HOUSEFLY, world(100, 100), null, 0.5);
    let thoughts = 0;
    for (let i = 0; i < 600; i += 1) {
      tickNeeds(c, HOUSEFLY, 1 / 60);
      if (thinkDue(c, HOUSEFLY)) thoughts += 1;
    }
    expect(Math.abs(thoughts - 10 / HOUSEFLY.thinkS)).toBeLessThanOrEqual(1);
    const late = spawn(HOUSEFLY, world(100, 100), null, 0.9);
    const early = spawn(HOUSEFLY, world(100, 100), null, 0.1);
    tickNeeds(late, HOUSEFLY, HOUSEFLY.thinkS * 0.2);
    tickNeeds(early, HOUSEFLY, HOUSEFLY.thinkS * 0.2);
    expect(thinkDue(late, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(false);
    tickNeeds(early, HOUSEFLY, 5);
    expect(thinkDue(early, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(true);
    expect(thinkDue(early, HOUSEFLY)).toBe(false);
  });

  it('a disturbance inside alarmMm plus its radius raises the alarm to 1, sets the away point once, and the alarm decays over alarmS', () => {
    const c = spawn(EARTHWORM, world(100, 100));
    const reach = unitsOfMm(EARTHWORM.senses.alarmMm);
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 0 }])).toBe(false);
    expect(c.alarm).toBe(0);
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 6 }])).toBe(true);
    expect(c.alarm).toBe(1);
    expect(c.target).not.toBeNull();
    expect(c.target!.wx).toBeLessThan(100); // away: west of the worm, the camera being east
    expect(c.sinceThink).toBe(EARTHWORM.thinkS); // the next think is now
    const away = c.target;
    expect(senseAlarm(c, EARTHWORM, [{ at: world(100 + reach + 5, 100), height: c.height, radius: 6 }])).toBe(false);
    expect(c.target).toBe(away);
    // A camera high overhead is not on top of it: the distance is three-dimensional.
    const calm = spawn(EARTHWORM, world(100, 100));
    expect(senseAlarm(calm, EARTHWORM, [{ at: world(100, 100), height: c.height + reach * 2, radius: 0 }])).toBe(false);
    tickNeeds(c, EARTHWORM, EARTHWORM.senses.alarmS / 2);
    expect(c.alarm).toBeCloseTo(0.5, 9);
    tickNeeds(c, EARTHWORM, EARTHWORM.senses.alarmS);
    expect(c.alarm).toBe(0);
  });
});

/**
 * A world whose fresh water is everything EAST of a straight bank at
 * `wx = bank` — the flood sense's whole question is where the edge is
 * and whether it moved, so the fake is an edge the test can move. Null
 * bank: no water at all, anywhere.
 */
function floodWorld(): Fake & { bank: number | null } {
  const w: Fake & { bank: number | null } = {
    bank: null,
    sky: null,
    list: [],
    sites: [],
    plants: [],
    groundAt: ground,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: (at) => habitat('shrubland', ground(at)),
    plantsOf: () => w.plants,
    resourcesOf: () => null,
    water: {
      freshDepthAt: (at) => (w.bank !== null && at.wx >= w.bank ? 10 : 0),
      isSeaAt: () => false,
      nearestWater: (at, radius) => {
        if (w.bank === null) return null;
        const distance = Math.abs(at.wx - w.bank);
        return distance < radius ? { at: world(w.bank, at.wz), distance } : null;
      },
    },
    weather: () => w.sky,
    disturbances: () => w.list,
  };
  return w;
}

/** One step the way the simulation takes it, flood sense included: sensed at think cadence, just before the think. */
function stepFlood(c: CreatureState, species: CreatureSpecies, w: Fake, rand: () => number, dt: number): boolean {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.list);
  let thought = false;
  if (thinkPending(c, species)) {
    senseFlood(c, species, w);
    thinkDue(c, species);
    think(c, species, w, rand, w.sky, null);
    thought = true;
  }
  move(c, species, w, dt);
  return thought;
}

describe('the flood', () => {
  it('the threat radius is fifty metres, in world units', () => {
    expect(FLOOD_THREAT).toBe(unitsOfMetres(50));
    expect(FLOOD_THREAT).toBe(5000);
  });

  it('with no water known, nothing fires and the reading is -1', () => {
    const w = floodWorld();
    const dry: Fake = { ...w, water: null };
    const c = spawn(EARTHWORM, world(400, 400));
    c.waterEdge = 1234;
    expect(senseFlood(c, EARTHWORM, dry)).toBe(false);
    expect(c.waterEdge).toBe(-1);
    expect(c.alarm).toBe(0);
    expect(c.target).toBeNull();
    // Water known but none anywhere: the same.
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(-1);
    expect(c.alarm).toBe(0);
  });

  it('an edge in reach that is not closer is a reading, not a fright — and beyond reach it is no reading at all', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    // Beyond fifty metres: unseen.
    w.bank = 400 + FLOOD_THREAT + 100;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(-1);
    // Twenty metres off, first seen: remembered, not fled.
    w.bank = 400 + 2000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(2000);
    expect(c.alarm).toBe(0);
    expect(c.target).toBeNull();
    // Still there: still nothing.
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(2000);
    // Receding: nothing, and the new distance is kept.
    w.bank = 400 + 2500;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(2500);
    expect(c.alarm).toBe(0);
    // Gone out of reach again: back to -1, so its return is a reading and not a fright.
    w.bank = 400 + FLOOD_THREAT + 1;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(-1);
    w.bank = 400 + 3000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(0);
  });

  it('an edge that is nearer than it was raises the alarm once, away from the edge, and brings the think forward', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    w.bank = 400 + 1500;
    expect(senseFlood(c, EARTHWORM, w)).toBe(true);
    expect(c.alarm).toBe(1);
    expect(c.waterEdge).toBe(1500);
    expect(c.sinceThink).toBe(EARTHWORM.thinkS);
    // Away: the water is east, so the target is west, and as far as the worm's flee carries it.
    expect(c.target).not.toBeNull();
    expect(c.target!.wx).toBeLessThan(400);
    expect(c.target!.wz).toBeCloseTo(400, 6);
    expect(distance(c.at, c.target!)).toBeCloseTo(unitsOfMm(EARTHWORM.pace.fleeMmS) * EARTHWORM.senses.alarmS, 6);
    // Closer still while already alarmed: held up, not fired again, and the target stands.
    const away = c.target;
    w.bank = 400 + 1000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(1);
    expect(c.target).toBe(away);
    expect(c.waterEdge).toBe(1000);
    // The same fright as a disturbance: the away point is the one `senseAlarm` would have chosen for something at the edge.
    const twin = spawn(EARTHWORM, world(400, 400));
    senseAlarm(twin, EARTHWORM, [{ at: world(400 + 1500, 400), height: twin.height, radius: 1500 }]);
    const fresh = spawn(EARTHWORM, world(400, 400));
    fresh.waterEdge = 2000;
    fresh.waterEdgeFrom = fresh.at; // a watch is a distance AND the spot it was read from
    w.bank = 400 + 1500;
    senseFlood(fresh, EARTHWORM, w);
    expect(fresh.target!.wx).toBeCloseTo(twin.target!.wx, 9);
    expect(fresh.target!.wz).toBeCloseTo(twin.target!.wz, 9);
  });

  it('water already underfoot is a flood whether or not the edge moved, and with no edge in reach "away" is the reverse heading', () => {
    const w = floodWorld();
    // The bank is a metre WEST of the worm: it is standing in the water, and the edge has never been read.
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 - 100;
    expect(senseFlood(c, EARTHWORM, w)).toBe(true);
    expect(c.alarm).toBe(1);
    expect(c.waterEdge).toBe(100);
    // Away from the EDGE, which is west: east, deeper into the water — the far bank is where dry ground is not, but the edge is where the water is coming from.
    expect(c.target!.wx).toBeGreaterThan(400);
    // A pool with no edge within fifty metres: still a flood, fled along the reverse of the heading.
    const lost = spawn(EARTHWORM, world(400, 400));
    lost.heading = 0; // facing +z
    w.bank = 400 - FLOOD_THREAT - 1000;
    expect(senseFlood(lost, EARTHWORM, w)).toBe(true);
    expect(lost.waterEdge).toBe(-1);
    expect(lost.target!.wz).toBeLessThan(400);
    expect(lost.target!.wx).toBeCloseTo(400, 6);
  });

  it('the closing threshold is one solver cell, read from the solver', () => {
    expect(FLOOD_CLOSING).toBe(WATER_SIM_DEFAULTS.cell);
    expect(FLOOD_CLOSING).toBe(unitsOfMetres(1));
  });

  it('a wiggling edge — 20.00 m, 19.60 m, 20.00 m from a still creature — is the nearest cell flipping, not water coming', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdge).toBe(2000);
    // Forty centimetres nearer: less than a cell, so the watch holds at twenty metres and nothing fires.
    w.bank = 400 + 1960;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(0);
    expect(c.target).toBeNull();
    expect(c.waterEdge).toBe(2000);
    // Back where it was: still nothing, and still the same watch.
    w.bank = 400 + 2000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(0);
    expect(c.waterEdge).toBe(2000);
    // And again, for as long as it likes: a cell flipping back and forth never adds up to a flood.
    for (let i = 0; i < 20; i += 1) {
      w.bank = 400 + (i % 2 === 0 ? 1960 : 2000);
      expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    }
    expect(c.alarm).toBe(0);
    expect(c.waterEdge).toBe(2000);
    // Exactly one cell nearer is the line, and the line is not crossed: a one-cell flip is the smallest wiggle the lattice has.
    w.bank = 400 + 2000 - FLOOD_CLOSING;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(0);
  });

  it('an edge that has come a cell and a half — 20 m then 18.5 m from the same spot — is a flood, fled away from the edge', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    w.bank = 400 + 1850;
    expect(senseFlood(c, EARTHWORM, w)).toBe(true);
    expect(c.alarm).toBe(1);
    expect(c.sinceThink).toBe(EARTHWORM.thinkS);
    // The watch is retaken from here, at the new distance.
    expect(c.waterEdge).toBe(1850);
    expect(c.waterEdgeFrom).toBe(c.at);
    // Away: the water is east, so the target is west.
    expect(c.target).not.toBeNull();
    expect(c.target!.wx).toBeLessThan(400);
    expect(c.target!.wz).toBeCloseTo(400, 6);
  });

  it('a steady advance of one cell per think is a flood by the second think, however the thinks fall against the cells', () => {
    // The lattice can only ever move the reading a cell at a time, so a
    // watch replaced at every think would compare each cell against the
    // last and never see two: the whole reason the watch holds.
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    w.bank -= FLOOD_CLOSING;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false); // one cell: on the line, held
    expect(c.waterEdge).toBe(2000);
    w.bank -= FLOOD_CLOSING;
    expect(senseFlood(c, EARTHWORM, w)).toBe(true); // two cells against the held watch: coming
    expect(c.waterEdge).toBe(1800);
    // And at a tenth of a cell a think — a pond rising by the centimetre — the same, eleven thinks later.
    const slow = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    senseFlood(slow, EARTHWORM, w);
    let fired = false;
    let thinks = 0;
    while (!fired && thinks < 30) {
      w.bank -= FLOOD_CLOSING / 10;
      fired = senseFlood(slow, EARTHWORM, w);
      thinks += 1;
    }
    expect(fired).toBe(true);
    expect(thinks).toBe(11);
  });

  it('a creature that walks five metres toward still water is not spooked by its own approach', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    const perch = c.at;
    expect(c.waterEdgeFrom).toBe(perch);
    // Five metres east, toward the bank, between two thinks: the edge is fifteen metres off now — and, from the perch, still twenty.
    c.at = world(900, 400);
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.alarm).toBe(0);
    expect(c.target).toBeNull();
    // It has left the perch by more than a cell, so the watch is retaken from where it stands.
    expect(c.waterEdge).toBe(1500);
    expect(c.waterEdgeFrom).toBe(c.at);
    // Right up to the edge, a metre at a time: never a fright, only ever a new watch.
    for (let x = 1000; x < 2400; x += 100) {
      c.at = world(x, 400);
      expect(senseFlood(c, EARTHWORM, w)).toBe(false);
      expect(c.alarm).toBe(0);
    }
    // The fly, whose drink is the case that found this: perched twenty metres off, then five from the water's edge, calm both times.
    const fly = spawn(HOUSEFLY, world(600, 600));
    w.bank = 600 + 2000;
    expect(senseFlood(fly, HOUSEFLY, w)).toBe(false);
    fly.at = world(600 + 2000 - 500, 600);
    expect(senseFlood(fly, HOUSEFLY, w)).toBe(false);
    expect(fly.alarm).toBe(0);
    expect(fly.waterEdge).toBe(500);
    // Now the water comes a cell and a half while it drinks: THAT is a flood, and it is fled — west, away from the edge.
    w.bank -= FLOOD_CLOSING * 1.5;
    expect(senseFlood(fly, HOUSEFLY, w)).toBe(true);
    expect(fly.target!.wx).toBeLessThan(fly.at.wx);
  });

  it('a step of less than a cell keeps the watch; the water receding retakes it', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    const perch = c.at;
    // Half a cell east: still watching from the perch, at the perch's distance.
    c.at = world(450, 400);
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdgeFrom).toBe(perch);
    expect(c.waterEdge).toBe(2000);
    // The water goes: the watch is retaken from where the creature stands, at the new distance.
    w.bank = 400 + 2600;
    expect(senseFlood(c, EARTHWORM, w)).toBe(false);
    expect(c.waterEdgeFrom).toBe(c.at);
    expect(c.waterEdge).toBe(2550);
  });

  it('the spot is null exactly when the distance is -1', () => {
    const w = floodWorld();
    const c = spawn(EARTHWORM, world(400, 400));
    expect(c.waterEdge).toBe(-1);
    expect(c.waterEdgeFrom).toBeNull();
    const paired = (): void => {
      expect(c.waterEdgeFrom === null, `edge ${c.waterEdge} from ${JSON.stringify(c.waterEdgeFrom)}`).toBe(c.waterEdge === -1);
    };
    // No water anywhere.
    senseFlood(c, EARTHWORM, w);
    paired();
    expect(c.waterEdgeFrom).toBeNull();
    // Seen.
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    paired();
    expect(c.waterEdgeFrom).toBe(c.at);
    // Out of reach again.
    w.bank = 400 + FLOOD_THREAT + 1;
    senseFlood(c, EARTHWORM, w);
    paired();
    expect(c.waterEdgeFrom).toBeNull();
    // Seen, then the whole water gone.
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    paired();
    senseFlood(c, EARTHWORM, { ...w, water: null });
    paired();
    expect(c.waterEdgeFrom).toBeNull();
    // Underfoot with no edge in reach: the alarm fires with nothing to watch.
    w.bank = 400 - FLOOD_THREAT - 1000;
    expect(senseFlood(c, EARTHWORM, w)).toBe(true);
    paired();
    expect(c.waterEdgeFrom).toBeNull();
    // And the spot round-trips as a plain point, the way `at` does.
    w.bank = 400 + 2000;
    senseFlood(c, EARTHWORM, w);
    expect(JSON.parse(JSON.stringify(c)).waterEdgeFrom).toEqual({ wx: 400, wz: 400 });
  });

  it('a creeping bank makes a worm go to the bottom of its band and away, and a fly take off away, with no species branch', () => {
    // The bank starts thirty metres east and comes at ten centimetres a step; the worm flees within a think of its first advance.
    const w = floodWorld();
    const rand = mulberry32(41);
    const worm = spawn(EARTHWORM, world(400, 400));
    for (let i = 0; i < 30 * 3; i += 1) stepFlood(worm, EARTHWORM, w, rand, 1 / 30);
    const before = worm.at;
    w.bank = before.wx + 3000;
    let fled = false;
    for (let i = 0; i < 30 * 20 && !fled; i += 1) {
      w.bank -= 10;
      stepFlood(worm, EARTHWORM, w, rand, 1 / 30);
      if (worm.behaviour === 'flee') fled = true;
    }
    expect(fled).toBe(true);
    expect(worm.alarm).toBeGreaterThanOrEqual(ALARM_FLEES_AT);
    expect(worm.target!.wx).toBeLessThan(before.wx);
    for (let i = 0; i < 30 * 3; i += 1) stepFlood(worm, EARTHWORM, w, rand, 1 / 30);
    expect(worm.at.wx).toBeLessThan(before.wx);
    expect(worm.height).toBeCloseTo(ground(worm.at) - unitsOfMm(EARTHWORM.burrow!.underMm), 3);

    // The fly: perched on a long idle, only the water can lift it.
    const fly = spawn(HOUSEFLY, world(600, 600));
    fly.behaviour = 'idle';
    fly.behaviourUntilS = 100;
    fly.behaviourS = 1;
    const rest = fly.at;
    w.bank = rest.wx + 3000;
    let up = false;
    for (let i = 0; i < 30 * 20 && !up; i += 1) {
      w.bank -= 10;
      stepFlood(fly, HOUSEFLY, w, rand, 1 / 30);
      if (isAirborne(fly.behaviour)) up = true;
    }
    expect(up).toBe(true);
    expect(fly.target!.wx).toBeLessThan(rest.wx);
    for (let i = 0; i < 30 * 2; i += 1) stepFlood(fly, HOUSEFLY, w, rand, 1 / 30);
    expect(fly.at.wx).toBeLessThan(rest.wx);
    expect(fly.behaviour).not.toBe('flee'); // an air species never uses the word: it takes off
  });
});

describe('the worm', () => {
  const rain: CreatureWeather = { rainMmHr: RAINING_MM_HR * 2, windX: 0, windZ: 0, night: false };
  const night: CreatureWeather = { rainMmHr: 0, windX: 0, windZ: 0, night: true };

  it('surfaces when it rains and stays up while it does; surfaces at night; burrows in a dry day', () => {
    for (const sky of [rain, night]) {
      const w = fakeWorld();
      w.sky = sky;
      const rand = mulberry32(11);
      const c = spawn(EARTHWORM, world(400, 400));
      let up = 0;
      for (let i = 0; i < 30 * 120; i += 1) {
        step(c, EARTHWORM, w, rand, 1 / 30);
        if (c.behaviour === 'surface' || c.behaviour === 'feed') up += 1;
      }
      expect(up).toBeGreaterThan(30 * 100);
      expect(c.height).toBeCloseTo(ground(c.at), 3);
    }
    const w = fakeWorld();
    const rand = mulberry32(12);
    const c = spawn(EARTHWORM, world(400, 400));
    let under = 0;
    for (let i = 0; i < 30 * 60; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'burrow') under += 1;
      expect(c.height).toBeLessThanOrEqual(ground(c.at));
    }
    expect(under).toBeGreaterThan(30 * 40);
  });

  it('picks a new heading every headingS, turned by no more than `turn` of a half-turn', () => {
    const w = fakeWorld();
    const rand = mulberry32(5);
    const c = spawn(EARTHWORM, world(400, 400));
    const headings: number[] = [];
    let last = -1;
    for (let i = 0; i < 30 * 400; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'burrow' && c.behaviourS < last) {
        headings.push(c.target === null ? c.heading : Math.atan2(c.target.wx - c.at.wx, c.target.wz - c.at.wz));
      }
      last = c.behaviourS;
    }
    expect(headings.length).toBeGreaterThanOrEqual(4);
    expect(headings.length).toBeLessThanOrEqual(400 / EARTHWORM.burrow!.headingS[0] + 2);
  });

  it('hungry with litter within sight, it surfaces and feeds at the litter; hungry with none, it burrows on', () => {
    const w = fakeWorld();
    const litter: ResourceSite = { id: 'litter:0,0:9', kind: 'litter', at: world(403, 402), above: 0, amount: 1, ownerId: null };
    w.sites = [litter];
    const rand = mulberry32(21);
    const c = spawn(EARTHWORM, world(400, 400));
    c.hunger = 0.95;
    let fed = false;
    for (let i = 0; i < 30 * 200 && !fed; i += 1) {
      step(c, EARTHWORM, w, rand, 1 / 30);
      if (c.behaviour === 'feed') {
        fed = true;
        expect(c.hostId).toBe(litter.id);
        expect(c.target).toBe(litter.at);
      }
    }
    expect(fed).toBe(true);
    expect(nearestSite(w, world(400, 400), ['litter'], unitsOfMm(EARTHWORM.senses.sightMm))).toBe(litter);
    expect(nearestSite(w, world(400, 400), ['nectar'], unitsOfMm(EARTHWORM.senses.sightMm))).toBeNull();
    expect(nearestSite(w, world(400, 400), ['litter'], 1)).toBeNull();
  });

  it('flees a disturbance within one think: down to the bottom of the band and away from it', () => {
    const w = fakeWorld();
    const rand = mulberry32(3);
    const c = spawn(EARTHWORM, world(400, 400));
    for (let i = 0; i < 30 * 5; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    const before = c.at;
    w.list = [{ at: world(before.wx + 2, before.wz), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, EARTHWORM, w, rand, 1 / 30)) thoughts += 1;
    expect(c.behaviour).toBe('flee');
    expect(c.alarm).toBeGreaterThanOrEqual(ALARM_FLEES_AT);
    expect(c.target!.wx).toBeLessThan(before.wx);
    for (let i = 0; i < 30 * 3; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    expect(c.at.wx).toBeLessThan(before.wx);
    expect(c.height).toBeCloseTo(ground(c.at) - unitsOfMm(EARTHWORM.burrow!.underMm), 3);
    w.list = [];
    for (let i = 0; i < 30 * 30; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    expect(c.behaviour).not.toBe('flee');
  });
});

describe("a size is a distance, too", () => {
  it('a worm twice as long flees twice as far and aims its next heading twice as far ahead', () => {
    const w = fakeWorld();
    const at = world(400, 400);
    const cited = spawn(EARTHWORM, at);
    const big = newCreature({
      id: 'earthworm:0,0:2', species: 'earthworm', cellKey: '0,0', at, height: cited.height,
      heading: cited.heading, phase: 0.3, behaviour: 'burrow', lengthMm: EARTHWORM.lengthMm * 2,
    });
    // The away point is what its own flee pace covers in the alarm's hold.
    const disturbance: Disturbance[] = [{ at: world(at.wx + 2, at.wz), height: cited.height, radius: 0 }];
    expect(senseAlarm(cited, EARTHWORM, disturbance)).toBe(true);
    expect(senseAlarm(big, EARTHWORM, disturbance)).toBe(true);
    const near = distance(cited.at, cited.target!);
    expect(near).toBeCloseTo(unitsOfMm(EARTHWORM.pace.fleeMmS) * EARTHWORM.senses.alarmS, 6);
    expect(distance(big.at, big.target!)).toBeCloseTo(2 * near, 6);

    // And the fresh heading a burrowing worm picks: the same draws, the
    // same turn, the same hold — twice the distance, because it will
    // have got twice as far by the time the hold runs out.
    const calm = (source: CreatureState): CreatureState => {
      const c = { ...source, alarm: 0, target: null, behaviour: 'burrow' as const, behaviourS: 0, behaviourUntilS: 0 };
      return c;
    };
    const one = calm(cited);
    const two = calm(big);
    for (const c of [one, two]) think(c, EARTHWORM, w, () => 0.5, null);
    expect(one.behaviour).toBe('burrow');
    expect(two.behaviour).toBe('burrow');
    expect(distance(two.at, two.target!)).toBeCloseTo(2 * distance(one.at, one.target!), 6);
  });

  it('an aphid keeps to five of ITS OWN body lengths of the stem, so a big one has more stem to walk', () => {
    const w = fakeWorld();
    w.plants = [SHRUB];
    const walkLimit = (lengthMm: number): number => {
      const c = newCreature({
        id: 'aphid:0,0:5', species: 'aphid', cellKey: '0,0', at: SHRUB.at, height: ground(SHRUB.at) + 10,
        heading: 0.4, phase: 0.3, hostId: SHRUB.id, lengthMm,
      });
      const rand = mulberry32(31);
      let far = 0;
      for (let i = 0; i < 30 * 600; i += 1) {
        step(c, BRIEF_APHID, w, rand, 1 / 30, SHRUB);
        far = Math.max(far, distance(c.at, SHRUB.at));
        expect(distance(c.at, SHRUB.at)).toBeLessThanOrEqual(HOST_WALK_LENGTHS * unitsOfMm(lengthMm) + 1e-6);
      }
      return far;
    };
    const small = walkLimit(APHID.lengthRangeMm[0]);
    const large = walkLimit(APHID.lengthRangeMm[1]);
    expect(large).toBeGreaterThan(small);
  }, 30_000);
});

describe('the aphid', () => {
  it('feeds most of the time, walks within five body lengths of its host, keeps its hostId, and stays on the plant for ten minutes', () => {
    const w = fakeWorld();
    w.plants = [SHRUB];
    const rand = mulberry32(8);
    const c = spawn(BRIEF_APHID, SHRUB.at, SHRUB.id);
    const body = unitsOfMm(APHID.lengthMm);
    let feeding = 0;
    let walked = 0;
    const total = 30 * 600;
    for (let i = 0; i < total; i += 1) {
      step(c, BRIEF_APHID, w, rand, 1 / 30, SHRUB);
      if (c.behaviour === 'feed') feeding += 1;
      if (c.behaviour === 'wander') walked += 1;
      expect(distance(c.at, SHRUB.at)).toBeLessThanOrEqual(HOST_WALK_LENGTHS * body + 1e-6);
      expect(c.hostId).toBe(SHRUB.id);
      expect(c.height).toBeGreaterThanOrEqual(ground(c.at) - 1e-9);
      expect(c.height).toBeLessThanOrEqual(ground(c.at) + SHRUB.size + 1e-9);
    }
    expect(feeding).toBeGreaterThan(total / 2);
    expect(walked).toBeGreaterThan(0);
    expect(hostPlantOf(c, w)).toBe(SHRUB);
  }, 30_000);

  it('on alarm drops to the ground and scrambles a few body lengths, then walks back to its host and feeds', () => {
    const w = fakeWorld();
    w.plants = [SHRUB];
    const rand = mulberry32(9);
    const c = spawn(APHID, SHRUB.at, SHRUB.id);
    for (let i = 0; i < 30 * 10; i += 1) step(c, APHID, w, rand, 1 / 30, SHRUB);
    const perch = c.height;
    expect(perch).toBeGreaterThan(ground(c.at));
    w.list = [{ at: world(c.at.wx, c.at.wz + 1), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, APHID, w, rand, 1 / 30, SHRUB)) thoughts += 1;
    expect(c.behaviour).toBe('flee');
    expect(c.targetHeight).toBeCloseTo(ground(c.at), 1);
    for (let i = 0; i < 30 * 5; i += 1) step(c, APHID, w, rand, 1 / 30, SHRUB);
    expect(c.height).toBeCloseTo(ground(c.at), 3);
    // It may already have been five body lengths out on a walk when the alarm came, and it scrambles three more.
    expect(distance(c.at, SHRUB.at)).toBeLessThanOrEqual((HOST_WALK_LENGTHS + HOST_FLEE_LENGTHS + 1) * unitsOfMm(APHID.lengthMm) + 1e-6);
    expect(c.hostId).toBe(SHRUB.id);
    w.list = [];
    let returned = false;
    for (let i = 0; i < 30 * 120 && !returned; i += 1) {
      step(c, APHID, w, rand, 1 / 30, SHRUB);
      if (c.behaviour === 'feed' && c.height > ground(c.at) + 1) returned = true;
    }
    expect(returned).toBe(true);
  });

  it('without a host it feeds where it stands and never wanders', () => {
    const w = fakeWorld();
    const rand = mulberry32(10);
    const c = spawn(APHID, world(700, 700), null);
    const at = c.at;
    for (let i = 0; i < 30 * 300; i += 1) {
      step(c, APHID, w, rand, 1 / 30, null);
      expect(c.behaviour).not.toBe('wander');
    }
    expect(c.at).toBe(at);
  });
});

describe('the fly', () => {
  it('hops, hovers, lands and perches; never targets a sea point; stays between the ground and its ceiling', () => {
    const w = fakeWorld();
    const rand = mulberry32(14);
    // Born on the beach, thirty centimetres from the sea: every random hop has to be checked.
    const c = spawn(HOUSEFLY, world(SEA_EAST_OF - 30, 400));
    const seen = new Set<string>();
    const ceiling = unitsOfMm(HOUSEFLY.flight!.ceilingMm);
    const seaTargets: string[] = [];
    let atSea = 0;
    let outOfBand = 0;
    let nonFinite = 0;
    for (let i = 0; i < 30 * 1000; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      seen.add(c.behaviour);
      if (c.target !== null && isAirborne(c.behaviour) && !isLand(w, c.target)) seaTargets.push(`${c.target.wx},${c.target.wz}`);
      if (c.at.wx >= SEA_EAST_OF) atSea += 1;
      const g = ground(c.at);
      if (c.height < g - 1e-9 || c.height > g + ceiling + 1e-9) outOfBand += 1;
      if (![c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight].every(Number.isFinite)) nonFinite += 1;
    }
    expect(seaTargets).toEqual([]);
    expect(atSea).toBe(0);
    expect(outOfBand).toBe(0);
    expect(nonFinite).toBe(0);
    finite(c);
    for (const word of ['idle', 'takeoff', 'fly', 'hover', 'land']) expect(seen, word).toContain(word);
    expect(seen.has('flee')).toBe(false);
  }, 30_000);

  it('is grounded by rain and by night: it does not take off, and lands if it is up', () => {
    for (const sky of [{ rainMmHr: 2, windX: 0, windZ: 0, night: false }, { rainMmHr: 0, windX: 0, windZ: 0, night: true }]) {
      const w = fakeWorld();
      const rand = mulberry32(15);
      const c = spawn(HOUSEFLY, world(600, 600));
      for (let i = 0; i < 30 * 3; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
      // It is up (or about to be): now the weather turns.
      w.sky = sky;
      let airborneAfter = 0;
      for (let i = 0; i < 30 * 120; i += 1) {
        step(c, HOUSEFLY, w, rand, 1 / 30);
        if (i > 30 * 10 && isAirborne(c.behaviour)) airborneAfter += 1;
      }
      expect(airborneAfter).toBe(0);
      expect(c.height).toBeCloseTo(ground(c.at), 3);
    }
  });

  it('hungry with a resource in sight, it flies to it and feeds there, naming the site', () => {
    const w = fakeWorld();
    const nectar: ResourceSite = { id: 'flower:0,0:2', kind: 'nectar', at: world(620, 610), above: 5, amount: 3, ownerId: 'flower:0,0:2' };
    w.sites = [nectar];
    const rand = mulberry32(16);
    const c = spawn(HOUSEFLY, world(600, 600));
    c.hunger = 0.9;
    let fed = false;
    for (let i = 0; i < 30 * 120 && !fed; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      if (c.behaviour === 'feed') {
        fed = true;
        expect(c.hostId).toBe(nectar.id);
        expect(distance(c.at, nectar.at)).toBeLessThan(unitsOfMm(HOUSEFLY.lengthMm) * 2);
      }
    }
    expect(fed).toBe(true);
  });

  it('a disturbance within alarm range makes it take off within one think, and it flies away from it', () => {
    const w = fakeWorld();
    const rand = mulberry32(17);
    const c = spawn(HOUSEFLY, world(600, 600));
    c.behaviour = 'idle';
    c.behaviourUntilS = 100; // a long perch, so only the alarm can lift it
    c.behaviourS = 1;
    for (let i = 0; i < 30 * 2; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
    expect(c.behaviour).toBe('idle');
    const before = c.at;
    w.list = [{ at: world(before.wx - 5, before.wz), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, HOUSEFLY, w, rand, 1 / 30)) thoughts += 1;
    expect(['takeoff', 'fly']).toContain(c.behaviour);
    expect(c.target!.wx).toBeGreaterThan(before.wx);
    for (let i = 0; i < 30 * 2; i += 1) step(c, HOUSEFLY, w, rand, 1 / 30);
    expect(c.at.wx).toBeGreaterThan(before.wx + 10);
    expect(isAirborne(c.behaviour)).toBe(true);
  });
});

describe('the fly and the water', () => {
  /** A perch that is over: the next think decides afresh. */
  function perched(at: WorldPoint, hunger = 0.1): CreatureState {
    const c = spawn(HOUSEFLY, at);
    c.hunger = hunger;
    c.behaviour = 'idle';
    c.behaviourS = 10;
    c.behaviourUntilS = 1;
    return c;
  }

  /**
   * A fly at the end of a `word` (a landing, or the hover before one) at
   * `at`: the clock is up and the body is a hand — under a body length —
   * over whatever floor is there, so the next think decides where it
   * perches. Its target is where it is, the way a hop that ran out of
   * time leaves it.
   */
  function ending(w: Fake, word: 'land' | 'hover', at: WorldPoint): CreatureState {
    const c = spawn(HOUSEFLY, at);
    c.behaviour = word;
    c.behaviourS = 10;
    c.behaviourUntilS = 1;
    c.target = at;
    c.height = floorAt(w, at) + 0.3;
    return c;
  }

  const CRUISE_FLOOR = unitsOfMm(HOUSEFLY.flight!.cruiseMm[0]);
  const POND_CENTRE = world(1200, 1200);
  /** 0.75 draws a hop due west of 3 m (2.825 s at the cruise, clamped to `hopMm`): from the pond's centre, well past its west bank. */
  const WESTWARD = (): number => 0.75;
  /** 0.5 draws a hop due north of 3 m (2.15 s at the cruise, clamped): from the pond's centre, still in the pond — four times over. */
  const SOUTHWARD = (): number => 0.5;

  /** Run a fly for `seconds`, counting the frames it is perched with water under it and the frames it is under a surface. */
  function soak(w: Fake, c: CreatureState, rand: () => number, seconds: number): { wetPerches: number; underSurface: number; perchedDryAt: number } {
    let wetPerches = 0;
    let underSurface = 0;
    let perchedDryAt = -1;
    for (let i = 0; i < 30 * seconds; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      const perched = !isAirborne(c.behaviour);
      if (perched && !isLand(w, c.at)) wetPerches += 1;
      if (perched && perchedDryAt < 0 && isLand(w, c.at)) perchedDryAt = i / 30;
      if (c.height < floorAt(w, c.at) - 1e-9) underSurface += 1;
      finite(c);
    }
    return { wetPerches, underSurface, perchedDryAt };
  }

  it('dry land is dry: isLand refuses a point under standing fresh water as it refuses the sea, and keeps a dry point', () => {
    const w = pondWorld();
    expect(isLand(w, world(1200, 1200))).toBe(false);
    expect(isLand(w, world(900, 1200))).toBe(true);
    expect(isLand(w, world(SEA_EAST_OF + 100, 400))).toBe(false);
    // With no water known there is no reading to refuse on; the sea is still refused by the ground and the habitat.
    const blind = fakeWorld(null);
    expect(isLand(blind, world(1200, 1200))).toBe(true);
    expect(isLand(blind, world(SEA_EAST_OF + 100, 400))).toBe(false);
  });

  it('over the pond the brain hovers a cruise floor above the surface, never the bed — and does not land there at all', () => {
    const w = pondWorld();
    const target = world(1200, 1200);
    const surface = ground(target) + POND_DEPTH;
    expect(floorAt(w, target)).toBe(surface);
    // A hop whose end is over the water (an away point, or a bank the pond has since risen over), the hop's time up:
    // the hover it chooses is over the water; and when the hover is up, water is not a place to land. Four hops due
    // south from here are still in the pond, so it hovers on over the surface; a hop due west finds the bank.
    const c = spawn(HOUSEFLY, world(900, 1200));
    c.behaviour = 'fly';
    c.behaviourS = 10;
    c.behaviourUntilS = 1;
    c.target = target;
    c.at = world(1150, 1200);
    c.height = ground(c.at) + POND_DEPTH + 20;
    think(c, HOUSEFLY, w, () => 0.5, null);
    expect(c.behaviour).toBe('hover');
    expect(c.targetHeight).toBeCloseTo(surface + unitsOfMm(HOUSEFLY.flight!.cruiseMm[0]), 9);
    c.behaviourS = 10;
    c.behaviourUntilS = 1;
    think(c, HOUSEFLY, w, () => 0.5, null);
    expect(c.behaviour).toBe('hover');
    // Held over where it IS, not over the target it let go: the pond's surface here, a cruise floor up.
    expect(c.targetHeight).toBeCloseTo(ground(c.at) + POND_DEPTH + unitsOfMm(HOUSEFLY.flight!.cruiseMm[0]), 9);
    expect(c.targetHeight).toBeGreaterThan(ground(c.at) + POND_DEPTH);
    think(c, HOUSEFLY, w, () => 0.75, null);
    expect(c.behaviour).toBe('fly');
    expect(inPond(c.target!)).toBe(false);
    expect(isLand(w, c.target!)).toBe(true);
    // And a takeoff from the bank measures its band from where it stands: dry there, so the ground.
    const bank = perched(world(900, 1200));
    think(bank, HOUSEFLY, w, () => 0.75, null);
    expect(bank.behaviour).toBe('takeoff');
    expect(bank.targetHeight).toBeGreaterThanOrEqual(ground(bank.at) + unitsOfMm(HOUSEFLY.flight!.cruiseMm[0]) - 1e-9);
  });

  it('an away point over the pond is refused: the fleeing fly hops for dry ground instead', () => {
    const w = pondWorld();
    const c = perched(world(POND.x0 - 5, 1200));
    c.behaviourUntilS = 100;
    c.behaviourS = 1;
    // The camera lands just west of it: away is east, and the longest hop east is well inside the pond.
    expect(senseAlarm(c, HOUSEFLY, [{ at: world(c.at.wx - 2, c.at.wz), height: c.height, radius: 0 }])).toBe(true);
    expect(inPond(c.target!)).toBe(true);
    // 0.75 draws a hop due west, so the answer is deterministic: land, and not the pond.
    think(c, HOUSEFLY, w, () => 0.75, null);
    expect(c.behaviour).toBe('takeoff');
    expect(inPond(c.target!)).toBe(false);
    expect(isLand(w, c.target!)).toBe(true);
    expect(c.targetHeight).toBeCloseTo(ground(c.at) + unitsOfMm(HOUSEFLY.flight!.cruiseMm[1]), 9);
  });

  it('a water-edge site is on the bank and is still a drink; one the pond has since risen over is refused for a dry hop', () => {
    const w = pondWorld();
    // Derived at a DRY lattice sample beside a wet one (`world/ecology/derive.ts`): the bank, a metre from the water.
    const bank: ResourceSite = { id: 'water-edge:0,0:5', kind: 'water-edge', at: world(POND.x0 - 100, 1200), above: 0, amount: 400, ownerId: null };
    w.sites = [bank];
    const thirsty = perched(world(POND.x0 - 120, 1200), 0.9);
    think(thirsty, HOUSEFLY, w, () => 0.5, null);
    expect(thirsty.behaviour).toBe('takeoff');
    expect(thirsty.target).toBe(bank.at);
    expect(thirsty.hostId).toBe(bank.id);
    // The pond has come up over the bank since its cell was derived: until the refresh the site is stale, and dry is dry.
    const drowned: ResourceSite = { ...bank, at: world(POND.x0 + 10, 1200) };
    w.sites = [drowned];
    expect(isLand(w, drowned.at)).toBe(false);
    const other = perched(world(POND.x0 - 10, 1200), 0.9);
    think(other, HOUSEFLY, w, () => 0.75, null);
    expect(other.behaviour).toBe('takeoff');
    expect(other.hostId).toBeNull();
    expect(other.target).not.toBe(drowned.at);
    expect(isLand(w, other.target!)).toBe(true);
  });

  it('a landing that runs out over the pond does not perch: it hops for dry ground, or hovers over the water and asks again', () => {
    const w = pondWorld();
    const surface = ground(POND_CENTRE) + POND_DEPTH;
    // A hop to land is found: it flies it, a cruise floor over the ground it is aimed at, the site let go.
    const hops = ending(w, 'land', POND_CENTRE);
    hops.hostId = 'flower:0,0:2';
    think(hops, HOUSEFLY, w, WESTWARD, null);
    expect(hops.behaviour).toBe('fly');
    expect(inPond(hops.target!)).toBe(false);
    expect(isLand(w, hops.target!)).toBe(true);
    expect(hops.targetHeight).toBeCloseTo(ground(hops.target!) + CRUISE_FLOOR, 9);
    expect(hops.hostId).toBeNull();
    // Nothing to hop to: it hovers a cruise floor over the WATER, and the next think with a hop in reach takes it.
    const hovers = ending(w, 'land', POND_CENTRE);
    think(hovers, HOUSEFLY, w, SOUTHWARD, null);
    expect(hovers.behaviour).toBe('hover');
    expect(hovers.targetHeight).toBeCloseTo(surface + CRUISE_FLOOR, 9);
    expect(hovers.targetHeight).toBeGreaterThan(ground(POND_CENTRE));
    hovers.behaviourS = 10;
    hovers.behaviourUntilS = 1;
    think(hovers, HOUSEFLY, w, WESTWARD, null);
    expect(hovers.behaviour).toBe('fly');
    expect(isLand(w, hovers.target!)).toBe(true);
    // Left to itself in the middle of the pond: never a perch on the water, never under a surface, and on dry ground within a minute.
    const c = ending(w, 'land', POND_CENTRE);
    const { wetPerches, underSurface, perchedDryAt } = soak(w, c, mulberry32(31), 60);
    expect(wetPerches).toBe(0);
    expect(underSurface).toBe(0);
    expect(perchedDryAt).toBeGreaterThanOrEqual(0);
  });

  it('the hover before a landing is refused the same way: a hop that ran out over the pond never starts down toward the surface', () => {
    const w = pondWorld();
    const c = ending(w, 'hover', POND_CENTRE);
    think(c, HOUSEFLY, w, WESTWARD, null);
    expect(c.behaviour).toBe('fly');
    expect(isLand(w, c.target!)).toBe(true);
    const held = ending(w, 'hover', POND_CENTRE);
    think(held, HOUSEFLY, w, SOUTHWARD, null);
    expect(held.behaviour).toBe('hover');
    expect(held.targetHeight).toBeCloseTo(ground(POND_CENTRE) + POND_DEPTH + CRUISE_FLOOR, 9);
    // On the bank a finished hover comes down as it always did: to the ground it is over.
    const bank = ending(w, 'hover', world(900, 1200));
    think(bank, HOUSEFLY, w, WESTWARD, null);
    expect(bank.behaviour).toBe('land');
    expect(bank.targetHeight).toBe(ground(bank.at));
  });

  it('the same over the sea: a landing that runs out off a beach hops back to the beach, and it perches there and not on the water', () => {
    const w = fakeWorld();
    // A metre and a half out over the sea along the beach: the floor is the sea, two metres over the bed.
    const at = world(SEA_EAST_OF + 150, 400);
    expect(floorAt(w, at)).toBe(SEA_LEVEL);
    expect(ground(at)).toBeLessThan(SEA_LEVEL);
    const c = ending(w, 'land', at);
    think(c, HOUSEFLY, w, WESTWARD, null);
    expect(c.behaviour).toBe('fly');
    expect(c.target!.wx).toBeLessThan(SEA_EAST_OF);
    expect(isLand(w, c.target!)).toBe(true);
    expect(c.targetHeight).toBeCloseTo(ground(c.target!) + CRUISE_FLOOR, 9);
    // Left to itself out over the sea: never perched at sea, never under the sea (the floor there IS the sea), and on the beach within a minute.
    const d = ending(w, 'land', at);
    const { wetPerches, underSurface, perchedDryAt } = soak(w, d, mulberry32(32), 60);
    expect(wetPerches).toBe(0);
    expect(underSurface).toBe(0);
    expect(perchedDryAt).toBeGreaterThanOrEqual(0);
  });

  it('on dry ground a landing ends where it always did — idle for a perch, feed at its site when hungry, rest when tired — on one draw', () => {
    const w = pondWorld();
    const at = world(600, 600);
    let draws = 0;
    const counted = (): number => { draws += 1; return 0.5; };
    const flight = HOUSEFLY.flight!;
    const perch = ending(w, 'land', at);
    think(perch, HOUSEFLY, w, counted, null);
    expect(perch.behaviour).toBe('idle');
    expect(perch.target).toBeNull();
    expect(perch.targetHeight).toBe(ground(at));
    expect(perch.behaviourUntilS).toBeCloseTo(flight.perchS[0] + 0.5 * (flight.perchS[1] - flight.perchS[0]), 9);
    expect(draws).toBe(1);
    draws = 0;
    const hungry = ending(w, 'land', at);
    hungry.hostId = 'flower:0,0:2';
    hungry.hunger = 0.9;
    think(hungry, HOUSEFLY, w, counted, null);
    expect(hungry.behaviour).toBe('feed');
    expect(hungry.hostId).toBe('flower:0,0:2');
    expect(hungry.target).toBeNull();
    expect(draws).toBe(1);
    draws = 0;
    const tired = ending(w, 'land', at);
    tired.fatigue = 0.9;
    think(tired, HOUSEFLY, w, counted, null);
    expect(tired.behaviour).toBe('rest');
    expect(tired.target).toBeNull();
    expect(tired.targetHeight).toBe(ground(at));
    expect(draws).toBe(1);
  });

  it('rain grounds it at the first dry ground: mid-hop over the pond it flies on to its dry target; mid-hop over the bank it comes down as before', () => {
    const w = pondWorld();
    w.sky = { rainMmHr: 2, windX: 0, windZ: 0, night: false };
    const dry = world(900, 1200);
    const over = spawn(HOUSEFLY, POND_CENTRE);
    over.behaviour = 'fly';
    over.behaviourS = 0.2;
    over.behaviourUntilS = 3;
    over.target = dry;
    over.height = ground(POND_CENTRE) + POND_DEPTH + CRUISE_FLOOR;
    think(over, HOUSEFLY, w, SOUTHWARD, w.sky);
    expect(over.behaviour).toBe('fly');
    expect(over.target).toBe(dry);
    const bank = spawn(HOUSEFLY, world(950, 1200));
    bank.behaviour = 'fly';
    bank.behaviourS = 0.2;
    bank.behaviourUntilS = 3;
    bank.target = dry;
    bank.height = ground(bank.at) + CRUISE_FLOOR;
    think(bank, HOUSEFLY, w, SOUTHWARD, w.sky);
    expect(bank.behaviour).toBe('hover');
    expect(bank.targetHeight).toBeCloseTo(ground(dry) + CRUISE_FLOOR, 9);
  });

  it('born on the bank, it never aims at the pond, is never under its surface, and never perches with water under it in ten minutes', () => {
    const w = pondWorld();
    const rand = mulberry32(23);
    const c = spawn(HOUSEFLY, world(POND.x0 - 20, 1200));
    const wetTargets: string[] = [];
    let underSurface = 0;
    let overPond = 0;
    let wetPerches = 0;
    for (let i = 0; i < 30 * 600; i += 1) {
      step(c, HOUSEFLY, w, rand, 1 / 30);
      if (c.target !== null && isAirborne(c.behaviour) && inPond(c.target)) wetTargets.push(`${c.target.wx},${c.target.wz}`);
      if (inPond(c.at)) {
        overPond += 1;
        if (c.height < ground(c.at) + POND_DEPTH - 1e-9) underSurface += 1;
      }
      // Perched — idle, feeding, resting, walking — is `walk`, and `walk` sets the height to the GROUND: the bed, under a pond.
      if (!isAirborne(c.behaviour) && !isLand(w, c.at)) wetPerches += 1;
      finite(c);
    }
    expect(wetTargets).toEqual([]);
    expect(underSurface, `under the pond's surface on ${underSurface} of ${overPond} frames over it`).toBe(0);
    expect(wetPerches, `perched with water under it on ${wetPerches} frames`).toBe(0);
  }, 30_000);
});

describe('the ground brain (the Lab\'s ants)', () => {
  it('a worker lives in the shared words, never flies, never attacks on its own, feeds at food in sight when hungry, and a thousand seconds is finite', () => {
    const w = fakeWorld();
    // Two units off: inside the worker's measured sight of 50 mm (five units), which is how far a 48-facet eye resolves motion.
    const nectar: ResourceSite = { id: 'flower:0,0:2', kind: 'nectar', at: world(502, 501), above: 5, amount: 3, ownerId: 'flower:0,0:2' };
    w.sites = [nectar];
    // A home, as the Lab names one: its wander is a forager's, never further than Tschinkel's 26 cm from the hole.
    w.home = world(500, 500);
    const rand = mulberry32(51);
    const c = spawn(WORKER, world(500, 500));
    // Hungry from the start, while the food is still in sight: a random walk of a minute would carry a five-unit eye past it.
    c.hunger = 0.95;
    const seen = new Set<string>();
    let nonFinite = 0;
    let fed = false;
    for (let i = 0; i < 30 * 1000; i += 1) {
      step(c, WORKER, w, rand, 1 / 30);
      seen.add(c.behaviour);
      if (c.behaviour === 'feed') {
        fed = true;
        expect(c.hostId).toBe(nectar.id);
      }
      expect(BEHAVIOURS_BY_MEDIUM.ground).toContain(c.behaviour);
      expect(c.height).toBe(ground(c.at));
      if (![c.at.wx, c.at.wz, c.height, c.heading, c.pitch, c.targetHeight, c.hunger, c.fatigue, c.alarm].every(Number.isFinite)) nonFinite += 1;
    }
    expect(nonFinite).toBe(0);
    expect(fed).toBe(true);
    expect(seen.has('wander')).toBe(true);
    expect(seen.has('idle')).toBe(true);
    expect(seen.has('attack')).toBe(false);
    expect(seen.has('fly')).toBe(false);
    // Its walks are loops inside the range of home: never further than 26 cm from it, all told well inside a metre.
    expect(distance(c.at, world(500, 500))).toBeLessThanOrEqual(GROUND_HOME_RANGE + unitsOfMm(WORKER.lengthMm));
    expect(distance(c.at, world(500, 500))).toBeLessThan(unitsOfMetres(1));
  }, 60_000);

  it('a defensive ant turns to face a disturbance ON it and holds its ground; one further off is fled; a skittish one flees either', () => {
    const w = fakeWorld();
    const rand = mulberry32(52);
    const c = spawn(WORKER, world(500, 500));
    c.behaviour = 'idle';
    c.behaviourUntilS = 100;
    c.behaviourS = 1;
    for (let i = 0; i < 30 * 2; i += 1) step(c, WORKER, w, rand, 1 / 30);
    const before = c.at;
    // The threat stands east of it, within a body length (a 3 mm ant: 0.3 units): ON it.
    w.list = [{ at: world(before.wx + 0.2, before.wz), height: c.height, radius: 0 }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, WORKER, w, rand, 1 / 30)) thoughts += 1;
    expect(c.behaviour).toBe('defend');
    expect(c.alarm).toBeGreaterThanOrEqual(ALARM_FLEES_AT);
    // The face point is TOWARD the threat: east.
    expect(c.target!.wx).toBeGreaterThan(before.wx);
    for (let i = 0; i < 30 * 2; i += 1) step(c, WORKER, w, rand, 1 / 30);
    // It turned to face east (heading π/2) and did not move.
    expect(Math.abs(c.heading - Math.PI / 2)).toBeLessThan(0.05);
    expect(distance(c.at, before)).toBeLessThan(1e-9);
    // The thing it faces steps back a hand: the stand HOLDS while the alarm lasts, it does not bolt.
    w.list = [{ at: world(before.wx + 2, before.wz), height: c.height, radius: 0 }];
    for (let i = 0; i < 30 * 1; i += 1) step(c, WORKER, w, rand, 1 / 30);
    expect(c.behaviour).toBe('defend');
    expect(distance(c.at, before)).toBeLessThan(1e-9);
    w.list = [];
    for (let i = 0; i < 30 * 30; i += 1) step(c, WORKER, w, rand, 1 / 30);
    expect(c.behaviour).not.toBe('defend');
    // The same species alarmed by a threat a hand off — inside its alarm reach, not on it — flees, away, at the flee pace.
    const far = spawn(WORKER, world(500, 500));
    far.behaviour = 'idle';
    far.behaviourUntilS = 100;
    far.behaviourS = 1;
    w.list = [{ at: world(502, 500), height: far.height, radius: 0 }];
    let fth = 0;
    while (fth < 1) if (step(far, WORKER, w, rand, 1 / 30)) fth += 1;
    expect(far.behaviour).toBe('flee');
    expect(far.target!.wx).toBeLessThan(500);
    for (let i = 0; i < 30 * 1; i += 1) step(far, WORKER, w, rand, 1 / 30);
    expect(far.at.wx).toBeLessThan(500);
    // The same alarm on a skittish ground animal is a flee, away, on it or not.
    const timid: CreatureSpecies = { ...WORKER, temperament: 'skittish' };
    const t = spawn(timid, world(500, 500));
    t.behaviour = 'idle';
    t.behaviourUntilS = 100;
    t.behaviourS = 1;
    w.list = [{ at: world(500.2, 500), height: t.height, radius: 0 }];
    let th = 0;
    while (th < 1) if (step(t, timid, w, rand, 1 / 30)) th += 1;
    expect(t.behaviour).toBe('flee');
    expect(t.target!.wx).toBeLessThan(500);
  });

  it('a worker chosen "fly" is a bug the brain throws on; the winged queen may use the air words', () => {
    const w = fakeWorld();
    const worker = spawn(WORKER, world(500, 500));
    worker.behaviour = 'fly';
    worker.behaviourUntilS = 100;
    expect(() => think(worker, WORKER, w, () => 0.5, null)).toThrow(/does not allow/);
    const queen = spawn(QUEEN, world(500, 500));
    queen.behaviour = 'fly';
    queen.behaviourUntilS = 100;
    expect(() => think(queen, QUEEN, w, () => 0.5, null)).not.toThrow();
    // The ground brain never puts her up on its own: only a SEVERE alarm, or a player's demand, does (tests/creatureGround.test.ts).
    const grounded = spawn(QUEEN, world(500, 500));
    const rand = mulberry32(53);
    for (let i = 0; i < 30 * 300; i += 1) {
      step(grounded, QUEEN, w, rand, 1 / 30);
      expect(isAirborne(grounded.behaviour)).toBe(false);
      expect(grounded.height).toBe(ground(grounded.at));
    }
  });

  it('a ground species\' flee and wander distances scale by its pace law, not its length', () => {
    const w = fakeWorld();
    const cited = spawn(WORKER, world(500, 500));
    const big = newCreature({
      id: 'worker:0,0:2', species: 'worker', cellKey: '0,0', at: cited.at, height: cited.height, heading: 0.4, phase: 0.3, lengthMm: WORKER.lengthMm * 2,
    });
    const timid: CreatureSpecies = { ...WORKER, temperament: 'skittish' };
    const disturbance: Disturbance[] = [{ at: world(502, 500), height: cited.height, radius: 0 }];
    expect(senseAlarm(cited, timid, disturbance)).toBe(true);
    expect(senseAlarm(big, timid, disturbance)).toBe(true);
    const near = distance(cited.at, cited.target!);
    expect(near).toBeCloseTo(unitsOfMm(WORKER.pace.fleeMmS) * WORKER.senses.alarmS, 6);
    expect(distance(big.at, big.target!)).toBeCloseTo(Math.pow(2, 0.75) * near, 6);
    // The wander reach, on the other hand, is body lengths: the bigger ant walks proportionally further.
    const walkFrom = (c: CreatureState): number => {
      const s = { ...c, alarm: 0, target: null, behaviour: 'idle' as const, behaviourS: 10, behaviourUntilS: 1, hunger: 0 };
      think(s, WORKER, w, () => 0.5, null);
      expect(s.behaviour).toBe('wander');
      return distance(s.at, s.target!);
    };
    expect(walkFrom(big)).toBeCloseTo(2 * walkFrom(cited), 6);
    expect(walkFrom(cited)).toBeLessThanOrEqual(GROUND_WANDER_LENGTHS * unitsOfMm(WORKER.lengthMm) + 1e-9);
  });
});
