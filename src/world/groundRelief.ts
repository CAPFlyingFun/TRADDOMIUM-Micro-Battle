/**
 * THE THIRD DIMENSION IN THE GROUND'S MATERIAL RESPONSE.
 *
 * The band maps are photographs. Photographs of rock and sand and
 * cracked soil, lit by whatever sun was out the day they were taken —
 * and then lit AGAIN, flatly, by ours, because to the renderer they are
 * paint on a plane. The stones in them are visible but they are printed
 * stones: no edge of one catches the low sun, none of them shades its
 * own lee side. At the angles this game is played at, that is most of
 * what separates ground from wallpaper.
 *
 * So: derive a height field from each band and hand the sun something
 * to describe.
 *
 * WHERE THE MATHS COMES FROM. Joshua's Local Texture Lab, constant for
 * constant — luminance, a blurred "large form" pass mixed against the
 * high-frequency residue, contrast, then levels. `scripts/bake-ground-pbr.mjs`
 * is the same pipeline offline, and exists so the dials can be judged as
 * images before they are judged as lighting.
 *
 * WHY IT RUNS HERE AND NOT IN THE BUILD. Because the height field is a
 * pure function of a colour map the player has already downloaded, and
 * shipping it a second time costs a payload we measured and did not
 * like. Seven bands of derived normal are 14 MB lossless. Lossy is
 * worse than expensive, it is wrong: WebP carries R and B through the
 * chroma path, and a normal map's x and y ARE its red and green, so
 * q92 came back with 21 degrees of mean angular error. Baked here it is
 * exact, full resolution, and free on the wire.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is move a vertex. The height is a
 * lighting term and nothing else — every photographed pebble becoming
 * geometry is the opposite of what this is for, and the terrain is not
 * ours to move in any case (see CLAUDE.md).
 */
import * as THREE from 'three';

/**
 * The lab's controls. Live, because "the sand height is too aggressive"
 * is a judgement to make on a phone in sunlight, not in a build script.
 */
export const RELIEF_DIALS = {
  heightContrast: 1.25,
  largeForm: 0.62,
  imageDetail: 0.35,
  heightLow: 0.04,
  heightHigh: 0.96,
  normalStrength: 1.25,
};

/**
 * How hard the derived micro-relief bends the sun, as a live uniform so
 * it can be turned down — or off — from the phone without a rebuild.
 */
export const RELIEF_BUMP_UNIFORM = { value: 1.0 };

/** How much the micro-slope darkens its own crevices. Subtle by remit. */
export const RELIEF_AO_UNIFORM = { value: 0.35 };

/**
 * Per-band roughness. Sand, wet reef, cracked cliff and snow do not
 * reflect alike, and one flat 0.95 for the whole island was the other
 * half of the flatness — a surface that never varies its specular
 * response reads as one material with different pictures on it.
 */
export const BAND_ROUGHNESS: Record<string, number> = {
  reef: 0.72,      // wet, permanently
  sand: 0.90,
  grass: 0.93,
  jungle: 0.95,
  cliff: 0.84,     // bare rock keeps a little sheen
  mountain: 0.88,
  snow: 0.62,      // the glossiest thing on the island
};

/**
 * The packed maps: two bands to a texture, x and y only.
 *
 * z is not stored because it is not information — it is
 * sqrt(1 - x² - y²), and spending a third of the memory to repeat
 * something the shader can recover in one instruction is a poor trade
 * at 1024² times seven. Pairs follow BAND_FILES, so the last map
 * carries snow in rg and nothing in ba.
 */
export const RELIEF_PAIRS: readonly (readonly [string, string | null])[] = [
  ['reef', 'sand'],
  ['grass', 'jungle'],
  ['cliff', 'mountain'],
  ['snow', null],
];

/** A flat normal, stood in until the bake runs. */
function flatMap(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([128, 128, 128, 128]), 1, 1,
  );
  texture.needsUpdate = true;
  return texture;
}

export const RELIEF_MAPS: { value: THREE.Texture }[] = RELIEF_PAIRS.map(
  () => ({ value: flatMap() as THREE.Texture }),
);

/** Uniform names, so the material and the shader agree in one place. */
export const RELIEF_UNIFORM_NAMES = RELIEF_PAIRS.map((_, i) => `t_relief${i}`);

const BAKE_FRAGMENT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D mapA, mapB;
  uniform vec2 texel;
  uniform float hasB, broadBias;
  uniform float contrast, largeForm, imageDetail, lowCut, highCut, strength;

  /**
   * BACK TO sRGB BEFORE MEASURING. The band maps are tagged sRGB, so the
   * sampler hands us linear light — but the lab read 0-255 bytes off a
   * canvas, and a height curve fitted against sRGB values does not mean
   * the same thing applied to linear ones. Undo the decode so the dials
   * keep the meaning they were tuned with.
   */
  vec3 toSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055,
               step(vec3(0.0031308), c));
  }
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  /**
   * The large form is a blurred copy of the luminance. The lab box-blurs
   * at radius size/128; a mip does the same averaging in one tap, and
   * the mip chain is already built.
   */
  float heightAt(sampler2D map, vec2 uv) {
    float sharp = luma(toSrgb(texture2D(map, uv).rgb));
    float broad = luma(toSrgb(texture2D(map, uv, broadBias).rgb));
    float high = sharp - broad;
    float v = mix(sharp, broad, largeForm * 0.72) + high * imageDetail * 1.3;
    v = (v - 0.5) * contrast + 0.5;
    return clamp((v - lowCut) / max(0.001, highCut - lowCut), 0.0, 1.0);
  }

  /** Central differences, as the lab takes them. */
  vec2 normalXY(sampler2D map, vec2 uv) {
    float dx = (heightAt(map, uv + vec2(texel.x, 0.0))
              - heightAt(map, uv - vec2(texel.x, 0.0))) * strength * 2.2;
    float dy = (heightAt(map, uv + vec2(0.0, texel.y))
              - heightAt(map, uv - vec2(0.0, texel.y))) * strength * 2.2;
    return normalize(vec3(-dx, -dy, 1.0)).xy * 0.5 + 0.5;
  }

  void main() {
    vec2 a = normalXY(mapA, vUv);
    vec2 b = hasB > 0.5 ? normalXY(mapB, vUv) : vec2(0.5);
    gl_FragColor = vec4(a, b);
  }
`;

const BAKE_VERTEX = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * Run the derivation over every band, into the packed maps above.
 *
 * Call it once the colour maps have actually arrived — a band still
 * holding its placeholder bakes a flat normal and stays flat, because
 * nothing re-bakes it later.
 */
export function bakeGroundRelief(
  renderer: THREE.WebGLRenderer,
  textures: Record<string, THREE.Texture>,
): void {
  const source = textures[RELIEF_PAIRS[0][0]];
  const size = (source?.image as { width?: number } | undefined)?.width ?? 1024;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: {
      mapA: { value: null }, mapB: { value: null },
      texel: { value: new THREE.Vector2(1 / size, 1 / size) },
      hasB: { value: 1 },
      // Radius size/128 is three mip levels of box averaging.
      broadBias: { value: Math.log2(Math.max(2, Math.round(size / 128))) },
      contrast: { value: RELIEF_DIALS.heightContrast },
      largeForm: { value: RELIEF_DIALS.largeForm },
      imageDetail: { value: RELIEF_DIALS.imageDetail },
      lowCut: { value: RELIEF_DIALS.heightLow },
      highCut: { value: RELIEF_DIALS.heightHigh },
      strength: { value: RELIEF_DIALS.normalStrength },
    },
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const previous = renderer.getRenderTarget();
  RELIEF_PAIRS.forEach(([a, b], index) => {
    const target = new THREE.WebGLRenderTarget(size, size, {
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
      stencilBuffer: false,
    });
    // Same reason the colour maps carry it: the ground is seen at a
    // grazing angle almost always, and that is where a tiled map dies.
    target.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // NOT sRGB. These are vectors, not colours; letting the sampler
    // "decode" them would bend every normal on the island.
    target.texture.colorSpace = THREE.NoColorSpace;

    material.uniforms.mapA.value = textures[a] ?? null;
    material.uniforms.mapB.value = b ? textures[b] ?? null : textures[a] ?? null;
    material.uniforms.hasB.value = b ? 1 : 0;

    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    RELIEF_MAPS[index].value.dispose?.();
    RELIEF_MAPS[index].value = target.texture;
  });
  renderer.setRenderTarget(previous);
  material.dispose();
}

/** Live tuning hooks, for judging this on the device it ships to. */
export function setReliefBump(scale: number): void {
  RELIEF_BUMP_UNIFORM.value = Math.max(0, scale);
}
export function setReliefAo(strength: number): void {
  RELIEF_AO_UNIFORM.value = Math.max(0, Math.min(1, strength));
}
