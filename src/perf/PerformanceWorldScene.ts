/**
 * The permanent benchmark scene (ARCHITECTURE §9): an empty world — a
 * large ground grid under a horizon-coloured sky — with the free-fly
 * camera and the perf HUD. Every world layer the plan adds becomes a
 * toggle here so its cost can be measured alone on a real phone; in
 * Phase 0 there is nothing to toggle and the scene measures the loop.
 *
 * Reached only through the registry as `world:perf-empty`, from the
 * loading screen via `WorldLoader.resolveWorld` or from the dev-tools hub.
 * It asks its owner for anything beyond its own state through the typed
 * hooks (§2.7): what PAUSE means is the owner's decision, not the scene's.
 *
 * SAVE POINTS. The world saves through the app's session — whichever
 * session that is (§5) — when the pause overlay opens, and hands its save
 * point to its owner for QUIT. Pause-open is read off the app state
 * inside `update()` rather than off the PAUSE button, because Escape
 * opens the same overlay without passing through this scene; the state
 * is the measured fact, the button is one of two ways to change it
 * (§2.3). v0 learned the second half the hard way: QUIT walked away from
 * up to a minute of play until a parting save was added, so here QUIT
 * gets the world's own save function and not just the session's flush.
 *
 * THE PLAYER HERE IS THE CAMERA. This world has no ant and no body: the
 * free-fly camera IS the local player, and what goes to the authority as
 * a movement claim is the camera's own pose — a DEBUG CAPSULE standing
 * where the camera is, facing where it faces. That is the honest first
 * actor (ARCHITECTURE §5: two coloured capsules before any ant), and it
 * is why nothing draws the local player: you are inside it. Other
 * players' capsules ARE drawn, from the replica, through `view/`.
 *
 * The camera stays an instrument even so. It is not stepped by
 * `Transform`, it is not snapped back when the authority refuses a
 * claim — a hand flying a benchmark camera must not be fought by a
 * travel budget written for a walking capsule — and it keeps flying
 * while the world is paused. A refusal is not hidden, though: the HUD
 * counts it, which is the honest way round.
 *
 * WHERE YOU JOIN IS THE AUTHORITY'S TO SAY, and that is the one moment
 * the camera moves on the network's word: the first time the authority
 * names this player's actor, the camera is moved OVER it — the spawn's
 * ground position, the camera's own height and its own look.
 *
 * Not doing that is a trap the multiplayer probe walked into. A camera
 * left at START stands 84 units from the capsule the relay spawned at
 * the origin; the claims it then makes each try to spend more than the
 * travel budget allows in one step, so every one of them is refused, the
 * actor never leaves the spawn point, and the player is a statue on
 * everybody else's screen — for ever, because the gap never closes.
 * Standing over the spawn leaves one step to pay for, the height the
 * camera flies at, which is a fraction of what the budget allows (and
 * `tests/perfWorldScene.test.ts` checks that against the authority's own
 * numbers rather than trusting this sentence). The height is kept rather
 * than taken because a benchmark camera at ground level is inside the
 * grid it is here to look at; the capsule simply stands where the camera
 * is, which is what it has always meant.
 *
 * IN A SOLO SESSION NO NETWORK CODE RUNS AT ALL. There is no transport
 * to open, so `NetworkedWorld` is never built, nothing is claimed and
 * the HUD says `Solo`. And a link that fails or dies later must never
 * take the world with it: the world's frame loop does not depend on the
 * network having worked.
 */
import * as THREE from 'three';
import { ACTION, actionButton } from '../app/actions';
import { DEBUG_CAPSULE_TUNING } from '../actor/CapsuleTuning';
import type { AppState } from '../app/AppState';
import type { AppScene, FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import {
  NetworkedWorld, PracticeBot, type MovePose, type NetworkIdentity, type NetworkedWorldState, type Transport,
} from '../net';
import type { GameSession, SessionSaveState } from '../session/GameSession';
import { ActorViews } from '../view/ActorViews';
import { TerrainStreamer } from '../terrain/TerrainStreamer';
import { TerrainView } from '../terrain/TerrainView';
import { OceanView, TIER_OCTAVES as OCEAN_OCTAVES } from '../sea/OceanView';
import { blendSight, underwaterLook } from '../sea/underwaterLook';
import { IslandWater } from '../water/IslandWater';
import { WorldObjects } from '../flora/WorldObjects';
import { HabitatMap } from '../world/habitat';
import { VEG_BYTES, decodeVeg } from '../world/landcover';
import { WORLD_SEED } from '../world/objects/seed';
import { PLANT_FAMILIES, plantSourcesOf } from '../world/objects/plants';
import { ResourceLayer, waterQueryOf, type WaterQuery } from '../world/ecology';
import {
  CREATURE_IDS, CREATURE_SPECIES, CreatureSim, isUnderground, metresOfUnits, nearestSighting, viewpointFor,
  type CreatureId,
} from '../creatures';
import { FaunaView } from '../fauna/FaunaView';
import { FinderView } from '../fauna/FinderView';
import { assets } from '../assets/assets';
import type { WorldLayerId } from '../world/WorldLoader';
import { islandChannels, type IslandChannels } from '../world/water/islandChannels';
import type { WeatherProvider } from '../world/weather/conditions';
import { LiveWeather, type WeatherCache } from '../world/weather/liveWeather';
import { SkyModel } from '../world/weather/skyModel';
import { kauaiClock, sunPosition, type SunPosition } from '../world/weather/solar';
import { skyLoaderFor } from '../assets/skySource';
import { RainView } from '../sky/RainView';
import { SkyView } from '../sky/SkyView';
import { skyLook } from '../sky/skyLook';
import { LensView } from '../sky/LensView';
import { lensExposure } from '../sky/lensExposure';
import { shadowFor } from '../sky/shadows';
import { easeRainWetness, shoreWetnessOf, type WetnessSignals } from '../terrain/wetness';
import { rainToUnitsPerSecond, type Sky, type WeatherNow } from '../world/weather/weather';
import { worldToGeo } from '../world/geo';
import { SeaTextures } from '../sea/SeaTextures';
import { SeaSwell } from '../world/sea/swell';
import { resolveTier, tierFor, type TextureTier } from '../assets/textureQuality';
import { detailFor, objectRadius, resolveDetail, type DetailTier } from '../assets/detailQuality';
import { LoadProgress } from '../world/LoadProgress';
import { COARSE_BYTES, decodeCoarse, type DemGrid } from '../world/dem';
import { repairGrid } from '../world/demRepair';
import { Heightfield, SEA_LEVEL } from '../world/heightfield';
import { toLocal } from '../world/origin';
import { compassBearing, type WorldPoint } from '../world/coords';
import { BotHud, type BotReadout } from './BotHud';
import { FrameStats } from './FrameStats';
import { CAMERA_SPEEDS, FreeFlyCamera, headingOfYaw, yawForHeading } from './FreeFlyCamera';
import { MoveStick } from '../input/MoveStick';
import {
  HUD_HZ, PerfHud, type CreaturesReadout, type FinderReadout, type FreshReadout, type ObjectsReadout, type SeaReadout,
  type SessionLink, type SessionReadout, type SpeciesReadout,
} from './PerfHud';
import { BUILT_LAYERS, LayerToggles } from './layerToggles';
import { PERF_WORLD_SCENE_ID } from './perfTool';

/**
 * The finder's word for each species: the SINGULAR, because its line
 * names one animal while the three ecology lines above it count whole
 * populations. Here rather than in `PerfHud` because the sheet prints
 * what it is told and never learns what a creature is.
 */
const FINDER_WORD: Readonly<Record<CreatureId, string>> = Object.freeze({
  earthworm: 'worm',
  aphid: 'aphid',
  housefly: 'fly',
});

/** The actor heading from one world point to another: ahead is (sin h, cos h). */
function headingTo(from: WorldPoint, to: WorldPoint): number {
  return Math.atan2(to.wx - from.wx, to.wz - from.wz);
}

/**
 * The settings this scene honours. Structural on purpose: the settings
 * document is the ui's, and perf/ may not import ui/ (§3), so whoever owns
 * the document builds this from it.
 */
export interface PerfWorldSettings {
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Multiplier on the look-drag turn rate. */
  readonly lookSensitivity: number;
  readonly invertY: boolean;
  /** Whether the perf HUD is shown at all. */
  readonly showFps: boolean;
  /**
   * Whether the perf HUD is folded to its one-line summary. Joshua, from
   * the phone (2026-09-07): "make the stat sheet collapsible as it takes
   * up most of the screen". The HUD's own corner button flips it, and
   * `onHudCollapse` carries the tap back to whoever owns the document.
   */
  readonly hudCollapsed: boolean;
  /**
   * Whether the creature finder is switched on (Joshua, 2026-09-08).
   * Persisted like the fold, and for the same reason: the switch lives
   * on a sheet that is folded on a phone, and an instrument that came
   * back off after every reload would be turned on again by hand every
   * time — which, now that the app reloads itself on a push
   * (`app/updateCheck.ts`), is often.
   */
  readonly finderOn: boolean;
  /**
   * The ceiling a full push of the move stick reaches: `slow` 5 m/s,
   * `medium` 10, `fast` 30 (`FreeFlyCamera.CAMERA_SPEEDS`). Every rung
   * starts at 1 m/s, so this is the top of the range and not the whole
   * of it. Joshua, 2026-09-08: "I am moving too fast to see them."
   */
  readonly cameraSpeed: 'slow' | 'medium' | 'fast';
  /**
   * The player's two three-level quality choices, since 2026-09-05.
   *
   * TWO, because they cost different parts of the machine and fail
   * differently: `textures` is GPU memory, whose failure is a killed
   * tab, and `detail` is vertices a frame, whose failure is a slow one.
   * Joshua: "Probably separate the two like rendering details vs
   * textures. So could do a random combination."
   *
   * LIVE SINCE PHASE 3, and the ocean is what reads both: `textures`
   * picks the rung it loads and how it filters, `detail` picks how many
   * ripple octaves its shader compiles and how far the moving water
   * reaches before the flat sheet takes over.
   */
  readonly textures: 'low' | 'medium' | 'high';
  readonly detail: 'low' | 'medium' | 'high';
}

export interface PerformanceWorldHooks {
  /** PAUSE was pressed. What a pause means — state, overlay, whether the world may freeze — is the owner's. */
  onPause(): void;
  /**
   * The renderer's shadow-map switch (the lighting polish, 2026-09-07).
   * The scene never reaches the renderer — the test rig withholds it —
   * so the owner hands over the one flag: on at enter, off at dispose;
   * whether anything CASTS is the sun light's, by rung and by hour.
   */
  shadows?(enabled: boolean): void;
  /** The drawing buffer's pixels per CSS pixel, for the streaks and the lens, which size themselves in device pixels. */
  pixelRatio?(): number;
  /**
   * A texture rung named by the ADDRESS BAR, overriding the one the
   * player's quality setting maps to. Null or absent is the ordinary
   * case: the setting decides.
   *
   * Here as a hook for the same reason the survey is: perf/ may not read
   * a browser global, and `app/registerScenes.ts` is the one place that
   * reads the address bar (`assets/textureQuality.ts` owns the rule).
   * It exists because CLAUDE.md requires the sea to be testable at
   * ultra-low on a phone, and ultra-low is not one of the player's three
   * choices.
   */
  readonly tierOverride?: TextureTier | null;
  /**
   * `?detail=` — the same door as `tierOverride`, for the other ladder.
   * Null is the ordinary case and means the player's setting decides.
   */
  readonly detailOverride?: DetailTier | null;
  /** Progress of `enter()`: a 0..1 fraction and an ETA in ms (null before there is a rate), for the loading screen. */
  onLoadProgress?(fraction: number, etaMs: number | null): void;
  /**
   * Where the elevation survey comes from.
   *
   * ABSENT MEANS NO TERRAIN — and that is the point. A scene must not
   * reach the network merely because it was constructed: every test of
   * the menu, the pause menu or the save slots would then wait out a
   * download's retry backoff to prove something about a button. The
   * integration pass (`app/registerScenes.ts`) wires the deployed files;
   * a test that is about terrain hands over bytes of its own; everything
   * else gets the empty world, which is what this scene already was.
   */
  survey?(onBytes: (received: number, total: number | null) => void): Promise<ArrayBuffer>;
  /**
   * Where the landcover raster comes from — what grows where, from the
   * real island (`world/landcover.ts`). Same rule as the survey: absent
   * means no vegetation, and a scene must not reach the network because
   * it was constructed. Only asked for once the survey has landed; there
   * is nothing to grow on without it.
   */
  landcover?(onBytes: (received: number, total: number | null) => void): Promise<ArrayBuffer>;
  /**
   * THE ISLAND'S WEATHER, live (Phase 5, Joshua 2026-09-07: "real weather
   * synced"): somewhere that answers with conditions for the station
   * grid. Wired the same way as the survey and the landcover, and for the
   * same reason: constructing the world reaches no network, and this is
   * the one place that says the weather is Open-Meteo's. Absent or null:
   * the seeded simulation alone, and the HUD says `sim`.
   */
  weather?: WeatherProvider | null;
  /**
   * Where a live reading is kept between sessions, so the second launch
   * on a plane still looks like Kauaʻi rather than like the model. A
   * typed seam over storage; absent: nothing is kept.
   */
  weatherCache?: WeatherCache | null;
  /**
   * The wall clock, Unix milliseconds, for the sun's position and the
   * feed's cadence. A hook so a probe can hold the island at an hour
   * (`?hour=`) and a test can run a day in a second. Absent: the scene
   * uses `Date.now`.
   */
  clock?(): number;
  /**
   * A sky held open by the address bar (`?sky=clear|cloudy|rain`), the
   * way `?tier=` holds a rung: an override for a probe, never a setting.
   * Null or absent: the weather is its own.
   */
  skyOverride?: Sky | null;
  /**
   * The current settings. Read once in `enter()` and again whenever the
   * app state changes — the pause menu is where a player changes them, and
   * returning from it is a state change — so no event bus is needed and
   * the document is not parsed every frame. Absent: the scene's defaults.
   */
  settings?(): PerfWorldSettings;
  /**
   * The player folded or unfolded the perf HUD by its corner button. The
   * scene never writes settings itself (perf/ may not import ui/); the
   * owner of the document persists this one, so the fold survives a
   * reload. Absent: the fold lasts until the scene is left.
   */
  onHudCollapse?(collapsed: boolean): void;
  /**
   * The player flipped the finder's switch. Persisted by the owner of
   * the settings document, exactly as the fold is — perf/ may not import
   * ui/ (§3). Absent: the switch lasts until the scene is left.
   */
  onFinderToggle?(on: boolean): void;
  /**
   * Where to resume from: the state the session loaded, or null for a
   * fresh start at the scene's own START. Read once in `enter()`. A hook
   * because the session seam has no `load` — what a session can restore
   * (a solo save on this device today, a server snapshot one day) is the
   * owner's knowledge, not the world's. Absent: always a fresh start.
   */
  resume?(): SessionSaveState | null;
  /**
   * Hands the owner the world's save point once `enter()` has a camera
   * worth saving; calling it writes the current pose through the app's
   * session. The owner calls it before the session leaves on QUIT, so the
   * pose on disk is the last one the player saw and not the pause-open
   * one — the free-fly camera keeps flying while the world is paused.
   * Absent: the session's own flush on leave keeps the pause-open save.
   */
  onSavePoint?(save: () => Promise<void>): void;
  /**
   * Who the local player is on the wire, read once in `enter()` and only
   * when the session is a networked one. A hook because the device
   * profile is a store, and a world may not open one (§2.7) — the owner
   * reads it and hands over the two facts a hello needs. Absent: nothing
   * is claimed and nothing is drawn for other players, and the HUD says
   * so rather than pretending to be solo.
   */
  identity?(): NetworkIdentity;
  /**
   * Who the PRACTICE BOT is on the wire, when the player asked for one on
   * the room screen. A separate hook from `identity` because it is a
   * separate player with its own id, and minting one is the wiring's job,
   * not a world's. Returning null — or not being here — means no bot, and
   * the panel is not built at all.
   *
   * Whether a bot was ASKED for is the session's answer, not this hook's:
   * the session is what knows which room it is (`openPracticeBot`). Both
   * have to say yes, exactly as the local player's own link needs both a
   * transport and an identity.
   */
  practiceBot?(): NetworkIdentity | null;
}

/**
 * A session that is multiplayer AND holds a wire. Read structurally
 * rather than by importing the session class: `perf/` has no business
 * knowing which implementation it was handed (§5 — a session is passed,
 * never its type), and a checked read is honest where a cast would not
 * be. A multiplayer session with no relay configured — the honest mock —
 * simply has nothing here, which is the whole difference.
 */
function multiplayerTransport(session: GameSession | null): Transport | null {
  if (session === null || session.mode !== 'multiplayer') return null;
  const held: unknown = (session as { readonly transport?: unknown }).transport;
  return isTransport(held) ? held : null;
}

/**
 * A session that will open a SECOND link to the same room, for the
 * practice bot — or null when it will not. Read structurally for the same
 * reason as the transport above: `perf/` is handed a session, never its
 * type (§5).
 *
 * IT ASKS, RATHER THAN ASSUMING. Every multiplayer session has this
 * method; only one the player asked a bot from answers with a link. An
 * earlier version returned a factory whenever the METHOD existed, so a
 * plain two-player room built a bot whose first call threw — which is
 * what `probe:multiplayer` reported as an uncaught page error on both
 * browsers.
 *
 * Asking costs nothing: the session CONSTRUCTS a transport and dials
 * nothing (`RemoteMultiplayerSession.openPracticeBot`), so the answer and
 * the first link are the same object, and it is handed straight back on
 * the first call rather than thrown away.
 */
function practiceBotOpener(session: GameSession | null): (() => Transport) | null {
  if (session === null || session.mode !== 'multiplayer') return null;
  const open: unknown = (session as { readonly openPracticeBot?: unknown }).openPracticeBot;
  if (typeof open !== 'function') return null;
  const ask = (): Transport | null => {
    const link: unknown = (open as () => unknown).call(session);
    return isTransport(link) ? link : null;
  };
  let first = ask();
  if (first === null) return null;
  return () => {
    const link = first ?? ask();
    first = null;
    // A session that offered one link and then refused: nothing in this
    // repository does that, and a bot with no wire must not pretend.
    if (link === null) throw new Error('practice bot: the session would not open another link');
    return link;
  };
}

function isTransport(value: unknown): value is Transport {
  if (typeof value !== 'object' || value === null) return false;
  const it = value as Record<string, unknown>;
  return (
    typeof it.state === 'string' &&
    typeof it.connect === 'function' &&
    typeof it.disconnect === 'function' &&
    typeof it.send === 'function' &&
    typeof it.onMessage === 'function' &&
    typeof it.onClose === 'function'
  );
}

/** `net/`'s states in the HUD's words. The HUD never learns the protocol's names (§2.7). */
const LINK_OF: Readonly<Record<NetworkedWorldState, SessionLink>> = {
  idle: 'idle',
  connecting: 'connecting',
  connected: 'connected',
  disconnected: 'lost',
  left: 'left',
  failed: 'unreachable',
};

/**
 * WHAT IS ACTUALLY DRAWN, published where a probe can read it.
 *
 * The HUD's SESSION line says how many other players the WIRE reports.
 * This says what the SCENE GRAPH holds — one row per remote capsule
 * that exists as a mesh, carrying that mesh's own render position — and
 * the two are different facts: a `join` that arrived is not yet a
 * capsule on screen, and only something that can read both can tell "the
 * message came through" from "the player appeared". `scripts/probe-
 * multiplayer.mjs` asserts on both, because the point of the feature is
 * the second one.
 *
 * Hidden, and never words: it is instrumentation, not a readout a person
 * is meant to read, and it exists for the same reason every control
 * carries a `data-action` (app/actions.ts) — a probe must be able to
 * measure the built page without a selector tied to a layout. It is
 * written only in a networked world, at the HUD's own rate, so it costs
 * a solo benchmark nothing and a multiplayer one no more than the HUD.
 */
export const REMOTE_CAPSULES_ROLE = 'remote-capsules';

/** How far the weather model is run in one step when a sky is held open at start, seconds — an hour, so the held sky has fully arrived. */
const HELD_SKY_WARM_UP_S = 3600;

/**
 * How far from the camera the island's resources are derived, world
 * units: the housefly's reach (`creatures/species.ts`, 40 m), which is
 * the farthest any species looks for a meal. Held inside the objects'
 * bubble at run time; a cell without plants resident derives nothing.
 */
const RESOURCE_REACH = 40 * 100;

/**
 * The camera's presence as the animals feel it, world units: the one
 * moving thing in the world until the ant arrives. Ten centimetres of
 * radius on top of each species' own alarm distance, so flying the eye
 * through a cloud of flies scatters them and hovering over a worm sends
 * it down. GAME TUNING.
 */
const EYE_PRESENCE = 10;

/** Which perf-world row switches which species. */
const SPECIES_LAYER: Readonly<Record<CreatureId, WorldLayerId>> = Object.freeze({
  earthworm: 'worms',
  aphid: 'aphids',
  housefly: 'flies',
});

/** The sky the grid vanishes into, and the fog that makes it vanish. */
const HORIZON = '#9db6c6';
/** What the ground bounces back up into the shaded side of a hill. */
const GROUND_BOUNCE = '#4a4335';
/** 2000 units across in 10-unit cells: big enough that a 40 unit/s camera takes time to reach the edge. */
const GRID_SIZE = 2000;
const GRID_DIVISIONS = 200;
const GRID_CENTRE = 0xc9a94a;
const GRID_LINE = 0x3b4a52;
/** Fog opens past the near cells and closes before the grid's edge, so the edge is never a hard line. */
const FOG_NEAR = 300;
const FOG_FAR = 1500;
/** A little above and behind the origin, looking slightly down at the centre lines. */
const START = { x: 0, y: 25, z: 80, yaw: 0, pitch: -0.22 } as const;

/**
 * THE ISLAND IS NOT AN ANT-SIZED ROOM, and the empty world's numbers do
 * not survive contact with it. The grid is 2,000 units across and the fog
 * closes at 1,500; Kauaʻi is 5,600,000 across.
 *
 * With terrain the fog is a FRACTION OF THE FAR PLANE rather than a fixed
 * distance, because the far plane rides the camera's height above the
 * ground (see `adaptDepth`). Fixed constants were tried and were wrong
 * everywhere but at altitude: at 60 m up the far plane is 3.6 km, so a
 * fog starting at 4 km never applied at all and the clipmap was cut by
 * the far plane into a hard-edged disc.
 *
 * It opens at a QUARTER of the view rather than near the end of it,
 * because the far half of a view from altitude is mostly deep sea floor,
 * which is the darkest thing in the palette: unfogged, the horizon reads
 * as a black band under a pale sky, which is the opposite of what
 * distance does to a real one.
 */
const FOG_NEAR_OF_FAR = 0.25;
const FOG_FAR_OF_FAR = 0.95;

/** What the far plane returns to when there is no terrain: the empty world's own. */
const EMPTY_WORLD_FAR = 5000;

/**
 * How far above the ground the camera starts when there is ground.
 *
 * World (0,0) is Waiʻaleʻale's summit plateau at 1,302 m, so a camera left
 * at START's 25 units begins 1.3 km INSIDE the mountain. 400 m above it
 * was not enough either: standing on the highest ground on the island, the
 * plateau itself fills the view. 1.5 km clears it and puts real distance
 * in frame.
 */
const START_CLEARANCE = 150_000;

/**
 * How high the camera starts IN A ROOM. Much lower, because in a room the
 * camera may only fly at a capsule's own top speed (`paceFor`), and from
 * 1.5 km up that is twenty minutes of descent before you can see anybody
 * — while your own capsule stands on the ground the whole time. 30 m puts
 * you among the other players, which is what a room is for.
 */
const NETWORKED_CLEARANCE = 3_000;

/** Looking down about 25 degrees, rather than the empty room's 12. */
const START_PITCH = -0.45;

/**
 * Facing WEST from the summit, which is the long way across Kauaʻi and the
 * direction Waimea Canyon and the Napali ridges lie in. The empty world's
 * yaw of 0 looks north, at the shortest and flattest view there is from
 * here. (Camera yaw is not heading: `headingOfYaw` adds half a turn.)
 */
const START_YAW = Math.PI / 2;

/**
 * THE FLY SPEED: 30 metres a second, flat.
 *
 * Joshua, 2026-09-05, from the device: "make the speed of the camera at
 * 30m/s". 3,000 world units a second, since a unit is a centimetre.
 *
 * IT USED TO RIDE THE ALTITUDE — a twenty-fourth of the height above
 * ground, which put the camera near 125 m/s when it started 1.5 km up
 * and slowed it as it came down. That was written to make a 56 km island
 * crossable when the only way to reach anywhere was to fly there from
 * the summit. It also made the camera uncontrollably fast up high and
 * sluggish at the surface, which is the opposite of what a person wants
 * while looking at something.
 *
 * The spawn map is what makes a flat, slow speed reasonable: you no
 * longer fly to a place, you start there, and 30 m/s is a speed you can
 * actually steer while looking at the ground. The mouse wheel still
 * scales it on a desktop; on a phone there is no wheel, so this constant
 * IS the speed and it is the one Joshua asked for.
 */
/**
 * The rung a world without a settings document flies at. `fast` — the
 * speed this camera had before the setting existed — because a probe or
 * a test that hands in no settings is measuring the island, not looking
 * for an animal on it.
 */
const DEFAULT_CAMERA_SPEED = 'fast';

/**
 * The fastest a camera may fly while a room is watching: the capsule's own
 * top speed, `walkSpeed x sprintFactor`, which is what the authority's
 * travel budget is sized for. Faster than this and the claims are refused.
 */
const NETWORKED_MAX_SPEED = DEBUG_CAPSULE_TUNING.walkSpeed * DEBUG_CAPSULE_TUNING.sprintFactor;

/**
 * How far above the ground a RESUMED camera is lifted when the save put
 * it underground. 30 m: clear of the surface at any resolution the
 * clipmap draws, close enough that the player is still where they were.
 */
const RESUME_CLEARANCE = 3_000;

/**
 * How close to the ground a resumed camera may be before it counts as
 * IN it. Half a metre: the camera's own near plane, plus the coarse
 * lattice's error against a tile that has not landed yet.
 *
 * IT USED TO BE THE CLEARANCE ITSELF. `standClearOfGround` treated
 * ground + 30 m as a FLOOR, so a player who had landed in the grass to
 * look at it, quit, and resumed came back thirty metres up — every time,
 * with no way to save a low pose at all. The comment on the clearance
 * said "when the save put it underground", and now the code does too.
 * `probe:objects` found it: its camera could not be stood on the ground.
 */
const RESUME_MARGIN = 50;

/**
 * Water into every CHANNEL cell, world units of depth a second.
 *
 * BASEFLOW IS NOT RAIN. A real river runs between storms because
 * groundwater seeps into its channel while the hillsides above it are
 * dry — so this goes into the cells `drainage.ts` marked and nowhere
 * else, and it never stops. Rain is the other feed and falls on
 * everything, only while it is falling.
 *
 * DOUBLED FROM 6 ON JOSHUA'S ASK (2026-09-06: "Can you double the water
 * amount/volume on the island? Doesn't appear like a lot of water").
 * Volume is LINEAR in this number and the doubling is real: measured
 * 2.07x the water in the window at every moment either site was sampled.
 *
 * MEASURED at the shipped window (256 cells, 1 m, soak 0.3, open rim) at
 * two channel cells the coarse drainage marks, named by coordinate so
 * the numbers can be reproduced rather than believed:
 *
 *   A  world(552344, -1667969)   1 m altitude  — Hanalei valley floor
 *   B  world(809375,  -196875) 446 m altitude  — Wailua headwater
 *
 * Share of the window drawn wet (depth >= `DRAWN_DEPTH`), and the water
 * standing in it, against simulated seconds since the window was placed:
 *
 *            10s      30s      60s     120s     300s     600s
 *   A  bf 6  22.2%    36.2%    47.7%    63.1%    77.2%    81.7%
 *   A  bf 12 26.9%    45.7%    59.9%    77.1%    92.3%    93.0%
 *   B  bf 6   7.2%     8.6%     9.3%     9.7%     9.9%     9.9%
 *   B  bf 12 10.1%    11.8%    13.1%    14.6%    16.3%    16.7%
 *
 * TWO THINGS IN THAT TABLE CORRECT WHAT USED TO BE WRITTEN HERE.
 *
 * The rim is OPEN, not closed. `WaterSimOptions.drainRim` defaults true
 * and this window takes the default, so the ring one cell wide sheds
 * what it would have sent into ground that is not simulated — measured,
 * it is half the water: at 60 s site B holds 31,294 m³ with the rim open
 * against 59,636 m³ with it shut. The comment that stood here said water
 * that enters can never leave. It leaves.
 *
 * And the window does NOT settle in ten seconds. It settles in five
 * MINUTES, and the equilibrium on a valley floor is a flood: 82% of the
 * window under water at the old rate, 93% at this one. Ten seconds is
 * 27% of the way there at site A. So the number this constant was tuned
 * against was never the equilibrium — it was the transient a player
 * actually meets, and that is the honest thing to tune against here,
 * because A PLAYER IN MOTION ONLY EVER SEES THE TRANSIENT: the window
 * re-anchors every eight metres and the ground ahead of her arrives dry,
 * so at flying speed no cell has more than about eight seconds of
 * simulation on it. The flood is what a player standing still for five
 * minutes in one valley would eventually be standing in, and it is the
 * cost of a feed sized for a catchment the window cannot see. It is
 * recorded here rather than capped, because a cap would be a second
 * answer to how deep water gets, argued from a look.
 *
 * WHAT THIS CONSTANT CANNOT FIX, and the reason the island reads dry
 * from the air whatever it is set to: the near tier is 256 m across and
 * Kauaʻi is 56 km. Everything past the window is not thin water, it is
 * NO water. The far tier — the surveyed ribbons of `water/hydro.ts` —
 * is what puts rivers in the distance, and it is not built yet.
 */
const BASEFLOW_PER_SECOND = 12;

/**
 * THE DEPTH BUFFER, AND WHY THE NEAR PLANE MOVES.
 *
 * Depth precision depends on far/near, not on far. The empty world's
 * 0.1 → 5,000 is a ratio of 50,000 and is fine; keeping near at 0.1 while
 * pushing far to 8,000,000 would be 80 million, and the island would
 * z-fight into confetti. A logarithmic depth buffer would fix it and cost
 * a per-fragment depth write on every phone, forever.
 *
 * Instead the near plane rides the camera's height above the ground and
 * the far plane keeps a FIXED RATIO to it. Close to the ground you get
 * millimetres of near plane and a short view; high above it you get a
 * coarse near plane and the whole island — which is exactly what you can
 * actually see from each. No extra fragment cost, and the ratio never
 * leaves what a 24-bit buffer holds comfortably.
 */
const DEPTH_RATIO = 60_000;
const MIN_NEAR = 0.1;
const MAX_NEAR = 120;
/** Refresh the projection only when the near plane has really moved: it is a matrix rebuild. */
const NEAR_HYSTERESIS = 1.3;

/**
 * Real milestones, weighted by roughly what they cost; not a timer. Small
 * today, but the loading screen shows THIS, and when terrain arrives the
 * DEM download joins the list with a weight that dwarfs these.
 */
const MILESTONES = [
  { id: 'ground', weight: 2 },
  { id: 'light', weight: 1 },
  { id: 'hud', weight: 1 },
  // The 2 MB survey, which dwarfs the rest — the loading bar is mostly
  // this, and it is reported from bytes that actually landed.
  { id: 'terrain', weight: 24 },
  // The 442 KB landcover raster and the first fill of the object bubble.
  { id: 'landcover', weight: 5 },
] as const;

export function createPerformanceWorldScene(hooks: PerformanceWorldHooks): SceneFactory {
  return (ctx: SceneContext): AppScene => {
    const three = new THREE.Scene();
    three.background = new THREE.Color(HORIZON);
    three.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);

    const fly = new FreeFlyCamera();
    fly.place(START.x, START.y, START.z, START.yaw, START.pitch);
    const stats = new FrameStats();
    /**
     * Built lazily in `enter()`, because whether TERRAIN is built is not
     * a fact about this build — it is a fact about whether the survey
     * actually downloaded. A row that reads "built" over ground that
     * never arrived is a control that looks functional and is not (2.9).
     */
    let toggles = new LayerToggles([]);

    let grid: THREE.GridHelper | null = null;
    let light: THREE.DirectionalLight | null = null;
    let sky: THREE.HemisphereLight | null = null;
    /** The ground, once the survey has landed. Null until then, and null forever if it does not. */
    let field: Heightfield | null = null;
    let terrain: TerrainView | null = null;
    let streamer: TerrainStreamer | null = null;
    /** What the terrain toggle was at the last look, so a change is acted on once. */
    let terrainOn = false;
    /** The sea. One swell for the whole scene — it is the ONE clock. */
    let swell: SeaSwell | null = null;
    let seaTextures: SeaTextures | null = null;
    let ocean: OceanView | null = null;
    /** What the ocean toggle was at the last look. */
    let oceanOn = false;
    /**
     * THE ISLAND'S FRESH WATER, and the two things it needs: the sky
     * that rains on it and the drainage that says where a river is.
     *
     * The channel analysis is run ONCE over the whole coarse survey and
     * held for the life of the scene — a property of the island's shape,
     * which is not ours to move.
     */
    let fresh: IslandWater | null = null;
    let channels: IslandChannels | null = null;
    let freshOn = false;
    /**
     * THE WEATHER, live (Phase 5). Open-Meteo over the station grid when
     * the owner wires a provider, kept on this device for three hours,
     * and the seeded model under it all — one `WeatherSource` whichever
     * is answering, and the HUD says which. The clock is the owner's, so
     * a probe can hold the island at an hour; the sky may be held open
     * the same way (`?sky=`), and the model is what gets held.
     */
    const clock = hooks.clock ?? (() => Date.now());
    const weather = new LiveWeather({
      provider: hooks.weather ?? null,
      clock,
      cache: hooks.weatherCache ?? null,
      fallback: new SkyModel(),
    });
    if (hooks.skyOverride !== undefined && hooks.skyOverride !== null) {
      // Held from the first frame: the model eases toward a forced sky
      // over minutes of simulated time (it does not snap, by design),
      // and a probe or a look that asked for rain wants rain NOW. An
      // hour in one step is inside the model's own clamp, and nothing
      // has read the reading yet, so no water sees an hour of it.
      weather.force(hooks.skyOverride);
      weather.tick(HELD_SKY_WARM_UP_S);
    }
    /** This frame's reading at the camera, and the sun over it. */
    let weatherNow: WeatherNow = weather.now();
    let sunNow: SunPosition | null = null;
    let sunElevationDeg = 0;
    /** What the weather toggle was at the last look. */
    let weatherOn = false;
    /**
     * THE SKY DRAWN (Phase 5): the dome, the rain, and the light they
     * drive. Built only over an island — the empty world keeps its flat
     * horizon, so the weather row there reads "not built" honestly — and
     * rebuilt when the texture or detail rung changes, like the sea.
     */
    let skyView: SkyView | null = null;
    let rain: RainView | null = null;
    let builtSkyTier: TextureTier | null = null;
    let builtRainDetail: DetailTier | null = null;
    /** The tier the sea was BUILT at, so a changed setting is noticed once and rebuilt once. */
    let builtTier: TextureTier | null = null;
    let builtDetail: DetailTier | null = null;
    /**
     * THE WORLD'S OBJECTS — grass, twigs, stones, rocks, trees — and the
     * two things they are grown from: the habitat map (what belongs
     * where, from the landcover raster and the coarse survey, built once
     * and world-fixed) and the repaired coarse grid it reads.
     */
    let coarseGrid: DemGrid | null = null;
    let habitat: HabitatMap | null = null;
    let objects: WorldObjects | null = null;
    let objectsOn = false;
    /**
     * WHAT THE ISLAND OFFERS (Phase 6.5, the ecology pass): nectar, seed,
     * sap, litter, honeydew hosts and the edges of the real fresh water,
     * DERIVED per cell from the objects' resident population and the
     * water solver — never placed. Built with the objects, walked after
     * them, and its cells wait for the objects' before deriving anything.
     */
    let resources: ResourceLayer | null = null;
    let resourcesOn = false;
    /** How far the objects' bubble reaches at the rung it was built at, world units. */
    let objectsRadius = 0;
    /** The fresh water as the resource layer asks it: rebuilt with the water, null without it. */
    let waterQuery: WaterQuery | null = null;
    /**
     * THE ISLAND'S ANIMALS (Phase 6.5): the simulation, core, reading the
     * world through one read-only object, with the camera as the only
     * disturbance until the ant arrives. Built with the objects, because
     * its aphids sit on the objects' plants; each species is its own row.
     */
    let creatures: CreatureSim | null = null;
    /**
     * And how they look: one loaded rig per species from the GLBs, a
     * small pool of skeleton clones lent to the nearest, impostors past
     * it. It draws what the simulation holds and nothing else, so a
     * species switched off in the simulation is gone from the screen.
     */
    let fauna: FaunaView | null = null;
    /**
     * THE FINDER (Joshua, 2026-09-08). An instrument over the world, not
     * a layer in it: `finderOn` is its switch, the pins are drawn from
     * the simulation's own creature list, and with it off nothing here
     * runs at all. See `fauna/FinderView` for why it is allowed to look
     * like a gizmo.
     */
    let finder: FinderView | null = null;
    let finderOn = false;
    /** The species GO last showed, so the next press shows a different one. */
    let lastShown: CreatureId | null = null;
    /**
     * The ceiling a full stick push reaches, from the player's Camera
     * speed setting. Held here rather than read inside `pace()` because
     * `applySettings` already has the document open and parsing it twice
     * a state change is what the settings hook exists to avoid.
     */
    let cameraTop: number = CAMERA_SPEEDS[DEFAULT_CAMERA_SPEED];
    /** What each species row was at the last look. */
    const speciesOn: Record<CreatureId, boolean> = { earthworm: false, aphid: false, housefly: false };
    /** The rung the bubble was BUILT at: a changed setting is noticed once. */
    let builtObjectsDetail: DetailTier | null = null;
    /** The air's colour as a colour, so the blend never restates it. */
    const SKY = new THREE.Color(HORIZON);
    /**
     * THE AIR THE CROSSING BLENDS FROM (the lighting polish): the sky's
     * LIVE horizon on the frame the eye goes under, not the noon
     * constant, so a night dive fogs toward the night and surfacing
     * never flashes noon. With the weather layer off it is the noon
     * horizon, which is what `SKY` was for.
     */
    const airColour = new THREE.Color(HORIZON);
    /** The air lights' intensities the underwater look scales from; latched the way `airFog` is. */
    let baseSun = 1.15;
    let baseSky = 1.0;
    let underwaterLit = false;
    /** How many drops the lens keeps when the eye surfaces. GAME TUNING. */
    const SURFACING_DROPS = 4;
    /** The shore's wetness band, from the swell's crest envelope once the sea exists; dry until then. */
    const DRY_SHORE: WetnessSignals = Object.freeze({ shoreTop: -1e9, shoreFade: 1, rain: 0 });
    let shoreWet: WetnessSignals = DRY_SHORE;
    /** Rain wetness on the ground, eased up in seconds and dried over minutes (`terrain/wetness.ts`). */
    let rainWet = 0;
    /** The lens: rain on the eye, drawn after the world (`renderOverlays`). Built with the rain, at the detail rung. */
    let lens: LensView | null = null;
    let builtLensDetail: DetailTier | null = null;
    /** The rung the sun's shadow was configured at, and the HUD's word for it. */
    let builtShadowDetail: DetailTier | null = null;
    let shadowWord = '';
    let viewWidth = 0;
    let viewHeight = 0;
    /** Whether the eye is under the sea, and the air fog it went under from. */
    let underwater = false;
    let airFog = { near: 0, far: 0 };
    /** The near plane the projection was last built with. */
    let builtNear = 0;
    let hud: PerfHud | null = null;
    let stick: MoveStick | null = null;
    let pauseButton: HTMLButtonElement | null = null;
    /** The app state at the last look; a change is the cue to re-read settings and to notice a pause opening. */
    let seenState: AppState | null = null;

    let net: NetworkedWorld | null = null;
    /** The scripted test player, when one was asked for on the room screen. */
    let bot: PracticeBot | null = null;
    let botHud: BotHud | null = null;
    let remotes: ActorViews | null = null;
    let remoteGroup: THREE.Group | null = null;
    /** The authority has named this player's actor and the camera has been placed on it. Once, on join. */
    let spawnAdopted = false;
    /**
     * The player has taken the camera: they flew, or they looked. From
     * that moment nothing here turns it again — see `watchBot` below.
     */
    let cameraTaken = false;
    /** The exact pose the world last PLACED the camera at, so "has the player flown?" is a measured fact. */
    let placedPose: { readonly wx: number; readonly wz: number; readonly yaw: number } | null = null;
    /** The scene graph's own count and positions, in the DOM: see REMOTE_CAPSULES_ROLE. */
    let capsuleList: HTMLElement | null = null;
    /** Seconds of RAW time since that list was last written; Infinity so the first networked frame writes it. */
    let sinceCapsulePublish = Infinity;
    /** True when the session is a networked one, whether or not a link could be built. */
    let networked = false;
    /**
     * RAW wall-clock milliseconds since the world entered — the clock the
     * network and its replica are read on. Raw, because a wire does not
     * pause when a frame stalls and a replica read on a clamped clock
     * would fall behind the snapshots it is interpolating between.
     */
    let netClockMs = 0;

    /**
     * The camera's pose as a capsule's. Height is clamped at the ground
     * plane because a capsule may not stand below it (`ActorState`) while
     * a benchmark camera may certainly fly under the grid; claiming a
     * negative height would be a message the guard drops, which is a
     * silence rather than an answer. Pitch has no capsule to belong to.
     */
    const claimPose = (): MovePose => {
      const pose = fly.pose();
      // The camera's yaw is not an actor's heading: they are half a turn
      // apart (`FreeFlyCamera.headingOfYaw`). Claiming the yaw raw pointed
      // every player's capsule backwards on everybody else's screen —
      // invisible while a capsule was a featureless pill, and a bug the
      // moment one has a front.
      //
      // HEIGHT IS MEASURED FROM THE GROUND, and for this camera it is
      // zero: your capsule is where you ARE ON THE ISLAND, standing on it,
      // not a pill hanging at whatever altitude the benchmark camera is
      // flying at. That is what makes multiplayer and terrain able to
      // coexist at all. The authority spawns actors at height 0 and has
      // no DEM; with terrain, an ABSOLUTE height meant the camera claimed
      // 280,255 units against a travel budget of 37.5 and every single
      // claim was refused — a capsule frozen at its spawn point on every
      // other screen, for ever, which is the exact trap this file's header
      // warns about. Height above ground makes the spawn already correct
      // and the claim small. `view/CapsuleView` adds the terrain back at
      // the render boundary, where the terrain is known.
      return { at: pose.at, height: 0, heading: headingOfYaw(pose.yaw) };
    };

    /** How high the island is under a world position, for drawing something standing on it. */
    const groundUnder = (at: WorldPoint): number => (field === null ? 0 : field.heightAt(at));

    /**
     * Make the instrumentation list match the group of capsule meshes,
     * mark-and-sweep over rows the way `ActorViews` does over the meshes
     * themselves. Every number here is read off the mesh's own transform,
     * so a row can only exist for something that is genuinely in the
     * scene: what it publishes is the render position (`view/CapsuleView`
     * converts the WorldPoint at the render boundary), which is the
     * coordinate a person would see the capsule at.
     */
    const publishCapsules = (): void => {
      const list = capsuleList;
      const group = remoteGroup;
      if (list === null || group === null) return;
      while (list.children.length > group.children.length) list.lastElementChild?.remove();
      while (list.children.length < group.children.length) {
        list.appendChild(list.ownerDocument.createElement('span'));
      }
      group.children.forEach((object, index) => {
        const row = list.children[index] as HTMLElement;
        row.dataset.capsule = object.name;
        row.dataset.lx = object.position.x.toFixed(2);
        row.dataset.ly = object.position.y.toFixed(2);
        row.dataset.lz = object.position.z.toFixed(2);
      });
    };

    /** What the HUD says about this session. Every field measured; nothing about a link that was never opened. */
    const sessionReadout = (): SessionReadout => {
      if (net === null) return { link: networked ? 'idle' : 'solo', others: 0, refusedClaims: 0 };
      const status = net.status;
      return {
        link: LINK_OF[status.state],
        others: status.actorCount,
        refusedClaims: status.refusedClaims,
        ...(status.roundTripMs === undefined ? {} : { roundTripMs: status.roundTripMs }),
      };
    };

    /** Remember where the world put the camera, so it can tell later whether the player has moved it. */
    const placeCamera = (lx: number, height: number, lz: number, yaw: number, pitch: number): void => {
      fly.place(lx, height, lz, yaw, pitch);
      const pose = fly.pose();
      placedPose = { wx: pose.at.wx, wz: pose.at.wz, yaw: pose.yaw };
    };

    /**
     * Put the camera above the ground rather than inside it.
     *
     * World (0,0) is Waiʻaleʻale's summit plateau at 1,302 m, so START's
     * 25 units is 1.3 km underground the moment terrain exists. This is
     * only for a FRESH start: a resumed camera is where the player left
     * it, and moving it would be taking their world away.
     */
    const standOnGround = (): void => {
      if (field === null) return;
      const pose = fly.pose();
      const ground = field.heightAt(pose.at);
      const clearance = networked ? NETWORKED_CLEARANCE : START_CLEARANCE;
      placeCamera(START.x, ground + clearance, START.z, START_YAW, networked ? START.pitch : START_PITCH);
      pace();
    };

    /**
     * RESCUE A RESUMED CAMERA THAT IS NOW INSIDE A MOUNTAIN.
     *
     * Every save written before terrain existed holds a pose from the
     * empty world — START is 25 units up, and the whole grid room was
     * 2,000 units across, so every such pose is a few hundred units above
     * a floor that was at zero. World (0,0) is now Waiʻaleʻale's summit
     * plateau at 1,302 m, so restoring one of those poses puts the camera
     * 1.3 km INSIDE the mountain, looking at the underside of the terrain
     * (the material is double-sided, so it is not even transparent), with
     * no lift gesture on a phone and, at the empty world's 40 units a
     * second, the better part of an hour of holding forward to climb out.
     *
     * The save format did not change and should not have to: a pose is
     * only invalid relative to ground that did not exist when it was
     * written. So the check is against the ground, not against a version.
     * A camera already in the open is left exactly where the player left
     * it — this only ever lifts, never lowers, and never turns.
     */
    const standClearOfGround = (): void => {
      if (field === null) return;
      const pose = fly.pose();
      const ground = field.heightAt(pose.at);
      if (pose.height > ground + RESUME_MARGIN) {
        // In the open — an ant's eye over the grass included. Its pace
        // still has to suit the island.
        pace();
        return;
      }
      const local = toLocal(pose.at);
      placeCamera(local.lx, ground + RESUME_CLEARANCE, local.lz, pose.yaw, pose.pitch);
      pace();
    };

    /**
     * A flying pace that suits the height it is flown at.
     *
     * The empty world's 40 units a second is 0.4 m/s, right for a room
     * 20 m across and four hours' flying across a 56 km island. It lived
     * inside the fresh-start path, so a RESUMED session — including one
     * saved from this very build — came back at 0.4 m/s with no gesture
     * on a phone to change it: `CameraPose` carries no speed, and
     * FreeFlyCamera's only speed setter was the mouse wheel (the stick,
     * since 2026-09-07, scales the pace but never raises the ceiling).
     */
    const pace = (): void => {
      // IN A ROOM, THE AUTHORITY PAYS FOR EVERY STEP. It earns an actor
      // walkSpeed x sprintFactor x tolerance = 150 units a second of
      // travel and banks at most 37.5, so a camera flying faster than
      // that has its claims refused and stands still on everybody else's
      // screen. Solo, nobody is paying.
      fly.speed = networked ? Math.min(cameraTop, NETWORKED_MAX_SPEED) : cameraTop;
    };

    /**
     * Build the sea at the tier the player has chosen — or rebuild it,
     * when they have chosen a different one.
     *
     * A TIER IS A COMPILED PROGRAM AND A LOADED TEXTURE, so it cannot be
     * a uniform: the octave count is baked into the fragment shader and
     * the texture rung is a different file. Rebuilding is the honest
     * mechanism, and it is cheap because it happens on a state change —
     * the pause menu is where the setting is changed, and returning from
     * it is that change.
     */
    const buildOcean = (): void => {
      if (field === null || swell === null) return;
      const set = hooks.settings?.();
      const tier = resolveTier(hooks.tierOverride ?? null, tierFor(set?.textures ?? 'medium'));
      const detail = resolveDetail(hooks.detailOverride ?? null, detailFor(set?.detail ?? 'medium'));
      if (ocean !== null && builtTier === tier && builtDetail === detail) return;
      if (ocean) {
        three.remove(ocean.group);
        ocean.dispose();
        ocean = null;
      }
      // The textures are the sea's, not a sheet's: one copy, shared by
      // both sheets, freed here and nowhere else.
      seaTextures?.dispose();
      seaTextures = new SeaTextures({
        tier,
        deviceAnisotropy: ctx.renderer.gl.capabilities.getMaxAnisotropy(),
        base: import.meta.env.BASE_URL,
      });
      ocean = new OceanView({ field, swell, textures: seaTextures, detail });
      builtTier = tier;
      builtDetail = detail;

      // THE FRESH WATER SHARES THE SEA'S TEXTURES AND ITS RUNG. Joshua
      // asked for inland water that looks like the ocean; sharing the
      // baked textures is most of how that is true, and baking a second
      // set would be a second answer to what water looks like.
      fresh?.dispose();
      fresh = null;
      waterQuery = null;
      if (channels !== null) {
        fresh = new IslandWater({
          field,
          swell,
          textures: seaTextures,
          detail,
          octaves: OCEAN_OCTAVES[detail],
          isChannel: channels.isChannel,
        });
        three.add(fresh.group);
        fresh.group.visible = freshOn;
        // The one door the resource layer (and through it the creatures)
        // has to the water: a READ of the solver's spots and the ground.
        waterQuery = waterQueryOf(fresh, groundUnder);
        // FILLED BEHIND THE LOADING SCREEN, exactly as the ocean's
        // sheets are: `buildOcean` runs before the first drawn frame,
        // and a ten-second warm-up on the first FRAME is a freeze the
        // player sees rather than water that is already there.
        fresh.prime(fly.pose().at, BASEFLOW_PER_SECOND);
      }
      three.add(ocean.group);
      ocean.group.visible = oceanOn;
      // The sheets have to be filled before the first drawn frame, or
      // the sea is a flat plane at the origin for one frame.
      ocean.update(fly.pose().at, fly.camera.far);
      // AND THAT FILL IS LOAD TIME, NOT FRAME TIME. It happens behind the
      // loading screen, or behind the pause menu on a quality change, and
      // no frame was dropped for it. Left in, it would land on the first
      // frame that ticks and stand as the cost record's peak forever —
      // reporting a hitch the player never saw and hiding the first real
      // one behind it.
      ocean.resetCost();
    };

    /** Show or hide the water. */
    const syncOceanLayer = (): void => {
      oceanOn = toggles.isEnabled('ocean');
      if (ocean !== null) ocean.group.visible = oceanOn;
      // THE SWELL'S LATTICE FOLLOWS THE DRAWN SHEET, so a hidden ocean
      // must not leave gameplay sampling the chords of a mesh nobody is
      // drawing. Registered on the next update when it comes back.
      if (!oceanOn) swell?.clearLattice();
    };

    /** Show or hide the fresh water. */
    const syncFreshLayer = (): void => {
      freshOn = toggles.isEnabled('freshwater');
      if (fresh !== null) fresh.group.visible = freshOn;
    };

    /**
     * Build the object bubble at the detail rung the player has chosen —
     * or rebuild it when they have chosen a different one.
     *
     * THE RUNG NEVER REACHES THE WORLD. It sets the bubble's radius and
     * its caps (`world/objects/budget.ts`); the habitat and the populator
     * are handed the same seed and the same island at every rung, so a
     * tree stands where it stands at low and at high (Joshua, 2026-09-06,
     * and `tests/floraWorldObjects.test.ts` holds it there).
     */
    const buildObjects = (): void => {
      if (field === null || habitat === null) return;
      const set = hooks.settings?.();
      const detail = resolveDetail(hooks.detailOverride ?? null, detailFor(set?.detail ?? 'medium'));
      if (objects !== null && builtObjectsDetail === detail) return;
      if (objects) {
        three.remove(objects.group);
        objects.dispose();
        objects = null;
      }
      const map = habitat;
      objects = new WorldObjects({
        field,
        habitatAt: (at) => map.at(at),
        seed: WORLD_SEED,
        detail,
        radius: objectRadius(detail),
      });
      builtObjectsDetail = detail;
      objectsRadius = objectRadius(detail);
      three.add(objects.group);
      objects.group.visible = objectsOn;
      // THE RESOURCE LAYER, ONCE. It reads the objects through the live
      // variable, so a rebuilt bubble is read as it stands; the water
      // through `waterQuery`, which follows the water; and nothing of it
      // depends on the rung — the sites are the plants', and a rung that
      // draws fewer plants still derives from the cell's full population.
      if (resources === null) {
        resources = new ResourceLayer({
          world: {
            habitatAt: (at) => map.at(at),
            plantsOf: (cx, cz) => {
              const population = objects?.populationOf({ cx, cz }) ?? null;
              return population === null ? null : plantSourcesOf(population, PLANT_FAMILIES);
            },
            get water(): WaterQuery | null {
              return waterQuery;
            },
          },
          seed: WORLD_SEED,
          now: () => performance.now(),
        });
      }
      // THE ANIMALS, ONCE, AND THEIR RUNG EVERY TIME. The simulation reads
      // the same live variables the resource layer does; the rung reaches
      // it as caps that are maximums (`creatures/species.ts`), never as
      // where an animal is.
      if (creatures === null) {
        const ground = field;
        creatures = new CreatureSim({
          world: {
            groundAt: (at) => ground.heightAt(at),
            normalAt: (at) => ground.normalAt(at),
            habitatAt: (at) => map.at(at),
            plantsOf: (cx, cz) => {
              const population = objects?.populationOf({ cx, cz }) ?? null;
              return population === null ? null : plantSourcesOf(population, PLANT_FAMILIES);
            },
            // Off, the layer answers nothing: the creatures stop finding sites.
            resourcesOf: (cx, cz) => (resourcesOn && resources !== null ? resources.sitesOf(cx, cz) : null),
            get water(): WaterQuery | null {
              return waterQuery;
            },
            weather: () => ({
              rainMmHr: weatherNow.rainMmHr,
              windX: weatherNow.windX,
              windZ: weatherNow.windZ,
              // Night is the real sun's, below the real horizon.
              night: sunElevationDeg < 0,
            }),
            disturbances: () => {
              const pose = fly.pose();
              return [{ at: pose.at, height: pose.height, radius: EYE_PRESENCE }];
            },
          },
          seed: WORLD_SEED,
          rung: detail,
          now: () => performance.now(),
        });
      } else {
        creatures.setRung(detail);
      }
      if (fauna === null) {
        const ground = field;
        fauna = new FaunaView({
          species: creatures.species,
          loadModel: assets.loadModel,
          rung: detail,
          groundAt: (at) => ground.heightAt(at),
        });
        // The rigs load in the background; the impostors carry the
        // animals until they arrive, and a rig that never arrives is a
        // box of the species' size — an honest body, not an absence.
        void fauna.ready();
        for (const id of CREATURE_IDS) fauna.setEnabled(id, speciesOn[id]);
        three.add(fauna.group);
      } else {
        fauna.setRung(detail);
      }
      if (finder === null) {
        const ground = field;
        finder = new FinderView({ groundAt: (at) => ground.heightAt(at) });
        finder.setEnabled(finderOn);
        three.add(finder.group);
      }
      // FILLED BEHIND THE LOADING SCREEN, like the terrain's rings and
      // the sea's sheets: every cell within reach generated now, so the
      // first drawn frame has grass in it and pays nothing for it.
      const pose = fly.pose();
      objects.prime(pose.at, pose.height);
    };

    /** Show or hide the world's objects. */
    const syncObjectsLayer = (): void => {
      objectsOn = toggles.isEnabled('vegetation');
      if (objects !== null) objects.group.visible = objectsOn;
    };

    /**
     * Switch the resource layer: off, the sites stop being derived and
     * the creatures stop finding them (`resourcesOf` answers null), and
     * the HUD's line reads `sites off`. Nothing is drawn for a resource
     * yet, so there is no group to hide.
     */
    const syncResourcesLayer = (): void => {
      resourcesOn = toggles.isEnabled('resources');
    };

    /**
     * Switch a species: off, it is dropped from the simulation (and from
     * the renderer, which draws what the simulation holds) and nothing of
     * it is generated; the world forgets nothing, because the population
     * is a function of the cell.
     */
    const syncCreatureLayers = (): void => {
      if (creatures === null) return;
      for (const id of CREATURE_IDS) {
        const on = toggles.isEnabled(SPECIES_LAYER[id]);
        if (on === speciesOn[id]) continue;
        speciesOn[id] = on;
        creatures.setEnabled(id, on);
        fauna?.setEnabled(id, on);
      }
    };

    /**
     * Walk the bubble after the camera. Every frame, on no dt at all:
     * the objects do not animate, so there is nothing to integrate, and
     * a paused world's camera still flies (raw dt) and still wants the
     * ground it flies over to be grown.
     */
    const updateObjects = (): void => {
      if (objects === null) return;
      if (toggles.isEnabled('vegetation') !== objectsOn) syncObjectsLayer();
      if (!objectsOn) return;
      const pose = fly.pose();
      objects.update(pose.at, pose.height);
    };

    /**
     * Walk the resource layer after the objects, on SIMULATION seconds:
     * its water edges are re-read on a sim clock, and a paused world's
     * rivers do not move. Its reach is the creatures' — the farthest any
     * species looks for a drink or a meal (`RESOURCE_REACH`) — held
     * inside the objects' bubble, because a cell with no plants resident
     * derives nothing and would only wait.
     */
    const updateResources = (dt: number): void => {
      if (resources === null) return;
      if (toggles.isEnabled('resources') !== resourcesOn) syncResourcesLayer();
      if (!resourcesOn) return;
      resources.update(fly.pose().at, Math.min(objectsRadius, RESOURCE_REACH), dt);
    };

    /**
     * Think and move the animals on SIMULATION seconds — paused, they
     * hold still with the water and the sky — and stream their cells
     * after the camera whatever dt is, so a paused world still fills in
     * around a flying eye the way the objects do.
     */
    const updateCreatures = (dt: number): void => {
      if (creatures === null) return;
      syncCreatureLayers();
      const pose = fly.pose();
      creatures.update(pose.at, dt);
      // Drawn AFTER they moved, at where they are this frame.
      if (fauna !== null) fauna.update(creatures.creatures(), pose.at, dt, pose.height);
      // And the pins over them, from the same list, at the size the
      // camera's own field and the viewport make PIN_PIXELS. Off, this
      // is one `visible` check.
      if (finder !== null && finderOn) {
        finder.update(creatures.creatures(), pose.at, {
          fovRadians: (fly.camera.fov * Math.PI) / 180,
          heightPx: viewHeight,
          at: fly.camera.position,
        });
      }
    };

    /**
     * TAKE THE CAMERA TO THE NEAREST ANIMAL — the half of the finder a
     * pin cannot do. A 15 cm worm has to be looked at from about 45 cm
     * to fill any part of a phone screen, and nobody flies a stick to
     * within 45 cm of a marker. `creatures/finder.viewpointFor` decides
     * where to stand (from the side the camera is already on, above the
     * GROUND when the animal is under it); this only turns its heading
     * into a camera yaw, which is the one place that conversion lives.
     */
    const goToNearest = (): void => {
      if (creatures === null || !finderOn) return;
      const pose = fly.pose();
      const ground = field;
      const groundAt = ground === null ? undefined : (at: WorldPoint): number => ground.heightAt(at);
      // A DIFFERENT ANIMAL EACH PRESS, by SPECIES rather than by
      // distance. Excluding the last animal was tried first and is not
      // enough: aphids live in colonies (`population.clump` 0.9), so the
      // next-nearest is another aphid a centimetre away on the same
      // leaf, and ten presses are ten photographs of one plant. Rotating
      // the species shows the three MODELS, which is what was asked for.
      // A species whose only candidates are underground is passed over —
      // there is nothing to look at there — and only if no species has
      // one above ground does it fall back to the nearest of anything,
      // which is when the readout says `under` and means it.
      const list = creatures.creatures();
      const from = lastShown === null ? 0 : (CREATURE_IDS.indexOf(lastShown) + 1) % CREATURE_IDS.length;
      let near = null;
      for (let i = 0; i < CREATURE_IDS.length && near === null; i += 1) {
        const id = CREATURE_IDS[(from + i) % CREATURE_IDS.length];
        const found = nearestSighting(list, pose.at, {
          groundAt, preferVisible: true, species: new Set<CreatureId>([id]),
        });
        if (found !== null && !isUnderground(found)) near = found;
      }
      if (near === null) near = nearestSighting(list, pose.at, { groundAt, preferVisible: true });
      if (near === null) return;
      lastShown = near.species;
      const view = viewpointFor(near, CREATURE_SPECIES[near.species], { from: pose.at, groundAt });
      const local = toLocal(view.at);
      placeCamera(local.lx, view.height, local.lz, yawForHeading(view.heading), view.pitch);
      // AND GET THE SHEET OUT OF THE WAY. The camera puts the animal at
      // the centre of the screen, and the centre of a 932 x 430 screen is
      // underneath the stat sheet — so without this, pressing GO flies to
      // the worm and then hides it, which reads as nothing happening.
      // The FOLD only, never the setting: `collapsed` deliberately does
      // not fire `onCollapse` (see PerfHud), so the player's own choice
      // is still in the document and one tap on the corner brings the
      // sheet back.
      if (hud !== null) hud.collapsed = true;
    };

    /**
     * Rain on the island, run the water, and walk the window after her.
     *
     * `dt` is SIMULATION seconds, like the sea's: the weather and the
     * water stop when the world is paused, or a paused world would come
     * back to a flood.
     *
     * THE FEED IS TWO NUMBERS AND THEY ARE NOT THE SAME NUMBER. Rain
     * falls on EVERY cell and only while it is raining; baseflow goes
     * into the CHANNEL cells alone and never stops. That is why the
     * island drains between showers instead of every slope staying
     * permanently wet — the thing Joshua asked v0 about, and the reason
     * `drainage.ts` exists at all.
     */
    /**
     * The weather's frame: advance it by SIMULATION seconds (paused, the
     * sky holds still with everything else), read it where the camera
     * is, ask for fresh readings when they are due, and find the sun.
     * Runs before the water, which reads the rain this frame took.
     */
    const updateWeather = (dt: number): void => {
      if (toggles.isEnabled('weather') !== weatherOn) syncWeatherLayer();
      weather.tick(dt);
      const at = fly.pose().at;
      weatherNow = weather.sample(at);
      if (weather.dueForRefresh()) void weather.refresh();
      sunNow = sunPosition(clock(), worldToGeo(at));
      sunElevationDeg = sunNow.elevation * (180 / Math.PI);
      // The dome and the light it drives, BEFORE the water's fog: under
      // the sea the underwater look overwrites what the sky set, every
      // frame, which is the order that makes the surface the boundary.
      const look = skyLook(weatherNow, sunNow);
      if (weatherOn && skyView !== null) skyView.update(look, fly.camera);
      // No streaks fall through the sea: under the surface the rain view
      // holds still and hidden (`adaptWater` hides it), and catches up
      // when the eye comes back up.
      if (weatherOn && rain !== null && !underwater) rain.update(weatherNow, fly.camera, dt);
      // THE LENS (the lighting polish): rain reaches the eye when the eye
      // looks up into it or the wind drives it in — the same eased
      // strength the streaks fade by, the same wind, and none of it under
      // water or with the weather off.
      const strength = weatherOn && rain !== null ? rain.strength : 0;
      if (lens !== null) {
        const pose = fly.pose();
        const exposure = underwater || strength <= 0
          ? 0
          : lensExposure({ pitch: pose.pitch, yaw: pose.yaw, windX: weatherNow.windX, windZ: weatherNow.windZ, strength }).exposure;
        lens.update(strength, exposure, dt, Math.min(1, look.sunIntensity));
      }
      // THE GROUND'S WETNESS: the shore band from the swell's own crest
      // envelope, rain wetness eased up in seconds and dried over
      // minutes. Two scalars a frame, appearance only; nothing here can
      // reach a height.
      if (shoreWet === DRY_SHORE && swell !== null) shoreWet = { ...shoreWetnessOf(swell.reach()), rain: 0 };
      rainWet = easeRainWetness(rainWet, strength, dt);
      if (terrain !== null) terrain.setWetness({ shoreTop: shoreWet.shoreTop, shoreFade: shoreWet.shoreFade, rain: rainWet });
    };

    /**
     * The dome and the rain, at the rungs the settings name. A no-op when
     * nothing changed; a rebuild when a rung did, because the dome's
     * images are baked per rung and the rain's cap is the detail rung's.
     */
    const buildSky = (): void => {
      if (terrain === null || light === null || sky === null) return;
      const set = hooks.settings?.();
      const tier = resolveTier(hooks.tierOverride ?? null, tierFor(set?.textures ?? 'medium'));
      const detail = resolveDetail(hooks.detailOverride ?? null, detailFor(set?.detail ?? 'medium'));
      if (skyView !== null && builtSkyTier !== tier) {
        three.remove(skyView.group);
        skyView.dispose();
        skyView = null;
        builtShadowDetail = null;
      }
      if (skyView === null) {
        skyView = new SkyView({ tier, load: skyLoaderFor({ base: import.meta.env.BASE_URL }) });
        skyView.bind({ sun: light, hemisphere: sky, fog: three.fog as THREE.Fog | null, background: three.background as THREE.Color });
        three.add(skyView.group);
        builtSkyTier = tier;
      }
      // THE SUN'S SHADOW, BY RUNG (the lighting polish): a camera-following
      // box the size the Detail rung names, none below medium. The rung
      // reaches the sky view as a configuration; whether a shadow is cast
      // this frame is the sun's — by hour and by cloud — inside `update`.
      if (builtShadowDetail !== detail) {
        const shadow = shadowFor(detail);
        skyView.setShadow(shadow.mapSize > 0 ? shadow : null);
        builtShadowDetail = detail;
        shadowWord = shadow.mapSize > 0 ? `shadow ${shadow.mapSize} · ${(shadow.reach * 2) / 100} m` : 'shadow off';
      }
      // THE LENS, with the rain and at its rung: a pooled overlay, absent
      // at ultra-low the way the streak cap says so.
      if (lens !== null && builtLensDetail !== detail) {
        lens.dispose();
        lens = null;
      }
      if (lens === null) {
        lens = new LensView({ detail });
        builtLensDetail = detail;
        if (viewWidth > 0) {
          const pr = hooks.pixelRatio?.() ?? 1;
          lens.resize(viewWidth * pr, viewHeight * pr);
        }
      }
      if (rain !== null && builtRainDetail !== detail) {
        three.remove(rain.group);
        rain.dispose();
        rain = null;
      }
      if (rain === null) {
        rain = new RainView({ detail });
        three.add(rain.group);
        builtRainDetail = detail;
      }
      skyView.group.visible = weatherOn;
      rain.group.visible = weatherOn;
    };

    /**
     * Show or hide the sky's weather: the dome, the rain and the light it
     * drives. Off, the world goes back to the fixed noon it shipped with
     * — the same numbers `skyLook` gives a clear noon, so the toggle
     * measures the sky's COST and not a different look. The reading
     * itself never stops: the HUD's line still moves with the island.
     */
    const syncWeatherLayer = (): void => {
      weatherOn = toggles.isEnabled('weather');
      if (skyView !== null) skyView.group.visible = weatherOn;
      if (rain !== null) rain.group.visible = weatherOn && !underwater;
      if (weatherOn || light === null || sky === null) return;
      // Off, the sun stands at a fixed local direction millions of units
      // from the eye and could shadow nothing near it; it casts nothing.
      light.castShadow = false;
      // The noon numbers written below are the base the underwater look
      // scales from now; re-latch them on the next submerged frame.
      underwaterLit = false;
      light.color.set(0xfff4e0);
      light.intensity = 1.15;
      light.position.set(200, 400, 100);
      light.target.position.set(0, 0, 0);
      light.target.updateMatrixWorld();
      sky.color.set(HORIZON);
      sky.groundColor.set(GROUND_BOUNCE);
      sky.intensity = 1.0;
      const fog = three.fog as THREE.Fog | null;
      if (fog !== null) fog.color.set(HORIZON);
      (three.background as THREE.Color).set(HORIZON);
      // near/far belong to `adaptDepth`, as they do when she surfaces.
      builtNear = 0;
      adaptDepth();
    };

    const updateFresh = (dt: number): void => {
      if (fresh === null) return;
      if (toggles.isEnabled('freshwater') !== freshOn) syncFreshLayer();
      if (!freshOn) return;
      fresh.update(fly.pose().at, dt, rainToUnitsPerSecond(weatherNow.rainMmHr), BASEFLOW_PER_SECOND);
      fresh.tick(dt);
    };

    /**
     * Point the sea at the camera and advance the ONE clock. One call a
     * frame, and the only `tick` call site in the build.
     */
    const updateOcean = (dt: number): void => {
      if (ocean === null) return;
      if (toggles.isEnabled('ocean') !== oceanOn) syncOceanLayer();
      if (!oceanOn) return;
      // THE SEA REACHES AS FAR AS THE CAMERA CAN SEE. `adaptDepth` has
      // already run this frame and put the far plane on the camera's
      // altitude, so this is the same view distance the projection was
      // just built with — and the far sheet is sized from it. Without
      // this the sheets are the 8.2 km v0 gave an ant on a beach, which
      // from 1.5 km above the middle of Kauaʻi is entirely inside the
      // island: the probe measured the ocean costing three times the
      // frame and changing not one pixel of the world.
      //
      // The NEAR sheet does not grow, and that is right rather than an
      // oversight: it carries the swell, whose wavelengths are 3.6 m and
      // 2.1 m, and from a kilometre up there is no such wave to resolve.
      // It comes into its own as the camera descends.
      ocean.update(fly.pose().at, fly.camera.far);
      ocean.tick(dt);
    };

    /**
     * Show or hide the ground, and move the fog to the scale of whatever
     * is being looked at. Called when the toggle changes, not every frame.
     */
    const syncTerrainLayer = (): void => {
      terrainOn = toggles.isEnabled('terrain');
      if (terrain !== null) terrain.group.visible = terrainOn;
      if (grid !== null) grid.visible = !terrainOn;
      // The fog is NOT set here: with terrain it belongs to the far
      // plane, which rides the camera's height (see `adaptDepth`), and a
      // second writer at a fixed distance is how it ended up ahead of the
      // far plane in the first place. Turning terrain off is handled
      // there too, on the same frame.
      builtNear = 0;
    };

    /**
     * Ride the near plane on the camera's height above the ground, and
     * keep the far plane a fixed ratio beyond it — see DEPTH_RATIO. Only
     * rebuilds the projection when the near plane has really moved,
     * because that is a matrix, not a number.
     */
    const adaptDepth = (): void => {
      const camera = fly.camera;
      const fog = three.fog as THREE.Fog | null;
      if (!terrainOn || field === null) {
        if (builtNear === 0) return;
        builtNear = 0;
        camera.near = MIN_NEAR;
        camera.far = EMPTY_WORLD_FAR;
        camera.updateProjectionMatrix();
        if (fog) {
          fog.near = FOG_NEAR;
          fog.far = FOG_FAR;
        }
        return;
      }
      const pose = fly.pose();
      const altitude = Math.abs(pose.height - field.heightAt(pose.at));
      const near = Math.min(MAX_NEAR, Math.max(MIN_NEAR, altitude / 1000));
      if (builtNear !== 0 && near < builtNear * NEAR_HYSTERESIS && near > builtNear / NEAR_HYSTERESIS) return;
      builtNear = near;
      camera.near = near;
      camera.far = near * DEPTH_RATIO;
      camera.updateProjectionMatrix();
      // THE FOG HAS TO FOLLOW THE FAR PLANE, not sit at a fixed distance.
      // The far plane rides the altitude, so at 60 m up it is 3.6 km —
      // nearer than a fog that starts at 4 km, which means no fog is
      // applied anywhere in the visible range and the clipmap is sliced
      // by the far plane straight against the background: a hard disc
      // with the island's mountains cut off behind it. Fog exists exactly
      // so that edge is never a hard line, so it is expressed as a
      // fraction of the distance the camera can actually see.
      if (fog) {
        fog.near = camera.far * FOG_NEAR_OF_FAR;
        fog.far = camera.far * FOG_FAR_OF_FAR;
      }
    };

    /**
     * PUT THE WATER BETWEEN THE EYE AND EVERYTHING, when the eye is
     * under it.
     *
     * Joshua, 2026-09-06: "need to add the underwater fog." Below the
     * waterline the build drew the seabed through clear air fading to
     * the pale sky — the same thing v0 was told about, for the same
     * reason: there is a water SURFACE and nothing else, so from
     * underneath there is nothing in the way.
     *
     * THE SURFACE IS THE SWELL'S, not a flat zero. Sea level is the
     * mean, and a wave passing over her eye really does put her under
     * and take her out again — asking the swell is what makes the fog
     * wash in and out with it instead of switching on a plane she can
     * see waves crossing.
     *
     * AND SHE HAS TO BE IN THE SEA, not merely below zero. The camera
     * can fly under sea level inside a mountain, and turning the world
     * green in there would be the fog claiming water that is rock. The
     * seabed under her has to be below sea level too.
     *
     * EVERY FRAME AND WITHOUT HYSTERESIS, unlike `adaptDepth` next door:
     * this is two colour writes and two numbers, the surface moves under
     * a wave, and a fog that lagged the eye by a hysteresis step is the
     * bug it exists to fix wearing a different hat.
     */
    const adaptWater = (): void => {
      const fog = three.fog as THREE.Fog | null;
      if (fog === null) return;
      const air = { near: fog.near, far: fog.far };
      const restore = (): void => {
        if (!underwater) return;
        underwater = false;
        // Back to the air she left: the sky's live horizon when the
        // weather draws one (it rewrites it every frame anyway; this
        // stops the one-frame noon flash), the noon constant otherwise.
        fog.color.copy(weatherOn ? airColour : SKY);
        (three.background as THREE.Color).copy(weatherOn ? airColour : SKY);
        if (underwaterLit && light !== null && sky !== null) {
          light.intensity = baseSun;
          sky.intensity = baseSky;
        }
        underwaterLit = false;
        if (rain !== null) rain.group.visible = weatherOn;
        // A few drops stay on the lens as the eye comes up — the seam the
        // brief asked for, reused rather than a second effect.
        lens?.splash(SURFACING_DROPS);
        // near/far belong to `adaptDepth`, which is the only thing that
        // knows what the far plane is doing; ask it rather than
        // remembering a number that may be a scale out of date.
        builtNear = 0;
        adaptDepth();
      };
      if (field === null || swell === null || !oceanOn) {
        restore();
        return;
      }
      const pose = fly.pose();
      const ground = field.heightAt(pose.at);
      if (ground >= SEA_LEVEL) {
        restore();
        return;
      }
      const surface = swell.heightAt(pose.at, SEA_LEVEL - ground);
      const look = underwaterLook(surface - pose.height);
      if (look === null) {
        restore();
        return;
      }
      // The air fog this is blending FROM is whatever adaptDepth last
      // set, so it is re-read on the frame she goes under and not before.
      // The air's colour is re-read every frame the sky is writing it
      // (the sky runs before this, so `fog.color` is this frame's live
      // horizon), and latched on the going-under frame when it is not.
      if (weatherOn || !underwater) airColour.copy(fog.color);
      if (!underwater) {
        underwater = true;
        airFog = air;
        if (rain !== null) rain.group.visible = false;
      }
      // The light under the surface is the air's, dimmed with depth on
      // the look's own curve. The base is re-read each frame while the
      // sky writes it, latched once when it does not (weather off writes
      // the noon numbers ONCE, and a per-frame multiply would compound).
      if (light !== null && sky !== null) {
        if (weatherOn || !underwaterLit) {
          baseSun = light.intensity;
          baseSky = sky.intensity;
        }
        light.intensity = baseSun * look.light;
        sky.intensity = baseSky * look.light;
        underwaterLit = true;
      }
      // sRGB IN, because that is what the look authors and what every
      // other colour in this file is written as; three's working space
      // is linear and `setRGB` would otherwise take these as linear and
      // render a washed-out swimming-pool blue. The BLEND is in linear,
      // which is where a blend belongs — and it is blended FROM the air's
      // own colour, read from the one constant that owns it rather than
      // from three numbers copied out of it.
      fog.color.setRGB(look.r, look.g, look.b, THREE.SRGBColorSpace).lerp(airColour, 1 - look.strength);
      (three.background as THREE.Color).copy(fog.color);
      fog.near = blendSight(Math.max(1, airFog.near), 0.02 * look.sight, look.strength);
      fog.far = blendSight(Math.max(1, airFog.far), look.sight, look.strength);
    };

    /** Point the clipmap at the camera and ask for the tiles under it. One call a frame. */
    const updateTerrain = (): void => {
      if (terrain === null) return;
      if (toggles.isEnabled('terrain') !== terrainOn) syncTerrainLayer();
      // BEFORE the early return, so that switching the layer OFF actually
      // restores the near and far planes and the room-sized fog. Behind
      // it, the restore branch could never run and the empty world was
      // left being drawn through the island's projection.
      adaptDepth();
      if (!terrainOn) return;
      const at = fly.pose().at;
      terrain.update(at);
      streamer?.update(at);
    };

    /** True while the camera is still exactly where the world put it: the player has not flown. */
    const cameraUntouched = (): boolean => {
      if (placedPose === null) return false;
      const pose = fly.pose();
      return pose.at.wx === placedPose.wx && pose.at.wz === placedPose.wz && pose.yaw === placedPose.yaw;
    };

    /**
     * WATCH THE BOT YOU ASKED FOR — until you take the camera yourself.
     *
     * The player asked for somebody to watch; a camera pointing the other
     * way is the feature not working as far as they are concerned. The
     * authority spawns players a hundred units apart along +wx while this
     * camera looks along +wz, so the bot starts a third of a turn off to
     * the side, and its patrol then carries it a hundred and fifty units
     * further — enough to swing it out of frame again. One aim on join
     * was tried first and `probe:bot` caught it leaving: present,
     * correct, and off the edge of the screen.
     *
     * So the heading follows the bot, and ONLY while the camera is still
     * exactly where the world last put it. The moment the player flies or
     * looks, the pose stops matching and this hands the camera over for
     * good — no mode, no toggle, no fighting the thumbs; the measured
     * fact that the camera has moved IS the handover (§2.3).
     *
     * Position and pitch are never touched. Where you are was the
     * authority's word (see the header) and this is only which way you
     * were left looking.
     */
    const watchBot = (): void => {
      if (cameraTaken || bot === null) return;
      if (!cameraUntouched()) {
        cameraTaken = true;
        return;
      }
      const at = bot.readout.at;
      if (at === null) return;
      const pose = fly.pose();
      const dx = at.wx - pose.at.wx;
      const dz = at.wz - pose.at.wz;
      // Standing on top of it there is no direction to face, and atan2 of
      // two zeroes would snap the view to +wz for a frame.
      if (Math.hypot(dx, dz) < 1) return;
      const here = toLocal(pose.at);
      // Ahead is (sin yaw, cos yaw) in (wx, wz) — the actor convention this
      // world shares with `actor/Transform.ts`.
      placeCamera(here.lx, pose.height, here.lz, yawForHeading(Math.atan2(dx, dz)), pose.pitch);
    };

    /**
     * The bot's own state, in the words the panel prints. `net/`'s link
     * states are translated through the SAME table the SESSION line uses,
     * so the two overlays can never disagree about one relay.
     */
    const botReadout = (): BotReadout | null => {
      if (bot === null) return null;
      const r = bot.readout;
      return {
        name: r.name,
        link: LINK_OF[r.link],
        intent: r.intent,
        at: r.at === null ? null : { wx: r.at.wx, wz: r.at.wz },
        heading: r.heading,
        secondsLeft: r.secondsLeft,
        ...(r.roundTripMs === undefined ? {} : { roundTripMs: r.roundTripMs }),
        refusedClaims: r.refusedClaims,
        gone: r.phase === 'gone',
      };
    };

    const applySettings = (): void => {
      const s = hooks.settings?.();
      if (!s) return;
      fly.setFov(s.fov);
      fly.setLook({ sensitivity: s.lookSensitivity, invertY: s.invertY });
      if (hud) {
        hud.hidden = !s.showFps;
        hud.collapsed = s.hudCollapsed;
      }
      // The stick's ceiling, from the document already in hand — never a
      // second read of it, which is what `reads()` counts — so a rung
      // chosen in the pause menu is in force the moment the player
      // closes it rather than at the next resume (Joshua, 2026-09-08).
      cameraTop = CAMERA_SPEEDS[s.cameraSpeed];
      pace();
      // The finder follows the document too, so the switch survives the
      // reload the update check performs on a push.
      if (s.finderOn !== finderOn) {
        finderOn = s.finderOn;
        finder?.setEnabled(finderOn);
      }
      // The sea is a compiled program and a loaded texture per tier, so
      // a changed quality setting is a rebuild. No-ops when it has not
      // changed, which is every state change but the one that did.
      buildOcean();
      buildObjects();
      buildSky();
    };

    /** The save point: the camera, in world coordinates, through whichever session the app holds. */
    const save = async (): Promise<void> => {
      await ctx.app.session?.save({ camera: fly.pose() });
    };

    const stateChanged = (state: AppState): void => {
      seenState = state;
      applySettings();
      // The overlay just opened (PAUSE, or Escape): the first save point.
      if (state === 'paused') void save();
    };

    return {
      name: PERF_WORLD_SCENE_ID,
      three,
      camera: fly.camera,

      async enter() {
        // WHETHER A ROOM IS WATCHING, decided first: it changes how fast
        // the camera may fly (`paceFor`), and the camera is placed long
        // before the wire is built.
        networked = ctx.app.session !== null && ctx.app.session.mode === 'multiplayer';

        const progress = new LoadProgress();
        progress.define(MILESTONES);
        const reached = (id: (typeof MILESTONES)[number]['id']): void => {
          progress.report(id, 1);
          hooks.onLoadProgress?.(progress.fraction(), progress.etaMs());
        };

        grid = new THREE.GridHelper(GRID_SIZE, GRID_DIVISIONS, GRID_CENTRE, GRID_LINE);
        three.add(grid);
        reached('ground');

        // The sun, and the sky it hangs in.
        //
        // A lone directional light leaves every slope facing away from it
        // BLACK, because nothing else reaches them — which is what the
        // first terrain screenshots showed: half an island the colour of
        // nothing. Outdoors the shaded side of a hill is lit by the sky,
        // and a hemisphere light is that, cheaply: sky colour from above,
        // bounced ground from below, no shadow map and no second pass.
        light = new THREE.DirectionalLight(0xfff4e0, 1.15);
        light.position.set(200, 400, 100);
        three.add(light);
        sky = new THREE.HemisphereLight(HORIZON, GROUND_BOUNCE, 1.0);
        three.add(sky);
        // The shadow map is switched on with the lights and off at
        // dispose; with no light casting it compiles nothing extra. What
        // casts, and when, is decided per rung and per frame in the sky.
        hooks.shadows?.(true);
        reached('light');

        // THE SURVEY. Everything after this can fail without taking the
        // world with it: a world with no terrain is the empty world,
        // which is a thing this scene already is.
        if (hooks.survey) {
          try {
            const bytes = await hooks.survey((received, total) => {
              progress.report('terrain', Math.min(1, received / (total ?? COARSE_BYTES)));
              hooks.onLoadProgress?.(progress.fraction(), progress.etaMs());
            });
            const repaired = repairGrid(decodeCoarse(bytes)).grid;
            coarseGrid = repaired;
            field = new Heightfield(repaired);
            // WHERE THE ISLAND'S RIVERS ARE, from the island's own shape,
            // computed once here and never again. It reads the COARSE
            // survey rather than the heightfield deliberately: the
            // heightfield answers with whatever HD tiles have streamed
            // in, so a mask built through it would depend on how far the
            // player had walked before it was built.
            channels = islandChannels(repaired);
            terrain = new TerrainView({ field });
            streamer = new TerrainStreamer({ field });
            // THE SEA READS THE SAME GROUND, through the same object.
            // Two heightfields would be two answers about where the
            // shore is, and the sea is drawn against the shore.
            swell = new SeaSwell({ groundAt: (at) => field!.heightAt(at) });
            buildOcean();
          } catch (error) {
            console.error('[terrain] the survey did not load; the world is the empty one', error);
          }
        }
        reached('terrain');

        // WHAT GROWS WHERE. The landcover raster, then the habitat map
        // (world-fixed: the coarse survey, the drainage and the raster,
        // never the streamed field), then the object bubble at the
        // player's rung. Everything after the survey can fail without
        // taking the world with it: an island with no landcover is bare,
        // says so on the LAYERS column, and is still Kauaʻi.
        if (hooks.landcover && field !== null && coarseGrid !== null && channels !== null) {
          try {
            const veg = await hooks.landcover((received, total) => {
              progress.report('landcover', Math.min(1, received / (total ?? VEG_BYTES)));
              hooks.onLoadProgress?.(progress.fraction(), progress.etaMs());
            });
            habitat = new HabitatMap({ landcover: decodeVeg(veg), coarse: coarseGrid, isChannel: channels.isChannel });
          } catch (error) {
            console.error('[vegetation] the landcover did not load; the island is bare', error);
          }
        }
        reached('landcover');

        /**
         * THE ANSWER TO "CPU OR GPU", on the device rather than in a
         * probe. The ocean times its own `update` and `tick`; the HUD is
         * handed four numbers and never learns what an OceanView is.
         *
         * Read against the frame rate the lines sit under: a sea costing
         * a fraction of a millisecond while the frame rate halves is a
         * sea spending on the GPU, and the texture rung is the lever. The
         * record is read ONCE — it is a fresh frozen snapshot per call,
         * and taking three would be three of them.
         *
         * The vertex count is NOT passed on: it is fixed per rung
         * (`sheetVertexCount`), so on screen it would be the rung said
         * twice, and screen width is the scarcest thing the HUD has.
         */
        const seaCost = (): SeaReadout | null => {
          if (ocean === null) return null;
          const cost = ocean.cost;
          return { meanMs: cost.meanMs, peakMs: cost.peakMs, detail: ocean.detail, tier: seaTextures?.tier ?? null };
        };

        /** What the island's water costs, and how much of it there is. */
        const freshCost = (): FreshReadout | null => {
          if (fresh === null) return null;
          const c = fresh.cost;
          return { meanMs: c.meanMs, peakMs: c.peakMs, wetCells: c.wetCells, cells: c.cells };
        };

        /** What the world's objects cost, and how many are drawn. */
        const objectsCost = (): ObjectsReadout | null => {
          if (objects === null) return null;
          const c = objects.cost;
          return {
            meanMs: c.meanMs, peakMs: c.peakMs, cells: c.cells, pending: c.pending,
            grass: c.drawn.grass, twig: c.drawn.twig, stone: c.drawn.stone, rock: c.drawn.rock, tree: c.drawn.tree,
            // The seven ground-plant families of the ecology pass, as one count: grass and trees have their own lines.
            plants: PLANT_FAMILIES.reduce((sum, family) => (family === 'grass' || family === 'tree' ? sum : sum + c.drawn[family]), 0),
            habitat: c.habitat,
          };
        };

        /**
         * The animals' block: each species as `resident of cap`, the
         * three costs, the sites the resource layer holds, and the
         * terrain-edit seam's honest word. Null before the simulation is
         * built; the hook is absent where there is no landcover at all.
         */
        const creaturesReadout = (): CreaturesReadout | null => {
          if (creatures === null) return null;
          const sim = creatures;
          const species = (id: CreatureId): SpeciesReadout => {
            const c = sim.counts(id);
            return { resident: c.resident, near: c.byTier.near, full: c.byTier.full, cap: c.cap };
          };
          const cost = sim.cost();
          let sites = 0;
          let waterEdges = 0;
          if (resourcesOn && resources !== null) {
            const counts = resources.counts();
            for (const kind of Object.keys(counts) as (keyof typeof counts)[]) sites += counts[kind];
            waterEdges = counts['water-edge'];
          }
          return {
            worms: species('earthworm'),
            aphids: species('aphid'),
            flies: species('housefly'),
            thinkMs: cost.thinkMs,
            moveMs: cost.moveMs,
            drawMs: fauna === null ? 0 : fauna.cost.meanMs,
            rigs: fauna === null ? 0 : CREATURE_IDS.reduce((sum, id) => sum + (fauna?.cost.rigsLent[id] ?? 0), 0),
            resources: resourcesOn && resources !== null ? { sites, waterEdges } : null,
            ground: { built: sim.burrows.editor.built, attempted: sim.burrows.attempted },
          };
        };

        /**
         * THE FINDER'S LINE. The word for each species is chosen here
         * and not in the sheet, which prints what it is told: `worm`,
         * `aphid`, `fly` — the singulars, because this line names ONE
         * animal while the three above it count populations.
         */
        const finderReadout = (): FinderReadout => {
          const sim = creatures;
          if (sim === null || !finderOn) return { on: finderOn, pins: 0, nearest: null };
          const ground = field;
          const groundAt = ground === null ? undefined : (at: WorldPoint): number => ground.heightAt(at);
          const eye = fly.pose().at;
          // `preferVisible`: the line names the animal GO would take the
          // camera to, and GO goes to one that can be looked at.
          const near = nearestSighting(sim.creatures(), eye, { groundAt, preferVisible: true });
          return {
            on: true,
            pins: finder?.cost.pins ?? 0,
            nearest: near === null ? null : {
              species: FINDER_WORD[near.species],
              metres: metresOfUnits(near.distance),
              bearing: compassBearing(headingTo(eye, near.at)),
              under: isUnderground(near),
            },
          };
        };

        hud = new PerfHud(ctx.uiLayer, {
          layers: () => toggles.list(),
          onLayerToggle: (id, enabled) => {
            toggles.setEnabled(id, enabled);
          },
          // THE INSTRUMENT, only where there are animals to find.
          finder: habitat === null ? undefined : finderReadout,
          onFinderToggle: (on) => {
            finderOn = on;
            finder?.setEnabled(on);
            hooks.onFinderToggle?.(on);
          },
          onFinderGo: goToNearest,
          onCollapse: (collapsed) => hooks.onHudCollapse?.(collapsed),
          session: sessionReadout,
          fresh: field === null ? undefined : freshCost,
          // THE LINES EXIST ONLY WHERE THERE IS LANDCOVER TO GROW FROM.
          objects: habitat === null ? undefined : objectsCost,
          creatures: habitat === null ? undefined : creaturesReadout,
          // THE SKY'S LINES, always: the reading exists whether or not
          // there is an island under it, and its source word is the
          // honesty rule in print.
          weather: () => ({
            sky: weatherNow.sky,
            rainMmHr: weatherNow.rainMmHr,
            cloud: weatherNow.cloud,
            source: weatherNow.source,
            clock: kauaiClock(clock()),
            sunElevationDeg,
            ...(shadowWord === '' ? {} : { shadow: shadowWord }),
          }),
          // THE COLUMN EXISTS ONLY WHERE A SEA DOES. Whether this world
          // has one is settled by now — `buildOcean` has already run, and
          // it can only ever succeed if the survey downloaded — so an
          // empty world offers no hook at all rather than a SEA line
          // reading "not built yet" about an ocean that is never coming.
          // Same rule as SESSION, and the same rule as the layer labels.
          ...(ocean === null ? {} : { sea: seaCost }),
        });
        // Its fold comes with the first `applySettings`, on the first
        // frame's state change, like `hidden` does — one read of the
        // document, not two.
        // THE STICK — v0's, fixed and visible, bottom-left (Joshua,
        // 2026-09-07). It lives in the UI layer beside the HUD and reads
        // into the camera every frame; the camera turns its push into a
        // pace between 1 m/s and the camera's own speed.
        stick = new MoveStick(ctx.uiLayer);
        pauseButton = actionButton(ACTION.pause, 'Pause', () => hooks.onPause());
        pauseButton.style.cssText =
          'position:absolute;right:12px;top:8px;padding:10px 18px;font:14px system-ui,sans-serif;' +
          'color:#e8e2c8;background:#1a2014;border:1px solid #c9a94a;border-radius:6px;';
        ctx.uiLayer.appendChild(pauseButton);
        reached('hud');

        // The saved pose replaces START only once the world exists to stand
        // in; and the save point is handed over only now, so the owner can
        // never save a camera the world has not placed.
        const from = hooks.resume?.();
        if (from) {
          fly.restore(from.camera);
          standClearOfGround();
        } else {
          standOnGround();
        }
        hooks.onSavePoint?.(save);

        // THE BUBBLE, ONLY NOW: after the camera is where it will be.
        // Built in the landcover block above, it was primed around START
        // — the summit plateau — and a resumed player then arrived at
        // their beach to a bubble streaming in from twenty kilometres
        // away, three cells a frame. `probe:objects` measured it: 37
        // cells still queued forty frames after arrival, and no grass.
        buildObjects();

        // Terrain is the world now, so it comes up ON — but only when
        // there IS terrain. The toggle is still the way to measure what
        // it costs; turning it off is what the empty world was.
        // `vegetation` is BUILT only when the landcover actually landed:
        // a row that reads built over a bare island is a control that
        // looks functional and is not (§2.9), and the raster is a
        // download that can fail on its own.
        // `resources` is gated the same way — its sites are the plants' —
        // and the three species rows are gated on the simulation below,
        // so a row never reads built over something that is not (§2.9).
        toggles = new LayerToggles(terrain === null ? [] : BUILT_LAYERS.filter((id) => {
          if (id === 'vegetation' || id === 'resources') return objects !== null;
          if (id === 'worms' || id === 'aphids' || id === 'flies') return creatures !== null;
          return true;
        }));
        if (terrain !== null) {
          toggles.setEnabled('terrain', true);
          three.add(terrain.group);
          syncTerrainLayer();
          // THE FIRST FILL, HERE, BEHIND THE LOADING SCREEN. All eight
          // rings at once is the single most expensive frame the terrain
          // ever has (~34 ms on a desktop, several times that on a
          // phone). Paying it while the loading bar is still up costs
          // nobody anything; paying it on the first frame of play is a
          // visible lurch the moment the world appears.
          terrain.update(fly.pose().at);
          adaptDepth();
        }
        // AND THE SEA WITH IT. The island is surrounded by water and a
        // Kauaʻi with none is a mesa; the toggle is still how you measure
        // what the ocean costs, which is the whole reason Joshua asked
        // for the tiers. Its first fill has already happened inside
        // `buildOcean`, behind the loading screen, for the same reason
        // the terrain's did.
        if (ocean !== null) {
          toggles.setEnabled('ocean', true);
          syncOceanLayer();
        }
        // AND THE ISLAND'S OWN WATER. On for the same reason: Kauaʻi
        // without its rivers is not Kauaʻi, and the toggle is how its
        // cost gets measured rather than argued about.
        if (fresh !== null) {
          toggles.setEnabled('freshwater', true);
          syncFreshLayer();
        }
        // AND THE GROUND'S OWN CLUTTER. On, because an island with no
        // grass is a model of one; the toggle is how its cost is measured,
        // which is the point of this milestone.
        if (objects !== null) {
          toggles.setEnabled('vegetation', true);
          syncObjectsLayer();
        }
        // AND WHAT THE ISLAND OFFERS, derived from those objects.
        if (resources !== null) {
          toggles.setEnabled('resources', true);
          syncResourcesLayer();
        }
        // AND THE ANIMALS, each species its own row, so one can be
        // switched off and read for what it cost.
        if (creatures !== null) {
          for (const id of CREATURE_IDS) toggles.setEnabled(SPECIES_LAYER[id], true);
          syncCreatureLayers();
        }
        // AND THE SKY. On wherever there is an island for it to be over;
        // the toggle is how what it costs gets measured, like the rest.
        if (terrain !== null) {
          toggles.setEnabled('weather', true);
          buildSky();
          syncWeatherLayer();
        }

        // The wire, last: the world is already whole and measurable
        // without it, which is the point — a relay that never answers
        // costs this scene nothing but an honest line in the HUD.
        const session = ctx.app.session;
        const transport = multiplayerTransport(session);
        // The identity is asked for only when there is a wire to present
        // it on: a solo game has no business opening the profile store.
        const identity = transport === null ? undefined : hooks.identity?.();
        if (transport !== null && identity !== undefined) {
          remoteGroup = new THREE.Group();
          remoteGroup.name = 'remote-actors';
          three.add(remoteGroup);
          remotes = new ActorViews(remoteGroup);
          capsuleList = ctx.uiLayer.ownerDocument.createElement('div');
          capsuleList.dataset.role = REMOTE_CAPSULES_ROLE;
          capsuleList.hidden = true;
          ctx.uiLayer.appendChild(capsuleList);
          net = new NetworkedWorld({ transport, identity, now: () => netClockMs });
          // Not awaited: the world enters on the frame it is ready, and a
          // handshake over a radio is not a reason to hold the loading
          // screen open. `connect()` does not reject; the status carries
          // whatever it finds.
          void net.connect();

          // THE PRACTICE BOT, if the player asked for one. It needs both
          // halves — a session willing to open a second link, and an
          // identity for it to be — exactly as the player's own link does.
          // Built after the player's, and not awaited either: a bot that
          // cannot reach the relay must cost the world nothing but an
          // honest line in its own panel.
          const openBot = practiceBotOpener(session);
          const botIdentity = openBot === null ? null : (hooks.practiceBot?.() ?? null);
          if (openBot !== null && botIdentity !== null) {
            bot = new PracticeBot({ openTransport: openBot, identity: botIdentity, now: () => netClockMs });
            botHud = new BotHud(ctx.uiLayer, { onRestart: () => void bot?.restart() });
            void bot.start();
          }
        }

        // loading → playing is requested here because only the world knows
        // when it is ready. Guarded: the state machine allows `playing` only
        // after `loading`, and opened as a dev tool from the hub the app is in
        // `menu`, where the hub owns what happens next.
        if (ctx.app.state === 'loading') ctx.app.requestState('playing');
        stateChanged(ctx.app.state);
      },

      update(frame: FrameInfo) {
        if (ctx.app.state !== seenState) stateChanged(ctx.app.state);
        stats.record(frame.rawDt, frame.simDt);
        // The camera moves by RAW dt: it is not simulation, it is the
        // instrument the player measures the simulation with. Fed sim dt it
        // would freeze on pause — exactly when you want to fly around and
        // look — and would lag the hand during a stall, because the sim cap
        // would swallow most of the stall's time.
        fly.update(ctx.input.snapshot(), frame.rawDt, stick === null ? null : stick.read());
        // After the camera, before anything is drawn: the ground is
        // placed against where the camera IS this frame, not where it was.
        updateTerrain();
        // simDt, not rawDt: the sea is simulation and it must stop when the
        // world is paused. rawDt here would leave the swell running under
        // a frozen camera, and the ONE clock would then disagree with the
        // dt every other system integrated on.
        updateOcean(frame.simDt);
        updateWeather(frame.simDt);
        updateFresh(frame.simDt);
        updateObjects();
        updateResources(frame.simDt);
        updateCreatures(frame.simDt);
        // AFTER the ocean, so the swell it asks about is this frame's.
        adaptWater();
        if (net !== null) {
          netClockMs += Math.max(0, frame.rawDt) * 1000;
          // Stand over the spawn the authority named, the first time it
          // names one — see the header. Its ground position; this camera's
          // own height and look.
          if (!spawnAdopted) {
            const mine = net.localActor();
            if (mine !== null) {
              const at = toLocal(mine.at);
              const look = fly.pose();
              placeCamera(at.lx, look.height, at.lz, look.yaw, look.pitch);
              // The spawn is a world position like any other, and the
              // ground there is not the ground here: adopting it can put
              // the camera inside a hill.
              standClearOfGround();
              spawnAdopted = true;
            }
          }
          // Claim first, then draw: what is drawn for the others is what
          // the replica holds a moment behind the wire, and the claim just
          // sent cannot be in it yet either way.
          net.update(claimPose());
          // The bot walks on SIM dt and spends its five minutes on RAW dt
          // (`net/PracticeBot.ts`); it is stepped BEFORE the replica is
          // read so a pose it claims this frame is on the wire before the
          // next snapshot rather than one frame behind it.
          bot?.update(frame.simDt, frame.rawDt);
          if (spawnAdopted) watchBot();
          // Capsules stand ON the island. The authority holds a height
          // above whatever an actor is standing on; the terrain it is
          // standing on is known only here.
          remotes?.sync(net.remoteActors(netClockMs), groundUnder);
          sinceCapsulePublish += frame.rawDt;
          if (sinceCapsulePublish >= 1 / HUD_HZ) {
            sinceCapsulePublish = 0;
            publishCapsules();
          }
        }
        hud?.update({
          frame: stats.summary(),
          camera: fly.readout(),
          aboveGround: field === null ? null : fly.pose().height - field.heightAt(fly.pose().at),
        }, frame.rawDt);
        const botLine = botReadout();
        if (botHud !== null && botLine !== null) botHud.update(botLine, frame.rawDt);
      },

      resize(width, height) {
        fly.resize(width, height);
        viewWidth = width;
        viewHeight = height;
        // The streaks and the lens size themselves in DEVICE pixels; the
        // streaks were never told the phone's, and drew a quarter too long.
        const pr = hooks.pixelRatio?.() ?? 1;
        rain?.resize(width * pr, height * pr);
        lens?.resize(width * pr, height * pr);
      },

      /**
       * The lens, after the world and under the HUD: a second scene over
       * the frame the renderer just drew, with the clear switched off for
       * exactly that call. Nothing when there is nothing on the glass.
       */
      renderOverlays() {
        if (lens === null || !weatherOn || lens.cost.live === 0) return;
        const gl = (ctx as { renderer?: { gl?: THREE.WebGLRenderer } }).renderer?.gl;
        if (gl === undefined) return;
        gl.autoClear = false;
        gl.render(lens.scene, lens.camera);
        gl.autoClear = true;
      },

      dispose() {
        // The link goes first, with a `bye`, so the authority drops this
        // player now rather than waiting out its disconnect grace while a
        // ghost stands in everyone else's world.
        // The bot leaves before the player does: its own `bye` on its own
        // link, so the authority drops it now rather than leaving a
        // scripted stranger standing in the room for its grace window.
        bot?.close();
        bot = null;
        botHud?.dispose();
        botHud = null;
        lens?.dispose();
        lens = null;
        hooks.shadows?.(false);
        net?.close();
        net = null;
        remotes?.dispose();
        remotes = null;
        if (remoteGroup) {
          three.remove(remoteGroup);
          remoteGroup = null;
        }
        capsuleList?.remove();
        capsuleList = null;
        if (objects) {
          three.remove(objects.group);
          objects.dispose();
          objects = null;
        }
        resources = null;
        creatures = null;
        if (finder) {
          three.remove(finder.group);
          finder.dispose();
          finder = null;
        }
        if (fauna) {
          three.remove(fauna.group);
          fauna.dispose();
          fauna = null;
        }
        objectsRadius = 0;
        habitat = null;
        coarseGrid = null;
        builtObjectsDetail = null;
        // The fresh water was built inside `buildOcean` and, until this
        // line, was let go nowhere but there.
        if (fresh) {
          three.remove(fresh.group);
          fresh.dispose();
          fresh = null;
        }
        channels = null;
        if (ocean) {
          three.remove(ocean.group);
          ocean.dispose();
          ocean = null;
        }
        seaTextures?.dispose();
        seaTextures = null;
        swell = null;
        builtTier = null;
        streamer?.dispose();
        streamer = null;
        if (terrain) {
          three.remove(terrain.group);
          terrain.dispose();
          terrain = null;
        }
        field = null;
        if (grid) {
          three.remove(grid);
          grid.dispose();
          grid = null;
        }
        if (light) {
          three.remove(light);
          light.dispose();
          light = null;
        }
        if (sky) {
          three.remove(sky);
          sky.dispose();
          sky = null;
        }
        hud?.dispose();
        stick?.dispose();
        stick = null;
        if (skyView !== null) {
          three.remove(skyView.group);
          skyView.dispose();
          skyView = null;
        }
        if (rain !== null) {
          three.remove(rain.group);
          rain.dispose();
          rain = null;
        }
        builtSkyTier = null;
        builtRainDetail = null;
        hud = null;
        pauseButton?.remove();
        pauseButton = null;
      },
    };
  };
}
