/**
 * SOLO or MULTIPLAYER, as two cards — a DOM fragment so it can sit inside
 * the main menu's panel (PLAY opens it in place) or inside its own scene.
 *
 * Each card shows the caption of the very `GameSession` object it would
 * start, read off the object rather than retyped here: that is how the
 * multiplayer mock's honest "Online play is not built yet." reaches the
 * screen from the one place a test pins it (ARCHITECTURE §2.10). The mock
 * is still enterable, so the whole session → loading → world path is
 * exercised long before a transport exists.
 *
 * The picker knows only the `GameSession` TYPE. Who constructs a solo or
 * multiplayer session is the wiring's business (`SessionOffers`).
 */
import { ACTION } from '../app/actions';
import type { GameSession } from '../session/GameSession';
import { actionRow, actionsRow } from './screen';

/** The solo game saved on this device, as the menu's CONTINUE shows it. */
export interface SavedGame {
  /** The session that resumes it — on the save's own map, not the menu's default. */
  readonly session: GameSession;
  /** ISO 8601, when it was written; the menu turns it into "Last played …". */
  readonly savedAt: string;
}

/** Builds the session a card would start — supplied by integration, since the ui may not import session internals. */
export interface SessionOffers {
  solo(): GameSession;
  multiplayer(): GameSession;
  /**
   * The solo game saved on this device, or null when there is none this
   * build can load — integration decides that against the world registry,
   * so a CONTINUE can never open a world that is not there. Optional: a
   * wiring without saves has no CONTINUE, rather than one that cannot.
   */
  saved?(): SavedGame | null;
}

export interface SessionPickerHooks extends SessionOffers {
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
    cards.appendChild(card(doc, 'Solo', solo, actionRow(ACTION.solo, 'Play solo', () => hooks.onStart(solo), { primary: true })));
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
