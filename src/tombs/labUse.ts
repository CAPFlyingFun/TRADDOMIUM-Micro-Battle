/**
 * WHAT USING A THING IN THE LAB DOES WITH THE BODY — which hands go where,
 * where the head looks, whether the body sits, and for how long.
 *
 * Joshua, 2026-09-30: "you can move the body around, but some of the hands
 * and head movements are automatic... press a button on mobile (like 'E'
 * for computer) to trigger the animations." The player drives the body;
 * this file turns the plan's own interaction into TARGETS, and
 * `actor/humanAim` and `actor/humanReach` turn targets into joints. Nothing
 * here poses anything, and nothing here is remembered: the same
 * interaction and the same body give the same use, every time.
 *
 * Pure — no three, no DOM — so a test reads the real plan through it.
 *
 * ─── which hand ──────────────────────────────────────────────────────
 *
 * THE HAND ON THE THING'S SIDE, and the right one when it is in front.
 * Jack is right-handed (Joshua, 2026-09-30), but the intercom on his desk
 * sits half a metre to the LEFT of his keyboard, where it is in the
 * approved lab picture: his right hand would have to cross his body and
 * the whole keyboard to reach it, 0.8 m from his right shoulder on a
 * 0.6 m arm. So a target off to one side is that side's hand's, and only
 * one near the middle — within `MIDLINE_M` — is the right hand's by
 * preference.
 *
 * ─── which way the palm faces ────────────────────────────────────────
 *
 * DOWN onto anything whose top the fingertip lands on (a key, a desk
 * button); INTO the face of anything the fingertip meets from the side
 * (a wall panel, a lever), along the line from the body to it.
 */
import type { HandSide, HandTarget } from '../actor/humanReach';
import type { Interaction, LabLayout, Slab, Vec3 } from '../world/tombs/types';

export type UseMode = 'sit' | 'press' | 'grip' | 'look';

/** Where a seated body's root goes: the seat's middle, facing the keyboard (three's `rotation.y`, +z at 0). */
export interface LabSeat {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

export interface LabUse {
  /** The interaction's id. */
  readonly id: string;
  readonly mode: UseMode;
  /** 'sit' only. */
  readonly seat: LabSeat | null;
  readonly hands: readonly HandTarget[];
  /** Where the head aims, metres. */
  readonly look: Vec3;
  /** How long a one-shot lasts, seconds; `Infinity` for a toggle ('sit', 'look'). */
  readonly seconds: number;
}

/** A press: reach, push, come back. GAME TUNING. */
export const PRESS_SECONDS = 0.7;
/** A grip on a lever: a beat longer, it is pulled rather than tapped. GAME TUNING. */
export const GRIP_SECONDS = 1.0;
/** Each keyboard grip this far either side of the keyboard's middle — two hands on the home row. */
export const GRIP_SPREAD_M = 0.1;
/** How far a sliding grip stops short of the keyboard's end. */
export const GRIP_END_M = 0.05;
/** Closer to the body's midline than this, a one-handed target is the right hand's. */
export const MIDLINE_M = 0.15;
/**
 * A chair further than this from its keyboard (middle to middle,
 * horizontal) has been pushed away from the desk — Sarah's stands a
 * chair's roll off hers — and sitting in it would put the keys past the
 * end of the arm. Using such a workstation reads it standing, eyes only.
 * Jack's is 0.30 m (`world/tombs/plan.ts`'s `CHAIR_TO_KEYS`); this leaves
 * room for a chair a little out without letting one across the aisle in.
 */
export const SIT_REACH_M = 0.45;
/** A fingertip this close under a slab's top is ON its top, and the palm faces down. */
const ON_TOP_M = 0.01;

const DOWN: Vec3 = Object.freeze({ x: 0, y: -1, z: 0 });

/** The fixture an interaction belongs to: `use:jack-workstation` → `jack-workstation`. */
function fixtureOf(interaction: Interaction): string {
  return interaction.id.startsWith('use:') ? interaction.id.slice(4) : interaction.id;
}

function slabNamed(layout: LabLayout, id: string): Slab | null {
  for (const s of layout.slabs) if (s.id === id) return s;
  return null;
}

/** The fixture's own slab, or its first part (`lab-intercom:unit`). */
function slabOf(layout: LabLayout, fixture: string): Slab | null {
  const own = slabNamed(layout, fixture);
  if (own !== null) return own;
  for (const s of layout.slabs) if (s.id.startsWith(`${fixture}:`)) return s;
  return null;
}

/**
 * Where the head aims to use it: the fixture's monitor where it has one —
 * a workstation is READ off its screen, not off the point the plan stood
 * its reach on — and otherwise the interaction's own point.
 */
export function lookAtOf(layout: LabLayout, interaction: Interaction): Vec3 {
  const monitor = slabNamed(layout, `${fixtureOf(interaction)}:monitor`);
  return monitor === null ? interaction.at : monitor.box.at;
}

/**
 * The body's LEFT, horizontal, for a body at three's `rotation.y` = `yaw`
 * whose bind puts its left along +x × `leftSign`: `rotation.y` carries
 * (1, 0, 0) to (cos yaw, 0, −sin yaw).
 */
export function leftOf(yaw: number, leftSign: 1 | -1): { x: number; z: number } {
  return { x: leftSign * Math.cos(yaw), z: -leftSign * Math.sin(yaw) };
}

/** Which hand takes a one-handed target (the header). */
export function handFor(body: { readonly x: number; readonly z: number; readonly yaw: number }, at: Vec3, leftSign: 1 | -1): HandSide {
  const left = leftOf(body.yaw, leftSign);
  const across = (at.x - body.x) * left.x + (at.z - body.z) * left.z;
  return across > MIDLINE_M ? 'L' : 'R';
}

/** The palm for a one-handed target: down onto a top, else into the face along the body's line to it. */
function palmFor(layout: LabLayout, interaction: Interaction, body: { readonly x: number; readonly z: number }): Vec3 {
  const slab = slabOf(layout, fixtureOf(interaction));
  if (slab !== null && interaction.at.y >= slab.box.at.y + slab.box.size.y / 2 - ON_TOP_M) return DOWN;
  const dx = interaction.at.x - body.x;
  const dz = interaction.at.z - body.z;
  const d = Math.hypot(dx, dz);
  // Standing on the point itself there is no "into": a top is as good a guess as any.
  return d > 1e-6 ? { x: dx / d, y: 0, z: dz / d } : DOWN;
}

/**
 * What using `interaction` does, for a body standing at `body` (metres,
 * three's yaw) whose bind's left is +x × `leftSign`.
 */
export function useOf(
  layout: LabLayout,
  interaction: Interaction,
  body: { readonly x: number; readonly z: number; readonly yaw: number },
  leftSign: 1 | -1,
): LabUse {
  const fixture = fixtureOf(interaction);
  const look = lookAtOf(layout, interaction);

  if (interaction.doing === 'read') {
    const keyboard = slabNamed(layout, `${fixture}:keyboard`);
    const chair = slabNamed(layout, `${fixture}:chair-seat`);
    if (keyboard === null || chair === null
      || Math.hypot(keyboard.box.at.x - chair.box.at.x, keyboard.box.at.z - chair.box.at.z) > SIT_REACH_M) {
      return { id: interaction.id, mode: 'look', seat: null, hands: [], look, seconds: Infinity };
    }
    // SIT: in the chair, facing the keyboard, both hands on it.
    const k = keyboard.box;
    const dx = k.at.x - chair.box.at.x;
    const dz = k.at.z - chair.box.at.z;
    const yaw = Math.hypot(dx, dz) > 1e-6 ? Math.atan2(dx, dz) : 0;
    const seat: LabSeat = { x: chair.box.at.x, z: chair.box.at.z, yaw };
    const alongX = k.size.x >= k.size.z;
    const axis = alongX ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
    const long = alongX ? k.size.x : k.size.z;
    const top = k.at.y + k.size.y / 2;
    // Which end of the keyboard is the sitter's left.
    const left = leftOf(yaw, leftSign);
    const toLeft = axis.x * left.x + axis.z * left.z >= 0 ? 1 : -1;
    const range = Math.max(0, long / 2 - GRIP_SPREAD_M - GRIP_END_M);
    const grip = (side: HandSide, sign: number): HandTarget => ({
      side,
      x: k.at.x + axis.x * sign * GRIP_SPREAD_M,
      y: top,
      z: k.at.z + axis.z * sign * GRIP_SPREAD_M,
      kind: 'hold',
      slideAxis: axis,
      slideRange: range,
    });
    return {
      id: interaction.id, mode: 'sit', seat,
      hands: [grip('L', toLeft), grip('R', -toLeft)],
      look, seconds: Infinity,
    };
  }

  const side = handFor(body, interaction.at, leftSign);
  const palm = palmFor(layout, interaction, body);
  const at = interaction.at;
  if (interaction.doing === 'pull') {
    return {
      id: interaction.id, mode: 'grip', seat: null,
      hands: [{ side, x: at.x, y: at.y, z: at.z, kind: 'hold', palm }],
      look: at, seconds: GRIP_SECONDS,
    };
  }
  // 'speak' and 'open': a press.
  return {
    id: interaction.id, mode: 'press', seat: null,
    hands: [{ side, x: at.x, y: at.y, z: at.z, kind: 'press', palm }],
    look: at, seconds: PRESS_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// The roll toward a button a seated body cannot reach
// ---------------------------------------------------------------------------

/**
 * A SEATED BODY ROLLS IN TOWARD WHAT IT REACHES FOR. Jack's intercom
 * stands where the approved picture has it, and from his chair it is
 * 0.94 of his arm away — just past the 0.85 at which `actor/humanReach`
 * takes hold, as a real button at the back of a desk is: "He reached for
 * the intercom." A person closes that last few centimetres with the chair,
 * and TMB-Story's chapter 1 does the same (`people3d.placeBody`). So while
 * a seated one-shot's hand has not taken hold, the root rolls toward the
 * target at `ROLL_SPEED_M_S`, no further than `ROLL_MAX_M`, and rolls back
 * once the hand is free. Closed on the solver's own answer — whether the
 * hand holds — so it rolls exactly as far as this arm needs and no
 * further, for any body and any button. GAME TUNING.
 */
export const ROLL_MAX_M = 0.15;
export const ROLL_SPEED_M_S = 0.5;

/** One step of the roll: out while `reaching` and not yet `holding`, held while holding, back when not reaching. */
export function rollStep(current: number, reaching: boolean, holding: boolean, dt: number): number {
  if (!(dt > 0)) return current;
  if (reaching && !holding) return Math.min(ROLL_MAX_M, current + ROLL_SPEED_M_S * dt);
  if (reaching) return current;
  return Math.max(0, current - ROLL_SPEED_M_S * dt);
}

/** The seat moved `by` metres horizontally toward `target`, written into `out`. */
export function rolledToward(seat: LabSeat, target: Vec3, by: number, out: { x: number; z: number }): { x: number; z: number } {
  const dx = target.x - seat.x;
  const dz = target.z - seat.z;
  const d = Math.hypot(dx, dz);
  const k = d > 1e-6 ? Math.min(by, d) / d : 0;
  out.x = seat.x + dx * k;
  out.z = seat.z + dz * k;
  return out;
}
