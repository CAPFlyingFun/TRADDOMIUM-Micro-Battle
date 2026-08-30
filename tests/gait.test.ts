/**
 * PACE ACROSS THE THREE MEDIA — one vocabulary over three tables.
 *
 * Land owns PACE_SPEED, air owns AUTO_AIRSPEED, and sea is the land
 * ceiling times PADDLE_PACE inside wadeAt. Nothing decided anything
 * here before; these tests pin what the tuning ACTUALLY is, including
 * the part that does not match.
 */
import { describe, expect, it } from 'vitest';
import {
  TIERS, gaitWords, mediumOf, paceCeiling, paceShare, tierOf,
} from '../src/ant/gait';
import { PACE_SPEED, SPRINT_SPEED } from '../src/ant/pace';
import { AUTO_AIRSPEED, MAX_POWERED_SPEED, SPRINT_AIRSPEED } from '../src/ant/flight';
import { PADDLE_PACE } from '../src/ant/wading';

describe('which ceilings are in force', () => {
  it('is derived from the motion, never asserted', () => {
    expect(mediumOf('flying')).toBe('air');
    expect(mediumOf('swimming')).toBe('sea');
    expect(mediumOf('diving')).toBe('sea');
    expect(mediumOf('wading')).toBe('land');   // feet on the bed: walking
    expect(mediumOf('walking')).toBe('land');
    expect(mediumOf('idle')).toBe('land');
  });
});

describe('the ceilings themselves', () => {
  it('read the existing land table rather than a copy of it', () => {
    expect(paceCeiling('land', 'crawl')).toBe(PACE_SPEED.crawl);
    expect(paceCeiling('land', 'walk')).toBe(PACE_SPEED.walk);
    expect(paceCeiling('land', 'run')).toBe(PACE_SPEED.run);
    expect(paceCeiling('land', 'sprint')).toBe(SPRINT_SPEED);
  });

  it('and the existing air table', () => {
    expect(paceCeiling('air', 'crawl')).toBe(AUTO_AIRSPEED.crawl);
    expect(paceCeiling('air', 'run')).toBe(AUTO_AIRSPEED.run);
    expect(paceCeiling('air', 'sprint')).toBe(SPRINT_AIRSPEED);
  });

  it('and the sea is the land ceiling paddled', () => {
    for (const tier of TIERS) {
      expect(paceCeiling('sea', tier))
        .toBeCloseTo(paceCeiling('land', tier) * PADDLE_PACE, 9);
    }
  });
});

/**
 * THE MISMATCH, WRITTEN DOWN. Joshua asked for crawl 25 / walk 50 /
 * run 75 / sprint 100 across all three. The AIR is exactly that, by
 * construction. LAND is four hand-tuned speeds that do not land on
 * quarters, and SEA inherits land's ratios exactly because PADDLE_PACE
 * scales every rung equally.
 *
 * This test states the tuning as it stands. If the land table is ever
 * moved onto quarters it will fail, which is the point: that is a feel
 * change to every step she takes and should not pass silently.
 */
describe('the tiers are not the same share in every medium', () => {
  it('AIR is quarters, exactly', () => {
    expect(paceShare('air', 'crawl')).toBeCloseTo(0.25, 9);
    expect(paceShare('air', 'walk')).toBeCloseTo(0.5, 9);
    expect(paceShare('air', 'run')).toBeCloseTo(0.75, 9);
    expect(paceShare('air', 'sprint')).toBe(1);
    // Written as literal quarters of the model's maximum.
    expect(AUTO_AIRSPEED.walk).toBeCloseTo(MAX_POWERED_SPEED * 0.5, 9);
  });

  it('LAND is not — 12 / 39 / 67 / 100', () => {
    expect(paceShare('land', 'crawl')).toBeCloseTo(2.2 / 18, 9);
    expect(paceShare('land', 'walk')).toBeCloseTo(7 / 18, 9);
    expect(paceShare('land', 'run')).toBeCloseTo(12 / 18, 9);
    expect(paceShare('land', 'sprint')).toBe(1);
    expect(paceShare('land', 'crawl')).toBeLessThan(0.25);
  });

  it('and SEA inherits land exactly, because the paddle scales it all', () => {
    for (const tier of TIERS) {
      expect(paceShare('sea', tier)).toBeCloseTo(paceShare('land', tier), 9);
    }
  });

  it('sprint is the top of every ladder by definition', () => {
    for (const medium of ['land', 'air', 'sea'] as const) {
      expect(paceShare(medium, 'sprint')).toBe(1);
    }
  });
});

describe('what she is on right now', () => {
  it('is the selected pace until the sprint override takes over', () => {
    expect(tierOf('walk', false)).toBe('walk');
    expect(tierOf('walk', true)).toBe('sprint');
    expect(tierOf('crawl', true)).toBe('sprint');
  });

  it('and reads as one short cell', () => {
    expect(gaitWords('air', 'walk')).toBe('walk 50%');
    expect(gaitWords('land', 'crawl')).toBe('crawl 12%');
    expect(gaitWords('sea', 'sprint')).toBe('sprint 100%');
  });
});
