/**
 * The real session from Phase 0: local authority, true pause, local saves,
 * works offline.
 *
 * ONE SLOT, ALWAYS RESUMED. There is one solo save on a device, and every
 * solo session on the map it names picks it up: PLAY → SOLO and CONTINUE
 * open the same game, and CONTINUE is the shortcut that says so on the
 * menu. That is deliberate — a PLAY that started over would overwrite the
 * save at its first pause with no question asked, and a data-loss path
 * with no "are you sure" is worse than no "new game" at all. Starting
 * over is a later feature with a confirmation in front of it.
 */
import { defineStore, type KeyValueStore, type Store } from '../persistence/store';
import type { GameSession, SessionSaveState } from './GameSession';
import { SOLO_SAVE_VERSION, soloSaveSpec, type KnownMap, type SoloSave } from './SoloSave';

export { SOLO_SAVE_SPEC, SOLO_SAVE_VERSION, hasSoloSave, soloSaveSpec, type KnownMap, type SoloSave } from './SoloSave';

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

/** The saved solo game CONTINUE offers: the session that reopens it, and when it was written. */
export interface SavedSoloGame {
  /** A session on the save's own map — never the menu's default map, which may be a different world. */
  readonly session: LocalSoloSession;
  /** ISO 8601 as the save was stamped; the menu turns it into "Last played …". */
  readonly savedAt: string;
  readonly mapId: string;
}

/**
 * What `hasSoloSave` answers, plus the session that resumes it — or null
 * when there is nothing to resume: no save, a save from another version,
 * or a save on a map this build does not have. `knownMap` is the world
 * registry's answer, passed in because session/ may not read the scene
 * registry (ARCHITECTURE §3). Null means the menu shows PLAY alone; a
 * CONTINUE that opened a world that is not there would be the dishonest
 * button, so the refusal happens here, in the store's own sanitizer.
 */
export function savedSoloGame(
  kv: KeyValueStore,
  knownMap: KnownMap,
  now?: () => string,
): SavedSoloGame | null {
  const store = defineStore(soloSaveSpec(knownMap), kv);
  const save = store.read();
  if (save.savedAt === null) return null;
  return { session: new LocalSoloSession(store, save.mapId, now), savedAt: save.savedAt, mapId: save.mapId };
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
