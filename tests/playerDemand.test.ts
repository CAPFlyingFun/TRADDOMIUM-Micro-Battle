/**
 * The thumbs' half of the Creature Lab's sentence, as a pure mapping
 * under node: a camera-relative push lands on the creature's own axes
 * for every medium, steering is looking with the right sign, and
 * nothing pressed is exactly NEUTRAL. Then the same sentence on a
 * surface (`demandFromLook`, Creature Lab D): the flat case is
 * `demandFrom` to 1e-12 over the whole grid, and on a wall the stick
 * means what the player sees.
 */
import { describe, expect, it } from 'vitest';
import { KEYS, NO_BUTTONS, STEER_SATURATION, demandFrom, demandFromLook, verticalFor, type LabButtons } from '../src/control/PlayerDemand';
import { newMutableIntent } from '../src/creatures/demand';
import { wrapHeading } from '../src/creatures/heading';
import type { Medium } from '../src/creatures/species';
import { FACE_NORMALS, WORLD_UP, aheadOn, headingOn, rightOn, vec3, type MutableVec3, type Vec3 } from '../src/creatures/surface';
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
 * ahead and right. `ahead(h) = (sin h, cos h)`, and right is ahead × up
 * with +y up: `right(h) = (−cos h, sin h)` — the body's own right hand,
 * the free-fly camera's right, and NOT local +X, which the rigs measure
 * as the left side.
 */
function expected(x: number, y: number, view: number, heading: number): { forward: number; strafe: number } {
  const wx = y * Math.sin(view) - x * Math.cos(view);
  const wz = y * Math.cos(view) + x * Math.sin(view);
  return {
    forward: wx * Math.sin(heading) + wz * Math.cos(heading),
    strafe: -wx * Math.cos(heading) + wz * Math.sin(heading),
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
    // Creature ahead is +z (heading 0), so its right hand is at −x. The
    // camera looking along +x (heading π/2) looks across its LEFT: a
    // push away from that camera is a step to the left, strafe −1.
    const left = demandFrom(snap(), push(0, 1), yawForHeading(Math.PI / 2), 0, 'ground', NO_BUTTONS);
    expect(left.forward).toBeCloseTo(0, 9);
    expect(left.strafe).toBeCloseTo(-1, 9);
    // And from the camera on its right (−x), a push away is a step to the right.
    const right = demandFrom(snap(), push(0, 1), yawForHeading(-Math.PI / 2), 0, 'ground', NO_BUTTONS);
    expect(right.forward).toBeCloseTo(0, 9);
    expect(right.strafe).toBeCloseTo(1, 9);
  });

  it('with the camera behind the creature, a push right is a step to the creature\'s right (Joshua, 2026-09-09: "left and right ... are backwards")', () => {
    // Heading 0: ahead +z, right −x. The camera behind it looks along +z too.
    const out = demandFrom(snap(), push(1, 0), yawForHeading(0), 0, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(0, 9);
    expect(out.strafe).toBeCloseTo(1, 9);
    // The world step that strafe makes is −x: the same side the camera's own D key walks to.
    const wx = Math.sin(0) * out.forward - Math.cos(0) * out.strafe;
    expect(wx).toBeCloseTo(-1, 9);
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
    // Camera along the creature's right (−x for a body facing +z): W is a strafe to the right.
    const across = demandFrom(snap(['KeyW']), null, yawForHeading(-Math.PI / 2), 0, 'ground', NO_BUTTONS);
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

// ---------------------------------------------------------------------------
// The stick on a surface (Creature Lab D)
// ---------------------------------------------------------------------------

const X: Vec3 = FACE_NORMALS[0];
const NY: Vec3 = FACE_NORMALS[3];

function v(): MutableVec3 {
  return { x: 0, y: 0, z: 0 };
}

/** A unit look direction. */
function look(x: number, y: number, z: number): Vec3 {
  const len = Math.hypot(x, y, z);
  return vec3(x / len, y / len, z / len);
}

/** The heading that points along `dir` on a face: the body's heading for a body facing that way. */
function headingAlong(up: Vec3, dir: Vec3): number {
  return headingOn(up, dir);
}

describe('demandFromLook: the flat case is demandFrom to 1e-12', () => {
  const pushes = [
    { name: 'up', x: 0, y: 1 },
    { name: 'down', x: 0, y: -1 },
    { name: 'left', x: -1, y: 0 },
    { name: 'right', x: 1, y: 0 },
    { name: 'up-right, half', x: 0.5, y: 0.5 },
    { name: 'nothing', x: 0, y: 0 },
  ];
  const views = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.6];
  const headings = [0, 1.1, -2.3, 3.0];

  for (const medium of MEDIA) {
    for (const p of pushes) {
      for (const view of views) {
        for (const heading of headings) {
          it(`${medium}: ${p.name} with the look along ${view.toFixed(2)} and the creature at ${heading}`, () => {
            const flat = demandFrom(snap(), push(p.x, p.y), yawForHeading(view), heading, medium, NO_BUTTONS, true);
            const onFace = demandFromLook(snap(), push(p.x, p.y), look(Math.sin(view), 0, Math.cos(view)), heading, WORLD_UP, medium, NO_BUTTONS, true);
            expect(Math.abs(onFace.forward - flat.forward)).toBeLessThan(1e-12);
            expect(Math.abs(onFace.strafe - flat.strafe)).toBeLessThan(1e-12);
            expect(Math.abs(onFace.turn - flat.turn)).toBeLessThan(1e-12);
            expect(onFace.vertical).toBe(flat.vertical);
            expect(onFace.sprint).toBe(flat.sprint);
            expect(onFace.primary).toBe(flat.primary);
            expect(onFace.secondary).toBe(flat.secondary);
          });
        }
      }
    }
  }

  it('agrees on the keys, the vertical and the toggles too', () => {
    const keys = ['KeyW', 'KeyD', 'ShiftLeft', 'KeyE', 'KeyF', 'KeyR'];
    for (const medium of MEDIA) {
      const flat = demandFrom(snap(keys), push(-0.3, 0.2), yawForHeading(1.9), -0.4, medium, buttons({ down: true }), true);
      const onFace = demandFromLook(snap(keys), push(-0.3, 0.2), look(Math.sin(1.9), 0, Math.cos(1.9)), -0.4, WORLD_UP, medium, buttons({ down: true }), true);
      expect(Math.abs(onFace.forward - flat.forward)).toBeLessThan(1e-12);
      expect(Math.abs(onFace.strafe - flat.strafe)).toBeLessThan(1e-12);
      expect(Math.abs(onFace.turn - flat.turn)).toBeLessThan(1e-12);
      expect(onFace.vertical).toBe(flat.vertical);
      expect(onFace.sprint).toBe(true);
      expect(onFace.primary).toBe(true);
      expect(onFace.secondary).toBe(true);
    }
  });

  it('a look with a pitch is read by its horizontal part on the ground: the follow camera looks down onto the animal', () => {
    const flat = demandFrom(snap(), push(0.4, 0.6), yawForHeading(0.7), 0.2, 'ground', NO_BUTTONS);
    const down = demandFromLook(snap(), push(0.4, 0.6), look(Math.sin(0.7), -0.9, Math.cos(0.7)), 0.2, WORLD_UP, 'ground', NO_BUTTONS);
    expect(down.forward).toBeCloseTo(flat.forward, 12);
    expect(down.strafe).toBeCloseTo(flat.strafe, 12);
    expect(down.turn).toBeCloseTo(flat.turn, 12);
  });
});

describe('demandFromLook: on a wall the stick means what the player sees', () => {
  // The east wall of a box: its outward normal is +x. A body facing UP
  // the wall has ahead +y; the camera stands out from the wall, looking
  // into it and up along it.
  const upTheWall = headingAlong(X, vec3(0, 1, 0));
  const lookUpTheWall = look(-0.5, 0.85, 0);

  it('with the look up the wall, a push up walks up the wall: forward 1, strafe 0, turn 0', () => {
    const out = demandFromLook(snap(), push(0, 1), lookUpTheWall, upTheWall, X, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(1, 12);
    expect(out.strafe).toBeCloseTo(0, 12);
    expect(out.turn).toBeCloseTo(0, 12);
  });

  it('a push right is a strafe to the body\'s right, which is the screen\'s right', () => {
    const out = demandFromLook(snap(), push(1, 0), lookUpTheWall, upTheWall, X, 'ground', NO_BUTTONS);
    expect(out.strafe).toBeCloseTo(1, 12);
    expect(out.forward).toBeCloseTo(0, 12);
    // The body's right on the +x face facing +y is ahead × up = (0,1,0) × (1,0,0) = −z:
    // the same side the camera's own right lands on, looking into the wall with world up.
    const cameraRight = new Float64Array(3);
    const d = lookUpTheWall;
    cameraRight[0] = d.y * 0 - d.z * 1;
    cameraRight[2] = d.x * 1 - d.y * 0;
    expect(Math.sign(cameraRight[2])).toBe(-1);
  });

  it('a push down walks back down the wall, and a push left is the other strafe', () => {
    const back = demandFromLook(snap(), push(0, -1), lookUpTheWall, upTheWall, X, 'ground', NO_BUTTONS);
    expect(back.forward).toBeCloseTo(-1, 12);
    expect(back.strafe).toBeCloseTo(0, 12);
    const left = demandFromLook(snap(), push(-1, 0), lookUpTheWall, upTheWall, X, 'ground', NO_BUTTONS);
    expect(left.strafe).toBeCloseTo(-1, 12);
  });

  it('with the look ALONG the wall, a push up walks along it, and the body turns onto the look — a left turn where the look is at a greater heading', () => {
    // Ahead +y, look +z: on the +x face a growing heading turns +y toward +z
    // (aheadOn(+x, h) = sin h·(−y) + cos h·(+z)), so this is a left turn, +1.
    const out = demandFromLook(snap(), push(0, 1), look(-0.3, 0, 1), upTheWall, X, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(0, 12);
    expect(out.strafe).toBeCloseTo(Math.sign(wrapHeading(headingAlong(X, vec3(0, 0, 1)) - upTheWall)) * -1, 12);
    expect(out.turn).toBeCloseTo(1, 12);
    // The same error read on the heading scale: a quarter turn saturates.
    const error = wrapHeading(headingAlong(X, vec3(0, 0, 1)) - upTheWall);
    expect(error).toBeCloseTo(Math.PI / 2, 12);
    // Half the error, half the turn.
    const half = look(-0.3, Math.SQRT1_2, Math.SQRT1_2);
    const eased = demandFromLook(snap(), push(0, 1), half, upTheWall, X, 'ground', NO_BUTTONS);
    expect(eased.turn).toBeCloseTo(0.5, 9);
  });

  it('a look straight along the normal has no projection: no turn, and the push in the body\'s frame', () => {
    for (const normal of [vec3(1, 0, 0), vec3(-1, 0, 0)]) {
      const out = demandFromLook(snap(), push(0.6, 0.8), normal, upTheWall, X, 'ground', NO_BUTTONS);
      expect(out.forward).toBeCloseTo(0.8, 12);
      expect(out.strafe).toBeCloseTo(0.6, 12);
      expect(out.turn).toBe(0);
    }
  });

  it('a look that is not a number is the same no-projection: what demandFrom makes of a NaN yaw', () => {
    const out = demandFromLook(snap(), push(0, 1), vec3(NaN, NaN, NaN), 1.2, WORLD_UP, 'ground', NO_BUTTONS);
    const flat = demandFrom(snap(), push(0, 1), NaN, 1.2, 'ground', NO_BUTTONS);
    expect(out.forward).toBeCloseTo(flat.forward, 12);
    expect(out.strafe).toBeCloseTo(flat.strafe, 12);
    expect(out.turn).toBe(0);
    expect(flat.turn).toBe(0);
  });

  it('a body with no frame moves nothing: a NaN up is a push that goes nowhere, a NaN heading the push in the look\'s frame', () => {
    const noUp = demandFromLook(snap(), push(0, 1), lookUpTheWall, upTheWall, vec3(NaN, 0, 0), 'ground', NO_BUTTONS);
    expect(noUp.forward).toBe(0);
    expect(noUp.strafe).toBe(0);
    expect(noUp.turn).toBe(0);
    const noHeading = demandFromLook(snap(), push(0.6, 0.8), look(Math.sin(2), 0, Math.cos(2)), NaN, WORLD_UP, 'ground', NO_BUTTONS);
    const flat = demandFrom(snap(), push(0.6, 0.8), yawForHeading(2), NaN, 'ground', NO_BUTTONS);
    expect(noHeading.forward).toBeCloseTo(flat.forward, 12);
    expect(noHeading.strafe).toBeCloseTo(flat.strafe, 12);
    expect(noHeading.turn).toBe(0);
  });
});

describe('demandFromLook: on the ceiling and on every face', () => {
  it('nothing pressed is exactly NEUTRAL on every face, whatever the look', () => {
    for (const up of FACE_NORMALS) {
      for (const medium of MEDIA) {
        const out = demandFromLook(snap(), null, look(0.3, -0.5, 0.8), 2.5, up, medium, NO_BUTTONS, true);
        expect(out).toEqual(NEUTRAL_INTENT);
        const centred = demandFromLook(snap(), { x: 0, y: 0, deflection: 0, held: false }, look(1, 0, 0), 0, up, medium, NO_BUTTONS);
        expect(centred).toEqual(NEUTRAL_INTENT);
      }
    }
  });

  it('on the ceiling a push up with the look along the body\'s ahead walks ahead; the push keeps its size on every face', () => {
    for (const up of FACE_NORMALS) {
      for (const h of [0, 0.9, -2.1]) {
        const ahead = aheadOn(up, h, v());
        // The camera is out from the face and a little behind, looking at the body along its ahead.
        const l = look(ahead.x - up.x * 0.6, ahead.y - up.y * 0.6, ahead.z - up.z * 0.6);
        const out = demandFromLook(snap(), push(0, 1), l, h, up, 'ground', NO_BUTTONS);
        expect(out.forward).toBeCloseTo(1, 12);
        expect(out.strafe).toBeCloseTo(0, 12);
        expect(out.turn).toBeCloseTo(0, 12);
        const diagonal = demandFromLook(snap(), push(0.5, 0.5), l, h, up, 'ground', NO_BUTTONS);
        expect(Math.hypot(diagonal.forward, diagonal.strafe)).toBeCloseTo(Math.hypot(0.5, 0.5), 12);
        // The stick's right is the SCREEN'S right: the body's own on the
        // ground and on every wall, and the body's LEFT on the ceiling,
        // where a level picture shows the ant upside down.
        expect(diagonal.strafe).toBeCloseTo(up === NY ? -0.5 : 0.5, 12);
      }
    }
  });

  it('on the ceiling a push right walks the upside-down ant to the SCREEN\'S right, which is its own left', () => {
    // Body on the ceiling facing +x (heading π/2 on the −y face: aheadOn(−y, π/2) = +x); the camera below and behind, looking along +x and up a little.
    const h = Math.PI / 2;
    const bodyAhead = aheadOn(NY, h, v());
    expect(bodyAhead.x).toBeCloseTo(1, 12);
    const l = look(1, 0.4, 0);
    const out = demandFromLook(snap(), push(1, 0), l, h, NY, 'ground', NO_BUTTONS);
    // The screen's right for a look along +x under a world-up lens is +x × +y = +z. The body's right is
    // ahead × up = +x × −y = −z. So a push right is a strafe of −1 for the body, and the body moves to +z.
    expect(out.forward).toBeCloseTo(0, 12);
    expect(out.strafe).toBeCloseTo(-1, 12);
    const bodyRight = rightOn(NY, bodyAhead, v());
    const moveZ = bodyAhead.z * out.forward + bodyRight.z * out.strafe;
    expect(moveZ).toBeCloseTo(1, 12);
    // And on the wall the two rights agree, so nothing there changed: the wall test above pins it.
  });

  it('on the ceiling the turn is a left turn about the ceiling\'s up: the sign of the heading difference on that face', () => {
    const h = 0.4;
    const b = 1.1;
    const lookDir = aheadOn(NY, b, v());
    const out = demandFromLook(snap(), push(0, 1), lookDir, h, NY, 'ground', NO_BUTTONS);
    expect(out.turn).toBeCloseTo((b - h) / STEER_SATURATION, 12);
    const other = demandFromLook(snap(), push(0, 1), aheadOn(NY, h - 0.3, v()), h, NY, 'ground', NO_BUTTONS);
    expect(other.turn).toBeCloseTo(-0.3 / STEER_SATURATION, 12);
  });

  it('writes into the intent the caller keeps, and is already inside the Intent contract', () => {
    const out = newMutableIntent();
    const got = demandFromLook(snap(['KeyW', 'ShiftLeft']), push(0.3, 0), look(0, 1, 0), 0, X, 'air', buttons({ up: true }), false, out);
    expect(got).toBe(out);
    expect(out.sprint).toBe(true);
    expect(out.vertical).toBe(1);
    expect(clampIntent(out)).toEqual(out);
    const wild = demandFromLook(snap(['KeyW', 'KeyD']), push(3, 3), look(0, -1, 0.2), -1, NY, 'ground', NO_BUTTONS);
    expect(clampIntent(wild)).toEqual(wild);
    expect(Math.hypot(wild.forward, wild.strafe)).toBeCloseTo(1, 9);
  });
});
