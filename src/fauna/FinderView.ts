/**
 * THE FINDER'S PINS: one marker over every animal the simulation is
 * holding, drawn so a person can actually see where they are.
 *
 * THIS IS AN INSTRUMENT, NOT PART OF THE WORLD, and it is the one thing
 * in `src/` that is allowed to look like it. It is unlit, it ignores the
 * depth buffer, and it holds the same size on screen at any distance —
 * three properties that would be bugs in a renderer and are the entire
 * specification of a gizmo. In particular it does NOT follow "light
 * decides what shows" (CLAUDE.md): a pin that dimmed at dusk would fail
 * exactly when the animals are hardest to find. Nothing here is ever on
 * a screenshot of the game; the toggle is off by default and the probe
 * shots are taken with it off.
 *
 * WHAT A PIN SAYS. It stands over the animal, tip down, in its species'
 * colour. A buried worm — the case the whole thing exists for, because
 * `FaunaView` correctly declines to draw a body under the ground — gets
 * a dimmed pin standing on the GROUND above it rather than down in the
 * soil with it, which reads as "under here" instead of as a worm you
 * cannot find however close you fly.
 *
 * CONSTANT SCREEN SIZE is what makes it a finder rather than a second
 * thing too small to see: a pin is `PIN_PIXELS` tall whether the animal
 * is a metre away or thirty, so the marker for a 2.5 mm aphid is exactly
 * as findable as the one for a 15 cm worm. The scale comes from the
 * camera's own vertical field and the viewport's height in pixels, so it
 * is right on a phone and on a desktop without a second constant.
 *
 * ONE DRAW CALL. Every pin is an instance of one four-sided pyramid and
 * stalk, coloured per instance. Nothing is allocated per frame.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UNDER_GROUND, type CreatureId, type CreatureState } from '../creatures';
import { distanceSquared, type LocalPoint, type WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';

/** Wall-clock, for the cost line only — never fed back into anything drawn. */
const now = (): number => performance.now();

/**
 * How tall a pin is drawn, in PIXELS of the viewport's height. Big
 * enough to catch the eye on a 430-pixel phone screen among grass;
 * small enough that forty of them are a scatter of markers rather than
 * a wall. GAME TUNING.
 */
export const PIN_PIXELS = 26;

/**
 * The most pins drawn at once, nearest first. The simulation's own caps
 * come to 240 animals at the high rung, so this is a ceiling that does
 * not normally bite; it exists so a future rung with larger caps cannot
 * turn the instrument into the most expensive thing on screen.
 */
export const PIN_CAP = 256;

/**
 * A pin's colours, per species: the one for an animal you can see, and
 * the one for an animal under the ground.
 *
 * Not the bodies' own colours (`FaunaView.LOOK`). A worm is a muddy
 * brown by daylight and a marker in that colour on a forest floor is
 * another thing to look for. These are chosen to be legible over green,
 * over sand and over water — the instrument's job — while still telling
 * the three species apart at a glance.
 *
 * BOTH STATES ARE BRIGHT. The buried one was tried DIM first and it was
 * the wrong way round: a worm is underground most of its life, so the
 * buried pin is the common case for the species the finder exists for,
 * and dimming it put the most important marker in the same tonal range
 * as the forest floor it stands on. So `buried` is the species' hue
 * washed out towards white — plainly different from the solid one, and
 * still the brightest thing on a dark floor. Measured against a real
 * forest screenshot: no pixel of the island lands within 20 per channel
 * of any of these six, which is what lets `probe:finder` count the pins
 * on the screen rather than take the HUD's word for it.
 */
export interface PinLook {
  readonly colour: number;
  readonly buried: number;
}

export const PIN_LOOK: Readonly<Record<CreatureId, PinLook>> = Object.freeze({
  // Warm coral: the worm is the one being hunted, so it is the loudest.
  earthworm: Object.freeze({ colour: 0xff6a4d, buried: 0xffd0c4 }),
  aphid: Object.freeze({ colour: 0xc6ff4a, buried: 0xe8ffbe }),
  // A fly never burrows, so its second colour is only ever a placeholder
  // kept for the table's shape — the species table is what says so.
  housefly: Object.freeze({ colour: 0x6fd8ff, buried: 0xcdf1ff }),
  // The ants, for the Lab: gold for the queen, amber for the worker;
  // neither burrows yet, so the second colour is the table's shape.
  queen: Object.freeze({ colour: 0xffc83d, buried: 0xffe9a8 }),
  worker: Object.freeze({ colour: 0xff9a3d, buried: 0xffd9b0 }),
});

/** Where a world position is drawn. `world/origin.toLocal` is the default; a test hands in its own. */
export interface FinderOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

export interface FinderViewOptions {
  /** The ground's height at a point, world units. Without it, no pin can say a worm is buried. */
  readonly groundAt?: (at: WorldPoint) => number;
  readonly origin?: FinderOrigin;
}

/** What the pins cost and how many there are, for the HUD. Wall-clock, never fed back into anything. */
export interface FinderCost {
  readonly pins: number;
  readonly meanMs: number;
}

/**
 * The camera facts a pin needs to hold its size: the vertical field in
 * RADIANS and the viewport's height in CSS pixels. Passed rather than
 * read off a camera object so a test can hold both still.
 */
export interface FinderLens {
  readonly fovRadians: number;
  readonly heightPx: number;
  /** Where the camera is, in the same local frame the pins are drawn in. */
  readonly at: THREE.Vector3;
}

export class FinderView {
  /** One group; the toggle is one `visible`. */
  readonly group = new THREE.Group();

  private readonly pins: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  private readonly groundAt: ((at: WorldPoint) => number) | null;
  private disposed = false;

  // Scratch, allocated once.
  private readonly m = new THREE.Matrix4();
  private readonly colour = new THREE.Color();
  private readonly pos = new THREE.Vector3();
  private order: number[] = [];
  private d2 = new Float64Array(PIN_CAP * 2);

  private shown = 0;
  private frames = 0;
  private totalMs = 0;

  constructor(options: FinderViewOptions = {}) {
    this.toLocal = options.origin ? (at) => options.origin!.toLocal(at) : originToLocal;
    this.groundAt = options.groundAt ?? null;
    this.geometry = buildPin();
    this.material = new THREE.MeshBasicMaterial({
      // UNLIT AND THROUGH EVERYTHING, on purpose: see the header. A pin
      // behind a hill or under the soil is the one that matters most.
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    this.pins = new THREE.InstancedMesh(this.geometry, this.material, PIN_CAP);
    this.pins.name = 'finder:pins';
    this.pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pins.frustumCulled = false;
    // Last, over everything, including the sea and the sky dome.
    this.pins.renderOrder = 4000;
    this.pins.count = 0;
    this.group.name = 'finder';
    this.group.visible = false;
    this.group.add(this.pins);
  }

  /** On or off. Off costs one `visible` and no update work at all. */
  setEnabled(on: boolean): void {
    this.group.visible = on;
    if (!on) {
      this.pins.count = 0;
      this.shown = 0;
    }
  }

  get enabled(): boolean {
    return this.group.visible;
  }

  get cost(): FinderCost {
    return { pins: this.shown, meanMs: this.frames === 0 ? 0 : this.totalMs / this.frames };
  }

  resetCost(): void {
    this.frames = 0;
    this.totalMs = 0;
  }

  /**
   * Place a pin over every creature, nearest first, up to the cap.
   *
   * `focus` is the simulation's focus (the camera's world point) and
   * decides WHICH creatures get a pin when the cap bites; the lens's
   * position decides how big each one is drawn. They are usually the
   * same place and are two arguments because a bench camera can pull
   * back from the focus it is measuring.
   */
  update(creatures: readonly CreatureState[], focus: WorldPoint, lens: FinderLens): void {
    if (this.disposed || !this.group.visible) return;
    const started = now();
    const n = creatures.length;
    if (this.d2.length < n) this.d2 = new Float64Array(n * 2);
    if (this.order.length !== n) this.order = new Array<number>(n);

    // THROUGH `coords`, never by taking a point apart: this directory
    // reads no world coordinate at all (`tests/viewBoundary.test.ts`),
    // and a hand-rolled subtraction here is exactly the seam that rule
    // exists to keep shut.
    for (let i = 0; i < n; i += 1) {
      this.d2[i] = distanceSquared(creatures[i].at, focus);
      this.order[i] = i;
    }
    // Nearest first ONLY when the cap bites: under it every creature
    // gets a pin and the order between them is invisible, so a sort
    // every frame would buy nothing. Over it, the sort is what makes the
    // cap drop the far ones rather than an arbitrary slice of the list.
    if (n > PIN_CAP) this.order.sort((a, b) => this.d2[a] - this.d2[b]);

    // A pin is PIN_PIXELS tall on screen: the world size of one pixel at
    // distance d is 2·d·tan(fov/2) / heightPx.
    const perPixel = lens.heightPx > 0 ? (2 * Math.tan(lens.fovRadians / 2)) / lens.heightPx : 0;

    const count = Math.min(n, PIN_CAP);
    for (let k = 0; k < count; k += 1) {
      const c = creatures[this.order[k]];
      const local = this.toLocal(c.at);
      const ground = this.groundAt === null ? null : this.groundAt(c.at);
      const buried = ground !== null && ground - c.height > UNDER_GROUND;
      // A buried animal's pin stands on the ground over it — "dig here" —
      // rather than down in the soil where nothing can be seen anyway.
      const tipY = buried && ground !== null ? ground : c.height;
      this.pos.set(local.lx, tipY, local.lz);
      const height = Math.max(this.pos.distanceTo(lens.at) * perPixel * PIN_PIXELS, 0);
      this.m.makeScale(height, height, height);
      this.m.setPosition(this.pos);
      this.pins.setMatrixAt(k, this.m);
      const look = PIN_LOOK[c.species];
      this.colour.setHex(buried ? look.buried : look.colour);
      this.pins.setColorAt(k, this.colour);
    }
    this.pins.count = count;
    this.shown = count;
    this.pins.instanceMatrix.needsUpdate = true;
    if (this.pins.instanceColor !== null) this.pins.instanceColor.needsUpdate = true;

    this.frames += 1;
    this.totalMs += Math.max(0, now() - started);
  }

  dispose(): void {
    this.disposed = true;
    this.group.remove(this.pins);
    this.pins.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * The marker itself, built once at unit height with its TIP AT THE
 * ORIGIN so an instance's position is the thing it points at and its
 * scale is its height on screen.
 *
 * A four-sided pyramid, point down, under a thin stalk: twelve triangles
 * that read as a marker from any angle and cannot be mistaken for
 * anything the island grows.
 */
function buildPin(): THREE.BufferGeometry {
  const head = new THREE.ConeGeometry(0.16, 0.42, 4);
  // A cone is built point-up around its own middle; turn it over and lift
  // it so the point sits exactly at the origin.
  head.rotateX(Math.PI);
  head.translate(0, 0.21, 0);
  const stalk = new THREE.CylinderGeometry(0.03, 0.03, 0.58, 4);
  stalk.translate(0, 0.71, 0);
  const merged = mergeGeometries([head, stalk], false);
  head.dispose();
  stalk.dispose();
  if (merged === null) throw new Error('FinderView: the pin geometry would not merge');
  return merged;
}
