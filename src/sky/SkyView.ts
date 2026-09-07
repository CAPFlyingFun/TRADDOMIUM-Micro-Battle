/**
 * THE SKY, DRAWN — a dome on the camera wearing two of the baked skies,
 * and the hand that moves the scene's sun, sky-light, fog and
 * background to agree with it.
 *
 * What `terrain/` is to the ground and `sea/` to the water, this is to
 * the air: the one place `skyLook`'s numbers meet three. It owns the
 * dome and the textures on it and NOTHING ELSE. The scene's lights, fog
 * and background belong to the scene; it hands them in through `bind`
 * and this writes into exactly what it was handed, every frame, so a
 * reader of the scene can see in one line what the sky is allowed to
 * touch (ARCHITECTURE §2.1).
 *
 * ─── the dome ────────────────────────────────────────────────────────
 *
 * One sphere, centred on the camera every frame, its radius just inside
 * the far plane (`DOME_OF_FAR`), viewed from inside. It neither reads
 * nor writes depth and it is drawn first (`DOME_RENDER_ORDER`), so
 * everything else paints over it and nothing can ever be behind it: it
 * is the far plane made visible. `frustumCulled` is off for the reason
 * the sea's sheets have it off — a sphere centred on the camera always
 * contains it, so a frustum test could only ever be wrong.
 *
 * The fragment shader samples TWO equirectangular maps and mixes them
 * by `look.mix`: one draw, two texture reads a fragment, and that is
 * the whole cost on a phone. Each map is rotated about +y by (the real
 * sun's bearing − the bearing its sun was baked at), so the photographed
 * sun sits where NOAA says the real one is (`world/weather/solar.ts`),
 * and the two maps of a cross-fade each carry their own rotation, so a
 * dawn fades from a night glow to a dusk glow on the same side of the
 * sky. The bearing convention is the island's: north is −z, east is +x,
 * clockwise from above, exactly `coords`' compass.
 *
 * Below the horizon and for a few degrees above it the dome is the
 * HORIZON colour — the same colour the fog and the background are set
 * to — so the fogged far ground meets the sky without a line
 * (`HORIZON_BAND`). Fog is OFF on the dome itself: the dome is where
 * the fog goes, not a thing the fog is applied to.
 *
 * ─── the textures ────────────────────────────────────────────────────
 *
 * Loaded LAZILY, per sky, the first time a look needs one, through the
 * loader the owner hands in (`assets/skySource.ts` is the real one; a
 * test hands in a stub). Until a sky arrives the dome shows the horizon
 * colour for it — a fogged sky, which is a look and not a failure. A
 * sky the look has stopped reading is kept for `RELEASE_AFTER_UPDATES`
 * frames and then released, so at most two are ever resident for long,
 * plus the one that just faded out: at `medium` that is two 512 × 256
 * images, one megabyte, and the whole day's four never sit on the GPU
 * at once. The grace is there so a cloud value hovering at the edge of
 * the day fade does not fetch and drop the same file every second.
 *
 * ─── the lights ──────────────────────────────────────────────────────
 *
 * The sun light is moved to the sun's direction — elevation and bearing
 * to a unit vector, and the light sits `SUN_DISTANCE` along it from the
 * camera, its target on the camera — and given the look's intensity and
 * colour. The hemisphere light takes the look's sky and ground colours
 * and its intensity. All colours arrive as sRGB, the convention every
 * colour in the scene is written in, and are converted on the way in.
 *
 * ─── the shadow ──────────────────────────────────────────────────────
 *
 * The sun light may cast ONE shadow map over a square of ground that
 * follows the camera — the first shadow the game has, and by Joshua's
 * brief (2026-09-07) the smallest that is useful: no cascades, a map
 * and a reach per detail rung (`sky/shadows.ts` holds the table and
 * the fades), and nothing at all on the rungs under `medium`. The
 * owner hands the rung's spec in with the lights (`SkyLights.shadow`,
 * optional: absent, the sun casts nothing and this writes nothing
 * about shadows) and calls `setShadow` when the rung changes.
 *
 * THE MAP IS THREE'S TO ALLOCATE AND OURS TO LET GO OF. three builds
 * the render target the first time it renders the light, at whatever
 * `mapSize` says then, and never looks at `mapSize` again — so a rung
 * change must dispose the old map and null it, or a phone that drops
 * to `medium` keeps rendering into a 1024² map for ever. `setShadow`
 * does exactly that, and only when the size actually changed.
 *
 * THE SQUARE MOVES IN WHOLE TEXELS. The shadow camera three builds
 * sits at the light and looks at the target; if both simply followed
 * the eye, the map's texel grid would slide under the world by a
 * fraction of a texel every frame and every shadow edge would crawl as
 * she walked. So the eye is SNAPPED, before the light and the target
 * are placed, to the lattice of texels in the map's own plane — the
 * basis `Matrix4.lookAt` gives the shadow camera, which is the same
 * call `Object3D.lookAt` makes for it, zenith nudge and all — and the
 * grid stays put while the camera moves inside a texel. Snapping in
 * the light's plane rather than in world x/z is what makes this hold
 * at a low sun: a world step is a whole texel in the map only when the
 * sun is overhead. The snap moves the light and the target by the same
 * offset, perpendicular to the sun, so the light's DIRECTION is exactly
 * what it was without a shadow; only the anchor differs from the eye,
 * by under a texel.
 *
 * The bias is all NORMAL bias (`shadows.shadowNormalBias`: 1.5 texels
 * in world units, which is over the float32 spacing at the coast) and
 * no depth bias, so a shadow does not detach from the foot that casts
 * it. Per frame: the light casts only while `shadows.shadowCasts` says
 * a shadow would show — a sun, not the night's 0.06; a height above
 * the floor; a sky not closed over — and `shadow.intensity` carries the
 * height and cloud fades, a uniform three mixes per fragment, so no
 * shader is rebuilt as the sun climbs. The `shadow` readout is for the
 * HUD and the tests: the map, the reach, whether it is casting, and
 * how strongly.
 *
 * ─── the fog ─────────────────────────────────────────────────────────
 *
 * The scene's fog is LINEAR (`THREE.Fog`), and it stays linear; this
 * sets its near and far from the look's density. THE CONVERSION: the
 * look's density ρ is the exp²-fog rule √(−ln 0.05)/sight, so the
 * distance at which 5% of a surface is left — visibility, as a forecast
 * means it — is `sight = √(−ln 0.05)/ρ`. three's linear fog leaves
 * 1 − smoothstep(near, far, d) of a surface at d, so 5% is left where
 * the smoothstep reaches 0.95, at t = 0.8647 of the way from near to
 * far (`SMOOTHSTEP_AT_95`, solved rather than typed). Keeping the
 * scene's own near/far RATIO (`FOG_NEAR_OF_FAR`, its 0.25 and 0.95 of
 * the far plane), far = sight / (r + t(1 − r)) and near = r·far put the
 * 5% distance exactly at the visibility. And the far end never passes
 * `FOG_FAR_OF_CLIP` of the camera's far plane, for the reason the scene
 * had that fraction: the clip edge must always be fogged, or the
 * clipmap is cut into a hard-edged disc against the dome. A `FogExp2`,
 * if the scene ever wears one, takes ρ directly.
 */
import * as THREE from 'three';
import { bakedSky, type SkyImageId } from '../assets/skyManifest';
import { prepareSkyTexture } from '../assets/skySource';
import type { TextureTier } from '../assets/textureQuality';
import { shadowCasts, shadowIntensityFor, shadowNormalBias, type ShadowSpec } from './shadows';
import { sightFor, type Rgb, type SkyLook } from './skyLook';

export interface SkyViewOptions {
  readonly tier: TextureTier;
  /** One sky at one rung, when it is first needed. `assets/skySource.skyLoaderFor` is the real one. */
  readonly load: (id: SkyImageId, tier: TextureTier) => Promise<THREE.Texture>;
}

/** What the OWNER hands in. The view writes into these and constructs none of them. */
export interface SkyLights {
  readonly sun: THREE.DirectionalLight;
  readonly hemisphere: THREE.HemisphereLight;
  /** The scene's fog. Linear stays linear; exp² takes the density; null is no fog. */
  readonly fog: THREE.Fog | THREE.FogExp2 | null;
  /** `scene.background`, as the colour it is. */
  readonly background: THREE.Color;
  /**
   * The sun's shadow for the detail rung (`shadows.shadowFor`), when the
   * owner wants one. Absent or a zero map, the sun casts nothing and the
   * view writes nothing about shadows. Optional so a caller that has no
   * shadow to hand in need not say so.
   */
  readonly shadow?: ShadowSpec;
}

/** What the shadow is doing right now. For a HUD, and for a test. */
export interface ShadowReadout {
  /** Texels a side of the map in use; 0 is no shadow. */
  readonly mapSize: number;
  /** Half the square's width, world units. */
  readonly reach: number;
  /** Whether the light is casting this frame. */
  readonly casting: boolean;
  /** `shadow.intensity`: the height and cloud fades, 0..1. */
  readonly intensity: number;
}

/** Drawn before everything: the lowest order anything in the scene uses. */
export const DOME_RENDER_ORDER = -1000;
/** The dome's radius as a fraction of the camera's far plane: inside it, or the GPU clips it. */
export const DOME_OF_FAR = 0.98;
/** How far along the sun vector the directional light sits from the camera. Any distance; this one. */
export const SUN_DISTANCE = 1000;
/** The shadow camera's near plane, world units: just off the light, which nothing is ever that close to. */
export const SHADOW_NEAR = 1;
/**
 * The shadow camera's far plane for a reach: from the light, past the
 * eye by the same distance again and the square's whole width, so the
 * ground under a camera well above it is still inside the depth range.
 */
export function shadowFarFor(reach: number): number {
  return 2 * SUN_DISTANCE + 2 * reach;
}
/** The scene's fog near over its far — the 0.25 and 0.95 of the far plane `PerformanceWorldScene` chose. */
export const FOG_NEAR_OF_FAR = 0.25 / 0.95;
/** The fog's far end never passes this fraction of the camera's far plane. */
export const FOG_FAR_OF_CLIP = 0.95;
/** Frames a sky the look has stopped reading is kept before its texture is released. */
export const RELEASE_AFTER_UPDATES = 600;
/** Above the horizon (in the direction's y) over which the dome blends from the horizon colour to the image. */
export const HORIZON_BAND = 0.1;

/** The t at which 3t² − 2t³ = 0.95: where three's linear fog leaves 5% of a surface. */
export const SMOOTHSTEP_AT_95 = smoothstepInverse(0.95);

function smoothstepInverse(y: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (mid * mid * (3 - 2 * mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Linear-fog near and far for a visibility, so that 5% of a surface is
 * left at `sight` — see the header — held inside the camera's clip.
 */
export function fogRangeFor(sight: number, clipFar: number): { near: number; far: number } {
  const r = FOG_NEAR_OF_FAR;
  const bySight = Math.max(1, sight) / (r + SMOOTHSTEP_AT_95 * (1 - r));
  const byClip = Number.isFinite(clipFar) && clipFar > 0 ? clipFar * FOG_FAR_OF_CLIP : Infinity;
  const far = Math.max(1, Math.min(bySight, byClip));
  return { near: far * r, far };
}

/** A bearing (radians clockwise from north) and an elevation as a unit vector: north is −z, east +x, up +y. */
export function sunVector(azimuth: number, elevation: number, out = new THREE.Vector3()): THREE.Vector3 {
  const flat = Math.cos(elevation);
  return out.set(Math.sin(azimuth) * flat, Math.sin(elevation), -Math.cos(azimuth) * flat);
}

/** The angle a sky's map is turned about +y so its baked sun sits at the real sun's bearing. */
export function domeRotationFor(id: SkyImageId, sunAzimuth: number): number {
  return sunAzimuth - bakedSky(id).sunAzimuth * Math.PI * 2;
}

/** The dome's uniforms, by name. Read by tests; written only here. */
export interface SkyUniforms {
  readonly uMapA: { value: THREE.Texture };
  readonly uMapB: { value: THREE.Texture };
  readonly uHasA: { value: number };
  readonly uHasB: { value: number };
  readonly uRotA: { value: number };
  readonly uRotB: { value: number };
  readonly uMix: { value: number };
  readonly uDim: { value: number };
  readonly uHorizon: { value: THREE.Color };
}

const VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  // A unit sphere on the camera: the vertex IS the direction.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
#define SKY_PI 3.141592653589793
#define SKY_TWO_PI 6.283185307179586
uniform sampler2D uMapA;
uniform sampler2D uMapB;
uniform float uHasA;
uniform float uHasB;
uniform float uRotA;
uniform float uRotB;
uniform float uMix;
uniform float uDim;
uniform vec3 uHorizon;
varying vec3 vDir;

// Equirectangular lookup: u from the bearing (clockwise from north,
// north −z, east +x), turned by the map's rotation; v from the
// elevation. The top row of the map is the zenith.
vec2 equirect(vec3 d, float rot) {
  float bearing = atan(d.x, -d.z);
  float u = fract((bearing - rot) / SKY_TWO_PI);
  float v = asin(clamp(d.y, -1.0, 1.0)) / SKY_PI + 0.5;
  return vec2(u, v);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 a = mix(uHorizon, texture2D(uMapA, equirect(d, uRotA)).rgb, uHasA);
  vec3 b = mix(uHorizon, texture2D(uMapB, equirect(d, uRotB)).rgb, uHasB);
  vec3 sky = mix(a, b, uMix) * uDim;
  // The rim and everything under it is the horizon colour: where the fog ends, the dome begins.
  float above = smoothstep(0.0, ${HORIZON_BAND.toFixed(3)}, d.y);
  gl_FragColor = vec4(mix(uHorizon, sky, above), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Slot {
  texture: THREE.Texture | null;
  /** The load is in flight. */
  pending: boolean;
  /** The look read this sky in the current update. Cleared by `release`. */
  read: boolean;
  /** Whole updates since the look last read this sky. */
  idle: number;
}

export class SkyView {
  /** One group, so a layer toggle is one `visible` and never a walk. */
  readonly group = new THREE.Group();
  readonly tier: TextureTier;
  readonly uniforms: SkyUniforms;

  private readonly dome: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly placeholder: THREE.DataTexture;
  private readonly load: SkyViewOptions['load'];
  private readonly slots = new Map<SkyImageId, Slot>();
  private lights: SkyLights | null = null;
  private disposed = false;

  private readonly eye = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly horizon = new THREE.Color();

  /** The shadow as applied: written by `applyShadow` and `update`, read through `shadow`. */
  private readonly shadowState = { mapSize: 0, reach: 0, casting: false, intensity: 0 };
  /** The shadow camera's basis and the snapped eye, kept so a frame allocates nothing. */
  private readonly basis = new THREE.Matrix4();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();

  constructor(options: SkyViewOptions) {
    this.tier = options.tier;
    this.load = options.load;
    this.group.name = 'sky';

    // A 1 × 1 texture for a sampler that has nothing yet: the shader
    // weights it by zero, but the sampler must be bound to something.
    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.placeholder.needsUpdate = true;

    this.uniforms = {
      uMapA: { value: this.placeholder },
      uMapB: { value: this.placeholder },
      uHasA: { value: 0 },
      uHasB: { value: 0 },
      uRotA: { value: 0 },
      uRotB: { value: 0 },
      uMix: { value: 0 },
      uDim: { value: 1 },
      uHorizon: { value: new THREE.Color(0, 0, 0) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as unknown as Record<string, THREE.IUniform>,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    // 32 × 16 is plenty: the lookup is per fragment on the normalised
    // direction, so the mesh only has to be round enough at the silhouette,
    // and there is no silhouette — it is behind everything.
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.material);
    this.dome.name = 'skydome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = DOME_RENDER_ORDER;
    this.group.add(this.dome);
  }

  /** Hand in the scene's lights, fog and background. The view writes into these and nothing else outside itself. */
  bind(lights: SkyLights): void {
    this.lights = lights;
    this.applyShadow(lights.shadow ?? null);
  }

  /**
   * The rung changed: a new map and reach, or none. Lets go of the old
   * map when the size changed, because three never will (see the
   * header). Nothing until `bind`: the spec travels with the lights.
   */
  setShadow(spec: ShadowSpec | null): void {
    if (this.disposed) return;
    this.applyShadow(spec);
  }

  /** What the shadow is doing: the map and reach in use, and this frame's casting and strength. */
  get shadow(): ShadowReadout {
    return this.shadowState;
  }

  /** Configure the bound sun's shadow for a spec, or turn it off. */
  private applyShadow(spec: ShadowSpec | null): void {
    const lights = this.lights;
    if (lights === null) return;
    const { sun } = lights;
    const shadow = sun.shadow;
    const state = this.shadowState;
    const wanted = spec !== null && spec.mapSize > 0 && spec.reach > 0 ? spec : null;
    const mapSize = wanted === null ? 0 : Math.floor(wanted.mapSize);

    // THE OLD MAP. three allocates on first render and never re-reads
    // `mapSize`, so a change of size — or no shadow at all — must
    // release what was allocated, depth texture first as three itself
    // does, and null it so the next render builds the right one.
    const map = shadow.map;
    if (map !== null && (mapSize === 0 || shadow.mapSize.x !== mapSize || shadow.mapSize.y !== mapSize)) {
      const depth = map.depthTexture;
      if (depth !== null) {
        depth.dispose();
        map.depthTexture = null;
      }
      map.dispose();
      shadow.map = null;
    }

    if (wanted === null) {
      sun.castShadow = false;
      state.mapSize = 0;
      state.reach = 0;
      state.casting = false;
      state.intensity = 0;
      return;
    }

    const reach = wanted.reach;
    shadow.mapSize.set(mapSize, mapSize);
    // All normal bias, no depth bias: a foot's shadow must start at the foot.
    shadow.bias = 0;
    shadow.normalBias = shadowNormalBias({ mapSize, reach });
    // The square, seen down the sun: ±reach across, deep enough to reach
    // the ground under a camera high above it. Only when the reach
    // changed — the projection is a matrix, and the matrix is the cost.
    if (state.reach !== reach || state.mapSize === 0) {
      const camera = shadow.camera;
      camera.left = -reach;
      camera.right = reach;
      camera.top = reach;
      camera.bottom = -reach;
      camera.near = SHADOW_NEAR;
      camera.far = shadowFarFor(reach);
      camera.updateProjectionMatrix();
    }
    sun.castShadow = true;
    state.mapSize = mapSize;
    state.reach = reach;
    state.casting = true;
    state.intensity = shadow.intensity;
  }

  /**
   * The eye, moved to the nearest point of the texel lattice in the
   * shadow map's own plane, so the map's grid holds still under the
   * world while the camera moves inside a texel. The plane's basis is
   * the one three will give the shadow camera: `Matrix4.lookAt` from
   * the light toward the target with the camera's up, which is what
   * `Object3D.lookAt` calls for a camera.
   */
  private snapToTexel(eye: THREE.Vector3, dir: THREE.Vector3, texel: number, cameraUp: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.basis.lookAt(dir, ORIGIN, cameraUp).extractBasis(this.right, this.up, this.back);
    const x = eye.dot(this.right);
    const y = eye.dot(this.up);
    return out
      .copy(eye)
      .addScaledVector(this.right, Math.round(x / texel) * texel - x)
      .addScaledVector(this.up, Math.round(y / texel) * texel - y);
  }

  /** The skies whose textures are resident right now. For a HUD, and for a test. */
  get resident(): readonly SkyImageId[] {
    const out: SkyImageId[] = [];
    for (const [id, slot] of this.slots) if (slot.texture !== null) out.push(id);
    return out;
  }

  /** One call a frame, after the camera has been placed. */
  update(look: SkyLook, camera: THREE.PerspectiveCamera): void {
    if (this.disposed) return;
    camera.getWorldPosition(this.eye);

    // THE DOME, on the eye and just inside the far plane.
    this.dome.position.copy(this.eye);
    this.dome.scale.setScalar(Math.max(camera.near * 2, camera.far * DOME_OF_FAR));

    // THE MAPS. `image` is always needed; `nextImage` only once the mix
    // has left zero, so a fade that has not begun does not fetch.
    const a = this.request(look.image);
    const b = look.mix > 0 ? this.request(look.nextImage) : this.slots.get(look.nextImage) ?? null;
    const u = this.uniforms;
    u.uMapA.value = a.texture ?? this.placeholder;
    u.uHasA.value = a.texture === null ? 0 : 1;
    u.uMapB.value = b?.texture ?? this.placeholder;
    u.uHasB.value = b?.texture ? 1 : 0;
    u.uRotA.value = domeRotationFor(look.image, look.sunAzimuth);
    u.uRotB.value = domeRotationFor(look.nextImage, look.sunAzimuth);
    u.uMix.value = look.mix;
    u.uDim.value = look.dimming;
    srgb(this.horizon, look.horizon);
    u.uHorizon.value.copy(this.horizon);
    this.release();

    // THE LIGHTS, THE FOG AND THE BACKGROUND — the scene's, written into.
    const lights = this.lights;
    if (lights === null) return;
    const { sun, hemisphere, fog, background } = lights;
    sunVector(look.sunAzimuth, look.sunElevation, this.dir);
    // With a shadow, the light and its target stand on the texel lattice
    // rather than on the eye itself; without one, on the eye exactly.
    const state = this.shadowState;
    const anchor = state.mapSize > 0
      ? this.snapToTexel(this.eye, this.dir, (2 * state.reach) / state.mapSize, sun.shadow.camera.up, this.anchor)
      : this.anchor.copy(this.eye);
    sun.position.copy(anchor).addScaledVector(this.dir, SUN_DISTANCE);
    sun.target.position.copy(anchor);
    // The target is not in the scene graph, so nothing else updates its matrix.
    sun.target.updateMatrixWorld();
    sun.intensity = look.sunIntensity;
    // THE SHADOW, while there is a map: cast only when it would show,
    // at the strength the sun's height and the cloud leave it.
    if (state.mapSize > 0) {
      const intensity = shadowIntensityFor(look);
      const casting = shadowCasts(state, look);
      sun.castShadow = casting;
      sun.shadow.intensity = intensity;
      state.casting = casting;
      state.intensity = intensity;
    }
    srgb(sun.color, look.sunColour);
    srgb(hemisphere.color, look.hemisphereSky);
    srgb(hemisphere.groundColor, look.hemisphereGround);
    hemisphere.intensity = look.hemisphereIntensity;
    background.copy(this.horizon);
    if (fog !== null) {
      fog.color.copy(this.horizon);
      if ((fog as THREE.FogExp2).isFogExp2) {
        (fog as THREE.FogExp2).density = look.fogDensity;
      } else {
        const range = fogRangeFor(sightFor(look.fogDensity), camera.far);
        (fog as THREE.Fog).near = range.near;
        (fog as THREE.Fog).far = range.far;
      }
    }
  }

  /** The slot for a sky, requesting its texture the first time. */
  private request(id: SkyImageId): Slot {
    let slot = this.slots.get(id);
    if (slot === undefined) {
      const fresh: Slot = { texture: null, pending: true, read: true, idle: 0 };
      slot = fresh;
      this.slots.set(id, fresh);
      this.load(id, this.tier).then(
        (texture) => {
          // THE RACE IS REAL: a view disposed while the file was in
          // flight, or a slot released and re-requested meanwhile, must
          // not be handed a texture nothing will ever dispose.
          if (this.disposed || this.slots.get(id) !== fresh) {
            texture.dispose();
            return;
          }
          fresh.texture = prepareSkyTexture(texture);
          fresh.pending = false;
        },
        () => {
          // A missing sky is the horizon colour, which is a fogged sky.
          // Not retried while the look keeps reading it; released with
          // the others once it does not, and asked for again after.
          fresh.pending = false;
        },
      );
    }
    slot.read = true;
    return slot;
  }

  /** Let go of skies the look has stopped reading, once they have idled through the grace. */
  private release(): void {
    for (const [id, slot] of this.slots) {
      if (slot.read) {
        slot.read = false;
        slot.idle = 0;
        continue;
      }
      slot.idle += 1;
      if (slot.idle <= RELEASE_AFTER_UPDATES || slot.pending) continue;
      slot.texture?.dispose();
      this.slots.delete(id);
    }
  }

  /** Everything this made and everything it loaded. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.group.remove(this.dome);
    this.dome.geometry.dispose();
    this.material.dispose();
    for (const slot of this.slots.values()) slot.texture?.dispose();
    this.slots.clear();
    this.placeholder.dispose();
    this.lights = null;
  }
}

/** The origin, for `Matrix4.lookAt` — a direction is a point looked at from here. Never written. */
const ORIGIN = new THREE.Vector3();

/** Write an sRGB triple into a colour, converting to three's working space on the way. */
function srgb(into: THREE.Color, from: Rgb): THREE.Color {
  return into.setRGB(from.r, from.g, from.b, THREE.SRGBColorSpace);
}
