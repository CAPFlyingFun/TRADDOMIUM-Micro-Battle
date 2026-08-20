import { describe, expect, it } from 'vitest';
import { shouldAskToRotate } from '../src/ui/rotateGate';

describe('asking for landscape', () => {
  it('asks a phone held upright', () => {
    expect(shouldAskToRotate(430, 932, true)).toBe(true);
  });

  it('stays out of the way once the phone is turned', () => {
    expect(shouldAskToRotate(932, 430, true)).toBe(false);
  });

  it('never blocks a desktop, however narrow the window', () => {
    // A keyboard plays fine in a tall window; blocking it would be rude.
    expect(shouldAskToRotate(500, 900, false)).toBe(false);
    expect(shouldAskToRotate(300, 1200, false)).toBe(false);
  });

  it('treats a perfect square as landscape enough', () => {
    // Nothing is gained by nagging at exactly 1:1, and tablets sit near
    // it while rotating.
    expect(shouldAskToRotate(800, 800, true)).toBe(false);
  });
});
