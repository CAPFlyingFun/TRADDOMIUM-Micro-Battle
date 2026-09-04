/**
 * How the ui moves the app: the few lines every front-door screen would
 * otherwise repeat, written once so the state-machine order is in one place.
 *
 * Only `app/` is imported (the registry and the scene context), which the
 * dependency map allows: ui → app is how screens reach the transition choke
 * point. Nothing here knows what a scene contains.
 */
import { listScenes, sceneFactory } from '../app/registry';
import type { SceneContext } from '../app/Scene';
import type { GameSession } from '../session/GameSession';

/**
 * A menu destination: a callback, or `null` when the scene it would open is
 * not registered in this build. A screen renders null as a disabled button
 * whose label says so — an unavailable action must never look functional,
 * and a click that throws "No scene registered" is neither honest nor safe.
 */
export type Destination = (() => void) | null;

/** Registry ids of the ui's own screens. Integration registers these (see ui/index.ts). */
export const SCREEN_ID = {
  menu: 'menu',
  session: 'session',
  settings: 'settings',
  about: 'about',
  loading: 'loading',
  profile: 'profile',
  /** Owned by devtools/; the menu only needs to know its door. */
  editors: 'editors',
} as const;

export type ScreenId = (typeof SCREEN_ID)[keyof typeof SCREEN_ID];

/**
 * Open a front-door screen. Every front-door screen lives in the `menu`
 * app state (AppState.ts), and `menu` is reachable from every state, so the
 * request is always legal.
 */
export function goToScreen(ctx: SceneContext, id: ScreenId): void {
  ctx.app.requestState('menu');
  void ctx.scenes.goTo(sceneFactory(id));
}

/** `goToScreen` as a Destination, or null when the id is not registered. */
export function destination(ctx: SceneContext, id: ScreenId): Destination {
  return listScenes().includes(id) ? () => goToScreen(ctx, id) : null;
}

/**
 * The player chose a session: the app holds it, the state walks to
 * `loading`, and the loading screen asks for the world from inside its own
 * transition. Legal from `menu` (in-place picker) and `session` (picker scene).
 */
export function startSession(ctx: SceneContext, session: GameSession): void {
  ctx.app.startSession(session);
  ctx.app.requestState('loading');
  void ctx.scenes.goTo(sceneFactory(SCREEN_ID.loading));
}

/**
 * Leave the world for the menu. The session is ended FIRST so its `leave()`
 * flushes the save while the world still exists to save.
 */
export async function quitToMenu(ctx: SceneContext): Promise<void> {
  await ctx.app.endSession();
  ctx.app.requestState('menu');
  await ctx.scenes.goTo(sceneFactory(SCREEN_ID.menu));
}
