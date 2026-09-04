/**
 * THE CHOICES BETWEEN PRESSING A BUTTON AND BEING IN A GAME, in order:
 * how to play, then — for a solo game — which slot, or, for a
 * multiplayer game in a build that has a relay, which room.
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
 *
 * THE ROOM STEP APPEARS ONLY WHEN THERE IS A RELAY TO REACH. The flow
 * asks `sessions.rooms()` for that; when it answers null — or is not
 * there at all, which is a build with no online play — MULTIPLAYER starts
 * the session the picker shows, exactly as it has since Phase 0, and the
 * player never meets a screen about rooms that cannot be joined
 * (ARCHITECTURE §2.9). Both endings go through the SAME `onStart`, so the
 * host screen keeps the one transition it always had.
 */
import type { GameSession } from '../session/GameSession';
import { RoomCodePicker, type RoomOffer } from './RoomCodeScene';
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
  private roomPicker: RoomCodePicker | null = null;

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
    return this.sessionPicker !== null || this.slotPicker !== null || this.roomPicker !== null;
  }

  /** NEW GAME: how to play, then which slot — or, for multiplayer with a relay, which room. */
  openSessions(): void {
    this.clear();
    const rooms = this.hooks.sessions.rooms?.() ?? null;
    this.sessionPicker = new SessionPicker(this.host, {
      solo: () => this.hooks.sessions.solo(),
      multiplayer: () => this.hooks.sessions.multiplayer(),
      onSolo: () => this.openSlots('new-game'),
      onRooms: rooms === null ? null : () => this.openRooms(rooms),
      onStart: (session) => this.hooks.onStart(session),
      onBack: () => this.close(),
    });
    this.place(this.sessionPicker.element);
  }

  /**
   * The room step. JOIN asks the wiring for the session that joins THAT
   * room and starts it through the same `onStart` the mock uses, so a
   * multiplayer game still takes no slot and the host screen still owns
   * the transition. BACK returns to the how-to-play cards, which is the
   * step the player came from.
   */
  openRooms(offer: RoomOffer): void {
    this.clear();
    this.roomPicker = new RoomCodePicker(this.host, {
      relayUrl: offer.relayUrl,
      onJoin: (code, options) => this.hooks.onStart(this.hooks.sessions.multiplayer(code, options)),
      onBack: () => this.openSessions(),
    });
    this.place(this.roomPicker.element);
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
    this.roomPicker?.dispose();
    this.roomPicker = null;
  }

  private place(element: HTMLElement): void {
    if (this.before) this.host.insertBefore(element, this.before);
  }
}
