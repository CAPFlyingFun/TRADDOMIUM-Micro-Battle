import { describe, expect, it } from 'vitest';
import {
  NOTCHES, NOTCH_MARK, NOTCH_SPEED, NOTCH_TURN, shift, slower, type Notch,
} from '../src/ant/gait';

describe('the throttle ladder', () => {
  it('runs astern, through stop, up to a sprint', () => {
    expect(NOTCHES).toEqual([
      'backWalk', 'backCrawl', 'stop', 'crawl', 'walk', 'run', 'sprint',
    ]);
  });

  it('only reverses at a crawl or a walk', () => {
    // An ant hauling something backwards is not sprinting.
    const astern = NOTCHES.filter((n) => NOTCH_SPEED[n] < 0);
    expect(astern).toHaveLength(2);
    expect(Math.abs(NOTCH_SPEED.backCrawl)).toBe(NOTCH_SPEED.crawl);
    expect(Math.abs(NOTCH_SPEED.backWalk)).toBe(NOTCH_SPEED.walk);
  });

  it('gets faster with every notch ahead', () => {
    expect(NOTCH_SPEED.stop).toBe(0);
    expect(NOTCH_SPEED.crawl).toBeLessThan(NOTCH_SPEED.walk);
    expect(NOTCH_SPEED.walk).toBeLessThan(NOTCH_SPEED.run);
    expect(NOTCH_SPEED.run).toBeLessThan(NOTCH_SPEED.sprint);
  });

  it('trades agility for speed, and pivots freely at rest', () => {
    expect(NOTCH_TURN.crawl).toBeGreaterThan(NOTCH_TURN.walk);
    expect(NOTCH_TURN.walk).toBeGreaterThan(NOTCH_TURN.run);
    expect(NOTCH_TURN.run).toBeGreaterThan(NOTCH_TURN.sprint);
    expect(NOTCH_TURN.stop).toBeGreaterThan(NOTCH_TURN.crawl);
  });

  it('marks each notch the way the sketch drew it', () => {
    expect(NOTCH_MARK.crawl).toBe('›');
    expect(NOTCH_MARK.walk).toBe('››');
    expect(NOTCH_MARK.run).toBe('›››');
    expect(NOTCH_MARK.sprint).toBe('››››');
    expect(NOTCH_MARK.backCrawl).toBe('‹');
    expect(NOTCH_MARK.backWalk).toBe('‹‹');
  });
});

describe('shifting the telegraph', () => {
  it('steps one notch at a time', () => {
    expect(shift('walk', 1)).toBe('run');
    expect(shift('walk', -1)).toBe('crawl');
  });

  it('carries on down through stop into astern', () => {
    // Tapping down from ahead must reach reverse without a mode change.
    expect(shift('crawl', -1)).toBe('stop');
    expect(shift('stop', -1)).toBe('backCrawl');
    expect(shift('backCrawl', -1)).toBe('backWalk');
  });

  it('stops at the ends rather than wrapping round', () => {
    // Wrapping would put full astern one tap past full ahead.
    expect(shift('sprint', 1)).toBe('sprint');
    expect(shift('backWalk', -1)).toBe('backWalk');
    expect(shift('stop', 99)).toBe('sprint');
    expect(shift('stop', -99)).toBe('backWalk');
  });

  it('eases a spent sprint down one, not to a halt', () => {
    expect(slower('sprint')).toBe('run');
  });

  it('never leaves a notch without a mark or a speed', () => {
    for (const notch of NOTCHES) {
      expect(NOTCH_MARK[notch as Notch]).toBeTruthy();
      expect(Number.isFinite(NOTCH_SPEED[notch as Notch])).toBe(true);
    }
  });
});
