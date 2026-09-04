import { beforeEach, describe, expect, it } from 'vitest';
import { ISLAND_SPAN, world } from '../src/world/coords';
import { ORIGIN_STEP, REBASE_AT, originAt, rebaseFor, setOrigin, toLocal } from '../src/world/origin';

beforeEach(() => setOrigin(world(0, 0)));

describe('why this exists at all', () => {
  it('keeps rendered coordinates where float32 is still precise', () => {
    // The whole point, stated as a measurement. At the far corner of
    // the world a float32 cannot resolve a quarter of her body length;
    // near the origin it resolves a thousandth of a millimetre.
    const spacing = (x: number): number => {
      let d = Math.abs(x) * 1.2e-7 || 1e-45;
      while (Math.fround(x + d) === x) d *= 2;
      let lo = 0;
      let hi = d;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        if (Math.fround(x + mid) === x) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    expect(spacing(ISLAND_SPAN / 2)).toBeGreaterThan(0.1);
    // Rebasing holds everything rendered inside this, and there the
    // spacing is far below anything an eye or a leg could notice.
    expect(spacing(REBASE_AT * 2)).toBeLessThan(0.002);
  });

  it('has a logical world that costs nothing, because JS is float64', () => {
    const far = ISLAND_SPAN / 2;
    expect(far + 1e-6).not.toBe(far);
  });
});

describe('rebasing', () => {
  it('leaves her alone while she is close to the origin', () => {
    expect(rebaseFor(world(REBASE_AT - 1, 0))).toBeNull();
    expect(originAt()).toEqual({ wx: 0, wz: 0 });
  });

  it('shifts the world once she strays far enough', () => {
    const shift = rebaseFor(world(REBASE_AT + 500, 0));
    expect(shift).not.toBeNull();
    expect(shift?.dx).toBeGreaterThan(0);
    expect(shift?.dz).toBe(0);
  });

  it('snaps to a lattice rather than following her exactly', () => {
    // A continuously-moving origin re-rounds every vertex every frame,
    // which is the shimmer this exists to prevent.
    rebaseFor(world(REBASE_AT + 517.3, REBASE_AT + 99.9));
    const at = originAt();
    expect(at.wx % ORIGIN_STEP).toBe(0);
    expect(at.wz % ORIGIN_STEP).toBe(0);
  });

  it('hands back the exact delta, so nothing has to subtract two big numbers', () => {
    setOrigin(world(ISLAND_SPAN / 4, ISLAND_SPAN / 4));
    const before = originAt();
    const shift = rebaseFor(world(ISLAND_SPAN / 4 + REBASE_AT + 10, ISLAND_SPAN / 4));
    expect(shift).not.toBeNull();
    const after = originAt();
    expect(after.wx - before.wx).toBe(shift?.dx);
    expect(after.wz - before.wz).toBe(shift?.dz);
  });

  it('keeps her rendered position sane right across the world', () => {
    // Walk the whole island and check nothing rendered ever gets big.
    let worst = 0;
    for (let x = -ISLAND_SPAN / 2; x <= ISLAND_SPAN / 2; x += REBASE_AT / 3) {
      rebaseFor(world(x, 0));
      worst = Math.max(worst, Math.abs(toLocal(world(x, 0)).lx));
    }
    expect(worst).toBeLessThan(REBASE_AT + ORIGIN_STEP);
  });

  it('renders the origin itself at zero', () => {
    setOrigin(world(ISLAND_SPAN / 3, -ISLAND_SPAN / 3));
    const seat = toLocal(originAt());
    expect(seat.lx).toBe(0);
    expect(seat.lz).toBe(0);
  });

  it('setOrigin snaps too, so a spawn and a rebase agree on the lattice', () => {
    setOrigin(world(1_000_000, -1_000_000));
    // Math.abs: a negative multiple gives -0 from %, and -0 is not Object.is 0.
    expect(Math.abs(originAt().wx % ORIGIN_STEP)).toBe(0);
    expect(Math.abs(originAt().wz % ORIGIN_STEP)).toBe(0);
  });
});
