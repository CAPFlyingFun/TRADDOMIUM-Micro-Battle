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
  // THE LAB'S CONTRAST AND LEVELS ARE NOT USED AT THEIR OWN DEFAULTS,
  // and the reason is worth keeping written down. At contrast 1.25 with
  // the 0.04..0.96 cut, 10.4% of the sand height came out clipped at
  // pure white and 41.3% of the jungle at pure black. Clipping is not a
  // cosmetic loss here: a saturated region has NO GRADIENT, and the
  // gradient is the entire product. The pale pebbles are the brightest
  // thing in the sand map, so they saturated together with the bright
  // sand around them and came out with no edge and no shape — visible
  // in the photograph, perfectly flat under the sun. (Joshua: "some of
  // those small rocks are a few millimetres wide and it's not obvious
  // a rock... still looks too flat.")
  //
  // So the height is left as measured and the punch comes from
  // strength, which multiplies the slope and cannot clip anything.
  heightContrast: 1.0,
  largeForm: 0.62,
  imageDetail: 0.35,
  heightLow: 0.0,
  heightHigh: 1.0,
  // ONE, because the depth is now a measurement and not a taste. The
  // dial multiplies RELIEF_AMPLITUDE, so 1.0 is exactly the 2 cm asked
  // for and anything else is a deliberate exaggeration of it.
  normalStrength: 1.0,
  /**
   * HOW WIDE A SLOPE COUNTS AS A SLOPE.
   *
   * A one-texel difference only ever sees the finest octave, which on
   * sand is grain. A pebble twenty texels across has a gentle slope per
   * texel and barely registers against that grain, so the old normal
   * gave every rock a thin rim and no body. Reading the slope over
   * several spans at once and adding them lets a rock tilt as a whole
   * object while the grain still sparkles on top of it.
   */
  fineSpan: 1.0,
  midSpan: 4.0,
  coarseSpan: 12.0,
  fineWeight: 1.0,
  midWeight: 0.55,
  coarseWeight: 0.35,
};

/**
 * How hard the derived micro-relief bends the sun, as a live uniform so
 * it can be turned down — or off — from the phone without a rebuild.
 */
/**
 * HOW DEEP THE RELIEF ACTUALLY IS, peak to peak, in world units — and
 * a world unit is a centimetre.
 *
 * Two: the highest point of a band's height field stands 1 cm proud of
 * the mid and the lowest sits 1 cm below it (Joshua: "the highest
 * mapping +1 cm and the lowest -1 cm for a total of a 2 cm difference
 * ... the mean average in the middle would be zero").
 *
 * IT IS A LIGHTING DEPTH, NOT A SURFACE. Nothing here moves a vertex
 * and nothing here reaches the walker, so a pebble standing 1 cm proud
 * of the mid is 1 cm proud TO THE SUN and to nothing else: the queen
 * walks straight through it, not over it. An earlier version of this
 * comment called it "a pebble she has to walk around the shoulder of",
 * which is a promise the code does not keep.
 *
 * The mid sitting at zero costs nothing and matters for nothing — a
 * normal map is made of SLOPES, and adding a constant to every height
 * changes no slope anywhere. It is written down because it is what
 * makes the number meaningful: without a datum, "2 cm of relief" does
 * not say which 2 cm.
 *
 * What it buys is that the dial below is now a MULTIPLIER ON A
 * MEASUREMENT rather than a unitless fudge. At 1.0 the ground has
 * exactly the 2 cm asked for.
 */
export const RELIEF_AMPLITUDE = 2;

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
/**
 * BANDS THAT SHIP REAL SCANNED MAPS, which beat anything derived.
 *
 * Measured against Ground054's own normal, a normal derived from its
 * displacement could not get below 16.7 degrees of error on a map
 * carrying 15.5 degrees of tilt — no better than guessing flat. The
 * derivation is what a band gets when nobody has scanned it, not a
 * substitute for someone who has.
 */
export const AUTHORED_BANDS = ['sandsmooth'] as const;

/**
 * WHAT THE SCANNED SAND IS ACTUALLY WORTH, measured rather than assumed.
 *
 * RELIEF_AMPLITUDE calibrates the DERIVED bands: their height fields go
 * through slopeScale and come out at a stated 2 cm. An authored normal
 * does not — the bake reads its xy straight out of the file, so it
 * arrives carrying whatever depth the scanner and the vendor agreed on,
 * and tuning RELIEF_AMPLITUDE does not touch it.
 *
 * Measured: the shipped Ground054 normal has an RMS slope of 0.324
 * against 0.883 for coarse sand derived at the calibrated 2 cm. On the
 * derived bands' own scale it therefore behaves like about 0.73 cm —
 * roughly 2.7 times shallower than the number written beside it.
 *
 * (Fitting its own displacement map against it cannot recover this: the
 * angular error falls monotonically as the amplitude goes to zero,
 * because the two disagree about SHAPE, not scale. RMS slope is the
 * statistic that survives that.)
 *
 * So the beach does not currently share one depth, and relief(1) means
 * 2 cm on the coarse sand and about three quarters of a centimetre on
 * the fine. Left alone DELIBERATELY: correcting it changes how the
 * ground looks, and the ground must not move between a frame-rate
 * measurement and its control. Multiplying the authored xy by about 2.7
 * in the bake is the one-line fix when that is wanted.
 */
export const AUTHORED_IMPLIED_AMPLITUDE = 0.73;

/**
 * Whose roughness and occlusion ride in the last map's spare channels.
 *
 * The snow pair has no partner, so map 3's blue and alpha were carrying
 * nothing. A real roughness map is most of what makes sand stop
 * answering the sun like painted card, and putting it there costs no
 * download beyond the file itself and NOT ONE extra texture fetch —
 * map 3 is already sampled for snow.
 */
export const SURFACE_BAND = 'sandsmooth';

export const RELIEF_PAIRS: readonly {
  a: string; b: string | null; surface?: string;
}[] = [
  { a: 'reef', b: 'sand' },
  { a: 'grass', b: 'jungle' },
  { a: 'cliff', b: 'mountain' },
  { a: 'snow', b: null },
  // THE SECOND SAND. Scanned, so its normal is read rather than
  // derived, and its roughness and occlusion ride in the spare two
  // channels beside it — the same free lodging snow's slot offered.
  { a: 'sandsmooth', b: null, surface: 'sandsmooth' },
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
  uniform sampler2D authoredA, authoredB, surfaceRough, surfaceAo;
  uniform vec2 texel;
  uniform float hasB, broadBias;
  uniform float hasAuthoredA, hasAuthoredB, writeSurface;
  uniform float contrast, largeForm, imageDetail, lowCut, highCut, strength;
  uniform float fineSpan, midSpan, coarseSpan, slopeScale;
  uniform float fineWeight, midWeight, coarseWeight;

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

  /**
   * A TRUE derivative over the given span: height units per texel.
   *
   * Divided by the span it was measured over, which the first version
   * of this was not. Summing raw differences across three spans made a
   * wider span count for more simply because it reached further, so the
   * result was a shape emphasis in no units at all — fine while the
   * strength was a fudge factor, useless now that the depth is a
   * measurement someone can check.
   */
  vec2 slope(sampler2D map, vec2 uv, float span) {
    vec2 e = texel * span;
    return vec2(
      heightAt(map, uv + vec2(e.x, 0.0)) - heightAt(map, uv - vec2(e.x, 0.0)),
      heightAt(map, uv + vec2(0.0, e.y)) - heightAt(map, uv - vec2(0.0, e.y))
    ) / (2.0 * span);
  }

  /**
   * Three spans, added rather than averaged. The wide one carries the
   * shape of a stone, the narrow one the grain sitting on it — and a
   * rock only reads as a rock when its whole face turns to the sun
   * together instead of showing a lit outline round a flat middle.
   */
  vec2 normalXY(sampler2D map, vec2 uv) {
    // A WEIGHTED MEAN of the three, not a sum: each span is already a
    // derivative, so averaging them keeps the answer one.
    vec2 g = (slope(map, uv, fineSpan) * fineWeight
            + slope(map, uv, midSpan) * midWeight
            + slope(map, uv, coarseSpan) * coarseWeight)
           / max(0.0001, fineWeight + midWeight + coarseWeight);
    // Height units per texel become world units per world unit here,
    // and this is the only place the relief acquires a physical size.
    g *= slopeScale * strength;
    return normalize(vec3(-g, 1.0)).xy * 0.5 + 0.5;
  }

  void main() {
    // A scanned normal is already the answer; only derive where there
    // is nothing to read. Its xy are stored the same way ours are, so
    // it drops straight into the same two channels.
    vec2 a = hasAuthoredA > 0.5 ? texture2D(authoredA, vUv).xy : normalXY(mapA, vUv);
    vec2 b;
    if (writeSurface > 0.5) {
      b = vec2(texture2D(surfaceRough, vUv).r, texture2D(surfaceAo, vUv).r);
    } else if (hasAuthoredB > 0.5) {
      b = texture2D(authoredB, vUv).xy;
    } else {
      b = hasB > 0.5 ? normalXY(mapB, vUv) : vec2(0.5);
    }
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
  authored: Record<string, THREE.Texture> = {},
  bandTile = 128,
): void {
  const source = textures[RELIEF_PAIRS[0].a];
  const size = (source?.image as { width?: number } | undefined)?.width ?? 1024;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const material = new THREE.ShaderMaterial({
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: {
      mapA: { value: null }, mapB: { value: null },
      authoredA: { value: null }, authoredB: { value: null },
      surfaceRough: { value: null }, surfaceAo: { value: null },
      hasAuthoredA: { value: 0 }, hasAuthoredB: { value: 0 },
      writeSurface: { value: 0 },
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
      // Rise over run, both in world units: RELIEF_AMPLITUDE of height
      // across one texel of ground. At a 128-unit tile over 1024 texels
      // a texel is 1.25 mm, so 2 cm of relief is a slope of 16 — which
      // is exactly why sand at this scale is all shoulders and pits.
      slopeScale: { value: RELIEF_AMPLITUDE / (bandTile / size) },
      fineSpan: { value: RELIEF_DIALS.fineSpan },
      midSpan: { value: RELIEF_DIALS.midSpan },
      coarseSpan: { value: RELIEF_DIALS.coarseSpan },
      fineWeight: { value: RELIEF_DIALS.fineWeight },
      midWeight: { value: RELIEF_DIALS.midWeight },
      coarseWeight: { value: RELIEF_DIALS.coarseWeight },
    },
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const previous = renderer.getRenderTarget();
  RELIEF_PAIRS.forEach(({ a, b, surface }, index) => {
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

    const fallback = textures[a] ?? null;
    material.uniforms.mapA.value = fallback;
    material.uniforms.mapB.value = b ? textures[b] ?? null : fallback;
    material.uniforms.hasB.value = b ? 1 : 0;
    // Every sampler needs something bound whether or not it is read.
    material.uniforms.authoredA.value = authored[`${a}-normal`] ?? fallback;
    material.uniforms.authoredB.value = (b && authored[`${b}-normal`]) || fallback;
    material.uniforms.hasAuthoredA.value = authored[`${a}-normal`] ? 1 : 0;
    material.uniforms.hasAuthoredB.value = b && authored[`${b}-normal`] ? 1 : 0;
    const rough = surface ? authored[`${surface}-rough`] : undefined;
    const occlusion = surface ? authored[`${surface}-ao`] : undefined;
    material.uniforms.surfaceRough.value = rough ?? fallback;
    material.uniforms.surfaceAo.value = occlusion ?? fallback;
    material.uniforms.writeSurface.value = rough && occlusion ? 1 : 0;

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
