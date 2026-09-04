/**
 * THE MULTIPLAYER SIDE OF THE SESSION SEAM (ARCHITECTURE §5).
 *
 * Gameplay is written against `GameSession` and never learns which
 * implementation it holds. This one holds the link to the relay when
 * there is a relay to hold, and nothing at all when there is not — the
 * build that ships without a relay URL is exactly the honest mock it has
 * been since Phase 0, same class, same interface.
 *
 * THE CAPTION IS THE HONESTY RULE (ARCHITECTURE §2.10), and it is pinned
 * by `tests/session.test.ts`:
 *
 *   no relay configured   'Online play is not built yet.'   — always,
 *                         whatever this class grows later. A build with
 *                         nowhere to connect to must not hint that
 *                         online play is one tap away.
 *   relay configured      what the TRANSPORT reports, and only that:
 *                         not connected / connecting / connected. The
 *                         caption never runs ahead of the socket, so it
 *                         cannot say "connected" to a player whose
 *                         relay is down.
 *
 * Note what the connected caption does NOT say: that online play works.
 * It says the link to the relay is up, which is the thing that is true.
 *
 * `canPauseWorld` stays false and `authority` stays `'server'` in every
 * case — a server's clock does not stop for one player's menu, and that
 * is true of a relay that has not been reached yet as much as of one
 * that has.
 */
import { WebSocketTransport, type Transport } from '../net';
import type { GameSession, SessionSaveState } from './GameSession';

/** Pinned. The caption for a build with no relay configured. */
export const MULTIPLAYER_CAPTION = 'Online play is not built yet.';

/** A relay is configured, and this end has not reached it (yet, or any more). */
export const RELAY_CLOSED_CAPTION = 'Not connected to the relay.';
export const RELAY_CONNECTING_CAPTION = 'Connecting to the relay…';
export const RELAY_CONNECTED_CAPTION = 'Connected to the relay.';

export interface RemoteMultiplayerOptions {
  /**
   * `ws://` or `wss://`. Absent or empty means this build has no online
   * play, which is the pinned-caption case — not an error.
   */
  readonly relayUrl?: string;
  /**
   * How the session reaches that URL. Injectable so a test drives a fake
   * socket and so the app can hand in a transport it already holds.
   */
  readonly createTransport?: (url: string) => Transport;
  /**
   * The player asked for a practice bot in this room (`ui/RoomCodeScene`).
   * It is carried on the session because the session is the object that
   * knows WHICH ROOM this is and travels from the room screen to the
   * world; the world asks for the link when it enters.
   */
  readonly practiceBot?: boolean;
}

export class RemoteMultiplayerSession implements GameSession {
  readonly mode = 'multiplayer' as const;
  readonly canPauseWorld = false;
  readonly authority = 'server' as const;

  /** The link, or null when no relay is configured. Read-only to everyone above. */
  private readonly link: Transport | null;
  /** The room's address and how to reach it, kept so a SECOND link can be opened for a bot. */
  private readonly url: string;
  private readonly create: (url: string) => Transport;
  private readonly wantsPracticeBot: boolean;

  constructor(
    readonly mapId: string,
    options: RemoteMultiplayerOptions = {},
  ) {
    this.url = options.relayUrl ?? '';
    this.create = options.createTransport ?? ((at: string): Transport => new WebSocketTransport({ url: at }));
    this.wantsPracticeBot = options.practiceBot === true;
    // A blank URL is "no relay" and is the pinned-caption case. A
    // malformed one is a typo, and the transport throws on it here at
    // construction rather than letting it hide behind a caption that
    // reads like a build with online play simply switched off.
    this.link = this.url.length === 0 ? null : this.create(this.url);
  }

  /** Null when this build has no relay; the transport otherwise, for whoever drives the client. */
  get transport(): Transport | null {
    return this.link;
  }

  /**
   * A SECOND, FRESH link to the same room, for the practice bot
   * (`net/PracticeBot.ts`) — null when no bot was asked for, or when
   * this build has no relay to ask it into.
   *
   * A separate socket and not a share of the player's own, because the
   * bot is a separate PLAYER: it says its own hello under its own
   * PlayerId, and the authority keys players by that (`net/Host.ts`,
   * `onHello`). Two players down one socket would be one connection
   * speaking for two, which the host refuses by design.
   *
   * A function and not a property, because the bot leaves after five
   * minutes and can be sent back in: a link that has said `bye` cannot
   * be reopened, so each run gets its own.
   */
  openPracticeBot(): Transport | null {
    if (!this.wantsPracticeBot || this.url.length === 0) return null;
    return this.create(this.url);
  }

  get caption(): string {
    const link = this.link;
    if (link === null) return MULTIPLAYER_CAPTION;
    switch (link.state) {
      case 'open':
        return RELAY_CONNECTED_CAPTION;
      case 'connecting':
        return RELAY_CONNECTING_CAPTION;
      default:
        return RELAY_CLOSED_CAPTION;
    }
  }

  /**
   * Open the link. Without a relay there is nothing to open and nothing
   * to apologise for: the caption already says so. With one, this
   * rejects with the transport's own message when the relay cannot be
   * reached, so the caller can show a reason rather than a spinner.
   */
  async connect(): Promise<void> {
    await this.link?.connect();
  }

  /** The server would own state; there is nothing local to write. */
  async save(_state?: SessionSaveState): Promise<void> {}

  /** Hang up for good. The transport stops retrying; a left session is not dragged back online. */
  async leave(): Promise<void> {
    this.link?.disconnect();
  }
}
