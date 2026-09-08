/**
 * THE BRAIN — a behaviour chosen every `thinkS`, not every frame.
 *
 * Ported in shape from TCS's `creatureBrain.ts`, which ported it from
 * Beyond Extinction's dinosaurs, and the lesson that survived both moves
 * is the only one that matters: THE NUMBERS LIVE IN DATA AND NONE OF THE
 * BEHAVIOUR DOES. There is no `if (species.id === 'aphid')` in this
 * file. There is one brain per MEDIUM — soil, plant, air — because the
 * medium is what decides which words a creature may use
 * (`BEHAVIOURS_BY_MEDIUM`), and every distance, pace, duration and
 * threshold inside each is read from the species table. A fourth animal
 * of an existing medium is a table entry; the brain does not change.
 *
 * THROTTLED, AND WHY THAT IS NOT AN OPTIMISATION. With three hundred
 * creatures around the camera, thinking every frame is three hundred
 * sense passes at sixty hertz to make decisions that change twice a
 * minute. `thinkDue` consumes a per-creature accumulator seeded by its
 * hashed phase, so a cell's creatures think on different frames and the
 * load is a hum, not a spike. Clocks (`tickNeeds`) advance every step
 * regardless — a need that only ticked on think frames would be
 * quantised to `thinkS`.
 *
 * AN ALARM IS AN EVENT. `senseAlarm` runs every step, not every think,
 * because a camera that swept past between two thinks would otherwise
 * be missed (the donor's `wound` lesson). When an alarm first fires it
 * writes the AWAY point into `target` and brings the next think forward,
 * so a skittish creature is fleeing within one think of the disturbance;
 * the alarm then decays over `senses.alarmS`, and the brain returns the
 * creature to its life when it has.
 *
 * A FLOOD IS THE SAME ALARM WITH A SLOWER CAUSE (Joshua, 2026-09-08,
 * from alpha.34: "flies fly away, aphids seek dry ground, worms burrow
 * deeper/away" when flood water comes). `senseFlood` asks the water
 * where its nearest edge is, remembers the distance AND the spot it was
 * measured from, re-measures from that same spot at the next think, and
 * treats an edge that has come a solver cell nearer — or water already
 * underfoot — as a disturbance standing AT the edge. It raises the alarm
 * through the one helper `senseAlarm` uses, so the flee that follows is
 * the species' own and this file grows no species branch for it: the fly
 * takes off, the aphid drops and scrambles, the worm goes to the bottom
 * of its band and away, exactly as they do from a camera. Water moves in
 * seconds and not in frames and its edge is thousands of points, so
 * unlike `senseAlarm` this runs at THINK cadence, just ahead of the
 * think that acts on it — and it scans that edge at most twice per
 * think, once from the watch's spot and once from where the creature
 * stands when the watch is retaken, which is the price of knowing who
 * moved.
 *
 * THE FLY MEASURES FROM THE WATER, NOT THE BED, AND DRY LAND IS DRY
 * (Joshua, 2026-09-08, from a beach with the finder on: the flies "look
 * like they are underwater still and all over the place"). The ground the
 * brain reads for the worm and the aphid is the heightfield, and under
 * the sea the heightfield is the seabed. So the air brain reads
 * `floorAt` — the ground, or the water's surface where water stands on
 * it — for every height it chooses, and `isLand` refuses standing fresh
 * water as it refuses the sea, so a hop is never aimed at a puddle's bed
 * (Joshua's own words for the aphid: "seek dry ground"). The worm and
 * the aphid keep the ground: an aphid is not a boat. And a hop that runs
 * out of time short of its dry target, over a pond's corner or a bay's
 * curve, is not landed where it is: A FLY DOES NOT PERCH ON WATER
 * (`hopOffWater`, below).
 *
 * THE FLY'S FLEE IS A TAKEOFF — `state.ts` says so on the word, and the
 * renderer's `AIRBORNE` list does not include `flee`, so an air species
 * never uses the word: it takes off and flies away, which is what a fly
 * does. A worm's flee is down and away; an aphid's is a drop to the
 * ground and a scramble.
 *
 * WHAT THE WEATHER DOES. A worm surfaces in rain and at night (Edwards &
 * Bohlen; `burrow.surfacesInRain/AtNight`), and stays up while either
 * holds. A housefly is diurnal and shelters from rain (BIOLOGICAL
 * SHAPE), so rain or night grounds it: it lands if it is up and does not
 * take off until the sky clears. An aphid on its stem notices neither.
 *
 * A BIG ONE GOES FURTHER, AND FOR THE SAME REASON IT GOES FASTER. Every
 * pace this file reads — how far a fresh heading is aimed, how far a
 * flee carries, how long a walk to a stem should take — is multiplied by
 * `sizeRatio(state, species)`, and so is every distance measured in body
 * lengths, because the measured law is a fraction of the animal's own
 * body a second (Joshua, 2026-09-08: the earthworm "should be based on
 * size and dynamic"). What is NOT scaled is what belongs to the KIND
 * rather than the body: how far it can sense a disturbance, the band it
 * burrows in, and a fly's flight — a hop is the wing's, and the wing is
 * not in the table's length.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distanceSquared, translate, type WorldPoint } from '../world/coords';
import type { NearestWater, PlantSource, ResourceKind, ResourceSite } from '../world/ecology/resources';
import { SEA_LEVEL } from '../world/heightfield';
import { CELL_SPAN } from '../world/objects/cells';
import { WATER_SIM_DEFAULTS } from '../world/water/sim';
import { unitsOfMetres } from './finder';
import { ahead, headingToward, wrapHeading } from './heading';
import { arrived, floorAt, isAirborne, isMoving } from './locomotion';
import { PERCH_FRACTION } from './population';
import { sizeRatio, unitsOfMm, type CreatureSpecies, type FlightSpec } from './species';
import { behaviourAllowed, type Behaviour, type CreatureState } from './state';
import type { CreatureWeather, CreatureWorld, Disturbance } from './world';

// ---------------------------------------------------------------------------
// The few numbers that are the brain's own: dimensionless, and one weather line
// ---------------------------------------------------------------------------

/** Alarm at or above this is a creature that acts on it. BIOLOGICAL SHAPE: alarm is 0..1 and half is the line. */
export const ALARM_FLEES_AT = 0.5;
/** Rain heavier than this is "raining" to a creature. GAME TUNING: a drizzle counts, dew does not. mm/hr. */
export const RAINING_MM_HR = 0.5;
/** A plant creature's walks stay within this many body lengths of its host. GAME TUNING, from the ecology brief. */
export const HOST_WALK_LENGTHS = 5;
/** How far a plant creature scrambles from its spot on alarm, body lengths. GAME TUNING. */
export const HOST_FLEE_LENGTHS = 3;
/** After a feed, the chance a plant creature takes a short walk rather than feeding on. GAME TUNING: feeding dominates. */
export const WALK_CHANCE = 0.5;
/** When not hungry, the chance a flier is drawn to a resource in sight rather than hopping at random. GAME TUNING. */
export const ATTRACTION_CHANCE = 0.5;
/** How many hops a flier tries before accepting there is no land to hop to. GAME TUNING. */
const LANDWARD_TRIES = 4;
/** A flier takes off into level flight once it has this much of its cruise floor under it. GAME TUNING. */
const TAKEOFF_FRACTION = 0.8;
/**
 * How far away a fresh-water edge is worth watching, world units: 50 m.
 * GAME TUNING — Joshua's starting test radius (2026-09-08: "~50 m as a
 * starting test radius"), not a measured sense of any of the three
 * animals; it is one number for every species on purpose, so the first
 * device test changes one line. In world units rather than in the
 * species' millimetres because it is not a property of a body: a flood
 * is felt by the ground going, not by an antenna.
 */
export const FLOOD_THREAT = unitsOfMetres(50);
/**
 * How much nearer a fresh-water edge must read, from the same spot,
 * before it counts as COMING, world units: one solver cell, 1 m. DERIVED
 * FROM THE SOLVER'S LATTICE, not tuned — the shoreline is the wet cells
 * of `WaterSim`'s 1 m grid (`WATER_SIM_DEFAULTS.cell`), so the nearest
 * edge point can only ever be a lattice point, and a change smaller
 * than a cell is the nearest cell FLIPPING, not water moving: a film
 * draining from one cell and pooling in the next moves the reading by
 * a fraction of a metre while the flood stands still, and a sense that
 * fired on that would flip a creature between alarm and calm at every
 * think (Joshua, 2026-09-08: "flood edges can wiggle numerically even
 * when the actual flood is steadily advancing"). Read from the solver's
 * own table so the two cannot drift apart; a window built with another
 * cell size is not something the brain can see, and the shipped one is
 * the one the animals live beside.
 */
export const FLOOD_CLOSING = WATER_SIM_DEFAULTS.cell;

/** The sky when the world has none to report: calm, dry, daylight. */
export const CALM_WEATHER: CreatureWeather = Object.freeze({ rainMmHr: 0, windX: 0, windZ: 0, night: false });

// ---------------------------------------------------------------------------
// Clocks and senses — every step
// ---------------------------------------------------------------------------

/** A number in a range from a 0..1 draw. */
function draw(rand: () => number, range: readonly [number, number]): number {
  return range[0] + rand() * (range[1] - range[0]);
}

/** Enter a behaviour, restarting its clock only on a real change, and set how long it is meant to last. */
function enter(state: CreatureState, behaviour: Behaviour, untilS: number): void {
  if (state.behaviour !== behaviour) {
    state.behaviour = behaviour;
    state.behaviourS = 0;
  }
  state.behaviourUntilS = untilS;
}

/** Enter a behaviour and restart its clock even when it is the same word: a new heading, another feed. */
function renew(state: CreatureState, behaviour: Behaviour, untilS: number): void {
  state.behaviour = behaviour;
  state.behaviourS = 0;
  state.behaviourUntilS = untilS;
}

/**
 * Advance the clocks: time in the behaviour, time since the last thought,
 * the alarm's decay, and the needs. Hunger climbs while not feeding and
 * falls to nothing over the feed that was chosen; fatigue climbs while
 * moving and falls over the rest. Every bar that moves has its way back
 * (CLAUDE.md's survival invariant).
 */
export function tickNeeds(state: CreatureState, species: CreatureSpecies, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  state.behaviourS += dt;
  state.sinceThink += dt;
  if (state.alarm > 0) state.alarm = Math.max(0, state.alarm - dt / Math.max(1e-3, species.senses.alarmS));
  const needs = species.needs;
  if (state.behaviour === 'feed') {
    state.hunger = Math.max(0, state.hunger - dt / Math.max(state.behaviourUntilS, needs.feedS[0], 1e-3));
  } else {
    state.hunger = Math.min(1, state.hunger + needs.hungerPerS * dt);
  }
  if (state.behaviour === 'rest') {
    state.fatigue = Math.max(0, state.fatigue - dt / Math.max(state.behaviourUntilS, needs.restS[0], 1e-3));
  } else if (isMoving(state.behaviour)) {
    state.fatigue = Math.min(1, state.fatigue + needs.fatiguePerS * dt);
  }
}

/**
 * Is a decision about to be due? A look and not a consumption: the
 * simulation asks this to run the senses that belong to a think just
 * ahead of it (`senseFlood`), and `thinkDue` is the one call that then
 * takes the accumulator.
 */
export function thinkPending(state: CreatureState, species: CreatureSpecies): boolean {
  return state.sinceThink >= species.thinkS;
}

/** Is a decision due? Consumes the accumulator when it is; a step longer than `thinkS` earns one thought, not several. */
export function thinkDue(state: CreatureState, species: CreatureSpecies): boolean {
  if (!thinkPending(state, species)) return false;
  state.sinceThink = Math.min(species.thinkS, state.sinceThink - species.thinkS);
  return true;
}

/**
 * How far a flee takes a creature: what ITS flee pace covers in the
 * alarm's hold, so a long worm retreats further than a short one in the
 * same six seconds. For a flier it is the longest hop, which belongs to
 * the flight spec and not to the body.
 */
function fleeDistance(state: CreatureState, species: CreatureSpecies): number {
  if (species.flight !== null) return unitsOfMm(species.flight.hopMm[1]);
  return sizeRatio(state, species) * unitsOfMm(species.pace.fleeMmS) * species.senses.alarmS;
}

/**
 * Raise the alarm to 1 because of something at `from`. On the FIRST
 * raise — calm to alarmed — the away point is written to `target` and
 * the next think is brought forward, so the flee is decided at once and
 * in a direction that was true when the alarm sounded; an alarm that is
 * already up is only held up. Standing exactly on the cause, "away" is
 * the reverse of the heading, since a direction from a point to itself
 * is no direction. The one place a flee's direction is decided, shared
 * by the disturbance sense and the flood sense so the two cannot drift.
 * Returns whether a new alarm fired.
 */
function raiseAlarm(state: CreatureState, species: CreatureSpecies, from: WorldPoint): boolean {
  const wasCalm = state.alarm < ALARM_FLEES_AT;
  state.alarm = 1;
  if (!wasCalm) return false;
  const away = from.wx === state.at.wx && from.wz === state.at.wz
    ? wrapHeading(state.heading + Math.PI)
    : headingToward(from, state.at);
  state.target = ahead(state.at, away, fleeDistance(state, species));
  state.sinceThink = species.thinkS;
  return true;
}

/**
 * Notice a disturbance. One inside `senses.alarmMm` plus the
 * disturbance's own radius (in three dimensions: a camera two metres
 * over a worm is not on top of it) raises the alarm through
 * `raiseAlarm`, away from the nearest one. Returns whether a new alarm
 * fired.
 */
export function senseAlarm(state: CreatureState, species: CreatureSpecies, disturbances: readonly Disturbance[]): boolean {
  if (disturbances.length === 0) return false;
  const reach = unitsOfMm(species.senses.alarmMm);
  let nearest = -1;
  let nearestD2 = Infinity;
  for (let i = 0; i < disturbances.length; i += 1) {
    const d = disturbances[i];
    const r = reach + Math.max(0, d.radius);
    const dh = d.height - state.height;
    const d2 = distanceSquared(state.at, d.at) + dh * dh;
    if (d2 <= r * r && d2 < nearestD2) {
      nearest = i;
      nearestD2 = d2;
    }
  }
  if (nearest < 0) return false;
  return raiseAlarm(state, species, disturbances[nearest].at);
}

/**
 * Notice the water coming. Keeps a WATCH — the distance to the nearest
 * fresh edge within `FLOOD_THREAT` (`waterEdge`, -1 for none) and the
 * spot it was measured from (`waterEdgeFrom`, null with it) — and raises
 * the alarm, away from the edge, when either
 *
 *   (a) the edge, re-measured FROM THE WATCH'S SPOT, is at least
 *       `FLOOD_CLOSING` nearer than the watch read (so the first sight of
 *       an edge is a reading, not a fright: a worm born forty metres from
 *       a river is not born fleeing it), or
 *   (b) the water is already UNDER the creature, edge or no edge — a
 *       flood that arrived between two thinks, or a pool so wide its
 *       edge is out of reach.
 *
 * IT KNOWS WHO MOVED. The re-measure is taken from the spot the watch was
 * set at, not from where the creature is now, so a creature's own walk
 * toward the water changes nothing it compares: a fly flying to a
 * water-edge site to drink finds the edge exactly as far from its old
 * perch as it was, and is not spooked by its own approach. Only the
 * WATER can shorten that distance. The creature's position enters once,
 * when the watch is retaken from where it stands.
 *
 * THE WATCH HOLDS THROUGH A WIGGLE (Joshua, 2026-09-08: "react when
 * significantly closer than before, stay alarmed for a short period").
 * The edge is lattice points, and the nearest one flipping a cell either
 * way moves the reading by less than `FLOOD_CLOSING` — see that constant
 * — so a watch replaced at every think by the latest reading would only
 * ever see one cell of change, and a flood advancing one cell per think
 * or slower would never read as coming — and one cell per think is 2 m/s
 * for the worm and nearly 7 m/s for a fly thinking every 0.15 s, while a
 * shallow-water front runs at about √(g·h), a metre a second for a sheet
 * a decimetre deep (BIOLOGICAL SHAPE of the water, not a measurement of
 * this solver's). So the watch is
 * HELD while the re-measure is no further and less than a cell nearer,
 * and a steady advance accumulates against it until it crosses the cell
 * — however slowly it comes. It is RETAKEN from where the creature
 * stands when the water recedes (nothing to accumulate), when it has
 * come (the alarm has fired and a new watch starts from here), when the
 * old spot no longer has an edge in reach, and when the creature itself
 * has left the spot by more than a cell — a watch is FROM a spot, and a
 * spot the body has left by more than the water's own resolution is
 * somebody else's. That last rule means a creature on the move is
 * watching from where it is; the one that a flood catches is the one
 * that stayed put, and its watch is the one that holds.
 *
 * "Stay alarmed for a short period" is what `raiseAlarm` already gives:
 * the alarm goes to 1 and decays over `senses.alarmS`, and a re-measure
 * that reads closing while it is up only holds it there. There is no
 * second timer here.
 *
 * Away from the EDGE, not from the depth: the edge is where the water is
 * coming from, and the far side of it is where the water is — the one
 * nearest the creature now, failing that the one the watch saw come,
 * and with no edge in reach at all and water underfoot, the reverse of
 * the heading, which is the best a creature standing in water with no
 * bank in sight can do.
 *
 * COST: one scan of the shoreline per think while the watch holds, two
 * when it is retaken — the price of measuring from a fixed spot and
 * then from the creature's own. Returns whether a new alarm fired. No
 * water known: the watch is cleared and nothing fires.
 */
export function senseFlood(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): boolean {
  const water = world.water;
  if (water === null) {
    state.waterEdge = -1;
    state.waterEdgeFrom = null;
    return false;
  }
  const from = state.waterEdgeFrom;
  const before = state.waterEdge;
  // The edge as the watch's spot sees it now: the only reading "closing" is ever judged on.
  let watched: NearestWater | null = null;
  let closing = false;
  let hold = false;
  if (from !== null && before >= 0) {
    watched = water.nearestWater(from, FLOOD_THREAT);
    if (watched !== null) {
      closing = watched.distance < before - FLOOD_CLOSING;
      hold = !closing
        && watched.distance <= before
        && distanceSquared(from, state.at) <= FLOOD_CLOSING * FLOOD_CLOSING;
    }
  }
  let edge: NearestWater | null = watched;
  if (!hold) {
    edge = water.nearestWater(state.at, FLOOD_THREAT);
    state.waterEdge = edge === null ? -1 : edge.distance;
    state.waterEdgeFrom = edge === null ? null : state.at;
  }
  const underfoot = water.freshDepthAt(state.at) > 0;
  if (!closing && !underfoot) return false;
  const cause = edge ?? watched;
  return raiseAlarm(state, species, cause === null ? state.at : cause.at);
}

// ---------------------------------------------------------------------------
// Looking around
// ---------------------------------------------------------------------------

/**
 * DRY land the creatures may aim at: ground above the sea, not the sea to
 * the water, not the sea to the habitat — and not under standing fresh
 * water either. A puddle's bed is ground the heightfield prices above the
 * sea and the habitat calls shrubland, and a fly that aimed at it landed
 * on the bed with the pond over it; a flooded bank is the same to a fly
 * fleeing the flood. "Seek dry ground" (Joshua, 2026-09-08, for the
 * aphid) is the rule for anything that picks a spot to stand: dry is
 * dry. With no water known, nothing is wet — a null water is "no water
 * known", not "dry", but there is no reading to refuse on, and the sea
 * is still refused by the ground and the habitat.
 *
 * A water-edge site passes: it is derived at a DRY lattice sample beside
 * a wet one (`world/ecology/derive.ts`), so a drink is aimed at the
 * bank, not the water. One the water has since risen over is refused
 * until its cell's next refresh — which is right, because the bank it
 * marked is under the pond now.
 */
export function isLand(world: CreatureWorld, at: WorldPoint): boolean {
  if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return false;
  const ground = world.groundAt(at);
  if (!(ground >= SEA_LEVEL)) return false;
  const water = world.water;
  if (water !== null) {
    if (water.isSeaAt(at)) return false;
    // `> 0`, not `!== 0`: a NaN depth is not wet, as the resource layer reads it.
    if (water.freshDepthAt(at) > 0) return false;
  }
  return world.habitatAt(at).kind !== 'sea';
}

/**
 * The nearest resource site of one of `kinds` within `radius` of `at`,
 * scanning only the cells the circle touches. Returns the site the layer
 * owns, never a copy; null when there is none or the layer is not built.
 */
export function nearestSite(world: CreatureWorld, at: WorldPoint, kinds: readonly ResourceKind[], radius: number): ResourceSite | null {
  if (kinds.length === 0 || !(radius > 0)) return null;
  const cx0 = Math.floor((at.wx - radius) / CELL_SPAN);
  const cx1 = Math.floor((at.wx + radius) / CELL_SPAN);
  const cz0 = Math.floor((at.wz - radius) / CELL_SPAN);
  const cz1 = Math.floor((at.wz + radius) / CELL_SPAN);
  let best: ResourceSite | null = null;
  let bestD2 = radius * radius;
  for (let cz = cz0; cz <= cz1; cz += 1) {
    for (let cx = cx0; cx <= cx1; cx += 1) {
      const cell = world.resourcesOf(cx, cz);
      if (cell === null) continue;
      const sites = cell.sites;
      for (let i = 0; i < sites.length; i += 1) {
        const site = sites[i];
        if (!kinds.includes(site.kind)) continue;
        const d2 = distanceSquared(at, site.at);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = site;
        }
      }
    }
  }
  return best;
}

/**
 * The plant a creature's `hostId` names, found in its cell's plants. The
 * id carries the cell (`family:cx,cz:site`), so the lookup is one cell's
 * list and not the world's. The simulation caches the answer per
 * creature; this is the slow path a test or a single think may take.
 */
export function hostPlantOf(state: CreatureState, world: CreatureWorld): PlantSource | null {
  const id = state.hostId;
  if (id === null) return null;
  const m = /^[^:]+:(-?\d+),(-?\d+):/.exec(id);
  if (m === null) return null;
  const plants = world.plantsOf(Number(m[1]), Number(m[2]));
  if (plants === null) return null;
  for (let i = 0; i < plants.length; i += 1) if (plants[i].id === id) return plants[i];
  return null;
}

/** A hop `hopMm` away in a random direction that lands on dry land, or null when four tries found only sea or standing water. */
function landwardHop(world: CreatureWorld, at: WorldPoint, flight: FlightSpec, rand: () => number): WorldPoint | null {
  for (let i = 0; i < LANDWARD_TRIES; i += 1) {
    const theta = rand() * Math.PI * 2;
    const r = unitsOfMm(draw(rand, flight.hopMm));
    const t = translate(at, Math.sin(theta) * r, Math.cos(theta) * r);
    if (isLand(world, t)) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * WHAT IT DOES NEXT. Reads the needs, the alarm, the sky and the medium;
 * writes `behaviour`, `behaviourUntilS`, `target`, `targetHeight` and
 * `hostId`, and nothing else. Every word it writes is one its medium
 * allows, and it throws if it is not — a bug in the brain is a test
 * failure, never a worm in the air.
 *
 * `host` is the plant a plant creature sits on, when the caller has it
 * (the simulation caches it); `undefined` asks this function to find it,
 * `null` says there is none.
 */
export function think(
  state: CreatureState,
  species: CreatureSpecies,
  world: CreatureWorld,
  rand: () => number,
  weather: CreatureWeather | null,
  host?: PlantSource | null,
): void {
  const sky = weather ?? CALM_WEATHER;
  const ground = world.groundAt(state.at);
  switch (species.medium) {
    case 'soil':
      thinkSoil(state, species, world, rand, sky, ground);
      break;
    case 'plant':
      thinkPlant(state, species, world, rand, host === undefined ? hostPlantOf(state, world) : host, ground);
      break;
    case 'air':
      thinkAir(state, species, world, rand, sky);
      break;
  }
  if (!Number.isFinite(state.targetHeight)) state.targetHeight = state.height;
  if (!Number.isFinite(state.behaviourUntilS) || state.behaviourUntilS < 0) state.behaviourUntilS = 0;
  if (!behaviourAllowed(species.medium, state.behaviour)) {
    throw new Error(`creatures/intent: ${species.id} (${species.medium}) chose "${state.behaviour}", which its medium does not allow`);
  }
}

/**
 * SOIL. Its life is the band under the surface: a heading held for
 * `headingS`, then a new one turned by `turn` of a half-turn; up to the
 * surface when it rains, at night, when hungry with litter within
 * sensing distance, or now and then on its own schedule; a rest when
 * tired; and, on alarm, down to the bottom of the band and away.
 */
function thinkSoil(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, sky: CreatureWeather, ground: number,
): void {
  const spec = species.burrow;
  if (spec === null) return;
  const needs = species.needs;
  const bottom = Number.isFinite(ground) ? ground - unitsOfMm(spec.underMm) : state.height;

  if (state.alarm >= ALARM_FLEES_AT) {
    if (state.behaviour !== 'flee') {
      if (state.target === null) state.target = ahead(state.at, wrapHeading(state.heading + Math.PI), fleeDistance(state, species));
      state.targetHeight = bottom;
      state.hostId = null;
      enter(state, 'flee', species.senses.alarmS);
    }
    return;
  }

  const wantsUp = (sky.rainMmHr >= RAINING_MM_HR && spec.surfacesInRain) || (sky.night && spec.surfacesAtNight);
  const done = state.behaviourS >= state.behaviourUntilS;

  switch (state.behaviour) {
    case 'flee':
      if (!done) return;
      newHeading(state, species, spec, rand, ground);
      return;
    case 'surface': {
      if (!done) return;
      if (state.hunger >= needs.feedAt) {
        const litter = nearestSite(world, state.at, needs.eats, unitsOfMm(species.senses.sightMm));
        state.target = litter === null ? null : litter.at;
        state.hostId = litter === null ? null : litter.id;
        state.targetHeight = ground;
        enter(state, 'feed', draw(rand, needs.feedS));
        return;
      }
      // Still raining, still night: stay up, on a fresh clock.
      if (wantsUp) renew(state, 'surface', draw(rand, spec.surfaceS));
      else newHeading(state, species, spec, rand, ground);
      return;
    }
    case 'feed':
      if (!done) return;
      state.target = null;
      state.hostId = null;
      if (wantsUp) renew(state, 'surface', draw(rand, spec.surfaceS));
      else newHeading(state, species, spec, rand, ground);
      return;
    case 'rest':
      if (!done) return;
      newHeading(state, species, spec, rand, ground);
      return;
    default: {
      // Burrowing (and the shared words, should a save carry one).
      const hungry = state.hunger >= needs.feedAt;
      const litterNear = hungry && nearestSite(world, state.at, needs.eats, unitsOfMm(species.senses.sightMm)) !== null;
      // Its own schedule: one surfacing per `betweenSurfacingsS` on average, as a chance per think. BIOLOGICAL SHAPE.
      const between = (spec.betweenSurfacingsS[0] + spec.betweenSurfacingsS[1]) / 2;
      const scheduled = rand() < species.thinkS / Math.max(species.thinkS, between);
      if (wantsUp || litterNear || scheduled) {
        state.target = null;
        state.hostId = null;
        state.targetHeight = ground;
        enter(state, 'surface', draw(rand, spec.surfaceS));
        return;
      }
      if (state.fatigue >= needs.restAt) {
        state.target = null;
        enter(state, 'rest', draw(rand, needs.restS));
        return;
      }
      if (state.behaviour !== 'burrow' || done) newHeading(state, species, spec, rand, ground);
    }
  }
}

/** A fresh heading in the band: turned by up to `turn` of a half-turn either way, held for `headingS`, aimed at the band's middle. */
function newHeading(
  state: CreatureState, species: CreatureSpecies, spec: NonNullable<CreatureSpecies['burrow']>, rand: () => number, ground: number,
): void {
  const hold = draw(rand, spec.headingS);
  const heading = wrapHeading(state.heading + (rand() * 2 - 1) * spec.turn * Math.PI);
  // As far as THIS worm gets in the time it holds the heading, so the
  // target is where it will actually be and not where the cited animal
  // would have been.
  state.target = ahead(state.at, heading, sizeRatio(state, species) * unitsOfMm(species.pace.wanderMmS) * hold);
  state.hostId = null;
  if (Number.isFinite(ground)) state.targetHeight = ground - (unitsOfMm(spec.underMm) + unitsOfMm(spec.boreMm) / 2) / 2;
  renew(state, 'burrow', hold);
}

/**
 * PLANT. It feeds on its host most of the time, broken by short walks
 * within a few body lengths of it and rests when tired. On alarm it
 * drops to the ground and scrambles a few body lengths, then walks back
 * when calm. It never leaves its host: `hostId` is kept through all of
 * it. Without a host (none in the cell, or not found) it feeds where it
 * stands and does not walk.
 */
function thinkPlant(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, host: PlantSource | null, ground: number,
): void {
  const needs = species.needs;
  // Its own body, not the table's: a 4 mm aphid keeps to five of ITS
  // lengths of the stem, which is further than a 1.5 mm one goes.
  const body = sizeRatio(state, species) * unitsOfMm(species.lengthMm);
  const done = state.behaviourS >= state.behaviourUntilS;

  if (state.alarm >= ALARM_FLEES_AT) {
    if (state.behaviour !== 'flee') {
      const away = state.target === null ? wrapHeading(state.heading + Math.PI) : headingToward(state.at, state.target);
      state.target = ahead(state.at, away, HOST_FLEE_LENGTHS * body);
      state.targetHeight = ground;
      enter(state, 'flee', species.senses.alarmS);
    }
    return;
  }

  switch (state.behaviour) {
    case 'flee':
      if (!done) return;
      if (host === null) {
        state.target = null;
        enter(state, 'idle', draw(rand, needs.restS));
        return;
      }
      walkOnHost(state, species, world, rand, host, 0);
      return;
    case 'wander':
      if (!done && !arrived(state, species)) return;
      state.target = null;
      enter(state, 'feed', draw(rand, needs.feedS));
      return;
    case 'rest':
      if (!done) return;
      enter(state, 'feed', draw(rand, needs.feedS));
      return;
    case 'feed':
      if (!done) return;
      if (state.fatigue >= needs.restAt) {
        enter(state, 'rest', draw(rand, needs.restS));
        return;
      }
      if (state.hunger < needs.feedAt && host !== null && rand() < WALK_CHANCE) {
        walkOnHost(state, species, world, rand, host, HOST_WALK_LENGTHS * body);
        return;
      }
      renew(state, 'feed', draw(rand, needs.feedS));
      return;
    default:
      state.target = null;
      enter(state, 'feed', draw(rand, needs.feedS));
  }
}

/** Walk to a spot within `reach` of the host's foot and a perch height up its stem. */
function walkOnHost(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, host: PlantSource, reach: number,
): void {
  const theta = rand() * Math.PI * 2;
  const r = reach * Math.sqrt(rand());
  const target = translate(host.at, Math.sin(theta) * r, Math.cos(theta) * r);
  const ground = world.groundAt(target);
  const perch = PERCH_FRACTION[0] + (PERCH_FRACTION[1] - PERCH_FRACTION[0]) * rand();
  state.target = target;
  state.targetHeight = (Number.isFinite(ground) ? ground : state.height) + perch * Math.max(0, host.size);
  const pace = sizeRatio(state, species) * unitsOfMm(species.pace.wanderMmS);
  const far = Math.sqrt(distanceSquared(state.at, target)) + Math.abs(state.targetHeight - state.height);
  enter(state, 'wander', pace > 0 ? far / pace + 1 : 1);
}

/**
 * A FLY DOES NOT PERCH ON WATER.
 *
 * Every hop is aimed at dry land (`landwardHop`, `isLand`), but a hop is
 * a CLOCK as well as a place: `hopS` can run out short of the target,
 * and where it runs out is wherever the path was — a pond's corner, the
 * curve of a bay along a beach. The old brain hovered there, landed
 * there and perched there, and `walk` then set the perched body's height
 * to the GROUND, which under water is the bed: Joshua's flies sitting
 * on and under the sea along the shore (2026-09-08) were flies that had
 * run out of hop over the water and perched where they were.
 *
 * So a hover or a landing that finds no land under it does not perch.
 * It takes a hop toward dry ground and flies it, a cruise floor over
 * whatever is under the target; and when four tries find only water it
 * hovers a cruise floor over the water — `floorAt` keeps a hover above
 * the surface — and asks again at the next think. Water is never a
 * place to stop, only a place to be over. The hop is random, as every
 * hop with nothing to aim at is: the dry target it was short of is not
 * kept, because a target a hop failed to reach is, in the same wind and
 * at the same pace, a target the next hop may fail to reach.
 *
 * `floor` is the floor under the fly now and `lo` the cruise floor above
 * it, both already read by the caller. The site it was flying to, if
 * any, is let go with the target: it is not there, and a perch elsewhere
 * that still named it would feed at a flower it never reached.
 */
function hopOffWater(
  state: CreatureState, world: CreatureWorld, flight: FlightSpec, rand: () => number, floor: number, lo: number,
): void {
  state.hostId = null;
  const hop = landwardHop(world, state.at, flight, rand);
  if (hop !== null) {
    const under = floorAt(world, hop);
    state.target = hop;
    state.targetHeight = (Number.isFinite(under) ? under : floor) + lo;
    enter(state, 'fly', draw(rand, flight.hopS));
    return;
  }
  state.target = state.at;
  state.targetHeight = floor + lo;
  enter(state, 'hover', draw(rand, flight.hoverS));
}

/**
 * AIR. Perch → takeoff → fly → hover → land → feed, rest or perch again.
 * The flight aims at a resource it is drawn to when one is in sight
 * (always when hungry, half the time otherwise), else a random hop of
 * `hopMm` that is checked to land on dry land — never over the sea,
 * never on standing water. On alarm it takes off (or, already up, flies
 * on) toward the away point and keeps going while the alarm holds. Rain
 * and night ground it — on the ground: a hover or a landing that finds
 * water under it hops for land instead (`hopOffWater`), and the rain
 * brings a fly down at the first dry ground under it, not before.
 *
 * Every height this brain chooses is measured from the FLOOR (`floorAt`
 * in `locomotion.ts`) and not from the ground `think` reads for the
 * other two media: the ground under a fly on a beach is the seabed two
 * metres down, and a cruise band hung from it is under water. So the
 * floor is read here, where the fly stands, and again under each target
 * as it is chosen — a takeoff, a hover and a landing are all so many
 * centimetres over the surface that is actually there.
 */
function thinkAir(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, sky: CreatureWeather,
): void {
  const flight = species.flight;
  if (flight === null) return;
  const needs = species.needs;
  const body = sizeRatio(state, species) * unitsOfMm(species.lengthMm);
  const lo = unitsOfMm(flight.cruiseMm[0]);
  const climb = unitsOfMm(flight.climbMmS);
  const floor = floorAt(world, state.at);
  const g = Number.isFinite(floor) ? floor : state.height;
  const above = state.height - g;
  const grounded = sky.rainMmHr >= RAINING_MM_HR || sky.night;
  const done = state.behaviourS >= state.behaviourUntilS;

  if (state.alarm >= ALARM_FLEES_AT) {
    if (state.target === null || !isLand(world, state.target)) {
      // The away point is over the sea: any hop to land will do, else hold here.
      state.target = landwardHop(world, state.at, flight, rand) ?? state.at;
    }
    state.hostId = null;
    if (!isAirborne(state.behaviour)) {
      state.targetHeight = g + unitsOfMm(flight.cruiseMm[1]);
      enter(state, 'takeoff', lo / climb);
    } else if (state.behaviour === 'takeoff') {
      if (above >= TAKEOFF_FRACTION * lo || done) enter(state, 'fly', draw(rand, flight.hopS));
    } else if (state.behaviour !== 'fly') {
      state.targetHeight = g + unitsOfMm(flight.cruiseMm[1]);
      enter(state, 'fly', draw(rand, flight.hopS));
    } else if (done || arrived(state, species)) {
      // Still alarmed at the end of the hop: keep going the same way.
      state.target = ahead(state.at, state.heading, fleeDistance(state, species));
      if (!isLand(world, state.target)) state.target = landwardHop(world, state.at, flight, rand) ?? state.at;
      renew(state, 'fly', draw(rand, flight.hopS));
    }
    return;
  }

  switch (state.behaviour) {
    case 'takeoff':
      if (above < TAKEOFF_FRACTION * lo && !done) return;
      enter(state, 'fly', draw(rand, flight.hopS));
      return;
    case 'fly': {
      // Grounded means brought down at the first dry ground: over water the hop is flown out.
      if (!done && !arrived(state, species) && !(grounded && isLand(world, state.at))) return;
      if (state.target === null) state.target = state.at;
      const under = floorAt(world, state.target);
      state.targetHeight = (Number.isFinite(under) ? under : g) + lo;
      enter(state, 'hover', draw(rand, flight.hoverS));
      return;
    }
    case 'hover': {
      if (!done) return;
      if (!isLand(world, state.at)) {
        hopOffWater(state, world, flight, rand, g, lo);
        return;
      }
      if (state.target === null) state.target = state.at;
      const under = floorAt(world, state.target);
      state.targetHeight = Number.isFinite(under) ? under : g;
      enter(state, 'land', Math.max(0, above) / climb + flight.hoverS[1]);
      return;
    }
    case 'land':
      if (above > body && !done) return;
      if (!isLand(world, state.at)) {
        hopOffWater(state, world, flight, rand, g, lo);
        return;
      }
      state.target = null;
      state.targetHeight = g;
      if (state.hostId !== null && state.hunger >= needs.feedAt) enter(state, 'feed', draw(rand, needs.feedS));
      else if (state.fatigue >= needs.restAt) enter(state, 'rest', draw(rand, needs.restS));
      else enter(state, 'idle', draw(rand, flight.perchS));
      return;
    default: {
      // Perched: idle, feeding, resting, or walking about the perch.
      if (state.behaviour === 'idle' && state.behaviourS === 0 && state.behaviourUntilS === 0) {
        // Fresh from the population: a perch of its own length first, so a cell does not all take off together.
        enter(state, 'idle', draw(rand, flight.perchS));
        return;
      }
      if (!done && !(state.behaviour === 'wander' && arrived(state, species))) return;
      if (state.fatigue >= needs.restAt && state.behaviour !== 'rest') {
        state.target = null;
        enter(state, 'rest', draw(rand, needs.restS));
        return;
      }
      if (grounded) {
        state.target = null;
        enter(state, 'idle', draw(rand, flight.perchS));
        return;
      }
      const hungry = state.hunger >= needs.feedAt;
      const sight = unitsOfMm(species.senses.sightMm);
      let site: ResourceSite | null = null;
      if (hungry) site = nearestSite(world, state.at, needs.eats, sight);
      else if (rand() < ATTRACTION_CHANCE) site = nearestSite(world, state.at, flight.drawnTo, sight);
      if (site !== null && hungry && distanceSquared(state.at, site.at) <= body * body) {
        // Already on it.
        state.target = null;
        state.hostId = site.id;
        enter(state, 'feed', draw(rand, needs.feedS));
        return;
      }
      if (site !== null && isLand(world, site.at)) {
        state.target = site.at;
        state.hostId = site.id;
      } else {
        state.target = landwardHop(world, state.at, flight, rand);
        state.hostId = null;
      }
      if (state.target === null) {
        enter(state, 'idle', draw(rand, flight.perchS));
        return;
      }
      state.targetHeight = g + unitsOfMm(draw(rand, flight.cruiseMm));
      enter(state, 'takeoff', lo / climb);
    }
  }
}
