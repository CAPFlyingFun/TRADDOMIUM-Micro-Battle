/**
 * A TREE, AS TRIANGLES — TMB's own, in centimetres.
 *
 * WHAT IS REUSED, and from where. The shape of this is Thronemound's
 * tree.ts, read as a reference: a tree is a list of LIMBS (a line with
 * a radius at each end), the trunk wanders rather than standing like a
 * pipe, boughs climb in a golden spiral and sweep up as they go out,
 * and every detail level is a different tessellation of the SAME wood
 * so a swap cannot change the silhouette. Its two hard-won rules are
 * kept: consecutive limbs are skinned as ONE tube with shared rings
 * (separate tubes open a wedge at every bend), and the drawn polygon
 * circumscribes the limb's circle rather than sitting inside it.
 *
 * WHAT IS NOT. Thronemound's tree is a thing she climbs, at 1:1000,
 * with a 64-sided near level, six photographed barks with normal maps
 * and a collision profile baked from the same skeleton. None of that
 * is this. At TMB's scale she FLIES PAST these at three metres and
 * never touches one — there is no solid to collide with and no bark
 * she is close enough to read — so this is two levels, twelve and six
 * sides, flat vertex colour, no textures, no twigs, and it is written
 * for the instanced stand from the start: one baked geometry per
 * level, scaled and spun per tree by its matrix.
 *
 * Everything here is in WORLD UNITS (centimetres). The bake below
 * normalises to one unit tall so an instance matrix carries the size.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface TreeSpec {
  /** Ground to the highest leaf, world units. */
  readonly height: number;
  /** Trunk diameter at the foot, world units. */
  readonly girth: number;
  /** The same seed is the same tree, always. */
  readonly seed: number;
  /** Trunk sections. A tall tree wants a dozen to bend convincingly. */
  readonly rings?: number;
  readonly boughs?: number;
}

/** One tapered section of wood. */
export interface Limb {
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  readonly ra: number;
  readonly rb: number;
  /** 0 for the trunk, 1 for a bough. */
  readonly order: number;
}

/** A cluster of leaves: a centre and a radius. */
export interface Tuft {
  readonly at: THREE.Vector3;
  readonly r: number;
}

export interface TreeParts {
  readonly limbs: Limb[];
  readonly tufts: Tuft[];
}

/** Where the boughs begin, as a fraction of the height. */
export const LOWEST_BOUGH = 0.42;
/** The leader's tip radius, world units — a fixed small circle, not a fraction. */
const TIP_RADIUS = 2;

/** Deterministic noise. `Math.random` would make every reload a different tree. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Some unit vector not parallel to `v`. */
function anyPerp(v: THREE.Vector3, into: THREE.Vector3): THREE.Vector3 {
  into.set(v.z, v.x, v.y);
  into.addScaledVector(v, -into.dot(v));
  if (into.lengthSq() < 1e-9) into.set(1, 0, 0).addScaledVector(v, -v.x);
  return into.normalize();
}

/**
 * The tree's skeleton, before anything is drawn.
 *
 * Separate from the mesh so it can be checked without a renderer, and
 * so both detail levels are tessellations of the same wood.
 */
export function growTree(spec: TreeSpec): TreeParts {
  const rand = rng(spec.seed);
  const limbs: Limb[] = [];
  const tufts: Tuft[] = [];
  const baseR = spec.girth / 2;
  const tipR = Math.min(TIP_RADIUS, baseR * 0.5);
  const RINGS = Math.max(3, spec.rings ?? 12);

  // THE TRUNK WANDERS — a slow curve, not noise per segment.
  const leanX = (rand() - 0.5) * spec.height * 0.05;
  const leanZ = (rand() - 0.5) * spec.height * 0.05;
  const phase = rand() * Math.PI * 2;
  const axis: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    // Widest at the foot, thinning fast out of the flare, then slowly,
    // and landing on a fixed small circle at the tip.
    const flare = 1 + 0.28 * Math.exp(-t * 18);
    const shape = (1 - t) ** 1.35;
    radii.push(tipR + (baseR * flare - tipR) * shape);
    const bend = t * t;
    axis.push(new THREE.Vector3(
      leanX * bend + Math.sin(t * 3.1 + phase) * baseR * 0.35,
      t * spec.height,
      leanZ * bend + Math.cos(t * 2.6 + phase) * baseR * 0.35,
    ));
  }
  for (let i = 0; i < RINGS; i++) {
    limbs.push({ a: axis[i], b: axis[i + 1], ra: radii[i], rb: radii[i + 1], order: 0 });
  }

  // BOUGHS climb in a golden spiral, each shorter and steeper than the
  // last, and sweep up as they go out.
  const BOUGHS = Math.max(1, spec.boughs ?? 9);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < BOUGHS; i++) {
    const t = LOWEST_BOUGH + (BOUGHS > 1 ? i / (BOUGHS - 1) : 0) * 0.54;
    const ring = Math.min(RINGS - 1, Math.floor(t * RINGS));
    const root = axis[ring];
    const trunkR = radii[ring];
    const spin = i * GOLDEN + phase;
    dir.set(Math.cos(spin), 0.22 + rand() * 0.18, Math.sin(spin)).normalize();
    const len = spec.height * (0.20 - 0.11 * t) * (0.8 + rand() * 0.4);
    let here = root.clone().addScaledVector(dir, trunkR * 0.8);
    let r = trunkR * (0.42 - 0.12 * t);
    const SEGS = 3;
    for (let s = 0; s < SEGS; s++) {
      const u = (s + 1) / SEGS;
      const along = dir.clone().addScaledVector(up, 0.55 * u * u).normalize();
      const next = here.clone().addScaledVector(along, len / SEGS);
      const rNext = r * (1 - u) ** 0.9 + r * 0.06;
      limbs.push({ a: here, b: next, ra: r, rb: rNext, order: 1 });
      here = next;
      r = rNext;
    }
    tufts.push({ at: here.clone(), r: len * 0.42 });
  }
  // A crown on the leader, so the top is foliage and not a cut pole.
  tufts.push({ at: axis[RINGS].clone(), r: spec.height * 0.07 });
  return { limbs, tufts };
}

/** What one detail level bothers to draw. */
export interface Detail {
  /** Sides round a limb. */
  readonly sides: number;
  /** Highest limb order drawn: 0 trunk only, 1 boughs too. */
  readonly order: number;
  /** Leaf blob tessellation: 0 is the coarsest icosahedron. */
  readonly leaf: number;
}

/**
 * The two levels. Twelve sides up close — at three metres a twelve-gon
 * sixty centimetres across has facets a body length wide, which is the
 * coarsest the eye forgives. Six sides and the trunk alone past that.
 */
export const DETAILS: readonly Detail[] = [
  { sides: 12, order: 1, leaf: 1 },
  { sides: 6, order: 0, leaf: 0 },
];

const BARK = new THREE.Color(0x4a3622);
const LEAF = new THREE.Color(0x3d7a2c);

/** Skin the limbs at one detail level into one indexed geometry. */
function skin(limbs: readonly Limb[], d: Detail, tint: THREE.Color): THREE.BufferGeometry {
  const used = limbs.filter((l) => l.order <= d.order);
  // CHAINS, NOT LIMBS: a run where each one's far end IS the next one's
  // near end is one tube with one ring at each joint.
  const chains: Limb[][] = [];
  let run: Limb[] = [];
  for (const limb of used) {
    if (run.length > 0 && run[run.length - 1].b === limb.a) run.push(limb);
    else { if (run.length > 0) chains.push(run); run = [limb]; }
  }
  if (run.length > 0) chains.push(run);

  // The drawn polygon CIRCUMSCRIBES the limb's circle.
  const fatten = 1 / Math.cos(Math.PI / d.sides);
  let ringCount = 0;
  let spanCount = 0;
  for (const chain of chains) { ringCount += chain.length + 1; spanCount += chain.length; }
  const stride = d.sides + 1;
  const pos = new Float32Array(ringCount * stride * 3);
  const nrm = new Float32Array(ringCount * stride * 3);
  const uv = new Float32Array(ringCount * stride * 2);
  const col = new Float32Array(ringCount * stride * 3);
  const idx = new Uint32Array(spanCount * d.sides * 6);

  const tangent = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const radial = new THREE.Vector3();
  let p = 0;
  let f = 0;
  for (const chain of chains) {
    const pts: THREE.Vector3[] = [chain[0].a.clone()];
    const rad: number[] = [chain[0].ra];
    for (const limb of chain) { pts.push(limb.b.clone()); rad.push(limb.rb); }
    // The foot overruns into the ground and a bough's foot into the
    // trunk, so no join shows. Radius carried along the same slope.
    const footSpan = pts[0].distanceTo(pts[1]);
    const back = Math.min(rad[0] * 0.9, footSpan * 0.4);
    tangent.copy(pts[1]).sub(pts[0]).normalize();
    pts[0].addScaledVector(tangent, -back);
    const last = pts.length - 1;
    const firstRing = p;
    for (let i = 0; i <= last; i++) {
      if (i === 0) tangent.copy(pts[1]).sub(pts[0]).normalize();
      else if (i === last) tangent.copy(pts[last]).sub(pts[last - 1]).normalize();
      else tangent.copy(pts[i + 1]).sub(pts[i - 1]).normalize();
      if (i === 0) {
        anyPerp(tangent, u);
      } else {
        // Parallel transport: turn the last frame by the bend, so the
        // ring never twists against its neighbour.
        turn.setFromUnitVectors(prevTangent, tangent);
        u.applyQuaternion(turn);
        u.addScaledVector(tangent, -u.dot(tangent)).normalize();
      }
      v.crossVectors(tangent, u).normalize();
      prevTangent.copy(tangent);
      const r = rad[i] * fatten;
      for (let k = 0; k <= d.sides; k++) {
        const a = (k / d.sides) * Math.PI * 2;
        radial.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        const at = p * 3;
        pos[at] = pts[i].x + radial.x * r;
        pos[at + 1] = pts[i].y + radial.y * r;
        pos[at + 2] = pts[i].z + radial.z * r;
        nrm[at] = radial.x; nrm[at + 1] = radial.y; nrm[at + 2] = radial.z;
        uv[p * 2] = k / d.sides;
        uv[p * 2 + 1] = i;
        col[at] = tint.r; col[at + 1] = tint.g; col[at + 2] = tint.b;
        p++;
      }
    }
    for (let i = 0; i < last; i++) {
      for (let k = 0; k < d.sides; k++) {
        const a = firstRing + i * stride + k;
        const b = a + 1;
        const c = a + stride;
        const e = c + 1;
        idx[f++] = a; idx[f++] = c; idx[f++] = b;
        idx[f++] = b; idx[f++] = c; idx[f++] = e;
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** The leaves as blobs, tinted, in one geometry. */
function leaves(tufts: readonly Tuft[], detail: number, tint: THREE.Color): THREE.BufferGeometry | null {
  if (tufts.length === 0) return null;
  const blobs = tufts.map((tuft) => {
    const blob = new THREE.IcosahedronGeometry(tuft.r, detail);
    blob.translate(tuft.at.x, tuft.at.y, tuft.at.z);
    const n = blob.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
    blob.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return blob;
  });
  const merged = mergeGeometries(blobs, false);
  for (const blob of blobs) blob.dispose();
  return merged;
}

/**
 * Bake a whole tree — wood and leaves — into ONE geometry at one detail
 * level, coloured by vertex so a stand is one material and one draw.
 */
export function bakeTree(spec: TreeSpec, level: number): THREE.BufferGeometry {
  const parts = growTree(spec);
  const d = DETAILS[Math.min(DETAILS.length - 1, Math.max(0, level))];
  const rand = rng(spec.seed ^ 0x51ee);
  // A little variation per bake, so two stands are not one colour.
  const bark = BARK.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.08);
  const leaf = LEAF.clone().offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.1);
  const wood = skin(parts.limbs, d, bark).toNonIndexed();
  const green = leaves(parts.tufts, d.leaf, leaf);
  const out = green ? mergeGeometries([wood, green], false) : wood;
  if (green) { wood.dispose(); green.dispose(); }
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Triangles in a geometry, indexed or not. */
export function triangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

/**
 * A UNIT TREE for an instanced stand: baked at a representative size,
 * then divided down to one unit tall so an instance matrix carries the
 * whole of its size. Uniform scale — the bake already has the right
 * girth-to-height ratio and owes nothing more.
 */
export function bakeUnitTree(
  height: number, girthOfHeight: number, seed: number, level: number,
): THREE.BufferGeometry {
  const geo = bakeTree({ height, girth: height * girthOfHeight, seed }, level);
  geo.scale(1 / height, 1 / height, 1 / height);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/** The material a stand is drawn with: matte, lit, coloured by vertex. */
export function treeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    fog: true,
  });
}
