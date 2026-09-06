/**
 * A TREE, AS TRIANGLES — v0's bake, carried into v1 and taught three
 * silhouettes.
 *
 * WHAT IS PORTED, AND FROM WHERE. This is `legacy/v0-main:src/world/
 * treeMesh.ts`, re-added for Phase 6 (ARCHITECTURE §11) after the review
 * §2 asks for. Its algorithm is kept EXACTLY: a tree is a list of LIMBS
 * (a line with a radius at each end), the trunk wanders in one slow
 * curve rather than standing like a pipe, boughs climb in a golden
 * spiral and sweep up as they go out, and each detail level is a
 * different tessellation of the SAME wood so a swap cannot change the
 * silhouette. Its two hard-won rules are kept: consecutive limbs are
 * skinned as ONE tube with shared rings (separate tubes open a wedge at
 * every bend), and the drawn polygon circumscribes the limb's circle
 * rather than sitting inside it. So is its fix: the outside faces OUT,
 * and the test reads the winding and the normals against each other
 * because either alone let the inside-out tree through.
 *
 * The two levels are v0's two — twelve sides, boughs and icosahedron(1)
 * leaves near; six sides, trunk only and icosahedron(0) far — and v0's
 * MEASURED cost of them holds unchanged: 1,736 triangles near and 344
 * far for its 26 m reference tree. `tests/floraTreeGeometry.test.ts`
 * pins those two numbers exactly, because they are the proof that the
 * algorithm came across intact rather than approximately.
 *
 * WHAT CHANGED, AND WHY.
 *
 *  - The noise is `world/random.ts`'s mulberry32, not a private copy.
 *    v0's `rng` WAS mulberry32, constant for constant, so the same seed
 *    still grows the same skeleton; the copy is gone because ONE COPY is
 *    that file's whole point.
 *
 *  - A `shape`. v0 grew one tree. Kauaʻi's cover is not one tree: the
 *    land-cover raster (`world/landcover.ts`) says tree, shrub and
 *    wetland, and the coast wants a palm. `broad` is v0's tree
 *    unchanged and the default; `scrub` is the same skeleton with five
 *    boughs from three tenths of the way up, reaching further out than
 *    up, under a crown wider than it is tall — a 3–8 m bush-tree; `palm`
 *    is a bare leaning trunk with one flattened crown of leaves and no
 *    limb tube above the trunk at all. Each is a row in `SHAPE_PROFILES`
 *    rather than a branch in the code, so a fourth silhouette is a row.
 *
 *  - `height` MEANS height. v0's `TreeSpec` said "ground to the highest
 *    leaf", and its leader tip sat at `height` with a crown tuft poking
 *    seven percent above it — its own test allowed 1.12. Here the
 *    skeleton is grown twice: once to measure where its highest leaf
 *    lands, again at the height that puts that leaf on `spec.height`.
 *    The unit bake is therefore one unit tall TO ITS TOP LEAF, so a stand
 *    that scales an instance by twenty metres gets a twenty-metre tree.
 *
 *  - The foot's overrun into the ground is CAPPED at 1.5% of the height.
 *    v0 sank the foot by up to nine tenths of its own radius, which for a
 *    stout trunk is more than the unit contract (0 ± 0.02) allows; the
 *    join it hides is hidden as well by less.
 *
 *  - Vertex colour on the WOOD as well as the leaves, and Lambert rather
 *    than Standard. v0's wood was flat brown waiting for a bark
 *    photograph and its normal map (`wearBark`, `BARK_TILE`). No bark
 *    ships in this milestone, the terrain is Lambert with vertex colour,
 *    and a tree should cost what the ground under it costs. The UVs
 *    STAY — u once round the trunk, v up the wood at the same rate, in
 *    foot circumferences — so a bark texture later is a material change
 *    and not a geometry one.
 *
 *  - The leaf blobs are written straight into one buffer from a single
 *    unit icosahedron, instead of one `IcosahedronGeometry` per tuft
 *    merged through `BufferGeometryUtils`. Same triangles, one
 *    allocation, and no example-module import to carry.
 *
 * WHAT THIS IS NOT. Thronemound's tree is a thing an ant climbs, with a
 * 64-sided near level and a collision profile; v0's header says why none
 * of that is here — at three metres she flies PAST these and touches
 * none of them. `growTree` stays exported so a solid, a dev tool or a
 * test can read the skeleton without a renderer.
 *
 * `src/flora/` is a RENDERER directory, like `sea/` and `terrain/`: it
 * may import three. It touches no world coordinate — everything here is
 * in the tree's own space, foot at the origin, +y up, world units
 * (centimetres) until the unit bake divides them out — and it imports
 * nothing from actor/, view/, session/, ui/ or net/.
 */
import * as THREE from 'three';
import { mulberry32 } from '../world/random';

/** The three silhouettes. `broad` is v0's tree and the default. */
export type TreeShape = 'broad' | 'scrub' | 'palm';

export const TREE_SHAPES: readonly TreeShape[] = Object.freeze(['broad', 'scrub', 'palm']);

export interface TreeSpec {
  /** Ground to the highest leaf, world units. Exactly — see the header. */
  readonly height: number;
  /** Trunk diameter at the foot, world units. */
  readonly girth: number;
  /** The same seed is the same tree, always. */
  readonly seed: number;
  /** Which silhouette. Defaults to `broad`. */
  readonly shape?: TreeShape;
  /** Trunk sections. A tall tree wants a dozen to bend convincingly. */
  readonly rings?: number;
  /** Bough count. Ignored by `palm`, which has none by definition. */
  readonly boughs?: number;
}

/** One tapered section of wood. */
export interface Limb {
  readonly a: THREE.Vector3;
  readonly b: THREE.Vector3;
  readonly ra: number;
  readonly rb: number;
  /**
   * How far along the wood this limb STARTS, world units — the bark's v
   * coordinate. Measured along the limbs rather than as height, so the
   * grain does not stretch where a bough leans out.
   */
  readonly run: number;
  /** 0 for the trunk, 1 for a bough. */
  readonly order: number;
}

/** A cluster of leaves: a centre, a radius, and how flat it is. */
export interface Tuft {
  readonly at: THREE.Vector3;
  readonly r: number;
  /**
   * Vertical scale of the blob: 1 is v0's sphere, less is a lens. A palm
   * crown is fronds arching out and drooping, which from thirty metres
   * is a disc and not a ball.
   */
  readonly squash: number;
}

export interface TreeParts {
  readonly limbs: Limb[];
  readonly tufts: Tuft[];
}

/**
 * What makes one silhouette differ from another — every number v0 had
 * inline, lifted into a row so a shape is data. `broad` is v0's row
 * verbatim; the other two are GAME TUNING, chosen for how they read at
 * three metres and on the horizon, and they are not measured biology.
 */
export interface ShapeProfile {
  /** Default bough count. 0 means a bare trunk. */
  readonly boughs: number;
  /** Where the boughs begin, as a fraction of the height. */
  readonly lowestBough: number;
  /** How far up from there the boughs climb, as a fraction of the height. */
  readonly boughClimb: number;
  /** Bough length as a fraction of the height: `[base, slope]` in `base - slope * t`. */
  readonly reach: readonly [number, number];
  /** A bough's initial upward component: `[least, spread]`, the spread drawn per bough. */
  readonly rise: readonly [number, number];
  /** How hard a bough curls upward toward its tip. */
  readonly sweep: number;
  /** A bough-tip tuft's radius as a fraction of the bough's length. */
  readonly tuftOfReach: number;
  /** The leader's crown tuft radius as a fraction of the height. */
  readonly crown: number;
  /** The crown tuft's vertical scale. */
  readonly crownSquash: number;
  /** Basal flare: how much wider than the nominal girth the foot is. */
  readonly flare: number;
  /**
   * Tip radius floor as a fraction of the base radius. 0 is v0's rule
   * (a fixed 2 cm circle); a palm keeps most of its girth to the top.
   */
  readonly tipOfBase: number;
  /** How far the trunk leans, as a fraction of the height, either way. */
  readonly lean: number;
  /** The height a unit tree is grown at, world units, for its proportions. */
  readonly bakeHeight: number;
  /** The foot's diameter at that height, as a fraction of the height. */
  readonly girthOfHeight: number;
  /** The foliage's base green, before the seed tints it. */
  readonly leaf: number;
  /** The bark's base brown, before the seed tints it. */
  readonly bark: number;
}

/**
 * The rows. `broad` is v0's tree with v0's stand numbers behind it —
 * a 24 m bake with a 4% girth (`LandmarkStand.BAKE_HEIGHT`,
 * `landmarks.GIRTH_OF_HEIGHT`) and v0's leaf green and bark brown.
 *
 * `scrub` reaches further out than up: boughs from 0.30 rather than
 * 0.42, a third of the height long rather than a fifth, rising less and
 * curling less, so the crown is a rounder, wider mass — and a fuller top
 * tuft, because a bush has no leader to speak of.
 *
 * `palm` keeps seven tenths of its girth to the top, barely flares, leans
 * up to fifteen percent of its height, and carries ONE crown a fifth of
 * its height in radius squashed to a lens. A coconut palm is 25–35 cm
 * across on 15–25 m of trunk with a crown six to eight metres wide;
 * these ratios are that, rounded.
 */
export const SHAPE_PROFILES: Readonly<Record<TreeShape, ShapeProfile>> = Object.freeze({
  broad: {
    boughs: 9, lowestBough: 0.42, boughClimb: 0.54,
    reach: [0.20, 0.11], rise: [0.22, 0.18], sweep: 0.55, tuftOfReach: 0.42,
    crown: 0.07, crownSquash: 1,
    flare: 0.28, tipOfBase: 0, lean: 0.05,
    bakeHeight: 2_400, girthOfHeight: 0.04,
    leaf: 0x3d7a2c, bark: 0x6b5744,
  },
  scrub: {
    boughs: 5, lowestBough: 0.30, boughClimb: 0.45,
    reach: [0.32, 0.12], rise: [0.08, 0.16], sweep: 0.30, tuftOfReach: 0.50,
    crown: 0.10, crownSquash: 0.8,
    flare: 0.28, tipOfBase: 0, lean: 0.08,
    bakeHeight: 500, girthOfHeight: 0.06,
    leaf: 0x4a7d2e, bark: 0x5e4a38,
  },
  palm: {
    boughs: 0, lowestBough: 0, boughClimb: 0,
    reach: [0, 0], rise: [0, 0], sweep: 0, tuftOfReach: 0,
    crown: 0.20, crownSquash: 0.55,
    flare: 0.12, tipOfBase: 0.7, lean: 0.30,
    bakeHeight: 1_500, girthOfHeight: 0.022,
    leaf: 0x4f8a34, bark: 0x8a7a62,
  },
});

/** phi. The icosahedron is built on it, and so is the spin that puts a vertex on its pole. */
const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

/** The leader's tip radius, world units — a fixed small circle, not a fraction (v0). */
const TIP_RADIUS = 2;

/**
 * How far the foot may be sunk below the ground, as a fraction of the
 * height. The overrun hides the join between trunk and ground on a
 * slope; 1.5% keeps it inside the unit contract's tolerance with room
 * for the tilt of the foot ring.
 */
const FOOT_CAP_OF_HEIGHT = 0.015;

/** Some unit vector not parallel to `v`. */
function anyPerp(v: THREE.Vector3, into: THREE.Vector3): THREE.Vector3 {
  into.set(v.z, v.x, v.y);
  into.addScaledVector(v, -into.dot(v));
  if (into.lengthSq() < 1e-9) into.set(1, 0, 0).addScaledVector(v, -v.x);
  return into.normalize();
}

/** The skeleton's highest point: a tuft's top, or the leader's tip if it is bare. */
function skeletonTop(parts: TreeParts): number {
  let top = 0;
  for (const limb of parts.limbs) top = Math.max(top, limb.a.y, limb.b.y);
  for (const tuft of parts.tufts) top = Math.max(top, tuft.at.y + tuft.r * tuft.squash);
  return top;
}

/**
 * v0's `growTree`, with the leader's tip at `h` and the profile's numbers
 * where v0's constants were. The random draws are taken in v0's order,
 * and none of them depends on `h` — which is what lets `growTree` call
 * this twice with the same seed and get the same tree at a different
 * size.
 */
function grow(spec: TreeSpec, profile: ShapeProfile, h: number): TreeParts {
  const rand = mulberry32(spec.seed >>> 0);
  const limbs: Limb[] = [];
  const tufts: Tuft[] = [];
  const baseR = spec.girth / 2;
  const tipR = Math.max(Math.min(TIP_RADIUS, baseR * 0.5), baseR * profile.tipOfBase);
  const RINGS = Math.max(3, spec.rings ?? 12);

  // THE TRUNK WANDERS — a slow curve, not noise per segment.
  const leanX = (rand() - 0.5) * h * profile.lean;
  const leanZ = (rand() - 0.5) * h * profile.lean;
  const phase = rand() * Math.PI * 2;
  const axis: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    // Widest at the foot, thinning fast out of the flare, then slowly,
    // and landing on the tip circle.
    const flare = 1 + profile.flare * Math.exp(-t * 18);
    const shape = (1 - t) ** 1.35;
    radii.push(tipR + (baseR * flare - tipR) * shape);
    const bend = t * t;
    axis.push(new THREE.Vector3(
      leanX * bend + Math.sin(t * 3.1 + phase) * baseR * 0.35,
      t * h,
      leanZ * bend + Math.cos(t * 2.6 + phase) * baseR * 0.35,
    ));
  }
  let run = 0;
  for (let i = 0; i < RINGS; i++) {
    limbs.push({
      a: axis[i], b: axis[i + 1], ra: radii[i], rb: radii[i + 1], run, order: 0,
    });
    run += axis[i].distanceTo(axis[i + 1]);
  }

  // BOUGHS climb in a golden spiral, each shorter and steeper than the
  // last, and sweep up as they go out. A palm has none.
  const BOUGHS = profile.boughs === 0 ? 0 : Math.max(1, spec.boughs ?? profile.boughs);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  for (let i = 0; i < BOUGHS; i++) {
    const t = profile.lowestBough + (BOUGHS > 1 ? i / (BOUGHS - 1) : 0) * profile.boughClimb;
    const ring = Math.min(RINGS - 1, Math.floor(t * RINGS));
    const root = axis[ring];
    const trunkR = radii[ring];
    const spin = i * GOLDEN + phase;
    dir.set(Math.cos(spin), profile.rise[0] + rand() * profile.rise[1], Math.sin(spin)).normalize();
    const len = h * (profile.reach[0] - profile.reach[1] * t) * (0.8 + rand() * 0.4);
    let here = root.clone().addScaledVector(dir, trunkR * 0.8);
    let r = trunkR * (0.42 - 0.12 * t);
    const SEGS = 3;
    let ran = t * h;
    for (let s = 0; s < SEGS; s++) {
      const u = (s + 1) / SEGS;
      const along = dir.clone().addScaledVector(up, profile.sweep * u * u).normalize();
      const next = here.clone().addScaledVector(along, len / SEGS);
      const rNext = r * (1 - u) ** 0.9 + r * 0.06;
      limbs.push({ a: here, b: next, ra: r, rb: rNext, run: ran, order: 1 });
      ran += len / SEGS;
      here = next;
      r = rNext;
    }
    tufts.push({ at: here.clone(), r: len * profile.tuftOfReach, squash: 1 });
  }
  // A crown on the leader, so the top is foliage and not a cut pole.
  tufts.push({ at: axis[RINGS].clone(), r: h * profile.crown, squash: profile.crownSquash });
  return { limbs, tufts };
}

/**
 * The tree's skeleton, before anything is drawn.
 *
 * Separate from the mesh so it can be checked without a renderer, and so
 * both detail levels are tessellations of the same wood.
 *
 * GROWN TWICE, so that `spec.height` is where the highest leaf lands and
 * not where the leader's tip does. The first pass measures how far above
 * the tip the foliage reaches for this seed and shape; the second grows
 * the tip lower by that much. Every draw is relative and taken in the
 * same order, so the second tree is the first tree resized — the only
 * term that does not scale with the height is a bough's root offset,
 * which is a fraction of the trunk's GIRTH, and that leaves the top a
 * few hundredths of a percent off rather than seven percent.
 */
export function growTree(spec: TreeSpec): TreeParts {
  const profile = SHAPE_PROFILES[spec.shape ?? 'broad'];
  const first = grow(spec, profile, spec.height);
  const top = skeletonTop(first);
  if (!(top > 0)) return first;
  return grow(spec, profile, spec.height * (spec.height / top));
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
 * The two levels, v0's exactly. Twelve sides up close — at three metres
 * a twelve-gon sixty centimetres across has facets a body length wide,
 * which is the coarsest the eye forgives. Six sides and the trunk alone
 * past that. The leaves are drawn at BOTH levels, at every tuft, because
 * a far tree with no crown is a pole on the horizon; they just get the
 * 20-triangle icosahedron instead of the 80.
 */
export const DETAILS: readonly Detail[] = Object.freeze([
  { sides: 12, order: 1, leaf: 1 },
  { sides: 6, order: 0, leaf: 0 },
]);

/** A detail level: 0 near, 1 far. */
export type TreeLevel = 0 | 1;

/**
 * Skin the limbs at one detail level into one indexed geometry.
 *
 * `footCap` bounds the overrun of a chain's first ring, world units;
 * `wrap` is the foot's circumference, the unit the bark's v is written
 * in; `bark` is the wood's colour, shaded a little per ring from `rand`
 * so a trunk is not one flat swatch under a flat light.
 */
function skin(
  limbs: readonly Limb[], d: Detail, footCap: number, wrap: number,
  bark: THREE.Color, rand: () => number,
): THREE.BufferGeometry {
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
  const col = new Float32Array(ringCount * stride * 3);
  const uv = new Float32Array(ringCount * stride * 2);
  const idx = new Uint32Array(spanCount * d.sides * 6);

  const tangent = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const radial = new THREE.Vector3();
  const shade = new THREE.Color();
  let p = 0;
  let f = 0;
  for (const chain of chains) {
    const pts: THREE.Vector3[] = [chain[0].a.clone()];
    const rad: number[] = [chain[0].ra];
    // How far up the wood each ring sits, for the bark's v.
    const along: number[] = [chain[0].run];
    let walked = chain[0].run;
    for (const limb of chain) {
      walked += limb.a.distanceTo(limb.b);
      pts.push(limb.b.clone());
      rad.push(limb.rb);
      along.push(walked);
    }
    // The foot overruns into the ground and a bough's foot into the
    // trunk, so no join shows. Radius carried along the same slope. The
    // cap only ever bites on the trunk: a bough's radius is far smaller.
    const footSpan = pts[0].distanceTo(pts[1]);
    const back = Math.min(rad[0] * 0.9, footSpan * 0.4, footCap);
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
      shade.copy(bark).offsetHSL(0, 0, (rand() - 0.5) * 0.08);
      for (let k = 0; k <= d.sides; k++) {
        const a = (k / d.sides) * Math.PI * 2;
        radial.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        const at = p * 3;
        pos[at] = pts[i].x + radial.x * r;
        pos[at + 1] = pts[i].y + radial.y * r;
        pos[at + 2] = pts[i].z + radial.z * r;
        nrm[at] = radial.x; nrm[at + 1] = radial.y; nrm[at + 2] = radial.z;
        col[at] = shade.r; col[at + 1] = shade.g; col[at + 2] = shade.b;
        // THE BARK, IN FOOT CIRCUMFERENCES: u wraps once round, and v
        // runs up the wood at the same rate, so a texel is the same size
        // in both directions on every part of the tree. v0 wrote these in
        // 30 cm tiles for a photograph it had; the photograph is not here
        // and the tile count can come back with it, as a scale on both.
        uv[p * 2] = k / d.sides;
        uv[p * 2 + 1] = along[i] / wrap;
        p++;
      }
    }
    /*
     * WOUND SO THE OUTSIDE FACES OUT.
     *
     * The ring runs from `u` toward `v` and `v = tangent x u`, so
     * (u, v, tangent) is right-handed and increasing `k` turns
     * anticlockwise seen from ahead. With that basis the quad's outward
     * face is a -> b -> c, and v0's first cut had a -> c -> b: every
     * triangle wound backwards, so backface culling threw the near wall
     * away and drew the FAR INSIDE of the trunk instead. Joshua on the
     * device: "the tree facings are swapped inwards vs outwards."
     *
     * The normals were right all along — they are the radial vector,
     * which points out — which is exactly why it lit plausibly and still
     * read wrong. The test checks the two against each other rather
     * than either alone.
     */
    for (let i = 0; i < last; i++) {
      for (let k = 0; k < d.sides; k++) {
        const a = firstRing + i * stride + k;
        const b = a + 1;
        const c = a + stride;
        const e = c + 1;
        idx[f++] = a; idx[f++] = b; idx[f++] = c;
        idx[f++] = b; idx[f++] = e; idx[f++] = c;
      }
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/**
 * The leaves as blobs, in one non-indexed geometry.
 *
 * ONE unit icosahedron is built at the level's detail and copied per
 * tuft — scaled by its radius, squashed by its `squash`, moved to its
 * centre. A unit sphere's position IS its normal, so the normal comes
 * from the same number; under a non-uniform squash it is the inverse
 * transpose, `(x, y / squash, z)` renormalised, or the lens would be lit
 * as the sphere it is not.
 *
 * COLOUR PER TUFT AND PER FACE. A shade per tuft, so a crown reads as
 * several masses of foliage rather than one flat green lump (v0); and a
 * smaller shade per triangle, all three of its vertices alike, so a
 * blob reads as facets of leaves rather than a lit ball. Per VERTEX
 * would interpolate across each face and read as speckle.
 */
function leaves(
  tufts: readonly Tuft[], detail: number, tint: THREE.Color, rand: () => number,
): THREE.BufferGeometry | null {
  if (tufts.length === 0) return null;
  const unit = new THREE.IcosahedronGeometry(1, detail);
  // SPUN SO ONE VERTEX SITS ON THE POLE. three's icosahedron has none
  // there: its top vertex is 0.85 of the radius up, and only the
  // subdivided level gains a pole from an edge midpoint. Left alone, the
  // far level's crown stops fifteen percent of a radius short of the
  // near level's and a LOD swap nods. The spin is the same at both
  // levels and costs nothing after the bake.
  unit.rotateX(-Math.atan2(GOLDEN_RATIO, 1));
  const src = unit.getAttribute('position');
  const n = src.count;
  const pos = new Float32Array(tufts.length * n * 3);
  const nrm = new Float32Array(tufts.length * n * 3);
  const col = new Float32Array(tufts.length * n * 3);
  const normal = new THREE.Vector3();
  const shade = new THREE.Color();
  const facet = new THREE.Color();
  let p = 0;
  for (const tuft of tufts) {
    shade.copy(tint).offsetHSL(0, 0, (rand() - 0.5) * 0.12);
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) facet.copy(shade).offsetHSL(0, 0, (rand() - 0.5) * 0.06);
      const x = src.getX(i);
      const y = src.getY(i);
      const z = src.getZ(i);
      const at = p * 3;
      pos[at] = tuft.at.x + x * tuft.r;
      pos[at + 1] = tuft.at.y + y * tuft.r * tuft.squash;
      pos[at + 2] = tuft.at.z + z * tuft.r;
      normal.set(x, y / tuft.squash, z).normalize();
      nrm[at] = normal.x; nrm[at + 1] = normal.y; nrm[at + 2] = normal.z;
      col[at] = facet.r; col[at + 1] = facet.g; col[at + 2] = facet.b;
      p++;
    }
  }
  unit.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

/** A baked tree: the wood, and the foliage, as two shapes. */
export interface BakedTree {
  /** Vertex-coloured bark brown, UV'd in foot circumferences. */
  readonly wood: THREE.BufferGeometry;
  /** Vertex-coloured green blobs, or null for a skeleton with no tufts. */
  readonly leaves: THREE.BufferGeometry | null;
}

/**
 * Bake a tree at one detail level, WOOD AND LEAVES APART, in world
 * units with the foot at the origin.
 *
 * Two geometries because they are two materials: v0 split them so the
 * wood could carry a bark photograph while the leaves stayed flat, and
 * the split still costs two draw calls for a whole instanced stand. The
 * photograph is not in this milestone; the split stays because putting
 * it back is then a material change and not a re-bake.
 */
export function bakeTree(spec: TreeSpec, level: TreeLevel): BakedTree {
  const profile = SHAPE_PROFILES[spec.shape ?? 'broad'];
  const parts = growTree(spec);
  const d = DETAILS[level];
  // Two streams, so the wood's shading cannot shift the leaves'.
  const leafRand = mulberry32((spec.seed ^ 0x51ee) >>> 0);
  const woodRand = mulberry32((spec.seed ^ 0xba2c) >>> 0);
  const leaf = new THREE.Color(profile.leaf)
    .offsetHSL((leafRand() - 0.5) * 0.04, 0, (leafRand() - 0.5) * 0.1);
  const bark = new THREE.Color(profile.bark).offsetHSL(0, 0, (woodRand() - 0.5) * 0.08);
  const wood = skin(
    parts.limbs, d, spec.height * FOOT_CAP_OF_HEIGHT, Math.PI * spec.girth, bark, woodRand,
  );
  wood.computeBoundingSphere();
  wood.computeBoundingBox();
  const green = leaves(parts.tufts, d.leaf, leaf, leafRand);
  green?.computeBoundingSphere();
  green?.computeBoundingBox();
  return { wood, leaves: green };
}

/** Triangles in a geometry, indexed or not. */
export function triangles(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

/**
 * A UNIT TREE for an instanced stand: grown at the shape's representative
 * size, then divided down to one unit tall — foot at y = 0, highest leaf
 * at y = 1 — so an instance matrix carries the whole of its size. Uniform
 * scale — the bake already has the right girth-to-height ratio for the
 * shape and owes nothing more. UVs are not scaled: they are in foot
 * circumferences and stay square at any size.
 */
export function bakeUnitTree(shape: TreeShape, seed: number, level: TreeLevel): BakedTree {
  const profile = SHAPE_PROFILES[shape];
  const height = profile.bakeHeight;
  const baked = bakeTree({ height, girth: height * profile.girthOfHeight, seed, shape }, level);
  for (const part of [baked.wood, baked.leaves]) {
    if (!part) continue;
    part.scale(1 / height, 1 / height, 1 / height);
    part.computeBoundingSphere();
    part.computeBoundingBox();
  }
  return baked;
}

/**
 * THE WOOD'S MATERIAL. Lambert, coloured by vertex, fogged with the
 * world — the same class and the same cost as the terrain it stands on.
 * v0's was Standard at roughness 1 waiting for a bark map; a phone
 * drawing a thousand of these does not pay for a PBR pass on a trunk
 * with no texture. Two functions rather than one shared material,
 * because the stand holds two draw calls and the wood is the one a bark
 * map will one day be hung on.
 */
export function woodMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
}

/** And the foliage's: flat, matte, coloured by vertex. */
export function leafMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, fog: true });
}
