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
import {
  DEVTOOLS_SCENE_ID, NET_LAB_SCENE_ID, createDevToolsHubScene, createNetworkLabScene, netLabTool, registerTool,
} from '../devtools';
import { playerId } from '../actor/PlayerId';
import { PRACTICE_BOT_NAME, RELAY_QUERY_PARAM, resolveRelayUrl, toRoomSocketUrl } from '../net';
import { createPerformanceWorldScene } from '../perf/PerformanceWorldScene';
import { fetchCoarseDem } from '../assets/demSource';
import { TIER_QUERY_PARAM, isTextureTier, type TextureTier } from '../assets/textureQuality';
import { PERF_WORLD_MAP_ID, PERF_WORLD_SCENE_ID, perfWorldTool } from '../perf/perfTool';
import {
  LocalSoloSession, isSoloSlot, newSoloGame, readSoloSlots, resumeSoloSlot, restorableStateOf, savedSoloGame,
  soloSlotSpec, toolSoloSlot, type KnownMap, type SoloSlot,
} from '../session/LocalSoloSession';
import {
  MAX_DISPLAY_NAME, PLAYER_PROFILE_SPEC, loadProfile, playerIdOf, setDisplayName,
} from '../session/PlayerProfile';
import { RemoteMultiplayerSession } from '../session/RemoteMultiplayerSession';
import {
  BUILD_INFO,
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
  type SoloPlay,
} from '../ui';
import { LoadProgress } from '../world/LoadProgress';
import { WORLD_SCENE_PREFIX, resolveWorld, worldSceneId } from '../world/WorldLoader';
import type { SceneContext } from './Scene';
import { listScenes, registerScene, sceneFactory } from './registry';
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

/**
 * Does this build carry a world for the map a save names? Read from the
 * registry AT CALL TIME — after every `registerScene` below has run — so
 * the save store can refuse a save on a world that is not here, and the
 * menu never offers a CONTINUE into nothing. session/ may not read the
 * registry itself (§3); this is the one predicate it is handed.
 */
const hasWorld: KnownMap = (mapId) => listScenes().includes(worldSceneId(mapId));

/** One slot's save store, opened with the world predicate so every reader agrees on what counts. */
const soloSlotStore = (ctx: SceneContext, slot: SoloSlot) => ctx.storage.open(soloSlotSpec(slot, hasWorld));

/**
 * THE RELAY THIS RUN USES, resolved once, in the one place allowed to
 * read the address bar: `net/relayConfig.ts` is core and may not name a
 * browser global, so the `?relay=` override is read here and passed in
 * (that is also what lets a probe point the running build at
 * `npm run relay:dev` on 127.0.0.1). Empty is the honest no-relay case
 * and is what a build made with `TRADDOMIUM_RELAY_URL=` gets.
 *
 * Read at module scope because it cannot change without a reload, and
 * guarded because this module is also imported by node tests, where
 * there is no address bar at all.
 */
const RELAY_URL = resolveRelayUrl(
  typeof globalThis.location === 'undefined'
    ? null
    : new URLSearchParams(globalThis.location.search).get(RELAY_QUERY_PARAM),
  BUILD_INFO.relayUrl,
);

/**
 * THE TEXTURE RUNG THIS RUN USES when the address bar names one, read in
 * the same place and for the same reason as `?relay=` above: the rule is
 * `assets/textureQuality.ts`'s, which is pure and may not name a browser
 * global, so the parameter is read here and handed in.
 *
 * Null is the ordinary case and means the player's quality setting
 * decides. `?tier=ultra-low` is the one CLAUDE.md asks for by name — the
 * rung a phone cannot otherwise select — and every other rung works too,
 * which is what makes a tier sweep possible from one build.
 *
 * Module scope, guarded, because it cannot change without a reload and
 * this module is imported by node tests that have no address bar.
 */
const TIER_NAMED = typeof globalThis.location === 'undefined'
  ? null
  : new URLSearchParams(globalThis.location.search).get(TIER_QUERY_PARAM);
const TIER_OVERRIDE: TextureTier | null = isTextureTier(TIER_NAMED) ? TIER_NAMED : null;

/**
 * The sessions and slots the menu and the picker offer. Both carry the
 * only world that exists; `slots` is the three save documents as the
 * player sees them, and `saved` is the newest game among them — what
 * RESUME names and, when it is the only one, opens.
 *
 * `solo()` is read for its CAPTION, never started: which slot a solo game
 * writes to is decided one screen later, and the session that carries it
 * is built then, by `play` below.
 *
 * `multiplayer()` is the same shape twice over. WITHOUT a room it carries
 * no relay URL and is the pinned no-relay mock — which is what a build
 * made with `TRADDOMIUM_RELAY_URL=` shows on its card. WITH one it is the
 * session for THAT room, built from the relay address and the code the
 * player typed, and it holds the wire the world then drives:
 * `toRoomSocketUrl` throws on an address that is not one, so a mistyped
 * `?relay=` is a message under the field rather than a socket opened
 * somewhere unintended.
 *
 * In a build that HAS a relay the picker never shows the room-less
 * session's caption: the card describes the build's multiplayer, whose
 * facts arrive through `rooms()` and whose words are the ui's own
 * (`SessionPicker.ROOMS_CAPTION`). A session with no room describes no
 * room, and printing its "no relay configured" line beside a working
 * JOIN button would be the one thing the honesty rule forbids — a
 * caption that is not true of the build the player is holding.
 *
 * `rooms` is present only when there IS a relay, and its presence is the
 * whole of how the ui learns that the room step exists.
 */
const offers = (ctx: SceneContext): SessionOffers => ({
  solo: () => new LocalSoloSession(soloSlotStore(ctx, 1), PERF_WORLD_MAP_ID),
  multiplayer: (room, options) =>
    new RemoteMultiplayerSession(PERF_WORLD_MAP_ID, {
      relayUrl: room === undefined || room === '' ? '' : toRoomSocketUrl(RELAY_URL, room),
      // Only the room screen can ask for one, so a session with no room
      // never carries a bot: there would be no room to put it in.
      practiceBot: options?.practiceBot === true,
    }),
  ...(RELAY_URL === '' ? {} : { rooms: () => ({ relayUrl: RELAY_URL }) }),
  slots: () => readSoloSlots(ctx.storage.kv, hasWorld),
  saved: () => {
    const newest = savedSoloGame(ctx.storage.kv, hasWorld);
    return newest === null ? null : { slot: newest.slot, savedAt: newest.savedAt };
  },
});

/**
 * The two ways into a solo game, once a slot has been chosen on screen.
 *
 * A slot number arrives from a DOM control, so it is checked against the
 * slots this build has before it names a save document — the ui is trusted
 * to ask the question, never to be the only thing that got the answer
 * right. A slot that is not one of ours does nothing at all rather than
 * writing somewhere unexpected.
 *
 * NEW GAME opens the map this build ships. RESUME opens the map the save
 * itself names, which is why it goes through the save rather than through
 * a default: a resume onto the wrong world is a camera in the sea.
 */
const play = (ctx: SceneContext): SoloPlay => ({
  newGame: (slot) => {
    if (!isSoloSlot(slot)) return;
    startSession(ctx, newSoloGame(ctx.storage.kv, hasWorld, slot, PERF_WORLD_MAP_ID));
  },
  resume: (slot) => {
    if (!isSoloSlot(slot)) return;
    const saved = resumeSoloSlot(ctx.storage.kv, hasWorld, slot);
    if (saved) startSession(ctx, saved.session);
  },
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

/** How the survey reaches the world. The shape of `PerformanceWorldHooks.survey`. */
export type SurveySource = (onBytes: (received: number, total: number | null) => void) => Promise<ArrayBuffer>;

export interface RegisterScenesOptions {
  /**
   * Where the elevation survey comes from.
   *
   * Omit for the deployed files, which is what the app does. Pass `null`
   * for a world with NO terrain — what a test of the menus, the pause
   * menu or the save slots wants, since none of them is about downloading
   * two megabytes and all of them would otherwise wait out its retry
   * backoff. Pass a function to serve it from somewhere else.
   */
  readonly survey?: SurveySource | null;
}

export function registerScenes(options: RegisterScenesOptions = {}): void {
  const survey: SurveySource | undefined = options.survey === null
    ? undefined
    : options.survey ?? ((onBytes) => fetchCoarseDem({ onBytes }));
  // Front door. Every screen here lives in the `menu` app state.
  registerScene(SCREEN_ID.menu, createMainMenuScene(offers, play));
  registerScene(SCREEN_ID.session, createSessionPickerScene(offers, play));
  registerScene(SCREEN_ID.settings, createSettingsScene);
  registerScene(SCREEN_ID.about, createAboutScene);
  registerScene(SCREEN_ID.profile, createProfileScene(profile));
  registerScene(SCREEN_ID.loading, createLoadingScene(loading));

  // The Performance World: the benchmark scene, and in Phase 0 the only
  // world. It reaches the settings it can honour through a hook, because
  // perf/ may not import ui/ (§3).
  // The camera resumes from whatever the session can restore (the solo
  // save on this device; nothing for the multiplayer mock), and the shell
  // takes the world's save point so QUIT writes the pose the player last saw.
  registerScene(
    PERF_WORLD_SCENE_ID,
    withPauseMenu((ctx, shell) =>
      createPerformanceWorldScene({
        onPause: shell.onPause,
        onSavePoint: shell.onSavePoint,
        onLoadProgress: (fraction) => worldLoad.report(WORLD_MILESTONE, fraction),
        // THE SURVEY, wired here and nowhere else. The scene takes it as
        // a hook so that constructing it does not reach the network; this
        // is the one place that says the terrain is the deployed files.
        survey,
        settings: () => openSettings(ctx.storage).read(),
        tierOverride: TIER_OVERRIDE,
        resume: () => restorableStateOf(ctx.app.session),
        // WHO THIS PLAYER IS ON THE WIRE, read only when the world asks —
        // which it does only for a session that holds a transport. The
        // same two facts the Network Lab presents for its "A" player, from
        // the same device profile, so the capsule a room shows other
        // players is this device's own identity and not a per-session
        // invention. Without this hook a multiplayer world opens no link
        // at all and the HUD reads "Not connected": honest, but not a game.
        identity: () => {
          const p = loadProfile(ctx.storage.open(PLAYER_PROFILE_SPEC));
          return { playerId: playerIdOf(p), name: p.displayName };
        },
        // THE PRACTICE BOT'S OWN IDENTITY, minted here because a world may
        // not mint one: it is a second player in the room and the
        // authority keys players by this id (`net/Host.ts`). Fresh every
        // time the world enters, so a bot from a previous visit can never
        // be re-attached to by mistake — and never this device's own id,
        // which would make the authority hand the player's own actor to
        // the bot. Whether a bot is wanted at all is the SESSION's answer;
        // this hook only says who it would be.
        practiceBot: () => ({
          playerId: playerId(`practice-bot-${crypto.randomUUID()}`),
          name: PRACTICE_BOT_NAME,
        }),
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
          // through the loading screen, exactly as NEW GAME → SOLO does. A
          // tool opened this way IS a solo game in that world, and quitting
          // from its pause menu lands on the main menu like any other game.
          // `toolSoloSlot` decides which slot without ever silently
          // replacing a game the player can still reach (LocalSoloSession).
          const mapId = id.slice(WORLD_SCENE_PREFIX.length);
          const slot = toolSoloSlot(ctx.storage.kv, hasWorld, mapId);
          startSession(ctx, new LocalSoloSession(soloSlotStore(ctx, slot), mapId));
          return;
        }
        // A tool scene of its own stays in the `menu` state, like any front-door screen.
        void ctx.scenes.goTo(sceneFactory(id));
      },
      onBack: () => goToScreen(ctx, SCREEN_ID.menu),
    })),
  );

  // The Network Lab (Phase 1): one host and two loopback clients in this
  // tab, no server. A plain tool scene in the `menu` state — it holds no
  // session, so it is not a `world:` id and needs no loading screen. Its
  // "A" player is this device's profile, the same identity a real session
  // would present.
  registerTool(netLabTool);
  registerScene(
    NET_LAB_SCENE_ID,
    createNetworkLabScene((ctx) => ({
      identity: () => {
        const p = loadProfile(ctx.storage.open(PLAYER_PROFILE_SPEC));
        return { playerId: playerIdOf(p), name: p.displayName };
      },
      onBack: () => goToScreen(ctx, SCREEN_ID.editors),
    })),
  );
}
