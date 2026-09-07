/**
 * RAIN, AROUND HER AND NOWHERE ELSE — v0's `weather/Rain.ts`, carried
 * into v1 as a sheet of streaks that follows the camera.
 *
 * The island is fifty-six kilometres across and the weather covers all
 * of it, but the weather is numbers. Drawing rain over five and a half
 * million units of terrain to render the fraction within a metre of the
 * camera would be the same mistake as loading the whole heightfield to
 * walk on one hill. So: a box of drops that follows the camera,
 * wrapping around it, and a reading (`WeatherNow.rainMmHr`) that says
 * how hard it should be falling THERE.
 *
 * RAIN AT THIS SCALE IS NOT WEATHER, IT IS ARTILLERY. A 2 mm raindrop
 * reaches about 6.5 m/s falling — Gunn and Kinzer measured the curve in
 * still air and it has stood since 1949 [J. Meteor. 6 (1949) 243–248].
 * At one centimetre to the unit that is 650 units a second, past an
 * animal about a unit long. A drop is a third of her body wide and
 * crosses the whole visible volume in a fifth of a second. Nothing
 * about that needed exaggerating for effect, so nothing has been. The
 * drop COUNT is v0's too: about a thousand drops per cubic metre in
 * heavy rain, which is what 1,200 of them in this 1.3 m³ volume works
 * out to, and here "heavy" is `HEAVY_RAIN_MM_HR` — the 10 mm/hr the
 * weather seam calls a real shower — with the count scaling down from
 * there. Above it the drops do not multiply; a downpour is the same
 * sheet falling faster and slanting harder (GAME TUNING; a 50 mm/hr
 * tropical downpour at a thousand drops a cubic metre already fills the
 * screen).
 *
 * THE COUNT IS A CAP PER DETAIL RUNG (`RAIN_CAPS`), named by the rung's
 * string exactly as `world/objects/budget.ts` names its caps, so the
 * rung is a lens here as everywhere: a phone on `low` sees the same
 * rain at fewer drops. The eased count is the fraction of the cap.
 *
 * STREAKS, AS POINTS. v0 drew each drop as a two-vertex line, which is
 * a one-pixel streak whatever the screen. Here each drop is one point
 * sprite whose shader draws the streak INSIDE the sprite: the vertex
 * shader projects the drop and its tail (the drop `SMEAR` seconds
 * earlier, against the wind and up) to the screen, sizes the sprite to
 * span them, and hands the fragment shader the on-screen direction; the
 * fragment shader keeps only the pixels along that line. One vertex a
 * drop, one draw, and a streak with width — which at this scale a drop
 * has. The sprite's size is in device pixels, so `resize` tells the
 * view the drawing buffer's size; a wrong size only lengthens or
 * shortens the streak, never misplaces the drop.
 *
 * WIND SLANTS IT. The weather's wind is a vector on the ground plane in
 * units a second — a 20 km/h trade wind is 555 — and a falling drop
 * takes the air's horizontal speed, so at the reading's full strength
 * the streaks would slant forty degrees. The ant lives in the boundary
 * layer, where the wind is a fraction of the ten-metre reading, so the
 * drift is `BOUNDARY_LAYER` of it (GAME TUNING) and never more than
 * `DRIFT_MAX`, so a hurricane cannot lay the rain flat.
 *
 * NOTHING STEPS: the count eases toward its target as 1 − exp(−dt/τ),
 * so a shower does not arrive as twelve hundred drops in one frame and
 * a phone at 60 fps and a probe at 1.5 fps arrive at the same rain.
 * Drops WRAP around the camera by modulo rather than "if past the edge,
 * reset to the top": at 650 units a second a drop can cross the whole
 * box in a single slow frame, and a single-step reset would strand it
 * outside. The box lives in RENDER space, deliberately: rain has no
 * identity and nothing refers to it later, so it reads the camera's
 * rendered position and no world coordinate at all.
 *
 * The drops' starting places come from a small seeded generator rather
 * than `Math.random`, so two runs draw the same rain and a test can
 * count on it; nothing else about the rain is deterministic or needs to
 * be.
 */
import * as THREE from 'three';
import type { WeatherNow } from '../world/weather/weather';

/**
 * The most drops in the air, per detail rung. `high` is v0's 1,200.
 * Keyed by the rung's NAME, as `world/objects/budget.ts` is; a test
 * pins the keys against `DETAIL_TIERS`.
 */
export const RAIN_CAPS: Readonly<Record<string, number>> = Object.freeze({
  'ultra-low': 250,
  low: 500,
  medium: 800,
  high: 1_200,
  'ultra-high': 2_000,
});

/** The cap for a rung named by the detail ladder. An unknown name is `medium`. */
export function rainCapFor(detail: string): number {
  return RAIN_CAPS[detail] ?? RAIN_CAPS.medium;
}

/** The rate at which the sheet is full: the weather seam's "real shower". */
export const HEAVY_RAIN_MM_HR = 10;
/** Half the width of the volume, in world units — 60 cm each way. */
export const SPREAD = 60;
/** Half its height. */
export const RISE = 45;
/** Terminal velocity of a 2 mm drop, in units per second (Gunn & Kinzer). */
export const FALL = 650;
/** How much of the ten-metre wind reaches the ground she stands on. GAME TUNING. */
export const BOUNDARY_LAYER = 0.5;
/** The most sideways a drop is allowed, units per second. */
export const DRIFT_MAX = FALL * 1.5;
/** Seconds of fall a streak represents. Pure look. */
export const SMEAR = 0.011;
/** How long the count takes to ease toward a new rate, seconds. */
export const EASE_S = 2.5;
/** The streak's width on screen, device pixels, and the most a sprite may be. */
const THICKNESS_PX = 2.5;
const MAX_POINT_PX = 96;
/** v0's drop colour. */
const DROP_COLOUR = 0xbcd4e8;

export interface RainViewOptions {
  /** The detail rung's name, for the cap. */
  readonly detail: string;
}

const VERTEX = /* glsl */ `
uniform vec3 uVelocity;
uniform float uSmear;
uniform vec2 uViewport;
uniform float uThickness;
uniform float uMaxPoint;
varying vec2 vStreak;
varying float vHalf;
varying float vWidth;

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 head = projectionMatrix * mv;
  // The tail is where the drop was uSmear seconds ago: against its velocity.
  vec3 back = (viewMatrix * vec4(-uVelocity * uSmear, 0.0)).xyz;
  vec4 tail = projectionMatrix * vec4(mv.xyz + back, 1.0);
  vec2 dpx = vec2(0.0, 1.0);
  float len = 0.0;
  if (head.w > 1e-4 && tail.w > 1e-4) {
    dpx = (tail.xy / tail.w - head.xy / head.w) * 0.5 * uViewport;
    len = length(dpx);
  }
  vStreak = len > 1e-4 ? dpx / len : vec2(0.0, 1.0);
  float size = min(uMaxPoint, len + uThickness * 2.0);
  vHalf = min(len, size) / size * 0.5;
  vWidth = uThickness / size;
  gl_PointSize = size;
  gl_Position = head;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColour;
uniform float uOpacity;
varying vec2 vStreak;
varying float vHalf;
varying float vWidth;

void main() {
  // Sprite space, y up, centred: gl_PointCoord's origin is the top left.
  vec2 q = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
  float along = dot(q, vStreak);
  float across = abs(dot(q, vec2(-vStreak.y, vStreak.x)));
  float body = 1.0 - smoothstep(vHalf, vHalf + vWidth, abs(along));
  float edge = 1.0 - smoothstep(vWidth * 0.5, vWidth, across);
  float a = body * edge * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColour, a);
  #include <colorspace_fragment>
}
`;

/** mulberry32: a small seeded generator, for the drops' starting places. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RainView {
  /** One group, so a layer toggle is one `visible` and never a walk. */
  readonly group = new THREE.Group();
  /** The most drops this rung draws. */
  readonly cap: number;

  private readonly points: THREE.Points;
  private readonly material: THREE.ShaderMaterial;
  /** Where each drop is RELATIVE TO THE CAMERA — the position attribute's own array. */
  private readonly offsets: Float32Array;
  private readonly attribute: THREE.BufferAttribute;
  private readonly velocity = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  private falling = 0;
  private drops = 0;

  constructor(options: RainViewOptions) {
    this.cap = rainCapFor(options.detail);
    this.group.name = 'rain';

    const random = seeded(0x5eed);
    this.offsets = new Float32Array(this.cap * 3);
    for (let i = 0; i < this.cap; i += 1) {
      this.offsets[i * 3] = (random() - 0.5) * 2 * SPREAD;
      this.offsets[i * 3 + 1] = (random() - 0.5) * 2 * RISE;
      this.offsets[i * 3 + 2] = (random() - 0.5) * 2 * SPREAD;
    }
    const geometry = new THREE.BufferGeometry();
    this.attribute = new THREE.BufferAttribute(this.offsets, 3);
    this.attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uVelocity: { value: this.velocity },
        uSmear: { value: SMEAR },
        uViewport: { value: new THREE.Vector2(1920, 1080) },
        uThickness: { value: THICKNESS_PX },
        uMaxPoint: { value: MAX_POINT_PX },
        uColour: { value: new THREE.Color(DROP_COLOUR) },
        uOpacity: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // Depth TEST on, so a hill in front of a drop hides it and drops
      // below ground never show. Depth WRITE off, so a near drop does
      // not punch a hole in the drop behind it.
      depthWrite: false,
      depthTest: true,
      fog: false,
    });

    this.points = new THREE.Points(geometry, this.material);
    this.points.name = 'raindrops';
    // The box is rebuilt around the camera every frame, so culling it
    // against a stale bounding sphere only ever hides it wrongly.
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
    this.group.add(this.points);
  }

  /** The drawing buffer's size in DEVICE pixels, for the streak's length. */
  resize(widthPx: number, heightPx: number): void {
    if (Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0) {
      (this.material.uniforms.uViewport.value as THREE.Vector2).set(widthPx, heightPx);
    }
  }

  /**
   * @param camera where the eye is — this is a local effect.
   * @param dt SIMULATED seconds.
   */
  update(now: WeatherNow, camera: THREE.Camera, dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    // Easing the count as well as the reading means a shower does not
    // arrive as the whole cap appearing in one frame.
    const target = Math.min(1, Math.max(0, now.rainMmHr) / HEAVY_RAIN_MM_HR);
    this.falling += (target - this.falling) * (1 - Math.exp(-step / EASE_S));

    const drops = Math.round(this.falling * this.cap);
    this.drops = drops;
    if (drops <= 0) {
      this.points.visible = false;
      return;
    }
    this.points.visible = true;
    camera.getWorldPosition(this.eye);
    this.points.position.copy(this.eye);
    this.material.uniforms.uOpacity.value = 0.28 + this.falling * 0.42;

    // Heavier rain falls faster: bigger drops, higher terminal velocity.
    const fall = FALL * (0.72 + this.falling * 0.28);
    let driftX = (Number.isFinite(now.windX) ? now.windX : 0) * BOUNDARY_LAYER;
    let driftZ = (Number.isFinite(now.windZ) ? now.windZ : 0) * BOUNDARY_LAYER;
    const drift = Math.hypot(driftX, driftZ);
    if (drift > DRIFT_MAX) {
      driftX *= DRIFT_MAX / drift;
      driftZ *= DRIFT_MAX / drift;
    }
    this.velocity.set(driftX, -fall, driftZ);

    const dx = driftX * step;
    const dy = -fall * step;
    const dz = driftZ * step;
    const offsets = this.offsets;
    for (let i = 0; i < drops; i += 1) {
      const p = i * 3;
      offsets[p] = wrap(offsets[p] + dx, SPREAD);
      offsets[p + 1] = wrap(offsets[p + 1] + dy, RISE);
      offsets[p + 2] = wrap(offsets[p + 2] + dz, SPREAD);
    }
    this.points.geometry.setDrawRange(0, drops);
    // Only the drops actually drawn were moved, so only they are sent.
    // In light rain that is a fraction of the buffer.
    this.attribute.clearUpdateRanges();
    this.attribute.addUpdateRange(0, drops * 3);
    this.attribute.needsUpdate = true;
  }

  /** How many drops are in the air. What a probe counts. */
  get drawing(): number {
    return this.drops;
  }

  /** The eased fraction of the cap in the air, 0..1. */
  get strength(): number {
    return this.falling;
  }

  dispose(): void {
    this.group.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Fold a coordinate back into [-half, half], however far out it is. */
function wrap(value: number, half: number): number {
  const span = half * 2;
  let folded = (value + half) % span;
  if (folded < 0) folded += span;
  return folded - half;
}
