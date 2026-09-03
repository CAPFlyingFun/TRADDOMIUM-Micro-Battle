import * as THREE from 'three';
import { PlayerAnt } from '../ant/PlayerAnt';
import { FollowCamera } from '../camera/FollowCamera';
import { PaceSelector } from '../input/PaceSelector';
import { LookDrag } from '../input/LookDrag';
import { MoveStick, type StickReading } from '../input/MoveStick';
import { AutoRun } from '../input/autoRun';
import { resolve } from '../ant/locomotion';
import {
  fasterPace, PACE_SPEED, REST_DEADZONE, slowerPace, type Pace,
} from '../ant/pace';
import { Stamina } from '../ant/stamina';
import {
  groundHeight, ISLAND_SPAN, reliefScale, setRelief, setSmoothing, smoothingAmount,
} from '../world/heightfield';
import { findLandfall, UNITS_PER_METRE, type HeightGrid } from '../world/kauai';
import { forceMicro, forceTier, setAnchor, setDetailDial } from '../world/lod';
import { describeKnownSystems, lodAt, lodLine, lodReport } from '../world/lodProbe';
import { syncLodUniforms } from '../world/lodShader';
import {
  DEFAULT_MESO_SCALE, SEA_SOURCE_NOTE, liveField, liveRegime, seaFromQuery,
  blendToObservation, seaLine, seaBlend, seaMode, settleSea, useFixedSea,
  useProceduralSea, type LiveSeaOptions,
} from '../world/liveSea';
import {
  activeWaves, restartSwellClock, swellAmplitude, swellReach, waveTableVersion,
} from '../world/seaSwell';
import { seaFeed } from '../weather/SeaService';
import { local, world, type WorldPoint } from '../world/coords';
import { TerrainStream, TIER_CUTS } from '../world/TerrainStream';
import { followHd, forgetHd, hdReady, hdResident, onHdTile } from '../world/kauaiHd';
import { IslandWater } from '../world/IslandWater';
import { Underwater } from '../world/Underwater';
import { Ocean } from '../world/Ocean';
import { canDrink, swimEffort, wadeAt } from '../ant/wading';
import { Wings } from '../ant/wings';
import { nearestSea, nearestWatercourse } from '../world/nearestWater';
import { MissionBrain, type WaterSighting } from '../ant/autonomy/missionBrain';
import { gaitWords, mediumOf, paceShare, tierOf } from '../ant/gait';
import { straightLineTrip } from '../ant/autonomy/mission';
import { AUTONOMY_DEFAULTS } from '../ant/autonomy/autonomyConfig';
import { seaSwellAt } from '../world/seaSwell';
import {
  afloatIn, instrumented, motionOf, type Act, type Motion,
} from '../ant/motion';
import { Breath, DROWN_HP_PER_SECOND, blackout } from '../ant/breath';
import { SaltExposure, SALT_DAMAGE_FRACTION } from '../ant/brine';
import { waterSpotAt } from '../world/waterQuery';
import { bakeIslandChannels } from '../world/islandChannels';
import { forgetVeg, loadVeg } from '../world/landcover';
import { LandmarkStand } from '../world/LandmarkStand';
import { landmarksNear } from '../world/landmarks';
import { DEFAULT_MODE, type SessionMode } from '../game/session';
import {
  Autopilot, tookOver, travelling, type NavCommand,
} from '../ant/autopilot';
import { MAX_TRAVEL, TravelScale } from '../ant/travelScale';
import { WaveWatch } from '../ant/waveClearance';
import { AutopilotChip, type ChipState } from '../ui/AutopilotChip';
import { AUTOPILOT_DEFAULTS } from '../ant/autopilotConfig';
import type { Hazard } from '../ant/hazards';
import {
  planChain, planRoute, routeWords, type RoutePlan,
} from '../ant/routePlanner';
import {
  DISCOVERY_CELLS, decodeDiscovery, emptyDiscovery, encodeDiscovery,
  fractionSeen, reveal,
  type Discovery,
} from '../game/discovery';
import { Minimap } from '../ui/Minimap';
import { MapScreen } from '../ui/MapScreen';
import { bakeIsland } from '../ui/islandMap';
import { reliefCost, reliefIsland, warmRelief } from '../ui/islandRelief';
import type { MapMarks } from '../ui/mapView';

import { originAt, rebaseFor, setOrigin, toLocal, toWorld,
} from '../world/origin';
import { bakeGrain, GRAIN_SIZE } from '../world/groundTexture';
import {
  BAND_TILE, FADE_FROM_UNIFORM, FADE_TO_UNIFORM, setGroundMode,
  loadAuthored, loadBands, reliefUniform,
  setDetailRange, setTileScale,
  setTextureOrigin, terrainMaterial,
} from '../world/terrainMaterial';
import {
  RELIEF_AO_UNIFORM, RELIEF_BUMP_UNIFORM, bakeGroundRelief, setReliefAo, setReliefBump,
} from '../world/groundRelief';
import { setFoamLod } from '../world/waterLook';
import { SettingsPanel } from '../ui/SettingsPanel';
import { PauseMenu } from '../ui/PauseMenu';
import {
  newSaveId, writeSave, type Snapshot, type SoloSave,
} from '../game/save';
import { Vitals } from '../ui/Vitals';
import { LIVE_GROWTH, liveStat } from '../ant/castes';
import { ActionPad, type Action } from '../input/ActionPad';
import { Thirst } from '../ant/thirst';
import { LiftSlider, leverFor } from '../input/LiftSlider';
import { WeatherChip } from '../ui/WeatherChip';
import { FlightHud, windCall, type FlightView } from '../ui/FlightHud';
import {
  Eased, SOON, driftOf, groundVelocity, touchdown, trackOf,
  type FlightTelemetry,
} from '../ant/telemetry';
import { bearingFromHeading, bearingOf, headingFromBearing, pitchOf } from '../ui/compassMath';
import { Compass } from '../ui/Compass';
import { type CompassMarker } from '../ui/compassMath';
import {
  AUTO_AIRSPEED, Flight, SPRINT_AIRSPEED, setFlightScale,
  HOVER_HOLD,
} from '../ant/flight';
import { Grace } from '../ant/grace';
import {
  MOVING_RECOVERY, RESTING_RECOVERY, SPRINT_DRAIN,
} from '../ant/stamina';
import { loadQueen, QUEEN_JOB, type QueenBody } from '../ant/queenModel';
import { onChange, set as setSetting, settings } from '../ui/settings';
import { fixAt, formatFix, fixToWorld, mslOf, parseFix } from '../ui/fix';
import { weather } from '../weather/WeatherService';
import { skyLook } from '../weather/sky';
import { Rain } from '../weather/Rain';
import type { GameWeather } from '../weather/gameplay';
import { FIRST_LIGHT_JOB, TERRAIN_JOB, type LoadReport } from '../ui/loadPlan';
import { LiveWind, shelter, windProfile } from '../weather/windField';

/**
 * THE ISLAND — Kauai at 1:1000, walked by one ant.
 *
 * The first development scene, and the integration gate for rebuild
 * steps 01 movement and 02 input + camera.
 *
 * The terrain is cut into a grid of section meshes rather than one
 * sheet, so three.js can cull the sections behind you: the whole island
 * is far too many triangles to draw at once, but only a wedge of it is
 * ever on screen. Vertex normals are derived from the heightfield
 * instead of from each section's own triangles, because per-section
 * normals disagree along the shared edges and print the section grid
 * into the lighting.
 */

/**
 * Bare earth shown through the cover wherever the ground steepens.
 *
 * A MULTIPLIER now, not a colour. The band textures carry what the
 * ground looks like; the vertex stream only shades it, so this warms
 * and darkens a slope toward soil rather than painting brown over it.
 */

const SKY_COLOR = 0x9cc8e8;

/** How long the lapse warning stays up, in seconds. */
const PROTECTION_NOTICE = 6;

/**
 * How far a replacement surface may sit behind a discarded one before
 * it counts as a seam, in world units. A metre at ant scale.
 */
const GAP_TOLERANCE = 100;

/** Section meshes per side. */
/** Vertices per side within a section, up close and far away. */

/**
 * How fast the eased dive chases the lever, per second. Halved at
 * v0.0.80 (Joshua: "the dive is too fast underwater and the speed
 * could be split in half") — a full-depth dive is a deliberate three
 * seconds of work now, swimming down rather than sinking.
 */
/**
 * How fast the flight's hold reference chases the real surface, per
 * second. The open sea's swell runs at about 1.5 s a period, so half
 * an e-fold a second lets a whole wave pass through the reference
 * almost unnoticed; inland, a water level that changes is real news
 * and the ripples are millimetres, so it follows much more closely.
 */
const HOLD_EASE_SEA = 0.5;
const HOLD_EASE_FRESH = 3;
/** Land: a hillside is news, a pebble is not. */
const HOLD_EASE_LAND = 2.5;
/** Nothing real may come closer than this before she climbs. */
const SURFACE_MARGIN = 12;
/**
 * How often the water instrument re-answers, seconds. A ray march and
 * a ring search are not frame work, and neither answer moves far in a
 * tenth of a second — she cannot outwalk it.
 */
const WATER_CADENCE = 0.1;
/** How long an autonomy notice stays up, seconds — the grace chip's. */
const AUTONOMY_NOTICE = 6;

/**
 * WHERE ALONG THE LEG THE DRAINAGE IS ASKED, as fractions of what she
 * could actually cover before drying.
 *
 * Three points, quarter, half and three quarters. Not the destination
 * itself: water at the far end of the leg is water she reaches anyway,
 * and a fourth ring search buys nothing the reachability filter would
 * not throw away.
 */
const CORRIDOR_AT: readonly number[] = [0.25, 0.5, 0.75];
/**
 * She starts looking down the corridor with this many low-water floors
 * left — thirty minutes, at the shipped fifteen.
 *
 * Early enough that the candidates are already in hand when the trigger
 * fires, late enough that a queen with an hour of water in her is not
 * paying for three ring searches a second to answer a question she does
 * not have.
 */
const CORRIDOR_AHEAD = 2;

const DIVE_EASE = 0.9;
/**
 * The way UP keeps its old pace — the halving was asked of the DIVE,
 * and buoyancy is not hers to slow: going down she is working against
 * her own float, coming up the water is doing the work (Joshua: "a
 * little more buoyancy", v0.0.72). Numerically this is the previous
 * 1.2 x the previous dive ease.
 */
const RISE_EASE = 2.16;

/**
 * How far she walks before the fog is recomputed — half a mask cell.
 *
 * Half rather than a whole, so the reveal can never skip a cell by
 * stepping cleanly over it, and derived from the mask rather than typed
 * so the two cannot come apart if the grid ever changes.
 */
const REVEAL_STEP = ISLAND_SPAN / DISCOVERY_CELLS / 2;

export class IslandScene {
  private readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly follow: FollowCamera;
  private readonly stick: MoveStick;
  private readonly paceUI: PaceSelector;
  private readonly look: LookDrag;
  private readonly panel: SettingsPanel;
  private readonly vitals: Vitals;
  private readonly actions: ActionPad;
  private readonly thirst = new Thirst();
  /** The drink button. On the pad only where there is water to drink. */
  private drinkButton!: Action;
  private readonly weatherChip: WeatherChip;
  /** Altitude, vertical speed and the wind — flight only. */
  private readonly flightHud: FlightHud;
  /**
   * Her track, held through the moment a headwind cancels her exactly.
   * A zero velocity has no direction; the last real one stands.
   */
  private heldTrack = 0;
  /** The HUD's own numbers, eased. The physics above is never touched. */
  private readonly easedAgl = new Eased();
  private readonly easedLanding = new Eased();
  private readonly easedRange = new Eased();
  private readonly easedWhen = new Eased();
  /**
   * HER SETTLED VERTICAL RATE, and the reason the touchdown marker
   * holds still.
   *
   * The touchdown point divides the height she has to lose by the rate
   * she is losing it at, so a small wobble in the rate is a LARGE
   * wobble in the answer: at thirteen metres up, a sink rate breathing
   * between 20 and 30 centimetres a second moves the marker from 360
   * metres out to 240 and back, several times a minute. Her real
   * vertical never holds perfectly still — the air wanders, by design
   * now, see wander.ts — so the prediction is fed a rate averaged over
   * about a second and a half.
   *
   * SMOOTHING THE INPUT TO A DISPLAY, not the physics. Her actual
   * vertical speed, the one the model integrates and the VS readout
   * shows, is untouched. This is the same rule as the eased readouts
   * below, applied one step earlier because the arithmetic in between
   * amplifies rather than attenuates.
   */
  private readonly easedRise = new Eased(1.5);
  private readonly compass: Compass;
  /**
   * What the compass points at. GLOBAL positions, recomputed into
   * bearings every frame — nothing here caches a direction.
   */
  private readonly markers: CompassMarker[] = [];
  private readonly liftSlider: LiftSlider;
  private readonly pauseMenu: PauseMenu;
  /**
   * SOLO PAUSE. The whole simulation stops — physics, weather, the
   * survival timers, the sea. Rendering does not, because a frozen
   * frame the player can still look at is what "paused" means and a
   * black screen is what "crashed" looks like.
   */
  private halted = false;
  /**
   * SOLO PAUSES THE WORLD; MULTIPLAYER ONLY STOPS HER HANDS.
   *
   * Defaults to solo rather than to the front door's choice, because
   * `?scene=island` builds this scene straight from main.ts with no
   * GameFlow in between, and so does every probe in scripts/. See
   * game/session.ts.
   */
  private mode: SessionMode = DEFAULT_MODE;
  /** A menu or the map is up. In multiplayer this is all a pause is. */
  private menuOpen = false;
  private minimap!: Minimap;
  private mapScreen!: MapScreen;
  /**
   * WHAT SHE HAS SEEN, which is not what is there.
   *
   * The island is 56 km of surveyed Kauaʻi and all of it exists from
   * the first frame; this is the separate question of how much of it
   * she has been near enough to know about. Trello card 10's rule —
   * world truth and player knowledge are two different things — and
   * the reason it is saved beside her position rather than derived.
   */
  private known: Discovery = emptyDiscovery();
  /** Where the last reveal was centred, so it is not redone every frame. */
  private revealedAt: WorldPoint | null = null;
  /**
   * PHASE 2. The other pilot — it holds the same stick and nothing else.
   *
   * The MissionBrain decides where she is going; this decides what the
   * controls should do about it; Flight decides what happens. Three
   * questions, three files, and this one never learns why.
   */
  private readonly autopilot = new Autopilot(AUTOPILOT_DEFAULTS);
  /** Last frame's command, for the developer line. */
  private nav: NavCommand | null = null;
  /** The pin the autopilot was last handed, by identity. */
  private flownTo: WorldPoint | null = null;
  /**
   * EVERYTHING KNOWN TO BE IN HER WAY.
   *
   * Empty today, and honestly so: TMB has no trees with tops, no
   * predators and no forbidden ground yet, and filling this with
   * invented content to give the planner something to do would be a
   * feature that exists only in the code that avoids it. The
   * MECHANISM ships now; the content arrives with the systems that
   * produce it, and `__island.addHazard` is how a probe proves the
   * chain end to end in the meantime.
   */
  private readonly hazards: Hazard[] = [];
  /** The plan the pin turned into, and which leg of it she is flying. */
  private route: RoutePlan | null = null;
  private legAt = 0;
  /**
   * THE PLAYER'S OWN WAYPOINTS, still to be visited, last one last.
   *
   * Not the same list as the route's legs: these are the taps, and the
   * legs are what the planner made of them — several per tap where
   * something had to be gone around. Kept because a survival detour
   * replaces the destination for a while, and when the primary comes
   * back the rest of the chain has to come back with it. Without this
   * a thirsty queen would drink and then fly straight to the end,
   * skipping every stop the player put in.
   */
  private chain: WorldPoint[] = [];
  /** The player took the stick, and has not asked to be flown since. */
  private surrendered = false;

  /**
   * Have the flight controls come to REST since she left the ground?
   *
   * The run-up, the takeoff shove and the climb-out are one continuous
   * input that began on the ground, and treating any of it as "the
   * player is taking over" is what stopped the autopilot ever flying a
   * destination set before takeoff. See `flyMyself`.
   */
  private handsClear = false;
  /** Her own clock — see travelScale.ts. Real time unless flown. */
  private readonly travel = new TravelScale();
  private apChip!: AutopilotChip;
  /**
   * The stick as the THUMB left it, before the hands-off gate.
   *
   * The gated reading is zeroed while a menu is up, so testing that one
   * for a manual override would mean opening the map counted as taking
   * the controls — and the autopilot would disengage every time
   * somebody looked at the map it is flying to.
   */
  private rawStick: StickReading = { x: 0, y: 0, deflection: 0, lane: 'none', released: false };
  /**
   * Which slot this run writes to. One run, one slot, all sitting.
   *
   * IT WAS `readonly` AND THAT MADE THE COMMENT FALSE. A fresh id is
   * right for a new colony and wrong for a resumed one: `resume()` did
   * not adopt the id it had just loaded, so every CONTINUE wrote a
   * SECOND slot for the same colony. `writeSave` keeps the five newest
   * by `updatedAt` (save.ts), so five sittings with one colony fill
   * every slot with that colony and evict the others — and CONTINUE
   * always offers the newest, so nothing on screen would ever have
   * said so. Latent today because there is one colony and no slot
   * picker; a data-loss bug the moment either arrives.
   */
  private slot = newSaveId();
  /** Simulated seconds lived, carried across sittings by the save. */
  private lived = 0;
  /** Sim seconds since the last autosave. */
  private sinceSaved = 0;
  private savedRegion = 'Kauaʻi';
  /** What to do when she is asked to leave. Set by the flow. */
  private leaving: (() => void) | null = null;

  /**
   * How often the run writes itself, in SIMULATED seconds.
   *
   * A minute. Frequent enough that the worst loss is a minute of
   * walking, rare enough that a phone is not writing JSON every few
   * frames — and on the simulated clock, so a long pause is not a
   * flurry of saves the moment she resumes.
   */
  private static readonly AUTOSAVE_EVERY = 60;
  /**
   * How long new ground may go unsaved, simulated seconds.
   *
   * Not a second autosave clock — it pulls the ordinary one forward, so
   * a run that is discovering writes every few seconds and a run that
   * is sitting still still writes once a minute. Five seconds of flight
   * is about 350 m, well under one mask cell.
   */
  private static readonly DISCOVERY_SAVE = 5;
  private readonly flight = new Flight();
  /** Five minutes of being left alone, and of leaving everything alone. */
  /**
   * HER OWN MILLISECONDS, monotonic, for anything that runs on a
   * DEADLINE rather than on a per-frame tick.
   *
   * Everything of hers that ticks — thirst, stamina, breath, drying —
   * is handed her time each frame and so follows the travel scale for
   * free. `Grace` does not tick: it is a deadline compared against a
   * clock, deliberately, so that it survives a reload and could one day
   * be issued by a server. That design is right and it had exactly one
   * consequence nobody had thought about — the clock it was compared
   * against was the WALL, so under a x10 flight her five minutes of
   * protection ran ten times slower than every other number on her
   * card. Joshua, 2026-08-31: "only the water clock matched the x speed
   * correctly... protection didn't sync."
   *
   * So it gets a clock of her own. Still a deadline, still injected,
   * still replaceable by a server's — just measured in her seconds like
   * the rest of her.
   */
  /**
   * HOW BIG THE WAVES UNDER HER HAVE BEEN LATELY.
   *
   * Sampled on the WORLD's clock, because the sea is not on hers — see
   * `waveClearance.ts`. Fed the gap between the true water surface and
   * the damped one she flies against, which IS the crest height.
   */
  private readonly waves = new WaveWatch();
  private herMs = 0;
  private readonly grace = new Grace(() => this.herMs);
  /** Seconds the "protection ended" warning still has to run. */
  private noticeLeft = 0;
  /** Her body, once it has loaded. Null while the placeholder is up. */
  private queen: QueenBody | null = null;
  /**
   * Whether she still has her wings.
   *
   * Held HERE rather than only on the model, because the model arrives
   * asynchronously and the answer has to survive that gap — and because
   * when dealation becomes a real event it will be the game that
   * decides, not the renderer.
   */
  private winged = true;
  /**
   * What the reserve is doing this frame, fractions per second.
   *
   * Held because the HUD needs the same number the reserve was charged,
   * and deriving it twice is how the two come to disagree.
   */
  private effort = 0;
  private rain!: Rain;
  private sun!: THREE.DirectionalLight;
  private skyLight!: THREE.HemisphereLight;
  /** Resolves when every ground map has pixels in it. */
  private bandsReady!: Promise<void>;
  /**
   * A ring of recent frame times, for the readout.
   *
   * Two seconds of them at sixty: long enough that the mean is steady
   * enough to read on a moving phone, short enough that it answers a
   * change in the scene rather than averaging the whole session.
   */
  private readonly frames = new Float32Array(120);
  private frameAt = 0;
  private framesSeen = 0;
  /**
   * Resolves when the world is worth looking at.
   *
   * NOT when the constructor returns. The scene is alive long before it
   * is presentable: the terrain is cut, but until the band maps arrive
   * the shader samples them as black and the ground under her is a
   * void. Whoever put the loading screen up waits on this.
   */
  readonly ready: Promise<void>;
  /** Set once a frame has been drawn with everything in place. */
  private shown = false;
  private showFirstFrame: (() => void) | null = null;
  /** The weather she is actually standing in, eased. */
  private nowWeather: GameWeather | null = null;
  /**
   * The reported wind turned back into moving air.
   *
   * Advanced every frame whether she is flying or not — the air over
   * the island does not wait for her to take off, and a gust that
   * started while she was walking should already be underway when she
   * leaves the ground.
   */
  private readonly liveWind = new LiveWind();
  private readonly ant = new PlayerAnt();
  private readonly clock = new THREE.Clock();
  private terrain!: TerrainStream;
  private water: IslandWater | null = null;
  private ocean: Ocean | null = null;
  /**
   * HOW FAR DOWN SHE IS SWIMMING, nought at the surface and one on the
   * bottom. Eased rather than set: the lever can snap, a swimming
   * animal cannot, and snapping her to the bed the instant the lever
   * hits the stop read as a teleport in the build this came from.
   */
  /**
   * WET WINGS. Landing on water grounds her until they dry, and a
   * dive spends the drying she has done — wings.ts carries the rules.
   */
  private readonly wings = new Wings();
  /**
   * WHAT SHE IS DOING, derived once a frame from everything below and
   * read by everything downstream. Never assigned by hand — motion.ts
   * carries the reason, and it is v0.0.123's bug.
   */
  private motion: Motion = 'idle';
  /**
   * THE WATER INSTRUMENT, recomputed on a cadence rather than a frame.
   *
   * Finding the coast is a ray march and finding a pond is a ring
   * search; neither answer changes meaningfully in a tenth of a
   * second, and she cannot walk far enough in one to make it lie.
   */
  private waterLine: string | null = null;
  private waterDue = 0;
  /**
   * STAGE H — the Queen's mission brain. It decides WHERE and WHY and
   * publishes an intent; nothing consumes that intent yet, because the
   * executor that turns it into a FlightDemand is Phase 2. Wired now so
   * it runs against the real world rather than only against tests.
   */
  private readonly brain = new MissionBrain(
    straightLineTrip(AUTONOMY_DEFAULTS.assumedSpeed),
  );
  private brainSaid: string | null = null;
  private brainSaidLeft = 0;
  /**
   * The island-wide watercourse candidate, cached.
   *
   * A ring search over the drainage is not frame work, and unlike the
   * WTR readout the brain needs it whether or not the developer
   * register is on — so it has its own clock rather than riding the
   * debug line's.
   */
  private channelNear: WaterSighting | null = null;
  private channelDue = 0;
  /**
   * WATER DOWN THE CORRIDOR, not merely water near her.
   *
   * `channelNear` answers "what is closest", and closest is the wrong
   * question when she is going somewhere: a channel 300 m behind costs
   * 600 m of backtracking, one 700 m ahead and slightly off the line
   * costs almost nothing. The brain can only compare candidates it has
   * been given, so this samples the drainage at a few points along the
   * line she is actually flying and hands the sightings over with the
   * nearest one.
   *
   * Sampled on the brain's own cadence and ONLY WHEN SHE IS SHORT —
   * three ring searches a second is not free, and a queen with an hour
   * of water in hand has no use for the answer. Empty the rest of the
   * time, which reads as "nobody looked", which is true.
   */
  private waterAhead: WaterSighting[] = [];
  /** Whether the vegetation rasters have arrived — see `vegArrived`. */
  private vegReady = false;
  /**
   * THE LANDMARK TREES — the first things on the island with a
   * footprint she cannot fly through. Drawn by this, placed by
   * landmarks.ts, and handed to the planner leg by leg through
   * `hazardsAlong`. See LandmarkStand.
   */
  private readonly landmarks: LandmarkStand;
  /** How long the last plan took, milliseconds of wall clock. */
  private planMs = 0;
  /** And what she is doing with it. Acts interrupt; motions do not. */
  private act: Act = 'none';
  private dive = 0;
  /** Whether her feet are off the bottom, updated every on-foot frame. */
  private afloat = false;
  /**
   * THE BUOY. Built here rather than reached for globally so the scene
   * owns its lifetime, and constructed even when the flag is off —
   * construction only reads the cache, it does not touch the network.
   */
  private readonly sea = seaFeed();
  /** The `?sea=` dials in force, or null on the shipped ocean. */
  private wantsSea: LiveSeaOptions | null = null;
  /** The feed reading the running generation was grown from. */
  private seaStamp = -1;
  /** The wave table's shape, so the water is rebuilt only when it moves. */
  private seaTable = -1;
  /** Water over the ground under her, drawn units. */
  private wet = 0;
  /** Whether the water stands over her head — with hysteresis. */
  private headUnder = false;
  /** The hypoxia veil — see the constructor. */
  private dim!: HTMLDivElement;
  private shownDim = '';
  /** What the water was doing to her this frame, for the swim HUD. */
  private swimCarry: { x: number; z: number } | null = null;
  private swimAbove = 0;
  /** Vertical speed in the water, measured and eased for the eye. */
  private swimVs = 0;
  private lastSwimAlt: number | null = null;
  /** Water standing over where she rides — the DEPTH readout. */
  private swimOver = 0;
  /** How far the CAMERA is under a surface — the green-screen test. */
  private camUnder = 0;
  /** Latched 'there is water beneath her' — see readFlight. */
  private overWater = false;
  /** The DAMPED surface the autopilot flies against — see update(). */
  private holdFloor = 0;
  /** Her air, held while the head is under (breath.ts). */
  private readonly breath = new Breath();
  /** The sea's clock on her (brine.ts). */
  private readonly brine = new SaltExposure();
  /**
   * Her health, live at last. The caste table's maximum is the truth
   * it moves under; the sea is the first thing that can spend it and
   * healthRecovery — a stat that sat unread since it was written — is
   * the way back CLAUDE.md's bar rule demands.
   */
  private hp = liveStat('maxHealth');
  /** The look below the waterline. A LOOK, not a mechanic. */
  private underwater!: Underwater;
  /**
   * The CEILING on a full push of the stick — not propulsion. She does
   * not move because this is set; she moves because a thumb asks.
   */
  private pace: Pace = 'walk';
  /** A sprint asked for and not yet given up. */
  private sprintOn = false;
  /**
   * Set when a sprint runs dry, cleared when the ask stops. A held key
   * must not quietly start sprinting again the moment the bar creeps
   * back over its re-arm mark: that stutters between a sprint and a run
   * without the player asking for either. The next one is deliberate.
   */
  private reask = false;
  private readonly auto = new AutoRun();
  private readonly stamina = new Stamina();
  private speed = 0;
  /** Simulated seconds since boot — what the probes wait on. */
  private elapsed = 0;
  private readonly detachSettings: () => void;
  private detachKill: () => void = () => {};
  /**
   * Watches the canvas host itself. Orientation changes fire `resize`
   * before the viewport has settled on some phones, so a handler that
   * only listens for the event reads the OLD size and leaves the canvas
   * at the wrong dimensions. An observer fires after layout instead.
   */
  private readonly watchSize = new ResizeObserver(() => this.onResize());
  private disposed = false;
  private dying = false;

  constructor(
    private readonly host: HTMLElement,
    grid: HeightGrid,
    /**
     * Where the colony begins, in GLOBAL coordinates. Comes from the
     * spawn map; falls back to a search of the real terrain so the
     * island lab still boots straight into a scene on its own.
     */
    start?: { at: WorldPoint; heading: number },
    /**
     * Called when she dies. Nothing kills her yet — there is no damage
     * and no predator — so today this only fires from the debug kill,
     * which is enough to build and test the loop against.
     */
    private readonly onDeath?: () => void,
    /**
     * Where the loading screen finds out how the world is coming
     * along. Optional: the island lab boots straight in with nobody
     * watching, and the scene must not require an audience.
     */
    private readonly report?: LoadReport,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // The camera has to see from half a unit to six million. No
      // ordinary depth buffer spans that; a logarithmic one does, and
      // without it the distant island z-fights itself to pieces.
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    // THE DARKNESS WHEN THE AIR RUNS SHORT. A veil over the WORLD and
    // not the instruments: z-index 1 sits over the canvas and under
    // every HUD element (they start at 2), so a fainting queen can
    // still read the ring that says why and the lever that fixes it.
    // Driven from breath in update(); the transition smooths the steps.
    this.dim = document.createElement('div');
    Object.assign(this.dim.style, {
      position: 'fixed', inset: '0',
      // TUNNEL VISION, not a uniform dim: the rim goes first and the
      // centre lags well behind, so the world narrows the way sight
      // does. At full opacity the centre still passes ~45% of the
      // frame — the "barely" in barely see.
      background:
        'radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.82) 45%, rgba(0,0,0,0.97) 75%, #000 100%)',
      opacity: '0', pointerEvents: 'none', zIndex: '1',
      transition: 'opacity 400ms linear',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(this.dim);

    this.scene.background = new THREE.Color(SKY_COLOR);
    // At true scale an ant's world ends a few dozen metres out. The
    // fog hides where the streamed cells stop and hands off to the
    // backdrop, which is the island itself, correctly and distantly
    // enormous. FogExp2 rather than linear: with a backdrop 56 km away
    // a linear fog's far plane has to sit somewhere, and anywhere it
    // sits is a visible wall.
    // Thin enough to SEE with. It was 0.00055, which is a hundred
    // percent fogged by three thousand units — a metre and a half of
    // visibility, so the sea and the mountains and every landmark were
    // gone and flying was instrument-only. At this density she can make
    // out ground a few hundred metres off and the island beyond it,
    // while the air still stacks up over real distance.
    this.scene.fog = new THREE.FogExp2(SKY_COLOR, 0.0000075);

    this.buildLights();
    this.rain = new Rain(this.scene);
    // SMOOTHING FIRST, because it decides what the vertices ARE and
    // the mesh is about to be cut from them. Relief comes after, in
    // reshapeIsland, because that one is a transform ON the finished
    // mesh. Get either the wrong side of its build and the island is
    // drawn at one shape while she walks another — which is precisely
    // the bug that put her inside an invisible hill last release.
    setFlightScale(settings().flightSpeed);
    weather().setMode(settings().liveWeather ? 'live' : 'simulated');
    // The safeguard takes its own constant; the dial moves the RADIUS
    // and nothing else.
    setDetailRange();
    setDetailDial(settings().detailRange);
    syncLodUniforms();
    // The debug registry's picture of the coverage systems — replaced
    // by the same names when owners register themselves in later
    // stages, so calling it on every build stacks nothing.
    describeKnownSystems();
    setSmoothing(settings().terrainSmoothing);
    this.buildTerrain();

    // AFTER the terrain exists and BEFORE she is placed. Both halves
    // matter: the sections have to be there to be scaled, and she has
    // to be put down on the island's final height or she spawns inside
    // a hill. Getting this wrong drew the island at full height while
    // she stood at the flattened one — and since backfaces are culled,
    // the hill she was buried in simply vanished and left open sea.
    // Pick the opening spot from the real terrain rather than a
    // hand-typed coordinate a re-bake could drop into the sea.
    const found = start ?? (() => {
      const spot = findLandfall(grid, 3, 20);
      return { at: world(spot.x, spot.z), heading: Math.atan2(-spot.x, -spot.z) };
    })();
    // ORIGIN FIRST. Put it where she starts, so the very first frame
    // renders small numbers rather than five-million-unit ones — and
    // so the terrain that gets cut below is cut around HER, not around
    // wherever the origin happened to be left.
    // The island-wide channel bake — before the water's first
    // resample, so even the first window reads the world-fixed answer.
    // About a second, once, on the immutable coarse grid.
    bakeIslandChannels(grid);
    setOrigin(found.at.wx, found.at.wz);
    const seated = originAt();
    setTextureOrigin(seated.x, seated.z);
    const facing = found.heading;
    this.ant.placeAt(found.at.wx, found.at.wz, facing);
    // BEFORE the island is reshaped: the relief dial re-seats the stand,
    // and `reshapeIsland` below is the first turn of that dial. Empty
    // until the vegetation raster lands — see `vegArrived`.
    this.landmarks = new LandmarkStand(this.scene, import.meta.env.BASE_URL);
    // AND THE WOOD IS SOLID. The first thing in the game she cannot
    // pass through, walking or flying. Her body asks; the stand knows.
    this.ant.blocked = (x, y, z, radius) => this.landmarks.trunks.bump(x, y, z, radius);
    // AND THE WOOD IS CLIMBABLE, which is the same wood. Joshua: "let's
    // make the trees able to climb/walk, and in turn, collision." The
    // stand answers both questions because they are one fact about a
    // trunk seen from two sides — see ant/climb.ts.
    this.ant.grip = {
      depthAt: (x, y, z) => this.landmarks.trunks.depthAt(x, y, z),
    };
    this.terrain.follow(this.ant.where);
    this.reshapeIsland();
    this.scene.add(this.ant.root);

    this.stick = new MoveStick(host);
    this.paceUI = new PaceSelector(host);
    this.look = new LookDrag(host);
    this.panel = new SettingsPanel(host, true, () => this.kill());
    this.pauseMenu = new PauseMenu(host, {
      resume: () => { this.shroud(false); },
      save: () => this.save(),
      settings: () => this.panel.reveal(),
      quit: () => { this.partingSave(); this.leaving?.(); },
    });
    this.panel.intercept(() => {
      this.shroud(true);
      this.pauseMenu.show(this.mode);
    });
    // Her health, food and water come off the queen's stat table
    // rather than being typed here — this is the only place the data
    // file and the HUD meet, and it is a read, not a copy.
    this.actions = new ActionPad(host);

    this.weatherChip = new WeatherChip(host);
    this.flightHud = new FlightHud(host);
    this.compass = new Compass(host);
    // THE TEXTURED ISLAND, started here and finished whenever it is
    // finished. It reads the same seven ground maps the terrain is
    // built from, so it waits on nothing but their decode — they are
    // already in cache by the time anything asks. Deliberately NOT
    // awaited: a map is never worth holding a run up for, and both
    // surfaces draw the flat chart until this lands and then swap.
    void warmRelief(import.meta.env.BASE_URL);

    // THE MAP, AND THE ISLAND IT DRAWS, BOTH BUILT HERE — behind the
    // loading screen, on purpose.
    //
    // MEASURED rather than guessed, because the cost is the whole
    // argument: 1,163,976 `terrainHeight` calls (one per pixel of 768²
    // plus two more for the hillshade on each of the 48.7% that are
    // land), 428 ms on a desktop core with no HD tiles resident. Call
    // it a second or two on a phone. It memoises, so it is paid
    // exactly once; the only question is when.
    //
    // NEW COLONY already pays it at the spawn picker. CONTINUE COLONY
    // never constructs SpawnMap — GameFlow wires resume straight to
    // spawn — so a resumed run would have paid it COLD on the first
    // tap of the minimap, which is to say mid-flight. The veil is up
    // for the whole of this constructor. It gets paid here.
    bakeIsland();
    this.mapScreen = new MapScreen(host, {
      // THE CHAIN IS THE PLAYER'S; the BRAIN gets only its end.
      //
      // `MissionBrain` holds one primary mission and that is the right
      // shape for it: it answers "where does she need to be", and the
      // answer to a five-tap route is still its last point. The stops
      // on the way are a routing decision, so they live with the route.
      confirm: (chain) => {
        // THE NEXT STOP, NOT THE LAST ONE, and that was a real bug on
        // the device. Joshua set three waypoints with the last one
        // roughly where he was standing: she took off, flew nowhere,
        // and landed a few metres away. The brain had been handed the
        // END of the chain as its mission, its arrival test is "am I
        // within five metres of it", and she was — so the mission
        // completed on the first tick and the two stops before it were
        // never ordered at all.
        //
        // The brain answers "where does she need to be", and the honest
        // answer while a chain is running is the NEXT place, not the
        // final one. `advance` hands it the following stop each time
        // one completes; the route still covers the whole remaining
        // chain, so the map shows the trip rather than the hop.
        this.chain = [...chain];
        this.orderTo(this.chain[0], 'waypoint');
      },
      clearMission: () => this.brain.cancel(),
      // Solo halts, multiplayer takes her hands. One decision, made in
      // `shroud`, so the map and the pause menu cannot disagree.
      onToggle: (open) => {
        this.shroud(open);
        // A CAMERA DRAG CAN BE LIVE WHEN THIS OPENS. LookDrag binds to
        // #app and never looks at the event's target, so a thumb still
        // down when the map appears would keep swinging the world
        // behind it — the map's own root swallows moves, but the drag
        // that started BEFORE it existed is already claimed.
        if (open) this.look.release();
      },
    });
    // CONTINUE. The one way back from STANDBY that does not mean
    // re-confirming a destination she already has.
    this.apChip = new AutopilotChip(host, () => {
      this.surrendered = false;
      // AND THE CONTROLS MUST COME TO REST FIRST. A thumb still on the
      // stick when CONTINUE is tapped would otherwise take her straight
      // back — a button that undoes itself.
      this.handsClear = false;
      // Nothing else: the pin is still on the brain, the autopilot
      // still holds it, and the travel ramp eases back in on its own.
    });
    this.minimap = new Minimap(host, () => {
      this.mapScreen.open(this.marks(), this.known);
    });
    // Both buttons are ALWAYS there. A control that appears and
    // disappears under a thumb already resting on it is worse than one
    // that greys out, and the design says so explicitly.
    //
    // DESCEND IS ADDED FIRST AND SITS AT THE BOTTOM. The pad is a
    // `column-reverse`, so the order here is the order up the screen,
    // not down it. Up belongs physically above down — reading a climb
    // button below a descend button costs a beat every time, and it is
    // the sort of beat that gets someone killed mid-flight.
    this.liftSlider = new LiftSlider(host);
    // CONTEXTUAL, per the HUD rule: it exists because water now exists,
    // and it only lights when she is actually standing at some. Held,
    // not tapped — drinking is an act, and an act can be interrupted.
    // THE DRINK BUTTON IS BACK, because there is something to drink
    // again. It went out when the water did — it had spent a build on
    // the pad permanently disabled, which is the state the contextual
    // HUD rule exists to forbid: a control for a mechanic the game
    // does not have is clutter even when it is greyed.
    //
    // So it returns CONTEXTUAL, off the pad entirely unless there is
    // fresh water within reach (`canDrink`, which probes a ring around
    // her so she can drink from the bank rather than having to stand
    // in it — and which refuses salt at every probe, so the sea can
    // never satisfy it). And HELD, not tapped: drinking is an act, it
    // holds her still, and an act can be interrupted.
    this.drinkButton = this.actions.add('💧', 'drink', 'e');
    this.drinkButton.show(false);
    this.vitals = new Vitals(host, {
      health: liveStat('maxHealth'),
      food: liveStat('maxHunger'),
      water: liveStat('maxThirst'),
    });
    this.detachSettings = onChange(() => {
      this.follow.reshape();
      this.reshapeIsland();
      this.resmoothIsland();
      setFlightScale(settings().flightSpeed);
      weather().setMode(settings().liveWeather ? 'live' : 'simulated');
      // The safeguard takes its own constant; the dial moves the RADIUS
    // and nothing else.
    setDetailRange();
    setDetailDial(settings().detailRange);
    syncLodUniforms();
    });
    // The view is a world bearing, so it has to be told where behind
    // her IS. Without this she opens side-on to her own camera.
    this.look.setYaw(-facing);
    this.follow = new FollowCamera(this.aspect());
    this.follow.snapTo(this.ant.root, -facing);
    // The look below the waterline. Reads the camera and the water
    // query; safe from the first frame because both exist by here and
    // a dry eye is a no-op.
    this.underwater = new Underwater(this.scene, this.follow.camera);

    // ARRIVE IN THE WEATHER, do not fade into it. Everything the sky
    // does eases over minutes, which is right while she is walking and
    // wrong at the instant she appears: without this she would spawn
    // into a default afternoon and watch the real one wash over her.
    this.applyWeather(weather().settleAt(found.at));

    // THE FIRST MARKER, and for now the only one: where she started.
    // It is a real marker rather than a mock — same list, same
    // projection, same edge-pinning — so what comes next (a nest, a
    // death site, a target) is a push onto this array and nothing else.
    this.markers.push({
      id: 'spawn',
      label: 'START',
      at: found.at,
      colour: 'rgba(150, 235, 160, .95)',
    });

    // She plays in stick-legs from the first frame and becomes herself
    // when the mesh lands. A failed load leaves the placeholder up,
    // which is a playable game rather than an ant-shaped hole.
    const queenArrived = loadQueen(this.report)
      .then((queen) => {
        if (this.disposed) return;
        this.ant.wear(queen.model);
        this.queen = queen;
        // Whatever was asked for before she arrived still holds: the
        // model lands a second or two late and must not undo a decision
        // taken in the meantime.
        queen.setWings(this.winged);
      })
      .catch((why) => console.warn('the queen model did not load', why))
      .finally(() => this.report?.finish(QUEEN_JOB));

    // Debug kill, so the death/restart loop can be walked through
    // before anything in the world is able to hurt her.
    const debugKill = (event: KeyboardEvent) => {
      if (event.code === 'KeyK' && !event.repeat) this.kill();
      // Until dealation is a real event, G is how the two states get
      // looked at side by side.
      if (event.code === 'KeyG' && !event.repeat) this.setWings(!this.winged);
    };
    window.addEventListener('keydown', debugKill);
    this.detachKill = () => window.removeEventListener('keydown', debugKill);

    // A fresh queen gets her five minutes from the moment she arrives.
    this.grace.begin();

    this.watchSize.observe(host);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(this.tick);

    // The terrain was cut synchronously up in the constructor, so by
    // the time anyone can await this it is already standing.
    // AND RE-CUT WHEN THE FINE GROUND LANDS. The cells above were built
    // from whatever `baseLand` could answer at the time, which for the
    // first frames is the coarse grid; a tile arriving afterwards moves
    // the answer without moving the mesh, and she would stand on
    // 54.7 m triangles over 13.67 m ground.
    // ONE callback — `onHdTile` is a single slot, so the trees reseat
    // inside the terrain's re-cut rather than registering a second
    // listener that would silently replace it.
    onHdTile(() => {
      if (this.disposed) return;
      this.terrain.rebuild();
      this.landmarks.reseat();
    });
    followHd(this.ant.where.wx, this.ant.where.wz);
    // WHAT GROWS WHERE — the vegetation rasters, off the loading plan
    // like the HD tiles: 442 KB that decide where the landmark trees
    // stand, and a forest that appears a second after the ground is
    // not worth holding the veil up for. Nothing draws until it lands,
    // and nothing breaks if it never does — the island is simply bare,
    // which is what it was until v0.0.149.
    void loadVeg()
      .then(() => { if (!this.disposed) this.vegArrived(); })
      .catch((why) => console.warn('the vegetation raster did not load', why));


    this.report?.finish(TERRAIN_JOB);

    /**
     * Presentable, in three steps that have to happen in this order.
     *
     * The maps and the queen first — those are the five megabytes, and
     * the black ground is what their absence looks like. Then ONE MORE
     * DRAWN FRAME, because a texture is not on screen the moment its
     * promise resolves: three uploads it to the GPU and compiles
     * against it during the next render, and lifting the veil before
     * that shows the very frame the veil was for.
     */
    this.ready = (async () => {
      await Promise.allSettled([this.bandsReady, queenArrived]);
      if (this.disposed) return;
      await new Promise<void>((drawn) => { this.showFirstFrame = drawn; });
      this.report?.finish(FIRST_LIGHT_JOB);
    })();

    // What the headless probes measure the scene by.
    (window as unknown as Record<string, unknown>).__island = {
      triangles: () => this.renderer.info.render.triangles,
      drawCalls: () => this.renderer.info.render.calls,
      where: () => [this.ant.where.wx, this.ant.root.position.y, this.ant.where.wz],
      origin: () => originAt(),
      cells: () => this.terrain.cellCount,
      /** How many fine tiles are resident — 0 until the first lands. */
      hdTiles: () => hdResident(),
      /**
       * Move the smoothing dial and re-cut, for the comparison rig.
       * The same path the slider takes on release; a blur mixes
       * neighbouring samples, so the vertices genuinely move.
       */
      smoothing: () => smoothingAmount(),
      setSmoothing: (to: number) => {
        setSmoothing(to);
        this.terrain.rebuild();
        this.ant.reground();
      },
      cameraAt: () => this.follow.camera.position.toArray(),
      paused: () => this.halted,
      /**
       * THE POSITION FIX AS A STRING — the same one under the compass.
       *
       * Paired with `goTo`, this is how a screenshot becomes a frame
       * that can be re-rendered: read the line off the picture, hand it
       * back, stand in the same place. See ui/fix.ts.
       */
      fix: () => {
        const view = new THREE.Vector3();
        this.follow.camera.getWorldDirection(view);
        return formatFix(fixAt(
          this.ant.where, this.mslNow(),
          bearingOf(view.x, view.z), pitchOf(view.y), reliefScale(),
        ));
      },
      /** Put the camera back where a fix says it was. */
      goTo: (text: string) => this.goTo(text),
      // Her WORLD position, not her rendered one. root.position is
      // measured from the floating origin now, so asking the heightfield
      // about it samples a spot near the middle of the island instead
      // of the ground she is standing on.
      /**
       * WATER, FOR PROBES AND FOR TESTS.
       *
       * The whole argument for the simulated water is that it can be
       * CHECKED instead of looked at, and a check needs a way in. This
       * is it: depth under any world point, and how much of the window
       * is currently drawn.
       */
      waterDepth: (wx: number, wz: number) => this.water?.depthAt(wx, wz) ?? 0,
      // WHERE THE SHEET ACTUALLY IS, versus the ground drawn under it.
      // Depth alone cannot tell you the water is buried in the hill.
      waterSkin: (wx: number, wz: number) => this.water?.skinAt(wx, wz) ?? null,
      // STAGE H. Phase 1.5 gave the player a real door to this (the
      // map's FLY HERE), and the probe keeps its own so a test can
      // order a hydration mission, which the map deliberately cannot.
      orderTo: (wx: number, wz: number, satisfiesHydration = false) => {
        this.orderTo(world(wx, wz), 'probe', satisfiesHydration);
      },
      cancelOrder: () => this.brain.cancel(),
      /**
       * PHASE 2, probe only: what the autopilot is doing, and WHY NOT.
       *
       * It returned null whenever it was not flying, which cost an
       * afternoon: the first end-to-end probe watched a queen who was
       * airborne with a pin set and was told only `null` — which cannot
       * tell "not engaged" from "surrendered" from "on the ground". The
       * reasons are the useful half.
       */
      autopilot: () => ({
        engaged: this.autopilot.engaged,
        surrendered: this.surrendered,
        aloft: this.flight.aloft,
        pinned: this.brain.primaryMission !== null,
        stick: [this.rawStick.x, this.rawStick.y],
        travel: this.travel.scale,
        lever: this.liftSlider.lift,
        nav: this.nav === null ? null : {
          state: this.nav.state,
          blocked: this.nav.blocked,
          range: this.nav.range,
          wanted: this.nav.wanted,
          track: this.heldTrack,
          error: this.nav.error,
          target: this.nav.target,
          airspeed: this.flight.airspeed,
          clearance: this.nav.ahead,
        },
      }),
      /**
       * PHASE 3, probe only: put something in her way.
       *
       * The hazard list is empty in the shipped game because TMB has
       * nothing to put in it yet — no trees with tops, no predators, no
       * forbidden ground. That is honest, and it also means the router
       * has nothing to route around, so this is the door that lets a
       * probe prove the whole chain: pin, plan, detour, fly it.
       *
       * `top: null` is a thing she may never fly over — go around it.
       * A number is how much air she needs to pass above it.
       */
      addHazard: (
        wx: number, wz: number, radius: number, top: number | null = null,
      ) => {
        this.hazards.push({
          id: `probe-${this.hazards.length}`,
          at: world(wx, wz),
          radius,
          top,
          kind: top === null ? 'zone' : 'obstacle',
        });
        return this.hazards.length;
      },
      clearHazards: () => { this.hazards.length = 0; },
      /** Probe only: the plan the last order turned into. */
      routePlan: () => (this.route === null ? null : {
        legs: this.route.legs.map((leg) => ({
          wx: leg.to.wx, wz: leg.to.wz, floorAgl: leg.floorAgl, detour: leg.detour,
        })),
        at: this.legAt,
        words: routeWords(this.route.report),
        ...this.route.report,
        planMs: this.planMs,
      }),
      /** Probe only: the landmark trees within a radius of her. */
      trees: (radius: number) => landmarksNear(this.ant.where, radius).map((t) => ({
        id: t.id, wx: t.at.wx, wz: t.at.wz, height: t.height, trunk: t.trunk,
        ground: t.ground,
      })),
      /**
       * Probe only: is this world point inside a trunk, and which way
       * is out? The same call `PlayerAnt.settle` makes, so a probe can
       * check the wall from outside rather than trusting that it fired.
       */
      trunkAt: (wx: number, y: number, wz: number, radius = 0) =>
        this.landmarks.trunks.bump(wx, y, wz, radius),
      /** Probe only: is she holding wood, and which way is her up? */
      climbing: () => ({
        on: this.ant.climbing,
        up: [this.ant.up.x, this.ant.up.y, this.ant.up.z],
        height: this.ant.height,
        ground: groundHeight(this.ant.where.wx, this.ant.where.wz),
      }),
      /** Probe only: the nearest trunk the forward march can see. */
      inTheWay: () => {
        const way = this.autopilot.inTheWay;
        return way === null ? null : {
          id: way.id, range: way.range, off: way.off, squeeze: way.squeeze,
          way: way.way, swerve: way.swerve, pinched: way.pinched,
        };
      },
      /** Probe only: what the stand is drawing. */
      landmarks: () => ({
        standing: this.landmarks.trees.length,
        near: this.landmarks.nearby,
        triangles: this.landmarks.triangles,
      }),
      /** Probe only: what the textured overview cost, and whether it landed. */
      mapRelief: () => ({ ms: Math.round(reliefCost()), ready: reliefIsland() !== null }),
      // PHASE 1.5, probe only. Discovery is meant to take hours of
      // flying to open up, which is exactly right for a player and
      // useless for a screenshot — so a probe can walk the reveal
      // along a line and photograph a map with something on it.
      explore: (fromX: number, fromZ: number, toX: number, toZ: number, steps = 40) => {
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          reveal(this.known, fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t);
        }
        return fractionSeen(this.known);
      },
      explored: () => fractionSeen(this.known),
      openMap: () => this.mapScreen.open(this.marks(), this.known),
      closeMap: () => this.mapScreen.close(),
      /** Probe only: the same door the save system restores through. */
      setThirst: (fraction: number) => this.thirst.restore(fraction),
      /** Probe only: whether the vegetation rasters have landed. */
      vegReady: () => this.vegReady,
      autonomy: () => ({
        goal: this.brain.goal,
        primary: this.brain.primaryMission?.label ?? null,
        detour: this.brain.detourMission?.label ?? null,
        intent: this.brain.intent,
        channel: this.channelNear,
        // The corridor candidates handed over this second, and what the
        // last water decision actually weighed — a probe that can only
        // see the goal cannot tell a good choice from a lucky one.
        ahead: this.waterAhead.length,
        candidate: this.brain.debug({
          at: this.ant.where,
          thirst: this.thirst.fraction,
          thirstDrain: this.thirst.drain,
          stamina: this.stamina.fraction,
          staminaSpent: this.stamina.spent,
          motion: this.motion,
          act: this.act,
          medium: 'air',
          tier: 'run',
          paceShare: 1,
          wingsWet: this.wings.wet,
          drinkable: false,
          nearestFresh: null,
          nearestWatercourse: this.channelNear,
          waterAhead: this.waterAhead,
        }).candidate,
        thirst: this.thirst.fraction,
        drain: this.thirst.drain,
        ...(() => {
          const g = this.gaitNow();
          return {
            medium: g.medium, tier: g.tier, paceShare: paceShare(g.medium, g.tier),
          };
        })(),
      }),
      // What the water is doing to HER, for the probes: the same
      // numbers the movement just used, not a re-derivation.
      wading: () => ({ depth: this.wet, afloat: this.afloat, dive: this.dive, under: this.headUnder }),
      // The wings' clock, for the probes and for a device readout —
      // wet says whether she may fly, seconds is what the lever shows.
      wingDry: () => ({
        wet: this.wings.wet, seconds: this.wings.seconds, held: this.wings.held,
      }),
      sea: () => ({
        hp: this.hp, air: this.breath.fraction,
        salt: this.brine.exposureSeconds, burning: this.brine.burning,
      }),
      // THE VERTICAL TRUTH, all of it, from the frame that just ran —
      // what the flight is flooring on, what the water query says, and
      // the three altitudes. A disagreement between these is exactly
      // the class of bug that put her under the sea while the HUD said
      // she was a metre over it.
      column: () => {
        const g = groundHeight(this.ant.where.wx, this.ant.where.wz);
        const spot = waterSpotAt(this.ant.where.wx, this.ant.where.wz);
        const depth = spot?.depth ?? 0;
        return {
          ground: g,
          depth,
          salt: spot?.salt === true,
          floor: g + depth,
          clearance: this.flight.height,
          msl: g + depth + this.flight.height,
          mode: this.flight.holdMode,
          aloft: this.flight.aloft,
          camUnder: this.camUnder,
          herY: this.ant.root.position.y,
          camY: this.follow.camera.position.y,
          afloat: this.afloat,
          dive: this.dive,
        };
      },
      sheets: () => this.scene.children
        .filter((o) => (o as THREE.Mesh).isMesh
          && ((o as THREE.Mesh).geometry?.getAttribute('depth')))
        .map((o) => {
          const m = o as THREE.Mesh;
          return {
            verts: m.geometry.getAttribute('position').count,
            order: m.renderOrder,
            visible: m.visible,
            pos: [Math.round(m.position.x), Math.round(m.position.y), Math.round(m.position.z)],
            colour: (m.material as THREE.MeshStandardMaterial).color.getHexString(),
          };
        }),
      /**
       * Probe-only: leave ONLY the near ocean sheet drawing, so its
       * geometry can be judged with nothing in front of or behind it.
       * Identified by vertex count — 241^2 near, 257^2 far horizon,
       * 256^2 the freshwater window.
       */
      solo: (on: boolean) => {
        for (const o of this.scene.children) {
          const m = o as THREE.Mesh;
          if (!m.isMesh || !m.geometry?.getAttribute('depth')) continue;
          const n = m.geometry.getAttribute('position').count;
          m.visible = on ? n === 241 * 241 : true;
        }
      },
      /** Probe-only: hide every water sheet at once. */
      hideAllWater: () => {
        for (const o of this.scene.children) {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry?.getAttribute('depth')) m.visible = false;
        }
      },
      /** Probe-only: sweep the authored texture scale, world units. */
      setTileScale: (units: number) => setTileScale(units),
      /**
       * PROFILING: rebuild the ground with or without the relief path.
       *
       * `relief(0)` is NOT this. It skips the final normal bend and
       * leaves all five relief fetches, the blend, the cavity and the
       * scanned roughness running, so 0 against 1 compares two shaders
       * that do nearly the same work. This recompiles.
       *
       *   __island.ground('full')   what ships
       *   __island.ground('base')   relief path compiled out
       *   __island.ground('lite')   biome colour only, no samples
       */
      ground: (mode: 'full' | 'base' | 'lite') => ({ mode: setGroundMode(mode) }),
      /**
       * The foam's distance simplification. 1 ships, 0 is the control:
       * full lace at every range, which is what 166 m looked like
       * before.
       */
      foamLod: (amount: number) => ({ foamLod: setFoamLod(amount) }),
      /**
       * THE MASTER LOD, inspected (see docs/LOD_ARCHITECTURE.md).
       *
       *   __island.lod()                     the whole state: dial %,
       *     radius, 3D anchor, speed, the point straight BELOW her
       *     (true 3D distance + micro fraction — the flying case),
       *     any forces, every registered profile.
       *   __island.lodAt(wx, wy, wz)         one world point: its 3D
       *     distance, micro fraction, and tier on every ladder.
       *   __island.lodForce(0.5)             pin the MICRO fraction
       *     everywhere; null releases it.
       *   __island.lodForceTier('terrain-tiers', 2)   pin a profile
       *     to a tier index; null releases. Both report FORCED on the
       *     overlay line while pinned, and neither survives a reload.
       */
      /**
       * THE SEA EXPERIMENT (Stage C, dev only). Four comparisons, and
       * each rebuilds the water so the picture and the physics agree:
       *
       *   __island.waves('fixed')            the shipped 2-wave sea
       *   __island.waves('procedural')       macro + meso, default scale
       *   __island.waves('macro')            macro only, no chop
       *   __island.waves('procedural', 0.6)  meso at a chosen scale
       *
       * Returns what the sea now IS — every generated component, so a
       * report never has to guess what it measured.
       */
      waves: (which: 'fixed' | 'procedural' | 'macro' | 'meso' = 'procedural',
        mesoScale?: number) => {
        if (which === 'fixed') this.useSea(null);
        else {
          this.useSea({
            ...(which === 'macro' ? { meso: false } : {}),
            ...(which === 'meso' ? { macro: false } : {}),
            ...(mesoScale === undefined ? {} : { mesoScale }),
          });
        }
        return this.seaReport();
      },
      /** What the sea is right now, without changing it. */
      waveState: () => this.seaReport(),
      lod: () => lodReport(),
      lodAt: (wx: number, wy: number, wz: number) => lodAt(wx, wy, wz),
      lodForce: (fraction: number | null) => {
        forceMicro(fraction);
        return lodReport().forced;
      },
      lodForceTier: (profile: string, index: number | null) => {
        forceTier(profile, index);
        return lodReport().forced;
      },
      // The micro-relief, judged where it ships: on a phone, in sun.
      // bump 0 is the honest A/B — it turns the third dimension off
      // without touching the colour work underneath it.
      relief: (bump: number, ao?: number) => {
        setReliefBump(bump);
        if (ao !== undefined) setReliefAo(ao);
        return { bump: RELIEF_BUMP_UNIFORM.value, ao: RELIEF_AO_UNIFORM.value };
      },
      /** Probe-only: drive a settings dial from a headless run. */
      setSetting: (key: string, value: number) => {
        setSetting(key as 'detailRange', value as never);
      },
      /**
       * Probe-only: where a GROUND point this far from her lands on
       * screen, so a detail radius can be measured against the world
       * rather than guessed from a screenshot.
       */
      project: (dx: number, dz: number) => {
        const at = this.ant.where;
        const seat = toLocal(world(at.wx + dx, at.wz + dz));
        const p = new THREE.Vector3(seat.lx, groundHeight(at.wx + dx, at.wz + dz), seat.lz);
        p.project(this.follow.camera);
        const wide = this.renderer.domElement.clientWidth;
        const tall = this.renderer.domElement.clientHeight;
        return p.z > 1 ? null
          : { x: ((p.x + 1) / 2) * wide, y: ((1 - p.y) / 2) * tall };
      },
      // Probe-only: set her air, so a 45-second drain does not cost a
      // headless run ten slow-motion minutes to reach the interesting
      // part.
      gasp: (fraction: number) => this.breath.restore(fraction),
      waterDrawn: () => this.water?.drawnCells() ?? -1,
      groundUnderfoot: () => groundHeight(this.ant.where.wx, this.ant.where.wz),
      /**
       * PUT HER SOMEWHERE, in GLOBAL coordinates — for probes that need
       * a particular piece of island and cannot walk five kilometres to
       * it at ant pace under a software renderer.
       *
       * Does everything a spawn does, in the same order and for the
       * same reasons: the origin first so nothing large is ever
       * rendered, then her, then the terrain around her, then the sea's
       * folded phase, then the camera snapped rather than eased.
       */
      putAt: (wx: number, wz: number, heading = 0) => {
        // A teleport is not travel. The water-speed row smooths her
        // measured velocity, and folding a jump in reads as thousands
        // of centimetres a second of "current" for the next second —
        // the screenshot rig caught SWIM @ 1553 cm/s on a fix restore.
        setOrigin(wx, wz);
        const seat = originAt();
        setTextureOrigin(seat.x, seat.z);
        this.ant.placeAt(wx, wz, heading);
        this.flight.land();
        this.terrain.follow(this.ant.where);
        this.terrain.place();
        // AND THE LOOK DRAG, which is the other half of the camera.
        // `bodyView` is -look.yaw, so leaving it behind aims her at
        // whatever she was facing before the teleport: she lands
        // pointing the right way and then curves back onto the old
        // heading over the next few seconds. A probe that stood her
        // in front of a tree watched her arc politely around it and
        // read that as the collision failing to fire.
        this.look.face(-heading);
        this.follow.snapTo(this.ant.root, -heading);
      },
      pace: () => this.pace,
      setPace: (to: Pace) => { this.pace = to; },
      stamina: () => this.stamina.fraction,
      /** Probe only: the same door the save system restores through. */
      setStamina: (fraction: number) => this.stamina.restore(fraction),
      speed: () => this.speed,
      // Wall clock is not game time here: a frame under a software
      // renderer is worth hundreds of milliseconds, so every check that
      // means "after N seconds of PLAY" has to wait on this instead.
      simTime: () => this.elapsed,
      auto: () => this.auto.state,
      sprinting: () => this.sprintOn,
      setSprint: (on: boolean) => { this.sprintOn = on; },
      bearing: () => this.ant.bearing,
      roll: () => this.flight.roll,
      stride: () => this.ant.stridePhase,
      deadzone: () => REST_DEADZONE,
      fov: () => this.follow.camera.fov,
      kill: () => this.kill(),
      grace: () => this.grace.seconds,
      shielded: () => this.grace.shielded,
      disarmed: () => this.grace.disarmed,
      ignoredByHostiles: () => this.grace.ignoredByHostiles,
      wings: () => this.winged,
      /**
       * Probe only: the SHARED water query — the one the scene itself
       * flies against, which reports the sea as well as the inland
       * simulation. `waterDepth` above is the inland sim alone, and a
       * probe hunting for the ocean with it finds streams.
       */
      seaAt: (wx: number, wz: number) => {
        const spot = waterSpotAt(wx, wz);
        return spot === null ? null
          : { depth: spot.depth, salt: spot.salt === true };
      },
      /**
       * Probe only: the crest lately, and the AWL it demands.
       *
       * NOT `waves` — that name is already the sea's own visual mode
       * switch, and two of them in one object literal is a silent
       * overwrite in JavaScript and a compile error here. Named for
       * what it is about: the clearance she needs.
       */
      seaClear: () => ({
        crest: this.waves.crest,
        clearance: this.waves.clearance,
        floor: this.holdFloor,
      }),
      /** Probe only: seconds until she can fly again, or null if dry. */
      wingsLeft: () => this.wings.seconds,
      compass: () => {
        const view = new THREE.Vector3();
        this.follow.camera.getWorldDirection(view);
        return bearingOf(view.x, view.z);
      },
      // What the loader actually produced, so a missing wing mesh is a
      // finding rather than a mystery.
      queenParts: () => {
        const found: unknown[] = [];
        this.ant.root.traverse((part) => {
          const mesh = part as THREE.Mesh & { isMesh?: boolean; isSkinnedMesh?: boolean };
          if (!mesh.isMesh) return;
          const geo = mesh.geometry as THREE.BufferGeometry;
          found.push({
            name: part.name,
            skinned: Boolean(mesh.isSkinnedMesh),
            visible: part.visible,
            tris: geo.getIndex() ? (geo.getIndex() as THREE.BufferAttribute).count / 3 : 0,
          });
        });
        return found;
      },
      setWings: (on: boolean) => this.setWings(on),
      // The whole flight picture as the HUD received it, so a probe can
      // check the WIRING and not just the arithmetic — the unit tests
      // cannot tell whether the scene handed the HUD airspeed where it
      // meant ground speed, which is a mistake this code has already
      // made once.
      telemetry: () => this.lastFlight,
      // HOW FAR THE GROUND DETAIL ACTUALLY REACHES, which is a
      // question no screenshot answers and every fade tuning needs.
      // Walks the centre column, unprojects each row onto the ground
      // plane under her, and differences neighbouring pixels — the
      // same footprint the shader's own derivatives report, in the
      // same texels, against a distance in metres. `probe:reach` turns
      // it into a table. Kept because the first four attempts at this
      // fade were all tuned by eye, and the eye had them ten times too
      // tight.
      fadeProfile: () => {
        const cam = this.follow.camera;
        const w = this.renderer.domElement.clientWidth;
        const h = this.renderer.domElement.clientHeight;
        const groundY = this.ant.root.position.y;
        const hit = (px: number, py: number): THREE.Vector3 | null => {
          const ndc = new THREE.Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0.5);
          ndc.unproject(cam);
          const dir = ndc.sub(cam.position).normalize();
          if (dir.y >= -1e-6) return null;
          const t = (groundY - cam.position.y) / dir.y;
          if (t <= 0) return null;
          return cam.position.clone().addScaledVector(dir, t);
        };
        const rows: unknown[] = [];
        for (let py = 2; py < h; py += 2) {
          const a = hit(w / 2, py);
          const b = hit(w / 2, py + 1);
          const c = hit(w / 2 + 1, py);
          if (!a || !b || !c) continue;
          const long = Math.max(a.distanceTo(b), a.distanceTo(c));
          rows.push({
            py,
            // Horizontal ground distance from her, in metres.
            metres: Math.hypot(a.x - this.ant.root.position.x,
                               a.z - this.ant.root.position.z) / 100,
            texels: (long / BAND_TILE) * 1024,
          });
        }
        return {
          camHeightCm: cam.position.y - groundY,
          fov: cam.fov,
          tileCm: BAND_TILE,
          // The LIVE thresholds, dial included, so the probe reports
          // what actually ships rather than what it was told once.
          fadeFrom: FADE_FROM_UNIFORM.value,
          fadeTo: FADE_TO_UNIFORM.value,
          rows,
        };
      },
      graceRecord: () => this.grace.issued,
      sightLine: (pitchDeg: number, yawDeg = 0) => this.sightLine(pitchDeg, yawDeg),
      sightThroughPixel: (u: number, v: number) => this.sightThroughPixel(u, v),
      tierHeights: (wx: number, wz: number) => this.tierHeights(wx, wz),
      terrainCost: () => this.terrain.cost,
      weather: () => this.nowWeather,
      reading: () => weather().reading,
      weatherSource: () => weather().source,
      fogDensity: () => (this.scene.fog as THREE.FogExp2).density,
      sunlight: () => this.sun.intensity,
      raindrops: () => this.rain.drawing,
      weatherAt: (wx: number, wz: number) => weather().peek(world(wx, wz)),
      airborne: () => this.motion === 'flying',
      // STAGE G. The one name for what she is doing, so a probe can
      // assert on the state instead of re-deriving it from six flags.
      motion: () => this.motion,
      act: () => this.act,
      height: () => this.flight.height,
      flightState: () => this.flight.where,
      airspeed: () => this.flight.airspeed,
      canTakeOff: () => this.flight.canTakeOff(this.ant.pace, this.stamina.fraction),
    };

    // `?fix=...` — the other half of the screenshot loop. A fix read
    // off a phone picture goes in the address bar and the same frame
    // comes back, with no walking and nothing typed at a console.
    // Deliberately after the handle above, because it goes through it.
    const asked = new URLSearchParams(location.search).get('fix');
    if (asked) this.goTo(asked);
  }

  /**
   * Flatten or raise the island to the relief dial.
   *
   * A SCALE, not a rebuild. Rebuilding 128 section geometries on every
   * drag of a slider would hitch for seconds; scaling the meshes on Y
   * is free and cannot disagree with the walker, because a triangle's
   * height interpolates linearly between its corners — scaling the
   * corners and scaling the answer are the same arithmetic.
   *
   * The band shader divides the same number back out, so a flattened
   * Kauai keeps sand at the shore and snow on the peaks instead of
   * going green to the summit.
   */
  /** Vertical exaggeration — a transform, so it is free. */
  private reshapeIsland(): void {
    const times = settings().terrainRelief;
    this.terrain.setRelief(times);
    setRelief(times);
    this.landmarks.reseat();
    // The band shader picks its texture by world height, so an
    // exaggerated island would wear the wrong biomes without this.
    reliefUniform.value = times;
    // THE DIAL REACHES THE WATER, explicitly. The lakes only ever
    // survived a relief change because their follow() happens to re-seat
    // every frame; the rivers' follow() early-returns and kept the old
    // scale until she crossed a decision cell — minutes, at ant pace.
  }

  /**
   * Re-cut the ground at a new smoothing.
   *
   * Unlike the height dial this cannot be a transform: a blur mixes
   * neighbouring samples, so the vertices genuinely move and every cell
   * has to be built again. That is why the slider commits on release.
   */
  private resmoothIsland(): void {
    const wanted = settings().terrainSmoothing;
    if (wanted === smoothingAmount()) return;
    setSmoothing(wanted);
    this.terrain.rebuild();
    this.ant.reground();
  }

  /**
   * End the run. Debug-only for now: `K`, or __island.kill().
   *
   * Real deaths arrive with damage and predators. Having the path
   * exist first means those land as a cause rather than as a system.
   */
  kill(): void {
    if (this.dying) return;
    this.dying = true;
    // WHAT SHE LEARNED OUTLIVES HER. The run is over, but the slot is
    // what CONTINUE COLONY reads, and a death that threw away the last
    // minute of exploring would make dying cost map as well as life.
    this.partingSave();
    this.onDeath?.();
  }

  /**
   * The one door damage comes through, so every cause of death lands
   * as a cause rather than as its own system — exactly what kill()'s
   * note promised. Saltwater is the first caller.
   *
   * @param why a short cause, carried so the death screen can one day
   *   say what got her. Unused until it can.
   */
  hurt(amount: number, why: string): void {
    if (this.dying || amount <= 0) return;
    void why;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp <= 0) this.kill();
  }

  dispose(): void {
    this.underwater.dispose();
    this.ocean?.dispose();
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.watchSize.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.stick.dispose();
    this.paceUI.dispose();
    this.flightHud.dispose();
    this.look.dispose();
    this.panel.dispose();
    this.vitals.dispose();
    this.actions.dispose();
    this.liftSlider.dispose();
    this.pauseMenu.dispose();
    this.weatherChip.dispose();
    this.compass.dispose();
    this.apChip.dispose();
    this.minimap.dispose();
    this.mapScreen.dispose();
    this.rain.dispose();
    this.detachSettings();
    this.detachKill();
    onHdTile(null);
    forgetHd();
    forgetVeg();
    this.landmarks.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.dim.remove();
  }

  /**
   * WHAT SHE IS AND WHERE, for the save. Global coordinates and
   * fractions — nothing local, nothing rendered, nothing that means a
   * different thing on a different relief dial.
   */
  snapshot(): Snapshot {
    return {
      region: this.savedRegion,
      at: {
        wx: this.ant.where.wx,
        wz: this.ant.where.wz,
        heading: this.ant.bearing,
        agl: this.flight.height,
      },
      body: { stage: LIVE_GROWTH, winged: this.winged },
      meters: { stamina: this.stamina.fraction, thirst: this.thirst.fraction },
      elapsed: this.elapsed,
      playedSeconds: this.lived,
      // WHAT SHE KNOWS, which is not what is there. The island is a
      // function and is never saved; the fog over it is the one thing
      // about the map that is hers and cannot be recomputed.
      discovery: encodeDiscovery(this.known),
    };
  }

  /**
   * Which kind of run this is. Called by GameFlow before first light.
   *
   * A setter rather than a constructor argument for the same reason
   * `resume` is one: the constructor already carries five parameters
   * and two of its callers pass two, so a sixth positional would need
   * a default that quietly disagrees with the front door.
   */
  setMode(mode: SessionMode): void {
    this.mode = mode;
  }

  /**
   * START THIS RUN KNOWING WHAT THE LAST ONE LEARNED.
   *
   * `resume()` restores a saved run's own map. This is the other case:
   * a NEW queen, after the last one died, on an island the player has
   * already flown over. CLAUDE.md's premise is that individual ants die
   * and the colony continues, and card 10 is explicit that discovery is
   * what THIS PLAYER knows rather than what this body saw — so a death
   * costs a life and not a chart.
   *
   * Bad or absent text starts her unexplored, the same as any other
   * unreadable blob. Losing a map is a smaller thing than refusing a
   * run.
   */
  inheritDiscovery(blob: string | undefined): void {
    this.known = decodeDiscovery(blob) ?? emptyDiscovery();
  }

  /**
   * A MENU WENT UP OR CAME DOWN, and exactly one place decides what
   * that costs.
   *
   * Solo halts the tick, which is the behaviour this game has always
   * had and is legitimate for one player alone. Multiplayer cannot:
   * the other queen does not stop existing while this one reads a map,
   * so the world keeps turning and she simply loses the controls —
   * `handsOff` below. Both doors (the pause menu and the map) come
   * through here so they cannot drift apart about what a pause means.
   */
  private shroud(open: boolean): void {
    this.menuOpen = open;
    this.halted = open && this.mode === 'solo';
  }

  /**
   * Her hands are off the controls but the world is still running.
   *
   * Only ever true in multiplayer — in solo the tick has already
   * returned by the time anything asks.
   */
  private get handsOff(): boolean {
    return this.menuOpen && this.mode === 'multiplayer';
  }

  /** Where QUIT TO MENU goes. */
  onLeave(run: () => void): void {
    this.leaving = run;
  }

  /**
   * The last write before this run stops being the live one.
   *
   * QUIT and DEATH both used to walk away from up to a minute of
   * simulated time — her position, her meters, and now the map she had
   * opened up. Autosave is a floor, not a goodbye.
   */
  private partingSave(): void {
    this.sinceSaved = 0;
    this.save();
  }

  /**
   * SEND HER SOMEWHERE — the one path a destination is set through.
   *
   * `order()` on the brain already IS "replace the primary mission": it
   * swaps the primary, wakes the state machine if it was off or
   * finished, and leaves a live survival detour running. There is no
   * `setPrimaryMission` to add and adding one would be two names for a
   * decision.
   *
   * `satisfies` IS ALMOST ALWAYS EMPTY, and the exception is the probe.
   * A mission that advertises hydration is one the brain reads as
   * already solving thirst — `thirstUnsafe` returns false on it — so
   * tagging a player's waypoint would quietly disable the whole
   * survival-detour system for as long as the pin existed. The map
   * never passes true.
   */
  private orderTo(at: WorldPoint, label: string, hydration = false): void {
    this.brain.order({
      id: `${label}:${Math.round(at.wx)},${Math.round(at.wz)}`,
      label,
      at,
      satisfies: hydration ? ['hydration'] : [],
      arriveWithin: 500,
    });
  }

  /**
   * IS THE AUTOPILOT DELIBERATELY STANDING STILL?
   *
   * Only while it is actually flying her — a surrendered autopilot has
   * no say in what her thumbs do, and neither has one that is not
   * engaged.
   */
  private restingHush(): boolean {
    return this.nav?.state === 'resting'
      && this.autopilot.engaged
      && !this.surrendered;
  }

  /**
   * EVERYTHING IN THE WAY OF ONE LEG: whatever the probes put in the
   * list, plus the landmark trees near the line. A method on the
   * instance rather than a closure per order, so the planner is handed
   * the same function every time.
   *
   * Remembers what it showed. A route that bends round nothing visible
   * on the map — the map draws no trees yet — needs the readout to say
   * what it bent for, and a leg reported `dropped > 0` is a leg she may
   * fly through a tree on.
   */
  private readonly hazardsAlong = (from: WorldPoint, to: WorldPoint): readonly Hazard[] => {
    // TREES ARE NOT ROUTED ANY MORE, and the readout is what settled
    // it: `trees 8/338`. The visibility graph is bounded at 160
    // vertices, which affords eight octagons, and a real jungle leg has
    // three hundred trunks across it — so she flew through the other
    // ninety-eight per cent, having never been told. Joshua: "can you
    // not have it scan ahead 10-20 meters and will alter the trajectory
    // left or right basically having its own first person camera view."
    //
    // So they went where TERRAIN has always been in this project: not
    // in the hazard list, dodged reactively every frame instead, which
    // is finer than anything a route could carry. See lookout.ts. This
    // list is back to what it honestly holds — nothing, until TMB has
    // predators or forbidden ground.
    void from;
    void to;
    return this.hazards;
  };

  /**
   * WHAT THE AUTOPILOT IS DOING, as far as the player is concerned.
   *
   * Off unless there is somewhere to go — a chip about a destination
   * she does not have is a chip nobody can act on. STANDBY is the
   * interesting one: the pin is still there and the automatic steering
   * is not, which before the chip existed was a state with no way out
   * and nothing on screen to say so.
   */
  private apState(): ChipState {
    if (this.brain.active === null) return 'off';
    if (this.surrendered) return 'standby';
    // NOT `&& aloft` any more, and that was not a cosmetic clause: the
    // autopilot owns the takeoff now, so the seconds between confirming
    // a destination and leaving the ground are seconds it is flying her
    // — and a chip that stayed dark through the one part of the journey
    // the player has never seen it do would read as nothing having
    // happened at all.
    // RESTING IS ITS OWN WORD, and it has to be: a queen sitting on the
    // ground with a destination and a chip that says FLYING is a chip
    // arguing with the screen.
    if (this.nav?.state === 'resting') return 'resting';
    return this.autopilot.engaged ? 'flying' : 'off';
  }

  /**
   * HOW FAST HER CLOCK MAY RUN BEFORE SHE OUTRUNS THE ISLAND.
   *
   * At full boost she crosses seven metres a second, so ground that
   * used to have minutes to stream now has seconds — and an autopilot
   * that accelerated into terrain the game cannot answer questions
   * about would be flying on a heightfield that is still arriving.
   *
   * So the boost gives way rather than the streamer being asked to win
   * the race: if the tile she is heading into is not resident, the cap
   * comes down and the ramp follows it smoothly, climbing back as
   * coverage catches up. A player should see the speed ease off, never
   * a stutter or a hole in the island.
   */
  private streamingCap(): number {
    if (!this.flight.aloft) return MAX_TRAVEL;
    const drift = groundVelocity(
      this.flight.airspeed, this.flight.heading, this.windOnHer(),
    );
    const speed = Math.hypot(drift.x, drift.z);
    if (speed < 1) return MAX_TRAVEL;
    // Where full boost would put her in a couple of seconds. Asking
    // about the ground she is ON would always say yes and measure
    // nothing; the question is about where she is GOING.
    const ahead = 2 * MAX_TRAVEL;
    const at = this.ant.where;
    return hdReady(at.wx + drift.x * ahead, at.wz + drift.z * ahead)
      ? MAX_TRAVEL
      // Not a stop. Half speed is still five times a walk, and it buys
      // the streamer twice as long to land the tile.
      : MAX_TRAVEL / 2;
  }

  /**
   * ONE FRAME OF THE AUTOPILOT, or null when the player is flying.
   *
   * Returns the demand a thumb would have produced, or nothing at all —
   * and "nothing at all" is the ordinary case, so the manual path below
   * is untouched by this existing.
   *
   * THE ORDER OF THE THREE REFUSALS MATTERS. A real stick input beats
   * everything, because the player is never a passenger. A pin she has
   * not got is next. And a menu is NOT a refusal in multiplayer: an
   * autopilot that stopped flying because someone opened the map is not
   * an autopilot, and the hover only stands in when nothing else is
   * holding the controls.
   */
  private flyMyself(dt: number, floor: number): NavCommand | null {
    // WHAT THE BRAIN SAYS TO SERVE, not what the player pinned.
    //
    // THE BUG JOSHUA'S SCREENSHOT CAUGHT. It read `primaryMission`, and
    // the frame showed `AI approach_water · pri waypoint · det water`:
    // the brain had decided she needed a drink and started a detour,
    // and the autopilot flew straight past it toward the waypoint. The
    // brain's whole job is deciding WHERE SHE NEEDS TO GO, and a
    // survival detour is that decision — an executor that ignores it is
    // an executor that flies a thirsty queen across the island.
    //
    // The MAP still draws `primaryMission`, and must: the gold pin is
    // the player's destination and should not jump to a puddle and back.
    // Two different questions, and this is the one about flying.
    const pin = this.brain.active?.at ?? null;

    // A NEW ORDER IS A NEW CONSENT. Confirming a destination is the
    // player asking to be flown there, so it clears any earlier
    // surrender — and it is one of only two things that do; the other
    // is CONTINUE.
    if (pin !== this.flownTo) {
      this.flownTo = pin;
      this.surrendered = false;
      // Same reason as CONTINUE: a destination confirmed with a thumb
      // still down must not be undone by that same thumb.
      this.handsClear = false;
      if (pin === null) {
        this.autopilot.clear();
        this.route = null;
        this.chain = [];
      } else {
        // ── THE ROUTE ────────────────────────────────────────────
        // A destination is not a leg. The planner turns the one into
        // the other — round what has no top, over what has one — and
        // the autopilot flies them one at a time, which is all it has
        // ever done. With nothing in the way this is a single leg
        // straight there and behaves exactly as it did before the
        // planner existed.
        //
        // PLANNED ONCE, at the order. Re-planning every frame would
        // mean a route that changed under her as she flew it, and a
        // plan that cannot be shown to the player is not a plan.
        //
        // THROUGH THE WHOLE REMAINING CHAIN when this pin is its next
        // stop, and straight there when it is not. The second case is a survival
        // detour: the brain has decided she needs a drink first, and a
        // route to the puddle by way of three waypoints she chose for
        // the trip afterwards would be an autopilot arguing with a
        // thirsty queen. The chain survives it and comes back when the
        // primary does.
        //
        // AND AGAINST THE TREES NEAR EACH LEG, asked per leg rather
        // than handed as a list — see `hazardsAlong` and HazardSource.
        // Timed, because the graph is bounded by a number that was
        // chosen on paper and has to be read on a phone.
        const next = this.chain.length > 0 ? this.chain[0] : null;
        const began = performance.now();
        this.route = pin === next
          ? planChain(
            this.ant.where, this.chain, this.hazardsAlong, AUTOPILOT_DEFAULTS.floorAgl,
          )
          : planRoute(
            this.ant.where, pin, this.hazardsAlong, AUTOPILOT_DEFAULTS.floorAgl,
          );
        this.planMs = performance.now() - began;
        this.legAt = 0;
        const leg = this.route.legs[0];
        this.autopilot.engage(leg.to, leg.floorAgl);
      }
    }

    // SHE IS NOT AIRBORNE YET, and until v0.0.139 that was the end of
    // it: the autopilot commanded nothing on a surface and the player
    // had to fly her off it by hand. Joshua, watching a queen sit on a
    // beach and then on the open sea with a waypoint set: "It never
    // automatically lift and fly from land or water... It's missing a
    // takeoff action to link it together."
    //
    // So the takeoff is the autopilot's now, and what remains here is
    // the one thing that did not change: the run-up, the shove and the
    // climb-out are one continuous input that begins on a surface, and
    // `handsClear` is the memory that keeps a player who takes off by
    // hand from being read as taking the controls away from an
    // autopilot that had not touched them yet.

    // THE PLAYER'S OWN HANDS, read from the RAW controls rather than
    // the gated ones — `handsOff` zeroes those, and reading them would
    // mean opening the map counted as taking over.
    // THE LEVER ONLY COUNTS WHILE IT IS HELD, and this is the bug the
    // first end-to-end flight found. It comes home over a second when
    // released, and a takeoff leaves it at full deflection — so reading
    // its VALUE meant every frame of that second re-declared "the
    // player is flying", and the autopilot could never engage after a
    // takeoff. Which is the only way she gets airborne.
    //
    // The stick is not the same case: it reads its keys and its thumb
    // live, so its value IS a command.
    const lever = this.liftSlider.held ? this.liftSlider.lift : 0;
    const hands = !this.handsOff
      && tookOver(this.rawStick.y, this.rawStick.x, lever, AUTOPILOT_DEFAULTS);

    if (!hands) {
      // At rest. Whatever she is doing now, the NEXT hand on the
      // controls is a fresh one and means what it says.
      this.handsClear = true;
    } else if (this.handsClear) {
      // A FRESH GRAB, and only a fresh grab, takes the aircraft.
      //
      // AND IT STAYS TAKEN once it is taken. Re-engaging the instant the
      // thumb lifted would mean the player could never fly manually
      // while a pin existed without holding the stick for ever. Two
      // things give it back and only two: confirming a destination, and
      // CONTINUE.
      this.surrendered = true;
      this.autopilot.disengage();
    }

    // A HAND ON THE CONTROLS ALWAYS WINS THE FRAME, fresh or not. The
    // climb-out grip is not a surrender, but the autopilot must not
    // fight it either — it simply waits for the controls to come to
    // rest and then flies her.
    if (hands || this.surrendered || pin === null || !this.autopilot.engaged) {
      this.nav = null;
      return null;
    }

    // HER TRACK, FRESH. `heldTrack` is written by the telemetry pass
    // that feeds the HUD, which runs AFTER this — so the held value is
    // last frame's and is used only as the steady fallback `trackOf`
    // wants when she is barely moving.
    const drift = groundVelocity(
      this.flight.airspeed, this.flight.heading, this.windOnHer(),
    );
    this.nav = this.autopilot.update(dt, {
      at: this.ant.where,
      altitude: floor + this.flight.height,
      ground: floor,
      heading: this.flight.heading,
      airspeed: this.flight.airspeed,
      drift,
      track: trackOf(drift, this.heldTrack),
      climbing: this.flight.climbing,
      aloft: this.flight.aloft,
      // WHY SHE IS STILL ON THE WATER, when she is. Both are the
      // scene's facts and neither is the autopilot's to overrule: the
      // launch below refuses on wet wings whatever this file thinks,
      // and the reserve a takeoff costs belongs to `Flight`.
      wingsWet: this.wings.wet,
      launchable: this.flight.canLaunch(this.stamina.fraction),
      // WHAT IS LEFT IN HER, which is a different question from whether
      // the model would let her off the ground. See NavSense.reserve.
      reserve: this.stamina.fraction,
      // AND WHAT THE WATER IS DOING RIGHT NOW. Zero over dry land; over
      // the sea, the tallest crest of the last three seconds plus a
      // metre. The leg's own floor and this one are combined by taking
      // the larger — see NavSense.minimumAgl.
      minimumAgl: this.waves.clearance,
      // The DRAWN floor, the one she would land on — water included,
      // the same surface the flight model is given below.
      terrainAt: (wx, wz) => groundHeight(wx, wz) + (waterSpotAt(wx, wz)?.depth ?? 0),
      // WHAT A BAND SHE IS NOT IN WOULD FEEL LIKE. The scene owns the
      // profile and the sheltering; the autopilot only asks.
      windAt: (agl) => this.windAtAgl(agl),
      // AND WHAT IS STANDING IN FRONT OF HER. The landmark trees, as
      // circles, for the forward march — see lookout.ts. Cheap at this
      // radius: the lattice is 20 m, so a fifteen-metre look is nine
      // cells of pure placement arithmetic.
      trunksNear: (at, reach) => landmarksNear(at, reach).map((t) => ({
        id: t.id, at: t.at, radius: t.trunk,
      })),
    });

    // ── ON TO THE NEXT LEG ───────────────────────────────────────
    // `hold` is the autopilot's own word for "arrived and staying
    // put", and on the last leg that is exactly right — she hovers
    // over the pin. On any earlier one it means a corner has been
    // turned, so hand it the next.
    //
    // `engage` RATHER THAN A NEW ROUTE: the plan is still the plan,
    // and re-planning at every corner would let her arrive somewhere
    // the player was never shown.
    if (this.nav.state === 'hold' && this.route !== null
      && this.legAt < this.route.legs.length - 1) {
      // The CHAIN is not advanced here. The brain owns that: it holds
      // the next stop as its mission and completes it on its own
      // arrival test, and two systems deciding she has arrived is two
      // systems that can disagree about it.
      this.legAt++;
      const leg = this.route.legs[this.legAt];
      this.autopilot.engage(leg.to, leg.floorAgl);
    }
    return this.nav;
  }

  /**
   * WHAT THE TWO MAP SURFACES ARE TOLD, once a frame.
   *
   * `brain.primaryMission` and NOT `intent().target` or
   * `debug().target`: those two follow `detour ?? primary`, so a
   * thirsty queen would watch her destination jump to whatever puddle
   * the autonomy picked and jump back when she had drunk. The pin is
   * the player's, and the player's alone.
   *
   * Her heading goes across RAW. The radians-to-compass conversion
   * belongs to whoever draws, through `bearingFromHeading` — this repo
   * has open-coded it once and it cost 142 degrees.
   */
  private marks(): MapMarks {
    return {
      at: this.ant.where,
      heading: this.ant.bearing,
      primary: this.brain.primaryMission?.at ?? null,
      // Only when it bends. A "route" that is the straight line the
      // dashed reference already draws is two lines saying one thing.
      route: this.route !== null && this.route.legs.length > 1
        ? this.route.legs.map((leg) => leg.to) : null,
    };
  }

  /** Write this run to its slot. Cheap enough to call on a whim. */
  save(): void {
    writeSave(localStorage, this.snapshot(), this.slot, new Date().toISOString());
  }

  /**
   * Put a loaded run back into the world.
   *
   * POSITION IS NOT DONE HERE — the scene is built around a start
   * point, so where she stands came from the save before this object
   * existed. What is left is the state a constructor argument could
   * not carry.
   *
   * Growth is recorded and not restored, and saying so is better than
   * pretending: `LIVE_GROWTH` is a constant today because she does not
   * grow yet. The field is in the save so that the first run of the
   * release that adds growth is not the run that loses it.
   */
  resume(save: SoloSave): void {
    // THE SLOT COMES WITH IT. Continuing a colony is the same run in a
    // later sitting, not a new one beside it.
    this.slot = save.saveId;
    this.savedRegion = save.region;
    this.lived = save.playedSeconds;
    this.elapsed = save.elapsed;
    this.stamina.restore(save.meters.stamina);
    this.thirst.restore(save.meters.thirst);
    this.setWings(save.body.winged);
    // A SAVE FROM BEFORE THE MAP EXISTED HAS NO FOG, and neither does
    // one whose blob did not survive the trip. Both mean the same
    // thing and it is not an error: she starts unexplored and the
    // first reveal of the tick puts the ground she is standing on back
    // on the chart. Losing a map is a smaller thing than refusing a
    // run, which is why this falls back rather than failing.
    this.known = decodeDiscovery(save.discovery) ?? emptyDiscovery();
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Clamp dt so a backgrounded tab does not teleport the ant on return.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.frames[this.frameAt] = dt;
    this.frameAt = (this.frameAt + 1) % this.frames.length;
    this.framesSeen = Math.min(this.framesSeen + 1, this.frames.length);

    // PAUSED: draw the frame, advance nothing.
    //
    // The delta is still READ, and that is the point of taking it
    // before this line — `getDelta` measures from the last call, so
    // skipping it would hand the first resumed frame every second the
    // menu was open. The clamp would cap it at a tenth of a second and
    // she would still lurch.
    if (this.halted) {
      this.renderer.render(this.scene, this.follow.camera);
      return;
    }

    this.elapsed += dt;
    this.lived += dt;

    // AUTOSAVE. Off the SIMULATED clock, so a paused menu is not a
    // save and a slow frame is not a missed one.
    this.sinceSaved += dt;
    if (this.sinceSaved >= IslandScene.AUTOSAVE_EVERY) {
      this.sinceSaved = 0;
      this.save();
    }
    // The air breathes on its own clock, above the ant and beside her.
    this.liveWind.update(
      this.nowWeather?.windMps ?? 0, this.nowWeather?.gustMps ?? 0, dt,
    );
    // BOTH OF THESE ARE READ EVEN WHEN THEY ARE ABOUT TO BE THROWN
    // AWAY. `LookDrag.read` decays its own swing and `MoveStick.read`
    // clears the lift edge and repaints the ring — skipping them
    // banks a frame of input to be applied later, which is exactly
    // the lurch the pause was meant to prevent.
    const look = this.look.read(dt);
    const held = this.stick.read();

    // ── HANDS OFF ────────────────────────────────────────────────
    // Multiplayer with a menu up: the world keeps running and she
    // stops. Not a frozen tick — a neutral pilot. Three substitutions
    // and nothing else, because these are the only three lines player
    // input enters the simulation through.
    //
    // `released` STAYS FALSE. It is a single-frame edge and AutoRun
    // engages on it, so a real lift banked behind an open map would
    // have set her running by herself the moment it closed.
    this.rawStick = held;
    const stick: StickReading = this.handsOff
      ? { x: 0, y: 0, deflection: 0, lane: 'none', released: false }
      : held;
    const lever = this.handsOff ? 0 : this.liftSlider.lift;
    // Her body must not come round to follow a camera drag she is not
    // making. Facing her own bearing is a request to stay put.
    const bodyView = this.handsOff ? this.ant.bearing : -look.yaw;

    // The pace is a ceiling, so changing it moves nothing on its own.
    const asked = this.paceUI.takeRequest();
    if (asked === 'faster') this.pace = fasterPace(this.pace);
    else if (asked === 'slower') this.pace = slowerPace(this.pace);
    else if (asked !== null) this.pace = asked;
    // Asking for a pace MEANS it. Sprint raises the ceiling over
    // whatever is selected, so leaving it on made every pace tap look
    // ignored — she stayed at a sprint until the reserve ran out.
    //
    // It has to suppress a HELD key too, not just the tap toggle, or
    // the rule holds on the phone and not on the desktop. Same
    // mechanism as exhaustion: let go and ask again.
    if (asked !== null) {
      this.sprintOn = false;
      this.reask = true;
    }

    // ── THE WATER, FIRST ──────────────────────────────────────────
    // BEFORE ANYTHING READS IT, so one frame is one state of the pond.
    // This used to run 350 lines below the seat that reads it, which
    // meant her float height was computed against the water as it
    // stood and the sheet was then drawn from the water after its
    // step — she rode one step under the surface she could see. Still
    // water hides it; rain does not.
    //
    // The same rule the sea already follows a few lines from where
    // this used to live: "before anything reads the water, so a frame
    // never spans two different tables." Fresh water was not given it.
    this.water?.update(dt);

    // Auto: armed by dragging past the rim, engaged on release, given
    // up the moment a clear fore/aft push asks for manual control back.
    this.auto.update(stick.lane, stick.released, stick);
    if (this.stick.takeAutoKey()) {
      if (this.auto.active) this.auto.cancel();
      else this.auto.engage();
    }
    // Tapping the chip turns Auto round rather than giving it up —
    // hauling something is walked backwards, and holding reverse across
    // a long drag is exactly the fatigue Auto exists to take away.
    if (this.paceUI.takeAutoFlips() % 2 === 1) this.auto.flip();

    if (this.paceUI.takeSprintTaps() % 2 === 1) this.sprintOn = !this.sprintOn;
    // The hold pill on the flight rail: MSL pins an altitude, the
    // other mode pins her clearance over whatever she would land on
    // (AGL over land, AWL over water — the pill names which).
    if (this.flightHud.takeHoldTaps() % 2 === 1) {
      this.flight.holdMode = this.flight.holdMode === 'msl' ? 'floor' : 'msl';
    }
    const asking = this.sprintOn || this.paceUI.sprintHeld;
    if (!asking) this.reask = false;
    const wants = asking && !this.reask && !this.stamina.spent;

    const travel = resolve({
      stick,
      pace: this.pace,
      sprinting: wants,
      // AND A REST IS A REST. The autopilot's reserve branch asks for
      // nothing at all on the ground, and a latched Auto used to walk
      // straight through that: she spent the whole recovery walking, at
      // the walking rate rather than the resting one — which is half —
      // and set off again barely topped up. Joshua: "at first it said
      // resting to gain stamina but kept walking and never got it to
      // max before taking back off."
      //
      // HUSHED, NOT CANCELLED. The latch is the player's and it is
      // still theirs; it simply does not drive her while the autopilot
      // she asked for is standing still on purpose. One frame's lag on
      // a thirty-second rest, which is nothing.
      auto: this.auto.active && !this.restingHush() ? this.auto.way : 0,
    });

    // WHOSE CLOCK SHE IS ON. Boost only while the autopilot is actually
    // flying her: a player at the controls gets real time, because a
    // world that moved ten times faster under a thumb would be
    // unplayable rather than convenient.
    //
    // AND MANUAL CONTROL DOES NOT WAIT FOR THE RAMP. Asking for the
    // boost to stop begins an ease down; it gates nothing the player
    // does. Their input is authoritative the instant they make it.
    this.travel.capAt(this.streamingCap());
    // `nav` rather than `engaged`: it is non-null only on frames the
    // autopilot actually issued a demand, so a hand on the controls
    // hands her back real time without waiting to be a surrender.
    //
    // ONLY WHILE IT IS TAKING HER SOMEWHERE, and that is the right axis
    // — which took two wrong ones to find. I gated this on `aloft`,
    // then removed the gate on the grounds that her clock should be her
    // clock everywhere, and the device answered both: "upon landing or
    // arriving at a waypoint or gaining stamina, it shouldn't keep x10
    // the default."
    //
    // The boost is for the CROSSING. Arrived, resting, drinking, idle —
    // real time, because none of those are a journey and all of them
    // are things the player might want to watch at the speed they
    // actually happen. `travelling` is the one place that decision
    // lives.
    this.travel.ask(
      this.nav !== null && !this.surrendered && travelling(this.nav.state),
    );
    const plan = this.travel.update(dt);
    // HER CLOCK ADVANCES BY WHAT SHE IS ABOUT TO SPEND. Before the
    // simulation rather than after, so anything reading a deadline this
    // frame reads the same instant her physiology is being stepped to.
    this.herMs += plan.budget * 1000;

    // ── HOW HIGH THE SEA IS STANDING ─────────────────────────────
    // ONCE A FRAME AND ON THE WORLD'S dt, outside the substep loop:
    // the swell is not on her clock, so three seconds means three of
    // the world's — about two full periods. Inside the loop it would
    // sample her boosted time and the window would shrink to a third of
    // a period, which is the one thing that would make it miss the
    // crest it exists to find.
    //
    // THE MEASUREMENT IS THE GAP, and it needs no wave model: the true
    // surface under her against the damped one she flies against. That
    // difference IS the crest, it already carries the shoaling that
    // grows waves toward the beach, and it cannot fall out of step with
    // the ocean because it is read from it.
    const seaHere = waterSpotAt(this.ant.where.wx, this.ant.where.wz);
    this.waves.see(
      seaHere === null ? 0
        : groundHeight(this.ant.where.wx, this.ant.where.wz)
          + seaHere.depth - this.holdFloor,
      dt,
    );

    // ── Air or ground ────────────────────────────────────────────
    // Takeoff is offered on ACTUAL speed, never the selected pace:
    // picking Run and then barely moving must not get her airborne.
    // The lever comes home on its own when nobody is holding it.
    this.liftSlider.update(dt);
    const wantsUp = this.liftSlider.takeTakeoff();
    // WET WINGS REFUSE, and the refusal has to live HERE as well as on
    // the lever's enabled state: afloat the lever is the DIVE control
    // and therefore live, so a shove past the takeoff detent still
    // arrives as a takeoff request and would otherwise fly her off the
    // water she has just landed on.
    if (!this.flight.aloft && wantsUp && !this.wings.wet) {
      // She keeps the way she was running. A takeoff does not turn her.
      //
      // TWO DOORS, because there are two situations. On the ground she
      // has to have run up to TAKEOFF_SPEED. Afloat she never can —
      // paddling caps her at a fraction of her pace — so leaving the
      // WATER is its own move: no run-up, and the burst comes from the
      // wings instead (Flight.launch).
      const paid = this.afloat
        ? this.flight.launch(this.stamina.fraction, this.ant.bearing)
        : this.flight.takeOff(
          this.ant.pace, this.stamina.fraction, this.ant.bearing,
        );
      if (paid > 0) {
        this.stamina.spend(paid);
        // AND SHE LETS GO OF WHATEVER SHE WAS HOLDING. A takeoff off
        // the side of a trunk is the one moment her attitude has to
        // stop being the bark's and start being the wings' — on this
        // frame, not eased over the next second, because the flight
        // model is about to own her body outright.
        this.ant.letGo();
        // AN AIRBORNE QUEEN DOES NOT FLY TAIL-FIRST. Auto astern is for
        // hauling something backwards along the ground; carried into
        // the air it would mean powered reverse flight, which no winged
        // animal does. Turned round rather than cancelled, so a player
        // who locked Auto and took off keeps the thing they asked for.
        if (this.auto.active && this.auto.way === -1) this.auto.flip();
      }
    }

    let winded = false;
    // Whether her BODY is in the sea this frame. False while she
    // flies, whatever is below her — spray does not reach a wing.
    let inSalt = false;
    // NOTHING TO DRINK FROM UP HERE. Cleared before either branch so
    // the act cannot survive a takeoff — she would otherwise drink her
    // way across the island at flying speed.
    this.act = 'none';
    // ── HER OWN CLOCK ────────────────────────────────────────────
    // Under autopilot her simulation runs up to ten seconds for every
    // one the world spends, so a twenty-minute crossing is two minutes
    // of sitting there. ONE time scale rather than eight multipliers:
    // scale her time and the turn rate, the climb, the acceleration,
    // the braking and the wind's displacement all follow for nothing,
    // because every one of them is integrated against this dt. The path
    // through space is identical — the same flight, played faster.
    //
    // AND IT IS SPENT IN BOUNDED STEPS. One dt ten times as long is the
    // same arithmetic and a completely different flight: she would turn
    // in chunky increments, overshoot a band, cross a waterline between
    // samples, blow through a capture. The frame clamp is a tenth of a
    // second, so a bad phone frame times ten would be a ONE SECOND
    // physics leap. `planSteps` refuses that.
    //
    // `dt` IS SHADOWED INSIDE THE LOOP, deliberately and visibly: every
    // line below already integrates against it, so her clock replacing
    // the world's is the whole change. The world outside this loop —
    // the weather, the sea, the water, the day — never sees it.
    for (let leg = 0; leg < plan.steps; leg++) {
      const dt = plan.each;
      if (this.flight.aloft) {
        this.drinkButton.show(false);
        this.headUnder = false;
        // TWO SURFACES, AND THEY ARE NOT THE SAME QUESTION.
        //
        // The PHYSICAL one — this — is the real water standing under her
        // this instant, swell and all. Collision, landing, swimming,
        // the underwater look and the AWL/AGL readouts all use it, and
        // must: they are statements about the world.
        //
        // The HOLD REFERENCE is what the autopilot flies against, and
        // flying against the physical one made her chase every 1.5 s
        // crest — Joshua: "like turbulence or drunken bobbing". So the
        // reference is a damped version of it, slow over the open sea
        // (a swell period must pass through it unnoticed) and quicker
        // inland, where a changing water level is real information and
        // the ripples are small. Her PLACEMENT rides the reference too,
        // or the two would disagree and we would be back to flying
        // underwater (v0.0.83).
        const here = waterSpotAt(this.ant.where.wx, this.ant.where.wz);
        const column = here?.depth ?? 0;
        const ground = groundHeight(this.ant.where.wx, this.ant.where.wz);
        const trueFloor = ground + column;
        // THE WHOLE FLOOR IS DAMPED, not just the water on top of it.
        // An earlier cut smoothed only the column, which left the
        // TERRAIN instantaneous — so "AGL does not chase tiny terrain
        // bumps" was never actually delivered, and over land she still
        // twitched at every pebble. The reference is now the floor
        // itself: sea, stream or sand, one damped surface.
        //
        // Three speeds, because they are three different questions. The
        // open sea's swell must pass through the reference unnoticed;
        // an inland water level that changes is real news; and terrain
        // is news too, but a rock is not, so land sits between them.
        const ease = column <= 0 ? HOLD_EASE_LAND
          : here?.salt === true ? HOLD_EASE_SEA : HOLD_EASE_FRESH;
        this.holdFloor += (trueFloor - this.holdFloor) * (1 - Math.exp(-ease * dt));
        // SAFETY IS NOT SMOOTHED. Nothing real may pass through her: if
        // the true surface — a crest, a rock — comes within
        // SURFACE_MARGIN of where the reference would put her, the
        // reference rises to clear it. That is the controller climbing
        // over a wave, which is what a flyer would do.
        this.holdFloor = Math.max(
          this.holdFloor, trueFloor + SURFACE_MARGIN - this.flight.height,
        );
        // What the placement adds on top of the INSTANTANEOUS terrain to
        // land her on the damped floor. settle() works from groundHeight
        // and this closes the gap.
        const holdBase = this.holdFloor - ground;

        // ── THE OTHER PILOT ──────────────────────────────────────
        // Phase 2. She flies herself to the pin the MissionBrain holds,
        // by holding the same stick a thumb would — the command below is
        // a FlightDemand and nothing else, so `Flight.update` is still
        // the only thing in the game that moves her.
        //
        // ANY REAL INPUT WINS, immediately. The player is never a
        // passenger: a push, a turn or a touch of the lever past the
        // deadzone hands the controls straight back and leaves the
        // destination standing, because taking the stick is not changing
        // your mind about where you were going.
        const nav = this.flyMyself(dt, trueFloor);

        const step = this.flight.update(
          nav ? {
            ...nav.demand,
            // THE AUTOPILOT FLIES AT THE TOP OF THE MODEL, and this
            // used to say the opposite: the pace row was the power
            // setting and an autopilot did not get to raise the ceiling
            // the player chose, any more than Auto does.
            //
            // Joshua overruled that on the first device pass — "I
            // noticed it was traveling way too slow and should set for
            // the fastest speed" — and it took a second bug to notice
            // the rule was still standing, because my own probe forced
            // Run and sprint before every flight and so never once flew
            // at the ceiling a player would actually have left selected.
            // Walk is the default. Walk is half the model's maximum. A
            // queen crossing Kauai at 35 cm/s under a x10 boost is a
            // twelve-minute leg that should have been six.
            //
            // A pace row is a decision about how hard SHE is working
            // when the player is flying her. Handing a machine the
            // controls and asking it to cross an island is a different
            // decision, already made, and it is made in the same breath
            // as choosing the destination.
            //
            // EXCEPT ON AN EMPTY RESERVE, where the pace row comes back
            // — a spent queen is not sprinting anywhere and the survival
            // systems must keep meaning what they say.
            ceiling: this.stamina.spent
              ? AUTO_AIRSPEED[this.pace] : SPRINT_AIRSPEED,
          } : {
            push: stick.y,
            side: stick.x,
            lift: lever,
            // THE LIT PACE ROW IS THE POWER SETTING, in the air as well
            // as on the ground. Auto already flew at it; the stick did
            // not, so the lowest row and the highest were the same
            // flight and the readout sat at 100% either way.
            // FOUR ROWS, FOUR QUARTERS. Sprint is a toggle beside the
            // pace rather than a fourth pace, so the air never read the
            // top cell and a queen at maximum flew at whatever row sat
            // under it. `wants` is sprint asked for AND affordable, which
            // is the same test the ground uses.
            ceiling: wants ? SPRINT_AIRSPEED : AUTO_AIRSPEED[this.pace],
            // AUTO IN THE AIR holds an airspeed for the selected pace, so
            // the thumb is free to steer, look and climb. Lateral input,
            // the camera and both buttons leave it engaged; only a
            // deliberate fore/aft push takes manual control back, which
            // is the same rule it follows on the ground.
            // HANDS OFF IN THE AIR IS A HOVER, and it has to be a hold
            // rather than a neutral. Neutral is a glide that becomes a
            // fall (flight.ts) — leave the phone on a menu and she
            // lands herself somewhere she did not choose, which in
            // multiplayer is a death nobody was at the controls for.
            // HOVER_HOLD is the smallest airspeed that still counts as
            // powered flight, so the level-flight path holds her height
            // while her speed decays to about a centimetre a second.
            // She still drifts on the wind and still pays for the
            // wingbeats, because she is still flying.
            hold: this.handsOff ? HOVER_HOLD
              : this.auto.active
                ? (wants ? SPRINT_AIRSPEED : AUTO_AIRSPEED[this.pace]) : null,
          },
          this.stamina.fraction,
          this.stamina.spent,
          dt,
          // The DRAWN surface under her, the one she would land on — and
          // that is the WATER's surface where there is water. This is
          // what makes a lake solid to land on: descend until the floor
          // arrives, and over water the floor is the film. The biology
          // agrees (docs/FIRE_ANT_BIOLOGY.md — she rides the surface
          // film), and wadeAt takes over the moment she is down.
          //
          // ONE FLOOR, MEASURED ONCE, and handed to BOTH the model and
          // her placement below. They used to disagree: the model flew
          // a clearance over the water while `fly` seated her that
          // clearance over the SEABED, so "one metre up" over nine
          // metres of sea put her nine metres under it, tinted the
          // screen, and made the shore transition anything but seamless.
          this.holdFloor,
        );
        this.effort = step.effort;
        winded = this.stamina.update(step.effort, dt);
        // Flight owns her velocity outright — it already carries her
        // momentum, so handing it through the walk's easing would smear
        // one model over the other.
        this.ant.fly(
          { ahead: step.ahead, across: step.across, speed: Math.hypot(step.ahead, step.across) },
          this.flight.heading, this.flight.roll, this.flight.pitch,
          dt, this.flight.height,
          // The wind reaches her ONLY here. Walking gets nothing.
          this.windOnHer(),
          // …and the SAME floor the model just flew against.
          holdBase,
        );
        // The camera CHASES in flight rather than steering. Her heading
        // is her own up here, so a view left where the player put it
        // would watch her fly out of frame — but snapping it to her nose
        // would take the free look away, which the design is explicit
        // about keeping. So it eases, and only while nobody is dragging.
        if (!look.active) this.look.chase(-this.flight.heading, dt);
        // Landing needs no button: descend until the ground arrives.
        if (this.flight.height <= 0) this.flight.land();
      } else {
        // WHAT THE WATER IS DOING TO HER. The lever is the climb lever
        // in the air and the dive lever in the water — nought at the
        // surface, one on the bottom — and the eased `dive` is what
        // wadeAt scales her float height by.
        //
        // OUT OF AIR THE LEVER STOPS COUNTING: spiracles shut on an
        // empty film, her own buoyancy owns the vertical, and she goes
        // up whatever the player is holding — the old build's rule,
        // kept ("she floats her out when she has none, lever or no
        // lever"). And UP on the lever surfaces her FASTER than the
        // film alone: buoyancy plus swimming for the light.
        const wantDive = this.breath.spent ? 0 : Math.max(0, -lever);
        const ease = wantDive < this.dive
          ? RISE_EASE * (1 + Math.max(0, lever))
          : DIVE_EASE;
        this.dive += (wantDive - this.dive) * (1 - Math.exp(-ease * dt));
        // THE WATER IS ALREADY THIS FRAME'S. It used to be stepped 350
        // lines below this, so the seat was computed against the pond as
        // it stood BEFORE the step and the sheet was then drawn from the
        // pond after it: she rode one water-step under the surface she
        // could see, every frame, for ever. On a still pond that is
        // nothing; in the heavy rain Joshua was flying in, the pond
        // climbs about two units a step and she sits two units under.
        // MEASURED before the move: `wade` was always exactly the
        // PREVIOUS frame's query — 14.04 against 14.43, then 14.43
        // against 16.37, while her seat was correct to the millimetre
        // for the depth she had been given. The seat was never wrong.
        // The two answers were one step apart.
        const wade = wadeAt(this.ant.where.wx, this.ant.where.wz, this.dive, this.afloat);
        this.afloat = wade.afloat;
        this.wet = wade.depth;
        // ON FOOT THE REFERENCE IS SIMPLY WHERE SHE IS. Left to drift
        // while she walked, it would be stale by the time she took off
        // and the first airborne frame would snap her — the damping is
        // for flight, and flight is the only thing that reads it.
        this.holdFloor = groundHeight(this.ant.where.wx, this.ant.where.wz)
          + wade.depth;
        this.swimCarry = wade.carry;
        this.swimAbove = wade.above;
        inSalt = wade.depth > 0 && wade.salt;
        // HER HEAD IS EITHER UNDER OR IT IS NOT — measured as the water
        // standing over where she rides, with a little hysteresis so
        // bobbing at one body length cannot flick her breath on and off.
        const overHer = wade.depth - wade.above;
        this.swimOver = Math.max(0, overHer);
        this.headUnder = overHer > (this.headUnder ? 0.6 : 1.0);

        // ── THE DRONE LIFT ───────────────────────────────────────
        // The other pilot, on the surface. It runs here as well as in
        // the air because it now owns the whole journey: Joshua's
        // report on v0.0.138 was that she never left the ground or the
        // water at all — "It's missing a takeoff action to link it
        // together" — and everything Phase 2 built began one metre up.
        //
        // The floor is where she is standing, water and all. `holdFloor`
        // was set from `wade` three lines ago precisely so it is this
        // frame's and not a stale one carried over from the last time
        // she flew.
        const lift = this.flyMyself(dt, this.holdFloor);
        // WET WINGS STILL REFUSE, and the refusal lives here rather than
        // in the autopilot for the same reason it always did: it is a
        // fact about her body, it applies to the player's lever too, and
        // a second copy of it in the other file would be a second thing
        // to get out of step. The autopilot is TOLD (`wingsWet`) so it
        // can say WAITING ON WINGS rather than sit there mute.
        if (lift?.launch === true && !this.wings.wet) {
          // STRAIGHT UP, at a standstill. Not the water launch's burst
          // at the model's ceiling: she is being lifted to a metre and
          // then asked where she is going, and 70 cm/s of uncommanded
          // forward would throw her downwind of the pin before she was
          // a body length up. See Flight.liftOff.
          const paid = this.flight.liftOff(
            this.stamina.fraction, this.ant.bearing, this.afloat,
          );
          if (paid > 0) {
            this.stamina.spend(paid);
            // An airborne queen does not fly tail-first — the same
            // reason the manual takeoff turns Auto astern round.
            if (this.auto.active && this.auto.way === -1) this.auto.flip();
            // She is flying NOW. The rest of this leg is the ground's
            // arithmetic — paddling, wading, footfall — and none of it
            // is true of her any more; the next substep takes the air
            // branch and picks her up a centimetre off the sand.
            continue;
          }
        }

        // Only charge her for a sprint she is actually getting: calling
        // for one while stopped or reversing costs nothing. Afloat the
        // water prices the frame instead (swimEffort): paddling costs,
        // the sea costs half again more, and pushing down costs like a
        // sprint — wading stays on the ground ladder, because wading is
        // walking.
        // DRINKING IS AN ACT, and an act can be interrupted. The button
        // is on the pad only where there is fresh water within reach,
        // and she is drinking only while it is HELD — let go, walk off,
        // or take off, and it ends.
        const reachable = canDrink(this.ant.where.wx, this.ant.where.wz);
        this.drinkButton.show(reachable);
        // SHE DRINKS FOR HERSELF WHEN SHE FLEW HERE TO DRINK.
        //
        // The brain decides she is thirsty, plans a detour to water and
        // the autopilot flies her to it — and then, until now, the whole
        // errand stopped one tap short of the point of it. Joshua, with
        // a queen standing in a stream at 0% water: "it also needs to
        // self drink or prompt the user to press and hold to drink."
        //
        // Self-drink, and the reason to choose that over a prompt is
        // that a prompt is a fifth thing to do while she is already
        // being flown by a machine. The conditions are narrow: it has to
        // be the BRAIN's own errand (`goal === 'drink'`), she has to be
        // standing at water she can reach, and the autopilot has to
        // still have the controls. A player flying by hand still holds
        // the button — nothing about their queen changed.
        const errand = this.brain.goal === 'drink'
          && this.autopilot.engaged && !this.surrendered;
        this.act = reachable && (this.drinkButton.held || errand)
          ? 'drinking' : 'none';
        const sprinting = wants && travel.speed > PACE_SPEED[this.pace] + 1e-3;
        const resting = this.ant.pace < 0.05;
        this.effort = swimEffort(wade.afloat, wade.salt, travel.speed > 0.05, wantDive)
          ?? (sprinting ? SPRINT_DRAIN
            : resting ? RESTING_RECOVERY : MOVING_RECOVERY);
        winded = this.stamina.update(this.effort, dt);
        // Depth gates her drive — wading drags, paddling crawls — and
        // the current is a push she does not control. Both reach
        // PlayerAnt through the hooks that survived v0.0.57 exactly so
        // this could come back.
        // Drinking holds her still, which is what makes it a decision
        // rather than something she does in passing — and the current is
        // let go of with her drive, or the stream would carry a drinking
        // queen downhill while she stood there.
        const hold = this.act === 'drinking' ? 0 : wade.pace;
        this.ant.update(
          {
            ahead: travel.ahead * hold,
            across: travel.across * hold,
            speed: travel.speed * hold,
          },
          bodyView, dt, wade.above,
          this.act === 'drinking' ? null : wade.carry,
        );
      }
    }

    // ── WHAT SHE HAS SEEN ────────────────────────────────────────
    // Two kilometres around her, and it stays revealed. Recomputed on
    // DISTANCE rather than on frames: the disc is 2 km across and half
    // a mask cell is 73 m, so re-stamping it every frame would be the
    // same 700-odd cells re-tested sixty times a second to discover
    // nothing. At a sprint she covers half a cell about every four
    // seconds.
    const her = this.ant.where;
    if (this.revealedAt === null
      || Math.hypot(her.wx - this.revealedAt.wx, her.wz - this.revealedAt.wz) >= REVEAL_STEP) {
      this.revealedAt = her;
      // GROUND SHE HAS NEVER SEEN IS WORTH SAVING FOR. The autosave is
      // a minute of SIMULATED time apart, and a minute of flying is
      // four kilometres of new coast — losing that to a closed tab
      // would be the map forgetting the one thing it is for. So new
      // cells bring the next save forward rather than waiting out the
      // clock, throttled by DISCOVERY_SAVE so a long flight is not a
      // write per second.
      if (reveal(this.known, her.wx, her.wz) > 0) {
        this.sinceSaved = Math.max(
          this.sinceSaved, IslandScene.AUTOSAVE_EVERY - IslandScene.DISCOVERY_SAVE,
        );
      }
    }

    // ── WHAT SHE IS DOING ────────────────────────────────────────
    // HERE, and not earlier: both branches above have run, so every
    // number this reads is THIS frame's rather than last frame's. It
    // is derived rather than assigned (motion.ts), so it cannot
    // disagree with the physics it is read from — which is the whole
    // point of it, and the bug it exists because of.
    //
    // THE ORDERING RULE, and it cost a bug to find during Stage G's
    // own sweep: NOTHING ABOVE THIS LINE MAY READ `this.motion`. The
    // takeoff a hundred lines up can set `aloft` mid-frame, so the
    // branch that follows it has to ask the LIVE flight model which
    // world she is in; a state derived at the end of the previous
    // frame would still have said 'swimming' and run the water branch
    // on the frame she left the water. Producers read physics,
    // consumers read the state, and this is the line between them.
    this.motion = motionOf({
      aloft: this.flight.aloft,
      afloat: this.afloat,
      under: this.headUnder,
      depth: this.wet,
      speed: this.ant.pace,
    });

    // Exhaustion drops her to the sustainable pace, never to a halt —
    // and the next sprint has to be asked for deliberately.
    if (winded) {
      this.sprintOn = false;
      this.reask = true;
    }

    // THE SAME INSTRUMENTS FLY AND SWIM. readFlight still runs every
    // frame (its easings and touchdown bookkeeping belong to flight);
    // afloat, the panel is fed water telemetry instead — her speed
    // THROUGH the water where airspeed goes, the current where the
    // wind goes, height over the BED on the tape — and the whole HUD
    // lights up exactly as it does in the air. Joshua: "show water
    // speed + underwater speed and movement like in the air with same
    // hud."
    const swimming = afloatIn(this.motion);
    const flightTelemetry = this.readFlight(dt);
    if (!swimming) {
      this.lastSwimAlt = null;
      this.swimVs = 0;
    }
    const telemetry = swimming ? this.readSwim(dt) : flightTelemetry;
    const hudUp = instrumented(this.motion);
    this.lastFlight = telemetry;
    this.paceUI.show(
      this.pace, wants, this.stamina.spent,
      // Over the GROUND. On foot that is her pace; in the air it is the
      // vector sum with the wind, which is a different number and the
      // one the second line exists to contrast with.
      this.motion === 'flying'
        ? Math.hypot(telemetry.ground.x, telemetry.ground.z) : this.ant.pace,
      this.auto.active, this.auto.way,
      this.motion === 'flying' ? telemetry.airspeed : null,
    );
    this.flightHud.show(
      telemetry, hudUp, this.seeFlight(telemetry),
      this.motion === 'flying' ? this.flight.holdMode : null,
    );
    // The RATE goes with the reserve, so the readout can say how long
    // what she is doing right now can go on rather than how much
    // sprinting the bar would be worth.
    // WINGS BEAT WHEN SHE IS FLYING THEM. A glide is not a beat — she
    // is holding them out, not working them — and neither is standing
    // on the ground with them folded.
    this.queen?.beat(
      dt,
      this.motion === 'flying' && this.flight.where !== 'glide',
    );
    // THE CAMERA, not her body. Asked of the camera itself rather than
    // of the look controller, so there is no second convention to keep
    // in step: whatever is actually being rendered from is what the
    // compass reports.
    // BEFORE THE COMPASS COMPOSES ITS LINES, or both instruments show
    // the previous frame's answer — confusing on a 5 Hz brain, where a
    // frame of lag reads as the decision itself being late.
    this.readWater(dt);
    this.thinkAutonomy(dt);
    // WHERE SHE IS AND WHERE SHE SAID SHE WAS GOING. Both surfaces
    // decide for themselves whether anything is worth repainting —
    // the minimap on `worthRedrawing`, the map screen on being open at
    // all — so this is a cheap call on a still frame and it is the
    // only place either of them is driven from.
    this.apChip.show(this.apState(), this.travel.scale);
    const marks = this.marks();
    this.minimap.update(marks, this.known);
    if (this.mapScreen.isOpen) this.mapScreen.update(marks, this.known);
    const view = new THREE.Vector3();
    this.follow.camera.getWorldDirection(view);
    this.compass.update(
      bearingOf(view.x, view.z), this.ant.where, this.markers, dt,
      {
        fps: settings().showFps ? this.frameRate() : null,
        fix: settings().showFix
          ? { msl: this.mslNow(), pitch: pitchOf(view.y), relief: reliefScale() }
          : null,
        // The master LOD's state rides the same developer toggle as
        // the fix — one switch, one register, one screenshot.
        lod: settings().showFix ? lodLine() : null,
        water: settings().showFix ? this.waterLine : null,
        ai: settings().showFix ? this.aiLine() : null,
        nav: settings().showFix ? this.navWords() : null,
        // HER NOSE, not the camera's. In flight they part company the
        // moment she looks around, and the pairing with the flight
        // panel's ground line only means anything if this one is hers.
        // Swimming keeps the rows: speed through the water where AIR
        // goes, drift over the island where GND goes, the current
        // where the wind goes.
        air: hudUp
          ? {
            heading: telemetry.heading,
            speed: telemetry.airspeed,
            label: swimming ? 'SWIM' : undefined,
            // HER CLOCK, so the row can say what the world sees her do.
            // Her airspeed does not move under boost — that is the
            // whole reason it was invisible.
            travel: this.travel.scale,
          }
          : null,
        ground: hudUp
          ? {
            track: telemetry.track,
            speed: telemetry.groundSpeed,
            drift: telemetry.drift,
            travel: this.travel.scale,
          }
          : null,
        // Only when there is a wind to speak of. The readout resolves
        // to a tenth of a centimetre a second; below that there is
        // nothing to say and a permanent "0.0" is a row nobody reads.
        wind: hudUp && telemetry.wind.speed >= 0.05
          ? {
            speed: telemetry.wind.speed,
            relative: telemetry.wind.bearing - telemetry.heading,
            label: swimming ? 'CUR' : undefined,
            // The same clock as the two speeds above it. The WARNING
            // below is deliberately NOT scaled: a headwind she cannot
            // out-fly is a fact about the air and her wings, and it is
            // true at any playback speed.
            travel: this.travel.scale,
            call: windCall(
              telemetry.wind.speed,
              Math.cos(
                ((telemetry.wind.bearing - telemetry.heading) * Math.PI) / 180,
              ) * telemetry.wind.speed,
            ) ?? '',
          }
          : null,
      },
    );
    // HER HEAD IS EITHER UNDER OR IT IS NOT, and that is the only
    // question this meter asks. Ticked here rather than inside the
    // THE RESERVE MOVES AGAIN, both ways. CLAUDE.md's survival rule is
    // that a bar may only move if there is a way to move it back; it
    // was held full and still for the versions when there was nothing
    // on the island to drink from. There is now, and the refill lands
    // in the same change as the drain rather than a build later.
    // HER AIR, HER BLOOD AND THE SEA'S CLOCK, all on simulation time.
    // The breath reads the head-under signal the wade computed; the
    // brine reads "body in the sea" and answers in damage ticks, each
    // worth one percent of her MAXIMUM — the toll is fixed, so it can
    // actually kill — and every tick goes through hurt(), the same
    // door every future predator will use. Out of the sea she knits,
    // on the caste table's own healthRecovery: the way back that lets
    // the bar move at all.
    // HER PHYSIOLOGY IS ON HER CLOCK TOO, and this is what stops the
    // boost being a cheat. A journey that would have cost twenty
    // minutes of water still costs twenty minutes of water even though
    // the player watched two. Without it, autopilot would quietly hand
    // her ten times the biological range and every survival detour
    // built in Phase 1 would stop meaning anything.
    //
    // Stamina needs no line here: it is spent inside the loop above,
    // against the same shadowed dt, so it was already on her clock.
    this.thirst.update(plan.budget, this.act === 'drinking');
    this.breath.update(this.motion === 'diving', plan.budget);
    const stings = this.brine.update(inSalt, dt);
    if (stings > 0) {
      this.hurt(stings * liveStat('maxHealth') * SALT_DAMAGE_FRACTION, 'saltwater');
    }
    // DROWNING, at last — but only while something genuinely keeps her
    // under with nothing left, because an empty film has already taken
    // the lever away and buoyancy is already carrying her up. A steady
    // rate rather than ticks: suffocation is continuous. ON TOP of any
    // salt, as asked.
    if (this.breath.spent && this.motion === 'diving') {
      this.hurt(DROWN_HP_PER_SECOND * dt, 'drowning');
    }
    // She cannot knit while the sea has her or while she is drowning —
    // the queen's recovery rate happens to match the drowning rate
    // exactly, and healing through suffocation would cancel it to a
    // polite stalemate.
    if (!inSalt && !this.breath.spent && !this.dying && this.hp > 0) {
      this.hp = Math.min(liveStat('maxHealth'), this.hp + liveStat('healthRecovery') * dt);
    }
    // The hypoxia veil follows the air, not the water: it starts at
    // FADE_FROM and never quite reaches black — she can always still
    // barely see the way up.
    const veil = blackout(this.breath.fraction).toFixed(3);
    if (veil !== this.shownDim) {
      this.shownDim = veil;
      this.dim.style.opacity = veil;
    }
    this.vitals.aloft(this.motion === 'flying');
    this.vitals.show(this.stamina.fraction, this.stamina.spent, this.effort);
    this.vitals.air(this.breath.fraction, this.motion === 'diving');
    this.vitals.showHealth(this.hp / liveStat('maxHealth'), this.hp, this.brine.burning);
    this.vitals.saltStatus(this.brine.burning ? 'burning' : inSalt ? 'in' : 'none');
    this.vitals.thirst(
      this.thirst.fraction, this.thirst.parched, this.act === 'drinking',
      this.thirst.drain,
    );

    // NOTHING TO TICK. The grace is a deadline, so the only question
    // each frame is what time it is — which is why backgrounding the
    // tab or losing the page can no longer buy extra protection.
    if (this.grace.takeExpiry()) this.noticeLeft = PROTECTION_NOTICE;
    // THE AUTONOMY'S ONE LINE, on the same countdown as the grace chip.
    // The brain hands each message over exactly once, so nothing here
    // has to guard against it repeating.
    if (this.brainSaidLeft > 0) {
      this.brainSaidLeft = Math.max(0, this.brainSaidLeft - dt);
      this.vitals.showNotice(this.brainSaidLeft > 0 ? this.brainSaid : null);
    }
    if (this.noticeLeft > 0) {
      this.noticeLeft = Math.max(0, this.noticeLeft - dt);
      this.vitals.showGraceEnded();
    } else {
      this.vitals.showGrace(this.grace.active ? this.grace.seconds : null);
    }

    // The lever says what it DOES right now: a takeoff on the ground,
    // climb and descent in the air, and how deep she swims on the
    // water. leverFor() owns that choice and carries the reason the
    // third case had to be added.
    // The wings dry wherever she is NOT under the surface — on land,
    // and afloat, where she rides the film with her wings out of the
    // water (wings.ts). Rain stretches the clock rather than stopping
    // it. The weather is last frame's, which is what every other
    // consumer of nowWeather reads and is well inside a 30 s count.
    // WATER ON THE WINGS is now just a reading of the state. Afloat is
    // the test rather than any depth — wading is a film round her feet
    // and her wings are a body up — and `flying` answers false, which
    // is what makes the NEXT touchdown an edge rather than more of the
    // same. That used to be a tenth flag kept in step by hand.
    // Her clock again: wings dry over her flight, not over the
    // player's wait.
    this.wings.update(
      plan.budget, afloatIn(this.motion), this.motion === 'diving',
      this.nowWeather?.rainfall ?? 0,
    );
    this.liftSlider.enable(leverFor(
      this.motion === 'flying',
      afloatIn(this.motion),
      !this.wings.wet
        && this.flight.canTakeOff(this.ant.pace, this.stamina.fraction),
      !this.wings.wet && this.flight.canLaunch(this.stamina.fraction),
    ));
    this.liftSlider.drying(
      this.motion === 'flying' ? null : this.wings.seconds,
    );

    // ── The world moves under her ─────────────────────────────────
    // She has just travelled, so this is the moment to decide whether
    // the scene needs shifting and which ground should exist.
    const at = this.ant.where;
    const shift = rebaseFor(at.wx, at.wz);
    if (shift) {
      // Everything already placed moves by exactly the delta. The
      // camera included: it lives in rendered space, and leaving it
      // behind would read as the world lurching sideways.
      this.ant.reground();
      this.follow.camera.position.x -= shift.x;
      this.follow.camera.position.z -= shift.z;
      // The sea is a function of WORLD position, so a rebase does not
      // move it — it refolds the phase that keeps it where it is. See
      // Ocean.reorigin, and the test that proves a rebase leaves the
      // water alone.
      // The ground texture tiles off world position, not rendered
      // position, or it slides sideways on every shift.
      const now = originAt();
      setTextureOrigin(now.x, now.z);
      this.terrain.place();
      this.water?.place();
      this.ocean?.place();
      this.landmarks.place();
    }
    // What is DRAWN follows her by lattice cell, so that half is free
    // until she crosses one; what is SOLID re-centres every few metres
    // because it reaches less far than the cell is wide. See
    // LandmarkStand.follow.
    this.landmarks.follow(at);
    // THE GROUND'S DETAIL FOLLOWS HER UP.
    //
    // The fade is measured in TEXELS PER PIXEL, which is the honest
    // unit for "is there any pattern left to see" — but it means the
    // reach is fixed in metres while her eye is not. Standing on the
    // sand a pixel covers a few texels and the grain is crisp; a metre
    // up the same pixel covers a hundred and the ground is a wash, and
    // at three and a half metres it is the same wash, which is Joshua's
    // "1 m vs 3.5 m off the ground looked the same even with details at
    // 200%". The dial could not fix it because the dial is a multiple
    // of a ground-level baseline.
    //
    // So the reach RISES WITH HER, over the ten metres of AGL/AWL she
    // asked for, and stops there: past ten metres the ground genuinely
    // is far away and a fade is the truth rather than a compromise.
    // The camera's grazing angle — the thing that streaks when the fade
    // is pushed too far at ground level — is exactly what altitude
    // takes away, so the range that smears underfoot is safe from up
    // here. On the ground the dial behaves precisely as before.
    // THE DETAIL REGION IS A RADIUS AROUND HER, in metres, and it is
    // the slider's whole meaning: 100% is ten metres of detailed
    // ground in every direction, at one metre up or at five. An
    // earlier cut let ALTITUDE scale the reach, which quietly
    // redefined what the player had asked for; height has no vote
    // here now. Her RENDERED position, because the shader compares it
    // against rendered fragment positions.
    // THE MASTER ANCHOR, in world coordinates and all three axes —
    // wy is her rendered y unchanged, because the origin rebases in
    // x and z only. lod.ts is where every distance-graded system asks
    // "how far is this from her" from now on.
    setAnchor(at.wx, this.ant.root.position.y, at.wz, dt);
    // …and its shader-side copy, in RENDERED coordinates, in the same
    // breath: her position, the radius, and any debug force. Every
    // wearer of the sphere — the ground, the sea's foam — binds these
    // very objects (lodShader.ts), so one assignment moves them all.
    syncLodUniforms(this.ant.root.position);

    // THE FINE GROUND FOLLOWS HER TOO. Fire-and-forget: a tile that has
    // not landed is answered by the coarse grid, which holds the same
    // number at every sample the two share, so the ground sharpens
    // rather than moves when one arrives.
    followHd(at.wx, at.wz);
    this.terrain.follow(at);
    // THE WATER FOLLOWS HER TOO, and is seated in the same breath as
    // the terrain — a window left against the old origin would draw
    // the river a rebase-width away from its own valley.
    // The window still FOLLOWS here, where the terrain is seated: this
    // is about where the sheet lives, not what it holds.
    this.water?.follow(at);
    this.ocean?.follow(at);
    this.ocean?.update(dt);
    // AFTER the ocean's own tick, because a rebuild here replaces the
    // very object that was just updated — and before anything reads
    // the water, so a frame never spans two different tables.
    this.stepSea();
    // The sky feeds the streams. Set after the weather is read below?
    // No — read from the LAST frame's reading deliberately: asking for
    // it here would reorder the weather update around the water for one
    // frame's worth of rain, which is not worth a special case.

    // WEATHER IS ASKED IN GLOBAL COORDINATES and drawn in local ones.
    // Her position decides what the sky is doing; the CAMERA's rendered
    // position decides where the drops go. Handing the second of those
    // to the field would make a shower follow the floating origin
    // around, which is exactly the confusion the typed coordinates
    // exist to prevent.
    const service = weather();
    const sky = service.update(at, dt);
    this.nowWeather = sky;
    this.water?.setWeather(sky.precipitation);
    this.applyWeather(sky);
    this.rain.update(this.follow.camera.position, sky, dt);
    // The sea takes the camera's RENDERED position, which is the one
    // thing about it that is allowed to be local: the grid is recentred
    // on the eye, while every wave on it is a function of where the
    // island is. See Ocean.
    const reading = service.reading;
    if (reading) {
      this.weatherChip.update(
        reading, service.source, service.field.ageSeconds(Date.now()),
        // Her heading only matters aloft: the headwind warning is about
        // whether she can make progress the way she is pointed.
        this.motion === 'flying' ? this.flight.heading : null,
      );
    }

    // Read AFTER she has moved: this is what she is actually doing,
    // which the easing makes different from what was asked for.
    this.speed = this.ant.pace;
    // CALM while the SEA is moving her: the camera damps her bob so the
    // horizon stays put. Flying, it answers at once.
    // CALM while the SEA is moving her; the DIVE lever tells the
    // camera when it may stop holding itself above the water.
    // WHICH WAY IS UP FOR HER, before the boom is placed. On the ground
    // this is the world's up and the camera is unchanged; on a trunk it
    // is the bark's, and the boom lifts off the surface she is on
    // rather than into the sky. See camera/FollowCamera.standOn.
    this.follow.standOn(this.ant.up, this.ant.pointing);
    this.follow.update(
      this.ant.root, look, dt,
      afloatIn(this.motion),
      this.motion === 'flying' ? 0 : this.dive,
    );
    // AFTER THE WEATHER, because it takes its fraction of the fog and
    // lights applyWeather has just written — and AFTER THE CAMERA, for
    // a reason Joshua photographed.
    //
    // This ran before follow.update, so it asked "is the lens under
    // the water" about LAST frame's lens against THIS frame's sea. The
    // clamp below the camera guarantees the rendered position is above
    // the surface; the tint was reading a position the camera had
    // already left. On a swell that is precisely the frame where the
    // two disagree — a crest arrives, the stale position is inside it,
    // and the whole screen goes green for a frame on a queen who never
    // went under. Same reason the pane is seated here (see below):
    // anything that reads the camera's pose has to run after the pose
    // is final.
    this.camUnder = this.underwater.update(
      this.sun, this.skyLight, dt,
      // INTENT, NOT MEASUREMENT: a crest washing over a floating
      // queen must not read as a dive, and a real dive must not wait.
      // So this stays the LEVER rather than becoming motion 'diving',
      // which is the measured signal breath.ts is fed. Two different
      // questions that agree most of the time — collapsing them here
      // would undo the fix this comment was written for.
      this.motion !== 'flying' && this.dive > 0.15,
    );
    // AFTER THE WEATHER AND AFTER THE CAMERA, and it needs both.
    //
    // After the weather because applyWeather stamps the fog colour and
    // density, the background, the sun and the skylight from the
    // current sky on every single frame, so an underwater look written
    // before it is overwritten before anyone sees it. That is also why
    // there is no restore when she surfaces, which otherwise reads as a
    // missing branch: the next applyWeather IS the restore.
    //
    // After the camera because the near pane is a screen-filling quad
    // seated on the camera's pose, and it is sized with barely over a
    // degree of angular slack. Seated one line earlier — before
    // follow.update writes the position and re-aims the lookAt — it
    // would be placed for the pose of the PREVIOUS frame, and a turn of
    // more than about a degree in a frame would swing its edge inside
    // the frustum. Since it draws with depthTest off over the whole
    // image, that edge is a hard straight seam with the water tint
    // simply missing on one side of it. A key-held turn is 1.43 degrees
    // a frame at sixty, so this would have shown every time she looked
    // around underwater rather than in some corner case.
    this.renderer.render(this.scene, this.follow.camera);

    // A frame has now been drawn with whatever had arrived by the time
    // it started. That is the one the loading screen was waiting for.
    if (!this.shown && this.showFirstFrame) {
      this.shown = true;
      const drawn = this.showFirstFrame;
      this.showFirstFrame = null;
      drawn();
    }
  };

  private readonly onResize = (): void => {
    const { clientWidth, clientHeight } = this.host;
    // Mid-rotation the host can measure zero. Resizing to that leaves a
    // collapsed canvas that never recovers, so wait for a real box.
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.follow.resize(clientWidth / clientHeight);

    // Draw again right now. Resizing the canvas clears it, and the next
    // scheduled frame does not land until after the browser has already
    // painted — which shows as a flash of stretched or blank canvas at
    // the moment the device turns.
    //
    // The underwater pane has to be re-seated first. It is cut to the
    // frustum, the frustum's aspect has just changed, and this path
    // renders without going through tick() at all — so without this the
    // one frame the device turn is there to rescue would draw the pane
    // at the old shape, with its edge inside the new view. Turning a
    // phone while she is under water is exactly when that happens.
    if (!this.disposed) {
        this.renderer.render(this.scene, this.follow.camera);
    }
  };

  /**
   * SHOOT A RAY AND SAY WHAT IT WOULD ACTUALLY SEE.
   *
   * A hole in the ground is not something a screenshot can diagnose:
   * you can see that there is sky where ground should be, but not WHICH
   * tier failed to cover it or how far away the failure is. This casts
   * a ray the way the camera looks and reports every tier's geometry it
   * crosses, each marked with whether the fragment shader would have
   * kept it — the near cut is a discard, so a tier's geometry reaches
   * places the tier does not draw.
   *
   * A direction is a HOLE when nothing survives the cuts, or when the
   * nearest thing that does is the sea.
   *
   * @param pitchDeg degrees BELOW where the camera is pointing.
   * @param yawDeg degrees right of where the camera is pointing.
   */
  private sightLine(pitchDeg: number, yawDeg = 0): unknown {
    const camera = this.follow.camera;
    const way = new THREE.Vector3();
    camera.getWorldDirection(way);
    way.applyAxisAngle(new THREE.Vector3(0, 1, 0), (-yawDeg * Math.PI) / 180);
    const right = new THREE.Vector3().crossVectors(way, new THREE.Vector3(0, 1, 0))
      .normalize();
    // MINUS: rotating about `right` by a positive angle tips the nose
    // UP, and a sweep that thinks it is looking at the ground while it
    // is looking at the sky reports the sky as a hole in the ground.
    way.applyAxisAngle(right, (-pitchDeg * Math.PI) / 180).normalize();
    return this.alongRay(camera.position.clone(), way, { pitch: pitchDeg, yaw: yawDeg });
  }

  /**
   * The same question, asked through a SCREEN PIXEL.
   *
   * Which is the honest way to ask it: the complaint is about something
   * visible at a place on the screen, so the ray that matters is the
   * one the camera actually cast through that pixel — not an angle
   * guessed to be nearby.
   *
   * @param u 0..1 across the canvas, @param v 0..1 down it.
   */
  private sightThroughPixel(u: number, v: number): unknown {
    const camera = this.follow.camera;
    const way = new THREE.Vector3(u * 2 - 1, -(v * 2 - 1), 0.5)
      .unproject(camera)
      .sub(camera.position)
      .normalize();
    return this.alongRay(camera.position.clone(), way, { u, v });
  }

  private alongRay(
    from: THREE.Vector3, way: THREE.Vector3, about: Record<string, number>,
  ): unknown {
    const caster = new THREE.Raycaster(from, way, 0.1, ISLAND_SPAN);
    const { cells, transition, middle, backdrop } = this.terrain.tiers;
    const look = (
      targets: THREE.Object3D[], tier: string, cut: number,
    ) => caster.intersectObjects(targets, false).map((hit) => {
      const there = toWorld(local(hit.point.x, hit.point.z));
      // The shader's own test, repeated exactly: a SQUARE measured from
      // the camera, because the tier inside is a square window.
      const square = Math.max(
        Math.abs(hit.point.x - from.x), Math.abs(hit.point.z - from.z),
      );
      return {
        tier,
        distance: hit.distance,
        square,
        drawn: cut <= 0 || square >= cut,
        /**
         * What the heightfield says is HERE — the one authority.
         *
         * Needed because a coarse tier bridges water. The backdrop has
         * a vertex every 437 metres, so at Hanalei it draws land clean
         * across the mouth of the bay; the finer tier, which knows
         * better, draws the bay. Discarding the backdrop there and
         * showing water is the tiers working, not failing, and without
         * this the probe cries wolf at every bay on the island.
         */
        truth: groundHeight(there.wx, there.wz),
      };
    });

    const hits = [
      ...look(cells, 'cells', 0),
      ...look([transition], 'transition', TIER_CUTS.transition),
      ...look([middle], 'middle', TIER_CUTS.middle),
      ...look([backdrop], 'backdrop', TIER_CUTS.backdrop),
    ].sort((a, b) => a.distance - b.distance);

    const seen = hits.find((hit) => hit.drawn) ?? null;
    // The nearest surface that WAS there and was thrown away. A tier
    // cut is a promise that something finer is covering this ground; a
    // discarded surface in front of everything else is that promise
    // being broken.
    const dropped = hits.find((hit) => !hit.drawn && hit.tier !== 'sea') ?? null;
    const uncovered = dropped !== null
      && (seen === null || dropped.distance < seen.distance);

    return {
      ...about,
      seen,
      dropped,
      /**
       * SKY OR WATER THROUGH LAND — the thing being tested for.
       *
       * Not merely "no ground here": above the horizon there is
       * correctly no ground, and past a real coastline the sea is
       * correctly the sea. It is a hole only when ground WAS there,
       * was discarded in favour of a finer tier, and no finer tier
       * turned up to cover it.
       */
      // Sea in front of land is only a fault where there should BE
      // land. Ask the heightfield rather than the picture.
      hole: uncovered
        && (seen === null
          || (seen.tier === 'sea' && (seen as { truth: number }).truth > 0)),
      /**
       * Ground still visible, but a long way behind where the
       * discarded surface was.
       *
       * The tolerance is not decoration. Tiers overlap ON PURPOSE, so
       * in the overlap band the outer tier is routinely a couple of
       * units above the inner one and every ray "passes through" it
       * before hitting the ground that covers it. Counting those made
       * 89% of a flying sweep look like a defect when nothing was
       * wrong. What matters is whether the replacement ground is where
       * the discarded ground WAS — a metre out is a seam nobody can
       * see, a hundred is a step.
       */
      gap: uncovered && seen !== null && seen.tier !== 'sea'
        && seen.distance - (dropped as { distance: number }).distance > GAP_TOLERANCE,
      /** How far behind the discarded surface the replacement is. */
      behind: uncovered && seen !== null
        ? seen.distance - (dropped as { distance: number }).distance
        : 0,
      hits,
    };
  }

  /**
   * How high each tier DRAWS the ground at one global point.
   *
   * Straight down from far above, against one tier at a time. The tiers
   * describe the same island at different resolutions, so where they
   * disagree vertically is where a sight line can pass between them —
   * and a number is a great deal easier to argue with than a
   * screenshot.
   */
  private tierHeights(wx: number, wz: number): unknown {
    const seat = toLocal(world(wx, wz));
    const from = new THREE.Vector3(seat.lx, ISLAND_SPAN, seat.lz);
    const down = new THREE.Vector3(0, -1, 0);
    const caster = new THREE.Raycaster(from, down, 0.1, ISLAND_SPAN * 2);
    const { cells, transition, middle, backdrop } = this.terrain.tiers;
    const top = (targets: THREE.Object3D[]) => {
      const hit = caster.intersectObjects(targets, false)[0];
      return hit ? hit.point.y : null;
    };
    return {
      // What she would WALK on. `groundHeight` already carries the
      // relief dial — multiplying by it again here was a bug in this
      // diagnostic that made every tier look 33% too low.
      truth: groundHeight(wx, wz),
      cells: top(cells),
      transition: top([transition]),
      middle: top([middle]),
      backdrop: top([backdrop]),
    };
  }

  /**
   * The wind as it actually reaches her, world units per second.
   *
   * The full measured vector, scaled by the influence dial. At the
   * default of 1 this is simply the real wind — see settings for why
   * the dial exists at all, which is that the real wind on this island
   * is several times what she can fly against.
   */
  /**
   * THE TELEMETRY, SEEN THROUGH THIS CAMERA.
   *
   * The one place flight numbers become screen pixels, and the one
   * place the floating origin matters to them. Everything the
   * prediction computed is in the island's real million-unit
   * coordinates; every one of them is converted to a LOCAL position
   * before it goes anywhere near a projection matrix. Rebuilding big
   * global numbers inside a float32 pipeline is what tore the ground
   * texture apart, and a marker would fare no better.
   */
  private seeFlight(now: FlightTelemetry): FlightView {
    const camera = this.follow.camera;
    const wide = this.renderer.domElement.clientWidth;
    const tall = this.renderer.domElement.clientHeight;

    // Where the true horizon falls. The camera hangs behind and above
    // her looking DOWN, so it is nowhere near the middle of the screen
    // and a ladder drawn there would be decoration.
    camera.getWorldDirection(this.eye);
    const perRadian = tall / 2 / Math.tan((camera.fov * Math.PI) / 360);
    const elevation = Math.asin(Math.max(-1, Math.min(1, this.eye.y)));

    /** A LOCAL point to screen pixels, or null if it is behind us. */
    const onScreen = (
      point: THREE.Vector3,
    ): { x: number; y: number } | null => {
      const seen = point.clone().project(camera);
      if (seen.z > 1) return null;
      return { x: ((seen.x + 1) / 2) * wide, y: ((1 - seen.y) / 2) * tall };
    };

    const at = toLocal(this.ant.where);
    const herY = now.altitude;
    const her = new THREE.Vector3(at.lx, herY, at.lz);

    // THE FLIGHT-PATH VECTOR: her real three-dimensional velocity over
    // the ground, projected as a direction. Below a crawl the direction
    // of a near-zero vector is noise, so it is simply not drawn.
    let path: { x: number; y: number } | null = null;
    const rate = Math.hypot(now.ground.x, now.ground.z, now.climbing);
    if (now.groundSpeed > 2 && rate > 1e-6) {
      const REACH = 400;
      path = onScreen(new THREE.Vector3(
        at.lx + (now.ground.x / rate) * REACH,
        herY + (now.climbing / rate) * REACH,
        at.lz + (now.ground.z / rate) * REACH,
      ));
    }

    // THE TOUCHDOWN ZONE, drawn on the island where she will meet it.
    // Nothing stands in for it when there is none: a cruise that is not
    // coming down has no touchdown point, and drawing a placeholder
    // there would be inventing one.
    let mark: { x: number; y: number } | null = null;
    if (now.touchdown) {
      const seat = toLocal(world(now.touchdown.wx, now.touchdown.wz));
      mark = onScreen(new THREE.Vector3(seat.lx, now.touchdown.terrain, seat.lz));
    }

    return {
      horizon: Math.tan(elevation) * perRadian,
      perDegree: (perRadian * Math.PI) / 180,
      path,
      target: mark && now.touchdown
        ? { ...mark, hit: now.touchdown.after < SOON }
        : null,
      her: onScreen(her),
    };
  }

  private readonly eye = new THREE.Vector3();
  /** The last reading, for the debug handle and the probes. */
  private lastFlight: FlightTelemetry | null = null;

  /**
   * EVERY FLIGHT NUMBER, WORKED OUT ONCE.
   *
   * The one place physics becomes instrumentation. Nothing downstream
   * recomputes any of it — an altimeter and a flight-path marker that
   * disagree about her sink rate are worse than either alone, and the
   * only way they can disagree is if they each did the arithmetic.
   *
   * GLOBAL COORDINATES HERE, deliberately: the heightfield is indexed
   * by the island's real million-unit coordinates and doing the
   * prediction in float64 on the CPU costs nothing. Only the drawing
   * goes through the floating origin — which is the rule the ground
   * texture had to learn the hard way.
   */
  /**
   * Her altitude above the sea, world units.
   *
   * The SAME expression the flight panel's MSL comes from, on purpose:
   * a fix printed two pixels under a readout that disagreed with it
   * would be read as a bug every time it was read at all.
   */
  /**
   * The average frame rate, and the worst of the recent frames.
   *
   * THE MEAN IS OF THE FRAME TIMES, not of the rates. Averaging rates
   * flatters a stutter: one 200 ms frame among sixty 16 ms ones is 5
   * fps against 60, and the mean of the RATES says 59 while the mean of
   * the TIMES says 35 — and 35 is what the two seconds actually felt
   * like. The low is the 95th-percentile frame time for the same
   * reason: the number a stutter shows up in.
   */
  private frameRate(): { mean: number; low: number } {
    const seen = this.framesSeen;
    if (seen === 0) return { mean: 0, low: 0 };
    const recent = Array.from(this.frames.subarray(0, seen));
    let total = 0;
    for (const t of recent) total += t;
    recent.sort((a, b) => a - b);
    const worst = recent[Math.min(seen - 1, Math.floor(seen * 0.95))];
    return {
      mean: total > 0 ? seen / total : 0,
      low: worst > 0 ? 1 / worst : 0,
    };
  }

  private mslNow(): number {
    const here = this.ant.where;
    // PLUS WHATEVER IS HOLDING HER UP — wings OR water.
    //
    // This was ground + flight.height, and afloat that is the BED: the
    // water's lift lives in the `above` PlayerAnt is placed with, and
    // the altimeter could not see it. So the whole HUD under-reported
    // by the depth she was floating in — most of a metre on the Wailua
    // — and worse, the position fix RECORDED that number. Restoring
    // such a fix put her a metre low, on the bed of the river she had
    // been swimming in, which is how a replay of Joshua's own swimming
    // screenshot came back standing on dry grass.
    //
    // The sum itself lives in fix.ts, where a test can reach it.
    return mslOf(groundHeight(here.wx, here.wz), this.flight.height, this.ant.riding);
  }

  /**
   * PUT THE CAMERA BACK WHERE A FIX SAYS IT WAS.
   *
   * Everything a spawn does — `putAt` handles the origin, the terrain,
   * the sea's folded phase and the camera snap — and then, if the fix
   * was taken in the air, puts her back in the air at the height it
   * recorded. Landing her instead would reproduce the coordinates and
   * not the picture, which is the whole point of the exercise.
   *
   * @returns whether the text was a fix at all.
   */
  private goTo(text: string): boolean {
    const fix = parseFix(text);
    if (!fix) return false;
    const at = fixToWorld(fix);
    // HER CONVENTION, NOT THE COMPASS'S. A bearing counts clockwise
    // from north and north is −Z; a heading is radians along
    // (sin h, cos h). Converting with `bearing * PI / 180`, as this
    // did, is not a conversion at all — it put the camera 142 degrees
    // off the frame it was reproducing, and looked plausible enough
    // that only a rendered comparison caught it.
    // A FIX WITHOUT A BEARING LEAVES HER FACING WHERE SHE IS FACING.
    // The line stopped printing one when the compass ribbon above it
    // was found to be saying the same number — so a fix taken today
    // reproduces the SPOT, and a fix off an older screenshot, which
    // still carries its bearing, reproduces the whole frame. Snapping
    // to north on a missing number would be inventing a fact.
    // `face(-heading)` is how the yaw is set, so `-look.yaw` is the
    // heading she is on now — which is the honest answer when the fix
    // does not carry one.
    const heading = Number.isFinite(fix.bearing)
      ? headingFromBearing(fix.bearing) : -this.look.facing;
    const handle = (window as unknown as Record<string, {
      putAt: (wx: number, wz: number, heading?: number) => void;
    }>).__island;
    handle.putAt(at.wx, at.wz, heading);

    // ALTITUDE IS NOT A PROPERTY OF THE ISLAND ALONE. The relief dial
    // scales every height, so a fix taken at 1.0 and restored at 1.5
    // asks for a spot ninety-five metres inside a hill — where the
    // floor clamp obligingly stands her on the summit and the whole
    // frame is wrong in a way that reads as drift.
    //
    // SO SET THE DIAL, rather than converting the altitude to survive a
    // different one. Converting put her at the right height above the
    // wrong island: at 1.5 every ridge stands half again as tall and
    // every valley half again as deep, which is not the terrain the
    // screenshot was taken of. A reproduced frame that gets the height
    // right and the SHAPE wrong is worse than no reproduction, because
    // it looks like a reproduction. Measured: asked for ×1.00 at
    // 22.32 m and got ×1.50 at 33.49 m — exactly 1.5 times, exactly
    // wrong, and a completely different hillside.
    //
    // A fix with no dial recorded predates the field and is assumed to
    // be ours, so nothing moves and the altitude is taken at face value.
    if (Number.isFinite(fix.relief) && fix.relief !== reliefScale()) {
      setSetting('terrainRelief', fix.relief);
    }
    const msl = fix.msl;
    // Clearance over the surface she flies against — the WATER where
    // water stands. Against bare terrain, a fix a metre over the sea
    // reproduced as a metre over the SEABED, tens of metres up.
    const above = msl - groundHeight(at.wx, at.wz)
      - (waterSpotAt(at.wx, at.wz)?.depth ?? 0);
    const look = (fix.pitch * Math.PI) / 180;
    if (above > 1) this.flight.hold(above, heading);
    // BOTH, and they are not the same act. The snap places the camera
    // for this frame; the aim is what stops the next frame's look
    // input putting it straight back at its resting elevation, which
    // is how four reproduced frames came back pitched 22 degrees down
    // when the fix said 11.
    this.look.aim(this.follow.offsetFor(look));
    this.look.face(-heading);
    this.follow.snapTo(this.ant.root, -heading, look);
    return true;
  }

  /**
   * The flight panel's numbers, measured from the WATER instead of the
   * air. The mapping is exact rather than analogous: airspeed is speed
   * through the medium, and her medium is the water, so the AIR line
   * carries her swim speed; the wind rows carry the current, which is
   * the thing carrying HER; the tape reads her height over the BED the
   * way it reads height over the ground aloft; MSL is simply true. VS
   * is measured from her actual height and eased for the eye, the same
   * way AGL is. No touchdown: a swimmer is not on approach to anywhere.
   */
  /**
   * HOW FAR TO THE WATER, SIGNED — the instrument Joshua asked for
   * after "I landed on it, settled below the water".
   *
   * The vertical half is the one that matters and the one that did not
   * exist: her height above the DRAWN surface, negative when she is
   * under it. AWL could not say this — it clamps at zero, only appears
   * over 30+ units of water, and measures against the queried surface
   * rather than the drawn one. A number that cannot go negative cannot
   * report being underneath something.
   *
   * The horizontal half is range and bearing to the nearest of each
   * kind, so "where is water" is answerable from the readout instead
   * of by flying around looking for it.
   */
  private readWater(dt: number): void {
    if (!settings().showFix) { this.waterLine = null; return; }
    this.waterDue -= dt;
    if (this.waterDue > 0) return;
    this.waterDue = WATER_CADENCE;
    const here = this.ant.where;
    const herY = this.ant.root.position.y;
    const say = (v: number): string =>
      `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(1)}`;
    const far = (r: number): string => (r < 1
      ? 'here'
      : r < 100_000 ? `${(r / 100).toFixed(1)}m` : `${(r / 100_000).toFixed(2)}km`);
    const way = (b: number): string =>
      `${Math.round(((b * 180) / Math.PI + 360) % 360).toString().padStart(3, '0')}°`;

    // FRESH. The skin is what she can see, so it is what the sign is
    // measured against — the whole point of the exercise.
    const skin = this.water?.skinAt(here.wx, here.wz) ?? null;
    const nearFresh = this.water?.nearestFresh(here.wx, here.wz) ?? null;
    const fresh = skin && skin.depth > 0 && skin.skin > skin.ground
      ? `${say(herY - skin.skin)}`
      : '——';
    const freshWay = nearFresh
      ? `${far(nearFresh.range)}${nearFresh.range < 1 ? '' : ` ${way(nearFresh.bearing)}`}`
      : 'none';

    // SALT. Ground below zero IS the sea, and its surface is the swell
    // — the same one shared surface the ocean sheet draws from.
    const g = groundHeight(here.wx, here.wz);
    const nearSea = nearestSea(here.wx, here.wz);
    const salt = g < 0 ? `${say(herY - seaSwellAt(here.wx, here.wz, -g))}` : '——';
    const seaWay = nearSea
      ? `${far(nearSea.range)}${nearSea.range < 1 ? '' : ` ${way(nearSea.bearing)}`}`
      : 'none';

    // AND WHAT THE SEA IS DEMANDING, in BOTH modes. Joshua asked for
    // the sampling "(both auto and manual)", and this is the half that
    // is honest in manual: the autopilot is made to respect the number,
    // and a player flying by hand is TOLD it. Forcing a hand-flown
    // queen up would fight the one manoeuvre that has to be allowed to
    // go down — landing on the water.
    const crest = this.waves.crest;
    this.waterLine = `WTR fresh ${fresh} ${freshWay} · salt ${salt} ${seaWay}`
      + (crest > 0
        ? ` · crest ${far(crest)} → fly ${far(this.waves.clearance)} AWL` : '');
  }

  /**
   * STAGE H — feed the brain, take what it says.
   *
   * EVERY FRAME, because the brain throttles ITSELF: think five times a
   * second, plan once. Doing the throttling here instead would put the
   * rate in the caller, where a second caller could disagree with it.
   *
   * The sense is READ-ONLY. Motion and Act are derived (ant/motion.ts)
   * and the brain is handed them rather than allowed to set them — the
   * disagreement Stage G removed does not get to come back through the
   * autonomy.
   *
   * PHASE 1 CONSUMES NOTHING. `brain.intent` is published and no code
   * acts on it: the executor that turns an intent into a FlightDemand
   * is Phase 2. She will decide correctly and stand still doing it.
   */
  /**
   * HER PACE, ONCE — the tier she is on and the ceilings it is measured
   * against. Both the brain and the developer line read this, so the
   * two cannot disagree about what she is doing.
   */
  private gaitNow(): { medium: ReturnType<typeof mediumOf>; tier: ReturnType<typeof tierOf> } {
    const medium = mediumOf(this.motion);
    // The SELECTED pace plus whether the sprint override is actually in
    // force — asking for a sprint with an empty bar is not a sprint.
    const sprinting = (this.sprintOn || this.paceUI.sprintHeld)
      && !this.reask && !this.stamina.spent;
    return { medium, tier: tierOf(this.pace, sprinting) };
  }

  private thinkAutonomy(dt: number): void {
    const here = this.ant.where;
    this.channelDue -= dt;
    if (this.channelDue <= 0) {
      this.channelDue = AUTONOMY_DEFAULTS.planEvery;
      this.channelNear = nearestWatercourse(here.wx, here.wz);
      this.waterAhead = this.lookAhead(here);
    }
    this.brain.update(dt, {
      at: here,
      thirst: this.thirst.fraction,
      thirstDrain: this.thirst.drain,
      stamina: this.stamina.fraction,
      staminaSpent: this.stamina.spent,
      motion: this.motion,
      act: this.act,
      ...(() => {
        const g = this.gaitNow();
        return { medium: g.medium, tier: g.tier, paceShare: paceShare(g.medium, g.tier) };
      })(),
      wingsWet: this.wings.wet,
      drinkable: canDrink(here.wx, here.wz),
      nearestFresh: this.water?.nearestFresh(here.wx, here.wz) ?? null,
      // STRATEGIC, and only worth asking on the brain's slow cadence —
      // it is a ring search over the island. Handed the cached answer
      // the water readout already computed where one exists.
      nearestWatercourse: this.channelNear,
      waterAhead: this.waterAhead,
    });
    // ── ON TO THE NEXT STOP ──────────────────────────────────────
    // The brain has finished the one it was given. If the player laid
    // out more, hand it the next; if that was the last, the trip is
    // over and the chain goes with it.
    if (this.chain.length > 0 && this.brain.primaryMission === null) {
      this.chain.shift();
      if (this.chain.length > 0) this.orderTo(this.chain[0], 'waypoint');
    }

    const said = this.brain.takeNotice();
    if (said) {
      this.brainSaid = said;
      this.brainSaidLeft = AUTONOMY_NOTICE;
    }
  }

  /**
   * WATER ALONG THE LINE SHE IS FLYING, as sightings from where she is.
   *
   * `nearestWatercourse` around HER answers one question and the brain
   * needs a second: what is near the ROUTE. So the drainage is asked at
   * three points down the leg and the answers re-expressed from her
   * position, which is the only form the brain accepts — a sighting is
   * true from the place it was taken, and one carried over from a
   * kilometre back would be believed and wrong.
   *
   * BOUNDED BY WHAT SHE COULD REACH, not by the leg. A quarter of the
   * way along a fifty-kilometre crossing is twelve kilometres out, and
   * a candidate the reachability filter is certain to throw away is a
   * ring search spent for nothing. The sampling walks the corridor only
   * as far as her remaining water could carry her.
   *
   * Empty when she is not short, when there is nowhere she is going, or
   * when the drainage has nothing — all of which read the same way to
   * the brain, which is correct: it means it has no extra candidates,
   * not that the island has no water.
   */
  private lookAhead(here: WorldPoint): WaterSighting[] {
    const goal = this.brain.primaryMission?.at ?? null;
    if (goal === null) return [];
    const dry = this.thirst.drain > 0
      ? this.thirst.fraction / this.thirst.drain
      : Number.POSITIVE_INFINITY;
    if (dry > AUTONOMY_DEFAULTS.thirstFloor * CORRIDOR_AHEAD) return [];
    const span = Math.hypot(goal.wx - here.wx, goal.wz - here.wz);
    if (!(span > 0)) return [];
    const reach = Math.min(span, dry * AUTONOMY_DEFAULTS.assumedSpeed);
    // AND EACH SEARCH IS CAPPED at the radius the brain would accept
    // anyway. Without it a sample point out over the water walks the
    // drainage ring by ring to the far coast — millions of nodes inside
    // one frame — to find a channel the reachability test then throws
    // away. This is that same test, applied before the work.
    const useful = Math.max(
      0,
      (dry - AUTONOMY_DEFAULTS.hydrationReserve) * AUTONOMY_DEFAULTS.assumedSpeed,
    );
    const seen: WaterSighting[] = [];
    for (const along of CORRIDOR_AT) {
      const share = (reach * along) / span;
      const px = here.wx + (goal.wx - here.wx) * share;
      const pz = here.wz + (goal.wz - here.wz) * share;
      const found = nearestWatercourse(px, pz, useful);
      if (!found) continue;
      // The node it found, in world, then said again FROM HER.
      const dx = px + Math.sin(found.bearing) * found.range - here.wx;
      const dz = pz + Math.cos(found.bearing) * found.range - here.wz;
      seen.push({ range: Math.hypot(dx, dz), bearing: Math.atan2(dx, dz) });
    }
    return seen;
  }

  /**
   * THE RASTER HAS LANDED. Whatever grows from it may now be grown;
   * until this fires the island is bare and every placement query
   * answers "nothing", which is honest rather than wrong.
   */
  private vegArrived(): void {
    this.vegReady = true;
    this.landmarks.wake();
  }

  /**
   * STAGE H's developer line — what the brain is thinking, in one row.
   *
   * The same register as the fix, LOD and water lines and under the
   * same single toggle. Compact on purpose: this is an instrument for
   * whoever is building the autonomy, not furniture for the player.
   */
  private aiLine(): string {
    const d = this.brain.debug({
      at: this.ant.where,
      thirst: this.thirst.fraction,
      thirstDrain: this.thirst.drain,
      stamina: this.stamina.fraction,
      staminaSpent: this.stamina.spent,
      motion: this.motion,
      act: this.act,
      wingsWet: this.wings.wet,
      ...(() => {
        const g = this.gaitNow();
        return { medium: g.medium, tier: g.tier, paceShare: paceShare(g.medium, g.tier) };
      })(),
      drinkable: false,
      nearestFresh: null,
      nearestWatercourse: this.channelNear,
      waterAhead: this.waterAhead,
    });
    const secs = (v: number): string => (Number.isFinite(v)
      ? (v >= 600 ? `${(v / 60).toFixed(0)}m` : `${v.toFixed(0)}s`)
      : '——');
    const km = (v: number): string => `${(v / 100_000).toFixed(2)}km`;
    const chan = this.channelNear === null ? 'none'
      : this.channelNear.range < 1 ? 'here'
        : km(this.channelNear.range);
    // THE WATER DECISION, SHOWN AS IT WAS MADE. Range is how far the
    // candidate is, `c` is what stopping there costs the trip, then the
    // time to reach it and whether that fits inside her water. A queen
    // who flew past a stream and one who never saw it look identical
    // from outside without these four.
    const cand = d.candidate === null ? 'none'
      : `${d.candidate.label} ${km(d.candidate.range)} c${km(d.candidate.cost)}`
        + ` ${secs(d.candidate.eta)} ${d.candidate.reachable ? 'ok' : 'FAR'}`;
    return `AI ${d.goal} · pri ${d.primary ?? '—'} · det ${d.detour ?? '—'}`
      + ` · h2o ${(d.thirst * 100).toFixed(0)}%`
      + ` dry ${secs(d.dry)}/${secs(d.threshold)}`
      + ` · cand ${cand} · ahead ${this.waterAhead.length}`
      + ` · eta ${secs(d.eta)} · chan ${chan}`
      + ` · stam ${(d.stamina * 100).toFixed(0)}%`
      + ` · ${d.medium} ${gaitWords(d.medium, d.tier)}`
      + ` · ${d.motion}/${d.act}`;
  }

  /**
   * THE AUTOPILOT, in one cell of the developer line.
   *
   * Empty while it is not flying, which is most of the time — a
   * permanent readout for something that is usually idle is a readout
   * nobody reads. Everything in it is a number the controller actually
   * used, so a disagreement between what she does and what this says
   * is a bug rather than a rounding difference.
   *
   * Deliberately small. The Phase 2 brief asked for compact developer
   * telemetry and explicitly not a giant permanent UI.
   */
  private navWords(): string | null {
    const nav = this.nav;
    if (nav === null || !this.autopilot.engaged) return null;
    const km = (v: number): string => (v >= 100_000
      ? `${(v / 100_000).toFixed(2)}km` : `${(v / 100).toFixed(0)}m`);
    const clear = nav.ahead === null ? '——' : km(nav.ahead);
    return `AP ${nav.state}${nav.blocked ? `(${nav.blocked})` : ''}`
      + ` ${km(nav.range)}`
      // WANTED against ACTUAL, because the gap between them IS the
      // crab, and a heading readout beside a track readout is the one
      // pair that shows the wind being flown through.
      + ` · trk ${nav.wanted.toFixed(0)}/${this.heldTrack.toFixed(0)}`
      + ` err ${nav.error >= 0 ? '+' : ''}${nav.error.toFixed(0)}°`
      + ` · spd ${nav.target.toFixed(0)}/${this.flight.airspeed.toFixed(0)}`
      + ` gnd ${Math.hypot(...(() => {
        const g = groundVelocity(
          this.flight.airspeed, this.flight.heading, this.windOnHer(),
        );
        return [g.x, g.z] as [number, number];
      })()).toFixed(0)}`
      // THE BAND AND WHAT IT COSTS. The altitude it has chosen against
      // the one it is at, and the crab that choice buys — the pair that
      // shows the wind being flown around rather than through.
      + ` · band ${km(nav.band)}/${km(this.flight.height)}`
      + ` crab ${nav.crab >= 0 ? '+' : ''}${nav.crab.toFixed(0)}°`
      + ` · clr ${clear}`
      // WHAT THE SEA IS ASKING FOR, when it is asking for anything.
      // Silent over dry land, where the crest is zero and there is
      // nothing to clear.
      + (this.waves.clearance > 0
        ? ` · sea ${km(this.waves.crest)}+1m` : '')
      // HER CLOCK, when it is not the world's. Silent at 1x, because a
      // multiplier that always says "x1.0" is a character of noise on a
      // line that has already been off the side of the screen once.
      + (this.travel.boosted ? ` · x${this.travel.scale.toFixed(1)}` : '')
      // WHAT THE PLANNER DID TO THE PLAN, and which leg of it she is
      // on. Silent when it did nothing, which with an empty hazard list
      // is every flight — a line that says "changed nothing" every time
      // is a line that gets read once.
      + (this.route === null || !this.route.report.changed ? ''
        : ` · leg ${this.legAt + 1}/${this.route.legs.length}`
          + ` ${routeWords(this.route.report)}`)
      // WHAT THE FORWARD MARCH CAN SEE — the nearest trunk in her lane,
      // how far into the middle of it, which way she is going round and
      // whether there is room. `PINCH` is the case that also slows her
      // and stops the climb. Silent with a clear lane, beside how many
      // trees are standing and what the last plan cost.
      + (() => {
        const way = this.autopilot.inTheWay;
        if (way === null) {
          return ` · look clear · stand ${this.landmarks.trees.length}`;
        }
        return ` · look ${(way.range / 100).toFixed(1)}m`
          + ` mid ${(way.squeeze * 100).toFixed(0)}%`
          + ` ${way.way > 0 ? 'R' : 'L'}${Math.abs(way.swerve).toFixed(0)}°`
          + `${way.pinched ? ' PINCH' : ''}`
          + ` · stand ${this.landmarks.trees.length}`;
      })()
      + (this.route === null ? '' : ` · plan ${this.planMs.toFixed(1)}ms`);
  }

  private readSwim(dt: number): FlightTelemetry {
    const here = this.ant.where;
    const terrain = groundHeight(here.wx, here.wz);
    const agl = this.swimAbove;
    const altitude = terrain + agl;
    const ground = this.ant.overGround;
    this.heldTrack = trackOf(ground, this.heldTrack);
    const current = this.swimCarry;
    const thru = current
      ? Math.hypot(ground.x - current.x, ground.z - current.z)
      : Math.hypot(ground.x, ground.z);
    if (this.lastSwimAlt !== null && dt > 0) {
      const vs = (altitude - this.lastSwimAlt) / dt;
      this.swimVs += (vs - this.swimVs) * (1 - Math.exp(-6 * dt));
    }
    this.lastSwimAlt = altitude;
    return {
      water: { over: this.swimOver },
      airspeed: thru,
      groundSpeed: Math.hypot(ground.x, ground.z),
      heading: bearingFromHeading(this.ant.bearing),
      track: this.heldTrack,
      drift: driftOf(this.heldTrack, this.ant.bearing),
      climbing: this.swimVs,
      agl,
      awl: null,
      altitude,
      ground,
      wind: current
        ? { speed: Math.hypot(current.x, current.z), bearing: bearingOf(current.x, current.z) }
        : { speed: 0, bearing: 0 },
      touchdown: null,
      shownAgl: this.easedAgl.push(agl, dt),
      shownAtLanding: null,
      shownRange: null,
      shownWhen: null,
    };
  }

  private readFlight(dt: number): FlightTelemetry {
    const here = this.ant.where;
    const terrain = groundHeight(here.wx, here.wz);
    // THREE ALTITUDES, one truth each (Joshua's naming). The flight's
    // stored clearance is measured against the floor it flies on —
    // the terrain, or the WATER SURFACE where water stands. So over
    // water that clearance IS her AWL; AGL keeps its own meaning (the
    // ground, seabed included) by adding the column back; and MSL is
    // the surface plus the clearance, which over dry land collapses
    // to the old terrain-plus-height exactly.
    const column = waterSpotAt(here.wx, here.wz)?.depth ?? 0;
    const clearance = this.flight.height;
    // WHERE SHE IS is the reference plus her clearance — that is what
    // the placement did. WHAT SHE IS OVER is the real water. So the
    // readouts stay truthful even while the autopilot flies smoothed:
    // AWL is her true instantaneous clearance above the real wave
    // surface, and it breathes with the swell exactly as it should.
    const ridden = this.motion === 'flying' ? this.holdFloor - terrain : column;
    const altitude = terrain + ridden + clearance;
    const agl = ridden + clearance;
    // WHETHER THERE IS WATER UNDER HER TO SPEAK OF, with hysteresis.
    // A bare `column > 0` chattered as the swash washed back and forth
    // across her: the AWL row appeared and vanished, the rail reflowed
    // under it, and the hold pill flipped AGL/AWL every few frames.
    // Joshua: "doesn't need to randomly switch."
    this.overWater = column > (this.overWater ? 12 : 30);
    const awl = this.overWater ? ridden + clearance - column : null;
    // MEASURED, not reconstructed: her actual displacement over the
    // island, which already contains her airspeed, the wind, and
    // anything the movement pipeline grows later.
    const ground = this.ant.overGround;
    this.heldTrack = trackOf(ground, this.heldTrack);

    const from = { wx: here.wx, wz: here.wz, altitude };
    const climbing = this.flight.climbing;
    // The surface she would actually MEET — water counts. A descent
    // over the sea ends at the sea, and LND/TGT should say so instead
    // of measuring to a seabed she can never reach.
    const sample = (wx: number, wz: number): number => {
      const g = groundHeight(wx, wz);
      return g + (waterSpotAt(wx, wz)?.depth ?? 0);
    };

    // THE WIND SHE IS IN, not the one the station reported: the same
    // vector the flight model is adding to her, height profile and
    // gusts and all. At twenty centimetres up that is a fraction of the
    // ten-metre figure, and describing the ten-metre figure as her
    // drift input would be describing air she is not in.
    const felt = this.windOnHer();

    // THE TOUCHDOWN ZONE. Fed the settled rate, not the instantaneous
    // one — see easedRise. Only worth walking the path while she is
    // actually flying it.
    const settled = this.easedRise.push(climbing, dt);
    const spot = this.motion === 'flying'
      ? touchdown(from, ground, settled, sample)
      : null;
    if (!spot) {
      this.easedLanding.set(Number.NaN);
      this.easedRange.set(Number.NaN);
      this.easedWhen.set(Number.NaN);
    }

    return {
      airspeed: this.flight.airspeed,
      groundSpeed: Math.hypot(ground.x, ground.z),
      heading: bearingFromHeading(this.flight.heading),
      track: this.heldTrack,
      drift: driftOf(this.heldTrack, this.flight.heading),
      climbing,
      agl,
      awl,
      altitude,
      ground,
      wind: {
        speed: felt ? Math.hypot(felt.x, felt.z) : 0,
        bearing: felt ? bearingOf(felt.x, felt.z) : 0,
      },
      touchdown: spot,
      // SMOOTHED FOR THE EYE ONLY. Terrain sampled along a moving path
      // is genuinely spiky — a metre sideways can be a different
      // hillside — and every one of those reported honestly is
      // unreadable. Nothing above this line is eased.
      shownAgl: this.easedAgl.push(agl, dt),
      // HOW FAR SHE STILL HAS TO COME DOWN: her altitude measured
      // against the ground at the landing spot, not the ground under
      // her feet. Joshua's "altitude difference".
      shownAtLanding: spot
        ? this.easedLanding.push(altitude - spot.terrain, dt)
        : null,
      shownRange: spot ? this.easedRange.push(spot.range, dt) : null,
      shownWhen: spot ? this.easedWhen.push(spot.after, dt) : null,
    };
  }

  // ── WHAT THE WATER DID TO HER ───────────────────────────────────
  // A surf reading, a carry eased in and out over a fraction of a
  // second, a swim model with four states, and an air reserve. All of
  // it read one question — which water has her, right where she is —
  // and answered it in the units the walker wanted. It is gone with
  // the water it measured. The one part worth carrying forward is that
  // the carry was DRAG rather than a shove: she was never teleported
  // at the water's speed, her own eased toward it, and at the moment a
  // wave arrives those two look completely different.

  private windOnHer(): { x: number; z: number } | null {
    return this.windAtAgl(this.flight.height);
  }

  /**
   * THE WIND AT A HEIGHT SHE IS NOT AT — the autopilot's whole altitude
   * argument, and the reason this was split out of `windOnHer`.
   *
   * The profile is `t²(3−2t)` to full strength at ten metres, so it
   * collapses fast down low: measured against the frame Joshua sent,
   * the same air that is 132 cm/s at 4.9 m is 28 cm/s at 2 m and
   * 2.4 cm/s at 55 cm. With a 40 cm/s airspeed that is the difference
   * between hopeless and still air. An autopilot that cannot ask "what
   * would the wind be if I dropped a metre" cannot use any of that.
   *
   * SHELTER IS PART OF THE ANSWER and is deliberately left keyed to her
   * REAL position: a ridge upwind of her shelters the band she is
   * considering just as it shelters the one she is in.
   */
  private windAtAgl(agl: number): { x: number; z: number } | null {
    const sky = this.nowWeather;
    if (!sky) return null;
    // Nothing at her feet, all of it at ten metres. Cheapest possible
    // exit too: on the ground this is exactly zero and the vector maths
    // below never runs.
    // AGL for the profile, and that stays AGL on purpose: how much
    // wind there is depends on how far off the deck she is, which is a
    // different question from what altitude she is holding.
    const reach = windProfile(agl) * settings().windInfluence;
    if (reach <= 0) return null;

    const live = this.liveWind.sample;
    // The reported bearing plus however far the air has wandered off
    // it. Veer is clockwise in compass terms, which is anticlockwise in
    // heading terms — hence the sign, and hence saying so.
    const heading = sky.windHeading - (live.veerDegrees * Math.PI) / 180;
    // WHAT IS UPWIND OF HER, which in a gorge is most of the answer.
    // `heading` is where the air is GOING, so the way back along it is
    // where it comes from — and that is the direction to look for rock
    // standing between her and the weather. MSL, not AGL: a ridge
    // shelters her if it is higher THAN SHE IS, and how far she
    // happens to be off the floor at the time is beside the point.
    const here = this.ant.where;
    const kept = shelter(
      here.wx, here.wz, groundHeight(here.wx, here.wz) + agl,
      -Math.sin(heading), -Math.cos(heading), groundHeight,
    );
    const speed = live.speedMps * UNITS_PER_METRE * reach * kept;
    return { x: Math.sin(heading) * speed, z: Math.cos(heading) * speed };
  }

  /**
   * Take her wings, or give them back.
   *
   * TEMPORARY IN THE SENSE THAT NOTHING CALLS IT YET. Dealation is a
   * real event in an ant's life — she sheds her wings after the mating
   * flight and never flies again — and when that event exists it calls
   * this. Until then it is reachable from the debug key and from a
   * probe, so the two states can be looked at and tested rather than
   * taken on trust.
   */
  private setWings(on: boolean): void {
    this.winged = on;
    this.queen?.setWings(on);
  }

  private aspect(): number {
    return this.host.clientWidth / Math.max(1, this.host.clientHeight);
  }

  private buildLights(): void {
    // Held rather than dropped into the scene and forgotten: the
    // weather dims and warms them every frame.
    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
    this.sun.position.set(2000, 3000, 1400);
    this.skyLight = new THREE.HemisphereLight(SKY_COLOR, 0x5a4a38, 0.85);
    this.scene.add(this.sun, this.skyLight);
  }

  /**
   * Put the weather on the scene.
   *
   * The fog density comes from the reported VISIBILITY rather than
   * from a constant, which is the whole difference between fog as a
   * weather effect and fog as a place to hide the streaming seam.
   */
  private applyWeather(now: GameWeather): void {
    const look = skyLook(now);
    const sky = new THREE.Color(look.sky.r, look.sky.g, look.sky.b);
    (this.scene.background as THREE.Color).copy(sky);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(sky);
    fog.density = look.density;

    this.sun.intensity = look.sun;
    // Sunlight goes from golden to flat grey as the cloud thickens.
    this.sun.color.setRGB(
      1, 0.949 + (1 - 0.949) * (1 - look.warmth),
      0.867 + (1 - 0.867) * (1 - look.warmth),
    );
    this.skyLight.intensity = look.ambient;
    this.skyLight.color.copy(sky);
  }

  private buildTerrain(): void {
    // A baked tile rather than a shipped asset: no fetch to wait on,
    // and it exists to break up the band textures' own repeat at very
    // close range, where the camera spends its whole life.
    const grain = new THREE.DataTexture(
      bakeGrain(GRAIN_SIZE), GRAIN_SIZE, GRAIN_SIZE, THREE.RGBAFormat,
    );
    grain.wrapS = THREE.RepeatWrapping;
    grain.wrapT = THREE.RepeatWrapping;
    grain.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    grain.generateMipmaps = true;
    grain.minFilter = THREE.LinearMipmapLinearFilter;
    grain.magFilter = THREE.LinearFilter;
    grain.needsUpdate = true;

    // One material per distance tier, each cutting away the range the
    // tier inside it already covers. They share the textures; only the
    // cut differs.
    const bands = loadBands(this.renderer, this.report);
    const authored = loadAuthored(this.renderer, this.report);
    // THE RELIEF, once the maps it reads are actually here. Bands still
    // holding their placeholder would bake a flat normal and stay flat,
    // because nothing bakes them a second time — and that goes for the
    // scanned maps too, so wait on both.
    this.bandsReady = Promise.all([bands.ready, authored.ready]).then(() => {
      bakeGroundRelief(this.renderer, bands.textures, authored.textures, BAND_TILE);
    });
    const maps = bands.textures;
    this.terrain = new TerrainStream(
      this.scene,
      terrainMaterial(maps, grain),
      terrainMaterial(maps, grain, TIER_CUTS.transition),
      terrainMaterial(maps, grain, TIER_CUTS.middle),
      terrainMaterial(maps, grain, TIER_CUTS.backdrop),
    );

    // THE WATER. Nothing to load: it rains on the window and the
    // ground routes it, so the only input is the terrain that is
    // already here. The hydrography stays on disk as the thing the
    // tests check the result AGAINST — see IslandWater's header.
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.water = new IslandWater(this.scene, aniso);
    this.water.follow(this.ant.where);
    // THE DEV FLAG, read once and answered BEFORE the ocean is built,
    // because seaSwell's chunk is baked into the water's shader at
    // compile time: choosing the sea first means the very first frame
    // already draws it, with no rebuild. Without the flag the shipped
    // table is installed explicitly, so a scene cannot inherit a
    // generated sea from the one before it.
    //
    // A FRESH SCENE STARTS A FRESH SEA. Ocean used to do this and no
    // longer may: it is rebuilt mid-transition when a new buoy reading
    // blends in, and restarting the clock there would jump the phase
    // of every wave at once.
    restartSwellClock();
    const asked = seaFromQuery(window.location.search);
    this.wantsSea = asked;
    if (asked) {
      // THE CACHE SPEAKS FIRST. A stored reading is on hand before the
      // first frame, so the ocean opens on the real sea rather than on
      // a fallback that gets swapped out a second later. Only if there
      // is nothing stored does TYPICAL_SEA stand in — and that is a
      // genuine 51208 reading too, so either way the water is right.
      useProceduralSea({ ...asked, observation: this.sea.observation });
      this.seaStamp = this.sea.version;
    } else useFixedSea();
    this.seaTable = waveTableVersion();
    this.ocean = new Ocean(this.scene, aniso);
    this.ocean.follow(this.ant.where);
  }

  /**
   * SWAP THE SEA, and rebuild the water so the picture agrees.
   *
   * seaSwell's chunk is baked into the shader at compile time, so
   * changing the table is only half the job: the ocean's materials
   * have to be made again for the geometry to follow the physics.
   * Disposing and recreating is the honest way to do that, and it is
   * a dev action rather than a per-frame one.
   *
   * @param options null for the built-in sea.
   */
  private useSea(options: LiveSeaOptions | null): void {
    if (options) useProceduralSea(options); else useFixedSea();
    this.rebuildOcean();
  }

  /**
   * WHAT THE SEA IS, in the units a person argues in.
   *
   * Everything a Stage C measurement needs to name its own conditions:
   * which table is in force, what the regime asked for, and every
   * component's period, wavelength, amplitude and heading. Peak
   * vertical acceleration is included because it is the number the
   * "washing machine" complaint was actually about — A * omega^2, per
   * scale, which is what separates a big slow swell from fast chop.
   */
  private seaReport(): Record<string, unknown> {
    const waves = activeWaves();
    const field = liveField();
    const regime = liveRegime();
    const per = (from: readonly typeof waves[number][]) => ({
      count: from.length,
      // Peak vertical speed and acceleration this scale can impose.
      peakRiseCmS: Number(from.reduce((s2, w) => s2 + w.amp * w.omega, 0).toFixed(2)),
      peakAccelMs2: Number((from.reduce(
        (s2, w) => s2 + w.amp * w.omega * w.omega, 0) / 100).toFixed(3)),
      reachCm: Number(from.reduce((s2, w) => s2 + w.amp, 0).toFixed(2)),
    });
    const macro = field
      ? waves.filter((_, i) => field.components[i]?.scale === 'macro') : waves;
    const meso = field
      ? waves.filter((_, i) => field.components[i]?.scale === 'meso') : [];
    const feed = this.sea.state;
    return {
      mode: seaMode(),
      line: seaLine(feed),
      feed: {
        source: feed.source,
        station: feed.station,
        ageMinutes: feed.ageMs === null ? null : Math.round(feed.ageMs / 60_000),
        fetchedAt: feed.fetchedAt,
        failure: feed.failure,
        asking: feed.asking,
        observation: feed.observation,
      },
      blend: seaBlend(),
      source: seaMode() === 'procedural' ? SEA_SOURCE_NOTE : 'built-in table',
      mesoScaleDefault: DEFAULT_MESO_SCALE,
      regime: regime && {
        significantHeightM: Number(regime.significantHeightM.toFixed(3)),
        dominantPeriodS: regime.dominantPeriodS,
        towardDeg: Number(regime.towardDeg.toFixed(1)),
        periodSpread: Number(regime.periodSpread.toFixed(3)),
        directionSpreadDeg: Number(regime.directionSpreadDeg.toFixed(1)),
        grouping: Number(regime.grouping.toFixed(3)),
        seed: regime.seed,
      },
      // The whole sea, and each scale on its own.
      all: per(waves),
      macro: per(macro),
      meso: per(meso),
      swellAmplitudeCm: Number(swellAmplitude().toFixed(2)),
      swellReachCm: Number(swellReach().toFixed(2)),
      components: waves.map((w, i) => ({
        scale: field?.components[i]?.scale ?? 'fixed',
        periodS: Number(((2 * Math.PI) / w.omega).toFixed(3)),
        wavelengthCm: Number(((2 * Math.PI) / w.k).toFixed(1)),
        amplitudeCm: Number(w.amp.toFixed(3)),
        towardDeg: Number(
          ((Math.atan2(w.dx, -w.dz) * 180) / Math.PI + 360).toFixed(1),
        ) % 360,
        faceDeg: Number(
          ((Math.atan(w.amp * w.k) * 180) / Math.PI).toFixed(2),
        ),
      })),
    };
  }

  /**
   * ONE FRAME OF THE BUOY — poll, blend, retire, rebuild.
   *
   * Nothing here can block and nothing here can fail loudly. The poll
   * returns at once and lands whenever it lands; a refusal, a partial
   * record or a malformed document leaves the sea exactly as it was
   * (SeaService). What this does when a genuinely NEW reading takes
   * hold is start a four-minute crossfade, not a swap.
   *
   * THE WATER IS REBUILT ONLY WHEN THE TABLE CHANGES SHAPE — twice per
   * observation, once as the second generation joins and once as the
   * first is retired — because the shader bakes each component's
   * wavenumber, frequency and heading. Both moments are chosen so the
   * SURFACE does not move across them: the joining generation's
   * amplitude is nought at the start of the fade and the retiring
   * one's is nought at the end. Amplitude itself is a uniform and
   * needs no rebuild, which is what lets the crossfade run smoothly in
   * between.
   *
   * OFF UNLESS THE FLAG IS ON. A player on the shipped ocean does not
   * make requests to NOAA for an experiment they are not running.
   */
  private stepSea(): void {
    if (!this.wantsSea) return;
    this.sea.poll();
    if (this.sea.version !== this.seaStamp) {
      const seen = this.sea.observation;
      this.seaStamp = this.sea.version;
      if (seen) blendToObservation(seen, { ...this.wantsSea, observation: seen });
    }
    settleSea();
    const shape = waveTableVersion();
    if (shape !== this.seaTable) {
      this.seaTable = shape;
      this.rebuildOcean();
    }
  }

  private rebuildOcean(): void {
    if (!this.ocean) return;
    this.ocean.dispose();
    this.ocean = new Ocean(
      this.scene, this.renderer.capabilities.getMaxAnisotropy(),
    );
    this.ocean.follow(this.ant.where);
    this.ocean.place();
  }


}
