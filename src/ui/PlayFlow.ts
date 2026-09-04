/**
 * THE CHOICES BETWEEN PRESSING A BUTTON AND BEING IN A GAME, in order:
 * how to play, then — for a solo game — which slot.
 *
 * Its own object because two screens run the same sequence: the main menu
 * (NEW GAME and RESUME open it in place, inside the menu's own panel) and
 * the session-picker scene. Written once, so the two can never drift into
 * asking the questions in a different order or asking one of them twice.
 *
 * It owns only the panels it makes. It does not swap scenes, request an
 * app state or start a session — the screen that hosts it does that,
 * because the app state and the transition belong to the screen, and a
 * fragment that reached for either would be a second place transitions
 * come from (ARCHITECTURE §4).
 *
 * `onClose` fires whenever the last panel goes away, so the host can put
 * its own controls back without tracking which panel was open.
 */
import type { GameSession } from '../session/GameSession';
import { SessionPicker, type SessionOffers } from './SessionPicker';
import { SlotPicker, type SlotPurpose, type SlotView } from './SlotPicker';

export interface PlayFlowHooks {
  readonly sessions: SessionOffers;
  /** MULTIPLAYER: it takes no slot, so the picker's own session object is what starts. */
  onStart(session: GameSession): void;
  /** A slot was chosen for a NEW game — the wiring clears it and opens it empty. */
  onNewGame(slot: number): void;
  /** A slot was chosen to RESUME — the wiring opens the game already in it. */
  onResume(slot: number): void;
  /** Every panel is gone. */
  onClose(): void;
}

export class PlayFlow {
  private sessionPicker: SessionPicker | null = null;
  private slotPicker: SlotPicker | null = null;

  /**
   * `host` is the panel the fragments live in; `before` is the element
   * they are inserted above (the menu's build stamp), or null to append.
   */
  constructor(
    private readonly host: HTMLElement,
    private readonly before: HTMLElement | null,
    private readonly hooks: PlayFlowHooks,
  ) {}

  get isOpen(): boolean {
    return this.sessionPicker !== null || this.slotPicker !== null;
  }

  /** NEW GAME: how to play, then which slot. */
  openSessions(): void {
    this.clear();
    this.sessionPicker = new SessionPicker(this.host, {
      solo: () => this.hooks.sessions.solo(),
      multiplayer: () => this.hooks.sessions.multiplayer(),
      onSolo: () => this.openSlots('new-game'),
      onStart: (session) => this.hooks.onStart(session),
      onBack: () => this.close(),
    });
    this.place(this.sessionPicker.element);
  }

  /**
   * The slot list. For a new game BACK returns to the how-to-play cards,
   * because that is the step the player came from; for a resume it closes
   * the flow, because RESUME opened this directly from the menu.
   */
  openSlots(purpose: SlotPurpose): void {
    this.clear();
    this.slotPicker = new SlotPicker(this.host, {
      purpose,
      slots: this.slots(),
      onChoose: (slot) => (purpose === 'new-game' ? this.hooks.onNewGame(slot) : this.hooks.onResume(slot)),
      onBack: () => (purpose === 'new-game' ? this.openSessions() : this.close()),
    });
    this.place(this.slotPicker.element);
  }

  /** The slots this wiring offers, or none at all when it keeps no saves. */
  slots(): readonly SlotView[] {
    return this.hooks.sessions.slots?.() ?? [];
  }

  /** Close everything and tell the host. */
  close(): void {
    this.clear();
    this.hooks.onClose();
  }

  /** Take the panels down without firing `onClose` — for a scene being disposed. */
  dispose(): void {
    this.clear();
  }

  private clear(): void {
    this.sessionPicker?.dispose();
    this.sessionPicker = null;
    this.slotPicker?.dispose();
    this.slotPicker = null;
  }

  private place(element: HTMLElement): void {
    if (this.before) this.host.insertBefore(element, this.before);
  }
}
