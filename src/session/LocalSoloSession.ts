/**
 * The real session from Phase 0: local authority, true pause, local saves,
 * works offline.
 */
import { boundedString, type Store, type StoreSpec, type Versioned } from '../persistence/store';
import type { GameSession } from './GameSession';

export interface SoloSave extends Versioned {
  /** ISO 8601, or null when nothing has been saved yet. */
  readonly savedAt: string | null;
  readonly mapId: string;
}

/**
 * Bumped when a field changes meaning. A save from another version is
 * refused (read as defaults) rather than guessed at — a half-understood
 * save looks like it worked, which is worse than a fresh start.
 */
export const SOLO_SAVE_VERSION = 1;

export const SOLO_SAVE_SPEC: StoreSpec<SoloSave> = {
  key: 'traddomium.v1.solo-save',
  version: SOLO_SAVE_VERSION,
  defaults: { version: SOLO_SAVE_VERSION, savedAt: null, mapId: '' },
  sanitize(raw, defaults) {
    const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    return {
      version: SOLO_SAVE_VERSION,
      savedAt: typeof r.savedAt === 'string' ? r.savedAt : defaults.savedAt,
      mapId: boundedString(r.mapId, defaults.mapId, 64),
    };
  },
};

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

  async save(): Promise<void> {
    this.saves.write({ version: SOLO_SAVE_VERSION, savedAt: this.now(), mapId: this.mapId });
  }

  /** Leaving flushes: the player never has to remember to save. */
  async leave(): Promise<void> {
    await this.save();
  }
}
