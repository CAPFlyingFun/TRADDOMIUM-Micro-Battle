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
 *   spawning   the species drawn from a SEEDED generator so RUN AGAIN
 *              is the same test and not another one (CLAUDE.md: never
 *              `Math.random`), at a rate that RAMPS — one a second for
 *              the first ten seconds of spawning, two for the next ten,
 *              three for the ten after that (below). Each threshold
 *              records the count the first time the rolling average
 *              falls through it.
 *   recovery   spawning stops when the average has held under the last
 *              threshold for `BREAK_HOLD_S`; the bodies already there
 *              keep living for `RECOVERY_S` so the report can say what
 *              the phone settles to once nothing new is arriving.
 *   done       the report stands until RUN AGAIN or RESET.
 *
 * ─── the ramp, and what reading it costs ────────────────────────────
 *
 * Joshua, 2026-09-10, correcting his own first wording: "I meant
 * increase the rate every 10 seconds, like the example, rather than
 * every 10 spawned insects: 0-10 s = 1/sec, 10-20 s = 2/sec, 20-30 s =
 * 3/sec, 30-40 s = 4/sec etc. That should let us reach the actual
 * breaking point much faster." The run that asked for it is why: at one
 * a second the phone was still locked at 60.1 fps when the test's own
 * four-hundredth creature stopped it, so the flat rate had spent seven
 * minutes measuring patience rather than the phone. Under the ramp the
 * same four hundred arrive in a hundred seconds and ten thousand inside
 * eight minutes.
 *
 * The clock the rate is read from is the SPAWNING clock and not the
 * run's: the settle and the window fill are the bench being built, and
 * a rate measured from them would open at two a second.
 *
 * WHAT IT COSTS, and why every count now carries a ±. A threshold is
 * crossed by a FIVE-SECOND average, so the crowd has already grown by
 * five seconds of arrivals before the average can report the crossing
 * at all: at rate N a count is good to about ±5N — ±5 at the start,
 * ±200 at forty a second. That is not noise to be tidied away, it is
 * the price of reaching the breaking point in one sitting, so the rate
 * in force is recorded ON the crossing, printed beside it, and the
 * arithmetic is stated in the report. A ramped run that printed a bare
 * "below 30 fps: 812" would be claiming a precision it does not have.
 *
 * ─── the DRAWN census, and the two kinds of number in it ────────────
 *
 * Joshua, 2026-09-10, after the first real run: repeat it at RIGS: RUNG
 * and say "how many creatures were drawn as full rigs versus
 * impostors". That census is the only thing that makes the two runs
 * readable side by side — 178 bodies carrying 178 skeletons and 178
 * bodies carrying eight are not the same measurement, and the totals
 * alone cannot tell them apart. So the scene hands a `StressSample` in
 * with the frame time, and the run keeps the census beside every
 * threshold it records as well as at the end.
 *
 * The two millisecond figures in that sample are NOT the same kind of
 * number, and the report must never print them as though they were.
 * `drawMs` is the scene's own wall time around the creature renderer,
 * taken this frame, so its mean is a per-frame cost and comes OUT of
 * the frame. `aiMs` is `CreatureSim.cost()`, which answers the LAST
 * TICK's reading — and the sim does not necessarily tick every frame —
 * so its mean is the shape of a tick repeated, not a budget, and it is
 * printed outside the frame's split for exactly that reason.
 *
 * THE CENSUS ACCOUNTS FOR EVERYONE, which is what `notDrawn` is for.
 * The first RIGS: RUNG run reported four hundred placed and 13 rigs +
 * 332 impostors drawn, and Joshua asked where the other fifty-five had
 * gone: they were earthworms underground, which the renderer refuses to
 * draw while no cutaway is open. The refusal is correct; three numbers
 * that do not add up to the crowd are what made it read as fifty-five
 * lost animals. So the report prints the identity — rigs + impostors +
 * not drawn = placed — and prints the DISCREPANCY when it fails, since
 * a renderer and a run that disagree about how many bodies exist is
 * exactly the thing worth knowing.
 *
 * A run driven with NO samples — every test that predates them, and any
 * caller with nothing to measure — leaves every census number null, and
 * the report then prints neither block rather than a column of zeroes.
 * A zero standing in for "nobody counted" is the one error a pasted
 * report can never be recovered from.
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
 * object made once, and the species a frame owes come back in ONE array
 * that is emptied and refilled rather than a new one each frame — this
 * object sits inside the thing it is measuring, and at forty a second
 * most frames would otherwise allocate.
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

/**
 * The FIRST bracket's interval: one creature every this many seconds
 * until the ramp's first step, and the unit every later rate is a
 * multiple of. Joshua's original brief: "1 random currently implemented
 * insect per second".
 */
export const SPAWN_EVERY_S = 1;

/**
 * How often the rate gains one a second, seconds of SPAWNING (never of
 * the run — the header says why). Joshua, 2026-09-10: "0-10 s = 1/sec,
 * 10-20 s = 2/sec, 20-30 s = 3/sec, 30-40 s = 4/sec etc."
 */
export const RAMP_EVERY_S = 10;

/** The frame rates whose creature count the run records, highest first. Joshua's four. */
export const THRESHOLDS: readonly number[] = Object.freeze([45, 30, 20, 10]);

/** How long the average must hold under the last threshold before spawning stops, seconds. Joshua: "about 5 seconds". */
export const BREAK_HOLD_S = 5;

/** How long the bodies keep living after spawning stops, seconds. Joshua: "another 10 seconds". */
export const RECOVERY_S = 10;

/**
 * The most creatures a run will place. GAME TUNING, and a GUARD rather
 * than a target — Joshua, 2026-09-10: "remove the 400 stress-test
 * ceiling. Keep going until we actually cross the FPS thresholds and hit
 * the existing under-10-FPS stop condition." Ten thousand is far past
 * anything a phone is expected to hold, which is the whole point of the
 * number; it is not removed altogether because a run that spawns until
 * the tab is killed loses its report, and the report is the one thing
 * the run is for. A run that reaches this stops and SAYS it stopped
 * here — the ending reads "NOT a breaking point" — so it can never be
 * mistaken for a limit of the phone.
 */
export const MAX_CREATURES = 10_000;

/**
 * The longest a run may take, seconds. GAME TUNING, the same guard from
 * the other side, and the ramp is what keeps it comfortable: after k
 * ten-second brackets a run has placed 5k(k+1), so 44 whole brackets is
 * 9,900 at 440 s of spawning and the forty-fifth rate clears the last
 * hundred a couple of seconds later — the ten-thousandth creature lands
 * about 442 s in, plus the five-second window fill. Ten minutes would
 * allow roughly 18,000, so the creature ceiling is always what a long
 * run meets first, and this stays what it was for: anything past ten
 * minutes is a run nobody is still watching.
 */
export const MAX_RUN_S = 600;

/** The seed the species draw runs on, so two runs are the same run. */
export const STRESS_SEED = 0x57_2e_55;

/**
 * THE RATE IN FORCE after `spawningS` seconds of SPAWNING, creatures a
 * second: one more each `RAMP_EVERY_S`, in units of the first bracket's
 * interval, so a caller that asked for a slower base keeps the base it
 * asked for and the ramp still doubles it, trebles it and so on.
 *
 * Exported because the run, the report, the live panel and the tests all
 * have to mean the same thing by "at 4/s", and a second copy of this
 * arithmetic is how they would stop meaning it.
 */
export function stressRatePerS(spawningS: number, spawnEveryS: number = SPAWN_EVERY_S): number {
  const brackets = Number.isFinite(spawningS) && spawningS > 0 ? Math.floor(spawningS / RAMP_EVERY_S) : 0;
  return (1 + brackets) / spawnEveryS;
}

/**
 * HOW MANY CREATURES THE RAMP HAS OWED after `spawningS` seconds of
 * spawning — the rate INTEGRATED over the run rather than a clock ticked
 * down, which is what makes a bracket's turn cost nothing.
 *
 * A spawn clock that accumulates seconds and pays one out per interval
 * is the obvious shape and it is subtly wrong here: at the moment the
 * bracket turns, whatever is banked on that clock is suddenly measured
 * against the SHORTER interval, so a clock holding the second it was
 * about to pay one for pays TWO instead. Once per bracket, always in the
 * same direction, and by the fortieth it has silently added a creature
 * to every count in the report. The integral cannot do that: k whole
 * brackets have owed exactly `RAMP_EVERY_S`·k(k+1)/2 — Joshua's 5k(k+1)
 * at his ten seconds and one a second — and the part-bracket owes its
 * own rate times its own seconds. Nothing is dropped either: the caller
 * places the difference between what is owed and what it has placed, so
 * a frame long enough to owe eight hands back eight.
 */
export function stressOwedBy(spawningS: number, spawnEveryS: number = SPAWN_EVERY_S): number {
  if (!(Number.isFinite(spawningS) && spawningS > 0 && spawnEveryS > 0)) return 0;
  const brackets = Math.floor(spawningS / RAMP_EVERY_S);
  const rest = spawningS - brackets * RAMP_EVERY_S;
  return ((RAMP_EVERY_S * brackets * (brackets + 1)) / 2 + (brackets + 1) * rest) / spawnEveryS;
}

/**
 * HOW WRONG A THRESHOLD'S COUNT MAY BE, in creatures: the arrivals the
 * rolling window sees before it can report the crossing (the header's
 * ±5N). Whole, because a count is. The window is a parameter rather
 * than the constant because a run may have been driven on a shorter
 * one, and a ± that quietly assumed five seconds would be exactly the
 * kind of number this function exists to prevent.
 */
export function crossingSlack(rate: number, windowS: number = WINDOW_S): number {
  return Number.isFinite(rate) && rate > 0 && windowS > 0 ? Math.round(rate * windowS) : 0;
}

export type StressPhase = 'idle' | 'warmup' | 'spawning' | 'recovery' | 'done';

/** Why a run stopped spawning — the report says which, because they mean different things. */
export type StressEnding = 'broke' | 'ceiling' | 'timeout' | 'stopped';

/**
 * WHAT THE SCENE SAW THIS FRAME, handed in beside the frame time. The
 * run keeps none of the renderer's or the sim's vocabulary — these are
 * four numbers — but it is the only place that knows which frame they
 * belong to, which is what makes a census at a threshold possible.
 */
export interface StressSample {
  /** Creatures drawn with an animated skeleton this frame (LOD0). */
  readonly rigs: number;
  /**
   * Creatures wearing the REAL MESH with their bones held still (LOD1):
   * moved through the world every frame, re-posed a few times a second.
   * The middle tier, and the number this whole ladder exists to price —
   * a body here keeps its silhouette without paying for six legs, two
   * antennae and a gaster sixty times a second.
   */
  readonly reduced: number;
  /** Creatures drawn as a 20-triangle impostor this frame. */
  readonly impostors: number;
  /**
   * Creatures the renderer did NOT draw this frame: an earthworm under
   * the soil with no cutaway open, or a body past a pool or a cap. It is
   * not an error term — refusing to draw what cannot be seen is the
   * renderer working — it is the number that makes the census add up to
   * the crowd (the header).
   */
  readonly notDrawn: number;
  /** The creature simulation's own cost, ms — its LAST TICK's reading. */
  readonly aiMs: number;
  /** The creature renderer's own wall time this frame, ms. */
  readonly drawMs: number;
  /**
   * THE CAPS the two mesh counts above are up against, and the DEMAND
   * the radii put on them: how many bodies were inside `LOD0_IN` and
   * inside `LOD1_IN` of the eye before any budget refused them.
   *
   * Joshua, 2026-09-10, looking at 1,077 insects in the one-metre room:
   * "LOD still not correct and rendering as a procedural too close". It
   * was not the centre and it was not the radii — it was thirteen of
   * thirteen full rigs, with some four hundred bodies inside the radius
   * that wanted one. `13` on its own cannot say that; `13 / 13, 412
   * asked` can, and it is the difference between the ladder having
   * nothing nearer to draw and the ladder having nothing left to give.
   */
  readonly rigBudget: number;
  readonly reducedBudget: number;
  readonly withinFull: number;
  readonly withinReduced: number;
}

/** One threshold, and the run when it fell through it. */
export interface Crossing {
  readonly fps: number;
  /** Creatures alive when the average first fell below `fps`. */
  readonly creatures: number;
  /** Seconds into the run. */
  readonly atS: number;
  /** Rigs drawn on the frame that recorded this, or null when the run was driven without samples. */
  readonly rigs: number | null;
  /** Bodies on the middle tier on that same frame, or null. */
  readonly reduced: number | null;
  /** Impostors drawn on that same frame, or null. */
  readonly impostors: number | null;
  /**
   * The spawn rate in force when this was recorded, creatures a second.
   * The count above is good to about `crossingSlack` of it, so a
   * crossing at 40/s is a different KIND of number from one at 1/s and
   * must never be printed as though it were the same.
   */
  readonly rate: number;
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
  /** The latest sample's rig count, or null while nothing has been measured. */
  readonly rigs: number | null;
  /** The latest sample's middle-tier count, or null. */
  readonly reduced: number | null;
  /** The latest sample's impostor count, or null. */
  readonly impostors: number | null;
  /** The latest sample's not-drawn count, or null. */
  readonly notDrawn: number | null;
  /**
   * THE CAPS AND THE DEMAND on the latest sample, or null. `rigs` and
   * `reduced` above say what the ladder SPENT; these say what it was
   * allowed and how many bodies were inside each radius asking. A near
   * body drawn as an ellipsoid means one of two entirely different
   * things depending on which of these is binding.
   */
  readonly rigBudget: number | null;
  readonly reducedBudget: number | null;
  readonly withinFull: number | null;
  readonly withinReduced: number | null;
  /** The spawn rate now, creatures a second — one more every `RAMP_EVERY_S` of spawning. */
  readonly rate: number;
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
  private speciesPool: readonly CreatureId[];
  private readonly seed: number;
  private readonly spawnEveryS: number;
  private readonly maxCreatures: number;
  private rand: () => number;

  private phase: StressPhase = 'idle';
  private settled = 0;
  private elapsed = 0;
  /**
   * Seconds spent SPAWNING — the ramp's own clock, and not `elapsed`
   * (the header). The only spawn state there is: what is owed at any
   * moment is a function of this and `count`, so there is no second
   * clock to fall out of step with it.
   */
  private spawningS = 0;
  private belowLast = 0;
  private recovered = 0;
  private ending: StressEnding | null = null;

  private count = 0;
  private readonly counts = new Map<CreatureId, number>();
  private readonly crossings: Crossing[] = [];

  /**
   * THE SPECIES THIS FRAME OWES: one array for the life of the run,
   * emptied at the top of every `frame` and refilled. The caller places
   * what is in it and lets go of it; keeping it would be keeping a
   * window onto the next frame's answer.
   */
  private readonly owed: CreatureId[] = [];

  /** The whole run's frames and seconds, for the average; and the extremes. */
  private runFrames = 0;
  private runSeconds = 0;
  private worstFrameS = 0;
  private lowestFps = Infinity;
  /** The rolling average at the moment spawning stopped, and at the end of the recovery. */
  private brokeAtFps = 0;
  private recoveryFps = 0;

  /**
   * THE CENSUS, over the frames a sample actually arrived on. Separate
   * from `runFrames` because the two are not the same population: a
   * caller may drive the run with no samples at all, and a mean over
   * frames nobody measured is not a mean.
   */
  private lastSample: StressSample | null = null;
  private sampleFrames = 0;
  private drawMsTotal = 0;
  private aiMsTotal = 0;
  private peakRigsSeen = 0;
  private peakImpostorsSeen = 0;

  constructor(options: StressOptions) {
    this.speciesPool = options.species.slice();
    this.seed = options.seed ?? STRESS_SEED;
    // Clamped positive: the spawn clock DRAINS in a while-loop now, so a
    // zero or negative interval would not be a very fast run, it would be
    // a frame that never ends.
    const every = options.spawnEveryS ?? SPAWN_EVERY_S;
    this.spawnEveryS = Number.isFinite(every) && every > 0 ? every : SPAWN_EVERY_S;
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
    this.spawningS = 0;
    this.belowLast = 0;
    this.recovered = 0;
    this.ending = null;
    this.count = 0;
    this.counts.clear();
    this.crossings.length = 0;
    this.owed.length = 0;
    this.runFrames = 0;
    this.runSeconds = 0;
    this.worstFrameS = 0;
    this.lowestFps = Infinity;
    this.brokeAtFps = 0;
    this.recoveryFps = 0;
    this.lastSample = null;
    this.sampleFrames = 0;
    this.drawMsTotal = 0;
    this.aiMsTotal = 0;
    this.peakRigsSeen = 0;
    this.peakImpostorsSeen = 0;
  }

  /** The species this run draws from. */
  get pool(): readonly CreatureId[] {
    return this.speciesPool;
  }

  /**
   * DRAW FROM THESE SPECIES FROM NOW ON — the workers-only, queens-only,
   * flies-only runs Joshua asked for after the mixed one, to find which
   * animal is the expensive one.
   *
   * It refuses while a run is going rather than throwing, because it is
   * wired to a button a thumb can reach mid-run and a half-changed pool
   * would make the report a lie about its own sequence. Otherwise it
   * RESETS: a run drawn from a different pool is a different test, so
   * the standing report, the counts and the seeded draw must not survive
   * into it. An empty pool is refused outright — a run with nothing to
   * spawn never reaches a threshold and never ends.
   */
  setPool(species: readonly CreatureId[]): void {
    if (this.running || species.length === 0) return;
    this.speciesPool = species.slice();
    this.reset();
  }

  /** Stop a run where it stands and go straight to the report (the button says STOP). */
  stop(): void {
    if (!this.running) return;
    this.finish('stopped');
  }

  /** The spawn rate now, creatures a second: `stressRatePerS` on the spawning clock. */
  rate(): number {
    return stressRatePerS(this.spawningS, this.spawnEveryS);
  }

  /**
   * ONE FRAME. Returns the species to spawn now — usually none, usually
   * one once the ramp is going, and SEVERAL when a frame is long or the
   * rate is high: at forty a second and sixty frames a second a frame
   * owes less than one, but a 200 ms hitch at that rate owes eight, and
   * a run that dropped seven of them would under-count the crowd exactly
   * where the phone is struggling — which is the only place the run is
   * looking.
   *
   * The caller MUST place every one it is given: the count is advanced
   * here, and a report whose count and bench disagreed would be
   * worthless. The array is the run's own and is emptied by the next
   * call, so place them now rather than keeping it.
   */
  frame(rawDt: number, sample?: StressSample | null): readonly CreatureId[] {
    this.owed.length = 0;
    if (!this.running) return this.owed;
    const dt = Number.isFinite(rawDt) && rawDt > 0 ? rawDt : 0;

    // THE SETTLE. These frames are thrown away — not averaged, not
    // counted, not on the run's clock — because they belong to the
    // rebuild the button just did and not to the bench. The run begins
    // when this ends.
    // Only in the warm-up: a run STOPped inside its own settle must
    // still be able to reach its report rather than sit here forever.
    // A sample handed in with such a frame goes with it: a rig count
    // taken while the bench is being torn down is a census of a rebuild.
    if (this.phase === 'warmup' && this.settled < SETTLE_S) {
      this.settled += dt;
      return this.owed;
    }

    this.window.add(rawDt);
    this.elapsed += dt;
    if (dt > 0) {
      this.runFrames += 1;
      this.runSeconds += dt;
      if (dt > this.worstFrameS) this.worstFrameS = dt;
      if (sample) this.measure(sample);
    }

    // The window must be full before any reading is used for anything:
    // a threshold crossed on two seconds of frames is a claim about a
    // scene that was still loading (the header).
    if (!this.window.full()) return this.owed;
    const fps = this.window.fps();
    if (fps < this.lowestFps) this.lowestFps = fps;

    if (this.phase === 'warmup') {
      this.phase = 'spawning';
      this.spawningS = 0;
    }

    if (this.phase === 'recovery') {
      this.recovered += dt;
      this.recoveryFps = fps;
      if (this.recovered >= RECOVERY_S) this.phase = 'done';
      return this.owed;
    }

    // THE RAMP'S CLOCK, which starts HERE and not at `start()`: the
    // settle and the window fill are the bench being built, and a rate
    // read from the run's clock would open the spawning at two a second.
    this.spawningS += dt;
    const rate = this.rate();

    // THE THRESHOLDS, in order and once each: a run that falls straight
    // past three of them in one bad frame records all three at the count
    // it had, which is the truth about that count.
    for (let i = this.crossings.length; i < THRESHOLDS.length; i += 1) {
      if (fps >= THRESHOLDS[i]) break;
      this.crossings.push({
        fps: THRESHOLDS[i],
        creatures: this.count,
        atS: this.elapsed,
        // This frame's census, not the run's latest: at RIGS: RUNG the
        // rig pool fills early and every body after it is an impostor,
        // so the split AT THIS COUNT is the whole point of the line.
        rigs: this.lastSample?.rigs ?? null,
        reduced: this.lastSample?.reduced ?? null,
        impostors: this.lastSample?.impostors ?? null,
        // The rate is what says how precise the count beside it is, so it
        // is recorded WITH it: reconstructing it from `atS` later would
        // be reconstructing it from a clock that is not the one the ramp
        // was read from.
        rate,
      });
    }

    // THE BREAKING POINT: the average held under the last threshold for
    // the hold. Anything above it resets the hold, so one lucky frame
    // does not end the run and one unlucky one does not either.
    const last = THRESHOLDS[THRESHOLDS.length - 1];
    this.belowLast = fps < last ? this.belowLast + dt : 0;
    if (this.belowLast >= BREAK_HOLD_S) {
      this.finish('broke');
      return this.owed;
    }
    if (this.elapsed >= MAX_RUN_S) {
      this.finish('timeout');
      return this.owed;
    }

    // WHAT THIS FRAME OWES: everything the ramp has owed since spawning
    // opened, less what has already been placed. Nothing is carried in a
    // clock, so the frame a bracket turns on neither drops a spawn nor
    // pays one twice (`stressOwedBy` argues it), and a frame that owes
    // several hands back several — which is not the exception it sounds
    // like, since one interval is 25 ms by the fortieth bracket and a
    // frame is longer than that whenever the phone is in the state the
    // run is looking for.
    const due = Math.floor(stressOwedBy(this.spawningS, this.spawnEveryS));
    while (this.count < due) {
      if (this.count >= this.maxCreatures) {
        this.finish('ceiling');
        return this.owed;
      }
      const species = this.speciesPool[Math.min(this.speciesPool.length - 1, Math.floor(this.rand() * this.speciesPool.length))];
      this.count += 1;
      this.counts.set(species, (this.counts.get(species) ?? 0) + 1);
      this.owed.push(species);
    }
    return this.owed;
  }

  /**
   * ONE MEASURED FRAME'S CENSUS. A sample whose numbers are not all
   * finite and non-negative is not a measurement and is dropped whole,
   * the way `RollingFps` drops a frame time that is not one: half a
   * sample would put a NaN through every mean that follows and the
   * report would print it.
   */
  private measure(s: StressSample): void {
    if (!(ok(s.rigs) && ok(s.impostors) && ok(s.notDrawn) && ok(s.aiMs) && ok(s.drawMs))) return;
    this.lastSample = s;
    this.sampleFrames += 1;
    this.drawMsTotal += s.drawMs;
    this.aiMsTotal += s.aiMs;
    if (s.rigs > this.peakRigsSeen) this.peakRigsSeen = s.rigs;
    if (s.impostors > this.peakImpostorsSeen) this.peakImpostorsSeen = s.impostors;
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
      rigs: this.lastSample?.rigs ?? null,
      rigBudget: this.lastSample?.rigBudget ?? null,
      reducedBudget: this.lastSample?.reducedBudget ?? null,
      withinFull: this.lastSample?.withinFull ?? null,
      withinReduced: this.lastSample?.withinReduced ?? null,
      reduced: this.lastSample?.reduced ?? null,
      impostors: this.lastSample?.impostors ?? null,
      notDrawn: this.lastSample?.notDrawn ?? null,
      rate: this.rate(),
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
      windowS: this.window.windowS,
      finalRigs: this.lastSample?.rigs ?? null,
      finalReduced: this.lastSample?.reduced ?? null,
      finalImpostors: this.lastSample?.impostors ?? null,
      finalNotDrawn: this.lastSample?.notDrawn ?? null,
      finalRigBudget: this.lastSample?.rigBudget ?? null,
      finalReducedBudget: this.lastSample?.reducedBudget ?? null,
      finalWithinFull: this.lastSample?.withinFull ?? null,
      finalWithinReduced: this.lastSample?.withinReduced ?? null,
      peakRigs: this.sampleFrames > 0 ? this.peakRigsSeen : null,
      peakImpostors: this.sampleFrames > 0 ? this.peakImpostorsSeen : null,
      meanDrawMs: this.sampleFrames > 0 ? this.drawMsTotal / this.sampleFrames : null,
      meanAiMs: this.sampleFrames > 0 ? this.aiMsTotal / this.sampleFrames : null,
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
  /** The rolling window the thresholds were read through, seconds — what a crossing's ± is five of. */
  readonly windowS: number;
  /** The census of the LAST measured frame; null when the run was driven without samples. */
  readonly finalRigs: number | null;
  /** Bodies on the middle tier at the end: the real mesh, bones held still. */
  readonly finalReduced: number | null;
  readonly finalImpostors: number | null;
  /** Bodies the renderer drew NEITHER way on that frame — the crowd's remainder (the header). */
  readonly finalNotDrawn: number | null;
  /**
   * THE LADDER'S CAPS AND ITS DEMAND on the last measured frame. The
   * four counts above say what was drawn; these say what the renderer
   * was allowed to draw and how many bodies were inside each tier's
   * radius asking to be. A report without them cannot answer the one
   * question a crowded room raises — whether a near ellipsoid is the
   * ladder finding nobody closer, or the ladder having nothing left.
   */
  readonly finalRigBudget: number | null;
  readonly finalReducedBudget: number | null;
  readonly finalWithinFull: number | null;
  readonly finalWithinReduced: number | null;
  /** The most rigs, and the most impostors, drawn in any one measured frame. */
  readonly peakRigs: number | null;
  readonly peakImpostors: number | null;
  /** The creature renderer's mean wall time over the measured frames, ms — a true per-frame cost. */
  readonly meanDrawMs: number | null;
  /** The mean of `CreatureSim.cost()` over those frames, ms — a TICK's reading, not a frame's (the header). */
  readonly meanAiMs: number | null;
}

/** What the run was run under, printed so two runs can be compared honestly. */
export interface StressConditions {
  /** Human-readable: the device, the build, the day. All handed in; this file has no clock. */
  readonly stamp: string;
  readonly build: string;
  readonly viewport: string;
  /** `all` — one rig per creature — or the detail rung's pool, past which bodies draw as impostors. */
  readonly rigs: 'all' | 'rung' | 'rung2' | 'rung4';
  readonly rung: string;
  readonly predation: string;
  readonly camera: string;
  /** Which species the run drew from, in words: `all five, mixed`, `queen only` (`labTool.stressPoolWords`). */
  readonly pool: string;
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

/** A spawn rate in words: `4/s`, and a fraction only where the run's base made one. */
function rateWords(rate: number): string {
  if (!(Number.isFinite(rate) && rate > 0)) return '—';
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2)}/s`;
}

/** A census number, or an em-dash: a run nobody measured has no zero to print. */
function whole(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * A COUNT AGAINST ITS CAP — `13/13`, or just the count when nothing
 * capped it. It is the whole of the instrument this release adds: the
 * count says what the ladder spent and the cap says what it had, and a
 * near animal drawn as an ellipsoid means one thing when they are equal
 * and an entirely different one when they are not.
 */
function ofCap(value: number | null, cap: number | null): string {
  if (value === null) return '—';
  return cap === null || cap <= 0 ? String(value) : `${value}/${cap}`;
}

/** A millisecond figure in the frame block's right-aligned column, or an em-dash there. */
function msCol(value: number | null): string {
  return (value === null ? '—' : value.toFixed(1)).padStart(7);
}

/** Whether a sampled number is one: finite and not negative. A count and a duration are both. */
function ok(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
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
 *     and says so where the ending is printed;
 *   - every threshold count carries the ± the ramp costs it and the rate
 *     it was crossed at, because a count reached at forty a second is
 *     good to about two hundred and must not be pasted as though it were
 *     good to one;
 *   - the drawn census ACCOUNTS for the whole crowd — rigs, impostors and
 *     the bodies nobody drew, summed against the number placed — and
 *     prints the discrepancy rather than hiding it if they disagree;
 *   - the census blocks appear only when the scene measured one, so a
 *     report that does not mention rigs is a report that did not count
 *     them rather than one that found none.
 */
export function stressReport(result: StressResult, conditions: StressConditions): string {
  const at = (want: number): Crossing | null => result.crossings.find((c) => c.fps === want) ?? null;
  const thirty = at(30);
  // The window is the RUN's, not the constant: a run driven on a shorter
  // one has a smaller ± and must be allowed to say so.
  const slackOf = (c: Crossing): number => crossingSlack(c.rate, result.windowS);
  const lines: string[] = [];

  lines.push('STRESS TEST COMPLETE — TRADDOMIUM Creature Lab');
  lines.push('');
  lines.push(thirty === null
    ? `SUSTAINED AT 30+ FPS: ${result.creatures} creatures — never fell below 30 fps (${ENDING_WORDS[result.ending]})`
    : thirty.creatures === 0
      ? 'SUSTAINED AT 30+ FPS: 0 creatures — READ THE CAVEAT BELOW'
      : `SUSTAINED AT 30+ FPS: ${thirty.creatures} creatures  (± ${slackOf(thirty)}, arriving at ${rateWords(thirty.rate)})`);
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

  // WHAT WAS ACTUALLY DRAWN. The whole reason the run is repeated at
  // RIGS: RUNG: the totals are the same test, the split is not.
  if (result.finalRigs !== null || result.finalImpostors !== null || result.finalNotDrawn !== null || result.peakRigs !== null) {
    lines.push('');
    lines.push('DRAWN AT THE END');
    lines.push(`  ${'full rigs'.padEnd(20)}${ofCap(result.finalRigs, result.finalRigBudget)}   (animated every frame)`);
    lines.push(`  ${'reduced'.padEnd(20)}${ofCap(result.finalReduced, result.finalReducedBudget)}   (real mesh, bones held still)`);
    lines.push(`  ${'impostors'.padEnd(20)}${whole(result.finalImpostors)}`);
    lines.push(`  ${'not drawn'.padEnd(20)}${whole(result.finalNotDrawn)}   (underground burrowers, or past a cap)`);
    if (result.finalWithinFull !== null || result.finalWithinReduced !== null) {
      lines.push('  ---');
      // WHAT THE LADDER WAS ASKED FOR, against what it was allowed. Two
      // counts that are equal to their caps with hundreds asking is the
      // signature of a BUDGET limit; counts short of their caps is the
      // signature of there being nobody else near enough to serve.
      lines.push(`  ${'inside LOD0'.padEnd(20)}${whole(result.finalWithinFull)}   (wanted a full rig)`);
      lines.push(`  ${'inside LOD1'.padEnd(20)}${whole(result.finalWithinReduced)}   (wanted the mesh)`);
    }
    lines.push('  ---');
    // THE IDENTITY, and WHAT IT IS AGAINST. The three above are the
    // RENDERER's count — every body it was handed — while `creatures` is
    // the RUN's, which counts only what the run itself spawned. Those are
    // not the same number and were never going to be: the room the run
    // spawns into already has animals in it (the Creature Lab's own five
    // stand on the bench before STRESS is pressed), and a mixed run of
    // four therefore has nine bodies in the room. Reporting the gap as a
    // disagreement, as this block first did, cried bug at the bench being
    // a bench. So the total is the renderer's, the run's own count is
    // named beside it, and the remainder is stated as what it is.
    if (result.finalRigs !== null && result.finalImpostors !== null && result.finalNotDrawn !== null) {
      const drawn = result.finalRigs + (result.finalReduced ?? 0) + result.finalImpostors + result.finalNotDrawn;
      lines.push(`  ${'bodies in the room'.padEnd(20)}${drawn}`);
      lines.push(`  ${'of those, the run\'s'.padEnd(20)}${result.creatures}`);
      const already = drawn - result.creatures;
      if (already > 0) {
        lines.push(`  ${'already there'.padEnd(20)}${already}   (the bench's own animals, not spawned by this run)`);
      } else if (already < 0) {
        // The only direction that IS a disagreement: the run cannot have
        // spawned more bodies than the renderer was ever handed.
        lines.push(`  MISMATCH: the run placed ${result.creatures} but only ${drawn} reached the renderer —`);
        lines.push(`  ${-already} ${already === -1 ? 'body is' : 'bodies are'} unaccounted for, which is a bug.`);
      }
    } else {
      lines.push(`  ${'total placed'.padEnd(20)}${result.creatures}`);
    }
    lines.push(`  ${'peak full rigs'.padEnd(20)}${whole(result.peakRigs)}`);
  }

  // WHERE THE FRAME WENT. Two figures that split the frame, and a third
  // that deliberately does not.
  if (result.meanDrawMs !== null || result.meanAiMs !== null) {
    const drawn = result.meanDrawMs;
    // Floored at zero: the two means are taken over different populations
    // of frames (every frame, and every SAMPLED frame), so a run whose
    // samples all landed on its slow frames can subtract to a negative,
    // and a negative here would read as the renderer giving time back.
    const rest = drawn === null ? null : Math.max(0, result.averageFrameMs - drawn);
    lines.push('');
    lines.push('WHERE THE FRAME WENT (mean per frame)');
    lines.push(`  ${'creature drawing'.padEnd(16)}${msCol(drawn)} ms`);
    lines.push(`  ${'everything else'.padEnd(16)}${msCol(rest)} ms   (terrain, sky, UI, present, and the sim)`);
    // THE THIRD LINE IS NOT PART OF THE SPLIT, and the next person to read
    // this will try to make the three add up. They do not and must not:
    // the sim's work is already inside `everything else` (it is inside the
    // frame time the whole split is taken from), and it is not even a
    // per-frame number — `CreatureSim.cost()` answers its LAST TICK, and
    // the sim does not tick every frame. Adding it to the drawing figure
    // would count it twice and call a tick's cost a frame's.
    lines.push(`  ${'sim tick'.padEnd(16)}${msCol(result.meanAiMs)} ms   (the sim's own last-tick reading, not a per-frame cost)`);
  }

  lines.push('');
  lines.push('INSECTS AT EACH THRESHOLD');
  for (const want of THRESHOLDS) {
    const c = at(want);
    if (c === null) {
      lines.push(`  below ${String(want).padStart(2)} fps      never reached`);
      continue;
    }
    // The census this threshold was crossed AT, when there is one: at
    // RIGS: RUNG the rig pool is full long before 30 fps, so the count
    // and the split tell two different halves of the same story.
    const census = c.rigs === null && c.impostors === null ? ''
      : `   ${whole(c.rigs)} rigs · ${whole(c.reduced)} reduced · ${whole(c.impostors)} impostors`;
    const empty = c.creatures === 0 ? '  ← empty bench' : '';
    // The ± and the rate ride WITH the count rather than being left to a
    // footnote, because the count is what gets pasted somewhere else.
    // Each group is padded to its own column so four lines read down as
    // well as across, and the line is trimmed so one with no census does
    // not end in that padding.
    const when = `(${c.atS.toFixed(0)} s)`.padEnd(9);
    const slack = `± ${String(slackOf(c)).padEnd(5)}at ${rateWords(c.rate).padEnd(6)}`;
    lines.push(`  below ${String(want).padStart(2)} fps      ${String(c.creatures).padEnd(6)}${when}${slack}${census}${empty}`.trimEnd());
  }
  lines.push('');
  lines.push(`Each count is good to about ± one ${result.windowS} s window of arrivals at the rate`);
  lines.push('printed beside it: the average cannot report a crossing until the crowd');
  lines.push('has already grown by that much. At 1/s that is ± 5; at 40/s, ± 200. The');
  lines.push('ramp is what buys a breaking point in one sitting, and that is its price.');
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
  lines.push(`  pool       ${conditions.pool}`);
  lines.push(`  spawn rate 1 per ${SPAWN_EVERY_S} s, +1/s every ${RAMP_EVERY_S} s of spawning`);
  lines.push('             (1/s, 2/s, 3/s …), seeded — RUN AGAIN repeats this exact sequence');
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
  // The split, while it is happening: at RIGS: RUNG this is the line that
  // shows the rig pool filling and the impostors taking over.
  if (r.rigs !== null || r.impostors !== null || r.notDrawn !== null) {
    // EACH COUNT AGAINST ITS CAP. `4/13` is the ladder running out of
    // animals; `13/13` is the ladder running out of budget, and the
    // nearest body it could not serve is an ellipsoid however close it
    // stands. The counts alone cannot tell those apart, which is what
    // "LOD still not correct and rendering as a procedural too close"
    // was looking at on a bench reading 13 of 13.
    lines.push(`drawn     ${ofCap(r.rigs, r.rigBudget)} rigs · ${ofCap(r.reduced, r.reducedBudget)} reduced`);
    lines.push(`          ${whole(r.impostors)} impostors · ${whole(r.notDrawn)} not drawn`);
    if (r.withinFull !== null || r.withinReduced !== null) {
      // The DEMAND, by distance alone and before any budget refused it.
      lines.push(`inside    ${whole(r.withinFull)} at LOD0 · ${whole(r.withinReduced)} at LOD1`);
    }
  }
  lines.push(r.fps > 0 ? `fps       ${r.fps.toFixed(1)}  (${WINDOW_S} s average)` : `fps       — (filling the ${WINDOW_S} s window)`);
  lines.push(`elapsed   ${r.elapsedS.toFixed(0)} s`);
  // The rate only while it is doing anything: printed during the recovery
  // it would read as a bench still filling up, which is the one thing the
  // recovery is not.
  if (r.phase === 'spawning') lines.push(`rate      ${rateWords(r.rate)}`);
  lines.push(r.nextFps === null ? 'waiting   the hold under the last threshold' : `waiting   for the average to fall under ${r.nextFps}`);
  if (r.crossings.length > 0) {
    lines.push('');
    for (const c of r.crossings) lines.push(`below ${String(c.fps).padStart(2)}  ${String(c.creatures).padEnd(5)} (${c.atS.toFixed(0)} s)`);
  }
  return lines.join('\n');
}
