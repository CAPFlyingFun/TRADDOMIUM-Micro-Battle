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
 * THE AGREEMENT, PINNED. Joshua asked for crawl 25 / walk 50 / run 75 /
 * sprint 100 across all three media, and as of the quarters retune all
 * three are that: air by construction, land by the retuned PACE_SPEED,
 * sea because PADDLE_PACE scales every rung equally and the ratios
 * survive it exactly.
 *
 * These were the tests that FAILED on that retune, which is what they
 * were written for — moving the land table is a feel change to every
 * step she takes and must never pass silently. They still hold that
 * door: drifting any rung off its quarter fails here.
 */
describe('the tiers are the same share in every medium', () => {
  it('AIR is quarters, exactly', () => {
    expect(paceShare('air', 'crawl')).toBeCloseTo(0.25, 9);
    expect(paceShare('air', 'walk')).toBeCloseTo(0.5, 9);
    expect(paceShare('air', 'run')).toBeCloseTo(0.75, 9);
    expect(paceShare('air', 'sprint')).toBe(1);
    // Written as literal quarters of the model's maximum.
    expect(AUTO_AIRSPEED.walk).toBeCloseTo(MAX_POWERED_SPEED * 0.5, 9);
  });

  it('LAND is too, since the retune — 25 / 50 / 75 / 100', () => {
    expect(paceShare('land', 'crawl')).toBeCloseTo(0.25, 9);
    expect(paceShare('land', 'walk')).toBeCloseTo(0.5, 9);
    expect(paceShare('land', 'run')).toBeCloseTo(0.75, 9);
    expect(paceShare('land', 'sprint')).toBe(1);
    // The literals too, so moving SPRINT_SPEED alone cannot keep the
    // shares looking right while changing every speed underneath them.
    expect(PACE_SPEED.crawl).toBe(4.5);
    expect(PACE_SPEED.walk).toBe(9);
    expect(PACE_SPEED.run).toBe(13.5);
    expect(SPRINT_SPEED).toBe(18);
  });

  it('but the SPEEDS still differ by medium, and should', () => {
    // Same rung, three different worlds. Sharing a share is not sharing
    // a speed: a CRAWL in the air (17.5) all but matches a SPRINT on
    // foot (18), and comfortably outruns a run.
    expect(paceCeiling('air', 'crawl')).toBeGreaterThan(paceCeiling('land', 'run'));
    expect(paceCeiling('air', 'crawl') / paceCeiling('land', 'sprint'))
      .toBeGreaterThan(0.95);

    // And the retune changed a real ordering rather than only the
    // labels: paddling flat out is 3.96, which used to BEAT the 2.2
    // crawl on land and now sits below the 4.5 one. Slowest thing she
    // can do on her feet is faster than the fastest she can swim.
    expect(paceCeiling('sea', 'sprint')).toBeLessThan(paceCeiling('land', 'crawl'));
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
    expect(gaitWords('land', 'crawl')).toBe('crawl 25%');
    expect(gaitWords('sea', 'sprint')).toBe('sprint 100%');
  });
});
