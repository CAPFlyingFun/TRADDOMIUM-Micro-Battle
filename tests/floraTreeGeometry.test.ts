/**
 * THE TREE AS TRIANGLES — the shape is checked, not looked at.
 *
 * v0's `treeMesh.test.ts`, carried across with its three facing checks
 * intact, and widened to the three silhouettes. Four things this holds:
 *
 *  1. IT IS v0's TREE. Not "about the same" — the reference tree bakes
 *     to v0's MEASURED 1,736 triangles near and 344 far, exactly. That is
 *     the evidence the algorithm was ported rather than rewritten.
 *  2. THE UNIT CONTRACT. Every shape at every level stands at y = 0 and
 *     reaches y = 1 to its highest leaf, so a stand's `height` is the
 *     tree's height. v0's unit tree was 1.07 tall and its test allowed
 *     1.12; the header of `treeGeometry.ts` says what changed.
 *  3. THE OUTSIDE FACES OUT. A mesh has two independent answers to which
 *     way is out — the vertex normal and the winding — and v0's first cut
 *     had them disagree. They are checked against each other, and
 *     against the geometry, for every shape.
 *  4. THE SHAPES ARE WHAT THEY CLAIM. A palm has no limb above its trunk
 *     and one crown; a scrub carries its leaves lower and wider than it
 *     does tall; both fit the same triangle caps as the broad tree.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DETAILS, SHAPE_PROFILES, TREE_SHAPES, bakeTree, bakeUnitTree, growTree, leafMaterial, triangles,
  woodMaterial, type BakedTree, type TreeLevel, type TreeShape,
} from '../src/flora/treeGeometry';

/** v0's reference tree: 26 m, a metre round at the foot. */
const SPEC = { height: 2_600, girth: 104, seed: 0x7ee } as const;
const LEVELS: readonly TreeLevel[] = [0, 1];
/** v0's stand seed, and three more so a claim about a shape is not a claim about one draw. */
const SEEDS = [0x7ee5, 1, 2, 3];

/** Wood and leaves together. */
function whole(baked: BakedTree): number {
  return triangles(baked.wood) + (baked.leaves ? triangles(baked.leaves) : 0);
}

/** The box round wood and leaves together. */
function bounds(baked: BakedTree): THREE.Box3 {
  const box = baked.wood.boundingBox!.clone();
  if (baked.leaves) box.union(baked.leaves.boundingBox!);
  return box;
}

function positions(geometry: THREE.BufferGeometry): number[] {
  return Array.from(geometry.getAttribute('position').array as Float32Array);
}

describe('the skeleton', () => {
  it('is the same tree for the same seed, and a different one otherwise', () => {
    const a = growTree(SPEC);
    const b = growTree(SPEC);
    const c = growTree({ ...SPEC, seed: 0x7ef });
    expect(a.limbs.map((l) => l.b.toArray())).toEqual(b.limbs.map((l) => l.b.toArray()));
    expect(a.limbs.map((l) => l.b.toArray())).not.toEqual(c.limbs.map((l) => l.b.toArray()));
  });

  it('puts its highest leaf at the height it was asked for, whatever the shape', () => {
    // v0 put the leader's TIP there and let the crown poke 7% above it.
    for (const shape of TREE_SHAPES) {
      for (const seed of SEEDS) {
        const { limbs, tufts } = growTree({ ...SPEC, seed, shape });
        let top = 0;
        for (const limb of limbs) top = Math.max(top, limb.a.y, limb.b.y);
        for (const tuft of tufts) top = Math.max(top, tuft.at.y + tuft.r * tuft.squash);
        expect(top / SPEC.height, `${shape} seed ${seed}`).toBeCloseTo(1, 3);
        // And the foot is on the ground.
        expect(limbs[0].a.y).toBe(0);
      }
    }
  });

  it('starts the boughs where the profile says, one trunk ring of slack', () => {
    // A bough roots on the trunk ring at or below its nominal fraction,
    // so the lowest may sit up to one ring lower than the number.
    for (const shape of ['broad', 'scrub'] as const) {
      const { limbs, tufts } = growTree({ ...SPEC, shape });
      const boughs = limbs.filter((l) => l.order === 1);
      expect(boughs.length / 3).toBe(SHAPE_PROFILES[shape].boughs);
      const lowest = Math.min(...boughs.map((l) => l.a.y));
      expect(lowest).toBeGreaterThanOrEqual(SPEC.height * (SHAPE_PROFILES[shape].lowestBough - 1 / 12));
      expect(tufts.length).toBe(SHAPE_PROFILES[shape].boughs + 1);
    }
  });

  it('is widest at the foot and thin at the tip — except a palm, which keeps its girth', () => {
    const broad = growTree(SPEC).limbs.filter((l) => l.order === 0);
    expect(broad[0].ra).toBeGreaterThan(SPEC.girth / 2);
    expect(broad[broad.length - 1].rb).toBeLessThan(5);
    const palm = growTree({ ...SPEC, shape: 'palm' }).limbs.filter((l) => l.order === 0);
    expect(palm[palm.length - 1].rb / palm[0].ra).toBeGreaterThan(0.5);
  });
});

describe('the bake', () => {
  it('has two levels, the far one trunk-only', () => {
    expect(DETAILS).toHaveLength(2);
    expect(DETAILS[0].sides).toBeGreaterThan(DETAILS[1].sides);
    expect(DETAILS[1].order).toBe(0);
  });

  it('is v0\'s tree, triangle for triangle: 1,736 near and 344 far, as measured', () => {
    // 12 trunk rings x 12 sides x 2 = 288, 9 boughs x 3 segments x 24 =
    // 648, 10 tufts x 80 = 800; far: 12 x 6 x 2 = 144 and 10 x 20 = 200.
    const near = bakeTree(SPEC, 0);
    const far = bakeTree(SPEC, 1);
    expect(triangles(near.wood)).toBe(936);
    expect(triangles(near.leaves!)).toBe(800);
    expect(whole(near)).toBe(1_736);
    expect(triangles(far.wood)).toBe(144);
    expect(triangles(far.leaves!)).toBe(200);
    expect(whole(far)).toBe(344);
  });

  it('and every shape is cheap enough for a stand at both levels — measured, not hoped', () => {
    for (const shape of TREE_SHAPES) {
      const near = whole(bakeTree({ ...SPEC, shape }, 0));
      const far = whole(bakeTree({ ...SPEC, shape }, 1));
      expect(near, `${shape} near`).toBeLessThan(4_000);
      expect(far, `${shape} far`).toBeLessThan(700);
      expect(far, `${shape}`).toBeLessThan(near);
      console.log(`${shape} bake: near ${near} tris, far ${far} tris`);
    }
  });

  it('stands on the ground and reaches its height, in world units', () => {
    const baked = bakeTree(SPEC, 0);
    // The foot overruns a little below zero on purpose, so no join shows.
    expect(baked.wood.boundingBox!.min.y).toBeLessThanOrEqual(0);
    expect(baked.wood.boundingBox!.min.y).toBeGreaterThan(-SPEC.girth);
    const box = bounds(baked);
    expect(box.max.y).toBeGreaterThan(SPEC.height * 0.995);
    expect(box.max.y).toBeLessThan(SPEC.height * 1.005);
  });

  it('comes apart into wood and leaves, each coloured by vertex: bark brown and leaf green', () => {
    for (const shape of TREE_SHAPES) {
      const baked = bakeTree({ ...SPEC, shape }, 0);
      const bark = baked.wood.getAttribute('color');
      expect(bark.count).toBe(baked.wood.getAttribute('position').count);
      for (let i = 0; i < bark.count; i++) {
        expect(bark.getX(i), `${shape} wood vertex ${i}`).toBeGreaterThan(bark.getZ(i));
      }
      expect(baked.leaves).not.toBeNull();
      const leaf = baked.leaves!.getAttribute('color');
      expect(leaf.count).toBe(baked.leaves!.getAttribute('position').count);
      for (let i = 0; i < leaf.count; i++) {
        expect(leaf.getY(i), `${shape} leaf vertex ${i}`).toBeGreaterThan(leaf.getX(i));
        expect(leaf.getY(i), `${shape} leaf vertex ${i}`).toBeGreaterThan(leaf.getZ(i));
      }
    }
  });

  it('keeps the wood UV\'d — once round, and up the trunk at the same rate', () => {
    const uv = bakeTree(SPEC, 0).wood.getAttribute('uv');
    let mostU = 0;
    let mostV = 0;
    for (let i = 0; i < uv.count; i++) {
      mostU = Math.max(mostU, uv.getX(i));
      mostV = Math.max(mostV, uv.getY(i));
    }
    expect(mostU).toBeCloseTo(1, 6);
    // A 26 m trunk is about eight of its own foot circumferences long.
    expect(mostV).toBeGreaterThan((SPEC.height / (Math.PI * SPEC.girth)) * 0.9);
  });

  it('wears Lambert, coloured by vertex — the terrain\'s material, not a PBR pass', () => {
    for (const material of [woodMaterial(), leafMaterial()]) {
      expect(material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect(material.vertexColors).toBe(true);
      expect(material.fog).toBe(true);
      material.dispose();
    }
  });
});

describe('the unit bake', () => {
  it('lists three shapes and bakes every one of them', () => {
    expect(TREE_SHAPES).toEqual(['broad', 'scrub', 'palm']);
    for (const shape of TREE_SHAPES) {
      for (const level of LEVELS) {
        const baked = bakeUnitTree(shape, 0x7ee5, level);
        expect(whole(baked)).toBeGreaterThan(0);
      }
    }
  });

  it('is the same geometry for the same seed, twice over', () => {
    for (const shape of TREE_SHAPES) {
      for (const level of LEVELS) {
        const a = bakeUnitTree(shape, 0x7ee5, level);
        const b = bakeUnitTree(shape, 0x7ee5, level);
        expect(positions(a.wood), `${shape} wood L${level}`).toEqual(positions(b.wood));
        expect(positions(a.leaves!), `${shape} leaves L${level}`).toEqual(positions(b.leaves!));
        const c = bakeUnitTree(shape, 0x7ee6, level);
        expect(positions(a.wood)).not.toEqual(positions(c.wood));
      }
    }
  });

  it('stands at zero and reaches one to its highest leaf, for every shape and level', () => {
    for (const shape of TREE_SHAPES) {
      for (const level of LEVELS) {
        for (const seed of SEEDS) {
          const box = bounds(bakeUnitTree(shape, seed, level));
          const name = `${shape} L${level} seed ${seed}`;
          // The foot overruns into the ground by design, and by no more
          // than the cap: 0 minus up to two hundredths.
          expect(box.min.y, name).toBeLessThanOrEqual(0);
          expect(box.min.y, name).toBeGreaterThanOrEqual(-0.02);
          expect(box.max.y, name).toBeGreaterThanOrEqual(0.98);
          expect(box.max.y, name).toBeLessThanOrEqual(1.02);
        }
      }
    }
  });

  it('reaches the same top at both levels, so a LOD swap does not nod', () => {
    for (const shape of TREE_SHAPES) {
      const near = bounds(bakeUnitTree(shape, 0x7ee5, 0)).max.y;
      const far = bounds(bakeUnitTree(shape, 0x7ee5, 1)).max.y;
      expect(Math.abs(near - far), shape).toBeLessThan(0.005);
    }
  });
});

describe('the shapes', () => {
  it('a palm is a bare trunk under one crown: no limb above the trunk, no bough tuft', () => {
    for (const seed of SEEDS) {
      const { limbs, tufts } = growTree({ ...SPEC, seed, shape: 'palm', boughs: 9 });
      expect(limbs.every((l) => l.order === 0), `seed ${seed}`).toBe(true);
      expect(tufts).toHaveLength(1);
      // And the mesh agrees: the near wood is exactly the trunk's twelve
      // rings at twelve sides, and the far wood the same at six.
      const near = bakeTree({ ...SPEC, seed, shape: 'palm' }, 0);
      const far = bakeTree({ ...SPEC, seed, shape: 'palm' }, 1);
      expect(triangles(near.wood)).toBe(12 * 12 * 2);
      expect(triangles(far.wood)).toBe(12 * 6 * 2);
      expect(triangles(near.leaves!)).toBe(80);
      expect(triangles(far.leaves!)).toBe(20);
      // The crown sits on the trunk's top, not somewhere down it.
      const tip = limbs[limbs.length - 1].b;
      expect(tufts[0].at.distanceTo(tip)).toBeLessThan(1e-6);
    }
  });

  it('a palm leans; a broad tree stands', () => {
    // The tip's horizontal offset from the foot, as a fraction of the
    // height. Both draw the lean from the seed, so this is over four.
    const lean = (shape: TreeShape, seed: number): number => {
      const trunk = growTree({ ...SPEC, seed, shape }).limbs.filter((l) => l.order === 0);
      const tip = trunk[trunk.length - 1].b;
      return Math.hypot(tip.x, tip.z) / SPEC.height;
    };
    const palm = SEEDS.map((s) => lean('palm', s));
    const broad = SEEDS.map((s) => lean('broad', s));
    expect(Math.min(...palm)).toBeGreaterThan(Math.max(...broad));
    expect(Math.max(...palm)).toBeGreaterThan(0.05);
  });

  it('a scrub is squatter-crowned than a broad tree, and carries its leaves lower', () => {
    // "Squat" is an aspect: the crown's height over its width. Both
    // tops are at one, so the crown that starts lower is the taller by
    // extent — what makes it squat is that it reaches out further still.
    const crown = (shape: TreeShape, seed: number): { aspect: number; lowest: number } => {
      const box = bakeUnitTree(shape, seed, 0).leaves!.boundingBox!;
      const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
      return { aspect: (box.max.y - box.min.y) / width, lowest: box.min.y };
    };
    for (const seed of SEEDS) {
      const scrub = crown('scrub', seed);
      const broad = crown('broad', seed);
      expect(scrub.aspect, `seed ${seed}`).toBeLessThan(broad.aspect * 0.8);
      expect(scrub.lowest, `seed ${seed}`).toBeLessThan(broad.lowest - 0.1);
    }
  });

  it('a scrub has five boughs by default and a broad tree nine, and both take an override', () => {
    const count = (shape: TreeShape, boughs?: number): number =>
      growTree({ ...SPEC, shape, boughs }).limbs.filter((l) => l.order === 1).length / 3;
    expect(count('broad')).toBe(9);
    expect(count('scrub')).toBe(5);
    expect(count('broad', 4)).toBe(4);
    expect(count('scrub', 7)).toBe(7);
  });
});

/**
 * WHICH WAY THE WOOD FACES.
 *
 * A mesh has two independent answers to that — the vertex NORMAL and the
 * triangle's WINDING — and v0's first cut of `skin` got them to
 * disagree. The normals were the radial vector, which points out; the
 * winding was a->c->b, which faces in. Backface culling then threw the
 * near wall of every trunk away and drew the far inside of it, lit by
 * outward normals. It looks like a tree and it is inside out: "the tree
 * facings are swapped inwards vs outwards" (Joshua, v0.0.149).
 *
 * Neither alone can catch that, so this checks them AGAINST EACH OTHER,
 * and against the geometry they describe — for every shape, because a
 * leaning palm is the trunk most likely to expose a frame that twists.
 */
describe('which way the wood faces', () => {
  /** Every triangle of a bake's wood, as its winding, its normals and its centre. */
  function faces(shape: TreeShape, level: TreeLevel): {
    wound: THREE.Vector3; normal: THREE.Vector3; centre: THREE.Vector3;
  }[] {
    const geo = bakeTree({ ...SPEC, shape }, level).wood.toNonIndexed();
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const out = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t);
      b.fromBufferAttribute(pos, t + 1);
      c.fromBufferAttribute(pos, t + 2);
      const wound = new THREE.Vector3()
        .subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (wound.lengthSq() < 1e-12) continue;
      const normal = new THREE.Vector3()
        .fromBufferAttribute(nrm, t)
        .add(new THREE.Vector3().fromBufferAttribute(nrm, t + 1))
        .add(new THREE.Vector3().fromBufferAttribute(nrm, t + 2));
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
    for (const shape of TREE_SHAPES) {
      for (const level of LEVELS) {
        const all = faces(shape, level);
        expect(all.length).toBeGreaterThan(100);
        const agree = all.filter((f) => f.wound.dot(f.normal) > 0).length;
        // The leaf blobs are three.js's own and are already right; the
        // wood is what this is about. Every one of them, not most.
        expect(agree, `${shape} level ${level}`).toBe(all.length);
      }
    }
  });

  it('and the trunk faces AWAY from its own axis, not into it', () => {
    // The independent check: a tube's outward face points away from the
    // centre line. Read off the geometry rather than off the normals, so
    // a bake with both of them inverted still fails. THE FAR LEVEL, which
    // is trunk and nothing else, so every face is a trunk face.
    //
    // The axis is INTERPOLATED between the skeleton's rings rather than
    // snapped to the nearest, as v0 did. A face's centre sits midway
    // between two rings by construction, and a bent trunk's rings are
    // offset from each other by more than the tip's two-centimetre
    // radius — v0 had to stop the check at 0.35 of the height for that
    // reason. Interpolating lets the whole trunk be checked, and a
    // leaning palm along with it.
    for (const shape of TREE_SHAPES) {
      const trunk = growTree({ ...SPEC, shape }).limbs.filter((l) => l.order === 0);
      const axisAt = (y: number): THREE.Vector3 | null => {
        for (const limb of trunk) {
          if (y >= limb.a.y && y <= limb.b.y) {
            const t = (y - limb.a.y) / (limb.b.y - limb.a.y);
            return limb.a.clone().lerp(limb.b, t);
          }
        }
        return null;
      };
      let outward = 0;
      let inward = 0;
      for (const face of faces(shape, 1)) {
        const axis = axisAt(face.centre.y);
        if (!axis) continue;
        const away = new THREE.Vector3(face.centre.x - axis.x, 0, face.centre.z - axis.z);
        if (away.lengthSq() < 1e-6) continue;
        const flat = new THREE.Vector3(face.wound.x, 0, face.wound.z);
        if (flat.lengthSq() < 1e-9) continue;
        if (flat.normalize().dot(away.normalize()) > 0) outward++;
        else inward++;
      }
      expect(outward, shape).toBeGreaterThan(100);
      // Bare trunk: every single one of them, not a majority.
      expect(inward, shape).toBe(0);
    }
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
    // wall is shared by two triangles, and only the tube's open ends are
    // held by one.
    for (const shape of TREE_SHAPES) {
      const geo = bakeTree({ ...SPEC, shape }, 1).wood.toNonIndexed();
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
      expect(shared, shape).toBeGreaterThan(lone);
      geo.dispose();
    }
  });
});
