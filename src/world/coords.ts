/**
 * WHERE THINGS ARE — the authoritative answer, and the rendered one.
 *
 * These are TWO CONCEPTS and they must never be confused, so they are
 * two types with different field names AND different brands. You cannot
 * pass one where the other is expected, and every call site says which
 * it means.
 *
 *   WorldPoint  { wx, wz }   MACRO. Authoritative. Persistent.
 *   LocalPoint  { lx, lz }   Rendered. Temporary. Meaningless alone.
 *
 * THE RULE. Anything that outlives a frame is addressed in WORLD
 * coordinates: nests, players, creatures, food sites, death markers,
 * saved objects, and every position that will one day cross a network.
 * A LocalPoint is a rendering artefact — it is measured from a floating
 * origin that moves as the ant walks, so the same LocalPoint means a
 * different place ten seconds later. Storing one as if it were a
 * location is a bug that will not show up until something is reloaded
 * or two players compare notes.
 *
 * The floating origin (origin.ts) is a TRANSFORM into render space. It
 * is not the location system and nothing should ask it where anything
 * is.
 *
 * WHY THE TYPES, rather than a comment saying "be careful": going to
 * true scale in v0 produced four bugs in one afternoon and every one was
 * this mistake. A camera clamped its height against its own rendered
 * position and sat two kilometres up a mountain. A ground readout did
 * the same. A texture tiled off rendered position and would have slid
 * sideways on every origin shift. And the height API took bare numbers,
 * so nothing stopped a rendered value going in where a world one
 * belonged. Convention did not survive one change; different field
 * names do — and in v1 the brand goes further: a bare `{wx, wz}` literal
 * is not a WorldPoint either. Every point is made by `world()` or
 * `local()`, so the one place a coordinate enters the type system is a
 * place a reader can find.
 *
 * CHUNKS ARE GLOBAL. A chunk's identity comes from world coordinates
 * alone, so moving the origin cannot change what terrain — or what
 * anything else — belongs where. That is what lets the same ground be
 * generated identically on two devices, after a reload, or a week
 * later, and it is why chunk addressing lives here with the
 * authoritative coordinates rather than next to the renderer.
 *
 * Pure: no three, no DOM. This is the vocabulary every core module
 * shares, and it must be loadable on a headless authority.
 */

/**
 * The island at TRUE SCALE, in world units — one unit is a centimetre
 * to terrain and ant alike, so real Kauaʻi is 5,600,000 units across.
 * Lives here rather than with the terrain because it bounds every
 * persisted WorldPoint: a save that claims a position outside the island
 * is refused, and the session can check that without loading a DEM.
 */
export const ISLAND_SPAN = 5_600_000;

declare const WORLD_BRAND: unique symbol;
declare const LOCAL_BRAND: unique symbol;

/** MACRO position. Authoritative, persistent, safe to save and send. */
export interface WorldPoint {
  readonly wx: number;
  readonly wz: number;
  /** Phantom — never present at runtime. Makes a bare literal not a WorldPoint. */
  readonly [WORLD_BRAND]: 'world';
}

/**
 * Rendered position, measured from the floating origin.
 *
 * Valid for exactly as long as the origin does not move. Never store
 * one, never persist one, never send one.
 */
export interface LocalPoint {
  readonly lx: number;
  readonly lz: number;
  /** Phantom — never present at runtime. Makes a LocalPoint unassignable to a WorldPoint. */
  readonly [LOCAL_BRAND]: 'local';
}

/** The one door into WorldPoint. The cast is the brand's whole runtime cost: none. */
export function world(wx: number, wz: number): WorldPoint {
  return { wx, wz } as WorldPoint;
}

/** The one door into LocalPoint. */
export function local(lx: number, lz: number): LocalPoint {
  return { lx, lz } as LocalPoint;
}

/** A point some distance away, in world units, on the same plane. */
export function translate(at: WorldPoint, dx: number, dz: number): WorldPoint {
  return world(at.wx + dx, at.wz + dz);
}

export function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = b.wx - a.wx;
  const dz = b.wz - a.wz;
  return dx * dx + dz * dz;
}

/** Horizontal distance in world units. Heights are somebody else's axis. */
export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function samePoint(a: WorldPoint, b: WorldPoint): boolean {
  return a.wx === b.wx && a.wz === b.wz;
}

/**
 * The nearest point on a lattice of `step` world units, on both axes.
 *
 * The operation behind every window that has to move in jumps rather
 * than follow something continuously — the floating origin does it to
 * itself, and the terrain clipmap does it per ring. Here rather than in
 * either of them so that a renderer can snap without reading `.wx` and
 * doing the arithmetic by hand, which is the mistake the two point types
 * exist to prevent.
 */
export function snapTo(at: WorldPoint, step: number): WorldPoint {
  if (!(step > 0)) return at;
  return world(Math.round(at.wx / step) * step, Math.round(at.wz / step) * step);
}

// ---------------------------------------------------------------------------
// Which way is north
// ---------------------------------------------------------------------------

/**
 * A COMPASS BEARING IS NOT A HEADING, and printing one as the other is a
 * mirrored compass.
 *
 * Joshua, from the device, 2026-09-05: "the heading 'degrees °' is
 * backwards on the display meaning going clockwise should add not
 * subtract." He is right, and the readout was wrong in a way that hid
 * itself — it agreed with a real compass at east and west and was a full
 * half-turn out at north and south, which is exactly what a mirrored
 * compass looks like.
 *
 * TWO FACTS MEET HERE, and neither file owns both, which is why the
 * conversion lives in this one:
 *
 *   1. `+wx is EAST and +wz is SOUTH` (`world/dem.ts`, matching the
 *      survey's own column and row order). So NORTH is -wz.
 *   2. An actor's heading `h` means ahead is `(sin h, cos h)`
 *      (`actor/Transform.ts`). So h = 0 points at +wz, which is SOUTH.
 *
 * Put together: h = 0 is a bearing of 180, h = 90° is east (90), h = 180°
 * is north (0), h = 270° is west (270). That is `180 - h`, and the minus
 * sign is the whole bug — a heading turns anticlockwise as it grows,
 * because it is a rotation about +y, while a bearing turns clockwise,
 * because that is what a compass rose is.
 *
 * A HEADING IS STILL THE ONLY THING STORED, SENT OR STEPPED. This is a
 * presentation conversion and nothing else reads it: no save, no wire
 * message and no movement changes meaning. Flipping the sign inside
 * `headingOfYaw` instead would have turned every capsule on the wire
 * around, which is a bug this project has already had once.
 */
export function compassBearing(heading: number): number {
  const degrees = Math.round((heading * 180) / Math.PI);
  // Round BEFORE wrapping: rounding after would let 359.6 print as 360.
  return ((180 - degrees) % 360 + 360) % 360;
}

/** How wide a chunk is, in world units. */
export const CHUNK_SPAN = 512;

/**
 * A chunk's address. Integers, derived from world position only.
 *
 * The unit of streaming and the natural unit of persistence: what lives
 * in a chunk can be saved, loaded and simulated with it, and two
 * machines that agree on the address agree on the contents.
 */
export interface ChunkId {
  readonly cx: number;
  readonly cz: number;
}

export function chunkAt(at: WorldPoint): ChunkId {
  return {
    cx: Math.floor(at.wx / CHUNK_SPAN),
    cz: Math.floor(at.wz / CHUNK_SPAN),
  };
}

/** The world position of a chunk's corner — where its contents begin. */
export function chunkOrigin(id: ChunkId): WorldPoint {
  return world(id.cx * CHUNK_SPAN, id.cz * CHUNK_SPAN);
}

/** A stable string address, for maps and for anything stored by chunk. */
export function chunkKey(id: ChunkId): string {
  return `${id.cx},${id.cz}`;
}

export function sameChunk(a: ChunkId, b: ChunkId): boolean {
  return a.cx === b.cx && a.cz === b.cz;
}
