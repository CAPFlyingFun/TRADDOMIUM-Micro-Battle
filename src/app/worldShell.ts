/**
 * What every PLAYABLE world gets from the shell, so no world scene has to
 * build it: the session check, the pause menu, and the Escape key.
 *
 * A world scene (the Performance World today, Kauaʻi later) is written
 * against typed hooks — it reports "PAUSE was pressed" and nothing more,
 * because what a pause MEANS (the app state, whether the clock may stop,
 * which overlay appears) is the app's decision, not the scene's
 * (ARCHITECTURE §2.7). This wrapper is where that decision is made, once.
 *
 * Order matters in `enter()`: the session is checked BEFORE the world
 * builds anything, so a world entered without a session (a stale link, a
 * dev shortcut) throws early and the SceneManager falls back to the menu
 * with nothing half-built; and the overlay is created AFTER the world's
 * own DOM, so it paints above the HUD.
 *
 * The overlay requests `paused` / `playing` itself; QUIT ends the session
 * first (flushing the save while the world still exists) and then leaves,
 * through `ui/navigation.quitToMenu`.
 */
import { PauseOverlay, quitToMenu } from '../ui';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from './Scene';

/** Builds the world scene itself; `onPause` is the hook it fires when its PAUSE control is pressed. */
export type WorldBuilder = (ctx: SceneContext, onPause: () => void) => AppScene;

export function withPauseMenu(build: WorldBuilder): SceneFactory {
  return (ctx: SceneContext): AppScene => {
    let pause: PauseOverlay | null = null;
    let offEscape: (() => void) | null = null;
    const toggle = (): void => {
      if (!pause) return;
      if (pause.isOpen) pause.hide();
      else pause.show();
    };
    const world = build(ctx, () => pause?.show());

    return {
      name: world.name,
      three: world.three,
      camera: world.camera,

      async enter() {
        const session = ctx.app.session;
        if (!session) throw new Error(`${world.name} entered without a session`);
        await world.enter();
        pause = new PauseOverlay(ctx, {
          session,
          onResume: () => {},
          onQuit: () => void quitToMenu(ctx),
        });
        // Escape toggles the menu on a keyboard. On a phone the PAUSE control does it.
        offEscape = ctx.input.onKeyDown((code) => {
          if (code === 'Escape') toggle();
        });
      },

      update(frame: FrameInfo) {
        world.update(frame);
      },

      resize(width: number, height: number) {
        world.resize(width, height);
      },

      renderOverlays() {
        world.renderOverlays?.();
      },

      dispose() {
        offEscape?.();
        offEscape = null;
        pause?.dispose();
        pause = null;
        world.dispose();
      },
    };
  };
}
