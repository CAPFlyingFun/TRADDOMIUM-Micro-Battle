import * as THREE from 'three';
import { PlayerAnt } from '../ant/PlayerAnt';
import { FollowCamera } from '../camera/FollowCamera';
import { PaceSelector } from '../input/PaceSelector';
import { LookDrag } from '../input/LookDrag';
import { MoveStick } from '../input/MoveStick';
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
import { local, world, type WorldPoint } from '../world/coords';
import { TerrainStream, TIER_CUTS } from '../world/TerrainStream';
import { followHd, forgetHd, hdResident, onHdTile } from '../world/kauaiHd';
import { IslandWater } from '../world/IslandWater';

import { originAt, rebaseFor, setOrigin, toLocal, toWorld,
} from '../world/origin';
import { bakeGrain, GRAIN_SIZE } from '../world/groundTexture';
import {
  BAND_TILE, FADE_FROM_UNIFORM, FADE_TO_UNIFORM,
  loadBands, reliefUniform, setDetailRange, setTextureOrigin, terrainMaterial,
} from '../world/terrainMaterial';
import { SettingsPanel } from '../ui/SettingsPanel';
import { PauseMenu } from '../ui/PauseMenu';
import {
  newSaveId, writeSave, type Snapshot, type SoloSave,
} from '../game/save';
import { Vitals } from '../ui/Vitals';
import { LIVE_GROWTH, liveStat } from '../ant/castes';
import { ActionPad } from '../input/ActionPad';
import { Thirst } from '../ant/thirst';
import { LiftSlider, leverFor } from '../input/LiftSlider';
import { DebugDie } from '../ui/DebugDie';
import { WeatherChip } from '../ui/WeatherChip';
import { FlightHud, windCall, type FlightView } from '../ui/FlightHud';
import {
  Eased, SOON, driftOf, touchdown, trackOf,
  type FlightTelemetry,
} from '../ant/telemetry';
import { bearingFromHeading, bearingOf, headingFromBearing, pitchOf } from '../ui/compassMath';
import { Compass } from '../ui/Compass';
import { type CompassMarker } from '../ui/compassMath';
import { AUTO_AIRSPEED, Flight, setFlightScale } from '../ant/flight';
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
  private readonly debugDie: DebugDie;
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
  /** Which slot this run writes to. One run, one slot, all sitting. */
  private readonly slot = newSaveId();
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
  private readonly flight = new Flight();
  /** Five minutes of being left alone, and of leaving everything alone. */
  private readonly grace = new Grace();
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
    setDetailRange(settings().detailRange);
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
    setOrigin(found.at.wx, found.at.wz);
    const seated = originAt();
    setTextureOrigin(seated.x, seated.z);
    const facing = found.heading;
    this.ant.placeAt(found.at.wx, found.at.wz, facing);
    this.terrain.follow(this.ant.where);
    this.reshapeIsland();
    this.scene.add(this.ant.root);

    this.stick = new MoveStick(host);
    this.paceUI = new PaceSelector(host);
    this.look = new LookDrag(host);
    this.panel = new SettingsPanel(host, true);
    this.pauseMenu = new PauseMenu(host, {
      resume: () => { this.halted = false; },
      save: () => this.save(),
      settings: () => this.panel.reveal(),
      quit: () => this.leaving?.(),
    });
    this.panel.intercept(() => {
      this.halted = true;
      this.pauseMenu.show();
    });
    // Her health, food and water come off the queen's stat table
    // rather than being typed here — this is the only place the data
    // file and the HUD meet, and it is a read, not a copy.
    this.actions = new ActionPad(host);
    this.debugDie = new DebugDie(host, () => this.kill());
    this.weatherChip = new WeatherChip(host);
    this.flightHud = new FlightHud(host);
    this.compass = new Compass(host);
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
    // THE DRINK BUTTON WENT WITH THE WATER. It stayed on the pad for
    // one build after the water came out, permanently disabled, which
    // is the state the contextual-HUD rule exists to forbid: a control
    // for a mechanic the game does not have is clutter even when it is
    // greyed. It comes back when there is something to drink.
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
      setDetailRange(settings().detailRange);
      this.debugDie.show(settings().showFix);
    });
    this.debugDie.show(settings().showFix);
    // The view is a world bearing, so it has to be told where behind
    // her IS. Without this she opens side-on to her own camera.
    this.look.setYaw(-facing);
    this.follow = new FollowCamera(this.aspect());
    this.follow.snapTo(this.ant.root, -facing);

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
    onHdTile(() => { if (!this.disposed) this.terrain.rebuild(); });
    followHd(this.ant.where.wx, this.ant.where.wz);


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
        this.follow.snapTo(this.ant.root, -heading);
      },
      pace: () => this.pace,
      setPace: (to: Pace) => { this.pace = to; },
      stamina: () => this.stamina.fraction,
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
      airborne: () => this.flight.aloft,
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
    this.onDeath?.();
  }

  dispose(): void {
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
    this.debugDie.dispose();
    this.weatherChip.dispose();
    this.compass.dispose();
    this.rain.dispose();
    this.detachSettings();
    this.detachKill();
    onHdTile(null);
    forgetHd();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
      // `thirst` stays in the schema so saves written while the water
      // existed still load; nothing feeds it now.
      meters: { stamina: this.stamina.fraction, thirst: 1 },
      elapsed: this.elapsed,
      playedSeconds: this.lived,
    };
  }

  /** Where QUIT TO MENU goes. */
  onLeave(run: () => void): void {
    this.leaving = run;
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
    this.savedRegion = save.region;
    this.lived = save.playedSeconds;
    this.elapsed = save.elapsed;
    this.stamina.restore(save.meters.stamina);
    this.setWings(save.body.winged);
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Clamp dt so a backgrounded tab does not teleport the ant on return.
    const dt = Math.min(this.clock.getDelta(), 0.1);

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
    const look = this.look.read(dt);
    const stick = this.stick.read();

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
    const asking = this.sprintOn || this.paceUI.sprintHeld;
    if (!asking) this.reask = false;
    const wants = asking && !this.reask && !this.stamina.spent;

    const travel = resolve({
      stick,
      pace: this.pace,
      sprinting: wants,
      auto: this.auto.active ? this.auto.way : 0,
    });

    // ── Air or ground ────────────────────────────────────────────
    // Takeoff is offered on ACTUAL speed, never the selected pace:
    // picking Run and then barely moving must not get her airborne.
    // The lever comes home on its own when nobody is holding it.
    this.liftSlider.update(dt);
    const wantsUp = this.liftSlider.takeTakeoff();
    if (!this.flight.aloft && wantsUp) {
      // She keeps the way she was running. A takeoff does not turn her.
      const paid = this.flight.takeOff(
        this.ant.pace, this.stamina.fraction, this.ant.bearing,
      );
      if (paid > 0) {
        this.stamina.spend(paid);
        // AN AIRBORNE QUEEN DOES NOT FLY TAIL-FIRST. Auto astern is for
        // hauling something backwards along the ground; carried into
        // the air it would mean powered reverse flight, which no winged
        // animal does. Turned round rather than cancelled, so a player
        // who locked Auto and took off keeps the thing they asked for.
        if (this.auto.active && this.auto.way === -1) this.auto.flip();
      }
    }

    let winded = false;
    if (this.flight.aloft) {
      const step = this.flight.update(
        {
          push: stick.y,
          side: stick.x,
          lift: this.liftSlider.lift,
          // THE LIT PACE ROW IS THE POWER SETTING, in the air as well
          // as on the ground. Auto already flew at it; the stick did
          // not, so the lowest row and the highest were the same
          // flight and the readout sat at 100% either way.
          ceiling: AUTO_AIRSPEED[this.pace],
          // AUTO IN THE AIR holds an airspeed for the selected pace, so
          // the thumb is free to steer, look and climb. Lateral input,
          // the camera and both buttons leave it engaged; only a
          // deliberate fore/aft push takes manual control back, which
          // is the same rule it follows on the ground.
          hold: this.auto.active ? AUTO_AIRSPEED[this.pace] : null,
        },
        this.stamina.fraction,
        this.stamina.spent,
        dt,
        // The DRAWN ground under her, the same surface she would land
        // on — so holding an altitude means holding it against the
        // island the player can actually see.
        groundHeight(this.ant.where.wx, this.ant.where.wz),
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
      // Only charge her for a sprint she is actually getting: calling
      // for one while stopped or reversing costs nothing.
      const sprinting = wants && travel.speed > PACE_SPEED[this.pace] + 1e-3;
      const resting = this.ant.pace < 0.05;
      this.effort = sprinting ? SPRINT_DRAIN
        : resting ? RESTING_RECOVERY : MOVING_RECOVERY;
      winded = this.stamina.update(this.effort, dt);
      this.ant.update(
        { ahead: travel.ahead, across: travel.across, speed: travel.speed },
        -look.yaw, dt,
      );
    }

    // Exhaustion drops her to the sustainable pace, never to a halt —
    // and the next sprint has to be asked for deliberately.
    if (winded) {
      this.sprintOn = false;
      this.reask = true;
    }

    const telemetry = this.readFlight(dt);
    this.lastFlight = telemetry;
    this.paceUI.show(
      this.pace, wants, this.stamina.spent,
      // Over the GROUND. On foot that is her pace; in the air it is the
      // vector sum with the wind, which is a different number and the
      // one the second line exists to contrast with.
      this.flight.aloft ? Math.hypot(telemetry.ground.x, telemetry.ground.z) : this.ant.pace,
      this.auto.active, this.auto.way,
      this.flight.aloft ? telemetry.airspeed : null,
    );
    this.flightHud.show(telemetry, this.flight.aloft, this.seeFlight(telemetry));
    // The RATE goes with the reserve, so the readout can say how long
    // what she is doing right now can go on rather than how much
    // sprinting the bar would be worth.
    // WINGS BEAT WHEN SHE IS FLYING THEM. A glide is not a beat — she
    // is holding them out, not working them — and neither is standing
    // on the ground with them folded.
    this.queen?.beat(
      dt,
      this.flight.aloft && this.flight.where !== 'glide',
    );
    // THE CAMERA, not her body. Asked of the camera itself rather than
    // of the look controller, so there is no second convention to keep
    // in step: whatever is actually being rendered from is what the
    // compass reports.
    const view = new THREE.Vector3();
    this.follow.camera.getWorldDirection(view);
    this.compass.update(
      bearingOf(view.x, view.z), this.ant.where, this.markers, dt,
      {
        fix: settings().showFix
          ? { msl: this.mslNow(), pitch: pitchOf(view.y), relief: reliefScale() }
          : null,
        // HER NOSE, not the camera's. In flight they part company the
        // moment she looks around, and the pairing with the flight
        // panel's ground line only means anything if this one is hers.
        air: this.flight.aloft
          ? { heading: telemetry.heading, speed: telemetry.airspeed }
          : null,
        ground: this.flight.aloft
          ? {
            track: telemetry.track,
            speed: telemetry.groundSpeed,
            drift: telemetry.drift,
          }
          : null,
        // Only when there is a wind to speak of. The readout resolves
        // to a tenth of a centimetre a second; below that there is
        // nothing to say and a permanent "0.0" is a row nobody reads.
        wind: this.flight.aloft && telemetry.wind.speed >= 0.05
          ? {
            speed: telemetry.wind.speed,
            relative: telemetry.wind.bearing - telemetry.heading,
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
    // THE RESERVE IS HELD, NOT DRAINING. CLAUDE.md's survival rule is
    // that a bar may only move if there is a way to move it back, and
    // with the water gone there is nothing on the island to drink
    // from. So it is shown full and still rather than counting down to
    // a state she cannot leave. `Thirst` keeps its drain law intact for
    // when water returns; nothing here advances it.
    this.vitals.aloft(this.flight.aloft);
    this.vitals.show(this.stamina.fraction, this.stamina.spent, this.effort);
    this.vitals.thirst(this.thirst.fraction, this.thirst.parched, false, 0);

    // NOTHING TO TICK. The grace is a deadline, so the only question
    // each frame is what time it is — which is why backgrounding the
    // tab or losing the page can no longer buy extra protection.
    if (this.grace.takeExpiry()) this.noticeLeft = PROTECTION_NOTICE;
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
    this.liftSlider.enable(leverFor(
      this.flight.aloft,
      this.flight.canTakeOff(this.ant.pace, this.stamina.fraction),
    ));
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
    }
    // THE FINE GROUND FOLLOWS HER TOO. Fire-and-forget: a tile that has
    // not landed is answered by the coarse grid, which holds the same
    // number at every sample the two share, so the ground sharpens
    // rather than moves when one arrives.
    followHd(at.wx, at.wz);
    this.terrain.follow(at);
    // THE WATER FOLLOWS HER TOO, and is seated in the same breath as
    // the terrain — a window left against the old origin would draw
    // the river a rebase-width away from its own valley.
    this.water?.follow(at);
    this.water?.update(dt);
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
        this.flight.aloft ? this.flight.heading : null,
      );
    }

    // Read AFTER she has moved: this is what she is actually doing,
    // which the easing makes different from what was asked for.
    this.speed = this.ant.pace;
    this.follow.update(this.ant.root, look, dt);
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
    const agl = msl - groundHeight(at.wx, at.wz);
    const look = (fix.pitch * Math.PI) / 180;
    if (agl > 1) this.flight.hold(agl, heading);
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

  private readFlight(dt: number): FlightTelemetry {
    const here = this.ant.where;
    const terrain = groundHeight(here.wx, here.wz);
    const agl = this.flight.height;
    const altitude = terrain + agl;
    // MEASURED, not reconstructed: her actual displacement over the
    // island, which already contains her airspeed, the wind, and
    // anything the movement pipeline grows later.
    const ground = this.ant.overGround;
    this.heldTrack = trackOf(ground, this.heldTrack);

    const from = { wx: here.wx, wz: here.wz, altitude };
    const climbing = this.flight.climbing;
    const sample = (wx: number, wz: number): number => groundHeight(wx, wz);

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
    const spot = this.flight.aloft
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
    const sky = this.nowWeather;
    if (!sky) return null;
    // Nothing at her feet, all of it at ten metres. Cheapest possible
    // exit too: on the ground this is exactly zero and the vector maths
    // below never runs.
    // AGL for the profile, and that stays AGL on purpose: how much
    // wind there is depends on how far off the deck she is, which is a
    // different question from what altitude she is holding.
    const reach = windProfile(this.flight.height) * settings().windInfluence;
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
      here.wx, here.wz, groundHeight(here.wx, here.wz) + this.flight.height,
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
    this.bandsReady = bands.ready;
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
    this.water = new IslandWater(this.scene);
    this.water.follow(this.ant.where);
  }


}
