import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery } from '../src/world/waterQuery';
import type { LookInput } from '../src/input/LookDrag';
import { loadIsland } from './support/island';
import { groundHeight } from '../src/world/heightfield';
import { geoToWorld } from '../src/world/geo';
import { world, type WorldPoint } from '../src/world/coords';
import { setOrigin, toLocal } from '../src/world/origin';

afterEach(() => useWaterQuery(null));

/**
 * She faces +Z, so the camera rests at -Z looking along +Z.
 *
 * In that frame the viewer's RIGHT is world -X: three.js cameras look
 * down their local -Z, so local +Z is world -Z, and local +X (screen
 * right) = localY x localZ = (0,1,0) x (0,0,-1) = (-1,0,0).
 */
function antFacingNorth(): THREE.Object3D {
  const ant = new THREE.Object3D();
  ant.position.set(0, 0, 0);
  ant.rotation.y = 0;
  return ant;
}

function look(over: Partial<LookInput> = {}): LookInput {
  return { yaw: 0, pitch: 0, active: true, ...over };
}

/** Settle the camera on a look input and report where it ended up. */
function orbit(input: LookInput): THREE.Vector3 {
  const ant = antFacingNorth();
  const follow = new FollowCamera(2);
  follow.snapTo(ant);
  // Plenty of frames to converge on the desired spot.
  for (let i = 0; i < 400; i++) follow.update(ant, input, 1 / 60);
  return follow.camera.position.clone();
}

describe('the boom is built on HER up', () => {
  /** Settle the camera with her standing on a given surface. */
  function boomOn(
    up: { x: number; y: number; z: number }, height = 0,
  ): THREE.Vector3 {
    const ant = antFacingNorth();
    ant.position.y = height;
    const follow = new FollowCamera(2);
    follow.standOn(up, { x: 0, y: 0, z: 1 });
    follow.snapTo(ant);
    for (let i = 0; i < 400; i++) follow.update(ant, look({ active: false }), 1 / 60);
    return follow.camera.position.clone();
  }

  it('is bit-for-bit unchanged on level ground', () => {
    // THE PROMISE THE WHOLE DESIGN RESTS ON. Her up on the ground IS
    // the world's, so the projection removes nothing and every number
    // is the one the camera produced before climbing existed. A default
    // that merely LOOKED right would not do: this compares the new path
    // against the untouched one.
    const was = orbit(look({ active: false }));
    const now = boomOn({ x: 0, y: 1, z: 0 });
    expect(now.x).toBeCloseTo(was.x, 10);
    expect(now.y).toBeCloseTo(was.y, 10);
    expect(now.z).toBeCloseTo(was.z, 10);
  });

  it('lifts off the BARK when she is on a trunk, not into the sky', () => {
    // Bark facing +x: the boom's lift has to come out along +x, or the
    // lens climbs the tree with her and frames the trunk instead of her.
    const high = 200;
    const at = boomOn({ x: 1, y: 0, z: 0 }, high);
    expect(at.x).toBeGreaterThan(1);
    // And it is no longer riding above her in world terms.
    expect(Math.abs(at.y - high)).toBeLessThan(Math.abs(at.x));
  });

  it('keeps its distance whatever she is standing on', () => {
    // The boom is a length. Tipping the frame must not stretch it.
    //
    // MEASURED UP A TRUNK, and it has to be: on bark the lift comes out
    // sideways, so a queen standing at ground level would put the lens
    // exactly ON the ground and the don't-sink-into-a-hillside clamp
    // would — rightly — push it clear, which is a longer boom for a
    // good reason. Two metres up is where climbing actually happens.
    const high = 200;
    const flat = boomOn({ x: 0, y: 1, z: 0 }, high).sub(
      new THREE.Vector3(0, high, 0),
    ).length();
    const bark = boomOn({ x: 1, y: 0, z: 0 }, high).sub(
      new THREE.Vector3(0, high, 0),
    ).length();
    expect(bark).toBeCloseTo(flat, 6);
  });

  it('sits BEHIND HER NOSE once she is on bark, not on a compass', () => {
    // Joshua, v0.0.156: "I did not get behind the player because the
    // camera was still stuck on world versus relative XYZ." A compass
    // bearing cannot say "behind her" on the side of a trunk; her
    // carried nose can.
    const high = 200;
    const ant = antFacingNorth();
    ant.position.y = high;
    const follow = new FollowCamera(2);
    // Up a trunk whose bark faces +x, with her nose pointing +y — she
    // is climbing. Behind her is therefore BELOW her.
    follow.standOn({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    follow.snapTo(ant);
    for (let i = 0; i < 400; i++) follow.update(ant, look({ active: false }), 1 / 60);
    const at = follow.camera.position;
    expect(at.y).toBeLessThan(high);
    // …and still off the bark, so the lens is not inside the trunk.
    expect(at.x).toBeGreaterThan(0);
  });

  it('rolls the horizon with her instead of framing her sideways', () => {
    // `camera.up` was never written by this file, because the world's
    // up was always hers. Up a trunk it is not.
    const ant = antFacingNorth();
    ant.position.y = 200;
    const follow = new FollowCamera(2);
    follow.standOn({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    follow.snapTo(ant);
    for (let i = 0; i < 400; i++) follow.update(ant, look({ active: false }), 1 / 60);
    expect(follow.camera.up.x).toBeGreaterThan(0.9);
  });

  it('leaves camera.up alone on the ground', () => {
    const was = orbit(look({ active: false }));
    expect(was).toBeDefined();
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.standOn({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    follow.snapTo(ant);
    for (let i = 0; i < 60; i++) follow.update(ant, look({ active: false }), 1 / 60);
    expect(follow.camera.up.y).toBeCloseTo(1, 9);
  });

  it('survives a drag pointing straight at the surface', () => {
    // Her up and the drag bearing parallel: "along the surface" has no
    // answer, and the fallback has to produce a finite camera rather
    // than a NaN one.
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.standOn({ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
    follow.snapTo(ant);
    for (let i = 0; i < 60; i++) follow.update(ant, look({ yaw: Math.PI }), 1 / 60);
    const at = follow.camera.position;
    expect(Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z))
      .toBe(true);
  });
});

describe('the chase camera', () => {
  it('sits on the bearing the view holds, not on her nose', () => {
    const at = orbit(look({ active: false }));
    expect(at.z).toBeLessThan(-4);
    expect(Math.abs(at.x)).toBeLessThan(0.5);
    expect(at.y).toBeGreaterThan(0);
  });

  it('swings the opposite way to the drag', () => {
    // A drag travelling right reports positive yaw. On the device,
    // walking the camera the same way round read as backwards, so a
    // rightward drag must move the camera toward world +X — the
    // viewer's LEFT — and a leftward drag the other way.
    expect(orbit(look({ yaw: 0.6 })).x).toBeGreaterThan(1);
    expect(orbit(look({ yaw: -0.6 })).x).toBeLessThan(-1);
  });

  it('lifts toward top-down on positive pitch', () => {
    const level = orbit(look({ pitch: 0 }));
    const lifted = orbit(look({ pitch: 0.8 }));
    expect(lifted.y).toBeGreaterThan(level.y);
  });

  it('comes home when nothing is driving it', () => {
    expect(Math.abs(orbit(look({ yaw: 0, active: false })).x)).toBeLessThan(0.5);
  });
});

describe('holding station on a moving queen', () => {
  /**
   * THE WIND BUG. A 4 mph wind moves her at 179 units a second —
   * two and a half times her own top airspeed — and the old camera,
   * lerping its world position, trailed thirty units upwind while
   * aiming at her, which pointed the view downwind whatever the stick
   * said. The camera must keep the same station relative to her at any
   * carry speed, because smoothing lives in offset space now.
   */
  it('keeps its station behind a queen carried by wind', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    const rest = follow.camera.position.clone().sub(ant.position);

    const input = look({ active: false });
    for (let i = 0; i < 400; i++) {
      ant.position.x += 179 / 60; // a 4 mph wind, at 60 fps
      follow.update(ant, input, 1 / 60);
    }
    const now = follow.camera.position.clone().sub(ant.position);
    // Same offset as at rest — no trail, however fast she is carried.
    expect(now.distanceTo(rest)).toBeLessThan(0.05);
  });

  it('keeps the view pointed past her, not back along the drift', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    const input = look({ active: false });
    for (let i = 0; i < 400; i++) {
      ant.position.x += 179 / 60;
      follow.update(ant, input, 1 / 60);
    }
    // The rest bearing puts the camera at -Z of her; carried east at
    // any speed, it must STAY at her -Z rather than falling to her -X
    // and staring east. The offset says which way the camera faces,
    // since it always aims at her.
    const offset = follow.camera.position.clone().sub(ant.position);
    expect(offset.z).toBeLessThan(-4);
    expect(Math.abs(offset.x)).toBeLessThan(0.5);
  });

  it('still eases a drag while she is being carried', () => {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    // One frame of a hard drag: the offset must move toward the new
    // bearing but not arrive — that smoothing is what the lerp is FOR,
    // and holding station must not have thrown it away.
    const before = follow.camera.position.clone().sub(ant.position);
    follow.update(ant, look({ yaw: 1.2 }), 1 / 60);
    const after = follow.camera.position.clone().sub(ant.position);
    expect(after.distanceTo(before)).toBeGreaterThan(0.01);
    for (let i = 0; i < 400; i++) follow.update(ant, look({ yaw: 1.2 }), 1 / 60);
    const settled = follow.camera.position.clone().sub(ant.position);
    expect(settled.distanceTo(after)).toBeGreaterThan(0.5);
  });
});

/**
 * THE CAMERA MUST NOT FALL BEHIND A CLIMB.
 *
 * A first-order filter lags a RAMP by its speed over its rate, and a
 * climb is a ramp. The vertical damping added in v0.0.88 to stop the
 * swell pumping the horizon was also applied while flying at a rate of
 * 8 a second: at the top of the lift lever, 300 units a second, that is
 * 37 units of lag against a follow distance of 7.8. The camera sat five
 * times its own distance below her and aimed almost straight up.
 */
describe('following her up', () => {
  /** Fly her upward at `rate` units a second for a second, return the gap. */
  function climbGap(rate: number, calm: boolean): number {
    const ant = antFacingNorth();
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    for (let i = 0; i < 60; i++) {
      ant.position.y += rate / 60;
      follow.update(ant, look({ active: false }), 1 / 60, calm);
    }
    // Where the camera sits relative to her, vertically.
    return follow.camera.position.y - ant.position.y;
  }

  it('holds its height above her through the fastest climb', () => {
    // Settled, the camera rests ABOVE her. Any lag eats into that, and
    // enough of it puts the camera below her looking up.
    const rest = climbGap(0, false);
    for (const rate of [20, 100, 300]) {
      const gap = climbGap(rate, false);
      expect(gap).toBeGreaterThan(rest - 0.5);
    }
  });

  it('never ends up below her, which is what aimed the view upward', () => {
    expect(climbGap(300, false)).toBeGreaterThan(0);
  });

  it('settles its offset more softly afloat than on land', () => {
    // WHAT REPLACED THE BOB DAMPING (v0.0.111). The camera no longer
    // holds still against the sea — every version that did lost her
    // from a picture nine centimetres tall while she rode two metres
    // of swell. It travels with her, and the softness is one shared
    // rate on the OFFSET, which takes the edge off transients without
    // putting a filter between the camera and her translation.
    const settle = (calm: boolean): number => {
      const ant = antFacingNorth();
      const follow = new FollowCamera(2);
      useWaterQuery(() => (calm ? { depth: 2, flowX: 0, flowZ: 0, salt: true } : null));
      follow.snapTo(ant);
      const rest = follow.camera.position.clone().sub(ant.position);
      // One drag, then let go and watch how fast it comes home.
      for (let i = 0; i < 40; i++) follow.update(ant, look({ yaw: 1.2 }), 1 / 60, calm);
      const swung = follow.camera.position.clone().sub(ant.position);
      for (let i = 0; i < 20; i++) {
        follow.update(ant, look({ yaw: 0, active: false }), 1 / 60, calm);
      }
      const back = follow.camera.position.clone().sub(ant.position);
      return back.distanceTo(rest) / Math.max(1e-6, swung.distanceTo(rest));
    };
    // Afloat it is still further from home after the same third of a
    // second — softer, by construction and by measurement.
    expect(settle(true)).toBeGreaterThan(settle(false));
  });
});

/**
 * THE ELEVATION IS MEASURED FROM THE SLOPE, NOT FROM THE HORIZON.
 *
 * Twenty-six degrees above the horizon is the right rest angle on flat
 * ground and the wrong one on a hillside: climbing a steep slope the
 * boom still hangs 26° over her, so the hill fills the frame from her
 * nose to the top of the screen and the only thing moving in the shot
 * is the ground going past underneath. Joshua, on the grass slope:
 * "that one with the grass is the lowest I can get behind the ant, so
 * the camera angle needs to compensate for terrain so it can be able to
 * look more upwards to see where you're going vs seeing the ground
 * flash by beneath you."
 */
describe('the camera on a hillside', () => {
  /** The angle of the lens above her, degrees. */
  function elevationOn(spot: WorldPoint, aloft = 0): number {
    setOrigin(spot.wx, spot.wz);
    const seat = toLocal(spot);
    const ant = new THREE.Object3D();
    ant.position.set(seat.lx, groundHeight(spot.wx, spot.wz) + aloft, seat.lz);
    const follow = new FollowCamera(2);
    // Yaw PI puts the boom behind her along -Z, which is the direction
    // the fixture below measures the drop in.
    const input = look({ yaw: 0, active: false });
    follow.snapTo(ant);
    for (let i = 0; i < 400; i++) follow.update(ant, input, 1 / 60);
    const lens = follow.camera.position;
    const flat = Math.hypot(lens.x - ant.position.x, lens.z - ant.position.z);
    return (Math.atan2(lens.y - ant.position.y, Math.max(1e-6, flat)) * 180) / Math.PI;
  }

  /** Somewhere the ground falls away behind the boom, and somewhere level. */
  function spots(): { steep: WorldPoint; level: WorldPoint } {
    loadIsland();
    let steep: WorldPoint | null = null;
    let level: WorldPoint | null = null;
    const middle = geoToWorld({ lat: 22.08, lon: -159.50 });
    for (let r = 0; r < 240 && (!steep || !level); r++) {
      const at = world(middle.wx + (r % 16) * 4_000, middle.wz + Math.floor(r / 16) * 4_000);
      const hers = groundHeight(at.wx, at.wz);
      if (hers <= 100) continue;
      // The slope is measured 300 units behind her — LEAN_REACH.
      const drop = hers - groundHeight(at.wx, at.wz - 300);
      if (!steep && drop > 170) steep = at;          // ~30 degrees
      if (!level && Math.abs(drop) < 4) level = at;  // under a degree
    }
    expect(steep, 'a slope').not.toBeNull();
    expect(level, 'level ground').not.toBeNull();
    return { steep: steep!, level: level! };
  }

  it('looks further along the climb than it does on the flat', () => {
    const { steep, level } = spots();
    const onFlat = elevationOn(level);
    const onHill = elevationOn(steep);
    // Lower means more of what is ahead and less of what is underfoot.
    expect(onHill).toBeLessThan(onFlat - 5);
    console.log(`camera elevation: ${onFlat.toFixed(1)}° level,`
      + ` ${onHill.toFixed(1)}° on the slope`);
  }, 120000);

  it('and leaves the flat exactly as it was', () => {
    const { level } = spots();
    // The rest angle is 26° and level ground must still get it — this
    // compensation may not become a tax on ordinary play. The fixture's
    // "level" is level to within a degree of slope, so the lens is
    // within about a degree of rest, and that residual is the thing
    // working rather than noise.
    expect(Math.abs(elevationOn(level) - 26)).toBeLessThan(1.5);
  }, 120000);

  it('and lets go of the slope once she is well above it', () => {
    // The lean is about what FRAMES the shot. A boom's worth of air
    // under her and the hill is scenery, not the thing she is moving
    // against — tilting for it would roll the horizon for nothing.
    const { steep } = spots();
    const low = elevationOn(steep, 10);
    const high = elevationOn(steep, 600);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(26, 0);
  }, 120000);
});
