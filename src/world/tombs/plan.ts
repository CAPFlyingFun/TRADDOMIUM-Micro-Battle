/**
 * THE TOMBS RESEARCH LABORATORY, EXPANDED FROM A SPECIFICATION.
 *
 * This is the building the player starts inside. `site.ts` says where it
 * stands on Kauaʻi, `types.ts` says what a room, a slab, a ring and a
 * lamp ARE, and this file is the only thing that decides what the
 * building IS. `src/tombs/` draws whatever comes out; it never invents a
 * wall of its own, and a server could hold this layout without a GPU.
 *
 * IT IS GENERATED, NOT TRANSCRIBED — and that is the point of `LabSpec`.
 * A floor plan typed out as five hundred boxes is a floor plan that can
 * only be changed by typing it out again, and every one of those boxes
 * is a chance to leave a hole a player can walk through. So the spec
 * carries SIX ROOM RECTANGLES and SEVEN OPENINGS, and everything else —
 * the floors, the ceilings, every wall segment, the shell, the lights —
 * is computed. Widen the laboratory in `LAB_SPEC` and its walls, its
 * shell, its lights and its benches all move with it; `tests/tombsPlan
 * .test.ts` proves that by planning a wider building and re-running the
 * seal and the reachability checks against it.
 *
 * THE WALLS ARE THE GAPS BETWEEN THE ROOMS, which is why the room table
 * is the whole of the geometry. `chamber` ends at z = -0.4 and `control`
 * begins at z = +0.4, so the wall between them is 0.8 m thick and the
 * number 0.8 is never written down: it is the distance between two rooms
 * that a reader can see in the table. The only thickness this file names
 * is the SHELL's, because outside the outermost room there is no second
 * room to measure against.
 *
 * HOW THE WALLS ARE CUT. Every room edge and the shell's own edge become
 * lines of a LATTICE; each cell of that lattice is either the inside of
 * exactly one room or it is structure. Structure cells are merged into
 * the largest rectangles that agree on height and on which room they
 * serve, and then each rectangle is CUT around the openings that pierce
 * it — left of the door, right of it, under it and over it — so a wall
 * is a set of segments and never one slab with an imaginary hole in it.
 * A renderer that drew a hole as a hole would be the only thing that
 * knew the hole was there; the collision would not, and the player would
 * walk into a doorway.
 *
 * A WALL RISES TO THE TALLEST ROOM IT TOUCHES. The array chamber is 7 m
 * and the control room next door is 3.2 m, so the wall between them is
 * 7 m and the control room's ceiling tucks into it. The height comes
 * from the lattice — the rooms in the eight cells around this one — not
 * from a number in a table, so it follows a room whose ceiling changes.
 *
 * WHAT THE ROOMS HOLD IS STORY CANON. The manuscript's chapters 1-3 name
 * Jack's workstation and the second one his chair nearly struck, the
 * intercom he called Sarah on, the sliding door, the far end of the
 * laboratory, the primary and secondary consoles, the emitter controls,
 * the emergency panel and its physical shutdown lever, the perimeter
 * camera feeds, the structural monitor, the island map with the red
 * boundary on it, the array's articulated rings around their central
 * platform, and the three things the power came from — the backup
 * capacitors, the offline reactor and the island grid feed. Each of
 * those is a fixture below with the chapter it comes from named in a
 * comment. The entrance is OURS: the manuscript never walks in from
 * outside, and the player has to.
 *
 * THE RINGS ARE STOPPED. Chapter 3 leaves the array at rest, and a PLAN
 * is not a state machine: every ring's `spin` is 0 and the speeds a
 * caller would use to start it live in `ARRAY_SPINS`, signed so that
 * neighbouring rings turn against each other.
 *
 * LOCAL METRES THROUGHOUT. The origin is on the floor at the building's
 * centre, +X east, +Y up, +Z south — the world's own axes, because
 * `TOMBS_YAW` is zero. The renderer multiplies by `UNITS_PER_METRE`
 * once, at its own boundary; nothing here ever does.
 *
 * PURE AND DETERMINISTIC. No `Math.random`, no clock, no three, no DOM,
 * no storage, no network. The same spec gives the same building on every
 * machine and on every call, which is what lets a test compare two plans
 * and what would let an authority and a phone agree on where a wall is.
 */
import {
  box, maxOf, minOf, spanning, union, vec,
  type Box, type Doing, type Doorway, type Interaction, type LabLayout, type Lamp,
  type LightMode, type Pillar, type Ring, type Room, type RoomId, type Slab, type Surface, type Vec3,
} from './types';

// ---------------------------------------------------------------------------
// The specification: the whole building, in six rectangles and seven holes
// ---------------------------------------------------------------------------

/** One room's INTERIOR volume. The walls are the gaps between these. */
export interface RoomSpec {
  readonly id: RoomId;
  /** What a person would call it. */
  readonly name: string;
  /** Interior bounds along +X (east), low then high. */
  readonly x: readonly [number, number];
  /** Interior bounds along +Z (south), low then high. */
  readonly z: readonly [number, number];
  /** Floor to the underside of the ceiling. */
  readonly ceiling: number;
}

/**
 * A way through a wall, or a way to LOOK through one. A `doorway` is
 * empty and a body passes; a `port` is filled with glass that stops one.
 * Both cut the wall the same way, which is the whole reason they share
 * a type — the mistake to avoid is a port that is a hole to the
 * collision and a window to the renderer.
 */
export type OpeningKind = 'doorway' | 'port';

export interface OpeningSpec {
  readonly id: string;
  readonly from: RoomId;
  /** `null` is the island. */
  readonly to: RoomId | null;
  readonly kind: OpeningKind;
  /** The axis the opening passes THROUGH: the axis its wall is thin along. */
  readonly through: 'x' | 'z';
  /** Where that wall stands, on the `through` axis. */
  readonly at: number;
  /** Where the opening's centre sits along the wall's length. */
  readonly along: number;
  readonly width: number;
  readonly height: number;
  /** The opening's bottom, off the floor. A doorway is 0; the port sits at 1.0. */
  readonly sill: number;
  /** Chapter 1's laboratory door slides. A hatch does not. */
  readonly sliding: boolean;
}

export interface LabSpec {
  readonly rooms: readonly RoomSpec[];
  readonly openings: readonly OpeningSpec[];
  /**
   * The outer shell's thickness — the ONE wall thickness written down,
   * because outside the outermost room there is no second room to
   * measure the gap against.
   */
  readonly shell: number;
  /** Floor slab and foundation thickness, under every room and every wall. */
  readonly floor: number;
  /** Ceiling slab thickness, above each room's interior height. */
  readonly ceiling: number;
  /**
   * Where a new game begins.
   *
   * YAW CONVENTION: 0 faces -Z (north) and increases toward +X, which is
   * exactly what a three.js object with `rotation.y` does, so the
   * renderer assigns this number and does not negate it. Facing north
   * from the spawn puts Jack's workstation ahead of the player with the
   * sliding door beyond it — chapter 1's opening shot.
   */
  readonly spawn: { readonly room: RoomId; readonly at: Vec3; readonly yaw: number };
}

/**
 * Freeze a table and everything inside it. The canonical building is a
 * shared constant; a caller that edited one of its rooms would change
 * every plan made afterwards in that process.
 */
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) freezeDeep(inner);
  }
  return Object.freeze(value);
}

/**
 * THE CANONICAL BUILDING.
 *
 * The interior footprint is 26 x 26 m and the shell runs
 * x in [-13.4, +13.4], z in [-10.4, +16.4] — which is the 26 x 26 m the
 * site survey found a quarter-kilometre of flat ground for (`site.ts`).
 */
export const LAB_SPEC: LabSpec = freezeDeep<LabSpec>({
  rooms: [
    // The array chamber is the tall one: 7 m, because the array stands in it (ch 2).
    { id: 'chamber', name: 'Array chamber', x: [-13.0, 1.0], z: [-10.0, -0.4], ceiling: 7.0 },
    // The main control room, looking north into the chamber through the port (ch 2, ch 3).
    { id: 'control', name: 'Main control room', x: [-13.0, 1.0], z: [0.4, 6.0], ceiling: 3.2 },
    // The plant: capacitors, the reactor, the grid feed (ch 2).
    { id: 'utility', name: 'Utility bay', x: [1.4, 13.0], z: [-10.0, 6.0], ceiling: 4.0 },
    // The corridor from the laboratory to the main control room (ch 2).
    { id: 'corridor', name: 'Main corridor', x: [-13.0, 13.0], z: [6.4, 9.0], ceiling: 2.7 },
    // Jack's laboratory (ch 1). Its far end is the west wall Sarah turns toward in ch 2.
    { id: 'laboratory', name: 'Laboratory', x: [-13.0, -1.0], z: [9.4, 16.0], ceiling: 3.0 },
    // Ours, not the manuscript's: the way in from the island.
    { id: 'entrance', name: 'Entrance hall', x: [-0.6, 13.0], z: [9.4, 16.0], ceiling: 3.0 },
  ],
  openings: [
    // Ch 1: "the laboratory door slid open".
    { id: 'lab-door', from: 'laboratory', to: 'corridor', kind: 'doorway', through: 'z', at: 9.2, along: -3.5, width: 1.4, height: 2.2, sill: 0, sliding: true },
    { id: 'control-door', from: 'control', to: 'corridor', kind: 'doorway', through: 'z', at: 6.2, along: -6.0, width: 1.6, height: 2.2, sill: 0, sliding: true },
    { id: 'utility-door', from: 'utility', to: 'corridor', kind: 'doorway', through: 'z', at: 6.2, along: 7.0, width: 1.6, height: 2.2, sill: 0, sliding: false },
    { id: 'entrance-door', from: 'entrance', to: 'corridor', kind: 'doorway', through: 'z', at: 9.2, along: 4.0, width: 1.8, height: 2.4, sill: 0, sliding: true },
    // The only way into the chamber is through the plant, which is why ch 2 goes that way.
    { id: 'chamber-hatch', from: 'chamber', to: 'utility', kind: 'doorway', through: 'x', at: 1.2, along: -5.0, width: 1.6, height: 2.4, sill: 0, sliding: false },
    { id: 'outer-door', from: 'entrance', to: null, kind: 'doorway', through: 'z', at: 16.2, along: 6.0, width: 2.0, height: 2.4, sill: 0, sliding: true },
    // Ch 2: the reinforced port the control room watches the array through.
    // Not a doorway — it is filled with glass, and the glass is solid.
    { id: 'control-port', from: 'control', to: 'chamber', kind: 'port', through: 'z', at: 0.0, along: -6.0, width: 8.0, height: 1.8, sill: 1.0, sliding: false },
  ],
  shell: 0.4,
  floor: 0.4,
  ceiling: 0.25,
  // On the laboratory floor between Sarah's workstation and the far end,
  // facing north up the room (ch 1).
  spawn: { room: 'laboratory', at: vec(-6.0, 0, 13.0), yaw: 0 },
});

// ---------------------------------------------------------------------------
// Tuning tables. Everything a reviewer might want to nudge lives here
// rather than inline, and every one of them is frozen.
// ---------------------------------------------------------------------------

/** The array's five articulated rings, outermost first (ch 2). */
const RING_RADII: readonly number[] = Object.freeze([2.6, 2.2, 1.8, 1.5, 1.2]);
const RING_TUBES: readonly number[] = Object.freeze([0.20, 0.18, 0.15, 0.13, 0.12]);
/**
 * Radians about +X. The TILT CLIMBS AS THE RADIUS FALLS, deliberately:
 * the outer ring lies flat and the inner one stands almost upright, so
 * five rings sharing one centre read as five angles instead of a blur —
 * and the tallest tilt is on the smallest ring, which is what keeps the
 * innermost ring's lowest point (1.28 m) clear of the 0.6 m platform
 * below it.
 */
const RING_TILTS: readonly number[] = Object.freeze([0.00, 0.42, 0.84, 1.20, 1.53]);
/** Radians about +Y, spread evenly over a half turn so no two rings share a plane. */
const RING_YAWS: readonly number[] = Object.freeze([0.00, 0.63, 1.26, 1.88, 2.51]);
/**
 * Radians a second EACH RING WOULD TURN AT if the array were running —
 * signed so neighbours turn against each other, and slower as the ring
 * gets smaller so the outer ring leads.
 *
 * The plan's own `spin` is 0 for every ring: chapter 3 leaves the array
 * stopped, and a plan describes a building, not a moment in it. This is
 * here so the thing that STARTS the array has one table to read rather
 * than five numbers of its own.
 */
export const ARRAY_SPINS: readonly number[] = Object.freeze([0.35, -0.28, 0.22, -0.18, 0.14]);

/** The array's centre sits this far above the chamber floor (ch 2). */
const ARRAY_HUB_Y = 2.6;
/** The central platform (ch 2: "a central platform"). */
const PLATFORM_RADIUS = 1.6;
const PLATFORM_HEIGHT = 0.6;
/** Six emitter pylons on a circle about the platform. */
const PYLON_COUNT = 6;
const PYLON_RING_RADIUS = 4.2;
const PYLON_RADIUS = 0.25;
const PYLON_HEIGHT = 3.0;

/**
 * How many light panels a room gets, and how many emergency lamps.
 *
 * BOTH SETS EXIST IN EVERY ROOM AT ONCE. Chapter 2 switches the building
 * from one to the other — "the room went dark... the emergency lights
 * switched on" — and a plan that only carried the set that happens to be
 * on would make the switch a thing the renderer had to invent. The
 * emergency set is always the smaller one, which is what makes the
 * change read as a loss.
 */
interface LightPlan {
  readonly cols: number;
  readonly rows: number;
  readonly emergency: number;
  /** A fitting that fills its slot rather than one that sits in the middle of it. */
  readonly strip: boolean;
}

const LIGHTING: Readonly<Record<RoomId, LightPlan>> = Object.freeze({
  laboratory: Object.freeze({ cols: 3, rows: 2, emergency: 2, strip: false }),
  // Ch 2's corridor is lit by STRIPS, not panels: `strip` makes each
  // fitting fill its slot, so a longer corridor gets longer lights rather
  // than the same six spots further apart.
  corridor: Object.freeze({ cols: 6, rows: 1, emergency: 2, strip: true }),
  control: Object.freeze({ cols: 4, rows: 2, emergency: 3, strip: false }),
  chamber: Object.freeze({ cols: 3, rows: 2, emergency: 2, strip: false }),
  utility: Object.freeze({ cols: 3, rows: 3, emergency: 2, strip: false }),
  entrance: Object.freeze({ cols: 3, rows: 2, emergency: 2, strip: false }),
});


/** Cool white, the building's own lighting. */
const NORMAL_COLOUR = 0xdfe6f2;
/** Ch 2's emergency lighting: red, and dimmer than what it replaces. */
const EMERGENCY_COLOUR = 0xff3b21;
const NORMAL_INTENSITY = 1.0;
/**
 * EARNED AT THE PROBE, not guessed. It began at 0.45 — half a normal
 * lamp, on the reasoning that emergency light is dim light — and
 * `probe:tombs` photographed a control room nobody could have worked in,
 * which is the wrong scene: chapter 2 has Jack and Sarah still at the
 * consoles after the lever, reading a boundary off a screen.
 *
 * So an emergency luminaire is BRIGHTER than a ceiling panel, and what
 * makes the room read as an emergency is that there are three of them
 * instead of eight and they are deep red — a colour whose luminance is a
 * fifth of the white one's before any intensity is applied. The darkness
 * is the AMBIENT's job (`tombs/labLook.ts`, a tenth of the normal
 * state); the lamp's job is to be a pool of light in it.
 */
const EMERGENCY_INTENSITY = 1.6;
/** A lamp carries about this many room-heights before it is not worth drawing. */
const LAMP_REACH_PER_METRE = 2.4;

/** A ceiling light panel's footprint, and how far its face hangs below the ceiling. */
const PANEL_WIDE = 1.2;
const PANEL_DEEP = 0.6;
const PANEL_THICK = 0.06;
/** How much of its slot a strip light fills, leaving a dark joint between runs. */
const STRIP_FILL = 0.8;

/** The dome an emergency lamp sits in: small, so the two sets never read as one row of fittings. */
const EMERGENCY_FITTING = vec(0.22, 0.14, 0.22);

/** Desk, console and cabinet heights, in one place so a room reads consistently. */
const DESK_HEIGHT = 0.75;
const CONSOLE_HEIGHT = 1.0;
const CHAIR = 0.55;
const CHAIR_HEIGHT = 0.9;
/** A flush wall panel: an intercom, a camera screen, a readout. */
const PANEL_SKIN = 0.08;

/** Every interaction's reach, in the 0.9-1.5 m band the contract asks for. */
const REACH_CLOSE = 0.9;
const REACH_DESK = 1.2;
const REACH_CONSOLE = 1.4;
const REACH_WALL_DISPLAY = 1.5;

// ---------------------------------------------------------------------------
// Small pure helpers, used everywhere rather than written out per fixture
// ---------------------------------------------------------------------------

/** A room's interior, resolved from its spec once so nothing re-reads a tuple. */
interface Interior {
  readonly id: RoomId;
  readonly name: string;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly ceiling: number;
}

/** Which interior wall a fixture is flush against. */
type Side = 'west' | 'east' | 'north' | 'south';

/**
 * `count` evenly spaced centres filling `from`..`to`, each with half a
 * slot of margin at either end.
 *
 * This is the one repeated-placement rule in the file: a row of ceiling
 * panels, a bank of capacitor cabinets, six camera screens and the
 * laboratory's benches are all this function with different numbers. A
 * room that grows gets its run re-spread rather than re-typed.
 */
function spread(from: number, to: number, count: number): number[] {
  const step = (to - from) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(from + (i + 0.5) * step);
  return out;
}

/** `count` points evenly round a circle on the floor plane. */
function around(cx: number, cz: number, radius: number, count: number): { readonly x: number; readonly z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    out.push({ x: cx + radius * Math.cos(angle), z: cz + radius * Math.sin(angle) });
  }
  return out;
}

/** A box standing on the floor: footprint and height, never a half-extent. */
function resting(x: number, z: number, wide: number, deep: number, tall: number): Box {
  return box(vec(x, tall / 2, z), vec(wide, tall, deep));
}

/**
 * A fixture flush against one of a room's interior walls. `along` runs
 * +Z on the west and east walls and +X on the north and south ones; `y`
 * is the fixture's CENTRE height. Flush, not floating: a panel placed by
 * eye ends up a hand's width off the wall and looks broken from inside.
 */
function against(r: Interior, side: Side, along: number, y: number, deep: number, wide: number, tall: number): Box {
  switch (side) {
    case 'west': return box(vec(r.x0 + deep / 2, y, along), vec(deep, tall, wide));
    case 'east': return box(vec(r.x1 - deep / 2, y, along), vec(deep, tall, wide));
    case 'north': return box(vec(along, y, r.z0 + deep / 2), vec(wide, tall, deep));
    case 'south': return box(vec(along, y, r.z1 - deep / 2), vec(wide, tall, deep));
  }
}

/** The middle of a room, on the floor. */
const midX = (r: Interior): number => (r.x0 + r.x1) / 2;
const midZ = (r: Interior): number => (r.z0 + r.z1) / 2;

/** Everything a plan accumulates while it is being built. */
interface Build {
  readonly slabs: Slab[];
  readonly pillars: Pillar[];
  readonly rings: Ring[];
  readonly lamps: Lamp[];
  readonly interactions: Interaction[];
}

function slab(b: Build, id: string, room: RoomId, surface: Surface, shape: Box, solid: boolean): void {
  b.slabs.push({ id, room, surface, box: shape, solid });
}

function pillar(b: Build, id: string, room: RoomId, surface: Surface, at: Vec3, radius: number, height: number, solid: boolean): void {
  b.pillars.push({ id, room, surface, at, radius, height, solid });
}

/**
 * An interaction point. The id is NAMESPACED `use:` because the layout's
 * ids are unique across everything in it and the things worth touching
 * are named after fixtures and doorways that already hold those names —
 * `outer-door` is a doorway before it is a button.
 */
function touch(b: Build, id: string, room: RoomId, at: Vec3, reach: number, doing: Doing, label: string, prompt: string): void {
  b.interactions.push({ id: `use:${id}`, room, at, reach, doing, label, prompt });
}

// ---------------------------------------------------------------------------
// The shell: floors, ceilings, and the walls the rooms leave between them
// ---------------------------------------------------------------------------

function interiorsOf(spec: LabSpec): Map<RoomId, Interior> {
  const out = new Map<RoomId, Interior>();
  for (const r of spec.rooms) {
    if (out.has(r.id)) throw new Error(`tombs plan: room '${r.id}' is specified twice`);
    if (r.x[1] <= r.x[0] || r.z[1] <= r.z[0] || r.ceiling <= 0) throw new Error(`tombs plan: room '${r.id}' has no interior`);
    out.set(r.id, { id: r.id, name: r.name, x0: r.x[0], x1: r.x[1], z0: r.z[0], z1: r.z[1], ceiling: r.ceiling });
  }
  return out;
}

/** Throws rather than returning undefined: a missing room is a broken spec, not a branch. */
function roomOf(rooms: ReadonlyMap<RoomId, Interior>, id: RoomId): Interior {
  const r = rooms.get(id);
  if (!r) throw new Error(`tombs plan: no room '${id}' in the spec`);
  return r;
}

function sortedUnique(values: readonly number[]): number[] {
  const out = [...values].sort((a, b) => a - b);
  return out.filter((v, i) => i === 0 || v !== out[i - 1]);
}

/**
 * The lattice every room edge and the shell's own edge cut the plan into.
 *
 * Each cell is either the inside of exactly one room or it is structure.
 * That is the whole trick: a wall is not placed, it is what is LEFT, so
 * a wall cannot be forgotten and two rooms cannot both claim one.
 */
interface Lattice {
  readonly xs: readonly number[];
  readonly zs: readonly number[];
  /** `(xs.length - 1) * (zs.length - 1)` cells, row-major by x then z. */
  readonly owner: readonly (RoomId | null)[];
}

function latticeOf(spec: LabSpec, rooms: ReadonlyMap<RoomId, Interior>): Lattice {
  const all = [...rooms.values()];
  const xs = sortedUnique([
    ...all.map((r) => r.x0), ...all.map((r) => r.x1),
    Math.min(...all.map((r) => r.x0)) - spec.shell, Math.max(...all.map((r) => r.x1)) + spec.shell,
  ]);
  const zs = sortedUnique([
    ...all.map((r) => r.z0), ...all.map((r) => r.z1),
    Math.min(...all.map((r) => r.z0)) - spec.shell, Math.max(...all.map((r) => r.z1)) + spec.shell,
  ]);
  const owner: (RoomId | null)[] = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < zs.length - 1; j += 1) {
      const cz = (zs[j] + zs[j + 1]) / 2;
      const found = all.find((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1);
      owner.push(found ? found.id : null);
    }
  }
  return { xs, zs, owner };
}

const cellAt = (lat: Lattice, i: number, j: number): RoomId | null => (
  i < 0 || j < 0 || i >= lat.xs.length - 1 || j >= lat.zs.length - 1 ? null : lat.owner[i * (lat.zs.length - 1) + j]
);

/**
 * How tall a piece of structure stands, and which room it serves.
 *
 * BOTH COME FROM THE ROOMS AROUND IT — the eight cells touching this one,
 * edge and corner. A wall between the 7 m chamber and the 3.2 m control
 * room is 7 m tall because the chamber is, not because a table says 7.
 * The tie-break is the spec's own room order, so the answer does not
 * depend on how a Map happens to iterate.
 */
function servedBy(lat: Lattice, rooms: ReadonlyMap<RoomId, Interior>, i: number, j: number, tallest: Interior): Interior {
  let best: Interior | null = null;
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      const id = cellAt(lat, i + di, j + dj);
      if (id === null) continue;
      const r = roomOf(rooms, id);
      if (best === null || r.ceiling > best.ceiling) best = r;
    }
  }
  // A cell with no room anywhere near it cannot happen in a connected
  // building, but a spec is a spec: fall back to the tallest room rather
  // than to a zero-height wall somebody would have to debug.
  return best ?? tallest;
}

/** One merged run of structure cells: a rectangle of wall, before it is cut. */
interface WallRect {
  readonly id: string;
  readonly room: RoomId;
  readonly box: Box;
}

/**
 * Merge the structure cells into the largest rectangles that agree on
 * height AND on which room they serve — horizontally first, then down
 * the rows. The merge is greedy and walks the lattice in index order, so
 * it is the same every time; it exists because a 26 m outer wall drawn
 * as seven abutting boxes is seven draw calls and seven chances for a
 * seam to show.
 */
function wallRects(spec: LabSpec, lat: Lattice, rooms: ReadonlyMap<RoomId, Interior>): WallRect[] {
  const all = [...rooms.values()];
  const tallest = all.reduce((a, r) => (r.ceiling > a.ceiling ? r : a), all[0]);
  interface Run { i0: number; i1: number; j0: number; j1: number; room: RoomId; top: number }
  const open = new Map<string, Run>();
  const runs: Run[] = [];
  for (let j = 0; j < lat.zs.length - 1; j += 1) {
    let i = 0;
    while (i < lat.xs.length - 1) {
      if (cellAt(lat, i, j) !== null) { i += 1; continue; }
      const served = servedBy(lat, rooms, i, j, tallest);
      let end = i + 1;
      while (end < lat.xs.length - 1 && cellAt(lat, end, j) === null) {
        const next = servedBy(lat, rooms, end, j, tallest);
        if (next.id !== served.id) break;
        end += 1;
      }
      // The wall rises past its room's ceiling slab, so the slab tucks into it.
      const top = served.ceiling + spec.ceiling;
      const key = `${i}:${end}:${served.id}:${top}`;
      const above = open.get(key);
      if (above && above.j1 === j) above.j1 = j + 1;
      else {
        const run: Run = { i0: i, i1: end, j0: j, j1: j + 1, room: served.id, top };
        open.set(key, run);
        runs.push(run);
      }
      i = end;
    }
  }
  return runs.map((run) => ({
    id: `wall:${run.room}:${run.i0}-${run.j0}`,
    room: run.room,
    box: spanning(vec(lat.xs[run.i0], -spec.floor, lat.zs[run.j0]), vec(lat.xs[run.i1], run.top, lat.zs[run.j1])),
  }));
}

/**
 * Cut one opening out of one box: left of it, right of it, under it and
 * over it, whichever of those have any size. The opening always goes
 * clean THROUGH — its extent on the `axis` is the box's own — because a
 * doorway that stopped halfway into a wall would be a hole from one side
 * and a wall from the other.
 */
function cutBox(b: Box, axis: 'x' | 'z', a0: number, a1: number, y0: number, y1: number): Box[] {
  const lo = minOf(b);
  const hi = maxOf(b);
  const from = axis === 'z' ? lo.x : lo.z;
  const to = axis === 'z' ? hi.x : hi.z;
  const c0 = Math.max(a0, from);
  const c1 = Math.min(a1, to);
  const d0 = Math.max(y0, lo.y);
  const d1 = Math.min(y1, hi.y);
  if (c0 >= c1 || d0 >= d1) return [b];
  const piece = (p0: number, p1: number, q0: number, q1: number): Box => (axis === 'z'
    ? spanning(vec(p0, q0, lo.z), vec(p1, q1, hi.z))
    : spanning(vec(lo.x, q0, p0), vec(hi.x, q1, p1)));
  const out: Box[] = [];
  if (from < c0) out.push(piece(from, c0, lo.y, hi.y));
  if (c1 < to) out.push(piece(c1, to, lo.y, hi.y));
  if (lo.y < d0) out.push(piece(c0, c1, lo.y, d0));
  if (d1 < hi.y) out.push(piece(c0, c1, d1, hi.y));
  return out;
}

/** Does this opening pierce this box? Strictly inside, so it cuts exactly one wall. */
function pierces(o: OpeningSpec, b: Box): boolean {
  const lo = minOf(b);
  const hi = maxOf(b);
  const through = o.through === 'z' ? [lo.z, hi.z] : [lo.x, hi.x];
  const along = o.through === 'z' ? [lo.x, hi.x] : [lo.z, hi.z];
  return o.at > through[0] && o.at < through[1]
    && o.along + o.width / 2 > along[0] && o.along - o.width / 2 < along[1]
    && o.sill + o.height > lo.y && o.sill < hi.y;
}

/** The aperture an opening leaves in a wall of this through-extent. */
function apertureIn(o: OpeningSpec, b: Box): Box {
  const lo = minOf(b);
  const hi = maxOf(b);
  const a0 = o.along - o.width / 2;
  const a1 = o.along + o.width / 2;
  return o.through === 'z'
    ? spanning(vec(a0, o.sill, lo.z), vec(a1, o.sill + o.height, hi.z))
    : spanning(vec(lo.x, o.sill, a0), vec(hi.x, o.sill + o.height, a1));
}

/**
 * Floors, ceilings, walls, the glass in the reinforced port and the
 * frames around every opening.
 */
function shellOf(b: Build, spec: LabSpec, rooms: ReadonlyMap<RoomId, Interior>): void {
  for (const r of rooms.values()) {
    slab(b, `floor:${r.id}`, r.id, 'floor', spanning(vec(r.x0, -spec.floor, r.z0), vec(r.x1, 0, r.z1)), true);
    slab(b, `ceiling:${r.id}`, r.id, 'ceiling', spanning(vec(r.x0, r.ceiling, r.z0), vec(r.x1, r.ceiling + spec.ceiling, r.z1)), true);
  }
  // An opening pierces exactly one wall rectangle, and its trim is emitted
  // once. The guard is not decoration: a spec whose opening straddled two
  // merged rectangles would otherwise emit two jambs with one id.
  const trimmed = new Set<string>();
  for (const rect of wallRects(spec, latticeOf(spec, rooms), rooms)) {
    let pieces: Box[] = [rect.box];
    for (const o of spec.openings) {
      if (!pierces(o, rect.box)) continue;
      const cut: Box[] = [];
      for (const p of pieces) {
        cut.push(...(pierces(o, p)
          ? cutBox(p, o.through, o.along - o.width / 2, o.along + o.width / 2, o.sill, o.sill + o.height)
          : [p]));
      }
      pieces = cut;
      if (!trimmed.has(o.id)) {
        trimmed.add(o.id);
        openingTrim(b, o, apertureIn(o, rect.box));
      }
    }
    pieces.forEach((piece, n) => {
      slab(b, pieces.length === 1 ? rect.id : `${rect.id}:${n}`, rect.room, 'wall', piece, true);
    });
  }
}

/**
 * What fills an opening once the wall is cut: two jambs and a lintel for
 * anything, and for the reinforced port the glass itself.
 *
 * The glass is SOLID. `types.ts` says a solid is a solid for everyone,
 * and the one place that rule earns its keep is here — the control room
 * looks into the chamber and nobody walks into it (ch 2).
 */
function openingTrim(b: Build, o: OpeningSpec, aperture: Box): void {
  const lo = minOf(aperture);
  const hi = maxOf(aperture);
  if (o.kind === 'port') {
    slab(b, o.id, o.from, 'glass', aperture, true);
    return;
  }
  const jamb = 0.06;
  // The lintel spans BETWEEN the jambs rather than over them: three pieces
  // that meet at a face, not three that share two corners.
  if (o.through === 'z') {
    slab(b, `${o.id}:jamb-west`, o.from, 'accent', spanning(vec(lo.x, lo.y, lo.z), vec(lo.x + jamb, hi.y, hi.z)), false);
    slab(b, `${o.id}:jamb-east`, o.from, 'accent', spanning(vec(hi.x - jamb, lo.y, lo.z), vec(hi.x, hi.y, hi.z)), false);
    slab(b, `${o.id}:lintel`, o.from, 'accent', spanning(vec(lo.x + jamb, hi.y - jamb, lo.z), vec(hi.x - jamb, hi.y, hi.z)), false);
  } else {
    slab(b, `${o.id}:jamb-north`, o.from, 'accent', spanning(vec(lo.x, lo.y, lo.z), vec(hi.x, hi.y, lo.z + jamb)), false);
    slab(b, `${o.id}:jamb-south`, o.from, 'accent', spanning(vec(lo.x, lo.y, hi.z - jamb), vec(hi.x, hi.y, hi.z)), false);
    slab(b, `${o.id}:lintel`, o.from, 'accent', spanning(vec(lo.x, hi.y - jamb, lo.z + jamb), vec(hi.x, hi.y, hi.z - jamb)), false);
  }
}

// ---------------------------------------------------------------------------
// Lighting: both sets, in every room, at once
// ---------------------------------------------------------------------------

/**
 * A lamp AND the fixture you see it in — one object, because they are
 * one thing. The plan sizes the fixture because the plan knows the room;
 * `tombs/LabView` draws it and darkens it with the lever. Neither emits
 * a slab for it: a lamp that were both a slab and a fitting would be
 * drawn twice and only half of it would obey the lever, which is exactly
 * the bug this shape was introduced to close.
 */
function lamp(b: Build, id: string, room: RoomId, at: Vec3, mode: LightMode, ceiling: number, fitting: Vec3): void {
  const lit: Lamp = {
    id,
    room,
    at,
    mode,
    colour: mode === 'normal' ? NORMAL_COLOUR : EMERGENCY_COLOUR,
    intensity: mode === 'normal' ? NORMAL_INTENSITY : EMERGENCY_INTENSITY,
    reach: ceiling * LAMP_REACH_PER_METRE,
    fitting,
  };
  b.lamps.push(lit);
}

function lightsOf(b: Build, r: Interior): void {
  const plan = LIGHTING[r.id];
  const wide = plan.strip ? ((r.x1 - r.x0) / plan.cols) * STRIP_FILL : PANEL_WIDE;
  let n = 0;
  const panel = vec(wide, PANEL_THICK, PANEL_DEEP);
  for (const x of spread(r.x0, r.x1, plan.cols)) {
    for (const z of spread(r.z0, r.z1, plan.rows)) {
      n += 1;
      lamp(b, `lamp:${r.id}:normal:${n}`, r.id, vec(x, r.ceiling - PANEL_THICK / 2, z), 'normal', r.ceiling, panel);
    }
  }
  // Ch 2: fewer, dimmer and red. High on the wall line rather than in the
  // ceiling grid, so the two sets never read as one row of fittings.
  spread(r.x0, r.x1, plan.emergency).forEach((x, i) => {
    const at = vec(x, r.ceiling - 0.3, midZ(r));
    lamp(b, `lamp:${r.id}:emergency:${i + 1}`, r.id, at, 'emergency', r.ceiling, EMERGENCY_FITTING);
  });
}

// ---------------------------------------------------------------------------
// What the rooms hold. Every fixture below is the manuscript's unless a
// comment says it is ours, and the chapter is named where it comes from.
// ---------------------------------------------------------------------------

/**
 * A workstation: the desk, the monitor over it, the keyboard shelf on it
 * and the wheeled chair behind it.
 *
 * One function, used four times, because chapter 1 turns on there being
 * MORE THAN ONE of them — Jack's chair "rolled backward and nearly
 * struck another workstation", which is only true if the second one is
 * a chair's length away, and that spacing is a number here rather than a
 * coincidence between two hand-placed boxes.
 */
function workstation(b: Build, r: Interior, id: string, x: number, z: number, wide: number, chairZ: number, chairX: number): void {
  const deep = 0.8;
  slab(b, `${id}:desk`, r.id, 'desk', resting(x, z, wide, deep, DESK_HEIGHT), true);
  slab(b, `${id}:monitor`, r.id, 'screen',
    box(vec(x, DESK_HEIGHT + 0.33, z - deep / 2 + 0.12), vec(0.62, 0.46, 0.05)), false);
  slab(b, `${id}:keyboard`, r.id, 'desk',
    box(vec(x, DESK_HEIGHT + 0.015, z + deep / 2 - 0.16), vec(0.62, 0.03, 0.22)), false);
  slab(b, `${id}:chair`, r.id, 'panel', resting(chairX, chairZ, CHAIR, CHAIR, CHAIR_HEIGHT), true);
}

/** Jack's laboratory (ch 1), and the far end Sarah turns toward (ch 2). */
function laboratoryFit(b: Build, r: Interior, aisleX: number): void {
  // Ch 1 opens at Jack's desk against the north wall, with the sliding
  // door beyond it. Sarah's is 2.0 m south of his — a chair's roll away.
  const jackZ = r.z0 + 0.8;
  const sarahZ = jackZ + 2.0;
  workstation(b, r, 'jack-workstation', aisleX, jackZ, 1.8, jackZ + 0.9, aisleX);
  workstation(b, r, 'sarah-workstation', aisleX, sarahZ, 1.6, sarahZ, aisleX + 1.4);
  // "another workstation" is not the only other one: the room is a
  // laboratory, and two more stand at the west end.
  const westX = r.x0 + 2.5;
  workstation(b, r, 'west-workstation-1', westX, r.z0 + 1.6, 1.6, r.z0 + 2.5, westX);
  workstation(b, r, 'west-workstation-2', westX, r.z0 + 4.1, 1.6, r.z0 + 5.0, westX);

  // Ch 1: "He reached for the intercom." By the door, at a standing height.
  slab(b, 'lab-intercom:panel', r.id, 'panel',
    against(r, 'east', r.z0 + 0.5, 1.4, PANEL_SKIN, 0.25, 0.3), false);

  // THE FAR END (ch 2): benches, then the sample cabinets Sarah turns
  // toward. Both runs are spread, so a longer room gets a longer bench
  // rather than a gap at the end of it.
  spread(r.z0 + 0.4, r.z0 + 4.0, 2).forEach((z, i) => {
    slab(b, `lab-bench-${i + 1}`, r.id, 'desk', against(r, 'west', z, 0.45, 0.7, 1.7, 0.9), true);
  });
  spread(r.z0 + 4.2, r.z1 - 0.1, 2).forEach((z, i) => {
    slab(b, `sample-cabinet-${i + 1}`, r.id, 'panel', against(r, 'west', z, 1.0, 0.7, 1.0, 2.0), true);
  });

  touch(b, 'jack-workstation', r.id, vec(aisleX, DESK_HEIGHT + 0.33, jackZ), REACH_DESK, 'read',
    "Jack's workstation", 'Read the diagnostic data');
  touch(b, 'sarah-workstation', r.id, vec(aisleX, DESK_HEIGHT + 0.33, sarahZ), REACH_DESK, 'read',
    "Sarah's workstation", 'Read the run log');
  touch(b, 'lab-intercom', r.id, vec(r.x1 - PANEL_SKIN / 2, 1.4, r.z0 + 0.5), REACH_CLOSE, 'speak',
    'Laboratory intercom', 'Call Sarah');
}

/** The corridor from the laboratory to the main control room (ch 2). */
function corridorFit(b: Build, r: Interior): void {
  // Ch 2: "another alarm sounded overhead". One beacon, over the middle —
  // a lamp whose fitting IS the beacon, so it goes red with the set
  // rather than sitting there as a dead lump beside a light.
  const beaconAt = vec(midX(r), r.ceiling - 0.25, r.z0 + 0.5);
  lamp(b, 'lamp:corridor:emergency:beacon', r.id, beaconAt, 'emergency', r.ceiling, vec(0.3, 0.22, 0.3));
  // The cable tray the corridor carries the building's signals in. Ours:
  // the manuscript walks the corridor, it does not describe its ceiling.
  slab(b, 'corridor-cable-tray', r.id, 'metal',
    spanning(vec(r.x0, r.ceiling - 0.35, r.z1 - 0.65), vec(r.x1, r.ceiling - 0.25, r.z1 - 0.35)), true);
}

/** The main control room (ch 2, ch 3). */
function controlFit(b: Build, r: Interior): void {
  const deskZ = r.z0 + 1.2;
  // Ch 2, ch 3: the primary console, facing north at the port.
  const primaryX = midX(r) - 1.5;
  slab(b, 'primary-console', r.id, 'panel', resting(primaryX, deskZ, 2.4, 0.9, CONSOLE_HEIGHT), true);
  // Ch 2: the emitter controls, set into the primary console's top.
  slab(b, 'emitter-controls', r.id, 'readout',
    box(vec(primaryX, CONSOLE_HEIGHT + 0.015, deskZ), vec(1.8, 0.03, 0.6)), false);
  // Ch 3: "Sarah moved to the secondary console."
  const secondaryX = midX(r) + 2.0;
  slab(b, 'secondary-console', r.id, 'panel', resting(secondaryX, deskZ, 2.0, 0.9, CONSOLE_HEIGHT), true);
  slab(b, 'secondary-readout', r.id, 'readout',
    box(vec(secondaryX, CONSOLE_HEIGHT + 0.015, deskZ), vec(1.5, 0.03, 0.6)), false);

  // Ch 2: "Jack opened the emergency panel", and then "he pulled the
  // physical shutdown lever". The lever stands proud of the panel's face,
  // which is what makes it a thing to pull rather than a thing to press.
  const panelZ = r.z0 + 2.6;
  slab(b, 'emergency-panel', r.id, 'panel', against(r, 'west', panelZ, 1.3, 0.15, 0.6, 0.8), false);
  slab(b, 'shutdown-lever', r.id, 'accent',
    box(vec(r.x0 + 0.21, 1.15, panelZ), vec(0.12, 0.5, 0.12)), false);

  // Ch 2: the settlement perimeter feeds. Six, numbered, two rows of three.
  let feed = 0;
  for (const y of [1.78, 2.22]) {
    for (const z of spread(r.z0 + 0.8, r.z0 + 4.4, 3)) {
      feed += 1;
      slab(b, `camera-screen-${feed}`, r.id, 'screen', against(r, 'east', z, y, 0.07, 0.84, 0.36), false);
    }
  }
  // Ch 2: the structural monitor, beside the camera bank.
  slab(b, 'structural-monitor', r.id, 'screen', against(r, 'east', r.z1 - 0.8, 2.0, 0.07, 0.8, 0.6), false);
  // Ch 2: the mapping controls — this is where the red boundary is drawn.
  const mapX = midX(r) - 4.0;
  slab(b, 'map-display', r.id, 'readout', against(r, 'south', mapX, 1.8, 0.06, 2.4, 1.4), false);
  const intercomX = midX(r) + 3.0;
  slab(b, 'control-intercom', r.id, 'panel', against(r, 'south', intercomX, 1.4, PANEL_SKIN, 0.25, 0.3), false);

  touch(b, 'primary-console', r.id, vec(primaryX, CONSOLE_HEIGHT, deskZ), REACH_CONSOLE, 'read',
    'Primary console', 'Read the array status');
  touch(b, 'secondary-console', r.id, vec(secondaryX, CONSOLE_HEIGHT, deskZ), REACH_CONSOLE, 'read',
    'Secondary console', 'Read the power draw');
  touch(b, 'emergency-panel', r.id, vec(r.x0 + 0.15, 1.3, panelZ), REACH_CLOSE, 'open',
    'Emergency panel', 'Open the emergency panel');
  touch(b, 'shutdown-lever', r.id, vec(r.x0 + 0.27, 1.15, panelZ), REACH_CLOSE, 'pull',
    'Physical shutdown lever', 'Pull the physical shutdown lever');
  touch(b, 'map-display', r.id, vec(mapX, 1.8, r.z1 - 0.06), REACH_WALL_DISPLAY, 'read',
    'Mapping controls', 'Pull up the island map');
  touch(b, 'control-intercom', r.id, vec(intercomX, 1.4, r.z1 - PANEL_SKIN / 2), REACH_CLOSE, 'speak',
    'Control room intercom', 'Call the laboratory');
}

/** The array chamber (ch 2). */
function chamberFit(b: Build, r: Interior): void {
  const cx = midX(r);
  const cz = midZ(r);
  // A steel grating over the chamber's slab. NOT solid: the floor beneath
  // it is what stops a body, and a 60 mm deck is not a step to climb.
  slab(b, 'chamber-grating', r.id, 'metal', spanning(vec(r.x0, 0, r.z0), vec(r.x1, 0.06, r.z1)), false);
  // Ch 2: "At its center stood the TOMBS Array... Several articulated
  // rings surrounded a central platform."
  pillar(b, 'array-platform', r.id, 'metal', vec(cx, 0, cz), PLATFORM_RADIUS, PLATFORM_HEIGHT, true);
  for (let i = 0; i < RING_RADII.length; i += 1) {
    b.rings.push({
      id: `array-ring-${i + 1}`,
      at: vec(cx, ARRAY_HUB_Y, cz),
      radius: RING_RADII[i],
      tube: RING_TUBES[i],
      tilt: RING_TILTS[i],
      yaw: RING_YAWS[i],
      // Ch 3 leaves the array stopped. `ARRAY_SPINS` holds what these
      // would be if something started it.
      spin: 0,
    });
  }
  around(cx, cz, PYLON_RING_RADIUS, PYLON_COUNT).forEach((p, i) => {
    pillar(b, `emitter-pylon-${i + 1}`, r.id, 'metal', vec(p.x, 0, p.z), PYLON_RADIUS, PYLON_HEIGHT, true);
  });
  // Warning stripes round the platform: a painted square, not a fence.
  const edge = PLATFORM_RADIUS + 0.7;
  const band = 0.1;
  const stripe = (id: string, shape: Box): void => slab(b, id, r.id, 'accent', shape, false);
  stripe('array-stripe-north', spanning(vec(cx - edge, 0.06, cz - edge - band), vec(cx + edge, 0.08, cz - edge)));
  stripe('array-stripe-south', spanning(vec(cx - edge, 0.06, cz + edge), vec(cx + edge, 0.08, cz + edge + band)));
  stripe('array-stripe-west', spanning(vec(cx - edge - band, 0.06, cz - edge), vec(cx - edge, 0.08, cz + edge)));
  stripe('array-stripe-east', spanning(vec(cx + edge, 0.06, cz - edge), vec(cx + edge + band, 0.08, cz + edge)));

  touch(b, 'array-platform', r.id, vec(cx, PLATFORM_HEIGHT, cz), REACH_WALL_DISPLAY, 'read',
    'TOMBS Array', 'Look over the array');
}

/** The building's plant: everything chapter 2 asks the power question of. */
function utilityFit(b: Build, r: Interior): void {
  // Ch 2: the backup capacitors — "Not enough for this."
  spread(r.z0 + 1.0, r.z1 - 2.0, 6).forEach((z, i) => {
    slab(b, `capacitor-bank-${i + 1}`, r.id, 'panel', against(r, 'east', z, 1.1, 0.8, 1.2, 2.2), true);
  });
  // Ch 2: the internal reactor — "Offline."
  pillar(b, 'reactor-housing', r.id, 'metal', vec(midX(r), 0, midZ(r) - 4.0), 1.6, 3.2, true);
  // Ch 2: the island grid feed, which is what Lena cuts.
  slab(b, 'grid-feed', r.id, 'panel', against(r, 'north', r.x0 + 2.6, 1.0, 0.7, 1.6, 2.0), true);
  // Conduit runs under the ceiling, clear of the reactor's 3.2 m housing.
  spread(r.z0 + 1.0, r.z1 - 1.0, 4).forEach((z, i) => {
    slab(b, `utility-conduit-${i + 1}`, r.id, 'metal',
      spanning(vec(r.x0, r.ceiling - 0.45, z - 0.08), vec(r.x1, r.ceiling - 0.29, z + 0.08)), true);
  });
  // Two structural columns: the plant is the widest span in the building.
  [r.x0 + 3.1, r.x1 - 3.5].forEach((x, i) => {
    pillar(b, `utility-column-${i + 1}`, r.id, 'metal', vec(x, 0, midZ(r) + 3.0), 0.3, r.ceiling, true);
  });

  touch(b, 'reactor-housing', r.id, vec(midX(r) - 1.8, 1.4, midZ(r) - 4.0), REACH_CONSOLE, 'read',
    'Reactor housing', 'Read the reactor status');
}

/**
 * The way in from the island. OURS, not the manuscript's — chapter 1
 * never walks in from outside, and the player has to.
 */
function entranceFit(b: Build, r: Interior, outer: OpeningSpec): void {
  spread(r.x0 + 7.0, r.x1 - 1.6, 5).forEach((x, i) => {
    slab(b, `locker-${i + 1}`, r.id, 'panel', against(r, 'north', x, 1.0, 0.55, 0.7, 2.0), true);
  });
  slab(b, 'entrance-bench', r.id, 'desk', resting(midX(r) + 2.3, r.z0 + 1.8, 2.0, 0.5, 0.45), true);

  // A decontamination frame standing INSIDE the outer door, derived from
  // the door rather than typed next to it: move the door and the frame
  // follows it.
  const frameZ = r.z1 - 0.2;
  const jamb = outer.width / 2 + 0.15;
  slab(b, 'decon-frame-west', r.id, 'accent', resting(outer.along - jamb, frameZ, 0.3, 0.3, 2.7), true);
  slab(b, 'decon-frame-east', r.id, 'accent', resting(outer.along + jamb, frameZ, 0.3, 0.3, 2.7), true);
  slab(b, 'decon-frame-head', r.id, 'accent',
    spanning(vec(outer.along - jamb - 0.15, 2.7, frameZ - 0.15), vec(outer.along + jamb + 0.15, r.ceiling, frameZ + 0.15)), true);
  const controlX = outer.along + outer.width / 2 + 0.6;
  slab(b, 'outer-door-control', r.id, 'accent', against(r, 'south', controlX, 1.2, PANEL_SKIN, 0.2, 0.3), false);

  touch(b, 'outer-door', r.id, vec(controlX, 1.2, r.z1 - PANEL_SKIN / 2), REACH_DESK, 'open',
    'Outer door', 'Open the outer door');
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** The one opening that leads off the site. Throws: a building with no way out is a bug. */
function wayOut(spec: LabSpec): OpeningSpec {
  const out = spec.openings.find((o) => o.to === null);
  if (!out) throw new Error('tombs plan: the building has no opening to the island');
  return out;
}

/**
 * Expand a specification into the whole building.
 *
 * PURE AND DETERMINISTIC: nothing here reads a clock, a random number or
 * a global. Called twice with the same spec it returns two structurally
 * identical layouts, which is what lets the layout be compared, cached,
 * hashed or agreed on between a phone and an authority.
 */
export function planLab(spec: LabSpec = LAB_SPEC): LabLayout {
  const rooms = interiorsOf(spec);
  const b: Build = { slabs: [], pillars: [], rings: [], lamps: [], interactions: [] };

  shellOf(b, spec, rooms);

  // The laboratory's workstation row runs along the SPAWN's own axis, so
  // chapter 1's opening shot — Jack's desk ahead, the sliding door beyond
  // it — survives a change to the room's size.
  laboratoryFit(b, roomOf(rooms, 'laboratory'), spec.spawn.at.x);
  corridorFit(b, roomOf(rooms, 'corridor'));
  controlFit(b, roomOf(rooms, 'control'));
  chamberFit(b, roomOf(rooms, 'chamber'));
  utilityFit(b, roomOf(rooms, 'utility'));
  entranceFit(b, roomOf(rooms, 'entrance'), wayOut(spec));

  for (const r of rooms.values()) lightsOf(b, r);

  // A port is not a doorway: nobody walks through the glass, so it is not
  // an edge of the room graph and it is not in this list.
  const doorways: Doorway[] = spec.openings
    .filter((o) => o.kind === 'doorway')
    .map((o) => ({
      id: o.id,
      from: o.from,
      to: o.to,
      at: o.through === 'z' ? vec(o.along, o.sill, o.at) : vec(o.at, o.sill, o.along),
      width: o.width,
      height: o.height,
      sliding: o.sliding,
    }));

  const roomList: Room[] = [...rooms.values()].map((r) => ({
    id: r.id,
    name: r.name,
    inside: spanning(vec(r.x0, 0, r.z0), vec(r.x1, r.ceiling, r.z1)),
  }));

  const bounds = union([
    ...b.slabs.map((s) => s.box),
    ...b.pillars.map((p) => box(vec(p.at.x, p.at.y + p.height / 2, p.at.z), vec(p.radius * 2, p.height, p.radius * 2))),
  ]);

  return Object.freeze({
    rooms: Object.freeze(roomList),
    slabs: Object.freeze(b.slabs),
    pillars: Object.freeze(b.pillars),
    rings: Object.freeze(b.rings),
    lamps: Object.freeze(b.lamps),
    doorways: Object.freeze(doorways),
    interactions: Object.freeze(b.interactions),
    spawn: Object.freeze({ at: spec.spawn.at, yaw: spec.spawn.yaw }),
    bounds,
  });
}
