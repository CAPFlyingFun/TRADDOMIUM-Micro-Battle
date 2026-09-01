/**
 * THE TREE AS TRIANGLES — the shape is checked, not looked at.
 */
import { describe, expect, it } from 'vitest';
import {
  DETAILS, LOWEST_BOUGH, bakeTree, bakeUnitTree, growTree, triangles,
} from '../src/world/treeMesh';

const SPEC = { height: 2_600, girth: 104, seed: 0x7ee } as const;

describe('the skeleton', () => {
  it('is the same tree for the same seed, and a different one otherwise', () => {
    const a = growTree(SPEC);
    const b = growTree(SPEC);
    const c = growTree({ ...SPEC, seed: 0x7ef });
    expect(a.limbs.map((l) => l.b.toArray())).toEqual(b.limbs.map((l) => l.b.toArray()));
    expect(a.limbs.map((l) => l.b.toArray())).not.toEqual(c.limbs.map((l) => l.b.toArray()));
  });

  it('reaches its height, and the boughs start where the hazard says', () => {
    const { limbs, tufts } = growTree(SPEC);
    const trunk = limbs.filter((l) => l.order === 0);
    expect(trunk[trunk.length - 1].b.y).toBeCloseTo(SPEC.height, 6);
    const lowest = Math.min(...limbs.filter((l) => l.order === 1).map((l) => l.a.y));
    // The planner's trunk-only ring rests on this: she flies under it.
    expect(lowest).toBeGreaterThanOrEqual(SPEC.height * LOWEST_BOUGH * 0.95);
    expect(tufts.length).toBeGreaterThan(1);
  });

  it('is widest at the foot and thin at the tip', () => {
    const trunk = growTree(SPEC).limbs.filter((l) => l.order === 0);
    expect(trunk[0].ra).toBeGreaterThan(SPEC.girth / 2);
    expect(trunk[trunk.length - 1].rb).toBeLessThan(5);
  });
});

describe('the bake', () => {
  it('has two levels, the far one trunk-only', () => {
    expect(DETAILS).toHaveLength(2);
    expect(DETAILS[0].sides).toBeGreaterThan(DETAILS[1].sides);
    expect(DETAILS[1].order).toBe(0);
  });

  it('stands on the ground and reaches the crown', () => {
    const geo = bakeTree(SPEC, 0);
    const box = geo.boundingBox!;
    // The foot overruns a little below zero on purpose, so no join shows.
    expect(box.min.y).toBeLessThanOrEqual(0);
    expect(box.min.y).toBeGreaterThan(-SPEC.girth);
    expect(box.max.y).toBeGreaterThan(SPEC.height * 0.98);
    expect(box.max.y).toBeLessThan(SPEC.height * 1.12);
  });

  it('and is cheap enough for a stand — measured, not hoped', () => {
    const near = triangles(bakeTree(SPEC, 0));
    const far = triangles(bakeTree(SPEC, 1));
    expect(near).toBeLessThan(4_000);
    expect(far).toBeLessThan(700);
    expect(far).toBeLessThan(near);
    console.log(`landmark bake: near ${near} tris, far ${far} tris`);
  });

  it('carries its colour in the vertices, so a stand is one material', () => {
    const geo = bakeTree(SPEC, 0);
    const col = geo.getAttribute('color');
    expect(col.count).toBe(geo.getAttribute('position').count);
    let greens = 0;
    for (let i = 0; i < col.count; i++) if (col.getY(i) > col.getX(i)) greens++;
    expect(greens).toBeGreaterThan(0);
    expect(greens).toBeLessThan(col.count);
  });

  it('as a unit tree is one unit tall, for the instance matrix to scale', () => {
    const geo = bakeUnitTree(2_400, 0.04, 0x7ee, 1);
    expect(geo.boundingBox!.max.y).toBeGreaterThan(0.98);
    expect(geo.boundingBox!.max.y).toBeLessThan(1.12);
  });
});
