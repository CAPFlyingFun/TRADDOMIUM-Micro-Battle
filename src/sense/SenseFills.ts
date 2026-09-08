/**
 * THE ANTENNAE'S FILLS: one flat bright shape per thing the sweep has
 * reached, standing where the thing stands and sized to it.
 *
 * This is the half of the effect that makes a body VISIBLE. The names
 * floating over them are another file's job and the two never speak;
 * both read the same `Sighting[]` and neither arranges it.
 *
 * ─── why a stand-in and not the body ────────────────────────────────
 *
 * Nothing here has the thing's own mesh to paint. The world's objects
 * live in `flora/WorldObjects`' instanced families and the animals in
 * `fauna/FaunaView`'s pools and impostors, and reaching into either to
 * swap a material for ten seconds would put a gameplay effect inside two
 * renderers that own their own materials. So a fill is a STAND-IN drawn
 * beside the thing at the thing's size — the same answer `FaunaView`
 * already gives for an animal too far for a rig: an icosahedron scaled
 * to an ellipsoid, twenty triangles, one draw call for the lot.
 *
 * ─── one shape, three postures ──────────────────────────────────────
 *
 * A blade, a twig, a stone and a worm are different shapes, and one
 * geometry is what keeps this to a single draw call — so the shape is
 * one ellipsoid and the KIND chooses its proportions. Unlit and flat,
 * a fill has no shading at all, which means what the eye gets is a
 * silhouette: an upright sliver for what grows, a low lozenge for a
 * body, a squat lump for what a colony is built out of. That is a
 * second cue under the hue, and it survives a screenshot where the
 * colours wash out.
 *
 * A fill carries no heading. A `Sighting` does not have one, and
 * inventing a facing for a stone would be the renderer deciding
 * something about the world.
 *
 * ─── an instrument, but not a wallhack ──────────────────────────────
 *
 * Like the finder's pins these are unlit and untoned: the sun may not
 * decide how bright a sense is, or the effect would fail at night,
 * which is half of Kaua'i's day. That is the one part of "light decides
 * what shows" an instrument is allowed to ignore (CLAUDE.md).
 *
 * It is NOT allowed to ignore the world. A pin deliberately draws
 * through the ground, because its whole job is to say "there is a worm
 * under here you cannot see". A fill is the thing itself lit up, and a
 * thing seen through a hill is not a sense, it is a wallhack: the sweep
 * would claim to reach further than it does, which is the rule about a
 * readout never claiming more than it does (ARCHITECTURE §2.9) applied
 * to a shape. So `SEE_THROUGH_WORLD` is false and the fills are depth
 * tested — named, so the integrator can try the other answer on the
 * device without going looking for a boolean.
 *
 * ─── the floor grows the shape and never moves the thing ────────────
 *
 * A 2.5 mm aphid two metres off is under half a pixel: drawn honestly
 * at its own size it would be nothing at all, and Joshua's ask was
 * explicitly to "fill the insects with a solid color". So a fill is
 * never drawn smaller than `MIN_FILL_PIXELS` on screen. What the floor
 * may do is make the SHAPE bigger; what it may never do is move it —
 * the centre is computed from the thing's true size, so a floored fill
 * grows around the animal rather than lifting off it.
 */
import * as THREE from 'three';
import type { LocalPoint, WorldPoint } from '../world/coords';
import { toLocal as originToLocal } from '../world/origin';
import { SENSE_COLOURS, SENSE_KINDS, type SenseKind, type Sighting } from './senseTypes';

/**
 * A kind's stand-in, as fractions of the thing's longest axis.
 *
 * Every kind's larger number is exactly 1, and that is not a
 * coincidence to be tuned away: `SenseThing.size` IS the longest axis,
 * so the only free number per kind is how squat the group is across it.
 */
export interface FillShape {
  /** Across the ground. */
  readonly girth: number;
  /** Up from the ground. */
  readonly rise: number;
}

/**
 * GAME TUNING, from the posture of each group rather than from any one
 * member: a worm and an aphid are longer than they are tall, what grows
 * stands up, and a twig lies along the slope while a stone sits bedded
 * in it. Rough on purpose — the shape says which of the three groups
 * this is at a glance, and the name over it says what it actually is.
 */
export const FILL_SHAPE: Readonly<Record<SenseKind, FillShape>> = Object.freeze({
  creature: Object.freeze({ girth: 1, rise: 0.45 }),
  plant: Object.freeze({ girth: 0.3, rise: 1 }),
  material: Object.freeze({ girth: 1, rise: 0.55 }),
});

/**
 * The most fills drawn at once, nearest to the sweep first.
 *
 * The cost is not the triangles — one draw call of twenty-triangle
 * hulls is nothing beside the 11,000 grass blades already on screen —
 * it is the SCREEN. Past a couple of hundred flat bright shapes a close
 * radius reads as a wall of colour instead of as things, and the sweep
 * would be hiding the world it is describing. The drop costs little,
 * because strength already falls off with distance and the ones cut are
 * the faintest. GAME TUNING.
 */
export const FILL_CAP = 256;

/**
 * A fill at full strength, before the sighting's own strength
 * multiplies it. Not 1: a hairline of the real body showing through
 * reads as the thing lit up rather than as a plastic bead standing
 * where it used to be. GAME TUNING.
 */
export const FILL_OPACITY = 0.85;

/**
 * The smallest a fill is drawn, in PIXELS of the viewport's height.
 * About a fortieth of a 430-pixel phone screen — plainly visible at
 * arm's length, and well under the finder's 26-pixel pin, because a pin
 * says "look over here" and a fill only says "this is a thing".
 * GAME TUNING.
 */
export const MIN_FILL_PIXELS = 10;

/**
 * How much proud of the thing the stand-in is drawn. The fill occupies
 * the same space as the body it stands for, so at 1.0 the two would
 * z-fight along every surface where they touch and the fill would come
 * out chewed. GAME TUNING: 8% is past any lump the ellipsoid is
 * approximating without reading as a halo.
 */
export const FILL_SWELL = 1.08;

/**
 * Whether a fill draws through the ground. FALSE — see the header: a
 * sense that reached through a hill would claim more than it does.
 * Named because it is a decision and not an accident.
 */
export const SEE_THROUGH_WORLD = false;

/** After the world and the water, before the finder's pins. */
export const FILL_RENDER_ORDER = 3000;

/** Where a world position is drawn. `world/origin.toLocal` is the default; a test hands in its own. */
export interface SenseOrigin {
  toLocal(at: WorldPoint): LocalPoint;
}

/**
 * The camera facts the pixel floor needs: the vertical field in RADIANS,
 * the viewport's height in CSS pixels, and where the camera stands in
 * the same local frame the fills are drawn in. Passed rather than read
 * off a camera so a test can hold all three still.
 */
export interface SenseLens {
  readonly fovRadians: number;
  readonly heightPx: number;
  readonly at: THREE.Vector3;
}

export interface SenseFillsOptions {
  readonly origin?: SenseOrigin;
}

export class SenseFills {
  /** One group, added to the scene once. */
  readonly group = new THREE.Group();

  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  /**
   * Per-instance RGBA. three reads a four-component `color` attribute as
   * colour AND alpha (`USE_COLOR_ALPHA`), and an instanced one carries a
   * divisor, so this is per-instance opacity in stock three with no
   * shader patched — which is what lets a sighting's own strength be the
   * only thing that decides how bright its fill is.
   */
  private readonly tint: THREE.InstancedBufferAttribute;
  private readonly toLocal: (at: WorldPoint) => LocalPoint;
  /** One `Color` per kind, converted out of sRGB once rather than every frame. */
  private readonly hues: Readonly<Record<SenseKind, THREE.Color>>;
  private disposed = false;

  // Scratch, allocated once and grown only when the list outgrows it.
  private readonly pos = new THREE.Vector3();
  private order: number[] = [];
  private d = new Float64Array(FILL_CAP * 2);
  private readonly byDistance = (a: number, b: number): number => this.d[a] - this.d[b];

  private shown = 0;

  constructor(options: SenseFillsOptions = {}) {
    this.toLocal = options.origin ? (at) => options.origin!.toLocal(at) : originToLocal;
    // The same hull `FaunaView` uses for an impostor: twenty triangles,
    // convex, and unrecognisable as anything the island grows once it is
    // filled with a flat colour.
    this.geometry = new THREE.IcosahedronGeometry(1, 0);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(FILL_CAP * 4), 4);
    this.tint.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('color', this.tint);
    this.material = new THREE.MeshBasicMaterial({
      // Basic and untoned: no light reaches it, by construction.
      vertexColors: true,
      transparent: true,
      opacity: FILL_OPACITY,
      depthTest: !SEE_THROUGH_WORLD,
      // It does not occlude the fills behind it — a body inside a bush
      // should light up with the bush, not punch a hole in it.
      depthWrite: false,
      toneMapped: false,
      // The island's haze may not decide how bright a sense is; only
      // `strength` may.
      fog: false,
    });
    // FRONT faces only, and deliberately: the hull is closed and convex,
    // so its near faces cover it exactly once. Drawing the far ones too
    // would blend the fill over itself and make a thing look denser the
    // less of it there is to see.
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, FILL_CAP);
    this.mesh.name = 'sense:fills';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The fills ride the sweep's own radius around the camera, so their
    // bounds always contain the eye and a frustum test on last frame's
    // instances could only ever be wrong.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = FILL_RENDER_ORDER;
    this.mesh.count = 0;
    const hues = {} as Record<SenseKind, THREE.Color>;
    for (const kind of SENSE_KINDS) hues[kind] = new THREE.Color().setHex(SENSE_COLOURS[kind]);
    this.hues = hues;
    this.group.name = 'sense:fills';
    this.group.add(this.mesh);
  }

  /** How many fills the last frame drew. For the HUD; never fed back into anything drawn. */
  get drawn(): number {
    return this.shown;
  }

  /**
   * Fill everything the sweep has reached, nearest first, up to the cap.
   *
   * THERE IS NO SECOND OFF SWITCH. An empty list draws nothing, and an
   * empty list is exactly what a pulse that has run out hands over, so a
   * `setEnabled` here would be a second way to be off and a chance for
   * the two to disagree about which one the player is looking at.
   */
  update(sightings: readonly Sighting[], lens: SenseLens): void {
    if (this.disposed) return;
    const n = sightings.length;
    if (this.order.length !== n) this.order = new Array<number>(n);
    for (let i = 0; i < n; i += 1) this.order[i] = i;
    // Nearest first ONLY when the cap bites. Under it every sighting is
    // filled and the order between them is invisible; over it, the sort
    // is what makes the cap drop the far ones rather than an arbitrary
    // slice of somebody else's list. The distance sorted on is the
    // SWEEP's — how far the antennae had to reach — which is not the
    // camera's, and it is the sweep that is running out of room.
    if (n > FILL_CAP) {
      if (this.d.length < n) this.d = new Float64Array(n * 2);
      for (let i = 0; i < n; i += 1) this.d[i] = sightings[i].distance;
      this.order.sort(this.byDistance);
    }

    // The world size of one pixel at distance d is 2·d·tan(fov/2) / heightPx.
    const perPixel = lens.heightPx > 0 ? (2 * Math.tan(lens.fovRadians / 2)) / lens.heightPx : 0;
    const into = this.mesh.instanceMatrix.array as Float32Array;
    const tint = this.tint.array as Float32Array;
    const count = Math.min(n, FILL_CAP);
    for (let k = 0; k < count; k += 1) {
      const s = sightings[this.order[k]];
      const here = this.toLocal(s.at);
      const shape = FILL_SHAPE[s.kind];
      // `height` is where the thing meets the ground, so the hull is
      // lifted by half its own rise and stands ON the ground rather than
      // buried to the waist — the same seating `FaunaView` gives an
      // impostor. Computed from the TRUE size, so the floor below cannot
      // move it.
      this.pos.set(here.lx, s.height + (s.size * shape.rise) / 2, here.lz);
      const floor = this.pos.distanceTo(lens.at) * perPixel * MIN_FILL_PIXELS;
      const span = Math.max(s.size, floor) * FILL_SWELL;
      const rx = (span * shape.girth) / 2;
      const ry = (span * shape.rise) / 2;
      // An axis-aligned scale and a translation, written straight into
      // the buffer: composing a Matrix4 to say the same thing would be
      // more work for the fifteen numbers that are already known.
      const o = k * 16;
      into[o] = rx; into[o + 1] = 0; into[o + 2] = 0; into[o + 3] = 0;
      into[o + 4] = 0; into[o + 5] = ry; into[o + 6] = 0; into[o + 7] = 0;
      into[o + 8] = 0; into[o + 9] = 0; into[o + 10] = rx; into[o + 11] = 0;
      into[o + 12] = this.pos.x; into[o + 13] = this.pos.y; into[o + 14] = this.pos.z; into[o + 15] = 1;

      const hue = this.hues[s.kind];
      const t = k * 4;
      tint[t] = hue.r;
      tint[t + 1] = hue.g;
      tint[t + 2] = hue.b;
      // Clamped, because a fill may not come out brighter than the pulse
      // it belongs to however the caller arrived at the number.
      tint[t + 3] = s.strength > 1 ? 1 : s.strength > 0 ? s.strength : 0;
    }
    this.mesh.count = count;
    this.shown = count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tint.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.shown = 0;
    this.group.remove(this.mesh);
    this.mesh.count = 0;
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
