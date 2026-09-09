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
 * `paceRatio(state, species)`, the length ratio raised to the species'
 * own law (1 for the worm, 0.75 for an ant), and every distance measured
 * in body lengths by `sizeRatio`, the length ratio itself, because the
 * measured law is a fraction of the animal's own body a second (Joshua,
 * 2026-09-08: the earthworm "should be based on size and dynamic"). What
 * is NOT scaled is what belongs to the KIND rather than the body: how
 * far it can sense a disturbance, the band it burrows in, and a fly's
 * flight — a hop is the wing's, and the wing is not in the table's
 * length.
 *
 * THE GROUND BRAIN IS THE ANTS' (the Creature Lab, 2026-09-09). The two
 * ants (`species.ts`, QUEEN and WORKER) live in the fourth medium, and
 * `thinkGround` gives them the shared words and the ground's own two.
 * Needs drive it as they drive the others: hunger goes to the nearest
 * site of what the species eats — liquid carbohydrate first and protein
 * when it is starving (`PROTEIN_AT`; Tennant & Porter 1991: 70-80 % of
 * loads are liquid), the drink counting as a feed when it is nearest —
 * and the queen's `eats` has no protein in it, so she takes sugars and
 * water only (SUMMARY §1, decision 3's default) by data and not by a
 * branch; rest is NAPS — the species' short `restS` (Cassill 2009: a
 * minute at a time, 253 a day); a wander is a short loop that never
 * leaves the range of HOME when the world names one (`GROUND_HOME_RANGE`,
 * Tschinkel 2011's 26 cm of a tunnel exit), and a hungry ant with
 * nothing in sight sweeps further (`GROUND_FORAGE_LENGTHS`). On alarm a
 * DEFENSIVE species turns to face the disturbance and holds — but only
 * when the disturbance is ON it, within a body length (Haight 2010: a
 * threat AT the nest is met); anything further is fled at the flee
 * pace, as a skittish one flees everything. The winged queen, on a
 * SEVERE alarm — the alarm at 1 with the disturbance inside half her
 * alarm reach — leaves the ground when the sky allows
 * (`takeoffWeatherAllows`), and `beginTakeoff` is the one door a
 * possessing player uses for the same thing.
 *
 * THE TWO BRAINS HAND OVER BY THE WORD. A ground species that carries a
 * flight spec is routed to `thinkAir` for as long as its word is
 * airborne (`isAirborne`) and to `thinkGround` otherwise, in `think`'s
 * dispatch. Ground → air is `beginTakeoff` writing `takeoff`; the air
 * brain then flies her exactly as it flies the fly — hop, hover (zero
 * seconds, for her), land — and air → ground is the air brain's `land`
 * case writing a grounded word (`idle`, `feed` or `rest`), after which
 * the next think finds her on the ground and the ground brain has her
 * back. No word is ever chosen that `behaviourAllowedFor` refuses, and
 * `think` throws if one is.
 *
 * `attack` IS THE POLICY'S (Joshua's brief, §25): `CreatureWorld.policy`
 * says OFF, NORMAL or FORCE (absent: normal, the island); what is legal
 * prey is the species entry's `prey` list, read by `preyOf` and empty
 * for every species today — the aphid is never prey (§11), the adult
 * fly is uncatchable (Hu & Frank 1996), the worm is carrion or a
 * recruitment target (SUMMARY §2) — so nothing is attacked until the
 * table names something. A species whose medium has no `attack` word
 * can never choose it under any policy; a test holds every non-ground
 * species to that across every word and every policy.
 *
 * CONTAINMENT IS A TARGET, NEVER A MOVE (§31). A world that has an edge
 * offers `inBounds` and `inwardTarget`; at the end of every think a
 * target outside the bounds is replaced by the world's inward point
 * (`containTarget`), for a walker, a burrower and a flier alike, and
 * the body is never touched — a creature that reaches the boundary and
 * stops is a bug to see. The island offers neither and nothing changes.
 *
 * THE THREE WILD ONES, FROM THE RESEARCH (SUMMARY.md, Joshua's
 * defaults). The APHID's flee is a ladder, not a drop: on alarm it
 * first walks 1-3 cm along its host (`HOST_FLEE_WALK_MM`; Basu et al.
 * 2021, J. Pest Sci. 2020) and DROPS only on contact — the disturbance
 * inside `senses.contactMm` — or, when the disturbance outlasts the
 * walk, by `senses.dropChance` (Nault 1976: walking is the tribe's
 * majority answer); a species without `contactMm` drops as it always
 * did. A displaced aphid walks to the nearest host it can SEE
 * (`sightMm`, host-finding only — Gish & Inbar 2006, 13 cm), which may
 * not be the one it fell from. An ant is not a disturbance to it at
 * all: a `creature` source is filtered out of a plant creature's
 * alarm, because a tended aphid is stood on by its ants (SUMMARY #5).
 * The FLY's alarm is LOOMING: a disturbance whose radius is large for
 * its distance (`LOOM`, from the 2.9°-per-facet eye of housefly.md) —
 * a hand, the camera — and not a small slow thing walking up; the old
 * range rule stays as the contact floor. It hovers only before a
 * landing, never station-keeps (except over water, which is never a
 * place to stop), is perched through the night with no takeoff but
 * an alarm's, and a hop's DISTANCE is derived from `hopS × cruise`,
 * held inside `hopMm`, so the clock and the place agree
 * (`hopDistance`, `flightClock`; housefly.md D7). The EARTHWORM's new
 * ground is dug at the crawl over `burrow.digDiscount` (`digPaceFactor`;
 * the measured figure is 30-75× — Ruiz 2015, 2017 — and the reason it is
 * not used is that a 1 m box would show a worm that never moves): the
 * worm has no memory of its burrows yet, so `burrow` IS digging and
 * `surface` is crawling. Its flee stays down and away (Joshua's
 * decision on retraction is pending) and its flood answer stays v1's
 * "flee the edge", noted against A. gracilis, which surfaces (SUMMARY
 * #7). Its alarm is vibration and contact within `alarmMm`, unchanged.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distance, distanceSquared, translate, type WorldPoint } from '../world/coords';
import type { NearestWater, PlantSource, ResourceKind, ResourceSite } from '../world/ecology/resources';
import { SEA_LEVEL } from '../world/heightfield';
import { CELL_SPAN, cellsWithin } from '../world/objects/cells';
import { WATER_SIM_DEFAULTS } from '../world/water/sim';
import { unitsOfMetres } from './finder';
import { ahead, headingToward, wrapHeading } from './heading';
import { arrived, floorAt, isAirborne, isMoving } from './locomotion';
import { PERCH_FRACTION } from './population';
import { paceRatio, sizeRatio, unitsOfMm, type CreatureId, type CreatureSpecies, type FlightSpec } from './species';
import { behaviourAllowed, behaviourAllowedFor, type Behaviour, type CreatureState } from './state';
import type { CreatureWeather, CreatureWorld, Disturbance, PredationPolicy } from './world';

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
 * How far a ground creature's aimless walk is aimed, body lengths. GAME
 * TUNING with a biological shape: a fire-ant forager is never far from a
 * tunnel exit — every point of the territory within 26 cm of one
 * (Tschinkel 2011) — so a wander is a short loop, not a crossing. Twenty
 * bodies is 6 cm for the table's worker and 16 for the queen.
 */
export const GROUND_WANDER_LENGTHS = 20;
/** How many spots a ground creature tries before it stays where it is: only dry land is walked to. GAME TUNING. */
const GROUND_WANDER_TRIES = 4;
/**
 * How long a ground creature stands between one thing and the next,
 * seconds. GAME TUNING: an ant is rarely idle on the surface (Cassill
 * 2009: four in five awake at any moment), so the pause is a beat and
 * not a rest — a rest is the `rest` word, with the species' own length.
 */
export const GROUND_IDLE_S: readonly [number, number] = Object.freeze([1, 5]) as readonly [number, number];
/**
 * How far from HOME a ground creature's wander may take it, world units:
 * 26 cm. MEASURED SHAPE — Tschinkel 2011: every point of a fire-ant
 * colony's territory is within 26 cm of a tunnel exit, so a forager on
 * the surface is never further than that from a hole. In world units
 * and not body lengths because it is the colony's number, not the
 * body's: a minim and a major share the same territory. Read only when
 * the world names a `home` (`CreatureWorld.home`); the island has none
 * yet and its ants wander around where they stand, as before.
 */
export const GROUND_HOME_RANGE = unitsOfMm(260);
/**
 * How far a HUNGRY ground creature's walk is aimed when nothing to eat
 * is in sight, body lengths. GAME TUNING with a biological shape: a
 * foraging trip is about half a metre of surface walking (Tschinkel
 * 2011), far more than the idle loop's `GROUND_WANDER_LENGTHS`, and the
 * home range above is what keeps the sweep inside the territory. Sixty
 * bodies is 18 cm for the table's worker and 48 for the queen — a
 * sweep across the Lab's box rather than a shuffle beside the block.
 */
export const GROUND_FORAGE_LENGTHS = 60;
/**
 * Hunger at or above which PROTEIN is looked for before carbohydrate.
 * GAME TUNING, one number, with the measured shape behind it: 70-80 %
 * of a fire-ant forager's loads are liquid (Tennant & Porter 1991), so
 * sugar is the everyday food and protein the food of real need. The
 * state carries one hunger, not two; this is where the one number
 * becomes "whichever need is greater".
 */
export const PROTEIN_AT = 0.85;
/** The resource kinds that are liquid carbohydrate or seed, and the drink that counts as a feed when it is nearest and the animal is hungry. */
export const CARBOHYDRATE_OR_DRINK: readonly ResourceKind[] = Object.freeze(['nectar', 'seed', 'sap', 'honeydew-host', 'water-edge']);
/** The resource kinds that are protein — the Lab's carrion test resource, and litter — with the same drink. */
export const PROTEIN_OR_DRINK: readonly ResourceKind[] = Object.freeze(['carrion', 'litter', 'water-edge']);
/**
 * A SEVERE alarm: the alarm at 1 with the disturbance inside this
 * fraction of the species' alarm reach. GAME TUNING (half): the line
 * between a threat a queen faces or flees on foot and one she leaves
 * the ground for.
 */
export const SEVERE_ALARM_FRACTION = 0.5;
/**
 * The most wind a queen takes off into, world units a second: 2.2 m/s.
 * BIOLOGICAL SHAPE — "light" wind, ≤ 8 km/h in the extension summaries
 * of Milio et al. 1988 and Morrill 1974 (queen.md; the primary's
 * threshold was not reached). The other halves of the measured gate —
 * 24-32 °C and RH ≥ 80 % — are not on `CreatureWeather` today, so the
 * gate reads wind, night and rain and says so on `takeoffWeatherAllows`.
 */
export const TAKEOFF_WIND_MAX = unitsOfMetres(2.2);
/**
 * THE LOOM: a disturbance alarms a looming-eyed species when its RADIUS
 * over its DISTANCE exceeds this. GAME TUNING, derived from housefly.md
 * D4: a housefly's eye has 2.9° per facet (Juusola lab 2026), so a
 * 4 mm ant is resolvable at all only inside ~80 mm — 4 / 80 = 0.05,
 * one facet across. The escape is triggered by an approaching DARK
 * object judged by its expansion, not by range (Holmqvist & Srinivasan
 * 1991), so the alarm's line is set six facets past bare resolution:
 * 0.3 means a thing subtending about 33° — eleven facets across its
 * diameter — a hand at 20 cm, the camera at half a metre, and never a
 * 4 mm ant walking up, which at ten body lengths is 0.05. A radius of
 * nothing never looms; the contact floor (the species' alarm reach) is
 * what a point-sized disturbance is felt by.
 */
export const LOOM = 0.3;
/**
 * The chance a plant creature DROPS when a disturbance outlasts its
 * walk, when the species does not say (`senses.dropChance`). GAME
 * TUNING: aphid.md's "20-30 % is a guess and labelled so" — an Aphis
 * walks or waggles and drops as the minority answer (Nault et al. 1976).
 */
export const DROP_CHANCE_DEFAULT = 0.25;
/**
 * How far a plant creature walks along its host on the FIRST stage of
 * its flee, mm. MEASURED SHAPE: the alarm pheromone's reach is 1-3 cm
 * from a fresh droplet (Basu et al. 2021) and the answer to a stem
 * vibration or a contact is "kick, then walk 1-3 cm away" (J. Pest Sci.
 * 2020, pea aphid; aphid.md D3). The drop is the second stage.
 */
export const HOST_FLEE_WALK_MM: readonly [number, number] = Object.freeze([10, 30]) as readonly [number, number];
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
// What the table may say and does not have to: fields read as optional
// ---------------------------------------------------------------------------

/**
 * FOUR FIELDS THE RESEARCH ASKED FOR, READ AS OPTIONAL. The species
 * table (`species.ts`) is another leaf's file in this pass; these
 * readers take the field when the entry carries it and answer with
 * today's behaviour when it does not, so the brain is right on the
 * table as it stands and right on the table as it will be, and a
 * species written by hand in a test can set any of them. The
 * intersection types are the smallest thing that typechecks both ways:
 * when the fields land on `CreatureSpecies` proper they are the same
 * fields and nothing here changes.
 */
interface OptionalSenses {
  /** The CONTACT radius, mm: a disturbance inside it is on the animal — an aphid's drop line, a fly's alarm floor. Absent: `alarmMm`. */
  readonly contactMm?: number;
  /** The chance a plant creature drops when a disturbance outlasts its walk. Absent: `DROP_CHANCE_DEFAULT`. */
  readonly dropChance?: number;
}
interface OptionalBurrow {
  /** New ground is dug at the crawl over this. Absent: 1, the crawl — today's pace. */
  readonly digDiscount?: number;
}
interface OptionalPrey {
  /** The species this one may attack, when the policy allows. Absent: none. */
  readonly prey?: readonly CreatureId[];
}

/** The species' contact radius, mm, or null when the entry has none — in which case a species drops, or is alarmed, at its `alarmMm`. */
export function contactMmOf(species: CreatureSpecies): number | null {
  const mm = (species.senses as CreatureSpecies['senses'] & OptionalSenses).contactMm;
  return mm !== undefined && Number.isFinite(mm) && mm >= 0 ? mm : null;
}

/** The chance a plant creature drops when the disturbance outlasts its walk, 0..1. */
export function dropChanceOf(species: CreatureSpecies): number {
  const p = (species.senses as CreatureSpecies['senses'] & OptionalSenses).dropChance;
  return p !== undefined && Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : DROP_CHANCE_DEFAULT;
}

/** How many times slower than the crawl new ground is dug, ≥ 1. A species with no burrow, or no discount, digs at the crawl. */
export function digDiscountOf(species: CreatureSpecies): number {
  const spec = species.burrow;
  if (spec === null) return 1;
  const k = (spec as NonNullable<CreatureSpecies['burrow']> & OptionalBurrow).digDiscount;
  return k !== undefined && Number.isFinite(k) && k >= 1 ? k : 1;
}

/**
 * THE PACE FACTOR FOR THE GROUND A WORM IS IN: 1 / `digDiscount` while
 * its word is `burrow` — new ground, since the worm has no memory of
 * its burrows yet — and 1 for everything else: a surfaced crawl, a
 * flee, a rise to feed. The integrator (`demand.ts`, `planePace` and
 * `verticalStep` for the `burrow` way) is where the factor has to be
 * multiplied in for the body to slow; this file only decides what the
 * factor IS, and until the legs read it the factor is a number on the
 * HUD. Exported so the legs and the brain cannot hold two versions of
 * the rule.
 */
export function digPaceFactor(state: CreatureState, species: CreatureSpecies): number {
  if (species.medium !== 'soil' || state.behaviour !== 'burrow') return 1;
  return 1 / digDiscountOf(species);
}

/** The species this one may attack. Empty for every entry the table ships; a test names one. */
export function preyOf(species: CreatureSpecies): readonly CreatureId[] {
  return (species as CreatureSpecies & OptionalPrey).prey ?? [];
}

/** May this species ever attack: its medium has the word AND the table names it prey. Neither alone is enough. */
export function isPredator(species: CreatureSpecies): boolean {
  return behaviourAllowed(species.medium, 'attack') && preyOf(species).length > 0;
}

/** The world's predation policy: the Lab's option, or `normal` where none is set — the island. */
export function predationOf(world: CreatureWorld): PredationPolicy {
  return world.policy?.predation ?? 'normal';
}

/** The nest stand-in, or null where the world names none. */
export function homeOf(world: CreatureWorld): WorldPoint | null {
  const home = world.home;
  return home !== undefined && Number.isFinite(home.wx) && Number.isFinite(home.wz) ? home : null;
}

/** Inside the world's bounds, or the world has none. */
function inBoundsOf(world: CreatureWorld, at: WorldPoint): boolean {
  return world.inBounds === undefined || world.inBounds(at);
}

/**
 * Does this species notice a disturbance at all? A plant creature does
 * not notice a CREATURE: a tended aphid is stood on by its ants and
 * does not flee them (Nault 1976; SUMMARY #5), and a disturbance made
 * by a predator is a kind the field does not have yet. Everything else
 * notices everything.
 */
function noticed(species: CreatureSpecies, d: Disturbance): boolean {
  return !(d.source === 'creature' && species.medium === 'plant');
}

/** The squared three-dimensional distance from the body to a disturbance's point: a camera two metres over a worm is not on top of it. */
function disturbanceD2(state: CreatureState, d: Disturbance): number {
  const dh = d.height - state.height;
  return distanceSquared(state.at, d.at) + dh * dh;
}

/** Whether a species' alarm is LOOMING — judged by how big a thing is for how far it is — rather than a flat reach. The air's eye, today. */
function looms(species: CreatureSpecies): boolean {
  return species.medium === 'air';
}

/** The reach inside which anything is felt, world units: the contact radius for a looming eye, the alarm reach for the rest. */
function alarmReachOf(species: CreatureSpecies): number {
  if (!looms(species)) return unitsOfMm(species.senses.alarmMm);
  const contact = contactMmOf(species);
  return unitsOfMm(contact === null ? species.senses.alarmMm : contact);
}

/**
 * The nearest disturbance this species notices, by the gap between the
 * body and the disturbance's edge (its distance less its radius), or
 * null when there is none. No allocation: the list is the world's.
 */
export function nearestDisturbance(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): Disturbance | null {
  const list = world.disturbances();
  let best: Disturbance | null = null;
  let bestGap = Infinity;
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    if (!noticed(species, d)) continue;
    const gap = Math.sqrt(disturbanceD2(state, d)) - Math.max(0, d.radius);
    if (gap < bestGap) {
      bestGap = gap;
      best = d;
    }
  }
  return best;
}

/** How far the nearest noticed disturbance's edge is from the body, world units; Infinity with none. Zero or less: it is on the animal. */
export function nearestDisturbanceGap(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): number {
  const d = nearestDisturbance(state, species, world);
  return d === null ? Infinity : Math.sqrt(disturbanceD2(state, d)) - Math.max(0, d.radius);
}

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
  return paceRatio(state, species) * unitsOfMm(species.pace.fleeMmS) * species.senses.alarmS;
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
 * Notice a disturbance. One inside the species' alarm reach plus the
 * disturbance's own radius (in three dimensions: a camera two metres
 * over a worm is not on top of it) raises the alarm through
 * `raiseAlarm`, away from the nearest one. Returns whether a new alarm
 * fired.
 *
 * TWO SPECIES READ IT DIFFERENTLY, by data and by medium, never by
 * name. A LOOMING eye (the air's — `looms`) is alarmed by a disturbance
 * whose radius is large for its distance (`LOOM`): the camera, a hand;
 * a small slow thing walking up does not loom, and the flat reach —
 * `contactMm` where the entry has one, else the old `alarmMm` — stays
 * as the floor anything is felt inside, so a point-sized disturbance
 * on top of it is still felt. A PLANT creature does not notice a
 * `creature` source at all (`noticed`): its ants stand on it. Every
 * other species is alarmed by the flat reach it always was, and no
 * allocation is made on this every-step path.
 */
export function senseAlarm(state: CreatureState, species: CreatureSpecies, disturbances: readonly Disturbance[]): boolean {
  if (disturbances.length === 0) return false;
  const reach = alarmReachOf(species);
  const loomingEye = looms(species);
  let nearest = -1;
  let nearestD2 = Infinity;
  for (let i = 0; i < disturbances.length; i += 1) {
    const d = disturbances[i];
    if (!noticed(species, d)) continue;
    const radius = Math.max(0, d.radius);
    const r = reach + radius;
    const d2 = disturbanceD2(state, d);
    // The loom: radius / distance > LOOM, squared so nothing is rooted; a radius of nothing never looms.
    const felt = d2 <= r * r || (loomingEye && radius > 0 && radius * radius > LOOM * LOOM * d2);
    if (felt && d2 < nearestD2) {
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
  return nearestSiteOf(world, at, kinds, null, radius);
}

/**
 * `nearestSite` with a second list: the nearest site whose kind is in
 * `kinds` AND in `group` (null: any). Two lists rather than one built
 * per think, so a hungry ant's "what I eat, of the carbohydrates" is
 * a scan and not an allocation.
 */
function nearestSiteOf(
  world: CreatureWorld, at: WorldPoint, kinds: readonly ResourceKind[], group: readonly ResourceKind[] | null, radius: number,
): ResourceSite | null {
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
        if (group !== null && !group.includes(site.kind)) continue;
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
 * The nearest host plant this creature can SEE: a plant of a family
 * its species sits on (`population.hosts`), within `sightMm` of where
 * it stands, across the cells that circle touches. Host-finding is by
 * the sight of a plant's silhouette (Gish & Inbar 2006: a dropped
 * aphid walks back to a plant it sees from 13 cm), which is why the
 * sight radius is a HOST's and never a threat's — a threat is felt, by
 * contact and vibration, in `senseAlarm`. Null with none in sight, or
 * for a species with no hosts.
 */
export function nearestHostInSight(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): PlantSource | null {
  const hosts = species.population.hosts;
  if (hosts === null) return null;
  const sight = unitsOfMm(species.senses.sightMm);
  if (!(sight > 0)) return null;
  const cells = cellsWithin(state.at, sight);
  let best: PlantSource | null = null;
  let bestD2 = sight * sight;
  for (let c = 0; c < cells.length; c += 1) {
    const plants = world.plantsOf(cells[c].cx, cells[c].cz);
    if (plants === null) continue;
    for (let i = 0; i < plants.length; i += 1) {
      const p = plants[i];
      if (p.id === null || !hosts.includes(p.family)) continue;
      const d2 = distanceSquared(state.at, p.at);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
  }
  return best;
}

/**
 * The creature with this id, among those the world shows, or null. A
 * scan, since the world hands out its own array and not a map; the
 * arrays a brain sees are the Lab's five or a rung's few dozen.
 */
export function creatureById(world: CreatureWorld, id: string): CreatureState | null {
  if (world.creatures === undefined) return null;
  const all = world.creatures();
  for (let i = 0; i < all.length; i += 1) if (all[i].id === id) return all[i];
  return null;
}

/**
 * The nearest creature of a species this one may attack (`preyOf`),
 * within `radius` in three dimensions, never itself; null with none, or
 * on a world that shows no creatures. What is attacked is the table's
 * to say and this function's only to find.
 */
export function nearestPrey(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, radius: number): CreatureState | null {
  if (world.creatures === undefined || !(radius > 0)) return null;
  const prey = preyOf(species);
  if (prey.length === 0) return null;
  const all = world.creatures();
  let best: CreatureState | null = null;
  let bestD2 = radius * radius;
  for (let i = 0; i < all.length; i += 1) {
    const c = all[i];
    if (c.id === state.id || !prey.includes(c.species)) continue;
    const dh = c.height - state.height;
    const d2 = distanceSquared(state.at, c.at) + dh * dh;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
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

/**
 * HOW FAR A HOP GOES, world units: a duration drawn from `hopS` flown
 * at the cruise, held inside `hopMm`. The table used to carry both as
 * independent draws and they disagreed (housefly.md D7: 0.8-3.5 s ×
 * 1.5 m/s is 1.2-5.3 m against a `hopMm` of 0.5-3 m; at 2 m/s the gap
 * widens), so a hop's clock could run out short of its place and the
 * fly landed wherever that was — which over water is how flies came to
 * perch on the sea. Now the PLACE is derived from the TIME — for the
 * table's fly, 1.2-5.25 m clamped to 1.2-3 m — and the clock a flight
 * is then given is the time that place takes (`flightClock`). One rand,
 * as the old draw of `hopMm` was.
 */
function hopDistance(flight: FlightSpec, rand: () => number): number {
  const byTime = draw(rand, flight.hopS) * unitsOfMm(flight.cruiseMmS);
  return Math.min(unitsOfMm(flight.hopMm[1]), Math.max(unitsOfMm(flight.hopMm[0]), byTime));
}

/**
 * How long a flight to `target` is given, seconds: the distance at the
 * cruise, plus a half-turn at the species' turn rate for the turn onto
 * the bearing, so the clock and the place agree and `done` means "it
 * should be there", not "the hop's time is up wherever it is". No
 * target: the longest hop's worth.
 */
function flightClock(state: CreatureState, species: CreatureSpecies, flight: FlightSpec, target: WorldPoint | null): number {
  const far = target === null ? unitsOfMm(flight.hopMm[1]) : distance(state.at, target);
  return far / unitsOfMm(flight.cruiseMmS) + Math.PI / Math.max(1e-6, airTurnRadS(species, flight));
}

/**
 * The turn rate in the AIR: the flight spec's own (`turnRadSAir` — a
 * housefly's saccades are ~30 rad/s against ~6 on foot, housefly.md D3)
 * where the entry carries a number, else the ground rate, which is what
 * every flier turned at before the field existed. Read defensively
 * because the field is landing with the species pass and an entry
 * without it must still fly.
 */
function airTurnRadS(species: CreatureSpecies, flight: FlightSpec): number {
  const air = flight.turnRadSAir;
  return Number.isFinite(air) && air > 0 ? air : species.pace.turnRadS;
}

/**
 * A hop in a random direction that lands on dry land inside the
 * world's bounds, or null when four tries found only sea, standing
 * water or the outside of the box. The distance is `hopDistance`'s.
 */
function landwardHop(world: CreatureWorld, at: WorldPoint, flight: FlightSpec, rand: () => number): WorldPoint | null {
  for (let i = 0; i < LANDWARD_TRIES; i += 1) {
    const theta = rand() * Math.PI * 2;
    const r = hopDistance(flight, rand);
    const t = translate(at, Math.sin(theta) * r, Math.cos(theta) * r);
    if (isLand(world, t) && inBoundsOf(world, t)) return t;
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
    case 'ground':
      // A winged ground species is the air brain's while its word is
      // airborne and the ground brain's otherwise: the hand-over is the
      // word (the header). The air brain's `land` writes a grounded
      // word; the ground brain's `beginTakeoff` writes `takeoff`.
      if (species.flight !== null && isAirborne(state.behaviour)) thinkAir(state, species, world, rand, sky);
      else thinkGround(state, species, world, rand, sky, ground);
      break;
  }
  if (!Number.isFinite(state.targetHeight)) state.targetHeight = state.height;
  if (!Number.isFinite(state.behaviourUntilS) || state.behaviourUntilS < 0) state.behaviourUntilS = 0;
  containTarget(state, world);
  if (!behaviourAllowedFor(species, state.behaviour)) {
    throw new Error(`creatures/intent: ${species.id} (${species.medium}) chose "${state.behaviour}", which its medium does not allow`);
  }
}

/**
 * SOFT CONTAINMENT (Joshua's brief, §31). A target outside a bounded
 * world's `inBounds` is replaced by its `inwardTarget` from where the
 * body stands — for a walker, a burrower and a flier alike; a flier's
 * chosen height, which hangs from the floor under its target, is moved
 * by the difference between the two floors so the band it was aimed
 * into is the band it flies. NOTHING MOVES THE BODY: a creature that
 * reaches the boundary and stops is a bug to diagnose, not to hide. A
 * world with no bounds (the island) changes nothing. Returns whether
 * the target was replaced.
 */
export function containTarget(state: CreatureState, world: CreatureWorld): boolean {
  const target = state.target;
  if (target === null || world.inBounds === undefined || world.inwardTarget === undefined) return false;
  // A stand's target is a bearing to face, not a place to go: an ant at the edge faces the thing outside it.
  if (state.behaviour === 'defend') return false;
  if (world.inBounds(target)) return false;
  const inward = world.inwardTarget(state.at);
  if (isAirborne(state.behaviour)) {
    const was = floorAt(world, target);
    const now = floorAt(world, inward);
    if (Number.isFinite(was) && Number.isFinite(now)) state.targetHeight += now - was;
  }
  state.target = inward;
  return true;
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
  state.target = ahead(state.at, heading, paceRatio(state, species) * unitsOfMm(species.pace.wanderMmS) * hold);
  state.hostId = null;
  if (Number.isFinite(ground)) state.targetHeight = ground - (unitsOfMm(spec.underMm) + unitsOfMm(spec.boreMm) / 2) / 2;
  renew(state, 'burrow', hold);
}

/**
 * The direction AWAY: from the nearest disturbance the species notices
 * when one stands, else along the away point the alarm wrote into the
 * target, else the reverse of the heading — a direction from a point to
 * itself being no direction.
 */
function awayFrom(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): number {
  const threat = nearestDisturbance(state, species, world);
  if (threat !== null && !(threat.at.wx === state.at.wx && threat.at.wz === state.at.wz)) return headingToward(threat.at, state.at);
  const t = state.target;
  if (t === null) return wrapHeading(state.heading + Math.PI);
  if (t.wx === state.at.wx && t.wz === state.at.wz) return state.heading;
  return headingToward(state.at, t);
}

/**
 * THE APHID'S LADDER (aphid.md D3; SUMMARY §3): a disturbance is a
 * vibration or a contact, and the answer is "kick, then walk 1-3 cm
 * away, and only then, for a minority, let go". So the FIRST stage is a
 * walk of `HOST_FLEE_WALK_MM` along the host, away, staying up on the
 * plant at the flee pace; the SECOND — the drop to the ground and a
 * scramble of `HOST_FLEE_LENGTHS`, which is what every alarm used to be
 * — comes only when the disturbance is in CONTACT (its edge inside
 * `senses.contactMm`) or has outlasted the walk, and then by
 * `senses.dropChance`; a disturbance that persists without touching is
 * walked from again. Which stage it is in is read from the state, not
 * kept: a fleeing body whose target height is the ground has dropped.
 * A species whose entry has no `contactMm` drops at once, as it always
 * did — the table says when the ladder is the animal's.
 */
function fleeOnHost(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, body: number, ground: number,
): void {
  const fleeing = state.behaviour === 'flee';
  // Dropped already: on its way down and away, nothing more to decide while the alarm holds.
  if (fleeing && state.targetHeight <= ground) return;
  const done = state.behaviourS >= state.behaviourUntilS;
  const contact = contactMmOf(species);
  const inContact = contact === null || nearestDisturbanceGap(state, species, world) <= unitsOfMm(contact);
  const outlasted = fleeing && done;
  if (inContact || (outlasted && rand() < dropChanceOf(species))) {
    state.target = ahead(state.at, awayFrom(state, species, world), HOST_FLEE_LENGTHS * body);
    state.targetHeight = ground;
    renew(state, 'flee', species.senses.alarmS);
    return;
  }
  if (!fleeing || outlasted) {
    const step = unitsOfMm(draw(rand, HOST_FLEE_WALK_MM));
    const pace = paceRatio(state, species) * unitsOfMm(species.pace.fleeMmS);
    state.target = ahead(state.at, awayFrom(state, species, world), step);
    // Up on the plant, where it is: the walk is along the host, not off it.
    state.targetHeight = Math.max(ground, state.height);
    renew(state, 'flee', pace > 0 ? step / pace : species.senses.alarmS);
  }
}

/**
 * PLANT. It feeds on its host most of the time, broken by short walks
 * within a few body lengths of it and rests when tired. On alarm it
 * walks along the host and drops only on contact or persistence
 * (`fleeOnHost`), then walks back to the nearest host it can SEE when
 * calm — usually the one it fell from, and `hostId` then names whichever
 * it chose. Without a host (none in the cell, none in sight) it feeds
 * where it stands and does not walk.
 *
 * `host` is the caller's cached plant for `hostId`, resolved once per
 * creature by the simulation; when the id no longer matches it — the
 * creature chose another host — the plant is looked up again here, so
 * a stale cache can never walk an aphid back to a plant it left.
 */
function thinkPlant(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, host: PlantSource | null, ground: number,
): void {
  const needs = species.needs;
  // Its own body, not the table's: a 4 mm aphid keeps to five of ITS
  // lengths of the stem, which is further than a 1.5 mm one goes.
  const body = sizeRatio(state, species) * unitsOfMm(species.lengthMm);
  const done = state.behaviourS >= state.behaviourUntilS;
  if (state.hostId === null) host = null;
  else if (host === null || host.id !== state.hostId) host = hostPlantOf(state, world);

  if (state.alarm >= ALARM_FLEES_AT) {
    fleeOnHost(state, species, world, rand, body, ground);
    return;
  }

  switch (state.behaviour) {
    case 'flee': {
      if (!done) return;
      // Displaced: the nearest host in SIGHT, which may not be the one it left.
      const seen = nearestHostInSight(state, species, world);
      if (seen !== null && seen.id !== null && seen.id !== state.hostId) {
        state.hostId = seen.id;
        host = seen;
      }
      if (host === null) {
        state.target = null;
        enter(state, 'idle', draw(rand, needs.restS));
        return;
      }
      walkOnHost(state, species, world, rand, host, 0);
      return;
    }
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
  const pace = paceRatio(state, species) * unitsOfMm(species.pace.wanderMmS);
  const far = Math.sqrt(distanceSquared(state.at, target)) + Math.abs(state.targetHeight - state.height);
  enter(state, 'wander', pace > 0 ? far / pace + 1 : 1);
}

/**
 * THE SKY'S GATE ON A TAKEOFF. A fire-ant alate flies at 24-32 °C, RH
 * ≥ 80 %, in light wind, by day, ideally after rain (Milio et al. 1988;
 * Morrill 1974; Zeng et al., as cited in queen.md), and outside that
 * band a real alate does not go — the hard gate is the honest one.
 * What `CreatureWeather` carries today is wind, rain and night, so the
 * gate reads those three and NOT temperature or humidity, which are not
 * on the weather yet; when they arrive this is the one place to add
 * them. Rain is in the gate although the brief named wind and night,
 * because the air brain grounds a flier in rain at its next think
 * (`thinkAir`, `grounded`): a takeoff into rain would be a hop the sky
 * reverses a fifth of a second later, which is a bug to watch, not a
 * behaviour. A player's demand is not gated here — `beginTakeoff` is
 * the door, this is the AI's reason to knock.
 */
export function takeoffWeatherAllows(weather: CreatureWeather | null): boolean {
  const sky = weather ?? CALM_WEATHER;
  if (sky.night) return false;
  if (sky.rainMmHr >= RAINING_MM_HR) return false;
  const wind = Math.hypot(sky.windX, sky.windZ);
  return !Number.isFinite(wind) || wind <= TAKEOFF_WIND_MAX;
}

/**
 * LEAVE THE GROUND: the one hand-over from the ground brain to the air
 * brain, and the one door a possessing player uses for the same thing
 * (Joshua's brief, §13: "wing activation, takeoff"). Writes `takeoff`
 * with the climb the air brain expects — the top of the cruise band
 * over the floor here, for the time the cruise floor takes at the climb
 * rate — and touches nothing else: the target, if any, is where the
 * flight goes, and the air brain gives an empty one a hover and a
 * landing where it is. Returns false, and changes nothing, for a species
 * with no wings or a body already in the air.
 */
export function beginTakeoff(state: CreatureState, species: CreatureSpecies, world: CreatureWorld): boolean {
  const flight = species.flight;
  if (flight === null || isAirborne(state.behaviour)) return false;
  const floor = floorAt(world, state.at);
  const g = Number.isFinite(floor) ? floor : state.height;
  const lo = unitsOfMm(flight.cruiseMm[0]);
  const climb = unitsOfMm(flight.climbMmS);
  state.hostId = null;
  state.targetHeight = g + unitsOfMm(flight.cruiseMm[1]);
  enter(state, 'takeoff', lo / climb);
  return true;
}

/**
 * WHAT A HUNGRY GROUND CREATURE LOOKS FOR, of what it eats: liquid
 * carbohydrate by preference (`CARBOHYDRATE_OR_DRINK`) and protein
 * (`PROTEIN_OR_DRINK`) when it is starving (`PROTEIN_AT`), the other
 * group when the first has nothing in sight — and the drink counts in
 * both, so a thirsty ant that is hungry takes the nearer of a flower and
 * the water's edge. There is no thirst on the state yet; this is what
 * stands in for it, and it says so. The queen's `eats` names no
 * protein, so she takes sugars and water only by data (SUMMARY §1,
 * decision 3's default), not by a branch.
 */
function foodInSight(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, sight: number): ResourceSite | null {
  const eats = species.needs.eats;
  const starving = state.hunger >= PROTEIN_AT;
  const first = starving ? PROTEIN_OR_DRINK : CARBOHYDRATE_OR_DRINK;
  const second = starving ? CARBOHYDRATE_OR_DRINK : PROTEIN_OR_DRINK;
  return nearestSiteOf(world, state.at, eats, first, sight) ?? nearestSiteOf(world, state.at, eats, second, sight);
}

/**
 * THE POLICY'S PREY, or null (`CreaturePolicy` in `world.ts`): nothing
 * under OFF, nothing for a species that is not a predator; under NORMAL
 * only a defensive temperament with no food in sight — prey is the last
 * resort of hunger, never a habit; under FORCE any legal prey in sight.
 */
function preyToAttack(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, policy: PredationPolicy, hasFood: boolean,
): CreatureState | null {
  if (policy === 'off' || !isPredator(species)) return null;
  if (policy === 'normal' && (species.temperament !== 'defensive' || hasFood)) return null;
  return nearestPrey(state, species, world, unitsOfMm(species.senses.sightMm));
}

/** The prey an attack in progress names (`hostId`), while the policy still allows it, it is still legal, and it is still in sight. */
function attackable(state: CreatureState, species: CreatureSpecies, world: CreatureWorld, policy: PredationPolicy): CreatureState | null {
  if (policy === 'off' || !isPredator(species) || state.hostId === null) return null;
  const prey = creatureById(world, state.hostId);
  if (prey === null || !preyOf(species).includes(prey.species)) return null;
  const sight = unitsOfMm(species.senses.sightMm);
  return distanceSquared(state.at, prey.at) <= sight * sight ? prey : null;
}

/**
 * GROUND. An ant's life in the shared words, and the ground's own two.
 *
 * Idle → a short walk to a spot on dry land within a few body lengths
 * (`GROUND_WANDER_LENGTHS`) — inside the range of HOME when the world
 * names one, and further (`GROUND_FORAGE_LENGTHS`) when hungry with
 * nothing in sight — or to food when hungry and food is in sight
 * (`foodInSight`) → feed there → a beat of idle → again; a NAP when
 * tired (the species' short `restS`). On alarm a DEFENSIVE species
 * whose disturbance is ON it — its edge within a body length — turns to
 * face it and holds its ground for the alarm's length, re-facing it
 * every think — a stand, at no pace; one whose disturbance is further
 * flees it at the flee pace, as a skittish one flees everything. The
 * winged queen leaves the ground on a SEVERE alarm — the alarm at 1
 * with the disturbance inside half her reach — when the sky allows
 * (`takeoffWeatherAllows`, `beginTakeoff`), and is the air brain's from
 * that word to the landing. `attack` is chosen only as the policy says
 * (`preyToAttack`), re-aimed at the prey every think while it lasts,
 * and ends where the prey is reached: the bite is a later milestone.
 * Nothing about the sky beyond the takeoff gate — a fire ant forages
 * by day or night as the soil's temperature says (Porter & Tschinkel
 * 1987), and the temperature is not on `CreatureWeather` today.
 */
function thinkGround(
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, rand: () => number, sky: CreatureWeather, ground: number,
): void {
  const needs = species.needs;
  const body = sizeRatio(state, species) * unitsOfMm(species.lengthMm);
  const g = Number.isFinite(ground) ? ground : state.height;
  const done = state.behaviourS >= state.behaviourUntilS;
  const policy = predationOf(world);

  if (state.alarm >= ALARM_FLEES_AT) {
    const threat = nearestDisturbance(state, species, world);
    const onIt = threat !== null && threat.at.wx === state.at.wx && threat.at.wz === state.at.wz;
    const gap = threat === null ? Infinity : Math.sqrt(disturbanceD2(state, threat)) - Math.max(0, threat.radius);
    // SEVERE, and winged: up, if the sky allows. The away point the alarm wrote is where the flight goes.
    if (
      species.flight !== null && state.alarm >= 1 && gap <= unitsOfMm(species.senses.alarmMm) * SEVERE_ALARM_FRACTION
      && takeoffWeatherAllows(sky) && beginTakeoff(state, species, world)
    ) return;
    if (species.temperament === 'defensive' && (gap <= body || state.behaviour === 'defend')) {
      // ON it: a point a body length toward it is what the legs turn to
      // face — and `defend` has no pace, so it is faced and not walked to.
      // Re-faced every think; `enter` keeps the clock of a stand in
      // progress, and a stand once taken is HELD while the alarm lasts,
      // whether the disturbance backs off or goes: an ant that bolted the
      // moment the thing it faced stepped back would have faced nothing.
      const toward = threat === null || onIt ? state.heading : headingToward(state.at, threat.at);
      state.target = ahead(state.at, toward, body);
      state.targetHeight = g;
      state.hostId = null;
      enter(state, 'defend', species.senses.alarmS);
      return;
    }
    if (state.behaviour !== 'flee') {
      // Away: from the disturbance that stands, else along the away point
      // the alarm wrote — unless the last word was a stand, whose target
      // is a point TOWARD the threat, in which case the reverse of the
      // heading that faced it.
      let away: number;
      if (threat !== null && !onIt) away = headingToward(threat.at, state.at);
      else if (state.behaviour === 'defend' || state.target === null) away = wrapHeading(state.heading + Math.PI);
      else away = headingToward(state.at, state.target);
      state.target = ahead(state.at, away, fleeDistance(state, species));
      state.targetHeight = g;
      state.hostId = null;
      enter(state, 'flee', species.senses.alarmS);
    }
    return;
  }

  switch (state.behaviour) {
    case 'attack': {
      const prey = attackable(state, species, world, policy);
      if (prey !== null && !done && distance(state.at, prey.at) > body) {
        // The prey moves: re-aimed at where it is now.
        state.target = prey.at;
        state.targetHeight = g;
        return;
      }
      // Reached, gone, out of sight, or no longer allowed: the bite is a later milestone.
      state.target = null;
      state.hostId = null;
      enter(state, 'idle', draw(rand, GROUND_IDLE_S));
      return;
    }
    case 'flee':
    case 'defend':
      if (!done) return;
      state.target = null;
      state.hostId = null;
      enter(state, 'idle', draw(rand, GROUND_IDLE_S));
      return;
    case 'wander':
      if (!done && !arrived(state, species)) return;
      state.target = null;
      if (state.hostId !== null && state.hunger >= needs.feedAt) {
        enter(state, 'feed', draw(rand, needs.feedS));
        return;
      }
      state.hostId = null;
      enter(state, 'idle', draw(rand, GROUND_IDLE_S));
      return;
    case 'feed':
    case 'rest':
      if (!done) return;
      state.target = null;
      state.hostId = null;
      enter(state, 'idle', draw(rand, GROUND_IDLE_S));
      return;
    default: {
      // Idle, and any word a save carried.
      if (!done) return;
      if (state.fatigue >= needs.restAt) {
        // A NAP: the species' own `restS`, which for the ants is a minute's order (Cassill 2009).
        state.target = null;
        state.hostId = null;
        enter(state, 'rest', draw(rand, needs.restS));
        return;
      }
      const pace = paceRatio(state, species) * unitsOfMm(species.pace.wanderMmS);
      const turn = Math.PI / Math.max(1e-6, species.pace.turnRadS);
      const hungry = state.hunger >= needs.feedAt;
      if (hungry) {
        const site = foodInSight(state, species, world, unitsOfMm(species.senses.sightMm));
        if (site !== null && distanceSquared(state.at, site.at) <= body * body) {
          // Already on it.
          state.target = null;
          state.hostId = site.id;
          enter(state, 'feed', draw(rand, needs.feedS));
          return;
        }
        const prey = preyToAttack(state, species, world, policy, site !== null);
        if (prey !== null) {
          const burst = paceRatio(state, species) * unitsOfMm(species.pace.fleeMmS);
          state.target = prey.at;
          state.hostId = prey.id;
          state.targetHeight = g;
          enter(state, 'attack', burst > 0 ? distance(state.at, prey.at) / burst + turn : 1);
          return;
        }
        if (site !== null && isLand(world, site.at)) {
          state.target = site.at;
          state.hostId = site.id;
          state.targetHeight = g;
          enter(state, 'wander', pace > 0 ? distance(state.at, site.at) / pace + 1 : 1);
          return;
        }
      }
      // Nowhere in particular: a loop on dry land inside the box and inside
      // the range of home — a short one, or a forager's sweep when hungry —
      // or, strayed past that range, the way back; else another beat here.
      const home = homeOf(world);
      const reach = (hungry ? GROUND_FORAGE_LENGTHS : GROUND_WANDER_LENGTHS) * body;
      for (let i = 0; i < GROUND_WANDER_TRIES; i += 1) {
        const theta = rand() * Math.PI * 2;
        const r = reach * Math.sqrt(rand());
        const spot = translate(state.at, Math.sin(theta) * r, Math.cos(theta) * r);
        if (!isLand(world, spot) || !inBoundsOf(world, spot)) continue;
        if (home !== null && distanceSquared(spot, home) > GROUND_HOME_RANGE * GROUND_HOME_RANGE) continue;
        state.target = spot;
        state.hostId = null;
        state.targetHeight = g;
        enter(state, 'wander', pace > 0 ? r / pace + 1 : 1);
        return;
      }
      if (home !== null && distanceSquared(state.at, home) > GROUND_HOME_RANGE * GROUND_HOME_RANGE) {
        const back = Math.min(reach, distance(state.at, home));
        state.target = ahead(state.at, headingToward(state.at, home), back);
        state.hostId = null;
        state.targetHeight = g;
        enter(state, 'wander', pace > 0 ? back / pace + 1 : 1);
        return;
      }
      state.target = null;
      enter(state, 'idle', draw(rand, GROUND_IDLE_S));
    }
  }
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
  state: CreatureState, species: CreatureSpecies, world: CreatureWorld, flight: FlightSpec, rand: () => number, floor: number, lo: number,
): void {
  state.hostId = null;
  const hop = landwardHop(world, state.at, flight, rand);
  if (hop !== null) {
    const under = floorAt(world, hop);
    state.target = hop;
    state.targetHeight = (Number.isFinite(under) ? under : floor) + lo;
    enter(state, 'fly', flightClock(state, species, flight, hop));
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
      if (above >= TAKEOFF_FRACTION * lo || done) enter(state, 'fly', flightClock(state, species, flight, state.target));
    } else if (state.behaviour !== 'fly') {
      state.targetHeight = g + unitsOfMm(flight.cruiseMm[1]);
      enter(state, 'fly', flightClock(state, species, flight, state.target));
    } else if (done || arrived(state, species)) {
      // Still alarmed at the end of the hop: keep going the same way.
      state.target = ahead(state.at, state.heading, fleeDistance(state, species));
      if (!isLand(world, state.target) || !inBoundsOf(world, state.target)) {
        state.target = landwardHop(world, state.at, flight, rand) ?? state.at;
      }
      renew(state, 'fly', flightClock(state, species, flight, state.target));
    }
    return;
  }

  switch (state.behaviour) {
    case 'takeoff':
      if (above < TAKEOFF_FRACTION * lo && !done) return;
      enter(state, 'fly', flightClock(state, species, flight, state.target));
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
        hopOffWater(state, species, world, flight, rand, g, lo);
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
        hopOffWater(state, species, world, flight, rand, g, lo);
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
