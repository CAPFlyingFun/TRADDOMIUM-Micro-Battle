/**
 * HER BIRTH AREA, SHAPED (sarahlab/birthArea.ts), on a stand-in: a band of skin bent round under her (an arc round a
 * line across her, as her crotch is). The cleft runs in along its middle between its two ends, a soft fold either side
 * stands a little out, nothing far to the side or facing sideways (her inner thighs) moves, and the move fades to
 * nothing at both ends.
 */
import { describe, expect, it } from 'vitest';
import { BIRTH_AREA, birthAreaField } from '../src/sarahlab/birthArea';

// (the field finds its middle `centreUp` above the band's lowest point: the arc's own middle when the arc is that round)
const CY = 0.87, CZ = 0.0, R = BIRTH_AREA.centreUp;
function band(sideways = false) {
  const pos: number[] = [], nrm: number[] = [], at: { x: number; deg: number }[] = [];
  for (let d = -80; d <= 80; d += 2) for (let x = -0.03; x <= 0.0301; x += 0.0005) {
    const a = (d * Math.PI) / 180;
    pos.push(x, CY - R * Math.cos(a), CZ + R * Math.sin(a));
    if (sideways) nrm.push(Math.sign(x) || 1, 0, 0); else nrm.push(0, -Math.cos(a), Math.sin(a));
    at.push({ x, deg: d });
  }
  return { pos, nrm, at };
}

describe('her birth area, shaped', () => {
  it('in along the middle between its ends, out a little either side, nothing far off or past its ends', () => {
    const { pos, nrm, at } = band(), f = birthAreaField(pos, nrm);
    const move = new Map<number, number>();
    for (let k = 0; k < f.index.length; k++) { const i = f.index[k]; move.set(i, f.move[k * 3] * nrm[i * 3] + f.move[k * 3 + 1] * nrm[i * 3 + 1] + f.move[k * 3 + 2] * nrm[i * 3 + 2]); }
    // (at the band's point nearest x: it has one every half millimetre)
    const amount = (x: number, deg: number) => { const i = at.findIndex((p) => Math.abs(p.x - x) < 0.00025 + 1e-9 && p.deg === deg); return move.get(i) ?? 0; };
    expect(f.index.length).toBeGreaterThan(0);
    // the two folds stand out either side and meet in the middle: the middle the low line between them, never an open groove
    expect(amount(BIRTH_AREA.foldAt, 4)).toBeGreaterThan(0.5 * BIRTH_AREA.fold);
    expect(amount(-BIRTH_AREA.foldAt, 4)).toBeCloseTo(amount(BIRTH_AREA.foldAt, 4), 9);
    expect(amount(0, 4)).toBeLessThan(amount(BIRTH_AREA.foldAt, 4));
    expect(amount(0, 4)).toBeGreaterThan(-BIRTH_AREA.depth);
    expect(Math.abs(amount(0.025, 4))).toBeLessThan(1e-4);
    // past its ends, nothing of the cleft
    expect(amount(0, -70)).toBe(0);
    expect(amount(0, BIRTH_AREA.front + 30)).toBeGreaterThanOrEqual(0);
    // never more than its depth
    for (const v of move.values()) expect(Math.abs(v)).toBeLessThanOrEqual(Math.max(BIRTH_AREA.depth, BIRTH_AREA.fold + BIRTH_AREA.mound) + 1e-9);
  });

  it('skin facing sideways (her inner thighs) is never moved', () => {
    const { pos, nrm } = band(true);
    expect(birthAreaField(pos, nrm).index.length).toBe(0);
  });
});
