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

/**
 * World units per repeat of a band texture. About 10 cm — small enough
 * that detail streams past at a walk, which is the entire point, and
 * large enough not to alias into noise at a distance.
 */
export const BAND_TILE = 10;

/**
 * The fine grain is tiled much tighter and at a size that shares no
 * common factor with the band tile, so the two patterns never line up
 * and the repeat stops reading as a grid.
 */
export const GRAIN_TILE = 2.7;

/** Which file carries which band, ordered as they stack up the island. */
export const BAND_FILES = [
  'reef', 'sand', 'grass', 'jungle', 'cliff', 'mountain', 'snow',
] as const;

/**
 * Band edges in WORLD units, from the same real Kauai elevations
 * heightfield.ts uses — one real metre is a tenth of a world unit. The
 * feather either side is what keeps a biome change a gradient rather
 * than a contour line drawn round the hill.
 */
const EDGES = `
  float wReef  = 1.0 - smoothstep(-0.35, 0.05, h);
  float wSand  = span(h, -0.05, 1.2, 0.35);
  float wGrass = span(h, 1.0, 22.0, 1.4);
  float wJung  = span(h, 20.0, 70.0, 4.0);
  float wCliff = span(h, 66.0, 100.0, 6.0);
  float wMount = span(h, 95.0, 128.0, 8.0);
  float wSnow  = smoothstep(120.0, 145.0, h);
`;

/**
 * Build the terrain material.
 *
 * @param textures the seven band maps, keyed by BAND_FILES
 * @param grain the fine tiling detail that breaks up the band repeat
 */
export function terrainMaterial(
  textures: Record<string, THREE.Texture>,
  grain: THREE.Texture,
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
    shader.uniforms.grainTile = { value: GRAIN_TILE };

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
        uniform float grainTile;

        float span(float x, float lo, float hi, float feather) {
          return smoothstep(lo - feather, lo + feather, x)
               * (1.0 - smoothstep(hi - feather, hi + feather, x));
        }`)
      .replace('#include <map_fragment>', `
        vec2 bandUv = vGround.xz / bandTile;
        float h = vGround.y;
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

        // The fine grain rides on top at a tile size that shares no
        // factor with the band tile, so close up there is always
        // something moving past even mid-way through one band tile.
        float g = texture2D(t_grain, vGround.xz / grainTile).g;
        ground *= 0.80 + g * 0.42;

        diffuseColor.rgb *= ground;
      `);
  };

  return material;
}

/** Load the band maps, tiling and mip-mapped, from the public folder. */
export function loadBands(
  renderer: THREE.WebGLRenderer,
): Record<string, THREE.Texture> {
  const loader = new THREE.TextureLoader();
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  const bands: Record<string, THREE.Texture> = {};
  for (const name of BAND_FILES) {
    const texture = loader.load(`${import.meta.env.BASE_URL}kauai-tex/${name}.jpg`);
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
