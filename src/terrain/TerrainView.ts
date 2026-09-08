/**
 * KAUAʻI, DRAWN — a geometry clipmap over the heightfield.
 *
 * THE PROBLEM THIS SHAPE SOLVES. The island is 5,600,000 units across and
 * the finest survey is a sample every 1,367. One mesh at that rate is
 * 16.8 million vertices, which is not a phone. One mesh coarse enough to
 * fit is 54.7 m a sample, which is not terrain you can stand on. Detail
 * has to fall away with distance, and it has to do it without seams and
 * without rebuilding geometry as the camera moves.
 *
 * A CLIPMAP: concentric square rings, each one twice the quad size and
 * twice the span of the one inside it, all with the SAME vertex count.
 * The innermost is a full grid; every ring outside it is an annulus with
 * its middle quarter left out, because the finer ring is already drawn
 * there. Eleven levels reach 112 km — twice the island — for about
 * 49,000 vertices, which is roughly what two detailed character models
 * cost. That is the whole reason to build it this way rather than as
 * tiles: the cost does not grow with the world.
 *
 * NOTHING IS REBUILT WHEN THE CAMERA MOVES. Each ring is one static
 * geometry whose vertices are offsets from its own centre; a ring moves
 * by having its centre reassigned, snapped to TWICE its own quad so the
 * parity of its grid never changes. Only the heights are rewritten, and
 * only for rings that actually moved. A ring that has not moved is not
 * touched at all.
 *
 * THE HOLES MUST LINE UP WITH WHERE THE FINER RING ACTUALLY IS, and this
 * is the part that is easy to get wrong — the first build did. Each ring
 * snaps to its OWN lattice, so ring N and ring N+1 do not share a centre:
 * ring N sits at a multiple of its own two-quad step, which is exactly
 * ONE quad of ring N+1, so the finer ring lands offset from the middle of
 * the coarser ring's hole by 0 or ±1 coarse quad in each axis. Left
 * unhandled that is a gap you can see sky through on one side and an
 * overlap that z-fights on the other, which is precisely what the first
 * screenshot showed. So the hole is cut where the finer ring IS: the
 * offset is recomputed when a ring moves and the index buffer is rewritten
 * for it — nine possible positions, and the geometry is otherwise
 * untouched.
 *
 * THE SEAM IS STITCHED, NOT HIDDEN. Where a fine ring meets a coarse one,
 * two fine edge segments meet one coarse segment and the fine vertex in
 * between is not on the coarse line. That is a T-junction, and it is a
 * hairline you can see the sky through — the second screenshot had 83 such
 * pixels, every one of them exactly the horizon colour.
 *
 * A skirt hanging down from the fine edge covers only HALF of it: the half
 * where the coarse line is lower. Where the coarse line is higher the gap
 * is above the fine edge and a downward skirt points away from it. So
 * instead of hiding the seam, the boundary is made not to have one — each
 * ring's outer edge has its in-between vertices pinned to the mean of
 * their neighbours, which IS the coarse ring's straight line. The two
 * polylines then coincide exactly and no gap exists to cover.
 *
 * The cost is named rather than hidden: those boundary vertices are the
 * only ones in the mesh that are not `heightAt`'s own answer, they are off
 * by at most what the coarse ring is off by anyway, and the test says so.
 * The OUTERMOST ring keeps its true heights, because nothing coarser is
 * out there to agree with.
 *
 * SKIRTS STAY, for the world's outer edge and as insurance: a strip
 * hanging from each ring's boundary costs one quad row and covers
 * anything the stitch does not.
 *
 * IT DRAWS THE HEIGHTFIELD, NOT THE DEM. Every vertex is a `heightAt`,
 * so the mesh agrees with what an ant walks on by construction rather
 * than by a second copy of the sampling rules.
 *
 * THE FINEST RINGS ARE FINER THAN THE SURVEY, and that is not a terrain
 * edit. Everything that stands on the ground is seated on `heightAt`,
 * which is BILINEAR between the survey's 13.67 m samples. A ring draws
 * the same samples as two triangles a quad, and between the vertices the
 * two surfaces differ by the quad's twist — agreeing at every vertex and
 * nowhere else. Measured on the shipped survey: at a forest site the gap
 * is median 1.1 cm, p90 13 cm, p99 44 cm; on Waimea's canyon wall (world
 * −1215200, −143200) median 15 cm, p90 71 cm, max 4.2 m. That gap is a
 * stone standing on air or a tuft of grass under the ground, and it is
 * what Joshua saw on his phone: objects underground.
 *
 * The fix is NOT to seat objects on the triangles. `heightAt` is the one
 * truth for everything that touches the ground — later the ant too — and
 * a second surface for props to rest on would be the second copy of the
 * rules this file exists to avoid. The fix is to draw `heightAt` more
 * faithfully where it can be seen. The triangle-against-bilinear residual
 * falls with the SQUARE of the subdivision, so three extra levels below
 * the survey's step — quads of 6.84 m, 3.42 m and 1.71 m — divide the
 * canyon wall's p90 by 64, to about 1.1 cm. No height is invented: every
 * vertex of every ring is still `heightAt` of its own position, and a
 * sub-survey vertex lands on the same bilinear surface an ant's foot
 * does. `SUB_HD_LEVELS` is that count; the ring count grows by it so the
 * outermost ring's reach does not move, and the levels from
 * `SUB_HD_LEVELS` outward still put every vertex on the survey's own
 * lattice, which the tile-staleness argument below depends on.
 * `tests/terrainView.test.ts` measures the convergence on the real
 * survey rather than trusting this paragraph.
 *
 * What it costs, measured in node with the tiles resident, walking the
 * canyon point: three more draw calls, 13,443 more vertices (35,848 to
 * 49,291), and a finest ring that moves every 3.4 m instead of every
 * 27 — 0.585 ring refills a metre walked along an axis where it was
 * 0.070 (0.79 on a diagonal), each refill the same 4,225 reads and the
 * same 3.3 ms it always was. Per metre that is 1.9 ms where it was 0.25;
 * at 30 m/s it is 17.5 refills a second, one every three or four frames.
 *
 * THE REFILL IS RATIONED: at most `REFILLS_PER_UPDATE` rings an update,
 * finest first, the rest left for the next call. A refill that is 3.3 ms
 * in node is likely 8 ms or more on Joshua's phone, and two things stack
 * them: a tile landing, which stales the five rings below the coarse step
 * in one go (measured: 9.4 ms in one update unrationed, 4.5 ms rationed
 * with the rest drained over the next two), and any frame that moves
 * further than a finest quad and so crosses more than one snap line per
 * axis. Five refills in one frame is a hitch you feel. The first fill is
 * exempt — it happens behind the loading screen, and a world with rings
 * missing is worse than a slow first frame.
 *
 * A DEFERRED RING IS NOT MOVED. Its heights are offsets from its centre,
 * so moving the mesh without rewriting them would slide the ground
 * sideways by up to two quads. It stays where it was, at the heights it
 * had, and its neighbours are told about the centre it actually has: the
 * holes are cut and the meshes placed in a second pass from the rings'
 * ACTUAL centres, every update, never from where a ring would be if it
 * were current. Before the ration those were the same thing and the
 * code used the wanted centres; they are not the same thing any more.
 *
 * WHY THE LAG IS BOUNDED. Ring i's hole tolerates the finer ring sitting
 * −1, 0 or +1 of its own quads off centre, and two rings at their wanted
 * centres are at most 1.5 of those quads apart (the finer within half a
 * quad of the camera, the coarser within one). So the hole is still
 * where the finer ring is as long as the camera has moved less than HALF
 * a quad of ring i — one quad of ring i−1 — since either ring's centre
 * was last current. Finest first makes the inner ring of every pair the
 * fresher one, so the lag that matters is the outer ring's, and every
 * outer ring has the larger quad and the larger tolerance; the tightest
 * seam is ring 1 over ring 0, at 1.71 m of travel. And along an axis the
 * rings' snap lines form a RULER: a ring snaps at odd multiples of its
 * own quad, so in finest quads ring 0's lines are the odd numbers, ring
 * 1's twice an odd, ring 2's four times an odd — one line every 1.71 m
 * and each line one ring's, never two (measured: 2,000 ten-unit steps
 * along x never snapped two rings at once). A frame that moves less than
 * 1.71 m therefore crosses at most one line per axis and stales at most
 * two rings, which is the budget: at 30 m/s, 0.5 m a frame, movement
 * alone never leaves a ring stale. A burst does — a tile landing stales
 * five — and drains in three updates, 1.5 m of travel at that speed,
 * inside the tightest tolerance. The one thing a drain can show is the
 * seam: a ring drawing the old revision beside one drawing the new is
 * two versions of the ground for a frame or two, the hairline the
 * revision counter exists to prevent, now bounded to those frames rather
 * than to the distance to the next snap.
 *
 * AND IT HAS TO BE TOLD WHEN THE GROUND CHANGES. An earlier version of
 * this comment claimed a streamed tile "sharpens the ground under the
 * camera with no change here", which was false: a ring is refilled only
 * when it MOVES, so a tile landing under a camera that is standing still
 * reached nobody, and once the camera did move the rings caught up at
 * different rates — at the time ring 0 every 27 m, ring 4 every 437 m — leaving
 * adjacent rings drawing two different versions of the ground and pulling
 * the stitched seam apart. `Heightfield.revision()` closes it: one
 * counter, bumped when a tile arrives or leaves, compared per frame, and
 * a change marks every ring stale at once — the ration then drains them
 * over three updates rather than at the next snap.
 *
 * THE REFILL IS THE FRAME BUDGET, so it is written like it. Measured at
 * 14 ms and ~89,000 short-lived objects a ring before this was addressed,
 * landing on about a third of frames at the scene's own flying speed —
 * on a phone that is the whole frame. Three things were paying for it:
 * `normalAt` per vertex (four more heightfield reads each, when the
 * neighbouring vertices this loop has ALREADY computed are the same
 * samples), a `THREE.Color` allocated three deep per vertex, and a
 * two-character string built per read inside the heightfield's tile
 * lookup. All three are gone; what is left is one small point per vertex.
 *
 * THE COLOUR IS HEIGHT, and it is honest about being a stand-in: there
 * are no textures baked yet (the ladder they will be baked to is in
 * `assets/textureQuality.ts`). Below sea level is drawn as sea floor
 * rather than as water — the ocean is Phase 3, and pretending otherwise
 * here would be a surface nobody owns.
 *
 * WET GROUND IS A LENS ON THE COLOUR, NOT A SECOND SURFACE (Joshua's
 * brief, 2026-09-07: terrain the ocean touches reads wet, recently
 * exposed ground reads slightly darker and slightly more reflective and
 * fades back; rain does the same; nothing here is erosion). It is done
 * where it is cheapest and where it cannot touch a height: in the one
 * Lambert material, patched with `onBeforeCompile`. Three uniforms — the
 * height the swash reaches, the band over which it fades, and how wet
 * the rain has left the ground — and each vertex's own world height,
 * which the rings already carry as their y. The fragment darkens and
 * cools the vertex colour by `wet` and adds one narrow Blinn-Phong lobe
 * from the sun, scaled by `wet`, so the highlight is what reveals wet
 * sand and water-facing rock when the darkening itself is hard to see.
 * The lobe scales with the sun: at night (0.06) it is a whisper, by day
 * a glint on the swash. Nothing is made brighter that the light does
 * not make brighter; the texture is always there and the illumination
 * decides — which is what Joshua asked for and what Lambert already did.
 *
 * `setWetness` writes the three numbers and NOTHING else: no position,
 * no normal, no colour byte, no refill. The test holds the position
 * bytes still across a call, the same way it does across an origin
 * rebase. Below mean sea level the seabed reads wet too, because the
 * smoothstep says so and it costs nothing to let it.
 *
 * THE LOBE HAS TO BE SUMMED BY HAND. three's Lambert fragment adds
 * `directDiffuse + indirectDiffuse + emissive` and never
 * `directSpecular` — the field exists in `ReflectedLight` but Lambert
 * does not read it. So the patch also extends that one line, and the
 * fixture test runs the patch against three's REAL `ShaderLib.lambert`
 * source so that a three upgrade that moves an anchor fails a test
 * rather than quietly losing the glint on a phone.
 */
import * as THREE from 'three';
import { COARSE_STEP, HD_STEP } from '../world/dem';
import { SEA_LEVEL, normalOfGradient, slopeOfUp, type Heightfield } from '../world/heightfield';
import { samePoint, snapTo, translate, type WorldPoint } from '../world/coords';
import { toLocal } from '../world/origin';
import type { WetnessSignals } from './wetness';
import type { SoilTile } from '../world/SparseSoil';
import { SoilClip } from './SoilClip';

/** Quads across one ring, each way. 64 keeps a ring at 4,225 vertices. */
export const RING_QUADS = 64;

/** Rings at and above the survey's step. Eight doublings from 13.67 m reach 112 km, twice the island. */
const HD_LEVELS = 8;

/**
 * Rings BELOW the survey's step — see THE FINEST RINGS ARE FINER THAN THE
 * SURVEY in the header. Three halvings of 13.67 m: 6.84 m, 3.42 m, 1.71 m.
 * Zero would be the pre-subdivision clipmap; the convergence test fails
 * at zero, which is the point of it.
 */
export const SUB_HD_LEVELS = 3;

/** Rings, finest first. The sub-survey rings are added INSIDE the eight, so the outermost ring's reach is unchanged. */
export const RING_LEVELS = HD_LEVELS + SUB_HD_LEVELS;

/**
 * The finest quad: the survey's high-detail step, halved `SUB_HD_LEVELS`
 * times. Level `SUB_HD_LEVELS` draws every sample the survey has; the
 * levels inside it draw the bilinear surface between them.
 */
export const FINEST_QUAD = HD_STEP / 2 ** SUB_HD_LEVELS;

/**
 * The most rings one `update` refills once the world is drawn — see THE
 * REFILL IS RATIONED in the header. Two is the most a frame can stale by
 * movement alone at the game's own speeds (one snap line per axis), so
 * the ration bites only on bursts.
 */
export const REFILLS_PER_UPDATE = 2;

/** How deep a ring's skirt hangs, as a multiple of its own quad size. */
const SKIRT_QUADS = 1.5;

/**
 * Height in world units at which the colour ramp changes hands. Tuned to
 * Kauaʻi, not measured from it.
 *
 * IT STAYS GREEN ALL THE WAY UP, which is the thing a generic height ramp
 * gets wrong here. Kauaʻi has no treeline: Waiʻaleʻale's 1,548 m summit is
 * a rainforest bog, the wettest place on Earth, and painting it grey
 * because it is high would be a mountain from somewhere else. The island's
 * bare rock is its CLIFFS — Waimea's walls, the Napali face — and that is
 * a matter of slope, which is what `ROCK` is for.
 */
const BANDS: readonly { readonly at: number; readonly colour: number }[] = [
  { at: -300_000, colour: 0x16324e },
  { at: -40_000, colour: 0x1b5378 },
  { at: -2_000, colour: 0x2d7f96 },
  { at: 0, colour: 0xcfc09a },
  { at: 1_500, colour: 0x7d9b4e },
  { at: 25_000, colour: 0x4a7a3a },
  { at: 90_000, colour: 0x3f6b32 },
  { at: 160_000, colour: 0x35583a },
];

/** The red-brown of Waimea's walls: what steep ground is, at any height. */
const ROCK = 0x8a6a52;
/** Below this slope nothing is bare; above the second, everything is. Degrees. */
const ROCK_FROM = 32;
const ROCK_FULL = 58;

/**
 * How wet soaking rain can make the ground, 0..1, against the swash's
 * 1. GAME TUNING: rain-wet soil is darker than dry soil but never the
 * mirror a beach is where a wave has just drawn back, so a downpour tops
 * out short of the shore.
 */
export const RAIN_WET_MAX = 0.7;

/**
 * What wet ground does to its own colour: darker, and slightly cooler,
 * because a film of water lets more of the sky in and less of the soil
 * out. GAME TUNING, applied as a multiplier so the height ramp and the
 * rock lerp are unchanged and this can never brighten anything.
 */
export const WET_DARKEN = Object.freeze({ r: 0.62, g: 0.66, b: 0.72 });

/**
 * The wet highlight's Blinn-Phong exponent. GAME TUNING: 48 is a tight
 * glint, the kind a wet beach throws at a low sun, rather than the broad
 * sheen that would make every hillside look varnished.
 */
export const WET_SHINE = 48;

/**
 * The wet highlight's strength at `wet == 1`, as a fraction of the sun's
 * colour. GAME TUNING, gentle on purpose: "even when albedo is hard to
 * see, small highlights can reveal wet soil ... do not make every
 * surface glossy". Dry ground gets none of it.
 */
export const WET_SPEC = 0.35;

/**
 * The smallest fade the shader will run, in world units (one
 * centimetre). `smoothstep(a, b, x)` divides by `b - a`; a fade of zero
 * — the honest default before the sea has spoken — would be a divide by
 * zero on the whole shoreline, which some GPUs paint black.
 */
export const MIN_WET_FADE = 1;

/**
 * The GLSL the wetness lens adds, as the four pieces `onBeforeCompile`
 * splices after three's own include lines. Exported so the fixture test
 * can pin the source rather than paraphrase it.
 *
 * THE VERTEX'S Y IS ITS WORLD HEIGHT. A ring's vertices are offsets from
 * its centre in x and z and `heightAt` in y; the mesh is placed at
 * `(lx, 0, lz)` and the group is never moved, and the floating origin
 * rebases x and z only. So `position.y` is the height above mean sea
 * level with no matrix at all, and the test pins the rings at y = 0 so
 * that this stays true.
 */
export const WET_VERTEX_PARS = 'varying float vWorldY;';
export const WET_VERTEX = '\tvWorldY = position.y;';
export const WET_FRAGMENT_PARS = [
  'uniform float uWetTop;',
  'uniform float uWetFade;',
  'uniform float uRainWet;',
  'varying float vWorldY;',
].join('\n');

/**
 * After `color_fragment`, where the vertex colour has just become
 * `diffuseColor`. The shore is 1 up to `uWetTop` and fades to 0 over
 * `uWetFade` above it — below sea level included, so the seabed reads
 * wet for free. Rain is the other source and the two take the MAX: a
 * soaked beach is not wetter than a wave-covered one.
 */
export const WET_ALBEDO = [
  '\t// WET GROUND — see terrain/TerrainView.ts. A lens on the colour; no height is read or written.',
  `\tfloat shore = 1.0 - smoothstep(uWetTop, uWetTop + max(uWetFade, ${MIN_WET_FADE.toFixed(1)}), vWorldY);`,
  `\tfloat wet = max(shore, uRainWet * ${RAIN_WET_MAX.toFixed(1)});`,
  `\tdiffuseColor.rgb *= mix(vec3(1.0), vec3(${WET_DARKEN.r.toFixed(2)}, ${WET_DARKEN.g.toFixed(2)}, ${WET_DARKEN.b.toFixed(2)}), wet);`,
].join('\n');

/**
 * After `lights_fragment_end`, once three has walked its lights and
 * `geometryNormal` / `geometryViewDir` stand in view space. One
 * Blinn-Phong lobe from the first directional light — the scene's one
 * sun (`sky/SkyView.ts`) — gated by `wet`, and by N·L so a face the sun
 * does not reach cannot glint. The light's colour carries its intensity,
 * which is what makes the night version a whisper without a branch.
 */
export const WET_HIGHLIGHT = [
  '\t#if NUM_DIR_LIGHTS > 0',
  '\t{',
  '\t\t// THE WET GLINT — see terrain/TerrainView.ts. Only where wet, only where lit.',
  '\t\tvec3 wetHalf = normalize(directionalLights[0].direction + geometryViewDir);',
  '\t\tfloat wetNH = saturate(dot(geometryNormal, wetHalf));',
  '\t\tfloat wetNL = saturate(dot(geometryNormal, directionalLights[0].direction));',
  `\t\treflectedLight.directSpecular += directionalLights[0].color * (${WET_SPEC.toFixed(2)} * wet * wetNL * pow(wetNH, ${WET_SHINE.toFixed(1)}));`,
  '\t}',
  '\t#endif',
].join('\n');

/**
 * three's Lambert sums diffuse and emissive and never reads
 * `directSpecular`; this is the line, and the line with the lobe in it.
 */
export const LAMBERT_OUTGOING =
  'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;';
export const LAMBERT_OUTGOING_WITH_SPECULAR =
  'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + totalEmissiveRadiance;';

export interface TerrainViewOptions {
  readonly field: Heightfield;
  /** Rings to build. Fewer is a smaller world drawn, not a coarser one. */
  readonly levels?: number;
  readonly ringQuads?: number;
  /**
   * The innermost ring's quad. Exists so a measurement can stand the
   * pre-subdivision clipmap (`HD_STEP`, eight levels) beside the current
   * one and time them against the same ground; the game never passes it.
   */
  readonly finestQuad?: number;
  /**
   * The ration, for a measurement that wants to stand the unrationed
   * clipmap beside the rationed one. The game never passes it.
   */
  readonly refillsPerUpdate?: number;
}

interface Ring {
  readonly level: number;
  readonly quad: number;
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  /** Where its centre is now, in world units, snapped to twice its quad. Null until the first fill. */
  centre: WorldPoint | null;
  /** The heightfield revision this ring's heights were read at. -1 until the first fill. */
  filledAt: number;
  /** Where the hole is cut, in this ring's own quads, relative to the middle. Each is -1, 0 or 1. */
  holeX: number;
  holeZ: number;
}

export class TerrainView {
  private readonly soilClip = new SoilClip();
  readonly group = new THREE.Group();
  private readonly rings: Ring[] = [];
  private readonly field: Heightfield;
  private readonly material: THREE.MeshLambertMaterial;
  private readonly quads: number;
  private readonly levels: number;
  private readonly refillsPerUpdate: number;
  /** Whether the first, unrationed fill has happened. */
  private filledOnce = false;
  /** How many rings had their heights rewritten by the last `update`. The cost, measurable. */
  lastRebuilt = 0;
  /** How many rings the last `update` left stale for the next one. Zero means the clipmap is current. */
  lastDeferred = 0;
  /**
   * The wetness lens's three uniforms, held here and handed to the
   * program BY REFERENCE in `onBeforeCompile`, so `setWetness` is three
   * number writes and never an allocation. Before the sea has spoken the
   * ground is wet exactly to mean sea level and dry above it, and no
   * rain has fallen.
   */
  private readonly uWetTop = { value: SEA_LEVEL };
  private readonly uWetFade = { value: 0 };
  private readonly uRainWet = { value: 0 };

  constructor(options: TerrainViewOptions) {
    this.field = options.field;
    const levels = options.levels ?? RING_LEVELS;
    const quads = options.ringQuads ?? RING_QUADS;
    const finest = options.finestQuad ?? FINEST_QUAD;
    this.refillsPerUpdate = options.refillsPerUpdate ?? REFILLS_PER_UPDATE;
    this.quads = quads;
    this.levels = levels;
    this.group.name = 'terrain';
    // Double-sided so the skirts need only one winding and so a camera
    // that dips below the surface sees ground rather than through it.
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // The wetness lens — see WET GROUND IS A LENS in the header. Still a
    // Lambert: the patch reads the vertex's height and writes the colour
    // and one highlight, and three's own lighting does everything else.
    //
    // ITS OWN PROGRAM. three caches compiled programs against the
    // material's parameters and cannot see what `onBeforeCompile`
    // injected; a plain Lambert elsewhere with the same parameters would
    // otherwise be handed this shader, or this one handed the plain one
    // (`sea/waterLook.ts` lost its waves to exactly that). The key names
    // the patch and its version.
    this.material.customProgramCacheKey = () => 'terrain:wetness:1:soil:1';
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uWetTop = this.uWetTop;
      shader.uniforms.uWetFade = this.uWetFade;
      shader.uniforms.uRainWet = this.uRainWet;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${WET_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WET_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${WET_FRAGMENT_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${WET_ALBEDO}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${WET_HIGHLIGHT}`)
        .replace(LAMBERT_OUTGOING, LAMBERT_OUTGOING_WITH_SPECULAR);
      this.soilClip.patch(shader);
    };

    for (let level = 0; level < levels; level += 1) {
      const quad = finest * 2 ** level;
      const geometry = ringGeometry(quads, quad, level > 0);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.name = `terrain-ring-${level}`;
      // Drawn finest first so the depth buffer rejects the coarse rings
      // behind them rather than shading twice.
      mesh.renderOrder = level;
      // The ring is a moving window on a fixed world; its bounds are
      // rewritten with its heights, and three must not cull it on stale ones.
      mesh.frustumCulled = false;
      // The ground takes shadows; it casts none (nothing stands under
      // it). A receiver flag alone draws nothing different until a
      // light with a shadow map exists, and that light is another
      // module's to add — this is the half the terrain owns.
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.rings.push({ level, quad, mesh, geometry, centre: null, holeX: 0, holeZ: 0, filledAt: -1 });
    }
  }

  /**
   * Point the clipmap at a world position and place it against the
   * current floating origin.
   *
   * Cheap enough for every frame: a ring whose snapped centre has not
   * moved is repositioned but never refilled, and repositioning eleven
   * rings is eleven subtractions. Because the placement is redone every
   * call, an origin rebase needs no separate notification — the next
   * update draws in the new frame of reference on its own.
   *
   * Refills are rationed to `refillsPerUpdate` a call, finest first,
   * after the first fill — see the header for why the lag that leaves
   * is bounded. `lastRebuilt` and `lastDeferred` say what this call did
   * and what it left.
   */
  update(at: WorldPoint): void {
    // The ground's own version. A tile arriving or leaving changes it,
    // and every ring is then stale wherever it looks — including the ones
    // that have not moved. Marking all of them on that frame is the same
    // test the first frame already does; the ration decides how many are
    // refilled per call.
    const revision = this.field.revision();
    const budget = this.filledOnce ? this.refillsPerUpdate : Infinity;
    let rebuilt = 0;
    let deferred = 0;

    // 1. Refill, finest first, until the ration is spent. A ring that is
    // deferred keeps its centre and its heights; nothing here touches it.
    for (const ring of this.rings) {
      // Snapped to TWICE the quad: snapping to one quad would flip the
      // grid's parity every step and make the surface crawl.
      const wanted = snapTo(at, ring.quad * 2);
      const moved = ring.centre === null || !samePoint(ring.centre, wanted);
      // A ring whose quad is the coarse lattice's own step (or a multiple
      // of it) samples ONLY at coarse sample points — and decimating the
      // high-detail grid by four reproduces the coarse one exactly there,
      // which `tests/worldDem.test.ts` pins. So a tile arriving cannot
      // change one pixel of what those rings draw, and refilling every
      // ring on every tile would be six rings of wasted work per download.
      // The sub-survey rings are the finest of the ones that DO refill:
      // their vertices sit between the samples, on the bilinear surface a
      // tile changes everywhere.
      const stale = ring.filledAt !== revision && ring.quad < COARSE_STEP;
      if (moved || stale) {
        if (rebuilt < budget) {
          ring.centre = wanted;
          this.fill(ring);
          rebuilt += 1;
        } else {
          deferred += 1;
        }
      } else if (ring.filledAt !== revision) {
        // Up to date by the argument above; say so, or it would be
        // re-examined against every future revision for ever.
        ring.filledAt = revision;
      }
    }
    this.filledOnce = true;
    this.lastRebuilt = rebuilt;
    this.lastDeferred = deferred;

    // 2. Place every ring where it ACTUALLY is, and cut every hole around
    // where the finer ring actually is — from the centres the rings have,
    // not the ones they would have if they were current, because a
    // deferred ring has the old one. Every ring, every call: it is a
    // subtraction and a compare each.
    for (let i = 0; i < this.rings.length; i += 1) {
      const ring = this.rings[i];
      const centre = ring.centre;
      if (centre === null) continue;
      const here = toLocal(centre);
      const innerCentre = i > 0 ? this.rings[i - 1].centre : null;
      if (innerCentre !== null) {
        const inner = toLocal(innerCentre);
        const holeX = Math.round((inner.lx - here.lx) / ring.quad);
        const holeZ = Math.round((inner.lz - here.lz) / ring.quad);
        if (holeX !== ring.holeX || holeZ !== ring.holeZ || !ring.geometry.getIndex()) {
          ring.holeX = holeX;
          ring.holeZ = holeZ;
          cutHole(ring.geometry, holeX, holeZ);
        }
      }
      // THE RENDER BOUNDARY: the only world → local conversion here, and
      // it goes through the floating origin rather than by hand.
      ring.mesh.position.set(here.lx, 0, here.lz);
    }
  }

  /** Where each ring cuts its hole, in its own quads. Exposed so a test can see the alignment. */
  holeOffsets(): { x: number; z: number }[] {
    return this.rings.map((r) => ({ x: r.holeX, z: r.holeZ }));
  }

  /** Total vertices across every ring — the number that has to stay small. */
  vertexCount(): number {
    return this.rings.reduce((total, r) => total + r.geometry.getAttribute('position').count, 0);
  }

  /**
   * The innermost drawn sheet, for joining a voxel patch to its actual
   * triangles. This is a render seam only; creatures and water continue
   * to read the survey/soil. Null outside the ready innermost ring.
   */
  drawnHeightAt(at: WorldPoint): number | null {
    const ring = this.rings[0];
    if (!ring?.centre) return null;
    const local = toLocal(at);
    const half = this.quads * ring.quad / 2;
    const x = (local.lx - ring.mesh.position.x + half) / ring.quad;
    const z = (local.lz - ring.mesh.position.z + half) / ring.quad;
    if (!Number.isFinite(x + z) || x < 0 || z < 0 || x > this.quads || z > this.quads) return null;
    const col = Math.min(this.quads - 1, Math.floor(x));
    const row = Math.min(this.quads - 1, Math.floor(z));
    const u = x - col, v = z - row;
    const position = ring.geometry.getAttribute('position');
    const a = row * (this.quads + 1) + col;
    const ha = position.getY(a), hb = position.getY(a + 1);
    const hc = position.getY(a + this.quads + 1), hd = position.getY(a + this.quads + 2);
    // cutHole lays down (a,c,b) and (b,c,d). Reading the stored heights
    // also includes edge stitching and the revision actually rendered.
    return u + v <= 1 ? ha + u * (hb - ha) + v * (hc - ha)
      : hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
  }

  ringCount(): number {
    return this.rings.length;
  }

  /** The world span of the outermost ring: how far the drawn island reaches. */
  reach(): number {
    const outer = this.rings[this.rings.length - 1];
    return outer ? outer.quad * this.quads : 0;
  }

  /**
   * Tell the ground how wet it is. Three uniform writes, no allocation,
   * no refill: the positions, normals and colour bytes of every ring are
   * exactly what they were, and the test says so.
   *
   * A signal with a non-finite number in it is ignored WHOLE rather than
   * applied in part — the three describe one frame of one sea, and a
   * shore top from this frame beside a fade from the last is a line
   * nobody drew. Rain is clamped to 0..1 on the way in, because a `mix`
   * past 1 would darken past the colour it was aiming at.
   */
  setWetness(signals: WetnessSignals): void {
    const { shoreTop, shoreFade, rain } = signals;
    if (!Number.isFinite(shoreTop) || !Number.isFinite(shoreFade) || !Number.isFinite(rain)) return;
    this.uWetTop.value = shoreTop;
    this.uWetFade.value = shoreFade;
    this.uRainWet.value = rain < 0 ? 0 : rain > 1 ? 1 : rain;
  }

  /** Called after the soil view publishes complete column meshes. */
  setSoilTiles(tiles: readonly SoilTile[]): void { this.soilClip.setTiles(tiles); }

  /** What the shader is being told. For tests and a HUD line; allocates, so not for every frame. */
  get wetness(): WetnessSignals {
    return { shoreTop: this.uWetTop.value, shoreFade: this.uWetFade.value, rain: this.uRainWet.value };
  }

  dispose(): void {
    this.soilClip.dispose();
    for (const ring of this.rings) ring.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.rings.length = 0;
  }

  /**
   * Rewrite one ring's heights, colours and normals from the heightfield.
   *
   * Four passes rather than one, because each needs the one before it
   * finished across the WHOLE ring: normals read neighbouring heights,
   * and the stitch moves heights that the normals must then reflect.
   */
  private fill(ring: Ring): void {
    const centre = ring.centre;
    if (!centre) return;
    const position = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colour = ring.geometry.getAttribute('color') as THREE.BufferAttribute;
    const normal = ring.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const skirtFrom = ring.geometry.userData.skirtFrom as number;
    const quads = ring.geometry.userData.quads as number;
    const side = quads + 1;

    // 1. The surface, straight from the heightfield. ONE read a vertex.
    for (let i = 0; i < skirtFrom; i += 1) {
      position.setY(i, this.field.heightAt(translate(centre, position.getX(i), position.getZ(i))));
    }

    // 2. The seam. Every other vertex along the outer boundary is pinned
    // to the mean of its neighbours, which is exactly the line the coarse
    // ring outside draws between the same two points — see the header.
    // The outermost ring is skipped: nothing is out there to agree with.
    if (ring.level < this.levels - 1) {
      const runs = ring.geometry.userData.edgeRuns as number[][];
      for (const edgeRun of runs) {
        for (let i = 1; i < edgeRun.length - 1; i += 2) {
          position.setY(edgeRun[i], (position.getY(edgeRun[i - 1]) + position.getY(edgeRun[i + 1])) / 2);
        }
      }
    }

    // 3. Normals and colour, from the heights now standing in the buffer.
    //
    // The normal is a central difference across the ring's OWN
    // neighbours — the same samples this loop just read, so it costs
    // nothing instead of four more heightfield reads a vertex, and it
    // describes the surface actually being drawn rather than a second
    // opinion about it. Only the ring's outer boundary, which has no
    // neighbour on one side, falls back to asking the field.
    const twoQuads = 2 * ring.quad;
    for (let row = 0; row < side; row += 1) {
      for (let col = 0; col < side; col += 1) {
        const i = row * side + col;
        const height = position.getY(i);
        let n;
        if (col > 0 && col < quads && row > 0 && row < quads) {
          const west = position.getY(i - 1);
          const east = position.getY(i + 1);
          const north = position.getY(i - side);
          const south = position.getY(i + side);
          n = normalOfGradient((west - east) / twoQuads, (north - south) / twoQuads);
        } else {
          n = this.field.normalAt(translate(centre, position.getX(i), position.getZ(i)));
        }
        normal.setXYZ(i, n.nx, n.ny, n.nz);
        const c = colourAt(height, slopeOfUp(n.ny), SCRATCH_COLOUR);
        colour.setXYZ(i, c.r, c.g, c.b);
      }
    }

    // 4. The skirts, hung from whatever height their edge vertex ended up
    // at, wearing its colour so they never catch the light as a band.
    const drop = ring.quad * SKIRT_QUADS;
    const edge = ring.geometry.userData.edge as number[];
    for (let i = 0; i < edge.length; i += 1) {
      const from = edge[i];
      const to = skirtFrom + i;
      position.setY(to, position.getY(from) - drop);
      normal.setXYZ(to, normal.getX(from), normal.getY(from), normal.getZ(from));
      colour.setXYZ(to, colour.getX(from), colour.getY(from), colour.getZ(from));
    }

    position.needsUpdate = true;
    colour.needsUpdate = true;
    normal.needsUpdate = true;
    ring.geometry.computeBoundingSphere();
    ring.filledAt = this.field.revision();
  }
}

/** One colour, reused for every vertex of every ring. See the header on what allocating one cost. */
const SCRATCH_COLOUR = new THREE.Color();

/**
 * The stand-in surface colour: the height ramp, then as much bare rock as
 * the slope earns. Exported so a test can read it rather than guess it.
 */
export function colourAt(height: number, slopeDegrees = 0, into?: THREE.Color): THREE.Color {
  const base = bandColour(height, into ?? new THREE.Color());
  // Underwater the sea floor is sea floor however steep it is; a rock face
  // painted onto the bathymetry would be visible through nothing.
  if (height < 0 || slopeDegrees <= ROCK_FROM) return base;
  const t = Math.min(1, (slopeDegrees - ROCK_FROM) / (ROCK_FULL - ROCK_FROM));
  return base.lerp(ROCK_COLOUR, t);
}

/** The rock, as one colour rather than one per vertex. `lerp` only reads it. */
const ROCK_COLOUR = new THREE.Color(ROCK);

function bandColour(height: number, into: THREE.Color): THREE.Color {
  const first = BANDS[0];
  if (height <= first.at) return into.copy(BAND_COLOURS[0]);
  for (let i = 1; i < BANDS.length; i += 1) {
    const low = BANDS[i - 1];
    const high = BANDS[i];
    if (height <= high.at) {
      const t = (height - low.at) / (high.at - low.at);
      return into.copy(BAND_COLOURS[i - 1]).lerp(BAND_COLOURS[i], t);
    }
  }
  return into.copy(BAND_COLOURS[BAND_COLOURS.length - 1]);
}

/**
 * Each band's colour, converted once.
 *
 * `setHex` is not a field assignment — three converts sRGB to linear on
 * the way in, which is a `Math.pow` per channel. Doing that per vertex
 * cost more than reading the heightfield did. These are built at module
 * load and only ever copied from.
 */
const BAND_COLOURS = BANDS.map((b) => new THREE.Color(b.colour));

/**
 * One ring, centred on its own origin, in the XZ plane with Y left at
 * zero for `fill` to write.
 *
 * `hollow` leaves out the middle quarter, which the finer ring covers.
 * The skirt is a strip hanging from the outer boundary; its vertices are
 * appended after the grid's, and `userData.skirtFrom` is where they start
 * so `fill` knows which ones to drop.
 */
function ringGeometry(quads: number, quad: number, hollow: boolean): THREE.BufferGeometry {
  const side = quads + 1;
  const half = (quads * quad) / 2;
  const positions: number[] = [];

  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      positions.push(col * quad - half, 0, row * quad - half);
    }
  }

  const skirtFrom = positions.length / 3;
  // The outer boundary, walked once: north edge, south edge, then the two
  // sides. Every one of these gets a twin hanging below it.
  const edge: number[] = [];
  for (let col = 0; col < side; col += 1) edge.push(col, side * quads + col);
  for (let row = 1; row < quads; row += 1) edge.push(row * side, row * side + quads);
  const skirtOf = new Map<number, number>();
  edge.forEach((index, i) => {
    skirtOf.set(index, skirtFrom + i);
    positions.push(positions[index * 3], 0, positions[index * 3 + 2]);
  });

  // Two triangles a boundary segment, joining each edge vertex to its
  // dropped twin. Fixed for the life of the ring: only the SURFACE indices
  // change when the hole moves.
  const skirt: number[] = [];
  const addSkirt = (a: number, b: number): void => {
    const a2 = skirtOf.get(a);
    const b2 = skirtOf.get(b);
    if (a2 === undefined || b2 === undefined) return;
    skirt.push(a, a2, b, b, a2, b2);
  };
  for (let col = 0; col < quads; col += 1) {
    addSkirt(col, col + 1);
    addSkirt(side * quads + col, side * quads + col + 1);
  }
  for (let row = 0; row < quads; row += 1) {
    addSkirt(row * side, (row + 1) * side);
    addSkirt(row * side + quads, (row + 1) * side + quads);
  }

  const geometry = new THREE.BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.userData.quads = quads;
  geometry.userData.skirtFrom = skirtFrom;
  geometry.userData.hollow = hollow;
  geometry.userData.skirt = skirt;
  // The boundary walk, in the order the skirt twins were appended, so the
  // fill can stitch an edge and hang its skirt from the stitched height.
  geometry.userData.edge = edge;
  // The four edges as ordered runs, for the stitch: north, south, west, east.
  const run = (from: number, step: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i <= quads; i += 1) out.push(from + i * step);
    return out;
  };
  geometry.userData.edgeRuns = [
    run(0, 1),
    run(side * quads, 1),
    run(0, side),
    run(quads, side),
  ];
  cutHole(geometry, 0, 0);
  return geometry;
}

/**
 * Rewrite a ring's SURFACE indices with its hole shifted by `offsetX` and
 * `offsetZ` of its own quads, then append the skirt unchanged.
 *
 * The hole is exactly the span of the next ring in — a quarter of this
 * ring's width on each side, so half of it — and it is cut where that
 * ring actually IS rather than in the middle of this one. A solid ring
 * (level 0) cuts no hole and this simply lays down every quad.
 */
export function cutHole(geometry: THREE.BufferGeometry, offsetX: number, offsetZ: number): void {
  const quads = geometry.userData.quads as number;
  const hollow = geometry.userData.hollow as boolean;
  const skirt = geometry.userData.skirt as number[];
  const side = quads + 1;
  const lowX = quads / 4 + offsetX;
  const lowZ = quads / 4 + offsetZ;
  const highX = lowX + quads / 2;
  const highZ = lowZ + quads / 2;

  const indices: number[] = [];
  for (let row = 0; row < quads; row += 1) {
    for (let col = 0; col < quads; col += 1) {
      if (hollow && col >= lowX && col < highX && row >= lowZ && row < highZ) continue;
      const a = row * side + col;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setIndex([...indices, ...skirt]);
}
