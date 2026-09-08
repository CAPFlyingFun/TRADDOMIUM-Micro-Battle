/**
 * WHAT BEING INSIDE THE SOIL LOOKS LIKE — the fog, and nothing else.
 *
 * Joshua, 2026-09-08, from shots/cutaway-below-floor.png and
 * shots/cutaway-deep-looking-up.png, the eye a few centimetres under the
 * cut floor: two thirds of the frame is the pale horizon colour and the
 * rest is the unlit black underside of the terrain sheet. His words: the
 * white "is empty space, which it shouldn't be… between ground and
 * infinity. Don't change the default white to brown as it will change
 * everything else, so maybe add an underground fog that fades brown or
 * depending on soil like gray for Rocky."
 *
 * So the horizon stays the horizon and the sky over the pit stays exactly
 * as it is: this look applies only while the eye is IN SOLID SOIL, and it
 * is keyed on that rather than on being below ground level, because the
 * cut's air is below ground level and is the one place the whole section
 * exists to let the player stand. The scene decides what "solid" means
 * at the eye — under the cut floor when the section is open, under the
 * ground when it is shut — and hands the depth here as `burial`.
 *
 * THE COLOUR IS THE SOIL'S OWN. `soilAlbedoAt` mirrors the depth ramp
 * `terrain/soilMesh.ts` paints its cut faces with — the same three
 * channels, the same four-centimetre shade — so the fog closes to the
 * colour of the wall it is closing over rather than to a brown picked
 * beside it. It is a copy because soilMesh.ts exports no lookup, and it
 * is a separate PARAMETER of `undergroundLook` rather than something the
 * look reads for itself so that a rocky soil can hand in its grey
 * without this file learning what a habitat is: the fog is a colour and
 * two distances, and whose colour is the caller's business.
 *
 * LINEAR, LIKE THE MESH. The soil's vertex colours are linear albedo
 * (`soilMesh.ts`: "Linear albedo, never emissive"), so these numbers are
 * linear too and the scene writes them with `Color.setRGB` in three's
 * working space — NOT with the sRGB flag `sea/underwaterLook.ts` needs,
 * whose colours were picked by eye. A fogged pixel is then exactly an
 * unlit face of the same soil, which is what the inside of the ground is.
 *
 * Built the way the sea's look is built (`sea/underwaterLook.ts`): pure,
 * no three, no DOM, a null above the medium as the caller's cue to put
 * the air back, and linear fog because swapping to exponential recompiles
 * every material in the scene.
 */

/** A linear-space colour, each channel 0..1: what the soil reflects. */
export interface SoilAlbedo {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * The soil's albedo at the surface and how quickly it darkens with depth:
 * `terrain/soilMesh.ts`'s cut-face ramp, restated. Shade runs 0 at the
 * ground to 1 at `SHADE_DEPTH` and holds there. Change soilMesh.ts and
 * change this together, or the fog and the wall will be two browns.
 */
const SURFACE: SoilAlbedo = Object.freeze({ r: 0.32, g: 0.17, b: 0.078 });
const DARKENING: SoilAlbedo = Object.freeze({ r: 0.225, g: 0.127, b: 0.06 });
/** World units (cm) below the ground at which the cut face reaches its darkest. */
export const SHADE_DEPTH = 4;

/**
 * THE SOIL'S OWN COLOUR at a depth below the surveyed ground, world units.
 * Above the ground it is the surface colour; four centimetres down and
 * deeper it is the dark one; between, the mesh's own linear ramp. NaN
 * reads as the surface, so a failed height cannot black the fog out.
 */
export function soilAlbedoAt(depthBelowGround: number): SoilAlbedo {
  const shade = depthBelowGround > 0 ? Math.min(1, depthBelowGround / SHADE_DEPTH) : 0;
  return {
    r: SURFACE.r - DARKENING.r * shade,
    g: SURFACE.g - DARKENING.g * shade,
    b: SURFACE.b - DARKENING.b * shade,
  };
}

/**
 * HOW FAR THE EYE SEES THROUGH SOIL, in world units (cm).
 *
 * You are in dirt: there is nothing to see through it at all, and the
 * only reason the far plane is not zero is that a fog closing at the eye
 * itself draws every face flat, with no shading left to say which way
 * the wall stands. A few centimetres leaves the nearest faces readable
 * as faces. `FAR_SHALLOW` is what an eye a hair under the floor gets —
 * the case the camera clamp leaves at a rounding error, and the one the
 * player sees most — and `FAR_DEEP` is what a camera buried under a
 * slope with no section open gets, tighter because there is more soil
 * in every direction. The ramp between them is an e-fold on burial so
 * that a millimetre under the floor does not slam to the deep look.
 *
 * GAME TUNING, all three: soil has no optics worth citing at this scale.
 */
export const FAR_SHALLOW = 6;
export const FAR_DEEP = 2;
export const BURIAL_EFOLD = 3;

export interface UndergroundLook {
  /** Fog and background colour, linear, each channel 0..1. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Where the fog starts, world units from the eye. Zero: the soil begins at the eye. */
  readonly near: number;
  /** Where nothing is left, world units from the eye. */
  readonly far: number;
}

/**
 * The look at a given burial — how far the eye is INSIDE solid soil, in
 * world units — closing to the given albedo.
 *
 * Null at or above the soil (zero, negative or NaN), which is the
 * caller's cue to put the air back rather than a value to blend towards.
 */
export function undergroundLook(burial: number, albedo: SoilAlbedo): UndergroundLook | null {
  if (!(burial > 0)) return null;
  const deep = 1 - Math.exp(-burial / BURIAL_EFOLD);
  return {
    r: albedo.r,
    g: albedo.g,
    b: albedo.b,
    near: 0,
    far: FAR_SHALLOW + (FAR_DEEP - FAR_SHALLOW) * deep,
  };
}
