/**
 * The composition list: every navigable scene and every dev tool this
 * build contains, registered in one place so what exists can be read top
 * to bottom (ARCHITECTURE §3; `registry.ts` explains why leaf modules do
 * not register themselves).
 *
 * This lives BESIDE `registry.ts` rather than inside it: the registry is a
 * pure Map that core `world/WorldLoader` imports, and this file pulls in
 * three and the DOM through every screen it registers.
 *
 * Each leaf exports factories with typed hooks. What a screen may not
 * construct itself — a session, the profile store, load progress, the
 * settings document — is built here from the `SceneContext`, and only
 * here, so there is one place to look when the wiring is wrong.
 */
import { DEVTOOLS_SCENE_ID, createDevToolsHubScene, registerTool } from '../devtools';
import { createPerformanceWorldScene } from '../perf/PerformanceWorldScene';
import { PERF_WORLD_MAP_ID, PERF_WORLD_SCENE_ID, perfWorldTool } from '../perf/perfTool';
import { LocalSoloSession, SOLO_SAVE_SPEC } from '../session/LocalSoloSession';
import { MAX_DISPLAY_NAME, PLAYER_PROFILE_SPEC, loadProfile, setDisplayName } from '../session/PlayerProfile';
import { RemoteMultiplayerSession } from '../session/RemoteMultiplayerSession';
import {
  SCREEN_ID,
  createAboutScene,
  createLoadingScene,
  createMainMenuScene,
  createProfileScene,
  createSessionPickerScene,
  createSettingsScene,
  goToScreen,
  openSettings,
  startSession,
  type LoadingHooks,
  type ProfileSource,
  type SessionOffers,
} from '../ui';
import { LoadProgress } from '../world/LoadProgress';
import { WORLD_SCENE_PREFIX, resolveWorld } from '../world/WorldLoader';
import type { SceneContext } from './Scene';
import { registerScene, sceneFactory } from './registry';
import { withPauseMenu } from './worldShell';

/**
 * Player-facing names for the worlds a session can carry. A map id is an
 * identifier; the loading screen's heading is read by a person.
 */
const WORLD_TITLES: Readonly<Record<string, string>> = {
  [PERF_WORLD_MAP_ID]: perfWorldTool.title,
};

function worldTitle(mapId: string): string {
  return WORLD_TITLES[mapId] ?? mapId;
}

/**
 * The handoff between the loading screen and the world it waits for. The
 * loader draws this; the world's `enter()` reports into it through its
 * `onLoadProgress` hook. One milestone, because a world reports one
 * already-weighted fraction (its own milestones are its business).
 *
 * KNOWN LIMIT (Phase 0). `SceneManager.goTo` disposes the loader before
 * the world's `enter()` runs, so today the bar is drawn at 0 % behind the
 * fade and the world appears when it is ready. That is honest — nothing
 * has loaded while the loader is visible — and the empty world loads in
 * one frame anyway. When a world has real load time (the Phase 2 DEM), the
 * transition needs a hold-until-ready shape so the loader stays current
 * while the world enters; the wiring here already carries the progress.
 */
const worldLoad = new LoadProgress();
const WORLD_MILESTONE = 'world';

/** The sessions the menu and the picker offer. Both carry the only world that exists. */
const offers = (ctx: SceneContext): SessionOffers => ({
  solo: () => new LocalSoloSession(ctx.storage.open(SOLO_SAVE_SPEC), PERF_WORLD_MAP_ID),
  multiplayer: () => new RemoteMultiplayerSession(PERF_WORLD_MAP_ID),
});

const loading = (ctx: SceneContext): LoadingHooks => {
  const session = ctx.app.session;
  // Thrown from the factory, so the SceneManager's fallback returns the player to the menu.
  if (!session) throw new Error('loading screen entered without a session');
  const world = resolveWorld({ id: session.mapId, layers: [] });
  worldLoad.define([{ id: WORLD_MILESTONE, weight: 1 }]);
  return {
    caption: `Loading ${worldTitle(session.mapId)}`,
    progress: worldLoad,
    // Queued behind the loader's own transition; the world's enter() does the loading.
    onEnter: () => void ctx.scenes.goTo(world),
    // The world enters itself when ready; there is no press-to-continue gate.
    canContinue: () => false,
    onContinue: () => {},
  };
};

const profile = (ctx: SceneContext): ProfileSource => {
  const store = ctx.storage.open(PLAYER_PROFILE_SPEC);
  return {
    read: () => loadProfile(store),
    setDisplayName: (name) => setDisplayName(store, name),
    maxNameLength: MAX_DISPLAY_NAME,
  };
};

export function registerScenes(): void {
  // Front door. Every screen here lives in the `menu` app state.
  registerScene(SCREEN_ID.menu, createMainMenuScene(offers));
  registerScene(SCREEN_ID.session, createSessionPickerScene(offers));
  registerScene(SCREEN_ID.settings, createSettingsScene);
  registerScene(SCREEN_ID.about, createAboutScene);
  registerScene(SCREEN_ID.profile, createProfileScene(profile));
  registerScene(SCREEN_ID.loading, createLoadingScene(loading));

  // The Performance World: the benchmark scene, and in Phase 0 the only
  // world. It reaches the settings it can honour through a hook, because
  // perf/ may not import ui/ (§3).
  registerScene(
    PERF_WORLD_SCENE_ID,
    withPauseMenu((ctx, onPause) =>
      createPerformanceWorldScene({
        onPause,
        onLoadProgress: (fraction) => worldLoad.report(WORLD_MILESTONE, fraction),
        settings: () => openSettings(ctx.storage).read(),
      })(ctx),
    ),
  );

  // Dev tools. The Performance World is registered FIRST so the hub lists
  // it first (§12); `listTools` keeps registration order for this reason.
  registerTool({
    ...perfWorldTool,
    description:
      'A free-fly camera over an empty grid, with raw frame time and sim dt read out as two separate ' +
      'numbers. World layers join it as they are built so each can be measured alone.',
  });
  registerScene(
    DEVTOOLS_SCENE_ID,
    createDevToolsHubScene((ctx) => ({
      openScene: (id) => {
        if (id.startsWith(WORLD_SCENE_PREFIX)) {
          // A world needs a session (its pause menu reads one) and enters
          // through the loading screen, exactly as PLAY → SOLO does. A tool
          // opened this way IS a solo game in that world, and quitting from
          // its pause menu lands on the main menu like any other game.
          const mapId = id.slice(WORLD_SCENE_PREFIX.length);
          startSession(ctx, new LocalSoloSession(ctx.storage.open(SOLO_SAVE_SPEC), mapId));
          return;
        }
        // A tool scene of its own stays in the `menu` state, like any front-door screen.
        void ctx.scenes.goTo(sceneFactory(id));
      },
      onBack: () => goToScreen(ctx, SCREEN_ID.menu),
    })),
  );
}
