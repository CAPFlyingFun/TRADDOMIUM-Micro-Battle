/**
 * How big a capsule is on screen, and how its parts contrast.
 *
 * GAME TUNING (debug), the visual half of `actor/CapsuleTuning`: one
 * world unit is a centimetre, and an ant will be about one unit long,
 * but the capsule is the debug actor that has to be SEEN from the
 * Performance World's camera 25 units up and 80 back, so it stands
 * sixteen units tall and walks four body lengths a second. When the
 * player shell arrives (Phase 7) the ant's size comes from the caste
 * registry, not from here.
 *
 * A value object passed in, like the tuning, so a lab can shrink or
 * grow every capsule at once and a test can pin the numbers.
 */
export interface CapsuleLook {
  /** Radius of the body and its hemispherical ends, world units. */
  readonly radius: number;
  /** The straight part between the ends, world units. Total height is `length + 2 × radius`. */
  readonly length: number;
  /** The nose cone that shows which way she faces, world units long. */
  readonly markerLength: number;
  /** The name label's footprint in world units, and its gap above the capsule's top. */
  readonly labelWidth: number;
  readonly labelHeight: number;
  readonly labelGap: number;
}

export const DEBUG_CAPSULE_LOOK: CapsuleLook = Object.freeze({
  radius: 4,
  length: 8,
  markerLength: 5,
  labelWidth: 40,
  labelHeight: 7.5,
  labelGap: 3,
});

/** The panel text everywhere in the v1 HUD; the marker borrows it for dark capsules. */
export const PARCHMENT = '#f4f1de';
/** Near-black with a little blue, for a marker on a light capsule. */
export const INK = '#101418';

/** Relative luminance of `#rrggbb` per WCAG 2 (sRGB linearised), 0 black .. 1 white. */
export function luminanceOf(hex: string): number {
  const channel = (at: number): number => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Above this the capsule is light enough that an ink marker reads better than a parchment one. */
const LIGHT_ABOVE = 0.4;

/** The marker's colour for a capsule of `color`: whichever of ink and parchment contrasts. */
export function markerColorFor(color: string): string {
  return luminanceOf(color) > LIGHT_ABOVE ? INK : PARCHMENT;
}
