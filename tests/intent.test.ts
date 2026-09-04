/**
 * The one movement shape. Both producers (thumbs now, autonomy later)
 * must be able to hand over sloppy arithmetic and have the actor still
 * see a request inside the contract.
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_INTENT, clampIntent } from '../src/input/Intent';

describe('Intent', () => {
  it('neutral is standing still and frozen', () => {
    expect(NEUTRAL_INTENT).toEqual({ forward: 0, strafe: 0, turn: 0, sprint: false });
    expect(Object.isFrozen(NEUTRAL_INTENT)).toBe(true);
  });

  it('clamps every axis to -1..1', () => {
    expect(clampIntent({ forward: 3, strafe: -7, turn: 1.0001, sprint: true })).toEqual({
      forward: 1, strafe: -1, turn: 1, sprint: true,
    });
    expect(clampIntent({ forward: 0.25, strafe: -0.5, turn: 0, sprint: false })).toEqual({
      forward: 0.25, strafe: -0.5, turn: 0, sprint: false,
    });
  });

  it('reads a non-finite axis as no request, never as full ahead', () => {
    expect(clampIntent({ forward: Number.NaN, strafe: Number.POSITIVE_INFINITY, turn: Number.NEGATIVE_INFINITY, sprint: true }))
      .toEqual({ forward: 0, strafe: 0, turn: 0, sprint: true });
  });

  it('returns a fresh object and leaves the input alone', () => {
    const raw = { forward: 2, strafe: 0, turn: 0, sprint: false };
    const out = clampIntent(raw);
    expect(out).not.toBe(raw);
    expect(raw.forward).toBe(2);
  });
});
