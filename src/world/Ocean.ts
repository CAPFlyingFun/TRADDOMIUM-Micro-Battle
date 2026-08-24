import * as THREE from 'three';
import { SAMPLES, SPAN, UNITS_PER_METRE } from './kauai';
import { reliefScale } from './heightfield';
import { originAt } from './origin';
import { foldAt, swellGLSL } from './swell';

/**
 * THE SEA AROUND KAUAʻI.
 *
 * Ported from Beyond Extinction's ocean and adapted where TMB is a
 * different world: a hundred times the numeric scale, a floating origin
 * BE never had, and a camera four centimetres off the ground rather
 * than at a swimmer's eye.
 *
 * What it replaces is a flat translucent disc at y = 0. What it adds:
 * a real swell the CPU can also evaluate (ocean.ts), a coastline that
 * comes from the island's own elevation rather than a guessed radius,
 * water that is turquoise over the reef and navy offshore, surf at the
 * waterline, and a sky sheen at grazing angles.
 *
 * THREE RULES HOLD THIS TOGETHER:
 *
 *  1. NOTHING LARGE REACHES THE GPU. Wave phase, ripple tiling and the
 *     seabed lookup all need a WORLD position, and world positions here
 *     run to 2.8 million where float32 steps by a quarter of a unit.
 *     Each is folded on the CPU in float64 — the phase into one turn,
 *     the ripples into one tile, the seabed into a texture coordinate —
 *     and only the fold plus a small local position reaches a shader.
 *     This is the ground-texture lesson (terrainMaterial.ts) applied
 *     before it can bite rather than after.
 *
 *  2. THE MESH FOLLOWS THE CAMERA, the water does not. A radial grid
 *     recentred every frame keeps the vertices where the detail is
 *     wanted; because every wave is a function of world position, the
 *     surface itself stays nailed to the island while the grid slides
 *     underneath it.
 *
 *  3. ONE SWELL, TWO CONSUMERS. The vertex shader's `seaH` is generated
 *     from the same table `seaHeightAt` reads. See ocean.ts.
 */

/** The mesh's innermost ring, in world units. Two centimetres. */
const NEAR = 200;
/**
 * Where the fine rings stop and the cheap ones start.
 *
 * The swell is faded out before here, so everything beyond is a flat
 * sheet carrying only the ripple normal — which is why it can be as
 * coarse as it likes.
 */
const FINE_TO = 24_000;
/** Spacing of the fine rings. Ten times finer than the shortest wave. */
const FINE_STEP = 300;
/** Rings from FINE_TO out to the horizon, growing geometrically. */
const FAR_RINGS = 40;
const SECTORS = 96;

/**
 * WHERE THE SWELL GIVES UP, in world units from the camera.
 *
 * Not a taste decision: past this the ring spacing can no longer hold
 * the shortest wave (39 m) without aliasing it into a shimmer. It is
 * also further than it sounds — 120 to 240 metres, which for a queen
 * two centimetres long is most of a horizon.
 */
const SWELL_FROM = 12_000;
const SWELL_TO = 24_000;

/**
 * The seabed texture's encoding range, in world units of elevation.
 *
 * Eight-bit, so the range is chosen rather than the precision: from
 * three metres of dry beach down to twelve of water, which covers the
 * reef shelf and the whole of the coastline fade at about six
 * centimetres a step. Deeper than this is simply "deep", and the colour
 * has already saturated by then.
 */
const BED_LOW = -1_200;
const BED_HIGH = 300;

/** Ripple octaves: tile size in world units, rotation, and drift. */
const RIPPLES: readonly { tile: number; turn: number }[] = [
  { tile: 1_730, turn: 0.0 },
  { tile: 870, turn: 2.1 },
  { tile: 390, turn: 4.3 },
  { tile: 150, turn: 1.2 },
];

/**
 * A polar grid centred on the viewer: uniform rings where the swell is
 * drawn, geometric ones out to the horizon where it is not.
 *
 * BE grew its rings geometrically the whole way, which is right when
 * the fade is 1.4 km out in a world of metres. Here the shortest wave
 * is 39 m and a purely geometric grid is already spacing vertices
 * further apart than that by the time the fade begins — so the waves
 * would alias exactly where they are meant to be visible. The fine zone
 * costs eighty rings and buys a swell that holds its shape.
 */
export function buildOceanGrid(reach: number): THREE.BufferGeometry {
  const radii: number[] = [];
  for (let r = NEAR; r < FINE_TO; r += FINE_STEP) radii.push(r);
  const ratio = (reach / FINE_TO) ** (1 / FAR_RINGS);
  for (let i = 0; i <= FAR_RINGS; i++) radii.push(FINE_TO * ratio ** i);

  const points: number[] = [0, 0, 0];
  for (const r of radii) {
    for (let s = 0; s < SECTORS; s++) {
      const a = (s / SECTORS) * Math.PI * 2;
      points.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }

  const faces: number[] = [];
  for (let s = 0; s < SECTORS; s++) {
    faces.push(0, 1 + ((s + 1) % SECTORS), 1 + s);
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    const inner = 1 + ring * SECTORS;
    const outer = inner + SECTORS;
    for (let s = 0; s < SECTORS; s++) {
      const next = (s + 1) % SECTORS;
      faces.push(inner + s, inner + next, outer + s);
      faces.push(inner + next, outer + next, outer + s);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  // The grid moves with the camera and is larger than any view, so the
  // usual sphere test can only ever get this wrong.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), reach * 1.1);
  return geometry;
}

/**
 * THE SEABED, AS A TEXTURE, BUILT FROM THE ISLAND ITSELF.
 *
 * No download: the height grid is already in memory, and below the
 * waterline `terrainHeight` returns it unmodified — the procedural
 * relief is eased in only over the first four metres of dry land. So
 * the raw grid IS the seabed, exactly, everywhere the ocean is drawn.
 *
 * A separate coast mask (BE bakes one) would be a second source of
 * truth about where the coastline is, and the first re-bake of the
 * terrain would start it lying.
 */
export function seabedTexture(grid: Int16Array): THREE.DataTexture {
  const codes = new Uint8Array(SAMPLES * SAMPLES);
  const span = BED_HIGH - BED_LOW;
  for (let i = 0; i < codes.length; i++) {
    // The grid is decimetres of real metres; one metre is UNITS_PER_METRE.
    const height = (grid[i] / 10) * UNITS_PER_METRE;
    const t = (height - BED_LOW) / span;
    codes[i] = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
  }
  const texture = new THREE.DataTexture(
    codes, SAMPLES, SAMPLES, THREE.RedFormat, THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export class Ocean {
  readonly mesh: THREE.Mesh;

  private readonly material: THREE.MeshStandardMaterial;
  private readonly clock = { value: 0 };
  private readonly phase = { value: new THREE.Vector3() };
  private readonly bedUv = { value: new THREE.Vector2() };
  private readonly ripples = {
    value: RIPPLES.map(() => new THREE.Vector2()),
  };
  private readonly relief = { value: 1 };
  private readonly rippleMap: { value: THREE.Texture };
  private seconds = 0;

  constructor(scene: THREE.Scene, grid: Int16Array, ripple: THREE.Texture | null) {
    const flat = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    flat.needsUpdate = true;
    this.rippleMap = { value: ripple ?? flat };
    this.material = this.build(grid);
    this.mesh = new THREE.Mesh(buildOceanGrid(SPAN * 0.95), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.reorigin();
  }

  /**
   * Run the sea for a frame.
   *
   * @param at the camera's RENDERED position — the grid is recentred on
   *   it, which is the one thing here that is allowed to be local.
   */
  update(at: THREE.Vector3, dt: number): void {
    this.seconds += dt;
    this.clock.value = this.seconds;
    this.relief.value = reliefScale();
    // Snapped to the fine ring spacing rather than followed exactly. A
    // grid that slides continuously re-rounds every vertex every frame,
    // and the whole surface crawls — the same reason the middle terrain
    // tier snaps to its own step.
    this.mesh.position.set(
      Math.round(at.x / FINE_STEP) * FINE_STEP, 0,
      Math.round(at.z / FINE_STEP) * FINE_STEP,
    );
  }

  /**
   * The world moved under the scene: refold everything that depends on
   * where the origin is. Called on every rebase, and once at birth.
   */
  reorigin(): void {
    const origin = originAt();
    const folded = foldAt(origin.x, origin.z);
    this.phase.value.set(folded[0], folded[1], folded[2]);
    // The seabed lookup covers the whole island, so its texture
    // coordinate cannot be folded into a tile — its tile IS the island.
    // Instead the ORIGIN's coordinate is computed here in float64 and
    // the small local offset added in the shader. See WATER_PORT.md.
    this.bedUv.value.set(origin.x / SPAN + 0.5, origin.z / SPAN + 0.5);
    // The ripples do tile, so each gets its own remainder — the same
    // trick, and for the same reason, as the ground texture's.
    RIPPLES.forEach((r, i) => {
      const fold = (v: number) => ((v % r.tile) + r.tile) % r.tile;
      this.ripples.value[i].set(fold(origin.x), fold(origin.z));
    });
  }

  /**
   * Take the ripple map once it arrives.
   *
   * Late rather than awaited: the sea draws from the first frame with a
   * flat normal, and a boot that blocked on twelve kilobytes to show
   * glassy water instead of chopped water is a boot that is wrong about
   * what matters.
   */
  wear(texture: THREE.Texture): void {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.needsUpdate = true;
    this.rippleMap.value = texture;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }

  private build(grid: Int16Array): THREE.MeshStandardMaterial {
    const wave = this.rippleMap.value;
    wave.wrapS = THREE.RepeatWrapping;
    wave.wrapT = THREE.RepeatWrapping;
    wave.colorSpace = THREE.NoColorSpace;
    wave.needsUpdate = true;

    const material = new THREE.MeshStandardMaterial({
      color: 0x1a6389,
      roughness: 0.18,
      // LOW metalness on purpose: a mirror seen steeply reflects the
      // dark water beneath it and reads near-black. The Fresnel term
      // below supplies the sky glint at grazing angles instead.
      metalness: 0.1,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      // Z-FIGHT GUARD at the waterline, where the wet-sand shelf is
      // very nearly coplanar with the sea. Generous and
      // distance-adaptive by nature: a depth unit is a fraction of a
      // millimetre underfoot and metres at the horizon, so this barely
      // moves the near shoreline and decisively settles the far one.
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 12,
    });

    const bed = { value: seabedTexture(grid) };
    const sky = { value: new THREE.Color(0x9fc6df).convertSRGBToLinear() };

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.clock;
      shader.uniforms.uPhase = this.phase;
      shader.uniforms.uBedUv = this.bedUv;
      shader.uniforms.uRipple = this.rippleMap;
      shader.uniforms.uRippleFold = this.ripples;
      shader.uniforms.uBed = bed;
      shader.uniforms.uSky = sky;
      shader.uniforms.uRelief = this.relief;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSea;
          uniform float uTime;
          uniform vec3 uPhase;
          ${swellGLSL()}
          float seaLift;`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
          vec3 seaAt = (modelMatrix * vec4(position, 1.0)).xyz;
          // Faded by distance from the eye, because past the fine rings
          // the grid cannot hold the shortest wave and would alias it
          // into a shimmer. No texture fetch here: a vertex sample is
          // unreliable on some mobile GPUs and on SwiftShader, and a
          // NaN in a vertex is a black triangle.
          float seaFade = 1.0 - smoothstep(
            ${SWELL_FROM.toFixed(1)}, ${SWELL_TO.toFixed(1)},
            length(seaAt.xz - cameraPosition.xz));
          seaLift = seaH(seaAt.xz, uTime, uPhase) * seaFade;
          vec2 seaG = seaSlope(seaAt.xz, uTime, uPhase) * seaFade;
          objectNormal = normalize(vec3(-seaG.x, 1.0, -seaG.y));`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          transformed.y += seaLift;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
          vSea = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSea;
          uniform sampler2D uRipple, uBed;
          uniform vec2 uBedUv;
          uniform vec2 uRippleFold[${RIPPLES.length}];
          uniform vec3 uSky;
          uniform float uTime, uRelief;
          mat2 spin(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          {
            // MULTI-OCTAVE ROTATED RIPPLE. The swell fades to flat far
            // out and in the shallows, and without this the bare plane
            // reads as ice. Each octave is the same tiling normal map at
            // a different scale AND a different odd rotation, so their
            // repeats never line up into the diamond moiré that a plain
            // stack produces. Each is offset by its own folded origin
            // remainder, so the pattern is nailed to the island rather
            // than swimming with the camera-centred grid.
            float eye = distance(vSea, cameraPosition);
            float wide = 1.0 - smoothstep(30000.0, 260000.0, eye);
            float close = 1.0 - smoothstep(300.0, 5500.0, eye);
            vec3 chop = vec3(0.0);
            ${RIPPLES.map((r, i) => {
    const weight = ['1.0', '0.8 * wide', '0.65 * wide', '0.7 * close'][i];
    const drift = ['vec2(0.021,0.013)', '-vec2(0.017,0.024)',
      'vec2(0.032,-0.019)', 'vec2(-0.045,0.05)'][i];
    return `chop += (texture2D(uRipple, spin(${r.turn.toFixed(4)})
              * ((vSea.xz + uRippleFold[${i}]) / ${r.tile.toFixed(1)})
              + uTime * ${drift}).xyz - 0.5) * (${weight});`;
  }).join('\n            ')}
            normal = normalize(normal + vec3(chop.x, 0.0, chop.y) * 0.55);
          }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // THE COASTLINE, FROM THE ISLAND'S OWN ELEVATION. The uv is
            // the ORIGIN's, computed in float64 on the CPU, plus this
            // fragment's small local offset — never the world position
            // rebuilt in float32, which is the bug that striped the
            // ground.
            float code = texture2D(uBed, uBedUv + vSea.xz / ${SPAN.toFixed(1)}).r;
            float bed = (${BED_LOW.toFixed(1)}
              + code * ${(BED_HIGH - BED_LOW).toFixed(1)}) * uRelief;

            // DISTANCE-ADAPTIVE WATERLINE. Close in the shoreline is
            // tight, because a queen is two centimetres long and a soft
            // edge would be a swamp. Far away the threshold opens out so
            // the near-coplanar reef shelf goes transparent instead of
            // shimmering on and off as the view moves.
            float far = clamp((eyeDist - 20000.0) / 300000.0, 0.0, 1.0);
            float dry = mix(0.0, -40.0, far);
            float wet = mix(-25.0, -600.0, far);
            float coast = smoothstep(0.0, 1.0, clamp((bed - dry) / (wet - dry), 0.0, 1.0));
            diffuseColor.a *= coast;
            if (diffuseColor.a < 0.01) discard;

            // Turquoise over the reef, navy offshore. Kauaʻi's water.
            float deep = clamp(-bed, 0.0, 800.0);
            float shallow = 1.0 - smoothstep(30.0, 450.0, deep);
            diffuseColor.rgb = mix(
              vec3(0.008, 0.10, 0.26), vec3(0.020, 0.34, 0.42), shallow * shallow);

            // Surf at the waterline, and the odd whitecap offshore.
            float surf = smoothstep(160.0, 15.0, deep);
            float sud = texture2D(uRipple,
              (vSea.xz + uRippleFold[3]) / 600.0 + uTime * vec2(0.05, 0.03)).r;
            vec3 cap = texture2D(uRipple,
              (vSea.xz + uRippleFold[2]) / 1400.0 - uTime * vec2(0.02, 0.028)).xyz * 2.0 - 1.0;
            float foam = clamp(surf * smoothstep(0.60, 0.86, sud)
              + smoothstep(0.55, 0.95, length(cap.xy)) * 0.45, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.90, 0.95, 0.97), foam);

            // Clear in the shallows so the reef reads through, closing up
            // with depth so deep water is a body of water and not a film.
            diffuseColor.a = clamp(
              diffuseColor.a * mix(1.45, 0.85, shallow) + foam * 0.5, 0.0, 1.0);
            // FROM BELOW, THE SURFACE IS THE CEILING OF A BODY OF WATER,
            // not the back of a transparent sheet. Total internal
            // reflection is far beyond this material, but the visual
            // contract is the same one the contained inland water uses:
            // darker, bluer and opaque enough to close the world above.
            if (!gl_FrontFacing) {
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.003, 0.035, 0.10), 0.76);
              diffuseColor.a = max(diffuseColor.a, 0.86);
            }
          }`)
        // The sky, at a grazing angle. Cheap Schlick against the surface
        // normal — the one thing that stops flat water reading as paint.
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          {
            float face = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
            float glint = pow(1.0 - face, 5.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSky, glint * 0.55);
          }`);

      // `eyeDist` is wanted in map_fragment, which three.js emits BEFORE
      // the normal block that computes it — so it is hoisted rather than
      // computed twice.
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {', 'void main() {\n  float eyeDist = distance(vSea, cameraPosition);',
      );
    };

    return material;
  }
}
