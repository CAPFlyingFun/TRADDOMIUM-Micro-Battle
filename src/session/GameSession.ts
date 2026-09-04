/**
 * The session seam (ARCHITECTURE §5), built as written in
 * `docs/research/SESSION_ARCHITECTURE.md` §19.
 *
 * Session state has ONE owner: the session object. It is passed around,
 * never its `mode` enum, so gameplay code never learns whether the other
 * player is local or remote — it asks the session to save, to leave, or
 * whether the world may pause, and the session answers.
 */
export type SessionMode = 'solo' | 'multiplayer';
export type SessionAuthority = 'local' | 'server';

export interface GameSession {
  readonly mode: SessionMode;
  readonly mapId: string;
  /** Solo true, multiplayer false: a server's clock does not stop for one player's menu. */
  readonly canPauseWorld: boolean;
  readonly authority: SessionAuthority;
  /**
   * One honest line for the session picker. "Multiplayer" may never imply
   * more than exists (ARCHITECTURE §2.10); a test pins the mock's text.
   */
  readonly caption: string;
  save(): Promise<void>;
  leave(): Promise<void>;
}
