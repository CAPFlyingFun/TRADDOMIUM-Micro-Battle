/**
 * WHICH GAME — the three solo save slots as rows, and the one question
 * that must be asked before a game is thrown away.
 *
 * A DOM fragment, like `SessionPicker`, so it can open in place inside the
 * main menu's panel rather than as a scene swap: choosing a slot is one
 * step of starting a game, not a place the player travels to.
 *
 * The picker is shown for two purposes and behaves differently for each,
 * because the same row means two different things:
 *
 *   'new-game'  every slot is choosable. An EMPTY one starts at once. An
 *               OCCUPIED one replaces its card with a confirmation naming
 *               the game that would be lost — the "are you sure" that has
 *               to exist before anything can overwrite a save.
 *   'resume'    only occupied slots are choosable. An empty one is drawn
 *               disabled and says "Empty", because an unavailable action
 *               must never look functional (ARCHITECTURE §2.9).
 *
 * The picker is handed slots as plain data (`SlotView`) and hands back the
 * slot number the player pressed. It does not know what a save is, cannot
 * read one, and cannot delete one: the wiring does that, after this screen
 * has the answer (screen.ts, the typed-hooks convention).
 */
import { ACTION } from '../app/actions';
import { timeAgo } from './timeAgo';
import { actionRow, actionsRow, namedButton, note } from './screen';

/** One slot as the player sees it. `savedAt` is the whole of what "occupied" means. */
export interface SlotView {
  /** 1-based, and shown: this is "Slot 2" on the screen. */
  readonly slot: number;
  /** ISO 8601 as the game was stamped, or null when the slot is empty. */
  readonly savedAt: string | null;
}

export type SlotPurpose = 'new-game' | 'resume';

export interface SlotPickerHooks {
  readonly purpose: SlotPurpose;
  readonly slots: readonly SlotView[];
  /** The player chose this slot — and, for a new game on an occupied slot, confirmed it. */
  onChoose(slot: number): void;
  onBack(): void;
}

/**
 * Slot buttons are outside the closed `ACTION` vocabulary, the way
 * settings fields and dev tools are: the set grows with the number of
 * slots rather than with the app's shared verbs. A probe drives
 * `[data-action="slot:1"]`.
 */
export const slotAction = (slot: number): string => `slot:${slot}`;

/** The two answers to "replace the game in this slot?" — named so a probe can press either. */
export const SLOT_OVERWRITE_ACTION = 'slot-overwrite';
export const SLOT_KEEP_ACTION = 'slot-keep';

const HEADING: Readonly<Record<SlotPurpose, string>> = {
  'new-game': 'Choose a slot for the new game.',
  resume: 'Choose a game to resume.',
};

export class SlotPicker {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly rows: HTMLElement;
  private readonly heading: HTMLParagraphElement;
  private readonly back: HTMLElement;
  private confirm: HTMLElement | null = null;

  constructor(host: HTMLElement, private readonly hooks: SlotPickerHooks) {
    this.doc = host.ownerDocument;
    this.element = this.doc.createElement('div');
    this.element.className = 'ui-column';
    this.element.dataset.role = 'slot-picker';
    this.element.dataset.purpose = hooks.purpose;

    this.heading = this.doc.createElement('p');
    this.heading.className = 'ui-subtitle';
    this.heading.textContent = HEADING[hooks.purpose];
    this.element.appendChild(this.heading);

    this.rows = this.doc.createElement('div');
    this.rows.className = 'ui-slots';
    for (const view of hooks.slots) this.rows.appendChild(this.slotButton(view));
    this.element.appendChild(this.rows);

    this.back = actionsRow(this.element, [actionRow(ACTION.back, 'Back', () => hooks.onBack(), { compact: true })]);
    host.appendChild(this.element);
  }

  dispose(): void {
    this.element.remove();
  }

  /**
   * One row: the slot's name, and under it the one honest fact about it —
   * when its game was last played, or that it is empty. Both lines live
   * inside the button, so three slots cost three touch targets rather than
   * six rows on a 430 px screen.
   */
  private slotButton(view: SlotView): HTMLButtonElement {
    const occupied = view.savedAt !== null;
    const button = namedButton(slotAction(view.slot), `Slot ${view.slot}`, () => this.choose(view), {
      primary: this.hooks.purpose === 'resume' && occupied,
    });
    button.classList.add('ui-button--stacked');
    const sub = this.doc.createElement('small');
    sub.className = 'ui-button__sub';
    sub.textContent = occupied ? `Last played ${timeAgo(view.savedAt ?? '', Date.now())}` : 'Empty';
    button.appendChild(sub);
    // Resuming an empty slot is not an action, so it does not look like one.
    button.disabled = this.hooks.purpose === 'resume' && !occupied;
    return button;
  }

  private choose(view: SlotView): void {
    if (this.confirm) return;
    if (this.hooks.purpose === 'new-game' && view.savedAt !== null) {
      this.askToOverwrite(view);
      return;
    }
    this.hooks.onChoose(view.slot);
  }

  /**
   * The card that stands between a saved game and being replaced. It names
   * the slot and when its game was last played, so the player is answering
   * about a game they recognise rather than about a slot number, and the
   * confirming button says what it does ("Start over") rather than "OK".
   */
  private askToOverwrite(view: SlotView): void {
    // The question is the only thing on screen while it stands: BACK would
    // be a second way to say no, sitting under a button that already does.
    this.rows.hidden = true;
    this.heading.hidden = true;
    this.back.hidden = true;
    const card = this.doc.createElement('div');
    card.className = 'ui-column';
    card.dataset.role = 'slot-overwrite';
    card.dataset.slot = String(view.slot);
    note(card, `Slot ${view.slot} holds a game last played ${timeAgo(view.savedAt ?? '', Date.now())}.`);
    note(card, 'Starting a new game here replaces it. There is no way to get it back.');
    actionsRow(card, [
      namedButton(SLOT_OVERWRITE_ACTION, 'Start over', () => this.hooks.onChoose(view.slot), { compact: true }),
      namedButton(SLOT_KEEP_ACTION, 'Keep it', () => this.closeConfirm(), { primary: true, compact: true }),
    ]);
    this.element.insertBefore(card, this.rows);
    this.confirm = card;
  }

  private closeConfirm(): void {
    this.confirm?.remove();
    this.confirm = null;
    this.rows.hidden = false;
    this.heading.hidden = false;
    this.back.hidden = false;
  }
}
