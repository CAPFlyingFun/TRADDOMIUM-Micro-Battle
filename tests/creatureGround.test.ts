/**
 * The ground brain and the Lab's box: a worker naps and forages by what
 * it needs; a queen takes sugars and water only, leaves the ground on a
 * SEVERE alarm when the sky allows and comes back to the ground brain
 * on landing with every word legal; a home holds a wander inside the
 * territory; a stand is taken only when the disturbance is ON the ant;
 * a target outside the Lab's box is replaced by an inward one and a
 * body is never moved; and the three wild species behave as the
 * research says — the aphid's two-stage flee, its blindness to its
 * tenders and its walk to the nearest host it can see; the fly's
 * looming alarm, its hover only before a landing, its night and its
 * hop derived from `hopS × cruise`; the worm's dig discount, read and
 * not yet applied by the legs.
 */
import { describe, expect, it } from 'vitest';
import {
  APHID, BLOCK, EARTHWORM, HOUSEFLY, LAB_HALF, LAB_PLANTS, QUEEN, WORKER, behaviourAllowedFor, createLabWorld, newCreature, unitsOfMm,
  type Behaviour, type CreatureSpecies, type CreatureState, type CreatureWeather, type CreatureWorld, type Disturbance,
} from '../src/creatures';
import {
  ALARM_FLEES_AT, CARBOHYDRATE_OR_DRINK, DROP_CHANCE_DEFAULT, GROUND_FORAGE_LENGTHS, GROUND_HOME_RANGE, GROUND_WANDER_LENGTHS,
  HOST_FLEE_LENGTHS, HOST_FLEE_WALK_MM, LOOM, PROTEIN_AT, PROTEIN_OR_DRINK, SEVERE_ALARM_FRACTION, TAKEOFF_WIND_MAX, beginTakeoff,
  contactMmOf, containTarget, digDiscountOf, digPaceFactor, dropChanceOf, homeOf, nearestDisturbanceGap, nearestHostInSight, senseAlarm,
  takeoffWeatherAllows, think, thinkDue, tickNeeds,
} from '../src/creatures/intent';
import { unitsOfMetres } from '../src/creatures/finder';
import { floorAt, isAirborne, move } from '../src/creatures/locomotion';
import { distance, world, type WorldPoint } from '../src/world/coords';
import type { CellResources, PlantSource, ResourceSite, WaterQuery } from '../src/world/ecology/resources';
import type { Habitat, HabitatKind } from '../src/world/habitat';
import { CELL_SPAN } from '../src/world/objects/cells';
import { mulberry32 } from '../src/world/random';

// ---------------------------------------------------------------------------
// A flat world with nothing in it but what a test puts there
// ---------------------------------------------------------------------------

const GROUND = 200;

function habitat(kind: HabitatKind, elevation: number): Habitat {
  return {
    kind, forest: 0, grass: 1, shrub: 0, bare: 0, wet: 0, lake: 0, coast: 0, exposure: 0,
    elevation, slopeDegrees: 0, coastDistance: 10_000, channel: false, rainfallMmYear: null,
  };
}

interface Fake extends CreatureWorld {
  sky: CreatureWeather | null;
  list: Disturbance[];
  sites: ResourceSite[];
  plants: PlantSource[];
  home?: WorldPoint;
}

const DRY: WaterQuery = { freshDepthAt: () => 0, isSeaAt: () => false, nearestWater: () => null };

function fakeWorld(): Fake {
  const w: Fake = {
    sky: null,
    list: [],
    sites: [],
    plants: [],
    groundAt: () => GROUND,
    normalAt: () => ({ nx: 0, ny: 1, nz: 0 }),
    habitatAt: () => habitat('grassland', GROUND),
    plantsOf: () => w.plants,
    resourcesOf: (cx, cz): CellResources | null => {
      const sites = w.sites.filter((s) => Math.floor(s.at.wx / CELL_SPAN) === cx && Math.floor(s.at.wz / CELL_SPAN) === cz);
      return { cx, cz, sites };
    },
    water: DRY,
    weather: () => w.sky,
    disturbances: () => w.list,
  };
  return w;
}

interface SpawnOptions {
  readonly hostId?: string | null;
  readonly hunger?: number;
  readonly fatigue?: number;
  readonly behaviour?: Behaviour;
  readonly height?: number;
  readonly heading?: number;
}

function spawn(species: CreatureSpecies, at: WorldPoint, options: SpawnOptions = {}): CreatureState {
  const height = options.height ?? (species.burrow !== null ? GROUND - unitsOfMm(species.burrow.underMm) : GROUND);
  const c = newCreature({
    id: `${species.id}:0,0:1`, species: species.id, cellKey: '0,0', at, height, heading: options.heading ?? 0.4, phase: 0.3,
    behaviour: options.behaviour ?? (species.burrow !== null ? 'burrow' : 'idle'), hostId: options.hostId ?? null,
    hunger: options.hunger ?? 0.1, fatigue: options.fatigue ?? 0.1,
  });
  c.sinceThink = c.phase * species.thinkS;
  return c;
}

/** A creature whose current word is over, so the next think decides afresh. */
function decided(c: CreatureState): CreatureState {
  c.behaviourS = 10;
  c.behaviourUntilS = 1;
  return c;
}

/** One simulation step of a single creature, the way the simulation does it. Returns whether it thought. */
function step(c: CreatureState, species: CreatureSpecies, w: CreatureWorld, rand: () => number, dt: number, host?: PlantSource | null): boolean {
  tickNeeds(c, species, dt);
  senseAlarm(c, species, w.disturbances());
  let thought = false;
  if (thinkDue(c, species)) {
    think(c, species, w, rand, w.weather(), host);
    thought = true;
  }
  move(c, species, w, dt);
  return thought;
}

function site(kind: ResourceSite['kind'], at: WorldPoint, n: number): ResourceSite {
  return { id: `${kind}:0,0:${n}`, kind, at, above: 0, amount: 1, ownerId: null };
}

const CALM: CreatureWeather = { rainMmHr: 0, windX: 0, windZ: 0, night: false };
const NIGHT: CreatureWeather = { rainMmHr: 0, windX: 0, windZ: 0, night: true };
const WINDY: CreatureWeather = { rainMmHr: 0, windX: unitsOfMetres(3), windZ: 0, night: false };
const RAIN: CreatureWeather = { rainMmHr: 2, windX: 0, windZ: 0, night: false };

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

describe('the worker', () => {
  it('naps: a tired worker rests for the species\' own restS and is up again within it, not for a block', () => {
    const w = fakeWorld();
    const rand = mulberry32(61);
    const c = spawn(WORKER, world(500, 500), { fatigue: 0.95 });
    let restedFrom = -1;
    let restedFor = -1;
    let t = 0;
    for (let i = 0; i < 30 * 600 && restedFor < 0; i += 1) {
      step(c, WORKER, w, rand, 1 / 30);
      t += 1 / 30;
      if (c.behaviour === 'rest' && restedFrom < 0) restedFrom = t;
      if (c.behaviour !== 'rest' && restedFrom >= 0) restedFor = t - restedFrom;
    }
    expect(restedFrom).toBeGreaterThanOrEqual(0);
    expect(restedFor).toBeGreaterThan(0);
    // The nap is the table's `restS` and no longer: whatever B3 makes that number, the brain reads it and does not add to it.
    expect(restedFor).toBeLessThanOrEqual(WORKER.needs.restS[1] + WORKER.thinkS + 1 / 30);
    expect(restedFor).toBeGreaterThanOrEqual(WORKER.needs.restS[0] - WORKER.thinkS - 1 / 30);
    expect(c.fatigue).toBeLessThan(0.95);
  });

  it('hungry, it takes the nearest carbohydrate before a nearer protein; starving, the protein first; and the drink counts when it is nearest', () => {
    const w = fakeWorld();
    // Sight is 50 mm: five units. Carrion at two, nectar at three, water at one — all in sight.
    const carrion = site('carrion', world(502, 500), 1);
    const nectar = site('nectar', world(500, 503), 2);
    w.sites = [carrion, nectar];
    const hungry = decided(spawn(WORKER, world(500, 500), { hunger: 0.7 }));
    think(hungry, WORKER, w, () => 0.5, null);
    expect(hungry.behaviour).toBe('wander');
    expect(hungry.hostId).toBe(nectar.id);
    expect(hungry.target).toBe(nectar.at);
    const starving = decided(spawn(WORKER, world(500, 500), { hunger: PROTEIN_AT }));
    think(starving, WORKER, w, () => 0.5, null);
    expect(starving.behaviour).toBe('wander');
    expect(starving.hostId).toBe(carrion.id);
    // The drink: a water-edge site nearer than either is the feed target when the animal is hungry — there is no thirst yet, and this stands in.
    const water = site('water-edge', world(501, 500), 3);
    w.sites = [carrion, nectar, water];
    const thirsty = decided(spawn(WORKER, world(500, 500), { hunger: 0.7 }));
    think(thirsty, WORKER, w, () => 0.5, null);
    expect(thirsty.hostId).toBe(water.id);
    expect(CARBOHYDRATE_OR_DRINK).toContain('water-edge');
    expect(PROTEIN_OR_DRINK).toContain('water-edge');
    // Starving with only carbohydrate in sight: the other group is taken rather than nothing.
    w.sites = [nectar];
    const onlySugar = decided(spawn(WORKER, world(500, 500), { hunger: 0.95 }));
    think(onlySugar, WORKER, w, () => 0.5, null);
    expect(onlySugar.hostId).toBe(nectar.id);
    // Not hungry: nothing is sought, and the walk is a short loop.
    w.sites = [carrion, nectar, water];
    const full = decided(spawn(WORKER, world(500, 500), { hunger: 0.1 }));
    think(full, WORKER, w, () => 0.5, null);
    expect(full.hostId).toBeNull();
    expect(full.behaviour).toBe('wander');
    expect(distance(full.at, full.target!)).toBeLessThanOrEqual(GROUND_WANDER_LENGTHS * unitsOfMm(WORKER.lengthMm) + 1e-9);
  });

  it('hungry with nothing in sight, its walk is a forager\'s sweep, longer than the idle loop', () => {
    const w = fakeWorld();
    const body = unitsOfMm(WORKER.lengthMm);
    const full = decided(spawn(WORKER, world(500, 500), { hunger: 0.1 }));
    think(full, WORKER, w, () => 0.5, null);
    const hungry = decided(spawn(WORKER, world(500, 500), { hunger: 0.9 }));
    think(hungry, WORKER, w, () => 0.5, null);
    expect(hungry.behaviour).toBe('wander');
    expect(distance(hungry.at, hungry.target!)).toBeCloseTo(GROUND_FORAGE_LENGTHS * body * Math.sqrt(0.5), 9);
    expect(distance(hungry.at, hungry.target!) / distance(full.at, full.target!)).toBeCloseTo(GROUND_FORAGE_LENGTHS / GROUND_WANDER_LENGTHS, 9);
  });

  it('home: with a home named, ten minutes of wandering never leaves its range; strayed past it, the next walk is back toward it; without one, nothing changes', () => {
    const w = fakeWorld();
    w.home = world(500, 500);
    expect(homeOf(w)).toBe(w.home);
    expect(homeOf(fakeWorld())).toBeNull();
    const rand = mulberry32(62);
    const c = spawn(WORKER, world(500, 500), { hunger: 0.9 });
    let furthest = 0;
    let targetsOutside = 0;
    for (let i = 0; i < 30 * 600; i += 1) {
      const thought = step(c, WORKER, w, rand, 1 / 30);
      furthest = Math.max(furthest, distance(c.at, w.home));
      if (thought && c.target !== null && distance(c.target, w.home) > GROUND_HOME_RANGE + 1e-9) targetsOutside += 1;
    }
    expect(targetsOutside).toBe(0);
    expect(furthest).toBeLessThanOrEqual(GROUND_HOME_RANGE + unitsOfMm(WORKER.lengthMm));
    expect(furthest).toBeGreaterThan(unitsOfMm(WORKER.lengthMm));
    // Carried past the range (a flee, a player): the next walk goes toward home.
    const strayed = decided(spawn(WORKER, world(500 + GROUND_HOME_RANGE + 20, 500), { hunger: 0.1 }));
    think(strayed, WORKER, w, () => 0.99, null);
    expect(strayed.behaviour).toBe('wander');
    expect(distance(strayed.target!, w.home)).toBeLessThan(distance(strayed.at, w.home));
    // The island names no home: the same ant wanders around where it stands.
    const wild = decided(spawn(WORKER, world(500 + GROUND_HOME_RANGE + 20, 500), { hunger: 0.1 }));
    think(wild, WORKER, fakeWorld(), () => 0.5, null);
    expect(wild.behaviour).toBe('wander');
    expect(distance(wild.at, wild.target!)).toBeLessThanOrEqual(GROUND_WANDER_LENGTHS * unitsOfMm(WORKER.lengthMm) + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// The queen: two brains, one animal
// ---------------------------------------------------------------------------

describe('the queen', () => {
  it('takes sugars and water only: with carrion and litter nearer than a flower, the flower — by her eats list, not a branch', () => {
    expect(QUEEN.needs.eats).not.toContain('carrion');
    expect(QUEEN.needs.eats).not.toContain('litter');
    const w = fakeWorld();
    const carrion = site('carrion', world(501, 500), 1);
    const litter = site('litter', world(500, 501.5), 2);
    const nectar = site('nectar', world(500, 504), 3);
    w.sites = [carrion, litter, nectar];
    const q = decided(spawn(QUEEN, world(500, 500), { hunger: 0.95 }));
    think(q, QUEEN, w, () => 0.5, null);
    expect(q.behaviour).toBe('wander');
    expect(q.hostId).toBe(nectar.id);
  });

  it('the sky\'s gate: day, dry and light wind allow a takeoff; night, rain or a 3 m/s wind refuse it', () => {
    expect(takeoffWeatherAllows(CALM)).toBe(true);
    expect(takeoffWeatherAllows(null)).toBe(true);
    expect(takeoffWeatherAllows(NIGHT)).toBe(false);
    expect(takeoffWeatherAllows(RAIN)).toBe(false);
    expect(takeoffWeatherAllows(WINDY)).toBe(false);
    expect(takeoffWeatherAllows({ ...CALM, windX: TAKEOFF_WIND_MAX * 0.9 })).toBe(true);
    expect(TAKEOFF_WIND_MAX).toBe(unitsOfMetres(2.2));
  });

  it('beginTakeoff is the one door: a grounded queen goes up, an airborne one and a wingless worker do not', () => {
    const w = fakeWorld();
    const q = spawn(QUEEN, world(500, 500));
    expect(beginTakeoff(q, QUEEN, w)).toBe(true);
    expect(q.behaviour).toBe('takeoff');
    expect(q.targetHeight).toBeCloseTo(GROUND + unitsOfMm(QUEEN.flight!.cruiseMm[1]), 9);
    expect(q.behaviourUntilS).toBeCloseTo(QUEEN.flight!.cruiseMm[0] / QUEEN.flight!.climbMmS, 9);
    expect(beginTakeoff(q, QUEEN, w)).toBe(false);
    const k = spawn(WORKER, world(500, 500));
    expect(beginTakeoff(k, WORKER, w)).toBe(false);
    expect(k.behaviour).toBe('idle');
  });

  it('a SEVERE alarm sends her up; the round trip is ground → takeoff → fly → land → ground, every word legal, and the ground brain has her back', () => {
    const w = fakeWorld();
    w.sky = CALM;
    const rand = mulberry32(63);
    const q = spawn(QUEEN, world(500, 500));
    q.behaviour = 'idle';
    q.behaviourUntilS = 100;
    q.behaviourS = 1;
    for (let i = 0; i < 30 * 2; i += 1) step(q, QUEEN, w, rand, 1 / 30);
    // On top of her: alarm 1, the disturbance inside half her reach.
    w.list = [{ at: world(q.at.wx + 0.1, q.at.wz), height: q.height, radius: 0, source: 'tool' }];
    const words: Behaviour[] = [];
    let illegal = 0;
    let t = 0;
    let landedAt = -1;
    for (let i = 0; i < 30 * 90; i += 1) {
      step(q, QUEEN, w, rand, 1 / 30);
      t += 1 / 30;
      if (t > 1) w.list = [];
      if (!behaviourAllowedFor(QUEEN, q.behaviour)) illegal += 1;
      if (words[words.length - 1] !== q.behaviour) words.push(q.behaviour);
      if (landedAt < 0 && words.includes('land') && !isAirborne(q.behaviour)) landedAt = t;
    }
    expect(illegal).toBe(0);
    // The alarm brings the think forward, so the takeoff is the very first word the loop sees.
    const at = (word: Behaviour): number => words.indexOf(word);
    expect(at('takeoff')).toBeGreaterThanOrEqual(0);
    expect(at('fly')).toBeGreaterThan(at('takeoff'));
    expect(at('land')).toBeGreaterThan(at('fly'));
    expect(landedAt).toBeGreaterThan(0);
    // Back on the ground brain: a grounded word, the ground's height, no target.
    expect(isAirborne(q.behaviour)).toBe(false);
    expect(q.height).toBe(GROUND);
    expect(words.slice(at('land') + 1).every((word) => behaviourAllowedFor(QUEEN, word))).toBe(true);
    // And the ground brain decides for her again: run her word out and she walks.
    decided(q);
    q.hunger = 0.1;
    think(q, QUEEN, w, () => 0.5, w.sky);
    expect(q.behaviour).toBe('wander');
    expect(q.height).toBe(GROUND);
  });

  it('at night, in rain or in wind the same alarm keeps her on the ground: a stand when it is on her, a flee when it is a hand off', () => {
    const body = unitsOfMm(QUEEN.lengthMm);
    const severe = unitsOfMm(QUEEN.senses.alarmMm) * SEVERE_ALARM_FRACTION;
    for (const sky of [NIGHT, RAIN, WINDY]) {
      const w = fakeWorld();
      w.sky = sky;
      const on = spawn(QUEEN, world(500, 500), { behaviour: 'idle' });
      on.behaviourUntilS = 100;
      on.behaviourS = 1;
      w.list = [{ at: world(500 + body / 2, 500), height: on.height, radius: 0 }];
      senseAlarm(on, QUEEN, w.list);
      think(on, QUEEN, w, () => 0.5, sky);
      expect(on.behaviour, `${JSON.stringify(sky)} on her`).toBe('defend');
      const off = spawn(QUEEN, world(500, 500), { behaviour: 'idle' });
      off.behaviourUntilS = 100;
      off.behaviourS = 1;
      w.list = [{ at: world(500 + severe * 0.8, 500), height: off.height, radius: 0 }];
      senseAlarm(off, QUEEN, w.list);
      think(off, QUEEN, w, () => 0.5, sky);
      expect(off.behaviour, `${JSON.stringify(sky)} a hand off`).toBe('flee');
      expect(off.target!.wx).toBeLessThan(500);
    }
    // By day the hand-off one is severe enough: up she goes, toward the away point.
    const w = fakeWorld();
    w.sky = CALM;
    const day = spawn(QUEEN, world(500, 500), { behaviour: 'idle' });
    day.behaviourUntilS = 100;
    day.behaviourS = 1;
    w.list = [{ at: world(500 + severe * 0.8, 500), height: day.height, radius: 0 }];
    senseAlarm(day, QUEEN, w.list);
    think(day, QUEEN, w, () => 0.5, CALM);
    expect(day.behaviour).toBe('takeoff');
    expect(day.target!.wx).toBeLessThan(500);
    // Beyond half her reach, alarmed but not severely: on foot.
    const mild = spawn(QUEEN, world(500, 500), { behaviour: 'idle' });
    mild.behaviourUntilS = 100;
    mild.behaviourS = 1;
    w.list = [{ at: world(500 + severe * 1.5, 500), height: mild.height, radius: 0 }];
    senseAlarm(mild, QUEEN, w.list);
    expect(mild.alarm).toBe(1);
    think(mild, QUEEN, w, () => 0.5, CALM);
    expect(mild.behaviour).toBe('flee');
  });

  it('airborne, she is the air brain\'s: a fly word never reaches the ground brain, and a landing hands back a grounded word', () => {
    const w = fakeWorld();
    const q = spawn(QUEEN, world(500, 500), { behaviour: 'fly', height: GROUND + 40 });
    q.target = world(520, 500);
    q.targetHeight = GROUND + 40;
    q.behaviourS = 100;
    q.behaviourUntilS = 1;
    think(q, QUEEN, w, () => 0.5, CALM);
    // The hop is over: a hover — hers lasts zero seconds — then a landing.
    expect(q.behaviour).toBe('hover');
    expect(q.behaviourUntilS).toBe(0);
    think(q, QUEEN, w, () => 0.5, CALM);
    expect(q.behaviour).toBe('land');
    q.height = GROUND + 0.1;
    q.behaviourS = 100;
    think(q, QUEEN, w, () => 0.5, CALM);
    expect(isAirborne(q.behaviour)).toBe(false);
    expect(q.targetHeight).toBe(GROUND);
    expect(q.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Containment in the Lab's box
// ---------------------------------------------------------------------------

describe('containment (§31)', () => {
  it('containTarget replaces a target outside the box with the world\'s inward point and moves nothing; a flier\'s height follows the floor; a stand is left alone; no bounds, no change', () => {
    const lab = createLabWorld();
    const c = spawn(WORKER, world(48, 48), { height: lab.groundAt(world(48, 48)) });
    c.target = world(70, 70);
    const at = c.at;
    expect(containTarget(c, lab)).toBe(true);
    expect(lab.inBounds(c.target!)).toBe(true);
    expect(c.target).toEqual(lab.inwardTarget(at));
    expect(c.at).toBe(at);
    c.target = world(10, 10);
    expect(containTarget(c, lab)).toBe(false);
    expect(c.target).toEqual(world(10, 10));
    // A flier aimed a cruise floor over a target outside: the same floor over the inward one — here flat, so the height stands.
    const f = spawn(HOUSEFLY, world(48, -48), { behaviour: 'fly', height: lab.groundAt(world(48, -48)) + 20 });
    f.target = world(200, -200);
    f.targetHeight = floorAt(lab, f.target) + 12;
    expect(containTarget(f, lab)).toBe(true);
    expect(f.targetHeight).toBeCloseTo(floorAt(lab, f.target!) + 12, 9);
    // A stand's target is a bearing: an ant at the edge faces the thing outside.
    const d = spawn(WORKER, world(49, 0), { behaviour: 'defend', height: lab.groundAt(world(49, 0)) });
    d.target = world(60, 0);
    expect(containTarget(d, lab)).toBe(false);
    expect(d.target).toEqual(world(60, 0));
    // The island has no edge.
    const wild = spawn(WORKER, world(500, 500));
    wild.target = world(10_000, 10_000);
    expect(containTarget(wild, fakeWorld())).toBe(false);
  });

  it('600 s of each of the five from a corner of the box: no target is ever outside, a body never leaves it by more than its turning circle, and a body at the edge is back inside within twenty seconds', () => {
    const lab = createLabWorld();
    const home = world(0, BLOCK.size / 2 + 3);
    const w: CreatureWorld = { ...lab, home };
    const shrub = LAB_PLANTS.find((p) => p.family === 'shrub')!;
    const cases: readonly { species: CreatureSpecies; at: WorldPoint; height: number; hostId: string | null; behaviour: Behaviour }[] = [
      { species: QUEEN, at: world(-44, 44), height: lab.groundAt(world(-44, 44)), hostId: null, behaviour: 'idle' },
      { species: WORKER, at: world(44, 44), height: lab.groundAt(world(44, 44)), hostId: null, behaviour: 'idle' },
      {
        species: EARTHWORM, at: world(44, -44), height: lab.groundAt(world(44, -44)) - unitsOfMm(EARTHWORM.burrow!.underMm),
        hostId: null, behaviour: 'burrow',
      },
      { species: APHID, at: shrub.at, height: lab.groundAt(shrub.at) + shrub.size * 0.5, hostId: shrub.id, behaviour: 'idle' },
      { species: HOUSEFLY, at: world(-44, -44), height: lab.groundAt(world(-44, -44)), hostId: null, behaviour: 'idle' },
    ];
    /** How far inside the box a point is, from its nearest edge; negative outside. */
    const depth = (p: WorldPoint): number => LAB_HALF - Math.max(Math.abs(p.wx), Math.abs(p.wz));
    for (const { species, at, height, hostId, behaviour } of cases) {
      const c = newCreature({
        id: `${species.id}:0,0:9`, species: species.id, cellKey: '0,0', at, height, heading: Math.atan2(at.wx, at.wz), phase: 0.5,
        behaviour, hostId, hunger: 0.5, fatigue: 0.1,
      });
      const rand = mulberry32(64 + species.id.length);
      // A body may swing out by its turning circle — pace over turn rate — and no more; a walker's circle is under a body length, a
      // fly's at cruise is not. The GROUND turn rate is used for the circle on purpose: it is the wider of the two, and which rate the
      // legs turn a flier at is the integrator's (`turnRadSAir`), so the tight bound is its test to make once it reads the field.
      const pace = species.flight !== null ? unitsOfMm(species.flight.cruiseMmS) : unitsOfMm(species.pace.fleeMmS);
      const slack = Math.max(unitsOfMm(species.lengthMm), 2 * pace / species.pace.turnRadS);
      let targetsOutside = 0;
      let bodiesOutside = 0;
      let stuck = 0;
      let edgeSince = -1;
      let t = 0;
      let touchedEdge = false;
      for (let i = 0; i < 30 * 600; i += 1) {
        const thought = step(c, species, w, rand, 1 / 30, hostId === null ? null : shrub);
        t += 1 / 30;
        if (thought && c.target !== null && !lab.inBounds(c.target)) targetsOutside += 1;
        if (depth(c.at) < -slack) bodiesOutside += 1;
        const atEdge = depth(c.at) < 0.5;
        if (atEdge) {
          touchedEdge = true;
          if (edgeSince < 0) edgeSince = t;
          else if (t - edgeSince > 20) stuck += 1;
        } else {
          edgeSince = -1;
        }
        expect(Number.isFinite(c.at.wx) && Number.isFinite(c.at.wz) && Number.isFinite(c.height)).toBe(true);
      }
      expect(targetsOutside, `${species.id} aimed outside the box`).toBe(0);
      expect(bodiesOutside, `${species.id} left the box by more than ${slack.toFixed(1)} units`).toBe(0);
      expect(stuck, `${species.id} stayed at the edge past twenty seconds`).toBe(0);
      // The walkers and the burrower start six units from the corner and are meant to reach it now and then; the aphid never leaves its shrub.
      if (species.id === 'aphid') expect(touchedEdge).toBe(false);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// The aphid
// ---------------------------------------------------------------------------

describe('the aphid', () => {
  const HOST: PlantSource = { family: 'shrub', at: world(500, 500), size: 40, id: 'shrub:0,0:3', variant: 0 };
  /** The research's aphid: a contact radius inside the alarm reach, and the drop a minority answer. */
  const LADDERED: CreatureSpecies = { ...APHID, senses: { ...APHID.senses, contactMm: 5, dropChance: 0.25 } as CreatureSpecies['senses'] };

  it('the optional fields read as the entry says, and as today when it says nothing', () => {
    expect(contactMmOf(APHID)).toBe(20); // the research's contact/vibration radius (aphid.md), on the entry since B3
    expect(dropChanceOf(APHID)).toBe(DROP_CHANCE_DEFAULT);
    expect(contactMmOf(LADDERED)).toBe(5);
    expect(dropChanceOf(LADDERED)).toBe(0.25);
    const odd: CreatureSpecies = { ...APHID, senses: { ...APHID.senses, contactMm: NaN, dropChance: 7 } as CreatureSpecies['senses'] };
    expect(contactMmOf(odd)).toBeNull();
    expect(dropChanceOf(odd)).toBe(1);
  });

  it('an ant is not a disturbance to it: a creature-source disturbance on top raises nothing, a tool or the camera does; a worm feels either', () => {
    const w = fakeWorld();
    const a = spawn(APHID, HOST.at, { hostId: HOST.id, height: GROUND + 10 });
    const ant: Disturbance = { at: world(500.1, 500), height: a.height, radius: 0, source: 'creature' };
    expect(senseAlarm(a, APHID, [ant])).toBe(false);
    expect(a.alarm).toBe(0);
    w.list = [ant];
    expect(nearestDisturbanceGap(a, APHID, w)).toBe(Infinity);
    // A worker at the same height feels it a tenth of a unit off; the gap is three-dimensional, so one on the ground reads ten units.
    expect(nearestDisturbanceGap(spawn(WORKER, world(500, 500), { height: GROUND + 10 }), WORKER, w)).toBeCloseTo(0.1, 9);
    expect(nearestDisturbanceGap(spawn(WORKER, world(500, 500)), WORKER, w)).toBeCloseTo(Math.hypot(0.1, 10), 9);
    const tool: Disturbance = { ...ant, source: 'tool' };
    expect(senseAlarm(a, APHID, [tool])).toBe(true);
    const camera: Disturbance = { ...ant, source: 'camera' };
    expect(senseAlarm(spawn(APHID, HOST.at, { hostId: HOST.id, height: GROUND + 10 }), APHID, [camera])).toBe(true);
    const unnamed: Disturbance = { at: ant.at, height: ant.height, radius: 0 };
    expect(senseAlarm(spawn(APHID, HOST.at, { hostId: HOST.id, height: GROUND + 10 }), APHID, [unnamed])).toBe(true);
    const worm = spawn(EARTHWORM, world(500, 500));
    expect(senseAlarm(worm, EARTHWORM, [{ ...ant, height: worm.height }])).toBe(true);
  });

  it('two stages: alarmed from a hand off it WALKS 1-3 cm along the host, staying up; in contact it DROPS; a persisting disturbance drops it by chance, else it walks again', () => {
    const w = fakeWorld();
    w.plants = [HOST];
    const body = unitsOfMm(APHID.lengthMm);
    // Fifteen millimetres off: inside the alarm reach (20 mm), outside contact (5 mm).
    const off: Disturbance = { at: world(501.5, 500), height: GROUND + 10, radius: 0, source: 'tool' };
    const a = spawn(LADDERED, HOST.at, { hostId: HOST.id, height: GROUND + 10 });
    w.list = [off];
    expect(senseAlarm(a, LADDERED, w.list)).toBe(true);
    think(a, LADDERED, w, () => 0.5, null, HOST);
    expect(a.behaviour).toBe('flee');
    expect(a.targetHeight).toBe(GROUND + 10);
    const walked = distance(a.at, a.target!);
    expect(walked).toBeGreaterThanOrEqual(unitsOfMm(HOST_FLEE_WALK_MM[0]) - 1e-9);
    expect(walked).toBeLessThanOrEqual(unitsOfMm(HOST_FLEE_WALK_MM[1]) + 1e-9);
    expect(a.target!.wx).toBeLessThan(500); // away: west
    expect(a.behaviourUntilS).toBeCloseTo(walked / unitsOfMm(APHID.pace.fleeMmS), 9);
    // The walk done and the thing still there: with the draw above the drop chance it walks again; below it, it drops.
    a.behaviourS = a.behaviourUntilS + 1;
    think(a, LADDERED, w, () => 0.9, null, HOST);
    expect(a.behaviour).toBe('flee');
    expect(a.targetHeight).toBe(GROUND + 10);
    a.behaviourS = a.behaviourUntilS + 1;
    think(a, LADDERED, w, () => 0.1, null, HOST);
    expect(a.behaviour).toBe('flee');
    expect(a.targetHeight).toBe(GROUND);
    expect(distance(a.at, a.target!)).toBeCloseTo(HOST_FLEE_LENGTHS * body, 9);
    // Contact drops at once.
    const touched = spawn(LADDERED, HOST.at, { hostId: HOST.id, height: GROUND + 10 });
    w.list = [{ at: world(500.3, 500), height: GROUND + 10, radius: 0, source: 'tool' }];
    expect(senseAlarm(touched, LADDERED, w.list)).toBe(true);
    think(touched, LADDERED, w, () => 0.9, null, HOST);
    expect(touched.behaviour).toBe('flee');
    expect(touched.targetHeight).toBe(GROUND);
    // The table's aphid, with no contact radius, drops on any alarm as it always did.
    const plain = spawn(APHID, HOST.at, { hostId: HOST.id, height: GROUND + 10 });
    w.list = [off];
    expect(senseAlarm(plain, APHID, w.list)).toBe(true);
    think(plain, APHID, w, () => 0.9, null, HOST);
    expect(plain.behaviour).toBe('flee');
    expect(plain.targetHeight).toBe(GROUND);
  });

  it('displaced, it walks to the nearest host it can SEE — another plant when that is nearer — and with none in sight it waits where it is', () => {
    const w = fakeWorld();
    const other: PlantSource = { family: 'shrub', at: world(508, 500), size: 40, id: 'shrub:0,0:4', variant: 0 };
    const grass: PlantSource = { family: 'grass', at: world(505.5, 500), size: 8, id: 'grass:0,0:5', variant: 0 };
    w.plants = [HOST, other, grass];
    // The research's aphid: sight of a host 130 mm, thirteen units, and a dicot's hosts — no grass (the shipped table still lists grass; B3's call).
    const sighted: CreatureSpecies = {
      ...APHID, senses: { ...APHID.senses, sightMm: 130 }, population: { ...APHID.population, hosts: ['shrub', 'broadleaf', 'flower'] },
    };
    const a = spawn(sighted, world(506, 500), { hostId: HOST.id, behaviour: 'flee', height: GROUND });
    expect(nearestHostInSight(a, sighted, w)).toBe(other);
    decided(a);
    think(a, sighted, w, () => 0.5, null, HOST);
    expect(a.hostId).toBe(other.id);
    expect(a.behaviour).toBe('wander');
    expect(distance(a.target!, other.at)).toBeLessThan(1e-9);
    // The grass at 5.5 units is nearer than either shrub and is not a host: never chosen.
    expect(nearestHostInSight(a, sighted, w)).not.toBe(grass);
    // Its own host nearest: kept.
    const home = spawn(sighted, world(501, 500), { hostId: HOST.id, behaviour: 'flee', height: GROUND });
    decided(home);
    think(home, sighted, w, () => 0.5, null, HOST);
    expect(home.hostId).toBe(HOST.id);
    expect(home.behaviour).toBe('wander');
    // A SHORT-SIGHTED aphid (the table's sight is now 130 mm — Gish & Inbar 2006 — which sees both shrubs from here; 30 mm is the old
    // value, kept for this scenario) with the dicot's hosts: from between the two shrubs, neither in sight — but it has a host it KNOWS,
    // so it walks back to that one out of sight; only with NO host at all does it wait where it stands, off the open soil.
    const dim: CreatureSpecies = {
      ...APHID,
      population: { ...APHID.population, hosts: ['shrub', 'broadleaf', 'flower'] },
      senses: { ...APHID.senses, sightMm: 30 },
    };
    const blind = spawn(dim, world(504.5, 500), { hostId: HOST.id, behaviour: 'flee', height: GROUND });
    expect(nearestHostInSight(blind, dim, w)).toBeNull();
    decided(blind);
    think(blind, dim, w, () => 0.5, null, HOST);
    expect(blind.behaviour).toBe('wander');
    expect(blind.hostId).toBe(HOST.id);
    const lost = spawn(dim, world(504.5, 500), { hostId: null, behaviour: 'flee', height: GROUND });
    decided(lost);
    think(lost, dim, w, () => 0.5, null, null);
    expect(lost.behaviour).toBe('idle');
    expect(lost.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The fly
// ---------------------------------------------------------------------------

describe('the fly', () => {
  it('looms: a big thing far off alarms it, a small thing far off does not, a small thing on it does (the contact floor), and a worm feels only the reach', () => {
    const f = spawn(HOUSEFLY, world(500, 500));
    const reach = unitsOfMm(HOUSEFLY.senses.alarmMm);
    // A hand (10 units) at 30: 0.33 > LOOM, beyond the floor (15 + 10). Alarmed.
    expect(senseAlarm(f, HOUSEFLY, [{ at: world(530, 500), height: f.height, radius: 10 }])).toBe(true);
    expect(f.target!.wx).toBeLessThan(500);
    // An ant (0.3) at 30: 0.01. Not alarmed.
    expect(senseAlarm(spawn(HOUSEFLY, world(500, 500)), HOUSEFLY, [{ at: world(530, 500), height: GROUND, radius: 0.3 }])).toBe(false);
    // A point (0) at 5: inside the floor. Alarmed. At 20 (past 15 + 0): not.
    expect(senseAlarm(spawn(HOUSEFLY, world(500, 500)), HOUSEFLY, [{ at: world(505, 500), height: GROUND, radius: 0 }])).toBe(true);
    expect(senseAlarm(spawn(HOUSEFLY, world(500, 500)), HOUSEFLY, [{ at: world(520, 500), height: GROUND, radius: 0 }])).toBe(false);
    // Exactly on the line does not loom: radius / distance must EXCEED it.
    expect(senseAlarm(spawn(HOUSEFLY, world(500, 500)), HOUSEFLY, [{ at: world(500 + 10 / LOOM + 1, 500), height: GROUND, radius: 10 }])).toBe(false);
    expect(senseAlarm(spawn(HOUSEFLY, world(500, 500)), HOUSEFLY, [{ at: world(500 + 10 / LOOM - 1, 500), height: GROUND, radius: 10 }])).toBe(true);
    // With a contact radius on the entry the floor is that: an ant walking up to a hand's width is tolerated, one touching is not.
    const wary: CreatureSpecies = { ...HOUSEFLY, senses: { ...HOUSEFLY.senses, contactMm: 10 } as CreatureSpecies['senses'] };
    expect(senseAlarm(spawn(wary, world(500, 500)), wary, [{ at: world(505, 500), height: GROUND, radius: 0.3 }])).toBe(false);
    expect(senseAlarm(spawn(wary, world(500, 500)), wary, [{ at: world(501, 500), height: GROUND, radius: 0.3 }])).toBe(true);
    // The worm has no looming eye: a big thing past its reach is nothing to it.
    const worm = spawn(EARTHWORM, world(500, 500));
    expect(senseAlarm(worm, EARTHWORM, [{ at: world(500 + reach * 3, 500), height: worm.height, radius: 10 }])).toBe(false);
  });

  it('hovers only before a landing, never station-keeps over land: every hover over dry ground ends in a landing within hoverS', () => {
    const w = fakeWorld();
    const rand = mulberry32(65);
    const f = spawn(HOUSEFLY, world(500, 500));
    let hovers = 0;
    let hoverFrames = 0;
    let hoverThenNotLand = 0;
    let last: Behaviour = f.behaviour;
    for (let i = 0; i < 30 * 600; i += 1) {
      step(f, HOUSEFLY, w, rand, 1 / 30);
      if (f.behaviour === 'hover') hoverFrames += 1;
      if (f.behaviour !== last) {
        if (last === 'hover' && f.behaviour !== 'land') hoverThenNotLand += 1;
        if (f.behaviour === 'hover') hovers += 1;
        last = f.behaviour;
      }
    }
    expect(hovers).toBeGreaterThan(3);
    expect(hoverThenNotLand).toBe(0);
    expect(hoverFrames / 30 / hovers).toBeLessThanOrEqual(HOUSEFLY.flight!.hoverS[1] + HOUSEFLY.thinkS);
  });

  it('night: perched, no takeoff of its own; an alarm lifts it; and at dawn it is active again', () => {
    const w = fakeWorld();
    w.sky = NIGHT;
    const rand = mulberry32(66);
    const f = spawn(HOUSEFLY, world(500, 500));
    let up = 0;
    for (let i = 0; i < 30 * 300; i += 1) {
      step(f, HOUSEFLY, w, rand, 1 / 30);
      if (isAirborne(f.behaviour)) up += 1;
    }
    expect(up).toBe(0);
    expect(f.height).toBe(GROUND);
    // The camera at night: it takes off anyway.
    w.list = [{ at: world(f.at.wx - 5, f.at.wz), height: f.height, radius: 0, source: 'camera' }];
    let thoughts = 0;
    while (thoughts < 1) if (step(f, HOUSEFLY, w, rand, 1 / 30)) thoughts += 1;
    expect(isAirborne(f.behaviour)).toBe(true);
    w.list = [];
    for (let i = 0; i < 30 * 60; i += 1) step(f, HOUSEFLY, w, rand, 1 / 30);
    expect(isAirborne(f.behaviour)).toBe(false);
    // Dawn.
    w.sky = CALM;
    let dawnUp = 0;
    for (let i = 0; i < 30 * 120; i += 1) {
      step(f, HOUSEFLY, w, rand, 1 / 30);
      if (isAirborne(f.behaviour)) dawnUp += 1;
    }
    expect(dawnUp).toBeGreaterThan(0);
  });

  it('a hop is hopS × cruise held inside hopMm, and the flight\'s clock is that distance at the cruise plus a half-turn', () => {
    const w = fakeWorld();
    const flight = HOUSEFLY.flight!;
    const cruise = unitsOfMm(flight.cruiseMmS);
    // The half-turn is at the air rate where the entry carries one (`turnRadSAir`), else the ground rate — the brain's own rule.
    const airRate = Number.isFinite(flight.turnRadSAir) && flight.turnRadSAir > 0 ? flight.turnRadSAir : HOUSEFLY.pace.turnRadS;
    const halfTurn = Math.PI / airRate;
    const expected = (u: number): number => Math.min(unitsOfMm(flight.hopMm[1]), Math.max(unitsOfMm(flight.hopMm[0]), (flight.hopS[0] + u * (flight.hopS[1] - flight.hopS[0])) * cruise));
    for (const u of [0, 0.2, 0.5, 1]) {
      const f = decided(spawn(HOUSEFLY, world(500, 500)));
      think(f, HOUSEFLY, w, () => u, null);
      expect(f.behaviour).toBe('takeoff');
      const r = distance(f.at, f.target!);
      expect(r).toBeCloseTo(expected(u), 6);
      expect(r).toBeGreaterThanOrEqual(unitsOfMm(flight.hopMm[0]) - 1e-9);
      expect(r).toBeLessThanOrEqual(unitsOfMm(flight.hopMm[1]) + 1e-9);
      // The takeoff done: the flight's clock is the place's time.
      f.behaviourS = 100;
      think(f, HOUSEFLY, w, () => u, null);
      expect(f.behaviour).toBe('fly');
      expect(f.behaviourUntilS).toBeCloseTo(r / cruise + halfTurn, 9);
    }
    // The table's fly: 0.8-3.5 s at the cruise is 1.2-5.25 m, clamped to 1.2-3 m — the shortest draw is above hopMm's floor, the top is its ceiling.
    expect(expected(0)).toBeCloseTo(Math.max(unitsOfMm(flight.hopMm[0]), flight.hopS[0] * cruise), 9);
    expect(expected(1)).toBe(unitsOfMm(flight.hopMm[1]));
  });
});

// ---------------------------------------------------------------------------
// The worm
// ---------------------------------------------------------------------------

describe('the worm', () => {
  it('digPaceFactor reads burrow.digDiscount for the burrow word only: the crawl elsewhere, and the crawl everywhere when the entry has none', () => {
    const c = spawn(EARTHWORM, world(500, 500));
    expect(digDiscountOf(EARTHWORM)).toBeGreaterThanOrEqual(1);
    expect(digPaceFactor(c, EARTHWORM)).toBe(1 / digDiscountOf(EARTHWORM));
    const digger: CreatureSpecies = { ...EARTHWORM, burrow: { ...EARTHWORM.burrow!, digDiscount: 5 } as CreatureSpecies['burrow'] };
    expect(digDiscountOf(digger)).toBe(5);
    expect(digPaceFactor(c, digger)).toBeCloseTo(0.2, 12);
    for (const word of ['surface', 'feed', 'flee', 'rest', 'idle'] as const) {
      expect(digPaceFactor({ ...c, behaviour: word }, digger), word).toBe(1);
    }
    const plain: CreatureSpecies = { ...EARTHWORM, burrow: { ...EARTHWORM.burrow!, digDiscount: undefined } as CreatureSpecies['burrow'] };
    expect(digDiscountOf(plain)).toBe(1);
    const broken: CreatureSpecies = { ...EARTHWORM, burrow: { ...EARTHWORM.burrow!, digDiscount: 0.2 } as CreatureSpecies['burrow'] };
    expect(digDiscountOf(broken)).toBe(1);
    expect(digPaceFactor(spawn(WORKER, world(0, 0)), WORKER)).toBe(1);
  });

  it('its flee is still down and away, and a disturbance within alarmMm — contact and vibration — is what alarms it', () => {
    const w = fakeWorld();
    const rand = mulberry32(67);
    const c = spawn(EARTHWORM, world(500, 500));
    for (let i = 0; i < 30 * 3; i += 1) step(c, EARTHWORM, w, rand, 1 / 30);
    const before = c.at;
    w.list = [{ at: world(before.wx + 2, before.wz), height: c.height, radius: 0, source: 'creature' }];
    let thoughts = 0;
    while (thoughts < 1) if (step(c, EARTHWORM, w, rand, 1 / 30)) thoughts += 1;
    expect(c.behaviour).toBe('flee');
    expect(c.alarm).toBeGreaterThanOrEqual(ALARM_FLEES_AT);
    expect(c.target!.wx).toBeLessThan(before.wx);
    expect(c.targetHeight).toBeCloseTo(GROUND - unitsOfMm(EARTHWORM.burrow!.underMm), 9);
  });
});
