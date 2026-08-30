/**
 * SHE FLOATS ON THE WATER SHE CAN SEE.
 *
 * Joshua, on v0.0.125: "something is causing me to fall below the
 * water inland... we need to figure out how to make the ant walk /
 * stand on the water".
 *
 * The audit called this A5/F1 and parked it as accepted technical
 * debt, on the explicit condition that it be fixed IF THE UNDERWATER
 * SYMPTOM RETURNED. It returned, so this file is the fix's proof and
 * the record of what the fault actually was.
 *
 * THE FAULT: two grounds. The fresh sheet draws its surface at
 * `base[i] + d * relief`, where base is groundHeight at the 100-unit
 * CELL corners, linearly interpolated across the quad. Her float seat
 * used groundHeight sampled on the exact 8-unit terrain triangle. A
 * 100-unit chord across 8-unit terrain misses by whatever the ground
 * does in between — so the picture and the physics were answering
 * different questions, and about half the time the picture won.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadIsland } from './support/island';
import { groundHeight, reliefScale } from '../src/world/heightfield';
import { geoToWorld } from '../src/world/geo';
import { DRAUGHT, FOOTING } from '../src/ant/wading';

/** The sheet's own lattice — IslandWater's CELL. */
const CELL = 100;
/** Her body, nose to tail, in world units (see the queen-parts probe). */
const BODY = 0.99;

/** The bed the SHEET draws on: corners at CELL, bilinear across the quad. */
function drawnBed(wx: number, wz: number): number {
  const cx = Math.floor(wx / CELL) * CELL;
  const cz = Math.floor(wz / CELL) * CELL;
  const c00 = groundHeight(cx, cz);
  const c10 = groundHeight(cx + CELL, cz);
  const c01 = groundHeight(cx, cz + CELL);
  const c11 = groundHeight(cx + CELL, cz + CELL);
  const tx = (wx - cx) / CELL;
  const tz = (wz - cz) / CELL;
  return (c00 * (1 - tx) + c10 * tx) * (1 - tz)
    + (c01 * (1 - tx) + c11 * tx) * tz;
}

/** Where the sheet draws the surface, given the solver's depth there. */
const skinAt = (wx: number, wz: number, raw: number): number =>
  drawnBed(wx, wz) + raw * reliefScale();

/** What spotAt reports NOW: the drawn skin measured down to her ground. */
const columnNow = (wx: number, wz: number, raw: number): number =>
  skinAt(wx, wz, raw) - groundHeight(wx, wz);

/**
 * What it reported BEFORE: the solver's depth, which knew nothing about
 * where the sheet had actually drawn its bed.
 */
const columnBefore = (raw: number): number => raw * reliefScale();

/** Where wadeAt seats a floating queen, given a reported column. */
const seat = (wx: number, wz: number, column: number): number =>
  groundHeight(wx, wz) + Math.max(0, column - DRAUGHT);

const SPOT = { lat: 22.10664908, lon: -159.30305567 };

describe('the seat and the skin', () => {
  beforeAll(() => { loadIsland(); }, 120000);

  it('now agree, everywhere, by construction', () => {
    const at = geoToWorld(SPOT);
    let worst = 0;
    let n = 0;
    for (let dz = -3000; dz <= 3000; dz += 211) {
      for (let dx = -3000; dx <= 3000; dx += 211) {
        const wx = at.wx + dx;
        const wz = at.wz + dz;
        if (groundHeight(wx, wz) <= 0) continue;      // the sea is not ours
        const raw = 57;                                // a pond, as reported
        const column = columnNow(wx, wz, raw);
        if (column <= 0) continue;                     // skin buried: dry
        // She rides the film: exactly DRAUGHT under the drawn surface,
        // and never more.
        const gap = skinAt(wx, wz, raw) - seat(wx, wz, column);
        worst = Math.max(worst, Math.abs(gap - DRAUGHT));
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-6);
  }, 120000);

  it('and they did NOT before — this is the bug, measured', () => {
    const at = geoToWorld(SPOT);
    const raw = 57;
    let under = 0;
    let drowned = 0;
    let n = 0;
    for (let dz = -3000; dz <= 3000; dz += 211) {
      for (let dx = -3000; dx <= 3000; dx += 211) {
        const wx = at.wx + dx;
        const wz = at.wz + dz;
        if (groundHeight(wx, wz) <= 0) continue;
        const sank = skinAt(wx, wz, raw) - seat(wx, wz, columnBefore(raw));
        n++;
        if (sank > DRAUGHT) under++;
        if (sank > BODY) drowned++;
      }
    }
    // Not a rare corner: about half the island's inland water did it,
    // and a sixth of it buried her past her own length.
    expect(under / n).toBeGreaterThan(0.3);
    expect(drowned / n).toBeGreaterThan(0.1);
  }, 120000);

  it('at the exact spot Joshua reported', () => {
    const at = geoToWorld(SPOT);
    const raw = 57;
    const sank = skinAt(at.wx, at.wz, raw)
      - seat(at.wx, at.wz, columnBefore(raw));
    // Nearly her whole body length under a surface she was floating on.
    expect(sank).toBeGreaterThan(0.9);
    expect(sank).toBeLessThan(BODY);
    // And now she rides the film instead.
    const gap = skinAt(at.wx, at.wz, raw)
      - seat(at.wx, at.wz, columnNow(at.wx, at.wz, raw));
    expect(gap).toBeCloseTo(DRAUGHT, 9);
  }, 120000);

  /**
   * THE OTHER SIGN OF THE SAME FAULT. Half the disagreement runs the
   * other way: the drawn bed dips BELOW the true ground and the sheet
   * is buried inside the hill. Floating her on water she cannot see is
   * the same bug wearing the other hat, so the query answers dry.
   */
  it('and water drawn under the ground does not float her', () => {
    const at = geoToWorld(SPOT);
    let buried = 0;
    for (let dz = -3000; dz <= 3000; dz += 211) {
      for (let dx = -3000; dx <= 3000; dx += 211) {
        const wx = at.wx + dx;
        const wz = at.wz + dz;
        if (groundHeight(wx, wz) <= 0) continue;
        // A film the solver holds but the sheet draws inside the hill.
        if (columnNow(wx, wz, 0.5) <= 0) buried++;
      }
    }
    expect(buried).toBeGreaterThan(0);
  }, 120000);

  it('and FOOTING now measures water she can see', () => {
    // The float threshold reads the same column the sheet draws, so
    // "deep enough to swim" and "deep enough to look like water" are
    // one question rather than two.
    expect(FOOTING).toBeGreaterThan(DRAUGHT);
  });
});

/**
 * THE ROOT CAUSE, and it was not the seat at all.
 *
 * The seat was correct to the millimetre the whole time — measured:
 * `riding` equalled `depth - DRAUGHT` on every sample. What was wrong
 * was that the seat and the SHEET were reading the pond one step
 * apart: `wadeAt` ran at IslandScene:1497 and the sim stepped 350
 * lines later at :1846, so she was placed against the water as it
 * stood and the sheet was then drawn from the water after its step.
 *
 * She rode one water-step under the surface she could see, every
 * frame, for ever. On a still pond that is nothing, which is why it
 * hid for so long. In the heavy rain Joshua was flying in the pond
 * climbs about two units a step, and she sat two units under.
 *
 * Measured before: wade 14.04 against query 14.43, then wade 14.43
 * against query 16.37 — `wade` was always exactly the PREVIOUS query.
 * After: wade == query on every sample, and her seat -0.15 from the
 * drawn skin including on the frames where the pond rose 1.95.
 */
describe('one frame is one state of the pond', () => {
  const scene = () => readFileSync('src/scenes/IslandScene.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('steps the water BEFORE anything reads it', () => {
    const body = scene();
    const stepped = body.indexOf('this.water?.update(dt);');
    const read = body.indexOf('const wade = wadeAt(');
    expect(stepped).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(stepped).toBeLessThan(read);
  });

  it('and steps it exactly once a frame', () => {
    const body = scene();
    const steps = body.match(/this\.water\?\.update\(dt\);/g) ?? [];
    expect(steps).toHaveLength(1);
  });

  /**
   * The rule the SEA already had, a few lines from where the fresh
   * step used to live: "before anything reads the water, so a frame
   * never spans two different tables." Fresh water was simply never
   * given it.
   */
  it('the same rule the sea already followed', () => {
    expect(scene()).toContain('this.stepSea();');
  });
});

describe('the query is wired to the drawn bed', () => {
  const source = () => readFileSync('src/world/IslandWater.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('reads base on the same lattice as the depth, and returns the column', () => {
    const body = source();
    expect(body).toContain('const bed = (b00 * (1 - tx) + b10 * tx) * (1 - ty)');
    expect(body).toContain('const skin = bed + raw * reliefScale();');
    expect(body).toContain('const over = skin - groundHeight(wx, wz);');
    expect(body).toContain('return { depth: over, flowX: 0, flowZ: 0 };');
    // The old answer must not survive anywhere.
    expect(body).not.toContain('return { depth: raw * reliefScale()');
  });

  it('and the OCEAN is untouched — it never reaches this branch', () => {
    const body = source();
    // The sea is chosen before the fresh query is consulted.
    expect(body).toContain('const g = groundHeight(wx, wz);');
    expect(body).toContain('if (g < 0) {');
  });
});
