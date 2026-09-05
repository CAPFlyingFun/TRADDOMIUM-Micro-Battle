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
import { OceanView } from '../sea/OceanView';
import { SeaTextures } from '../sea/SeaTextures';
import { SeaSwell } from '../world/sea/swell';
import { resolveTier, tierFor, type TextureTier } from '../assets/textureQuality';
import { LoadProgress } from '../world/LoadProgress';
import { COARSE_BYTES, decodeCoarse } from '../world/dem';
import { repairGrid } from '../world/demRepair';
import { Heightfield } from '../world/heightfield';
import { toLocal } from '../world/origin';
import type { WorldPoint } from '../world/coords';
import { BotHud, type BotReadout } from './BotHud';
import { FrameStats } from './FrameStats';
import { FreeFlyCamera, headingOfYaw, yawForHeading } from './FreeFlyCamera';
import { HUD_HZ, PerfHud, type SeaReadout, type SessionLink, type SessionReadout } from './PerfHud';
import { BUILT_LAYERS, LayerToggles } from './layerToggles';
import { PERF_WORLD_SCENE_ID } from './perfTool';

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
   * The player's three-level quality choice.
   *
   * LIVE SINCE PHASE 3, and the ocean is what reads it: the texture rung
   * it loads, how many ripple octaves its shader compiles, and how much
   * geometry its two sheets carry. Changing it rebuilds the sea, which
   * is why it is read on every state change rather than once — the pause
   * menu is where it is changed and returning from it is a state change.
   *
   * Kept as the plain literals rather than importing `Quality` from
   * ui/settingsStore: perf/ may not import ui/ (§3), and the whole point
   * of this interface is that the document's owner builds it.
   */
  readonly quality: 'low' | 'medium' | 'high';
}

export interface PerformanceWorldHooks {
  /** PAUSE was pressed. What a pause means — state, overlay, whether the world may freeze — is the owner's. */
  onPause(): void;
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
   * The current settings. Read once in `enter()` and again whenever the
   * app state changes — the pause menu is where a player changes them, and
   * returning from it is a state change — so no event bus is needed and
   * the document is not parsed every frame. Absent: the scene's defaults.
   */
  settings?(): PerfWorldSettings;
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
 * The starting fly speed, as a fraction of the height above ground.
 *
 * The empty world's 40 units a second is 0.4 m/s, which is an ant's pace
 * and correct for a room 20 m across. Kauaʻi is 56 km across: at that
 * speed crossing it takes four hours. A twelfth of the altitude puts the
 * camera at about 125 m/s when it starts high, and the wheel takes over
 * from there.
 */
const SPEED_PER_ALTITUDE = 1 / 24;

/** Never slower than the empty world's own pace, however low the camera is. */
const MIN_FLY_SPEED = 40;

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
    /** The tier the sea was BUILT at, so a changed setting is noticed once and rebuilt once. */
    let builtTier: TextureTier | null = null;
    /** The near plane the projection was last built with. */
    let builtNear = 0;
    let hud: PerfHud | null = null;
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
      paceFor(clearance);
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
      const floor = ground + RESUME_CLEARANCE;
      if (pose.height >= floor) {
        // Already in the open. Its pace still has to suit the island.
        paceFor(Math.max(RESUME_CLEARANCE, pose.height - ground));
        return;
      }
      const local = toLocal(pose.at);
      placeCamera(local.lx, floor, local.lz, pose.yaw, pose.pitch);
      paceFor(RESUME_CLEARANCE);
    };

    /**
     * A flying pace that suits the height it is flown at.
     *
     * The empty world's 40 units a second is 0.4 m/s, right for a room
     * 20 m across and four hours' flying across a 56 km island. It lived
     * inside the fresh-start path, so a RESUMED session — including one
     * saved from this very build — came back at 0.4 m/s with no gesture
     * on a phone to change it: `CameraPose` carries no speed, and
     * FreeFlyCamera only reads the mouse wheel.
     */
    const paceFor = (altitude: number): void => {
      const want = Math.max(MIN_FLY_SPEED, altitude * SPEED_PER_ALTITUDE);
      // IN A ROOM, THE AUTHORITY PAYS FOR EVERY STEP. It earns an actor
      // walkSpeed x sprintFactor x tolerance = 150 units a second of
      // travel and banks at most 37.5, so a camera flying faster than
      // that has its claims refused and stands still on everybody else's
      // screen. Solo, nobody is paying, and the island is 56 km across.
      fly.speed = networked ? Math.min(want, NETWORKED_MAX_SPEED) : want;
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
      const tier = resolveTier(hooks.tierOverride ?? null, tierFor(hooks.settings?.().quality ?? 'medium'));
      if (ocean !== null && builtTier === tier) return;
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
      ocean = new OceanView({ field, swell, textures: seaTextures, tier });
      builtTier = tier;
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
      if (hud) hud.hidden = !s.showFps;
      // The sea is a compiled program and a loaded texture per tier, so
      // a changed quality setting is a rebuild. No-ops when it has not
      // changed, which is every state change but the one that did.
      buildOcean();
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
            field = new Heightfield(repairGrid(decodeCoarse(bytes)).grid);
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
          return { meanMs: cost.meanMs, peakMs: cost.peakMs, tier: ocean.tier };
        };

        hud = new PerfHud(ctx.uiLayer, {
          layers: () => toggles.list(),
          onLayerToggle: (id, enabled) => {
            toggles.setEnabled(id, enabled);
          },
          session: sessionReadout,
          // THE COLUMN EXISTS ONLY WHERE A SEA DOES. Whether this world
          // has one is settled by now — `buildOcean` has already run, and
          // it can only ever succeed if the survey downloaded — so an
          // empty world offers no hook at all rather than a SEA line
          // reading "not built yet" about an ocean that is never coming.
          // Same rule as SESSION, and the same rule as the layer labels.
          ...(ocean === null ? {} : { sea: seaCost }),
        });
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

        // Terrain is the world now, so it comes up ON — but only when
        // there IS terrain. The toggle is still the way to measure what
        // it costs; turning it off is what the empty world was.
        toggles = new LayerToggles(terrain === null ? [] : BUILT_LAYERS);
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
        fly.update(ctx.input.snapshot(), frame.rawDt);
        // After the camera, before anything is drawn: the ground is
        // placed against where the camera IS this frame, not where it was.
        updateTerrain();
        // simDt, not rawDt: the sea is simulation and it must stop when the
        // world is paused. rawDt here would leave the swell running under
        // a frozen camera, and the ONE clock would then disagree with the
        // dt every other system integrated on.
        updateOcean(frame.simDt);
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
        hud?.update({ frame: stats.summary(), camera: fly.readout() }, frame.rawDt);
        const botLine = botReadout();
        if (botHud !== null && botLine !== null) botHud.update(botLine, frame.rawDt);
      },

      resize(width, height) {
        fly.resize(width, height);
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
        hud = null;
        pauseButton?.remove();
        pauseButton = null;
      },
    };
  };
}
