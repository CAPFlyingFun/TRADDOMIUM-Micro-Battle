import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { dilate, paintSplit, seatDelta, toBase64, uvIslands } from '../src/sarahlab/storyBake';

/** An RGBA image `w` x `h` of transparent black, with the given texels set (x, y, rgb, alpha 255). */
function image(w: number, h: number, set: readonly (readonly [number, number, number, number, number])[]): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (const [x, y, r, g, b] of set) out.set([r, g, b, 255], (y * w + x) * 4);
  return out;
}
const texel = (rgba: Uint8Array, w: number, x: number, y: number) => Array.from(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('dilate: the islands run out over the gaps between them', () => {
  it('never changes a covered texel, and fills its neighbours with its colour', () => {
    const src = image(5, 5, [[2, 2, 200, 100, 50]]);
    const out = dilate(src, 5, 5, 1);
    expect(texel(out, 5, 2, 2)).toEqual([200, 100, 50, 255]);
    for (const [x, y] of [[1, 1], [2, 1], [3, 3], [1, 2]]) expect(texel(out, 5, x, y)).toEqual([200, 100, 50, 255]);
    // one pass reaches one texel out, no further
    expect(texel(out, 5, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(texel(out, 5, 4, 2)).toEqual([0, 0, 0, 0]);
    // the input is not touched
    expect(texel(src, 5, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('takes the mean of the covered neighbours as the previous pass left them', () => {
    const out = dilate(image(3, 1, [[0, 0, 100, 0, 0], [2, 0, 200, 50, 0]]), 3, 1, 1);
    expect(texel(out, 3, 1, 0)).toEqual([150, 25, 0, 255]);
  });

  it('fills every gap given passes enough, and stops early when nothing is left', () => {
    const out = dilate(image(16, 16, [[0, 0, 10, 20, 30]]), 16, 16, 1000);
    for (let i = 0; i < 16 * 16; i++) expect(out[i * 4 + 3]).toBe(255);
    expect(texel(out, 16, 15, 15)).toEqual([10, 20, 30, 255]);
  });

  it('is deterministic, and leaves an image with nothing covered as it was', () => {
    const src = image(8, 6, [[1, 1, 9, 9, 9], [6, 4, 200, 0, 100], [3, 0, 50, 60, 70]]);
    expect(Array.from(dilate(src, 8, 6, 4))).toEqual(Array.from(dilate(src, 8, 6, 4)));
    const empty = new Uint8Array(4 * 4 * 4);
    expect(Array.from(dilate(empty, 4, 4, 8))).toEqual(Array.from(empty));
  });

  it('refuses an image that is not width x height RGBA', () => {
    expect(() => dilate(new Uint8Array(10), 2, 2)).toThrow();
  });
});

/** Three vertices along x, two morph targets ("lean" and "seat") moving them, as a quantized file stores them. */
function mesh(normalized: boolean, relative = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const target = (values: number[]) => normalized
    ? new THREE.BufferAttribute(Int16Array.from(values.map((v) => Math.round(v * 32767))), 3, true)
    : new THREE.BufferAttribute(Float32Array.from(values), 3);
  g.morphAttributes.position = [target([0, 0.5, 0, 0, 0.5, 0, 0, 0.5, 0]), target([0, 0, -0.25, 0, 0, 0, 0, 0, 0.25])];
  g.morphAttributes.normal = [target([0, 0, 0, 0, 0, 0, 0, 0, 0]), target([0.5, 0, 0, 0, 0, 0, 0, 0, 0])];
  g.morphTargetsRelative = relative;
  return { geometry: g, morphTargetDictionary: { lean: 0, seat: 1 } };
}

describe('seatDelta: what SIT changes, as one corrective target', () => {
  it('is the weight change times each target, by name', () => {
    const d = seatDelta(mesh(false), { lean: 0.2, seat: 0 }, { lean: 0.2, seat: 1 })!;
    expect(d.targets).toEqual(['seat']);
    expect(Array.from(d.position)).toEqual([0, 0, -0.25, 0, 0, 0, 0, 0, 0.25]);
    expect(Array.from(d.normal!)).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(d.max).toBe(0.25);
  });

  it('decodes normalized integer targets, as a quantized glTF stores them', () => {
    const d = seatDelta(mesh(true), { seat: 0.5, lean: 0 }, { seat: 1, lean: 1 })!;
    expect([...d.targets].sort()).toEqual(['lean', 'seat']);
    const expected = [0, 0.5, -0.125, 0, 0.5, 0, 0, 0.5, 0.125];
    d.position.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 4));
    expect(d.normal![0]).toBeCloseTo(0.25, 4);
  });

  it('treats a missing weight as 0, and reads absolute targets against the base', () => {
    const abs = mesh(false, false);
    // absolute targets: "seat" sits the vertices at its own positions, so its delta is target minus base
    const d = seatDelta(abs, {}, { seat: 1 })!;
    expect(Array.from(d.position)).toEqual([0, 0, -0.25, -1, 0, 0, -2, 0, 0.25]);
  });

  it('is null when SIT moves nothing, or there is nothing to move', () => {
    expect(seatDelta(mesh(false), { seat: 0.3 }, { seat: 0.3 })).toBeNull();
    expect(seatDelta({ geometry: new THREE.BufferGeometry() }, {}, { seat: 1 })).toBeNull();
  });
});

describe('uvIslands and paintSplit: her islands, and which of them the paint is on', () => {
  // two islands: a quad (vertices 0-3) and a triangle (4-6), split at a seam that duplicates no vertex between them
  const index = [0, 1, 2, 0, 2, 3, 4, 5, 6];

  it('numbers the islands by the triangles that share vertices', () => {
    expect(Array.from(uvIslands(index, 7))).toEqual([0, 0, 1]);
    expect(Array.from(uvIslands([0, 1, 2, 3, 4, 5, 2, 3, 6], 7))).toEqual([0, 0, 0]);
  });

  it('puts an island with the paint when most of its vertices are painted, whole', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
    // the quad: three of four corners painted (in the second layer); the triangle: one corner in three
    g.setAttribute('fabricPaint', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 0.9, 0, 0, 0.6, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), 3));
    const split = paintSplit(new THREE.Mesh(g), index)!;
    expect(Array.from(split.paint)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(split.skin)).toEqual([4, 5, 6]);
  });

  it('is null with no paint, or with all of her painted', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(7 * 3), 3));
    expect(paintSplit(new THREE.Mesh(g), index)).toBeNull();
    g.setAttribute('fabricPaint', new THREE.BufferAttribute(new Float32Array(7 * 3).fill(1), 3));
    expect(paintSplit(new THREE.Mesh(g), index)).toBeNull();
  });
});

describe('toBase64', () => {
  it('is the bytes of the view, not of its whole buffer', () => {
    const whole = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(Buffer.from(toBase64(whole.subarray(2, 5)), 'base64')).toEqual(Buffer.from([3, 4, 5]));
    const f = new Float32Array([1.5, -2]);
    expect(new Float32Array(new Uint8Array(Buffer.from(toBase64(f), 'base64')).buffer)).toEqual(f);
  });
});
