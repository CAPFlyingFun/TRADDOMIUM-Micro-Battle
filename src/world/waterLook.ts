import * as THREE from 'three';

/**
 * BEYOND EXTINCTION'S WATER, WORN BY THIS ISLAND — one shader for every
 * sheet of water in the game.
 *
 * Ported from BE's makeOceanMaterial at v0.0.140 (KauaiStreamScene.ts),
 * which is the look Joshua asked for by name, and which twenty-five of
 * BE's versions tuned: turquoise shallows deepening to navy, scrolling
 * ripple normals in four world-planar octaves, surf at the waterline
 * with occasional open-water caps, clear-water alpha graded up with
 * depth, and a fresnel sky sheen. Every constant below that carries a
 * BE comment is BE's, converted from its metres to our centimetres.
 *
 * ONE MAKER, TWO WEARERS. The ocean wears it straight; inland water
 * wears it with a slight GREEN shift (Joshua: "just inland a slight
 * bit of a greenish tint") and its surf band scaled down — a lake bank
 * is not a beach break. Because both sheets come from here they cannot
 * drift apart, which is the whole reason this is one file.
 *
 * WHAT IS OURS, NOT BE'S: the skin drifts at the water's own measured
 * speed. Every vertex carries the sim's current (attribute `flow`),
 * and the octaves advect along it with the two-phase flow-map trick —
 * two copies half a cycle apart, crossfaded, so a spatially varying
 * current cannot shear the pattern into taffy. BE scrolls at fixed
 * rates; our rivers genuinely move, so the texture does too. The ocean
 * sheet passes zero flow and gets BE's calm drift from the fixed
 * per-octave rates alone.
 */
export interface WaterLookOpts {
  /** 0 = BE's ocean palette exactly; 1 = the inland green shift. */
  readonly green: number;
  /** Scales the surf/foam depth band. Ocean 1; inland much tighter. */
  readonly surf: number;
  /**
   * Polygon-offset direction. The OCEAN sinks (+) so near-coplanar
   * shore terrain wins the depth test — BE's flyover-shimmer lesson.
   * INLAND lifts (−): a film lies ON the ground it is coplanar with,
   * and sinking it hands the whole sheet to the sand.
   */
  readonly sink: boolean;
}

export interface WaterLook {
  readonly material: THREE.MeshStandardMaterial;
  /** Advance the ripple scroll. Seconds. */
  readonly clock: { value: number };
  /** World position the mesh's local frame is centred on. */
  readonly centre: { value: THREE.Vector2 };
}

export function makeWaterLook(opts: WaterLookOpts): WaterLook {
  const clock = { value: 0 };
  const centre = { value: new THREE.Vector2() };
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  flat.needsUpdate = true;
  const ripple = { value: flat as THREE.Texture };
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}water-normal.png`,
    (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      ripple.value = texture;
    },
    undefined,
    () => { /* flat water is a look, not a failure */ },
  );

  const material = new THREE.MeshStandardMaterial({
    // BE: color 0x1a6389, roughness .18, metalness LOW so steep views
    // keep the diffuse blue instead of mirroring the dark deep.
    color: 0x1a6389,
    roughness: 0.18,
    metalness: 0.1,
    transparent: true,
    opacity: 0.58, // BE v0.0.139: the SHALLOW value; the shader grades up
    envMapIntensity: 0.9,
    normalScale: new THREE.Vector2(0.55, 0.55),
    side: THREE.DoubleSide, // she swims; the sheet must exist from below
    polygonOffset: true,
    polygonOffsetFactor: opts.sink ? 2 : 0,
    polygonOffsetUnits: opts.sink ? 12 : -6,
  });
  const sky = new THREE.Color(0x9fc6df).convertSRGBToLinear();

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
    shader.uniforms.uCentre = centre;
    shader.uniforms.uRipple = ripple;
    shader.uniforms.uSky = { value: sky };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n attribute float depth;\n attribute vec2 flow;\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vFlow;\n uniform vec2 uCentre;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vDepth = depth;\n vFlow = flow;\n vWorld = vec2(position.x, position.z) + uCentre;');
    shader.fragmentShader = ('uniform float uTime;\nuniform sampler2D uRipple;\nuniform vec3 uSky;\n' + shader.fragmentShader)
      .replace('#include <common>', '#include <common>\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vFlow;\n mat2 rrot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // BE's four ripple octaves, world-planar, converted m -> cm —
          // advected by the LOCAL CURRENT with the two-phase flow trick
          // so a moving reach visibly moves and still water sits calm.
          float cyc = uTime * 0.09;
          float t0 = fract(cyc);
          float t1 = fract(cyc + 0.5);
          float xf = abs(2.0 * t0 - 1.0);
          vec2 wp = vWorld;
          vec2 adv = vFlow * (11.1); // units/s -> units per 11.1 s cycle
          vec2 a0 = adv * t0;
          vec2 a1 = adv * t1;
          vec3 rn0 = vec3(0.0);
          vec3 rn1 = vec3(0.0);
          rn0 += (texture2D(uRipple, rrot(0.0) * (wp - a0) / 1730.0 + uTime * vec2( 0.021, 0.013)).xyz - 0.5);
          rn1 += (texture2D(uRipple, rrot(0.0) * (wp - a1) / 1730.0 + uTime * vec2( 0.021, 0.013) + 0.37).xyz - 0.5);
          rn0 += (texture2D(uRipple, rrot(2.1) * (wp - a0) /  870.0 - uTime * vec2( 0.017, 0.024)).xyz - 0.5) * 0.8;
          rn1 += (texture2D(uRipple, rrot(2.1) * (wp - a1) /  870.0 - uTime * vec2( 0.017, 0.024) + 0.61).xyz - 0.5) * 0.8;
          rn0 += (texture2D(uRipple, rrot(4.3) * (wp - a0) /  390.0 + uTime * vec2( 0.032,-0.019)).xyz - 0.5) * 0.65;
          rn1 += (texture2D(uRipple, rrot(4.3) * (wp - a1) /  390.0 + uTime * vec2( 0.032,-0.019) + 0.19).xyz - 0.5) * 0.65;
          rn0 += (texture2D(uRipple, rrot(1.2) * (wp - a0) /  150.0 + uTime * vec2(-0.045, 0.05 )).xyz - 0.5) * 0.7;
          rn1 += (texture2D(uRipple, rrot(1.2) * (wp - a1) /  150.0 + uTime * vec2(-0.045, 0.05 ) + 0.83).xyz - 0.5) * 0.7;
          vec3 rn = mix(rn0, rn1, xf);
          // Films barely ripple; a body of water carries the full skin.
          float bodyAmp = smoothstep(0.0, 25.0, vDepth);
          normal = normalize(normal + vec3(rn.x, 0.0, rn.y) * 0.55 * bodyAmp);
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          if (vDepth < 1.5) discard;
          // BE's depth-tinted tropics, metres -> cm: turquoise over the
          // sand, navy in the body. ${''}
          float depth = vDepth;
          float shallow = 1.0 - smoothstep(30.0, 450.0, depth);
          vec3 shallowCol = vec3(0.020, 0.34, 0.42);   // BE deep teal
          vec3 deepCol    = vec3(0.008, 0.10, 0.26);   // BE navy
          // "Just inland a slight bit of a greenish tint" — a nudge of
          // the same water toward green, not a different water.
          shallowCol = mix(shallowCol, vec3(0.035, 0.36, 0.33), ${opts.green.toFixed(2)});
          deepCol    = mix(deepCol,    vec3(0.014, 0.15, 0.20), ${opts.green.toFixed(2)});
          diffuseColor.rgb = mix(deepCol, shallowCol, shallow * shallow);

          // BE's surf: broad foam right at the waterline, sparse caps
          // in open water where the ripple tilts hard. The band scales
          // per wearer — a beach break for the ocean, a whisper of
          // bank-line for a stream.
          float surf = smoothstep(160.0 * ${opts.surf.toFixed(3)}, 15.0 * ${opts.surf.toFixed(3)}, depth);
          float surfN = texture2D(uRipple, vWorld / 600.0 + uTime * vec2(0.05, 0.03)).r;
          float foam = surf * smoothstep(0.60, 0.86, surfN);
          vec3 cn = texture2D(uRipple, vWorld / 1400.0 - uTime * vec2(0.02, 0.028)).xyz * 2.0 - 1.0;
          foam = clamp(foam + smoothstep(0.55, 0.95, length(cn.xy)) * 0.45, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);

          // BE's clear-water alpha: see the sand at the waterline, a
          // real body offshore, foam near-opaque.
          diffuseColor.a *= mix(1.0, 1.55, smoothstep(40.0, 550.0, depth));
          diffuseColor.a = min(diffuseColor.a, 0.82);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // BE's fresnel sky sheen, capped so far flat water cannot
          // white-band.
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uSky * min(fres, 0.85) * 0.5;
        }`);
  };
  return { material, clock, centre };
}
