/**
 * RAIN ON THE GLASS — a few droplets on the view when the rain has a
 * reason to reach it, and nothing at all the rest of the time.
 *
 * Joshua, 2026-09-07: keep the world-space rain; add a RESTRAINED
 * camera-lens contact effect so heavy or correctly oriented rain
 * occasionally leaves visible droplets on the view. "Sparse and
 * atmospheric. The player should never feel like the camera needs
 * windshield wipers." The streaks (`RainView`) are the rain; this is
 * the evidence of it, and the evidence is meant to be occasional.
 *
 * WHAT IT DRAWS. One `InstancedMesh` of at most a couple of dozen quads,
 * in NDC, under an orthographic camera of its own, drawn as an overlay
 * pass after the world with the renderer's auto-clear off. Each quad's
 * shader draws a soft disc with a thin darker rim, a faintly darker
 * middle and a bright crescent on its upper-left — the shape a drop on
 * glass has when the light is above and ahead of it. There is no
 * render target in this app, so a drop cannot refract the world behind
 * it; it is alpha over the frame, and the rim is what makes a
 * transparent disc read as water rather than as a smudge. `uLight`
 * scales the crescent: the scene sets it from the sky's light, so at
 * night a drop is a rim and no shine ("subtle highlight when lighting
 * permits"). The HUD is DOM above the canvas, so the lens is below the
 * UI by construction and the HUD stays crisp.
 *
 * WHAT IT DOES NOT DO, by the brief's list: no full-screen blur, no
 * large opaque circles, no constant smear, no refracting the world, no
 * dozens of simulated droplets, no post-processing chain. One draw, one
 * material, a fixed pool.
 *
 * HOW A DROP LIVES. It appears (a short fade-in, so nothing pops), sits
 * or creeps downward — bigger drops creep faster and stretch a little
 * as they go, the way a heavy drop runs and a small one clings — and
 * fades over the last third of a life of two to six seconds. A new drop
 * that lands within one radius of a live one grows that one instead of
 * appearing beside it, which is the cheapest merge there is: O(n) over
 * a pool of at most 28. When the exposure is zero — the rain stopped,
 * or the camera came down out of it — nothing new appears and what is
 * there finishes its life, so the lens clears on its own within six
 * seconds.
 *
 * HOW OFTEN. The spawn rate is `SPAWN_PER_S × exposure × (SPAWN_FLOOR +
 * (1 − SPAWN_FLOOR) × strength)`, where `exposure` is `lensExposure`'s
 * 0..1 (already scaled by the rain's strength) and `strength` is the
 * streaks' own eased 0..1. At full exposure in a real shower that is
 * `SPAWN_PER_S` a second — 1.2, "occasional" — and it is evaluated as a
 * chance on a `LENS_TICK_S` accumulator rather than every frame, so the
 * arrivals are irregular the way rain is and the cost does not scale
 * with the frame rate. Light rain, level camera, no head wind: a drop
 * every ten seconds or so; heavy rain looking up into it: one every
 * second, each gone in a few, and never more than the rung's cap alive.
 *
 * THE CAP IS THE RUNG'S (`LENS_CAPS`), keyed by the rung's NAME exactly
 * as `RAIN_CAPS` and `world/objects/budget.ts` are, so the rung is a
 * lens here as everywhere: `ultra-low` is ZERO, and on that rung the
 * effect is simply absent — the honest floor for a phone that is
 * already choosing between the sea and the frame rate. The cap is a
 * maximum, not a quota.
 *
 * NO ALLOCATION PER FRAME. The pool is typed arrays; `update` reuses one
 * `Matrix4` and writes the instance matrices in place; the alpha is an
 * instanced attribute written the same way. A dead drop is swap-removed
 * so the live ones stay contiguous and `mesh.count` is the draw count.
 * `cost` is a running mean and a peak of `update`'s own wall-clock, so
 * the perf HUD can say what this layer costs rather than guess.
 *
 * SIZES ARE IN SCREEN HEIGHTS, not pixels or NDC: a 0.012 drop is 1.2%
 * of the screen's height on any phone, and `resize` hands the view the
 * aspect so the instance is scaled narrower in x by exactly that and
 * stays round. On a 932 × 430 phone at DPR 2 a small drop is 10 to 17
 * pixels across the radius, a medium one up to 39.
 *
 * SURFACING IS THE SAME THING WITH BIGGER DROPS. `splash(count,
 * radiusScale)` seeds a handful of larger, short-lived drops at once —
 * the seam for the camera coming up out of the sea, which the brief
 * asked the framework to be ready for and which this build does not yet
 * call. It uses the same pool, the same shader and the same life, so
 * it costs nothing until it is used.
 *
 * DETERMINISTIC: the drops' places, sizes and arrival chances come from
 * a small seeded generator (mulberry32, inlined as `RainView` inlines
 * its own, because `sky/` may import `world/` as TYPES ONLY and
 * `world/random` exports values — `tests/viewBoundary.test.ts` pins
 * that rule), never `Math.random`, so a test can count on the same rain
 * twice and two runs from one seed draw the same drops.
 *
 * It reads no world coordinate and knows nothing of who is under the
 * sky: it is handed a strength, an exposure, a dt and a light, and that
 * is the whole of its interface with the game.
 */
import * as THREE from 'three';

/**
 * The most drops on the glass, per detail rung. GAME TUNING — the
 * brief's "fixed maximum count", set low on purpose: a phone on `low`
 * sees at most six, and `ultra-low` sees none. Keyed by the rung's NAME;
 * a test pins the keys against `DETAIL_TIERS`.
 */
export const LENS_CAPS: Readonly<Record<string, number>> = Object.freeze({
  'ultra-low': 0,
  low: 6,
  medium: 12,
  high: 20,
  'ultra-high': 28,
});

/** The cap for a rung named by the detail ladder. An unknown name is `medium`. */
export function lensCapFor(detail: string): number {
  return LENS_CAPS[detail] ?? LENS_CAPS.medium;
}

/** Spawning is decided on this accumulator, not every frame. GAME TUNING. */
export const LENS_TICK_S = 0.1;
/** Drops a second at full exposure in a real shower: "occasional". GAME TUNING. */
export const SPAWN_PER_S = 1.2;
/** The spawn rate's share that does not scale with the rain's strength. GAME TUNING. */
export const SPAWN_FLOOR = 0.3;
/** A small drop's radius, in screen heights. GAME TUNING. */
export const SMALL_RADIUS_MIN = 0.012;
export const SMALL_RADIUS_MAX = 0.02;
/** The chance a new drop is a medium one. GAME TUNING. */
export const MEDIUM_CHANCE = 0.15;
/** A medium drop's largest radius, in screen heights. GAME TUNING. */
export const MEDIUM_RADIUS_MAX = 0.045;
/** A merged drop never grows past this radius. GAME TUNING. */
export const MERGE_RADIUS_MAX = 0.06;
/** How long a drop lives, seconds. GAME TUNING. */
export const LIFE_MIN_S = 2;
export const LIFE_MAX_S = 6;
/** The share of a life over which a drop fades out. GAME TUNING. */
export const FADE_FRACTION = 1 / 3;
/** Seconds over which a new drop fades in, so none pops. GAME TUNING. */
export const FADE_IN_S = 0.15;
/**
 * How fast a drop of `SMALL_RADIUS_MAX` creeps down the glass, in screen
 * heights a second; the creep scales with the square of the radius, so
 * a small drop clings and a medium one runs. GAME TUNING.
 */
export const CREEP_PER_S = 0.015;
/** How much a running drop stretches vertically by the end of its life. GAME TUNING. */
export const STRETCH_MAX = 0.35;
/** The crescent's brightness when the scene has not said otherwise. GAME TUNING. */
export const LIGHT_DEFAULT = 0.6;
/** A surfacing splash's drops: radius (in small/medium units, before `radiusScale`) and life. GAME TUNING. */
export const SPLASH_RADIUS_MIN = SMALL_RADIUS_MAX;
export const SPLASH_RADIUS_MAX = MEDIUM_RADIUS_MAX;
export const SPLASH_LIFE_MIN_S = 1.2;
export const SPLASH_LIFE_MAX_S = 2.5;

/** Where a drop may land, in NDC: inside the frame with a small margin. */
const SPAWN_X = 0.92;
const SPAWN_Y_MIN = -0.85;
const SPAWN_Y_MAX = 0.95;
/** The crescent's tint: the streaks' colour, so the two read as one rain. Look, not a registry number. */
const TINT = 0xbcd4e8;
/** The name a test or a probe finds the mesh by. */
const MESH_NAME = 'lensdrops';

export interface LensViewOptions {
  /** The detail rung's name, for the cap. */
  readonly detail: string;
  /** The generator's seed; the same seed draws the same drops. */
  readonly seed?: number;
}

export interface LensCost {
  /** Mean milliseconds an `update` has taken since the last reset. */
  readonly meanMs: number;
  /** The longest one. */
  readonly peakMs: number;
  /** Drops on the glass right now. */
  readonly live: number;
}

const VERTEX = /* glsl */ `
attribute float aAlpha;
varying vec2 vQ;
varying float vAlpha;

void main() {
  // The quad spans -1..1; the fragment shader wants that, not the uv.
  vQ = position.xy;
  vAlpha = aAlpha;
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * p;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uLight;
uniform vec3 uTint;
varying vec2 vQ;
varying float vAlpha;

void main() {
  float d = length(vQ);
  if (d > 1.0) discard;
  // The disc, soft at its edge.
  float disc = 1.0 - smoothstep(0.86, 1.0, d);
  // A thin darker rim: without refraction it is what makes glass read as water.
  float rim = smoothstep(0.62, 0.84, d) * disc;
  // The middle, faintly darker than the frame around it.
  float body = (1.0 - smoothstep(0.0, 0.7, d)) * disc;
  // The crescent on the upper-left, where a drop lit from above and ahead catches the light.
  vec2 toLight = normalize(vec2(-0.6, 0.8));
  float facing = d > 1e-4 ? max(0.0, dot(vQ / d, toLight)) : 0.0;
  float crescent = smoothstep(0.45, 0.72, d) * (1.0 - smoothstep(0.72, 0.9, d)) * facing * facing;
  float dark = body * 0.12 + rim * 0.30;
  float light = crescent * 0.55 * uLight;
  float a = clamp(dark + light, 0.0, 1.0) * vAlpha;
  if (a < 0.004) discard;
  // One output: black where the drop darkens, the tint where it shines.
  vec3 colour = uTint * (light / max(dark + light, 1e-4));
  gl_FragColor = vec4(colour, a);
  #include <colorspace_fragment>
}
`;

/** mulberry32, inlined: `sky/` may take `world/random` as types only. */
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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** How fast a drop of this radius creeps, in NDC a second (NDC y spans two screen heights). */
function creepOf(radius: number): number {
  const ratio = radius / SMALL_RADIUS_MAX;
  return 2 * CREEP_PER_S * ratio * ratio;
}

export class LensView {
  /** Its own scene, drawn as an overlay pass with the renderer's auto-clear off. */
  readonly scene = new THREE.Scene();
  /** NDC straight through: x and y in −1..1 are the screen. */
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** What this layer costs, for the perf HUD. */
  readonly cost: LensCost;

  private readonly geometry: THREE.PlaneGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly random: () => number;
  private readonly matrix = new THREE.Matrix4();
  private readonly costState = { meanMs: 0, peakMs: 0, live: 0 };
  private detailName: string;

  private mesh!: THREE.InstancedMesh;
  private alphaAttribute!: THREE.InstancedBufferAttribute;
  private capValue = 0;
  /** The pool: a drop's place (NDC), radius (screen heights), age and life (s), and creep (NDC/s). */
  private x!: Float32Array;
  private y!: Float32Array;
  private radius!: Float32Array;
  private age!: Float32Array;
  private life!: Float32Array;
  private creep!: Float32Array;
  private liveCount = 0;
  private spawnedCount = 0;
  private aspect = 1;
  private accumulator = 0;
  private costSum = 0;
  private costUpdates = 0;

  constructor(options: LensViewOptions) {
    this.cost = this.costState;
    this.detailName = options.detail;
    this.random = seeded(options.seed ?? 1);
    this.scene.name = 'lens';
    // No background: an overlay scene that cleared would wipe the world.
    this.scene.background = null;

    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uLight: { value: LIGHT_DEFAULT },
        uTint: { value: new THREE.Color(TINT) },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // Nothing in this scene has depth: the drops are on the glass.
      depthTest: false,
      depthWrite: false,
      fog: false,
    });

    this.buildPool(lensCapFor(options.detail));
  }

  /** The most drops this rung draws. */
  get cap(): number {
    return this.capValue;
  }

  /** The rung this view was built for. */
  get detail(): string {
    return this.detailName;
  }

  /** Drops on the glass right now. */
  get live(): number {
    return this.liveCount;
  }

  /** Drops that have ever appeared, splashes included. What a test counts. */
  get spawned(): number {
    return this.spawnedCount;
  }

  /** The drawing buffer's size in DEVICE pixels: only the aspect matters, and it keeps a disc round. */
  resize(widthPx: number, heightPx: number): void {
    if (!(Number.isFinite(widthPx) && Number.isFinite(heightPx) && widthPx > 0 && heightPx > 0)) return;
    this.aspect = widthPx / heightPx;
    this.writeInstances();
  }

  /** Rebuild the pool for another rung; drops that fit the new cap are kept. */
  setDetail(detail: string): void {
    this.detailName = detail;
    const cap = lensCapFor(detail);
    if (cap === this.capValue) return;
    const keep = Math.min(this.liveCount, cap);
    const old = { x: this.x, y: this.y, radius: this.radius, age: this.age, life: this.life, creep: this.creep };
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.buildPool(cap);
    for (let i = 0; i < keep; i += 1) {
      this.x[i] = old.x[i];
      this.y[i] = old.y[i];
      this.radius[i] = old.radius[i];
      this.age[i] = old.age[i];
      this.life[i] = old.life[i];
      this.creep[i] = old.creep[i];
    }
    this.liveCount = keep;
    this.writeInstances();
  }

  /**
   * One frame of the lens.
   *
   * @param strength the streaks' eased 0..1 (`RainView.strength`).
   * @param exposure `lensExposure(...).exposure`, 0..1.
   * @param dt SIMULATED seconds; zero, negative or non-finite is no frame.
   * @param light 0..1, how much the crescent may shine; omitted keeps the last.
   */
  update(strength: number, exposure: number, dt: number, light?: number): void {
    if (!(Number.isFinite(dt) && dt > 0)) return;
    const started = performance.now();
    if (light !== undefined && Number.isFinite(light)) this.material.uniforms.uLight.value = clamp01(light);
    const rain = clamp01(Number.isFinite(strength) ? strength : 0);
    const reach = clamp01(Number.isFinite(exposure) ? exposure : 0);

    // Age and creep every frame, so the motion is as smooth as the frame.
    const x = this.x;
    const y = this.y;
    const age = this.age;
    const life = this.life;
    const creep = this.creep;
    const radius = this.radius;
    let live = this.liveCount;
    for (let i = 0; i < live; ) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        // Swap-remove: the last live drop takes the dead one's slot.
        live -= 1;
        x[i] = x[live];
        y[i] = y[live];
        radius[i] = radius[live];
        age[i] = age[live];
        life[i] = life[live];
        creep[i] = creep[live];
        continue;
      }
      y[i] -= creep[i] * dt;
      i += 1;
    }
    this.liveCount = live;

    // Arrivals are decided on the tick, as a chance, so they are irregular
    // and the cost does not follow the frame rate.
    this.accumulator += dt;
    const chance = SPAWN_PER_S * reach * (SPAWN_FLOOR + (1 - SPAWN_FLOOR) * rain) * LENS_TICK_S;
    while (this.accumulator >= LENS_TICK_S) {
      this.accumulator -= LENS_TICK_S;
      if (chance <= 0) continue;
      if (this.random() < chance) this.spawn(true);
    }

    this.writeInstances();

    const took = performance.now() - started;
    this.costSum += took;
    this.costUpdates += 1;
    this.costState.meanMs = this.costSum / this.costUpdates;
    if (took > this.costState.peakMs) this.costState.peakMs = took;
  }

  /**
   * The surfacing seam: `count` larger, short-lived drops at once, as
   * many as the pool has room for. `radiusScale` grows them beyond a
   * medium drop; a merged result is still capped.
   */
  splash(count: number, radiusScale = 2): void {
    if (!(Number.isFinite(count) && count > 0)) return;
    const scale = Number.isFinite(radiusScale) && radiusScale > 0 ? radiusScale : 1;
    const n = Math.min(Math.floor(count), this.capValue - this.liveCount);
    for (let i = 0; i < n; i += 1) {
      const r = Math.min(MERGE_RADIUS_MAX, (SPLASH_RADIUS_MIN + (SPLASH_RADIUS_MAX - SPLASH_RADIUS_MIN) * this.random()) * scale);
      this.place(r, SPLASH_LIFE_MIN_S + (SPLASH_LIFE_MAX_S - SPLASH_LIFE_MIN_S) * this.random());
    }
    this.writeInstances();
  }

  resetCost(): void {
    this.costSum = 0;
    this.costUpdates = 0;
    this.costState.meanMs = 0;
    this.costState.peakMs = 0;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.liveCount = 0;
    this.costState.live = 0;
  }

  /** The pool at a cap: the typed arrays and the mesh that draws them. */
  private buildPool(cap: number): void {
    this.capValue = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.radius = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.creep = new Float32Array(cap);
    this.liveCount = 0;

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, cap);
    this.mesh.name = MESH_NAME;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // Rewritten every frame; culling it against a stale sphere only hides it wrongly.
    this.mesh.frustumCulled = false;
    // Inside the orthographic camera's 0..1 depth, clear of both planes.
    this.mesh.position.z = -0.5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.alphaAttribute = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aAlpha', this.alphaAttribute);
    this.scene.add(this.mesh);
  }

  /** A rain drop: mostly small, sometimes medium, merged into a neighbour when it lands on one. */
  private spawn(merge: boolean): void {
    const medium = this.random() < MEDIUM_CHANCE;
    const r = medium
      ? SMALL_RADIUS_MAX + (MEDIUM_RADIUS_MAX - SMALL_RADIUS_MAX) * this.random()
      : SMALL_RADIUS_MIN + (SMALL_RADIUS_MAX - SMALL_RADIUS_MIN) * this.random();
    const life = LIFE_MIN_S + (LIFE_MAX_S - LIFE_MIN_S) * this.random();
    this.place(r, life, merge);
  }

  /** Put a drop on the glass, or grow the one it landed on. */
  private place(r: number, life: number, merge = false): void {
    const px = (this.random() * 2 - 1) * SPAWN_X;
    const py = SPAWN_Y_MIN + (SPAWN_Y_MAX - SPAWN_Y_MIN) * this.random();
    if (merge) {
      for (let j = 0; j < this.liveCount; j += 1) {
        // Distance in screen heights: NDC x is stretched by the aspect, and both axes span two heights.
        const dist = 0.5 * Math.hypot((px - this.x[j]) * this.aspect, py - this.y[j]);
        if (dist < this.radius[j]) {
          const grown = Math.min(MERGE_RADIUS_MAX, Math.hypot(this.radius[j], r));
          this.radius[j] = grown;
          this.creep[j] = creepOf(grown);
          // A drop that just took on water is not about to fade.
          this.life[j] = Math.max(this.life[j], this.age[j] + LIFE_MIN_S);
          return;
        }
      }
    }
    if (this.liveCount >= this.capValue) return;
    const i = this.liveCount;
    this.x[i] = px;
    this.y[i] = py;
    this.radius[i] = r;
    this.age[i] = 0;
    this.life[i] = life;
    this.creep[i] = creepOf(r);
    this.liveCount = i + 1;
    this.spawnedCount += 1;
  }

  /** The pool into the instance matrices and alphas, in place. */
  private writeInstances(): void {
    const live = this.liveCount;
    const alpha = this.alphaAttribute.array as Float32Array;
    for (let i = 0; i < live; i += 1) {
      const r = this.radius[i];
      const f = this.age[i] / this.life[i];
      const fadeOut = f > 1 - FADE_FRACTION ? (1 - f) / FADE_FRACTION : 1;
      const fadeIn = Math.min(1, this.age[i] / FADE_IN_S);
      alpha[i] = fadeIn * fadeOut;
      // A running drop lengthens as it goes; a clinging small one hardly at all.
      const running = clamp01((r - SMALL_RADIUS_MIN) / (MEDIUM_RADIUS_MAX - SMALL_RADIUS_MIN));
      const stretch = 1 + STRETCH_MAX * running * f;
      // The quad spans −1..1, so a scale of s is a half-extent of s; NDC y
      // spans two screen heights, and x is narrowed by the aspect to stay round.
      this.matrix.makeScale((2 * r) / this.aspect, 2 * r * stretch, 1);
      this.matrix.setPosition(this.x[i], this.y[i], 0);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.count = live;
    this.mesh.visible = live > 0;
    this.costState.live = live;
    if (live === 0) return;
    // Only the live drops were written, so only they are sent.
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, live * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttribute.clearUpdateRanges();
    this.alphaAttribute.addUpdateRange(0, live);
    this.alphaAttribute.needsUpdate = true;
  }
}
