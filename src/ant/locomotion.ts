/**
 * LOCOMOTION — the one place that knows how a pace, a stick, a sprint
 * and an Auto lock combine into a velocity.
 *
 * It is deliberately pure. The UI asks for things and displays things;
 * it does not implement movement, and this file is what lets the whole
 * manual/auto/sprint rule set be tested without a browser.
 *
 * The frame is THE CAMERA'S: `ahead` is away from the view and `across`
 * is to its right. She turns to face the camera while she is driven, so
 * her body ends up aligned with `ahead` anyway — which is what lets
 * `across` still read as a proper sidestep on screen while the stick
 * stays camera-relative and never fights the view.
 */
import {
  PACE_SPEED, REVERSE_CAP, SPRINT_SPEED, STRAFE_SHARE, type Pace,
} from './pace';

export interface Demand {
  /** Stick vector, camera frame: x is the view's right, y is away. */
  stick: { x: number; y: number };
  pace: Pace;
  /** Whether a sprint is being called for AND is affordable. */
  sprinting: boolean;
  /** Whether Auto is carrying her — it supplies the forward push. */
  auto: boolean;
}

export interface Travel {
  /** Away from the camera, world units per second. Negative backs up. */
  ahead: number;
  /** The camera's right, world units per second. */
  across: number;
  /** Ground speed, whatever the direction. */
  speed: number;
}

/**
 * Resolve what the controls are asking into a velocity in her frame.
 *
 * The pace sets the ceiling and the stick picks a fraction of it, so
 * the entire radius is useful at every pace. Sprint raises the ceiling
 * rather than adding a gear.
 */
export function resolve({ stick, pace, sprinting, auto }: Demand): Travel {
  // Auto drives forward; the stick is then only steering and cancelling.
  const push = auto ? 1 : stick.y;

  // Sprint is a forward effort. There is no reverse sprint.
  const ceiling = sprinting && push > 0 ? SPRINT_SPEED : PACE_SPEED[pace];

  // Astern is capped at a reverse walk however fast the pace allows.
  const back = Math.min(1, REVERSE_CAP / ceiling);
  let ahead = (push < 0 ? push * back : push) * ceiling;
  let across = stick.x * STRAFE_SHARE * ceiling;

  // A diagonal must not outrun the ceiling by going two ways at once.
  const speed = Math.hypot(ahead, across);
  if (speed > ceiling) {
    const trim = ceiling / speed;
    ahead *= trim;
    across *= trim;
  }

  return { ahead, across, speed: Math.min(speed, ceiling) };
}
