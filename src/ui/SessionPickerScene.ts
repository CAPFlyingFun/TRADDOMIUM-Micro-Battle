/**
 * The play flow as a scene of its own (registry id `session`), for
 * anything that wants to land on the "how to play" question directly. The
 * main menu reaches the same flow in place, without a scene swap.
 *
 * It runs the identical `PlayFlow` the menu does — how to play, then which
 * slot — so the two cannot ask the questions in a different order.
 *
 * Entering it puts the app in the `session` state; Back returns to `menu`.
 */
import type { SceneContext, SceneFactory } from '../app/Scene';
import { goToScreen, SCREEN_ID, startSession } from './navigation';
import { PlayFlow, type PlayFlowHooks } from './PlayFlow';
import { Screen, titledPanel, type Wire } from './screen';
import type { SessionOffers } from './SessionPicker';
import type { SoloPlay } from './MainMenuScene';

export class SessionPickerScene extends Screen {
  readonly name = 'session';
  private flow: PlayFlow | null = null;

  constructor(ctx: SceneContext, private readonly hooks: PlayFlowHooks) {
    super(ctx, 'menu');
  }

  override async enter(): Promise<void> {
    this.ctx.app.requestState('session');
    await super.enter();
  }

  protected build(root: HTMLElement): void {
    const panel = titledPanel(root, 'Play', { wide: true });
    this.flow = new PlayFlow(panel, null, this.hooks);
    this.flow.openSessions();
  }

  override dispose(): void {
    this.flow?.dispose();
    this.flow = null;
    super.dispose();
  }
}

/** `offers` builds the sessions and `play` opens a slot (the ui may not do either); the rest is navigation. */
export function createSessionPickerScene(offers: Wire<SessionOffers>, play: Wire<SoloPlay>): SceneFactory {
  return (ctx) => {
    const sessions = offers(ctx);
    const solo = play(ctx);
    return new SessionPickerScene(ctx, {
      sessions,
      onStart: (session) => startSession(ctx, session),
      onNewGame: (slot) => solo.newGame(slot),
      onResume: (slot) => solo.resume(slot),
      // This scene IS the flow: closing it means leaving the screen.
      onClose: () => goToScreen(ctx, SCREEN_ID.menu),
    });
  };
}
