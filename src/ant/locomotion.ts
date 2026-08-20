/**
 * LOCOMOTION — the one place that knows how a pace, a stick, a sprint
 * and an Auto lock combine into a velocity.
 *
 * It is deliberately pure. The UI asks for things and displays things;
 * it does not implement movement, and this file is what lets the whole
 * manual/auto/sprint rule set be tested without a browser.
 *
 * The frame is HER OWN BODY: forward is where she is facing, strafe is
 * her right. That is what makes sidestep mean sidestep — a six-legged
 * animal crabs sideways without turning, which a camera-relative stick
 * cannot express.
 */
import {
  PACE_SPEED, REVERSE_CAP, SPRINT_SPEED, STRAFE_SHARE, type Pace,
} from './pace';

export interface Demand {
  /** Stick vector, her own frame: x is her right, y is her forward. */
  stick: { x: number; y: number };
  pace: Pace;
  /** Whether a sprint is being called for AND is affordable. */
  sprinting: boolean;
  /** Whether Auto is carrying her — it supplies the forward push. */
  auto: boolean;
}

export interface Travel {
  /** Along her heading, world units per second. Negative is astern. */
  forward: number;
  /** Her right, world units per second. */
  strafe: number;
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
  let forward = (push < 0 ? push * back : push) * ceiling;
  let strafe = stick.x * STRAFE_SHARE * ceiling;

  // A diagonal must not outrun the ceiling by going two ways at once.
  const speed = Math.hypot(forward, strafe);
  if (speed > ceiling) {
    const trim = ceiling / speed;
    forward *= trim;
    strafe *= trim;
  }

  return { forward, strafe, speed: Math.min(speed, ceiling) };
}
