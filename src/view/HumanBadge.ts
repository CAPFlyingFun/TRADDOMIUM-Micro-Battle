/**
 * THE BADGE, HUNG ON A BODY — where `actor/humanBadge`'s two angles become
 * a card on a chest and a lanyard round a neck.
 *
 * Joshua, 2026-10-07: "I separated the badges from the body, so the badge
 * could be like a soft body or something to hang and move more freely."
 * The new toon Jack and Sarah carry no badge in their skin; the card and
 * its clip are `public/models/badge.glb`, baked by `scripts/bakeBadge.mjs`
 * into a frame that is the contract with this file:
 *
 *   metres · origin = the PIVOT, the clip's ring where the straps meet ·
 *   +y up, so the card hangs along −y · +z the printed face · the card's
 *   BACK at z ≈ 0, so a pivot placed on a shirt hangs a card ON it.
 *
 * ─── the wearer is MEASURED, never named ─────────────────────────────
 *
 * Where the badge hangs is read off the body's own bind-pose skin at
 * attach time, the way `actor/humanSkeleton` reads joints: the neck's
 * centre, radius and height from the vertices round the neck joint, and
 * the FRONT SURFACE of the torso as a little height map, the furthest-
 * forward vertex in each centimetre cell. Nothing here knows which body
 * is Jack and which is Sarah. Sarah's front is further out low down
 * because she is pregnant, and that is a fact about her vertices that the
 * height map reports, not a case in this file.
 *
 * The vertices are skinned on the CPU (`SkinnedMesh.getVertexPosition`)
 * with the skeleton at its bind rotations, then carried into the MODEL's
 * own frame — upright, facing +z, in metres, whatever the model is scaled
 * or placed by. Measuring in that frame is what makes every number below
 * a length on a person and not on the scene: `LabPeople` scales the body
 * by `UNITS_PER_METRE`, and none of these figures sees it.
 *
 * ─── one frame, carried by the chest ─────────────────────────────────
 *
 * The badge's ANCHOR is a group parented to the chest bone whose local
 * matrix is chosen once, at attach, so that its world frame IS the model
 * frame at bind: `anchor = chestᵇⁱⁿᵈ⁻¹ · model`. From then on the chest
 * carries it — a bow, a twist, a breath — and everything inside it (the
 * pivot, the ribbons) is written in the model frame's metres. The bone's
 * own axes, which are whatever Meshy emitted (`view/HumanRig`'s header),
 * never appear.
 *
 * Each frame `sense` reads the anchor's world matrix and hands the
 * pendulum (`actor/humanBadge`): gravity, the pivot's acceleration (a
 * finite difference of its world position over the last frames, divided
 * by the anchor's world scale to come out in metres) and the frame's turn
 * since last time, all in that frame. The STEP is not taken here — `view/`
 * reads actor state and never runs it — so the owner calls
 * `swingBadge(handle, rawDt)`, which senses, steps, and calls `show` to
 * put the angles on the pivot group and redraw the strap.
 *
 * ─── the lanyard is drawn, not modelled ──────────────────────────────
 *
 * The master's loop was laid out flat, and a flat loop cannot go round a
 * neck (`bakeBadge.mjs`'s header). So the straps are two flat ribbons
 * built here from the measured neck: from the clip, up over the chest's
 * front surface, round each side of the neck at its base and over the
 * shoulder line, to meet behind it. A Catmull-Rom curve through those
 * points, a strip of quads along it, the width lying across the curve and
 * flat to the body. The lowest two points ride on the swinging pivot, so
 * the straps follow the clip; the curve is re-evaluated each frame, which
 * for two strips of a couple of dozen vertices is nothing.
 *
 * ─── what this file may not import ───────────────────────────────────
 *
 * `view/` is an adapter: three, `actor/`, and nothing that owns where a
 * body stands. It owns the anchor group, the ribbons' geometry and their
 * material, and releases exactly those. The badge's geometry, material
 * and textures belong to the TEMPLATE, which the caller loaded once and
 * releases once; each body's badge is `template.clone()`, which shares
 * them.
 */
import * as THREE from 'three';
import type { BadgeInput, BadgeSensor, BadgeState } from '../actor/humanBadge';
import type { BindJoint, HumanMeasure } from '../actor/humanRig';
import { findSkinnedMesh } from './HumanRig';

/**
 * GAME TUNING. Where on a body a badge is worn and how its strap lies;
 * chosen by eye against renders of both bodies, inside what a real
 * lanyard does.
 */
export const BADGE_FIT = Object.freeze({
  /**
   * How far below the base of the neck the clip hangs, metres. A real
   * breakaway lanyard puts the card at the sternum, its ring about a hand
   * below the collar.
   */
  pivotDropM: 0.15,
  /** How far in front of the shirt the clip sits, metres: its own thickness. */
  pivotClearM: 0.006,
  /** How far in front of the shirt the card's back must stay, metres. */
  cardClearM: 0.004,
  /** The card's half-width plus a little, metres: the strip of chest it can touch. */
  cardHalfWidthM: 0.036,
  /** The card's height below the pivot, metres (card + clip ≈ 0.112 m). */
  cardLengthM: 0.112,
  /** The furthest the card swings out from the chest, past its rest, radians. */
  swingOutRad: 0.9,
  /** The furthest the card swings sideways, radians. */
  maxRollRad: 0.55,
  /** The strap's width, metres. */
  strapWidthM: 0.014,
  /** How far the strap lies off the skin, metres. */
  strapClearM: 0.004,
  /** Dark charcoal, the colour of a plain lanyard. */
  strapColour: 0x2b2d31,
  /** Points sampled along the strap's curve, clip to clip. */
  strapSamples: 72,
  /**
   * The acceleration's smoothing time, seconds. A finite difference of a
   * position twice over is noisy at an uneven frame rate; a light low-pass
   * keeps a walk's lurch and drops the jitter.
   */
  accelSmoothS: 0.03,
  /** A pivot that moves further than this in one frame was teleported, metres. */
  teleportM: 0.5,
});

/** What was measured off a body, in the MODEL frame (metres, upright, facing +z). */
export interface BadgeFit {
  /** The pivot, model frame. */
  readonly pivot: { readonly x: number; readonly y: number; readonly z: number };
  /** The pitch at which the card's back meets the body. */
  readonly restPitch: number;
  /** The neck's axis (x, z), the height its base is measured at, and its mean radius. */
  readonly neck: { readonly x: number; readonly z: number; readonly baseY: number; readonly radius: number };
  /** The strap's path round the +x side of the neck, front to back (mirrored for −x). */
  readonly collar: readonly { readonly x: number; readonly y: number; readonly z: number }[];
  /** The neck and chest joints at bind, model frame: what the rest was measured from. */
  readonly joints: { readonly neckY: number; readonly chestY: number; readonly chestZ: number };
  /** How many skin vertices the measurement read. */
  readonly vertices: number;
}

export interface BadgeOptions {
  /**
   * Put the skeleton at its bind rotations for the measurement — usually
   * `rig.rest` — when the body may already be posed. The pose it had is
   * restored afterwards. Without it, the body is assumed to be in its bind
   * pose (attach before the first `apply`).
   */
  readonly rest?: () => void;
  /** Cast and take shadows, matching the body. Default false. */
  readonly shadows?: boolean;
  /** A name for the console when something is missing. */
  readonly label?: string;
}

/**
 * A hung badge. Each frame, AFTER the body has been posed and placed, the
 * owner calls `actor/humanBadge.swingBadge(handle, rawDt)`: this handle
 * senses the chest and draws the card, and the pendulum is stepped in
 * `actor/`, because `view/` reads actor state and never runs it.
 */
export interface BadgeHandle extends BadgeSensor {
  readonly fit: BadgeFit;
  /**
   * Forget the pivot's motion history and hang the card still at its
   * rest: for a body that has just been put down somewhere new, so the
   * jump is not read as a lurch.
   */
  reset(): void;
  /** Off the body; the ribbons released. The template's geometry is not touched. */
  dispose(): void;
}

// --------------------------------------------------------------------------
// measuring the wearer
// --------------------------------------------------------------------------

/** One centimetre: the measurement's cell size. */
const CELL = 0.01;

interface FrontMap {
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  /** The furthest-forward z in each cell, or −Infinity where the body has none. */
  readonly z: Float32Array;
}

/** Furthest-forward z in a box of cells around (x, y) — conservative, so a strap or card clears the cell beside it too. */
function frontAt(map: FrontMap, x: number, y: number, halfX: number, halfY = CELL): number {
  const i0 = Math.max(0, Math.floor((x - halfX - map.x0) / CELL));
  const i1 = Math.min(map.nx - 1, Math.floor((x + halfX - map.x0) / CELL));
  const j0 = Math.max(0, Math.floor((y - halfY - map.y0) / CELL));
  const j1 = Math.min(map.ny - 1, Math.floor((y + halfY - map.y0) / CELL));
  let best = -Infinity;
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const z = map.z[j * map.nx + i];
      if (z > best) best = z;
    }
  }
  return best;
}

/** Every skin vertex of the model, in the model frame, with the skeleton as it is now. */
function skinVertices(model: THREE.Object3D): Float32Array {
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const meshes: THREE.SkinnedMesh[] = [];
  model.traverse((node) => {
    const skin = node as THREE.SkinnedMesh;
    if (skin.isSkinnedMesh === true && skin.geometry.getAttribute('position') !== undefined) meshes.push(skin);
  });
  let total = 0;
  for (const mesh of meshes) total += mesh.geometry.getAttribute('position').count;
  const out = new Float32Array(total * 3);
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let k = 0;
  for (const mesh of meshes) {
    // `getVertexPosition` answers in the mesh's own frame (its
    // `bindMatrixInverse` is the mesh's world inverse in 'attached' mode,
    // refreshed by the `updateMatrixWorld` above); from there to the model.
    m.multiplyMatrices(toModel, mesh.matrixWorld);
    const count = mesh.geometry.getAttribute('position').count;
    for (let i = 0; i < count; i += 1) {
      mesh.getVertexPosition(i, v).applyMatrix4(m);
      out[k] = v.x;
      out[k + 1] = v.y;
      out[k + 2] = v.z;
      k += 3;
    }
  }
  return out;
}

interface Measured {
  readonly fit: BadgeFit;
  readonly front: FrontMap;
  /** The strap's path round the neck, model frame, one side (+x); mirrored for the other. */
  readonly collar: THREE.Vector3[];
}

/**
 * The wearer, measured. `chestJoint` and `neckJoint` are model-frame
 * positions of those bones at bind; `verts` is `skinVertices`.
 */
function measureWearer(verts: Float32Array, neckJoint: THREE.Vector3, chestJoint: THREE.Vector3): Measured {
  const count = verts.length / 3;
  const fit = BADGE_FIT;

  // THE NECK: the ring of skin three centimetres above the neck joint,
  // within 7.5 cm of its axis (a neck is 4-7 cm in radius; hair hanging
  // behind it and the T-posed arms are well outside). Its depth centre is
  // the ring's middle — not the joint, which an auto-rig puts toward the
  // back — and its radius the ring's mean half-extent.
  const ringY = neckJoint.y + 0.03;
  let neckX = neckJoint.x;
  let neckZ = neckJoint.z;
  let neckR = 0.055;
  // The ring's middle, twice: the second pass is centred on the first, so
  // a joint an auto-rig set toward the back of the neck does not bias it.
  // X stays on the joint, the rig's centre line: a strand of hair on one
  // side of a neck would otherwise pull the centre toward it.
  for (let pass = 0; pass < 2; pass += 1) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const x = verts[i * 3];
      const z = verts[i * 3 + 2];
      if (Math.abs(verts[i * 3 + 1] - ringY) > 0.006) continue;
      if (Math.hypot(x - neckX, z - neckZ) > 0.075) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) break;
    neckZ = (minZ + maxZ) / 2;
    neckR = ((maxX - minX) + (maxZ - minZ)) / 4;
  }

  // THE FRONT: a height map of the furthest-forward skin per centimetre
  // cell, ±12 cm about the neck's axis, from the chin down to the hips.
  // Only vertices forward of the neck axis count, so a ponytail or the
  // back of a collar cannot be read as a chest.
  const x0 = neckX - 0.12;
  const y0 = chestJoint.y - 0.45;
  const nx = Math.round(0.24 / CELL) + 1;
  const ny = Math.round((neckJoint.y + 0.1 - y0) / CELL) + 1;
  const z = new Float32Array(nx * ny).fill(-Infinity);
  for (let i = 0; i < count; i += 1) {
    const vx = verts[i * 3];
    const vy = verts[i * 3 + 1];
    const vz = verts[i * 3 + 2];
    if (vz < neckZ) continue;
    const ci = Math.floor((vx - x0) / CELL);
    const cj = Math.floor((vy - y0) / CELL);
    if (ci < 0 || ci >= nx || cj < 0 || cj >= ny) continue;
    const at = cj * nx + ci;
    if (vz > z[at]) z[at] = vz;
  }
  const front: FrontMap = { x0, y0, nx, ny, z };

  // THE BASE OF THE NECK is where the front of the neck meets the chest:
  // walking down the centre line from the ring, the first height at which
  // the front surface steps more than 2 cm forward of the neck's own
  // front. The neck joint is a fallback, not the answer: it sits wherever
  // the rig put it.
  let baseY = neckJoint.y;
  const neckFront = neckZ + neckR;
  for (let y = ringY; y > neckJoint.y - 0.12; y -= CELL / 2) {
    const f = frontAt(front, neckX, y, 0.02, CELL / 2);
    if (Number.isFinite(f) && f > neckFront + 0.02) {
      baseY = y;
      break;
    }
  }

  // THE PIVOT: on the centre line, `pivotDropM` below the base of the
  // neck, just proud of the shirt there.
  const pivotY = baseY - fit.pivotDropM;
  let surface = frontAt(front, neckX, pivotY, 0.015, CELL);
  if (!Number.isFinite(surface)) surface = chestJoint.z + 0.1;
  const pivot = { x: neckX, y: pivotY, z: surface + fit.pivotClearM };

  // THE REST PITCH: the least pitch at which every point down the card's
  // back clears the front surface across the card's width. The card's
  // back passes through the pivot's z plane at pitch 0 and leans out as
  // the pitch grows, so a chest that slopes out below the clip — a bust,
  // a belly — pushes the rest forward, and one that falls away lets the
  // card hang straight (the rest is never asked to be less than 0 by
  // gravity, but may be, so the card can swing back that far).
  let restPitch = -0.35;
  for (let pitch = -0.35; pitch <= 1.2; pitch += 0.005) {
    restPitch = pitch;
    let clear = true;
    for (let d = 0.01; d <= fit.cardLengthM + 1e-9; d += 0.005) {
      const y = pivot.y - d * Math.cos(pitch);
      const back = pivot.z + d * Math.sin(pitch);
      const f = frontAt(front, pivot.x, y, fit.cardHalfWidthM, CELL / 2);
      if (Number.isFinite(f) && back < f + fit.cardClearM) {
        clear = false;
        break;
      }
    }
    if (clear) break;
  }

  // THE STRAP ROUND THE NECK, +x side, from the front of the neck's base
  // round to the middle of the back. Each point leans on the neck from
  // just outside it, at the height of whatever skin is under it there.
  const collar: THREE.Vector3[] = [];
  // In each direction round the neck, the TOP of the skin as a function of
  // the distance out from the neck's axis, in centimetre bins, below the
  // ring (above it is jaw, chin and hair). Walking outward, that profile
  // falls steeply down the side of the neck and then flattens onto the
  // shoulder: the strap rests in that corner, where a loop pulled down by
  // a card stops sliding. Behind the neck there may be no corner — the
  // neck runs straight into the back — and there the strap keeps the
  // height the sides gave it and lies against the neck.
  const BINS = 13;
  const tops = new Float64Array(BINS);
  const profile = (a: number): Float64Array => {
    tops.fill(-Infinity);
    for (let i = 0; i < count; i += 1) {
      const vy = verts[i * 3 + 1];
      if (vy > ringY + 0.005 || vy < ringY - 0.2) continue;
      const dx = verts[i * 3] - neckX;
      const dz = verts[i * 3 + 2] - neckZ;
      const da = Math.atan2(dx, dz) - a;
      if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > 0.21) continue;
      const bin = Math.round((Math.hypot(dx, dz) - 0.03) / CELL);
      if (bin < 0 || bin >= BINS) continue;
      if (vy > tops[bin]) tops[bin] = vy;
    }
    return tops;
  };
  const angles = [40, 75, 105, 140, 180];
  const found: Array<{ r: number; y: number } | null> = [];
  for (const deg of angles) {
    const top = profile((deg * Math.PI) / 180);
    let corner: { r: number; y: number } | null = null;
    for (let b = 0; b < BINS - 1; b += 1) {
      if (!Number.isFinite(top[b]) || !Number.isFinite(top[b + 1])) continue;
      // Still at the ring's own height is still the neck's wall, cut flat
      // by the cap rather than flattening onto a shoulder.
      if (top[b + 1] > ringY - 0.005) continue;
      if (top[b] - top[b + 1] < 0.008) {
        corner = { r: 0.03 + b * CELL, y: top[b] };
        break;
      }
    }
    found.push(corner);
  }
  // The sides' height, for the directions with no corner of their own.
  let sideY = 0;
  let sides = 0;
  for (let k = 1; k <= 3; k += 1) {
    const c = found[k];
    if (c !== null) { sideY += c.y; sides += 1; }
  }
  sideY = sides > 0 ? sideY / sides : baseY + 0.04;
  for (let k = 0; k < angles.length; k += 1) {
    const a = (angles[k] * Math.PI) / 180;
    // a = 0 is straight forward (+z), 90 is +x, 180 straight back.
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    let c = found[k];
    if (c === null) {
      // No corner: the neck's own radius at the sides' height.
      let r = 0;
      for (let i = 0; i < count; i += 1) {
        if (Math.abs(verts[i * 3 + 1] - sideY) > 0.006) continue;
        const ex = verts[i * 3] - neckX;
        const ez = verts[i * 3 + 2] - neckZ;
        const da = Math.atan2(ex, ez) - a;
        if (Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) > 0.21) continue;
        const rr = Math.hypot(ex, ez);
        if (rr < 0.11 && rr > r) r = rr;
      }
      c = { r: r > 0 ? r : neckR, y: sideY };
    }
    const r = c.r + CELL / 2 + fit.strapClearM;
    collar.push(new THREE.Vector3(neckX + dx * r, c.y + fit.strapClearM, neckZ + dz * r));
  }

  return {
    fit: {
      pivot, restPitch, neck: { x: neckX, z: neckZ, baseY, radius: neckR },
      collar: collar.map((c) => ({ x: c.x, y: c.y, z: c.z })),
      joints: { neckY: neckJoint.y, chestY: chestJoint.y, chestZ: chestJoint.z },
      vertices: count,
    },
    front,
    collar,
  };
}

// --------------------------------------------------------------------------
// attaching
// --------------------------------------------------------------------------

/**
 * Hang a clone of `template` on `model`'s chest. Returns null — with a
 * line in the console — when the body has no skeleton to hang it from
 * (the magenta placeholder, an empty node); a body without a badge is a
 * body, and nothing about it may fail for the badge's sake.
 */
export function attachBadge(
  model: THREE.Object3D,
  measure: HumanMeasure,
  bind: readonly BindJoint[],
  template: THREE.Object3D,
  options: BadgeOptions = {},
): BadgeHandle | null {
  const label = options.label ?? model.name ?? 'body';
  const skin = findSkinnedMesh(model);
  if (skin === null) {
    console.warn(`[badge] ${label}: no skeleton, so no badge`);
    return null;
  }
  const bones = skin.skeleton.bones;
  if (bones.length !== bind.length) {
    console.warn(`[badge] ${label}: the skeleton (${bones.length}) is not the one measured (${bind.length}); no badge`);
    return null;
  }
  const chest = bones[measure.joints.chest];
  const neck = bones[measure.joints.neck];
  if (chest === undefined || neck === undefined) {
    console.warn(`[badge] ${label}: no chest or neck bone; no badge`);
    return null;
  }

  // At bind for the measurement, then back to whatever pose it had.
  const saved = options.rest !== undefined ? bones.map((b) => b.quaternion.clone()) : null;
  options.rest?.();
  const verts = skinVertices(model);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const neckAt = neck.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
  const chestAt = chest.getWorldPosition(new THREE.Vector3()).applyMatrix4(toModel);
  const measured = measureWearer(verts, neckAt, chestAt);
  // The anchor: chest⁻¹ · model, so its world frame is the model frame at bind.
  const anchorLocal = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(model.matrixWorld);
  if (saved !== null) {
    for (let i = 0; i < bones.length; i += 1) bones[i].quaternion.copy(saved[i]);
    model.updateMatrixWorld(true);
  }

  return new HungBadge(chest, anchorLocal, measured, template, options.shadows ?? false);
}

/** Points the strap's run from the clip to the neck is sampled at, between its two ends. */
const CHEST_RUN = 10;

/** The run's scratch: parameter, height, and the hull's indices. */
const RUN = {
  s: new Float64Array(CHEST_RUN + 2),
  z: new Float64Array(CHEST_RUN + 2),
  hull: new Int32Array(CHEST_RUN + 2),
};

/** Scratch, shared: one badge updates at a time. */
const S = {
  m: new THREE.Matrix4(),
  p: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  qi: new THREE.Quaternion(),
  dq: new THREE.Quaternion(),
  s: new THREE.Vector3(),
  g: new THREE.Vector3(),
  a: new THREE.Vector3(),
  v: new THREE.Vector3(),
  t: new THREE.Vector3(),
  n: new THREE.Vector3(),
  w: new THREE.Vector3(),
};

class HungBadge implements BadgeHandle {
  readonly fit: BadgeFit;
  readonly state: BadgeState;

  private readonly anchor = new THREE.Group();
  private readonly hinge = new THREE.Group();
  private readonly card: THREE.Object3D;
  private readonly strap: THREE.Mesh;
  private readonly strapMaterial: THREE.MeshStandardMaterial;
  private readonly measured: Measured;
  /**
   * The strap's control points, ONE strap from clip to clip: the +x
   * side's clip, its run up the chest, round the +x side of the neck to
   * the middle of the back, and down the −x side in reverse. One curve and
   * not two, so it is smooth where the sides meet behind the neck.
   */
  private readonly points: THREE.Vector3[] = [];
  private readonly curve: THREE.CatmullRomCurve3;
  private bone: THREE.Bone | null;

  // The pivot's history, in WORLD units, and what was made of it.
  private primed = false;
  private readonly lastPivot = new THREE.Vector3();
  private readonly lastVel = new THREE.Vector3();
  private readonly accel = new THREE.Vector3();
  private readonly lastTurn = new THREE.Quaternion();
  private readonly input: { -readonly [K in keyof BadgeInput]-?: BadgeInput[K] } = {
    gx: 0, gy: -1, gz: 0, ax: 0, ay: 0, az: 0, turnX: 0, turnZ: 0,
    restPitch: 0, maxPitch: 0, maxRoll: BADGE_FIT.maxRollRad,
  };

  constructor(bone: THREE.Bone, anchorLocal: THREE.Matrix4, measured: Measured, template: THREE.Object3D, shadows: boolean) {
    this.bone = bone;
    this.measured = measured;
    this.fit = measured.fit;
    this.state = { pitch: measured.fit.restPitch, roll: 0, pitchRate: 0, rollRate: 0 };
    this.input.restPitch = measured.fit.restPitch;
    this.input.maxPitch = measured.fit.restPitch + BADGE_FIT.swingOutRad;

    this.anchor.name = 'badge-anchor';
    this.anchor.matrixAutoUpdate = false;
    this.anchor.matrix.copy(anchorLocal);
    this.hinge.name = 'badge-pivot';
    this.hinge.position.set(measured.fit.pivot.x, measured.fit.pivot.y, measured.fit.pivot.z);
    this.card = template.clone();
    this.card.name = 'badge';
    this.card.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh !== true) return;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
    });
    this.hinge.add(this.card);
    this.anchor.add(this.hinge);

    this.strapMaterial = new THREE.MeshStandardMaterial({
      color: BADGE_FIT.strapColour, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
    });
    const n = BADGE_FIT.strapSamples;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    const index: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(index);
    this.strap = new THREE.Mesh(geometry, this.strapMaterial);
    this.strap.name = 'badge-strap';
    // Rewritten every frame; its exported bounds would be stale at once.
    this.strap.frustumCulled = false;
    this.strap.castShadow = shadows;
    this.strap.receiveShadow = shadows;
    this.anchor.add(this.strap);

    // +x: clip, clip-up, the run; then the collar out to the back centre;
    // then the −x collar mirrored about the neck's centre line, the −x run
    // and clip, in reverse.
    const nx = measured.fit.neck.x;
    const collar = measured.collar;
    const P = (): THREE.Vector3 => {
      const v = new THREE.Vector3();
      this.points.push(v);
      return v;
    };
    for (let i = 0; i < 2 + CHEST_RUN; i += 1) P();
    for (const c of collar) P().copy(c);
    for (let k = collar.length - 2; k >= 0; k -= 1) P().set(2 * nx - collar[k].x, collar[k].y, collar[k].z);
    for (let i = 0; i < 2 + CHEST_RUN; i += 1) P();
    this.curve = new THREE.CatmullRomCurve3(this.points, false, 'centripetal');

    bone.add(this.anchor);
    this.anchor.updateMatrixWorld(true);
    this.pose();
  }

  sense(rawDt: number): BadgeInput | null {
    if (this.bone === null || !Number.isFinite(rawDt) || rawDt <= 0) return null;
    const { m, p, q, qi, dq, s, g, a, v } = S;
    // The anchor's matrix is fixed (`matrixAutoUpdate` off), so three
    // never flags its world matrix stale on its own: walking up the
    // parents recomputes THEIRS, and only a flag makes it multiply its own
    // through. Without this line the pendulum reads the chest where it
    // stood at attach, for ever.
    this.anchor.matrixWorldNeedsUpdate = true;
    this.anchor.updateWorldMatrix(true, false);
    m.copy(this.anchor.matrixWorld);
    m.decompose(p, q, s);
    const scale = s.x > 0 ? s.x : 1;
    qi.copy(q).invert();
    // The pivot in WORLD units.
    const f = this.fit.pivot;
    v.set(f.x, f.y, f.z).applyMatrix4(m);

    const input = this.input;
    if (!this.primed) {
      this.primed = true;
      this.lastPivot.copy(v);
      this.lastVel.set(0, 0, 0);
      this.accel.set(0, 0, 0);
      this.lastTurn.copy(q);
    }
    // Velocity, metres a second, from the pivot's travel this frame.
    a.copy(v).sub(this.lastPivot).divideScalar(scale);
    const moved = a.length();
    this.lastPivot.copy(v);
    if (moved > BADGE_FIT.teleportM) {
      // A teleport — a spawn, a seat snap — is not a lurch.
      this.lastVel.set(0, 0, 0);
      this.accel.set(0, 0, 0);
      this.lastTurn.copy(q);
    } else {
      a.divideScalar(rawDt);
      const vel = a;
      // Acceleration, low-passed (see `accelSmoothS`).
      const raw = g.copy(vel).sub(this.lastVel).divideScalar(rawDt);
      this.lastVel.copy(vel);
      const k = 1 - Math.exp(-rawDt / BADGE_FIT.accelSmoothS);
      this.accel.lerp(raw, k);
    }
    // Into the chest frame.
    a.copy(this.accel).applyQuaternion(qi);
    g.set(0, -1, 0).applyQuaternion(qi);
    // The frame's turn since last frame, in its own axes: Δ = q⁻¹ · q_prev.
    dq.copy(qi).multiply(this.lastTurn);
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    this.lastTurn.copy(q);

    input.gx = g.x;
    input.gy = g.y;
    input.gz = g.z;
    input.ax = a.x;
    input.ay = a.y;
    input.az = a.z;
    // The frame turned by Δ⁻¹ from the card's point of view; small-angle.
    input.turnX = -2 * dq.x;
    input.turnZ = -2 * dq.z;
    return input;
  }

  show(): void {
    if (this.bone !== null) this.pose();
  }

  reset(): void {
    this.primed = false;
    this.state.pitch = this.fit.restPitch;
    this.state.roll = 0;
    this.state.pitchRate = 0;
    this.state.rollRate = 0;
    if (this.bone !== null) this.pose();
  }

  dispose(): void {
    if (this.bone === null) return;
    this.bone.remove(this.anchor);
    this.bone = null;
    this.hinge.remove(this.card);
    this.strap.geometry.dispose();
    this.strapMaterial.dispose();
  }

  /** The angles onto the hinge, and the straps redrawn to follow the clip. */
  private pose(): void {
    const st = this.state;
    // Pitch out (+z) is a turn about −x; roll toward +x is a turn about +z
    // (see `actor/humanBadge`'s header for the hanging direction of each).
    this.hinge.rotation.set(-st.pitch, 0, st.roll, 'XZY');
    this.hinge.updateMatrix();

    const { fit, front } = this.measured;
    const hingeM = this.hinge.matrix;
    const pts = this.points;
    const last = pts.length - 1;
    const neckIn = 2 + CHEST_RUN;
    for (let side = 0; side < 2; side += 1) {
      const sign = side === 0 ? 1 : -1;
      // Index k of this side, counted from its clip.
      const at = (k: number): THREE.Vector3 => pts[side === 0 ? k : last - k];
      // The ring, either side of the pivot, and the strap leaving it along
      // the card's own up axis — both ride on the swinging hinge.
      at(0).set(sign * 0.003, 0.002, 0.003).applyMatrix4(hingeM);
      at(1).set(sign * 0.008, 0.022, 0.003).applyMatrix4(hingeM);
      this.runUpChest(at, neckIn, front);
    }
    this.writeStrap(fit);
  }

  /**
   * The strap from the clip to the neck is PULLED TIGHT by the card's
   * weight, so it runs straight where it can and over the body where it
   * cannot: in the plane of the run, its height off the line is the UPPER
   * CONVEX HULL of the body's front surface under it. That is what lays
   * it over a bust or a collarbone instead of through it, and leaves it
   * off a chest that falls away beneath it.
   */
  private runUpChest(at: (k: number) => THREE.Vector3, neckIn: number, front: FrontMap): void {
    const a = at(1);
    const b = at(neckIn);
    const s = RUN.s;
    const z = RUN.z;
    const n = CHEST_RUN + 2;
    for (let i = 0; i < n; i += 1) {
      const u = i / (n - 1);
      s[i] = u;
      const x = a.x + (b.x - a.x) * u;
      const y = a.y + (b.y - a.y) * u;
      let zz = a.z + (b.z - a.z) * u;
      if (i > 0 && i < n - 1) {
        const f = frontAt(front, x, y, 0.008, CELL / 2);
        if (Number.isFinite(f)) zz = Math.max(zz, f + BADGE_FIT.strapClearM);
      }
      z[i] = zz;
    }
    // Upper hull (monotone chain over increasing s).
    const hull = RUN.hull;
    let h = 0;
    for (let i = 0; i < n; i += 1) {
      while (h >= 2) {
        const o = hull[h - 2];
        const p = hull[h - 1];
        const cross = (s[p] - s[o]) * (z[i] - z[o]) - (z[p] - z[o]) * (s[i] - s[o]);
        if (cross >= 0) h -= 1; else break;
      }
      hull[h] = i;
      h += 1;
    }
    let k = 0;
    for (let i = 1; i < n - 1; i += 1) {
      while (k < h - 2 && s[hull[k + 1]] < s[i]) k += 1;
      const i0 = hull[k];
      const i1 = hull[k + 1];
      const t = s[i1] > s[i0] ? (s[i] - s[i0]) / (s[i1] - s[i0]) : 0;
      at(1 + i).set(a.x + (b.x - a.x) * s[i], a.y + (b.y - a.y) * s[i], z[i0] + (z[i1] - z[i0]) * t);
    }
  }

  private writeStrap(fit: BadgeFit): void {
    const { t, n, w, p } = S;
    const curve = this.curve;
    const strap = this.strap;
    const position = strap.geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = strap.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const half = BADGE_FIT.strapWidthM / 2;
    const samples = BADGE_FIT.strapSamples;
    curve.updateArcLengths();
    for (let i = 0; i < samples; i += 1) {
      const u = i / (samples - 1);
      curve.getPointAt(u, p);
      curve.getTangentAt(u, t);
      // Flat to the body: the strap's face looks out from the neck's axis
      // (and out of the chest, low down), its width lies across the curve.
      // Round the base of the neck it lies on the slope of the shoulders,
      // so there the face also looks UP, as a strap on a trapezius does.
      n.set(p.x - fit.neck.x, 0, p.z - fit.neck.z);
      if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
      n.normalize();
      const lift = THREE.MathUtils.smoothstep(p.y, fit.neck.baseY - 0.03, fit.neck.baseY + 0.03);
      n.y += lift * 0.9;
      n.normalize();
      w.crossVectors(t, n);
      if (w.lengthSq() < 1e-8) w.set(1, 0, 0);
      w.normalize();
      // Re-derive the face from the width so it is square to the tangent.
      n.crossVectors(w, t).normalize();
      position.setXYZ(i * 2, p.x - w.x * half, p.y - w.y * half, p.z - w.z * half);
      position.setXYZ(i * 2 + 1, p.x + w.x * half, p.y + w.y * half, p.z + w.z * half);
      normal.setXYZ(i * 2, n.x, n.y, n.z);
      normal.setXYZ(i * 2 + 1, n.x, n.y, n.z);
    }
    position.needsUpdate = true;
    normal.needsUpdate = true;
  }
}
