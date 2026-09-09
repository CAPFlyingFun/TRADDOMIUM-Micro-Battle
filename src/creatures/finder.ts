/**
 * THE FINDER'S ARITHMETIC: which animal is nearest, and where a camera
 * would have to stand to actually see it.
 *
 * Joshua, 2026-09-08, from the phone: "I don't see any worms in the game
 * or any of the glb models you added." They are there. The trouble is
 * the scale the project chose. A worm is 150 mm of a 5,600,000-unit
 * island, an aphid 1.4 mm; a worm spends most of its life 12 mm UNDER
 * the ground, where the renderer correctly declines to draw it; and
 * nothing is simulated past its species' reach (30 m for a worm, 40 for
 * a fly). At any altitude a free camera actually flies at, a correct
 * ecology is indistinguishable from an empty island.
 *
 * So this is not a fix — nothing is broken — it is an INSTRUMENT. It
 * answers two questions and nothing else:
 *
 *   where is one?      `nearestSighting`, and the pins the renderer
 *                      draws from the same list. "One" means one that
 *                      can be SEEN where it can: see `preferVisible`.
 *   how do I see it?   `viewpointFor`: the pose a camera has to take to
 *                      have a 15 cm animal fill a phone screen, which is
 *                      closer than anyone flies by hand.
 *
 * IT ADDS NOTHING TO THE WORLD. It reads the simulation's own creature
 * list and the ground it already knows; it does not widen a reach, grow
 * a body, hold a worm at the surface or spawn anything. Switch it off
 * and the island is exactly what it was — which is the point of an
 * instrument, and the difference between finding the animals and
 * arranging for them to be findable.
 *
 * Pure: no three, no DOM. `src/creatures/` is core.
 */
import { distanceSquared, translate, type WorldPoint } from '../world/coords';
import { wrapHeading } from './heading';
import { MM_PER_UNIT, unitsOfMm, type CreatureId, type CreatureSpecies } from './species';
import type { Behaviour, CreatureState } from './state';

/** Metres to world units, and back. The world is in centimetres, so a metre is 100 units. */
export function unitsOfMetres(metres: number): number {
  return unitsOfMm(metres * 1000);
}

export function metresOfUnits(units: number): number {
  return (units * MM_PER_UNIT) / 1000;
}

/**
 * A body this far under the ground it stands on is underground as far as
 * the finder is concerned — the same line `fauna/FinderView` dims a pin
 * at, and deliberately the renderer's own `BURROW_HIDE`: the pin's job
 * is to say "here, and you cannot see it", so it must change exactly
 * when the body stops being drawn.
 */
export const UNDER_GROUND = 0.3;

/**
 * How close the viewpoint stands, in BODY LENGTHS. At three lengths a
 * 60° camera puts the animal across about a quarter of the screen's
 * height, which is what "look at the model" means; further out and the
 * worm is the two pixels it has been all along.
 */
export const VIEW_LENGTHS = 3;

/**
 * Never closer than this, world units: 1 cm, ten times the camera's near
 * plane (`perf/FreeFlyCamera`, 0.1 units), so the nearest thing the
 * finder ever asks for is still comfortably in front of the glass.
 *
 * It is deliberately SMALL. A floor of 20 cm was tried first and it is
 * the wrong instrument for this world: three lengths of a 1.4 mm aphid
 * is 4.2 mm, and holding the camera 20 cm off instead drew the animal
 * four pixels tall on a 430-pixel screen — the very complaint the finder
 * exists to answer. The test measures that span rather than trusting
 * the number.
 */
export const MIN_STANDOFF = 0.8;

/** How far above the animal the viewpoint sits, as a fraction of the standoff: a gentle look down, not a plan view. */
export const VIEW_RISE = 0.35;

/**
 * The air the viewpoint keeps under it where the ground rises to meet
 * it, as a FRACTION OF THE STANDOFF rather than an absolute: this world
 * spans four orders of magnitude of animal, and a fixed 2 cm that is
 * nothing to a worm at 45 cm would put the camera twenty standoffs above
 * an aphid and turn the shot into a plan view of the island.
 */
export const GROUND_CLEARANCE = 0.25;

/** One sighting: an animal, where it is, and what stands between it and being seen. */
export interface FinderSighting {
  readonly id: string;
  readonly species: CreatureId;
  readonly at: WorldPoint;
  /** The body's reference point above mean sea level, world units. */
  readonly height: number;
  /** Horizontal distance from the focus, world units. */
  readonly distance: number;
  /**
   * How far the body is under the ground it stands on, world units;
   * negative when it is above. Null when no ground was supplied — an
   * honest "not known", never a 0 that would read as "at the surface".
   */
  readonly under: number | null;
  readonly behaviour: Behaviour;
  /** THIS animal's body length, mm — what a camera has to stand back from. */
  readonly lengthMm: number;
}

/** Whether this sighting is hidden in the ground: false when nothing knows the ground. */
export function isUnderground(sighting: FinderSighting): boolean {
  return sighting.under !== null && sighting.under > UNDER_GROUND;
}

export interface SightingOptions {
  /** The ground's height at a point, world units above sea level. Without it, `under` is null on every sighting. */
  readonly groundAt?: (at: WorldPoint) => number;
  /** Consider only these species. Omitted: all of them. */
  readonly species?: ReadonlySet<CreatureId>;
  /**
   * PREFER AN ANIMAL THAT CAN ACTUALLY BE SEEN.
   *
   * The nearest animal to a camera in a forest is usually a worm 12 mm
   * under the soil, and being taken to one is being taken to a patch of
   * dirt — which is the complaint this whole thing exists to answer. So
   * the instrument looks for the nearest animal that is NOT underground
   * and only falls back to the nearest buried one when every animal in
   * reach is buried, in which case the readout says `under` and the
   * player is at least standing over it.
   *
   * Needs `groundAt`: with no ground nothing is known to be buried, and
   * this changes nothing.
   */
  readonly preferVisible?: boolean;
}

function sightingOf(c: CreatureState, focus: WorldPoint, groundAt?: (at: WorldPoint) => number): FinderSighting {
  return {
    id: c.id,
    species: c.species,
    at: c.at,
    height: c.height,
    distance: Math.sqrt(distanceSquared(c.at, focus)),
    under: groundAt === undefined ? null : groundAt(c.at) - c.height,
    behaviour: c.behaviour,
    lengthMm: c.lengthMm,
  };
}

/**
 * The nearest animal to the focus, or null when the simulation is
 * holding none. Horizontal distance, like every other reach in the
 * simulation: a camera 60 m up is still standing over the worm it can
 * see a pin for, and sorting by the 3-D distance would call that worm
 * "60 m away" and send the player chasing a nearer one on the far side
 * of a hill.
 */
export function nearestSighting(
  creatures: readonly CreatureState[],
  focus: WorldPoint,
  options: SightingOptions = {},
): FinderSighting | null {
  const { groundAt } = options;
  const wantsVisible = options.preferVisible === true && groundAt !== undefined;
  let best: CreatureState | null = null;
  let bestD2 = Infinity;
  let seen: CreatureState | null = null;
  let seenD2 = Infinity;
  for (const c of creatures) {
    if (options.species !== undefined && !options.species.has(c.species)) continue;
    const d2 = distanceSquared(c.at, focus);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
    if (wantsVisible && d2 < seenD2 && groundAt(c.at) - c.height <= UNDER_GROUND) {
      seenD2 = d2;
      seen = c;
    }
  }
  const pick = seen ?? best;
  return pick === null ? null : sightingOf(pick, focus, groundAt);
}

/** Every creature as a sighting, nearest first — what the pins are drawn from. */
export function sightings(
  creatures: readonly CreatureState[],
  focus: WorldPoint,
  options: SightingOptions = {},
): FinderSighting[] {
  const out: FinderSighting[] = [];
  for (const c of creatures) {
    if (options.species !== undefined && !options.species.has(c.species)) continue;
    out.push(sightingOf(c, focus, options.groundAt));
  }
  out.sort((a, b) => a.distance - b.distance);
  return out;
}

/**
 * How far off an animal is viewed from, world units: three of ITS body
 * lengths, never under `MIN_STANDOFF`.
 *
 * The animal's, not its kind's. Every worm used to be 150 mm and one
 * stand-off served them all; now a 250 mm worm is drawn at 250 mm, and a
 * camera parked at the cited length's distance would have it overflow
 * the frame while a 120 mm one sat lost in the middle of it.
 */
export function standoffOf(species: CreatureSpecies, lengthMm: number = species.lengthMm): number {
  const length = Number.isFinite(lengthMm) && lengthMm > 0 ? lengthMm : species.lengthMm;
  return Math.max(unitsOfMm(length) * VIEW_LENGTHS, MIN_STANDOFF);
}

/**
 * Where a camera stands to look at one animal.
 *
 * A HEADING AND A PITCH, NEVER A YAW. The half-turn between the two is
 * `perf/FreeFlyCamera.yawForHeading`, and it is written down once, in
 * the file that owns a camera — core says which way to LOOK, in the
 * actor convention every other heading in this project uses, and the
 * scene turns that into a camera at the seam.
 *
 * IT COMES FROM WHERE YOU ALREADY ARE. The viewpoint is placed on the
 * line from the animal back towards the focus, so the move reads as
 * "closer" rather than as a jump to the far side of it, and a second
 * press while already there does not swing the camera around. Standing
 * exactly on top of one, the animal's own heading breaks the tie.
 */
export interface Viewpoint {
  readonly at: WorldPoint;
  readonly height: number;
  /** Actor convention: ahead is (sin heading, cos heading). */
  readonly heading: number;
  /** Radians, up positive — what a camera pitch means. */
  readonly pitch: number;
}

export interface ViewpointOptions {
  /** The ground under the viewpoint, so the camera is never placed inside a hill. */
  readonly groundAt?: (at: WorldPoint) => number;
  /** Where the camera is now: the side the viewpoint is placed on. Omitted, it comes from due south. */
  readonly from?: WorldPoint;
  /** Override the standoff, world units — a test's dial, not a setting. */
  readonly standoff?: number;
}

export function viewpointFor(
  sighting: FinderSighting,
  species: CreatureSpecies,
  options: ViewpointOptions = {},
): Viewpoint {
  const standoff = options.standoff ?? standoffOf(species, sighting.lengthMm);
  // The direction from the animal back towards the camera. A zero-length
  // or non-finite vector (standing exactly on it) falls back to due
  // south, which is heading 0 in this project's convention.
  let dx = options.from === undefined ? 0 : options.from.wx - sighting.at.wx;
  let dz = options.from === undefined ? 1 : options.from.wz - sighting.at.wz;
  const length = Math.hypot(dx, dz);
  if (!(length > 1e-6) || !Number.isFinite(length)) {
    dx = 0;
    dz = 1;
  } else {
    dx /= length;
    dz /= length;
  }

  const at = translate(sighting.at, dx * standoff, dz * standoff);
  // A worm underground is looked at from above the GROUND, not from
  // under it: the pin is what shows through, and a camera buried in the
  // hill would see the inside of the terrain instead.
  const eyeOver = Math.max(sighting.height, options.groundAt?.(sighting.at) ?? sighting.height);
  let height = eyeOver + standoff * VIEW_RISE;
  const ground = options.groundAt?.(at);
  if (ground !== undefined && Number.isFinite(ground)) height = Math.max(height, ground + standoff * GROUND_CLEARANCE);

  // Looking back down the same line: the heading is the reverse of the
  // offset, and the pitch is the drop over the run.
  const heading = wrapHeading(Math.atan2(-dx, -dz));
  const drop = sighting.height - height;
  return { at, height, heading, pitch: Math.atan2(drop, standoff) };
}
