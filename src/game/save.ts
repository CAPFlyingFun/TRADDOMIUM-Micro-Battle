/**
 * THE SOLO SAVE — one portable document, read defensively.
 *
 * SESSION_ARCHITECTURE.md's model has `playerState: unknown` and
 * `worldState: unknown` in it, and that is how a save format rots: the
 * shape is whatever was convenient the day it was written, and two
 * releases later nothing can read the old one. So this is concrete,
 * and everything in it is a number, a string or a boolean.
 *
 * IT IS ALSO SMALLER THAN IT LOOKS, because this world is a function.
 * The island is not saved — it is baked Kauaʻi plus deterministic
 * octaves, identical in every session. Neither are the rivers, the
 * lakes, the coastline or the weather, which come from data and a
 * clock. What has to be remembered is only what the player CHANGED:
 * where she stands, what she is, and how far the things that run down
 * have run.
 *
 * ONE FIELD IS NOT A NUMBER, and it is the exception that proves the
 * paragraph above. The discovery mask is a few hundred characters of
 * encoded fog, and it belongs in a save for precisely the reason the
 * island does not: the island is the same function for everybody, and
 * what she has SEEN of it is hers alone. This file never reads that
 * string — `discovery.ts` owns the codec — it only checks that the
 * field is bounded and plausible, the way a document reader checks a
 * field it is carrying rather than interpreting.
 *
 * A DOCUMENT RATHER THAN A BROWSER RECORD. It carries its own version,
 * its own id and its own map, and it survives a round trip through
 * text — so the day a save moves from a phone to a desktop, that is a
 * transport problem and not a format one. Joshua asked for exactly
 * that, and the ordering argument against building device pairing now
 * is not an argument for making it hard later.
 *
 * READ AS UNTRUSTED INPUT, the way settings.ts reads its store, and
 * for the stronger version of the same reason: a settings file that
 * has been meddled with costs a bad camera angle, and a save that has
 * been meddled with is a queen standing in the sea. Known keys only,
 * every number finite and clamped, wrong version refused.
 */

/**
 * Bumped when a field changes meaning. A save from another version is
 * refused rather than guessed at — a half-understood save is worse
 * than a fresh start, because it looks like it worked.
 *
 * ADDING AN OPTIONAL FIELD IS NOT THAT. An older document without it is
 * still fully understood; it simply says nothing on the subject, and
 * the reader has a defined answer for that case. Bumping here would end
 * every colony currently sitting in a phone, so it is a decision to
 * argue for out loud rather than a routine step — `tests/soloSave.test`
 * pins the number so the argument has to happen.
 */
export const SAVE_VERSION = 1;

/** Where the saves live. Versioned, so a format change cannot collide. */
export const STORE = 'traddomium.saves.v1';

/** How many slots are kept. The oldest falls off the end. */
export const SLOTS = 5;

export interface SoloSave {
  readonly saveVersion: number;
  readonly saveId: string;
  /** Which world. One today; never the display name — see the plan. */
  readonly mapId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Simulated seconds lived in this world, across every sitting. */
  readonly playedSeconds: number;
  /** The region she founded in, so a slot has a name. */
  readonly region: string;

  /** WHERE SHE IS, in global coordinates — never local ones. */
  readonly at: {
    readonly wx: number;
    readonly wz: number;
    /** Radians, her convention: travel along (sin h, cos h). */
    readonly heading: number;
    /** Height above the terrain beneath her. Zero on the ground. */
    readonly agl: number;
  };

  /** WHAT SHE IS. */
  readonly body: {
    /** Index into the caste growth table. */
    readonly stage: number;
    readonly winged: boolean;
  };

  /** WHAT HAS RUN DOWN, each 0 to 1. */
  readonly meters: {
    readonly stamina: number;
    readonly thirst: number;
  };

  /**
   * The world clock she left at, in simulated seconds.
   *
   * Not the same as `playedSeconds` and both are needed: this drives
   * the sea's phase and the sky, so a resumed swell picks up where it
   * was rather than snapping to a different wave.
   */
  readonly elapsed: number;

  /**
   * WHAT SHE HAS SEEN, as `discovery.ts` encoded it.
   *
   * KNOWLEDGE, not world truth. Every other field here says something
   * about the world or about her; this one says only what the player
   * has been told, so it is the one field that could be thrown away
   * without the run becoming a different run — she would simply be
   * standing where she stands with the map dark again.
   *
   * OPTIONAL, AND ABSENT IS A REAL ANSWER. A save written before the
   * map existed has no mask, and neither does a save whose mask was
   * refused; both mean an unexplored island rather than a broken
   * document. That is why `SAVE_VERSION` did not move for this: an
   * older save is not half-understood, it is a queen who has not been
   * anywhere yet, and the one already on Joshua's phone must still open.
   */
  readonly discovery?: string;
}

/** Everything a scene has to hand over to be saved. */
export interface Snapshot {
  readonly region: string;
  readonly at: SoloSave['at'];
  readonly body: SoloSave['body'];
  readonly meters: SoloSave['meters'];
  readonly elapsed: number;
  readonly playedSeconds: number;
  /** Her mask, encoded — absent when the scene is not keeping one. */
  readonly discovery?: string;
}

/** Somewhere to put saves. localStorage in the game; a Map in a test. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Half the island's span, so a position can be sanity-checked here. */
const ISLAND_HALF = 2_800_000;

function clamp(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(high, Math.max(low, value))
    : fallback;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 && value.length < 200
    ? value : fallback;
}

/**
 * The longest discovery blob this document will carry.
 *
 * Derived from the mask rather than chosen: `discovery.ts` falls back
 * to a raw grid when run-length coding would lose, and that grid is one
 * byte for each of 384 x 384 cells, base64url'd at four characters per
 * three bytes. 196,608 characters, plus a comfortable allowance for the
 * `d1r:384:` header. Anything longer than that is not a mask this build
 * can have produced.
 *
 * Written as arithmetic, and kept here rather than imported, because a
 * document reader that imported the codec would drag the heightfield in
 * behind it — see `blob()`. `tests/soloSave.test.ts` pins the ceiling.
 */
const BLOB_MAX = 32 + Math.ceil((384 * 384 * 4) / 3);

/**
 * `<tag>:<grid>:<base64url>`, which is all of the shape save.ts knows.
 *
 * Deliberately looser than the two tags that exist today: naming `d1`
 * and `d1r` here would mean a new encoding in `discovery.ts` silently
 * became a save-format change. Tight enough, though, that a JSON
 * fragment, a script, a path or anything carrying whitespace or a
 * control character is not a candidate.
 */
const BLOB_SHAPE = /^[a-z][a-z0-9]{0,7}:[0-9]{1,6}:[A-Za-z0-9_-]+$/;

/**
 * A discovery blob, bounded and shaped — but never decoded here.
 *
 * `text()` is the wrong instrument twice over. It caps at 200
 * characters, which the mask passes within her first minutes of flying,
 * and it SUBSTITUTES a fallback rather than refusing, which for a mask
 * would mean quietly handing her somebody else's fog. So this one
 * returns nothing instead, and returning nothing costs nothing: an
 * absent mask is a legal save, so a bad blob may never take the rest of
 * the document down with it. Losing the fog is a re-explored island;
 * losing the save is a lost colony.
 *
 * The length is checked BEFORE the shape, so a hostile megabyte is
 * refused without being scanned.
 *
 * Whether the characters MEAN anything is `discovery.ts`'s business.
 * This file is a document reader and does not own the codec — if it
 * decoded the mask it would have to know the format, and then the next
 * encoding change would be a save-version change.
 */
function blob(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0 || value.length > BLOB_MAX) return undefined;
  return BLOB_SHAPE.test(value) ? value : undefined;
}

/**
 * Take one save out of whatever was in the store, or nothing.
 *
 * REFUSES rather than repairs when the version is wrong or the
 * position is not on the island. Everything else is clamped, because a
 * thirst of 4 is a typo and a queen at the bottom of the ocean is a
 * different game.
 */
export function readSave(raw: unknown): SoloSave | null {
  if (!raw || typeof raw !== 'object') return null;
  const it = raw as Record<string, unknown>;
  if (it.saveVersion !== SAVE_VERSION) return null;

  const at = (it.at ?? {}) as Record<string, unknown>;
  const wx = at.wx;
  const wz = at.wz;
  // NOT CLAMPED — refused. A position off the island is not a slider
  // that slipped, it is a save that is not about this world, and
  // dragging it to the nearest coastline would silently invent a run.
  if (typeof wx !== 'number' || !Number.isFinite(wx) || Math.abs(wx) > ISLAND_HALF) return null;
  if (typeof wz !== 'number' || !Number.isFinite(wz) || Math.abs(wz) > ISLAND_HALF) return null;

  const body = (it.body ?? {}) as Record<string, unknown>;
  const meters = (it.meters ?? {}) as Record<string, unknown>;
  const saveId = text(it.saveId, '');
  if (!saveId) return null;

  return {
    saveVersion: SAVE_VERSION,
    saveId,
    mapId: text(it.mapId, 'kauai'),
    createdAt: text(it.createdAt, new Date(0).toISOString()),
    updatedAt: text(it.updatedAt, new Date(0).toISOString()),
    playedSeconds: clamp(it.playedSeconds, 0, 1e9, 0),
    region: text(it.region, 'Kauaʻi'),
    at: {
      wx,
      wz,
      heading: clamp(at.heading, -Math.PI * 4, Math.PI * 4, 0),
      agl: clamp(at.agl, 0, 200_000, 0),
    },
    body: {
      stage: Math.round(clamp(body.stage, 0, 16, 0)),
      winged: body.winged !== false,
    },
    meters: {
      stamina: clamp(meters.stamina, 0, 1, 1),
      thirst: clamp(meters.thirst, 0, 1, 1),
    },
    elapsed: clamp(it.elapsed, 0, 1e9, 0),
    discovery: blob(it.discovery),
  };
}

/** Every save in the store, newest first, with the unreadable dropped. */
export function listSaves(store: Store): SoloSave[] {
  let raw: unknown;
  try {
    raw = JSON.parse(store.getItem(STORE) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const found = raw.map(readSave).filter((s): s is SoloSave => s !== null);
  found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return found.slice(0, SLOTS);
}

/** The one to offer under CONTINUE, or nothing. */
export function latestSave(store: Store): SoloSave | null {
  return listSaves(store)[0] ?? null;
}

/**
 * Write a snapshot into a slot, replacing that slot if it exists.
 *
 * WRITES THE WHOLE LIST rather than one key per slot, so a save can
 * never half-happen: either the new list is in the store or the old
 * one still is. A key per slot means a crash between two writes leaves
 * an index pointing at a colony that is not there.
 */
export function writeSave(
  store: Store, snapshot: Snapshot, saveId: string, now: string,
): SoloSave {
  const before = listSaves(store);
  const older = before.find((s) => s.saveId === saveId);
  const save: SoloSave = {
    saveVersion: SAVE_VERSION,
    saveId,
    mapId: 'kauai',
    createdAt: older?.createdAt ?? now,
    updatedAt: now,
    playedSeconds: snapshot.playedSeconds,
    region: snapshot.region,
    at: snapshot.at,
    body: snapshot.body,
    meters: snapshot.meters,
    elapsed: snapshot.elapsed,
    // Checked on the way OUT as well as on the way in, alone among the
    // snapshot's fields. The rest are small however wrong they are; an
    // oversized blob would be written into a list of five slots and
    // could take the whole store past quota, which loses the other four
    // colonies rather than one field.
    discovery: blob(snapshot.discovery),
  };
  const kept = [save, ...before.filter((s) => s.saveId !== saveId)].slice(0, SLOTS);
  try {
    store.setItem(STORE, JSON.stringify(kept));
  } catch {
    // A full or blocked store must not end the run. She keeps playing;
    // the next autosave tries again.
  }
  return save;
}

/** Throw one away. */
export function dropSave(store: Store, saveId: string): void {
  const kept = listSaves(store).filter((s) => s.saveId !== saveId);
  try {
    store.setItem(STORE, JSON.stringify(kept));
  } catch { /* see writeSave */ }
}

/** A new slot id. Random enough that two devices cannot collide. */
export function newSaveId(): string {
  const bits = new Uint8Array(8);
  crypto.getRandomValues(bits);
  return `s_${Array.from(bits, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** The document as text — the phone-to-desktop path, when it exists. */
export function exportSave(save: SoloSave): string {
  return JSON.stringify(save);
}

/** And back, with the same suspicion as anything else off a disk. */
export function importSave(from: string): SoloSave | null {
  try {
    return readSave(JSON.parse(from));
  } catch {
    return null;
  }
}

/** How long she has lived there, for a slot label. */
export function livedFor(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
