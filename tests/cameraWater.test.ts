/**
 * THE CAMERA MAY NOT GO UNDER A WAVE SHE IS FLOATING ON.
 *
 * Joshua's device frames: a queen at the surface, the lens crossing
 * above and below the ocean again and again as the swell rolled
 * through. The floor was clamping to `Math.min(0, herY - 2)` — SEA
 * LEVEL, a flat zero — while the queen and the drawn ocean both ride
 * the animated swell, so a crest standing half a metre proud of zero
 * simply rose through a camera that believed the water was at nought.
 *
 * These tests drive the real FollowCamera against a registered water
 * query, which is how the game supplies the surface, and reproduce the
 * exact failing case: floating queen, big crest, damping active.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery } from '../src/world/waterQuery';
import type { LookInput } from '../src/input/LookDrag';

const REST: LookInput = { yaw: 0, pitch: 0, active: false };

/**
 * A flat seabed a metre down with a swell standing over it. The bed is
 * FLAT so `groundHeight` — which the camera also reads, and which the
 * tests cannot register — answers zero everywhere: the surface the
 * camera must clear is then exactly `crest`.
 */
function seaAt(crest: number): void {
  useWaterQuery(() => ({ depth: crest, flowX: 0, flowZ: 0, salt: true }));
}

afterEach(() => useWaterQuery(null));

function floatingQueen(y: number): THREE.Object3D {
  const ant = new THREE.Object3D();
  ant.position.set(0, y, 0);
  return ant;
}

describe('the camera against a live sea', () => {
  it('stays above a crest that rises under it while she floats', () => {
    // Her draught keeps her just under the surface; the sea heaves.
    const ant = floatingQueen(0);
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    let lowest = Infinity;
    let deepest = -Infinity;
    // Two full 1.5 s swell periods at 60 Hz, the crest swinging over
    // the sea's real reach, with the vertical damping ON (calm) —
    // which is the state the fault needed.
    for (let i = 0; i < 180; i++) {
      const phase = (i / 60) * ((2 * Math.PI) / 1.5);
      const crest = 24 + 24 * Math.sin(phase); // 0 … 48 units of water
      seaAt(crest);
      ant.position.y = crest - 0.15; // riding the surface, less draught
      follow.update(ant, REST, 1 / 60, true, 0);
      lowest = Math.min(lowest, follow.camera.position.y - crest);
      deepest = Math.max(deepest, crest);
    }
    // The lens never reaches the water, let alone crosses it.
    expect(deepest).toBeGreaterThan(45); // the crest really did roll
    expect(lowest).toBeGreaterThan(0);
  });

  it('never dips under the surface across a sweep of sea states', () => {
    for (const reach of [8, 20, 34, 48]) {
      const ant = floatingQueen(0);
      const follow = new FollowCamera(2);
      follow.snapTo(ant);
      let lowest = Infinity;
      for (let i = 0; i < 240; i++) {
        const crest = reach * Math.sin((i / 60) * ((2 * Math.PI) / 1.5));
        seaAt(Math.max(0.5, crest + reach));
        ant.position.y = crest;
        follow.update(ant, REST, 1 / 60, true, 0);
        lowest = Math.min(lowest, follow.camera.position.y - (crest + reach));
      }
      expect(lowest, `reach ${reach}`).toBeGreaterThan(0);
    }
  });

  it('lets the lens follow her under once she commits to a dive', () => {
    // The test ground is flat at zero (no grid is loaded), so the
    // GROUND clamp is what stops the lens at 1.6 here — a real seabed
    // is below sea level and lets it go further. What this asserts is
    // the water clamp letting go: at the surface the lens is held
    // above 30, and diving puts it under that surface.
    const dived = (dive: number) => {
      const ant = floatingQueen(0);
      const follow = new FollowCamera(2);
      follow.snapTo(ant);
      seaAt(30);
      for (let i = 0; i < 240; i++) {
        ant.position.y = Math.max(-60, -i * 0.5);
        follow.update(ant, REST, 1 / 60, true, dive);
      }
      return follow.camera.position.y;
    };
    // Holding the surface: the lens stays over the water, however far
    // under it she has gone.
    expect(dived(0)).toBeGreaterThan(30);
    // Committed: the lens is under the surface with her.
    expect(dived(1)).toBeLessThan(30);
  });

  it('holds the clamp through a brushed lever, and hands over smoothly', () => {
    // A dive small enough to be a bob, not a decision.
    const ant = floatingQueen(29.85);
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    seaAt(30);
    for (let i = 0; i < 120; i++) follow.update(ant, REST, 1 / 60, true, 0.1);
    expect(follow.camera.position.y).toBeGreaterThan(30);

    // And the release is continuous: no step between neighbouring
    // lever positions anywhere across the band.
    const heights = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1].map((dive) => {
      const her = floatingQueen(-20);
      const cam = new FollowCamera(2);
      cam.snapTo(her);
      seaAt(30);
      for (let i = 0; i < 240; i++) cam.update(her, REST, 1 / 60, true, dive);
      return cam.camera.position.y;
    });
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThanOrEqual(heights[i - 1] + 1e-6);
      expect(heights[i - 1] - heights[i]).toBeLessThan(30);
    }
  });

  it('still keeps out of a hillside where there is no water at all', () => {
    useWaterQuery(() => null);
    const ant = floatingQueen(0);
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    for (let i = 0; i < 120; i++) follow.update(ant, REST, 1 / 60, false, 0);
    // Flat test ground is zero; the lens keeps its ground clearance.
    expect(follow.camera.position.y).toBeGreaterThan(1);
  });
});
