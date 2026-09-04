/**
 * The real session from Phase 0: local authority, true pause, local saves,
 * works offline.
 *
 * A SESSION IS A SLOT. The session holds one save document — one of the
 * three in `SoloSlots.ts` — and every write it makes goes there and
 * nowhere else. RESUME opens the slot the player chose; NEW GAME clears
 * the slot the player chose and opens it empty. Nothing here decides
 * WHICH slot: that is a choice the player made on a screen, and this
 * module is handed the answer.
 *
 * The rule that used to live here — never overwrite a save without
 * asking — has not gone anywhere; it moved to where it can be honoured.
 * `newSoloGame` is the only function that throws a game away, it takes
 * the slot as an argument, and the screen in front of it asks first.
 */
import { defineStore, type KeyValueStore, type Store } from '../persistence/store';
import type { GameSession, SessionSaveState } from './GameSession';
import { SOLO_SAVE_VERSION, type KnownMap, type SoloSave } from './SoloSave';
import {
  firstEmptySoloSlot, newestSoloSlot, readSoloSlots, soloSlotSpec, type SoloSlot, type SoloSlotState,
} from './SoloSlots';

export { SOLO_SAVE_SPEC, SOLO_SAVE_VERSION, hasSoloSave, soloSaveSpec, type KnownMap, type SoloSave } from './SoloSave';
export {
  SOLO_SLOTS, SOLO_SLOT_COUNT, clearSoloSlot, firstEmptySoloSlot, isSoloSlot, newestSoloSlot, occupiedSoloSlots,
  readSoloSlot, readSoloSlots, soloSlotKey, soloSlotSpec, type SoloSlot, type SoloSlotState,
} from './SoloSlots';

export class LocalSoloSession implements GameSession {
  readonly mode = 'solo' as const;
  readonly canPauseWorld = true;
  readonly authority = 'local' as const;
  /**
   * Honest to the letter: the world stops on pause because `canPauseWorld`
   * makes the frame loop stop it, and progress is written to this device's
   * store at the pause and quit save points — nowhere else, and it never
   * leaves the device (`tests/sessionSave.test.ts` pins the wording).
   */
  readonly caption = 'Play alone, offline. Pausing stops the world. Progress is saved on this device.';

  constructor(
    private readonly saves: Store<SoloSave>,
    readonly mapId: string,
    /** Injected so a test can pin the timestamp. */
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Without `state`, the camera already on disk is kept: a flush must
   * never overwrite a real pose with the default one.
   */
  async save(state?: SessionSaveState): Promise<void> {
    const camera = state?.camera ?? this.saves.read().camera;
    this.saves.write({ version: SOLO_SAVE_VERSION, savedAt: this.now(), mapId: this.mapId, camera });
  }

  /** The save for THIS map, or null when there is none — a fresh start, not a default pose. */
  load(): SoloSave | null {
    const save = this.saves.read();
    if (save.savedAt === null || save.mapId !== this.mapId) return null;
    return save;
  }

  /** Leaving flushes: the player never has to remember to save. */
  async leave(): Promise<void> {
    await this.save();
  }
}

/** A saved solo game RESUME can open: which slot it is in, the session that reopens it, and when it was written. */
export interface SavedSoloGame {
  readonly slot: SoloSlot;
  /** A session on the save's own map — never the menu's default map, which may be a different world. */
  readonly session: LocalSoloSession;
  /** ISO 8601 as the save was stamped; the menu turns it into "Last played …". */
  readonly savedAt: string;
  readonly mapId: string;
}

/**
 * The game in one slot, and the session that reopens it — or null when
 * that slot holds nothing this build can open: empty, a save from another
 * version, or a save on a map this build does not have. `knownMap` is the
 * world registry's answer, passed in because session/ may not read the
 * scene registry (ARCHITECTURE §3). Null is what makes a slot render as
 * empty rather than as a game that cannot be entered, and the refusal
 * happens in the store's own sanitiser rather than in a screen.
 */
export function resumeSoloSlot(
  kv: KeyValueStore,
  knownMap: KnownMap,
  slot: SoloSlot,
  now?: () => string,
): SavedSoloGame | null {
  const store = defineStore(soloSlotSpec(slot, knownMap), kv);
  const save = store.read();
  if (save.savedAt === null) return null;
  return { slot, session: new LocalSoloSession(store, save.mapId, now), savedAt: save.savedAt, mapId: save.mapId };
}

/**
 * Start over in one slot. The slot is CLEARED before the session is
 * built, so the world that opens it asks `restorableStateOf` and is told
 * there is nothing to restore. A new game that quietly inherited the old
 * camera pose would not be a new game, and the player would have no way
 * to tell which of the two they got.
 *
 * The confirmation belongs to the screen, not to this function: by the
 * time it is called the answer is yes.
 */
export function newSoloGame(
  kv: KeyValueStore,
  knownMap: KnownMap,
  slot: SoloSlot,
  mapId: string,
  now?: () => string,
): LocalSoloSession {
  const store = defineStore(soloSlotSpec(slot, knownMap), kv);
  store.clear();
  return new LocalSoloSession(store, mapId, now);
}

/**
 * The newest saved game on this device, or null when there is none — what
 * the menu's RESUME offers, and the slot it opens when it is the only
 * one. Null means the menu shows NEW GAME alone; a RESUME that opened a
 * world that is not in this build would be the dishonest button.
 */
export function savedSoloGame(
  kv: KeyValueStore,
  knownMap: KnownMap,
  now?: () => string,
): SavedSoloGame | null {
  const newest = newestSoloSlot(readSoloSlots(kv, knownMap));
  return newest === null ? null : resumeSoloSlot(kv, knownMap, newest.slot, now);
}

/**
 * Which slot a world opened from the DEV-TOOLS HUB should use. A tool is
 * not a place to keep a game, but a world needs a session, so the rule is
 * the least surprising one available: continue the game already saved on
 * that map (opening the tool twice continues rather than forking), else
 * take a slot that is empty (a tool never silently replaces a game the
 * player can still reach), else fall back to the newest — with three
 * games on other maps there is no free slot, and the newest is the one
 * the player is living in and would notice at once.
 */
export function toolSoloSlot(kv: KeyValueStore, knownMap: KnownMap, mapId: string): SoloSlot {
  const states = readSoloSlots(kv, knownMap);
  const onThisMap = states.filter((s: SoloSlotState) => s.savedAt !== null && s.mapId === mapId);
  return (newestSoloSlot(onThisMap) ?? firstEmptySoloSlot(states) ?? newestSoloSlot(states) ?? states[0]).slot;
}

/**
 * What a session can put back into the world, asked of the seam rather
 * than of a class. A solo session answers with the save on this device;
 * the multiplayer mock has nothing (a server would answer with a
 * snapshot, not a file); no session, nothing. session/ knows its own
 * classes so that nothing outside it has to — a world reads this through
 * a hook and never learns which session it holds (§5).
 */
export function restorableStateOf(session: GameSession | null): SessionSaveState | null {
  if (!(session instanceof LocalSoloSession)) return null;
  const save = session.load();
  return save ? { camera: save.camera } : null;
}
