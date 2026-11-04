/**
 * actor/jointLimits.ts against both masters (tests/fixtures/humanBind.json): each motion read as a clinician reads it,
 * and held at the table's walls (data/jointRange.ts) -- the head that cannot turn like an owl's, the back bent too far
 * held back along all of it, the hip's opening held while its flexion is kept, and a pose inside the walls untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BindJoint, JointTurn } from '../src/actor/humanRig';
import { newJointTurn } from '../src/actor/humanRig';
import { measureHuman } from '../src/actor/humanSkeleton';
import { poseHuman } from '../src/actor/humanPose';
import { poseSeated } from '../src/actor/humanSeated';
import { poseBirth } from '../src/actor/humanBirth';
import { JointLimits, type RangeOf } from '../src/actor/jointLimits';
import { rangeDeg, type RangeLevel, type Sex } from '../src/data/jointRange';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/humanBind.json', import.meta.url), 'utf8')) as { jack: BindJoint[]; sarah: BindJoint[] };
const MASTERS = [['sarah', RAW.sarah, 'female'], ['jack', RAW.jack, 'male']] as const;
const DEG = Math.PI / 180;
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V): V => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const rangeOf = (sex: Sex, level: RangeLevel): RangeOf => (j, m) => rangeDeg(j as never, m as never, sex, level);

function setup(bind: readonly BindJoint[], sex: Sex, level: RangeLevel = 'active') {
  const m = measureHuman(bind), j = m.joints, P = (i: number): V => [bind[i].x, bind[i].y, bind[i].z];
  // (the body's axes as the limits take them: up the spine, across the hips, forward square to both the way the toes go)
  const toe = bind.findIndex((b) => b.parent === j.ankleL), dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const up = unit(sub(P(j.neck), P(j.pelvis))), raw = sub(P(j.hipL), P(j.hipR)), out = unit(sub(raw, [up[0] * dot(raw, up), up[1] * dot(raw, up), up[2] * dot(raw, up)]));
  let fwd = unit(cross(out, up)); if (dot(fwd, sub(P(toe), P(j.ankleL))) < 0) fwd = [-fwd[0], -fwd[1], -fwd[2]];
  const turn = (joint: number, axis: V, deg: number): JointTurn => { const a = unit(axis); return { joint, ax: a[0], ay: a[1], az: a[2], radians: deg * DEG }; };
  return { m, j, P, up, fwd, out, turn, L: new JointLimits(m, bind, rangeOf(sex, level)) };
}

describe('jointLimits: reading a pose as a clinician does', () => {
  for (const [name, bind, sex] of MASTERS) {
    it(`${name}: standing straight reads nothing`, () => {
      const { m, L } = setup(bind, sex);
      const r = L.read(poseHuman(m, bind, { stance: 'stand', phase: 0, seconds: 0, lean: 0 }, Array.from({ length: 20 }, newJointTurn)));
      for (const v of [r.back.flexion, r.back.rotation, r.neck.flexion, r.neck.rotation, r.hipL.flexion, r.hipL.abduction, r.kneeL, r.ankleL]) expect(Math.abs(v)).toBeLessThan(0.5);
    });
    it(`${name}: a thigh brought forward reads as flexion, swung out as abduction, the shin back as the knee's bend`, () => {
      const { j, P, fwd, out, turn, L } = setup(bind, sex);
      const thigh = sub(P(j.kneeL), P(j.hipL)), shin = sub(P(j.ankleL), P(j.kneeL));
      const flex = L.read([turn(j.hipL, cross(thigh, fwd), 30)]);
      expect(flex.hipL.flexion).toBeCloseTo(30, 0); expect(Math.abs(flex.hipL.abduction)).toBeLessThan(1);
      const abd = L.read([turn(j.hipL, cross(thigh, out), 25)]);
      expect(abd.hipL.abduction).toBeCloseTo(25, 0); expect(Math.abs(abd.hipL.flexion)).toBeLessThan(1);
      const knee = L.read([turn(j.kneeL, cross(shin, [-fwd[0], -fwd[1], -fwd[2]]), 60)]);
      expect(knee.kneeL).toBeCloseTo(60, 0);
    });
  }
});

describe('jointLimits: holding a pose inside the walls', () => {
  for (const [name, bind, sex] of MASTERS) {
    it(`${name}: cannot turn its head like an owl -- a 90 degree look is held at the neck's rotation`, () => {
      const { j, up, turn, L } = setup(bind, sex);
      const owl = [turn(j.neck, up, 90)];
      expect(L.pastWalls(owl).map((p) => p.where)).toContain('neck');
      const held = L.limit(owl);
      expect(Math.abs(L.read(held).neck.rotation)).toBeCloseTo(rangeDeg('neck', 'rotation', sex), 0);
      expect(L.pastWalls(held)).toEqual([]);
    });
    it(`${name}: a back bent past its range is held back along all of it, each bone its share`, () => {
      const { j, P, up, fwd, turn, L } = setup(bind, sex);
      const axis = cross(up, fwd);
      const held = L.limit([turn(j.spine, axis, 50), turn(j.chest, axis, 50)]);
      expect(L.read(held).back.flexion).toBeCloseTo(rangeDeg('back', 'flexion', sex), 0);
      const a = held.find((t) => t.joint === j.spine)!, b = held.find((t) => t.joint === j.chest)!;
      expect(a.radians / DEG).toBeCloseTo(b.radians / DEG, 0);
      void P;
    });
    it(`${name}: only the motion past its wall changes -- a thigh opened too far keeps its flexion`, () => {
      const { j, P, fwd, out, turn, L } = setup(bind, sex);
      const t = unit(sub(P(j.kneeL), P(j.hipL))), dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      // (the opening's way square to the thigh AND to its flexion's way, as a clinician's floating axis is)
      const along = (v: V, n: V): V => unit(sub(v, [n[0] * dot(v, n), n[1] * dot(v, n), n[2] * dot(v, n)]));
      const f = along(fwd, t), o = along(along(out, f), t);
      // flexed 30, then opened 60 (the turns in the clinician's order: flexion first)
      const q = L.limit([turnOf(turn(j.hipL, cross(t, f), 30), turn(j.hipL, cross(t, o), 60))]);
      const r = L.read(q);
      expect(r.hipL.flexion).toBeCloseTo(30, 0);
      expect(r.hipL.abduction).toBeCloseTo(rangeDeg('hip', 'abduction', sex), 0);
    });
    it(`${name}: a pose inside every wall comes back as it went in, and a joint it does not hold passes through`, () => {
      const { m, j, up, turn, L } = setup(bind, sex);
      const sit = poseSeated(m, bind, { style: 'sit', seconds: 0 }, Array.from({ length: 40 }, newJointTurn));
      const wrist = turn(j.wristL, up, 170);
      const turns = [...sit, wrist];
      expect(L.pastWalls(sit)).toEqual([]);
      const held = L.limit(turns);
      turns.forEach((t, k) => { expect(held[k].joint).toBe(t.joint); expect(held[k].radians).toBeCloseTo(t.radians, 9); expect(held[k].ax).toBeCloseTo(t.ax, 9); });
    });
  }
  it('the birth positions are placed ones: inside the passive walls where the active ones would close her thighs', () => {
    const [, bind, sex] = MASTERS[0];
    const active = setup(bind, sex, 'active'), passive = setup(bind, sex, 'passive');
    const m = active.m, birth = poseBirth(m, bind, { style: 'recline', seconds: 0, bump: 1 }, Array.from({ length: 20 }, newJointTurn));
    expect(active.L.pastWalls(birth).some((p) => p.motion.startsWith('abduction'))).toBe(true);
    expect(passive.L.pastWalls(birth)).toEqual([]);
    expect(active.L.read(active.L.limit(birth)).hipL.abduction).toBeCloseTo(rangeDeg('hip', 'abduction', sex), 0);
  });
});

/** two turns of one joint as the one turn that does the second after the first (b · a, both in the bind frame) */
function turnOf(a: JointTurn, b: JointTurn): JointTurn {
  const q = (t: JointTurn) => { const s = Math.sin(t.radians / 2); return [t.ax * s, t.ay * s, t.az * s, Math.cos(t.radians / 2)]; };
  const [x1, y1, z1, w1] = q(b), [x2, y2, z2, w2] = q(a);
  // (b applied after a, in the same frame: the composite is a · b read as a joint's turn -- flexion first, then the opening)
  const x = w2 * x1 + x2 * w1 + y2 * z1 - z2 * y1, y = w2 * y1 - x2 * z1 + y2 * w1 + z2 * x1, z = w2 * z1 + x2 * y1 - y2 * x1 + z2 * w1, w = w2 * w1 - x2 * x1 - y2 * y1 - z2 * z1;
  const s = Math.hypot(x, y, z);
  return { joint: a.joint, ax: x / s, ay: y / s, az: z / s, radians: 2 * Math.atan2(s, w) };
}
