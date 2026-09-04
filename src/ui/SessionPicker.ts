/**
 * SOLO or MULTIPLAYER, as two cards — a DOM fragment so it can sit inside
 * the main menu's panel (NEW GAME opens it in place) or inside its own
 * scene.
 *
 * Each card shows the caption of the very `GameSession` object it
 * describes, read off the object rather than retyped here: that is how the
 * multiplayer mock's honest "Online play is not built yet." reaches the
 * screen from the one place a test pins it (ARCHITECTURE §2.10). The mock
 * is still enterable, so the whole session → loading → world path is
 * exercised long before a transport exists.
 *
 * THE TWO CARDS END DIFFERENTLY, and that asymmetry is the point.
 * MULTIPLAYER starts the session it shows, because a multiplayer game
 * takes no save slot: nothing about it is kept on this device — a server
 * would own the state — so a slot would be an empty promise, and offering
 * one would say the game is being kept somewhere it is not. SOLO does not
 * start anything here; it hands back to the caller, which asks which of
 * the three slots the game goes in. Its card's button says so.
 *
 * The picker knows only the `GameSession` TYPE. Who constructs a solo or
 * multiplayer session is the wiring's business (`SessionOffers`).
 */
import { ACTION } from '../app/actions';
import type { GameSession } from '../session/GameSession';
import { actionRow, actionsRow } from './screen';
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
  multiplayer(): GameSession;
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
  /** MULTIPLAYER chosen. It takes no slot, so the session it shows is the session it starts. */
  onStart(session: GameSession): void;
  onBack(): void;
}

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
      card(doc, 'Solo', solo, actionRow(ACTION.solo, 'Choose a save slot', () => hooks.onSolo(), { primary: true })),
    );
    cards.appendChild(
      card(doc, 'Multiplayer', multiplayer, actionRow(ACTION.multiplayer, 'Enter mock session', () => hooks.onStart(multiplayer))),
    );
    this.element.appendChild(cards);

    actionsRow(this.element, [actionRow(ACTION.back, 'Back', () => hooks.onBack(), { compact: true })]);
    host.appendChild(this.element);
  }

  dispose(): void {
    this.element.remove();
  }
}

function card(doc: Document, title: string, session: GameSession, button: HTMLButtonElement): HTMLElement {
  const box = doc.createElement('article');
  box.className = 'ui-card';
  box.dataset.sessionMode = session.mode;
  const heading = doc.createElement('h2');
  heading.className = 'ui-card__title';
  heading.textContent = title;
  const caption = doc.createElement('p');
  caption.className = 'ui-card__caption';
  caption.textContent = session.caption;
  button.classList.add('ui-button--compact');
  box.append(heading, caption, button);
  return box;
}
