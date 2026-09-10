/**
 * THE STRESS TEST — how many living creatures this phone can hold in one
 * cubic metre, measured rather than guessed.
 *
 * Joshua, 2026-09-10: "Spawn 1 random currently implemented insect per
 * second inside the existing 1 m room, using the normal creature systems
 * … record the insect count when performance first crosses 45 / 30 / 20 /
 * 10 FPS … the main number I care about is how many fully active insects
 * that 1 m room can sustain at 30+ FPS. The 10 FPS point is just the
 * absolute breaking point."
 *
 * This file is the test's ARITHMETIC and nothing else: a rolling frame
 * rate, a phase, a spawn clock, the thresholds it has crossed, and the
 * report at the end. It knows no creature, no world and no DOM — it is
 * handed a raw frame time and answers which species to spawn, and the
 * scene turns that into a body on the bench. So the whole run can be
 * played out in milliseconds under vitest at any frame rate a phone
 * might produce, which is the only way to test a thing whose subject is
 * frame rate.
 *
 * ─── the rolling average, and why it is over TIME ───────────────────
 *
 * `RollingFps` holds the frames of the last `WINDOW_S` seconds — his
 * five — and answers frames ÷ their wall-clock. NOT the last N frames:
 * `perf/FrameStats` holds 120 of those, which is two seconds at 60 fps
 * and twelve at ten, so a frame-counted window would quietly get longer
 * exactly as the phone got slower, which is the moment the number
 * matters most. And frames over time, never the mean of per-frame rates:
 * averaging rates lets 119 fast frames outvote one 2 s stall
 * (`FrameStats` learnt that first and says so).
 *
 * ─── the phases ─────────────────────────────────────────────────────
 *
 *   warmup     two guards, in order, before a single reading is used.
 *              First the SETTLE: for `SETTLE_S` the frames are thrown
 *              away entirely — not counted, not averaged, not part of
 *              the run's clock — because RUN AGAIN rebuilds the bench,
 *              and the rebuild frame is most of a second long. Then the
 *              FILL: no spawning until the window holds a full
 *              `WINDOW_S`, because a threshold crossed on a half-full
 *              window is a number about the loading screen.
 *
 *              The settle exists because of what it costs to be without
 *              it: one 900 ms frame inside the first five-second window
 *              drags the average to about 51 fps on a 60 fps phone, the
 *              run records "below 45" at ZERO creatures, and the report
 *              then says the empty bench could not hold 45 — a claim
 *              about the reset button, printed as a claim about the
 *              crowd.
 *   spawning   one creature every `SPAWN_EVERY_S`, the species drawn
 *              from a SEEDED generator so RUN AGAIN is the same test and
 *              not another one (CLAUDE.md: never `Math.random`). Each
 *              threshold records the count the first time the rolling
 *              average falls through it.
 *   recovery   spawning stops when the average has held under the last
 *              threshold for `BREAK_HOLD_S`; the bodies already there
 *              keep living for `RECOVERY_S` so the report can say what
 *              the phone settles to once nothing new is arriving.
 *   done       the report stands until RUN AGAIN or RESET.
 *
 * ─── what makes a run comparable to the last one ────────────────────
 *
 * The seed, the spawn clock and the thresholds are here; the scene holds
 * the rest still — observer mode, the camera at the bench's fixed
 * viewpoint, predation off — and the report PRINTS those conditions, so
 * two runs that were not the same test cannot be read as though they
 * were.
 *
 * Pure: no three, no DOM, no clock of its own (the timestamp is handed
 * in). Allocation-free per frame: the window is a ring, the counts an
 * object made once.
 */
import { mulberry32 } from '../world/random';
import type { CreatureId } from '../creatures/species';

// ---------------------------------------------------------------------------
// The numbers. Joshua's, except where a line says otherwise.
// ---------------------------------------------------------------------------

/** The rolling average's window, seconds. Joshua: "maybe over the previous 5 seconds". */
export const WINDOW_S = 5;

/**
 * How long a run throws its frames away before it starts measuring,
 * seconds. GAME TUNING. START and RUN AGAIN rebuild the bench — clearing
 * the crowd, restoring the camera, re-sizing the rig pool — and that
 * frame is long enough to be most of a second on a phone. A second is
 * comfortably more than one such frame and comfortably less than the
 * window it is protecting.
 */
export const SETTLE_S = 1;

/** One creature every this many seconds. Joshua: "1 random currently implemented insect per second". */
export const SPAWN_EVERY_S = 1;

/** The frame rates whose creature count the run records, highest first. Joshua's four. */
export const THRESHOLDS: readonly number[] = Object.freeze([45, 30, 20, 10]);

/** How long the average must hold under the last threshold before spawning stops, seconds. Joshua: "about 5 seconds". */
export const BREAK_HOLD_S = 5;

/** How long the bodies keep living after spawning stops, seconds. Joshua: "another 10 seconds". */
export const RECOVERY_S = 10;

/**
 * The most creatures a run will place. GAME TUNING, and a guard rather
 * than a target: Joshua is "hoping we might get close to 200", and a
 * phone that never reaches ten frames a second would otherwise spawn
 * until the tab is killed — which loses the report, the one thing the
 * run is for. A run that reaches this stops and SAYS it stopped here, so
 * the number is never mistaken for a breaking point.
 */
export const MAX_CREATURES = 400;

/**
 * The longest a run may take, seconds. GAME TUNING, the same guard from
 * the other side: at one a second, four hundred creatures is under seven
 * minutes, and anything past ten is a run nobody is still watching.
 */
export const MAX_RUN_S = 600;

/** The seed the species draw runs on, so two runs are the same run. */
export const STRESS_SEED = 0x57_2e_55;

export type StressPhase = 'idle' | 'warmup' | 'spawning' | 'recovery' | 'done';

/** Why a run stopped spawning — the report says which, because they mean different things. */
export type StressEnding = 'broke' | 'ceiling' | 'timeout' | 'stopped';

/** One threshold, and the run when it fell through it. */
export interface Crossing {
  readonly fps: number;
  /** Creatures alive when the average first fell below `fps`. */
  readonly creatures: number;
  /** Seconds into the run. */
  readonly atS: number;
}

// ---------------------------------------------------------------------------
// The rolling average
// ---------------------------------------------------------------------------

/**
 * The frames of the last `windowS` seconds, as a ring: raw frame times
 * in, frames ÷ their wall-clock out. Nothing is allocated after the
 * constructor, and a frame time that is not a positive finite number is
 * not a frame (the clock's first tick reads zero).
 */
export class RollingFps {
  private readonly times: Float64Array;
  private head = 0;
  private tail = 0;
  private count = 0;
  private total = 0;

  constructor(readonly windowS: number = WINDOW_S, capacity = 4096) {
    this.times = new Float64Array(capacity);
  }

  add(rawDt: number): void {
    if (!(Number.isFinite(rawDt) && rawDt > 0)) return;
    // A single frame longer than the whole window is a stall: it becomes
    // the window on its own rather than being dropped, because it is
    // exactly what the player saw.
    if (this.count === this.times.length) this.drop();
    this.times[this.head] = rawDt;
    this.head = (this.head + 1) % this.times.length;
    this.count += 1;
    this.total += rawDt;
    while (this.count > 1 && this.total - this.times[this.tail] >= this.windowS) this.drop();
  }

  private drop(): void {
    this.total -= this.times[this.tail];
    this.tail = (this.tail + 1) % this.times.length;
    this.count -= 1;
  }

  /** Frames over the seconds they took, or 0 with no frames. */
  fps(): number {
    return this.count > 0 && this.total > 0 ? this.count / this.total : 0;
  }

  /** The mean frame time over the window, milliseconds; 0 with no frames. */
  frameMs(): number {
    return this.count > 0 ? (this.total / this.count) * 1000 : 0;
  }

  /**
   * Whether the window is full — the only state in which a reading is
   * the reading it claims to be. The comparison carries an epsilon
   * because the total is a sum of hundreds of floats: three hundred
   * sixtieths of a second add up to 4.999999999999998, and a warm-up
   * that waited for a number that can never arrive would never end.
   * The window itself holds AT LEAST its seconds — the oldest frame is
   * kept until dropping it would take the total under `windowS` — so a
   * reading covers the window and at most one frame more.
   */
  full(): boolean {
    return this.total >= this.windowS - 1e-9;
  }

  seconds(): number {
    return this.total;
  }

  frames(): number {
    return this.count;
  }

  reset(): void {
    this.head = this.tail = this.count = 0;
    this.total = 0;
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** What the HUD shows while a run is going, and what the report is built from. */
export interface StressReadout {
  readonly phase: StressPhase;
  readonly creatures: number;
  readonly bySpecies: Readonly<Record<string, number>>;
  /** The rolling average now, or 0 before the window is full. */
  readonly fps: number;
  readonly elapsedS: number;
  readonly crossings: readonly Crossing[];
  /** The next threshold the run is waiting to fall through, or null once all four are recorded. */
  readonly nextFps: number | null;
  /** Seconds left of the recovery hold, while recovering. */
  readonly recoveryLeftS: number;
  readonly ending: StressEnding | null;
}

export interface StressOptions {
  /** The species a run may draw from. The Lab hands in the five it runs. */
  readonly species: readonly CreatureId[];
  readonly seed?: number;
  /** For a test that wants a shorter run; the defaults are Joshua's. */
  readonly spawnEveryS?: number;
  readonly windowS?: number;
  readonly maxCreatures?: number;
}

/**
 * A stress run. The scene calls `frame` once per rendered frame with the
 * RAW frame time — never the clamped simulation step, for `FrameStats`'s
 * reason — and spawns whatever species comes back.
 */
export class StressTest {
  private readonly window: RollingFps;
  private readonly pool: readonly CreatureId[];
  private readonly seed: number;
  private readonly spawnEveryS: number;
  private readonly maxCreatures: number;
  private rand: () => number;

  private phase: StressPhase = 'idle';
  private settled = 0;
  private elapsed = 0;
  private sinceSpawn = 0;
  private belowLast = 0;
  private recovered = 0;
  private ending: StressEnding | null = null;

  private count = 0;
  private readonly counts = new Map<CreatureId, number>();
  private readonly crossings: Crossing[] = [];

  /** The whole run's frames and seconds, for the average; and the extremes. */
  private runFrames = 0;
  private runSeconds = 0;
  private worstFrameS = 0;
  private lowestFps = Infinity;
  /** The rolling average at the moment spawning stopped, and at the end of the recovery. */
  private brokeAtFps = 0;
  private recoveryFps = 0;

  constructor(options: StressOptions) {
    this.pool = options.species.slice();
    this.seed = options.seed ?? STRESS_SEED;
    this.spawnEveryS = options.spawnEveryS ?? SPAWN_EVERY_S;
    this.maxCreatures = options.maxCreatures ?? MAX_CREATURES;
    this.window = new RollingFps(options.windowS ?? WINDOW_S);
    this.rand = mulberry32(this.seed);
  }

  get running(): boolean {
    return this.phase === 'warmup' || this.phase === 'spawning' || this.phase === 'recovery';
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  /** Begin, or begin again: every number back to where the last run started from. */
  start(): void {
    this.reset();
    this.phase = 'warmup';
  }

  /** Back to idle: no run, no report. */
  reset(): void {
    this.window.reset();
    this.rand = mulberry32(this.seed);
    this.phase = 'idle';
    this.settled = 0;
    this.elapsed = 0;
    this.sinceSpawn = 0;
    this.belowLast = 0;
    this.recovered = 0;
    this.ending = null;
    this.count = 0;
    this.counts.clear();
    this.crossings.length = 0;
    this.runFrames = 0;
    this.runSeconds = 0;
    this.worstFrameS = 0;
    this.lowestFps = Infinity;
    this.brokeAtFps = 0;
    this.recoveryFps = 0;
  }

  /** Stop a run where it stands and go straight to the report (the button says STOP). */
  stop(): void {
    if (!this.running) return;
    this.finish('stopped');
  }

  /**
   * ONE FRAME. Returns the species to spawn now, or null. The caller
   * MUST place what it is given: the count is advanced here, and a
   * report whose count and bench disagreed would be worthless.
   */
  frame(rawDt: number): CreatureId | null {
    if (!this.running) return null;
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;

    // THE SETTLE. These frames are thrown away — not averaged, not
    // counted, not on the run's clock — because they belong to the
    // rebuild the button just did and not to the bench. The run begins
    // when this ends.
    // Only in the warm-up: a run STOPped inside its own settle must
    // still be able to reach its report rather than sit here forever.
    if (this.phase === 'warmup' && this.settled < SETTLE_S) {
      this.settled += dt;
      return null;
    }

    this.window.add(rawDt);
    this.elapsed += dt;
    if (dt > 0) {
      this.runFrames += 1;
      this.runSeconds += dt;
      if (dt > this.worstFrameS) this.worstFrameS = dt;
    }

    // The window must be full before any reading is used for anything:
    // a threshold crossed on two seconds of frames is a claim about a
    // scene that was still loading (the header).
    if (!this.window.full()) return null;
    const fps = this.window.fps();
    if (fps < this.lowestFps) this.lowestFps = fps;

    if (this.phase === 'warmup') {
      this.phase = 'spawning';
      this.sinceSpawn = this.spawnEveryS;
    }

    if (this.phase === 'recovery') {
      this.recovered += dt;
      this.recoveryFps = fps;
      if (this.recovered >= RECOVERY_S) this.phase = 'done';
      return null;
    }

    // THE THRESHOLDS, in order and once each: a run that falls straight
    // past three of them in one bad frame records all three at the count
    // it had, which is the truth about that count.
    for (let i = this.crossings.length; i < THRESHOLDS.length; i += 1) {
      if (fps >= THRESHOLDS[i]) break;
      this.crossings.push({ fps: THRESHOLDS[i], creatures: this.count, atS: this.elapsed });
    }

    // THE BREAKING POINT: the average held under the last threshold for
    // the hold. Anything above it resets the hold, so one lucky frame
    // does not end the run and one unlucky one does not either.
    const last = THRESHOLDS[THRESHOLDS.length - 1];
    this.belowLast = fps < last ? this.belowLast + dt : 0;
    if (this.belowLast >= BREAK_HOLD_S) {
      this.finish('broke');
      return null;
    }
    if (this.elapsed >= MAX_RUN_S) {
      this.finish('timeout');
      return null;
    }

    this.sinceSpawn += dt;
    if (this.sinceSpawn < this.spawnEveryS) return null;
    this.sinceSpawn -= this.spawnEveryS;
    if (this.count >= this.maxCreatures) {
      this.finish('ceiling');
      return null;
    }
    const species = this.pool[Math.min(this.pool.length - 1, Math.floor(this.rand() * this.pool.length))];
    this.count += 1;
    this.counts.set(species, (this.counts.get(species) ?? 0) + 1);
    return species;
  }

  private finish(ending: StressEnding): void {
    this.ending = ending;
    this.brokeAtFps = this.window.fps();
    this.recoveryFps = this.brokeAtFps;
    this.recovered = 0;
    this.phase = 'recovery';
  }

  readout(): StressReadout {
    const bySpecies: Record<string, number> = {};
    for (const [id, n] of this.counts) bySpecies[id] = n;
    return {
      phase: this.phase,
      creatures: this.count,
      bySpecies,
      fps: this.window.full() ? this.window.fps() : 0,
      elapsedS: this.elapsed,
      crossings: this.crossings.slice(),
      nextFps: this.crossings.length < THRESHOLDS.length ? THRESHOLDS[this.crossings.length] : null,
      recoveryLeftS: this.phase === 'recovery' ? Math.max(0, RECOVERY_S - this.recovered) : 0,
      ending: this.ending,
    };
  }

  /** The numbers the report is written from. Valid once the phase is `done`. */
  result(): StressResult {
    const bySpecies: Record<string, number> = {};
    for (const [id, n] of this.counts) bySpecies[id] = n;
    return {
      creatures: this.count,
      bySpecies,
      durationS: this.elapsed,
      averageFps: this.runSeconds > 0 ? this.runFrames / this.runSeconds : 0,
      averageFrameMs: this.runFrames > 0 ? (this.runSeconds / this.runFrames) * 1000 : 0,
      lowestFps: Number.isFinite(this.lowestFps) ? this.lowestFps : 0,
      worstFrameMs: this.worstFrameS * 1000,
      finalFps: this.brokeAtFps,
      recoveryFps: this.recoveryFps,
      crossings: this.crossings.slice(),
      ending: this.ending ?? 'stopped',
    };
  }
}

export interface StressResult {
  readonly creatures: number;
  readonly bySpecies: Readonly<Record<string, number>>;
  readonly durationS: number;
  readonly averageFps: number;
  readonly averageFrameMs: number;
  /** The lowest the ROLLING AVERAGE reached — not the worst single frame, which is `worstFrameMs`. */
  readonly lowestFps: number;
  readonly worstFrameMs: number;
  /** The rolling average at the moment spawning stopped. */
  readonly finalFps: number;
  /** The rolling average after the recovery hold. */
  readonly recoveryFps: number;
  readonly crossings: readonly Crossing[];
  readonly ending: StressEnding;
}

/** What the run was run under, printed so two runs can be compared honestly. */
export interface StressConditions {
  /** Human-readable: the device, the build, the day. All handed in; this file has no clock. */
  readonly stamp: string;
  readonly build: string;
  readonly viewport: string;
  /** `all` — one rig per creature — or the detail rung's pool, past which bodies draw as impostors. */
  readonly rigs: 'all' | 'rung';
  readonly rung: string;
  readonly predation: string;
  readonly camera: string;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const ENDING_WORDS: Readonly<Record<StressEnding, string>> = Object.freeze({
  broke: `held under ${THRESHOLDS[THRESHOLDS.length - 1]} fps for ${BREAK_HOLD_S} s — the breaking point`,
  ceiling: `reached the ${MAX_CREATURES}-creature ceiling while still over ${THRESHOLDS[THRESHOLDS.length - 1]} fps — NOT a breaking point`,
  timeout: `ran past ${MAX_RUN_S} s — NOT a breaking point`,
  stopped: 'stopped by hand — NOT a breaking point',
});

function fps(value: number): string {
  return value > 0 ? value.toFixed(1) : '—';
}

/**
 * THE COPYABLE REPORT. One block of plain text, the numbers Joshua
 * listed and the conditions they were measured under — and the honest
 * caveats, because a number pasted into a card outlives the
 * conversation that produced it:
 *
 *   - the count that matters is the one at 30 fps, which is the one he
 *     asked for and the one at the top;
 *   - the creatures do not avoid or collide with one another (nothing
 *     in `creatures/` does), so this measures thinking, moving, sensing
 *     and drawing, and not crowding;
 *   - a run stopped by the ceiling or by hand is not a breaking point,
 *     and says so where the ending is printed.
 */
export function stressReport(result: StressResult, conditions: StressConditions): string {
  const at = (want: number): Crossing | null => result.crossings.find((c) => c.fps === want) ?? null;
  const thirty = at(30);
  const lines: string[] = [];

  lines.push('STRESS TEST COMPLETE — TRADDOMIUM Creature Lab');
  lines.push('');
  lines.push(thirty === null
    ? `SUSTAINED AT 30+ FPS: ${result.creatures} creatures — never fell below 30 fps (${ENDING_WORDS[result.ending]})`
    : thirty.creatures === 0
      ? 'SUSTAINED AT 30+ FPS: 0 creatures — READ THE CAVEAT BELOW'
      : `SUSTAINED AT 30+ FPS: ${thirty.creatures} creatures`);
  // A threshold recorded at zero is a reading about the EMPTY bench, and
  // therefore about this device and this build rather than about the
  // crowd — the number Joshua asked for cannot be measured on a phone
  // that was already under the line before the first insect arrived. Say
  // so where it is read, not in a footnote.
  const empties = result.crossings.filter((c) => c.creatures === 0);
  if (empties.length > 0) {
    lines.push('');
    lines.push(`CAVEAT: the bench was ALREADY under ${empties.map((c) => c.fps).join(' / ')} fps with NO`);
    lines.push('insects on it, so that threshold measures this device drawing an empty');
    lines.push('room — not creature density. This run cannot answer the density question.');
  }
  lines.push('');
  lines.push(`Total insects       ${result.creatures}`);
  const names = Object.keys(result.bySpecies).sort();
  for (const id of names) lines.push(`  ${id.padEnd(16)}${result.bySpecies[id]}`);
  lines.push('');
  lines.push(`Test duration       ${result.durationS.toFixed(1)} s`);
  lines.push(`Average FPS         ${fps(result.averageFps)}`);
  lines.push(`Average frame time  ${result.averageFrameMs.toFixed(1)} ms`);
  lines.push(`Lowest FPS (5 s)    ${fps(result.lowestFps)}`);
  lines.push(`Worst single frame  ${result.worstFrameMs.toFixed(0)} ms`);
  lines.push(`Final FPS           ${fps(result.finalFps)}   (when spawning stopped)`);
  lines.push(`FPS after ${RECOVERY_S} s hold  ${fps(result.recoveryFps)}   (no new insects)`);
  lines.push('');
  lines.push('INSECTS AT EACH THRESHOLD');
  for (const want of THRESHOLDS) {
    const c = at(want);
    lines.push(c === null
      ? `  below ${String(want).padStart(2)} fps      never reached`
      : `  below ${String(want).padStart(2)} fps      ${String(c.creatures).padEnd(5)} (${c.atS.toFixed(0)} s)${c.creatures === 0 ? '  ← empty bench' : ''}`);
  }
  lines.push('');
  lines.push(`Ended: ${ENDING_WORDS[result.ending]}`);
  lines.push('');
  lines.push('CONDITIONS');
  lines.push(`  build      ${conditions.build}`);
  lines.push(`  when       ${conditions.stamp}`);
  lines.push(`  viewport   ${conditions.viewport}`);
  lines.push(`  rigs       ${conditions.rigs === 'all' ? 'ALL — one animated skeleton per insect' : `RUNG (${conditions.rung}) — the rest draw as impostors`}`);
  lines.push(`  detail     ${conditions.rung}`);
  lines.push(`  predation  ${conditions.predation}`);
  lines.push(`  camera     ${conditions.camera}`);
  lines.push(`  spawn rate 1 per ${SPAWN_EVERY_S} s, seeded — RUN AGAIN repeats this exact sequence`);
  lines.push('');
  lines.push('NOTE: creatures do not collide with or avoid one another — no such');
  lines.push('system exists yet. This measures AI, senses, movement and drawing.');
  return lines.join('\n');
}

/**
 * THE LIVE BLOCK — what the panel shows while a run is going. Short
 * enough to read at a glance on a phone held at arm's length, and it
 * says which threshold the run is waiting for, so the number that is
 * about to be recorded is never a surprise.
 */
export function stressBlock(r: StressReadout): string {
  const lines: string[] = [];
  const phase = r.phase === 'warmup' ? 'WARMING UP'
    : r.phase === 'spawning' ? 'SPAWNING'
      : r.phase === 'recovery' ? `SETTLING · ${r.recoveryLeftS.toFixed(0)} s left`
        : r.phase.toUpperCase();
  lines.push(`STRESS TEST · ${phase}`);
  lines.push(`insects   ${r.creatures}`);
  lines.push(r.fps > 0 ? `fps       ${r.fps.toFixed(1)}  (${WINDOW_S} s average)` : `fps       — (filling the ${WINDOW_S} s window)`);
  lines.push(`elapsed   ${r.elapsedS.toFixed(0)} s`);
  lines.push(r.nextFps === null ? 'waiting   the hold under the last threshold' : `waiting   for the average to fall under ${r.nextFps}`);
  if (r.crossings.length > 0) {
    lines.push('');
    for (const c of r.crossings) lines.push(`below ${String(c.fps).padStart(2)}  ${String(c.creatures).padEnd(5)} (${c.atS.toFixed(0)} s)`);
  }
  return lines.join('\n');
}
