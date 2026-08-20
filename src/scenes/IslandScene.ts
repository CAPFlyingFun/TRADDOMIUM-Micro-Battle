import * as THREE from 'three';
import { PlayerAnt } from '../ant/PlayerAnt';
import { FollowCamera } from '../camera/FollowCamera';
import { GaitThrottle } from '../input/GaitThrottle';
import { LookDrag } from '../input/LookDrag';
import { MoveStick } from '../input/MoveStick';
import { gaitFromDeflection, type Gait } from '../ant/gait';
import {
  bandFor, groundDetail, groundHeight, ISLAND_SPAN, type Band,
} from '../world/heightfield';
import { findLandfall, type HeightGrid } from '../world/kauai';

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

const BAND_COLORS: Record<Band, THREE.Color> = {
  seabed: new THREE.Color(0x2f4757),
  reef: new THREE.Color(0x6f8f7d),
  sand: new THREE.Color(0xdccb88),
  lowland: new THREE.Color(0x6f9a48),
  jungle: new THREE.Color(0x3d6b32),
  cliff: new THREE.Color(0x8a7d6b),
  peak: new THREE.Color(0xa9a396),
};

/** Bare earth shown through the cover wherever the ground steepens. */
const SOIL_COLOR = new THREE.Color(0x6d5940);

const SKY_COLOR = 0x9cc8e8;

/** Section meshes per side. */
const SECTIONS = 8;
/** Vertices per side within a section, up close and far away. */
const NEAR_VERTS = 65;
const FAR_VERTS = 17;
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
  private readonly throttle: GaitThrottle;
  private readonly look: LookDrag;
  private readonly ant = new PlayerAnt();
  private readonly clock = new THREE.Clock();
  private readonly sections: Section[] = [];
  private currentGait: Gait = 'walk';
  /** Bearing auto-move is holding, or null while she is hand-driven. */
  private autoBearing: number | null = null;
  /** Cruising gait, chosen on the throttle while auto-move runs. */
  private autoGait: Gait = 'walk';
  /**
   * The last gait she was actually travelling at. Auto-move engages
   * from a centred stick — always, for a double-tap — so reading the
   * live deflection there would lock in a crawl every time.
   */
  private lastMovingGait: Gait = 'walk';
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
    this.buildTerrain();
    this.buildWater();

    // Pick the opening spot from the real terrain rather than a
    // hand-typed coordinate a re-bake could drop into the sea.
    const start = findLandfall(grid, 3, 20);
    this.ant.placeAt(start.x, start.z, Math.atan2(-start.x, -start.z));
    this.scene.add(this.ant.root);

    this.stick = new MoveStick(host);
    this.throttle = new GaitThrottle(host);
    this.look = new LookDrag(host);
    this.follow = new FollowCamera(this.aspect());
    this.follow.snapTo(this.ant.root);

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
      gait: () => this.currentGait,
      autoMoving: () => this.autoBearing !== null,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.watchSize.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.stick.dispose();
    this.throttle.dispose();
    this.look.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Clamp dt so a backgrounded tab does not teleport the ant on return.
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const look = this.look.read(dt);
    const stick = this.stick.read(dt);

    const fromStick = gaitFromDeflection(stick.deflection);
    const driving = stick.deflection > 0;
    if (driving) this.lastMovingGait = fromStick;

    // Auto-move. A double-tap toggles it; a released hold starts it.
    if (stick.toggleAuto) {
      this.autoBearing = this.autoBearing === null ? this.ant.bearing : null;
      if (this.autoBearing !== null) this.autoGait = this.lastMovingGait;
    } else if (stick.engageAuto && this.autoBearing === null) {
      this.autoBearing = this.ant.bearing;
      this.autoGait = this.lastMovingGait;
    }

    const auto = this.autoBearing !== null;
    // The throttle only takes taps while auto-move is running, because
    // that is the only time there is no thumb on the stick to read.
    const picked = this.throttle.takeRequest();
    if (picked && auto) this.autoGait = picked;

    // A hand on the stick always wins, and steers what auto-move will
    // carry on doing once the thumb lifts — cruise control, not a rail.
    if (auto && driving) {
      this.autoGait = fromStick;
      this.autoBearing = this.ant.bearing;
    }

    const gait = driving || !auto ? fromStick : this.autoGait;
    this.currentGait = gait;
    this.throttle.show(gait);
    this.throttle.setLive(auto);
    this.stick.showAuto(auto);

    const cameraYaw = Math.atan2(
      this.follow.camera.position.x - this.ant.root.position.x,
      this.follow.camera.position.z - this.ant.root.position.z,
    );
    // Read the field directly: it is null whenever auto-move is off,
    // so a hand on the stick is the only other thing to rule out.
    const bearing = driving ? null : this.autoBearing;
    this.ant.update({ move: stick, gait, bearing }, cameraYaw, dt);
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
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
    });
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
      heights[r * wide + c] = groundHeight(
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

      const slope = Math.hypot(dhdx, dhdz);
      tint.copy(BAND_COLORS[bandFor(h)]);
      if (h > 0) tint.lerp(SOIL_COLOR, Math.min(0.68, slope * 0.55));
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
