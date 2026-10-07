/**
 * `tombs/labUse` against the REAL laboratory plan, and — for the two uses
 * the chapter turns on, the keyboard and the intercom — against the real
 * arm solver on Jack's own bind, seated where the use seats him, and on
 * Sarah's in the same chair: hers is the shorter arm since the toon
 * masters (2026-10-07), and the only one that still has to ROLL to the
 * intercom, so she is what proves the roll.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createReach, reachHands, type HandTarget, type ReachResult } from '../src/actor/humanReach';
import { poseSeated, posedJoints } from '../src/actor/humanSeated';
import type { BindJoint, MutableJointTurn } from '../src/actor/humanRig';
import { measureHuman } from '../src/actor/humanSkeleton';
import { GRIP_SECONDS, PRESS_SECONDS, ROLL_MAX_M, SIT_REACH_M, handFor, leftOf, lookAtOf, rollStep, rolledToward, useOf } from '../src/tombs/labUse';
import { planLab } from '../src/world/tombs';
import type { Interaction } from '../src/world/tombs/types';

const LAYOUT = planLab();
const FIXTURE = fileURLToPath(new URL('./fixtures/humanBind.json', import.meta.url));
const MASTERS = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { jack: BindJoint[]; sarah: BindJoint[] };
/** Fixture units per metre, and the soles in the fixture's frame (`tests/humanReach.test.ts`). */
const UNITS_PER_METRE = 0.85;
const FLOOR_Y = -1.0 / 1.384083;

const find = (id: string): Interaction => {
  const i = LAYOUT.interactions.find((x) => x.id === id);
  if (i === undefined) throw new Error(`no ${id}`);
  return i;
};
const slab = (id: string) => {
  const s = LAYOUT.slabs.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no ${id}`);
  return s;
};
/**
 * The workstations the player can SIT at: the plan offers Jack's and
 * Sarah's (the west two are furniture), and Sarah's chair stands a
 * chair's roll from her desk, so hers is read standing (below).
 */
const WORKSTATIONS = ['jack-workstation'];

describe('what using a thing in the lab does with the body', () => {
  it('gives every interaction a finite use', () => {
    for (const i of LAYOUT.interactions) {
      const use = useOf(LAYOUT, i, { x: i.at.x + 0.5, z: i.at.z + 0.5, yaw: 0 }, 1);
      expect(use.id).toBe(i.id);
      for (const v of [use.look.x, use.look.y, use.look.z]) expect(Number.isFinite(v)).toBe(true);
      for (const h of use.hands) for (const v of [h.x, h.y, h.z]) expect(Number.isFinite(v)).toBe(true);
      // standing exactly on the point is degenerate, not broken
      const on = useOf(LAYOUT, i, { x: i.at.x, z: i.at.z, yaw: 0 }, 1);
      for (const h of on.hands) for (const v of [h.palm?.x ?? 0, h.palm?.y ?? 0, h.palm?.z ?? 0]) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('sits at every workstation, facing its keyboard, both hands on its top and reading its monitor', () => {
    for (const ws of WORKSTATIONS) {
      const use = useOf(LAYOUT, find(`use:${ws}`), { x: 0, z: 0, yaw: 0 }, 1);
      expect(use.mode).toBe('sit');
      expect(use.seconds).toBe(Infinity);
      const chair = slab(`${ws}:chair-seat`).box, k = slab(`${ws}:keyboard`).box;
      expect(use.seat?.x).toBeCloseTo(chair.at.x, 9);
      expect(use.seat?.z).toBeCloseTo(chair.at.z, 9);
      // facing: three's rotation.y carries +z onto the line to the keyboard
      const facing = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, use.seat!.yaw, 0));
      const to = new THREE.Vector3(k.at.x - chair.at.x, 0, k.at.z - chair.at.z).normalize();
      expect(facing.dot(to)).toBeGreaterThan(0.9999);
      expect(use.hands.map((h) => h.side).sort()).toEqual(['L', 'R']);
      for (const h of use.hands) {
        expect(h.kind).toBe('hold');
        expect(h.y).toBeCloseTo(k.at.y + k.size.y / 2, 9);
        expect(Math.abs(h.x - k.at.x)).toBeLessThanOrEqual(k.size.x / 2);
        expect(Math.abs(h.z - k.at.z)).toBeLessThanOrEqual(k.size.z / 2);
      }
      expect(use.look).toEqual(slab(`${ws}:monitor`).box.at);
      expect(lookAtOf(LAYOUT, find(`use:${ws}`))).toEqual(slab(`${ws}:monitor`).box.at);
    }
  });

  it("puts the L grip on the sitter's own left, by three's own rotation", () => {
    for (const leftSign of [1, -1] as const) {
      for (const ws of WORKSTATIONS) {
        const use = useOf(LAYOUT, find(`use:${ws}`), { x: 0, z: 0, yaw: 0 }, leftSign);
        // the bind's left, carried by a real Object3D's rotation.y
        const o = new THREE.Object3D();
        o.rotation.y = use.seat!.yaw;
        const left = new THREE.Vector3(leftSign, 0, 0).applyQuaternion(o.quaternion);
        const mine = leftOf(use.seat!.yaw, leftSign);
        expect(mine.x).toBeCloseTo(left.x, 12);
        expect(mine.z).toBeCloseTo(left.z, 12);
        const L = use.hands.find((h) => h.side === 'L')!, R = use.hands.find((h) => h.side === 'R')!;
        expect((L.x - R.x) * left.x + (L.z - R.z) * left.z).toBeGreaterThan(0);
      }
    }
  });

  it("presses Jack's desk intercom DOWN, with the hand on its side — his left", () => {
    const seat = useOf(LAYOUT, find('use:jack-workstation'), { x: 0, z: 0, yaw: 0 }, 1).seat!;
    const use = useOf(LAYOUT, find('use:lab-intercom'), seat, 1);
    expect(use.mode).toBe('press');
    expect(use.seconds).toBe(PRESS_SECONDS);
    expect(use.hands).toHaveLength(1);
    expect(use.hands[0].side).toBe('L');
    expect(use.hands[0].kind).toBe('press');
    expect(use.hands[0].palm).toEqual({ x: 0, y: -1, z: 0 });
    // It is ON his desk, to the left of his keyboard, where the picture has it.
    const unit = slab('lab-intercom:unit').box, desk = slab('jack-workstation:desk').box;
    expect(Math.abs(unit.at.x - desk.at.x)).toBeLessThan(desk.size.x / 2);
    expect(Math.abs(unit.at.z - desk.at.z)).toBeLessThan(desk.size.z / 2);
    expect(unit.at.y - unit.size.y / 2).toBeCloseTo(desk.at.y + desk.size.y / 2, 9);
  });

  it('takes a target in front with the right hand: Jack is right-handed', () => {
    expect(handFor({ x: 0, z: 0, yaw: 0 }, { x: 0.05, y: 1, z: 0.5 }, 1)).toBe('R');
    expect(handFor({ x: 0, z: 0, yaw: 0 }, { x: 0.4, y: 1, z: 0.5 }, 1)).toBe('L');
    expect(handFor({ x: 0, z: 0, yaw: 0 }, { x: -0.4, y: 1, z: 0.5 }, 1)).toBe('R');
  });

  it('presses a wall panel INTO the wall, and grips the lever', () => {
    const panel = find('use:control-intercom');
    const from = { x: panel.at.x, z: panel.at.z - 0.5, yaw: 0 };
    const press = useOf(LAYOUT, panel, from, 1);
    expect(press.mode).toBe('press');
    expect(press.hands[0].palm!.y).toBe(0);
    expect(press.hands[0].palm!.z).toBeCloseTo(1, 9);
    const lever = find('use:shutdown-lever');
    const grip = useOf(LAYOUT, lever, { x: lever.at.x + 0.5, z: lever.at.z, yaw: -Math.PI / 2 }, 1);
    expect(grip.mode).toBe('grip');
    expect(grip.seconds).toBe(GRIP_SECONDS);
    expect(grip.hands[0].kind).toBe('hold');
  });

  it("READS Sarah's workstation standing: her chair is pushed away from the desk", () => {
    const chair = slab('sarah-workstation:chair-seat').box, k = slab('sarah-workstation:keyboard').box;
    expect(Math.hypot(k.at.x - chair.at.x, k.at.z - chair.at.z)).toBeGreaterThan(SIT_REACH_M);
    const use = useOf(LAYOUT, find('use:sarah-workstation'), { x: 0, z: 0, yaw: 0 }, 1);
    expect(use.mode).toBe('look');
    expect(use.look).toEqual(slab('sarah-workstation:monitor').box.at);
  });

  it('only LOOKS at a console, and at the mapping display', () => {
    for (const id of ['use:primary-console', 'use:secondary-console', 'use:map-display']) {
      const use = useOf(LAYOUT, find(id), { x: 0, z: 0, yaw: 0 }, 1);
      expect(use.mode).toBe('look');
      expect(use.hands).toHaveLength(0);
      expect(use.look).toEqual(find(id).at);
    }
  });
});

/**
 * How far each body rolls its chair to take the intercom. On the scans
 * Jack rolled. Re-measured on the toon masters 2026-10-07: his fingertip
 * reach is 0.68 m (it was 0.60), and he takes the button from where he
 * sits — left share 0.825, held from the first frame, no roll — which is
 * the roll doing its job ("exactly as far as this arm needs"). Sarah's
 * 0.55 m arm in his chair rolls 0.14 m, inside ROLL_MAX_M, and holds.
 */
const ROLLS: Readonly<Record<'jack' | 'sarah', 'none' | 'some'>> = { jack: 'none', sarah: 'some' };

for (const who of ['jack', 'sarah'] as const) describe(`${who} seated at Jack's desk, on the real arm solver`, () => {
  const bind = MASTERS[who];
  const measure = measureHuman(bind);
  const leftSign = (measure.leftSign < 0 ? -1 : 1) as 1 | -1;
  const turns = poseSeated(measure, bind, { style: 'sit', seconds: 0 }, [] as MutableJointTurn[]).map((t) => ({ ...t }));
  // How far the seated pose lifts the soles, so the body is lowered onto the floor (the scene does the same).
  const p = posedJoints(bind, turns), j = measure.joints;
  const drop = Math.min(p[j.ankleL][1] - bind[j.ankleL].y, p[j.ankleR][1] - bind[j.ankleR].y) / UNITS_PER_METRE;
  const sit = useOf(LAYOUT, find('use:jack-workstation'), { x: 0, z: 0, yaw: 0 }, leftSign);
  const seat = sit.seat!;
  const floor = slab('jack-workstation:chair-seat').box.at.y - 0.45 + 0.035; // the seat's top is 0.45 m off this floor

  const solve = (hands: readonly HandTarget[], seconds: number): ReachResult => {
    const state = createReach(measure, bind, FLOOR_Y);
    const out: MutableJointTurn[] = [];
    let r: ReachResult | null = null;
    for (let i = 0; i < Math.round(seconds * 60); i += 1) {
      r = reachHands(state, measure, bind, turns, {
        dt: 1 / 60, rootX: seat.x, rootY: floor - drop, rootZ: seat.z, rootYaw: seat.yaw,
        unitsPerMetre: UNITS_PER_METRE, seated: true, hands,
      }, out);
    }
    return r!;
  };

  it('holds the keyboard with both hands, comfortably', () => {
    expect(drop).toBeGreaterThan(0.2);
    const r = solve(sit.hands, 1);
    for (const s of [r.L, r.R]) {
      expect(s.holding).toBe(true);
      expect(s.share).toBeLessThan(0.85);
    }
  });

  it("rolls toward the desk intercom only as far as the left hand needs to take the button, the right still on the keys", () => {
    const press = useOf(LAYOUT, find('use:lab-intercom'), seat, leftSign);
    const right = sit.hands.find((h) => h.side === 'R')!;
    const hands = [press.hands[0], right];
    const state = createReach(measure, bind, FLOOR_Y);
    const out: MutableJointTurn[] = [];
    const at = { x: 0, z: 0 };
    let roll = 0, r: ReachResult | null = null, heldAt = -1;
    for (let i = 0; i < 90; i += 1) {
      rolledToward(seat, press.hands[0], roll, at);
      r = reachHands(state, measure, bind, turns, {
        dt: 1 / 60, rootX: at.x, rootY: floor - drop, rootZ: at.z, rootYaw: seat.yaw,
        unitsPerMetre: UNITS_PER_METRE, seated: true, hands,
      }, out);
      if (heldAt < 0 && r.L.holding) heldAt = i;
      roll = rollStep(roll, true, r.L.holding, 1 / 60);
    }
    console.info(`${who} intercom: rolled ${roll.toFixed(3)} m, held from frame ${heldAt}; L share ${r!.L.share.toFixed(3)}, R share ${r!.R.share.toFixed(3)}`);
    expect(r!.L.holding).toBe(true);
    expect(r!.R.holding).toBe(true);
    if (ROLLS[who] === 'none') {
      expect(heldAt).toBe(0);
      expect(roll).toBe(0);
    } else {
      expect(heldAt).toBeGreaterThan(0);
      expect(roll).toBeGreaterThan(0);
    }
    expect(roll).toBeLessThan(ROLL_MAX_M);
    // and back, once the press is over
    for (let i = 0; i < 60; i += 1) roll = rollStep(roll, false, false, 1 / 60);
    expect(roll).toBe(0);
  });
});
