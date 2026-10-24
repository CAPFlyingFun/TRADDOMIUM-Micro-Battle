import { describe, expect, it } from 'vitest';
import { dabRows, paintDab, SkinUndo, TriangleGrid, type DirtyRows, type SkinDab, type SkinImage, type SkinMesh } from '../src/sarahlab/skinPaint';

/**
 * SKIN PAINT (Joshua, 2026-10-24: "maybe a simple body texture uploaded/paint"). Her skin map is one atlas of hundreds
 * of islands, so the brush is a sphere on her surface at REST, never a circle in the image: what these pin is that a
 * texel is painted by where it is on her, and that the pad, the overlap, the eraser and the undo do exactly what the
 * module says.
 */

type Rgb3 = readonly [number, number, number];

function blank(w: number, h: number, rgb: Rgb3 = [0, 0, 0]): SkinImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1]; data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
/** A different colour at every texel, alpha varying too (it must never change). */
function gradient(w: number, h: number): SkinImage {
  const img = blank(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    img.data[o] = x * 4; img.data[o + 1] = y * 4; img.data[o + 2] = 77; img.data[o + 3] = 200 + (x % 50);
  }
  return img;
}
const copy = (img: SkinImage): SkinImage => ({ width: img.width, height: img.height, data: img.data.slice() });
const red = (img: SkinImage, x: number, y: number) => img.data[(y * img.width + x) * 4];
const texel = (img: SkinImage, x: number, y: number) => Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
/** The rows where two images differ, min to max; null if none. */
function diffRows(a: SkinImage, b: SkinImage): DirtyRows | null {
  const stride = a.width * 4;
  let from = Infinity, to = -Infinity;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) { const y = Math.floor(i / stride); from = Math.min(from, y); to = Math.max(to, y); }
  return from <= to ? { from, to } : null;
}
const allOf = (mesh: SkinMesh) => Array.from({ length: mesh.index.length / 3 }, (_, i) => i);
const brush = (over: Partial<SkinDab> & Pick<SkinDab, 'centre' | 'radius'>): SkinDab => ({ colour: [255, 255, 255], strength: 1, hardness: 1, erase: false, ...over });

/**
 * Rectangles of surface, each at rest [x0, x1] × [y0, y1] at height z and laid in the image at [u0, u1] × [v0, v1]:
 * two triangles each, facing +z (or -z with `back`).
 */
interface Rect { readonly rest: readonly [number, number, number, number, number]; readonly uv: readonly [number, number, number, number]; readonly back?: boolean }
function meshOf(...rects: Rect[]): SkinMesh {
  const rest: number[] = [], uv: number[] = [], index: number[] = [];
  for (const { rest: [x0, y0, x1, y1, z], uv: [u0, v0, u1, v1], back } of rects) {
    const v = rest.length / 3;
    rest.push(x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    index.push(...(back ? [v, v + 2, v + 1, v, v + 3, v + 2] : [v, v + 1, v + 2, v, v + 2, v + 3]));
  }
  return { rest, uv, index };
}
/** The unit square, its image the whole of a square image: a texel's rest point is its own UV. */
const QUAD = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 1, 1] });

/** A small deterministic random source (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a dab is a sphere on her surface, not a circle in the image', () => {
  it('paints exactly the texels whose rest point lies inside the radius', () => {
    const img = blank(64, 64), r = 10.3 / 64;
    expect(paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: r }))).not.toBeNull();
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const inside = (x + 0.5 - 32) ** 2 + (y + 0.5 - 32) ** 2 < 10.3 ** 2;
      expect(red(img, x, y)).toBe(inside ? 255 : 0);
    }
  });

  it('leaves alone the island beside it in the image, which is somewhere else on her', () => {
    // her left patch at columns 0..30, a patch a metre away at 32..64: two pixels apart in the image
    const mesh = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 30 / 64, 1] }, { rest: [100, 0, 101, 1, 0], uv: [32 / 64, 0, 1, 1] });
    const img = blank(64, 64);
    paintDab(img, null, mesh, allOf(mesh), brush({ centre: { x: 1, y: 0.5, z: 0 }, radius: 0.3 }));
    expect(red(img, 29, 32)).toBe(255); // the left patch's edge, where the dab is
    expect(red(img, 30, 32)).toBe(255); // and its one-pixel pad
    for (let y = 0; y < 64; y++) for (let x = 31; x < 64; x++) expect(red(img, x, y)).toBe(0);
  });

  it('paints both sides of a seam, on islands far apart in the image', () => {
    // one strip of her cut at x = 1: the left half at the image's left, the right half at its right
    const mesh = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 16 / 64, 1] }, { rest: [1, 0, 2, 1, 0], uv: [48 / 64, 0, 1, 1] });
    const img = blank(64, 64);
    paintDab(img, null, mesh, allOf(mesh), brush({ centre: { x: 1, y: 0.5, z: 0 }, radius: 0.25 }));
    expect(red(img, 15, 32)).toBe(255);
    expect(red(img, 48, 32)).toBe(255);
    expect(red(img, 16, 32)).toBe(255); // the pads past each edge
    expect(red(img, 47, 32)).toBe(255);
    for (let y = 0; y < 64; y++) for (let x = 17; x <= 46; x++) expect(red(img, x, y)).toBe(0);
  });
});

describe('strength and hardness', () => {
  // centre on texel (32, 32), radius 16 texels, hard core 8 texels, strength 0.8; white on black
  const centre = { x: 32.5 / 64, y: 32.5 / 64, z: 0 };
  const img = blank(64, 64);
  paintDab(img, null, QUAD, allOf(QUAD), brush({ centre, radius: 16 / 64, strength: 0.8, hardness: 0.5 }));

  it('is the full strength at the centre and through the hard core', () => {
    expect(red(img, 32, 32)).toBe(204); // 0.8 of 255
    expect(red(img, 38, 32)).toBe(204);
    expect(red(img, 32, 38)).toBe(204);
  });
  it('falls off smoothly between the core and the rim', () => {
    expect(red(img, 44, 32)).toBe(102); // halfway out: smoothstep 0.5, 0.4 of 255
    expect(red(img, 32, 44)).toBe(102);
    expect(red(img, 46, 32)).toBe(32); // three quarters: 1 - 0.5625 × 1.5 = 0.15625, × 0.8 × 255 = 31.875
  });
  it('is nothing at the rim and beyond it', () => {
    expect(red(img, 48, 32)).toBe(0);
    expect(red(img, 50, 32)).toBe(0);
    expect(texel(img, 48, 32)).toEqual([0, 0, 0, 255]);
  });
  it('a soft brush moves a texel only part of the way, and alpha never', () => {
    const g = gradient(64, 64), before = copy(g);
    paintDab(g, null, QUAD, allOf(QUAD), brush({ centre, radius: 16 / 64, strength: 0.4, hardness: 0, colour: [10, 250, 77] }));
    const was = texel(before, 32, 32), now = texel(g, 32, 32);
    expect(now[0]).toBe(Math.round(was[0] + (10 - was[0]) * 0.4));
    expect(now[1]).toBe(Math.round(was[1] + (250 - was[1]) * 0.4));
    for (let i = 3; i < g.data.length; i += 4) expect(g.data[i]).toBe(before.data[i]);
  });
});

describe('which texels a triangle covers', () => {
  // one triangle with corners at texels (10, 10), (20, 10), (10, 20), its rest the same numbers / 64
  const tri: SkinMesh = { rest: [10 / 64, 10 / 64, 0, 20 / 64, 10 / 64, 0, 10 / 64, 20 / 64, 0], uv: [10 / 64, 10 / 64, 20 / 64, 10 / 64, 10 / 64, 20 / 64], index: [0, 1, 2] };
  const everything = brush({ centre: { x: 15 / 64, y: 15 / 64, z: 0 }, radius: 1 });

  it('covers texels whose centre is within one pixel of it, and no further', () => {
    const img = blank(64, 64);
    paintDab(img, null, tri, [0], everything);
    expect(red(img, 9, 15)).toBe(255); // half a pixel left of the left edge
    expect(red(img, 8, 15)).toBe(0); // a pixel and a half
    expect(red(img, 15, 9)).toBe(255);
    expect(red(img, 15, 8)).toBe(0);
    expect(red(img, 15, 15)).toBe(255); // 0.71 px past the long edge
    expect(red(img, 15, 16)).toBe(0); // 1.41 px past it
    expect(red(img, 20, 9)).toBe(255); // 0.71 px from a corner
    expect(red(img, 21, 9)).toBe(0); // 1.58 px
  });
  it('a padding texel takes a point ON the triangle, never one extrapolated off it', () => {
    // texel (15, 15) is just past the long edge: extrapolated it would be (15.5, 15.5) / 64, off the triangle (though
    // inside its box, so the dab is not turned away whole); clamped it is (15, 15) / 64, on the edge, 0.71 texels away
    const img = blank(64, 64);
    const at = { x: 15.5 / 64, y: 15.5 / 64, z: 0 };
    expect(paintDab(img, null, tri, [0], brush({ centre: at, radius: 0.45 / 64 }))).toBeNull();
    expect(paintDab(img, null, tri, [0], brush({ centre: at, radius: 0.8 / 64 }))).toEqual({ from: 15, to: 15 });
    expect(red(img, 15, 15)).toBe(255);
    expect(red(img, 14, 15)).toBe(0); // on the edge, a whole texel from the centre
    expect(red(img, 15, 14)).toBe(0);
  });
  it('skips a triangle with no area in the image', () => {
    const flat: SkinMesh = { rest: tri.rest, uv: [10 / 64, 10 / 64, 20 / 64, 20 / 64, 30 / 64, 30 / 64], index: [0, 1, 2] };
    const img = blank(64, 64);
    expect(paintDab(img, null, flat, [0], everything)).toBeNull();
    expect(dabRows(img, flat, [0], everything)).toBeNull();
  });
  it('clips to the image', () => {
    const big = meshOf({ rest: [0, 0, 1, 1, 0], uv: [-0.5, -0.5, 1.5, 1.5] });
    const img = blank(16, 16);
    expect(paintDab(img, null, big, allOf(big), brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 10 }))).toEqual({ from: 0, to: 15 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(red(img, x, y)).toBe(255);
    expect(img.data.length).toBe(16 * 16 * 4);
  });
});

describe('a texel two triangles cover', () => {
  it('is blended once, at the stronger weight, not twice', () => {
    // the quad's two triangles share its diagonal, and their pads overlap along it
    const img = blank(64, 64);
    paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 10, strength: 0.5 }));
    for (let i = 0; i < 64; i++) {
      expect(red(img, i, i)).toBe(128); // once: 127.5; twice would be 192
      if (i < 63) expect(red(img, i + 1, i)).toBe(128);
    }
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(128);
  });
  it('takes the strongest of the weights whatever order the triangles come in', () => {
    // two sheets laid on the same texels, one on the dab's centre, one 6 cm off it: every texel is the near sheet's
    const near = { rest: [0, 0, 1, 1, 0], uv: [0, 0, 1, 1] } as const, far = { rest: [0, 0, 1, 1, 0.06], uv: [0, 0, 1, 1] } as const;
    const dab = brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 0.3, strength: 0.9, hardness: 0.2 });
    const alone = blank(64, 64);
    paintDab(alone, null, meshOf(near), [0, 1], dab);
    for (const mesh of [meshOf(near, far), meshOf(far, near)]) {
      const img = blank(64, 64);
      paintDab(img, null, mesh, [0, 1, 2, 3], dab);
      expect(Array.from(img.data)).toEqual(Array.from(alone.data));
    }
  });
  it('and the same when the dab spans islands at opposite corners of a big image', () => {
    // 1450² is over 2^21 texels, so this dab's box (the whole image) gathers its weights in a map, not the array
    const W = 1450, side = 40 / W, corner = (u: number, v: number) => [u, v, u + side, v + side] as const;
    const a = { rest: [0, 0, 1, 1, 0], uv: corner(0, 0) } as const, aFar = { rest: [0, 0, 1, 1, 0.06], uv: corner(0, 0) } as const;
    const b = { rest: [1, 0, 2, 1, 0], uv: corner(1 - side, 1 - side) } as const, mesh = meshOf(a, aFar, b);
    const dab = brush({ centre: { x: 1, y: 0.5, z: 0 }, radius: 0.5, strength: 0.9, hardness: 0.2 });
    const expected = blank(W, W);
    paintDab(expected, null, mesh, [0, 1], dab); // each island on its own: a small box
    paintDab(expected, null, mesh, [4, 5], dab);
    const firstDifference = (x: SkinImage, y: SkinImage) => x.data.findIndex((v, i) => v !== y.data[i]);
    for (const order of [[0, 1, 2, 3, 4, 5], [5, 4, 3, 2, 1, 0]]) {
      const img = blank(W, W);
      const rows = paintDab(img, null, mesh, order, dab);
      expect(firstDifference(img, expected)).toBe(-1);
      expect(rows?.from).toBeLessThan(41);
      expect(rows?.to).toBeGreaterThan(W - 42);
    }
  });
  it('even when the same triangle is offered twice', () => {
    const img = blank(64, 64);
    paintDab(img, null, QUAD, [0, 0, 1, 1, 0], brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 10, strength: 0.5 }));
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(128);
  });
});

describe('the eraser', () => {
  const at = { x: 0.5, y: 0.5, z: 0 };
  it('returns texels to the base image exactly', () => {
    const base = gradient(64, 64), img = copy(base);
    expect(paintDab(img, base, QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, colour: [255, 0, 255] }))).not.toBeNull();
    expect(diffRows(img, base)).not.toBeNull();
    expect(paintDab(img, base, QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, erase: true }))).not.toBeNull();
    expect(Array.from(img.data)).toEqual(Array.from(base.data));
  });
  it('part strength goes part of the way back', () => {
    const base = gradient(64, 64), img = copy(base);
    paintDab(img, base, QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, colour: [255, 255, 255] }));
    paintDab(img, base, QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, erase: true, strength: 0.5 }));
    const b = texel(base, 30, 34);
    expect(texel(img, 30, 34)).toEqual([Math.round(255 + (b[0] - 255) * 0.5), Math.round(255 + (b[1] - 255) * 0.5), Math.round(255 + (b[2] - 255) * 0.5), b[3]]);
  });
  it('with no base (or a base of another size) changes nothing', () => {
    const img = gradient(64, 64), before = copy(img);
    expect(paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, erase: true }))).toBeNull();
    expect(paintDab(img, blank(32, 32), QUAD, allOf(QUAD), brush({ centre: at, radius: 0.2, erase: true }))).toBeNull();
    expect(diffRows(img, before)).toBeNull();
  });
});

describe('the normal under the brush', () => {
  // the front of a thin slab at z 0 (left of the image) and its back a centimetre behind (right of the image)
  const slab = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 0.5, 1] }, { rest: [0, 0, 1, 1, -0.01], uv: [0.5, 0, 1, 1], back: true });
  const at = { x: 0.5, y: 0.5, z: 0 };

  it('keeps a dab on the front from reaching the back', () => {
    const img = blank(64, 64);
    paintDab(img, null, slab, allOf(slab), brush({ centre: at, radius: 0.2, normal: [0, 0, 1] }));
    expect(red(img, 16, 32)).toBe(255);
    for (let y = 0; y < 64; y++) for (let x = 33; x < 64; x++) expect(red(img, x, y)).toBe(0);
  });
  it('and the other way round', () => {
    const img = blank(64, 64);
    paintDab(img, null, slab, allOf(slab), brush({ centre: { ...at, z: -0.01 }, radius: 0.2, normal: [0, 0, -2] }));
    expect(red(img, 48, 32)).toBe(255);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 31; x++) expect(red(img, x, y)).toBe(0);
  });
  it('without a normal, both sides are painted', () => {
    const img = blank(64, 64);
    paintDab(img, null, slab, allOf(slab), brush({ centre: at, radius: 0.2 }));
    expect(red(img, 16, 32)).toBe(255);
    expect(red(img, 48, 32)).toBe(255);
  });
});

describe('the rows a dab changed', () => {
  it('are exactly the first and last rows whose bytes differ', () => {
    const two = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 0.5, 0.5] }, { rest: [1, 0, 2, 1, 0], uv: [0.5, 0.5, 1, 1] });
    const rand = random(7);
    for (const mesh of [QUAD, two]) for (let k = 0; k < 40; k++) {
      const img = gradient(64, 64), before = copy(img);
      const dab = brush({ centre: { x: rand() * 2, y: rand(), z: (rand() - 0.5) * 0.1 }, radius: 0.02 + rand() * 0.3, strength: rand(), hardness: rand(), colour: [rand() * 255, rand() * 255, rand() * 255] });
      expect(paintDab(img, null, mesh, allOf(mesh), dab)).toEqual(diffRows(before, img));
    }
  });
  it('are null when nothing changes', () => {
    const img = blank(64, 64);
    expect(paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: { x: 5, y: 5, z: 5 }, radius: 0.5 }))).toBeNull(); // off her
    expect(paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 0.5, strength: 0 }))).toBeNull();
    expect(paintDab(img, null, QUAD, allOf(QUAD), brush({ centre: { x: 0.5, y: 0.5, z: 0 }, radius: 0.5, colour: [0, 0, 0] }))).toBeNull(); // already that colour
    expect(diffRows(img, blank(64, 64))).toBeNull();
  });
});

describe('dabRows', () => {
  it('covers every row paintDab changes', () => {
    const rand = random(11);
    const seam = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 16 / 64, 1] }, { rest: [1, 0, 2, 1, 0], uv: [48 / 64, 0, 1, 1] });
    const slab = meshOf({ rest: [0, 0, 1, 1, 0], uv: [0, 0, 0.5, 0.5] }, { rest: [0, 0, 1, 1, -0.01], uv: [0.5, 0.5, 1, 1], back: true });
    for (const mesh of [QUAD, seam, slab, wavy]) for (let k = 0; k < 60; k++) {
      const img = gradient(64, 64), before = copy(img);
      const dab = brush({ centre: { x: rand() * 2, y: rand(), z: (rand() - 0.5) * 0.2 }, radius: 0.01 + rand() * 0.4, strength: rand(), hardness: rand(), erase: k % 5 === 0, normal: k % 2 ? [0, 0, rand() < 0.5 ? 1 : -1] : undefined });
      const rows = dabRows(img, mesh, allOf(mesh), dab), changed = paintDab(img, blank(64, 64), mesh, allOf(mesh), dab);
      const diff = diffRows(before, img);
      expect(changed).toEqual(diff);
      if (!changed) continue;
      expect(rows).not.toBeNull();
      expect(rows!.from).toBeLessThanOrEqual(changed.from);
      expect(rows!.to).toBeGreaterThanOrEqual(changed.to);
    }
  });
});

/** A rippled sheet of 20 × 20 small quads (800 triangles) over [0, 1]², plus one triangle far away. */
const wavy: SkinMesh = (() => {
  const rest: number[] = [], uv: number[] = [], index: number[] = [], n = 20;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { rest.push(i / n, j / n, 0.05 * Math.sin(i * 0.9) * Math.cos(j * 0.7)); uv.push(i / n, j / n); }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = j * (n + 1) + i; index.push(v, v + 1, v + n + 2, v, v + n + 2, v + n + 1); }
  const far = rest.length / 3;
  rest.push(50, 50, 50, 51, 50, 50, 50, 51, 50);
  uv.push(0.9, 0.9, 0.95, 0.9, 0.9, 0.95);
  index.push(far, far + 1, far + 2);
  return { rest, uv, index };
})();

describe('TriangleGrid', () => {
  /** Every triangle whose rest box meets the sphere, by looking at all of them. */
  function brute(mesh: SkinMesh, c: { x: number; y: number; z: number }, r: number): number[] {
    const out: number[] = [];
    for (let t = 0; t < mesh.index.length / 3; t++) {
      let d2 = 0;
      for (const [k, v] of [[0, c.x], [1, c.y], [2, c.z]] as const) {
        const p = [0, 1, 2].map((i) => mesh.rest[mesh.index[t * 3 + i] * 3 + k]);
        const e = Math.max(Math.min(...p) - v, 0, v - Math.max(...p));
        d2 += e * e;
      }
      if (d2 <= r * r) out.push(t);
    }
    return out;
  }

  it('returns each nearby triangle once, and none far away', () => {
    const grid = new TriangleGrid(wavy, 0.03), rand = random(3), far = wavy.index.length / 3 - 1;
    for (let k = 0; k < 80; k++) {
      const c = { x: rand() * 1.2 - 0.1, y: rand() * 1.2 - 0.1, z: (rand() - 0.5) * 0.2 }, r = rand() * 0.25;
      const got = grid.near(c, r);
      expect(new Set(got).size).toBe(got.length);
      expect([...got].sort((a, b) => a - b)).toEqual(brute(wavy, c, r));
      expect(got).not.toContain(far);
    }
    expect(grid.near({ x: 20, y: 20, z: 20 }, 1)).toEqual([]);
    expect(grid.near({ x: 50.2, y: 50.2, z: 50 }, 0.1)).toEqual([far]);
  });
  it('a grid too fine for its cap grows its cells and still answers the same', () => {
    const grid = new TriangleGrid(wavy, 1e-9);
    const c = { x: 0.5, y: 0.5, z: 0 };
    expect([...grid.near(c, 0.2)].sort((a, b) => a - b)).toEqual(brute(wavy, c, 0.2));
  });
  it('painting through it is painting with every triangle', () => {
    const grid = new TriangleGrid(wavy, 0.03), rand = random(5);
    for (let k = 0; k < 20; k++) {
      const dab = brush({ centre: { x: rand(), y: rand(), z: 0 }, radius: 0.02 + rand() * 0.2, strength: 0.3 + rand() * 0.7, hardness: rand(), normal: [0, 0, 1] });
      const a = gradient(64, 64), b = copy(a);
      paintDab(a, null, wavy, grid.near(dab.centre, dab.radius), dab);
      paintDab(b, null, wavy, allOf(wavy), dab);
      expect(Array.from(a.data)).toEqual(Array.from(b.data));
    }
  });
  it('an empty mesh is an empty grid', () => {
    expect(new TriangleGrid({ rest: [], uv: [], index: [] }, 0.02).near({ x: 0, y: 0, z: 0 }, 1)).toEqual([]);
  });
});

describe('SkinUndo', () => {
  /** One stroke of several overlapping dabs, kept as the painter keeps them. */
  function stroke(undo: SkinUndo, img: SkinImage, at: readonly (readonly [number, number])[], colour: Rgb3): void {
    undo.begin();
    for (const [x, y] of at) {
      const dab = brush({ centre: { x, y, z: 0 }, radius: 0.15, strength: 0.6, hardness: 0.3, colour });
      const rows = dabRows(img, QUAD, allOf(QUAD), dab);
      if (rows) undo.keep(img, rows);
      paintDab(img, null, QUAD, allOf(QUAD), dab);
    }
    undo.end();
  }

  it('undoes and redoes a whole multi-dab stroke to the exact bytes', () => {
    const undo = new SkinUndo(), img = gradient(64, 64), before = copy(img);
    expect(undo.canUndo).toBe(false);
    stroke(undo, img, [[0.3, 0.3], [0.38, 0.33], [0.45, 0.38], [0.4, 0.3]], [255, 0, 0]);
    const after = copy(img);
    expect(diffRows(before, after)).not.toBeNull();
    expect(undo.canUndo).toBe(true);
    expect(undo.canRedo).toBe(false);
    const rows = undo.undo(img);
    expect(Array.from(img.data)).toEqual(Array.from(before.data));
    const diff = diffRows(before, after)!;
    expect(rows!.from).toBeLessThanOrEqual(diff.from);
    expect(rows!.to).toBeGreaterThanOrEqual(diff.to);
    expect(undo.canUndo).toBe(false);
    expect(undo.canRedo).toBe(true);
    expect(undo.redo(img)).toEqual(rows);
    expect(Array.from(img.data)).toEqual(Array.from(after.data));
    expect(undo.redo(img)).toBeNull();
  });
  it('keeps only the strokes its limit allows, oldest first to go', () => {
    const undo = new SkinUndo(2), img = gradient(64, 64);
    const states = [copy(img)];
    for (const [x, y] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8]] as const) { stroke(undo, img, [[x, y], [x + 0.05, y]], [0, 255, 0]); states.push(copy(img)); }
    expect(undo.undo(img)).not.toBeNull();
    expect(Array.from(img.data)).toEqual(Array.from(states[2].data));
    expect(undo.undo(img)).not.toBeNull();
    expect(Array.from(img.data)).toEqual(Array.from(states[1].data));
    expect(undo.canUndo).toBe(false);
    expect(undo.undo(img)).toBeNull();
    expect(Array.from(img.data)).toEqual(Array.from(states[1].data));
  });
  it('keeps no more bytes than its budget, but always the newest stroke', () => {
    const img = gradient(64, 64), stride = 64 * 4, undo = new SkinUndo(12, stride * 10);
    for (const from of [0, 20]) {
      undo.begin();
      undo.keep(img, { from, to: from + 7 }); // 8 rows: two strokes are 16 rows, over the 10-row budget
      for (let i = from * stride; i < (from + 8) * stride; i++) img.data[i] = 9;
      undo.end();
    }
    expect(undo.undo(img)).toEqual({ from: 20, to: 27 });
    expect(undo.canUndo).toBe(false);
    const big = new SkinUndo(12, stride);
    big.keep(img, { from: 0, to: 63 }); // a stroke bigger than the whole budget is still the newest
    big.end();
    expect(big.canUndo).toBe(true);
  });
  it('a row is kept once a stroke, as it was before the stroke', () => {
    const undo = new SkinUndo(), img = gradient(64, 64), before = copy(img);
    undo.begin();
    undo.keep(img, { from: 5, to: 6 });
    img.data[5 * 256] = 1;
    undo.keep(img, { from: 4, to: 6 }); // row 5 is not kept again (it has changed since)
    img.data[5 * 256] = 2; img.data[4 * 256] = 3;
    undo.end();
    expect(undo.undo(img)).toEqual({ from: 4, to: 6 });
    expect(Array.from(img.data)).toEqual(Array.from(before.data));
  });
  it('a stroke that kept nothing is no step, and a new stroke ends the redo trail', () => {
    const undo = new SkinUndo(), img = gradient(64, 64);
    undo.begin();
    undo.end();
    expect(undo.canUndo).toBe(false);
    stroke(undo, img, [[0.5, 0.5]], [0, 0, 255]);
    undo.undo(img);
    expect(undo.canRedo).toBe(true);
    stroke(undo, img, [[0.2, 0.7]], [0, 0, 255]);
    expect(undo.canRedo).toBe(false);
    expect(undo.redo(img)).toBeNull();
    undo.clear();
    expect(undo.canUndo).toBe(false);
  });
});
