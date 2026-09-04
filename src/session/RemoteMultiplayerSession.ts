/**
 * A MOCK adapter behind the real interface.
 *
 * It exists so that gameplay code is written against `GameSession` from
 * day one and never learns which implementation it has. When the
 * transport arrives, this class grows a connection; nothing that consumes
 * a session changes. Until then it is honest about being a mock: the
 * caption is pinned by a test so "Multiplayer" can never quietly imply
 * more than exists.
 */
import type { GameSession, SessionSaveState } from './GameSession';

export const MULTIPLAYER_CAPTION = 'Online play is not built yet.';

export class RemoteMultiplayerSession implements GameSession {
  readonly mode = 'multiplayer' as const;
  readonly canPauseWorld = false;
  readonly authority = 'server' as const;
  readonly caption = MULTIPLAYER_CAPTION;

  constructor(readonly mapId: string) {}

  /** The server would own state; there is nothing local to write. */
  async save(_state?: SessionSaveState): Promise<void> {}

  async leave(): Promise<void> {}
}
