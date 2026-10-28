/**
 * THE INSTANT CUTS OF THE NEW TEE (Stage 3): which of the full-extent tee (`TeeParams.extend`) is worn for a set of
 * settings (`settings.ts`), as a field over its render vertices -- the cloth simulates and draws the triangles it keeps
 * (`garmentCloth.ts`), and the material draws the edge where it crosses 0 (`cutEdge.ts`).
 *
 * CONTRACT STUB (the contract commit): the types and signatures below are what the cloth and the room are written
 * against; the bodies are placeholders that keep every vertex and cut nothing, so the rest can be built and tested
 * before the real cut lines land.
 *
 * Plain TypeScript, metres in each piece's plane.
 */
import type { Draft } from './draft';
import { GARMENT_DEFAULTS, LENGTH_STOPS, SLEEVE_STOPS, type GarmentSettings, type GarmentStops } from './settings';
import type { BodyMeasure, SewnGarment } from './types';

/** What the cuts read: the tee as tailored (`tailor.ts` Tailored has all three). */
export interface CutSource {
  readonly sewn: SewnGarment;
  readonly draft: Draft;
  readonly measure: BodyMeasure;
}

/** The cut of the tee for one set of settings, per render vertex (`SewnGarment.vertexParticle` order). */
export interface GarmentCuts {
  /**
   * Signed metres in the vertex's piece plane from the nearest cut line that crosses its piece (perpendicular distance,
   * so a band of a given width is that wide everywhere): above 0 kept, below 0 cut away. A piece kept whole reads +1 at
   * every vertex, a piece cut away whole -1: at GARMENT_DEFAULTS that is every piece, so the default tee is exactly the
   * plain one with nothing below its hem or cuffs. A triangle is worn when any corner reads above 0.
   */
  readonly keep: Float32Array;
  /**
   * Signed metres from the NECKLINE's cut line, above 0 kept (under it), on the vertices of the piece it crosses (the
   * front); +Infinity on every vertex where no neckline cut runs -- every vertex while the neckline is the drafted one.
   */
  readonly neck: Float32Array;
}

/** The cut for `settings` (STUB: keeps every vertex). */
export function garmentCuts(t: CutSource, settings: GarmentSettings = GARMENT_DEFAULTS): GarmentCuts {
  void settings;
  const n = t.sewn.vertexParticle.length;
  return { keep: new Float32Array(n).fill(1), neck: new Float32Array(n).fill(Infinity) };
}

/** Her landmarks for the instant controls (STUB: the drafted hem and sleeve at every stop). */
export function garmentStops(t: CutSource): GarmentStops {
  return {
    lengthY: LENGTH_STOPS.map(() => t.draft.notes.hemY),
    sleeveLength: SLEEVE_STOPS.map(() => 0.215),
    hipY: t.measure.hip.y,
    kneeY: t.measure.kneeY,
    neckDeepest: 0.25,
  };
}
