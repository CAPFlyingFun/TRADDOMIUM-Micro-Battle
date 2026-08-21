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
import { TerrainStream } from '../world/TerrainStream';
import { originAt, rebaseFor, setOrigin } from '../world/origin';
import { bakeGrain, GRAIN_SIZE } from '../world/groundTexture';
import {
  loadBands, ORIGIN_UNIFORM, reliefUniform, terrainMaterial,
} from '../world/terrainMaterial';
import { SettingsPanel } from '../ui/SettingsPanel';
import { Vitals } from '../ui/Vitals';
import { liveStat } from '../ant/castes';
import { ActionPad, type Action } from '../input/ActionPad';
import { Flight, setFlightScale } from '../ant/flight';
import {
  MOVING_RECOVERY, RESTING_RECOVERY, SPRINT_DRAIN,
} from '../ant/stamina';
import { loadQueen } from '../ant/queenModel';
import { onChange, settings } from '../ui/settings';

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
  private readonly climbButton: Action;
  private readonly descendButton: Action;
  private readonly flight = new Flight();
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
  /**
   * Watches the canvas host itself. Orientation changes fire `resize`
   * before the viewport has settled on some phones, so a handler that
   * only listens for the event reads the OLD size and leaves the canvas
   * at the wrong dimensions. An observer fires after layout instead.
   */
  private readonly watchSize = new ResizeObserver(() => this.onResize());
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    grid: HeightGrid,
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
    this.scene.fog = new THREE.FogExp2(SKY_COLOR, 0.00055);

    this.buildLights();
    // SMOOTHING FIRST, because it decides what the vertices ARE and
    // the mesh is about to be cut from them. Relief comes after, in
    // reshapeIsland, because that one is a transform ON the finished
    // mesh. Get either the wrong side of its build and the island is
    // drawn at one shape while she walks another — which is precisely
    // the bug that put her inside an invisible hill last release.
    setFlightScale(settings().flightSpeed);
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
    const start = findLandfall(grid, 3, 20);
    // Put the origin where she starts, so the first frame is already
    // rendering small numbers rather than five-million-unit ones.
    setOrigin(start.x, start.z);
    const seated = originAt();
    ORIGIN_UNIFORM.value.set(seated.x, seated.z);
    const facing = Math.atan2(-start.x, -start.z);
    this.ant.placeAt(start.x, start.z, facing);
    this.terrain.follow(start.x, start.z);
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
    // Both buttons are ALWAYS there. A control that appears and
    // disappears under a thumb already resting on it is worse than one
    // that greys out, and the design says so explicitly.
    this.climbButton = this.actions.add('⬆️', 'climb', 'Space');
    this.descendButton = this.actions.add('⬇️', 'descend', 'ShiftLeft');
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
    });
    // The view is a world bearing, so it has to be told where behind
    // her IS. Without this she opens side-on to her own camera.
    this.look.setYaw(-facing);
    this.follow = new FollowCamera(this.aspect());
    this.follow.snapTo(this.ant.root, -facing);

    // She plays in stick-legs from the first frame and becomes herself
    // when the mesh lands. A failed load leaves the placeholder up,
    // which is a playable game rather than an ant-shaped hole.
    void loadQueen()
      .then(({ model }) => { if (!this.disposed) this.ant.wear(model); })
      .catch((why) => console.warn('the queen model did not load', why));

    this.watchSize.observe(host);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    this.onResize();
    this.renderer.setAnimationLoop(this.tick);

    // What the headless probes measure the scene by.
    (window as unknown as Record<string, unknown>).__island = {
      triangles: () => this.renderer.info.render.triangles,
      drawCalls: () => this.renderer.info.render.calls,
      where: () => [this.ant.where.x, this.ant.root.position.y, this.ant.where.z],
      origin: () => originAt(),
      cells: () => this.terrain.cellCount,
      cameraAt: () => this.follow.camera.position.toArray(),
      // Her WORLD position, not her rendered one. root.position is
      // measured from the floating origin now, so asking the heightfield
      // about it samples a spot near the middle of the island instead
      // of the ground she is standing on.
      groundUnderfoot: () => groundHeight(this.ant.where.x, this.ant.where.z),
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
      stride: () => this.ant.stridePhase,
      deadzone: () => REST_DEADZONE,
      fov: () => this.follow.camera.fov,
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
    this.detachSettings();
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
      const paid = this.flight.takeOff(
        this.ant.pace, this.stamina.fraction, stick.y, stick.x,
      );
      if (paid > 0) this.stamina.spend(paid);
    }

    let winded = false;
    if (this.flight.aloft) {
      const step = this.flight.update(
        {
          push: stick.y,
          side: stick.x,
          climb: this.climbButton.held,
          descend: this.descendButton.held,
        },
        this.stamina.fraction,
        this.stamina.spent,
        dt,
      );
      winded = this.stamina.update(step.effort, dt);
      // Flight owns her velocity outright — it already carries her
      // momentum, so handing it through the walk's easing would smear
      // one model over the other.
      this.ant.fly(
        { ahead: step.ahead, across: step.across, speed: Math.hypot(step.ahead, step.across) },
        -look.yaw, dt, this.flight.height,
      );
      // Landing needs no button: descend until the ground arrives.
      if (this.flight.height <= 0) this.flight.land();
    } else {
      // Only charge her for a sprint she is actually getting: calling
      // for one while stopped or reversing costs nothing.
      const sprinting = wants && travel.speed > PACE_SPEED[this.pace] + 1e-3;
      const resting = this.ant.pace < 0.05;
      winded = this.stamina.update(
        sprinting ? SPRINT_DRAIN : resting ? RESTING_RECOVERY : MOVING_RECOVERY,
        dt,
      );
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
    this.vitals.show(this.stamina.fraction, this.stamina.spent);

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
    const shift = rebaseFor(at.x, at.z);
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
    this.terrain.follow(at.x, at.z);

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

  private aspect(): number {
    return this.host.clientWidth / Math.max(1, this.host.clientHeight);
  }

  private buildLights(): void {
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.3);
    sun.position.set(2000, 3000, 1400);
    const sky = new THREE.HemisphereLight(SKY_COLOR, 0x5a4a38, 0.85);
    this.scene.add(sun, sky);
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

    this.terrain = new TerrainStream(
      this.scene, terrainMaterial(loadBands(this.renderer), grain),
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
