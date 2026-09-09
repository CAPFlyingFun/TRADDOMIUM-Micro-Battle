/**
 * Tap-to-possess against a fake camera under node: the nearest drawn
 * centre within a thumb or the body's own projected radius, never a
 * creature behind the eye, and an aphid tappable from twenty-two pixels.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { TAP_PIXELS, pickCreature, type Ndc, type Viewport } from '../src/control/pick';

const VIEWPORT: Viewport = { width: 932, height: 430 };

/** A 60° camera ten units back from the origin, looking at it, matrices current. */
function camera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, VIEWPORT.width / VIEWPORT.height, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

interface Body {
  readonly at: THREE.Vector3;
  readonly radius: number;
}

function pick(cam: THREE.Camera, bodies: Record<string, Body | null>, tap: Ndc, minPixels = TAP_PIXELS): string | null {
  return pickCreature(
    tap,
    cam,
    Object.keys(bodies),
    (id) => bodies[id]?.at ?? null,
    (id) => bodies[id]?.radius ?? 0,
    minPixels,
    VIEWPORT,
  );
}

/** Where a point lands on the screen, NDC. */
function ndcOf(cam: THREE.Camera, at: THREE.Vector3): Ndc {
  const v = at.clone().project(cam);
  return { x: v.x, y: v.y };
}

/** A tap `px` pixels to the right of a point. */
function beside(cam: THREE.Camera, at: THREE.Vector3, px: number, py = 0): Ndc {
  const c = ndcOf(cam, at);
  return { x: c.x + px / (VIEWPORT.width / 2), y: c.y + py / (VIEWPORT.height / 2) };
}

/** Pixels per unit at the origin's depth for this rig: the screen's half-height over the view's half-height at 10 units. */
const PX_PER_UNIT = (VIEWPORT.height / 2) / (10 * Math.tan(THREE.MathUtils.degToRad(30)));

describe('pickCreature', () => {
  it('picks the creature under the tap', () => {
    const cam = camera();
    const bodies = { queen: { at: new THREE.Vector3(0, 0, 0), radius: 0.4 } };
    expect(pick(cam, bodies, ndcOf(cam, bodies.queen.at))).toBe('queen');
  });

  it('the aphid rule: a creature of no size is tappable from a thumb away, and not from further', () => {
    const cam = camera();
    const bodies = { aphid: { at: new THREE.Vector3(2, 0.5, 0), radius: 0.01 } };
    expect(pick(cam, bodies, beside(cam, bodies.aphid.at, TAP_PIXELS - 1))).toBe('aphid');
    expect(pick(cam, bodies, beside(cam, bodies.aphid.at, 0, -(TAP_PIXELS - 1)))).toBe('aphid');
    expect(pick(cam, bodies, beside(cam, bodies.aphid.at, TAP_PIXELS + 2))).toBeNull();
  });

  it('a big body is picked anywhere on it, past the thumb', () => {
    const cam = camera();
    const radius = 2;
    const bodies = { queen: { at: new THREE.Vector3(0, 0, 0), radius } };
    const onBody = radius * PX_PER_UNIT * 0.9;
    expect(onBody).toBeGreaterThan(TAP_PIXELS * 2);
    expect(pick(cam, bodies, beside(cam, bodies.queen.at, onBody))).toBe('queen');
    expect(pick(cam, bodies, beside(cam, bodies.queen.at, radius * PX_PER_UNIT * 1.15))).toBeNull();
  });

  it('the nearest centre wins among those in reach: the worker beside the queen', () => {
    const cam = camera();
    const queen = { at: new THREE.Vector3(0, 0, 0), radius: 2 };
    // The worker's centre 0.3 units to the right of the queen's, inside her projected body.
    const worker = { at: new THREE.Vector3(0.3, 0, 0), radius: 0.1 };
    const bodies = { queen, worker };
    // A tap between the two, nearer the worker.
    const tap = beside(cam, queen.at, 0.2 * PX_PER_UNIT);
    expect(pick(cam, bodies, tap)).toBe('worker');
    // And nearer the queen.
    expect(pick(cam, bodies, beside(cam, queen.at, 0.1 * PX_PER_UNIT))).toBe('queen');
  });

  it('never picks a creature behind the eye, even where its mirror image lands under the tap', () => {
    const cam = camera();
    const behind = { at: new THREE.Vector3(1, 0, 20), radius: 5 };
    const bodies = { behind };
    // Its raw projection is the mirror of a point in front; tap there.
    const mirrored = new THREE.Vector3(-1, 0, 0);
    expect(pick(cam, bodies, ndcOf(cam, mirrored))).toBeNull();
    expect(pick(cam, bodies, { x: 0, y: 0 })).toBeNull();
  });

  it('skips a creature that is not drawn, and an empty list is nobody', () => {
    const cam = camera();
    const at = new THREE.Vector3(0, 0, 0);
    expect(pick(cam, { hidden: null, shown: { at, radius: 0.1 } }, ndcOf(cam, at))).toBe('shown');
    expect(pick(cam, { hidden: null }, ndcOf(cam, at))).toBeNull();
    expect(pick(cam, {}, { x: 0, y: 0 })).toBeNull();
  });

  it('a tap or a viewport that is not a number is nobody', () => {
    const cam = camera();
    const bodies = { queen: { at: new THREE.Vector3(0, 0, 0), radius: 1 } };
    expect(pick(cam, bodies, { x: NaN, y: 0 })).toBeNull();
    expect(pickCreature({ x: 0, y: 0 }, cam, ['queen'], () => bodies.queen.at, () => 1, TAP_PIXELS, { width: 0, height: 0 })).toBeNull();
  });

  it('a thumb of no size still picks a body by its own radius, and a radius that is not a number is a point', () => {
    const cam = camera();
    const bodies = { queen: { at: new THREE.Vector3(0, 0, 0), radius: 1 }, dot: { at: new THREE.Vector3(3, 0, 0), radius: NaN } };
    expect(pick(cam, bodies, beside(cam, bodies.queen.at, 0.5 * PX_PER_UNIT), 0)).toBe('queen');
    expect(pick(cam, bodies, ndcOf(cam, bodies.dot.at), 0)).toBe('dot');
    expect(pick(cam, bodies, beside(cam, bodies.dot.at, 2), 0)).toBeNull();
  });

  it('reads the camera as it stands and does not move it', () => {
    const cam = camera();
    const before = cam.matrixWorld.clone();
    const bodies = { queen: { at: new THREE.Vector3(0, 0, 0), radius: 1 } };
    pick(cam, bodies, { x: 0, y: 0 });
    expect(cam.matrixWorld.equals(before)).toBe(true);
    expect(cam.position.z).toBe(10);
  });
});
