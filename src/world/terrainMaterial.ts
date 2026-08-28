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
 * World units per repeat of a band texture. At true scale a unit is a
 * centimetre, so this is a 4 cm patch of sand or grass — about right
 * for an animal one centimetre long, where ten was a whole hand-span
 * stretched across the view and read as blocks.
 */
export const BAND_TILE = 4;

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
 * and the repeat stops reading as a grid.
 */
export const GRAIN_TILE = 1.1;

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
 * How far above the floor she is, 0 (on it) to 1 (ten metres up and
 * beyond). Drives the bias only — the ground is untouched at rest.
 */
export function setDetailLift(climb: number): void {
  const t = Math.min(1, Math.max(0, climb));
  MIP_BIAS_UNIFORM.value = -MAX_MIP_BIAS * (t * t * (3 - 2 * t));
}

export function setDetailRange(times: number): void {
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
        float far = smoothstep(fadeFrom, fadeTo, texels);

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
    shader.uniforms.bandTile = { value: BAND_TILE };
    // The relief slider flattens the island by scaling the meshes on Y,
    // which moves every world height and would drag the bands down with
    // it — a flattened Kauai would go green to the summit. Dividing it
    // back out keeps sand at the shore and snow on the peaks whatever
    // the slider is doing, so the knob changes the SHAPE and not the map.
    shader.uniforms.relief = reliefUniform;
    shader.uniforms.grainTile = { value: GRAIN_TILE };
    for (const name of BAND_FILES) {
      shader.uniforms[`avg_${name}`] = BAND_AVERAGE[name]
        ?? { value: new THREE.Color(0.5, 0.5, 0.5) };
    }
    shader.uniforms.fadeFrom = FADE_FROM_UNIFORM;
    shader.uniforms.fadeTo = FADE_TO_UNIFORM;
    shader.uniforms.mipBias = MIP_BIAS_UNIFORM;
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
