/**
 * ASKING WHERE THE WATER IS — and this file is deliberately NOT where
 * that question is defined.
 *
 * `router.ts`, beside this one, already owns `WaterSpot`, `WaterSource`
 * and the two-owner `WaterRouter`. It was written in Phase 3 against the
 * water audit's §13 and §15, and its central decision — that `kind` is
 * REQUIRED rather than an optional `salt?: boolean` — is the audit's F12
 * finding turned into a compile error. An optional flag is one a
 * consumer forgets, and forgetting it means treating the Pacific as a
 * pond.
 *
 * THIS FILE BRIEFLY DEFINED ITS OWN COPY OF ALL THREE, and that was a
 * mistake made while opening Phase 4: a second `WaterSpot` with the same
 * fields minus the discriminant, and a `firstSpot` helper that asked
 * several sources in turn — which is the router's entire job, done again
 * and worse. Two answers to one question is the exact failure both files
 * exist to prevent, and it went in during the same hour as a commit
 * message about one door. It is recorded here rather than quietly
 * deleted, because the useful part is not the deletion.
 *
 * So the types are RE-EXPORTED from their owner. Importing them from
 * here or from `router.ts` gets the same types, because they are the
 * same types. What remains below is the one thing that was genuinely
 * missing.
 */
export type { WaterKind, WaterSpot, WaterSource } from './router';
export { WaterRouter } from './router';

import type { WaterSpot } from './router';

/**
 * How far below a water surface a point is; zero when it is not under.
 *
 * Here because "am I under the water" is asked by the camera's fog, by a
 * later swimming pass and by anything that drowns, and three
 * implementations of one subtraction are three chances to get the sign
 * backwards — which reads as the world turning green while standing on a
 * beach.
 *
 * NULL IS NOT UNDER. A point where there is no water is not submerged by
 * zero; it is not submerged. The distinction matters because the caller
 * that gets 0 back cannot tell those apart, and `sea/underwaterLook.ts`
 * treats "not under" as its cue to put the air back rather than as a
 * water look of zero strength.
 */
export function submersion(spot: WaterSpot | null, height: number): number {
  return spot === null ? 0 : Math.max(0, spot.surface - height);
}
