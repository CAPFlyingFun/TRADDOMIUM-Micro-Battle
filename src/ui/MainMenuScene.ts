/**
 * The front door: title, five buttons, and the build stamp so a phone can
 * say which build it is running.
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
import { actionRow, buttonColumn, footer, markUnavailable, Screen, titledPanel, type Wire } from './screen';
import { SessionPicker, type SessionOffers } from './SessionPicker';

export const GAME_TITLE = 'TRADDOMIUM: Micro Battle!';

export interface MainMenuHooks {
  /** Builds the sessions the in-place picker offers. */
  readonly sessions: SessionOffers;
  /** The player chose a session from the picker. */
  onStart(session: GameSession): void;
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
    this.column = buttonColumn(this.panel, [
      actionRow(ACTION.play, 'Play', () => this.openPicker(), { primary: true }),
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

function destinationButton(action: Action, label: string, go: Destination): HTMLButtonElement {
  const button = actionRow(action, label, () => go?.());
  return go ? button : markUnavailable(button);
}

/**
 * `offers` builds the sessions (the ui may not construct them). The four
 * destinations are looked up in the registry at construction, which is
 * after every registration has run, so an unregistered screen is shown
 * honestly instead of throwing on tap.
 */
export function createMainMenuScene(offers: Wire<SessionOffers>): SceneFactory {
  return (ctx) =>
    new MainMenuScene(ctx, {
      sessions: offers(ctx),
      onStart: (session) => startSession(ctx, session),
      onProfile: destination(ctx, SCREEN_ID.profile),
      onSettings: destination(ctx, SCREEN_ID.settings),
      onEditors: destination(ctx, SCREEN_ID.editors),
      onAbout: destination(ctx, SCREEN_ID.about),
    });
}
