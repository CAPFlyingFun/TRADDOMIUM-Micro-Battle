/**
 * The real session from Phase 0: local authority, true pause, local saves,
 * works offline.
 */
import type { Store } from '../persistence/store';
import type { GameSession, SessionSaveState } from './GameSession';
import { SOLO_SAVE_VERSION, type SoloSave } from './SoloSave';

export { SOLO_SAVE_SPEC, SOLO_SAVE_VERSION, hasSoloSave, soloSaveSpec, type SoloSave } from './SoloSave';

export class LocalSoloSession implements GameSession {
  readonly mode = 'solo' as const;
  readonly canPauseWorld = true;
  readonly authority = 'local' as const;
  readonly caption = 'Play alone on this device. Pausing stops the world; progress is saved here.';

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
