/**
 * THE CREATURE LAB'S WORLD — one cubic metre the five animals share,
 * as the same read-only query the island is (`CreatureWorld`), with
 * nothing invented that the island would not offer.
 *
 * Joshua's Creature Lab brief, §6: "approximately 1 × 1 × 1 m bounded
 * test volume … flat soil, uneven soil patch, grass, flower, broadleaf,
 * shrub, small fern, leaf litter … shallow freshwater edge, nectar
 * source, seed source, sap source, litter/detritus food … a CENTRAL
 * TEST BLOCK approximately 15-25 cm across." And §35: "No separate 'lab
 * version' of the creature code. The LAB should use the SAME production
 * modules that Kauaʻi will eventually import." So this file is a
 * `CreatureWorld` and nothing else — the brain (`intent.ts`) and the
 * integrator (`demand.ts`) read it exactly as they read the island,
 * through `groundAt`, `habitatAt`, `plantsOf`, `resourcesOf`, `water`,
 * `weather` and `disturbances`, and could not tell the difference. The
 * few things a lab needs that an island does not — a box, a DISTURB
 * tool, a camera that may or may not disturb (§30), a reset — are
 * added on the side (`LabWorld`), never by a second creature engine.
 *
 * WHAT IS HERE, AND WHERE. Units are the world's, centimetres; the box
 * is `LAB_SIZE` across, centred on the origin, and every number below
 * is GAME TUNING from the brief's list unless a line says otherwise.
 *
 *   the floor       flat at `LAB_FLOOR`, a metre above mean sea level.
 *                   NOT at zero: `SEA_LEVEL` is 0 and every rule that
 *                   refuses the sea (`isLand`, the population, the
 *                   floor a flier measures from) reads ground below it
 *                   as sea, and the uneven patch and the puddle's dish
 *                   both dip below the floor. A bench top a metre up is
 *                   the same lab without the trap.
 *   the patch       `BUMP`: a 20 cm square of ±5 mm value noise at a
 *                   2 cm wavelength (`world/random.ts`, the island's own
 *                   noise), deterministic — the same bumps every time.
 *   the block       `BLOCK`: 20 cm square, 20 cm tall, on the origin —
 *                   a SLAB ON A PEDESTAL, two `Climbable` boxes
 *                   (`PILLAR_BOX`, `SLAB_BOX`, listed as `LAB_CLIMBABLES`
 *                   and offered as the world's `climbables`). The
 *                   ground is the FLOOR everywhere, under the slab too:
 *                   a climber walks into the pillar and up it, out
 *                   along the underside, round the slab's edge and onto
 *                   its top (`surface.ts`; the brief's §14, Creature
 *                   Lab D), and the worm walks under it. The block's
 *                   top used to be the ground over its footprint, a
 *                   20 cm step in one frame, and that is gone: nothing
 *                   in the ground answers for the block any more.
 *                   `inwardTarget` still keeps a wandering animal clear
 *                   of the footprint, and the brain keeps off the
 *                   pillar (`intent.routeTarget`), so a climb is a
 *                   thing a player sees, not a thing the AI does all
 *                   day.
 *   the puddle      `PUDDLE`: a 10 cm circle in the north-west corner, a
 *                   parabolic dish 5 mm deep at the centre, full to the
 *                   floor — so the water's surface is the floor's level
 *                   and the ground under it is the dish. The water is a
 *                   real `WaterQuery` (the resource layer's contract,
 *                   §24: "REAL water-query contracts"): depth, not sea,
 *                   and the nearest point of the rim.
 *   the plants      `LAB_PLANTS`: five `PlantSource`s at fixed spots, of
 *                   families the resource layer names (grass, flower,
 *                   broadleaf, shrub, fern), each with an id in the
 *                   island's form (`family:cx,cz:n`) so `hostPlantOf`
 *                   finds it through `plantsOf`. The aphid's host is the
 *                   broadleaf — a dicot, which the research says is what
 *                   a melon aphid sits on (SUMMARY §3).
 *   the resources   `LAB_SITES`: nectar at the flower's head, seed at
 *                   the grass head, sap on the broadleaf's stem, litter
 *                   in the north-east corner, a honeydew host on the
 *                   broadleaf, a water edge on the puddle's rim, and the
 *                   PROTEIN TEST RESOURCE (§23) as a `carrion` site: the
 *                   layer names carrion and derives it from nothing in
 *                   the wild (a carcass is a creature that has died, a
 *                   later milestone), and the Lab places one so a
 *                   worker's protein choice can be watched. No kind was
 *                   added to the layer for it.
 *   the home        `LAB_HOME`: the foot of the block's south-east
 *                   corner, the ants' nest stand-in (`CreatureWorld.home`).
 *                   A fire-ant forager is never more than 26 cm from a
 *                   tunnel exit (Tschinkel 2011) and the Lab has no
 *                   tunnel, so the brain centres the ants' loops on ONE
 *                   point (`intent.ts`, `GROUND_HOME_RANGE`); the block's
 *                   foot is that point because the block is what the
 *                   ants are here to be watched on (§6, §14). The range
 *                   reaches under the slab and past the pillar, so a
 *                   wander may be routed round the pedestal, and a flee
 *                   that meets it climbs — a thing to see, on purpose,
 *                   not all day.
 *   the spawns      `labSpawns`: the five, deterministic, each on a
 *                   surface its medium allows — queen and worker on the
 *                   floor beside the block, worm in its band under the
 *                   litter corner, aphid on the broadleaf, fly perched
 *                   on the flower — and each with a BODY LENGTH DRAWN
 *                   from its species' range by the Lab's seed (below).
 *
 * THE SIM IS BUILT FROM THE SPAWNS, NOT FROM CELLS. The habitat here is
 * grassland everywhere, and a `CreatureSim` streaming 16 m cells over
 * it would generate the island's wild worms and flies a few metres
 * outside a one-metre box. The Lab's simulation (its own leaf) places
 * `labSpawns()` and generates nothing.
 *
 * SIZES ARE DRAWN, AND THE DRAW IS THE SEED'S. A creature carries its
 * own length (`state.ts`) and the island draws one per animal out of
 * its cell's hash; the Lab has no cells, so `labSpawns` draws each of
 * the five out of `LAB_SEED` and the spawn's own index through the
 * same `drawLengthMm` the island uses — the same worm at the same
 * length on every device and every reset, and never `Math.random`. A
 * caller may pass another seed to see another five, or name a length
 * outright (`LabSpawnOptions.lengthMm`), which is how a minim and a
 * major are tested on the ONE worker rig without a second controller
 * (Joshua's brief, §12: "data-driven so later we can test
 * small/minim, medium, large/major-sized").
 *
 * RESET LAB (§26) IS THREE LINES, IN THIS ORDER, and this file owns the
 * first: `lab.reset()` puts the world back as it was constructed — the
 * clock at zero, no standing disturbance, the camera's dropped, the
 * weather as constructed; `ledger.clear()` (`control.ts`) lets go of
 * everyone; and the scene builds a fresh simulation from `labSpawns()`
 * with the same seed, since a `CreatureSim` keeps what it places for
 * as long as it lives. That is what makes a reset deterministic: the
 * same five, at the same spots, at the same sizes, with the same needs,
 * and nobody possessed — and no page reload ("Do not make death/testing
 * require reloading the whole browser page").
 *
 * SOFT CONTAINMENT (§31). The box has no walls: `inBounds` says whether
 * a point is inside it and `inwardTarget` gives a point back toward the
 * middle, clear of the block, for a brain to aim at when its animal
 * nears the edge. "Do not hide locomotion bugs by teleporting AI back
 * to center" — nothing here moves an animal; the Lab's brain asks and
 * the legs walk.
 *
 * DISTURBANCES (§30). `disturb` records a synthetic disturbance for
 * `DISTURB_HOLD_S` of the lab's own clock (`advance`), so a tap is an
 * event and not a standing state; the alarm it raises then holds for
 * the species' own `alarmS`. The camera is a disturbance only while the
 * Lab says so (`setCameraDisturbance`), because "sometimes I need to
 * inspect them without causing everyone to panic".
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distance, translate, world, type WorldPoint } from '../world/coords';
import type { CellResources, NearestWater, PlantSource, ResourceSite, WaterQuery } from '../world/ecology/resources';
import type { Habitat, HabitatKind } from '../world/habitat';
import { normalOfGradient, type Normal } from '../world/heightfield';
import { cellAt, cellKey } from '../world/objects/cells';
import { stableHash, valueNoise } from '../world/random';
import { CALM_WEATHER } from './intent';
import { drawLengthMm } from './population';
import { APHID, CREATURE_SPECIES, EARTHWORM, HOUSEFLY, QUEEN, WORKER, unitsOfMm, type CreatureId } from './species';
import type { NewCreatureOptions } from './state';
import type { Climbable } from './surface';
import type { CreatureWeather, CreatureWorld, Disturbance } from './world';

// ---------------------------------------------------------------------------
// The box and what stands in it — GAME TUNING from the brief's §6 throughout
// ---------------------------------------------------------------------------

/** The lab is a metre a side: 100 world units, the brief's "100 × 100 × 100". */
export const LAB_SIZE = 100;
export const LAB_HALF = LAB_SIZE / 2;
/** The floor's height above mean sea level: a metre, clear of `SEA_LEVEL` (the header says why). */
export const LAB_FLOOR = 100;
/** The one salt every lab hash uses, so the bumps are the same bumps on every device and every reset. */
export const LAB_SEED = 0x1ab;

/** The central test block: its footprint and its overall height — the SLAB's, since the block is a slab on a pedestal (below). */
export const BLOCK = Object.freeze({ at: world(0, 0), size: 20, height: 20 });

/**
 * THE BLOCK IS A SLAB ON A PEDESTAL (Creature Lab D, 2026-09-09). The
 * brief's §14 wants "top → down wall → underneath → around corner →
 * back upward", and a cube standing on the floor has no underneath. So
 * the 20 cm block is a 20 × 20 × 8 cm SLAB whose top is where the block's
 * top always was, carried 12 cm off the floor by an 8 × 8 cm PILLAR on
 * the origin: a walker climbs the pillar, walks out under the slab
 * upside down, round the slab's edge, up its side and onto the top. Both
 * are `Climbable`s (`surface.ts`) in world coordinates, y the height.
 * The pillar's foot is sunk a centimetre into the floor so no face of it
 * is coplanar with the ground — the z-fighting Joshua saw on the old
 * block's top was the floor mesh's plateau under the box's own top face,
 * and since the ground is the floor alone (`labGroundAt` is `labFloorAt`)
 * the floor mesh has no plateau to fight with. GAME TUNING throughout:
 * the brief's 15-25 cm block, given an underneath.
 */
export const PILLAR = Object.freeze({ size: 8, height: 12, sink: 1 });
export const SLAB = Object.freeze({ size: BLOCK.size, thickness: BLOCK.height - PILLAR.height });

/** The pillar as a solid: 8 cm square on the origin, from a centimetre under the floor to 12 cm above it. */
export const PILLAR_BOX: Climbable = Object.freeze({
  id: 'lab:pillar',
  min: Object.freeze({ x: BLOCK.at.wx - PILLAR.size / 2, y: LAB_FLOOR - PILLAR.sink, z: BLOCK.at.wz - PILLAR.size / 2 }),
  max: Object.freeze({ x: BLOCK.at.wx + PILLAR.size / 2, y: LAB_FLOOR + PILLAR.height, z: BLOCK.at.wz + PILLAR.size / 2 }),
});

/** The slab as a solid: the block's footprint, from the pillar's top to the block's top. */
export const SLAB_BOX: Climbable = Object.freeze({
  id: 'lab:slab',
  min: Object.freeze({ x: BLOCK.at.wx - SLAB.size / 2, y: LAB_FLOOR + PILLAR.height, z: BLOCK.at.wz - SLAB.size / 2 }),
  max: Object.freeze({ x: BLOCK.at.wx + SLAB.size / 2, y: LAB_FLOOR + BLOCK.height, z: BLOCK.at.wz + SLAB.size / 2 }),
});

/** Everything in the box a climber may walk on besides the floor, in the order a probe lists them. */
export const LAB_CLIMBABLES: readonly Climbable[] = Object.freeze([PILLAR_BOX, SLAB_BOX]);

/** The uneven patch: a square of value noise, ±`amplitude` at `wavelength`. */
export const BUMP = Object.freeze({ at: world(-30, 25), size: 20, amplitude: 0.5, wavelength: 2 });

/** The puddle: a circle in the north-west corner, a dish `depth` deep at its centre, full to the floor. */
export const PUDDLE = Object.freeze({ at: world(-40, -40), radius: 5, depth: 0.5 });

/** Where the leaf litter lies: the north-east corner. */
export const LITTER_CORNER = world(40, -40);

/** How long a synthetic disturbance stands, seconds of the lab's clock: a tap is an event. */
export const DISTURB_HOLD_S = 1.5;

/** How far inside the edge `inwardTarget` aims by default: a quarter of the box. */
export const INWARD_DISTANCE = LAB_HALF / 2;
/** How far from the block's footprint an inward target is kept, so the AI is not sent up the step all day. */
export const BLOCK_CLEARANCE = 3;

/**
 * THE ANTS' HOME: the foot of the block's south-east corner, on the
 * floor, the same clearance off the footprint the inward target keeps.
 * The queen spawns beside the block's east face and the worker beside
 * its south, each thirteen units from here, so both begin inside their
 * home range and their loops are around the block (the header says why
 * the block). One point for both, as `CreatureWorld.home` is one point:
 * the Lab has one nest stand-in, not a nest per ant.
 */
export const LAB_HOME: WorldPoint = world(BLOCK.size / 2 + BLOCK_CLEARANCE, BLOCK.size / 2 + BLOCK_CLEARANCE);

/** Grassland, all the way: the habitat the ants' own research names (worker.md, "Habitat"). Elevation is the floor's. */
export const LAB_HABITAT: Habitat = Object.freeze({
  kind: 'grassland' as HabitatKind,
  forest: 0, grass: 1, shrub: 0.1, bare: 0, wet: 0.05, lake: 0, coast: 0, exposure: 0,
  elevation: LAB_FLOOR, slopeDegrees: 0, coastDistance: 1_000_000, channel: false, rainfallMmYear: null,
});

/** A plant's id in the island's form, so `hostPlantOf` can find it by its cell. */
function plantId(family: string, at: WorldPoint, n: number): string {
  return `${family}:${cellKey(cellAt(at))}:${n}`;
}

function plant(family: string, at: WorldPoint, size: number, n: number, variant = 0): PlantSource {
  return Object.freeze({ family, at, size, id: plantId(family, at, n), variant });
}

/**
 * The five plants, at fixed spots away from the block, the patch and
 * the puddle. Sizes are world units: a blade, a stem, a leaf's height.
 */
export const LAB_PLANTS: readonly PlantSource[] = Object.freeze([
  plant('grass', world(30, 30), 8, 0, 2),
  plant('flower', world(20, -30), 12, 0),
  plant('broadleaf', world(-25, -20), 15, 0),
  plant('shrub', world(-20, 40), 25, 0),
  plant('fern', world(35, 5), 12, 0),
]);

const GRASS = LAB_PLANTS[0];
const FLOWER = LAB_PLANTS[1];
const BROADLEAF = LAB_PLANTS[2];

/** A dry point on the puddle's rim, toward the middle of the box: where the water-edge site stands. */
export const PUDDLE_EDGE: WorldPoint = (() => {
  const toward = Math.SQRT1_2;
  const out = PUDDLE.radius + 0.5;
  return world(PUDDLE.at.wx + toward * out, PUDDLE.at.wz + toward * out);
})();

/** The protein test resource's spot: open floor, east of the block. */
export const PROTEIN_SPOT = world(15, 20);

function site(kind: ResourceSite['kind'], at: WorldPoint, above: number, amount: number, owner: PlantSource | null, n: number): ResourceSite {
  return Object.freeze({ id: `${kind}:${cellKey(cellAt(at))}:${n}`, kind, at, above, amount, ownerId: owner === null ? null : owner.id });
}

/**
 * The resources, in the layer's own shape (`world/ecology/resources.ts`):
 * where each one is, how high on its plant, and a capacity in the kind's
 * unit — nectar µl, seeds, sap µl, litter cm², stem cm, water frontage
 * mm. Nothing is consumed yet, as on the island.
 */
export const LAB_SITES: readonly ResourceSite[] = Object.freeze([
  site('nectar', FLOWER.at, FLOWER.size, 3, FLOWER, 0),
  site('seed', GRASS.at, GRASS.size, 20, GRASS, 0),
  site('sap', BROADLEAF.at, BROADLEAF.size * 0.4, 5, BROADLEAF, 0),
  site('honeydew-host', BROADLEAF.at, BROADLEAF.size * 0.6, BROADLEAF.size, BROADLEAF, 0),
  site('litter', LITTER_CORNER, 0, 200, null, 0),
  // The PROTEIN TEST RESOURCE: a carrion site the wild never derives (the header).
  site('carrion', PROTEIN_SPOT, 0, 1, null, 0),
  // The rim's whole circumference as frontage, in millimetres.
  site('water-edge', PUDDLE_EDGE, 0, Math.round(2 * Math.PI * PUDDLE.radius * 10), null, 0),
]);

// ---------------------------------------------------------------------------
// The ground and the water
// ---------------------------------------------------------------------------

/** Inside the block's footprint (a closed square). */
export function onBlock(at: WorldPoint): boolean {
  const h = BLOCK.size / 2;
  return Math.abs(at.wx - BLOCK.at.wx) <= h && Math.abs(at.wz - BLOCK.at.wz) <= h;
}

/** Inside the uneven patch. */
function onBump(at: WorldPoint): boolean {
  const h = BUMP.size / 2;
  return Math.abs(at.wx - BUMP.at.wx) <= h && Math.abs(at.wz - BUMP.at.wz) <= h;
}

/** The dish's depth at a point: the puddle's depth at its centre, nothing at its rim and beyond. */
export function puddleDepthAt(at: WorldPoint): number {
  const r = distance(at, PUDDLE.at);
  if (r >= PUDDLE.radius) return 0;
  const f = r / PUDDLE.radius;
  return PUDDLE.depth * (1 - f * f);
}

/**
 * THE FLOOR: the flat floor, the bumps over the patch, the dish under
 * the puddle — the bench's heightfield with nothing standing on it. What
 * the floor MESH is sampled from (`lab/labMeshes.ts`), so the block is
 * never drawn twice (the header's z-fighting), and what a walker under
 * the slab stands on.
 */
export function labFloorAt(at: WorldPoint): number {
  if (!Number.isFinite(at.wx) || !Number.isFinite(at.wz)) return NaN;
  let ground = LAB_FLOOR;
  if (onBump(at)) ground += (valueNoise(at.wx / BUMP.wavelength, at.wz / BUMP.wavelength, LAB_SEED) * 2 - 1) * BUMP.amplitude;
  return ground - puddleDepthAt(at);
}

/**
 * THE GROUND: the floor — the bumps over the patch, the dish under the
 * puddle, and the flat floor everywhere else, under the slab included.
 * The block is not in it: the block is the world's `climbables`
 * (Creature Lab D), stood on by `surface.ts` and never by a step in
 * the ground. One name for the floor, so the mesh, the spawns and the
 * creatures all read the same sheet.
 */
export const labGroundAt = labFloorAt;

/** The ground's normal, by central differences over a millimetre: up on the floor, tipped on the bumps, and up under the slab — the block is not in the ground. */
export function labNormalAt(at: WorldPoint): Normal {
  const e = 0.1;
  const gx = (labGroundAt(world(at.wx + e, at.wz)) - labGroundAt(world(at.wx - e, at.wz))) / (2 * e);
  const gz = (labGroundAt(world(at.wx, at.wz + e)) - labGroundAt(world(at.wx, at.wz - e))) / (2 * e);
  if (!Number.isFinite(gx) || !Number.isFinite(gz)) return { nx: 0, ny: 1, nz: 0 };
  return normalOfGradient(-gx, -gz);
}

/**
 * THE WATER, as the resource layer and the creatures ask it: the dish's
 * depth, never the sea, and the nearest point of the rim within a
 * radius — from inside the puddle as well as outside, since a flood
 * sense standing in the water wants the way out.
 */
export const LAB_WATER: WaterQuery = Object.freeze({
  freshDepthAt: (at: WorldPoint): number => puddleDepthAt(at),
  isSeaAt: (): boolean => false,
  nearestWater: (at: WorldPoint, radius: number): NearestWater | null => {
    if (!(radius > 0)) return null;
    const dx = at.wx - PUDDLE.at.wx;
    const dz = at.wz - PUDDLE.at.wz;
    const r = Math.hypot(dx, dz);
    const gap = Math.abs(r - PUDDLE.radius);
    if (gap >= radius) return null;
    // On the centre exactly there is no direction; the rim is due east.
    const ux = r > 0 ? dx / r : 1;
    const uz = r > 0 ? dz / r : 0;
    return { at: world(PUDDLE.at.wx + ux * PUDDLE.radius, PUDDLE.at.wz + uz * PUDDLE.radius), distance: gap };
  },
});

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export interface LabWorldOptions {
  /** The sky the animals feel. Default: calm, dry, daylight. */
  readonly weather?: CreatureWeather | null;
}

export interface LabWorld extends CreatureWorld {
  readonly plants: readonly PlantSource[];
  readonly sites: readonly ResourceSite[];
  /** The puddle; never null in the lab. */
  readonly water: WaterQuery;
  /** The ants' nest stand-in: `LAB_HOME`, the block's foot. Never absent in the lab. */
  readonly home: WorldPoint;
  /** The block as solids — the pillar and the slab, `LAB_CLIMBABLES` — for every climber in the box. Never absent in the lab. */
  readonly climbables: readonly Climbable[];
  /** The lab's own clock, simulation seconds since construction or the last `reset`. What a standing disturbance expires against. */
  readonly clock: number;
  /** The DISTURB tool: a synthetic disturbance that stands for `holdS` seconds of the lab's clock. */
  disturb(d: Disturbance, holdS?: number): void;
  /** Drop every standing disturbance. The camera's, if set, stays. */
  calm(): void;
  /** The camera as a disturbance — on while the Lab says so, and off ("CAMERA DISTURBS CREATURES: ON / OFF"). */
  setCameraDisturbance(d: Disturbance | null): void;
  /** Advance the lab's own clock, simulation seconds: what expires a disturbance. */
  advance(dt: number): void;
  setWeather(weather: CreatureWeather | null): void;
  /**
   * The world's share of RESET LAB (the header): the clock to zero, every
   * standing disturbance dropped, the camera's disturbance dropped, the
   * weather back to what the lab was constructed with. The ground, the
   * plants, the sites and the water never changed, so they need no
   * putting back. The animals and the ledger are not this world's to
   * reset — the scene rebuilds one and clears the other.
   */
  reset(): void;
  /** Inside the box, at least `margin` units from its edge. */
  inBounds(at: WorldPoint, margin?: number): boolean;
  /** A point back toward the middle from `at`, `distance` along, kept clear of the block: what a brain aims at near the edge. */
  inwardTarget(at: WorldPoint, distance?: number): WorldPoint;
}

interface Standing {
  readonly disturbance: Disturbance;
  readonly untilS: number;
}

/** Inside the box, at least `margin` units from its edge. A point that is not a number is not inside. */
export function labInBounds(at: WorldPoint, margin = 0): boolean {
  const edge = LAB_HALF - margin;
  return Math.abs(at.wx) <= edge && Math.abs(at.wz) <= edge;
}

/**
 * A point `distance` toward the origin from `at`, never past it, and
 * pushed out of the block's footprint plus `BLOCK_CLEARANCE` along the
 * same ray when it would have landed inside. Standing on the origin
 * itself (or on a point that is not a number) the answer is a spot
 * clear of the block to the south, since a direction from a point to
 * itself is no direction.
 */
export function labInwardTarget(at: WorldPoint, distance = INWARD_DISTANCE): WorldPoint {
  const r = Math.hypot(at.wx, at.wz);
  if (!Number.isFinite(r) || r === 0) return world(0, BLOCK.size / 2 + BLOCK_CLEARANCE);
  const step = Math.min(Math.max(0, distance), r);
  const ux = at.wx / r;
  const uz = at.wz / r;
  let target = translate(at, -ux * step, -uz * step);
  const clear = BLOCK.size / 2 + BLOCK_CLEARANCE;
  if (Math.abs(target.wx) <= clear && Math.abs(target.wz) <= clear) {
    // Where the ray leaves the cleared square: the larger of the two axis crossings.
    const t = Math.min(
      Math.abs(ux) > 1e-12 ? clear / Math.abs(ux) : Infinity,
      Math.abs(uz) > 1e-12 ? clear / Math.abs(uz) : Infinity,
    );
    target = world(ux * t, uz * t);
  }
  return target;
}

export function createLabWorld(options: LabWorldOptions = {}): LabWorld {
  const constructedWeather: CreatureWeather | null = options.weather === undefined ? CALM_WEATHER : options.weather;
  let weather = constructedWeather;
  let camera: Disturbance | null = null;
  const standing: Standing[] = [];
  let clock = 0;
  // Rebuilt only when the list changes, so `disturbances()` allocates nothing per frame.
  let listed: Disturbance[] = [];
  let stale = true;

  const byCell = new Map<string, PlantSource[]>();
  for (const p of LAB_PLANTS) {
    const key = cellKey(cellAt(p.at));
    const list = byCell.get(key);
    if (list) list.push(p);
    else byCell.set(key, [p]);
  }
  const sitesByCell = new Map<string, CellResources>();
  for (const s of LAB_SITES) {
    const id = cellAt(s.at);
    const key = cellKey(id);
    const cell = sitesByCell.get(key);
    if (cell) (cell.sites as ResourceSite[]).push(s);
    else sitesByCell.set(key, { cx: id.cx, cz: id.cz, sites: [s] });
  }

  const relist = (): void => {
    listed = standing.map((s) => s.disturbance);
    if (camera !== null) listed.push(camera);
    stale = false;
  };

  return {
    plants: LAB_PLANTS,
    sites: LAB_SITES,
    water: LAB_WATER,
    home: LAB_HOME,
    climbables: LAB_CLIMBABLES,
    get clock(): number {
      return clock;
    },
    groundAt: labGroundAt,
    normalAt: labNormalAt,
    habitatAt: () => LAB_HABITAT,
    // A cell with no plants is generated and empty, never "not yet": nothing in the lab is still streaming in.
    plantsOf: (cx, cz) => byCell.get(cellKey({ cx, cz })) ?? [],
    resourcesOf: (cx, cz) => sitesByCell.get(cellKey({ cx, cz })) ?? { cx, cz, sites: [] },
    weather: () => weather,
    disturbances: () => {
      if (stale) relist();
      return listed;
    },
    disturb: (d, holdS = DISTURB_HOLD_S) => {
      standing.push({ disturbance: d, untilS: clock + Math.max(0, holdS) });
      stale = true;
    },
    calm: () => {
      standing.length = 0;
      stale = true;
    },
    setCameraDisturbance: (d) => {
      camera = d;
      stale = true;
    },
    advance: (dt) => {
      if (!(dt > 0) || !Number.isFinite(dt)) return;
      clock += dt;
      const before = standing.length;
      for (let i = standing.length - 1; i >= 0; i -= 1) if (standing[i].untilS <= clock) standing.splice(i, 1);
      if (standing.length !== before) stale = true;
    },
    setWeather: (w) => {
      weather = w;
    },
    reset: () => {
      clock = 0;
      standing.length = 0;
      camera = null;
      weather = constructedWeather;
      stale = true;
    },
    inBounds: labInBounds,
    inwardTarget: labInwardTarget,
  };
}

// ---------------------------------------------------------------------------
// The five
// ---------------------------------------------------------------------------

/** A creature's id in the island's form for its spawn cell. Each species spawns once, so `0` is unique per species. */
function spawnId(species: CreatureId, at: WorldPoint): string {
  return `${species}:${cellKey(cellAt(at))}:0`;
}

/** The aphid sits half-way up its host: inside the island's perch band (`population.PERCH_FRACTION`), a plain fraction here. */
export const APHID_PERCH_FRACTION = 0.5;

/**
 * The salt the five body lengths are drawn under, disjoint from the
 * cell populations' species blocks (`population.ts`, 0x1_0000..) and
 * from the bumps' `LAB_SEED` question, so a lab length and a lab bump
 * never share a number.
 */
const LENGTH_SALT = 0x6_0000;

export interface LabSpawnOptions {
  /** The seed the five body lengths are drawn under. Default `LAB_SEED`: the same five, every time. */
  readonly seed?: number;
  /**
   * A length named outright for a species, mm, instead of its draw:
   * `{ worker: 5.8 }` is a major on the one worker rig, `{ worker: 1.7 }`
   * a minim. Clamped to nothing — the table's range is the population's
   * rule, and a Lab that asks for a 12 mm worker is asking on purpose.
   * A length that is not a number falls back to the draw.
   */
  readonly lengthMm?: Readonly<Partial<Record<CreatureId, number>>>;
}

/**
 * THIS ONE'S LENGTH: the species' draw (`population.drawLengthMm`, the
 * same skew the island uses, mean at the cited length) out of the seed
 * and the spawn's index, unless the options name a length for it.
 */
function spawnLengthMm(species: CreatureId, index: number, options: LabSpawnOptions): number {
  const named = options.lengthMm?.[species];
  if (named !== undefined && Number.isFinite(named) && named > 0) return named;
  const seed = options.seed === undefined ? LAB_SEED : options.seed;
  return drawLengthMm(CREATURE_SPECIES[species], stableHash(index, 0, LENGTH_SALT ^ (seed | 0)));
}

/**
 * THE DETERMINISTIC INITIAL PLACEMENT. Queen and worker on the floor
 * beside the block, facing it; the worm in the middle of its band under
 * the litter corner, burrowing; the aphid on the broadleaf, its host
 * named; the fly perched on the flower's head, idle. Every phase, every
 * starting need and every body length is fixed by `LAB_SEED`, so two
 * labs, or one lab reset, begin the same (the header, "SIZES ARE
 * DRAWN"). A fresh array of fresh objects each call — a caller may build
 * a simulation from it and hand it nothing back.
 */
export function labSpawns(options: LabSpawnOptions = {}): readonly NewCreatureOptions[] {
  const queenAt = world(BLOCK.size / 2 + 4, 0);
  const workerAt = world(0, BLOCK.size / 2 + 4);
  const wormAt = LITTER_CORNER;
  const aphidAt = BROADLEAF.at;
  const flyAt = FLOWER.at;
  const under = unitsOfMm(EARTHWORM.burrow === null ? 0 : EARTHWORM.burrow.underMm);
  const bore = unitsOfMm(EARTHWORM.burrow === null ? 0 : EARTHWORM.burrow.boreMm);
  const length = (species: CreatureId, index: number): number => spawnLengthMm(species, index, options);
  return [
    {
      id: spawnId(QUEEN.id, queenAt), species: QUEEN.id, cellKey: cellKey(cellAt(queenAt)),
      at: queenAt, height: labGroundAt(queenAt), heading: -Math.PI / 2, lengthMm: length(QUEEN.id, 0), phase: 0.1,
      behaviour: 'idle', hunger: 0.2, fatigue: 0.1,
    },
    {
      id: spawnId(WORKER.id, workerAt), species: WORKER.id, cellKey: cellKey(cellAt(workerAt)),
      at: workerAt, height: labGroundAt(workerAt), heading: Math.PI, lengthMm: length(WORKER.id, 1), phase: 0.3,
      behaviour: 'idle', hunger: 0.4, fatigue: 0.1,
    },
    {
      id: spawnId(EARTHWORM.id, wormAt), species: EARTHWORM.id, cellKey: cellKey(cellAt(wormAt)),
      // The middle of the band: between `underMm` down and half a bore down, as the population places one.
      at: wormAt, height: labGroundAt(wormAt) - (under + bore / 2) / 2, heading: Math.PI / 2, lengthMm: length(EARTHWORM.id, 2),
      phase: 0.5, behaviour: 'burrow', hunger: 0.3, fatigue: 0.2,
    },
    {
      id: spawnId(APHID.id, aphidAt), species: APHID.id, cellKey: cellKey(cellAt(aphidAt)),
      at: aphidAt, height: labGroundAt(aphidAt) + APHID_PERCH_FRACTION * BROADLEAF.size, heading: 0, lengthMm: length(APHID.id, 3),
      phase: 0.7, behaviour: 'idle', hostId: BROADLEAF.id, hunger: 0.3, fatigue: 0.1,
    },
    {
      id: spawnId(HOUSEFLY.id, flyAt), species: HOUSEFLY.id, cellKey: cellKey(cellAt(flyAt)),
      at: flyAt, height: labGroundAt(flyAt) + FLOWER.size, heading: Math.PI / 4, lengthMm: length(HOUSEFLY.id, 4), phase: 0.9,
      behaviour: 'idle', hunger: 0.3, fatigue: 0.1,
    },
  ];
}
