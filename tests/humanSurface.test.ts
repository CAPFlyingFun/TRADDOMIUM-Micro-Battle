/**
 * THE BAKE'S RAY CASTER, CHECKED AGAINST A SHAPE WHOSE ANSWERS ARE KNOWN.
 *
 * `scripts/humanSurface.mjs` is what tells `authorSarah.mjs` that the
 * lanyard is a thin thing lying on a shirt and that the inside of a collar
 * is in shadow. Both readings are distances, and a distance that is quietly
 * wrong does not look wrong — it just puts the strap somewhere else.
 *
 * TWO OF THESE PIN BUGS THAT HAVE ACTUALLY HAPPENED HERE.
 *
 * The first is `tmax`. An earlier version of the walk returned as soon as
 * the best hit fell inside the current cell's t range, which let a hit in
 * the LAST cell — between `tmax` and that cell's far face — escape the
 * bound. Standoff came back at 74 mm against a 60 mm limit, and occlusion
 * counted blockers past a quarter of a metre. The self-test that missed it
 * cut 90 mm short of the boundary; these cut either side of it by a
 * millimetre.
 *
 * The second is glTF's UV origin. (0,0) is the image's TOP-LEFT, so a
 * texel's row is `v * S` and never `(1 - v) * S`. With the other
 * convention every lookup lands on a different island and still looks
 * entirely plausible, which is how this project lost an afternoon to it.
 *
 * The box below is built by hand rather than loaded, so the expected
 * answers are arithmetic rather than another measurement.
 */
import { describe, expect, it } from 'vitest';
import { buildRayGrid, raycast, rasterize } from '../scripts/humanSurface.mjs';

/** A closed axis-aligned box from (0,0,0) to (1,1,1): 12 triangles, wound outward. */
function unitBox(): { P: Float32Array; IDX: Uint32Array } {
  const P = new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,   // z = 0
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,   // z = 1
  ]);
  const IDX = new Uint32Array([
    0, 2, 1, 0, 3, 2,   // back   z=0
    4, 5, 6, 4, 6, 7,   // front  z=1
    0, 1, 5, 0, 5, 4,   // bottom y=0
    3, 7, 6, 3, 6, 2,   // top    y=1
    0, 4, 7, 0, 7, 3,   // left   x=0
    1, 2, 6, 1, 6, 5,   // right  x=1
  ]);
  return { P, IDX };
}

const box = unitBox();
const grid = buildRayGrid(box.P, box.IDX, 0.25);

describe('the ray caster finds the surface it is aimed at', () => {
  it('hits the near face from outside, at the distance to it', () => {
    // Fired from 1 m in front of the box at its middle: the front face is
    // at z = 1, so the ray runs exactly 1 m.
    expect(raycast(grid, 0.5, 0.5, 2, 0, 0, -1, 10)).toBeCloseTo(1, 9);
  });

  it('is a distance, so moving the origin back moves the answer with it', () => {
    const near = raycast(grid, 0.5, 0.5, 2, 0, 0, -1, 10);
    const far = raycast(grid, 0.5, 0.5, 2.5, 0, 0, -1, 10);
    expect(far - near).toBeCloseTo(0.5, 9);
  });

  it('hits the FAR side from inside — the shell is closed and back faces count', () => {
    // This is the standoff question: from just under one surface, how far to
    // the next one? From the middle of the box looking down, 0.5 m.
    expect(raycast(grid, 0.5, 0.5, 0.5, 0, -1, 0, 10)).toBeCloseTo(0.5, 9);
  });

  it('misses when it points away', () => {
    expect(raycast(grid, 0.5, 0.5, 2, 0, 0, 1, 10)).toBe(Infinity);
  });

  it('agrees on an oblique ray', () => {
    // Along the body diagonal from a corner, out through the opposite one:
    // the far corner is sqrt(3) away and the direction is normalised.
    const k = 1 / Math.sqrt(3);
    expect(raycast(grid, 0, 0, 0, k, k, k, 10)).toBeCloseTo(Math.sqrt(3), 6);
  });
});

describe('tmax is a bound, and it is enforced at the boundary', () => {
  const t = 1;   // the known distance to the front face

  it('a tmax one millimetre short is a miss', () => {
    expect(raycast(grid, 0.5, 0.5, 2, 0, 0, -1, t - 0.001)).toBe(Infinity);
  });

  it('a tmax one millimetre long is the same hit', () => {
    expect(raycast(grid, 0.5, 0.5, 2, 0, 0, -1, t + 0.001)).toBeCloseTo(t, 9);
  });

  /**
   * THE REGRESSION ITSELF. The bug let a hit past tmax escape when it lay in
   * the ray's last cell, so it only showed for particular tmax values — the
   * ones that end PART WAY THROUGH a cell rather than near its face. With a
   * 0.25 m cell, a tmax of 0.9 ends inside the cell the front face sits in.
   */
  it('never returns a t beyond its own tmax, whatever the tmax', () => {
    for (let n = 1; n <= 400; n += 1) {
      const tmax = n * 0.005;
      const hit = raycast(grid, 0.5, 0.5, 2, 0, 0, -1, tmax);
      if (Number.isFinite(hit)) expect(hit, `tmax ${tmax}`).toBeLessThanOrEqual(tmax);
    }
  });

  it('never returns a t beyond its tmax on oblique rays either', () => {
    for (let n = 1; n <= 200; n += 1) {
      const a = n * 0.031;
      const dx = Math.cos(a), dy = Math.sin(a) * 0.5, dz = -Math.sin(a);
      const L = Math.hypot(dx, dy, dz);
      for (const tmax of [0.4, 0.9, 1.4, 2.1]) {
        const hit = raycast(grid, 0.5, 0.5, 2, dx / L, dy / L, dz / L, tmax);
        if (Number.isFinite(hit)) expect(hit, `a ${a} tmax ${tmax}`).toBeLessThanOrEqual(tmax);
      }
    }
  });
});

describe('the atlas is rasterised with glTF\'s origin at the TOP LEFT', () => {
  /** One triangle covering the top-left quadrant of a 16×16 atlas, standing
   * at a position that says which way up the sheet was read. */
  const prim = {
    getAttribute(name: string) {
      const data: Record<string, { array: Float32Array; size: number }> = {
        POSITION: { array: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), size: 3 },
        NORMAL: { array: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), size: 3 },
        // v = 0 at the first vertex, so that vertex belongs at the TOP.
        TEXCOORD_0: { array: new Float32Array([0, 0, 0.5, 0, 0, 0.5]), size: 2 },
      };
      const d = data[name];
      return d ? { getArray: () => d.array, getElementSize: () => d.size } : null;
    },
    getIndices: () => ({ getArray: () => new Uint32Array([0, 1, 2]) }),
  };

  const S = 16;
  const { ok, pos } = rasterize(prim, S, 0);

  it('covers the TOP-left quadrant, not the bottom-left one', () => {
    const at = (x: number, y: number) => ok[y * S + x];
    expect(at(1, 1), 'top-left corner').toBeGreaterThan(0);
    expect(at(1, S - 2), 'bottom-left corner').toBe(0);
  });

  it('puts the v = 0 vertex at row 0', () => {
    // The first vertex is at the origin in space and at v = 0 in the atlas,
    // so the texel in the very first row must sit near the origin. Read the
    // other way up it would land a whole quadrant away.
    const i = 0 * S + 0;
    expect(ok[i]).toBeGreaterThan(0);
    expect(Math.hypot(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])).toBeLessThan(0.2);
  });
});
