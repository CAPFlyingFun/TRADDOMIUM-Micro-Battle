/**
 * THE SHAPE OF THE TOMBS LABORATORY — what a room, a wall, a console and
 * a light ARE, before anything draws one.
 *
 * The laboratory is procedural and modular: a small specification is
 * expanded by `plan.ts` into the lists below, and `src/tombs/` turns
 * those lists into meshes. Nothing here knows what a mesh is. That seam
 * is the same one `terrain/` has with `world/heightfield` and `flora/`
 * has with `world/objects`, and it buys the same two things — the plan
 * is testable in plain node, and a server could hold the building's
 * collision without a GPU.
 *
 * THREE RULES THE SHAPE IS BUILT ON, each of which is a simplification
 * made on purpose rather than a thing not yet done:
 *
 * 1. EVERYTHING IS AXIS-ALIGNED. A `Box` has a centre and extents and no
 *    rotation. A research building is rectangular, and an axis-aligned
 *    world makes the player's collision an interval test on three axes
 *    instead of a separating-axis routine. The array's rings are the one
 *    exception and they carry their own type, because a ring at an angle
 *    is the whole of what the array looks like.
 * 2. LOCAL METRES, not world units. The plan is written at human scale
 *    with the origin on the floor at the building's centre, +X east,
 *    +Y up, +Z south — the world's own axes, since `TOMBS_YAW` is zero.
 *    The renderer multiplies by `UNITS_PER_METRE` once, at the boundary.
 *    A floor plan in centimetres would be unreadable and a plan in world
 *    coordinates would be six digits wide.
 * 3. A SOLID IS A SOLID FOR EVERYONE. `Slab.solid` is the one answer to
 *    "does a body stop here" — the renderer does not get a second
 *    opinion and the player does not get a private list. A screen face
 *    is not solid; the glass in the reinforced port is.
 *
 * Pure: no three, no DOM, no storage, no network. This is core.
 */

/** A point or an extent in LOCAL METRES. Never world units. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** An axis-aligned box: `at` is its CENTRE, `size` its FULL extents. */
export interface Box {
  readonly at: Vec3;
  readonly size: Vec3;
}

/** The rooms the manuscript names, and nothing it does not. */
export type RoomId =
  /** Jack's laboratory: workstations, the intercom, the sliding door (ch 1). */
  | 'laboratory'
  /** The corridor from the laboratory to the main control room (ch 2). */
  | 'corridor'
  /** The main control room: both consoles, the emergency panel (ch 2, ch 3). */
  | 'control'
  /** The array chamber behind the reinforced port (ch 2). */
  | 'chamber'
  /** The building's plant: capacitors, the reactor housing, the grid feed (ch 2). */
  | 'utility'
  /** The way in from the island. Ours, not the manuscript's. */
  | 'entrance';

/**
 * What a slab is made of. The renderer owns the look; this says which
 * of a handful of looks, so a plan can be read without a colour in it.
 */
export type Surface =
  | 'floor'
  | 'wall'
  | 'ceiling'
  /** The reinforced port between the control room and the chamber. */
  | 'glass'
  /** Racks, housings, conduit, the chamber's grating. */
  | 'metal'
  /** A worktop. */
  | 'desk'
  /** A machine's casing. */
  | 'panel'
  /** A dark monitor face. */
  | 'screen'
  /** A display that is lit from inside. */
  | 'readout'
  /** Warning stripes, a lever housing, a door frame. */
  | 'accent';

/** One rectangular piece of the building. */
export interface Slab {
  readonly id: string;
  readonly room: RoomId;
  readonly surface: Surface;
  readonly box: Box;
  /** Does a body stop against it? The one answer, for everyone. */
  readonly solid: boolean;
}

/**
 * One of the array's articulated rings (ch 2: "Several articulated rings
 * surrounded a central platform").
 *
 * The one thing in the plan that is not axis-aligned, because the rings
 * lying at different angles is what the array looks like.
 */
export interface Ring {
  readonly id: string;
  /** Centre, local metres — the same centre for every ring. */
  readonly at: Vec3;
  readonly radius: number;
  /** The thickness of the ring itself. */
  readonly tube: number;
  /** Radians about +X, applied first. */
  readonly tilt: number;
  /** Radians about +Y, applied second. */
  readonly yaw: number;
  /**
   * Radians a second about the ring's own axis while the array runs.
   * Signed, so neighbouring rings can turn against each other. Zero is a
   * ring at rest, which is what chapter 3 leaves them at.
   */
  readonly spin: number;
}

/**
 * A cylinder: the array's central platform, the emitter pylons around
 * it, the reactor housing, a structural column.
 *
 * The second exception to "everything is axis-aligned", and a much
 * smaller one than the rings — a pillar stands UP, always. It exists
 * because a building drawn entirely out of boxes reads as a set of
 * boxes, and because a body stopping against a round thing at its radius
 * is one distance test rather than four faces of a square guess.
 */
export interface Pillar {
  readonly id: string;
  readonly room: RoomId;
  readonly surface: Surface;
  /** The centre of its BASE, not of its volume. */
  readonly at: Vec3;
  readonly radius: number;
  readonly height: number;
  /** Does a body stop against it? Same one answer as `Slab.solid`. */
  readonly solid: boolean;
}

/**
 * Which set a lamp belongs to. `normal` is the building's lighting;
 * `emergency` is what chapter 2 switches on after the shutdown lever —
 * "the room went dark… The emergency lights switched on."
 */
export type LightMode = 'normal' | 'emergency';

export interface Lamp {
  readonly id: string;
  readonly room: RoomId;
  readonly at: Vec3;
  readonly mode: LightMode;
  /** 0xRRGGBB. */
  readonly colour: number;
  readonly intensity: number;
  /** How far it carries, in metres. */
  readonly reach: number;
}

/** What the player does at an interaction point. */
export type Doing =
  /** Look at something and be told what it says. */
  | 'read'
  /** Speak into it. */
  | 'speak'
  /** Pull it. */
  | 'pull'
  /** Open or close it. */
  | 'open';

export interface Interaction {
  readonly id: string;
  readonly room: RoomId;
  /** Where the thing is. The player interacts from within `reach` of it. */
  readonly at: Vec3;
  /** Metres. */
  readonly reach: number;
  readonly doing: Doing;
  /** What it is, for a label: "Jack's workstation". */
  readonly label: string;
  /** What doing it would mean, for a prompt: "Read the diagnostic data". */
  readonly prompt: string;
}

/** A way through a wall. The plan cuts the wall around it. */
export interface Doorway {
  readonly id: string;
  readonly from: RoomId;
  /** `null` is the island. */
  readonly to: RoomId | null;
  /** The centre of the opening at floor level. */
  readonly at: Vec3;
  readonly width: number;
  readonly height: number;
  /** Chapter 1's laboratory door slides. A hatch does not. */
  readonly sliding: boolean;
}

export interface Room {
  readonly id: RoomId;
  /** What a person would call it. */
  readonly name: string;
  /**
   * The INTERIOR volume — air, not structure. Its floor is at
   * `inside.at.y - inside.size.y / 2`, which is where a body stands.
   */
  readonly inside: Box;
}

/** The whole building, expanded. */
export interface LabLayout {
  readonly rooms: readonly Room[];
  readonly slabs: readonly Slab[];
  readonly pillars: readonly Pillar[];
  readonly rings: readonly Ring[];
  readonly lamps: readonly Lamp[];
  readonly doorways: readonly Doorway[];
  readonly interactions: readonly Interaction[];
  /** Where a new game begins, and which way it faces (radians about +Y). */
  readonly spawn: { readonly at: Vec3; readonly yaw: number };
  /** Everything the building occupies, for a streaming bubble or a cull. */
  readonly bounds: Box;
}

// ---------------------------------------------------------------------------
// Small pure helpers, so nobody writes the arithmetic twice
// ---------------------------------------------------------------------------

export function vec(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** A box from its centre and its full extents. */
export function box(at: Vec3, size: Vec3): Box {
  return { at, size };
}

/**
 * A box from the two opposite corners it spans. The way a floor plan is
 * actually read — "the room runs from here to here" — and the way every
 * off-by-a-half-extent mistake is avoided.
 */
export function spanning(a: Vec3, b: Vec3): Box {
  return {
    at: vec((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2),
    size: vec(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)),
  };
}

export function minOf(b: Box): Vec3 {
  return vec(b.at.x - b.size.x / 2, b.at.y - b.size.y / 2, b.at.z - b.size.z / 2);
}

export function maxOf(b: Box): Vec3 {
  return vec(b.at.x + b.size.x / 2, b.at.y + b.size.y / 2, b.at.z + b.size.z / 2);
}

/** Does a point lie inside the box, inclusive of its faces? */
export function holds(b: Box, p: Vec3): boolean {
  const lo = minOf(b);
  const hi = maxOf(b);
  return p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y && p.z >= lo.z && p.z <= hi.z;
}

/** Do two boxes share any volume? Touching faces do NOT overlap. */
export function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.at.x - b.at.x) * 2 < a.size.x + b.size.x
    && Math.abs(a.at.y - b.at.y) * 2 < a.size.y + b.size.y
    && Math.abs(a.at.z - b.at.z) * 2 < a.size.z + b.size.z;
}

/** The smallest box holding all of them. Empty in, zero out. */
export function union(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return box(vec(0, 0, 0), vec(0, 0, 0));
  let lo = minOf(boxes[0]);
  let hi = maxOf(boxes[0]);
  for (let i = 1; i < boxes.length; i += 1) {
    const l = minOf(boxes[i]);
    const h = maxOf(boxes[i]);
    lo = vec(Math.min(lo.x, l.x), Math.min(lo.y, l.y), Math.min(lo.z, l.z));
    hi = vec(Math.max(hi.x, h.x), Math.max(hi.y, h.y), Math.max(hi.z, h.z));
  }
  return spanning(lo, hi);
}
