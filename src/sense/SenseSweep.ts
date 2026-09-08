/**
 * ONE SWEEP OF THE ANTENNAE: the object a scene constructs, pings,
 * updates and disposes, and the only place the five parts under it meet.
 *
 * `pulse` is the clock, `candidates` is what the world offers up,
 * `select` is what fits under the caps, and `SenseFills` and
 * `SenseLabels` are the two halves of what is drawn. None of them knows
 * any of the others — the two renderers do not even know that `select`
 * exists — and that is deliberate, because each of them is then a thing
 * with one job and a test of its own. What it costs is an assembler, and
 * this is it: one object, the shape `fauna/FinderView` already has, so a
 * scene wires a FEATURE rather than five parts it has to remember the
 * order of.
 *
 * ─── the sweep is anchored where it was SENT ────────────────────────
 *
 * `ping(at)` records that world point, and the gather and every later
 * selection use it — never the live camera. A player who sends a sweep
 * and then flies off does not drag the light along with them, and does
 * not light up the forest ahead of them either: what the antennae
 * touched is what they touched, and the ten seconds are the ten seconds
 * they hold it for. That is the whole reason `update` takes no origin.
 * It could not honour the anchor if it were handed a second one.
 *
 * The LENS is not the anchor and is passed every frame, because it is a
 * different fact: where the camera stands decides how big a fill and a
 * label are drawn on screen, and the camera may be anywhere.
 *
 * ─── two lists, two schedules ───────────────────────────────────────
 *
 * The world's OBJECTS are gathered ONCE, at the ping. `candidates.ts`
 * says why and it is worth repeating here, where the cost lands: a 16 m
 * cell holds several thousand sites, walking them is the most expensive
 * thing this feature does, and they do not move — so paying for it once
 * a ping instead of sixty times a second is the difference between a
 * sense and a frame the phone drops. The gather is TIMED and the number
 * reaches the HUD (`SenseCost.gatherMs`), because a cost that is paid in
 * one lump on the frame the player pressed the button is exactly the
 * kind that hides from a mean.
 *
 * The ANIMALS are re-read every frame, because they do move, and a worm
 * lit where it was ten seconds ago would be the sense lying about the
 * one thing the player is watching. There are a couple of hundred of
 * them at most and they are already in an array.
 *
 * ─── one array, refilled ────────────────────────────────────────────
 *
 * The gathered objects are held in ONE list that lives as long as this
 * object does; a frame truncates it back to the objects and appends the
 * animals. Nothing rebuilds the thousands. The animals' own rows are
 * minted by `candidates.creatureThings`, which allocates a small array
 * per frame — bounded by what is in reach and knowingly paid, because
 * the alternative is a second copy of the species table's rules
 * (`CREATURE_WORDS`, the cited length) sitting in this file, and a rule
 * with two copies is the thing this codebase spends its boundaries
 * avoiding.
 *
 * The SIGHTINGS are not held at all. `SenseSelection` owns that array
 * and refills it every frame; it is read by the two renderers in the
 * frame it was asked for and never stored.
 *
 * ─── dark costs one branch, and the frame it goes dark costs one more ─
 *
 * While nothing is lit `update` ticks the pulse and returns: no gather,
 * no selection, no renderer work at all. The one thing it may NOT do is
 * return on the FIRST dark frame, because the renderers hold whatever
 * they were last handed — a fill draws until it is told not to — and the
 * forest would stay lit for ever with the pulse insisting it was over.
 * So the sweep keeps one latch, `alive`, and hands both renderers an
 * empty list on the way down. It is one boolean and it is the only
 * latched state here, which is the rule for a latch that is genuinely
 * needed (ARCHITECTURE §2.3).
 */
import * as THREE from 'three';
import type { CreatureState } from '../creatures';
import type { WorldPoint } from '../world/coords';
import { creatureThings, objectThings, type ObjectSource } from './candidates';
import { SENSE_RADIUS, SensePulse, type PulsePhase } from './pulse';
import { SenseSelection } from './select';
import { SenseFills, type SenseLens, type SenseOrigin } from './SenseFills';
import { SenseLabels } from './SenseLabels';
import type { SenseThing, Sighting } from './senseTypes';

/** Wall-clock, for the cost line only — never fed back into anything drawn. */
const now = (): number => performance.now();

/** What the renderers are handed when the light dies. Frozen: nobody may fill it. */
const NOTHING: readonly Sighting[] = Object.freeze([]);

/**
 * The lens `reset` clears with, when there is no camera in the call.
 *
 * Honest rather than a lie about where the camera stands: a renderer
 * handed an empty list never enters the loop that would read one, so the
 * numbers here are unread by construction. A real lens remembered from
 * the last frame would be a camera position kept past the frame it was
 * true in, which is the thing `LocalPoint` exists to stop.
 */
const NO_LENS: SenseLens = { fovRadians: 0, heightPx: 0, at: new THREE.Vector3() };

export interface SenseSweepOptions {
  /** The world's two read-only queries: what is generated in a cell, and the ground under a point. */
  readonly objects: ObjectSource;
  /** How far a sweep reaches, world units. Defaults to `pulse.SENSE_RADIUS`. */
  readonly radius?: number;
  /** Where a world position is drawn. `world/origin.toLocal` is the default; a test hands in its own. */
  readonly origin?: SenseOrigin;
}

/**
 * What one sweep is doing and what it cost, for the HUD. Every number is
 * a measurement of the frame that just ran; nothing here is ever fed
 * back into anything drawn.
 */
export interface SenseCost {
  /** Where the ping is in its life: ready, sweep, hold, fade, cooldown. */
  readonly phase: PulsePhase;
  /** Whether another ping would be accepted right now. */
  readonly ready: boolean;
  /** Simulation seconds until one would be; 0 when it already would be. */
  readonly readyIn: number;
  /** Candidates the selection was offered — the gathered objects plus this frame's animals. */
  readonly things: number;
  /** How many of them the sweep has actually reached and is holding lit. */
  readonly sighted: number;
  /** Fills drawn, and names drawn — each renderer's own count, under its own cap. */
  readonly fills: number;
  readonly labels: number;
  /** Wall-clock milliseconds the last ping's gather took. */
  readonly gatherMs: number;
}

export class SenseSweep {
  /** One group: the fills and the names. A scene adds it once and never touches its insides. */
  readonly group = new THREE.Group();

  private readonly objects: ObjectSource;
  private readonly radius: number;
  private readonly pulse: SensePulse;
  private readonly selection = new SenseSelection();
  private readonly fills: SenseFills;
  private readonly labels: SenseLabels;

  /**
   * THE ONE LIST. The gathered objects occupy the first `objectCount`
   * places for the whole life of a ping; the animals are appended after
   * them every frame.
   */
  private readonly things: SenseThing[] = [];
  private objectCount = 0;

  /** Where the ping was sent from. Null until one is, and again after `reset`. */
  private anchor: WorldPoint | null = null;
  /** Whether the last update found the sweep alight — the one latch (see the header). */
  private alive = false;
  private disposed = false;

  private sighted = 0;
  private gatherMs = 0;

  constructor(options: SenseSweepOptions) {
    this.objects = options.objects;
    const radius = options.radius;
    this.radius = radius !== undefined && radius > 0 ? radius : SENSE_RADIUS;
    this.pulse = new SensePulse(this.radius);
    this.fills = new SenseFills({ origin: options.origin });
    this.labels = new SenseLabels({ origin: options.origin });
    this.group.name = 'sense';
    this.group.add(this.fills.group);
    this.group.add(this.labels.group);
  }

  /** Whether anything is lit. */
  get lit(): boolean {
    return this.pulse.lit;
  }

  /** Whether a ping would be accepted right now. */
  get ready(): boolean {
    return this.pulse.ready;
  }

  get cost(): SenseCost {
    return {
      phase: this.pulse.phase,
      ready: this.pulse.ready,
      readyIn: this.pulse.readyIn,
      things: this.things.length,
      sighted: this.sighted,
      fills: this.fills.drawn,
      labels: this.labels.drawn,
      gatherMs: this.gatherMs,
    };
  }

  /**
   * Send a sweep from `at`, and gather what stands around it.
   *
   * False means the pulse refused it — a sweep is already running or the
   * antennae are still recovering — and A REFUSED PING CHANGES NOTHING:
   * no gather, no new anchor, not so much as a cleared list. The caller
   * shows the refusal (the cooldown is already on the HUD as `readyIn`);
   * it does not retry.
   */
  ping(at: WorldPoint): boolean {
    if (this.disposed) return false;
    if (!this.pulse.ping()) return false;
    this.anchor = at;

    // The whole of the once-per-ping cost, timed: the walk over the
    // cells AND the copy into the list that outlives it, because a
    // number that leaves out the half a profile would find is worse
    // than no number.
    const started = now();
    const found = objectThings(this.objects, at, this.radius);
    this.things.length = 0;
    for (let i = 0; i < found.length; i += 1) this.things.push(found[i]);
    this.objectCount = this.things.length;
    this.gatherMs = Math.max(0, now() - started);
    return true;
  }

  /**
   * Advance the sweep by `dt` SIMULATION seconds and draw what it holds.
   *
   * No origin, on purpose: the sweep is anchored where it was sent (see
   * the header). `creatures` is the simulation's own list, read and
   * never written; `lens` is where the camera stands this frame, which
   * decides how big things are drawn and nothing else.
   */
  update(creatures: readonly CreatureState[], dt: number, lens: SenseLens): void {
    if (this.disposed) return;
    this.pulse.tick(dt);
    if (!this.pulse.lit) {
      // Steady-state dark is this one branch. The frame the light dies
      // is the exception, and it is the whole reason `alive` exists.
      if (this.alive) this.goDark(lens);
      return;
    }

    const anchor = this.anchor;
    // The pulse is only alight because `ping` set both of these, so this
    // is the type system's question rather than the world's.
    if (anchor === null) return;

    // Truncate to the objects gathered at the ping, then append the
    // animals where they are NOW.
    this.things.length = this.objectCount;
    const animals = creatureThings(creatures, anchor, this.radius);
    for (let i = 0; i < animals.length; i += 1) this.things.push(animals[i]);

    // The selection's own array, read in this frame and not kept.
    const sightings = this.selection.select(this.things, anchor, this.radius, this.pulse);
    this.fills.update(sightings, lens);
    this.labels.update(sightings, lens);
    this.sighted = sightings.length;
    this.alive = true;
  }

  /**
   * Back to nothing: no sweep, no anchor, nothing held and nothing drawn.
   *
   * A scene teardown, a session change or a world reload — never
   * gameplay. A ping's own end is the pulse's business and comes through
   * `update` like every other frame.
   */
  reset(): void {
    this.pulse.reset();
    this.anchor = null;
    this.gatherMs = 0;
    this.goDark(NO_LENS);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pulse.reset();
    this.anchor = null;
    this.gatherMs = 0;
    this.goDark(NO_LENS);
    this.fills.dispose();
    this.labels.dispose();
    this.group.remove(this.fills.group, this.labels.group);
  }

  /**
   * Put the light out: let go of what was gathered, and tell both
   * renderers there is nothing, which is the only way they stop drawing.
   *
   * The list's IDENTITY survives — it is the one array — but what it
   * held does not: a few thousand rows kept through a cooldown for a
   * ping that is over would be the feature's whole gather sitting in
   * memory doing nothing.
   */
  private goDark(lens: SenseLens): void {
    this.alive = false;
    this.things.length = 0;
    this.objectCount = 0;
    this.sighted = 0;
    this.selection.clear();
    this.fills.update(NOTHING, lens);
    this.labels.update(NOTHING, lens);
  }
}
