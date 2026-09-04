/**
 * The pure step: intent in, a new ActorState out, on a flat plane.
 *
 * This is the whole of movement until terrain exists — no ground
 * height, no slope, no surfaces — and it stays the kernel afterwards:
 * later phases add locomotion around it (pace as a ceiling, stamina,
 * gait), they do not reach into it. It owns nothing: it returns a fresh
 * state and never writes the one it was given, so the authority can
 * step a claim without committing to it (net/protocol: a move is a
 * claim the authority may refuse).
 *
 * `dt` is SIM dt — already clamped by the frame clock (ARCHITECTURE
 * §2.4). This function does not clamp again; a second clamp here would
 * be the place a raw wall-clock delta could quietly be fed in.
 */
import { clampIntent, type Intent } from '../input/Intent';
import { translate } from '../world/coords';
import type { ActorState } from './ActorState';
import type { CapsuleTuning } from './CapsuleTuning';

const TAU = Math.PI * 2;

/** Into (−π, π], so a heading is one number per direction and a snapshot can be range-checked. */
export function wrapHeading(heading: number): number {
  let h = heading % TAU;
  if (h > Math.PI) h -= TAU;
  else if (h <= -Math.PI) h += TAU;
  return h;
}

export function step(state: ActorState, intent: Intent, dt: number, tuning: CapsuleTuning): ActorState {
  const want = clampIntent(intent);
  const heading = wrapHeading(state.heading + want.turn * tuning.turnRate * dt);

  // The request is a direction on the unit disc, not the unit square:
  // full-ahead-and-full-strafe is still one pace, not 1.41 of them.
  let forward = want.forward;
  let strafe = want.strafe;
  const magnitude = Math.hypot(forward, strafe);
  if (magnitude > 1) {
    forward /= magnitude;
    strafe /= magnitude;
  }

  const speed = tuning.walkSpeed * (want.sprint ? tuning.sprintFactor : 1) * dt;
  // v0's convention: ahead is (sin h, cos h); right is a quarter turn clockwise from it.
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const dx = (forward * sin + strafe * cos) * speed;
  const dz = (forward * cos - strafe * sin) * speed;

  return { ...state, at: translate(state.at, dx, dz), heading };
}
