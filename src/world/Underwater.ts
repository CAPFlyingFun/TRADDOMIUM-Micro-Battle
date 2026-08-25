import * as THREE from 'three';
import { waterLevelAt } from './flow';
import { reliefScale } from './heightfield';
import { originAt } from './origin';

/**
 * WHAT BEING UNDER THE WATER LOOKS LIKE.
 *
 * Joshua: "underwater looks like above ground." He is right, and the
 * reason it matters more here than it would in most games is SCALE. A
 * world unit is a centimetre and the queen is about one unit long, so
 * her eye rides a few units off the ground. The water she can reach
 * runs a median of 0.30 m deep and often over a metre. At that ratio,
 * being NEXT TO a stream is almost always being INSIDE it — standing
 * beside the water is the rare case, not the normal one.
 *
 * MEASURED, BY ACCIDENT. Three probe frames meant to show a newly
 * widened stream from her own eye height came back looking like dry
 * sand. The first stood in 1.26 m of water (ground 305.84 m, surface
 * 307.10 m) with the camera 9 cm above the bed, which is 1.17 m under
 * the surface; the second was 0.71 m deep with the camera 22 cm up, 49
 * cm under; the third 1.37 m deep with the camera 18 cm up, 1.19 m
 * under. Toggling the water layer off changed 83-85% of the pixels in
 * those frames, so the water was not missing and was not a thin sliver
 * at the edge of the view: it was drawn, it covered nearly everything,
 * and it looked exactly like air. The renderer draws a water SURFACE
 * and nothing else — no attenuation, no tint, no loss of sight — so
 * from underneath you see the bed in full sunlight through nothing at
 * all.
 *
 * THIS FILE IS A LOOK AND NOTHING ELSE. No swimming, no wading, no
 * buoyancy, no drowning, no breath, no change to how she moves or what
 * it costs her. A later pass owns those, and when it comes it must read
 * the same waterLevelAt() this one does rather than inventing a second
 * answer to where the water is.
 *
 * THE ORDER OF WRITES IS THE WHOLE DESIGN. applyWeather() stamps the
 * fog colour and density, the background, the sun and the skylight
 * every single frame, so this has to be the LATER writer or it is
 * simply overwritten before anyone sees it. That is also why nothing is
 * put back when she surfaces; see update().
 */

/** A metre, in world units, so visibilities can be written as distances. */
const M = 100;

/**
 * The ocean's surface. Land is above it by definition, which is what
 * lets the sea be answered from a height alone rather than looked up.
 */
const SEA_LEVEL = 0;

/**
 * Water surface over this point in DRAWN units, or null where the flow
 * index has nothing.
 *
 * THE SEA IS DELIBERATELY NOT IN HERE, and the pinned name promises it,
 * so the divergence is worth a sentence. waterLevelAt() returns null
 * over the ocean — the bake indexes streams and ponds, not the sea —
 * and the only thing that makes the sea answerable at all is the rule
 * that land stands above y = 0. That is a fact about the HEIGHT being
 * asked about, not about (wx, wz), so folding it in here would mean
 * either returning SEA_LEVEL over every dry hilltop on the island or
 * asking the terrain grid a question it cannot answer before the island
 * has loaded. submersion() below is where the two surfaces meet, and it
 * has the height it needs to do it. Anything that only knows (wx, wz)
 * and wants the sea as well should floor this at SEA_LEVEL itself.
 */
export function surfaceAt(wx: number, wz: number): number | null {
  const raw = waterLevelAt(wx, wz);
  if (raw === null) return null;
  // Levels are stored at relief 1 and the dial is applied by the
  // caller, exactly as FlowWater seats its slabs and groundHeight()
  // scales the ground. One rule, or the water and the bed part company
  // the moment the slider moves.
  return raw * reliefScale();
}

/**
 * How far below the surface a camera at (wx, y, wz) is, drawn units.
 * Zero when it is not under.
 *
 * BOTH WATERS, AND THE HIGHER ONE WINS. The sea answers from y alone,
 * because its surface is SEA_LEVEL everywhere and land is above it; the
 * flow answers from the index. Taking the larger of the two DEPTHS is
 * the same thing as taking the higher of the two SURFACES, since both
 * are that surface minus the same y — which matters where a stream
 * mouth runs out over the shelf and the two overlap.
 */
export function submersion(wx: number, y: number, wz: number): number {
  const sea = y < SEA_LEVEL ? SEA_LEVEL - y : 0;
  const surface = surfaceAt(wx, wz);
  const fresh = surface === null ? 0 : Math.max(0, surface - y);
  return Math.max(sea, fresh);
}

/**
 * HOW FAR UNDER BEFORE THE LOOK IS FULLY ON.
 *
 * Her eye crossing the waterline is a real hard edge and the look
 * should not pretend otherwise, but a single frame going from clear air
 * to water thick enough to hide her own legs reads as a glitch rather
 * than as a transition. Two units is two body lengths of travel, a
 * fraction of a second at walking pace: long enough that the change has
 * somewhere to happen, short enough that nobody would call it a fade.
 */
const RAMP = 2;

/**
 * How fast the shallow look becomes the deep one, as an e-folding
 * depth. Beer-Lambert in spirit — light and sight both fall off
 * exponentially in water, so the blend does too rather than running
 * linearly to some arbitrary floor.
 *
 * ONE METRE, chosen against the three measured frames. At 49 cm, 1.17 m
 * and 1.19 m under they land 39%, 69% and 70% of the way to the deep
 * look, which spreads the water she will actually be standing in across
 * the range instead of pinning all of it at one end.
 */
const EFOLD = 1 * M;

/**
 * THE COLOUR OF THE WATER, shallow to deep.
 *
 * A fresh stream over a silty bed reads green near the top; depth eats
 * the long wavelengths first, so the red goes, then the green, and what
 * is left at the bottom is a blue-black. GAME TUNING shaped by that
 * order, not a measured spectrum.
 */
const SHALLOW_R = 0.07, SHALLOW_G = 0.20, SHALLOW_B = 0.21;
const DEEP_R = 0.01, DEEP_G = 0.05, DEEP_B = 0.09;

/**
 * √(−ln 0.05) — the 5%-contrast convention meteorology uses for
 * "visibility", so FogExp2 leaves exp(-(d·ρ)²) of a surface showing and
 * a dark object disappears at exactly the distance named below.
 *
 * Restated here rather than imported from weather/sky.ts, which owns
 * the same constant, because this file is deliberately kept to three,
 * flow, heightfield and origin. If one of the two ever changes, they
 * are both wrong, and this sentence is where to look.
 */
const FOG_TAIL = Math.sqrt(-Math.log(0.05));

/** The air's nominal fog density, which is 2.31 km of sight. */
const AIR_DENSITY = 0.0000075;

/**
 * HOW FAR SHE CAN SEE UNDER THERE, as a distance, because the next
 * person to touch this should be tuning metres rather than an exponent.
 *
 * Two and a half metres near the surface: fresh Hawaiian stream water
 * really is fairly clear, and at her scale two and a half metres is two
 * hundred and fifty body lengths, which is still a long way to see. Six
 * tenths of a metre at depth, where there is more water overhead and
 * more of the bed stirred into it. Against the air's 2.31 km that is a
 * cut of roughly nine hundredfold at the surface and four thousandfold
 * at the bottom, which is the "visibility cut hard" the frames were
 * missing entirely.
 *
 * The blend runs on SIGHT and the density is derived after, so the two
 * numbers stay readable as distances.
 */
const SIGHT_SHALLOW = 2.5 * M;
const SIGHT_DEEP = 0.6 * M;

/**
 * WHAT THE WATER TAKES OUT OF THE LIGHT, as multipliers on whatever the
 * weather has just set.
 *
 * Multipliers rather than absolutes, and that is the point of them: an
 * overcast pond should still be darker than a sunlit one, and two
 * absolute numbers would land both on the same brightness and throw the
 * weather away the moment she steps in.
 *
 * GAME TUNING, said plainly. A real stream a metre deep does not lose
 * four fifths of its sunlight — clear fresh water is far better than
 * that over such a short path. These numbers stand in for what the
 * fog cannot show: the sheet overhead, the silt in the column, and the
 * simple fact that a centimetre-long animal under a metre of water is
 * meant to feel like it is somewhere else.
 */
const SUN_SHALLOW = 0.75, SUN_DEEP = 0.18;
const AMBIENT_SHALLOW = 0.85, AMBIENT_DEEP = 0.30;

/**
 * THE NEAR PANE'S ALPHA, shallow to deep. Small on purpose — the fog is
 * doing the work and the pane only closes the gap fog cannot reach.
 *
 * The gap is measured. The camera rides 3.5 to 16 units off her, 7.8 by
 * default, and at 7.8 units the shallow fog leaves 99.7% of her showing
 * and the deep fog still leaves 95%. Fog is an exponential in distance
 * and she is barely any distance away, so without a pane she stays lit
 * as though she were standing in air with a green room behind her. With
 * these, she reads about a tenth water at the surface and a little over
 * two fifths of the way to it at depth.
 */
const TINT_SHALLOW = 0.10, TINT_DEEP = 0.40;

/**
 * WHERE THE PANE HANGS, in units ahead of the lens. The camera's near
 * plane is 0.5 and the closest the boom ever comes is 3.5, so 1.2 sits
 * clear of both: past the near plane, so it is never clipped away, and
 * inside her, so it is genuinely between the eye and everything.
 */
const PANE_AT = 1.2;
/** A little slack, so no rounding can ever expose the pane's own edge. */
const PANE_MARGIN = 1.05;
/**
 * After everything. The water slabs draw at 1 and the rain at 2; this
 * is the last thing between the eye and the frame, so it wants a number
 * nothing is going to grow into.
 */
const PANE_ORDER = 10_000;

/** Nothing at the waterline, everything a couple of units below it. */
function rampIn(under: number): number {
  const t = Math.min(Math.max(under / RAMP, 0), 1);
  return t * t * (3 - 2 * t);
}

function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * How the scene should look `under` drawn units below the surface.
 * A pure function, so it can be tested without a renderer.
 */
export interface Look {
  readonly r: number; readonly g: number; readonly b: number;
  readonly density: number;   // for FogExp2
  readonly sun: number;       // multiplier on the weather's sunlight
  readonly ambient: number;   // multiplier on the weather's skylight
  readonly tint: number;      // 0..1 alpha of the near pane
}

/**
 * THE LOOK AT A DEPTH.
 *
 * Two blends, and they are not the same blend. `deep` is how far down
 * the water has taken her, and it moves the colour, the sight and the
 * light; `ramp` is how far past the waterline she has got, and it moves
 * the look in from the air over the first couple of units so the
 * crossing is a transition rather than a switch.
 *
 * The COLOUR carries no ramp, and cannot: the air's colour is whatever
 * the weather is doing this minute and a pure function has no way to
 * know it. What comes back is the water's own colour at that depth, and
 * the ramp is applied against the current sky by the caller.
 */
export function underwaterLook(under: number): Look {
  const deep = 1 - Math.exp(-Math.max(under, 0) / EFOLD);
  const ramp = rampIn(under);
  const sight = mix(SIGHT_SHALLOW, SIGHT_DEEP, deep);
  return {
    r: mix(SHALLOW_R, DEEP_R, deep),
    g: mix(SHALLOW_G, DEEP_G, deep),
    b: mix(SHALLOW_B, DEEP_B, deep),
    density: mix(AIR_DENSITY, FOG_TAIL / sight, ramp),
    sun: mix(1, mix(SUN_SHALLOW, SUN_DEEP, deep), ramp),
    ambient: mix(1, mix(AMBIENT_SHALLOW, AMBIENT_DEEP, deep), ramp),
    tint: mix(0, mix(TINT_SHALLOW, TINT_DEEP, deep), ramp),
  };
}

export class Underwater {
  private readonly geometry = new THREE.PlaneGeometry(1, 1);
  private readonly material: THREE.MeshBasicMaterial;
  private readonly pane: THREE.Mesh;
  /** Scratch, so a submerged frame allocates nothing. */
  private readonly water = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    this.material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      // In front of everything, unconditionally. The pane is not part
      // of the world and has no business losing a depth test to it.
      depthTest: false,
      depthWrite: false,
      // Fogging the fog's own stand-in would be circular.
      fog: false,
      // Both faces, so which way round the plane was built cannot
      // become a thing anyone has to remember.
      side: THREE.DoubleSide,
    });
    this.pane = new THREE.Mesh(this.geometry, this.material);
    this.pane.renderOrder = PANE_ORDER;
    this.pane.visible = false;
    // Sized to sit exactly on the frustum edge, so culling it is a
    // question of rounding rather than of geometry. Not asked.
    this.pane.frustumCulled = false;
    // NOT PARENTED TO THE CAMERA, though that is what it is for. The
    // renderer walks the SCENE to decide what to draw, and this
    // project's camera is never added to it — FollowCamera builds the
    // camera and holds it — so a child of the camera would have its
    // matrix faithfully updated every frame and never once be drawn.
    // Seated from the camera's world matrix instead, in seat(), which
    // puts it in the same place and does not care where the camera
    // lives in the graph.
    scene.add(this.pane);
  }

  /**
   * Apply or clear the look. Call AFTER applyWeather, every frame.
   * Returns how far under the surface the camera is, 0 when dry.
   *
   * THE CAMERA'S POSITION IS THE RENDERED ONE. x and z are measured
   * from the floating origin and go back through originAt() before the
   * water is asked about them; y is absolute already and goes through
   * untouched. Skip that and this samples the water somewhere near the
   * middle of the island, which is the dangerous kind of wrong, because
   * an island that size nearly always has an answer and the answer
   * looks perfectly plausible.
   */
  update(sun: THREE.DirectionalLight, sky: THREE.HemisphereLight): number {
    const eye = this.camera.position;
    const seat = originAt();
    const under = submersion(eye.x + seat.x, eye.y, eye.z + seat.z);
    if (under <= 0) {
      // NOTHING IS RESTORED HERE, and the missing branch is deliberate.
      // applyWeather() rewrites the fog colour, the fog density, the
      // background, the sun and the skylight from the current sky on
      // every frame, immediately before this runs. Putting the air back
      // by hand would mean keeping a copy of five values that are
      // already about to be overwritten, and it would fight the weather
      // for a frame every time the sky changed while she was under.
      // Surfacing costs one frame of the last look; the next
      // applyWeather is the restore.
      this.pane.visible = false;
      return 0;
    }
    const look = underwaterLook(under);
    this.water.setRGB(look.r, look.g, look.b);
    // THE COLOUR IS CROSSFADED HERE because underwaterLook() cannot do
    // it: the air's colour belongs to the weather and a pure function
    // has no way to ask. Fog and background take the SAME ramp from the
    // SAME sky, which is what keeps them equal — they have to match or
    // the horizon draws a line across itself (see weather/sky.ts).
    const ramp = rampIn(under);
    const fog = this.scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.lerp(this.water, ramp);
      // NEVER THINNER THAN THE AIR SHE JUST LEFT. underwaterLook() has
      // to blend from a constant, because a pure function cannot ask the
      // sky what the fog is doing, and the constant it blends from is
      // CLEAR air at 2.31 km of sight. In weather already fogged down to
      // the 60 m floor the real air is thirty-eight times denser than
      // that, so the first stride under the surface would have made the
      // world CLEARER — the one thing going underwater must never do.
      // The colour on the line above has no such problem because it is
      // crossfaded from whatever applyWeather actually set.
      fog.density = Math.max(fog.density, look.density);
    }
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.lerp(this.water, ramp);
    }
    // MULTIPLIED, NOT SET. The weather chose these a moment ago and
    // taking a fraction of its choice is the whole reason they are
    // multipliers: an overcast pond stays darker than a sunlit one,
    // where two absolute numbers would have thrown the sky away.
    sun.intensity *= look.sun;
    sky.intensity *= look.ambient;
    this.material.color.copy(this.water);
    this.material.opacity = look.tint;
    this.pane.visible = true;
    this.seat();
    return under;
  }

  /**
   * Hold the pane across the frustum, a hair in front of the lens.
   *
   * THIS IS WHAT FOG CANNOT DO. FogExp2 is an exponential in DISTANCE,
   * so it only ever reaches what is far away, and at this scale nothing
   * she cares about is: her own body sits 7.8 units from the lens by
   * default, where even the densest water here leaves 95% of her
   * showing. Fog alone would put her in a lit glass box with a green
   * room outside it. The pane is the water between the eye and
   * everything, including her.
   */
  private seat(): void {
    const lens = this.camera as THREE.PerspectiveCamera;
    if (lens.isPerspectiveCamera) {
      // Re-sized every frame rather than once, because fov is a
      // settings slider and aspect changes when the phone turns, and a
      // pane a frame behind either of them shows its own edge.
      const high = 2 * PANE_AT * Math.tan(THREE.MathUtils.degToRad(lens.fov) / 2);
      this.pane.scale.set(high * lens.aspect * PANE_MARGIN, high * PANE_MARGIN, 1);
    }
    this.camera.getWorldQuaternion(this.pane.quaternion);
    this.camera.getWorldPosition(this.pane.position);
    // Along the camera's own forward, now that it wears the camera's
    // attitude. The scene is the pane's parent and the scene is
    // identity, so local and rendered are the same frame here.
    this.pane.translateZ(-PANE_AT);
  }

  dispose(): void {
    this.scene.remove(this.pane);
    this.geometry.dispose();
    this.material.dispose();
  }
}
