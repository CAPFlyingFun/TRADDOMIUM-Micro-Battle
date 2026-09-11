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
import { yawForHeading } from '../perf/FreeFlyCamera';
import { SPAWN_MAP_SCENE_ID, createSpawnMapScene } from '../map/SpawnMapScene';
import type { SpawnCandidate } from '../world/spawn';
import type { CameraPose } from '../session/GameSession';
import { fetchCoarseDem } from '../assets/demSource';
import { fetchVeg } from '../assets/vegSource';
import { TIER_QUERY_PARAM, isTextureTier, type TextureTier } from '../assets/textureQuality';
import { DETAIL_QUERY_PARAM, isDetailTier, type DetailTier } from '../assets/detailQuality';
import { OpenMeteo } from '../assets/openMeteo';
import { weatherCacheOver } from '../persistence/weatherCache';
import { heldHourMs } from '../world/weather/solar';
import { isBuiltSky, type Sky } from '../world/weather/weather';
import { PERF_WORLD_MAP_ID, PERF_WORLD_SCENE_ID, perfWorldTool } from '../perf/perfTool';
import { LAB_SCENE_ID, createCreatureLabScene, creatureLabTool } from '../lab';
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
 * THE OTHER LADDER'S OVERRIDE: `?detail=`, read here for the same reason
 * and in the same breath as `?tier=` above.
 *
 * Since 2026-09-05 rendering detail and texture size are separate
 * settings (Joshua: "could do a random combination"), so they need
 * separate doors — and having both means a tier sweep can hold one axis
 * still while it moves the other, which is the only way to find out
 * which of the two a device is actually spending its frame on.
 */
const DETAIL_NAMED = typeof globalThis.location === 'undefined'
  ? null
  : new URLSearchParams(globalThis.location.search).get(DETAIL_QUERY_PARAM);
const DETAIL_OVERRIDE: DetailTier | null = isDetailTier(DETAIL_NAMED) ? DETAIL_NAMED : null;

/**
 * THE SKY'S TWO OVERRIDES: `?sky=clear|cloudy|rain` holds the simulated
 * weather at a sky, and `?hour=0..24` holds the island's clock at an
 * HST hour, so `probe:sky` can photograph noon, dusk and night in one
 * run and a developer can look at a rain that is not falling today.
 * Read here for the same reason as `?tier=` — this is the one file that
 * reads the address bar — and, like it, an override and never a
 * setting: nothing is stored, and the HUD's sky line says `sim` while
 * one is in force, so a held sky can never be mistaken for the island's.
 */
const SKY_QUERY_PARAM = 'sky';
const HOUR_QUERY_PARAM = 'hour';
const SKY_NAMED = typeof globalThis.location === 'undefined'
  ? null
  : new URLSearchParams(globalThis.location.search).get(SKY_QUERY_PARAM);
const SKY_OVERRIDE: Sky | null = isBuiltSky(SKY_NAMED) ? SKY_NAMED : null;
const HOUR_NAMED = typeof globalThis.location === 'undefined'
  ? null
  : new URLSearchParams(globalThis.location.search).get(HOUR_QUERY_PARAM);
const HOUR_OVERRIDE: number | null = HOUR_NAMED !== null && Number.isFinite(Number(HOUR_NAMED)) && Number(HOUR_NAMED) >= 0 && Number(HOUR_NAMED) < 24
  ? Number(HOUR_NAMED)
  : null;

/**
 * The clock the world reads. Real time, or — under `?hour=` — today's
 * date held at that HST hour, frozen, so the sun stands still for a
 * screenshot. Today's date and not a fixed one: the sun's height at a
 * given hour depends on the season, and a probe run in December should
 * show December's noon.
 */
function worldClock(): () => number {
  if (HOUR_OVERRIDE === null) return () => Date.now();
  // `heldHourMs` is the one rule for "that hour on the island today"
  // (`world/weather/solar.ts`); the player's time slider holds the sky
  // with the same function, so the address bar and the control cannot
  // drift apart.
  const held = heldHourMs(Date.now(), HOUR_OVERRIDE);
  return () => held;
}

/**
 * WHICH SLOT THE SPAWN MAP IS CHOOSING FOR.
 *
 * NEW GAME now asks WHERE before it opens a world, so the slot the player
 * picked has to survive one screen. It is a single value on the way from
 * the slot picker to the map and back, cleared the moment it is used — a
 * latch that is genuinely needed is one named thing rather than loose
 * fields (CLAUDE.md), and this is the whole of it.
 *
 * Null means nobody is mid-flow: a map opened any other way starts
 * nothing, which is what should happen to a reload on that screen.
 */
let spawningInto: SoloSlot | null = null;

/**
 * How far above the ground a chosen start stands, in world units. 30 m —
 * the same clearance a resumed camera is lifted to, and enough to be over
 * the drawn surface rather than in it, since core validated the candidate
 * against the smooth survey and the clipmap draws chords of it.
 */
const SPAWN_CLEARANCE = 3_000;

/**
 * A chosen place as a camera pose.
 *
 * HERE AND NOT IN THE MAP. The map hands back a region and a candidate,
 * which are world facts; what a camera does with them — the half turn
 * between an actor heading and a camera yaw, how high it floats, how far
 * it looks down — belongs to the layer that owns the camera. A map that
 * knew about yaw would have to change every time the camera did.
 */
const poseFor = (candidate: SpawnCandidate): CameraPose => ({
  at: candidate.at,
  height: candidate.ground + SPAWN_CLEARANCE,
  yaw: yawForHeading(candidate.heading),
  // Looking slightly down, so the ground you chose is in frame on arrival
  // rather than the sky above it.
  pitch: -0.25,
});

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
    // ASK WHERE FIRST. The save is not written and the slot is not
    // cleared until a place is chosen, so backing out of the map leaves
    // whatever was in the slot untouched — a new game that had already
    // thrown the old one away before the player committed would be the
    // one destructive path with no confirmation in front of it.
    spawningInto = slot;
    goToScreen(ctx, SCREEN_ID.spawn);
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
  /**
   * Where the landcover raster comes from. Same three answers as the
   * survey; defaults to the deployed file, and to nothing when the
   * survey is `null` — there is nothing to grow on without terrain.
   */
  readonly landcover?: SurveySource | null;
}

export function registerScenes(options: RegisterScenesOptions = {}): void {
  const survey: SurveySource | undefined = options.survey === null
    ? undefined
    : options.survey ?? ((onBytes) => fetchCoarseDem({ onBytes }));
  const landcover: SurveySource | undefined = options.landcover === null || options.survey === null
    ? undefined
    : options.landcover ?? ((onBytes) => fetchVeg({ onBytes }));
  // Front door. Every screen here lives in the `menu` app state.
  registerScene(SCREEN_ID.menu, createMainMenuScene(offers, play));
  registerScene(SCREEN_ID.session, createSessionPickerScene(offers, play));
  registerScene(SCREEN_ID.settings, createSettingsScene);
  registerScene(SCREEN_ID.about, createAboutScene);
  registerScene(SCREEN_ID.profile, createProfileScene(profile));
  registerScene(SCREEN_ID.loading, createLoadingScene(loading));
  // WHERE THE COLONY BEGINS, between the slot picker and the world.
  // It takes the same survey the world does, because it paints the island
  // out of the same heightfield rather than out of a shipped picture.
  registerScene(SPAWN_MAP_SCENE_ID, createSpawnMapScene((ctx) => ({
    survey,
    onBack: () => {
      spawningInto = null;
      goToScreen(ctx, SCREEN_ID.menu);
    },
    // No survey, no island, no choice to make — so this is what NEW GAME
    // did before the map existed, unchanged.
    onDefault: () => {
      const slot = spawningInto;
      if (slot === null) return;
      spawningInto = null;
      startSession(ctx, newSoloGame(ctx.storage.kv, hasWorld, slot, PERF_WORLD_MAP_ID));
    },
    onStart: (_region, candidate) => {
      const slot = spawningInto;
      if (slot === null) return;
      spawningInto = null;
      // THE CHOSEN PLACE IS WRITTEN AS THE SAVE'S CAMERA POSE, and the
      // world then resumes from it. No new seam: the path that puts a
      // returning player back where they were is the same path that puts
      // a new one where they asked to start, which is one behaviour to
      // keep working rather than two.
      const session = newSoloGame(ctx.storage.kv, hasWorld, slot, PERF_WORLD_MAP_ID);
      void (async () => {
        try {
          await session.save({ camera: poseFor(candidate) });
        } catch (error) {
          // A storage failure loses the chosen spot, not the game: the
          // world opens at its own default rather than not at all.
          console.error('[spawn] could not record where the game begins', error);
        }
        startSession(ctx, session);
      })();
    },
  })));

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
        // AND WHAT GROWS ON IT, wired the same way for the same reason.
        landcover,
        // THE WEATHER, wired like the survey: Open-Meteo, asked from the
        // phone directly (it allows it; NDBC did not, hence the relay's sea
        // route), off when there is no island to rain on. The reading is
        // kept in this device's storage so the next launch on a plane
        // still opens on Kauaʻi's sky.
        weather: survey === undefined ? null : new OpenMeteo(),
        weatherCache: weatherCacheOver(ctx.storage),
        clock: worldClock(),
        skyOverride: SKY_OVERRIDE,
        // So the sheet can say `held` when the address bar is holding
        // the clock, not only when the player's slider is.
        hourOverride: HOUR_OVERRIDE,
        settings: () => openSettings(ctx.storage).read(),
        // The two settings the world writes, both from controls on the
        // stat sheet itself, so each survives a reload: the HUD's fold
        // (Joshua, 2026-09-07) and the creature finder's switch
        // (2026-09-08). The world cannot write them itself — perf/ may
        // not import ui/ — so the document's owner does it here.
        onHudCollapse: (collapsed) => {
          const store = openSettings(ctx.storage);
          store.write({ ...store.read(), hudCollapsed: collapsed });
        },
        onFinderToggle: (on) => {
          const store = openSettings(ctx.storage);
          store.write({ ...store.read(), finderOn: on });
        },
        // The held hour, so a sky set for a look survives the reload the
        // update check performs on a push. The world refuses it in a
        // room; this only writes what the world reports.
        onTimeChange: (hour) => {
          const store = openSettings(ctx.storage);
          store.write({ ...store.read(), timeOfDay: hour });
        },
        tierOverride: TIER_OVERRIDE,
        detailOverride: DETAIL_OVERRIDE,
        // The renderer's two facts the world may not reach for itself.
        // Tolerant of a renderer that is a stub: the app-flow test walks
        // the empty world with `{}` for one, and neither fact matters
        // there (nothing to shadow, nothing to size).
        shadows: (enabled) => ctx.renderer.setShadows?.(enabled),
        pixelRatio: () => ctx.renderer.gl?.getPixelRatio() ?? 1,
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

  // THE CREATURE LAB (ARCHITECTURE §11, 6.10): one 1 m bench where the
  // five first creatures live together under AI and any one of them can
  // be possessed by this device's player — the SAME production modules
  // Kauaʻi will import, wired exactly as the Network Lab is: a plain tool
  // scene in the menu state, no session, this device's profile as the
  // player whose Intent the possessed body obeys.
  registerTool(creatureLabTool);
  registerScene(
    LAB_SCENE_ID,
    createCreatureLabScene((ctx) => ({
      identity: () => {
        const p = loadProfile(ctx.storage.open(PLAYER_PROFILE_SPEC));
        return { playerId: playerIdOf(p), name: p.displayName };
      },
      onBack: () => goToScreen(ctx, SCREEN_ID.editors),
      // THE BENCH MEASURES AT THE RUNG HE PLAYS AT (Joshua, 2026-09-11:
      // "should be on High to match settings not medium"). The same
      // store the world reads, so the Creature Lab's reports can never
      // name a detail level his Settings do not show.
      settings: () => openSettings(ctx.storage).read(),
    })),
  );
}
