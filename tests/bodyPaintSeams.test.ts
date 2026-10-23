import { describe, expect, it } from 'vitest';
import { despeckle, vertexNeighbours } from '../src/sarahlab/bodyPaint';

/**
 * Her mesh is split along its texture seams: one point, two vertices, each in the triangles on its own side. The paint's
 * clean-up has to see them as one point, or the two copies end up different and a crisp edge shows a notch where they
 * meet (Joshua, 2026-10-22: "the sleeve has a small tear in it").
 */
describe('paint neighbours across a texture seam', () => {
  // a strip of two quads, split down the middle: vertices 1 and 4 are the same point as 2 and 5
  //   0 - 1 | 2 - 3
  //   4'- 5 | 6 - 7   (4 is at x 0, 5 and 6 at x 1, 7 at x 2; row y 1)
  const position = [0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 0, 2, 1, 0];
  const index = [0, 4, 1, 1, 4, 5, 2, 6, 3, 3, 6, 7];

  it('without places, each copy sees only its own side', () => {
    const nb = vertexNeighbours(index, 8);
    expect(Array.from(nb[1]).sort()).toEqual([0, 4, 5]);
    expect(Array.from(nb[2]).sort()).toEqual([3, 6]);
  });
  it('with places, the copies share the whole ring round the point, each other included', () => {
    const nb = vertexNeighbours(index, 8, position);
    expect(Array.from(nb[1]).sort()).toEqual([0, 2, 3, 4, 5, 6]);
    expect(Array.from(nb[2]).sort()).toEqual([0, 1, 3, 4, 5, 6]);
  });
  it('so the clean-up treats both copies alike', () => {
    const values = Float32Array.from([1, 1, 1, 0, 1, 1, 1, 0]);
    despeckle(values, vertexNeighbours(index, 8, position));
    expect(values[1]).toBe(values[2]);
    expect(values[5]).toBe(values[6]);
  });
});
