/**
 * "Last played …" picks the roughest honest unit, and never invents a
 * time it cannot read. Both the menu's RESUME and the slot rows say this
 * about the same save, so it is pinned once, here.
 */
import { describe, expect, it } from 'vitest';
import { timeAgo } from '../src/ui/timeAgo';

describe('timeAgo', () => {
  const now = Date.parse('2026-09-04T12:00:00.000Z');
  const before = (ms: number): string => new Date(now - ms).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('picks the roughest honest unit', () => {
    expect(timeAgo(before(0), now)).toBe('just now');
    expect(timeAgo(before(59_000), now)).toBe('just now');
    expect(timeAgo(before(MIN), now)).toBe('1 minute ago');
    expect(timeAgo(before(3 * MIN), now)).toBe('3 minutes ago');
    expect(timeAgo(before(59 * MIN), now)).toBe('59 minutes ago');
    expect(timeAgo(before(HOUR), now)).toBe('1 hour ago');
    expect(timeAgo(before(23 * HOUR), now)).toBe('23 hours ago');
    expect(timeAgo(before(DAY), now)).toBe('yesterday');
    expect(timeAgo(before(2 * DAY), now)).toBe('2 days ago');
    expect(timeAgo(before(6 * DAY), now)).toBe('6 days ago');
    expect(timeAgo(before(7 * DAY), now)).toBe('1 week ago');
    expect(timeAgo(before(29 * DAY), now)).toBe('4 weeks ago');
    expect(timeAgo(before(30 * DAY), now)).toBe('1 month ago');
    expect(timeAgo(before(364 * DAY), now)).toBe('12 months ago');
    expect(timeAgo(before(365 * DAY), now)).toBe('1 year ago');
    expect(timeAgo(before(800 * DAY), now)).toBe('2 years ago');
  });

  it('never invents a time: a future stamp is "just now", an unreadable one is "some time ago"', () => {
    expect(timeAgo(new Date(now + HOUR).toISOString(), now)).toBe('just now');
    expect(timeAgo('yesterday-ish', now)).toBe('some time ago');
    expect(timeAgo('', now)).toBe('some time ago');
  });
});
