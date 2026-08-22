/**
 * WHAT IS LEFT TO DO, AND HOW LONG IT WILL TAKE.
 *
 * A loading bar is a promise, and most of them lie. The one this
 * replaces was the worst kind — the world simply appeared, half of it
 * black, because the ground textures had not arrived and an unloaded
 * texture samples as nothing. The fix is to wait; the reason this file
 * exists is that waiting in silence is worse than not waiting.
 *
 * Joshua's requirement, and it is the right one: show the TOTAL, show
 * what has ARRIVED, and show how long the rest will take. A bar that
 * runs to full in ten seconds and then sits there while the game keeps
 * loading has told the player nothing except that it cannot be
 * trusted.
 *
 * So the plan is weighted, and the weights are honest. Downloads are
 * weighted by their real byte counts, read off the responses rather
 * than guessed. Work that has no byte count — cutting the terrain,
 * compiling the shader — carries a weight in the same currency, chosen
 * so that a phase which takes a second of wall clock is worth about a
 * second of bar. No phase may reach full while it is still running.
 *
 * Kept free of the DOM so all of it can be tested without a browser.
 */

/** A byte count as a person reads it. */
export function readableBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** A duration as a person reads it. */
export function readableWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return 'a moment';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.ceil(seconds % 60);
  return rest > 0 ? `${mins}m ${rest}s` : `${mins}m`;
}

/** The two jobs that are work rather than bytes. */
export const TERRAIN_JOB = 'terrain';
export const FIRST_LIGHT_JOB = 'first-light';

/**
 * Weight for a job that has no byte count, in byte-equivalents.
 *
 * Chosen so cutting the landscape and drawing the first frame are
 * together worth roughly a tenth of the bar — about their share of the
 * wall clock on a phone, next to five megabytes of download. The unit
 * is fictional and that is fine: the bar only ever shows a ratio.
 */
export const WORK_WEIGHT = 300_000;

/**
 * What a loader needs from the plan, and nothing more.
 *
 * Narrow on purpose: the asset loaders should be able to report their
 * progress without importing a screen, a scene, or anything that knows
 * what a bar looks like. `LoadPlan` satisfies this as it stands.
 */
export interface LoadReport {
  add(id: string, label: string, weight: number, counted?: boolean): void;
  resize(id: string, weight: number): void;
  advance(id: string, done: number): void;
  finish(id: string): void;
}

/**
 * One thing being waited on.
 *
 * `weight` is the share of the bar it owns. For a download it is the
 * byte count; for work it is a made-up number in the same units, which
 * is fine precisely because the bar only ever shows the ratio.
 */
interface Job {
  readonly id: string;
  readonly label: string;
  /** True when this job's weight is real bytes off the wire. */
  readonly counted: boolean;
  weight: number;
  done: number;
  finished: boolean;
}

/**
 * How long the rate sample must run before an estimate is offered.
 *
 * The first fraction of a second of a download is all handshake and no
 * throughput, and an estimate taken there says four minutes and then
 * corrects itself to three seconds, which is worse than saying nothing.
 */
const WARMUP_SECONDS = 0.4;

/** And it needs to have actually moved. */
const WARMUP_SHARE = 0.02;

/**
 * How far back the rate is measured, in milliseconds.
 *
 * A TRAILING WINDOW, not a per-frame average, and the difference is the
 * whole estimate. Easing a frame-by-frame delta looks reasonable and is
 * not: bytes land in bursts, so most frames see nothing arrive, and
 * averaging in all those zeroes drags the rate steadily down. The first
 * version of this did exactly that and the ETA CLIMBED from 12s to 19s
 * over a download that was running perfectly — the number got worse the
 * longer you watched it, which is the one thing an estimate may not do.
 *
 * Total bytes over total time across a couple of seconds has no such
 * bias, and does not care how often it is asked.
 */
const WINDOW_MS = 2500;

/** Don't record a sample more often than this. */
const SAMPLE_MS = 100;

export interface LoadState {
  /** 0–1 across everything. */
  readonly fraction: number;
  /** What is being waited on right now. */
  readonly label: string;
  /** Bytes arrived, over bytes expected, for the jobs that are downloads. */
  readonly bytesDone: number;
  readonly bytesTotal: number;
  /** Seconds left, or null while there is nothing honest to say. */
  readonly secondsLeft: number | null;
  readonly complete: boolean;
}

export class LoadPlan {
  private readonly jobs: Job[] = [];
  private readonly now: () => number;
  private started: number;
  private readonly samples: { at: number; bytes: number }[] = [];

  /** @param now milliseconds, injectable so the tests are not timed */
  constructor(now: () => number = () => performance.now()) {
    this.now = now;
    this.started = now();
  }

  /**
   * Declare something to wait for.
   *
   * A download whose size is not known yet passes its best guess; the
   * real Content-Length replaces it the moment the headers land, which
   * is early enough that the total settles before anyone reads it.
   */
  add(id: string, label: string, weight: number, counted = false): void {
    this.jobs.push({
      id, label, counted, weight: Math.max(1, weight), done: 0, finished: false,
    });
  }

  /** The real size, once the response headers say so. */
  resize(id: string, weight: number): void {
    const job = this.jobs.find((j) => j.id === id);
    if (job && weight > 0) job.weight = weight;
  }

  /** How far along one job is, in its own units. */
  advance(id: string, done: number): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.finished) return;
    // Never past its own weight: a job that overshoots its estimate
    // would push the bar backwards when another job's total lands.
    job.done = Math.max(job.done, Math.min(done, job.weight));
  }

  /** This one is done, whatever it managed to report along the way. */
  finish(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.done = job.weight;
    job.finished = true;
  }

  /** Everything declared is finished. */
  get complete(): boolean {
    return this.jobs.length > 0 && this.jobs.every((j) => j.finished);
  }

  /**
   * Read the plan.
   *
   * The fraction is deliberately NOT allowed to reach 1 until every job
   * is finished, however the arithmetic rounds. A bar sitting on full
   * while the game is plainly still working is the exact complaint this
   * screen exists to answer.
   */
  read(): LoadState {
    const weight = this.jobs.reduce((sum, j) => sum + j.weight, 0);
    const done = this.jobs.reduce((sum, j) => sum + j.done, 0);
    const complete = this.complete;
    const raw = weight > 0 ? done / weight : 0;
    const fraction = complete ? 1 : Math.min(0.995, raw);

    const counted = this.jobs.filter((j) => j.counted);
    const bytesTotal = counted.reduce((sum, j) => sum + j.weight, 0);
    const bytesDone = counted.reduce((sum, j) => sum + j.done, 0);

    const running = this.jobs.find((j) => !j.finished);
    return {
      fraction,
      label: running?.label ?? 'Ready',
      bytesDone,
      bytesTotal,
      // Estimated from the DOWNLOAD, not from the whole plan. The work
      // jobs finish in one step, and a job worth 300,000 completing
      // between two samples reads as a colossal burst of throughput —
      // which is what made the first estimate drop to two seconds the
      // instant the terrain finished cutting.
      secondsLeft: complete ? 0 : this.estimate(bytesDone, bytesTotal),
      complete,
    };
  }

  /**
   * Seconds left, from the rate the download has actually run at.
   *
   * Measured across every file rather than per file, because they
   * overlap — the queen downloads while the textures do — and a
   * per-file estimate would report the last one's share of the
   * connection as though it had the whole thing.
   *
   * Returns null rather than a number whenever there is nothing honest
   * to say: too early to tell, or nothing arriving. A blank is a fair
   * description of a stall. A number sliding upwards is not.
   */
  private estimate(bytes: number, total: number): number | null {
    const at = this.now();
    const newest = this.samples[this.samples.length - 1];
    // Idempotent within a sample interval, so reading the plan twice in
    // one frame cannot disturb the measurement it is reading.
    if (!newest || at - newest.at >= SAMPLE_MS) {
      this.samples.push({ at, bytes });
      while (this.samples.length > 2 && at - this.samples[0].at > WINDOW_MS) {
        this.samples.shift();
      }
    }

    const elapsed = (at - this.started) / 1000;
    if (elapsed < WARMUP_SECONDS || bytes < total * WARMUP_SHARE) return null;

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const span = (last.at - first.at) / 1000;
    const moved = last.bytes - first.bytes;
    if (span <= 0 || moved <= 0) return null;
    return (total - bytes) / (moved / span);
  }
}
