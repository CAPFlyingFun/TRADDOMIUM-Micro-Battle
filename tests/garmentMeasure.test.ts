/**
 * HER BODY, MEASURED (`src/sarahlab/garment/measure.ts`).
 *
 * On a synthetic body first -- a closed cylinder, radius 0.15 m, 64 segments round, 2 cm rings -- where every answer is
 * known: the dress form's outlines are the 64-gon (perimeter within 1% of 2 pi r), counter-clockwise from their largest
 * x, and `hullAt` blends two levels point for point. Then on Sarah herself, loaded from
 * `public/models/sarah-v2-body-slim.glb` through three's GLTFLoader under node with its textures stripped (as
 * `bodyBuildView.test.ts` does), at 0% belly (base + the `belly` morph), in rest metres: every measurement lands in the
 * band a woman of her build has, left and right agree, and the whole measure takes well under the time a room can wait.
 * The measured values are printed as a table for whoever drafts from them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { FACE_REST_OFFSET, FACE_REST_SCALE } from '../src/sarahlab/faceRig';
import { convexHull2D, dressForm, hullAt, measureBody, perimeter, sliceTriangles } from '../src/sarahlab/garment/measure';
import type { BodyInput, BodyJoints, BodyMeasure, DressForm, Vec3 } from '../src/sarahlab/garment/types';

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic

/** Signed area of an (x, z) outline: positive when counter-clockwise (x right, z up the page). */
function area(o: ArrayLike<number>): number {
  let a = 0;
  const n = o.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) a += o[2 * j] * o[2 * i + 1] - o[2 * i] * o[2 * j + 1];
  return a / 2;
}

/** The index (in points) of an outline's largest x. */
function argMaxX(o: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < o.length >> 1; i++) if (o[2 * i] > o[2 * best]) best = i;
  return best;
}

/** A closed cylinder about the y axis: `segments` round, rings every `ring` metres from 0 to `top`, capped. */
function cylinder(radius: number, top: number, segments: number, ring: number): BodyInput {
  const rings = Math.round(top / ring) + 1;
  const pos: number[] = [];
  for (let r = 0; r < rings; r++) for (let s = 0; s < segments; s++) {
    const a = (2 * Math.PI * s) / segments;
    pos.push(radius * Math.cos(a), r * ring, radius * Math.sin(a));
  }
  const bottom = pos.length / 3; pos.push(0, 0, 0);
  const cap = pos.length / 3; pos.push(0, top, 0);
  const tri: number[] = [];
  for (let r = 0; r + 1 < rings; r++) for (let s = 0; s < segments; s++) {
    const a = r * segments + s, b = r * segments + (s + 1) % segments, c = a + segments, d = b + segments;
    tri.push(a, c, b, b, c, d);
  }
  for (let s = 0; s < segments; s++) {
    tri.push(bottom, s, (s + 1) % segments);
    tri.push(cap, (rings - 1) * segments + (s + 1) % segments, (rings - 1) * segments + s);
  }
  const at = (x: number, y: number, z: number): Vec3 => [x, y, z];
  const joints: BodyJoints = {
    pelvis: at(0, 0.95, 0), chest: at(0, 1.25, 0), neck: at(0, 1.4, 0), head: at(0, 1.5, 0),
    shoulder: [at(0.15, 1.37, 0), at(-0.15, 1.37, 0)], elbow: [at(0.2, 1.12, 0), at(-0.2, 1.12, 0)],
    wrist: [at(0.27, 0.91, 0), at(-0.27, 0.91, 0)], hip: [at(0.1, 0.89, 0), at(-0.1, 0.89, 0)],
    knee: [at(0.1, 0.52, 0), at(-0.1, 0.52, 0)], ankle: [at(0.1, 0.11, 0), at(-0.1, 0.11, 0)],
  };
  return { positions: Float32Array.from(pos), triangles: Uint32Array.from(tri), arm: new Float32Array(pos.length / 3), joints };
}

/** A level outline: a circle of radius r with n points, CCW from +x. */
function circle(r: number, n: number): Float64Array {
  const o = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { o[2 * i] = r * Math.cos((2 * Math.PI * i) / n); o[2 * i + 1] = r * Math.sin((2 * Math.PI * i) / n); }
  return o;
}

describe('measuring a synthetic cylinder', () => {
  const body = cylinder(0.15, 1.6, 64, 0.02);
  const ideal = 2 * Math.PI * 0.15;

  it('stacks a dress form of 64-gons, CCW from their largest x', () => {
    const form = dressForm(body, 0.05, 1.55, 0.1);
    expect(form.y0).toBe(0.05);
    expect(form.step).toBe(0.1);
    expect(form.hulls.length).toBe(16);
    for (const h of form.hulls) {
      // the 64-gon: its corners, and perhaps points the diagonal edges leave on its sides (collinear but for rounding)
      expect(h.length).toBeGreaterThanOrEqual(128);
      for (let i = 0; i < h.length; i += 2) {
        expect(Math.hypot(h[i], h[i + 1])).toBeGreaterThan(0.15 * Math.cos(Math.PI / 64) - 1e-6);
        expect(Math.hypot(h[i], h[i + 1])).toBeLessThan(0.15 + 1e-6);
      }
      expect(Math.abs(perimeter(h) - ideal) / ideal).toBeLessThan(0.01);
      expect(area(h)).toBeGreaterThan(0);
      expect(argMaxX(h)).toBe(0);
      expect(h[0]).toBeCloseTo(0.15, 6);
    }
    // a level exactly on a ring of vertices is still a whole outline
    expect(perimeter(dressForm(body, 0.6, 0.6, 0.1).hulls[0])).toBeCloseTo(perimeter(form.hulls[0]), 6);
    // nothing of her above her head
    expect(dressForm(body, 1.7, 1.7, 0.1).hulls[0].length).toBe(0);
  });

  it('hullAt resamples by angle and blends the two nearest levels', () => {
    const form = dressForm(body, 0.05, 1.55, 0.1);
    const h = hullAt(form, 0.83);
    expect(h.length).toBe(256);
    expect(Math.abs(perimeter(h) - ideal) / ideal).toBeLessThan(0.01);
    expect(area(h)).toBeGreaterThan(0);
    expect(argMaxX(h)).toBe(0);

    // two circles, 0.1 and 0.2 m: a quarter of the way up every point is at 0.125
    const two: DressForm = { y0: 1, step: 0.2, hulls: [circle(0.1, 50), circle(0.2, 80)] };
    const q = hullAt(two, 1.05);
    for (let i = 0; i < 128; i++) expect(Math.hypot(q[2 * i], q[2 * i + 1])).toBeGreaterThan(0.1245 * Math.cos(Math.PI / 50));
    for (let i = 0; i < 128; i++) expect(Math.hypot(q[2 * i], q[2 * i + 1])).toBeLessThan(0.1251);
    expect(area(q)).toBeGreaterThan(0);
    expect(argMaxX(q)).toBe(0);
    // beyond the ends, the end levels; an empty level gives way to its neighbour
    expect(perimeter(hullAt(two, 0.5))).toBeCloseTo(perimeter(hullAt(two, 1)), 9);
    expect(perimeter(hullAt(two, 9))).toBeCloseTo(perimeter(hullAt(two, 1.2)), 9);
    const gap: DressForm = { y0: 0, step: 0.1, hulls: [circle(0.1, 40), new Float64Array(0)] };
    expect(perimeter(hullAt(gap, 0.05))).toBeCloseTo(perimeter(hullAt(gap, 0)), 9);
    expect(hullAt({ y0: 0, step: 0.1, hulls: [new Float64Array(0)] }, 0).length).toBe(0);
  });

  it('the small helpers', () => {
    // a square with points inside and on its edges
    const pts = [1, 1, -1, 1, -1, -1, 1, -1, 0, 0, 0.5, 0.2, 1, 0, 0, 1];
    const h = convexHull2D(pts);
    expect(Array.from(h)).toEqual([1, -1, 1, 1, -1, 1, -1, -1]);
    expect(perimeter(h)).toBe(8);
    expect(perimeter([0, 0])).toBe(0);
    expect(convexHull2D([]).length).toBe(0);

    const segs = sliceTriangles(body.positions, body.triangles, null, 0.71);
    expect(segs.length).toBe(4 * 128); // two triangles per quad, 64 quads round
    for (let i = 0; i < segs.length; i += 2) expect(Math.hypot(segs[i], segs[i + 1])).toBeLessThanOrEqual(0.15 + 1e-6);
    const none = new Uint8Array(body.triangles.length / 3);
    expect(sliceTriangles(body.positions, body.triangles, none, 0.71).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sarah

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const DROP = new Set(['EXT_texture_webp', 'KHR_texture_basisu', 'KHR_texture_transform']);
const MODEL = 'models/sarah-v2-body-slim.glb';
/** Her body mesh, among the file's skinned meshes. */
const BODY_VERTICES = 115710;
/** Skeleton bones that are her arms, shoulder down to the fingertips ([-x side], [+x side]). */
const ARM_BONES: readonly (readonly [number, number])[] = [[9, 32], [34, 57]];
/** Joint bone indices; pairs are [her +x side, her -x side] (bone 9's bind x is NEGATIVE, bone 34's positive). */
const BONES = { pelvis: 1, chest: 4, neck: 5, head: 6, shoulder: [34, 9], elbow: [35, 10], wrist: [36, 11], hip: [63, 58], knee: [64, 59], ankle: [65, 60] } as const;

/** The GLB with its images, textures and samplers removed: the rig and the mesh, nothing that needs a browser to decode. */
function withoutTextures(file: string): ArrayBuffer {
  const buf = readFileSync(join(ROOT, 'public', file));
  const length = buf.readUInt32LE(8);
  let off = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Buffer | null = null;
  while (off < length) {
    const chunkLength = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + chunkLength);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
    else if (type === BIN_CHUNK) bin = data;
    off += 8 + chunkLength;
  }
  if (json === null || bin === null) throw new Error(`${file}: not a GLB`);
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of (json.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
    delete m.extensions;
  }
  const drop = (list: unknown): string[] => ((list as string[] | undefined) ?? []).filter((e) => !DROP.has(e));
  json.extensionsUsed = drop(json.extensionsUsed);
  json.extensionsRequired = drop(json.extensionsRequired);
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  while (text.length % 4 !== 0) text = Buffer.concat([text, Buffer.from(' ')]);
  let body = bin;
  while (body.length % 4 !== 0) body = Buffer.concat([body, Buffer.from([0])]);
  const total = 12 + 8 + text.length + 8 + body.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  out.writeUInt32LE(text.length, 12); out.writeUInt32LE(JSON_CHUNK, 16); text.copy(out, 20);
  const binOff = 20 + text.length;
  out.writeUInt32LE(body.length, binOff); out.writeUInt32LE(BIN_CHUNK, binOff + 4); body.copy(out, binOff + 8);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

function parse(file: string): Promise<THREE.Object3D> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return new Promise((resolve, reject) => { loader.parse(withoutTextures(file), '', (gltf) => resolve(gltf.scene), reject); });
}

/** Geometry units to rest metres. */
const rest = (x: number, y: number, z: number): Vec3 =>
  [x * FACE_REST_SCALE + FACE_REST_OFFSET[0], y * FACE_REST_SCALE + FACE_REST_OFFSET[1], z * FACE_REST_SCALE + FACE_REST_OFFSET[2]];

/** Her body as the garment generator reads it, at 0% belly. */
function sarahInput(scene: THREE.Object3D): BodyInput {
  let mesh: THREE.SkinnedMesh | null = null;
  scene.traverse((node) => {
    const m = node as THREE.SkinnedMesh;
    if (m.isSkinnedMesh === true && m.geometry.getAttribute('position').count === BODY_VERTICES) mesh = m;
  });
  if (mesh === null) throw new Error(`${MODEL}: no skinned mesh of ${BODY_VERTICES} vertices`);
  const body: THREE.SkinnedMesh = mesh;
  const g = body.geometry;
  const pos = g.getAttribute('position');
  const belly = g.morphAttributes.position![body.morphTargetDictionary!.belly];
  const n = pos.count;
  const positions = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) positions.set(rest(pos.getX(i) + belly.getX(i), pos.getY(i) + belly.getY(i), pos.getZ(i) + belly.getZ(i)), 3 * i);
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const arm = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) {
    const b = si.getComponent(i, j);
    if (ARM_BONES.some(([lo, hi]) => b >= lo && b <= hi)) arm[i] += sw.getComponent(i, j);
  }
  // A bone's origin in her rest frame: inverse(boneInverse) carried by inverse(bindMatrix) (never bindMatrixInverse,
  // which follows the mesh's world matrix in attached mode).
  const unbind = body.bindMatrix.clone().invert();
  const joint = (i: number): Vec3 => {
    const p = new THREE.Vector3().setFromMatrixPosition(body.skeleton.boneInverses[i].clone().invert().premultiply(unbind));
    return rest(p.x, p.y, p.z);
  };
  const pair = (k: readonly [number, number]): [Vec3, Vec3] => [joint(k[0]), joint(k[1])];
  const joints: BodyJoints = {
    pelvis: joint(BONES.pelvis), chest: joint(BONES.chest), neck: joint(BONES.neck), head: joint(BONES.head),
    shoulder: pair(BONES.shoulder), elbow: pair(BONES.elbow), wrist: pair(BONES.wrist),
    hip: pair(BONES.hip), knee: pair(BONES.knee), ankle: pair(BONES.ankle),
  };
  return { positions, triangles: Uint32Array.from(g.index!.array as ArrayLike<number>), arm, joints };
}

describe('measuring Sarah', () => {
  let input: BodyInput;
  let m: BodyMeasure;
  let ms = 0;

  beforeAll(async () => {
    input = sarahInput(await parse(MODEL));
    const t = performance.now();
    m = measureBody(input);
    ms = performance.now() - t;
    const cm = (v: number): string => (v * 100).toFixed(1);
    const p3 = (v: Vec3): string => `(${v.map((c) => c.toFixed(3)).join(', ')})`;
    const g = (name: string, v: { y: number; girth: number }): string => `${name.padEnd(10)} ${cm(v.girth).padStart(6)} cm at y ${v.y.toFixed(3)}`;
    const lines = [
      `measureBody: ${ms.toFixed(0)} ms (${input.positions.length / 3} vertices, ${input.triangles.length / 3} triangles)`,
      `height     ${m.height.toFixed(3)} m   knee y ${m.kneeY.toFixed(3)}`,
      g('bust', m.bust), g('underbust', m.underbust), g('waist', m.waist), g('high hip', m.highHip), g('hip', m.hip), g('thigh', m.thigh),
      `neck       ${cm(m.neck.girth).padStart(6)} cm   side ${p3(m.neck.side[0])} ${p3(m.neck.side[1])}`,
      `           front ${p3(m.neck.front)} back ${p3(m.neck.back)}`,
      `shoulder   ${p3(m.shoulderPoint[0])} ${p3(m.shoulderPoint[1])}`,
      `armpit     ${p3(m.armpit[0])} ${p3(m.armpit[1])}`,
      ...m.arms.map((a, k) => `arm ${k ? '-x' : '+x'}     outside ${cm(a.outsideLength)} cm, inside ${cm(a.insideLength)} cm; girths t=0..1 by 0.05 (cm): ${a.girths.map(cm).join(' ')}`),
      `form       ${m.form.hulls.length} levels from ${m.form.y0} every ${m.form.step} m`,
    ];
    console.log(lines.join('\n'));
  }, 60000);

  it('her joints are where her rig puts them', () => {
    const J = input.joints;
    const near = (a: Vec3, b: readonly number[], tol = 0.01): void => { for (let i = 0; i < b.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(tol); };
    near(J.shoulder[0], [0.15, 1.371, -0.116]); near(J.shoulder[1], [-0.15, 1.371, -0.116]);
    near(J.elbow[0], [0.21, 1.119]); near(J.elbow[1], [-0.21, 1.119]);
    near(J.wrist[0], [0.28, 0.913]); near(J.wrist[1], [-0.28, 0.913]);
    near(J.hip[0], [0.10, 0.887]); near(J.hip[1], [-0.10, 0.887]);
    near(J.knee[0], [0.10, 0.521]); near(J.knee[1], [-0.10, 0.521]);
    near(J.neck, [0, 1.411]); near(J.chest, [0, 1.285]); near(J.pelvis, [0, 1.019]);
  });

  it('measures in well under the time a room can wait', () => {
    expect(ms).toBeLessThan(3000); // about 0.4 s on the dev box; the budget is 1.5 s, the slack is for CI
  });

  it('her height, girths and landmarks land where a woman of her build has them', () => {
    expect(m.height).toBeGreaterThan(1.69); expect(m.height).toBeLessThan(1.71);
    for (const a of m.armpit) { expect(a[1]).toBeGreaterThan(1.22); expect(a[1]).toBeLessThan(1.27); }
    expect(Math.abs(m.armpit[0][1] - m.armpit[1][1])).toBeLessThan(0.01);
    const band = (v: number, lo: number, hi: number): void => { expect(v).toBeGreaterThanOrEqual(lo); expect(v).toBeLessThanOrEqual(hi); };
    band(m.bust.girth, 0.90, 1.00); band(m.bust.y, 1.25, 1.31);
    band(m.underbust.girth, 0.70, 0.80); expect(m.underbust.y).toBeLessThan(m.bust.y - 0.03);
    band(m.waist.girth, 0.68, 0.78); band(m.waist.y, 1.08, 1.18); expect(m.waist.y).toBeLessThan(m.underbust.y);
    band(m.hip.girth, 1.00, 1.10); band(m.hip.y, 0.82, 0.94);
    band(m.highHip.y, m.hip.y, m.waist.y); band(m.highHip.girth, m.waist.girth, m.hip.girth);
    band(m.thigh.girth, 0.45, 0.65); expect(m.thigh.y).toBeLessThan(m.hip.y);
    // The neck girth is the trunk round the plane through her four neck points (front 4.5 cm under the side points, back
    // 1 cm over): it reads 0.47 m on her, the same as the level outline at the neck base. Wider than a tailor's neck base,
    // because the side points sit on the slope of her shoulders; pinned here as measured.
    band(m.neck.girth, 0.40, 0.50);
    for (const [k, s] of [[0, 1], [1, -1]] as const) {
      band(m.neck.side[k][0] * s, 0.06, 0.09); band(m.neck.side[k][1], 1.40, 1.46);
      band(m.shoulderPoint[k][0] * s, 0.15, 0.20); band(m.shoulderPoint[k][1], 1.37, 1.43);
    }
    expect(m.neck.front[1]).toBeLessThan(m.neck.side[0][1]); expect(m.neck.back[1]).toBeGreaterThan(m.neck.side[0][1]);
    expect(m.neck.front[2]).toBeGreaterThan(m.neck.back[2] + 0.06);
    for (const a of m.arms) {
      expect(a.girths.length).toBe(21);
      band(Math.max(...a.girths.slice(3, 7)), 0.22, 0.32); // her upper arm, t = 0.15 to 0.3
      band(a.girths[20], 0.13, 0.18); // her wrist
      for (const g of a.girths) band(g, 0.12, 0.30);
      expect(a.outsideLength).toBeGreaterThan(a.insideLength);
      band(a.outsideLength, 0.45, 0.60);
    }
    expect(m.kneeY).toBeCloseTo(0.521, 2);
  });

  it('left and right agree within 1.5 cm', () => {
    const mirror = (a: Vec3, b: Vec3): void => {
      expect(Math.abs(a[0] + b[0])).toBeLessThan(0.015);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(0.015);
      expect(Math.abs(a[2] - b[2])).toBeLessThan(0.015);
    };
    mirror(m.armpit[0], m.armpit[1]);
    mirror(m.neck.side[0], m.neck.side[1]);
    mirror(m.shoulderPoint[0], m.shoulderPoint[1]);
    const [a, b] = m.arms;
    for (let i = 0; i < 21; i++) expect(Math.abs(a.girths[i] - b.girths[i]), `girth ${i}`).toBeLessThan(0.015);
    expect(Math.abs(a.outsideLength - b.outsideLength)).toBeLessThan(0.015);
    expect(Math.abs(a.insideLength - b.insideLength)).toBeLessThan(0.015);
  });

  it('her dress form agrees with the girths taken off it', () => {
    const f = m.form;
    expect(f.hulls.length).toBeGreaterThan(160);
    for (const h of f.hulls) if (h.length > 0) { expect(area(h)).toBeGreaterThan(0); expect(argMaxX(h)).toBe(0); }
    for (const girth of [m.bust, m.waist, m.hip]) {
      expect(Math.abs(perimeter(hullAt(f, girth.y)) - girth.girth)).toBeLessThan(0.015);
    }
    // the exported dressForm is the same form
    const again = dressForm(input, f.y0, f.y0 + 10 * f.step, f.step);
    for (let i = 0; i <= 10; i++) expect(Array.from(again.hulls[i])).toEqual(Array.from(f.hulls[i]));
  });
});
