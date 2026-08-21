/**
 * WHERE THINGS ARE — the authoritative answer, and the rendered one.
 *
 * These are TWO CONCEPTS and they must never be confused, so they are
 * two types with different field names. You cannot pass one where the
 * other is expected, and every call site says which it means.
 *
 *   WorldPoint  { wx, wz }   MACRO. Authoritative. Persistent.
 *   LocalPoint  { lx, lz }   Rendered. Temporary. Meaningless alone.
 *
 * THE RULE. Anything that outlives a frame is addressed in WORLD
 * coordinates: nests, players, creatures, food sites, death markers,
 * saved objects, and every position that will one day cross a network.
 * A LocalPoint is a rendering artefact — it is measured from a floating
 * origin that moves as she walks, so the same LocalPoint means a
 * different place ten seconds later. Storing one as if it were a
 * location is a bug that will not show up until something is reloaded
 * or two players compare notes.
 *
 * The floating origin (origin.ts) is a TRANSFORM into render space. It
 * is not the location system and nothing should ask it where anything
 * is.
 *
 * WHY THE TYPES, rather than a comment saying "be careful": going to
 * true scale produced four bugs in one afternoon and every one was this
 * mistake. A camera clamped its height against its own rendered
 * position and sat two kilometres up a mountain. A ground readout did
 * the same. A texture tiled off rendered position and would have slid
 * sideways on every origin shift. Convention did not survive one
 * change; different field names do.
 *
 * CHUNKS ARE GLOBAL. A chunk's identity comes from world coordinates
 * alone, so moving the origin cannot change what terrain — or what
 * anything else — belongs where. That is what lets the same ground be
 * generated identically on two devices, after a reload, or a week
 * later, and it is why chunk addressing lives here with the
 * authoritative coordinates rather than next to the renderer.
 */

/** MACRO position. Authoritative, persistent, safe to save and send. */
export interface WorldPoint {
  readonly wx: number;
  readonly wz: number;
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
}

export function world(wx: number, wz: number): WorldPoint {
  return { wx, wz };
}

export function local(lx: number, lz: number): LocalPoint {
  return { lx, lz };
}

/** How wide a chunk is, in world units. */
export const CHUNK_SPAN = 512;

/**
 * A chunk's address. Integers, derived from world position only.
 *
 * The unit of streaming today and the natural unit of persistence
 * later: what lives in a chunk can be saved, loaded and simulated with
 * it, and two machines that agree on the address agree on the contents.
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
