/**
 * THE CAMERA ON A MOVING SEA — and the contract changed twice.
 *
 * v0.0.99 clamped the lens to a FLAT sea level, so crests rose through
 * it and the view crossed the waterline again and again.
 *
 * v0.0.100 clamped it to the LIVE surface plus four units, which fixed
 * that and caused a worse one: the lens rides about 3.27 units over the
 * water while she floats (a 7.8-unit boom at 26 degrees, less her
 * draught), so a four-unit clearance was active on EVERY frame rather
 * than on crests. The camera copied the whole 48-unit swing of the
 * swell and the horizon pumped — "like a washing machine".
 *
 * So the contract these tests hold is no longer "the lens is above the
 * water". It is:
 *
 *   the camera must not COPY the sea            (the pumping test)
 *   a passing crest may wash over the lens      (tolerated)
 *   submersion that LASTS is still corrected    (the sinking test)
 *   diving releases the envelope entirely
 *   the ground is still a hard floor
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FollowCamera } from '../src/camera/FollowCamera';
import { useWaterQuery } from '../src/world/waterQuery';
import { SETTLE, SPLASH } from '../src/world/Underwater';
import type { LookInput } from '../src/input/LookDrag';

const REST: LookInput = { yaw: 0, pitch: 0, active: false };
/** The sea's own numbers: 48 units of reach on a 1.5 s period. */
const REACH = 48;
const PERIOD = 1.5;

/** A flat bed at zero with `depth` of water standing over it, so the
 *  surface the camera sees is exactly `depth`. */
function seaAt(depth: number): void {
  useWaterQuery(() => ({ depth, flowX: 0, flowZ: 0, salt: true }));
}

afterEach(() => useWaterQuery(null));

function queen(y = 0): THREE.Object3D {
  const ant = new THREE.Object3D();
  ant.position.set(0, y, 0);
  return ant;
}

/**
 * Float her on a rolling swell and report how the two moved.
 *
 * WARMED UP FIRST, and the warm-up is not a detail. snapTo seats the
 * camera on a queen at zero and the very first frame puts her up on a
 * crest, so the damping filter — whose time constant is 1.7 s — spends
 * five seconds climbing to meet her. Measured from frame zero that
 * settling ramp IS the biggest vertical excursion in the run, and it
 * reported the camera following 69% of the sea when the true figure
 * was 19%. It nearly bought a retune of constants that were fine.
 */
function ride(seconds: number, dive = 0): {
  hers: number; lens: number; wettest: number; wetShare: number;
  longestWet: number;
} {
  const ant = queen(0);
  const follow = new FollowCamera(2);
  seaAt(REACH);
  follow.snapTo(ant);
  const dt = 1 / 60;
  const camYs: number[] = [];
  const herYs: number[] = [];
  let wettest = 0;
  let wet = 0;
  let n = 0;
  let streak = 0;
  let longestWet = 0;
  const WARM = 8;
  for (let t = -WARM; t < seconds; t += dt) {
    const crest = REACH * Math.sin((t / PERIOD) * 2 * Math.PI);
    // Sea level rides the swell; the bed stays put, so the column is
    // the surface height above a bed at zero.
    const surface = REACH + crest;
    seaAt(surface);
    ant.position.y = surface - 0.15; // riding the film, less draught
    follow.update(ant, REST, dt, true, dive);
    if (t < 0) continue;
    const under = surface - follow.camera.position.y;
    if (under > 0) {
      wet++;
      wettest = Math.max(wettest, under);
      streak += dt;
      longestWet = Math.max(longestWet, streak);
    } else streak = 0;
    camYs.push(follow.camera.position.y);
    herYs.push(ant.position.y);
    n++;
  }
  const swing = (v: number[]) => Math.max(...v) - Math.min(...v);
  return {
    hers: swing(herYs), lens: swing(camYs), wettest,
    wetShare: wet / n, longestWet,
  };
}

describe('the camera on a swell', () => {
  it('does not copy the sea — the horizon holds while she rides', () => {
    const r = ride(9);
    // She swings the full swell.
    expect(r.hers).toBeGreaterThan(REACH);
    // The lens must not. v0.0.100 tracked it rigidly; the design note
    // in FollowCamera calls 103% the fault it was built to prevent.
    // Measured 0.19 at these constants, against a floor of 0.144 that
    // the damping alone would give with no envelope at all.
    expect(r.lens / r.hers).toBeLessThan(0.25);
  });

  it('lets a crest wash over the lens rather than kicking it away', () => {
    const r = ride(9);
    // Being washed over is allowed and expected at this scale…
    expect(r.wetShare).toBeGreaterThan(0);
    // …and it is a wash, not a submarine ride: never past the one hard
    // line, and not the whole time either.
    expect(r.wettest).toBeLessThanOrEqual(70.001);
    expect(r.wetShare).toBeLessThan(0.6);
    // AND NO WASH MAY RAISE A VISIBLE TINT. This is the other half of
    // what Joshua filmed: the screen flipping green every wave. The
    // honest test is not "a crest is shorter than SPLASH" — it is how
    // much of the underwater look a crest can actually switch on, run
    // through Underwater's own constants so the two cannot drift.
    const t = Math.min(1, Math.max(0, (r.longestWet - SPLASH) / (SETTLE - SPLASH)));
    const engaged = t * t * (3 - 2 * t);
    expect(engaged).toBeLessThan(0.05);
  });

  it('corrects submersion that LASTS', () => {
    // A surface that stays high over a lens that starts low: nothing
    // passing, just water. The envelope must lift it out.
    const ant = queen(0);
    const follow = new FollowCamera(2);
    seaAt(60);
    follow.snapTo(ant);
    const before = follow.camera.position.y;
    for (let i = 0; i < 300; i++) follow.update(ant, REST, 1 / 60, true, 0);
    const after = follow.camera.position.y;
    expect(after).toBeGreaterThan(before);
    // Risen to the surface, and never overshooting into the air.
    expect(after).toBeCloseTo(60, 0);
  });

  it('is patient: one crest does not trigger the full lift', () => {
    // Half a wave of submersion, then clear water again.
    const ant = queen(0);
    const follow = new FollowCamera(2);
    seaAt(REACH);
    follow.snapTo(ant);
    const start = follow.camera.position.y;
    seaAt(REACH + 40);
    for (let i = 0; i < Math.round(0.7 * 60); i++) {
      follow.update(ant, REST, 1 / 60, true, 0);
    }
    const lifted = follow.camera.position.y - start;
    // The nudge is real but gentle — nothing like the 40 units a hard
    // clamp would have applied in one frame.
    expect(lifted).toBeGreaterThan(0);
    expect(lifted).toBeLessThan(20);
  });

  it('hands the water back entirely when she means to dive', () => {
    const deep = (dive: number) => {
      const ant = queen(0);
      const follow = new FollowCamera(2);
      seaAt(60);
      follow.snapTo(ant);
      for (let i = 0; i < 300; i++) {
        ant.position.y = Math.max(-90, -i * 0.6);
        follow.update(ant, REST, 1 / 60, true, dive);
      }
      return follow.camera.position.y;
    };
    // Holding the surface: the envelope keeps lifting the lens out.
    expect(deep(0)).toBeGreaterThan(30);
    // Committed: no water term at all, so it goes down with her (the
    // flat test bed at zero is what finally stops it).
    expect(deep(1)).toBeLessThan(30);
  });

  it('still keeps out of a hillside, which is not negotiable', () => {
    useWaterQuery(() => null);
    const ant = queen(0);
    const follow = new FollowCamera(2);
    follow.snapTo(ant);
    for (let i = 0; i < 120; i++) follow.update(ant, REST, 1 / 60, false, 0);
    expect(follow.camera.position.y).toBeGreaterThan(1);
  });
});
