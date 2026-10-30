/**
 * HER BIRTH POSITIONS (actor/humanBirth.ts), against both real skeletons (`fixtures/humanBind.json`): her knees open
 * wider than her hips, wider still round a bigger belly; standing and squatting her feet stay flat; squatting her knees
 * come up near her hips; the two sides mirror; nothing turns her pelvis (the owner places her).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BindJoint } from '../src/actor/humanRig';
import { measureHuman } from '../src/actor/humanSkeleton';
import { posedJoints } from '../src/actor/humanSeated';
import { BIRTH_POSES, BIRTH_STYLES, BIRTH_TURNS, birthSpread, poseBirth } from '../src/actor/humanBirth';

const RAW = JSON.parse(readFileSync(new URL('./fixtures/humanBind.json', import.meta.url), 'utf8')) as { jack: BindJoint[]; sarah: BindJoint[] };

for (const [name, bind] of [['sarah', RAW.sarah], ['jack', RAW.jack]] as const) {
  describe(`birth positions on ${name}`, () => {
    const m = measureHuman(bind);
    const j = m.joints;
    for (const style of BIRTH_STYLES) {
      it(`${style}: knees out past her hips, mirrored, and nothing turns her pelvis`, () => {
        const turns = poseBirth(m, bind, { style, seconds: 0, bump: 1 }, []);
        expect(turns).toHaveLength(BIRTH_TURNS);
        expect(turns.some((t) => t.joint === j.pelvis)).toBe(false);
        const P = posedJoints(bind, turns);
        const hipW = Math.abs(P[j.hipL][0] - P[j.hipR][0]), kneeW = Math.abs(P[j.kneeL][0] - P[j.kneeR][0]);
        expect(kneeW).toBeGreaterThan(hipW * 1.3);
        // mirrored about her middle
        const mid = (P[j.hipL][0] + P[j.hipR][0]) / 2;
        expect(Math.abs((P[j.kneeL][0] - mid) + (P[j.kneeR][0] - mid))).toBeLessThan(0.02 * m.height);
        expect(Math.abs(P[j.kneeL][1] - P[j.kneeR][1])).toBeLessThan(0.01 * m.height);
      });
    }

    it('a bigger belly opens her thighs wider', () => {
      for (const style of BIRTH_STYLES) expect(birthSpread(style, 2)).toBeGreaterThan(birthSpread(style, 1));
      const at = (bump: number) => { const P = posedJoints(bind, poseBirth(m, bind, { style: 'squat', seconds: 0, bump }, [])); return Math.abs(P[j.kneeL][0] - P[j.kneeR][0]); };
      expect(at(2)).toBeGreaterThan(at(1));
    });

    it('squatting, her knees come up near her hips and her ankles are well below them, under her', () => {
      const P = posedJoints(bind, poseBirth(m, bind, { style: 'squat', seconds: 0, bump: 1 }, []));
      expect(P[j.kneeL][1]).toBeGreaterThan(P[j.hipL][1] - 0.12 * m.legLength);
      expect(P[j.ankleL][1]).toBeLessThan(P[j.kneeL][1] - 0.3 * m.legLength);
    });

    it('only RECLINE leans her back; standing apart her knees are only a little bent', () => {
      expect(BIRTH_POSES.recline.leanBack).toBeGreaterThan(20);
      expect(BIRTH_POSES.apart.leanBack).toBe(0); expect(BIRTH_POSES.squat.leanBack).toBe(0);
      const P = posedJoints(bind, poseBirth(m, bind, { style: 'apart', seconds: 0, bump: 1 }, []));
      const drop = bind[j.hipL].y - bind[j.ankleL].y, now = P[j.hipL][1] - P[j.ankleL][1];
      expect(now).toBeGreaterThan(0.8 * drop); expect(now).toBeLessThan(drop);
    });
  });
}
