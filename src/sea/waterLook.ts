/**
 * BEYOND EXTINCTION'S WATER, WORN BY THIS ISLAND — one shader for every
 * sheet of water in the game.
 *
 * Ported from v0's `waterLook.ts`, which ported it from BE's
 * `makeOceanMaterial` at v0.0.140: turquoise shallows deepening to navy,
 * scrolling ripple normals in four world-planar octaves, surf at the
 * waterline with occasional open-water caps, clear-water alpha graded up
 * with depth, and a fresnel sky sheen. Every constant here is v0's,
 * which is BE's converted from metres to centimetres, and Joshua
 * accepted this look on his phone. CLAUDE.md: "The ocean's look is
 * accepted — protect it… Do not fix a camera or physics problem by
 * making waves smaller."
 *
 * ONE MAKER, TWO WEARERS. The ocean wears it straight; inland water will
 * wear it with a slight green shift and a tighter surf band — a lake
 * bank is not a beach break. Because both come from here they cannot
 * drift apart, which is the whole reason this is one file.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHAT CHANGED FOR v1, AND WHY EACH ONE
 *
 * The look is protected; the BILL for it is not. Joshua, 2026-09-05,
 * from the device, on v0's ocean: "really amazing", and, in the same
 * message, a likely cause of the choppiness — "we didn't have different
 * texture sizes… and probably wasn't optimized the best between CPU, and
 * GPU". His screenshots of it read 10 to 30 fps. Four changes, and the
 * first two do not alter a single pixel:
 *
 *  1. THE SECOND FLOW PHASE IS GONE FROM THE OCEAN, and it was always
 *     redundant there. v0 samples each octave TWICE — two copies of the
 *     pattern half an advection cycle apart, crossfaded, so a spatially
 *     varying current cannot shear the texture into taffy. That trick is
 *     for RIVERS. The ocean sheet's `flow` attribute is all zeros and
 *     always was; v0 says so itself ("The sea does not flow anywhere —
 *     zero is the honest value"). With zero flow the two phases sample
 *     the identical point, so `mix(rn0, rn1, xf)` mixes a value with
 *     itself, at every fragment of the largest surface on screen. Eight
 *     texture reads to compute what four compute exactly. `advected:
 *     false` emits the four, and `tests/seaWaterLook.test.ts` pins that
 *     the arithmetic is the same one.
 *  2. THE TEXTURES ARE INJECTED, not loaded here. See `SeaTextures`: v0
 *     loaded them per WEARER, so the ocean's two sheets held two copies
 *     of a 1536 normal map and a 1024 foam map — about 52 MiB once
 *     inland water made it three — and `dispose()` could not reach any
 *     of them, because they were closure-captured.
 *  3. THE RIPPLE OCTAVE COUNT IS A DIAL. Four is the accepted look and
 *     what medium and above run. The two coarse octaves alone still read
 *     as moving water, and on a phone that cannot hold sixty frames that
 *     is the trade Joshua asked for in his own words: sacrificing
 *     graphics on mobile is better than amazing graphics with horrible
 *     performance. It is a tier's decision, never a silent one.
 *  4. THE FOAM'S DISTANCE GATE IS THE CAMERA'S, not a master LOD sphere.
 *     v0 measured it from the queen's rendered position through
 *     `lod.ts`, shared with the terrain so the two could not disagree.
 *     v1 has no second consumer — the terrain is a clipmap — and
 *     importing a shared-sphere system for one wearer is the exact
 *     opposite of the reason v0's exists. The gate has the same SHAPE
 *     (feather in, zero out) and the same default reach, measured with
 *     `vViewPosition`, which in the perf world is the same distance:
 *     the free-fly camera IS the local player.
 *
 * Nothing else moved. Same colours, same foam thresholds, same alpha
 * bands, same fresnel, same polygon offsets.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE LIGHTING POLISH (Joshua, 2026-09-07), AND WHY IT IS NOT A NEW LOOK
 *
 * The sea was accepted under one sky: the clear noon the terrain shipped
 * with, when the scene's lights were constants. Phase 5 gave the island
 * its real sky, so the lights now run from full sun to a moonlit 0.06 —
 * and two things in this shader had been written as if noon were
 * permanent. Both showed up in the same phone shot, as a thin bright
 * rim along the shoreline at night:
 *
 *  1. THE SHEEN FOLLOWS THE SKY. The fresnel sheen added a CONSTANT sky
 *     colour as emissive at every hour — the sea glowing with a daytime
 *     sky over a black beach. It now adds the scene's own hemisphere sky
 *     light, scaled by `SKY_GAIN` so that at a clear noon it is the very
 *     colour it always was (pinned to 1e-6 in the test), and at night it
 *     is the night's. A wearer in a scene with no hemisphere light gets
 *     the constant, bit-identical.
 *  2. THE FOAM'S OPACITY FOLLOWS ITS LIGHT. Foam lifted the water's
 *     alpha toward 0.95 with no light term, so at night every pixel with
 *     any foam in it became a near-opaque patch over the dark seabed —
 *     the foam's COLOUR is diffuse and three lights it honestly; its
 *     OPACITY was not. The lift is now gated by `lit`, the luminance of
 *     the sky light and the sun together through a smoothstep whose
 *     thresholds sit so that every DAYTIME state the sky model produces
 *     — clear, cloudy, overcast, a low sun — gives exactly 1.0 and the
 *     daytime look is untouched, while night gives nothing.
 *  3. THE WASH BREATHES. This is the ONE change to the accepted daytime
 *     look, and it is asked for in his words: "allow stronger foam where
 *     an actual crest/wash is currently reaching; let the foam fade
 *     behind the passing water; the visible coastline should subtly move
 *     as swell reaches and retreats." The swash band was a function of
 *     depth and the scrolling textures only, so it never moved with the
 *     wave that made it. It now rides the crest the breaker already
 *     rides, between `WASH_FLOOR` of itself and all of it — the
 *     shoreline keeps at least 55% of today's wash everywhere and reaches
 *     today's full wash under a crest.
 *
 * None of this touches the palette, the swell, the shoreline feather,
 * the near/far handoff, the ripple taps or the cache key. The lights are
 * read where three declares them — file scope, from `lights_pars_begin`
 * — so the sheet needs no new uniform from the sky; it only needs the
 * scene to write its lights, which `SkyView` already does every frame.
 * ─────────────────────────────────────────────────────────────────────
 */
import * as THREE from 'three';
import { HORIZON_CLEAR } from '../sky/skyLook';
import { KEEL, type SeaSwell } from '../world/sea/swell';
import type { TextureSlot } from './SeaTextures';

/** How many ripple octaves a wearer may ask for. Four is the accepted look. */
export const MAX_OCTAVES = 4;

/**
 * The four octaves, coarsest first — tile size in world units, the
 * rotation applied to the sample, the scroll rate, and the weight.
 *
 * THE LADDER IS ANCHORED AT ONE METRE: Joshua's water map is authored as
 * a 1 x 1 m patch at full resolution, so the dominant octave tiles at
 * exactly 100 units and its chop appears at the size it was painted. The
 * larger two break the tiling and shade broad swell; the smallest is
 * near-field sparkle. Dropping octaves therefore drops them from the
 * FINE end, which is what a smaller screen cannot resolve anyway.
 */
const OCTAVES: readonly { tile: number; rot: number; sx: number; sy: number; weight: number }[] = [
  { tile: 865, rot: 0.0, sx: 0.021, sy: 0.013, weight: 0.6 },
  { tile: 230, rot: 2.1, sx: -0.017, sy: -0.024, weight: 0.7 },
  { tile: 100, rot: 4.3, sx: 0.032, sy: -0.019, weight: 1 },
  { tile: 45, rot: 1.2, sx: -0.045, sy: 0.05, weight: 0.5 },
];

/**
 * Where the foam's detail feather begins and ends, in world units of
 * camera distance.
 *
 * v0's numbers, carried: the master LOD's default radius was 1,000 units
 * (10 m) and its feather began at 0.7 of it. At an ant's scale that is
 * the distance past which surf lace is detail nobody can resolve — and
 * resolving it anyway is what produced "a dense crawling speckle rather
 * than surf".
 */
export const FOAM_NEAR = 700;
export const FOAM_FAR = 1_000;

/**
 * THE SKY THE SHEEN WAS TUNED AGAINST — BE's 0x9fc6df, the colour the
 * fresnel sheen shows at a clear noon and always has.
 *
 * WHAT THE SHADER IS ACTUALLY HANDED is `new THREE.Color(hex)
 * .convertSRGBToLinear()`, and that is two applications of the sRGB
 * transfer, not one: since r152 a hex colour is converted to the working
 * space as it is set, so the explicit conversion on top darkens it
 * again. The line is v0's, the sea was accepted on a phone with it, and
 * the LOOK is what is protected rather than the arithmetic that reached
 * it — so the expression is kept exactly, `SKY_GAIN` is derived from
 * what it produces, and this note is here so nobody "corrects" it into
 * a sea a third brighter than the one Joshua signed off.
 */
export const SHEEN_REFERENCE = 0x9fc6df;
const SHEEN = new THREE.Color(SHEEN_REFERENCE).convertSRGBToLinear();

/**
 * THE PER-CHANNEL GAIN THAT TURNS THE SCENE'S SKY LIGHT INTO THAT SHEEN.
 *
 * three folds a hemisphere light's intensity into `skyColor`, so at a
 * clear noon the shader reads the sky's `HORIZON_CLEAR` at intensity 1.0
 * (`skyLook` pins both). Dividing the sheen by that, channel for channel,
 * gives the gain that makes `skyColor * uSkyGain` the old constant to
 * float precision at noon — and a colour that dims and cools with the
 * sky at every other hour, which is the whole point. Computed here in
 * float64 from the two constants, never typed in.
 *
 * The horizon is converted the way `SkyView` converts it — `setRGB` with
 * the sRGB space — so the two sides of the ratio are the same transfer.
 */
export const SKY_GAIN: Readonly<{ r: number; g: number; b: number }> = (() => {
  const horizon = new THREE.Color().setRGB(HORIZON_CLEAR.r, HORIZON_CLEAR.g, HORIZON_CLEAR.b, THREE.SRGBColorSpace);
  return Object.freeze({ r: SHEEN.r / horizon.r, g: SHEEN.g / horizon.g, b: SHEEN.b / horizon.b });
})();

/**
 * WHERE THE FOAM'S OPACITY LIFT COMES ON, in luminance of the sky light
 * and the sun together (Rec. 709 weights, linear, intensities folded in
 * the way three folds them).
 *
 * The thresholds are placed against what the sky model actually
 * produces, and `tests/seaWaterLook.test.ts` evaluates it at each state
 * to hold them there: a clear noon reads about 1.50, seventy percent
 * cloud 1.01, a full overcast noon 0.64, the sun on the horizon 0.51 —
 * all above LIT_HI, so every daytime look is exactly the accepted one.
 * Night reads about 0.024, a hair above LIT_LO, so the lift is a tenth
 * of a percent of itself: nothing, without a hard edge that a moonlit
 * sea could cross in one frame. Between the two is nautical twilight,
 * where the foam's opacity eases out over the same degrees the sky's
 * night image fades in. GAME TUNING.
 */
export const LIT_LO = 0.02;
export const LIT_HI = 0.25;

/**
 * HOW MUCH OF THE SWASH SURVIVES IN A TROUGH, 0..1.
 *
 * The wash now rides the swell's crest like the breaker does, and this
 * is its floor: in a trough the shoreline keeps this much of the wash it
 * had before, under a crest it has all of it. The one deliberate change
 * to the accepted DAYTIME look — see the header — and the number is the
 * dial for how much the coastline breathes. At 0.55 the band never
 * empties, so the shore is still drawn as a rim of wash rather than a
 * fade, and it brightens by nearly double as a wave arrives. GAME
 * TUNING, Joshua's brief of 2026-09-07.
 */
export const WASH_FLOOR = 0.55;

export interface WaterLookOpts {
  /** The sea whose table this shader bakes. The one shared surface. */
  readonly swell: SeaSwell;
  /** The ripple and foam maps, loaded once and shared (`SeaTextures`). */
  readonly ripple: TextureSlot;
  readonly foam: TextureSlot;
  /** 0 = BE's ocean palette exactly; 1 = the inland green shift. */
  readonly green: number;
  /** Scales the surf/foam depth band. Ocean 1; inland much tighter. */
  readonly surf: number;
  /**
   * The feather band, in depth units: fully invisible at edgeLo of
   * column, fully itself at edgeHi.
   *
   * edgeLo is ABOVE ZERO for the ocean, and that is the entire trick (it
   * is BE's hiddenG, rediscovered the hard way): the flat sheet
   * geometrically intersects the rising beach at exactly zero depth, and
   * along that intersection the terrain occludes the water in a razor
   * line no alpha on the visible side can soften. Fading out while the
   * ground is still edgeLo UNDERWATER means the cut happens where the
   * water is already invisible.
   */
  readonly edgeLo: number;
  readonly edgeHi: number;
  /** Depth where shallow teal has fully handed over to the mid blue. */
  readonly midAt: number;
  /** Depth where the mid blue has fully handed over to deep navy. */
  readonly deepAt: number;
  /** How much the ripple shows in the COLOUR itself, as a fraction of brightness. */
  readonly texAmp: number;
  /**
   * Polygon-offset direction. The OCEAN sinks (+) so near-coplanar shore
   * terrain wins the depth test — BE's flyover-shimmer lesson. INLAND
   * lifts (−): a film lies ON the ground it is coplanar with, and
   * sinking it hands the whole sheet to the sand.
   */
  readonly sink: boolean;
  /**
   * How many ripple octaves, 1 to 4. Four is the accepted look. Fewer is
   * a QUALITY DECISION and shows: see the header.
   */
  readonly octaves?: number;
  /**
   * Whether the skin is advected by a per-vertex current.
   *
   * FALSE FOR THE OCEAN, and that is not a simplification: the sea's
   * flow attribute is zero, so the two advected phases sample the same
   * point and the crossfade is a no-op. Emitting one phase is the same
   * arithmetic at half the texture reads. TRUE is for water that
   * genuinely moves, where the two-phase trick stops a spatially varying
   * current shearing the pattern.
   */
  readonly advected?: boolean;
  /**
   * The near sheet rides the swell. Vertices displace by the wave table,
   * faded by DEPTH near shore and by rimLo..rimHi of sheet-local radius
   * so the sheet arrives flat at its own edge; alphaLo..alphaHi fades it
   * out entirely, crossfading into the far sheet's `hole`.
   */
  readonly swellRim?: {
    readonly rimLo: number; readonly rimHi: number;
    readonly alphaLo: number; readonly alphaHi: number;
  };
  /**
   * MEASURE THE FADE FROM THE CAMERA, not from the sheet's own middle.
   *
   * The sheet re-anchors on a hysteresis — it only moves once the camera
   * has crossed an eighth of its span — so between anchors the camera
   * drifts away from the middle and comes back. With the fade centred on
   * the SHEET, the wave zone therefore sits still while the player moves
   * and then jumps a whole recentre step. Joshua, 2026-09-06: "When
   * moving close and out, it changes the water for example and makes not
   * stay the same location."
   *
   * `setEye` is a uniform written every frame, which costs nothing; the
   * GEOMETRY still re-anchors on the hysteresis, because that is what
   * refills 82,369 depths. So the expensive thing keeps its steps and the
   * visible thing stops having any.
   *
   * The caller pays for it in reach: the band has to finish inside the
   * sheet measured from wherever the camera has drifted to, not from the
   * middle. `OceanView` subtracts that drift before it sizes the band.
   */
  readonly eyeCentred?: boolean;
  /**
   * The FAR sheet opens a hole under the near sheet — alpha rises from
   * nothing at `lo` of distance from the hole's centre to full by `hi`,
   * the exact complement of the near sheet's alpha rim.
   *
   * MEASURED IN THE SHEET'S OWN FRAME, not the island's: the shader is
   * given the hole as an offset from this sheet (`setHole` keeps the two
   * in step), because subtracting two world positions on the GPU is
   * subtracting two numbers in the millions. Distances are the same
   * either way; the precision is not.
   */
  readonly hole?: { readonly lo: number; readonly hi: number };
  /**
   * THE SEA, AS OPPOSED TO A LAKE — and it is TOLD, not guessed.
   *
   * The breaker foam is driven by the SWELL: it sums the table at the
   * fragment's own world position, so a crest's face whitens and the
   * front travels at the wave's own speed, because it IS the wave. That
   * is right for the ocean and nonsense inland — and in v0 it ran on
   * both for eight versions, giving a pool on a hillside breakers off
   * the Pacific's table.
   *
   * Told rather than inferred, because both cheap guesses are wrong:
   * guessing from DEPTH calls a deep lake the sea, and guessing from the
   * wave table makes fresh water change character every time the buoy
   * reports.
   */
  readonly ocean?: boolean;
}

export interface WaterLook {
  readonly material: THREE.MeshStandardMaterial;
  /** Advance the ripple scroll. Seconds. Written by the ONE clock. */
  readonly clock: { value: number };
  /** World position the mesh's local frame is centred on. READ IT; set it with `setCentre`. */
  readonly centre: { value: THREE.Vector2 };
  /**
   * Move the centre and everything derived from it. The only way to move
   * it: the wave phases are computed from it on the CPU, and a centre
   * moved without them is the sea of a different coast.
   */
  setCentre(wx: number, wz: number): void;
  /** World position of the far sheet's hole. READ IT; set it with `setHole`. */
  readonly hole: { value: THREE.Vector2 };
  /**
   * Move the hole. The only way: the shader is given the offset from this
   * sheet rather than the world position, and the two are kept in step
   * here — a world hole set alone would fade the wrong band.
   */
  setHole(wx: number, wz: number): void;
  /**
   * Where the camera is, so the fade can be measured from it. World
   * coordinates in; the shader is handed the offset from this sheet.
   * A no-op on a sheet built without `eyeCentred`.
   */
  setEye(wx: number, wz: number): void;
  /** How far foam keeps its detail, and where it is gone. */
  readonly foamNear: { value: number };
  readonly foamFar: { value: number };
  /** How many octaves this program was compiled with — for a HUD, and for a test. */
  readonly octaves: number;
  readonly advected: boolean;
}

/**
 * The ripple field, as GLSL.
 *
 * Emitted rather than written out, because the octave count is a dial
 * and the two-phase form must be provably the same arithmetic as the
 * one-phase form when the flow is zero.
 */
export function rippleChunk(octaves: number, advected: boolean): string {
  const used = OCTAVES.slice(0, Math.max(1, Math.min(MAX_OCTAVES, Math.round(octaves))));
  /**
   * ONE OCTAVE'S TAP, IN LOCAL SPACE.
   *
   * v0 sampled at `rrot(rot) * (world - a) / tile`. On a real coast
   * `world` is a couple of MILLION units, and a float32 there resolves to
   * a quarter of a unit — so the texture coordinate came in steps and the
   * sea was drawn as a washboard, which is what Joshua photographed at
   * Polihale. `probe:shot` recreates it.
   *
   * The fix is the identity the unrotated lookups already use through
   * `tiled()`: a wrapping texture is unchanged by a whole number of
   * tiles, so the centre may be reduced modulo the tile before it ever
   * reaches the GPU. THE REDUCTION HAPPENS IN THE ROTATED FRAME, which is
   * the part `tiled()` cannot do and the reason this is a uniform instead
   * — rotating a reduced position is not the same as reducing a rotated
   * one, so `mod` must come last. `uOct[i]` is `mod(rrot(rot) * centre,
   * tile)`, worked out on the CPU in float64, and what is left here is
   * `rrot(rot) * local`, which never leaves a few thousand.
   */
  const tap = (phase: string, o: typeof OCTAVES[number], i: number): string =>
    `  ${phase} += (texture2D(uRipple, (rrot(${o.rot.toFixed(1)}) * (vLocal - ${advected ? (phase === 'rn0' ? 'a0' : 'a1') : 'vec2(0.0)'}) + uOct[${i}]) / ${o.tile.toFixed(1)} + uTime * vec2(${o.sx.toFixed(3)}, ${o.sy.toFixed(3)})).xyz - 0.5)${o.weight === 1 ? '' : ` * ${o.weight.toFixed(1)}`};`;

  if (!advected) {
    // ONE PHASE. With no current there is nothing to advect along and
    // nothing to crossfade: `mix(x, x, t)` is `x`.
    return `
        vec3 rn0 = vec3(0.0);
${used.map((o, i) => tap('rn0', o, i)).join('\n')}
        gRn = rn0;`;
  }
  return `
        float cyc = uTime * 0.09;
        float t0 = fract(cyc);
        float t1 = fract(cyc + 0.5);
        float xf = abs(2.0 * t0 - 1.0);
        vec2 adv = vFlow * (11.1); // units/s -> units per 11.1 s cycle
        vec2 a0 = adv * t0;
        vec2 a1 = adv * t1;
        vec3 rn0 = vec3(0.0);
        vec3 rn1 = vec3(0.0);
${used.map((o, i) => `${tap('rn0', o, i)}\n${tap('rn1', o, i)}`).join('\n')}
        gRn = mix(rn0, rn1, xf);`;
}

export function makeWaterLook(opts: WaterLookOpts): WaterLook {
  const clock = { value: 0 };
  const centre = { value: new THREE.Vector2() };
  /**
   * THE CENTRE'S OWN CONTRIBUTION TO EACH WAVE'S PHASE, worked out on the
   * CPU in float64 (`SeaSwell.centrePhases`) and reduced to one turn.
   *
   * The shader adds this to `dot(dir, local) * k` and gets the same phase
   * a world coordinate would have given it — without ever holding a
   * number in the millions. See `centrePhases` for why that matters and
   * what it looked like when it did not happen.
   *
   * SET FROM `setCentre` AND NOWHERE ELSE, so the two can never disagree:
   * a centre moved without its phases would draw the sea of somewhere
   * else, which looks like a working ocean and is not.
   */
  const wavePhase = { value: opts.swell.centrePhases(0, 0) };
  // Far enough away that a hole nobody has placed swallows nothing.
  const hole = { value: new THREE.Vector2(1e9, 1e9) };
  /**
   * THE HOLE, MEASURED FROM THIS SHEET RATHER THAN FROM THE ISLAND.
   *
   * The far sheet fades out where the near one takes over, and it used to
   * find that band by taking the distance between two WORLD positions on
   * the GPU — a couple of million units from the origin each. Worse, one
   * of them arrived as a varying, so a number that size was INTERPOLATED
   * across far-sheet triangles kilometres wide. Float32 steps in
   * quarter-units there, the smoothstep turned those steps into bands of
   * alpha, and the sea was drawn as a washboard wherever the far sheet
   * lay over the near one. That is what Joshua photographed at Polihale
   * on 2026-09-05; `npm run probe:shot` recreates it from his HUD.
   *
   * Both ends are known on the CPU, so the subtraction happens THERE in
   * float64 and the shader is handed a small offset. `setCentre` and
   * `setHole` are the only things that move either end, and both refresh
   * it, so the two cannot fall out of step.
   */
  const holeLocal = { value: new THREE.Vector2(1e9, 1e9) };
  let holeWorld = { x: 1e9, z: 1e9 };
  let centreWorld = { x: 0, z: 0 };
  const refreshHole = (): void => {
    holeLocal.value.set(holeWorld.x - centreWorld.x, holeWorld.z - centreWorld.z);
  };
  /**
   * The camera in this sheet's own frame — the point the fade is measured
   * from when `eyeCentred` is set, and the origin when it is not.
   *
   * Subtracted on the CPU in float64 like everything else that crosses
   * this seam: both ends are world positions in the millions and the GPU
   * is handed only what is left. See `centrePhases`.
   */
  const eyeLocal = { value: new THREE.Vector2() };
  let eyeWorld = { x: 0, z: 0 };
  const refreshEye = (): void => {
    if (opts.eyeCentred !== true) return;
    eyeLocal.value.set(eyeWorld.x - centreWorld.x, eyeWorld.z - centreWorld.z);
  };
  const foamNear = { value: FOAM_NEAR };
  const foamFar = { value: FOAM_FAR };
  const octaves = Math.max(1, Math.min(MAX_OCTAVES, Math.round(opts.octaves ?? MAX_OCTAVES)));
  const advected = opts.advected ?? false;

  /**
   * Each ripple octave's share of the centre, ROTATED THEN REDUCED.
   *
   * The shader samples `rrot(rot) * position / tile`, and a wrapping
   * texture does not notice a whole number of tiles — so the centre can
   * be folded away before the GPU sees it. The order matters: the
   * rotation mixes the axes, so reducing first and rotating after lands
   * on a different texel. Hence rotate, then `mod`.
   *
   * `mat2(c, -s, s, c)` is COLUMN-major in GLSL, so it maps
   * (x, y) to (c*x + s*y, -s*x + c*y). Written out here rather than
   * borrowed from a matrix library, because the only thing that matters
   * is that it is the same arithmetic as the string above, and
   * tests/seaWaterLook.test.ts checks the two agree on real coordinates.
   */
  const octCentres = OCTAVES.slice(0, octaves).map(() => new THREE.Vector2());
  const oct = { value: octCentres };
  const fillOct = (wx: number, wz: number): void => {
    OCTAVES.slice(0, octaves).forEach((o, i) => {
      const c = Math.cos(o.rot);
      const sn = Math.sin(o.rot);
      const rx = c * wx + sn * wz;
      const ry = -sn * wx + c * wz;
      const mx = rx % o.tile;
      const my = ry % o.tile;
      octCentres[i].set(mx < 0 ? mx + o.tile : mx, my < 0 ? my + o.tile : my);
    });
  };
  const isSea = opts.ocean !== false;
  const swell = opts.swellRim;

  const material = new THREE.MeshStandardMaterial({
    // BE: color 0x1a6389, roughness .18, metalness LOW so steep views
    // keep the diffuse blue instead of mirroring the dark deep.
    color: 0x1a6389,
    roughness: 0.18,
    metalness: 0.1,
    transparent: true,
    // BE's shallow value was 0.58; nudged up because a film of sea over
    // bright sand was disappearing entirely (Joshua: "the water right at
    // the sand side is too transparent and hard to see").
    opacity: 0.63,
    envMapIntensity: 0.9,
    normalScale: new THREE.Vector2(0.55, 0.55),
    side: THREE.DoubleSide, // she swims; the sheet must exist from below
    polygonOffset: true,
    polygonOffsetFactor: opts.sink ? 2 : 0,
    polygonOffsetUnits: opts.sink ? 12 : -6,
  });

  // EVERY WEARER NEEDS ITS OWN PROGRAM, and this one line is why v0's
  // waves were invisible for three versions.
  //
  // three.js caches compiled programs against the MATERIAL's own
  // parameters. It does not — cannot — know what onBeforeCompile
  // injected. The two ocean sheets are both MeshStandardMaterial with
  // identical constructor parameters; only the injected source differs.
  // So the second material to compile was handed the FIRST one's
  // program: the near sheet ran the far sheet's shader, with no swell
  // displacement and with the far sheet's HOLE — which follows the near
  // sheet, so the near sheet was erasing itself precisely where the
  // player was standing. What was visible offshore was the tinted seabed
  // with no water drawn over it at all.
  //
  // THE KEY MUST NAME EVERYTHING THE SOURCE DEPENDS ON, which now
  // includes the octave count and the advection, or two tiers would
  // share one program and a phone would silently run the desktop's
  // fragment shader.
  material.customProgramCacheKey = () => [
    'water', isSea ? 'sea' : 'fresh',
    swell ? 'swell' : '-', opts.hole ? 'hole' : '-',
    `oct${octaves}`, advected ? 'adv' : 'still',
    opts.green, opts.surf, opts.edgeLo, opts.edgeHi,
    opts.midAt, opts.deepAt, opts.texAmp, opts.sink,
  ].join(':');

  // A ratio, not a colour: a Vector3 so nobody converts it.
  const skyGain = new THREE.Vector3(SKY_GAIN.r, SKY_GAIN.g, SKY_GAIN.b);

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
    shader.uniforms.uCentre = centre;
    shader.uniforms.uWavePhase = wavePhase;
    shader.uniforms.uOct = oct;
    shader.uniforms.uRipple = opts.ripple as { value: THREE.Texture };
    shader.uniforms.uFoam = opts.foam as { value: THREE.Texture };
    // The constant sheen, kept as the FALLBACK for a scene with no
    // hemisphere light, where it is what the sheen always was.
    shader.uniforms.uSky = { value: SHEEN };
    shader.uniforms.uSkyGain = { value: skyGain };
    shader.uniforms.uHole = hole;
    shader.uniforms.uHoleLocal = holeLocal;
    shader.uniforms.uEye = eyeLocal;
    shader.uniforms.uFoamNear = foamNear;
    shader.uniforms.uFoamFar = foamFar;
    // The sea's live amplitudes — where wave groups live. Shared by both
    // sheets and by the CPU queries, so one table moves them all. Fresh
    // water has no swell and does not declare the uniform, so binding it
    // there would leave a live ocean value on a material whose shader
    // never reads it.
    if (isSea) {
      opts.swell.bindUniforms(shader.uniforms as Record<string, { value: unknown }>);
    }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n attribute float depth;\n attribute vec2 flow;\n varying float vDepth;\n varying vec2 vLocal;\n varying vec2 vFlow;\n uniform vec2 uCentre;\n uniform vec2 uEye;'
        + (swell ? `\n varying vec2 vSwell;\n varying float vSheet;\n uniform float uTime;\n ${opts.swell.swellUniformChunk()}` : ''))
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vDepth = depth;\n vFlow = flow;\n vLocal = vec2(position.x, position.z);'
        + (swell ? `
        {
          // THE SWELL, from the one shared table. Faded by the water
          // column near shore — the same depth fade the CPU query uses —
          // and flattened toward the sheet's own rim so it meets the flat
          // far sheet without a step.
          float sw = 0.0;
          vec2 swSlope = vec2(0.0);
          vec2 localXZ = vLocal;
          ${opts.swell.swellChunk()}
          ${opts.swell.shoalChunk()}
          // HOW FAR THIS VERTEX IS FROM THE PLAYER, not from the sheet's
          // middle — one subtraction, and the difference between a wave
          // zone that follows her and one that sits still and then jumps.
          float fromEye = length(position.xz - uEye);
          float swFade = shoal
            * (1.0 - smoothstep(${swell.rimLo.toFixed(1)}, ${swell.rimHi.toFixed(1)}, fromEye));
          // …and a trough never cuts below the bed. Without this the
          // sheet drives through the sand in the shallows, which reads as
          // z-fighting because it IS the sheet and the seabed trading
          // places.
          float lift = max(sw * swFade, -max(0.0, depth - ${KEEL.toFixed(1)}));
          transformed.y += lift;
          vSwell = swSlope * swFade;
          vSheet = fromEye;
        }` : ''));

    // The ripple field is computed ONCE, in map_fragment (which three
    // runs before the normal and lighting stages), and handed to the
    // later stages through gRn/gBody — the colour weave, the normal tilt
    // and the surf caps all read the same water.
    shader.fragmentShader = (
      'uniform float uTime;\nuniform sampler2D uRipple;\nuniform sampler2D uFoam;\nuniform vec3 uSky;\nuniform vec3 uSkyGain;\n'
      + 'uniform float uFoamNear;\nuniform float uFoamFar;\n'
      + (isSea ? opts.swell.swellUniformChunk() : '') + '\n' + shader.fragmentShader
    )
      .replace('#include <common>', '#include <common>\n varying float vDepth;\n varying vec2 vLocal;\n varying vec2 vFlow;\n uniform vec2 uCentre;\n uniform vec2 uHoleLocal;\n uniform vec2 uOct[' + octaves + '];\n vec2 tiled(float T) { return (vLocal + mod(uCentre, vec2(T))) / T; }\n mat2 rrot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }\n vec3 gRn = vec3(0.0);\n float gBody = 0.0;'
        + (swell ? '\n varying vec2 vSwell;\n varying float vSheet;' : '')
        + (opts.hole ? '\n uniform vec2 uHole;' : ''))
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // THE EDGE BLENDS LIKE THE GROUND DOES. A hard discard at a
          // threshold cut the waterline like scissors against the beach;
          // the terrain never does that — its bands feather.
          float depth = vDepth;
          float edge = smoothstep(${opts.edgeLo.toFixed(1)}, ${opts.edgeHi.toFixed(1)}, depth);
          // Films barely ripple; a body of water carries the full skin.
          gBody = smoothstep(0.0, 25.0, depth);
${rippleChunk(octaves, advected)}

          // COLOUR. Three stops, wide handovers — the wearer picks where
          // (midAt/deepAt), so the ramp spans several bathymetry cells
          // instead of collapsing inside one at the shelf break.
          float toMid  = smoothstep(${opts.edgeLo.toFixed(1)}, ${opts.midAt.toFixed(1)}, depth);
          float toDeep = smoothstep(${opts.midAt.toFixed(1)}, ${opts.deepAt.toFixed(1)}, depth);
          vec3 shallowCol = vec3(0.020, 0.34, 0.42);   // BE deep teal
          vec3 midCol     = vec3(0.012, 0.21, 0.36);   // the bridge
          vec3 deepCol    = vec3(0.008, 0.10, 0.26);   // BE navy
          // "Just inland a slight bit of a greenish tint" — a nudge of
          // the same water toward green, not a different water.
          shallowCol = mix(shallowCol, vec3(0.035, 0.36, 0.33), ${opts.green.toFixed(2)});
          midCol     = mix(midCol,     vec3(0.022, 0.25, 0.28), ${opts.green.toFixed(2)});
          deepCol    = mix(deepCol,    vec3(0.014, 0.15, 0.20), ${opts.green.toFixed(2)});
          vec3 col = mix(shallowCol, midCol, toMid);
          col = mix(col, deepCol, toDeep);
          // FAR WATER IS SKY AND SCATTER, NOT BOTTOM. Beyond ~150 m of
          // view distance every depth slides toward the deep colour, so
          // no bathymetry contour can draw a second horizon.
          float away = smoothstep(15000.0, 130000.0, length(vViewPosition));
          col = mix(col, deepCol, away * 0.85);
          diffuseColor.rgb = col;
          // The ripple woven into the colour itself, so the surface reads
          // as textured even when the light angle flattens the normal
          // relief.
          diffuseColor.rgb *= 1.0 + (gRn.x + gRn.y) * ${opts.texAmp.toFixed(3)} * gBody * (1.0 - away);

          // ── THE FOAM'S DISTANCE GATE ─────────────────────────────
          //
          // THE BRANCH IS THE POINT, not the multiply. Everything inside
          // it is foam-specific: four texture samples, their derivatives,
          // and the swell sum the breaker phase needs. Outside the reach
          // a fragment SKIPS that work rather than computing it and
          // scaling it to nothing, which is what makes this an LOD rather
          // than a fade. The ordinary water above — ripple octaves,
          // colour, alpha, the normal — is untouched at every distance.
          //
          // Derivatives inside varying control flow are formally
          // undefined, and harmless here by construction: the branch
          // closes exactly where the feather reaches zero, so any
          // fragment that could be affected is one whose foam is already
          // being multiplied by ~0.
          float micro = 1.0 - smoothstep(uFoamNear, uFoamFar, length(vViewPosition));
          float foam = 0.0;
          if (micro > 0.0) {
          // THE BREAK. The swell dies at the shore fade and this is where
          // its energy goes: foam fronts that MARCH SHOREWARD on the
          // swell's own beat. The lace is BE's reef-water caustic web,
          // thresholded into bubbles — one broad sheet of wash, one fine
          // fizz — so a front is ragged foam, never a painted stripe.
          float surfLo = 320.0 * ${opts.surf.toFixed(3)};
          float surfHi = 30.0 * ${opts.surf.toFixed(3)};
          float surfN = texture2D(uRipple, tiled(300.0) + uTime * vec2(0.05, 0.03)).r;

          // ---- HOW MUCH FOAM THIS PIXEL CAN ACTUALLY HOLD -----------
          //
          // THREE KNEES, NOT ONE SWITCH. Each foam ingredient has its own
          // tile size and so its own vanishing distance, and giving them
          // separate thresholds is what makes the shoreline SIMPLIFY on
          // the way out instead of popping between looks: the fizz goes
          // first, the broad lace holds on much longer, and what is left
          // at the far end is the shape of the breaker, which is a
          // function of the swell and the depth and has no texture in it.
          //
          // Everything fades to the texture's MEAN COVERAGE, measured off
          // the shipped maps at these very thresholds. Fading to zero
          // would delete the surf line; fading to the mean keeps exactly
          // as much white as was there and simply stops resolving where
          // it sits.
          vec2 fizzUv = tiled(95.0);
          float fizzTexels = max(length(dFdx(fizzUv)), length(dFdy(fizzUv))) * 1024.0;
          vec2 speckUv = tiled(300.0);
          float speckTexels = max(length(dFdx(speckUv)), length(dFdy(speckUv))) * 1536.0;
          float fineGone = smoothstep(1.5, 12.0, fizzTexels);
          float laceGone = smoothstep(6.0, 48.0, fizzTexels);
          float speckGone = smoothstep(1.5, 14.0, speckTexels);

          // THE BAND IS NOT WIDENED WITH DISTANCE, though it was tried:
          // depth is the sampled seabed and the sampled seabed is
          // quantised, so a smoothstep over it terraces into contour
          // rings, and smoothing the foam above them uncovers them.
          // Widening this window measured 40% WORSE at 166 m.
          float surf = smoothstep(surfLo, surfHi, depth);
          foam = surf * mix(smoothstep(0.60, 0.86, surfN), 0.0098, speckGone);
          ${isSea ? `{
            // THE FOAM RIDES THE WAVE THAT MADE IT.
            //
            // v0 ran the phase on DEPTH against the swell's frequency —
            // foam marching along bathymetry contours at a speed set by
            // the seabed's slope, which has nothing to do with how fast
            // the water is moving. Joshua: "foam appears to travel faster
            // than the geometric waves… it feels like a separate animated
            // texture sliding across the water." It was. The phase is now
            // the SWELL ITSELF, summed here from the same table the
            // vertices are displaced by.
            float sw = 0.0;
            vec2 swSlope = vec2(0.0);
            vec2 localXZ = vLocal;
            ${opts.swell.swellChunk()}
            // Where this water sits in its own wave, -1 trough to +1
            // crest, and how steep the face is.
            float crest = clamp(sw / ${(opts.swell.reach() / 2).toFixed(2)}, -1.0, 1.0);
            // BREAKING happens in shallow water on a steep face, not out
            // at sea: gate hard on the column so open water stays clean.
            float shallow = 1.0 - smoothstep(60.0, 420.0, depth);
            // The crest, and a TAIL behind it — the wash that lingers for
            // a moment after the crest has gone by. The tail is the back
            // face, so it follows the crest shorewards and thins as the
            // wave passes.
            float face = smoothstep(0.15, 0.8, crest);
            float tail = smoothstep(0.0, 0.55, -dot(swSlope, vec2(0.9063, -0.4226)) * 40.0)
              * smoothstep(-0.6, 0.1, crest) * 0.55;
            float march = clamp((face + tail) * shallow, 0.0, 1.0);
            float lace = smoothstep(0.52, 0.86,
              dot(texture2D(uFoam, tiled(260.0) - uTime * vec2(0.012, 0.007)).rgb, vec3(0.3333)));
            float fizz = smoothstep(0.40, 0.80,
              dot(texture2D(uFoam, tiled(95.0) + uTime * vec2(0.016, -0.009)).rgb, vec3(0.3333)));
            fizz = mix(fizz, 0.333, fineGone);
            lace = mix(lace, 0.158, laceGone);
            // PALE, not merely smooth, at the far end. Fading the lace to
            // its mean removes the grain but keeps the brightness, and
            // that UNMASKED the bathymetric terracing the foam's own
            // texture had been hiding — measured 57% MORE fine structure
            // rather than less. So the far tier is a soft pale band.
            float pale = mix(1.0, 0.5, laceGone);
            float breaker = surf * march * (lace * 2.2 + fizz * 1.1) * pale;
            // THE SWASH LINE, and where it sits is the whole point.
            // Peaked at 40 it lived inside the alpha feather, where the
            // sheet is barely 1% there — dense foam nobody could see. It
            // now crowds the band just OUTSIDE the feather, where the
            // water is solid, so the edge of the sea is drawn as a bright
            // rim of wash rather than a fade.
            //
            // AND IT BREATHES WITH THE SWELL. Depth and the scrolling
            // textures alone gave a band that never moved with the wave
            // that made it; the breaker above already rides the crest,
            // and the wash now rides the same one — between WASH_FLOOR
            // of itself in a trough and all of itself under a crest, so
            // the coastline brightens as a wave reaches and fades behind
            // it as the water draws back. The ONE change to the accepted
            // daytime look, asked for in Joshua's 2026-09-07 brief; see
            // the header and WASH_FLOOR.
            float wash = smoothstep(170.0 * ${opts.surf.toFixed(3)}, 95.0 * ${opts.surf.toFixed(3)}, depth)
              * (lace * 0.85 + fizz * 0.35) * pale
              * mix(${WASH_FLOOR.toFixed(2)}, 1.0, smoothstep(-0.6, 0.4, crest));
            foam = clamp(foam + breaker + wash, 0.0, 1.0);
          }` : ''}
          // Open-water caps. The wave map's slope energy runs in thin
          // crest LINES, and a bare threshold paints those lines as white
          // scratches. Gating against the second, independently scrolling
          // sample keeps only the spots where the two patterns cross —
          // beads of foam that wink in and out, not dashes.
          vec3 cn = texture2D(uRipple, tiled(700.0) - uTime * vec2(0.02, 0.028)).xyz * 2.0 - 1.0;
          // Caps fade to NOTHING rather than to a mean: a whitecap is a
          // metre of broken water in open sea, so far enough out there is
          // genuinely none of it in the pixel. The shoreline is the
          // opposite — there is always surf on it.
          float caps = smoothstep(0.75, 1.10, length(cn.xy))
            * smoothstep(0.55, 0.80, surfN) * (1.0 - fineGone);
          foam = clamp(foam + caps * 0.4, 0.0, 1.0);
          // AND THE WHOLE OF IT RIDES THE GATE. Every ingredient at once
          // — lace, fizz, speckle, breaker, swash, caps and the
          // mean-coverage floors they fade to — so beyond the reach there
          // is no foam of any kind left on the water, not even a pale
          // averaged band.
          //
          // TWO GATES, LESSER WINS: the three knees above are the
          // screen-space safeguard and still simplify what a pixel cannot
          // resolve INSIDE the reach; this is the distance gate, and it
          // is the one that reaches zero.
          foam *= micro;
          }
          // THE FOAM'S COLOUR IS DIFFUSE, and three lights it: this
          // literal is the foam under full sun, and at night the lights
          // take it down like everything else. Do not add a light term
          // here — the one that was missing is on the OPACITY below.
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);

          // HOW LIT THIS WATER IS, from the scene's own lights: the sky
          // light and the sun together, as luminance. three folds each
          // light's intensity into its colour before it reaches here,
          // and declares both at file scope in lights_pars_begin, so
          // they are readable in map_fragment without a uniform of our
          // own. A scene with no sky light or no sun is lit in full —
          // the fallback is the look as it was, not a dark one.
          #if NUM_HEMI_LIGHTS > 0 && NUM_DIR_LIGHTS > 0
          float lit = smoothstep(${LIT_LO.toFixed(3)}, ${LIT_HI.toFixed(3)}, dot(hemisphereLights[0].skyColor + directionalLights[0].color, vec3(0.2126, 0.7152, 0.0722)));
          #else
          float lit = 1.0;
          #endif

          // BE's clear-water alpha: see the sand at the waterline, a real
          // body offshore, foam near-opaque.
          diffuseColor.a *= mix(1.0, 1.55, smoothstep(15.0, 320.0, depth));
          diffuseColor.a = min(diffuseColor.a, 0.82);
          // FOAM IS ONLY OPAQUE WHERE THERE IS LIGHT TO MAKE IT SO. With
          // no light term this lift ran at every hour, and at night
          // every pixel with any foam in it became a 0.95-opaque patch
          // over a black seabed — the bright rim along the shoreline in
          // Joshua's phone shot. lit is exactly 1.0 by day, so the
          // daytime look is the accepted one to the bit.
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam * lit);

          // NEARER MEANS MORE VISIBLE, and only nearer.
          //
          // Shin-deep water over bright sand is nearly invisible from
          // inside it: the column you are looking through is a couple of
          // centimetres of very clear water. From a few metres up the
          // same water looks superb, because the slant path through it is
          // long. (Joshua: "several meters up look amazing for the ocean,
          // but right along the shore is still too transparent... by 2.5m
          // away, make it exactly like now.") So this is a
          // VIEWING-DISTANCE term and nothing else, exactly 1.0 by 250
          // units, and it multiplies BEFORE the waterline feather so the
          // edge stays precisely where it was.
          float closeUp = 1.0 - smoothstep(60.0, 250.0, length(vViewPosition));
          diffuseColor.a = min(0.95, diffuseColor.a * mix(1.0, 1.9, closeUp));
          diffuseColor.a *= edge;${swell ? `
          // The near sheet hands over to the far one across its rim — the
          // far sheet's hole is the mirror of this fade.
          diffuseColor.a *= 1.0 - smoothstep(${swell.alphaLo.toFixed(1)}, ${swell.alphaHi.toFixed(1)}, vSheet);` : ''}${opts.hole ? `
          // And the far sheet stands aside where the near one rides.
          diffuseColor.a *= smoothstep(${opts.hole.lo.toFixed(1)}, ${opts.hole.hi.toFixed(1)}, distance(vLocal, uHoleLocal));` : ''}

          if (diffuseColor.a < 0.01) discard;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          normal = normalize(normal + vec3(gRn.x, 0.0, gRn.y) * 0.75 * gBody${swell
    ? ' + vec3(-vSwell.x, 0.0, -vSwell.y) * 1.5' : ''});
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // BE's fresnel sky sheen, capped so far flat water cannot
          // white-band.
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
          // THE SHEEN IS THE SKY'S, not a constant's. The scene's
          // hemisphere light is the sky's own colour at the sky's own
          // brightness, and uSkyGain is the ratio that makes it BE's
          // sheen at a clear noon — so by day this is the accepted
          // colour to float precision, and at night it is a night's.
          // Without a hemisphere light there is no sky to follow and the
          // constant stands, which is the look those scenes always had.
          #if NUM_HEMI_LIGHTS > 0
          vec3 skyLit = hemisphereLights[0].skyColor * uSkyGain;
          #else
          vec3 skyLit = uSky;
          #endif
          totalEmissiveRadiance += skyLit * min(fres, 0.85) * 0.5;
        }`);
  };

  /**
   * Move the sheet's world centre — and everything derived from it, in
   * the same call.
   *
   * THE ONE DOOR, because the derived values are not optional extras: the
   * wave phases ARE half of every wave's argument, and a centre set
   * without them draws the sea of a different coast. Two setters would be
   * two things a caller could do one of.
   */
  const setCentre = (wx: number, wz: number): void => {
    centre.value.set(wx, wz);
    centreWorld = { x: wx, z: wz };
    wavePhase.value = opts.swell.centrePhases(wx, wz);
    fillOct(wx, wz);
    refreshHole();
    refreshEye();
  };

  /**
   * Move the hole the far sheet fades around. World coordinates in; the
   * shader is handed the offset from this sheet, never the position.
   */
  const setHole = (wx: number, wz: number): void => {
    hole.value.set(wx, wz);
    holeWorld = { x: wx, z: wz };
    refreshHole();
  };

  const setEye = (wx: number, wz: number): void => {
    eyeWorld = { x: wx, z: wz };
    refreshEye();
  };

  return { material, clock, centre, setCentre, hole, setHole, setEye, foamNear, foamFar, octaves, advected };
}
