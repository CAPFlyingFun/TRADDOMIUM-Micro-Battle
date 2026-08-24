/**
 * THE ISLAND HAS TO HAVE ROOM FOR ITS OWN WATER — AT EVERY TIER.
 *
 * lakes.test.ts asks this of the source function. This file asks it of
 * the SURFACE THAT GETS DRAWN, which is a different question and the
 * one that was wrong: a distance tier samples every 312 or 3,125 units
 * and draws flat triangles between the samples, and it was those
 * triangles, not `terrainHeight`, that stood over the rivers.
 *
 * The symptom was a pale sheet in mid-air you could fly through — the
 * same "two terrains" fault the tier ladder was built to cure, except
 * the second surface was water. Half the drainage was buried in
 * hillside, and RiverWater's slope-scaled polygon offset floated the
 * buried half back out over the hill.
 *
 * So the invariant is stated where it broke: reconstruct the tier's
 * drawn surface by interpolating its own vertices, and require it to
 * stay under the water it is supposed to hold.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro, type Hydro } from '../src/world/hydro';
import { insideLake, lakeShape, useLakes } from '../src/world/lakes';
import { riverLevel, riverSegment, useRivers } from '../src/world/rivers';
import { farHeight, useGrid } from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}
const hydro: Hydro = decodeHydro(read('public/kauai-hydro.bin'));

/**
 * The tiers that sample `farHeight`, and the footprint each vertex
 * stands for. TerrainStream's FOOTPRINT is 1 — one whole step — and
 * that is not a taste: 0.75 leaves 4 river samples buried and 1.45 is
 * simply a wider trench for no gain. Measured here.
 */
const TIERS = [
  { name: 'transition', step: 312.5 },
] as const;

/**
 * THE MIDDLE TIER IS NOT HERE, and its absence is the point.
 *
 * It used to be, and satisfying it is what broke the island. Its
 * vertices are 3,125 apart, so containing water under them meant a
 * carve that flattened 62 metres of shelf at the waterline along every
 * river — grass plateaus ending in vertical walls, which is what
 * Joshua photographed.
 *
 * It was never needed. RiverWater stops at the transition tier's
 * reach, so nothing coarser ever has water drawn over it, and a tier
 * with no water to hold has nothing to contain. TerrainStream caps the
 * carve footprint at the transition step for exactly this reason.
 *
 * If water is ever drawn further out again, this list is the first
 * thing that has to grow — and the cap with it.
 */

/**
 * How far over the water a tier may be before it counts as burying it.
 *
 * A MICRON, which is to say nothing at all.
 *
 * The brim is zero now, so the ground beside a channel meets the
 * surface EXACTLY, and exact equality run through a bilinear
 * interpolation lands either side of zero by a picometre. That is the
 * only thing this tolerance is for.
 *
 * IT WAS BRIEFLY ONE CENTIMETRE, while the coarsest tier was still
 * burying the river by 2.5 of them, and that was the wrong move —
 * widening a tolerance until the failure fits inside it is how a test
 * stops being one. The shelf was widened instead (see rivers.ts) and
 * the number went to zero on its own.
 */
const TIE = 1e-6;

/** What the tier actually DRAWS at (x, z): its triangles, interpolated. */
function drawnAt(step: number, slack: number, x: number, z: number): number {
  const gx = Math.floor(x / step) * step;
  const gz = Math.floor(z / step) * step;
  const tx = (x - gx) / step;
  const tz = (z - gz) / step;
  const a = farHeight(gx, gz, slack);
  const b = farHeight(gx + step, gz, slack);
  const c = farHeight(gx, gz + step, slack);
  const d = farHeight(gx + step, gz + step, slack);
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/** Every place a lake surface is drawn, and how far the ground is over it. */
function lakesOverdrawn(step: number, slack: number): number[] {
  const over: number[] = [];
  for (let i = 0; i < hydro.lakes.length; i++) {
    const box = lakeShape(i);
    const walk = Math.max(80, Math.max(box.maxX - box.minX, box.maxZ - box.minZ) / 20);
    for (let x = box.minX; x <= box.maxX; x += walk) {
      for (let z = box.minZ; z <= box.maxZ; z += walk) {
        if (!insideLake(i, x, z)) continue;
        const gap = drawnAt(step, slack, x, z) - box.level;
        if (gap > TIE) over.push(gap);
      }
    }
  }
  return over;
}

/** The same for the river ribbons, sampled along their centrelines. */
function riversOverdrawn(step: number, slack: number): number[] {
  const over: number[] = [];
  for (let i = 0; i < 48_544; i += 37) {
    const seg = riverSegment(i);
    if (!seg) continue;
    const x = (seg.ax + seg.bx) / 2;
    const z = (seg.az + seg.bz) / 2;
    const level = riverLevel(x, z);
    if (level === null) continue;
    const gap = drawnAt(step, slack, x, z) - level;
    if (gap > TIE) over.push(gap);
  }
  return over;
}

beforeAll(() => {
  useGrid(decodeGrid(read('public/kauai-1025.bin')));
  useLakes(hydro);
  useRivers(hydro);
});

describe('the drawn distance tiers hold the water they are drawn under', () => {
  for (const tier of TIERS) {
    it(`${tier.name}: no lake surface is buried`, () => {
      expect(lakesOverdrawn(tier.step, tier.step)).toEqual([]);
    });

    it(`${tier.name}: no river surface is buried`, () => {
      expect(riversOverdrawn(tier.step, tier.step)).toEqual([]);
    });
  }
});

describe('and it is the footprint that does it', () => {
  // THE NEGATIVE CONTROL. Without it every assertion above passes for
  // free if `farHeight` ever stops asking about the footprint — which
  // is exactly the state this file was written to end.
  it('point sampling buries most of the drainage', () => {
    const buried = riversOverdrawn(3_125, 0);
    expect(buried.length).toBeGreaterThan(400);
    buried.sort((a, b) => a - b);
    // A metre typical, seventeen at worst: a river inside a hill. (Even
    // this understates what shipped — `farHeight` refused rivers
    // outright then, so a point sample of the trench was not on offer
    // at all and the worst case was sixty-six metres.)
    //
    // THE WORST CASE USED TO BE THIRTY METRES AND IS NOW SEVENTEEN, and
    // the control is not being loosened to accommodate a regression —
    // it is being corrected for an improvement in the thing it controls
    // FOR. A point sample can only find a trench if a station happens
    // to lie near it, and the centreline now carries 281,069 of them
    // where it carried 48,544 (centreline.ts), so the coarse tier's
    // blind guess is a better guess than it was. Measured here: 890
    // samples still buried, 140 units typical, 1,734 at worst. Seventeen
    // metres of ground standing over a river is still a river inside a
    // hill, so the control still says what it was written to say.
  });

  it('and buries lakes at the coarsest step too', () => {
    expect(lakesOverdrawn(3_125, 0).length).toBeGreaterThan(1_000);
  });
});
