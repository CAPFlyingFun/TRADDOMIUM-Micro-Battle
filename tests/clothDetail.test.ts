/**
 * HER DETAIL THROUGH THE CLOTH TEE (Joshua, 2026-10-24: "the breast slider has no effect on the outfit… it still should
 * have a visible effect", "the bellybutton also doesn't appear with the slider"). `clothDetail.ts` draws her nipples and
 * navel through the tee in shading. Here: the relief's gradient is the true slope of its height field, rises toward a
 * bump's centre and away from a dimple's, reaches nothing far off or a body's depth behind; a dimple darkens within its
 * limit and a bump never does; the fitted tee's own modelled navel is SETTLED -- each garment point inside the window
 * moved by `amount` of its own deviation onto the garment's smooth surface, a tilted, anisotropic quadric with the round
 * paraboloid as its special case (a dome pressed down, a hole's floor and its near-vertical wall lifted out, the inner
 * layer kept `thickness` inside), linear in amount, nothing past the window or a body's depth behind, nothing at all
 * without a settle -- and the shading mixed toward the smooth surface's own normal, square to it, by the same weight; the patch is applied once, chains whatever the material already had, keeps every hook the fabric patch
 * needs in either order, and leaves three's clip position alone unless something was moved; and the spots and the
 * settle land in the uniforms both stages read.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  DIMPLE_DARKEN, MAX_DARKEN, clothDetailAt, patchClothDetail, setClothDetail,
  type ClothDetailSettle, type ClothDetailSpot, type ClothDetailState,
} from '../src/sarahlab/clothDetail';
import { setFabricLayer } from '../src/sarahlab/fabricMaterial';

type Vec = [number, number, number];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: readonly number[]): number => Math.hypot(a[0], a[1], a[2]);
const add = (a: readonly number[], b: readonly number[]): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: readonly number[], k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a: readonly number[], b: readonly number[]): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: readonly number[], b: readonly number[]): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalized = (a: readonly number[]): Vec => scale(a, 1 / len(a));
/** A row-major 3x3 times a vector. */
const mul = (q: readonly number[], v: readonly number[]): Vec => [0, 1, 2].map((i) => q[3 * i] * v[0] + q[3 * i + 1] * v[1] + q[3 * i + 2] * v[2]) as Vec;
const expectVecClose = (a: readonly number[] | null, b: readonly number[], digits = 12): void => {
  expect(a).not.toBeNull();
  for (let k = 0; k < 3; k++) expect(a![k]).toBeCloseTo(b[k], digits);
};

/** A spot at `center` facing +z unless told otherwise. */
function spot(center: Vec, height: number, radius: number, normal: Vec = [0, 0, 1]): ClothDetailSpot {
  return { center, normal, height, radius };
}
const only = (s: ClothDetailSpot): ClothDetailState => ({ navel: s, nipples: [] });

/** Run a material's onBeforeCompile on three's own standard shader, the way the renderer would. */
function compiled(material: THREE.Material): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string } {
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  return shader;
}
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** A small tee-like mesh for the fabric patch to dress. */
function tee(): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const material = new THREE.MeshStandardMaterial();
  return { mesh: new THREE.Mesh(g, material), material };
}
const dress = (mesh: THREE.Mesh, material: THREE.Material): void =>
  setFabricLayer(mesh, material, 0, { texture: new THREE.Texture(), tile: 1, opacity: 1 }, { layers: 1, masked: false, rest: null });

describe('the relief on the CPU', () => {
  it('is flat exactly at a bump\'s centre and far away from it', () => {
    const s = only(spot([3, 4, 5], 0.4, 1.2));
    expect(len(clothDetailAt([3, 4, 5], s).gradient)).toBe(0);
    expect(len(clothDetailAt([3 + 60, 4, 5], s).gradient)).toBe(0);
  });

  it('slopes up toward a bump\'s centre, and away from a dimple\'s', () => {
    const p: Vec = [0.6, -0.3, 0];
    const t = p; // centre at the origin, normal +z: the offset is all tangential
    const bump = clothDetailAt(p, only(spot([0, 0, 0], 0.4, 1))).gradient;
    expect(dot(bump, t)).toBeLessThan(0);
    expect(Math.abs(bump[2])).toBe(0); // tangential: nothing along the normal
    const dimple = clothDetailAt(p, only(spot([0, 0, 0], -0.4, 1))).gradient;
    expect(dot(dimple, t)).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) expect(dimple[k]).toBeCloseTo(-bump[k], 12);
  });

  it('is the true gradient of the height field H·exp(-r²/R²) on the skin\'s plane', () => {
    const H = 0.35, R = 0.9, c: Vec = [1, 2, 3];
    const s = only(spot(c, H, R));
    const h = (x: number, y: number) => H * Math.exp(-((x - c[0]) ** 2 + (y - c[1]) ** 2) / (R * R));
    const p: Vec = [1.4, 2.25, 3], e = 1e-5;
    const g = clothDetailAt(p, s).gradient;
    expect(g[0]).toBeCloseTo((h(p[0] + e, p[1]) - h(p[0] - e, p[1])) / (2 * e), 8);
    expect(g[1]).toBeCloseTo((h(p[0], p[1] + e) - h(p[0], p[1] - e)) / (2 * e), 8);
  });

  it('reaches nothing a body\'s depth behind (the back of the shirt)', () => {
    const R = 1, s = only(spot([0, 0, 0], 0.4, R, [0, 0, 1]));
    const front = clothDetailAt([0.5, 0, 0], s).gradient;
    const back = clothDetailAt([0.5, 0, -25 * R], s).gradient;
    expect(len(front)).toBeGreaterThan(0.1);
    expect(len(back)).toBeLessThan(1e-50);
  });

  it('works in her skin\'s own frame, whatever way the normal faces', () => {
    const n: Vec = [0, Math.SQRT1_2, Math.SQRT1_2];
    const s = only(spot([0, 0, 0], 0.4, 1, n));
    const t: Vec = [0.5, 0.2, -0.2]; // tangential: dot(t, n) = 0
    const g = clothDetailAt(t, s).gradient;
    expect(dot(g, n)).toBeCloseTo(0, 12);
    expect(dot(g, t)).toBeLessThan(0);
    // an unnormalised normal is the same spot
    const g2 = clothDetailAt(t, only(spot([0, 0, 0], 0.4, 1, [0, 3, 3]))).gradient;
    for (let k = 0; k < 3; k++) expect(g2[k]).toBeCloseTo(g[k], 12);
  });

  it('darkens a dimple within its limit and never a bump', () => {
    expect(clothDetailAt([0, 0, 0], only(spot([0, 0, 0], 0.4, 1))).shade).toBe(1);
    expect(clothDetailAt([0.3, 0, 0], only(spot([0, 0, 0], 0.4, 1))).shade).toBe(1);
    const shallow = clothDetailAt([0, 0, 0], only(spot([0, 0, 0], -0.2, 1))).shade;
    expect(shallow).toBeCloseTo(1 - 0.2 * DIMPLE_DARKEN, 12);
    expect(shallow).toBeLessThan(1);
    expect(shallow).toBeGreaterThanOrEqual(1 - MAX_DARKEN);
    expect(clothDetailAt([0, 0, 0], only(spot([0, 0, 0], -5, 1))).shade).toBeCloseTo(1 - MAX_DARKEN, 12);
    expect(clothDetailAt([0, 0, -25], only(spot([0, 0, 0], -5, 1))).shade).toBeCloseTo(1, 12);
  });

  it('sums the navel and two nipples, and ignores a third', () => {
    const navel = spot([0, -10, 0], -0.3, 1), a = spot([-4, 8, 0], 0.4, 1), b = spot([4, 8, 0], 0.4, 1);
    const extra = spot([4.5, 8, 0], 2, 1);
    const p: Vec = [4.4, 8.1, 0];
    const two = clothDetailAt(p, { navel, nipples: [a, b] });
    const three = clothDetailAt(p, { navel, nipples: [a, b, extra] });
    expect(three).toEqual(two);
    const alone = clothDetailAt(p, { navel: null, nipples: [b] });
    for (let k = 0; k < 3; k++) expect(two.gradient[k]).toBeCloseTo(alone.gradient[k], 12);
    expect(len(clothDetailAt(p, { navel: null, nipples: [] }).gradient)).toBe(0);
  });

  it('moves nothing without a settle, and the spots move nothing at all', () => {
    const s = { navel: spot([0, 0, 0], -0.4, 1.5), nipples: [spot([4, 8, 0], 0.4, 1)] };
    for (const p of [[0, 0, 0], [0.4, -0.2, 0.1], [4, 8, 0], [3, 1, -2]] as Vec[]) {
      const at = clothDetailAt(p, s);
      expect(at.displacement).toEqual([0, 0, 0]);
      expect(at.settleWeight).toBe(0);
      expect(at.settleNormal).toBeNull();
      expect(clothDetailAt(p, { ...s, settle: null })).toEqual(at);
    }
  });
});

describe('settling the garment\'s own modelled navel', () => {
  /** k (I - n nᵀ), row-major: the round paraboloid as a special case of the quadric, t·(Q t) = k r² for t ⟂ n. */
  const iso = (k: number, n: Vec = [0, 0, 1]): number[] => {
    const u = scale(n, 1 / len(n));
    return [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => k * ((i === j ? 1 : 0) - u[i] * u[j])));
  };
  const K = 0.02;
  /**
   * A settle round the z axis through the origin (world units, a centimetre each): the garment's smooth surface stands
   * at 0.5 - 0.02 r² along it (no slope, the same curvature every way), settled fully inside 1 cm and not at all past 2,
   * a 0.9 mm tee, 2 cm of reach.
   */
  const BASE: ClothDetailSettle = {
    center: [0, 0, 0], normal: [0, 0, 1], height: 0.5, slope: [0, 0, 0], curvature: iso(K), inner: 1, outer: 2, amount: 1, thickness: 0.09, reach: 2,
  };
  const settled = (o: Partial<ClothDetailSettle> = {}): ClothDetailState => ({ navel: null, nipples: [], settle: { ...BASE, ...o } });
  /** The round smooth surface's height along the axis at r from it. */
  const surface = (r: number, k = K): number => BASE.height - k * r * r;
  /** A point at (x, y) across the axis, `dev` off the smooth surface along it. */
  const at = (x: number, y: number, dev: number): Vec => [x, y, surface(Math.hypot(x, y)) + dev];

  it('at amount 1 puts a dome\'s point exactly onto the smooth surface, moving it only along the axis', () => {
    const p = at(0.4, 0.3, 0.8); // an outie's dome, 8 mm proud, inside the window
    const s = clothDetailAt(p, settled());
    expect(s.displacement[0]).toBe(0);
    expect(s.displacement[1]).toBe(0);
    expect(s.displacement[2]).toBeCloseTo(-0.8, 12); // minus its deviation, along N
    expect(add(p, s.displacement)[2]).toBeCloseTo(surface(0.5), 12);
    // an outer-layer normal tipped off the axis (still facing out) is the same outer layer
    const tipped = clothDetailAt(p, settled(), [0.3, 0, 1]);
    expect(tipped.displacement[2]).toBeCloseTo(-0.8, 12);
  });

  it('lifts a hole\'s wall to half the thickness inside, and keeps the inner layer the whole thickness inside', () => {
    // a wall of a 13 mm hole: a point 11 mm down, its normal sideways (facing the axis)
    const wall = at(0.6, 0, -1.1);
    const w = clothDetailAt(wall, settled(), [-1, 0, 0]);
    expect(w.displacement[0]).toBe(0);
    expect(add(wall, w.displacement)[2]).toBeCloseTo(surface(0.6) - 0.5 * BASE.thickness, 12);
    // the floor of the hole on the inner layer, its normal facing her
    const floor = at(0.2, -0.3, -1.3);
    const f = clothDetailAt(floor, settled(), [0, 0, -1]);
    expect(add(floor, f.displacement)[2]).toBeCloseTo(surface(Math.hypot(0.2, -0.3)) - BASE.thickness, 12);
    // and the outer layer above it lands on the surface itself: the two stay the thickness apart
    const above = at(0.2, -0.3, -1.3 + BASE.thickness);
    const a = clothDetailAt(above, settled());
    expect(add(above, a.displacement)[2] - add(floor, f.displacement)[2]).toBeCloseTo(BASE.thickness, 12);
  });

  it('works along any axis, whatever its length', () => {
    const n: Vec = [0, Math.SQRT1_2, Math.SQRT1_2], c: Vec = [2, 3, 4];
    const t: Vec = [0.5, 0.3, -0.3]; // tangential: r = |t|
    const r = len(t), dev = -0.9;
    const p = add(add(c, t), scale(n, surface(r) + dev));
    const s = clothDetailAt(p, settled({ center: c, normal: [0, 5, 5], curvature: iso(K, n) }));
    for (let k = 0; k < 3; k++) expect(s.displacement[k]).toBeCloseTo(-dev * n[k], 12);
    const landed = add(p, s.displacement);
    expect(dot([landed[0] - c[0], landed[1] - c[1], landed[2] - c[2]], n)).toBeCloseTo(surface(r), 12);
  });

  it('moves nothing at amount 0 or with no settle, and clamps the amount to 0..1', () => {
    const p = at(0.4, 0.3, -1.0);
    for (const state of [settled({ amount: 0 }), { navel: null, nipples: [] }, { navel: null, nipples: [], settle: null }] as ClothDetailState[]) {
      const s = clothDetailAt(p, state);
      expect(s.displacement).toEqual([0, 0, 0]);
      expect(s.settleWeight).toBe(0);
    }
    expect(clothDetailAt(p, settled({ amount: 1.5 }))).toEqual(clothDetailAt(p, settled({ amount: 1 })));
    expect(clothDetailAt(p, settled({ amount: -1 }))).toEqual(clothDetailAt(p, settled({ amount: 0 })));
    expect(clothDetailAt(p, settled({ amount: Number.NaN }))).toEqual(clothDetailAt(p, settled({ amount: 0 })));
    // and a settle with no axis settles nothing
    expect(clothDetailAt(p, settled({ normal: [0, 0, 0] })).displacement).toEqual([0, 0, 0]);
  });

  it('is linear in amount', () => {
    const p = at(0.3, 0.5, -1.2);
    const full = clothDetailAt(p, settled()).displacement[2];
    expect(full).toBeCloseTo(1.2, 12);
    expect(clothDetailAt(p, settled({ amount: 0.5 })).displacement[2]).toBeCloseTo(0.5 * full, 12);
    expect(clothDetailAt(p, settled({ amount: 0.25 })).displacement[2]).toBeCloseTo(0.25 * full, 12);
    expect(clothDetailAt(p, settled({ amount: 0.5 })).settleWeight).toBeCloseTo(0.5, 12);
  });

  it('settles nothing past the window\'s outer edge, part of it between the edges', () => {
    expect(clothDetailAt(at(2, 0, -1), settled()).displacement).toEqual([0, 0, 0]);
    expect(clothDetailAt(at(0, 3, -1), settled()).displacement).toEqual([0, 0, 0]);
    expect(clothDetailAt(at(2, 0, -1), settled()).settleWeight).toBe(0);
    // halfway between inner and outer, smoothstep is a half
    const mid = clothDetailAt(at(1.5, 0, -1), settled());
    expect(mid.displacement[2]).toBeCloseTo(0.5, 12);
    expect(mid.settleWeight).toBeCloseTo(0.5, 12);
    const near = clothDetailAt(at(1.2, 0, -1), settled()).displacement[2], far = clothDetailAt(at(1.8, 0, -1), settled()).displacement[2];
    expect(near).toBeGreaterThan(0.5);
    expect(near).toBeLessThan(1);
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(0.5);
  });

  it('takes edges out of order as a hard edge at the outer one, and no reach as nothing, without NaN', () => {
    const hard = settled({ inner: 2, outer: 1 });
    expect(clothDetailAt(at(0.9, 0, -1), hard).displacement[2]).toBeCloseTo(1, 12);
    expect(clothDetailAt(at(1, 0, -1), hard).displacement).toEqual([0, 0, 0]);
    const equal = settled({ inner: 1, outer: 1 });
    expect(clothDetailAt(at(0.5, 0, -1), equal).displacement[2]).toBeCloseTo(1, 12);
    expect(clothDetailAt(at(1.5, 0, -1), equal).displacement).toEqual([0, 0, 0]);
    for (const reach of [0, -1]) {
      const s = clothDetailAt(at(0.2, 0, -1), settled({ reach }));
      expect(s.displacement).toEqual([0, 0, 0]);
      expect(s.settleWeight).toBe(0);
    }
  });

  it('leaves the back of the garment alone, a body\'s depth behind, and fades out between reach and 1.5x', () => {
    const back = clothDetailAt([0.3, 0, -25], settled(), [0, 0, -1]);
    expect(back.displacement).toEqual([0, 0, 0]);
    expect(back.settleWeight).toBe(0);
    expect(clothDetailAt([0.3, 0, -25], settled()).settleWeight).toBe(0);
    // 2.5 off: halfway from reach (2) to 1.5x (3)
    expect(clothDetailAt(at(0.3, 0, -2.5), settled()).displacement[2]).toBeCloseTo(0.5 * 2.5, 12);
    expect(clothDetailAt(at(0.3, 0, -3.2), settled()).displacement).toEqual([0, 0, 0]);
  });

  it('moves nothing on a round smooth surface itself, at any r, however curved', () => {
    for (const curve of [0, 0.02, -0.05, 0.3]) {
      for (const r of [0, 0.5, 1.2, 1.8, 2.5]) {
        const p: Vec = [r * 0.6, r * 0.8, surface(r, curve)];
        const s = clothDetailAt(p, settled({ curvature: iso(curve) }));
        expect(len(s.displacement)).toBeCloseTo(0, 12);
        // and its shading is mixed by the window alone
        if (r <= 1) expect(s.settleWeight).toBe(1);
        else if (r >= 2) expect(s.settleWeight).toBe(0);
        else { expect(s.settleWeight).toBeGreaterThan(0); expect(s.settleWeight).toBeLessThan(1); }
        // toward the paraboloid's own normal, N + 2k t
        expectVecClose(s.settleNormal, normalized([2 * curve * p[0], 2 * curve * p[1], 1]));
      }
    }
  });

  it('follows a tilted surface: a point on the slope does not move, and a slope along the axis is ignored', () => {
    const L: Vec = [0.3, -0.2, 0], tilted = settled({ slope: L, curvature: iso(0) });
    const plane = (x: number, y: number): number => BASE.height + L[0] * x + L[1] * y;
    for (const [x, y] of [[0, 0], [0.5, -0.4], [1.2, 0.7], [-0.8, 0.3]]) {
      const p: Vec = [x, y, plane(x, y)];
      const s = clothDetailAt(p, tilted);
      expect(len(s.displacement)).toBeCloseTo(0, 12);
      expectVecClose(s.settleNormal, normalized([-L[0], -L[1], 1])); // the plane's own normal, N - L
      expect(clothDetailAt(p, settled({ slope: [0.3, -0.2, 7], curvature: iso(0) }))).toEqual(s);
    }
    // a hole in it is lifted onto the slope, not onto the level
    const hole: Vec = [0.4, 0.2, plane(0.4, 0.2) - 1.1];
    expect(add(hole, clothDetailAt(hole, tilted).displacement)[2]).toBeCloseTo(plane(0.4, 0.2), 12);
  });

  it('follows a belly curved differently up and down than across', () => {
    const Q = [0.04, 0, 0, 0, 0.01, 0, 0, 0, 0], aniso = settled({ curvature: Q });
    const f = (x: number, y: number): number => BASE.height - 0.04 * x * x - 0.01 * y * y;
    for (const [x, y] of [[0, 0], [0.6, 0.8], [-0.9, 0.2], [1.5, -1.1], [0.1, -2.4]]) {
      expect(len(clothDetailAt([x, y, f(x, y)], aniso).displacement)).toBeCloseTo(0, 12);
    }
    // a dome on it settles onto it, and a hole is lifted onto it
    for (const dev of [0.8, -1.2]) {
      const p: Vec = [0.6, 0.8, f(0.6, 0.8) + dev];
      expect(add(p, clothDetailAt(p, aniso).displacement)[2]).toBeCloseTo(f(0.6, 0.8), 12);
    }
    // its normal off the axis: N + 2 Q t, square to the surface both ways
    const x = 0.6, y = 0.8, s = clothDetailAt([x, y, f(x, y)], aniso), e = 1e-4;
    expectVecClose(s.settleNormal, normalized([2 * 0.04 * x, 2 * 0.01 * y, 1]));
    expect(dot(s.settleNormal!, normalized([2 * e, 0, f(x + e, y) - f(x - e, y)]))).toBeCloseTo(0, 9);
    expect(dot(s.settleNormal!, normalized([0, 2 * e, f(x, y + e) - f(x, y - e)]))).toBeCloseTo(0, 9);
  });

  it('works for a general quadric round a tilted axis, its curvature\'s part along the axis taken out of the normal', () => {
    const n = normalized([0.2, -0.3, 1]), c: Vec = [1, -2, 3];
    const e1 = normalized(cross(n, [1, 0, 0])), e2 = cross(n, e1);
    const L = add(scale(e1, 0.25), scale(e2, -0.1));
    const Q = [0.05, 0.01, -0.02, 0.01, 0.03, 0.015, -0.02, 0.015, 0.04]; // symmetric, with parts along n
    const st = settled({ center: c, normal: [0.4, -0.6, 2], slope: add(L, scale(n, 3)), curvature: Q });
    const S = (u: number, v: number): Vec => {
      const t = add(scale(e1, u), scale(e2, v));
      return add(add(c, t), scale(n, BASE.height + dot(L, t) - dot(t, mul(Q, t))));
    };
    for (const [u, v] of [[0.6, -0.4], [-0.5, 0.5], [0.3, 0.8]]) {
      const p = S(u, v), s = clothDetailAt(p, st), e = 1e-4;
      expect(len(s.displacement)).toBeCloseTo(0, 12);
      expect(dot(s.settleNormal!, normalized(sub(S(u + e, v), S(u - e, v))))).toBeCloseTo(0, 9);
      expect(dot(s.settleNormal!, normalized(sub(S(u, v + e), S(u, v - e))))).toBeCloseTo(0, 9);
      expect(dot(s.settleNormal!, n)).toBeGreaterThan(0); // it faces out
      // a dome on it is put back onto it, along the axis
      const dome = add(p, scale(n, 0.7));
      expectVecClose(add(dome, clothDetailAt(dome, st).displacement), p);
    }
  });

  it('mixes the shading by the window and the reach, with no layer term, and leaves the spots\' shading as it was', () => {
    // the inner layer, settled the thickness inside: still the whole weight (it is never seen from outside)
    expect(clothDetailAt(at(0.2, 0, -BASE.thickness), settled()).settleWeight).toBe(1);
    // a point the vertex stage settled reads the whole weight where it was drawn
    const p = at(0.4, 0.3, -1.2), moved = add(p, clothDetailAt(p, settled({ amount: 0.6 })).displacement);
    expect(clothDetailAt(moved, settled({ amount: 0.6 })).settleWeight).toBeCloseTo(0.6, 12);
    // and the settle adds nothing to the spots' gradient or shade
    const spots = { navel: spot([0, 0, 0.5], -0.4, 1.5), nipples: [spot([4, 8, 0], 0.4, 1)] };
    for (const q of [[0.3, 0.2, 0.5], [0.8, -0.4, 0.2], [4.2, 8.1, 0]] as Vec[]) {
      const without = clothDetailAt(q, spots), withSettle = clothDetailAt(q, { ...spots, settle: BASE });
      expect(withSettle.gradient).toEqual(without.gradient);
      expect(withSettle.shade).toBe(without.shade);
    }
  });
});

describe('the patch', () => {
  it('is applied once', () => {
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    patchClothDetail(material);
    const hook = material.onBeforeCompile, key = material.customProgramCacheKey;
    expect(material.version).toBe(version + 1);
    patchClothDetail(material);
    setClothDetail(material, only(spot([0, 0, 0], 0.4, 1)));
    setClothDetail(material, { navel: null, nipples: [], settle: { center: [0, 0, 0], normal: [0, 0, 1], height: 0, slope: [0, 0, 0], curvature: [0, 0, 0, 0, 0, 0, 0, 0, 0], inner: 1, outer: 2, amount: 1, thickness: 0.09, reach: 2 } });
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey).toBe(key);
    expect(material.version).toBe(version + 1); // later changes are uniforms, never a recompile
    // and patched twice, the shader still carries everything once
    const shader = compiled(material);
    expect(count(shader.vertexShader, 'uniform float clothSettleOn;')).toBe(1);
    expect(count(shader.vertexShader, 'vec4 clothW = modelMatrix')).toBe(1);
    expect(count(shader.fragmentShader, 'if (clothSettleOn > 0.5)')).toBe(1);
  });

  it('chains the material\'s own onBeforeCompile and cache key', () => {
    const material = new THREE.MeshStandardMaterial();
    const before = vi.fn();
    material.onBeforeCompile = before;
    material.customProgramCacheKey = () => 'hem-cut-v3';
    patchClothDetail(material);
    const shader = compiled(material);
    expect(before).toHaveBeenCalledTimes(1);
    expect(before.mock.calls[0][0]).toBe(shader);
    expect(material.customProgramCacheKey()).toBe('hem-cut-v3|cloth-detail-v3');
    expect(material.customProgramCacheKey().endsWith('cloth-detail-v3')).toBe(true);
  });

  it('writes its code into three\'s standard shader and keeps every hook once', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const shader = compiled(material);
    expect(shader.vertexShader).toContain('varying vec3 vClothWorld;');
    const decls = [
      'uniform float clothDetailOn;', 'uniform vec3 clothSpotC[3];', 'uniform vec3 clothSpotN[3];', 'uniform float clothSpotH[3];', 'uniform float clothSpotR[3];',
      'uniform float clothSettleOn;', 'uniform vec3 clothSettleC;', 'uniform vec3 clothSettleN;', 'uniform float clothSettleH;', 'uniform vec3 clothSettleL;', 'uniform mat3 clothSettleQ;',
      'uniform float clothSettleIn;', 'uniform float clothSettleOut;', 'uniform float clothSettleF;', 'uniform float clothSettleT;', 'uniform float clothSettleR;',
    ];
    for (const decl of decls) {
      expect(count(shader.vertexShader, decl), decl).toBe(1);
      expect(count(shader.fragmentShader, decl), decl).toBe(1);
    }
    // the v2 flatten is gone from both stages
    for (const gone of ['clothSpotF', 'clothSpotE']) {
      expect(shader.vertexShader).not.toContain(gone);
      expect(shader.fragmentShader).not.toContain(gone);
    }
    const vert = shader.vertexShader, at = vert.indexOf('#include <project_vertex>');
    expect(vert.indexOf('vec4 clothW = modelMatrix * vec4(transformed, 1.0);')).toBeGreaterThan(at);
    // the garment's own normal in world space decides the layer; the point moves along the axis by its deviation
    expect(vert).toContain('transformNormalByInverseViewMatrix(transformedNormal, viewMatrix)');
    expect(vert).toContain('float clothLayer = clothSettleT * clamp(0.5 - 2.0 * dot(clothWN, clothSN), 0.0, 1.0);');
    expect(vert).toContain('vec3 clothQT = clothSettleQ * clothST;');
    expect(vert).toContain('float clothSurf = clothSettleH + dot(clothSettleL, clothST) - dot(clothST, clothQT);');
    expect(vert).toContain('float clothDev = clothSAlong - (clothSurf - clothLayer);');
    expect(vert).toContain('1.0 - smoothstep(clothSettleR, 1.5 * clothSettleR, abs(clothDev))');
    expect(vert).toContain('vec3 clothDisp = -(clothSW * clothDev) * clothSN;');
    // the varying is the drawn (displaced) point, written after any displacement
    expect(vert.indexOf('vClothWorld = clothW.xyz;')).toBeGreaterThan(vert.indexOf('clothW.xyz += clothDisp;'));
    // nothing to settle: the clip position is three's own (in project_vertex), rewritten only inside the guard below
    expect(count(vert, 'gl_Position =')).toBe(1);
    expect(vert).toMatch(/if \(dot\(clothDisp, clothDisp\) > 0\.0\) \{\s*clothW\.xyz \+= clothDisp;\s*mvPosition = viewMatrix \* clothW;\s*gl_Position = projectionMatrix \* mvPosition;\s*\}/);
    expect(vert.indexOf('if (clothSettleOn > 0.5)')).toBeLessThan(vert.indexOf('if (dot(clothDisp, clothDisp) > 0.0)'));
    // the spots' gradient is their own height again
    const frag = shader.fragmentShader;
    expect(frag).toContain('clothGrad += clothH * clothG * clothFade * (-2.0 / clothR2) * clothT;');
    expect(frag).toContain('diffuseColor.rgb *= clothShade;');
    expect(frag).toContain('normal = normalize(normal - faceDirection * (mat3(viewMatrix) * clothGrad));');
    // the settle's mix: no layer term, toward N + 2K t, and only where it has any weight
    expect(frag).toContain('float clothSurf = clothSettleH + dot(clothSettleL, clothST) - dot(clothST, clothQT);');
    expect(frag).toContain('float clothDev0 = clothSAlong - clothSurf;');
    expect(frag).toContain('if (clothSW > 0.0) normal = normalize(mix(normal, faceDirection * normalize(mat3(viewMatrix) * (clothSN - clothSettleL + 2.0 * (clothQT - dot(clothQT, clothSN) * clothSN))), clothSW));');
    expect(count(frag, 'normal = normalize(')).toBe(2);
    // the same constants as the CPU
    expect(frag).toContain(`clamp(clothDark * ${DIMPLE_DARKEN}, -${MAX_DARKEN}, 0.0)`);
    // the relief comes after the colour is known; the settle's mix after the shading normal is, and the spots' tilt on top
    expect(frag.indexOf('#include <color_fragment>')).toBeLessThan(frag.indexOf('float clothShade'));
    expect(frag.indexOf('#include <normal_fragment_begin>')).toBeLessThan(frag.indexOf('#include <normal_fragment_maps>'));
    expect(frag.indexOf('#include <normal_fragment_maps>')).toBeLessThan(frag.indexOf('mix(normal, faceDirection'));
    expect(frag.indexOf('mix(normal, faceDirection')).toBeLessThan(frag.indexOf('mat3(viewMatrix) * clothGrad'));
    for (const token of ['#include <project_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>', '#include <defaultnormal_vertex>']) expect(count(shader.vertexShader, token), token).toBe(1);
    // transformedNormal is declared before the hook that reads it
    expect(vert.indexOf('#include <defaultnormal_vertex>')).toBeLessThan(at);
    for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>']) expect(count(shader.fragmentShader, token), token).toBe(1);
    expect(Object.keys(shader.uniforms).sort()).toEqual([
      'clothDetailOn', 'clothSettleC', 'clothSettleF', 'clothSettleH', 'clothSettleIn', 'clothSettleL', 'clothSettleN', 'clothSettleOn',
      'clothSettleOut', 'clothSettleQ', 'clothSettleR', 'clothSettleT', 'clothSpotC', 'clothSpotH', 'clothSpotN', 'clothSpotR',
    ]);
    expect(shader.uniforms.clothDetailOn.value).toBe(0); // starts off
    expect(shader.uniforms.clothSettleOn.value).toBe(0);
    expect(shader.uniforms.clothSettleF.value).toBe(0);
  });

  for (const order of ['fabric first', 'cloth detail first'] as const) {
    it(`lives alongside the fabric patch (${order})`, () => {
      const { mesh, material } = tee();
      if (order === 'fabric first') { dress(mesh, material); patchClothDetail(material); } else { patchClothDetail(material); dress(mesh, material); }
      const shader = compiled(material);
      // the fabric's own insertions
      expect(shader.vertexShader).toContain('vFabricPos = fabricRest;');
      expect(shader.fragmentShader).toContain('float fabricMatte = 0.0, fabricRoughness = 1.0;');
      expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, fabricRoughness, fabricMatte);');
      expect(shader.uniforms.fabricOn0.value).toBe(1);
      // and the detail's
      expect(shader.vertexShader).toContain('vec4 clothW = modelMatrix * vec4(transformed, 1.0);');
      expect(shader.vertexShader).toContain('vClothWorld = clothW.xyz;');
      expect(shader.vertexShader).toContain('uniform float clothSettleF;');
      expect(shader.vertexShader).toContain('vec3 clothDisp = -(clothSW * clothDev) * clothSN;');
      expect(shader.fragmentShader).toContain('uniform float clothSettleF;');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb *= clothShade;');
      expect(shader.fragmentShader).toContain('mat3(viewMatrix) * clothGrad');
      expect(shader.fragmentShader).toContain('mix(normal, faceDirection');
      expect(shader.uniforms.clothDetailOn).toBeDefined();
      expect(shader.uniforms.clothSettleOn).toBeDefined();
      // the fabric's colour is laid before the detail shades it
      expect(shader.fragmentShader.indexOf('float fabricMatte')).toBeLessThan(shader.fragmentShader.indexOf('*= clothShade'));
      for (const token of ['#include <project_vertex>', '#include <begin_vertex>', '#include <beginnormal_vertex>']) expect(count(shader.vertexShader, token), token).toBe(1);
      for (const token of ['#include <color_fragment>', '#include <normal_fragment_maps>', '#include <map_fragment>', '#include <roughnessmap_fragment>', '#include <metalnessmap_fragment>']) expect(count(shader.fragmentShader, token), token).toBe(1);
      const key = material.customProgramCacheKey();
      expect(key).toContain('|fabric-1-v11');
      expect(key).toContain('|cloth-detail-v3');
    });
  }
});

describe('the spots and the settle in the uniforms', () => {
  const navel = spot([1, -12, 9], -0.4, 0.8, [0, 0, 2]);
  const left = spot([-5, 10, 11], 0.3, 0.6, [-0.2, 0, 1]);
  const right = spot([5, 10, 11], 0.25, 0.5);
  const settle: ClothDetailSettle = {
    center: [1, -12, 9.2], normal: [0, 3, 4], height: 0.6, slope: [0.1, 0.2, 0.3],
    // not symmetric, ON PURPOSE: it shows which way round the matrix reaches the shader
    curvature: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    inner: 0.9, outer: 1.8, amount: 0.75, thickness: 0.09, reach: 2.5,
  };

  it('land in the uniforms the shader reads: navel in 0, nipples in 1 and 2', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const shader = compiled(material); // compiled before the spots arrive: they reach it as uniform values
    setClothDetail(material, { navel, nipples: [left, right] });
    const u = shader.uniforms;
    expect(u.clothDetailOn.value).toBe(1);
    const c = u.clothSpotC.value as THREE.Vector3[], n = u.clothSpotN.value as THREE.Vector3[];
    expect(c.map((v) => v.toArray())).toEqual([[1, -12, 9], [-5, 10, 11], [5, 10, 11]]);
    expect(n[0].toArray()).toEqual([0, 0, 1]); // made unit length, as the CPU does
    expect(n[1].length()).toBeCloseTo(1, 12);
    expect(n[1].x).toBeLessThan(0);
    expect(n[2].toArray()).toEqual([0, 0, 1]);
    expect(u.clothSpotH.value).toEqual([-0.4, 0.3, 0.25]);
    expect(u.clothSpotR.value).toEqual([0.8, 0.6, 0.5]);
    expect(u.clothSettleOn.value).toBe(0); // no settle: off, nothing taken back
    expect(u.clothSettleF.value).toBe(0);
  });

  it('carry the settle, its axis made unit length and its amount clamped', () => {
    const material = new THREE.MeshStandardMaterial();
    patchClothDetail(material);
    const u = compiled(material).uniforms;
    setClothDetail(material, { navel, nipples: [left, right], settle });
    expect(u.clothSettleOn.value).toBe(1);
    expect((u.clothSettleC.value as THREE.Vector3).toArray()).toEqual([1, -12, 9.2]);
    const axis = (u.clothSettleN.value as THREE.Vector3).toArray();
    expect(axis[0]).toBe(0);
    expect(axis[1]).toBeCloseTo(0.6, 12);
    expect(axis[2]).toBeCloseTo(0.8, 12);
    expect([u.clothSettleH.value, u.clothSettleIn.value, u.clothSettleOut.value]).toEqual([0.6, 0.9, 1.8]);
    // the slope made tangent: its part along the axis (0.36 of it) taken out
    const slope = (u.clothSettleL.value as THREE.Vector3).toArray();
    expectVecClose(slope, [0.1, 0.2 - 0.36 * 0.6, 0.3 - 0.36 * 0.8]);
    expect(dot(slope, axis)).toBeCloseTo(0, 12);
    // the curvature as given, so that the shader's (column-major) mat3 times t is the row-major Q t
    const Q = u.clothSettleQ.value as THREE.Matrix3;
    expect(Q.elements).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    const t = new THREE.Vector3(0.3, -0.5, 0.7);
    expectVecClose(t.clone().applyMatrix3(Q).toArray(), mul(settle.curvature, t.toArray()));
    expect([u.clothSettleF.value, u.clothSettleT.value, u.clothSettleR.value]).toEqual([0.75, 0.09, 2.5]);
    setClothDetail(material, { navel, nipples: [], settle: { ...settle, amount: 1.5 } });
    expect(u.clothSettleF.value).toBe(1);
    setClothDetail(material, { navel, nipples: [], settle: { ...settle, amount: -1 } });
    expect(u.clothSettleF.value).toBe(0);
    // a settle with no axis is off
    setClothDetail(material, { navel, nipples: [], settle: { ...settle, normal: [0, 0, 0] } });
    expect(u.clothSettleOn.value).toBe(0);
    expect(u.clothSettleF.value).toBe(0);
    // and taken away again
    setClothDetail(material, { navel, nipples: [], settle });
    setClothDetail(material, { navel, nipples: [] });
    expect(u.clothSettleOn.value).toBe(0);
    expect(u.clothSettleF.value).toBe(0);
    expect(u.clothDetailOn.value).toBe(1); // the spots stay on
  });

  it('ignores extra nipples and empties a missing spot', () => {
    const material = new THREE.MeshStandardMaterial();
    setClothDetail(material, { navel: null, nipples: [left, right, spot([0, 0, 0], 9, 9)] });
    const u = compiled(material).uniforms;
    expect((u.clothSpotC.value as THREE.Vector3[]).length).toBe(3);
    expect((u.clothSpotC.value as THREE.Vector3[])[2].toArray()).toEqual([5, 10, 11]);
    expect(u.clothSpotH.value).toEqual([0, 0.3, 0.25]);
    expect(u.clothSpotR.value).toEqual([1, 0.6, 0.5]);
  });

  it('switch off with null, and leave a material never patched alone', () => {
    const material = new THREE.MeshStandardMaterial();
    setClothDetail(material, { navel, nipples: [left, right], settle });
    setClothDetail(material, null);
    const u = compiled(material).uniforms;
    expect(u.clothDetailOn.value).toBe(0);
    expect(u.clothSpotH.value).toEqual([0, 0, 0]);
    expect(u.clothSettleOn.value).toBe(0);
    expect(u.clothSettleF.value).toBe(0);
    const plain = new THREE.MeshStandardMaterial();
    const version = plain.version, hook = plain.onBeforeCompile;
    setClothDetail(plain, null);
    expect(plain.version).toBe(version);
    expect(plain.onBeforeCompile).toBe(hook);
  });
});
