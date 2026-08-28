import * as THREE from 'three';
import { DEPTH_HI, DEPTH_LO, swellChunk } from './seaSwell';

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
 *
 * COLOUR IS A JOURNEY, NOT A SWITCH. The palette has three stops —
 * shallow teal, a mid blue, deep navy — and each wearer says where the
 * handovers happen (midAt / deepAt, in depth). The bathymetry under
 * the ocean sheet is 32 m samples, so any ramp narrower than a few
 * cells collapses into a painted stripe at the shelf break ("almost
 * like a second horizon" — Joshua, with a circle around it). Wide
 * bands soften it up close, and a VIEW-DISTANCE smear finishes the
 * job: far water slides toward the deep colour regardless of depth,
 * because from a distance you see sky and scatter, not bottom. The
 * ripple is also woven into the COLOUR (texAmp), not just the
 * lighting normal — flat-lit open ocean showed "only color at the
 * moment" when the sun stopped catching the relief.
 */
export interface WaterLookOpts {
  /** 0 = BE's ocean palette exactly; 1 = the inland green shift. */
  readonly green: number;
  /** Scales the surf/foam depth band. Ocean 1; inland much tighter. */
  readonly surf: number;
  /**
   * The feather band, in depth units: fully invisible at edgeLo of
   * column, fully itself at edgeHi — the way the ground textures
   * blend band into band instead of cutting.
   *
   * edgeLo is ABOVE ZERO for the ocean, and that is the entire trick
   * (it is BE's hiddenG, rediscovered the hard way): the flat sheet
   * geometrically intersects the rising beach at exactly zero depth,
   * and along that intersection the terrain occludes the water in a
   * razor line no alpha on the visible side can soften. Fading out
   * while the ground is still edgeLo UNDERWATER means the cut happens
   * where the water is already invisible — the line still exists; it
   * just happens in water you cannot see.
   */
  readonly edgeLo: number;
  readonly edgeHi: number;
  /** Depth where shallow teal has fully handed over to the mid blue. */
  readonly midAt: number;
  /** Depth where the mid blue has fully handed over to deep navy. */
  readonly deepAt: number;
  /**
   * How much the ripple pattern shows in the COLOUR itself (fraction
   * of brightness). Keeps texture readable when the lighting angle
   * flattens the normal relief to nothing.
   */
  readonly texAmp: number;
  /**
   * Max anisotropic filtering for the ripple map — the terrain
   * learned this one (terrainMaterial.ts): at the oblique angles this
   * game is actually played at, isotropic mips average the pattern to
   * a flat wash. Pass renderer.capabilities.getMaxAnisotropy().
   */
  readonly anisotropy: number;
  /**
   * Polygon-offset direction. The OCEAN sinks (+) so near-coplanar
   * shore terrain wins the depth test — BE's flyover-shimmer lesson.
   * INLAND lifts (−): a film lies ON the ground it is coplanar with,
   * and sinking it hands the whole sheet to the sand.
   */
  readonly sink: boolean;
  /**
   * THE NEAR OCEAN SHEET RIDES THE SWELL (seaSwell.ts — the one
   * shared surface). Vertices displace by the wave table, faded by
   * the DEPTH attribute near shore and by rimLo..rimHi of sheet-local
   * radius so the sheet arrives flat at its own edge; alphaLo..alphaHi
   * fades the sheet out entirely, crossfading into the far sheet's
   * `hole`. The swell's slope also tilts the lighting normal.
   */
  readonly swell?: {
    readonly rimLo: number; readonly rimHi: number;
    readonly alphaLo: number; readonly alphaHi: number;
  };
  /**
   * The FAR sheet opens a hole under the near sheet — alpha rises
   * from nothing at `lo` of world distance from the hole's centre
   * (the WaterLook's `hole` uniform) to full by `hi`, the exact
   * complement of the near sheet's alpha rim.
   */
  readonly hole?: { readonly lo: number; readonly hi: number };
}

export interface WaterLook {
  readonly material: THREE.MeshStandardMaterial;
  /** Advance the ripple scroll. Seconds. */
  readonly clock: { value: number };
  /** World position the mesh's local frame is centred on. */
  readonly centre: { value: THREE.Vector2 };
  /** World position of the far sheet's hole (see opts.hole). */
  readonly hole: { value: THREE.Vector2 };
}

export function makeWaterLook(opts: WaterLookOpts): WaterLook {
  const clock = { value: 0 };
  const centre = { value: new THREE.Vector2() };
  // Far enough away that a hole nobody has placed swallows nothing.
  const hole = { value: new THREE.Vector2(1e9, 1e9) };
  const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
  flat.needsUpdate = true;
  const ripple = { value: flat as THREE.Texture };
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}water-normal.png`,
    (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = opts.anisotropy;
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
    // BE's shallow value was 0.58; nudged up because a film of sea
    // over bright sand was disappearing entirely (Joshua: "the water
    // right at the sand side is too transparent and hard to see").
    // The shader still grades up from here with depth.
    opacity: 0.63,
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
    shader.uniforms.uHole = hole;
    const swell = opts.swell;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n attribute float depth;\n attribute vec2 flow;\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vFlow;\n uniform vec2 uCentre;'
        + (swell ? '\n varying vec2 vSwell;\n varying float vSheet;\n uniform float uTime;' : ''))
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vDepth = depth;\n vFlow = flow;\n vWorld = vec2(position.x, position.z) + uCentre;'
        + (swell ? `
        {
          // THE SWELL, from the one shared table (seaSwell.ts). Faded
          // by the water column near shore — the same DEPTH_LO..HI the
          // CPU query uses — and flattened toward the sheet's own rim
          // so it meets the flat far sheet without a step.
          float sw = 0.0;
          vec2 swSlope = vec2(0.0);
          vec2 worldXZ = vWorld;
          ${swellChunk()}
          float swFade = smoothstep(${DEPTH_LO.toFixed(1)}, ${DEPTH_HI.toFixed(1)}, depth)
            * (1.0 - smoothstep(${swell.rimLo.toFixed(1)}, ${swell.rimHi.toFixed(1)}, length(position.xz)));
          transformed.y += sw * swFade;
          vSwell = swSlope * swFade;
          vSheet = length(position.xz);
        }` : ''));
    // The ripple field is computed ONCE, in map_fragment (which three
    // runs before the normal and lighting stages), and handed to the
    // later stages through gRn/gBody — the colour weave, the normal
    // tilt and the surf caps all read the same water.
    shader.fragmentShader = ('uniform float uTime;\nuniform sampler2D uRipple;\nuniform vec3 uSky;\n' + shader.fragmentShader)
      .replace('#include <common>', '#include <common>\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vFlow;\n mat2 rrot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }\n vec3 gRn = vec3(0.0);\n float gBody = 0.0;'
        + (swell ? '\n varying vec2 vSwell;\n varying float vSheet;' : '')
        + (opts.hole ? '\n uniform vec2 uHole;' : ''))
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // THE EDGE BLENDS LIKE THE GROUND DOES. A hard discard at a
          // threshold cut the waterline like scissors against the
          // beach; the terrain never does that — its bands feather.
          float depth = vDepth;
          float edge = smoothstep(${opts.edgeLo.toFixed(1)}, ${opts.edgeHi.toFixed(1)}, depth);
          // Films barely ripple; a body of water carries the full skin.
          gBody = smoothstep(0.0, 25.0, depth);

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
          // NOTE the two phases sample the SAME point apart from their
          // own advection — no extra UV offsets. At zero flow (the
          // ocean, a still lake) rn0 == rn1 and the crossfade is a
          // no-op at FULL contrast; offsets here would blur exactly
          // the water that holds still enough to look at.
          //
          // THE LADDER IS ANCHORED AT ONE METRE. Joshua's water map is
          // authored as a 1 x 1 m patch at full resolution, so the
          // dominant octave tiles at exactly 100 units — its chop
          // appears at the size it was painted. The larger octaves
          // exist to break the tiling and shade broad swell; the small
          // one is near-field sparkle.
          rn0 += (texture2D(uRipple, rrot(0.0) * (wp - a0) / 865.0 + uTime * vec2( 0.021, 0.013)).xyz - 0.5) * 0.6;
          rn1 += (texture2D(uRipple, rrot(0.0) * (wp - a1) / 865.0 + uTime * vec2( 0.021, 0.013)).xyz - 0.5) * 0.6;
          rn0 += (texture2D(uRipple, rrot(2.1) * (wp - a0) / 230.0 - uTime * vec2( 0.017, 0.024)).xyz - 0.5) * 0.7;
          rn1 += (texture2D(uRipple, rrot(2.1) * (wp - a1) / 230.0 - uTime * vec2( 0.017, 0.024)).xyz - 0.5) * 0.7;
          rn0 += (texture2D(uRipple, rrot(4.3) * (wp - a0) / 100.0 + uTime * vec2( 0.032,-0.019)).xyz - 0.5);
          rn1 += (texture2D(uRipple, rrot(4.3) * (wp - a1) / 100.0 + uTime * vec2( 0.032,-0.019)).xyz - 0.5);
          rn0 += (texture2D(uRipple, rrot(1.2) * (wp - a0) /  45.0 + uTime * vec2(-0.045, 0.05 )).xyz - 0.5) * 0.5;
          rn1 += (texture2D(uRipple, rrot(1.2) * (wp - a1) /  45.0 + uTime * vec2(-0.045, 0.05 )).xyz - 0.5) * 0.5;
          gRn = mix(rn0, rn1, xf);

          // COLOUR. Three stops, wide handovers — the wearer picks
          // where (midAt/deepAt), so the ramp spans several bathymetry
          // cells instead of collapsing inside one at the shelf break.
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
          // view distance every depth slides toward the deep colour,
          // so no bathymetry contour can draw a second horizon.
          float away = smoothstep(15000.0, 130000.0, length(vViewPosition));
          col = mix(col, deepCol, away * 0.85);
          diffuseColor.rgb = col;
          // The ripple woven into the colour itself, so the surface
          // reads as textured even when the light angle flattens the
          // normal relief. Fades with distance with everything else.
          diffuseColor.rgb *= 1.0 + (gRn.x + gRn.y) * ${opts.texAmp.toFixed(3)} * gBody * (1.0 - away);

          // BE's surf: broad foam right at the waterline, sparse caps
          // in open water where the ripple tilts hard. The band scales
          // per wearer — a beach break for the ocean, a whisper of
          // bank-line for a stream.
          float surf = smoothstep(160.0 * ${opts.surf.toFixed(3)}, 15.0 * ${opts.surf.toFixed(3)}, depth);
          float surfN = texture2D(uRipple, vWorld / 300.0 + uTime * vec2(0.05, 0.03)).r;
          float foam = surf * smoothstep(0.60, 0.86, surfN);
          // Open-water caps. The wave map's slope energy runs in thin
          // crest LINES (Joshua's 1x1 m chop map, sd 19-34/255), and a
          // bare threshold paints those lines as white scratches. Gating
          // against the second, independently scrolling sample keeps
          // only the spots where the two patterns cross — beads of
          // foam that wink in and out, not dashes.
          vec3 cn = texture2D(uRipple, vWorld / 700.0 - uTime * vec2(0.02, 0.028)).xyz * 2.0 - 1.0;
          float caps = smoothstep(0.75, 1.10, length(cn.xy)) * smoothstep(0.55, 0.80, surfN);
          foam = clamp(foam + caps * 0.4, 0.0, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);

          // BE's clear-water alpha: see the sand at the waterline, a
          // real body offshore, foam near-opaque. BE's band started at
          // 40..550; it starts sooner now so shin-deep water over sand
          // is visibly WATER — the waterline feather itself is edge's
          // job and unchanged.
          diffuseColor.a *= mix(1.0, 1.55, smoothstep(15.0, 320.0, depth));
          diffuseColor.a = min(diffuseColor.a, 0.82);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);
          diffuseColor.a *= edge;${opts.swell ? `
          // The near sheet hands over to the far one across its rim —
          // the far sheet's hole is the mirror of this fade.
          diffuseColor.a *= 1.0 - smoothstep(${opts.swell.alphaLo.toFixed(1)}, ${opts.swell.alphaHi.toFixed(1)}, vSheet);` : ''}${opts.hole ? `
          // And the far sheet stands aside where the near one rides.
          diffuseColor.a *= smoothstep(${opts.hole.lo.toFixed(1)}, ${opts.hole.hi.toFixed(1)}, distance(vWorld, uHole));` : ''}
          if (diffuseColor.a < 0.01) discard;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          normal = normalize(normal + vec3(gRn.x, 0.0, gRn.y) * 0.75 * gBody${opts.swell
    ? ' + vec3(-vSwell.x, 0.0, -vSwell.y) * 1.5' : ''});
        }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // BE's fresnel sky sheen, capped so far flat water cannot
          // white-band.
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uSky * min(fres, 0.85) * 0.5;
        }`);
  };
  return { material, clock, centre, hole };
}
