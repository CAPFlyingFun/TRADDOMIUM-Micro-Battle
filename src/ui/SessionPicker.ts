/**
 * SOLO or MULTIPLAYER, as two cards — a DOM fragment so it can sit inside
 * the main menu's panel (NEW GAME opens it in place) or inside its own
 * scene.
 *
 * The SOLO card, and the MULTIPLAYER card of a build with no relay, show
 * the caption of the very `GameSession` object they describe, read off the
 * object rather than retyped here: that is how the multiplayer mock's
 * honest "Online play is not built yet." reaches the screen from the one
 * place a test pins it (ARCHITECTURE §2.10). The mock is still enterable,
 * so the whole session → loading → world path is exercised in a build
 * that has no server at all.
 *
 * THE TWO CARDS END DIFFERENTLY, and that asymmetry is the point.
 * MULTIPLAYER never asks for a save slot: nothing about a multiplayer
 * game is kept on this device — a server would own the state — so a slot
 * would be an empty promise, and offering one would say the game is being
 * kept somewhere it is not. SOLO does not start anything here; it hands
 * back to the caller, which asks which of the three slots the game goes
 * in. Its card's button says so.
 *
 * WHAT MULTIPLAYER DOES DEPENDS ON WHETHER THIS BUILD HAS A RELAY, and
 * the difference is handed in (`onRooms`), never guessed at here:
 *
 *   no relay   the card starts the session it shows, exactly as it has
 *              since Phase 0 — and the session it shows carries the
 *              pinned "Online play is not built yet."
 *   a relay    the card leads to the room step (`RoomCodeScene.ts`),
 *              because a room has to be named before a session can be
 *              built for it.
 *
 * AND SO DO THE WORDS ON IT. A session built with no room describes no
 * room: its caption is the no-relay line, which stops being true of the
 * BUILD the moment a relay is compiled in and players can meet in it.
 * So the relay build's card carries the ui's own `ROOMS_CAPTION` — what
 * multiplayer is in this build — and `ROOMS_SCOPE_NOTE` under it — what
 * is not in it yet. Facts (is there a relay, and where) come from the
 * wiring through `rooms()`; the words are the screen's, which is where
 * player-facing prose belongs. Neither line may promise more than the
 * probe can show two browsers doing (ARCHITECTURE §2.10).
 *
 * The picker knows only the `GameSession` TYPE. Who constructs a solo or
 * multiplayer session is the wiring's business (`SessionOffers`).
 */
import { ACTION } from '../app/actions';
import type { GameSession } from '../session/GameSession';
import type { RoomOffer } from './RoomCodeScene';
import { actionRow, actionsRow, note } from './screen';
import type { SlotView } from './SlotPicker';

/** The newest solo game on this device, as the menu's RESUME shows it. */
export interface SavedGame {
  /** Which slot it is in — what RESUME opens when it is the only saved game. */
  readonly slot: number;
  /** ISO 8601, when it was written; the menu turns it into "Last played …". */
  readonly savedAt: string;
}

/** What a session card would start, and what is already saved — supplied by integration, since the ui may not import session internals. */
export interface SessionOffers {
  /**
   * A solo session, read for its CAPTION only. The session a slot
   * actually starts is built for that slot once the player has chosen
   * one, so this object is described, never entered.
   */
  solo(): GameSession;
  /**
   * The multiplayer session. With a room code it is the session that
   * joins THAT room on the relay; without one it is the session this
   * build offers with no room, which is what the card is described by.
   */
  multiplayer(room?: string): GameSession;
  /**
   * The room step's facts, or absent/null when this build has no relay.
   * Its presence is the whole of how the ui learns there is online play
   * to reach — the ui may not read the build's constants itself.
   */
  rooms?(): RoomOffer | null;
  /**
   * The three save slots as the player sees them. Optional: a wiring
   * without saves shows no slots and no RESUME, rather than empty ones
   * that cannot be filled.
   */
  slots?(): readonly SlotView[];
  /**
   * The newest saved solo game, or null when there is none this build can
   * open — integration decides that against the world registry, so RESUME
   * can never open a world that is not there.
   */
  saved?(): SavedGame | null;
}

export interface SessionPickerHooks {
  solo(): GameSession;
  multiplayer(): GameSession;
  /** SOLO chosen. The caller asks which slot; nothing has started yet. */
  onSolo(): void;
  /**
   * MULTIPLAYER chosen in a build that has a relay: the caller opens the
   * room step. Absent or null means there is no relay, and MULTIPLAYER
   * starts the session it shows, as it always has.
   */
  onRooms?: (() => void) | null;
  /** MULTIPLAYER chosen with no relay to reach: the session it shows is the session it starts. */
  onStart(session: GameSession): void;
  onBack(): void;
}

/**
 * What multiplayer IS in a build that has a relay. Every word of it is
 * what `npm run probe:multiplayer` drives two browsers through against a
 * running relay: same code, same world, each one's capsule moving on the
 * other's screen.
 */
export const ROOMS_CAPTION = 'Everyone who opens the same room code shares one world and sees the others move in it.';

/** And what is not there yet, so the card cannot be read as a finished game. */
export const ROOMS_SCOPE_NOTE = 'A room holds the test grid and a capsule each — no ant, no terrain, and nothing is saved.';

export class SessionPicker {
  readonly element: HTMLElement;

  constructor(host: HTMLElement, hooks: SessionPickerHooks) {
    const doc = host.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'ui-column';
    this.element.dataset.role = 'session-picker';

    const heading = doc.createElement('p');
    heading.className = 'ui-subtitle';
    heading.textContent = 'Choose how to play.';
    this.element.appendChild(heading);

    const cards = doc.createElement('div');
    cards.className = 'ui-cards';
    const solo = hooks.solo();
    const multiplayer = hooks.multiplayer();
    cards.appendChild(
      card(
        doc,
        'Solo',
        solo,
        actionRow(ACTION.solo, 'Choose a save slot', () => hooks.onSolo(), { primary: true }),
        solo.caption,
        null,
      ),
    );
    const rooms = hooks.onRooms ?? null;
    cards.appendChild(
      card(
        doc,
        'Multiplayer',
        multiplayer,
        rooms
          ? actionRow(ACTION.multiplayer, 'Choose a room', () => rooms())
          : actionRow(ACTION.multiplayer, 'Enter mock session', () => hooks.onStart(multiplayer)),
        rooms ? ROOMS_CAPTION : multiplayer.caption,
        rooms ? ROOMS_SCOPE_NOTE : null,
      ),
    );
    this.element.appendChild(cards);

    actionsRow(this.element, [actionRow(ACTION.back, 'Back', () => hooks.onBack(), { compact: true })]);
    host.appendChild(this.element);
  }

  dispose(): void {
    this.element.remove();
  }
}

/**
 * One card. `caption` is passed in rather than read off the session here,
 * because which words describe this card is the constructor's decision
 * (see the header): the session's own line for solo and for the no-relay
 * mock, the screen's for a build that has rooms.
 */
function card(
  doc: Document,
  title: string,
  session: GameSession,
  button: HTMLButtonElement,
  caption: string,
  scope: string | null,
): HTMLElement {
  const box = doc.createElement('article');
  box.className = 'ui-card';
  box.dataset.sessionMode = session.mode;
  const heading = doc.createElement('h2');
  heading.className = 'ui-card__title';
  heading.textContent = title;
  const line = doc.createElement('p');
  line.className = 'ui-card__caption';
  line.textContent = caption;
  button.classList.add('ui-button--compact');
  box.append(heading, line);
  if (scope !== null) note(box, scope);
  box.appendChild(button);
  return box;
}
