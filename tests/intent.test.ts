/**
 * The one movement shape. Both producers (thumbs now, autonomy later)
 * must be able to hand over sloppy arithmetic and have the actor still
 * see a request inside the contract — and the three fields the creatures
 * added are bounded when present and left absent when not, so a producer
 * that predates them (the capsule's routes) is still complete.
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_INTENT, clampAxis, clampIntent } from '../src/input/Intent';

describe('Intent', () => {
  it('neutral is standing still, all seven fields spelt out, and frozen', () => {
    expect(NEUTRAL_INTENT).toEqual({ forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 0, primary: false, secondary: false });
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
    expect(clampAxis(undefined)).toBe(0);
    expect(clampAxis(NaN)).toBe(0);
    expect(clampAxis(-4)).toBe(-1);
    expect(clampAxis(0.5)).toBe(0.5);
  });

  it('returns a fresh object and leaves the input alone', () => {
    const raw = { forward: 2, strafe: 0, turn: 0, sprint: false };
    const out = clampIntent(raw);
    expect(out).not.toBe(raw);
    expect(raw.forward).toBe(2);
  });

  it('bounds the vertical and the toggles when they are present, and does not invent them when they are not', () => {
    // A producer with nothing to say about a vertical (the capsule's routes) hands over four fields and gets four back.
    const four = clampIntent({ forward: 1, strafe: 0, turn: 0, sprint: false });
    expect('vertical' in four).toBe(false);
    expect('primary' in four).toBe(false);
    expect('secondary' in four).toBe(false);
    // A creature's producer hands over seven; the vertical is an axis like the others, the toggles are booleans or nothing.
    expect(clampIntent({ ...NEUTRAL_INTENT, vertical: 5, primary: true, secondary: false }))
      .toEqual({ forward: 0, strafe: 0, turn: 0, sprint: false, vertical: 1, primary: true, secondary: false });
    expect(clampIntent({ ...NEUTRAL_INTENT, vertical: Number.NaN }).vertical).toBe(0);
    expect(clampIntent({ ...NEUTRAL_INTENT, vertical: -0.25 }).vertical).toBe(-0.25);
    // A toggle that is not exactly `true` is not held.
    expect(clampIntent({ ...NEUTRAL_INTENT, primary: 1 as unknown as boolean }).primary).toBe(false);
    // Clamping twice is clamping once: the shape is a fixed point, present or absent.
    const seven = clampIntent({ ...NEUTRAL_INTENT, vertical: 0.5, primary: true });
    expect(clampIntent(seven)).toEqual(seven);
    expect(clampIntent(four)).toEqual(four);
  });
});
