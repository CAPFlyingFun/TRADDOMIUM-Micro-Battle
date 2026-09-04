/**
 * The session seam (ARCHITECTURE §5), built as written in
 * `docs/research/SESSION_ARCHITECTURE.md` §19.
 *
 * Session state has ONE owner: the session object. It is passed around,
 * never its `mode` enum, so gameplay code never learns whether the other
 * player is local or remote — it asks the session to save, to leave, or
 * whether the world may pause, and the session answers.
 */
import type { WorldPoint } from '../world/coords';

export type SessionMode = 'solo' | 'multiplayer';
export type SessionAuthority = 'local' | 'server';

/**
 * Where the player is looking from. In WORLD coordinates (coords.ts,
 * THE RULE): a camera pose outlives the frame the moment it is saved.
 * `height` is above the ground plane; `yaw`/`pitch` are radians.
 */
export interface CameraPose {
  readonly at: WorldPoint;
  readonly height: number;
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * Everything a world hands over to be saved. Small on purpose: the
 * island is a function (baked Kauaʻi, identical in every session), so
 * only what the player changed is remembered. Grows with the phases —
 * the actor joins it with the player shell.
 */
export interface SessionSaveState {
  readonly camera: CameraPose;
}

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
  /**
   * Persist. With `state`, that is what is written; without it, the
   * session flushes what it already holds (a pause-menu quit still saves
   * even when the world has nothing new to say).
   */
  save(state?: SessionSaveState): Promise<void>;
  leave(): Promise<void>;
}
