import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro } from '../src/world/hydro';
import { forgetRivers, useRivers } from '../src/world/rivers';
import { forgetLakes, useLakes } from '../src/world/lakes';
import { setRelief, useGrid } from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { waterBodyAt } from '../src/world/water';
import { SWELL } from '../src/world/swell';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const hydro = decodeHydro(read('public/kauai-hydro.bin'));

/** A low river point: the lower Wainiha, raw level 290, 30 m wide. */
const LOW = { wx: -1_246_979, wz: 815_548, level: 290 };

beforeAll(() => {
  useGrid(decodeGrid(read('public/kauai-1025.bin')));
  useRivers(hydro);
  useLakes(hydro);
});
afterAll(() => { forgetRivers(); forgetLakes(); setRelief(1); });

describe('one question, three waters, ONE frame', () => {
  it('a low river mouth is a river at every relief, not sometimes the sea', () => {
    // THE REVIEW'S CATCH. Fresh levels are raw, the sea is not, and the
    // first version compared them anyway — so at the shipped relief of
    // 1.5 a river whose surface DRAWS above the swell still answered
    // "sea", and the surf model ran on standing river water. The
    // winner must not change with the dial, because the dial does not
    // move water relative to the valley it is drawn in.
    for (const relief of [0.25, 1, 1.5, 2]) {
      setRelief(relief);
      const body = waterBodyAt(LOW.wx, LOW.wz, 3.7);
      expect(body?.kind, `relief ${relief}`).toBe('river');
      expect(Math.abs((body?.level ?? 0) - LOW.level)).toBeLessThan(10);
    }
  });

  it('open sea is the sea, and it flows nowhere', () => {
    setRelief(1.5);
    const body = waterBodyAt(0, 2_700_000, 5);
    expect(body?.kind).toBe('sea');
    expect(Math.abs(body!.level)).toBeLessThanOrEqual(SWELL);
    expect(body!.flowX).toBe(0);
  });

  it('the middle of Waita Reservoir is a lake at every relief', () => {
    for (const relief of [0.25, 1.5]) {
      setRelief(relief);
      const body = waterBodyAt(922_859, 1_517_838, 1);
      expect(body?.kind, `relief ${relief}`).toBe('lake');
      expect(body?.level).toBe(7_460);
    }
  });

  it('a river reports its current, raw and downstream', () => {
    setRelief(1);
    const body = waterBodyAt(LOW.wx, LOW.wz, 0);
    expect(body?.kind).toBe('river');
    expect(Math.hypot(body!.flowX, body!.flowZ)).toBeGreaterThanOrEqual(10);
  });
});
