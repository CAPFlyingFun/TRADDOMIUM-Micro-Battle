import { beforeEach, describe, expect, it } from 'vitest';
import {
  ORIGIN_STEP, originAt, REBASE_AT, rebaseFor, setOrigin, toLocal,
} from '../src/world/origin';
import { world } from '../src/world/coords';
import { SPAN } from '../src/world/kauai';

beforeEach(() => setOrigin(0, 0));

describe('why this exists at all', () => {
  it('keeps rendered coordinates where float32 is still precise', () => {
    // The whole point, stated as a measurement. At the far corner of
    // the world a float32 cannot resolve a quarter of her body length;
    // near the origin it resolves a thousandth of a millimetre.
    const spacing = (x: number) => {
      let d = Math.abs(x) * 1.2e-7 || 1e-45;
      while (Math.fround(x + d) === x) d *= 2;
      let lo = 0;
      let hi = d;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (Math.fround(x + mid) === x) lo = mid; else hi = mid;
      }
      return hi;
    };
    expect(spacing(SPAN / 2)).toBeGreaterThan(0.1);
    // Rebasing holds everything rendered inside this, and there the
    // spacing is far below anything an eye or a leg could notice.
    expect(spacing(REBASE_AT * 2)).toBeLessThan(0.002);
  });

  it('has a logical world that costs nothing, because JS is float64', () => {
    const far = SPAN / 2;
    expect(far + 1e-6).not.toBe(far);
  });
});

describe('rebasing', () => {
  it('leaves her alone while she is close to the origin', () => {
    expect(rebaseFor(REBASE_AT - 1, 0)).toBeNull();
    expect(originAt()).toEqual({ x: 0, z: 0 });
  });

  it('shifts the world once she strays far enough', () => {
    const shift = rebaseFor(REBASE_AT + 500, 0);
    expect(shift).not.toBeNull();
    expect(shift!.x).toBeGreaterThan(0);
  });

  it('snaps to a lattice rather than following her exactly', () => {
    // A continuously-moving origin re-rounds every vertex every frame,
    // which is the shimmer this exists to prevent.
    rebaseFor(REBASE_AT + 517.3, REBASE_AT + 99.9);
    const at = originAt();
    expect(at.x % ORIGIN_STEP).toBe(0);
    expect(at.z % ORIGIN_STEP).toBe(0);
  });

  it('hands back the exact delta, so nothing has to subtract two big numbers', () => {
    setOrigin(SPAN / 4, SPAN / 4);
    const before = originAt();
    const shift = rebaseFor(SPAN / 4 + REBASE_AT + 10, SPAN / 4)!;
    const after = originAt();
    expect(after.x - before.x).toBe(shift.x);
    expect(after.z - before.z).toBe(shift.z);
  });

  it('keeps her rendered position sane right across the world', () => {
    // Walk the whole island and check nothing rendered ever gets big.
    let worst = 0;
    for (let x = -SPAN / 2; x <= SPAN / 2; x += REBASE_AT / 3) {
      rebaseFor(x, 0);
      worst = Math.max(worst, Math.abs(toLocal(world(x, 0)).lx));
    }
    expect(worst).toBeLessThan(REBASE_AT + ORIGIN_STEP);
  });

  it('renders the origin itself at zero', () => {
    setOrigin(SPAN / 3, -SPAN / 3);
    const at = originAt();
    const seat = toLocal(world(at.x, at.z));
    expect(seat.lx).toBe(0);
    expect(seat.lz).toBe(0);
  });
});
