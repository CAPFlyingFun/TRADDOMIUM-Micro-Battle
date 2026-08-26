/**
 * THE WATER MUST BE AS DEEP AS THE GROUND UNDER IT IS LOW.
 *
 * This is the invariant that has broken four separate times, and every
 * break shipped, and every one of them reached Joshua as some version
 * of the same sentence: the water is there and you cannot see it.
 *
 *   1. Depth rode the geometry — one baked level-minus-bed per slab.
 *      Flat tones, a straight polygon edge at every ownership
 *      boundary, the island wearing shards instead of water.
 *   2. Depth came from a texture of the RAW height grid, where the
 *      terrain is the BLURRED one: 8.07 m out on average, wet-or-dry
 *      disagreeing on 28.7% of the water.
 *   3. Blended as baseLand blends it — and still a texture, so still
 *      no trench, because the trench is cut at RUNTIME. Mean depth
 *      -0.11 m where the game had 0.90 m; 66.6% of the island's water
 *      drawn at zero alpha. No texture could have saved it either:
 *      1025 samples over 56 km is one texel every 54.7 m, and a
 *      twelve-metre channel is a quarter of a texel.
 *   4. The trench profile alone, which knows the channel but not the
 *      ground either side of it: depth overstated by 54% and 74.6% of
 *      the DRY ground under a slab painted blue.
 *
 * What they have in common is that the water was shaded from a SECOND
 * description of the island, and any second description drifts. The
 * fragment shader now evaluates the depth terrainHeight itself arrives
 * at — see FlowWater's build() for the derivation — from four numbers
 * the slab carries. These tests hold that expression to the ground it
 * claims to be describing, on the shipped island rather than on a
 * fixture, because every one of the four failures above was invisible
 * to a fixture and obvious on Kauaʻi.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  setRelief, setSmoothing, terrainHeight, useGrid,
} from '../src/world/heightfield';
import { decodeGrid } from '../src/world/kauai';
import { decodeFlow, pondSheet, useFlow, waterLevelAt, type Flow } from '../src/world/flow';
import {
  buildPonds, buildReach, EDGE_FADE, SURFACE_ALPHA, waterShader,
} from '../src/world/FlowWater';
import { MAX_DEPTH, waterDepth as shaded } from '../src/world/carve';
import { DEFAULTS } from '../src/ui/settings';

const GRID = fileURLToPath(new URL('../public/kauai-1025.bin', import.meta.url));
const FLOW = fileURLToPath(new URL('../public/kauai-flow.bin', import.meta.url));
let flow: Flow;

beforeAll(() => {
  const g = readFileSync(GRID);
  useGrid(decodeGrid(g.buffer.slice(g.byteOffset, g.byteOffset + g.byteLength) as ArrayBuffer));
  // The dials the game ships at. Depth is measured against the ground
  // she WALKS on, so a test at some other smoothing is testing an
  // island nobody plays.
  setSmoothing(DEFAULTS.terrainSmoothing);
  setRelief(1);
  const f = readFileSync(FLOW);
  flow = decodeFlow(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) as ArrayBuffer);
  useFlow(flow);
});

interface Slab {
  pos: Float32Array; deep: Float32Array; across: Float32Array;
  span: Float32Array; rise: Float32Array;
}

/** Every fourteenth reach of the shipped bake, as read-back attributes. */
function slabs(): Slab[] {
  const out: Slab[] = [];
  for (let r = 0; r < flow.reaches.length; r += 14) {
    const { first, count } = flow.reaches[r];
    const g = buildReach(flow, first, count, 0, 0);
    if (!g) continue;
    out.push({
      pos: g.getAttribute('position').array as Float32Array,
      deep: g.getAttribute('deep').array as Float32Array,
      across: g.getAttribute('across').array as Float32Array,
      span: g.getAttribute('span').array as Float32Array,
      rise: g.getAttribute('rise').array as Float32Array,
    });
    g.dispose();
  }
  return out;
}

describe('the depth the water is shaded with', () => {
  it('is the depth the ground actually gives it', () => {
    // The whole point, stated as one number. At a vertex the shader's
    // expression and terrainHeight are the same algebra rearranged, so
    // this is not "close enough" — it is exact, and the tolerance is
    // here for float32 attributes and nothing else.
    //
    // The exceptions are real and bounded, and they are all the same
    // exception: flowAt carves toward the NEAREST station and segment,
    // and a vertex reaching a couple of hundred metres off a bend can
    // be nearest to neither of the two this row was built from. Where
    // that happens the cut it got is another station's, and no
    // expression built from this one's numbers can name it. Measured
    // at 5.3% of the vertices we own, none of them worse than the
    // metre a trench is deep — so the assertions are set at the
    // measurement plus headroom, not at zero.
    let n = 0, off = 0;
    let worst = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;                // collapsed
        const own = waterLevelAt(wx, wz);
        if (own === null || Math.abs(own - level) > 1) continue;  // not ours
        n++;
        const err = Math.abs(
          shaded(s.deep[v], s.across[v], s.span[v], s.rise[v])
          - (level - terrainHeight(wx, wz)),
        );
        if (err > 1) { off++; worst = Math.max(worst, err); }
      }
    }
    expect(n).toBeGreaterThan(10_000);
    // Version 3 of this shader would have scored about 100% here.
    //
    // THIS NUMBER IS DEBT, AND IT IS DRIFTING. It was 5.3% when the
    // ground and the shader both carved from the NEAREST station. The
    // ground now takes the deepest cut over every channel covering the
    // point, because selecting one made the terrain jump 48 cm wherever
    // the choice flipped — while the shader still models a single
    // trench, because three attributes cannot encode a maximum over
    // several. So the two disagree at confluences and score 8.2%.
    //
    // The fix is not a threshold. It is that the slab should carry the
    // real depth in `rise` and drop its private profile entirely, which
    // needs vertices dense enough to interpolate a trench: measured at
    // ACROSS = 9, dropping the profile today costs 4.66% of midpoints
    // over 25 cm against the analytic model's 1.20%, so the geometry
    // has to be rebuilt on a fine lattice first. Until then this is the
    // last place in the game where two descriptions of one surface are
    // kept in step by hand, and it is expected to get worse, not
    // better. Do not raise this again — remove the reason for it.
    expect(off / n).toBeLessThan(0.10);
    // And the worst case is bounded by the thing it is a disagreement
    // ABOUT: two stations can differ over whether a point sits in a
    // trench, and a trench is one metre deep. It comes back at exactly
    // that, plus float32 dust — which is the shape of the error
    // confirming what it is. Anything past it is a different bug.
    expect(worst).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  it('does not leave the island invisibly wet', () => {
    // The bug in Joshua's words, as a threshold. A vertex standing in
    // real water must come out with real depth: alpha ramps in over the
    // first 45 units, so a zero here is water that is drawn and cannot
    // be seen.
    let wet = 0, unseen = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;
        if (level - terrainHeight(wx, wz) <= 0) continue;   // dry here
        wet++;
        if (shaded(s.deep[v], s.across[v], s.span[v], s.rise[v]) <= 0) unseen++;
      }
    }
    expect(wet).toBeGreaterThan(10_000);
    expect(unseen / wet).toBeLessThan(0.05);
  });

  it('does not paint blue over ground that stands above it', () => {
    // The other half of the same complaint — water "floating like
    // highways". The depth test hides it, but only from a camera that
    // has the geometry to hide it with, and the water carries a
    // polygon offset toward the eye. Alpha reaching zero on its own is
    // what makes that not matter.
    let dry = 0, painted = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;
        if (level - terrainHeight(wx, wz) > 0) continue;    // wet here
        dry++;
        // Below a few centimetres the fragment is clear anyway.
        if (shaded(s.deep[v], s.across[v], s.span[v], s.rise[v]) > 5) painted++;
      }
    }
    expect(dry).toBeGreaterThan(1_000);
    expect(painted / dry).toBeLessThan(0.10);
  });

  it('gives a slab enough vertices to carry the ground it crosses', () => {
    // The density is not taste. Five rows per station scored 10.1% of
    // the water at zero alpha where four rows scores 5.4%, and the
    // tests above pass or fail on it — so if someone thins the mesh to
    // buy back a millisecond, this says what it costs.
    const { first, count } = flow.reaches[0];
    const g = buildReach(flow, first, count, 0, 0)!;
    const rows = g.getAttribute('position').count / 9;
    expect(rows).toBe((count - 1) * 4 + 1);
    g.dispose();
  });
});

/**
 * THE TWO THINGS THE WATER ASKS OF three.js BY NAME.
 *
 * Both are strings. Neither is typechecked, neither is compiled by
 * anything in this repo, and a three.js upgrade that renames either
 * one leaves the water looking *almost* right — which is the failure
 * mode this whole file exists to catch. The water already lost a depth
 * bias this way: `polygonOffsetUnits = -8` sat in the material for
 * three releases doing nothing at all, because a logarithmic depth
 * buffer makes the fragment shader write gl_FragDepth and a written
 * depth discards the rasteriser's offset.
 */
describe('the shader chunks the water patches', () => {
  it('still has the include points the material replaces', async () => {
    const THREE = await import('three');
    const fs = THREE.ShaderLib.standard.fragmentShader;
    // Where the depth bias goes, and where the colour is decided.
    expect(fs).toContain('#include <logdepthbuf_fragment>');
    expect(fs).toContain('#include <color_fragment>');
    expect(THREE.ShaderLib.standard.vertexShader).toContain('#include <begin_vertex>');
  });

  it('still spells the logarithmic-depth macro the way the bias guards it', async () => {
    const THREE = await import('three');
    // The macro three.js actually guards the chunk with...
    const macro = /#if defined\( (\w+) \)/.exec(THREE.ShaderChunk.logdepthbuf_fragment)?.[1];
    // ...must be the one FlowWater's injected #ifdef names.
    const src = readFileSync(
      fileURLToPath(new URL('../src/world/FlowWater.ts', import.meta.url)), 'utf8');
    expect(macro).toBeTruthy();
    expect(src).toContain(`#ifdef ${macro}`);
    expect(src).toContain('gl_FragDepth -=');
    // A #ifdef on a macro that no longer exists is not an error. It is
    // silence, and the water goes back to fighting the land for the
    // same pixels with nothing in the build to say why.
  });
});

/**
 * THE SHADER THE WATER ACTUALLY COMPILES.
 *
 * Seven `.replace` calls against three.js's source, and a replace that
 * misses is silent. Both silent misses this file knows about shipped:
 * a varying named `vUv` that three.js only declares when the material
 * has a map, which failed to link and drew every stream black; and a
 * `#ifdef` on a macro that does not exist, which compiled perfectly
 * and left the water fighting the land for the same pixels.
 *
 * Nothing here compiles GLSL — that needs a GPU. What it does is check
 * the two things a missed replace breaks: that the injection is
 * present at all, and that every name the injected code reads has been
 * declared somewhere ahead of it.
 */
describe('the water shader as it goes to the driver', () => {
  async function built() {
    const THREE = await import('three');
    return waterShader(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
    );
  }

  it('landed every injection', async () => {
    const { vertexShader, fragmentShader } = await built();
    // The depth expression, the waves, the bias, and the discard.
    expect(fragmentShader).toContain('tmbWaterDepth(');
    expect(fragmentShader).toContain('texture2D(ripple');
    expect(fragmentShader).toContain('gl_FragDepth -=');
    expect(fragmentShader).toContain('discard;');
    // And the vertex side that feeds them.
    expect(vertexShader).toContain('vFlowView = normalize(normalMatrix');
    // Each injection sits after the chunk it replaced, not instead of
    // it — dropping three.js's own code would break the material in
    // ways that have nothing to do with water.
    for (const chunk of ['normal_fragment_begin', 'color_fragment', 'logdepthbuf_fragment']) {
      expect(fragmentShader).toContain(`#include <${chunk}>`);
    }
    expect(vertexShader).toContain('#include <begin_vertex>');
  });

  it('declares every name the injected code reads', async () => {
    const { vertexShader, fragmentShader } = await built();
    // Everything the fragment side uses that three.js does not provide.
    for (const name of [
      'v_deep', 'v_across', 'v_span', 'v_rise', 'v_along',
      'vFlowView', 'clock', 'relief', 'ripple',
    ]) {
      expect(fragmentShader).toMatch(new RegExp(`(varying|uniform)[^;]*\\b${name}\\b`));
    }
    // A varying has to be declared and WRITTEN on the vertex side too,
    // or it reads as zero and the failure is a look rather than an
    // error. This is the exact shape of the vUv bug.
    for (const name of ['v_deep', 'v_across', 'v_span', 'v_rise', 'v_along', 'vFlowView']) {
      expect(vertexShader).toMatch(new RegExp(`varying[^;]*\\b${name}\\b`));
      expect(vertexShader).toMatch(new RegExp(`\\b${name}\\s*=`));
    }
  });

  it('asks for exactly the attributes the geometry supplies', async () => {
    // THE CROSS-CHECK THAT NOTHING ELSE MAKES. The shader names its
    // attributes in a string; buildReach names them in another string;
    // nothing has ever compared the two. A typo in either is a black
    // stream or a dead wave, with a clean build either way.
    const { vertexShader } = await built();
    const asked = new Set(
      [...vertexShader.matchAll(/attribute float (\w+);/g)].map((m) => m[1]));
    const { first, count } = flow.reaches[0];
    const geometry = buildReach(flow, first, count, 0, 0)!;
    const supplied = new Set(Object.keys(geometry.attributes));
    for (const name of asked) expect(supplied).toContain(name);
    geometry.dispose();
    // And the ponds, which are built by a different function and have
    // been given a different attribute set before now.
    const ponds = buildPonds(pondSheet()!, [0, 1, 2], 0, 0);
    const onPonds = new Set(Object.keys(ponds.attributes));
    for (const name of asked) expect(onPonds).toContain(name);
    ponds.dispose();
  });
});

/**
 * AND WHETHER THE WATER LOOKS LIKE WATER WHERE IT MEETS THE LAND.
 *
 * Depth being right is not the same as the water reading as water. The
 * shoreline ramp was 45 cm on an island whose median stream is 50 cm
 * deep, so it was spread over the whole range the water has, and the
 * shallow rim came out at a mean alpha of 0.11 — clear enough that
 * Joshua reported both halves of it in one sentence: the edges look
 * almost clear, and the water does not appear to reach the land.
 *
 * These hold the fix to the island rather than to the constant.
 */
describe('the water where it meets the land', () => {
  /** What the fragment shader's alpha comes to, at one depth. */
  function alphaAt(depth: number): number {
    const t = Math.min(1, Math.max(0, depth / EDGE_FADE));
    return SURFACE_ALPHA * (t * t * (3 - 2 * t));
  }

  it('reads as water along the shallow rim, not as glass', () => {
    // Area-weighted, because the tessellation crowds vertices where
    // the shape is and counting samples would count those twice.
    let rim = 0, lit = 0;
    for (const s of slabs()) {
      for (let v = 0; v < s.deep.length; v++) {
        const wx = s.pos[v * 3], wz = s.pos[v * 3 + 2], level = s.pos[v * 3 + 1];
        if (wx === 0 && wz === 0) continue;
        const depth = level - terrainHeight(wx, wz);
        // The rim: real water, under 20 cm of it.
        if (depth <= 0 || depth >= 20) continue;
        rim++;
        lit += alphaAt(depth);
      }
    }
    expect(rim).toBeGreaterThan(1_000);
    // 0.11 before. Anything back near that is the old ramp returning.
    expect(lit / rim).toBeGreaterThan(0.4);
  });

  it('still fades rather than ending in a cut edge', () => {
    // The ramp has to keep two jobs it was already doing: hide the
    // terrain clip under a fade, and leave the discard something to
    // catch so invisible water does not write depth and fight the
    // bank for the same pixels.
    expect(alphaAt(0)).toBe(0);
    expect(alphaAt(0.2)).toBeLessThan(0.004);
    // And it must not be so long that the rim goes clear again.
    expect(EDGE_FADE).toBeLessThan(15);
    expect(alphaAt(EDGE_FADE)).toBeCloseTo(SURFACE_ALPHA, 6);
  });
});

/**
 * THE RIPPLE'S SCALES, AND THE MOIRÉ THEY EXIST TO AVOID.
 *
 * The surface is one tiling normal map sampled four times. Beyond
 * Extinction shipped the same idea twice: first as a sum of cosine
 * wavelets, which "beat into a hard diamond grid/moiré (playtest)",
 * and then as this. The property that makes the second one work is
 * that the four sample scales share no factor and each is rotated by
 * its own angle, so their repeats never come into register.
 *
 * That property is four numbers in a shader string. Nothing about the
 * code stops someone rounding 263 and 127 to 250 and 125, which would
 * put a repeat every 250 units in both and hand the water its grid
 * back — and it would look fine in a still and wrong in motion, which
 * is the hardest kind of regression to catch. So it is checked.
 */
describe("the ripple's octaves", () => {
  async function scales(): Promise<number[]> {
    const THREE = await import('three');
    const { fragmentShader } = waterShader(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
    );
    return [...fragmentShader.matchAll(/tmbSpin\([\d.]+\) \* wp \/ ([\d.]+)/g)]
      .map((m) => Number(m[1]));
  }

  it('samples the map at four scales', async () => {
    expect(await scales()).toHaveLength(4);
  });

  it('shares no factor between any two of them', async () => {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const found = await scales();
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        expect(Number.isInteger(found[i])).toBe(true);
        expect(gcd(found[i], found[j])).toBe(1);
      }
    }
  });

  it('turns each one by a different angle', async () => {
    const THREE = await import('three');
    const { fragmentShader } = waterShader(
      THREE.ShaderLib.standard.vertexShader,
      THREE.ShaderLib.standard.fragmentShader,
    );
    const angles = [...fragmentShader.matchAll(/tmbSpin\(([\d.]+)\)/g)].map((m) => m[1]);
    expect(angles).toHaveLength(4);
    expect(new Set(angles).size).toBe(4);
  });

  it('keeps every wavelength something she could see', async () => {
    // She is one unit long. A ripple finer than a few units is noise
    // she can never resolve and aliases in the distance; one coarser
    // than a stream is wide stops reading as a ripple at all — the
    // median trench is 480 units across.
    for (const scale of await scales()) {
      expect(scale).toBeGreaterThan(10);
      expect(scale).toBeLessThan(480);
    }
  });
});

/**
 * EVERY POINT THE GAME CALLS WET MUST HAVE WATER DRAWN OVER IT.
 *
 * The depth is right and the shoreline is opaque and Joshua still found
 * places with none in them: "still water not showing in a deep part".
 * Nothing about depth could explain that, because there was no geometry
 * there to shade. Measured over six 4 km squares of island, 7.8% of
 * everything waterLevelAt called wet had no slab above it at all — she
 * could swim in it and could not see it.
 *
 * Four separate causes, none of them the drawing:
 *
 *   the slab drew 98% of the claim, for an alpha fade that moved to
 *     depth two versions ago                                   0.5 pt
 *   vertices offset along a SMOOTHED normal, so their clearance from
 *     the local segment was half·cos(φ)                        2.5 pt
 *   the index claimed the MAX of a segment's two ends while the
 *     geometry tapered between them                            2.1 pt
 *   the index claimed spans a pond had taken, where buildReach
 *     collapses the strip to nothing                           0.6 pt
 *
 * Which is one fault wearing four hats: the index and the geometry were
 * each computing the reach of the water, separately, and drifting. They
 * are now the same computation, and this is what says so.
 */
describe('the water the game claims', () => {
  it('has geometry over essentially all of it', async () => {
    const { pondLevelAt } = await import('../src/world/flow');
    // SIX SQUARES OF ISLAND, not one. The first version of this test
    // sampled a single 2 km box and could not tell any of the four
    // fixes from their absence — 561 wet points, and reverting the
    // miter moved it from 1.78% to 1.96%. Six 4 km squares on a 16 m
    // lattice is 8,671 wet points, runs in two seconds, and separates
    // them: 1.4% as it stands, 2.3% with the miter gone, 4.4% with the
    // taper gone.
    const HALF = 200_000, STEP = 1600;
    const N = (HALF * 2) / STEP;
    const SPOTS: Array<[number, number]> = [
      [-1.2e6, 1.1e6], [0, 0], [8e5, -6e5], [-2e6, -1e6], [1.5e6, 9e5], [-6e5, 4e5],
    ];
    const side = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) =>
      (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
    let wet = 0, holed = 0;
    for (const [cx, cz] of SPOTS) {
      const hit = new Uint8Array(N * N);
      const eat = (geo: ReturnType<typeof buildPonds> | null) => {
        if (!geo) return;
        const pos = geo.getAttribute('position').array as Float32Array;
        const idx = geo.getIndex()!.array as ArrayLike<number>;
        for (let t = 0; t < idx.length; t += 3) {
          const [a2, b2, c2] = [idx[t], idx[t + 1], idx[t + 2]];
          const xs = [pos[a2 * 3] - cx, pos[b2 * 3] - cx, pos[c2 * 3] - cx];
          const zs = [pos[a2 * 3 + 2] - cz, pos[b2 * 3 + 2] - cz, pos[c2 * 3 + 2] - cz];
          const lo = (v: number) => Math.max(0, Math.floor((v + HALF) / STEP));
          const hi = (v: number) => Math.min(N - 1, Math.ceil((v + HALF) / STEP));
          for (let j = lo(Math.min(...zs)); j <= hi(Math.max(...zs)); j++) {
            for (let i = lo(Math.min(...xs)); i <= hi(Math.max(...xs)); i++) {
              const px = i * STEP - HALF, pz = j * STEP - HALF;
              const s1 = side(xs[0], zs[0], xs[1], zs[1], px, pz);
              const s2 = side(xs[1], zs[1], xs[2], zs[2], px, pz);
              const s3 = side(xs[2], zs[2], xs[0], zs[0], px, pz);
              if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) {
                hit[j * N + i] = 1;
              }
            }
          }
        }
        geo.dispose();
      };
      for (const { first, count } of flow.reaches) {
        for (let i = 0; i < count; i++) {
          const p = first + i;
          if (Math.abs(flow.x[p] - cx) < HALF * 1.6 && Math.abs(flow.z[p] - cz) < HALF * 1.6) {
            eat(buildReach(flow, first, count, 0, 0));
            break;
          }
        }
      }
      // The SHEET, exactly as followPonds selects it — the first
      // version of this block scanned flow.pondX and then handed
      // buildPonds the whole Flow, which is structurally sheet-shaped
      // and compiled clean while rasterising STATION coordinates as
      // pond cells. The renamed spill field now makes that a type
      // error, and this uses the real thing.
      const pond = pondSheet()!;
      const cells: number[] = [];
      for (let i = 0; i < pond.x.length; i++) {
        if (Math.abs(pond.x[i] - cx) < HALF * 1.6
          && Math.abs(pond.z[i] - cz) < HALF * 1.6) cells.push(i);
      }
      if (cells.length) eat(buildPonds(pond, cells, 0, 0));

      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const wx = cx + i * STEP - HALF, wz = cz + j * STEP - HALF;
          const level = waterLevelAt(wx, wz);
          if (level === null || level - terrainHeight(wx, wz) <= 0) continue;
          // A pond answers for its own ground whether or not a reach
          // slab reaches it, and its sheet is built from the same cells.
          if (pondLevelAt(wx, wz) !== null) continue;
          wet++;
          if (!hit[j * N + i]) holed++;
        }
      }
    }
    expect(wet).toBeGreaterThan(5_000);
    // 7.8% before the four fixes and 1.4% after, with what is left
    // sitting a few metres from a station — slivers this lattice
    // cannot resolve rather than anywhere she could stand. Set at 2%,
    // which is under the score of every single one of the four faults
    // on its own.
    expect(holed / wet).toBeLessThan(0.02);
  });
});

/**
 * THE POND SHORELINE — the jagged edge, retired.
 *
 * Joshua: "can you fix the jagged edges?" They were two edges wearing
 * one look. The drawn sheet ended in a hard constant-alpha cut along
 * whatever terrain triangles clipped it, because pond fragments
 * carried their bake depth instead of the ground's — no ramp, pure
 * sawtooth. And the sheet stopped at the last LISTED cell, while a
 * lake's true waterline usually crosses the ring just outside the
 * listed set — a 55-metre staircase of quad borders standing in open
 * water. The fixes: a rim ring in the pond hash, and per-vertex
 * ground-sampled rise with the same six-centimetre fade the streams
 * use.
 */
describe('the pond shoreline', () => {
  it('answers the rim ring, one cell beyond the bake', async () => {
    const { pondLevelAt } = await import('../src/world/flow');
    const { SPAN } = await import('../src/world/kauai');
    const step = SPAN / 1024;
    let rims = 0, twoOut = 0, wrong = 0;
    for (let i = 0; i < flow.pondX.length && rims < 200; i += 3) {
      // March east until the listed cells run out; the next cell is
      // rim and must answer, the one after may not (unless another
      // pond owns it, so only count clean misses).
      let x = flow.pondX[i];
      while (pondLevelAt(x + step, flow.pondZ[i]) !== null
        && x < flow.pondX[i] + 40 * step) x += step;
      const rim = pondLevelAt(x, flow.pondZ[i]);
      if (rim === null) { wrong++; continue; }
      rims++;
      // Rim water is downhill of a lip, never uphill: the level it
      // answers is a real pond's spill, at least this basin's.
      expect(rim).toBeGreaterThan(0);
    }
    expect(rims).toBeGreaterThan(150);
    expect(wrong).toBe(0);
    expect(twoOut).toBe(0);
  });

  it('draws every cell the hash answers for', async () => {
    const { pondSheet, pondLevelAt } = await import('../src/world/flow');
    const pond = pondSheet()!;
    // One set by construction: each sheet cell answers, and each
    // listed bake cell is in the sheet. A rim that answered but was
    // not drawable would be swimmable invisible water.
    expect(pond.x.length).toBeGreaterThan(flow.pondX.length);
    for (let i = 0; i < pond.x.length; i += 97) {
      expect(pondLevelAt(pond.x[i], pond.z[i])).not.toBeNull();
    }
  });

  it('fades at the true waterline instead of ending in a sawtooth', async () => {
    const { pondSheet } = await import('../src/world/flow');
    // bareLand, NOT baseLand: the slab's `rise` is measured against the
    // island BEFORE its channel is cut, because the fragment shader
    // adds the trench profile back analytically. Asking the carved
    // ground here would count the trench twice.
    const { bareLand: baseLand } = await import('../src/world/heightfield');
    const pond = pondSheet()!;
    // LISTED and RIM cells carry different contracts, so they are
    // built and judged apart. A listed vertex's rise is the ground's
    // exact truth. A rim vertex's rise may only be LOWERED — that is
    // the feather that keeps flat marsh from ending on a raw cell
    // border — and some of it must actually be lowered, or the
    // feather is not there.
    // Collected separately: the sheet lists every bake cell before
    // any rim cell, so one capped loop never reaches the rim at all —
    // which is exactly how the first version of this test managed to
    // assert things about zero rim vertices.
    const listed: number[] = [];
    const rims: number[] = [];
    for (let i = 0; i < pond.x.length && listed.length < 300; i += 5) {
      if (pond.rim[i] === 0) listed.push(i);
    }
    for (let i = 0; i < pond.x.length && rims.length < 300; i += 5) {
      if (pond.rim[i] === 1) rims.push(i);
    }
    const exact = buildPonds(pond, listed, 0, 0);
    let pos = exact.getAttribute('position').array as Float32Array;
    let rise = exact.getAttribute('rise').array as Float32Array;
    let deep = exact.getAttribute('deep').array as Float32Array;
    let banks = 0, wets = 0;
    for (let v = 0; v < rise.length; v += 7) {
      expect(deep[v]).toBe(0);
      const truth = pos[v * 3 + 1] - baseLand(pos[v * 3], pos[v * 3 + 2]);
      expect(rise[v]).toBeCloseTo(truth, 0);
      if (truth < -EDGE_FADE) banks++;
      if (truth > EDGE_FADE) wets++;
    }
    exact.dispose();
    // The sheet must actually CROSS the waterline — vertices on both
    // sides — or there is no ramp to have, and the shoreline is back
    // to being whatever the depth test cuts.
    expect(banks).toBeGreaterThan(20);
    expect(wets).toBeGreaterThan(20);

    const fringe = buildPonds(pond, rims, 0, 0);
    pos = fringe.getAttribute('position').array as Float32Array;
    rise = fringe.getAttribute('rise').array as Float32Array;
    deep = fringe.getAttribute('deep').array as Float32Array;
    let feathered = 0, over = 0, seen = 0;
    for (let v = 0; v < rise.length; v += 3) {
      const truth = pos[v * 3 + 1] - baseLand(pos[v * 3], pos[v * 3 + 2]);
      seen++;
      if (rise[v] > truth + 0.5) over++;
      if (truth > EDGE_FADE && rise[v] < Math.min(truth, 6) - 0.5) feathered++;
    }
    fringe.dispose();
    expect(seen).toBeGreaterThan(500);
    // Never raised — a feather that ADDS water would be the floating
    // slab bug with a soft edge.
    expect(over).toBe(0);
    // And genuinely lowered somewhere: underwater rim vertices whose
    // alpha the feather has pulled below full. Measured at 36 on the
    // shipped bake — most rim ground is rising anyway, so the feather
    // only shows on the flat marsh fringes it exists for.
    expect(feathered).toBeGreaterThan(20);
  });
});
