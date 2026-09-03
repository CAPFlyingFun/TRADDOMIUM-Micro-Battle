/**
 * THE WOOD SHE CANNOT WALK THROUGH — and it is the wood she can see.
 *
 * Joshua: "let's make the trees able to climb/walk, and in turn,
 * collision." This is the collision half.
 *
 * The one thing that matters and the one thing that is easy to get
 * wrong is that the solid tree and the drawn tree are the SAME tree.
 * Thronemound's first cut was a straight vertical cone from base radius
 * to a fraction of it, which measured up to a third fatter than the
 * drawn wood at mid-height and modelled none of the trunk's lean; she
 * stood on the invisible one and floated over the visible one, and it
 * was reported as hovering. So most of this compares the profile
 * against the mesh rather than against a number.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  NO_TRUNKS, TrunkField, insideProfile, profileFor, ringFactor, trunkProfile,
  type Standing,
} from '../src/world/trunkSolid';
import { DETAILS, bakeTree, growTree } from '../src/world/treeMesh';
import { world } from '../src/world/coords';

const SPEC = { height: 2_600, girth: 104, seed: 0x7ee } as const;

describe('the trunk profile', () => {
  it('is one unit tall, whatever the tree', () => {
    for (const height of [1_800, 2_600, 3_000]) {
      const p = trunkProfile({ ...SPEC, height, girth: height * 0.04 }, 12);
      expect(p.pts[0].y).toBeCloseTo(0, 6);
      expect(p.pts[p.pts.length - 1].y).toBeCloseTo(1, 6);
    }
  });

  it('and carries the trunk\'s LEAN, not a straight pole', () => {
    // The reason a cone was wrong. The axis wanders off centre by more
    // than the trunk's own radius over its height, so a solid built on
    // a vertical line sits somewhere the picture is not.
    const p = trunkProfile(SPEC, 12);
    const wander = Math.max(...p.pts.map((q) => Math.hypot(q.x, q.z)));
    expect(wander).toBeGreaterThan(p.r[p.r.length - 1]);
  });

  it('and is the DRAWN ring, which is wider than the limb', () => {
    // `skin` pushes the vertices out to 1/cos(pi/sides) so the flats are
    // tangent to the circle rather than chords inside it. A solid that
    // used the limb's own radius would describe a thinner tree than the
    // one on screen — and she meets the corners.
    const limbs = growTree(SPEC).limbs.filter((l) => l.order === 0);
    const p = trunkProfile(SPEC, 6);
    expect(p.r[0]).toBeCloseTo(limbs[0].ra * ringFactor(6) / SPEC.height, 9);
    expect(ringFactor(6)).toBeGreaterThan(1.15);
    // And the far level, drawn coarser, is fatter than the near one.
    expect(trunkProfile(SPEC, 6).widest)
      .toBeGreaterThan(trunkProfile(SPEC, 12).widest);
  });

  it('and it wraps the wood the mesh actually drew', () => {
    // THE TEST THAT MATTERS. Every vertex of the drawn trunk should be
    // ON or just inside the solid — never outside it, which is the
    // hovering, and never far inside it, which is a tree wider than it
    // looks.
    for (const level of [0, 1]) {
      const p = profileFor(SPEC, level);
      const wood = bakeTree(SPEC, level).wood;
      const pos = wood.getAttribute('position');
      const k = 1 / SPEC.height;
      let worstOut = -Infinity;
      let deepest = -Infinity;
      // BELOW THE LOWEST BOUGH, so every vertex in the window is
      // trunk. The far level draws no boughs at all, so it can be
      // checked all the way up.
      const ceiling = DETAILS[level].order === 0 ? 0.9 : 0.38;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) * k;
        if (y < 0.02 || y > ceiling) continue;
        const inside = insideProfile(p, pos.getX(i) * k, y, pos.getZ(i) * k);
        worstOut = Math.max(worstOut, -inside);
        deepest = Math.max(deepest, inside);
      }
      // Nothing drawn stands outside the solid by more than a hair.
      expect(worstOut * SPEC.height, `level ${level} outside`).toBeLessThan(2);
      // And the solid is not fat: the deepest a drawn vertex sits
      // inside it is a fraction of the trunk's own radius.
      expect(deepest * SPEC.height, `level ${level} inside`).toBeLessThan(12);
      wood.dispose();
    }
  });

  it('and a level picks its own tessellation', () => {
    expect(profileFor(SPEC, 0).widest)
      .toBeCloseTo(trunkProfile(SPEC, DETAILS[0].sides).widest, 9);
    expect(profileFor(SPEC, 1).widest)
      .toBeCloseTo(trunkProfile(SPEC, DETAILS[1].sides).widest, 9);
  });
});

/** One tree, standing where the test puts it. */
function standing(over: Partial<Standing> = {}): Standing {
  const profile = profileFor(SPEC, 0);
  return {
    id: 't',
    at: world(0, 0),
    foot: 0,
    scale: SPEC.height,
    cos: 1,
    sin: 0,
    profile,
    reach: (profile.widest + 0.02) * SPEC.height,
    top: SPEC.height,
    ...over,
  };
}

describe('walking into it', () => {
  it('is nothing at all out in the open', () => {
    const field = new TrunkField([standing()]);
    expect(field.bump(10_000, 100, 10_000)).toBeNull();
    expect(NO_TRUNKS.bump(0, 0, 0)).toBeNull();
  });

  it('and nothing above the tree or below its foot', () => {
    const field = new TrunkField([standing()]);
    expect(field.bump(0, SPEC.height + 100, 0)).toBeNull();
    expect(field.bump(0, -100, 0)).toBeNull();
  });

  it('but the axis itself is deep inside the wood', () => {
    const field = new TrunkField([standing()]);
    const bump = field.bump(0, 200, 0);
    expect(bump).not.toBeNull();
    expect(bump!.depth).toBeGreaterThan(30);
    expect(bump!.id).toBe('t');
  });

  it('and the way out actually gets her out, in one push', () => {
    const field = new TrunkField([standing()]);
    // All round the trunk, at several heights.
    for (const y of [100, 800, 1_800]) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const r = 20;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const bump = field.bump(x, y, z, 18);
        if (!bump) continue;
        const outX = x + bump.outX * bump.depth;
        const outZ = z + bump.outZ * bump.depth;
        expect(field.bump(outX, y, outZ, 18), `${a.toFixed(2)} @ ${y}`).toBeNull();
      }
    }
  });

  it('and her BODY meets it, not her centre point', () => {
    // A body is not a point: without the radius her nose sits inside a
    // trunk while her middle is clear. Walked out as a POINT, she is
    // exactly at the bark — and the same spot still holds her body.
    const field = new TrunkField([standing()]);
    const y = 100;
    const deep = field.bump(0, y, 0, 0)!;
    const bx = deep.outX * deep.depth;
    const bz = deep.outZ * deep.depth;
    expect(field.bump(bx, y, bz, 0)).toBeNull();
    expect(field.bump(bx, y, bz, 18)).not.toBeNull();
  });

  it('and a spun tree is solid where it is DRAWN, not mirrored', () => {
    // The sign of the spin is the bug Thronemound shipped: `bump`
    // un-turns, so handing it minus the spin negates a negation and
    // leaves the solid tree turned by TWICE the spin away from the
    // drawn one. A trunk wanders off its own centre by more than its
    // radius, so a wrong turn moves the wood sideways.
    const spin = 1.1;
    const p = profileFor(SPEC, 0);
    // A point on the axis high up, where the lean is biggest, turned
    // the way the instance matrix turns it.
    const top = p.pts[p.pts.length - 2];
    const drawnX = (top.x * Math.cos(spin) + top.z * Math.sin(spin)) * SPEC.height;
    const drawnZ = (-top.x * Math.sin(spin) + top.z * Math.cos(spin)) * SPEC.height;
    const field = new TrunkField([standing({
      cos: Math.cos(spin), sin: Math.sin(spin),
    })]);
    expect(field.bump(drawnX, top.y * SPEC.height, drawnZ)).not.toBeNull();
  });

  it('and answers the DEEPEST of two overlapping trunks', () => {
    const field = new TrunkField([
      standing({ id: 'near', at: world(0, 0) }),
      standing({ id: 'far', at: world(60, 0) }),
    ]);
    const bump = field.bump(5, 100, 0, 18);
    expect(bump!.id).toBe('near');
  });
});

describe('and it is the same tree the instance draws', () => {
  it('scaled and spun by the same matrix', () => {
    // The stand composes position, a Y spin and a uniform scale. The
    // solid has to be read through the inverse of exactly that.
    const spin = 0.7;
    const height = 2_000;
    const at = world(1_234, -5_678);
    const p = profileFor(SPEC, 0);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(at.wx, 0, at.wz),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin),
      new THREE.Vector3(height, height, height),
    );
    const field = new TrunkField([standing({
      at, foot: 0, scale: height, cos: Math.cos(spin), sin: Math.sin(spin),
      profile: p, reach: (p.widest + 0.02) * height, top: height,
    })]);
    // Take a point on the profile's axis, push it through the SAME
    // matrix the mesh uses, and the field must call it wood.
    for (const q of p.pts.slice(1, -1)) {
      const drawn = new THREE.Vector3(q.x, q.y, q.z).applyMatrix4(m);
      expect(field.bump(drawn.x, drawn.y, drawn.z)).not.toBeNull();
    }
  });
});
