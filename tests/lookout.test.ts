/**
 * THE FORWARD MARCH — what is in her way, and which way she goes round.
 *
 * Joshua, after watching a routed flight clip trunks: "Can you not have
 * it scan ahead 10-20 meters and will alter the trajectory left or
 * right basically having its own first person camera view and if
 * anything is like in the center one third grid camera rule, will try
 * and make it out of it and if not, will slow down, descend and make an
 * effort to avoid it?"
 *
 * The route planner cannot do this and its own readout proved it:
 * `trees 8/338`. Eight octagons is what a 160-vertex visibility graph
 * affords, and a jungle leg has three hundred trunks across it. So
 * trees moved to where terrain has always been in this project —
 * dodged in front of her, every frame.
 *
 * All of it is arithmetic on circles, so none of it needs a world.
 */
import { describe, expect, it } from 'vitest';
import { lookout, reachFor, type Trunk } from '../src/ant/lookout';
import { world, type WorldPoint } from '../src/world/coords';

const HER = world(0, 0);
/** Half a metre of air each side, which is the shipped lane. */
const LANE = 50;
const REACH = 1_500;

/** A trunk `range` ahead on bearing 0 (north is -Z) and `off` to the right. */
function trunk(range: number, off: number, radius = 60, id = 't'): Trunk {
  return { id, at: world(off, -range), radius };
}

const north = (trunks: readonly Trunk[], from: WorldPoint = HER) =>
  lookout(from, 0, REACH, LANE, trunks);

describe('what the march can see', () => {
  it('an empty lane is nothing to do', () => {
    expect(north([])).toBeNull();
  });

  it('and a trunk beside the lane is not in it', () => {
    // Two metres off the line: she goes past without moving a wing.
    expect(north([trunk(1_000, 200)])).toBeNull();
  });

  it('and a trunk BEHIND her is not in front of her', () => {
    expect(north([trunk(-500, 0)])).toBeNull();
  });

  it('and one past the reach is a problem for later', () => {
    expect(north([trunk(REACH + 100, 0)])).toBeNull();
  });

  it('but one dead ahead is the whole of the shot', () => {
    const seen = north([trunk(1_000, 0)]);
    expect(seen).not.toBeNull();
    expect(seen!.range).toBeCloseTo(1_000, 6);
    expect(seen!.off).toBeCloseTo(0, 6);
    // Joshua's centre third, as a number: dead centre is all of it.
    expect(seen!.squeeze).toBeCloseTo(1, 6);
  });

  it('and the NEAREST one in the lane is the one that matters', () => {
    // Not the worst and not the average: she is about to reach this
    // one, and whatever is behind it will still be there afterwards.
    const seen = north([
      trunk(1_400, 0, 60, 'far'),
      trunk(600, 20, 60, 'near'),
    ]);
    expect(seen!.id).toBe('near');
  });

  it('and it measures the track she is MAKING GOOD, not her nose', () => {
    // A crabbing queen is carried sideways, and it is the carried line
    // that hits the tree. Same trunk, two tracks: in the lane on one.
    const east = world(1_000, 0);
    const one: Trunk = { id: 'e', at: east, radius: 60 };
    expect(lookout(HER, 90, REACH, LANE, [one])).not.toBeNull();
    expect(lookout(HER, 0, REACH, LANE, [one])).toBeNull();
  });
});

describe('which way she goes round', () => {
  it('passes on the far side of it — left of a trunk on her right', () => {
    const seen = north([trunk(1_000, 30)]);
    expect(seen!.way).toBe(-1);
    expect(seen!.swerve).toBeLessThan(0);
  });

  it('and right of a trunk on her left', () => {
    const seen = north([trunk(1_000, -30)]);
    expect(seen!.way).toBe(1);
    expect(seen!.swerve).toBeGreaterThan(0);
  });

  it('and the swerve grows as she closes on it', () => {
    // Small when it is far, urgent when it is near — which is the whole
    // behaviour, and it needs no gain to tune.
    const far = north([trunk(1_400, 0)])!.swerve;
    const near = north([trunk(300, 0)])!.swerve;
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(far) * 3);
  });

  it('and the swerve actually clears the trunk it is for', () => {
    // The geometry, checked rather than trusted: fly the swerve and see
    // where she is laterally when she draws level with it.
    for (const off of [-40, -10, 0, 15, 45]) {
      const one = trunk(900, off);
      const seen = north([one])!;
      const lateral = Math.tan((seen.swerve * Math.PI) / 180) * seen.range;
      expect(Math.abs(lateral - one.at.wx), `off ${off}`)
        .toBeGreaterThanOrEqual(one.radius + LANE - 1e-6);
    }
  });

  it('and a trunk dead centre still picks a side, the same one twice', () => {
    // A coin toss is fine; dithering between two equally good answers
    // frame to frame is not.
    const one = [trunk(900, 0)];
    expect(north(one)!.way).toBe(north(one)!.way);
    expect(Math.abs(north(one)!.swerve)).toBeGreaterThan(0);
  });
});

describe('when there is no room', () => {
  it('says so when the way round is blocked as well', () => {
    // A gate: two trunks abreast with less than a lane between them.
    const seen = north([
      trunk(900, 0, 60, 'a'),
      trunk(900, 150, 60, 'b'),
      trunk(900, -150, 60, 'c'),
    ]);
    expect(seen).not.toBeNull();
    expect(seen!.pinched).toBe(true);
    // And it still hands over the best of a bad pair rather than giving
    // up — the controller slows and descends on this, it does not stop.
    expect(Number.isFinite(seen!.swerve)).toBe(true);
  });

  it('and takes the open side when only one is blocked', () => {
    // The nearest is a hair to her right, so she would rather go left —
    // but there is a trunk there, and the right is clear.
    const seen = north([
      trunk(900, 5, 60, 'a'),
      trunk(900, -160, 60, 'blocking-the-left'),
    ]);
    expect(seen!.way).toBe(1);
    expect(seen!.pinched).toBe(false);
  });

  it('and a trunk well behind the first does not count as a pinch', () => {
    // Only things she meets at about the same moment.
    const seen = north([
      trunk(400, 0, 60, 'a'),
      trunk(1_400, -110, 60, 'much-later'),
    ]);
    expect(seen!.pinched).toBe(false);
  });
});

describe('how far ahead she looks', () => {
  it('is Joshua\'s ten to twenty metres, at the speed he was flying', () => {
    // The boosted autopilot makes good about seven metres a second.
    expect(reachFor(630)).toBeGreaterThan(1_000);
    expect(reachFor(630)).toBeLessThanOrEqual(2_000);
  });

  it('and holds the WARNING TIME rather than the distance', () => {
    // A queen crawling does not need to watch the next twenty metres;
    // one at ten times the speed needs every centimetre of it.
    expect(reachFor(70)).toBeLessThan(reachFor(2_000));
    expect(reachFor(70)).toBe(800);
    expect(reachFor(100_000)).toBe(2_000);
  });

  it('and a standstill still looks a little way ahead', () => {
    expect(reachFor(0)).toBe(800);
  });
});
