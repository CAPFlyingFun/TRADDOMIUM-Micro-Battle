// @vitest-environment jsdom
/**
 * THE DOME, THE LIGHTS IT DRIVES AND THE RAIN — three's scene graph
 * builds without WebGL, so everything here is measured on the objects
 * the renderer would draw, with a stub loader standing in for the
 * network:
 *
 *   the dome sits on the camera and just inside its far plane, reads and
 *     writes no depth, and is drawn before everything
 *   each map is turned by (the real sun's bearing − its baked sun's), so
 *     the photographed sun lands at the real one — a flipped sign fails
 *   the bound sun light points along the sun vector and carries the
 *     look's intensity and colour; the hemisphere and background follow
 *   the linear fog's near and far leave 5% of a surface at exactly the
 *     visibility, and never pass the camera's clip
 *   skies load lazily, only when the look reads them, and are released
 *     once it stops; dispose lets go of everything
 *   the rain counts from the rate, caps by rung, follows the camera and
 *     slants with the wind
 *   the shadow: bound with a rung's spec the sun casts over a ±reach
 *     square at that map size; it casts at noon and not at night, under
 *     cover or at the floor; a rung change lets go of the old map; the
 *     light and its target sit on the texel lattice so the map's grid
 *     holds still as the camera moves inside a texel; and without a
 *     spec nothing about shadows is touched
 */
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { DETAIL_TIERS } from '../src/assets/detailQuality';
import { bakedSky, SKY_IMAGE_IDS, type SkyImageId } from '../src/assets/skyManifest';
import type { TextureTier } from '../src/assets/textureQuality';
import {
  BOUNDARY_LAYER, DRIFT_MAX, FALL, HEAVY_RAIN_MM_HR, RAIN_CAPS, RISE, RainView, SPREAD, rainCapFor,
} from '../src/sky/RainView';
import { SHADOW_RUNGS, SHADOW_SUN_MIN, shadowNormalBias, shadowTexel, type ShadowSpec } from '../src/sky/shadows';
import {
  DOME_OF_FAR, DOME_RENDER_ORDER, FOG_FAR_OF_CLIP, FOG_NEAR_OF_FAR, RELEASE_AFTER_UPDATES, SHADOW_NEAR, SMOOTHSTEP_AT_95,
  SUN_DISTANCE, SkyView, domeRotationFor, fogRangeFor, shadowFarFor, sunVector, type SkyLights,
} from '../src/sky/SkyView';
import { LIGHT_FLOOR, sightFor, skyLook } from '../src/sky/skyLook';
import type { SunPosition } from '../src/world/weather/solar';
import { FAIR, visibilityFor, type WeatherNow } from '../src/world/weather/weather';

const DEG = Math.PI / 180;

const sun = (elevationDeg: number, azimuthDeg = 180): SunPosition => ({
  elevation: elevationDeg * DEG,
  azimuth: azimuthDeg * DEG,
  declination: 0,
  equationOfTimeMinutes: 0,
});
const weather = (over: Partial<WeatherNow> = {}): WeatherNow => ({ ...FAIR, ...over });

const NOON = skyLook(weather({ cloud: 0.1 }), sun(80, 200));
const NIGHT = skyLook(weather({ cloud: 0.1 }), sun(-30, 300));

/** Let a `Promise.resolve`d load land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function camera(far = 6000): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 2, 0.1, far);
  cam.position.set(100, 50, -20);
  cam.updateMatrixWorld();
  return cam;
}

function lights(fog: THREE.Fog | THREE.FogExp2 | null = new THREE.Fog(0x000000, 1, 2), shadow?: ShadowSpec): SkyLights {
  const bound: SkyLights = {
    sun: new THREE.DirectionalLight(0xffffff, 1),
    hemisphere: new THREE.HemisphereLight(0xffffff, 0x000000, 1),
    fog,
    background: new THREE.Color(0x000000),
  };
  return shadow === undefined ? bound : { ...bound, shadow };
}

interface Rig {
  readonly view: SkyView;
  readonly load: ReturnType<typeof vi.fn>;
  readonly textures: THREE.Texture[];
}

function rig(tier: TextureTier = 'medium'): Rig {
  const textures: THREE.Texture[] = [];
  const load = vi.fn((_id: SkyImageId, _tier: TextureTier) => {
    const texture = new THREE.Texture();
    textures.push(texture);
    return Promise.resolve(texture);
  });
  return { view: new SkyView({ tier, load }), load, textures };
}

const dome = (view: SkyView): THREE.Mesh => view.group.getObjectByName('skydome') as THREE.Mesh;
const srgb = (c: { r: number; g: number; b: number }): THREE.Color => new THREE.Color().setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

describe('the dome', () => {
  it('sits on the camera, just inside its far plane, and is drawn first without touching depth', () => {
    const { view } = rig();
    const cam = camera(6000);
    view.update(NOON, cam);
    const mesh = dome(view);
    expect(mesh.position.toArray()).toEqual(cam.position.toArray());
    expect(mesh.scale.x).toBeCloseTo(6000 * DOME_OF_FAR, 9);
    expect(mesh.scale.x).toBeLessThan(cam.far);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.renderOrder).toBe(DOME_RENDER_ORDER);
    const material = mesh.material as THREE.ShaderMaterial;
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(material.fog).toBe(false);
    expect(material.side).toBe(THREE.BackSide);
    // It follows: move the camera and the dome moves with it.
    cam.position.set(-4000, 900, 12);
    cam.updateMatrixWorld();
    view.update(NOON, cam);
    expect(dome(view).position.toArray()).toEqual(cam.position.toArray());
    view.dispose();
  });

  it('turns each map by the real sun’s bearing minus its baked sun’s, so the photographed sun lands on the real one', () => {
    const { view } = rig();
    view.update(NOON, camera());
    const u = view.uniforms;
    expect(u.uRotA.value).toBeCloseTo(NOON.sunAzimuth - bakedSky(NOON.image).sunAzimuth * Math.PI * 2, 12);
    expect(u.uRotB.value).toBeCloseTo(NOON.sunAzimuth - bakedSky(NOON.nextImage).sunAzimuth * Math.PI * 2, 12);
    expect(u.uMix.value).toBe(NOON.mix);
    expect(u.uDim.value).toBe(NOON.dimming);
    // THE PROPERTY, not the formula: the shader's lookup for the direction
    // of the real sun must land on the column the sun was baked in. This
    // is the shader's `equirect`, in JavaScript, fed the sun vector.
    for (const id of SKY_IMAGE_IDS) {
      for (const azimuthDeg of [0, 45, 137, 200, 359]) {
        const look = skyLook(weather(), sun(80, azimuthDeg));
        const rot = domeRotationFor(id, look.sunAzimuth);
        const d = sunVector(look.sunAzimuth, look.sunElevation);
        const bearing = Math.atan2(d.x, -d.z);
        let column = ((bearing - rot) / (Math.PI * 2)) % 1;
        if (column < 0) column += 1;
        const baked = bakedSky(id).sunAzimuth;
        const apart = Math.min(Math.abs(column - baked), 1 - Math.abs(column - baked));
        expect(apart, `${id} at ${azimuthDeg}°`).toBeLessThan(1e-9);
      }
    }
    view.dispose();
  });

  it('shows the horizon colour for a sky that has not arrived, and the map once it has', async () => {
    const { view, load } = rig();
    view.update(NOON, camera());
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('clear', 'medium');
    expect(view.uniforms.uHasA.value).toBe(0);
    expect(view.uniforms.uHorizon.value.getHex()).toBe(srgb(NOON.horizon).getHex());
    await settle();
    view.update(NOON, camera());
    expect(view.uniforms.uHasA.value).toBe(1);
    expect(view.resident).toEqual(['clear']);
    const texture = view.uniforms.uMapA.value;
    // What a sky texture must be — the loader's facts, applied on arrival.
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.minFilter).toBe(THREE.LinearFilter);
    view.dispose();
  });

  it('loads a second sky only once the fade toward it has begun', async () => {
    const { view, load } = rig('low');
    // Cloud 0.1 at 80°: mix 0, so `partly` is not fetched.
    view.update(NOON, camera());
    expect(load.mock.calls.map((c) => c[0])).toEqual(['clear']);
    // Cloud 0.45 at 80°: the fade is on, so it is.
    view.update(skyLook(weather({ cloud: 0.45 }), sun(80, 200)), camera());
    expect(load.mock.calls.map((c) => c[0])).toEqual(['clear', 'partly']);
    expect(load).toHaveBeenLastCalledWith('partly', 'low');
    await settle();
    view.update(skyLook(weather({ cloud: 0.45 }), sun(80, 200)), camera());
    expect(view.uniforms.uHasB.value).toBe(1);
    expect(view.resident).toEqual(['clear', 'partly']);
    view.dispose();
  });

  it('releases a sky the look has stopped reading, after the grace, and asks for it again when needed', async () => {
    const { view, load, textures } = rig();
    view.update(NOON, camera());
    await settle();
    const clear = textures[0];
    const disposed = vi.spyOn(clear, 'dispose');
    // The night: reads `night` alone (mix 0), so `clear` idles.
    for (let i = 0; i < RELEASE_AFTER_UPDATES; i += 1) view.update(NIGHT, camera());
    expect(disposed).not.toHaveBeenCalled();
    view.update(NIGHT, camera());
    view.update(NIGHT, camera());
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(view.resident).not.toContain('clear');
    // Needed again: fetched again.
    const before = load.mock.calls.length;
    view.update(NOON, camera());
    expect(load.mock.calls.length).toBe(before + 1);
    expect(load).toHaveBeenLastCalledWith('clear', 'medium');
    view.dispose();
  });

  it('never resolves a load into a view that was disposed meanwhile', async () => {
    const { view, textures } = rig();
    view.update(NOON, camera());
    view.dispose();
    await settle();
    expect(textures.length).toBe(1);
    // Disposed on arrival: nothing is left to own it.
    const again = vi.spyOn(textures[0], 'dispose');
    expect(view.resident).toEqual([]);
    view.update(NOON, camera());
    expect(again).not.toHaveBeenCalled();
    expect(view.group.children.length).toBe(0);
  });
});

describe('the lights it drives', () => {
  it('points the sun light along the sun vector from the camera, at the look’s intensity and colour', () => {
    const { view } = rig();
    const bound = lights();
    view.bind(bound);
    const cam = camera();
    view.update(NOON, cam);
    const expected = sunVector(NOON.sunAzimuth, NOON.sunElevation);
    const actual = bound.sun.position.clone().sub(bound.sun.target.position).normalize();
    expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
    expect(bound.sun.target.position.toArray()).toEqual(cam.position.toArray());
    expect(bound.sun.position.distanceTo(cam.position)).toBeCloseTo(SUN_DISTANCE, 6);
    expect(bound.sun.intensity).toBe(NOON.sunIntensity);
    expect(bound.sun.color.getHex()).toBe(srgb(NOON.sunColour).getHex());
    // The vector itself: north is −z, east +x, up +y — the island's compass.
    expect(sunVector(0, 0).toArray()).toEqual([0, 0, -1]);
    expect(sunVector(90 * DEG, 0).x).toBeCloseTo(1, 12);
    expect(sunVector(45 * DEG, 90 * DEG).y).toBeCloseTo(1, 12);
    view.dispose();
  });

  it('gives the hemisphere the look’s sky and ground, and the background the horizon', () => {
    const { view } = rig();
    const bound = lights();
    view.bind(bound);
    view.update(NIGHT, camera());
    expect(bound.hemisphere.intensity).toBe(NIGHT.hemisphereIntensity);
    expect(bound.hemisphere.color.getHex()).toBe(srgb(NIGHT.hemisphereSky).getHex());
    expect(bound.hemisphere.groundColor.getHex()).toBe(srgb(NIGHT.hemisphereGround).getHex());
    expect(bound.background.getHex()).toBe(srgb(NIGHT.horizon).getHex());
    expect((bound.fog as THREE.Fog).color.getHex()).toBe(srgb(NIGHT.horizon).getHex());
    // Background, fog and the dome's rim: one colour.
    expect(view.uniforms.uHorizon.value.getHex()).toBe(bound.background.getHex());
    view.dispose();
  });

  it('writes nothing until it is bound', () => {
    const { view } = rig();
    const bound = lights();
    const before = bound.sun.position.clone();
    view.update(NOON, camera());
    expect(bound.sun.position.toArray()).toEqual(before.toArray());
    expect(bound.sun.intensity).toBe(1);
    view.dispose();
  });
});

describe('the fog', () => {
  it('sets the linear fog so that 5% of a surface is left at exactly the visibility', () => {
    const { view } = rig();
    const bound = lights();
    view.bind(bound);
    // A far plane beyond the visibility, so the clip is not what limits it.
    view.update(NOON, camera(1e9));
    const fog = bound.fog as THREE.Fog;
    const sight = sightFor(NOON.fogDensity);
    expect(sight).toBeCloseTo(24_000 * 100, 3);
    const range = fogRangeFor(sight, 1e9);
    expect(fog.near).toBeCloseTo(range.near, 6);
    expect(fog.far).toBeCloseTo(range.far, 6);
    expect(fog.near / fog.far).toBeCloseTo(FOG_NEAR_OF_FAR, 12);
    // THE CONVERSION, checked as a property: three's linear fog leaves
    // 1 − smoothstep(near, far, d), and at d = sight that must be 5%.
    expect(1 - smoothstep(fog.near, fog.far, sight)).toBeCloseTo(0.05, 6);
    expect(SMOOTHSTEP_AT_95 * SMOOTHSTEP_AT_95 * (3 - 2 * SMOOTHSTEP_AT_95)).toBeCloseTo(0.95, 12);
    view.dispose();
  });

  it('never lets the fog’s far end pass the camera’s clip, so the clipmap is never cut into a disc', () => {
    const { view } = rig();
    const bound = lights();
    view.bind(bound);
    view.update(NOON, camera(6000));
    const fog = bound.fog as THREE.Fog;
    expect(fog.far).toBeCloseTo(6000 * FOG_FAR_OF_CLIP, 9);
    expect(fog.near).toBeCloseTo(fog.far * FOG_NEAR_OF_FAR, 9);
    view.dispose();
  });

  it('thickens with a shower and clears again', () => {
    const { view } = rig();
    const bound = lights();
    view.bind(bound);
    const cam = camera(1e9);
    view.update(NOON, cam);
    const clear = (bound.fog as THREE.Fog).far;
    view.update(skyLook(weather({ sky: 'rain', rainMmHr: 10, cloud: 0.95, visibilityM: visibilityFor(10, 0.95) }), sun(80)), cam);
    expect((bound.fog as THREE.Fog).far).toBeLessThan(clear / 3);
    view.update(NOON, cam);
    expect((bound.fog as THREE.Fog).far).toBeCloseTo(clear, 6);
    view.dispose();
  });

  it('hands an exp² fog the density straight, and tolerates no fog at all', () => {
    const { view } = rig();
    const exp = lights(new THREE.FogExp2(0x000000, 1));
    view.bind(exp);
    view.update(NOON, camera());
    expect((exp.fog as THREE.FogExp2).density).toBe(NOON.fogDensity);
    const none = lights(null);
    view.bind(none);
    expect(() => view.update(NOON, camera())).not.toThrow();
    view.dispose();
  });
});

describe('dispose', () => {
  it('removes the dome and lets go of the geometry, the material and every texture', async () => {
    const { view, textures } = rig();
    const bound = lights();
    view.bind(bound);
    view.update(skyLook(weather({ cloud: 0.45 }), sun(80, 200)), camera());
    await settle();
    expect(textures.length).toBe(2);
    const mesh = dome(view);
    const geometry = vi.spyOn(mesh.geometry, 'dispose');
    const material = vi.spyOn(mesh.material as THREE.Material, 'dispose');
    const gone = textures.map((t) => vi.spyOn(t, 'dispose'));
    view.dispose();
    expect(view.group.children).toEqual([]);
    expect(geometry).toHaveBeenCalledTimes(1);
    expect(material).toHaveBeenCalledTimes(1);
    for (const spy of gone) expect(spy).toHaveBeenCalledTimes(1);
    expect(view.resident).toEqual([]);
    // Idempotent, and inert afterwards.
    view.dispose();
    view.update(NOON, camera());
    expect(view.group.children).toEqual([]);
  });
});

describe('the shadow', () => {
  const HIGH = SHADOW_RUNGS.high;
  const MEDIUM = SHADOW_RUNGS.medium;
  const OVERCAST = skyLook(weather({ sky: 'cloudy', cloud: 0.95, visibilityM: visibilityFor(0, 0.95) }), sun(80, 200));
  /** The sun at the floor: the key light is held at +6°, where the shadow is gone. */
  const LOW = skyLook(weather({ cloud: 0.1 }), sun(-3, 260));

  it('binds the sun to cast over a ±reach square at the rung’s map size, with normal bias and no depth bias', () => {
    const { view } = rig();
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    const { sun } = bound;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    const cam = sun.shadow.camera;
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-400, 400, 400, -400]);
    expect(cam.near).toBe(SHADOW_NEAR);
    expect(cam.far).toBe(shadowFarFor(400));
    expect(cam.far).toBeGreaterThan(SUN_DISTANCE + 2 * 400);
    expect(sun.shadow.bias).toBe(0);
    expect(sun.shadow.normalBias).toBeCloseTo(shadowNormalBias(HIGH), 12);
    expect(sun.shadow.normalBias).toBeGreaterThan(0.25);
    // The projection was rebuilt for the square, not left at three's ±5 default.
    const corner = new THREE.Vector3(400, 400, -SHADOW_NEAR).applyMatrix4(cam.projectionMatrix);
    expect(corner.x).toBeCloseTo(1, 9);
    expect(corner.y).toBeCloseTo(1, 9);
    expect(view.shadow).toMatchObject({ mapSize: 1024, reach: 400 });
    view.dispose();
  });

  it('casts at a clear noon at full strength, and not at night: the 0.06 key light is not a sun', () => {
    const { view } = rig();
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    view.update(NOON, camera());
    expect(bound.sun.castShadow).toBe(true);
    expect(bound.sun.shadow.intensity).toBeCloseTo(1, 9);
    expect(view.shadow.casting).toBe(true);
    expect(view.shadow.intensity).toBeCloseTo(1, 9);
    view.update(NIGHT, camera());
    expect(NIGHT.sunIntensity).toBeLessThan(SHADOW_SUN_MIN);
    expect(bound.sun.castShadow).toBe(false);
    expect(view.shadow.casting).toBe(false);
    // And the light itself is still driven: the night's own intensity and colour.
    expect(bound.sun.intensity).toBe(NIGHT.sunIntensity);
    view.update(NOON, camera());
    expect(bound.sun.castShadow).toBe(true);
    view.dispose();
  });

  it('washes out under cover and is gone at the floor — and skips the depth pass for a shadow no one could see', () => {
    const { view } = rig();
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    view.update(OVERCAST, camera());
    expect(bound.sun.shadow.intensity).toBeLessThan(0.01);
    expect(view.shadow.intensity).toBeLessThan(0.01);
    expect(bound.sun.castShadow).toBe(false);
    view.update(LOW, camera());
    expect(LOW.sunElevation).toBe(LIGHT_FLOOR);
    expect(bound.sun.shadow.intensity).toBe(0);
    expect(view.shadow.intensity).toBe(0);
    expect(bound.sun.castShadow).toBe(false);
    // Half cover: half a shadow, still cast.
    view.update(skyLook(weather({ cloud: 0.7 }), sun(80, 200)), camera());
    expect(bound.sun.shadow.intensity).toBeCloseTo(0.5, 9);
    expect(bound.sun.castShadow).toBe(true);
    view.dispose();
  });

  it('lets go of the old map on a rung change, because three never reallocates one', () => {
    const { view } = rig();
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    view.update(NOON, camera());
    // What three would have allocated on the first render.
    const map = new THREE.WebGLRenderTarget(1024, 1024);
    map.depthTexture = new THREE.DepthTexture(1024, 1024);
    const mapGone = vi.spyOn(map, 'dispose');
    const depthGone = vi.spyOn(map.depthTexture, 'dispose');
    bound.sun.shadow.map = map;
    // Off: the map goes and the sun stops casting.
    view.setShadow(null);
    expect(bound.sun.castShadow).toBe(false);
    expect(bound.sun.shadow.map).toBeNull();
    expect(mapGone).toHaveBeenCalledTimes(1);
    expect(depthGone).toHaveBeenCalledTimes(1);
    expect(view.shadow).toEqual({ mapSize: 0, reach: 0, casting: false, intensity: 0 });
    view.update(NOON, camera());
    expect(bound.sun.castShadow).toBe(false);
    // Back on at medium: the new size and square.
    view.setShadow(MEDIUM);
    expect(bound.sun.castShadow).toBe(true);
    expect(bound.sun.shadow.mapSize.toArray()).toEqual([512, 512]);
    const cam = bound.sun.shadow.camera;
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([-250, 250, 250, -250]);
    expect(cam.far).toBe(shadowFarFor(250));
    expect(bound.sun.shadow.normalBias).toBeCloseTo(shadowNormalBias(MEDIUM), 12);
    expect(view.shadow).toMatchObject({ mapSize: 512, reach: 250 });
    // The same spec again is a no-op: a map three allocated at this size stays.
    const same = new THREE.WebGLRenderTarget(512, 512);
    bound.sun.shadow.map = same;
    const sameGone = vi.spyOn(same, 'dispose');
    view.setShadow(MEDIUM);
    expect(sameGone).not.toHaveBeenCalled();
    expect(bound.sun.shadow.map).toBe(same);
    // A size change lets it go.
    view.setShadow(HIGH);
    expect(sameGone).toHaveBeenCalledTimes(1);
    expect(bound.sun.shadow.map).toBeNull();
    expect(bound.sun.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    view.dispose();
  });

  it('stands the light and its target on the texel lattice, so the map’s grid holds still inside a texel', () => {
    const { view } = rig();
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    const { sun } = bound;
    const texel = shadowTexel(HIGH);
    const cam = camera();
    const eye = new THREE.Vector3(100.3, 50.2, -20.1);
    cam.position.copy(eye);
    cam.updateMatrixWorld();
    view.update(NOON, cam);
    // THE MAP'S OWN AXES, from the camera three builds for the light —
    // not from the view — so the lattice is measured where it is used.
    sun.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const toward = new THREE.Vector3();
    sun.shadow.camera.matrixWorld.extractBasis(right, up, toward);
    const expected = sunVector(NOON.sunAzimuth, NOON.sunElevation);
    expect(toward.distanceTo(expected)).toBeLessThan(1e-9);
    const target = sun.target.position.clone();
    const light = sun.position.clone();
    // ON the lattice: a whole number of texels along each of the map's axes.
    for (const axis of [right, up]) {
      const k = target.dot(axis) / texel;
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
    }
    // The direction is exactly the sun's, from the target, at SUN_DISTANCE.
    expect(light.clone().sub(target).normalize().distanceTo(expected)).toBeLessThan(1e-9);
    expect(light.distanceTo(target)).toBeCloseTo(SUN_DISTANCE, 6);
    // Within a texel of the eye, and off it only across the sun.
    const off = target.clone().sub(eye);
    expect(off.length()).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-9);
    expect(Math.abs(off.dot(expected))).toBeLessThan(1e-9);
    // Half-way toward the lattice point — inside the same texel — the same point.
    cam.position.copy(eye).addScaledVector(off, 0.5);
    cam.updateMatrixWorld();
    view.update(NOON, cam);
    expect(sun.target.position.distanceTo(target)).toBeLessThan(1e-9);
    expect(sun.position.distanceTo(light)).toBeLessThan(1e-9);
    // Ten texels along the map's own axis: ten texels along, and nothing else.
    cam.position.copy(eye).addScaledVector(right, 10 * texel);
    cam.updateMatrixWorld();
    view.update(NOON, cam);
    const moved = sun.target.position.clone().sub(target);
    expect(moved.dot(right) / texel).toBeCloseTo(10, 6);
    expect(Math.abs(moved.dot(up))).toBeLessThan(1e-6);
    expect(Math.abs(moved.dot(toward))).toBeLessThan(1e-6);
    expect(sun.position.clone().sub(light).distanceTo(moved)).toBeLessThan(1e-6);
    view.dispose();
  });

  it('touches nothing about shadows when no spec is handed in', () => {
    const { view } = rig();
    const bound = lights();
    const { sun } = bound;
    sun.shadow.mapSize.set(64, 64);
    const before = sun.shadow.camera.projectionMatrix.clone();
    view.bind(bound);
    const cam = camera();
    view.update(NOON, cam);
    expect(sun.castShadow).toBe(false);
    expect(sun.shadow.mapSize.toArray()).toEqual([64, 64]);
    expect(sun.shadow.camera.projectionMatrix.equals(before)).toBe(true);
    expect(sun.shadow.intensity).toBe(1);
    expect(sun.shadow.normalBias).toBe(0);
    // And the light stands exactly on the eye, as it always has.
    expect(sun.target.position.toArray()).toEqual(cam.position.toArray());
    expect(sun.position.distanceTo(cam.position)).toBeCloseTo(SUN_DISTANCE, 6);
    expect(view.shadow).toEqual({ mapSize: 0, reach: 0, casting: false, intensity: 0 });
    // A zero-map spec is the same as none.
    view.setShadow(SHADOW_RUNGS.low);
    expect(sun.castShadow).toBe(false);
    expect(view.shadow.mapSize).toBe(0);
    view.dispose();
  });

  it('does nothing before bind, and nothing after dispose', () => {
    const { view } = rig();
    expect(() => view.setShadow(HIGH)).not.toThrow();
    expect(view.shadow.mapSize).toBe(0);
    const bound = lights(undefined, HIGH);
    view.bind(bound);
    view.dispose();
    view.setShadow(null);
    expect(bound.sun.castShadow).toBe(true);
  });
});

describe('the rain', () => {
  const DRY = weather();
  const SHOWER = weather({ sky: 'rain', rainMmHr: HEAVY_RAIN_MM_HR, cloud: 0.95 });
  const points = (view: RainView): THREE.Points => view.group.getObjectByName('raindrops') as THREE.Points;
  const velocity = (view: RainView): THREE.Vector3 => (points(view).material as THREE.ShaderMaterial).uniforms.uVelocity.value as THREE.Vector3;

  it('caps by detail rung, names every rung the ladder has, and reads an unknown rung as medium', () => {
    for (const tier of DETAIL_TIERS) expect(RAIN_CAPS[tier], tier).toBeGreaterThan(0);
    let last = 0;
    for (const tier of DETAIL_TIERS) {
      expect(RAIN_CAPS[tier]).toBeGreaterThan(last);
      last = RAIN_CAPS[tier];
    }
    expect(RAIN_CAPS.high).toBe(1_200);
    expect(rainCapFor('nonsense')).toBe(RAIN_CAPS.medium);
    expect(new RainView({ detail: 'low' }).cap).toBe(RAIN_CAPS.low);
  });

  it('draws nothing when it is not raining', () => {
    const view = new RainView({ detail: 'high' });
    for (let i = 0; i < 50; i += 1) view.update(DRY, camera(), 0.1);
    expect(view.drawing).toBe(0);
    expect(points(view).visible).toBe(false);
    view.dispose();
  });

  it('eases up to the rung’s cap in a real shower, around the camera, and eases away again', () => {
    const view = new RainView({ detail: 'high' });
    const cam = camera();
    view.update(SHOWER, cam, 0.1);
    // Not all at once: a shower arrives, it does not appear.
    expect(view.drawing).toBeGreaterThan(0);
    expect(view.drawing).toBeLessThan(view.cap / 2);
    for (let i = 0; i < 200; i += 1) view.update(SHOWER, cam, 0.1);
    expect(view.drawing).toBe(view.cap);
    expect(points(view).visible).toBe(true);
    expect(points(view).position.toArray()).toEqual(cam.position.toArray());
    expect(points(view).geometry.drawRange.count).toBe(view.cap);
    // Every drawn drop is inside the box around her.
    const offsets = points(view).geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < view.cap; i += 1) {
      expect(Math.abs(offsets[i * 3])).toBeLessThanOrEqual(SPREAD);
      expect(Math.abs(offsets[i * 3 + 1])).toBeLessThanOrEqual(RISE);
      expect(Math.abs(offsets[i * 3 + 2])).toBeLessThanOrEqual(SPREAD);
    }
    // It follows.
    cam.position.set(9, 9, 9);
    cam.updateMatrixWorld();
    view.update(SHOWER, cam, 0.1);
    expect(points(view).position.toArray()).toEqual([9, 9, 9]);
    // And it stops, gradually.
    view.update(DRY, cam, 0.1);
    expect(view.drawing).toBeGreaterThan(0);
    for (let i = 0; i < 200; i += 1) view.update(DRY, cam, 0.1);
    expect(view.drawing).toBe(0);
    expect(points(view).visible).toBe(false);
    view.dispose();
  });

  it('draws a quarter of the sheet in light rain', () => {
    const view = new RainView({ detail: 'medium' });
    for (let i = 0; i < 300; i += 1) view.update(weather({ rainMmHr: 2.5 }), camera(), 0.1);
    expect(view.drawing).toBeCloseTo(view.cap * 0.25, -1);
    view.dispose();
  });

  it('falls at a 2 mm drop’s terminal velocity and slants with half the wind, never past the cap', () => {
    const view = new RainView({ detail: 'high' });
    const cam = camera();
    for (let i = 0; i < 100; i += 1) view.update(weather({ rainMmHr: 10, windX: 400, windZ: -100 }), cam, 0.1);
    const v = velocity(view);
    expect(v.y).toBeLessThan(0);
    expect(-v.y).toBeGreaterThanOrEqual(FALL * 0.72);
    expect(-v.y).toBeLessThanOrEqual(FALL);
    expect(v.x).toBeCloseTo(400 * BOUNDARY_LAYER, 9);
    expect(v.z).toBeCloseTo(-100 * BOUNDARY_LAYER, 9);
    view.update(weather({ rainMmHr: 10, windX: 1e6, windZ: 0 }), cam, 0.1);
    expect(Math.hypot(velocity(view).x, velocity(view).z)).toBeCloseTo(DRIFT_MAX, 6);
    view.dispose();
  });

  it('survives a bad dt and a bad wind without a NaN', () => {
    const view = new RainView({ detail: 'low' });
    const cam = camera();
    for (let i = 0; i < 50; i += 1) view.update(SHOWER, cam, 0.1);
    view.update(weather({ rainMmHr: 10, windX: Number.NaN, windZ: Number.POSITIVE_INFINITY }), cam, Number.NaN);
    view.update(SHOWER, cam, -1);
    const offsets = points(view).geometry.getAttribute('position').array as Float32Array;
    for (let i = 0; i < view.drawing * 3; i += 1) expect(Number.isFinite(offsets[i])).toBe(true);
    expect(Number.isFinite(velocity(view).x)).toBe(true);
    view.dispose();
    expect(view.group.children).toEqual([]);
  });
});
