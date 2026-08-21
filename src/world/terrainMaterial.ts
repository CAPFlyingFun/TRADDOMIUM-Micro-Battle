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
 * The floating origin, for texture tiling. Kept as a shared uniform
 * object so every cell's material sees the same value the moment the
 * world shifts under her.
 */
export const ORIGIN_UNIFORM = { value: new THREE.Vector2() };

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
const DETAIL_FADE_FROM = 0.4;
const DETAIL_FADE_TO = 3.0;

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
    shader.uniforms.fadeFrom = { value: DETAIL_FADE_FROM };
    shader.uniforms.fadeTo = { value: DETAIL_FADE_TO };
    // WHERE THE WORLD ACTUALLY IS. Vertices reach the shader measured
    // from the floating origin, so tiling straight off them would slide
    // the whole ground texture sideways every time the origin moved —
    // and it moves in 1024-unit steps, which no tile size divides.
    shader.uniforms.worldOffset = ORIGIN_UNIFORM;
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
        uniform float fadeFrom, fadeTo;
        uniform vec3 avg_reef, avg_sand, avg_grass, avg_jungle;
        uniform vec3 avg_cliff, avg_mountain, avg_snow;
        uniform vec2 worldOffset;
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
        vec2 bandUv = (vGround.xz + worldOffset) / bandTile;
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
        vec3 ground =
            texture2D(t_reef, bandUv).rgb * wReef
          + texture2D(t_sand, bandUv).rgb * wSand
          + texture2D(t_grass, bandUv).rgb * wGrass
          + texture2D(t_jungle, bandUv).rgb * wJung
          + texture2D(t_cliff, bandUv).rgb * wCliff
          + texture2D(t_mountain, bandUv).rgb * wMount
          + texture2D(t_snow, bandUv).rgb * wSnow;
        ground /= total;

        // HOW MUCH OF THE TEXTURE THIS PIXEL IS ACTUALLY COVERING.
        // The derivatives give the footprint in tile units directly, so
        // this reads "tiles per pixel" and needs no guess about how far
        // away anything is. Whichever axis is longer wins, because it
        // is the long axis that the anisotropic filter gives up on.
        vec2 duvdx = dFdx(bandUv);
        vec2 duvdy = dFdy(bandUv);
        float tilesPerPixel = max(length(duvdx), length(duvdy));
        float far = smoothstep(fadeFrom, fadeTo, tilesPerPixel);

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

        // The fine grain rides on top at a tile size that shares no
        // factor with the band tile, so close up there is always
        // something moving past even mid-way through one band tile.
        // It is tiled tighter still, so it aliases sooner and has to go
        // sooner — leaving it in would put the streaks back on its own.
        float g = texture2D(t_grain, (vGround.xz + worldOffset) / grainTile).g;
        ground *= mix(0.80 + g * 0.42, 1.0, far);

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

/** Load the band maps, tiling and mip-mapped, from the public folder. */
export function loadBands(
  renderer: THREE.WebGLRenderer,
): Record<string, THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const bands: Record<string, THREE.Texture> = {};
  for (const name of BAND_FILES) {
    BAND_AVERAGE[name] ??= { value: new THREE.Color(0.5, 0.5, 0.5) };
    const texture = loader.load(
      `${import.meta.env.BASE_URL}kauai-tex/${name}.jpg`,
      (loaded) => measureAverage(name, loaded),
    );
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    // The ground is seen at a grazing angle almost all the time, which
    // is exactly where a tiled map turns to mush without this.
    texture.anisotropy = anisotropy;
    bands[name] = texture;
  }
  return bands;
}
