/**
 * The session picker as a scene of its own (registry id `session`), for
 * anything that wants to land on it directly. The main menu reaches the
 * same picker in place, without a scene swap.
 *
 * Entering it puts the app in the `session` state; Back returns to `menu`.
 */
import type { SceneContext, SceneFactory } from '../app/Scene';
import { goToScreen, SCREEN_ID, startSession } from './navigation';
import { Screen, titledPanel, type Wire } from './screen';
import { SessionPicker, type SessionOffers, type SessionPickerHooks } from './SessionPicker';

export class SessionPickerScene extends Screen {
  readonly name = 'session';
  private picker: SessionPicker | null = null;

  constructor(ctx: SceneContext, private readonly hooks: SessionPickerHooks) {
    super(ctx, 'menu');
  }

  override async enter(): Promise<void> {
    this.ctx.app.requestState('session');
    await super.enter();
  }

  protected build(root: HTMLElement): void {
    const panel = titledPanel(root, 'Play', { wide: true });
    this.picker = new SessionPicker(panel, this.hooks);
  }

  override dispose(): void {
    this.picker?.dispose();
    this.picker = null;
    super.dispose();
  }
}

/** `offers` builds the sessions (the ui may not construct them); the rest is navigation. */
export function createSessionPickerScene(offers: Wire<SessionOffers>): SceneFactory {
  return (ctx) => {
    const sessions = offers(ctx);
    return new SessionPickerScene(ctx, {
      solo: () => sessions.solo(),
      multiplayer: () => sessions.multiplayer(),
      onStart: (session) => startSession(ctx, session),
      onBack: () => goToScreen(ctx, SCREEN_ID.menu),
    });
  };
}
