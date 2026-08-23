/**
 * A GORGE IS A CALM PLACE.
 *
 * Reported from the device: flying down a canyon she was pushed about
 * by a wind that two hundred metres of rock was standing in the way
 * of. The height profile cannot see that — it answers "how far off the
 * deck is she", which on open ground is the whole question and in a
 * canyon is not the question at all.
 *
 * `shelter` looks upwind instead, and the useful property is that it
 * never needs to know what a canyon IS: cross the gorge and the wall
 * is right there, turn along it and the fetch runs clear. Which is
 * Joshua's condition — nearly nothing, "unless the winds run through
 * them" — falling out rather than being written in.
 */
import { describe, expect, it } from 'vitest';
import { shelter } from '../src/weather/windField';

/**
 * A canyon running north–south: a trench 6 m wide in a plateau 3 m
 * high, floor at zero. She flies down the middle at 1 m.
 */
const CANYON = (x: number, _z: number) => (Math.abs(x) < 300 ? 0 : 300);
const IN_THE_TRENCH = { x: 0, z: 0, altitude: 100 };

/** Unit vector pointing the way the wind comes FROM, by compass angle. */
function from(degrees: number): [number, number] {
  const r = (degrees * Math.PI) / 180;
  return [Math.sin(r), -Math.cos(r)];
}

type Ground = (x: number, z: number) => number;

const at = (
  deg: number, ground: Ground = CANYON, spot = IN_THE_TRENCH,
) => shelter(
  spot.x, spot.z, spot.altitude, ...from(deg), ground,
);

describe('shelter in a north-south canyon', () => {
  it('kills a wind coming across it', () => {
    // Due east, straight at the wall three metres up and two from her.
    expect(at(90)).toBeLessThan(0.25);
    expect(at(270)).toBeLessThan(0.25);
  });

  it('lets one running along it straight through', () => {
    // THE CONDITION. Nothing upwind is above her, so nothing is in the
    // way, so she gets the weather.
    expect(at(0)).toBe(1);
    expect(at(180)).toBe(1);
  });

  it('takes an oblique wind in between', () => {
    // Fifteen degrees off the axis: shallow enough that the ray only
    // reaches the wall at the far end of its walk, so the angle it
    // subtends is small and only some of the wind is lost.
    const across = at(90);
    const oblique = at(15);
    const along = at(0);
    expect(oblique).toBeGreaterThan(across);
    expect(oblique).toBeLessThan(along);
  });
});

describe('shelter in the open', () => {
  const FLAT = () => 0;

  it('is no shelter at all, from any direction', () => {
    for (let deg = 0; deg < 360; deg += 30) {
      expect(at(deg, FLAT, { x: 0, z: 0, altitude: 100 })).toBe(1);
    }
  });

  it('and climbing out of the canyon finds the wind again', () => {
    // Over the rim she is above everything, so nothing shelters her —
    // which is also why this had to key off her ALTITUDE and not her
    // clearance. Down in the trench at 1 m she is sheltered; at the
    // same 1 m clearance standing on the plateau she is not.
    const inside = at(90, CANYON, { x: 0, z: 0, altitude: 100 });
    const above = at(90, CANYON, { x: 0, z: 0, altitude: 400 });
    expect(inside).toBeLessThan(0.25);
    expect(above).toBe(1);
  });
});

describe('what counts as a wall', () => {
  it('is a matter of the angle it subtends, at her scale', () => {
    // A kerb is a cliff to a queen: a 25-unit lip is a quarter of a
    // metre and still takes a bite out of the wind.
    const lip = (h: number) => (x: number) => (x > 250 ? h : 0);
    const low = at(90, lip(25), { x: 0, z: 0, altitude: 0 });
    const high = at(90, lip(150), { x: 0, z: 0, altitude: 0 });
    expect(high).toBeLessThan(low);
    expect(low).toBeLessThan(1);
  });

  it('and two ridges at the same angle shelter the same', () => {
    // THE POINT OF USING A SLOPE. Twice as tall and twice as far away
    // cuts off the same amount of sky, so it has to give the same
    // answer — which the height-and-distance version it replaced did
    // not, and could not without a fudge factor.
    const ridge = (h: number, from: number) => (x: number) => (x > from ? h : 0);
    const near = at(90, ridge(100, 340), { x: 0, z: 0, altitude: 0 });
    const far = at(90, ridge(200, 690), { x: 0, z: 0, altitude: 0 });
    expect(near).toBeCloseTo(far, 1);
  });

  it('and how close, because distance lets the air come back down', () => {
    const near = (x: number) => (x > 200 ? 300 : 0);
    const far = (x: number) => (x > 1_000 ? 300 : 0);
    expect(at(90, near, { x: 0, z: 0, altitude: 0 }))
      .toBeLessThan(at(90, far, { x: 0, z: 0, altitude: 0 }));
  });

  it('never returns more wind than there is, or less than none', () => {
    const wall = () => 100_000;
    for (let deg = 0; deg < 360; deg += 45) {
      const kept = at(deg, wall, { x: 0, z: 0, altitude: 0 });
      expect(kept).toBeGreaterThanOrEqual(0);
      expect(kept).toBeLessThanOrEqual(1);
    }
  });
});
