/**
 * THE PULSE: what one sweep of the antennae DOES over the ten seconds it
 * lasts, reduced to a single number per distance.
 *
 * A ping is not a switch. It leaves the ant, travels out to the edge of
 * the antennae's reach, holds everything it touched lit for as long as
 * the sense lasts, ebbs, and then costs a few seconds before another one
 * can be sent. Four phases and one clock — and no per-thing bookkeeping
 * anywhere in the feature: the selection and the renderers ask
 * `strengthAt` how bright something at that distance is right now and
 * multiply their opacity by the answer. Nothing else decides how bright
 * anything is (`senseTypes.Sighting.strength` says so).
 *
 * THE WAVE IS A DISC, NOT A RING. Everything here could be recomputed
 * from the clock each frame except one fact: a thing the front has
 * already passed must STAY lit behind it, or the sweep reads as a
 * travelling hoop and the forest goes dark a tenth of a second after it
 * lit up. So `front` is a high-water mark that only rises while a ping
 * is alive — the single latch this feature has, and therefore one field
 * of one named state object rather than a handful of loose ones.
 *
 * SIMULATION SECONDS, NEVER WALL CLOCK. `tick` takes the simulation's
 * dt, so a paused game holds the sweep where it is and a headless probe
 * running at a frame and a half a second does not spend the whole ten
 * seconds in six frames.
 *
 * Pure: no three, no DOM, no storage. Only `senseTypes` is upstream of
 * it, and this file does not even need that.
 */

/**
 * How far a sweep reaches, world units — six metres, at one unit a
 * centimetre. GAME TUNING, and the number this whole feature is
 * balanced around.
 *
 * He asked for "a close radius". Six metres is 600 body lengths to an
 * ant and still close: far enough to answer for the twig behind you and
 * the worm under the leaf you are standing on, near enough that a
 * forest floor does not come back with a hundred names. It is also what
 * the caps in `select.ts` were chosen against — widen this and that
 * lawn arrives.
 */
export const SENSE_RADIUS = 600;

/**
 * How long the wavefront takes to cross the full radius, seconds. GAME
 * TUNING.
 *
 * At `SENSE_RADIUS` that is 7.5 m/s, and about fifty frames on a phone:
 * slow enough that the cascade from your feet outward is a movement the
 * eye follows, fast enough that you are never waiting on your own
 * sense. Take it much below a quarter of a second and the front stops
 * being visible at all, at which point it should be deleted rather than
 * kept as a number nobody can see.
 */
export const SWEEP_SECONDS = 0.8;

/**
 * How long everything the sweep reached stays fully lit, seconds.
 *
 * His number, in his words: "the whole thing last about 10s per
 * ping/sense". The sweep and the fade are the top and tail either side
 * of it, so a ping's lit life is a little over twelve seconds and reads
 * as "about ten".
 */
export const HOLD_SECONDS = 10;

/**
 * How long the sense takes to ebb, seconds. GAME TUNING.
 *
 * Long enough to read as the sense fading rather than as the labels
 * being switched off — at this contrast a cut looks like a bug — and
 * short enough that the player is not walking through half-lit names
 * wondering whether the ping is still up.
 */
export const FADE_SECONDS = 1.5;

/**
 * How long after the fade before another ping is allowed, seconds.
 * GAME TUNING.
 *
 * A ping has to cost something or it stops being a sense and becomes a
 * permanent overlay of the world, which is not what he asked for. It
 * also must not be a punishment on a phone, where there is one thumb
 * and no patience. Four seconds is about the time it takes to walk out
 * of the patch you just lit, so the rhythm is ping, move, ping rather
 * than ping and wait.
 */
export const COOLDOWN_SECONDS = 4;

/**
 * How long a thing takes to come up to full after the front touches it,
 * seconds. GAME TUNING.
 *
 * Without it the wave is a hard-edged growing disc; with it the edge has
 * a width and the thing reads as a wave. An eighth of a second is about
 * eight frames — enough to see, too short for anything to be noticeably
 * dim by the time the front has moved on.
 */
export const WAKE_SECONDS = 0.12;

/**
 * What a thing at the very rim is lit to, against 1 at your feet. GAME
 * TUNING.
 *
 * Not 0: something that faded to nothing exactly at the rim would blink
 * in and out as the player walks, and the rim is where the new
 * information is. Not 1 either: the screenshots read their depth off
 * the fill — near things solid, far ones ghosts — and it is the honest
 * shape for a sense of touch and scent, where the far edge is a guess.
 */
export const EDGE_STRENGTH = 0.35;

/** When the fade begins, seconds after the ping. */
export const FADE_AT = SWEEP_SECONDS + HOLD_SECONDS;

/** How long anything is lit at all, seconds after the ping. */
export const LIT_SECONDS = FADE_AT + FADE_SECONDS;

/** A whole ping, from sent to sendable again, seconds. */
export const CYCLE_SECONDS = LIT_SECONDS + COOLDOWN_SECONDS;

/**
 * Where a ping is in its life. `ready` is the only phase that accepts
 * another one — a sweep is not interruptible, because restarting the
 * front halfway would pull the light back off everything behind it.
 */
export type PulsePhase = 'ready' | 'sweep' | 'hold' | 'fade' | 'cooldown';

/** The sweep's whole state: one object, because the latch in it is real. */
interface PulseState {
  phase: PulsePhase;
  /** Simulation seconds since `ping()`. Meaningless while `ready`. */
  elapsed: number;
  /** The front's high-water mark, world units. Only ever rises within a ping. */
  front: number;
}

function clamp01(value: number): number {
  if (!(value > 0)) return 0;
  return value < 1 ? value : 1;
}

function phaseAt(elapsed: number): PulsePhase {
  if (elapsed < SWEEP_SECONDS) return 'sweep';
  if (elapsed < FADE_AT) return 'hold';
  if (elapsed < LIT_SECONDS) return 'fade';
  if (elapsed < CYCLE_SECONDS) return 'cooldown';
  return 'ready';
}

export class SensePulse {
  /** How far this sweep reaches, world units. Fixed for the life of the pulse. */
  readonly radius: number;

  private readonly state: PulseState = { phase: 'ready', elapsed: 0, front: 0 };

  constructor(radius: number = SENSE_RADIUS) {
    this.radius = radius > 0 ? radius : SENSE_RADIUS;
  }

  /**
   * Send a sweep. False means it was refused because one is already
   * running or the antennae are still recovering — the caller shows
   * that, it does not retry.
   */
  ping(): boolean {
    if (this.state.phase !== 'ready') return false;
    this.state.phase = 'sweep';
    this.state.elapsed = 0;
    this.state.front = 0;
    return true;
  }

  /** Advance by `dt` SIMULATION seconds. A ready pulse costs nothing. */
  tick(dt: number): void {
    const s = this.state;
    if (s.phase === 'ready') return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    s.elapsed += dt;
    // The high-water mark: the disc's edge, which never comes back in
    // while the ping is alive. `max` rather than assignment so that no
    // future caller playing with the clock can un-light the forest.
    const reached = s.elapsed >= SWEEP_SECONDS
      ? this.radius
      : this.radius * (s.elapsed / SWEEP_SECONDS);
    if (reached > s.front) s.front = reached;
    s.phase = phaseAt(s.elapsed);
    if (s.phase === 'ready') this.reset();
  }

  /** Back to ready with nothing lit — a scene teardown or a session change, never gameplay. */
  reset(): void {
    this.state.phase = 'ready';
    this.state.elapsed = 0;
    this.state.front = 0;
  }

  get phase(): PulsePhase {
    return this.state.phase;
  }

  /**
   * Whether anything is lit at all. The renderers' early out: while this
   * is false there is nothing to select, fill or label, and the feature
   * costs one branch a frame.
   */
  get lit(): boolean {
    const phase = this.state.phase;
    return phase === 'sweep' || phase === 'hold' || phase === 'fade';
  }

  /** Whether a ping would be accepted right now. */
  get ready(): boolean {
    return this.state.phase === 'ready';
  }

  /**
   * How far out the sweep has reached, world units — nothing past it is
   * lit, so it is also the selection's and the renderers' cull radius.
   * Zero when nothing is lit.
   */
  get front(): number {
    return this.lit ? this.state.front : 0;
  }

  /** Simulation seconds until another ping is accepted; 0 when it already would be. */
  get readyIn(): number {
    if (this.state.phase === 'ready') return 0;
    const left = CYCLE_SECONDS - this.state.elapsed;
    return left > 0 ? left : 0;
  }

  /**
   * How lit a thing at this horizontal distance is, 0 to 1: the phase's
   * envelope times the falloff with distance.
   *
   * MONOTONE IN DISTANCE — nothing further out is ever brighter than
   * something nearer. That is not a coincidence to be preserved by
   * accident: `select` decides which things fit under its caps from
   * distance alone, and it may only do that because of this.
   */
  strengthAt(distance: number): number {
    if (!this.lit) return 0;
    if (!Number.isFinite(distance)) return 0;
    const d = distance > 0 ? distance : 0;
    if (d > this.radius || d > this.state.front) return 0;

    // When the front passed this distance, and how far up from dark the
    // thing has come since. Computed from the clock rather than
    // remembered per thing — the front's speed is a constant, so the
    // moment it crossed any distance is arithmetic.
    const passedAt = (d / this.radius) * SWEEP_SECONDS;
    const wake = WAKE_SECONDS > 0 ? clamp01((this.state.elapsed - passedAt) / WAKE_SECONDS) : 1;

    const ebb = this.state.elapsed <= FADE_AT
      ? 1
      : clamp01(1 - (this.state.elapsed - FADE_AT) / FADE_SECONDS);

    // Linear from 1 at your feet to EDGE_STRENGTH at the rim. Linear and
    // not a curve because the fill is flat colour: a gamma here would be
    // fighting whatever the renderer's own blend does with it.
    const falloff = 1 - (1 - EDGE_STRENGTH) * (d / this.radius);

    return wake * ebb * falloff;
  }
}
