/**
 * WHAT MOVES HER FACE (Joshua, 2026-10-24: "...open and close like talking, and maybe the illusion of the eyes being able
 * to look around in sync"). `faceMotion.ts` decides the gaze, the blink and the jaw `faceRig.ts` draws. Here: the same
 * seed gives the same face; every gaze is a unit vector; looking AROUND stays inside its bounds and jumps at a living
 * eye's pace, coming back to the middle now and then; looking at the CAMERA converges on a near one and holds at the
 * edge for one behind her; blinks come every 2 to 6 s and close all the way, even at a slow frame rate; talking opens and
 * closes the jaw several times a second with rests between phrases, and with nothing to say the jaw is exactly shut.
 * And the file is pure: nothing of three, the DOM, a clock or `Math.random`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACE_MOTION, FACE_MOTION_EYE_CENTRES, FaceMotion, type EyeMode } from '../src/sarahlab/faceMotion';

type V = readonly [number, number, number];
const DEG = Math.PI / 180;
const FRAME = 1 / 60;
const angle = (a: V, b: V): number => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
const yawOf = (g: V): number => Math.atan2(g[0], g[2]);
const pitchOf = (g: V): number => Math.asin(g[1]);
const length = (g: V): number => Math.hypot(g[0], g[1], g[2]);

interface Frame { t: number; right: V; left: V; blink: number; jaw: number }
/** Run a face for `seconds` at a fixed step, recording every frame. */
function run(face: FaceMotion, seconds: number, camera: V | null = null, dt = FRAME): Frame[] {
  const frames: Frame[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    face.step(dt, camera);
    frames.push({ t: (i + 1) * dt, right: [...face.gazeRight], left: [...face.gazeLeft], blink: face.blink, jaw: face.jaw });
  }
  return frames;
}
const withMode = (mode: EyeMode, seed = 7, o: Partial<Pick<FaceMotion, 'blinking' | 'talking' | 'mouth'>> = {}): FaceMotion => {
  const face = new FaceMotion(seed);
  face.mode = mode;
  Object.assign(face, o);
  return face;
};
/** The frames at which a saccade begins: the gaze turning more than a degree in a frame, a tenth of a second apart. */
function saccadeStarts(frames: Frame[]): number[] {
  const starts: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (angle(frames[i].right, frames[i - 1].right) > 1 * DEG && (starts.length === 0 || frames[i].t - starts[starts.length - 1] > 0.1)) starts.push(frames[i - 1].t);
  }
  return starts;
}
/** The times blinks begin: the blink leaving 0. */
function blinkStarts(frames: Frame[]): number[] {
  const starts: number[] = [];
  for (let i = 1; i < frames.length; i++) if (frames[i].blink > 0 && frames[i - 1].blink === 0) starts.push(frames[i - 1].t);
  return starts;
}

describe('the same seed, the same face', () => {
  it('two faces of one seed, stepped alike through every mode, agree on every frame; another seed does not', () => {
    const script = (face: FaceMotion): Frame[] => {
      const frames: Frame[] = [];
      for (let i = 0; i < 3000; i++) {
        if (i === 600) face.mode = 'camera';
        if (i === 900) face.talking = true;
        if (i === 1500) face.mode = 'ahead';
        if (i === 1800) { face.mode = 'around'; face.mouth = 0.3; }
        if (i === 2400) face.talking = false;
        const dt = 0.01 + 0.012 * ((i * 7) % 5) / 4;
        face.step(dt, i % 400 < 300 ? [0.1 * Math.sin(i / 50), 1.6, 0.6] : null);
        frames.push({ t: i, right: [...face.gazeRight], left: [...face.gazeLeft], blink: face.blink, jaw: face.jaw });
      }
      return frames;
    };
    const a = script(new FaceMotion(42)), b = script(new FaceMotion(42)), c = script(new FaceMotion(43));
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('defaults: looking around, blinking, not talking, mouth shut', () => {
    const face = new FaceMotion();
    expect([face.mode, face.blinking, face.talking, face.mouth, face.blink, face.jaw]).toEqual(['around', true, false, 0, 0, 0]);
    expect(face.gazeRight).toEqual([0, 0, 1]);
    expect(face.gazeLeft).toEqual([0, 0, 1]);
  });

  it('the eyes do not change when she starts talking or stops blinking: each part draws from its own stream', () => {
    const plain = run(withMode('around', 5), 20);
    const busy = run(withMode('around', 5, { talking: true, blinking: false }), 20);
    expect(busy.map((f) => [f.right, f.left])).toEqual(plain.map((f) => [f.right, f.left]));
  });
});

describe('the gaze', () => {
  it('is always a unit vector, whatever the mode, the camera or the step', () => {
    const face = new FaceMotion(3);
    const modes: EyeMode[] = ['around', 'camera', 'ahead'];
    for (let i = 0; i < 4000; i++) {
      if (i % 500 === 0) face.mode = modes[(i / 500) % 3];
      const dt = [FRAME, 0.001, 0.05, 0.3, 0, -1, Number.NaN][i % 7];
      face.step(dt, i % 3 === 0 ? null : [Math.sin(i) * 2, 1.6 + Math.cos(i), Math.cos(i * 0.3) * 2]);
      for (const g of [face.gazeRight, face.gazeLeft]) {
        expect(g.every(Number.isFinite)).toBe(true);
        expect(Math.abs(length(g) - 1)).toBeLessThan(1e-12);
      }
      expect(face.blink).toBeGreaterThanOrEqual(0);
      expect(face.blink).toBeLessThanOrEqual(1);
    }
  });

  it('AROUND stays inside its bounds for a minute at 60 fps, both eyes looking the same way', () => {
    for (const seed of [1, 2, 3]) {
      const frames = run(withMode('around', seed), 60);
      const jitter = FACE_MOTION.jitter.amplitude + 0.05 * DEG;
      for (const f of frames) {
        expect(Math.abs(yawOf(f.right))).toBeLessThanOrEqual(FACE_MOTION.around.yaw + jitter);
        expect(pitchOf(f.right)).toBeLessThanOrEqual(FACE_MOTION.around.pitchUp + jitter);
        expect(pitchOf(f.right)).toBeGreaterThanOrEqual(-FACE_MOTION.around.pitchDown - jitter);
        expect(f.left).toEqual(f.right);
      }
      // and it uses the room it has
      const yaws = frames.map((f) => yawOf(f.right) / DEG);
      expect(Math.max(...yaws) - Math.min(...yaws)).toBeGreaterThan(15);
    }
  });

  it('AROUND holds 0.5 to 2.6 s between saccades of a few tens of milliseconds', () => {
    for (const seed of [1, 9, 17]) {
      const frames = run(withMode('around', seed), 60);
      const starts = saccadeStarts(frames);
      expect(starts.length).toBeGreaterThanOrEqual(Math.floor(60 / 2.7));
      expect(starts.length).toBeLessThanOrEqual(Math.ceil(60 / 0.5));
      const gaps = starts.slice(1).map((t, i) => t - starts[i]);
      for (const gap of gaps) {
        expect(gap).toBeGreaterThanOrEqual(FACE_MOTION.around.holdMin - FRAME);
        expect(gap).toBeLessThanOrEqual(FACE_MOTION.around.holdMax + FACE_MOTION.saccade.max + 2 * FRAME);
      }
      // about every 1.6 s on average
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(mean).toBeGreaterThan(1.0);
      expect(mean).toBeLessThan(2.2);
      // each jump is quick: done within a tenth of a second, and at least four degrees
      for (const t of starts) {
        const i = frames.findIndex((f) => f.t >= t);
        const before = frames[Math.max(0, i - 1)].right, after = frames[Math.min(frames.length - 1, i + 6)].right;
        expect(angle(before, after) / DEG).toBeGreaterThan(FACE_MOTION.around.minJump / DEG - 1);
        let moving = 0;
        for (let k = i; k < Math.min(frames.length, i + 12); k++) if (angle(frames[k].right, frames[k - 1].right) > 1 * DEG) moving++;
        expect(moving * FRAME).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('AROUND comes back to the middle every few fixations', () => {
    const frames = run(withMode('around', 4), 60);
    const starts = saccadeStarts(frames);
    let centred = 0;
    for (let k = 0; k + 1 < starts.length; k++) {
      // the middle of a hold
      const mid = frames.find((f) => f.t >= (starts[k] + starts[k + 1]) / 2)!;
      if (Math.abs(yawOf(mid.right)) < 0.6 * DEG && Math.abs(pitchOf(mid.right)) < 0.6 * DEG) centred++;
    }
    expect(centred).toBeGreaterThanOrEqual(Math.floor(starts.length / (FACE_MOTION.around.centreMax + 1)));
    expect(centred).toBeLessThanOrEqual(Math.ceil(starts.length / 2));
  });

  it('AHEAD looks straight ahead, never further off than the jitter', () => {
    const frames = run(withMode('ahead'), 10);
    for (const f of frames.slice(5)) {
      expect(angle(f.right, [0, 0, 1])).toBeLessThan(FACE_MOTION.jitter.amplitude * Math.SQRT2 + 0.05 * DEG);
      expect(f.left).toEqual(f.right);
    }
    // and the jitter is there: a living eye is never quite still
    const spread = Math.max(...frames.map((f) => angle(f.right, [0, 0, 1])));
    expect(spread).toBeGreaterThan(0.1 * DEG);
  });

  it('CAMERA converges on a camera 40 cm in front: the right eye turns toward +x, the left toward -x', () => {
    const e = FACE_MOTION_EYE_CENTRES;
    const camera: V = [0, e.right[1], e.right[2] + 0.4];
    const f = run(withMode('camera'), 1, camera).at(-1)!;
    expect(f.right[0]).toBeGreaterThan(0);
    expect(f.left[0]).toBeLessThan(0);
    // each eye looks at it from its own centre, give or take the jitter
    for (const [g, c] of [[f.right, e.right], [f.left, e.left]] as const) {
      const d = [camera[0] - c[0], camera[1] - c[1], camera[2] - c[2]], n = Math.hypot(d[0], d[1], d[2]);
      expect(angle(g, [d[0] / n, d[1] / n, d[2] / n])).toBeLessThan(0.6 * DEG);
    }
    // a far camera, nearly parallel
    const far = run(withMode('camera'), 1, [0, e.right[1], 20]).at(-1)!;
    expect(angle(far.right, far.left)).toBeLessThan(0.3 * DEG);
    expect(angle(f.right, f.left)).toBeGreaterThan(angle(far.right, far.left) + 4 * DEG);
  });

  it('CAMERA follows a camera off to one side and above, and holds at the edge past it', () => {
    const at = (camera: V): Frame => run(withMode('camera'), 1, camera).at(-1)!;
    const side = at([0.5, 1.6, 1.5]);
    expect(yawOf(side.right) / DEG).toBeGreaterThan(15);
    expect(yawOf(side.right) / DEG).toBeLessThan(FACE_MOTION.camera.yaw / DEG);
    const tol = FACE_MOTION.jitter.amplitude + 0.05 * DEG;
    // straight up and well to her right: held at the edge
    const high = at([-3, 5, 0.5]);
    for (const g of [high.right, high.left]) {
      expect(Math.abs(pitchOf(g) - FACE_MOTION.camera.pitch)).toBeLessThan(tol);
      expect(Math.abs(yawOf(g) + FACE_MOTION.camera.yaw)).toBeLessThan(tol);
    }
    // behind her: both eyes held at the same edge, never sent apart
    for (const behind of [[0, 1.58, -1], [0.2, 1.6, -0.5], [-0.2, 1.6, -0.5], [0, 1.58, -0.05]] as V[]) {
      const f = at(behind);
      expect(Math.abs(Math.abs(yawOf(f.right)) - FACE_MOTION.camera.yaw), String(behind)).toBeLessThan(tol);
      expect(Math.abs(Math.abs(yawOf(f.left)) - FACE_MOTION.camera.yaw), String(behind)).toBeLessThan(tol + 4 * DEG);
      expect(Math.sign(yawOf(f.right))).toBe(Math.sign(yawOf(f.left)));
    }
  });

  it('CAMERA with no camera looks ahead, and changing mode moves the eyes like a saccade, not a cut', () => {
    const none = run(withMode('camera'), 1, null).at(-1)!;
    expect(angle(none.right, [0, 0, 1])).toBeLessThan(FACE_MOTION.jitter.amplitude * Math.SQRT2 + 0.05 * DEG);
    const face = withMode('camera');
    run(face, 1, [-3, 1.6, 0.5]);
    const from: V = [...face.gazeRight];
    face.mode = 'ahead';
    const frames = run(face, 0.3);
    let biggest = angle(frames[0].right, from);
    for (let i = 1; i < frames.length; i++) biggest = Math.max(biggest, angle(frames[i].right, frames[i - 1].right));
    expect(biggest).toBeLessThan(15 * DEG);
    expect(angle(frames.at(-1)!.right, [0, 0, 1])).toBeLessThan(FACE_MOTION.jitter.amplitude * Math.SQRT2 + 0.05 * DEG);
  });
});

describe('the blink', () => {
  it('comes every 2 to 6 s, closes all the way and is quick', () => {
    for (const mode of ['ahead', 'around'] as const) {
      const frames = run(withMode(mode, 11), 180);
      const starts = blinkStarts(frames);
      expect(starts.length).toBeGreaterThanOrEqual(Math.floor(180 / 6.1));
      expect(starts.length).toBeLessThanOrEqual(Math.ceil(180 / 1.9));
      for (let k = 1; k < starts.length; k++) {
        expect(starts[k] - starts[k - 1], mode).toBeGreaterThanOrEqual(FACE_MOTION.blink.everyMin - FRAME);
        expect(starts[k] - starts[k - 1], mode).toBeLessThanOrEqual(FACE_MOTION.blink.everyMax + 2 * FRAME);
      }
      const b = FACE_MOTION.blink, total = b.close + b.shut + b.open;
      for (const t of starts) {
        const during = frames.filter((f) => f.t > t && f.t <= t + total + 2 * FRAME);
        expect(Math.max(...during.map((f) => f.blink))).toBe(1);
        expect(during.filter((f) => f.blink > 0).length * FRAME).toBeLessThanOrEqual(total + 2 * FRAME);
      }
    }
  });

  it('reaches fully shut even at 20 fps and at 12 fps', () => {
    for (const dt of [1 / 20, 1 / 12]) {
      const frames = run(withMode('ahead', 2), 60, null, dt);
      const starts = blinkStarts(frames);
      expect(starts.length).toBeGreaterThan(8);
      for (const t of starts) expect(Math.max(...frames.filter((f) => f.t > t && f.t <= t + 0.3).map((f) => f.blink))).toBe(1);
    }
  });

  it('sometimes comes straight after a big saccade', () => {
    const frames = run(withMode('around', 6), 600);
    const saccades = saccadeStarts(frames);
    const blinks = blinkStarts(frames);
    // a blink within a tenth of a second of a saccade's start is one the saccade brought
    const after = blinks.filter((t) => saccades.some((s) => t >= s && t - s < 0.1)).length;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(blinks.length);
  });

  it('stops when blinking is off, and finishes the blink it was in', () => {
    const face = withMode('ahead', 8);
    let frames = run(face, 30);
    const i = frames.findIndex((f) => f.blink > 0);
    expect(i).toBeGreaterThan(0);
    // rewind to just after a blink starts, then switch it off
    const again = withMode('ahead', 8);
    frames = run(again, frames[i].t);
    again.blinking = false;
    const rest = run(again, 30);
    expect(Math.max(...rest.slice(0, 12).map((f) => f.blink))).toBe(1);
    expect(rest.slice(12).every((f) => f.blink === 0)).toBe(true);
  });
});

describe('the jaw', () => {
  it('talking opens and closes it several times a second, inside 0..1, resting between phrases', () => {
    for (const seed of [1, 2]) {
      const frames = run(withMode('ahead', seed, { talking: true }), 30);
      for (const f of frames) { expect(f.jaw).toBeGreaterThanOrEqual(0); expect(f.jaw).toBeLessThanOrEqual(1); }
      // openings: a rise of 0.06 from the last low (syllables close only to 0.05..0.15, not to 0), then a fall of 0.06
      let openings = 0, lo = frames[0].jaw, hi = frames[0].jaw, up = false;
      for (const f of frames) {
        if (up) { if (f.jaw > hi) hi = f.jaw; else if (f.jaw < hi - 0.06) { up = false; lo = f.jaw; } }
        else if (f.jaw < lo) lo = f.jaw;
        else if (f.jaw > lo + 0.06) { up = true; openings++; hi = f.jaw; }
      }
      expect(openings / 30).toBeGreaterThan(2);
      expect(openings / 30).toBeLessThan(1 / FACE_MOTION.talk.syllableMin);
      expect(Math.max(...frames.map((f) => f.jaw))).toBeGreaterThan(0.3);
      // rests: at least 0.12 s nearly shut, every few seconds
      let rests = 0, run0 = 0;
      for (const f of frames) {
        if (f.jaw < 0.03) run0 += FRAME; else { if (run0 >= 0.12) rests++; run0 = 0; }
      }
      expect(rests).toBeGreaterThanOrEqual(Math.floor(30 / 4));
    }
  });

  it('with nothing to say and no mouth held, it is exactly shut, and settles to exactly shut within a second of stopping', () => {
    const quiet = run(withMode('around', 3), 10);
    expect(quiet.every((f) => f.jaw === 0)).toBe(true);
    const face = withMode('ahead', 3, { talking: true });
    run(face, 3.3);
    face.talking = false;
    const after = run(face, 1);
    expect(after.at(-1)!.jaw).toBe(0);
    // and gently: no frame drops it by more than a third of the way
    for (let i = 1; i < 6; i++) expect(after[i - 1].jaw - after[i].jaw).toBeLessThan(0.35);
  });

  it('holds a mouth open by hand, talking over it never closing below it', () => {
    const held = withMode('ahead', 3, { mouth: 0.6 });
    const frames = run(held, 1);
    expect(frames.at(-1)!.jaw).toBe(0.6);
    expect(frames[1].jaw).toBeLessThan(0.6); // eased in, not cut
    held.talking = true;
    for (const f of run(held, 5)) expect(f.jaw).toBeGreaterThanOrEqual(0.6 - 1e-6);
    held.talking = false;
    held.mouth = 0;
    expect(run(held, 1).at(-1)!.jaw).toBe(0);
    // a mouth out of range is clamped
    const wide = withMode('ahead', 3, { mouth: 4 });
    expect(run(wide, 1).at(-1)!.jaw).toBe(1);
  });
});

describe('the file', () => {
  it('is pure: nothing of three, the DOM, a clock or Math.random', () => {
    const source = readFileSync('src/sarahlab/faceMotion.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(source).not.toMatch(/\bimport\b/);
    for (const word of ['three', 'THREE', 'window', 'document', 'performance', 'Date', 'Math.random', 'requestAnimationFrame', 'localStorage']) {
      expect(source, word).not.toMatch(new RegExp(`\\b${word.replace('.', '\\.')}\\b`));
    }
  });
});
