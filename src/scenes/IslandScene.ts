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
  FAR_VERTS, groundDetail, groundHeight, ISLAND_SPAN, NEAR_VERTS, SECTIONS,
  setRelief, setSmoothing, smoothingAmount, terrainHeight,
} from '../world/heightfield';
import { findLandfall, type HeightGrid } from '../world/kauai';
import { bakeGrain, GRAIN_SIZE } from '../world/groundTexture';
import { loadBands, reliefUniform, terrainMaterial } from '../world/terrainMaterial';
import { SettingsPanel } from '../ui/SettingsPanel';
import { Vitals } from '../ui/Vitals';
import { liveStat } from '../ant/castes';
import { ActionPad, type Action } from '../input/ActionPad';
import { Flight } from '../ant/flight';
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
const SOIL_TINT = new THREE.Color(1.22, 0.98, 0.72);

const SKY_COLOR = 0x9cc8e8;

/** Section meshes per side. */
/** Vertices per side within a section, up close and far away. */
/**
 * How far the detailed geometry reaches. Drawing the whole island at
 * full resolution is half a million triangles a frame, most of it
 * kilometres of ant-scale distance away; this keeps the detail where
 * she can see it and spends a fortieth of the triangles on the rest.
 * Generous on purpose, so the swap happens where it cannot be seen.
 */
const NEAR_RANGE = 1250;

interface Section {
  readonly x: number;
  readonly z: number;
  readonly near: THREE.Mesh;
  readonly far: THREE.Mesh;
}

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
  /** The relief the island is currently BUILT at. NaN until shaped. */
  private shaped = Number.NaN;
  private readonly ant = new PlayerAnt();
  private readonly clock = new THREE.Clock();
  private readonly sections: Section[] = [];
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
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 400, 3800);

    this.buildLights();
    // SMOOTHING FIRST, because it decides what the vertices ARE and
    // the mesh is about to be cut from them. Relief comes after, in
    // reshapeIsland, because that one is a transform ON the finished
    // mesh. Get either the wrong side of its build and the island is
    // drawn at one shape while she walks another — which is precisely
    // the bug that put her inside an invisible hill last release.
    setSmoothing(settings().terrainSmoothing);
    this.buildTerrain();
    this.buildWater();

    // AFTER the terrain exists and BEFORE she is placed. Both halves
    // matter: the sections have to be there to be scaled, and she has
    // to be put down on the island's final height or she spawns inside
    // a hill. Getting this wrong drew the island at full height while
    // she stood at the flattened one — and since backfaces are culled,
    // the hill she was buried in simply vanished and left open sea.
    this.reshapeIsland();

    // Pick the opening spot from the real terrain rather than a
    // hand-typed coordinate a re-bake could drop into the sea.
    const start = findLandfall(grid, 3, 20);
    const facing = Math.atan2(-start.x, -start.z);
    this.ant.placeAt(start.x, start.z, facing);
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
      where: () => this.ant.root.position.toArray(),
      cameraAt: () => this.follow.camera.position.toArray(),
      groundUnderfoot: () =>
        groundHeight(this.ant.root.position.x, this.ant.root.position.z),
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
  private reshapeIsland(): void {
    const relief = settings().terrainRelief;
    // Against its own record rather than the uniform: seeding the
    // uniform early made the first call look like a no-op, so the
    // meshes were never scaled at all.
    if (relief === this.shaped) return;
    this.shaped = relief;
    setRelief(relief);
    reliefUniform.value = relief;
    for (const section of this.sections) {
      section.near.scale.y = relief;
      section.far.scale.y = relief;
    }
    // She is standing on ground that just moved under her.
    this.ant.reground();
  }

  /**
   * Re-cut the island at a new smoothing.
   *
   * Unlike the height dial this CANNOT be a transform: a blur mixes
   * neighbouring samples, so the vertices genuinely move and every
   * section's geometry has to be built again. Roughly six hundred
   * thousand height lookups, which is why the slider commits on release
   * rather than on every pixel of a drag.
   */
  private resmoothIsland(): void {
    const wanted = settings().terrainSmoothing;
    if (wanted === smoothingAmount()) return;
    setSmoothing(wanted);

    const span = ISLAND_SPAN / SECTIONS;
    for (const section of this.sections) {
      const originX = section.x - span / 2;
      const originZ = section.z - span / 2;
      // Dispose before dropping the reference: geometry lives on the
      // GPU and the collector cannot free it for us.
      section.near.geometry.dispose();
      section.far.geometry.dispose();
      section.near.geometry = buildSection(originX, originZ, span, NEAR_VERTS);
      section.far.geometry = buildSection(originX, originZ, span, FAR_VERTS);
    }
    // The ground she is standing on just changed shape under her.
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
    // Read AFTER she has moved: this is what she is actually doing,
    // which the easing makes different from what was asked for.
    this.speed = this.ant.pace;
    this.follow.update(this.ant.root, look, dt);
    this.chooseDetail();
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

    const material = terrainMaterial(loadBands(this.renderer), grain);
    const span = ISLAND_SPAN / SECTIONS;
    for (let sz = 0; sz < SECTIONS; sz++) {
      for (let sx = 0; sx < SECTIONS; sx++) {
        const originX = -ISLAND_SPAN / 2 + sx * span;
        const originZ = -ISLAND_SPAN / 2 + sz * span;
        const near = new THREE.Mesh(buildSection(originX, originZ, span, NEAR_VERTS), material);
        const far = new THREE.Mesh(buildSection(originX, originZ, span, FAR_VERTS), material);
        this.scene.add(near, far);
        this.sections.push({
          x: originX + span / 2,
          z: originZ + span / 2,
          near,
          far,
        });
      }
    }
    this.chooseDetail();
  }

  /**
   * Show each section at the resolution its distance deserves. The
   * coarse mesh samples a subset of the fine one's grid, so the two
   * agree at the corners and the swap does not pop the skyline.
   */
  private chooseDetail(): void {
    const { x, z } = this.ant.root.position;
    for (const section of this.sections) {
      const close = Math.hypot(section.x - x, section.z - z) < NEAR_RANGE;
      section.near.visible = close;
      section.far.visible = !close;
    }
  }

  private buildWater(): void {
    const water = new THREE.Mesh(
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
    water.rotation.x = -Math.PI / 2;
    this.scene.add(water);
  }
}

/**
 * One patch of island. Heights are sampled on a grid one ring WIDER
 * than the patch so every vertex has neighbours on all sides, which is
 * what lets the normals be exact at the section's edges.
 */
function buildSection(
  originX: number,
  originZ: number,
  span: number,
  verts: number,
): THREE.BufferGeometry {
  const quads = verts - 1;
  const step = span / quads;
  const wide = verts + 2;

  const heights = new Float32Array(wide * wide);
  for (let r = 0; r < wide; r++) {
    for (let c = 0; c < wide; c++) {
      heights[r * wide + c] = terrainHeight(
        originX + (c - 1) * step,
        originZ + (r - 1) * step,
      );
    }
  }

  const count = verts * verts;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tint = new THREE.Color();

  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const i = iz * verts + ix;
      const x = originX + ix * step;
      const z = originZ + iz * step;
      const at = (c: number, r: number) => heights[r * wide + c];
      const h = at(ix + 1, iz + 1);

      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;


      // Central differences give the true surface gradient, so sections
      // agree along their shared edges and the seams disappear.
      const dhdx = (at(ix + 2, iz + 1) - at(ix, iz + 1)) / (2 * step);
      const dhdz = (at(ix + 1, iz + 2) - at(ix + 1, iz)) / (2 * step);
      const len = Math.hypot(dhdx, 1, dhdz);
      normals[i * 3] = -dhdx / len;
      normals[i * 3 + 1] = 1 / len;
      normals[i * 3 + 2] = -dhdz / len;

      // Shading only — what the ground IS comes from the band textures
      // in terrainMaterial.ts, which this multiplies.
      const slope = Math.hypot(dhdx, dhdz);
      tint.setRGB(1, 1, 1);
      if (h > 0) tint.lerp(SOIL_TINT, Math.min(0.6, slope * 0.55));
      tint.multiplyScalar(1 + groundDetail(x, z) * 0.11);
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
  }

  const indices = new Uint32Array(quads * quads * 6);
  let at = 0;
  for (let iz = 0; iz < quads; iz++) {
    for (let ix = 0; ix < quads; ix++) {
      const tl = iz * verts + ix;
      const tr = tl + 1;
      const bl = tl + verts;
      const br = bl + 1;
      indices[at++] = tl;
      indices[at++] = bl;
      indices[at++] = tr;
      indices[at++] = tr;
      indices[at++] = bl;
      indices[at++] = br;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
