/**
 * WHAT BEING UNDER THE SEA LOOKS LIKE — the fog, and nothing else.
 *
 * Joshua, 2026-09-06, after flying the camera below the waterline:
 * "need to add the underwater fog." Under the surface the build drew
 * the seabed in full sunlight through perfectly clear air, fading to the
 * pale sky colour at the horizon, which is what v0 was told about too —
 * "underwater looks like above ground" — and for the same reason: the
 * renderer draws a water SURFACE and nothing else, so from underneath
 * there is nothing between the eye and the bed.
 *
 * WHY IT MATTERS MORE HERE THAN IN MOST GAMES IS SCALE. A world unit is
 * a centimetre and the player is an ant. Being NEXT TO water is almost
 * always being INSIDE it, so the underwater look is not a rare set piece
 * — it is a place she will spend real time, and it has to read as
 * somewhere else the moment her eye crosses the line.
 *
 * THIS FILE IS A LOOK AND NOTHING ELSE. No swimming, no buoyancy, no
 * drowning, no breath, no change to how anything moves or what it costs.
 * A later pass owns those, and when it comes it must read the same
 * surface this one does rather than inventing a second answer to where
 * the water is.
 *
 * ─── carried from v0, and where it deliberately parts from it ────────
 *
 * v0's `world/Underwater.ts` solved this and its SHAPE is carried whole:
 * an exponential blend from a shallow look to a deep one, distances
 * written as how far you can SEE rather than as an exponent, and a short
 * ramp across the waterline so crossing it is a transition rather than a
 * one-frame glitch.
 *
 * Its NUMBERS are not carried, because they are not about this water.
 * v0 tuned 2.5 m of sight at the surface and 0.6 m at depth against
 * three measured frames of the queen standing in a FRESHWATER STREAM
 * over a silty bed. Clear Hawaiian coastal ocean is nothing like that:
 * thirty metres of horizontal visibility is ordinary and forty is a good
 * day. Using v0's stream numbers on the sea would put her in soup.
 *
 * v0 also dimmed the sun and the ambient and hung a tinted pane in front
 * of the lens. The pane is still not here — it belongs with the follow
 * camera that does not exist. The DIMMING is (2026-09-07, the lighting
 * polish): once the sky began writing the scene's lights every frame
 * there was something honest to multiply against, and without it the
 * seabed was lit as if in air — full sun on the sand under six metres of
 * water. `light` is that factor, pure like everything else here; the
 * scene multiplies the sky's sun and sky light by it while the eye is
 * under, and puts them back the frame it surfaces.
 *
 * LINEAR FOG, NOT EXPONENTIAL, and that is a rendering constraint rather
 * than a preference. three picks `FOG_EXP2` at COMPILE time, so swapping
 * a `Fog` for a `FogExp2` recompiles every material in the scene — and
 * the eye crosses the surface repeatedly as a swell passes over it. With
 * linear fog `far` IS the distance at which nothing is left, so a sight
 * distance goes in unchanged and nothing recompiles.
 *
 * Pure: no three, no DOM. A colour and two distances are not a scene.
 */

/** A metre, in world units, so visibilities can be written as distances. */
const M = 100;

/**
 * HOW FAR UNDER BEFORE THE LOOK IS FULLY ON.
 *
 * The eye crossing the waterline is a real hard edge and the look should
 * not pretend otherwise, but a single frame going from clear air to
 * water reads as a glitch rather than as a transition. A third of a
 * metre is a third of a second at the pace an ant swims and about ten
 * milliseconds at the free-fly camera's 30 m/s: long enough that the
 * change has somewhere to happen, short enough that nobody would call it
 * a fade — and short enough that a swell washing over her eye still
 * reads as a wave washing over her eye.
 */
export const SURFACE_RAMP = 0.33 * M;

/**
 * How fast the shallow look becomes the deep one, as an e-folding depth.
 *
 * Beer-Lambert in spirit — light and sight both fall off exponentially
 * in water, so the blend does too rather than running linearly to some
 * arbitrary floor. Twelve metres is chosen against how real sea water
 * eats light: red is gone by about 5 m, orange by 10, yellow by 20, and
 * what is left below 30 is blue. A 12 m e-fold has her four fifths of
 * the way to the deep look at 20 m down, which is where the colour has
 * genuinely gone.
 */
export const EFOLD = 12 * M;

/**
 * HOW FAR SHE CAN SEE UNDER THERE, as a distance, because the next
 * person to touch this should be tuning metres rather than an exponent.
 *
 * Thirty metres near the surface: clear Hawaiian coastal water really is
 * about that, and at her scale thirty metres is three thousand body
 * lengths, which is a very long way to see. Six metres at depth, where
 * there is more water overhead and more of the bed stirred into it.
 *
 * GAME TUNING SHAPED BY REAL OPTICS, not a measured spectrum.
 */
export const SIGHT_SHALLOW = 30 * M;
export const SIGHT_DEEP = 6 * M;

/**
 * HOW MUCH OF THE AIR'S LIGHT IS LEFT AT DEPTH, as a factor on the
 * scene's sun and sky light.
 *
 * At the surface all of it — the eye a centimetre under sees the same
 * sun the eye a centimetre above does — and it eases toward this floor
 * on the same e-fold the sight uses, so the water darkens and closes in
 * together rather than on two clocks. A floor rather than zero, because
 * the fog already takes the far end to the deep colour: what the light
 * has to do is take the shine off the sand and the shadow out of the
 * rocks, not black the world out twice. GAME TUNING shaped by the same
 * order the colours follow.
 */
export const LIGHT_DEEP = 0.35;

/**
 * THE COLOUR OF THE WATER, shallow to deep, as sRGB.
 *
 * Depth eats the long wavelengths first, so the red goes, then the
 * green, and what is left at the bottom is a blue-black. The shallow end
 * is a lit ocean teal — greener than the surface's own `0x1a6389`,
 * because looking THROUGH sunlit water is not the same as looking AT it.
 * GAME TUNING shaped by that order, not a spectrum.
 *
 * sRGB, LIKE EVERY OTHER COLOUR ANYONE PICKS. three's working space is
 * linear and `Color.setRGB` takes linear values unless it is told
 * otherwise, so authoring these as linear rendered them washed out — a
 * pale swimming-pool blue rather than the sea. The caller converts; the
 * numbers here are the ones a person would put in a colour picker, the
 * same as `HORIZON` next to them.
 */
const SHALLOW = { r: 0.09, g: 0.35, b: 0.42 } as const;
const DEEP = { r: 0.01, g: 0.05, b: 0.11 } as const;

export interface UnderwaterLook {
  /**
   * How much of the water's look applies, 0 at the surface to 1 once
   * fully under. The CALLER owns what it is blending from, because the
   * air's own fog rides the far plane and this module has no business
   * knowing that.
   */
  readonly strength: number;
  /** Fog and background colour at this depth, each channel 0..1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** How far anything is still visible, world units. */
  readonly sight: number;
  /**
   * How much of the air's light reaches here, 1 at the surface easing
   * to `LIGHT_DEEP`. The scene multiplies its sun and sky light by it;
   * the fog is a colour and this is a brightness, and neither does the
   * other's job.
   */
  readonly light: number;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The look at a given submersion — how far the eye is BELOW the surface,
 * in world units.
 *
 * Null above the water, which is the caller's cue to put the air back
 * rather than a value to blend towards. Zero or negative is above.
 */
export function underwaterLook(submersion: number): UnderwaterLook | null {
  if (!(submersion > 0)) return null;
  // Toward the deep look, exponentially — see EFOLD.
  const deep = 1 - Math.exp(-submersion / EFOLD);
  return {
    strength: Math.min(1, submersion / SURFACE_RAMP),
    r: mix(SHALLOW.r, DEEP.r, deep),
    g: mix(SHALLOW.g, DEEP.g, deep),
    b: mix(SHALLOW.b, DEEP.b, deep),
    sight: mix(SIGHT_SHALLOW, SIGHT_DEEP, deep),
    light: mix(1, LIGHT_DEEP, deep),
  };
}

/**
 * Blend a distance GEOMETRICALLY, which is the right way to interpolate
 * a scale.
 *
 * The air's fog closes at kilometres and the water's at tens of metres —
 * four orders of magnitude apart. A linear blend spends almost all of
 * its travel in distances that are still effectively "no fog" and then
 * arrives all at once, so the ramp it was given does nothing. A
 * geometric one moves by the same RATIO throughout, which is what the
 * eye reads as even.
 */
export function blendSight(air: number, water: number, strength: number): number {
  if (!(air > 0) || !(water > 0)) return water;
  const t = Math.min(1, Math.max(0, strength));
  return air * Math.pow(water / air, t);
}
