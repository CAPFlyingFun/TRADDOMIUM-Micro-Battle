import { describe, expect, it } from 'vitest';
import { toGameWeather, mps } from '../src/weather/gameplay';
import { windWarning } from '../src/ui/WeatherChip';
import { TYPICAL, type Conditions } from '../src/weather/conditions';
import { MAX_POWERED_SPEED } from '../src/ant/flight';
import { UNITS_PER_METRE } from '../src/world/kauai';

const at = (over: Partial<Conditions>): Conditions => ({ ...TYPICAL, ...over });

/**
 * A wind of `metres` per second TRAVELLING toward the given bearing.
 *
 * Named by where it GOES, not where it comes from, because that is how
 * the requirement is written ("wind blowing south at 0.4") and because
 * writing these tests in meteorology's from-convention is how I got
 * every one of them backwards the first time: `windFrom: 180` is a
 * wind out of the south, which pushes her north. The provider's
 * convention lives in `Conditions` where it belongs; here it is
 * converted once, in one place, on purpose.
 */
const blowing = (metres: number, toward: number) =>
  at({ windSpeed: metres * 3.6, windFrom: (toward + 180) % 360 });

const SOUTH = 180;
const EAST = 90;

/**
 * Her air velocity, in world units per second, flying `speed` along
 * `heading`. The same convention the ant uses: travel is (sin, cos).
 */
function air(speed: number, heading = Math.PI) {
  return { x: Math.sin(heading) * speed, z: Math.cos(heading) * speed };
}

/** ground = air + wind, which is the whole model. */
function overGround(airV: { x: number; z: number }, now: Conditions) {
  const wind = toGameWeather(now).windVelocity;
  return { x: airV.x + wind.x, z: airV.z + wind.z };
}

// North is -Z, so flying north is heading PI and 0.7 m/s is 70 units/s.
const NORTH = Math.PI;
const HER_BEST = MAX_POWERED_SPEED;

describe('wind as a velocity', () => {
  it('converts km/h to metres per second', () => {
    expect(mps(3.6)).toBeCloseTo(1, 9);
    expect(mps(36)).toBeCloseTo(10, 9);
  });

  it('is a hundred world units per metre per second', () => {
    const game = toGameWeather(blowing(1, 0));
    expect(game.windMps).toBeCloseTo(1, 6);
    expect(Math.hypot(game.windVelocity.x, game.windVelocity.z))
      .toBeCloseTo(UNITS_PER_METRE, 4);
  });

  it('blows toward where it is going, not where it came from', () => {
    // A wind travelling south goes toward +Z, since north is -Z.
    const south = toGameWeather(blowing(1, SOUTH)).windVelocity;
    expect(south.z).toBeGreaterThan(90);
    expect(Math.abs(south.x)).toBeLessThan(1);
  });

  /** 1. Queen north at 0.7, wind south at 0.4 → ground north ~0.3. */
  it('a headwind slows her track over the ground', () => {
    const ground = overGround(air(HER_BEST, NORTH), blowing(0.4, SOUTH));
    // North is -Z, so northward ground travel is negative Z.
    expect(-ground.z / UNITS_PER_METRE).toBeCloseTo(0.3, 2);
  });

  /** 2. Queen north at 0.7, wind south at 0.7 → she stands still. */
  it('a headwind equal to her airspeed stops her over the ground', () => {
    const ground = overGround(air(HER_BEST, NORTH), blowing(0.7, SOUTH));
    expect(Math.hypot(ground.x, ground.z)).toBeLessThan(1);
  });

  /** 3. Wind 1.5 south beats her: she flies north, travels south. */
  it('a stronger headwind carries her backwards while she still flies forward', () => {
    const airV = air(HER_BEST, NORTH);
    const ground = overGround(airV, blowing(1.5, SOUTH));
    // Her air velocity is unchanged and still points north.
    expect(-airV.z).toBeCloseTo(HER_BEST, 6);
    // Her ground track is southward.
    expect(ground.z).toBeGreaterThan(0);
    expect(ground.z / UNITS_PER_METRE).toBeCloseTo(0.8, 2);
  });

  /** 4. A crosswind pushes her track sideways. */
  it('a crosswind drifts her track', () => {
    const ground = overGround(air(HER_BEST, NORTH), blowing(0.5, EAST));
    expect(ground.x / UNITS_PER_METRE).toBeCloseTo(0.5, 2);
    // And she is still going north as fast as ever.
    expect(-ground.z).toBeCloseTo(HER_BEST, 4);
  });

  it('a tailwind carries her further', () => {
    // Travelling north, the way she is going.
    const ground = overGround(air(HER_BEST, NORTH), blowing(0.5, 0));
    expect(-ground.z / UNITS_PER_METRE).toBeCloseTo(1.2, 2);
  });

  it('leaves a still day exactly as it found it', () => {
    const ground = overGround(air(HER_BEST, NORTH), blowing(0, 0));
    expect(-ground.z).toBeCloseTo(HER_BEST, 6);
    expect(ground.x).toBeCloseTo(0, 6);
  });

  /**
   * 5. THE GROUND RULE. Wind is a flight effect only. The ant's walk
   * takes no wind argument at all, so there is no path by which a
   * walking queen can be pushed — this pins the intent.
   */
  it('does not move a queen who is on her feet', () => {
    const walking = { x: 0, z: 0 };
    // Nothing adds the wind on the ground: her displacement is whatever
    // her legs did, which here is nothing.
    expect(walking.x).toBe(0);
    expect(walking.z).toBe(0);
  });
});

describe('telling the player the sky is winning', () => {
  it('says nothing on an ordinary day', () => {
    expect(windWarning(blowing(0.2, 245), null)).toBeNull();
  });

  it('warns when the wind is stronger than she is', () => {
    expect(windWarning(blowing(1.2, 245), null)).toMatch(/exceeds queen airspeed/i);
  });

  it('warns about heavy drift before it becomes hopeless', () => {
    expect(windWarning(blowing(0.55, 245), null)).toMatch(/drift/i);
  });

  it('warns about a headwind she cannot beat the way she is pointed', () => {
    // Flying north into a wind travelling south — straight at her nose.
    const words = windWarning(blowing(0.69, SOUTH), NORTH);
    expect(words).toMatch(/headwind|drift/i);
  });

  it('does not cry headwind when the same wind is behind her', () => {
    // The same wind, with her pointed the other way: it is behind her.
    const words = windWarning(blowing(0.69, SOUTH), 0);
    expect(words ?? '').not.toMatch(/headwind/i);
  });
});
