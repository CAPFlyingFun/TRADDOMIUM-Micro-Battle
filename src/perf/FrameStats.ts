/**
 * The pure frame-time statistics behind the perf HUD.
 *
 * A ring buffer of the last FRAME_WINDOW RAW frame times, reduced to the
 * two numbers a benchmark scene needs — mean fps and the 95th-percentile
 * low — plus the latest simulation dt, kept beside them so the HUD can
 * show that they are two different numbers (ARCHITECTURE §2.4, §9).
 *
 * THE INPUT MUST BE RAW. `record()` names its parameter `rawDt` because
 * feeding it a clamped dt makes every result wrong by construction: v0
 * clamped dt to 0.1 s for anti-teleport reasons and fed that same value to
 * its FPS readout, so the display could not report below 10 fps however
 * badly the phone stalled. This module cannot tell a clamped number from a
 * real one — only the caller can, and `FrameInfo.rawDt` is the one to pass.
 * `tests/frameStats.test.ts` holds that regression as a test.
 *
 * PURE: imports nothing (§2.6). The import-boundary test covers it.
 */

/** Frames held. Two seconds at 60 fps: long enough to catch a stall, short enough to read as "now". */
export const FRAME_WINDOW = 120;

/** The slowest fraction of the window's TIME that the low readout describes. */
export const LOW_FRACTION = 0.05;

export interface FrameSummary {
  /** Frames in the window divided by the wall-clock seconds they took. 0 with no frames. */
  readonly meanFps: number;
  /**
   * 95th-percentile low: the frame rate at which the slowest 5 % of the
   * window's wall-clock time was being drawn. 0 with no frames.
   */
  readonly lowFps: number;
  /** The latest simulation step in seconds; 0 while the world is paused. */
  readonly simDt: number;
  /** How many frames the window currently holds (fills up to the capacity). */
  readonly frames: number;
}

export class FrameStats {
  private readonly times: Float64Array;
  /** Next slot to write. */
  private head = 0;
  private count = 0;
  private latestSimDt = 0;

  constructor(readonly capacity: number = FRAME_WINDOW) {
    if (!(Number.isInteger(capacity) && capacity >= 1)) {
      throw new Error(`FrameStats: capacity must be a positive integer, got ${capacity}`);
    }
    this.times = new Float64Array(capacity);
  }

  /**
   * One frame. `rawDt` is the unclamped wall-clock delta; `simDt` is what
   * the simulation integrated this frame (0 while paused) and is only kept,
   * never averaged — it is a fact about the world, not about the renderer.
   */
  record(rawDt: number, simDt: number): void {
    this.latestSimDt = Number.isFinite(simDt) && simDt > 0 ? simDt : 0;
    // The clock's first tick reads 0 and a 0 s frame has no frame rate; a
    // non-finite value is a bug upstream, not a frame. Neither enters the window.
    if (!(Number.isFinite(rawDt) && rawDt > 0)) return;
    this.times[this.head] = rawDt;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  summary(): FrameSummary {
    const n = this.count;
    if (n === 0) return { meanFps: 0, lowFps: 0, simDt: this.latestSimDt, frames: 0 };

    // Order does not matter to either statistic, so the ring's wrap point is irrelevant here.
    const slowestFirst = Array.from(this.times.subarray(0, n)).sort((a, b) => b - a);
    let total = 0;
    for (const t of slowestFirst) total += t;

    // The low is weighted by TIME, not by frame count. Averaging the slowest
    // six frames of a window that holds one 2 s stall reports about 2.9 fps
    // and hides that the player looked at a single frame for half of the
    // window's wall-clock; walking down from the slowest frame until 5 % of
    // the time is covered reports 0.5 fps, which is what they saw.
    const share = total * LOW_FRACTION;
    let covered = 0;
    let slowest = slowestFirst[0];
    for (const t of slowestFirst) {
      covered += t;
      slowest = t;
      if (covered >= share) break;
    }

    // Mean is frames over time, not the average of per-frame rates: averaging
    // rates lets 119 fast frames outvote a 2 s stall (59.5 fps for a window
    // that took four seconds to show 120 frames).
    return { meanFps: n / total, lowFps: 1 / slowest, simDt: this.latestSimDt, frames: n };
  }

  reset(): void {
    this.head = 0;
    this.count = 0;
    this.latestSimDt = 0;
  }
}
