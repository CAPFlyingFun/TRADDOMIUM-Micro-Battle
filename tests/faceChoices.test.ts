import { describe, expect, it } from 'vitest';
import { EYE_MODES, IRIS_CHOICES, browsLine, eyesLine, lipsLine, mouthLine, nextEyeMode } from '../src/sarahlab/faceChoices';
import { FACE_DEFAULTS } from '../src/sarahlab/faceRig';

describe("the FACE section's face controls (Joshua, 2026-10-24: a mouth that opens like talking, eyes that look around in sync)", () => {
  it('EYES steps through looking around, at the camera and ahead, and comes round', () => {
    expect(EYE_MODES[0]).toBe('around');
    let m = EYE_MODES[0];
    const seen = [m];
    for (let i = 0; i < EYE_MODES.length - 1; i++) { m = nextEyeMode(m); seen.push(m); }
    expect(new Set(seen).size).toBe(EYE_MODES.length);
    expect(nextEyeMode(m)).toBe(EYE_MODES[0]);
    expect(eyesLine('camera')).toBe('EYES · AT THE CAMERA');
  });

  it("opens on her reference sheet's hazel eyes, the face's own default", () => {
    expect(IRIS_CHOICES[0].name).toBe('hazel');
    expect(IRIS_CHOICES[0].linear).toEqual(FACE_DEFAULTS.iris);
    for (const c of IRIS_CHOICES) { expect(c.swatch).toMatch(/^#[0-9a-f]{6}$/); for (const v of c.linear) expect(v).toBeGreaterThanOrEqual(0); }
  });

  it('reads its sliders', () => {
    expect(mouthLine(0, false)).toBe('MOUTH · closed');
    expect(mouthLine(40, true)).toBe('MOUTH · 40% open · and talking');
    expect(browsLine(0)).toContain('none');
    expect(lipsLine(55)).toBe('LIP COLOUR · 55%');
  });
});
