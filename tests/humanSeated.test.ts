/**
 * THE SEATED POSES, against BOTH real skeletons (`fixtures/humanBind.json`,
 * measured from `public/models/*.glb`): the thighs come level, the shins
 * hang, the feet are flat, the hips do not move, and a dozing body's
 * hands are folded in front of its chest with its head dropped toward a
 * shoulder. Forward kinematics is `posedJoints`, the same rule the
 * renderer applies.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BindJoint } from '../src/actor/humanRig';
import { measureHuman } from '../src/actor/humanSkeleton';
import { SEATED_TURNS, poseSeated, posedJoints, seatedHips } from '../src/actor/humanSeated';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/humanBind.json', import.meta.url), 'utf8')) as {
  jack: BindJoint[]; sarah: BindJoint[];
};
const MASTERS = [
  { name: 'jack', bind: RAW.jack as readonly BindJoint[] },
  { name: 'sarah', bind: RAW.sarah as readonly BindJoint[] },
] as const;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const deg = (r: number) => (r * 180) / Math.PI;
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Closest distance between segments p1-q1 and p2-q2. */
function segmentGap(p1: V, q1: V, p2: V, q2: V): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
  const den = a * e - b * b;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
  let t = (b * s + f) / e;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  return len(sub([p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s], [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t]));
}

for (const master of MASTERS) {
  const bind = master.bind;
  const m = measureHuman(bind);
  const j = m.joints;
  const pose = (style: 'doze' | 'sit', seconds = 0, headSide = 1) =>
    posedJoints(bind, poseSeated(m, bind, { style, seconds, headSide }, []));

  describe(`poseSeated: ${master.name}`, () => {
    it('writes a fixed list of finite, unit-axis turns', () => {
      const turns = poseSeated(m, bind, { style: 'doze', seconds: 1.3 }, []);
      expect(turns.length).toBe(SEATED_TURNS);
      for (const t of turns) {
        expect(t.joint).toBeGreaterThanOrEqual(0);
        expect(Math.abs(Math.hypot(t.ax, t.ay, t.az) - 1)).toBeLessThan(1e-9);
        expect(Number.isFinite(t.radians)).toBe(true);
      }
    });

    for (const style of ['doze', 'sit'] as const) {
      it(`${style}: thighs level and forward, shins hanging, feet flat, hips unmoved`, () => {
        const p = pose(style);
        for (const [hip, knee, ankle] of [[j.hipL, j.kneeL, j.ankleL], [j.hipR, j.kneeR, j.ankleR]]) {
          const thigh = sub(p[knee], p[hip]);
          const shin = sub(p[ankle], p[knee]);
          // level within a few degrees, and pointing the way the body faces (+Z)
          expect(Math.abs(deg(Math.asin(thigh[1] / len(thigh))))).toBeLessThan(5);
          expect(thigh[2]).toBeGreaterThan(0.8 * len(thigh));
          // the shin hangs: mostly down, a little forward
          expect(shin[1]).toBeLessThan(-0.9 * len(shin));
          for (let a = 0; a < 3; a += 1) expect(p[hip][a]).toBeCloseTo([bind[hip].x, bind[hip].y, bind[hip].z][a], 9);
        }
        const hips = seatedHips(m, bind);
        expect(hips[1]).toBeCloseTo((bind[j.hipL].y + bind[j.hipR].y) / 2, 9);
      });
    }

    it('doze: the forearms fold one over the other and never pass through each other', () => {
      // Joshua, 2026-09-29: "Jack's hands cross through each other". Folded
      // arms STACK: the centre lines of the two forearms pass at least a
      // forearm's thickness apart (7 cm), the right (over) forearm lies in
      // front of and above the left, each wrist is past the middle, and the
      // elbows stay out at the sides rather than swinging into the chest.
      //
      // "Out at the sides" was 15 cm from the chest on the scans, whose
      // shoulders stood further out than that. Re-measured on the toon
      // masters 2026-10-07, Sarah's shoulder joints stand only 13.2 cm from
      // her chest (Jack's 15.1 and 20.9 — his chest joint is 2.3 cm off his
      // midline), so the absolute line would fail her for having narrow
      // shoulders while her elbows hang OUTSIDE them. What it guards against
      // is an elbow swung in past its own shoulder, so that is what it now
      // says: each elbow at least as far out as its shoulder in the bind
      // (Sarah 14.1 and 14.0 against 13.2; Jack 15.6 and 21.3 against 15.1
      // and 20.9).
      const p = pose('doze');
      const u = 1.7 / m.height; // metres per bind unit
      const gap = segmentGap(p[j.elbowL], p[j.wristL], p[j.elbowR], p[j.wristR]) * u;
      expect(gap).toBeGreaterThan(0.07);
      const chest = p[j.chest], L = m.leftSign < 0 ? -1 : 1;
      expect(-(p[j.wristL][0] - chest[0]) * L * u).toBeGreaterThan(0.03);
      expect((p[j.wristR][0] - chest[0]) * L * u).toBeGreaterThan(0.03);
      expect((p[j.wristR][2] - p[j.wristL][2]) * u).toBeGreaterThan(0.04);
      expect((p[j.wristR][1] - p[j.wristL][1]) * u).toBeGreaterThan(0.04);
      for (const [e, s] of [[j.elbowL, j.shoulderL], [j.elbowR, j.shoulderR]]) {
        expect(Math.abs(p[e][0] - chest[0])).toBeGreaterThanOrEqual(Math.abs(bind[s].x - bind[j.chest].x));
      }
    });

    it('doze: arms folded in front of the chest, head dropped toward the chosen shoulder', () => {
      const p = pose('doze');
      const chest = p[j.chest], neck = p[j.neck];
      for (const w of [j.wristL, j.wristR]) {
        // in front of the chest, between the shoulders, below the neck, above the hips
        expect(p[w][2]).toBeGreaterThan(chest[2] + 0.02);
        expect(Math.abs(p[w][0] - chest[0])).toBeLessThan(Math.abs(bind[j.shoulderL].x - bind[j.shoulderR].x) * 0.75);
        expect(p[w][1]).toBeLessThan(neck[1]);
        expect(p[w][1]).toBeGreaterThan(bind[j.hipL].y);
      }
      // the head drops forward and rolls toward the body's right (leftSign tells which x that is)
      const headRight = pose('doze', 0, 1)[j.head], headLeft = pose('doze', 0, -1)[j.head];
      const up = [bind[j.head].x, bind[j.head].y, bind[j.head].z] as V;
      expect(headRight[1]).toBeLessThan(up[1]);
      expect(headRight[2]).toBeGreaterThan(up[2]);
      const rightward = -m.leftSign;
      expect(Math.sign(headRight[0] - up[0])).toBe(rightward);
      expect(Math.sign(headLeft[0] - up[0])).toBe(-rightward);
    });

    it('breathes: the chest moves with the clock and the legs do not', () => {
      const a = pose('doze', 0), b = pose('doze', 1.25);
      expect(len(sub(a[j.neck], b[j.neck]))).toBeGreaterThan(1e-4);
      expect(len(sub(a[j.ankleL], b[j.ankleL]))).toBeLessThan(1e-12);
    });
  });
}

// Joshua, 2026-10-07, on the toon masters: "Sarah doesn't sleep like Jack" and "if Sarah does
// sleep like Jack, her hands and arms need to be differently as it changes the belly".
describe('doze: the same sleep on every body, and a pregnant body cradles rather than folds', () => {
  for (const master of MASTERS) {
    const bind = master.bind;
    const m = measureHuman(bind);
    const j = m.joints;
    it(`${master.name}: the head drops to the same pitch whatever the bind's own head lean`, () => {
      const P = posedJoints(bind, poseSeated(m, bind, { style: 'doze', seconds: 0 }, []));
      const pitch = deg(Math.atan2(P[j.head][2] - P[j.neck][2], P[j.head][1] - P[j.neck][1]));
      // 38° is where Jack's approved doze lands; the roll and the breath move it a little.
      expect(pitch).toBeGreaterThan(33);
      expect(pitch).toBeLessThan(43);
    });
    it(`${master.name}: cradling, the hands stay on their own sides, low in front, never crossed`, () => {
      const P = posedJoints(bind, poseSeated(m, bind, { style: 'doze', seconds: 0, arms: 'cradle' }, []));
      const mid = (bind[j.hipL].x + bind[j.hipR].x) / 2;
      const L = m.leftSign < 0 ? -1 : 1;
      // each wrist on its own side of the centre line (the fingertips may meet past it)
      expect(L * (P[j.wristL][0] - mid)).toBeGreaterThan(0);
      expect(L * (P[j.wristR][0] - mid)).toBeLessThan(0);
      // in front of the hips and below the chest: on the bump, not across the chest
      for (const w of [j.wristL, j.wristR]) {
        expect(P[w][2]).toBeGreaterThan(bind[j.hipL].z);
        expect(P[w][1]).toBeLessThan(bind[j.chest].y);
      }
    });
  }
});
