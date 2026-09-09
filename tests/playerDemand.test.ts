/**
 * The thumbs' half of the Creature Lab's sentence, as a pure mapping
 * under node: a camera-relative push lands on the creature's own axes
 * for every medium, steering is looking with the right sign, and
 * nothing pressed is exactly NEUTRAL.
 */
import { describe, expect, it } from 'vitest';
import { KEYS, NO_BUTTONS, STEER_SATURATION, demandFrom, verticalFor, type LabButtons } from '../src/control/PlayerDemand';
import { newMutableIntent } from '../src/creatures/demand';
import type { Medium } from '../src/creatures/species';
import type { InputSnapshot, PointerState } from '../src/input/Input';
import { NEUTRAL_INTENT, clampIntent } from '../src/input/Intent';
import type { StickReading } from '../src/input/MoveStick';
import { yawForHeading } from '../src/perf/FreeFlyCamera';

const IDLE_POINTER: PointerState = { down: false, buttons: 0, x: 0, y: 0, dx: 0, dy: 0 };

function snap(keys: readonly string[] = []): InputSnapshot {
  return { keys: new Set(keys), pointer: IDLE_POINTER, touches: [], wheel: 0 };
}

/** A stick reading as `MoveStick.read()` shapes one. */
function push(x: number, y: number): StickReading {
  return { x, y, deflection: Math.min(1, Math.hypot(x, y)), held: true };
}

function buttons(parts: Partial<LabButtons>): LabButtons {
  return { ...NO_BUTTONS, ...parts };
}

const MEDIA: readonly Medium[] = ['ground', 'soil', 'air', 'plant'];

/**
 * The expected axes by a different route: the push as a WORLD vector
 * (along and across the camera's heading), dotted onto the creature's
 * ahead and right. `ahead(h) = (sin h, cos h)`, `right(h) = (cos h, −sin h)`.
 */
function expected(x: number, y: number, view: number, heading: number): { forward: number; strafe: number } {
  const wx = y * Math.sin(view) + x * Math.cos(view);
  const wz = y * Math.cos(view) - x * Math.sin(view);
  return {
    forward: wx * Math.sin(heading) + wz * Math.cos(heading),
    strafe: wx * Math.cos(heading) - wz * Math.sin(heading),
  };
}

describe('demandFrom: nothing pressed', () => {
  it('is exactly NEUTRAL, even with the camera looking somewhere else', () => {
    for (const medium of MEDIA) {
      const out = demandFrom(snap(), null, yawForHeading(2.5), 0, medium, NO_BUTTONS, true);
      expect(out).toEqual(NEUTRAL_INTENT);
    }
  });

  it('a centred stick reads as nothing pressed', () => {
    const out = demandFrom(snap(), { x: 0, y: 0, deflection: 0, held: false }, yawForHeading(1), 0, 'ground', NO_BUTTONS);
    expect(out).toEqual(NEUTRAL_INTENT);
  });
});

describe('demandFrom: the stick is camera-relative and lands on the creature\'s axes', () => {
  const pushes = [
    { name: 'up', x: 0, y: 1 },
    { name: 'down', x: 0, y: -1 },
    { name: 'left', x: -1, y: 0 },
    { name: 'right', x: 1, y: 0 },
    { name: 'up-right, half', x: 0.5, y: 0.5 },
  ];
  const views = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7];
  const headings = [0, 1.1, -2.3];

  for (const medium of MEDIA) {
    for (const p of pushes) {
      for (const view of views) {
        for (const heading of headings) {
          it(`${medium}: ${p.name} with the camera along ${view.toFixed(2)} and the creature at ${heading}`, () => {
            const out = demandFrom(snap(), push(p.x, p.y), yawForHeading(view), heading, medium, NO_BUTTONS);
            const want = expected(p.x, p.y, view, heading);
            expect(out.forward).toBeCloseTo(want.forward, 9);
            expect(out.strafe).toBeCloseTo(want.strafe, 9);
            // The push's size is kept: pace as a ceiling, not a square.
            expect(Math.hypot(out.forward, out.strafe)).toBeCloseTo(Math.hypot(p.x, p.y), 9);
          });
        }
      }
    }
  }

  it('a push up with the camera looking across the creature\'s side is a strafe', () => {
    // Creature ahead is +z (heading 0); the camera looks along +x (heading π/2) — the creature's right.
    const out = demandFrom(snap(), push(0, 1), yawForHeading(Math.PI / 2), 0, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(0, 9);
    expect(out.strafe).toBeCloseTo(1, 9);
  });

  it('a push up with the camera facing the creature walks it backward', () => {
    const out = demandFrom(snap(), push(0, 1), yawForHeading(Math.PI), 0, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(-1, 9);
    expect(Math.abs(out.strafe)).toBeLessThan(1e-9);
  });
});

describe('demandFrom: steering is looking', () => {
  it('turns toward where the player looks, positive when the view heading is ahead of the body\'s', () => {
    const out = demandFrom(snap(), push(0, 1), yawForHeading(0.5), 0, 'ground', NO_BUTTONS);
    expect(out.turn).toBeGreaterThan(0);
    expect(out.turn).toBeCloseTo(0.5 / STEER_SATURATION, 9);
  });

  it('and negative the other way', () => {
    const out = demandFrom(snap(), push(0, 1), yawForHeading(-0.5), 0, 'ground', NO_BUTTONS);
    expect(out.turn).toBeCloseTo(-0.5 / STEER_SATURATION, 9);
  });

  it('takes the short way round', () => {
    // View at 3.0 from a body at −3.0: the short way is −0.283 through ±π, not +6.
    const out = demandFrom(snap(), push(0, 1), yawForHeading(3.0), -3.0, 'ground', NO_BUTTONS);
    expect(out.turn).toBeCloseTo(-(2 * Math.PI - 6.0) / STEER_SATURATION, 9);
  });

  it('saturates at a quarter turn of error', () => {
    expect(demandFrom(snap(), push(0, 1), yawForHeading(STEER_SATURATION), 0, 'ground', NO_BUTTONS).turn).toBeCloseTo(1, 9);
    expect(demandFrom(snap(), push(0, 1), yawForHeading(3), 0, 'air', NO_BUTTONS).turn).toBe(1);
    expect(demandFrom(snap(), push(0, 1), yawForHeading(-3), 0, 'soil', NO_BUTTONS).turn).toBe(-1);
  });

  it('is zero at rest: the body is left alone while the player only looks', () => {
    const out = demandFrom(snap(), null, yawForHeading(3), 0, 'ground', NO_BUTTONS);
    expect(out.turn).toBe(0);
  });

  it('turns while driven by keys, not only by the stick', () => {
    const out = demandFrom(snap(['KeyW']), null, yawForHeading(1), 0, 'ground', NO_BUTTONS);
    expect(out.turn).toBeCloseTo(1 / STEER_SATURATION, 9);
  });

  it('a yaw that is not a number is no difference: the push is taken in the creature\'s frame and nothing turns', () => {
    const out = demandFrom(snap(), push(0, 1), NaN, 1.2, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(1, 9);
    expect(out.strafe).toBeCloseTo(0, 9);
    expect(out.turn).toBe(0);
  });
});

describe('demandFrom: the desktop keys', () => {
  it('W is ahead, S back, A left, D right, camera-relative', () => {
    const yaw = yawForHeading(0);
    expect(demandFrom(snap(['KeyW']), null, yaw, 0, 'ground', NO_BUTTONS).forward).toBe(1);
    expect(demandFrom(snap(['KeyS']), null, yaw, 0, 'ground', NO_BUTTONS).forward).toBe(-1);
    expect(demandFrom(snap(['KeyA']), null, yaw, 0, 'ground', NO_BUTTONS).strafe).toBe(-1);
    expect(demandFrom(snap(['KeyD']), null, yaw, 0, 'ground', NO_BUTTONS).strafe).toBe(1);
    expect(demandFrom(snap(['ArrowUp']), null, yaw, 0, 'ground', NO_BUTTONS).forward).toBe(1);
    // Camera along the creature's right: W is a strafe.
    const across = demandFrom(snap(['KeyW']), null, yawForHeading(Math.PI / 2), 0, 'ground', NO_BUTTONS);
    expect(across.strafe).toBeCloseTo(1, 9);
    expect(across.forward).toBeCloseTo(0, 9);
  });

  it('two keys diagonally are one pace, not 1.41 of them', () => {
    const out = demandFrom(snap(['KeyW', 'KeyD']), null, yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(Math.SQRT1_2, 9);
    expect(out.strafe).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('keys and the stick add as vectors under the ceiling', () => {
    const with2 = demandFrom(snap(['KeyW']), push(0, 1), yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(with2.forward).toBe(1);
    const cancel = demandFrom(snap(['KeyS']), push(0, 1), yawForHeading(2), 0, 'ground', NO_BUTTONS);
    expect(cancel.forward).toBe(0);
    expect(cancel.turn).toBe(0);
  });

  it('a stick past its rim is one pace', () => {
    const out = demandFrom(snap(), push(0, 2), yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(out.forward).toBe(1);
  });

  it('a stick that is not a number is no push', () => {
    const out = demandFrom(snap(), { x: NaN, y: NaN, deflection: NaN, held: true }, yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(out).toEqual(NEUTRAL_INTENT);
  });
});

describe('demandFrom: the vertical by medium', () => {
  it('ground ignores it', () => {
    expect(demandFrom(snap(), null, 0, 0, 'ground', buttons({ up: true })).vertical).toBe(0);
    expect(demandFrom(snap(['KeyE']), null, 0, 0, 'ground', NO_BUTTONS).vertical).toBe(0);
  });

  it('unless the species has wings: then UP on the ground is a takeoff request the demand carries', () => {
    expect(demandFrom(snap(), null, 0, 0, 'ground', buttons({ up: true }), true).vertical).toBe(1);
    expect(demandFrom(snap(['Space']), null, 0, 0, 'ground', NO_BUTTONS, true).vertical).toBe(1);
    expect(demandFrom(snap(), null, 0, 0, 'ground', buttons({ down: true }), true).vertical).toBe(-1);
  });

  it('soil: DOWN burrows, UP surfaces', () => {
    expect(demandFrom(snap(), null, 0, 0, 'soil', buttons({ down: true })).vertical).toBe(-1);
    expect(demandFrom(snap(), null, 0, 0, 'soil', buttons({ up: true })).vertical).toBe(1);
    expect(demandFrom(snap(['KeyQ']), null, 0, 0, 'soil', NO_BUTTONS).vertical).toBe(-1);
    expect(demandFrom(snap(['KeyC']), null, 0, 0, 'soil', NO_BUTTONS).vertical).toBe(-1);
  });

  it('air: DOWN descends, UP climbs', () => {
    expect(demandFrom(snap(), null, 0, 0, 'air', buttons({ down: true })).vertical).toBe(-1);
    expect(demandFrom(snap(['KeyE']), null, 0, 0, 'air', NO_BUTTONS).vertical).toBe(1);
  });

  it('plant ignores it; DROP / EVADE is the secondary, carried through', () => {
    const out = demandFrom(snap(), null, 0, 0, 'plant', buttons({ down: true, secondary: true }));
    expect(out.vertical).toBe(0);
    expect(out.secondary).toBe(true);
  });

  it('both UP and DOWN held is neither', () => {
    expect(demandFrom(snap(), null, 0, 0, 'air', buttons({ up: true, down: true })).vertical).toBe(0);
  });

  it('verticalFor is the same rule the UI may ask', () => {
    expect(verticalFor('ground', false, 1)).toBe(0);
    expect(verticalFor('ground', true, 1)).toBe(1);
    expect(verticalFor('soil', false, -1)).toBe(-1);
    expect(verticalFor('air', false, 1)).toBe(1);
    expect(verticalFor('plant', true, 1)).toBe(0);
  });
});

describe('demandFrom: the toggles', () => {
  it('sprint from Shift or the button; Shift is never a descent', () => {
    expect(demandFrom(snap(['ShiftLeft']), null, 0, 0, 'air', NO_BUTTONS).sprint).toBe(true);
    expect(demandFrom(snap(['ShiftRight']), null, 0, 0, 'air', NO_BUTTONS).vertical).toBe(0);
    expect(demandFrom(snap(), null, 0, 0, 'air', buttons({ sprint: true })).sprint).toBe(true);
    expect(demandFrom(snap(), null, 0, 0, 'air', NO_BUTTONS).sprint).toBe(false);
  });

  it('primary and secondary from the buttons or F and R', () => {
    expect(demandFrom(snap(), null, 0, 0, 'ground', buttons({ primary: true })).primary).toBe(true);
    expect(demandFrom(snap(['KeyF']), null, 0, 0, 'ground', NO_BUTTONS).primary).toBe(true);
    expect(demandFrom(snap(), null, 0, 0, 'ground', buttons({ secondary: true })).secondary).toBe(true);
    expect(demandFrom(snap(['KeyR']), null, 0, 0, 'ground', NO_BUTTONS).secondary).toBe(true);
    expect(KEYS.primary).toEqual(['KeyF']);
    expect(KEYS.secondary).toEqual(['KeyR']);
  });
});

describe('demandFrom: the contract and the allocation', () => {
  it('writes into the intent the caller keeps and returns it', () => {
    const out = newMutableIntent();
    const got = demandFrom(snap(['KeyW', 'ShiftLeft']), push(0.3, 0), yawForHeading(0.2), 0, 'air', buttons({ up: true }), false, out);
    expect(got).toBe(out);
    expect(out.forward).toBeGreaterThan(0);
    expect(out.sprint).toBe(true);
    expect(out.vertical).toBe(1);
  });

  it('is already inside the Intent contract: clampIntent changes nothing', () => {
    const cases = [
      demandFrom(snap(['KeyW', 'KeyD']), push(1, 1), yawForHeading(3), -1, 'air', buttons({ up: true, sprint: true, primary: true, secondary: true })),
      demandFrom(snap(), push(0, 2), yawForHeading(-3), 2, 'soil', buttons({ down: true })),
      demandFrom(snap(), null, 0, 0, 'plant', NO_BUTTONS),
    ];
    for (const intent of cases) expect(clampIntent(intent)).toEqual(intent);
  });

  it('a fresh call with no out allocates one and does not share it', () => {
    const a = demandFrom(snap(['KeyW']), null, yawForHeading(0), 0, 'ground', NO_BUTTONS);
    const b = demandFrom(snap(), null, yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(a).not.toBe(b);
    expect(a.forward).toBe(1);
    expect(b.forward).toBe(0);
  });
});
