/**
 * Two dts from the moment time is read.
 *
 * v0 clamped `dt` to 0.1 s for anti-teleport reasons and fed that SAME
 * value to the FPS readout, so the display could not report below 10 fps
 * by construction — a slow phone looked fine in the corner of the screen
 * while it stuttered. Here `rawDt` is the unclamped wall-clock delta for
 * instrumentation, and `simDt` is the separately clamped value physics
 * integrates. They are never the same number under a stall, and
 * `tests/frameClock.test.ts` fails if they ever are.
 */

/** Longest step the simulation is allowed to take, in seconds. */
export const SIM_DT_CAP = 0.1;

export interface FrameTick {
  /** Unclamped wall-clock seconds since the previous tick. 0 on the first. */
  readonly rawDt: number;
  /** min(rawDt, SIM_DT_CAP), or 0 while paused. What physics integrates. */
  readonly simDt: number;
}

export class FrameClock {
  private lastMs: number | null = null;
  private paused = false;
  private simElapsed = 0;

  tick(nowMs: number): FrameTick {
    const rawDt = this.lastMs === null ? 0 : Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    const simDt = this.paused ? 0 : Math.min(rawDt, SIM_DT_CAP);
    this.simElapsed += simDt;
    return { rawDt, simDt };
  }

  /**
   * A true pause: sim dt reads 0 while raw dt keeps measuring, so the FPS
   * readout stays honest on a pause screen. The world stops because this
   * number stops, not because each system checks a flag (ARCHITECTURE §6).
   */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Simulated seconds accumulated so far — the world clock scenes read. */
  get elapsed(): number {
    return this.simElapsed;
  }
}
