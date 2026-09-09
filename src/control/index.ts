/**
 * PLAYER CONTROL — the thumbs' half of the Creature Lab's sentence, the
 * camera that follows whoever the player holds, and the tap that
 * chooses them.
 *
 * Three files, one seam each, and none of them knows which animal it
 * is driving:
 *
 *   PlayerDemand.ts  one frame of input → an Intent in the creature's
 *                    heading frame (pure; the species interprets the
 *                    toggles in `creatures/demand.ts`)
 *   FollowCamera.ts  behind and above the held creature, in ITS body
 *                    lengths; orbits on a world bearing; hands off
 *                    without a cut
 *   pick.ts          which drawn centre a tap means, with a thumb's
 *                    reach so an aphid is tappable
 *
 * Renderer-side (three is allowed); reads `creatures/` as types and pure
 * helpers, `input/` as types plus the Intent shape, and the yaw/heading
 * conversion from `perf/FreeFlyCamera.ts`. Who is possessed is the
 * session's ledger (`creatures/control.ts`), never anything here.
 */
export {
  BACK_LENGTHS, UP_LENGTHS, AHEAD_LENGTHS, ORBIT_LENGTHS, REST_ELEVATION, ELEVATION_MIN, ELEVATION_MAX,
  MIN_NEAR, MAX_NEAR, DEPTH_RATIO, NEAR_OF_ORBIT, MIN_ORBIT, LOOK_RADIANS_PER_PIXEL,
  EASE_TAU_S, LOOK_HOLD_S, DRIFT_TAU_S, HANDOFF_S, NO_LOOK,
  FollowCamera, lookDeltaOf,
  type FollowTarget, type LookDelta, type MutableLook,
} from './FollowCamera';
export { KEYS, NO_BUTTONS, STEER_SATURATION, demandFrom, verticalFor, type LabButtons } from './PlayerDemand';
export { TAP_PIXELS, pickCreature, type Ndc, type Viewport } from './pick';
