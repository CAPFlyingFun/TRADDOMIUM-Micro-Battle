/**
 * Milestone-weighted, monotonic loading progress with a rate-smoothed ETA.
 *
 * Built from real completion signals (bytes, tiles-ready ratio,
 * subsystem-ready flags), NOT a timer: each milestone reports its own
 * 0..1 fraction and the total is the weighted mean. Reported fractions can
 * only rise, so the bar never runs backwards when one signal is noisy — a
 * bar that fills, resets and fills again reads as a stall and a restart.
 *
 * Pure. Time is injected so tests are deterministic.
 */

export interface Milestone {
  readonly id: string;
  /** Relative cost. A terrain download of 2 MB outweighs a settings read. */
  readonly weight: number;
}

/** Samples older than this no longer inform the rate estimate. */
export const ETA_WINDOW_MS = 7000;

interface Sample {
  readonly atMs: number;
  readonly fraction: number;
}

export class LoadProgress {
  private readonly weights = new Map<string, number>();
  private readonly done = new Map<string, number>();
  private totalWeight = 0;
  private samples: Sample[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Replaces any previous definition. Zero or negative weights are ignored. */
  define(milestones: readonly Milestone[]): void {
    this.weights.clear();
    this.done.clear();
    this.samples = [];
    this.totalWeight = 0;
    for (const m of milestones) {
      if (!(m.weight > 0)) continue;
      this.weights.set(m.id, m.weight);
      this.done.set(m.id, 0);
      this.totalWeight += m.weight;
    }
  }

  /** Unknown ids are ignored: a typo cannot inflate the bar. Fractions only rise. */
  report(id: string, fraction: number): void {
    if (!this.weights.has(id)) return;
    const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
    const prev = this.done.get(id) ?? 0;
    if (clamped <= prev) return;
    this.done.set(id, clamped);
    this.sample();
  }

  /** 0..1, never decreasing. 1 when nothing is defined (there is nothing to wait for). */
  fraction(): number {
    if (this.totalWeight === 0) return 1;
    let sum = 0;
    for (const [id, weight] of this.weights) sum += weight * (this.done.get(id) ?? 0);
    return Math.min(1, sum / this.totalWeight);
  }

  complete(): boolean {
    return this.fraction() >= 1;
  }

  /**
   * Estimated milliseconds remaining from the progress rate over the
   * sliding window, or null when there is no rate yet — an honest "unknown"
   * rather than a number invented from a timer.
   */
  etaMs(): number | null {
    const current = this.fraction();
    if (current >= 1) return 0;
    const nowMs = this.now();
    this.trim(nowMs);
    const oldest = this.samples[0];
    if (!oldest) return null;
    const dt = nowMs - oldest.atMs;
    const df = current - oldest.fraction;
    if (dt <= 0 || df <= 0) return null;
    return ((1 - current) / df) * dt;
  }

  private sample(): void {
    const atMs = this.now();
    this.samples.push({ atMs, fraction: this.fraction() });
    this.trim(atMs);
  }

  private trim(nowMs: number): void {
    // Keep one sample at or before the window's edge so a rate can be read
    // across the full window even when reports are sparse.
    const edge = nowMs - ETA_WINDOW_MS;
    let firstInside = this.samples.findIndex((s) => s.atMs >= edge);
    if (firstInside === -1) firstInside = this.samples.length;
    const keepFrom = Math.max(0, firstInside - 1);
    if (keepFrom > 0) this.samples = this.samples.slice(keepFrom);
  }
}
