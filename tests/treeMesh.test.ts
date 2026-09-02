/**
 * THE TREE AS TRIANGLES — the shape is checked, not looked at.
 */
import * as THREE from 'three';
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

/**
 * WHICH WAY THE WOOD FACES.
 *
 * A mesh has two independent answers to that — the vertex NORMAL and
 * the triangle's WINDING — and the first cut of `skin` got them to
 * disagree. The normals were the radial vector, which points out; the
 * winding was a->c->b, which faces in. Backface culling then threw the
 * near wall of every trunk away and drew the far inside of it, lit by
 * outward normals. It looks like a tree and it is inside out: "the
 * tree facings are swapped inwards vs outwards" (Joshua, v0.0.149).
 *
 * Neither alone can catch that, so this checks them AGAINST EACH OTHER,
 * and against the geometry they describe.
 */
describe('which way the wood faces', () => {
  /** Every triangle of a bake, as three positions and their normals. */
  function faces(level: number): {
    wound: THREE.Vector3; normal: THREE.Vector3; centre: THREE.Vector3;
  }[] {
    const geo = bakeTree(SPEC, level);
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const index = geo.getIndex();
    const at = (i: number): number => (index ? index.getX(i) : i);
    const count = index ? index.count : pos.count;
    const out = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < count; t += 3) {
      const ia = at(t);
      const ib = at(t + 1);
      const ic = at(t + 2);
      a.fromBufferAttribute(pos, ia);
      b.fromBufferAttribute(pos, ib);
      c.fromBufferAttribute(pos, ic);
      const wound = new THREE.Vector3()
        .subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (wound.lengthSq() < 1e-12) continue;
      const normal = new THREE.Vector3()
        .fromBufferAttribute(nrm, ia)
        .add(new THREE.Vector3().fromBufferAttribute(nrm, ib))
        .add(new THREE.Vector3().fromBufferAttribute(nrm, ic));
      out.push({
        wound: wound.normalize(),
        normal: normal.normalize(),
        centre: new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3),
      });
    }
    geo.dispose();
    return out;
  }

  it('winds every triangle the same way its own normals point', () => {
    for (const level of [0, 1]) {
      const all = faces(level);
      expect(all.length).toBeGreaterThan(100);
      const agree = all.filter((f) => f.wound.dot(f.normal) > 0).length;
      // The leaf blobs are three.js's own and are already right; the
      // wood is what this is about. Every one of them, not most.
      expect(agree, `level ${level}`).toBe(all.length);
    }
  });

  it('and the trunk faces AWAY from its own axis, not into it', () => {
    // BELOW THE LOWEST BOUGH, so this is bare trunk and nothing else:
    // the tufts hang off bough ends, which start at 0.42 of the height
    // and only sweep up. A blob is a sphere about its own centre, so
    // "away from the trunk" says nothing about one and including them
    // is what made the first cut of this test meaningless.
    const CLEAR = SPEC.height * 0.35;
    // The independent check: a tube's outward face points away from the
    // centre line. Read off the geometry rather than off the normals,
    // so a bake with both of them inverted still fails.
    const trunk = growTree(SPEC).limbs.filter((l) => l.order === 0);
    const axisAt = (y: number): THREE.Vector3 => {
      let best = trunk[0].a;
      let gap = Infinity;
      for (const limb of trunk) {
        for (const end of [limb.a, limb.b]) {
          const d = Math.abs(end.y - y);
          if (d < gap) { gap = d; best = end; }
        }
      }
      return best;
    };
    let outward = 0;
    let inward = 0;
    for (const face of faces(1)) {
      if (face.centre.y <= 0 || face.centre.y >= CLEAR) continue;
      const axis = axisAt(face.centre.y);
      const away = new THREE.Vector3(
        face.centre.x - axis.x, 0, face.centre.z - axis.z,
      );
      if (away.lengthSq() < 1e-6) continue;
      const flat = new THREE.Vector3(face.wound.x, 0, face.wound.z);
      if (flat.lengthSq() < 1e-9) continue;
      if (flat.normalize().dot(away.normalize()) > 0) outward++;
      else inward++;
    }
    expect(outward).toBeGreaterThan(20);
    // Bare trunk: every single one of them, not a majority.
    expect(inward).toBe(0);
  });

  it('and the trunk closes round its seam, with no slit to see in by', () => {
    // The ring is built with `sides + 1` vertices so the last one lands
    // back on the first, and the seam column is the join. If it were
    // skipped there would be a slit down the whole trunk you could see
    // the inside through — and with the winding fixed, that is the
    // remaining way to see inside a tree.
    //
    // Counted by POSITION rather than by index, because the bake is
    // non-indexed by the time it leaves: an edge in the middle of the
    // wall is shared by two triangles, and only the tube's open ends
    // are held by one.
    const geo = bakeTree(SPEC, 1);
    const pos = geo.getAttribute('position');
    const key = (i: number): string => `${pos.getX(i).toFixed(2)},`
      + `${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    const edges = new Map<string, number>();
    for (let t = 0; t < pos.count; t += 3) {
      const v = [key(t), key(t + 1), key(t + 2)];
      for (let k = 0; k < 3; k++) {
        const pair = [v[k], v[(k + 1) % 3]].sort().join('|');
        edges.set(pair, (edges.get(pair) ?? 0) + 1);
      }
    }
    const lone = [...edges.values()].filter((n) => n === 1).length;
    const shared = edges.size - lone;
    expect(shared).toBeGreaterThan(lone);
    geo.dispose();
  });
});
