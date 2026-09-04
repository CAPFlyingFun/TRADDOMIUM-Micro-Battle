/**
 * What every PLAYABLE world gets from the shell, so no world scene has to
 * build it: the session check, the pause menu, the Escape key, and the
 * save on the way out.
 *
 * A world scene (the Performance World today, Kauaʻi later) is written
 * against typed hooks — it reports "PAUSE was pressed" and hands over its
 * save point, nothing more — because what a pause MEANS (the app state,
 * whether the clock may stop, which overlay appears) and WHEN a save is
 * written are the app's decisions, not the scene's (ARCHITECTURE §2.7).
 * This wrapper is where those decisions are made, once.
 *
 * Order matters in `enter()`: the session is checked BEFORE the world
 * builds anything, so a world entered without a session (a stale link, a
 * dev shortcut) throws early and the SceneManager falls back to the menu
 * with nothing half-built; and the overlay is created AFTER the world's
 * own DOM, so it paints above the HUD.
 *
 * The overlay requests `paused` / `playing` itself. QUIT saves through the
 * world's save point first (the pose the player last saw, not the
 * pause-open one — the free-fly camera keeps flying under the menu), then
 * ends the session, which flushes, and then leaves through
 * `ui/navigation.quitToMenu`.
 */
import { PauseOverlay, quitToMenu } from '../ui';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from './Scene';

/** What the shell hands a world: where to report PAUSE, and where to hand its save point. */
export interface WorldShellHooks {
  /** PAUSE was pressed. */
  onPause(): void;
  /** The world can save now; calling `save` writes its current state through the app's session. */
  onSavePoint(save: () => Promise<void>): void;
}

/** Builds the world scene itself against the shell's hooks. */
export type WorldBuilder = (ctx: SceneContext, shell: WorldShellHooks) => AppScene;

export function withPauseMenu(build: WorldBuilder): SceneFactory {
  return (ctx: SceneContext): AppScene => {
    let pause: PauseOverlay | null = null;
    let offEscape: (() => void) | null = null;
    let savePoint: (() => Promise<void>) | null = null;
    const toggle = (): void => {
      if (!pause) return;
      if (pause.isOpen) pause.hide();
      else pause.show();
    };
    const world = build(ctx, {
      onPause: () => pause?.show(),
      onSavePoint: (save) => {
        savePoint = save;
      },
    });

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
          onQuit: () =>
            void (async () => {
              await savePoint?.();
              await quitToMenu(ctx);
            })(),
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
        savePoint = null;
        pause?.dispose();
        pause = null;
        world.dispose();
      },
    };
  };
}
