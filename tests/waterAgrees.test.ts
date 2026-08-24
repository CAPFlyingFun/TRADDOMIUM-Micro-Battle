/**
 * WHAT IS DRAWN IS WHAT IS WET — the regression guard for the fault that
 * this whole centreline change exists to fix.
 *
 * Reported symptom, in Joshua's words: "it shows I am in no water, but
 * apparently I am in the water (I'm slowly moving from the water current
 * edge) although visually it shows no water at my location."
 *
 * Cause: two centrelines. The collision index walked the raw NHDPlus
 * polyline; the ribbon on screen was drawn through a centripetal
 * Catmull-Rom spline over the same points. The shipped chords are 35 m
 * long against channels 5.5 m wide, so on every bend the two courses
 * parted by most of a channel width. Measured then: 11.7% of the water
 * the game collided with had no ribbon over it — 49 units past the drawn
 * edge typically, 352 at worst — and 15,455 samples ran the other way,
 * under visible water on ground the game called dry.
 *
 * Both sides read `reachStations` now (centreline.ts), so they agree by
 * construction. This test is what keeps them agreeing: it rebuilds the
 * ribbon's own coverage from the same rows RiverWater builds geometry
 * from, and asks the GAME — `waterBodyAt`, the function the swim and
 * current code actually calls — whether each point is wet.
 *
 * A SMALL RESIDUAL IS EXPECTED AND BOUNDED. The strip lays two vertices
 * per station on a central-difference perpendicular; `riverAt` measures
 * to the nearest point of a segment. Those differ by a sliver on the
 * inside of a bend, which is geometry, not disagreement about where the
 * river is. The bound below is set well under a queen's body length.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeHydro } from '../src/world/hydro';
import { forgetRivers, reachStations, useRivers } from '../src/world/rivers';
import { forgetLakes, useLakes } from '../src/world/lakes';
import { setRelief, useGrid } from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { RIBBON_EDGE } from '../src/world/centreline';
import { waterBodyAt } from '../src/world/water';

function read(path: string): ArrayBuffer {
  const file = readFileSync(path);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
}

const hydro = decodeHydro(read('public/kauai-hydro.bin'));

beforeAll(() => {
  useGrid(decodeGrid(read('public/kauai-1025.bin')));
  useRivers(hydro);
  useLakes(hydro);
  setRelief(1);
});
afterAll(() => { forgetRivers(); forgetLakes(); setRelief(1); });

/** Nearest approach to a polyline of [x, y, z, w] rows, and the width there. */
function nearest(
  px: number, pz: number, row: Float64Array,
): { off: number; half: number } {
  let off = Infinity;
  let half = 0;
  for (let i = 0; i < row.length / 4 - 1; i++) {
    const ax = row[i * 4];
    const az = row[i * 4 + 2];
    const ex = row[(i + 1) * 4] - ax;
    const ez = row[(i + 1) * 4 + 2] - az;
    const run = ex * ex + ez * ez;
    const t = run > 0
      ? Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / run)) : 0;
    const d = Math.hypot(px - ax - ex * t, pz - az - ez * t);
    if (d < off) {
      off = d;
      half = ((row[i * 4 + 3] + (row[(i + 1) * 4 + 3] - row[i * 4 + 3]) * t) / 2)
        * RIBBON_EDGE;
    }
  }
  return { off, half };
}

/** The reach's shipped points as a row, for the chord-course comparison. */
function chords(reach: number): Float64Array {
  const river = hydro.rivers[reach];
  const row = new Float64Array(river.count * 4);
  for (let i = 0; i < river.count; i++) {
    const p = river.first + i;
    row[i * 4] = hydro.x[p];
    row[i * 4 + 2] = hydro.z[p];
    row[i * 4 + 3] = hydro.width[p];
  }
  return row;
}

/**
 * Sample MID-CHORD, which is the only place this ever went wrong.
 *
 * A Catmull-Rom passes exactly through its control points, so at a shipped
 * point the spline and the chord are the same place and every test that
 * samples there agrees with itself. The first version of this file did
 * exactly that and passed against both courses, proving nothing. The two
 * part company BETWEEN the shipped points, most of all halfway along a
 * 35-metre chord through a bend, so that is where the samples go.
 */
function survey(): {
  total: number;
  missedDrawn: number;
  falseWet: number;
  chordMismatch: number;
} {
  let total = 0;
  let missedDrawn = 0;
  let falseWet = 0;
  let chordMismatch = 0;
  for (let r = 0; r < hydro.rivers.length; r += 29) {
    const row = reachStations(r);
    if (!row) continue;
    const chord = chords(r);
    const river = hydro.rivers[r];
    for (let i = 0; i < river.count - 1; i++) {
      const ax = hydro.x[river.first + i];
      const az = hydro.z[river.first + i];
      const bx = hydro.x[river.first + i + 1];
      const bz = hydro.z[river.first + i + 1];
      let dx = bx - ax;
      let dz = bz - az;
      const run = Math.hypot(dx, dz);
      if (run < 1e-6) continue;
      dx /= run; dz /= run;
      for (const along of [0.25, 0.5, 0.75]) {
        const cx = ax + (bx - ax) * along;
        const cz = az + (bz - az) * along;
        for (const across of [-0.6, -0.2, 0.2, 0.6]) {
          const w = hydro.width[river.first + i];
          const px = cx + -dz * (w / 2) * across;
          const pz = cz + dx * (w / 2) * across;
          const body = waterBodyAt(px, pz, 0);
          // TWO DIFFERENT QUESTIONS, AND THE SEA ANSWERS THEM DIFFERENTLY.
          // "Is the drawn ribbon ever called dry land" is about WATER, and
          // at a river mouth the sea stands above the river's surface, so
          // `waterBodyAt` rightly answers `sea` — she is in water, just not
          // in the river. Counting that as dry put 284 false failures into
          // the first version of this test and every last one of them was a
          // river mouth. "Is she pushed by a current on dry ground" is about
          // the RIVER specifically, because the sea has its own model and its
          // own reasons to be there.
          const inWater = body !== null;
          const inRiver = body !== null && body.kind !== 'sea';
          const drawn = nearest(px, pz, row);
          const onChord = nearest(px, pz, chord);
          total++;
          if (drawn.off <= drawn.half && !inWater) missedDrawn++;
          if (drawn.off > drawn.half * 1.35 && inRiver) falseWet++;
          if ((onChord.off <= onChord.half) !== inRiver) chordMismatch++;
        }
      }
    }
  }
  return { total, missedDrawn, falseWet, chordMismatch };
}

describe('the water she can see is the water that moves her', () => {
  // ONCE, AND NOT AT DESCRIBE TIME. The survey needs the hydrography, which
  // `beforeAll` loads; calling it in the describe body ran it against an
  // empty index and every count came back zero.
  let cached: ReturnType<typeof survey> | null = null;
  const found = (): ReturnType<typeof survey> => (cached ??= survey());

  it('never calls the drawn ribbon dry land', () => {
    // The reported symptom, in its exact form: water on screen, and the
    // game saying she is not in it. This was 11.7% before centreline.ts.
    expect(found().total).toBeGreaterThan(5_000);
    // Zero, and asserted as zero: there is no sliver-of-geometry excuse
    // available on this side. A point under the ribbon is under the ribbon.
    expect(found().missedDrawn).toBe(0);
  });

  it('never pushes her on ground with no ribbon over it', () => {
    // And the other direction, which is what she actually felt: carried
    // downstream while standing somewhere that looks dry. 15,455 samples
    // did this before. Judged a comfortable third of a channel outside
    // the drawn edge, so the strip's mitre sliver is not counted as a
    // fault — it is geometry, and it is a fraction of a body length.
    expect(found().falseWet / found().total).toBeLessThan(0.01);
  });

  it('and follows the SPLINE rather than the shipped chords', () => {
    // THE DISCRIMINATOR, without which the two tests above pass against
    // either course and guard nothing. The bug was that the game agreed
    // with the chords while the screen agreed with the spline; if it ever
    // regresses to that, agreement with the chords is what comes back.
    // Measured here at roughly one sample in eight, and it must not fall
    // to nothing — that would mean the two courses had been re-merged the
    // wrong way round, with the ribbon dragged back onto the chords.
    expect(found().chordMismatch / found().total).toBeGreaterThan(0.02);
  });
});
