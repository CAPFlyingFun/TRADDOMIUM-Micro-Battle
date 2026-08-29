import * as THREE from 'three';
import {
  KEEL, bindSwellUniforms, shoalChunk, swellChunk, swellReach,
  swellUniformChunk,
} from './seaSwell';
import { bindLodUniforms, lodUniformsChunk, microChunk } from './lodShader';

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

/**
 * How hard the foam's distance simplification is applied, shared by
 * every sheet. One is the shipped behaviour; zero holds full detail at
 * every distance, which is the control for judging it — on a phone as
 * well as in a probe, because the whole complaint was about what a
 * particular altitude looks like.
 */
export const FOAM_LOD_UNIFORM = { value: 1 };

/** PROFILING AND JUDGEMENT: 1 simplifies with distance, 0 never does. */
export function setFoamLod(amount: number): number {
  FOAM_LOD_UNIFORM.value = Math.max(0, Math.min(1, amount));
  return FOAM_LOD_UNIFORM.value;
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
  // THE FOAM'S LACE — Beyond Extinction's Shallow Reef Water (the
  // Godot set), whose bright caustic web thresholds into exactly the
  // bubble lattice real surf wash is made of. The fallback is DARK on
  // purpose: every foam threshold sits above its luminance, so a
  // missing file means no surf rather than a solid white shore.
  const dark = new THREE.DataTexture(new Uint8Array([40, 40, 40, 255]), 1, 1);
  dark.needsUpdate = true;
  const foamTex = { value: dark as THREE.Texture };
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}surf-foam.jpg`,
    (texture) => {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = opts.anisotropy;
      foamTex.value = texture;
    },
    undefined,
    () => { /* a calm shore is a look, not a failure */ },
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
  // EVERY WEARER NEEDS ITS OWN PROGRAM, and this one line is why the
  // waves were invisible for three versions.
  //
  // three.js caches compiled programs against the MATERIAL's own
  // parameters. It does not — cannot — know what onBeforeCompile
  // injected. Our two ocean sheets are both MeshStandardMaterial with
  // identical constructor parameters (same colour, roughness, opacity,
  // transparency, side); only the injected source differs. So the
  // second material to compile was handed the FIRST one's program.
  //
  // The far sheet compiles first, so the NEAR sheet has been running
  // the far sheet's shader all along: no swell displacement — which is
  // why the sea stayed glass while the queen rode a swell she could
  // feel — and, worse, the far sheet's HOLE, which cuts alpha to zero
  // within seventy metres of the hole's centre. The hole follows the
  // near sheet, so the near sheet was erasing itself precisely where
  // she was standing, and what Joshua could see offshore was the
  // TINTED SEABED with no water drawn over it at all.
  //
  // Proved by elimination: hiding every water sheet changed the ocean
  // not at all.
  material.customProgramCacheKey = () => [
    'water', opts.swell ? 'swell' : '-', opts.hole ? 'hole' : '-',
    opts.green, opts.surf, opts.edgeLo, opts.edgeHi,
    opts.midAt, opts.deepAt, opts.texAmp, opts.sink,
  ].join(':');

  const sky = new THREE.Color(0x9fc6df).convertSRGBToLinear();

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
    shader.uniforms.uCentre = centre;
    shader.uniforms.uFoamLod = FOAM_LOD_UNIFORM;
    shader.uniforms.uRipple = ripple;
    shader.uniforms.uSky = { value: sky };
    shader.uniforms.uHole = hole;
    shader.uniforms.uFoam = foamTex;
    // The master LOD's sphere — one set of objects, shared with the
    // terrain, so the two can never disagree about where she is or
    // how far her detail reaches.
    bindLodUniforms(shader.uniforms as Record<string, { value: unknown }>);
    // The sea's live amplitudes — where wave groups live. Shared by
    // both sheets and by the CPU queries, so one table moves them all.
    bindSwellUniforms(shader.uniforms as Record<string, { value: unknown }>);
    const swell = opts.swell;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\n attribute float depth;\n attribute vec2 flow;\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vLocal;\n varying vec2 vFlow;\n varying vec3 vRender;\n uniform vec2 uCentre;'
        + (swell ? `\n varying vec2 vSwell;\n varying float vSheet;\n uniform float uTime;\n ${swellUniformChunk()}` : ''))
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vDepth = depth;\n vFlow = flow;\n vLocal = vec2(position.x, position.z);\n vWorld = vLocal + uCentre;'
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
          // SHOALED, exactly as the CPU query shoals it (seaSwell.ts),
          // then flattened toward this sheet's own rim so it meets the
          // flat far sheet without a step.
          ${shoalChunk()}
          float swFade = shoal
            * (1.0 - smoothstep(${swell.rimLo.toFixed(1)}, ${swell.rimHi.toFixed(1)}, length(position.xz)));
          // …and a trough never cuts below the bed. Without this the
          // sheet drives through the sand in the shallows, which reads
          // as z-fighting because it IS the sheet and the seabed
          // trading places.
          float lift = max(sw * swFade, -max(0.0, depth - ${KEEL.toFixed(1)}));
          transformed.y += lift;
          vSwell = swSlope * swFade;
          vSheet = length(position.xz);
        }` : '')
        // THE SURFACE'S OWN RENDERED POSITION, all three axes and
        // AFTER the swell has moved it — the master LOD sphere is
        // measured to the water the player can actually see, not to
        // the flat sheet it started as. Rendered rather than world
        // coordinates because the queen's uniform is rendered too and
        // float32 cannot hold five million; their difference is what
        // the sphere reads, and a rebase moves both ends alike.
        + '\n vRender = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // The ripple field is computed ONCE, in map_fragment (which three
    // runs before the normal and lighting stages), and handed to the
    // later stages through gRn/gBody — the colour weave, the normal
    // tilt and the surf caps all read the same water.
    shader.fragmentShader = ('uniform float uTime;\nuniform sampler2D uRipple;\nuniform sampler2D uFoam;\nuniform vec3 uSky;\n' + swellUniformChunk() + '\n' + lodUniformsChunk() + '\n' + shader.fragmentShader)
      .replace('#include <common>', '#include <common>\n varying float vDepth;\n varying vec2 vWorld;\n varying vec2 vLocal;\n varying vec2 vFlow;\n varying vec3 vRender;\n uniform vec2 uCentre;\n uniform float uFoamLod;\n vec2 tiled(float T) { return (vLocal + mod(uCentre, vec2(T))) / T; }\n mat2 rrot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }\n vec3 gRn = vec3(0.0);\n float gBody = 0.0;'
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

          // ── THE MASTER LOD SPHERE OWNS ALL OF THE FOAM ───────────
          //
          // Foam is the first MICRO consumer (docs/LOD_ARCHITECTURE).
          // Distance is measured from the queen to THIS WATER SURFACE
          // in all three axes — vRender carries the vertex the swell
          // actually displaced — so a queen 166 m above a wave is 166 m
          // from it and it earns nothing. Not planar, not the camera's
          // distance, not the sheet's own radius: those were the three
          // wrong rulers this architecture exists to retire.
          //
          // THE BRANCH IS THE POINT, not the multiply. Everything
          // inside it is foam-specific: four texture samples, their
          // derivatives, and the swell sum the breaker phase needs.
          // Outside the sphere a fragment now SKIPS that work rather
          // than computing it and scaling it to nothing, which is what
          // makes this an LOD system rather than a fade. The ordinary
          // water above — ripple octaves, colour, alpha, the normal —
          // is untouched at every distance: this stage is about foam.
          //
          // Derivatives inside varying control flow are formally
          // undefined, and harmless here by construction: the branch
          // closes exactly where the feather reaches zero, so any
          // fragment that could be affected is one whose foam is
          // already being multiplied by ~0.
          ${microChunk('vRender', 'micro')}
          float foam = 0.0;
          if (micro > 0.0) {
          // THE BREAK. The swell dies at the shore fade (seaSwell.ts)
          // and this is where its energy goes: foam fronts that MARCH
          // SHOREWARD on the swell's own beat. Phase runs on DEPTH, so
          // each front follows the bathymetry contour the way a real
          // set wraps a beach, and sin(k*d + w*t) walks the crests
          // toward shallower water. The lace is Beyond Extinction's
          // reef-water caustic web, thresholded into bubbles — one
          // broad sheet of wash, one fine fizz — so a front is ragged
          // foam, never a painted stripe. Everything scales with the
          // wearer's surf band: a beach break for the ocean, a whisper
          // of bank-line for a stream.
          float surfLo = 320.0 * ${opts.surf.toFixed(3)};
          float surfHi = 30.0 * ${opts.surf.toFixed(3)};
          float surfN = texture2D(uRipple, tiled(300.0) + uTime * vec2(0.05, 0.03)).r;

          // ---- HOW MUCH FOAM THIS PIXEL CAN ACTUALLY HOLD -----------
          //
          // From 166 m the shoreline still drew individual lace, which
          // is detail nobody can resolve and which therefore arrives as
          // a dense crawling speckle rather than as surf. (Joshua: "at
          // that altitude the surf should still be visible, but I
          // should not be able to resolve tiny repeating foam detail".)
          //
          // THREE KNEES, NOT ONE SWITCH. Each foam ingredient has its
          // own tile size and so its own vanishing distance, and giving
          // them separate thresholds is what makes the shoreline
          // SIMPLIFY on the way out instead of popping between looks:
          // the fizz goes first, the broad lace holds on much longer,
          // and what is left at the far end is the shape of the
          // breaker, which is a function of the swell and the depth and
          // has no texture in it at all.
          //
          // Everything fades to the texture's MEAN COVERAGE, measured
          // off the shipped maps at these very thresholds — 0.333 for
          // the fizz, 0.158 for the lace, 0.0098 for the open-water
          // speckle. Fading to zero would delete the surf line; fading
          // to the mean keeps exactly as much white as was there and
          // simply stops resolving where it sits.
          vec2 fizzUv = tiled(95.0);
          float fizzTexels = max(length(dFdx(fizzUv)), length(dFdy(fizzUv))) * 1024.0;
          vec2 speckUv = tiled(300.0);
          float speckTexels = max(length(dFdx(speckUv)), length(dFdy(speckUv))) * 1536.0;
          float fineGone = uFoamLod * smoothstep(1.5, 12.0, fizzTexels);
          float laceGone = uFoamLod * smoothstep(6.0, 48.0, fizzTexels);
          float speckGone = uFoamLod * smoothstep(1.5, 14.0, speckTexels);

          // THE BAND IS NOT WIDENED WITH DISTANCE, though it was tried.
          //
          // Measured, after two metrics disagreed with my eyes: the
          // high-frequency content on distant water is NOT mostly the
          // foam lace. depth is the sampled seabed and the sampled
          // seabed is quantised, so a smoothstep over it terraces into
          // contour rings, and smoothing the foam above them uncovers
          // them. Widening this window to turn those terraces into
          // gradients spread the foam over far more water instead, and
          // measured 40% WORSE at 166 m rather than better. Left alone.
          float surf = smoothstep(surfLo, surfHi, depth);
          foam = surf * mix(smoothstep(0.60, 0.86, surfN), 0.0098, speckGone);
          {
            // THE FOAM RIDES THE WAVE THAT MADE IT.
            //
            // This used to run its phase on DEPTH against the swell's
            // frequency — foam fronts marching along bathymetry
            // contours at a speed set by the seabed's slope, which has
            // nothing to do with how fast the water is actually
            // moving. Joshua: "foam appears to travel faster than the
            // geometric waves... it feels like a separate animated
            // texture sliding across the water." It was.
            //
            // So the phase is now the SWELL ITSELF, summed here from
            // the same table the vertices are displaced by. Foam
            // appears on the crest and its front face, where a wave
            // steepens and breaks, and it therefore travels at exactly
            // the wave's own speed because it IS the wave.
            float sw = 0.0;
            vec2 swSlope = vec2(0.0);
            vec2 worldXZ = vWorld;
            ${swellChunk()}
            // Where this water sits in its own wave, -1 trough to +1
            // crest, and how steep the face is.
            float crest = clamp(sw / ${(swellReach() / 2).toFixed(2)}, -1.0, 1.0);
            // BREAKING happens in shallow water on a steep face, not
            // out at sea: gate hard on the column so open water stays
            // clean and the surf zone owns the foam.
            float shallow = 1.0 - smoothstep(60.0, 420.0, depth);
            // The crest, and a TAIL behind it — the wash that lingers
            // for a moment after the crest has gone by rather than
            // vanishing with it. The tail is the back face (a falling
            // surface), so it follows the crest shorewards and thins
            // as the wave passes.
            float face = smoothstep(0.15, 0.8, crest);
            float tail = smoothstep(0.0, 0.55, -dot(swSlope, vec2(${(0.9063).toFixed(4)}, ${(-0.4226).toFixed(4)})) * 40.0)
              * smoothstep(-0.6, 0.1, crest) * 0.55;
            float march = clamp((face + tail) * shallow, 0.0, 1.0);
            float lace = smoothstep(0.52, 0.86,
              dot(texture2D(uFoam, tiled(260.0) - uTime * vec2(0.012, 0.007)).rgb, vec3(0.3333)));
            float fizz = smoothstep(0.40, 0.80,
              dot(texture2D(uFoam, tiled(95.0) + uTime * vec2(0.016, -0.009)).rgb, vec3(0.3333)));
            // The fine fizz is the first thing to go, the broad lace
            // the last. Between them the breaker keeps its shape while
            // its grain dissolves, which is the gradient the eye reads
            // as distance rather than as a change of setting.
            fizz = mix(fizz, 0.333, fineGone);
            lace = mix(lace, 0.158, laceGone);
            // The breaker rides the band; a standing wash clings to
            // the waterline itself, densest in the last stretch of
            // depth, so the beach edge is always dressed even between
            // sets.
            // PALE, not merely smooth, at the far end.
            //
            // Fading the lace to its mean removes the grain but keeps
            // the brightness, and that turned out to UNMASK something:
            // surf is a smoothstep over depth, depth is the sampled
            // seabed, and the sampled seabed is quantised — so the far
            // water carries faint bathymetric terracing that the foam's
            // own texture had been hiding. Smoothing the texture without
            // softening the amplitude made those rings the most visible
            // thing on the water, and measured 57% MORE fine structure
            // rather than less.
            //
            // So the far tier is a soft pale band, which is what was
            // asked for: same shape, same shoreline, less of it.
            float pale = mix(1.0, 0.5, laceGone);
            float breaker = surf * march * (lace * 2.2 + fizz * 1.1) * pale;
            // The wash sits just OUTSIDE the waterline's alpha
            // feather (edgeLo..edgeHi) — foam painted inside it is
            // foam the fade erases, which is exactly how the first
            // cut of this block vanished. Its inner tail dissolving
            // into the feather is the wash dying on the sand.
            // THE SWASH LINE, and where it sits is the whole point.
            // Peaked at 40 it lived inside the alpha feather, where
            // the sheet is barely 1% there — dense foam nobody could
            // see. It now crowds the band just OUTSIDE the feather,
            // where the water is solid, so the edge of the sea is
            // drawn as a bright rim of wash rather than a fade.
            float wash = smoothstep(170.0 * ${opts.surf.toFixed(3)}, 95.0 * ${opts.surf.toFixed(3)}, depth)
              * (lace * 0.85 + fizz * 0.35) * pale;
            foam = clamp(foam + breaker + wash, 0.0, 1.0);
          }
          // Open-water caps. The wave map's slope energy runs in thin
          // crest LINES (Joshua's 1x1 m chop map, sd 19-34/255), and a
          // bare threshold paints those lines as white scratches. Gating
          // against the second, independently scrolling sample keeps
          // only the spots where the two patterns cross — beads of
          // foam that wink in and out, not dashes.
          vec3 cn = texture2D(uRipple, tiled(700.0) - uTime * vec2(0.02, 0.028)).xyz * 2.0 - 1.0;
          // Caps fade to NOTHING rather than to a mean: a whitecap is
          // a metre of broken water in open sea, so far enough out
          // there is genuinely none of it in the pixel. The shoreline
          // is the opposite — there is always surf on it — which is why
          // that one keeps its mean and this one does not.
          float caps = smoothstep(0.75, 1.10, length(cn.xy))
            * smoothstep(0.55, 0.80, surfN) * (1.0 - fineGone);
          foam = clamp(foam + caps * 0.4, 0.0, 1.0);
          // AND THE WHOLE OF IT RIDES THE SPHERE. Every ingredient at
          // once — lace, fizz, speckle, breaker, swash, caps and the
          // mean-coverage floors they fade to — so beyond the radius
          // there is no foam of any kind left on the water, not even a
          // pale averaged band. If the coastline later wants a cheap
          // far-distance surf line it will be designed as a MACRO
          // shoreline feature, not smuggled in here.
          //
          // TWO GATES, LESSER WINS: the three fineGone/laceGone/
          // speckGone knees above are
          // the screen-space safeguard and still simplify what a pixel
          // cannot resolve INSIDE the sphere; this is the master's
          // gate, and it is the one that reaches zero.
          foam *= micro;
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);

          // BE's clear-water alpha: see the sand at the waterline, a
          // real body offshore, foam near-opaque. BE's band started at
          // 40..550; it starts sooner now so shin-deep water over sand
          // is visibly WATER — the waterline feather itself is edge's
          // job and unchanged.
          diffuseColor.a *= mix(1.0, 1.55, smoothstep(15.0, 320.0, depth));
          diffuseColor.a = min(diffuseColor.a, 0.82);
          diffuseColor.a = mix(diffuseColor.a, 0.95, foam);

          // NEARER MEANS MORE VISIBLE, and only nearer.
          //
          // Shin-deep water over bright sand is nearly invisible from
          // inside it: the column you are looking through is a couple
          // of centimetres of very clear water, so almost no colour
          // accumulates and the sand reads straight through. From a few
          // metres up the same water looks superb, because the slant
          // path through it is long. (Joshua: "several meters up look
          // amazing for the ocean, but right along the shore is still
          // too transparent... by 2.5m away, make it exactly like now
          // to get the best of both worlds.")
          //
          // So this is a VIEWING-DISTANCE term and nothing else. It is
          // exactly 1.0 by 250 units, which makes every frame he
          // approved bit-identical, and it multiplies BEFORE the
          // waterline feather so the edge stays precisely where it was
          // — the fade he asked me to revert once already is untouched.
          float closeUp = 1.0 - smoothstep(60.0, 250.0, length(vViewPosition));
          diffuseColor.a = min(0.95, diffuseColor.a * mix(1.0, 1.9, closeUp));
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
