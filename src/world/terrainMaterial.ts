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
import { GRAIN_SIZE } from './groundTexture';
import { UNITS_PER_METRE } from './kauai';

/**
 * World units per repeat of a band texture. About 10 cm — small enough
 * that detail streams past at a walk, which is the entire point, and
 * large enough not to alias into noise at a distance.
 */
/**
 * World units per source repeat of a band texture. At true scale a unit
 * is a centimetre, so this is a 4 cm patch of sand or grass. A single
 * square repeat at that scale read as a checkerboard, so the shader
 * below samples deterministic rotated, incommensurate copies rather
 * than exposing this source lattice directly.
 */
export const BAND_TILE = 4;

/**
 * Shared with every section's shader, so one write re-tints the island.
 * A uniform object rather than a number because three.js reads it by
 * reference each frame.
 */
export const reliefUniform = { value: 1 };

/**
 * Floating-origin phases for the rotated texture lattices.
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
 * Folding x and z before rotating is not equivalent: an axis-aligned
 * whole tile becomes a fractional shift after rotation. Rotate in
 * FLOAT64 here, then retain the fractional UV phase. The shader adds it
 * to the rotated LOCAL coordinate, reproducing R * world / tile modulo
 * one without ever sending the large world coordinate to the GPU.
 */
export const BAND_OFFSET_UNIFORM = { value: new THREE.Vector2() };
export const GRAIN_OFFSET_UNIFORM = { value: new THREE.Vector2() };
export const BAND_WARP_PHASE_UNIFORM = { value: new THREE.Vector2() };
export const GRAIN_WARP_PHASE_UNIFORM = { value: new THREE.Vector2() };

/** Row-major forms of the exact matrices authored in the shader. */
export const BAND_ROTATION = [0.8660254, 0.5, -0.5, 0.8660254] as const;
export const GRAIN_ROTATION = [0.7071068, 0.7071068, -0.7071068, 0.7071068] as const;

/** Radians per world unit; non-axis-aligned and unrelated to either tile size. */
export const BAND_WARP_FREQUENCIES = [0.0191, 0.0277, -0.0233, 0.0149] as const;
export const GRAIN_WARP_FREQUENCIES = [0.0317, -0.0211, 0.0173, 0.0367] as const;

/** Fold rotated UV and world-wave phases. Call on every rebase. */
export function setTextureOrigin(x: number, z: number): void {
  const fold = (v: number, period: number) => ((v % period) + period) % period;
  const rotated = (
    matrix: readonly [number, number, number, number],
    tile: number,
  ) => [
    fold((matrix[0] * x + matrix[1] * z) / tile, 1),
    fold((matrix[2] * x + matrix[3] * z) / tile, 1),
  ] as const;
  const phase = (frequencies: readonly [number, number, number, number]) => [
    fold(x * frequencies[0] + z * frequencies[1], Math.PI * 2),
    fold(x * frequencies[2] + z * frequencies[3], Math.PI * 2),
  ] as const;
  BAND_OFFSET_UNIFORM.value.fromArray(rotated(BAND_ROTATION, BAND_TILE));
  GRAIN_OFFSET_UNIFORM.value.fromArray(rotated(GRAIN_ROTATION, GRAIN_TILE));
  BAND_WARP_PHASE_UNIFORM.value.fromArray(phase(BAND_WARP_FREQUENCIES));
  GRAIN_WARP_PHASE_UNIFORM.value.fromArray(phase(GRAIN_WARP_FREQUENCIES));
}

/**
 * The fine grain is tiled much tighter than the bands. Its source tile
 * is also rotated and blended in the material: merely choosing 1.1
 * against 4 delayed the common repeat, but did not remove the two
 * axis-aligned square lattices from a close ant-scale view.
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
    shader.uniforms.bandTexels = { value: BAND_TEXELS };
    shader.uniforms.grainTexels = { value: GRAIN_SIZE };
    // WHERE THE WORLD ACTUALLY IS. Vertices reach the shader measured
    // from the floating origin, so tiling straight off them would slide
    // the whole ground texture sideways every time the origin moved —
    // and it moves in 1024-unit steps, which no tile size divides.
    shader.uniforms.bandOffset = BAND_OFFSET_UNIFORM;
    shader.uniforms.grainOffset = GRAIN_OFFSET_UNIFORM;
    shader.uniforms.bandWarpPhase = BAND_WARP_PHASE_UNIFORM;
    shader.uniforms.grainWarpPhase = GRAIN_WARP_PHASE_UNIFORM;
    shader.uniforms.nearCut = { value: nearCut };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGround;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGround;
        uniform sampler2D t_reef, t_sand, t_grass, t_jungle;
        uniform sampler2D t_cliff, t_mountain, t_snow, t_grain;
        uniform float bandTile;
        uniform float relief;
        uniform float grainTile;
        uniform float fadeFrom, fadeTo, bandTexels, grainTexels;
        uniform vec3 avg_reef, avg_sand, avg_grass, avg_jungle;
        uniform vec3 avg_cliff, avg_mountain, avg_snow;
        uniform vec2 bandOffset, grainOffset, bandWarpPhase, grainWarpPhase;
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
         // The source maps are square, but their UVs are not: rotate
         // then smoothly warp one world-deterministic coordinate. This
         // breaks the visible straight repeat lattice without doubling
         // the eight texture reads on a phone.
         mat2 bandTurn = mat2(0.8660254, -0.5, 0.5, 0.8660254);
         vec2 bandUv = bandTurn * vGround.xz / bandTile + bandOffset;
         bandUv += vec2(
           sin(mod(dot(vGround.xz, vec2(0.0191, 0.0277)) + bandWarpPhase.x, 6.2831853)),
           sin(mod(dot(vGround.xz, vec2(-0.0233, 0.0149)) + bandWarpPhase.y, 6.2831853))
         ) * 0.075;
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
         vec3 ground = mean / total;

         // Its footprint is also decided before sampling, allowing far
         // transition, middle and backdrop fragments to stop at averages.
         mat2 grainTurn = mat2(0.7071068, -0.7071068, 0.7071068, 0.7071068);
         vec2 grainUv = grainTurn * vGround.xz / grainTile + grainOffset;
         grainUv += vec2(
           sin(mod(dot(vGround.xz, vec2(0.0317, -0.0211)) + grainWarpPhase.x, 6.2831853)),
           sin(mod(dot(vGround.xz, vec2(0.0173, 0.0367)) + grainWarpPhase.y, 6.2831853))
         ) * 0.09;
         float grainFootprint = max(length(dFdx(grainUv)), length(dFdy(grainUv))) * grainTexels;
        float grainFar = smoothstep(fadeFrom, fadeTo, grainFootprint);
         if (far < 0.999) {
           vec3 detailed =
               texture2D(t_reef, bandUv).rgb * wReef
             + texture2D(t_sand, bandUv).rgb * wSand
             + texture2D(t_grass, bandUv).rgb * wGrass
             + texture2D(t_jungle, bandUv).rgb * wJung
             + texture2D(t_cliff, bandUv).rgb * wCliff
             + texture2D(t_mountain, bandUv).rgb * wMount
             + texture2D(t_snow, bandUv).rgb * wSnow;
           ground = mix(detailed / total, ground, far);
           if (grainFar < 0.999) {
             float g = texture2D(t_grain, grainUv).g;
             ground *= mix(0.80 + g * 0.42, 1.0, grainFar);
           }
         }

        diffuseColor.rgb *= ground;
      `);
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
 * Rough size of one band map, until the response says otherwise.
 *
 * Close to the real average on purpose. The browser only opens so many
 * connections at once, so the later files' headers do not land until
 * the earlier ones finish — the declared total is a mix of guesses and
 * facts for most of the load, and a guess that is nearly right keeps it
 * from visibly drifting while the player reads it.
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
    report.add(`band:${name}`, 'Ground textures', BAND_GUESS, true);
  }
}
