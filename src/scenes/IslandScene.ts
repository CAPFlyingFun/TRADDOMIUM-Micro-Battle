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
  groundHeight, ISLAND_SPAN, setRelief, setSmoothing, smoothingAmount,
} from '../world/heightfield';
import { findLandfall, type HeightGrid } from '../world/kauai';
import { local, world, type WorldPoint } from '../world/coords';
import { TerrainStream, TIER_CUTS } from '../world/TerrainStream';
import { originAt, rebaseFor, setOrigin, toLocal, toWorld,
} from '../world/origin';
import { bakeGrain, GRAIN_SIZE } from '../world/groundTexture';
import {
  loadBands, ORIGIN_UNIFORM, reliefUniform, terrainMaterial,
} from '../world/terrainMaterial';
import { SettingsPanel } from '../ui/SettingsPanel';
import { Vitals } from '../ui/Vitals';
import { liveStat } from '../ant/castes';
import { ActionPad, type Action } from '../input/ActionPad';
import { DebugDie } from '../ui/DebugDie';
import { WeatherChip } from '../ui/WeatherChip';
import { Compass } from '../ui/Compass';
import { bearingOf, type CompassMarker } from '../ui/compassMath';
import { AUTO_AIRSPEED, Flight, setFlightScale } from '../ant/flight';
import { Grace } from '../ant/grace';
import {
  MOVING_RECOVERY, RESTING_RECOVERY, SPRINT_DRAIN,
} from '../ant/stamina';
import { loadQueen, type QueenBody } from '../ant/queenModel';
import { onChange, settings } from '../ui/settings';
import { weather } from '../weather/WeatherService';
import { skyLook } from '../weather/sky';
import { Rain } from '../weather/Rain';
import type { GameWeather } from '../weather/gameplay';

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
  private readonly debugDie: DebugDie;
  private readonly weatherChip: WeatherChip;
  private readonly compass: Compass;
  /**
   * What the compass points at. GLOBAL positions, recomputed into
   * bearings every frame — nothing here caches a direction.
   */
  private readonly markers: CompassMarker[] = [];
  private readonly climbButton: Action;
  private readonly descendButton: Action;
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
  /** The weather she is actually standing in, eased. */
  private nowWeather: GameWeather | null = null;
  private readonly ant = new PlayerAnt();
  private readonly clock = new THREE.Clock();
  private terrain!: TerrainStream;
  /**
   * The sea. It is centred on the island rather than on her, so it
   * moves with every rebase like everything else already placed.
   */
  private water!: THREE.Mesh;
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
    setSmoothing(settings().terrainSmoothing);
    this.buildTerrain();
    this.buildWater();

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
    ORIGIN_UNIFORM.value.set(seated.x, seated.z);
    const facing = found.heading;
    this.ant.placeAt(found.at.wx, found.at.wz, facing);
    this.terrain.follow(this.ant.where);
    this.reshapeIsland();
    this.scene.add(this.ant.root);

    this.stick = new MoveStick(host);
    this.paceUI = new PaceSelector(host);
    this.look = new LookDrag(host);
    this.panel = new SettingsPanel(host);
    // Her health, food and water come off the queen's stat table
    // rather than being typed here — this is the only place the data
    // file and the HUD meet, and it is a read, not a copy.
    this.actions = new ActionPad(host);
    this.debugDie = new DebugDie(host, () => this.kill());
    this.weatherChip = new WeatherChip(host);
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
    this.descendButton = this.actions.add('⬇️', 'descend', 'ShiftLeft');
    this.climbButton = this.actions.add('⬆️', 'climb', 'Space');
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
    });
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
    void loadQueen()
      .then((queen) => {
        if (this.disposed) return;
        this.ant.wear(queen.model);
        this.queen = queen;
        // Whatever was asked for before she arrived still holds: the
        // model lands a second or two late and must not undo a decision
        // taken in the meantime.
        queen.setWings(this.winged);
      })
      .catch((why) => console.warn('the queen model did not load', why));

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

    // What the headless probes measure the scene by.
    (window as unknown as Record<string, unknown>).__island = {
      triangles: () => this.renderer.info.render.triangles,
      drawCalls: () => this.renderer.info.render.calls,
      where: () => [this.ant.where.wx, this.ant.root.position.y, this.ant.where.wz],
      origin: () => originAt(),
      cells: () => this.terrain.cellCount,
      cameraAt: () => this.follow.camera.position.toArray(),
      // Her WORLD position, not her rendered one. root.position is
      // measured from the floating origin now, so asking the heightfield
      // about it samples a spot near the middle of the island instead
      // of the ground she is standing on.
      groundUnderfoot: () => groundHeight(this.ant.where.wx, this.ant.where.wz),
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
    this.look.dispose();
    this.panel.dispose();
    this.vitals.dispose();
    this.actions.dispose();
    this.debugDie.dispose();
    this.weatherChip.dispose();
    this.compass.dispose();
    this.rain.dispose();
    this.detachSettings();
    this.detachKill();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Clamp dt so a backgrounded tab does not teleport the ant on return.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.elapsed += dt;
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
    const wantsUp = this.climbButton.takeTaps() > 0;
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
          climb: this.climbButton.held,
          descend: this.descendButton.held,
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
      this.ant.update(travel, -look.yaw, dt, 0);
    }

    // Exhaustion drops her to the sustainable pace, never to a halt —
    // and the next sprint has to be asked for deliberately.
    if (winded) {
      this.sprintOn = false;
      this.reask = true;
    }

    this.paceUI.show(
      this.pace, wants, this.stamina.spent,
      this.ant.pace, this.auto.active, this.auto.way,
    );
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
    );
    this.vitals.show(this.stamina.fraction, this.stamina.spent, this.effort);
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

    // The buttons say what they DO right now. On the ground the up
    // button is a takeoff and the down button has nothing to descend
    // from; in the air they are climb and descend.
    if (this.flight.aloft) {
      this.climbButton.label('⬆️');
      this.climbButton.enable(!this.stamina.spent);
      this.descendButton.enable(true);
    } else {
      this.climbButton.label('🪽');
      this.climbButton.enable(
        this.flight.canTakeOff(this.ant.pace, this.stamina.fraction),
      );
      this.descendButton.enable(false);
    }
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
      this.water.position.x -= shift.x;
      this.water.position.z -= shift.z;
      // The ground texture tiles off world position, not rendered
      // position, or it slides sideways on every shift.
      const now = originAt();
      ORIGIN_UNIFORM.value.set(now.x, now.z);
      this.terrain.place();
    }
    this.terrain.follow(at);

    // WEATHER IS ASKED IN GLOBAL COORDINATES and drawn in local ones.
    // Her position decides what the sky is doing; the CAMERA's rendered
    // position decides where the drops go. Handing the second of those
    // to the field would make a shower follow the floating origin
    // around, which is exactly the confusion the typed coordinates
    // exist to prevent.
    const service = weather();
    const sky = service.update(at, dt);
    this.nowWeather = sky;
    this.applyWeather(sky);
    this.rain.update(this.follow.camera.position, sky, dt);
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
    this.renderer.render(this.scene, this.follow.camera);
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
    if (!this.disposed) this.renderer.render(this.scene, this.follow.camera);
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
      ...look([this.water], 'sea', 0),
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
  private windOnHer(): { x: number; z: number } | null {
    const wind = this.nowWeather?.windVelocity;
    if (!wind) return null;
    const share = settings().windInfluence;
    return { x: wind.x * share, z: wind.z * share };
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
    const bands = loadBands(this.renderer);
    this.terrain = new TerrainStream(
      this.scene,
      terrainMaterial(bands, grain),
      terrainMaterial(bands, grain, TIER_CUTS.transition),
      terrainMaterial(bands, grain, TIER_CUTS.middle),
      terrainMaterial(bands, grain, TIER_CUTS.backdrop),
    );
  }

  private buildWater(): void {
    this.water = new THREE.Mesh(
      new THREE.CircleGeometry(ISLAND_SPAN * 0.95, 96),
      new THREE.MeshStandardMaterial({
        color: 0x2a6a8f,
        transparent: true,
        // Clear enough to show the reef near the beach, opaque enough
        // that the deep seabed never reads through as a stain.
        opacity: 0.88,
        roughness: 0.25,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.frustumCulled = false;
    this.scene.add(this.water);
  }
}
