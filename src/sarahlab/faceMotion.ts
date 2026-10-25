/**
 * WHAT MOVES HER FACE (Joshua, 2026-10-24, of Sarah v2: "would like to somehow add bones in or something around the
 * mouth to open and close like talking, and maybe the illusion of the eyes being able to look around in sync").
 *
 * `faceRig.ts` draws a jaw, a blink and a gaze on her body material; this is the small animator that decides them, one
 * `step` a frame: where the eyes look, when she blinks and how her jaw moves when she talks. It is pure -- no three, no
 * DOM, no clock of its own, no `Math.random` -- so the same seed and the same sequence of steps give the same face, and
 * a test can run a minute of it in a millisecond.
 *
 * THE EYES, three ways (`mode`):
 *  - AROUND, idle looking: hold a fixation for 0.5 to 2.6 s, then a saccade -- a fast, eased jump of about 45 ms (a
 *    little shorter for a small one, longer for a big one, as real saccades are) -- to somewhere new within 22° either
 *    side and from 12° down to 10° up, biased toward straight ahead, and every few fixations back to the middle. A jump
 *    is never smaller than 4°, so every one reads as a look rather than a twitch. Both eyes look the same way, at the
 *    same far point.
 *  - CAMERA, eye contact: each eye aims from its own centre at the camera, so a near camera draws them together the way
 *    a near face does. Past 30° either side or 25° up or down they hold at the edge. The edge is found for the pair, not
 *    for each eye, so a camera straight behind her does not send her eyes apart. No camera is AHEAD.
 *  - AHEAD: straight ahead.
 * In every mode a micro-jitter of up to 0.4° is redrawn about every 0.2 s, the small never-still drift of a living eye,
 * the same for both eyes. Changing mode is itself a saccade, timed by how far it goes.
 *
 * BLINKS (`blinking`): every 2 to 6 s, and sometimes (three in ten) straight after a big saccade, though never sooner
 * than 2 s after the last. A blink closes in 0.06 s, stays shut 0.02 s and opens in 0.09 s; a frame that steps across
 * the shut moment reads fully shut, so even a slow frame rate sees the lid all the way down.
 *
 * TALKING (`talking`): syllables of 0.12 to 0.24 s, each opening to between 0.25 and 0.7 and closing back to between
 * 0.05 and 0.15; phrases of 6 to 14 syllables with 0.3 to 0.8 s of closed mouth between them. `mouth` holds the jaw
 * open by hand. The jaw is the larger of the two, followed by a critically damped spring of about 30 ms so it never
 * snaps, and with neither it settles to exactly 0.
 *
 * The eyes, the blinks, the talking and the jitter each draw from their own seeded stream, so turning one on or off
 * leaves the others as they were. A step longer than a quarter of a second (a tab in the background) is taken as a
 * quarter of a second: the face resumes rather than replaying what it missed.
 */

/** How the eyes are driven. */
export type EyeMode = 'ahead' | 'around' | 'camera';

/**
 * The virtual eyeballs' centres in her rest frame (metres): `faceRig.ts`'s `FACE_EYE_CENTRES`, repeated here as plain
 * numbers so this file needs nothing of three (a test holds the two equal).
 */
export const FACE_MOTION_EYE_CENTRES = {
  right: [-0.0302, 1.5835, -0.0115],
  left: [0.0305, 1.5835, -0.0115],
} as const;

const DEG = Math.PI / 180;

/** Every number the animator uses, in seconds, radians and 0..1 jaw. */
export const FACE_MOTION = {
  around: {
    holdMin: 0.5, holdMax: 2.6,
    yaw: 22 * DEG, pitchUp: 10 * DEG, pitchDown: 12 * DEG,
    /** A target is drawn as sign(x)·|x|^bias of a uniform x in -1..1: above 1 leans toward straight ahead. */
    bias: 1.6,
    /** After this many fixations (drawn anew each time) the next saccade goes back to the middle. */
    centreMin: 3, centreMax: 6,
    minJump: 4 * DEG,
  },
  /** A saccade's duration: base + perDegree · its size in degrees, held within min..max (45 ms at 10°). */
  saccade: { base: 0.021, perDegree: 0.0024, min: 0.03, max: 0.075 },
  /** How far the eyes turn for a camera; past the edge each eye's own turn toward a near one fades out over `vergenceFade`. */
  camera: { yaw: 30 * DEG, pitch: 25 * DEG, vergenceFade: 20 * DEG },
  jitter: { amplitude: 0.4 * DEG, everyMin: 0.15, everyMax: 0.25, follow: 0.02 },
  blink: { everyMin: 2, everyMax: 6, afterBigSaccade: 0.3, bigSaccade: 10 * DEG, close: 0.06, shut: 0.02, open: 0.09 },
  talk: {
    syllableMin: 0.12, syllableMax: 0.24, openShare: 0.5,
    openMin: 0.25, openMax: 0.7, closeMin: 0.05, closeMax: 0.15,
    phraseMin: 6, phraseMax: 14, pauseMin: 0.3, pauseMax: 0.8,
  },
  /** The jaw's spring: critically damped, this time constant. */
  jawFollow: 0.03,
  /** The longest step taken as it comes. */
  maxStep: 0.25,
} as const;

type Rng = () => number;
/** mulberry32: a small, fast, seedable generator, 0 <= r < 1. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** One seed into a stream per part of the face. */
function streamSeed(seed: number, stream: number): number {
  let h = Math.imul((seed >>> 0) ^ Math.imul(stream + 1, 0x85ebca6b), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 13;
  return h >>> 0;
}
const between = (r: Rng, lo: number, hi: number): number => lo + (hi - lo) * r();
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** Minimum jerk: the eased 0..1 of a saccade. */
const minJerk = (t: number): number => { const x = clamp(t, 0, 1); return x * x * x * (10 + x * (-15 + 6 * x)); };
const smooth = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
/** An angle wrapped into -π..π. */
const wrap = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/** How long a saccade of `size` radians takes: the main sequence, held within its bounds. */
function saccadeLength(size: number): number {
  const s = FACE_MOTION.saccade;
  return clamp(s.base + s.perDegree * (size / DEG), s.min, s.max);
}

/** A critically damped spring followed exactly over `h` toward a target held still: the new [x, v]. */
function follow(x: number, v: number, target: number, omega: number, h: number): [number, number] {
  const e = x - target, c = v + omega * e, decay = Math.exp(-omega * h);
  return [target + (e + c * h) * decay, (v - omega * c * h) * decay];
}

/** (yaw, pitch) in radians; yaw is toward her left (+x), pitch up. */
interface Look { yaw: number; pitch: number }
const look = (yaw = 0, pitch = 0): Look => ({ yaw, pitch });

type Effective = 'ahead' | 'around' | 'camera';
type TalkPhase = 'idle' | 'open' | 'close' | 'pause';

export class FaceMotion {
  /** How the eyes are driven; default 'around'. */
  mode: EyeMode = 'around';
  /** Whether she blinks; default true. */
  blinking = true;
  /** Whether she talks; default false. */
  talking = false;
  /** A jaw held open by hand, 0..1; default 0. The jaw is the larger of this and the talking. */
  mouth = 0;

  /** Where each eye looks, a unit vector in her rest frame. Updated in place by `step`. */
  readonly gazeRight: [number, number, number] = [0, 0, 1];
  readonly gazeLeft: [number, number, number] = [0, 0, 1];

  private readonly rngEyes: Rng;
  private readonly rngBlink: Rng;
  private readonly rngTalk: Rng;
  private readonly rngJitter: Rng;

  // the eyes
  private effective: Effective | null = null;
  private outRight: Look = look();
  private outLeft: Look = look();
  private blendFromRight: Look = look();
  private blendFromLeft: Look = look();
  private blendT = 1;
  private blendDuration = 1;
  /** A change of mode is a saccade sized by how far it goes, which is known once the new mode has aimed. */
  private blendSized = true;
  // AROUND
  private fixation: Look = look();
  private holdLeft = 0;
  private inSaccade = false;
  private saccadeFrom: Look = look();
  private saccadeTo: Look = look();
  private saccadeT = 0;
  private saccadeDuration = 0;
  private saccadeSize = 0;
  private untilCentre = 0;
  // the jitter
  private jitterYaw = 0;
  private jitterPitch = 0;
  private jitterYawV = 0;
  private jitterPitchV = 0;
  private jitterTargetYaw = 0;
  private jitterTargetPitch = 0;
  private jitterLeft = 0;
  // the blink
  private blinkT = -1;
  private sinceBlink = 0;
  private nextBlink: number;
  private blinkValue = 0;
  // the talking
  private talkPhase: TalkPhase = 'idle';
  private talkT = 0;
  private talkDuration = 0;
  private syllableOpen = 0;
  private syllableClose = 0;
  private closeDuration = 0;
  private syllablesLeft = 0;
  private jawX = 0;
  private jawV = 0;

  /** The same seed, the same face. */
  constructor(seed = 1) {
    const s = Number.isFinite(seed) ? Math.floor(seed) : 1;
    this.rngEyes = mulberry32(streamSeed(s, 0));
    this.rngBlink = mulberry32(streamSeed(s, 1));
    this.rngTalk = mulberry32(streamSeed(s, 2));
    this.rngJitter = mulberry32(streamSeed(s, 3));
    this.nextBlink = between(this.rngBlink, FACE_MOTION.blink.everyMin, FACE_MOTION.blink.everyMax);
    this.untilCentre = this.drawUntilCentre();
  }

  /** 0..1: 0 open, 1 shut. */
  get blink(): number { return this.blinkValue; }
  /** 0..1: how far the jaw is open. */
  get jaw(): number { return this.jawX; }

  /** Advance by `dt` seconds; `camera` is the camera in her rest frame (metres), or null. */
  step(dt: number, camera: readonly [number, number, number] | null): void {
    const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, FACE_MOTION.maxStep) : 0;
    this.stepJitter(h);
    const effective: Effective = this.mode === 'around' ? 'around' : this.mode === 'camera' && camera ? 'camera' : 'ahead';
    if (effective !== this.effective) this.enter(effective);
    const bigSaccadeEnded = effective === 'around' ? this.stepAround(h) : false;
    let right: Look, left: Look;
    if (effective === 'around') {
      right = this.aroundLook();
      left = right;
    } else if (effective === 'camera' && camera) {
      [right, left] = this.cameraLooks(camera);
    } else {
      right = left = look();
    }
    if (!this.blendSized) {
      const size = Math.max(
        Math.hypot(right.yaw - this.blendFromRight.yaw, right.pitch - this.blendFromRight.pitch),
        Math.hypot(left.yaw - this.blendFromLeft.yaw, left.pitch - this.blendFromLeft.pitch));
      this.blendDuration = saccadeLength(size);
      this.blendSized = true;
    }
    if (this.blendT < this.blendDuration) {
      this.blendT = Math.min(this.blendDuration, this.blendT + h);
      const k = minJerk(this.blendT / this.blendDuration);
      right = look(this.blendFromRight.yaw + (right.yaw - this.blendFromRight.yaw) * k, this.blendFromRight.pitch + (right.pitch - this.blendFromRight.pitch) * k);
      left = look(this.blendFromLeft.yaw + (left.yaw - this.blendFromLeft.yaw) * k, this.blendFromLeft.pitch + (left.pitch - this.blendFromLeft.pitch) * k);
    }
    this.outRight = right;
    this.outLeft = left;
    toVector(right.yaw + this.jitterYaw, right.pitch + this.jitterPitch, this.gazeRight);
    toVector(left.yaw + this.jitterYaw, left.pitch + this.jitterPitch, this.gazeLeft);
    this.stepBlink(h, bigSaccadeEnded);
    this.stepTalk(h);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the eyes

  private enter(effective: Effective): void {
    this.blendFromRight = { ...this.outRight };
    this.blendFromLeft = { ...this.outLeft };
    this.blendT = 0;
    this.blendSized = false;
    if (effective === 'around') {
      const a = FACE_MOTION.around;
      this.fixation = look(
        clamp((this.outRight.yaw + this.outLeft.yaw) / 2, -a.yaw, a.yaw),
        clamp((this.outRight.pitch + this.outLeft.pitch) / 2, -a.pitchDown, a.pitchUp),
      );
      this.inSaccade = false;
      this.holdLeft = between(this.rngEyes, a.holdMin, a.holdMax);
    }
    this.effective = effective;
  }

  private aroundLook(): Look {
    if (!this.inSaccade) return this.fixation;
    const k = minJerk(this.saccadeT / this.saccadeDuration);
    return look(
      this.saccadeFrom.yaw + (this.saccadeTo.yaw - this.saccadeFrom.yaw) * k,
      this.saccadeFrom.pitch + (this.saccadeTo.pitch - this.saccadeFrom.pitch) * k,
    );
  }

  /** Run AROUND's fixations and saccades for `h`; true if a big saccade ended in it. */
  private stepAround(h: number): boolean {
    const a = FACE_MOTION.around;
    let left = h, big = false;
    for (let guard = 0; left > 0 && guard < 64; guard++) {
      if (this.inSaccade) {
        const take = Math.min(left, this.saccadeDuration - this.saccadeT);
        this.saccadeT += take;
        left -= take;
        if (this.saccadeT >= this.saccadeDuration) {
          this.inSaccade = false;
          this.fixation = this.saccadeTo;
          this.holdLeft = between(this.rngEyes, a.holdMin, a.holdMax);
          if (this.saccadeSize >= FACE_MOTION.blink.bigSaccade) big = true;
        }
      } else {
        const take = Math.min(left, this.holdLeft);
        this.holdLeft -= take;
        left -= take;
        if (this.holdLeft <= 0) this.startSaccade();
      }
    }
    return big;
  }

  private startSaccade(): void {
    const a = FACE_MOTION.around, from = this.fixation;
    const size = (to: Look): number => Math.hypot(to.yaw - from.yaw, to.pitch - from.pitch);
    let to: Look | null = null;
    this.untilCentre -= 1;
    if (this.untilCentre <= 0) {
      this.untilCentre = this.drawUntilCentre();
      if (size(look()) >= a.minJump) to = look();
    }
    if (!to) {
      // a few draws for one big enough to read as a look; failing that, the biggest of them
      let best = look(), bestSize = -1;
      for (let i = 0; i < 8; i++) {
        const x = 2 * this.rngEyes() - 1, y = 2 * this.rngEyes() - 1;
        const leanX = Math.sign(x) * Math.pow(Math.abs(x), a.bias), leanY = Math.sign(y) * Math.pow(Math.abs(y), a.bias);
        const candidate = look(a.yaw * leanX, leanY >= 0 ? a.pitchUp * leanY : a.pitchDown * leanY);
        const s = size(candidate);
        if (s > bestSize) { best = candidate; bestSize = s; }
        if (s >= a.minJump) break;
      }
      to = best;
    }
    this.saccadeFrom = from;
    this.saccadeTo = to;
    this.saccadeSize = size(to);
    this.saccadeT = 0;
    this.saccadeDuration = saccadeLength(this.saccadeSize);
    this.inSaccade = true;
  }

  private drawUntilCentre(): number {
    const a = FACE_MOTION.around;
    return a.centreMin + Math.floor(this.rngEyes() * (a.centreMax - a.centreMin + 1));
  }

  /**
   * Each eye's look at the camera, held at the edge of what eyes can turn to. The edge is found for the PAIR (the point
   * between the eyes) and each eye keeps its own turn toward the camera on top of it, so a near camera converges them;
   * once the pair is past the edge that turn fades out over `vergenceFade`, so a camera behind her, whose direction
   * from each eye is nearly straight back and differs in sign across the middle, leaves both at the same edge.
   */
  private cameraLooks(camera: readonly [number, number, number]): [Look, Look] {
    const c = FACE_MOTION.camera, e = FACE_MOTION_EYE_CENTRES;
    const toward = (from: readonly number[]): Look => {
      const dx = camera[0] - from[0], dy = camera[1] - from[1], dz = camera[2] - from[2];
      return dx === 0 && dy === 0 && dz === 0 ? look() : look(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz)));
    };
    const middle = [(e.right[0] + e.left[0]) / 2, (e.right[1] + e.left[1]) / 2, (e.right[2] + e.left[2]) / 2];
    const pair = toward(middle);
    const pairYaw = clamp(pair.yaw, -c.yaw, c.yaw);
    const keep = 1 - smooth((Math.abs(pair.yaw) - c.yaw) / c.vergenceFade);
    const one = (from: readonly number[]): Look => {
      const own = toward(from);
      return look(clamp(pairYaw + keep * wrap(own.yaw - pair.yaw), -c.yaw, c.yaw), clamp(own.pitch, -c.pitch, c.pitch));
    };
    return [one(e.right), one(e.left)];
  }

  private stepJitter(h: number): void {
    const j = FACE_MOTION.jitter;
    this.jitterLeft -= h;
    for (let guard = 0; this.jitterLeft <= 0 && guard < 16; guard++) {
      this.jitterTargetYaw = between(this.rngJitter, -j.amplitude, j.amplitude);
      this.jitterTargetPitch = between(this.rngJitter, -j.amplitude, j.amplitude);
      this.jitterLeft += between(this.rngJitter, j.everyMin, j.everyMax);
    }
    if (h > 0) {
      [this.jitterYaw, this.jitterYawV] = follow(this.jitterYaw, this.jitterYawV, this.jitterTargetYaw, 1 / j.follow, h);
      [this.jitterPitch, this.jitterPitchV] = follow(this.jitterPitch, this.jitterPitchV, this.jitterTargetPitch, 1 / j.follow, h);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the blink

  private stepBlink(h: number, bigSaccadeEnded: boolean): void {
    const b = FACE_MOTION.blink, total = b.close + b.shut + b.open;
    let crossedShut = false;
    if (this.blinkT >= 0) {
      if (this.blinkT >= total) {
        this.blinkT = -1; // a blink whose last step was held shut ends now
      } else {
        const before = this.blinkT;
        this.blinkT += h;
        crossedShut = before <= b.close + b.shut && this.blinkT >= b.close;
        if (this.blinkT >= total && !crossedShut) this.blinkT = -1;
      }
    }
    this.sinceBlink += h;
    if (this.blinkT < 0 && this.blinking) {
      let start = -1;
      if (this.sinceBlink >= this.nextBlink) start = Math.min(this.sinceBlink - this.nextBlink, h);
      else if (bigSaccadeEnded && this.sinceBlink >= b.everyMin && this.rngBlink() < b.afterBigSaccade) start = 0;
      if (start >= 0) {
        this.blinkT = start;
        this.sinceBlink = start;
        this.nextBlink = between(this.rngBlink, b.everyMin, b.everyMax);
        crossedShut = start >= b.close;
      }
    }
    const t = this.blinkT;
    this.blinkValue = t < 0 ? 0
      : crossedShut ? 1
        : t < b.close ? smooth(t / b.close)
          : t <= b.close + b.shut ? 1
            : t < total ? 1 - smooth((t - b.close - b.shut) / b.open) : 0;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the talking and the jaw

  private stepTalk(h: number): void {
    const omega = 1 / FACE_MOTION.jawFollow, held = Number.isFinite(this.mouth) ? clamp(this.mouth, 0, 1) : 0;
    if (!this.talking) {
      this.talkPhase = 'idle';
      this.moveJaw(held, omega, h);
      return;
    }
    if (this.talkPhase === 'idle') this.startPhrase();
    let left = h;
    for (let guard = 0; left > 0 && guard < 64; guard++) {
      const take = Math.min(left, this.talkDuration - this.talkT);
      this.moveJaw(Math.max(held, this.talkTarget()), omega, take);
      this.talkT += take;
      left -= take;
      if (this.talkT >= this.talkDuration) this.nextTalkPhase();
    }
    if (h === 0) this.moveJaw(Math.max(held, this.talkTarget()), omega, 0);
  }

  private talkTarget(): number {
    return this.talkPhase === 'open' ? this.syllableOpen : this.talkPhase === 'close' ? this.syllableClose : 0;
  }

  private startPhrase(): void {
    const t = FACE_MOTION.talk;
    this.syllablesLeft = t.phraseMin + Math.floor(this.rngTalk() * (t.phraseMax - t.phraseMin + 1));
    this.startSyllable();
  }

  private startSyllable(): void {
    const t = FACE_MOTION.talk;
    const length = between(this.rngTalk, t.syllableMin, t.syllableMax);
    this.syllableOpen = between(this.rngTalk, t.openMin, t.openMax);
    this.syllableClose = between(this.rngTalk, t.closeMin, t.closeMax);
    this.talkPhase = 'open';
    this.talkT = 0;
    this.talkDuration = length * t.openShare;
    this.syllablesLeft -= 1;
    this.closeDuration = length * (1 - t.openShare);
  }

  private nextTalkPhase(): void {
    const t = FACE_MOTION.talk;
    this.talkT = 0;
    if (this.talkPhase === 'open') {
      this.talkPhase = 'close';
      this.talkDuration = this.closeDuration;
    } else if (this.talkPhase === 'close') {
      if (this.syllablesLeft > 0) this.startSyllable();
      else { this.talkPhase = 'pause'; this.talkDuration = between(this.rngTalk, t.pauseMin, t.pauseMax); }
    } else {
      this.startPhrase();
    }
  }

  private moveJaw(target: number, omega: number, h: number): void {
    if (h > 0) [this.jawX, this.jawV] = follow(this.jawX, this.jawV, target, omega, h);
    if (this.jawX < 0) { this.jawX = 0; this.jawV = Math.max(0, this.jawV); }
    if (this.jawX > 1) { this.jawX = 1; this.jawV = Math.min(0, this.jawV); }
    // a spring only approaches its rest; close enough is there, so a closed mouth is exactly closed
    if (Math.abs(this.jawX - target) < 1e-6 && Math.abs(this.jawV) < 1e-4) { this.jawX = target; this.jawV = 0; }
  }
}

/** (yaw, pitch) to a unit direction in her rest frame, written into `out`. */
function toVector(yaw: number, pitch: number, out: [number, number, number]): void {
  const cp = Math.cos(pitch);
  out[0] = Math.sin(yaw) * cp;
  out[1] = Math.sin(pitch);
  out[2] = Math.cos(yaw) * cp;
}
