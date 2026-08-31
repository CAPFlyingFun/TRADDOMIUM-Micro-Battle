/**
 * THE QUEEN'S OWN CLOCK, and only hers.
 *
 * A cross-island flight is twenty minutes of real sitting there. Joshua,
 * 2026-08-31: "time is cut greatly for gameplay fun and not waiting for
 * 20+ minutes just to move in the map". So while the autopilot is
 * flying, her simulation runs ten seconds for every one the world
 * spends — she covers the ground ten times faster, and the player waits
 * two minutes instead of twenty.
 *
 * ONE TIME SCALE, NOT EIGHT MULTIPLIERS, and that distinction is the
 * whole design. The obvious version multiplies her airspeed and the
 * wind by ten and calls it done, and it is wrong in a way that only
 * shows up in the turns: her turn RATE, her climb rate, her
 * acceleration and her braking would all still happen at the old pace,
 * so at ten times the speed she would need ten times the room to come
 * round — a turning radius, as ChatGPT put it, the size of Rhode Island
 * by ant standards. Scale her TIME instead and every one of those
 * follows for nothing, because they are all integrated against the same
 * dt. The path through space comes out identical. It is the same
 * flight, played faster.
 *
 * `setFlightScale` already existed and is NOT this. It is a settings
 * dial over top speed and thrust, it leaves FLIGHT_TURN_RATE alone, and
 * it therefore has exactly the gremlin described above — at 2x, today.
 *
 * AND IT IS SUBSTEPPED, which is the part that stops the arithmetic
 * being a lie. Handing the flight model one dt ten times as long is
 * mathematically the same and numerically nothing like it: she would
 * turn in chunky increments, overshoot altitude bands, cross a
 * waterline between samples, and blow straight through a waypoint
 * capture. TMB clamps a slow frame at a tenth of a second, so a bad
 * phone frame times ten is a ONE SECOND physics leap — teleport with
 * extra maths. The scaled time is a BUDGET, spent in bounded steps.
 *
 * WHAT IS NOT ON HER CLOCK: the world. The weather, the ocean, the day,
 * the water simulation and anything else alive stay on real time. This
 * is not fast-forward; it is one ant travelling quickly through a world
 * going about its business.
 *
 * WHAT IS: her physiology. Thirst and stamina run on her clock too, so
 * a journey that would have cost twenty minutes of water still costs
 * twenty minutes of water even though the player watched two. Without
 * that, autopilot would quietly hand her ten times the biological range
 * and the survival detours built in Phase 1 would stop meaning
 * anything.
 */

/** The most her clock may outrun the world's. */
export const MAX_TRAVEL = 10;

/**
 * Seconds to ramp all the way in or out.
 *
 * Long enough to read as a machine spooling up rather than a jump cut,
 * short enough that it is not most of a short leg.
 */
export const RAMP_SECONDS = 5;

/**
 * The longest single step her simulation may be given, seconds.
 *
 * A thirtieth of a second: finer than the frame rate the game aims for,
 * so a substep is never coarser than an ordinary unboosted frame. That
 * is the bar — boosted travel must not sample the world more crudely
 * than normal flight does.
 */
export const MAX_STEP = 1 / 30;

/**
 * The most substeps one frame may be cut into.
 *
 * A backstop, not a target. At the clamped worst frame (0.1 s) and full
 * boost the budget is a full second, which wants thirty steps; this
 * allows it. What it refuses is an unbounded loop if a frame ever
 * arrives with a delta nobody expected.
 */
export const MAX_SUBSTEPS = 40;

/** How her clock is spent this frame. */
export interface TravelPlan {
  /** How many times to step her simulation. Always at least one. */
  readonly steps: number;
  /** How long each step is, seconds. */
  readonly each: number;
  /** The whole of her time this frame — `steps * each`. */
  readonly budget: number;
}

/**
 * Cut a span of her time into steps no coarser than an ordinary frame.
 *
 * The last step is not shortened to make the arithmetic tidy: every
 * step is the same length and they sum to the budget exactly, because a
 * short final step is a different-sized integration and the whole point
 * of this is that they are all the same.
 */
export function planSteps(budget: number): TravelPlan {
  const want = Math.max(0, budget);
  if (want <= MAX_STEP) return { steps: 1, each: want, budget: want };
  const steps = Math.min(MAX_SUBSTEPS, Math.ceil(want / MAX_STEP));
  return { steps, each: want / steps, budget: want };
}

/**
 * HER CLOCK, ramped.
 *
 * Holds the scale her simulation is currently running at and eases it
 * toward whatever is being asked for. Nothing here decides WHETHER to
 * boost — that is the scene's business, and this only ever answers
 * "how fast is her clock right now, and how do I spend this frame".
 */
export class TravelScale {
  private at = 1;
  private want = 1;
  private ceiling = MAX_TRAVEL;

  /** How much faster her clock is running than the world's. */
  get scale(): number { return this.at; }

  /** Is she under boost at all? */
  get boosted(): boolean { return this.at > 1.001; }

  /** True while the ramp is still moving either way. */
  get shifting(): boolean { return Math.abs(this.at - this.target()) > 0.001; }

  /**
   * Ask for the boost, or ask for it to stop.
   *
   * MANUAL CONTROL DOES NOT WAIT FOR THE RAMP. Asking for `false` here
   * begins the ease down; it does not gate anything the player does.
   * Their input is authoritative the instant they make it, and this
   * merely stops her clock outrunning the world while that settles —
   * ChatGPT was specific about the distinction and it is the right one.
   */
  ask(on: boolean): void {
    this.want = on ? MAX_TRAVEL : 1;
  }

  /**
   * THE STREAMING BRAKE. She must never accelerate into ground the game
   * cannot answer questions about.
   *
   * At full boost she crosses seven metres a second, so terrain that
   * used to have minutes to arrive now has seconds. Rather than hope
   * the streamer wins the race, the boost quietly gives way: the cap
   * comes down, the ramp follows it, and it climbs back as coverage
   * catches up. A player should see the speed ease off, not a stutter
   * or a hole in the island.
   */
  capAt(times: number): void {
    this.ceiling = Math.max(1, Math.min(MAX_TRAVEL, times));
  }

  /** Back to real time at once — for a scene teardown, not for gameplay. */
  reset(): void {
    this.at = 1;
    this.want = 1;
    this.ceiling = MAX_TRAVEL;
  }

  private target(): number {
    return Math.min(this.want, this.ceiling);
  }

  /**
   * Advance the ramp by one WORLD frame and say how to spend her time.
   *
   * Linear rather than eased, and the reason is the same one the lift
   * lever gives: the ramp is a promise about WHEN — five seconds, every
   * time — and an exponential never quite arrives.
   */
  update(worldDt: number): TravelPlan {
    const to = this.target();
    const step = (MAX_TRAVEL - 1) * (worldDt / RAMP_SECONDS);
    this.at = this.at < to
      ? Math.min(to, this.at + step)
      : Math.max(to, this.at - step);
    return planSteps(worldDt * this.at);
  }
}
