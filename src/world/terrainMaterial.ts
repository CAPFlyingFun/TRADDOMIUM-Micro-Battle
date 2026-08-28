/**
 * THE GROUND SHE CAN SEE.
 *
 * The island was one flat green, and a flat surface gives the eye
 * nothing to measure motion against — at ant scale you should see soil
 * grain and leaf litter streaming past, and without it a sprint and a
 * crawl look identical. That reads as dull controls when the controls
 * are fine.
 *
 * So the seven band textures are blended by ELEVATION and tiled from
 * WORLD POSITION, the same shape as the Godot build's terrain shader.
 * World-position tiling matters: the mesh is cut into sections, and a
 * per-section parameterisation would print the section grid across the
 * island as a visible seam every time the tiling restarted.
 *
 * It extends MeshStandardMaterial rather than replacing it, so the sun,
 * the hemisphere light and the fog all keep working. Only the diffuse
 * lookup is swapped out.
 */
import * as THREE from 'three';
import { pullBytes } from './fetchBytes';
import type { LoadReport } from '../ui/loadPlan';
import { assetBytes } from '../ui/assetSizes';
import { GRAIN_SIZE } from './groundTexture';
import { UNITS_PER_METRE } from './kauai';

/**
 * World units per repeat of a band texture. About 10 cm — small enough
 * that detail streams past at a walk, which is the entire point, and
 * large enough not to alias into noise at a distance.
 */
/**
 * World units per repeat of a band texture — 1.28 m of authored sand.
 *
 * IT WAS FOUR CENTIMETRES, and that is why the ground turned to beige
 * the moment she left the deck. The maps are 1024 texels across, so a
 * 4 cm tile is 256 texels per centimetre of world. Work out what a
 * pixel covers: at height h the ground footprint of one pixel is
 * about h * 0.00122 units (a 70-degree lens over a thousand pixels),
 * so texels per pixel is 1.25 * h / TILE. At three and a half metres
 * on a 4 cm tile that is a HUNDRED AND TEN texels averaged into every
 * pixel — the mip chain doing its job perfectly and handing back the
 * mean colour of sand, which is beige. No detail radius, mip bias or
 * anisotropy setting can recover a pattern that has been averaged
 * away; the tile itself was the problem.
 *
 * Turn the arithmetic round instead. For comfortable filtering (four
 * texels a pixel or fewer) at three and a half metres the tile must
 * be at least 110 units, and at five metres at least 156. 128 sits in
 * that window AND divides the origin's 1024-unit rebase step exactly,
 * so the pattern cannot jump when the floating origin moves — the one
 * property the old 4 also had and the reason not to simply pick 100.
 *
 * The price is magnification underfoot: at her eye height a pixel
 * covers a twentieth of a texel, so the sand is soft when she stands
 * on it. Joshua accepted that trade explicitly — "a little softness
 * extremely close is acceptable because eventually grass, rocks,
 * debris and insects will provide additional detail" — and those are
 * the right things to answer close-up detail with, not a texture
 * stretched so fine it cannot survive being looked at.
 */
export const BAND_TILE = 128;


/**
 * Shared with every section's shader, so one write re-tints the island.
 * A uniform object rather than a number because three.js reads it by
 * reference each frame.
 */
export const reliefUniform = { value: 1 };

/**
 * The floating origin, for texture tiling — passed MODULO THE TILE,
 * never whole.
 *
 * THE STRIPES THAT RAN EAST TO WEST. The tiling used to hand the
 * shader the raw origin and add it to the rendered position, which
 * rebuilds the FULL world coordinate in float32 — the exact number the
 * floating origin exists to keep away from the GPU. At Kapaʻa the
 * world X is around 2.2 million units, where float32 steps by a
 * quarter of a unit; divided by the four-unit tile that quantises the
 * texture coordinate to jumps of THIRTY-TWO TEXELS. The ground became
 * runs of one repeated texel, locked to the world axes — Joshua's
 * east-west lines — and the derivatives of that staircase are zero
 * then a spike, which is what had been thrashing the mip and
 * anisotropy selection and smearing the ground all along. It looked
 * worst at Mānā and Kapaʻa and mild near the island's centre because
 * the error scales with the magnitude of the world coordinate itself.
 *
 * The remainder is taken here in FLOAT64, where 2.2 million is
 * nothing, and only that remainder — a number smaller than one tile —
 * reaches the shader. Adding it to the local position shifts the
 * pattern by a whole number of tiles relative to true world tiling,
 * which is invisible, and the near cells' local coordinates are a few
 * thousand at most, so the texture coordinate is exact to a fraction
 * of a texel. The far tiers still see big locals, and do not matter:
 * past the detail fade there is no pattern left to quantise.
 *
 * The origin moves in 1024-unit steps. 1024 is a multiple of the
 * four-unit band tile, so the band offset never changes across a
 * rebase; the 1.1-unit grain tile does not divide 1024, so its offset
 * changes by a whole number of tiles — also invisible, and why each
 * tile size needs ITS OWN remainder rather than sharing one.
 */
export const BAND_OFFSET_UNIFORM = { value: new THREE.Vector2() };
export const GRAIN_OFFSET_UNIFORM = { value: new THREE.Vector2() };

/** Fold a world origin into per-tile remainders. Call on every rebase. */
export function setTextureOrigin(x: number, z: number): void {
  const fold = (v: number, tile: number) => ((v % tile) + tile) % tile;
  BAND_OFFSET_UNIFORM.value.set(fold(x, BAND_TILE), fold(z, BAND_TILE));
  GRAIN_OFFSET_UNIFORM.value.set(fold(x, GRAIN_TILE), fold(z, GRAIN_TILE));
}

/**
 * The fine grain is tiled much tighter and at a size that shares no
 * common factor with the band tile, so the two patterns never line up
 * and the repeat stops reading as a grid. Scaled with the band tile
 * (1.1 x 32) so that ratio — 3.64, comfortably irrational-looking —
 * survives the move to a metre-scale authored surface.
 */
export const GRAIN_TILE = 35.2;

/**
 * The tile sizes as LIVE uniforms, so the authored scale can be SWEPT
 * on a running build rather than guessed at through rebuilds — which
 * is how the 4 cm tile survived this long unexamined. The pair must
 * stay non-commensurate (see above), so setTileScale moves both by
 * one ratio.
 */
export const BAND_TILE_UNIFORM = { value: BAND_TILE };
export const GRAIN_TILE_UNIFORM = { value: GRAIN_TILE };

/** Set the band tile in world units; the grain follows in proportion. */
export function setTileScale(bandUnits: number): void {
  const scale = Math.max(0.5, bandUnits) / BAND_TILE;
  BAND_TILE_UNIFORM.value = BAND_TILE * scale;
  GRAIN_TILE_UNIFORM.value = GRAIN_TILE * scale;
}

/**
 * WHERE THE FINE DETAIL STOPS BEING DETAIL AND STARTS BEING NOISE.
 *
 * Measured in TILES PER PIXEL, not in metres, and that distinction is
 * the whole fix. A four-centimetre tile stretched across fifty-six
 * kilometres repeats about five thousand times in a two-hundred-metre
 * view; mip-mapping copes with that seen head-on, but the ground is
 * almost never seen head-on. At a grazing angle one pixel's footprint
 * is enormously longer than it is wide, far past the sixteen-to-one an
 * anisotropic filter will do, so the hardware blurs along one axis and
 * keeps detail along the other — and the ground turns into long streaks
 * running to the horizon. Joshua found it at Mānā Flats, which is the
 * flattest ground on the island and therefore the most grazing.
 *
 * A distance threshold would not have fixed it, because the same
 * distance is fine on a hillside and ruinous on a plain. The pixel
 * FOOTPRINT knows the difference, and the shader can ask for it
 * directly. Past this many tiles in one pixel there is no detail left
 * to resolve, only aliasing, so the texture gives way to its own
 * average colour and the ground goes quietly smooth.
 */
/**
 * The fade thresholds, in TEXELS PER PIXEL — and the unit is the story.
 *
 * Every earlier version of this fade measured the footprint in TILES
 * per pixel and reasoned about it as though small numbers meant
 * magnification. They did not. The band maps are 512 texels across, so
 * 0.4 tiles per pixel — where the old fade BEGAN — is two hundred and
 * five source texels averaged into every screen pixel, minification so
 * deep the streaking was long established. Even the "extreme" test
 * value of 0.05 was twenty-six texels a pixel. The whole range the
 * fade operated over was past the point where the damage happens,
 * which is why no amount of tuning it ever reached the smear. Joshua
 * caught the unit error from the screenshots.
 *
 * In texels the scale is meaningful: at one texel per pixel the
 * texture is shown at its native resolution; hardware filtering is
 * comfortable for a few times that; by eight to sixteen it is
 * averaging hundreds of texels down a grazing footprint and the
 * high-contrast maps turn to streaks. So the fade now starts where
 * filtering starts to strain and is done before the smear territory.
 *
 * Tuned from headless renders; the phone gets the final word.
 */
/**
 * RAISED AGAIN, 16x, AND THIS TIME AGAINST A MEASUREMENT.
 *
 * Every previous value here was picked by looking at renders, which
 * turns out to be a poor way to judge a threshold whose units are
 * texels per pixel. `npm run probe:reach` now answers the question
 * directly — it unprojects the centre column onto the ground and
 * reports the footprint against distance — and what it found is that
 * the 8-to-48 shipped here was fully flat by NINE CENTIMETRES. Barely
 * past her own body. That is what Joshua meant by "not enough
 * texture": there was almost none of it, anywhere but underfoot.
 *
 * The cause is the camera, which sits FOUR CENTIMETRES above her. At
 * that height the ground falls away to a grazing angle within a body
 * length, and the footprint grows with the square of the distance, so
 * by half a metre one pixel is already averaging several hundred
 * texels. Nothing about the maps or the filtering was wrong; the range
 * they were being asked to cover was simply a tenth of what it should
 * have been.
 *
 * 16x is where the measurement and the renders agree. Full detail now
 * reaches 21 cm and the hand-over completes at 64 cm, seven times the
 * old radius. 9x and 16x are both clean; 36x brings back the diagonal
 * smearing this whole fade exists to prevent, plainly visible in a
 * side-by-side crop. So the ceiling is real and it is a little above
 * here, which is also why the dial below no longer goes to 4x.
 */
const FADE_FROM_TEXELS = 128.0;
const FADE_TO_TEXELS = 768.0;

/**
 * The fade thresholds as LIVE uniforms, scaled by the detail-range
 * dial in settings.
 *
 * A dial rather than a constant for the usual reason (see settings.ts:
 * anything the player can feel gets tuned on the device, not by
 * redeploying). Distance scales with the SQUARE ROOT of the multiplier
 * — 4x the texels is 2x the radius — so the dial's 0.25-to-2 spans
 * roughly 32 cm to 1.4 m of reach. The top of that range is now a
 * MEASURED edge rather than a guess: 36x the baseline streaks, so 2x
 * on the dial is about as far as the maps will honestly go.
 */
export const FADE_FROM_UNIFORM = { value: FADE_FROM_TEXELS };
export const FADE_TO_UNIFORM = { value: FADE_TO_TEXELS };

/**
 * WHERE THE SAFEGUARD SITS, and it is a CONSTANT on purpose.
 *
 * This threshold answers a physical question — can this pattern be
 * resolved in this pixel, or will a grazing footprint smear it — and
 * the answer does not depend on what the player asked for. While the
 * detail slider also scaled it, the slider had two meanings at once
 * and neither could be tested alone. The slider owns the RADIUS; this
 * owns the smear. Set to the value the shipped default (a dial of 2)
 * used to produce, so the tuned look is unchanged.
 */
const SAFEGUARD_TEXELS = 2;

/**
 * HOW MUCH SHARPER A MIP TO ASK FOR — negative is sharper, in mip
 * levels, and each level is a HALVING of the blur.
 *
 * The fade above is not what washes the ground out when she flies.
 * Measured at three and a half metres: one pixel covers about seventy
 * texels, which is far below the fade's own threshold — the fade
 * never fires. What blurs it is the mip chain doing exactly its job,
 * averaging those seventy texels into one. So the honest lever is to
 * ask the sampler for a sharper level than it would choose, which is
 * a LOD bias, and pay for it in a little shimmer.
 *
 * Joshua: "1 m vs 3.5 m off the ground looked the same even with
 * details in settings at 200%... I want to raise the details before
 * it fades around 10 meters AGL/AWL." The dial could never have
 * fixed this; it scales the wrong thing.
 *
 * ZERO ON THE GROUND, always: underfoot the mip chain is already
 * picking a sharp level and biasing it would only alias.
 */
export const MIP_BIAS_UNIFORM = { value: 0 };

/** The sharpest we ask for — two levels, i.e. four times the detail. */
export const MAX_MIP_BIAS = 2;

/**
 * THE DETAIL RADIUS: how far from the QUEEN, in world units, terrain
 * still carries its detail. This is what the settings slider means,
 * and it means it in METRES OUTWARD IN EVERY DIRECTION — Joshua:
 * "25% = 2.5 m ... 200% = 20 m", i.e. radius = setting x 10 m.
 *
 * Why this exists beside the texel fade rather than instead of it.
 * The texel fade answers "is this pattern physically resolvable in
 * this pixel", which is a real question and the only defence against
 * smearing a grazing footprint — it stays, as a SAFEGUARD. But it is
 * a footprint threshold, not a distance, so the reach it produces
 * moves with the camera's height and angle, and the slider inherited
 * that: a dial that was supposed to say "detail out to twenty
 * metres" instead said "detail until the maths says stop", which is
 * why altitude quietly redefined it. Now the dial owns a radius, the
 * footprint owns a safeguard, and whichever wants LESS detail wins.
 */
export const DETAIL_RADIUS_UNIFORM = { value: 1_000 };
/**
 * Where the queen is, in RENDERED coordinates and in all three of
 * them — the same frame `vGround` is in, which is the only reason
 * this can be a subtraction in the shader. World coordinates would be
 * the floating-origin trap all over again (see setTextureOrigin).
 */
export const QUEEN_UNIFORM = { value: new THREE.Vector3() };

/** Metres of radius per unit of the settings dial. */
export const METRES_PER_DIAL = 10;

/**
 * The dial, in world units of radius. 0.25 -> 2.5 m, 2 -> 20 m.
 *
 * The floor is a hair above zero, NOT one: `Math.max(1, dial)` shipped
 * in v0.0.86 and silently pinned the bottom three settings — 25, 50
 * and 75 per cent all resolved to ten metres. It survived its own
 * visual check because the dial ALSO scaled the texel safeguard back
 * then, so the ground did visibly change at 25% — just not for the
 * reason being tested. Two knobs on one slider is how a test lies to
 * you; the safeguard is a fixed physical guard now (see
 * SAFEGUARD_TEXELS) and this is the only thing the dial moves.
 */
export function setDetailRadius(dial: number): void {
  DETAIL_RADIUS_UNIFORM.value
    = Math.max(0.01, dial) * METRES_PER_DIAL * UNITS_PER_METRE;
}

/**
 * The bias is RETIRED as an altitude trick — height must not redefine
 * what the detail dial promised — but the uniform stays wired at zero
 * so the sampling path is one code path rather than two, and so a
 * future per-material sharpen has somewhere to live.
 */
export function setDetailRange(times = SAFEGUARD_TEXELS): void {
  const factor = Math.max(0.1, times);
  FADE_FROM_UNIFORM.value = FADE_FROM_TEXELS * factor;
  FADE_TO_UNIFORM.value = FADE_TO_TEXELS * factor;
}

/**
 * Texels across one band map. All seven ship at 1024 — Beyond
 * Extinction's HD island set for the six it has, and the snow that was
 * already this size. 1024 is the mobile compromise on purpose: double
 * the sharpness beside the Queen for about 39 MB of GPU memory across
 * the whole set, where the 4K textures a desktop could afford would be
 * over 600 — the exact trap BE's own web build had to dig itself out
 * of. This constant feeds the detail fade, so it MUST follow the maps:
 * leaving it at 512 after this upgrade would have quietly halved the
 * fade's reach in real texels.
 */
const BAND_TEXELS = 1024;

/**
 * How much tighter the grain is tiled than the bands.
 *
 * THE BUG THIS FIXES. The grain repeats every 1.1 units against the
 * bands' 4, so a pixel covers three and a half times as much of it —
 * and it therefore turns to noise three and a half times sooner. Both
 * were being faded on the BANDS' schedule, so at every distance where
 * the bands were still fine the grain was already streaking, which is
 * why the smearing came back in places the first fix had cleaned up.
 * The comment beside it even said the grain "aliases sooner and has to
 * go sooner"; the code handed it the same number anyway.
 */
const GRAIN_RATIO = BAND_TILE / GRAIN_TILE;

/**
 * EACH BAND'S OWN AVERAGE COLOUR, filled in when its image lands.
 *
 * The distance fade needs something to fade TO, and the honest answer
 * is the colour that band actually is. Read off the loaded image rather
 * than hand-picked, so re-baking a texture cannot leave the far
 * hillside a colour the near one stopped being. The opening value is a
 * mid grey, used only in the moment before the image arrives.
 */
export const BAND_AVERAGE: Record<string, { value: THREE.Color }> = {};

/** Which file carries which band, ordered as they stack up the island. */
export const BAND_FILES = [
  'reef', 'sand', 'grass', 'jungle', 'cliff', 'mountain', 'snow',
] as const;

/**
 * Band edges in WORLD units, from the same real Kauai elevations
 * heightfield.ts uses. Written in METRES and converted, because these
 * were bare world-unit literals from the 1:1000 days: at true scale a
 * queen standing 78 centimetres above the sea was inside the CLIFF and
 * MOUNTAIN bands, so a beach rendered as blocky grey rubble.
 *
 * The feather either side is what keeps a biome change a gradient
 * rather than a contour line drawn round the hill.
 */
const M = UNITS_PER_METRE;
/**
 * Metres to a GLSL float literal.
 *
 * The `.toFixed(1)` is load-bearing: interpolating `1200 * 100` gives
 * "120000", which GLSL reads as an int, and smoothstep wants floats.
 * The shader failed to compile and the whole terrain vanished.
 */
const m = (metres: number) => (metres * M).toFixed(1);

const EDGES = `
  float wReef  = 1.0 - smoothstep(${m(-3.5)}, ${m(0.5)}, h);
  float wSand  = span(h, ${m(-0.5)}, ${m(12)}, ${m(3.5)});
  float wGrass = span(h, ${m(10)}, ${m(220)}, ${m(14)});
  float wJung  = span(h, ${m(200)}, ${m(700)}, ${m(40)});
  float wCliff = span(h, ${m(660)}, ${m(1000)}, ${m(60)});
  float wMount = span(h, ${m(950)}, ${m(1280)}, ${m(80)});
  float wSnow  = smoothstep(${m(1200)}, ${m(1450)}, h);
`;

/**
 * Build the terrain material.
 *
 * @param textures the seven band maps, keyed by BAND_FILES
 * @param grain the fine tiling detail that breaks up the band repeat
 * @param nearCut discard anything closer to the camera than this, in
 *   world units. THE FIX FOR TWO GROUNDS: the distance tiers all cover
 *   the same island at different resolutions, so without a cut they
 *   overlap and the coarse one pokes through the fine one. She flew
 *   through one surface and landed on another, and the far one slid
 *   about as the camera turned because its vertices are kilometres
 *   apart. Each tier now draws only where it is the best one available.
 */
/**
 * THE GROUND'S STRING SURGERY, on its own where a test can reach it.
 *
 * Pulled out of onBeforeCompile so a test can compose it directly: a
 * `.replace` against three.js source that stops matching is not an
 * error, it is silence, and the ground comes back subtly wrong with a
 * clean build. tests/groundTexture.test.ts composes it exactly as the
 * material does and checks the injection landed.
 */
export function groundShader(
  vert: string, frag: string,
): { vertexShader: string; fragmentShader: string } {
  let vertexShader = vert;
  let fragmentShader = frag;
    vertexShader = vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xyz;',
      );

    fragmentShader = fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGround;
        uniform sampler2D t_reef, t_sand, t_grass, t_jungle;
        uniform sampler2D t_cliff, t_mountain, t_snow, t_grain;
        uniform float bandTile;
        uniform float relief;
        uniform float grainTile;
        uniform float fadeFrom, fadeTo, bandTexels, grainTexelScale;
        uniform float mipBias;
        #define WET_REACH 26.0
        uniform float detailRadius;
        uniform vec3 queenAt;
        uniform vec3 avg_reef, avg_sand, avg_grass, avg_jungle;
        uniform vec3 avg_cliff, avg_mountain, avg_snow;
        uniform vec2 bandOffset, grainOffset;
        uniform float nearCut;

        float span(float x, float lo, float hi, float feather) {
          return smoothstep(lo - feather, lo + feather, x)
               * (1.0 - smoothstep(hi - feather, hi + feather, x));
        }`)
      .replace('#include <map_fragment>', `
        // Where a finer tier exists, this one is not wanted at all.
        //
        // A SQUARE test, because the tier inside is a square window. A
        // radial cut either leaves gaps along the axes or doubles up in
        // the corners — and doubling up in the corners is the bug this
        // exists to fix, just moved somewhere harder to notice.
        vec2 fromEye = abs(vGround.xz - cameraPosition.xz);
        if (nearCut > 0.0 && max(fromEye.x, fromEye.y) < nearCut) discard;
        vec2 bandUv = (vGround.xz + bandOffset) / bandTile;
        float h = vGround.y / max(relief, 0.0001);
        ${EDGES}
        float total = wReef + wSand + wGrass + wJung + wCliff + wMount + wSnow;
        // Below the deepest band and above the highest, the weights all
        // fall to zero and the ground would render black. Hold the
        // nearest band rather than letting that happen.
        if (total < 0.001) {
          wReef = h < 0.0 ? 1.0 : 0.0;
          wSnow = h < 0.0 ? 0.0 : 1.0;
          total = 1.0;
        }
        // SAMPLED WITH A BIAS, so a flying queen gets a sharper mip
        // than the footprint would choose for her. Zero on the ground.
        vec3 ground =
            texture2D(t_reef, bandUv, mipBias).rgb * wReef
          + texture2D(t_sand, bandUv, mipBias).rgb * wSand
          + texture2D(t_grass, bandUv, mipBias).rgb * wGrass
          + texture2D(t_jungle, bandUv, mipBias).rgb * wJung
          + texture2D(t_cliff, bandUv, mipBias).rgb * wCliff
          + texture2D(t_mountain, bandUv, mipBias).rgb * wMount
          + texture2D(t_snow, bandUv, mipBias).rgb * wSnow;
        ground /= total;

        // HOW MANY SOURCE TEXELS THIS PIXEL IS AVERAGING, along the
        // long axis of its footprint — the axis anisotropic filtering
        // strains on and the axis the streaks run along. The
        // derivatives give the footprint in tiles; times the map's
        // resolution it becomes texels, which is the unit the eye
        // actually cares about: one texel a pixel is the texture at
        // its native sharpness, hundreds is a smear whatever the
        // hardware claims to filter.
        vec2 duvdx = dFdx(bandUv);
        vec2 duvdy = dFdy(bandUv);
        float texels = max(length(duvdx), length(duvdy)) * bandTexels;
        // TWO REASONS TO STOP DRAWING DETAIL, and the stronger wins.
        //
        // The FOOTPRINT says whether the pattern can be resolved in
        // this pixel at all — the safeguard against smearing a grazing
        // view, and it must stay whatever the dial says.
        //
        // The RADIUS is what the player asked for: detail out to so
        // many metres from the queen, in every direction, at any
        // altitude. Measured from her rendered position to this
        // fragment, feathered over the last third so the edge of the
        // region is never a ring.
        float far = smoothstep(fadeFrom, fadeTo, texels);
        // THREE dimensions, not two. A horizontal distance says the
        // ground directly beneath a queen ten metres up is zero metres
        // away, which is not what "ten metres in every direction"
        // means — at altitude it quietly handed her a bigger region
        // than she asked for.
        float fromQueen = distance(vGround, queenAt);
        // Feathered over the last third, so the edge is never a ring.
        far = max(far, smoothstep(detailRadius * 0.7, detailRadius, fromQueen));

        // Past that, there is nothing left to resolve. Fade to the
        // colour the band actually is, so the far hillside stays the
        // right green instead of dissolving into streaks.
        // NOT NAMED f-l-a-t. That is an interpolation qualifier in
        // GLSL ES 3.0, so declaring a variable with the name is a
        // syntax error, the shader fails to compile, and the terrain
        // silently disappears — which is precisely how this read on the
        // first attempt: an ant floating in an empty blue world.
        vec3 mean =
            avg_reef * wReef + avg_sand * wSand + avg_grass * wGrass
          + avg_jungle * wJung + avg_cliff * wCliff
          + avg_mountain * wMount + avg_snow * wSnow;
        ground = mix(ground, mean / total, far);

        // UNDERWATER GROUND. Below sea level the bed is wet and lit
        // through a column of sea: it cools toward blue-green over the
        // first arm's-reach of depth and darkens as the light dies
        // further down. This is what makes shin-deep water over bright
        // sand READ as water even where the sheet above it is nearly
        // clear (Joshua: "too transparent and hard to see... it's all
        // sand") — and it survives the far fade above because it is
        // applied after it. Colour only; the heightfield is untouched.
        if (h < 0.0) {
          float dip = smoothstep(0.0, 90.0, -h);
          float deep = smoothstep(90.0, 700.0, -h);
          ground *= mix(vec3(1.0), vec3(0.60, 0.78, 0.80), dip);
          ground *= mix(1.0, 0.45, deep);
        }
        // WET SAND, so the waterline can be READ.
        //
        // Joshua: "it is difficult to see a clear visual boundary
        // between dry sand, wet sand, shallow water and breaking
        // water." Real beaches are legible because the swash leaves a
        // dark, saturated band above the water that dries out inland —
        // the eye reads DRY, WET, WATER without being told. That band
        // is free here: it is a function of height above sea level,
        // and it costs no geometry and no second texture. Darkest right
        // at the water and gone by the swash's reach, so it reads as a
        // wet margin rather than as a painted stripe.
        float wet = 1.0 - smoothstep(0.0, WET_REACH, max(h, 0.0));
        wet *= smoothstep(-40.0, 4.0, h);   // under water the tint above owns it
        ground *= mix(vec3(1.0), vec3(0.62, 0.66, 0.68), wet * 0.9);

        // MACRO VARIATION — the detail that survives altitude.
        //
        // The bands tile at four centimetres and the grain at one, and
        // both are the right size for an animal standing on them. From
        // three and a half metres up a pixel covers about a hundred and
        // ten texels: not a fade, just the mip chain averaging honestly,
        // and NO bias can recover a pattern that small. What the eye
        // can still resolve up there is something half a metre wide —
        // and the ground had nothing at that scale, which is why one
        // metre and three and a half looked identical however high the
        // detail dial went.
        //
        // So a single extra sample of the grain map, tiled forty times
        // coarser, modulates the ground's brightness into patches and
        // drifts about half a metre across. It fades IN exactly as the
        // fine detail fades out, so it costs nothing underfoot (where
        // there is real texture) and is the whole reason the ground
        // still reads as ground from the air.
        float macroMix = smoothstep(30.0, 200.0, texels);
        if (macroMix > 0.001) {
          float macro = texture2D(
            t_grain, (vGround.xz + grainOffset) / (grainTile * 40.0)).g;
          ground *= mix(1.0, 0.72 + 0.62 * macro, macroMix);
        }

        // The fine grain rides on top at a tile size that shares no
        // factor with the band tile, so close up there is always
        // something moving past even mid-way through one band tile.
        //
        // ON ITS OWN SCHEDULE. Same pixel and the same derivatives, but
        // the grain is tiled several times tighter, so its footprint is
        // that much larger and it becomes noise that much sooner. It
        // used to be faded on the BANDS' number, which meant that at
        // every distance where the bands were still fine the grain was
        // already streaking. (No backticks in here: this is inside a
        // template literal, and one of those ends the shader.)
        float grainFar = smoothstep(fadeFrom, fadeTo, texels * grainTexelScale);
        float g = texture2D(t_grain, (vGround.xz + grainOffset) / grainTile, mipBias).g;
        ground *= mix(0.80 + g * 0.42, 1.0, grainFar);

        diffuseColor.rgb *= ground;
      `);
  return { vertexShader, fragmentShader };
}

export function terrainMaterial(
  textures: Record<string, THREE.Texture>,
  grain: THREE.Texture,
  nearCut = 0,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    // The vertex colours no longer carry the biome tint — the textures
    // do. What is left there is shading: the soil showing through where
    // the ground steepens, and the macro relief mottle.
    vertexColors: true,
    roughness: 0.95,
  });

  material.onBeforeCompile = (shader) => {
    for (const name of BAND_FILES) {
      shader.uniforms[`t_${name}`] = { value: textures[name] };
    }
    shader.uniforms.t_grain = { value: grain };
    shader.uniforms.bandTile = BAND_TILE_UNIFORM;
    // The relief slider flattens the island by scaling the meshes on Y,
    // which moves every world height and would drag the bands down with
    // it — a flattened Kauai would go green to the summit. Dividing it
    // back out keeps sand at the shore and snow on the peaks whatever
    // the slider is doing, so the knob changes the SHAPE and not the map.
    shader.uniforms.relief = reliefUniform;
    shader.uniforms.grainTile = GRAIN_TILE_UNIFORM;
    for (const name of BAND_FILES) {
      shader.uniforms[`avg_${name}`] = BAND_AVERAGE[name]
        ?? { value: new THREE.Color(0.5, 0.5, 0.5) };
    }
    shader.uniforms.fadeFrom = FADE_FROM_UNIFORM;
    shader.uniforms.fadeTo = FADE_TO_UNIFORM;
    shader.uniforms.mipBias = MIP_BIAS_UNIFORM;
    shader.uniforms.detailRadius = DETAIL_RADIUS_UNIFORM;
    shader.uniforms.queenAt = QUEEN_UNIFORM;
    shader.uniforms.bandTexels = { value: BAND_TEXELS };
    // The grain is also 512 texels but tiled 3.6 times tighter, so its
    // texel footprint is that much larger at the same distance and it
    // fades that much sooner — on the SAME texel thresholds, which is
    // the point of working in texels: one perceptual scale for both.
    shader.uniforms.grainTexelScale = {
      value: GRAIN_RATIO * (GRAIN_SIZE / BAND_TEXELS),
    };
    // WHERE THE WORLD ACTUALLY IS. Vertices reach the shader measured
    // from the floating origin, so tiling straight off them would slide
    // the whole ground texture sideways every time the origin moved —
    // and it moves in 1024-unit steps, which no tile size divides.
    shader.uniforms.bandOffset = BAND_OFFSET_UNIFORM;
    shader.uniforms.grainOffset = GRAIN_OFFSET_UNIFORM;
    shader.uniforms.nearCut = { value: nearCut };
    const ground = groundShader(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = ground.vertexShader;
    shader.fragmentShader = ground.fragmentShader;
  };

  return material;
}

/**
 * Read a band's average colour off the image itself.
 *
 * Drawn small and averaged rather than trusted to a one-pixel downscale,
 * because how a browser filters an extreme reduction is its own
 * business and not always a mean. Failure is not worth interrupting
 * anything for: the opening grey is a perfectly serviceable colour to
 * fade a distant hillside to, and the near ground is unaffected either
 * way.
 */
function measureAverage(name: string, texture: THREE.Texture): void {
  const image = texture.image as CanvasImageSource | undefined;
  if (!image) return;
  try {
    const size = 8;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const paper = canvas.getContext('2d', { willReadFrequently: true });
    if (!paper) return;
    paper.drawImage(image, 0, 0, size, size);
    const { data } = paper.getImageData(0, 0, size, size);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    const pixels = data.length / 4;
    // The maps are sRGB and the shader works in linear light, so the
    // average has to be converted or the far ground reads too bright.
    BAND_AVERAGE[name].value
      .setRGB(r / pixels / 255, g / pixels / 255, b / pixels / 255)
      .convertSRGBToLinear();
  } catch {
    // A tainted canvas or a blocked context. Keep the grey.
  }
}

/**
 * What a band load hands back: the textures now, and a promise for the
 * moment they actually have pixels in them.
 *
 * Both halves matter. The textures have to exist immediately because
 * the material is built around them, and the promise has to exist
 * because UNTIL IT RESOLVES THEY SAMPLE AS BLACK — which is the
 * half-black world Joshua photographed, not a bug in the shader but
 * the shader faithfully drawing nothing.
 */
export interface BandLoad {
  readonly textures: Record<string, THREE.Texture>;
  readonly ready: Promise<void>;
}

/**
 * Fallback size of one band map, for a file nobody baked a size for.
 *
 * IT USED TO BE THE ONLY ANSWER, and being close to the real AVERAGE
 * turned out not to be enough: snow.jpg is 143 KB under it and
 * grass.jpg 84 KB over, so the declared total lurched by that much as
 * each file landed, in whatever order the browser finished them.
 * Joshua watched it: "it said 5.0mb, but then dropped to 4.6mb". The
 * real sizes are baked now (see assetSizes.ts) and this is only what
 * happens if someone adds a band without re-running the script.
 */
const BAND_GUESS = 445_000;

/** Load the band maps, tiling and mip-mapped, from the public folder. */
export function loadBands(
  renderer: THREE.WebGLRenderer,
  report?: LoadReport,
): BandLoad {
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const textures: Record<string, THREE.Texture> = {};
  const waiting: Promise<unknown>[] = [];

  for (const name of BAND_FILES) {
    BAND_AVERAGE[name] ??= { value: new THREE.Color(0.5, 0.5, 0.5) };
    const texture = new THREE.Texture();
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    // The ground is seen at a grazing angle almost all the time, which
    // is exactly where a tiled map turns to mush without this.
    texture.anisotropy = anisotropy;
    textures[name] = texture;

    const id = `band:${name}`;
    const url = `${import.meta.env.BASE_URL}kauai-tex/${name}.jpg`;
    // Pulled as bytes first so the loading screen has a real number to
    // show, then handed to the ordinary loader as a blob — everything
    // below this line is the same work it always did, and the blob is
    // same-origin so the average-colour measurement can still read the
    // canvas back.
    waiting.push(
      pullBytes(
        url,
        (size) => report?.resize(id, size),
        (got) => report?.advance(id, got),
      )
        .then((pull) => new Promise<void>((settled) => {
          loader.load(
            pull.url,
            (loaded) => {
              texture.image = loaded.image;
              texture.needsUpdate = true;
              measureAverage(name, texture);
              URL.revokeObjectURL(pull.url);
              report?.finish(id);
              settled();
            },
            undefined,
            () => { URL.revokeObjectURL(pull.url); report?.finish(id); settled(); },
          );
        }))
        // A band that will not load leaves its average grey and the
        // ground a little wrong. That is a far better outcome than a
        // loading screen that never lifts.
        .catch((why) => {
          console.warn(`the ${name} band did not load`, why);
          report?.finish(id);
        }),
    );
  }

  return { textures, ready: Promise.all(waiting).then(() => undefined) };
}

/** Declare the band downloads on a plan, before any of them start. */
export function planBands(report: LoadReport): void {
  for (const name of BAND_FILES) {
    const baked = assetBytes(`kauai-tex/${name}.jpg`);
    // FIRM when the bake knows the file: the wire's numbers are
    // transport trivia then, not corrections. See LoadPlan.resize.
    report.add(`band:${name}`, 'Ground textures', baked ?? BAND_GUESS, true, baked !== null);
  }
}
