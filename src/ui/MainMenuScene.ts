/**
 * The front door: title, the button column, and the build stamp so a
 * phone can say which build it is running.
 *
 * CONTINUE IS OFFERED ONLY WHEN THERE IS SOMETHING TO CONTINUE — v0's
 * rule, kept. It sits above PLAY, takes the gold, and says when the game
 * was last played, because a CONTINUE that drops the player somewhere
 * unexpected is worse than none. Whether a save exists, and whether this
 * build can open its world, is answered by the hooks: the menu shows what
 * it is handed and never reads the save document itself (§2.7).
 *
 * PLAY opens the session picker IN PLACE — the button column hides and the
 * two session cards take its spot inside the same panel — rather than
 * swapping scenes, so choosing how to play is one tap deep and there is
 * no fade between the title and the choice. The app state still walks
 * menu → session → loading, because the state is about what the app is
 * doing, not about which DOM is showing (AppState.ts).
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
import { actionRow, buttonColumn, footer, markUnavailable, namedButton, Screen, titledPanel, type Wire } from './screen';
import { SessionPicker, type SavedGame, type SessionOffers } from './SessionPicker';

export const GAME_TITLE = 'TRADDOMIUM: Micro Battle!';

/**
 * The `data-action` of the CONTINUE button. Outside the shared `ACTION`
 * vocabulary until integration adds it there; the loading screen's
 * press-to-continue shares the verb, and a probe tells them apart by the
 * screen they are on (`[data-screen="menu"] [data-action="continue"]`).
 */
export const MENU_CONTINUE_ACTION = 'continue';

export interface MainMenuHooks {
  /** Builds the sessions the in-place picker offers. */
  readonly sessions: SessionOffers;
  /** The player chose a session from the picker. */
  onStart(session: GameSession): void;
  /**
   * The saved solo game, or null when there is none this build can
   * resume — CONTINUE exists exactly when this is non-null. Read when the
   * menu builds, so the button reflects the device now, not the last visit.
   */
  savedGame(): SavedGame | null;
  /** CONTINUE was pressed, with the saved game it showed. */
  onContinue(saved: SavedGame): void;
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
  private picker: SessionPicker | null = null;

  constructor(ctx: SceneContext, private readonly hooks: MainMenuHooks) {
    super(ctx, 'menu');
  }

  protected build(root: HTMLElement): void {
    this.panel = titledPanel(root, GAME_TITLE, { hero: true, subtitle: 'You are the ant.', wide: true });
    const saved = this.hooks.savedGame();
    // With a save, continuing is the point of the screen and takes the gold; PLAY steps back to a plain button.
    const play = actionRow(ACTION.play, 'Play', () => this.openPicker(), { primary: saved === null });
    this.column = buttonColumn(this.panel, [
      ...(saved ? [continueButton(saved, () => this.hooks.onContinue(saved), Date.now())] : []),
      play,
      destinationButton(ACTION.profile, 'Profile', this.hooks.onProfile),
      destinationButton(ACTION.settings, 'Settings', this.hooks.onSettings),
      destinationButton(ACTION.editors, 'Editors', this.hooks.onEditors),
      destinationButton(ACTION.about, 'About', this.hooks.onAbout),
    ]);
    this.stamp = footer(this.panel, buildStamp());
  }

  override dispose(): void {
    this.picker?.dispose();
    this.picker = null;
    super.dispose();
  }

  private openPicker(): void {
    if (this.picker || !this.panel || !this.column) return;
    this.column.hidden = true;
    this.picker = new SessionPicker(this.panel, {
      solo: () => this.hooks.sessions.solo(),
      multiplayer: () => this.hooks.sessions.multiplayer(),
      onStart: (session) => this.hooks.onStart(session),
      onBack: () => this.closePicker(),
    });
    // Above the build stamp, where the buttons were.
    if (this.stamp) this.panel.insertBefore(this.picker.element, this.stamp);
    this.ctx.app.requestState('session');
  }

  private closePicker(): void {
    this.picker?.dispose();
    this.picker = null;
    if (this.column) this.column.hidden = false;
    this.ctx.app.requestState('menu');
  }
}

/**
 * CONTINUE with its "Last played …" line INSIDE the button: the column
 * is already six rows tall on a 430 px phone, and a seventh row for a
 * caption would push the build stamp off the panel.
 */
function continueButton(saved: SavedGame, onClick: () => void, nowMs: number): HTMLButtonElement {
  const button = namedButton(MENU_CONTINUE_ACTION, 'Continue', onClick, { primary: true });
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

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Calendar-rough on purpose: the line answers "is this the game I remember", not "when exactly". */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * "just now", "3 minutes ago", "yesterday", "2 weeks ago" — the roughest
 * honest unit. A stamp in the future (a phone whose clock was set back)
 * reads as "just now" rather than as a negative number, and a stamp that
 * does not parse reads as "some time ago": the save is still real, only
 * its clock is not, and inventing a time for it would not be.
 */
export function timeAgo(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'some time ago';
  const ago = nowMs - then;
  if (ago < MINUTE_MS) return 'just now';
  if (ago < HOUR_MS) return plural(Math.floor(ago / MINUTE_MS), 'minute');
  if (ago < DAY_MS) return plural(Math.floor(ago / HOUR_MS), 'hour');
  if (ago < 2 * DAY_MS) return 'yesterday';
  if (ago < 7 * DAY_MS) return plural(Math.floor(ago / DAY_MS), 'day');
  if (ago < MONTH_MS) return plural(Math.floor(ago / (7 * DAY_MS)), 'week');
  if (ago < YEAR_MS) return plural(Math.floor(ago / MONTH_MS), 'month');
  return plural(Math.floor(ago / YEAR_MS), 'year');
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}

/**
 * `offers` builds the sessions (the ui may not construct them) and says
 * whether there is a saved game to continue. The four destinations are
 * looked up in the registry at construction, which is after every
 * registration has run, so an unregistered screen is shown honestly
 * instead of throwing on tap.
 */
export function createMainMenuScene(offers: Wire<SessionOffers>): SceneFactory {
  return (ctx) => {
    const sessions = offers(ctx);
    return new MainMenuScene(ctx, {
      sessions,
      onStart: (session) => startSession(ctx, session),
      savedGame: () => sessions.saved?.() ?? null,
      onContinue: (saved) => startSession(ctx, saved.session),
      onProfile: destination(ctx, SCREEN_ID.profile),
      onSettings: destination(ctx, SCREEN_ID.settings),
      onEditors: destination(ctx, SCREEN_ID.editors),
      onAbout: destination(ctx, SCREEN_ID.about),
    });
  };
}
