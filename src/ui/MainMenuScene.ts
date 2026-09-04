/**
 * The front door: title, the button column, and the build stamp so a
 * phone can say which build it is running.
 *
 * RESUME IS OFFERED ONLY WHEN THERE IS SOMETHING TO RESUME — v0's rule,
 * kept. It sits above NEW GAME, takes the gold, and says when the game it
 * would open was last played, because a RESUME that drops the player
 * somewhere unexpected is worse than none. Whether a save exists, and
 * whether this build can open its world, is answered by the hooks: the
 * menu shows what it is handed and never reads a save document itself
 * (ARCHITECTURE §2.7).
 *
 * RESUME with one saved game opens it. With two or three it opens the
 * slot list instead: three games are three games, and picking the newest
 * on the player's behalf would be the menu deciding which one they meant.
 * Either way the button's own line names the newest, so the screen never
 * promises a game it is not about to open.
 *
 * NEW GAME opens the session picker IN PLACE — the button column hides
 * and the two session cards take its spot inside the same panel — rather
 * than swapping scenes, so choosing how to play is one tap deep and there
 * is no fade between the title and the choice. SOLO then asks which slot;
 * MULTIPLAYER takes no slot and starts. The app state still walks menu →
 * session → loading, because the state is about what the app is doing,
 * not about which DOM is showing (AppState.ts).
 *
 * A destination that is not registered in this build renders disabled
 * with the reason in its label. The button stays so the layout does not
 * change when the destination arrives, and so a probe still finds it.
 */
import { ACTION, type Action } from '../app/actions';
import type { SceneContext, SceneFactory } from '../app/Scene';
import type { GameSession } from '../session/GameSession';
import { buildStamp } from './buildInfo';
import { destination, SCREEN_ID, startSession, type Destination } from './navigation';
import { PlayFlow } from './PlayFlow';
import { actionRow, buttonColumn, footer, markUnavailable, Screen, titledPanel, type Wire } from './screen';
import type { SavedGame, SessionOffers } from './SessionPicker';
import { timeAgo } from './timeAgo';

export const GAME_TITLE = 'TRADDOMIUM: Micro Battle!';

/**
 * The `data-action` of the menu's RESUME. It is the shared verb, the same
 * one the pause menu's RESUME carries: both mean "back into the game I
 * was in". They are never on screen together — the menu is a scene, the
 * pause card is an overlay the world owns — and a probe tells them apart
 * by the screen they are on (`[data-screen="menu"] [data-action="resume"]`).
 */
export const MENU_RESUME_ACTION = ACTION.resume;

/**
 * How the wiring opens a solo slot. Two verbs, not one with a flag,
 * because they differ in the one way that matters: `newGame` throws the
 * slot's save away first and `resume` must not.
 */
export interface SoloPlay {
  newGame(slot: number): void;
  resume(slot: number): void;
}

export interface MainMenuHooks {
  /** The sessions and slots the in-place flow offers. */
  readonly sessions: SessionOffers;
  /** MULTIPLAYER was chosen; it takes no slot, so the session starts as it stands. */
  onStart(session: GameSession): void;
  /**
   * The newest saved solo game, or null when there is none this build can
   * open — RESUME exists exactly when this is non-null. Read when the menu
   * builds, so the button reflects the device now, not the last visit.
   */
  savedGame(): SavedGame | null;
  /** A slot was chosen for a new game: clear it and open it empty. */
  onNewGame(slot: number): void;
  /** A slot was chosen to resume: open the game already in it. */
  onResume(slot: number): void;
  readonly onProfile: Destination;
  readonly onSettings: Destination;
  readonly onEditors: Destination;
  readonly onAbout: Destination;
}

export class MainMenuScene extends Screen {
  readonly name = 'menu';
  private panel: HTMLElement | null = null;
  private column: HTMLElement | null = null;
  private stamp: HTMLElement | null = null;
  private flow: PlayFlow | null = null;

  constructor(ctx: SceneContext, private readonly hooks: MainMenuHooks) {
    super(ctx, 'menu');
  }

  protected build(root: HTMLElement): void {
    this.panel = titledPanel(root, GAME_TITLE, { hero: true, subtitle: 'You are the ant.', wide: true });
    const saved = this.hooks.savedGame();
    // With a save, resuming is the point of the screen and takes the gold; NEW GAME steps back to a plain button.
    const newGame = actionRow(ACTION.newGame, 'New game', () => this.openFlow('sessions'), { primary: saved === null });
    this.column = buttonColumn(this.panel, [
      ...(saved ? [resumeButton(saved, () => this.resume(saved), Date.now())] : []),
      newGame,
      destinationButton(ACTION.profile, 'Profile', this.hooks.onProfile),
      destinationButton(ACTION.settings, 'Settings', this.hooks.onSettings),
      destinationButton(ACTION.editors, 'Editors', this.hooks.onEditors),
      destinationButton(ACTION.about, 'About', this.hooks.onAbout),
    ]);
    this.stamp = footer(this.panel, buildStamp());
    this.flow = new PlayFlow(this.panel, this.stamp, {
      sessions: this.hooks.sessions,
      onStart: (session) => this.hooks.onStart(session),
      onNewGame: (slot) => this.hooks.onNewGame(slot),
      onResume: (slot) => this.hooks.onResume(slot),
      onClose: () => this.closeFlow(),
    });
  }

  override dispose(): void {
    this.flow?.dispose();
    this.flow = null;
    super.dispose();
  }

  /**
   * One saved game is one game: open it. Two or three, and the player
   * chooses — the newest is named on the button, not opened behind it.
   */
  private resume(saved: SavedGame): void {
    const games = this.flow?.slots().filter((s) => s.savedAt !== null) ?? [];
    if (games.length > 1) {
      this.openFlow('resume');
      return;
    }
    this.hooks.onResume(saved.slot);
  }

  private openFlow(what: 'sessions' | 'resume'): void {
    if (!this.flow || this.flow.isOpen || !this.column) return;
    this.column.hidden = true;
    if (what === 'sessions') this.flow.openSessions();
    else this.flow.openSlots('resume');
    this.ctx.app.requestState('session');
  }

  private closeFlow(): void {
    if (this.column) this.column.hidden = false;
    this.ctx.app.requestState('menu');
  }
}

/**
 * RESUME with its "Last played …" line INSIDE the button, not as a row of
 * its own: with a save the column is already six rows of the 48 px thumb
 * minimum, which is more than a 932 × 430 panel shows at once (it scrolls;
 * ABOUT and the build stamp sit just below the fold — carried from Phase 1,
 * and a composition question for the UI card, not something to fix by
 * shrinking a touch target). A seventh row would make that worse for a
 * caption that fits inside the button it describes.
 */
function resumeButton(saved: SavedGame, onClick: () => void, nowMs: number): HTMLButtonElement {
  const button = actionRow(MENU_RESUME_ACTION, 'Resume', onClick, { primary: true });
  button.classList.add('ui-button--stacked');
  const sub = button.ownerDocument.createElement('small');
  sub.className = 'ui-button__sub';
  sub.textContent = `Last played ${timeAgo(saved.savedAt, nowMs)}`;
  button.appendChild(sub);
  return button;
}

function destinationButton(action: Action, label: string, go: Destination): HTMLButtonElement {
  const button = actionRow(action, label, () => go?.());
  return go ? button : markUnavailable(button);
}

/**
 * `offers` builds the sessions and reads the slots (the ui may not
 * construct or read either); `onNewGame` and `onResume` are the wiring's
 * two ways into a solo game. The four destinations are looked up in the
 * registry at construction, which is after every registration has run, so
 * an unregistered screen is shown honestly instead of throwing on tap.
 */
export function createMainMenuScene(offers: Wire<SessionOffers>, play: Wire<SoloPlay>): SceneFactory {
  return (ctx) => {
    const sessions = offers(ctx);
    const solo = play(ctx);
    return new MainMenuScene(ctx, {
      sessions,
      onStart: (session) => startSession(ctx, session),
      savedGame: () => sessions.saved?.() ?? null,
      onNewGame: (slot) => solo.newGame(slot),
      onResume: (slot) => solo.resume(slot),
      onProfile: destination(ctx, SCREEN_ID.profile),
      onSettings: destination(ctx, SCREEN_ID.settings),
      onEditors: destination(ctx, SCREEN_ID.editors),
      onAbout: destination(ctx, SCREEN_ID.about),
    });
  };
}
