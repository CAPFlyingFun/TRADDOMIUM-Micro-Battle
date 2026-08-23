/**
 * WIND SHE CAN ACTUALLY FEEL — height, and the fact that it breathes.
 *
 * Two things turn one number from a weather station into air a queen
 * can fly in.
 *
 * IT IS NOT THE SAME WIND AT HER HEIGHT. A reported wind is measured at
 * TEN METRES, by international convention, and the air below that is
 * slowed by the ground it is dragging over. At half a millimetre up —
 * where a queen who has just left the grass is — there is essentially
 * no wind at all, which is exactly why she can take off in weather that
 * would otherwise be several times her airspeed. Applying the ten-metre
 * figure the instant her feet leave the ground is what sent her
 * skidding sideways off the launch.
 *
 * IT DOES NOT HOLD STILL. A station reports a SUSTAINED speed and a
 * GUST — two numbers describing a thing that is never at either for
 * long. Feeding the average in gives air like a wind tunnel: constant,
 * directionless in its steadiness, and dead.
 *
 * The second half of that problem is already solved, in Joshua's own
 * work: StormTracker's Weather gauge takes exactly these two numbers
 * off a METAR and drives a needle that reads like real air. The model
 * below is that one, ported — see `LiveWind`.
 */

/**
 * How much of the reported wind reaches a given height.
 *
 * Zero at the ground, half by five metres, all of it by ten — the shape
 * Joshua specified, as a smoothstep so it eases in at the bottom
 * instead of ramping off the ground linearly.
 *
 * A NOTE ON THE REAL PROFILE, since this is game tuning and should say
 * so. Atmospheric science uses the logarithmic wind profile,
 * u(z) ∝ ln(z/z0), with a roughness length z0 of a few centimetres over
 * grass. That curve is far more aggressive down low: it passes half the
 * ten-metre wind at about HALF a metre rather than five, so a queen a
 * body length up would already be in a third of it. True, and
 * unplayable when the trades run six to ten times her airspeed. This
 * keeps the honest endpoints — nothing at the surface, everything at
 * the reference height — and a gentler middle.
 *
 * @param heightUnits height above ground in world units (1 unit = 1 cm)
 */
export function windProfile(heightUnits: number): number {
  const metres = Math.max(0, heightUnits) / 100;
  const t = Math.min(1, metres / FULL_WIND_METRES);
  return t * t * (3 - 2 * t);
}

/** Height at which she feels the whole reported wind, in metres. */
export const FULL_WIND_METRES = 10;

// ── Perlin noise ───────────────────────────────────────────────────
// Ported verbatim from StormTracker (`docs/js/weather.js`, `_wn`) so the
// air over Kauaʻi in this game wanders on the same curve as the needle
// on Joshua's gauge. Ken Perlin's reference permutation table, doubled
// gradient set, quintic fade.
const PERM = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30,
  69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94,
  252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136,
  171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229,
  122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63,
  161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188,
  159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38,
  147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42,
  223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172,
  9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246,
  97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249,
  14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121, 50, 45,
  127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78,
  66, 215, 61, 156, 180,
];

const GRAD: readonly (readonly [number, number])[] = [
  [1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function grad(hash: number, x: number, y: number): number {
  const g = GRAD[hash % 8];
  return g[0] * x + g[1] * y;
}

/** Two-dimensional Perlin noise, roughly −1..1. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = PERM[(PERM[xi] + yi) & 255];
  const ab = PERM[(PERM[xi] + yi + 1) & 255];
  const ba = PERM[(PERM[(xi + 1) & 255] + yi) & 255];
  const bb = PERM[(PERM[(xi + 1) & 255] + yi + 1) & 255];
  return mix(
    mix(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    mix(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v,
  );
}

// ── The model's constants, all from StormTracker ───────────────────

/**
 * The band the wind wanders inside, as shares of the day's two numbers.
 *
 * Half the sustained speed at the bottom, a tenth above the gust at the
 * top. Note what this says: a lull is a real event, and a gust is very
 * nearly the top of the range rather than a number the wind sits at.
 */
const FLOOR_SHARE = 0.5;
const CEIL_SHARE = 1.1;

/**
 * ORDINARY AIR IS SYMMETRIC ABOUT THE REPORTED SPEED. The one place
 * this deviates from StormTracker, and it is worth the paragraph.
 *
 * There, ordinary picks are spread across the whole floor-to-ceiling
 * band and pulled toward wherever the sustained speed happens to sit
 * inside it. That band is lopsided — for "6 gusting 11" it runs 3 to
 * 12.1, three below the reported speed and six above — so the average
 * of the simulated wind comes out at 7.11 against a reported 6. A fifth
 * more wind than the station measured.
 *
 * On a gauge that is invisible: the needle looks right and nobody
 * integrates it. Here the same number is a force on a queen whose
 * cruise is comparable to the wind itself, and the HUD prints the
 * station's figure beside it. A sustained speed IS an average, so the
 * simulation's average has to be it.
 *
 * So ordinary air spans an interval CENTRED on the reported speed,
 * reaching down to StormTracker's lull floor and the same distance up.
 * Gusts still reach the true ceiling — they are excursions above the
 * average, which is exactly what a gust is. The mean now lands on the
 * reported speed plus the small honest contribution of the gusts.
 */
const ORDINARY_HALF_WIDTH = 1 - FLOOR_SHARE;

/** Seconds between targets. StormTracker's default sim interval. */
export const PICK_SECONDS = 5;

/**
 * How far along the noise curve one pick moves.
 *
 * NOT one cell, which is what StormTracker's `noise(tSec * 0.2, …)` on a
 * five-second timer literally says — and which is a trap worth writing
 * down, because it cost this file a rewrite and only a test caught it.
 *
 * Perlin noise is IDENTICALLY ZERO at every lattice point; that is how
 * it is built. Sample it once per whole cell from a clock that starts
 * at zero and every single reading is zero, forever. The first version
 * of this port did exactly that, and produced a wind that never veered
 * by a degree and picked the same speed at every pick — a very
 * elaborate way to write a constant.
 *
 * StormTracker escapes it by accident: its clock is wall time and its
 * `setInterval` drifts, so it never lands on the lattice. A simulated
 * clock lands on it exactly, every time.
 *
 * The reciprocal of the golden ratio is the standard way out. Its
 * multiples never repeat and spread as evenly through each cell as any
 * sequence can, so consecutive picks read genuinely different parts of
 * the curve while still moving along it slowly enough to be smooth.
 */
const CELLS_PER_PICK = 2 / (1 + Math.sqrt(5));
const NOISE_RATE = CELLS_PER_PICK / PICK_SECONDS;

/**
 * Which rows of the noise field speed and direction are read from.
 *
 * Both offset off the integer lattice for the reason above — on a whole
 * row the field collapses to a one-dimensional slice through the
 * gradients' x-components alone, which zeroes a quarter of the cells
 * outright and makes the two rows agree far more often than two
 * independent signals should.
 */
export const SPEED_ROW = 0.5;
export const DIRECTION_ROW = 100.5;

/** Chance per pick that this one is a gust rather than ordinary air. */
const GUST_CHANCE = 0.08;

/** A gust lands within this share of the range below the ceiling. */
const GUST_DEPTH = 0.08;

/**
 * How hard picks are pulled back toward the reported sustained speed.
 *
 * The noise is near enough uniform; raising the distance from centre to
 * this power before spending it is what makes the wind spend most of
 * its life near what the station actually reported, with the edges of
 * the band as occasional visits. Without it a "12 mph, gusting 20" day
 * would read as a steady 15. Being an odd reshaping of a symmetric
 * draw, it moves where the wind spends its time without moving the
 * average.
 */
const BIAS_EXPONENT = 1.8;

/**
 * Veer either side of the reported direction, in degrees, at the noise
 * peak. StormTracker's figure; the noise rarely reaches ±1, so in
 * practice the air wanders about ±3–4° over a few tens of seconds.
 */
export const VEER_DEGREES = 5;

/**
 * Never grind through more than this many missed picks in one frame.
 * A tab left in the background for an hour should resume, not hang.
 */
const CATCH_UP_LIMIT = 64;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** One target, or one sample: a speed and a direction offset. */
export interface WindSample {
  /** Metres per second. */
  readonly speedMps: number;
  /** Degrees off the reported bearing, positive clockwise. */
  readonly veerDegrees: number;
}

/**
 * THE LIVE WIND — Joshua's StormTracker gauge model, ported.
 *
 * StormTracker takes a METAR's sustained speed and gust and drives a
 * needle that reads like real air rather than an average. It works in
 * four moves, all of which are here:
 *
 *   1. The two numbers define a BAND — half the sustained at the floor,
 *      a tenth over the gust at the ceiling.
 *   2. Every five seconds it picks a new TARGET inside that band from
 *      Perlin noise, pulled toward where the sustained speed actually
 *      sits, so ordinary air stays ordinary.
 *   3. Eight times in a hundred that pick is instead a GUST, thrown
 *      near the ceiling.
 *   4. It SMOOTHSTEPS to the target rather than jumping, and the
 *      direction wanders on its own row of the same noise field.
 *
 * Ported rather than reinvented on purpose. The first version of this
 * file was three sine waves I made up, which is a fine way to get
 * movement and a poor way to get weather: sines have a period you can
 * hear, no notion of a lull, and no reason for a gust to be rare.
 *
 * WHAT IS DELIBERATELY LEFT OUT. StormTracker also nudges the band's
 * centre toward the next hour's forecast, and recomputes its displayed
 * gust as a rolling maximum of the simulated speed. The first needs
 * hourly data this layer does not carry; the second is a readout, and
 * the game's gust number should stay the one the station reported.
 *
 * The clock is SIMULATED seconds, not wall time, so the air breathes at
 * the same pace on any device and a paused game holds its breath.
 */
export class LiveWind {
  private clock = 0;
  private started = false;
  private sustained = 0;
  private gust = 0;
  private floor = 0;
  private ordinary = 0;
  private ceiling = 0;
  private from: WindSample = { speedMps: 0, veerDegrees: 0 };
  private to: WindSample = { speedMps: 0, veerDegrees: 0 };
  private pickedAt = 0;
  private current: WindSample = { speedMps: 0, veerDegrees: 0 };
  private readonly random: () => number;

  /**
   * @param random the gust roll; injectable so tests are deterministic
   */
  constructor(random: () => number = Math.random) {
    this.random = random;
  }

  /**
   * Advance the air and read it.
   *
   * Pass the day's reported numbers every frame — a fresh observation
   * simply re-bases the band and eases on from wherever the wind
   * currently is, the same way StormTracker handles a METAR refresh.
   *
   * @param sustainedMps the reported mean wind
   * @param gustMps the reported gust; equal to sustained on a steady day
   * @param dt simulated seconds
   */
  update(sustainedMps: number, gustMps: number, dt: number): WindSample {
    const mean = Math.max(0, sustainedMps);
    const peak = Math.max(mean, gustMps);

    if (!this.started) {
      this.started = true;
      this.rebase(mean, peak, { speedMps: mean, veerDegrees: 0 });
    } else if (mean !== this.sustained || peak !== this.gust) {
      this.rebase(mean, peak, this.current);
    }

    this.clock += Math.max(0, dt);

    let caught = 0;
    while (this.clock - this.pickedAt >= PICK_SECONDS) {
      if (++caught > CATCH_UP_LIMIT) {
        // Gone for a very long time. Land on the boundary rather than
        // spinning; the wind resumes from a fresh pick either way.
        this.pickedAt = this.clock;
        break;
      }
      this.pickedAt += PICK_SECONDS;
      this.from = this.to;
      // Sampled at the BOUNDARY, never at the frame that noticed it.
      // The frame lands anywhere up to one dt past the boundary, so
      // reading the clock here would give a phone at 15fps a different
      // day from a desktop at 120 — the same wind arriving in coarser
      // steps is fine, a different wind is not.
      this.to = this.pick(this.pickedAt);
    }

    const p = clamp((this.clock - this.pickedAt) / PICK_SECONDS, 0, 1);
    const eased = p * p * (3 - 2 * p);
    // The band is a safety net on the ease, not a gate the wind has to
    // pass through. A fresh observation legitimately starts the ease
    // OUTSIDE the new band — a jump from 6 to 14 m/s lifts the floor
    // above where the air currently is — and clamping to the new floor
    // there would turn every refresh into the visible step the easing
    // exists to prevent. It eases in over the next five seconds
    // instead, so the net only has to cover where it started.
    const low = Math.min(this.floor, this.from.speedMps);
    const high = Math.max(this.ceiling, this.from.speedMps);
    this.current = {
      speedMps: clamp(
        this.from.speedMps + (this.to.speedMps - this.from.speedMps) * eased,
        low,
        high,
      ),
      veerDegrees:
        this.from.veerDegrees + (this.to.veerDegrees - this.from.veerDegrees) * eased,
    };
    return this.current;
  }

  /** The last sample, without advancing. */
  get sample(): WindSample {
    return this.current;
  }

  /** Still air again — respawns and scene resets. */
  reset(): void {
    this.clock = 0;
    this.started = false;
    this.pickedAt = 0;
    this.current = { speedMps: 0, veerDegrees: 0 };
  }

  /**
   * New observation: rebuild the band and set off from where we are.
   *
   * Easing on from the CURRENT value rather than from the new reported
   * one is what stops a refresh being visible as a step. StormTracker
   * does the same on every METAR poll.
   */
  private rebase(mean: number, peak: number, from: WindSample): void {
    this.sustained = mean;
    this.gust = peak;
    this.floor = Math.max(0, mean * FLOOR_SHARE);
    this.ordinary = mean + mean * ORDINARY_HALF_WIDTH;
    // NOT StormTracker's `if (ceil <= floor) ceil = floor + 1`. That
    // guard only ever fires on a dead calm — with any wind at all,
    // 1.1 × gust already exceeds 0.5 × sustained — and there it invents
    // a band of one unit. One km/h is invisible on a gauge; one metre
    // per second is a hundred units a second of drift on a queen who
    // cruises at seventy-four. Still air is the correct answer to a
    // reported calm, and `pick` handles the empty band.
    //
    // The floor under it is the ordinary ceiling rather than the lull
    // floor: a day the station reports with no gust at all still has
    // air that moves, and stations report no gust because the gusts are
    // below a threshold, not because there are none.
    this.ceiling = Math.max(this.ordinary, peak * CEIL_SHARE);
    this.from = from;
    this.pickedAt = this.clock;
    this.to = this.pick(this.pickedAt);
  }

  /** Where the wind is heading over the next five seconds. */
  private pick(at: number): WindSample {
    const t = at * NOISE_RATE;
    const veerDegrees = noise2(t, DIRECTION_ROW) * VEER_DEGREES;
    const range = this.ceiling - this.floor;
    if (!Number.isFinite(range) || range <= 0) {
      // A reported calm. Still air, and nothing to interpolate.
      return { speedMps: this.floor, veerDegrees };
    }

    // A gust is an event, not a level. Eight rolls in a hundred throw
    // the target at the top of the band; the rest of the time the wind
    // has no idea the gust figure exists.
    if (this.random() < GUST_CHANCE) {
      const surge = this.ceiling - this.random() * range * GUST_DEPTH;
      return { speedMps: clamp(surge, this.floor, this.ceiling), veerDegrees };
    }

    // Ordinary air: a draw symmetric about the reported speed, pulled
    // toward it, and never reaching as high as a gust.
    const off = (noise2(t, SPEED_ROW) + 1) / 2 - 0.5;
    const reach = Math.min(1, Math.abs(off) * 2);
    const pull = Math.pow(reach, BIAS_EXPONENT) * 0.5;
    const biased = 0.5 + (off < 0 ? -pull : pull);
    return {
      speedMps: this.floor + biased * (this.ordinary - this.floor),
      veerDegrees,
    };
  }
}

// ── Shelter ────────────────────────────────────────────────────────

/**
 * HOW MUCH OF THE WIND ACTUALLY REACHES HER, given what is upwind.
 *
 * The height profile above answers "how far off the deck is she",
 * which on open ground is the whole question and in a canyon is not
 * the question at all. Flown down one on the device, she was carried
 * about by a wind that in reality would have been broken up by two
 * hundred metres of rock standing between her and it. A gorge is a
 * calm place unless the wind runs ALONG it.
 *
 * So: look upwind. Walk out along the bearing the air is coming from
 * and ask how much of the terrain out there stands above her. That
 * single test gives the canyon answer for free and WITHOUT KNOWING
 * WHAT A CANYON IS — cross the gorge and the wall is right there, turn
 * along it and the fetch runs clear to the end. Joshua's condition,
 * "basically 0.0 unless the winds run through them", falls out of the
 * geometry rather than being written in.
 *
 * WHAT COUNTS IS THE ANGLE, not the height and not the distance. A
 * ridge two metres up and six away shelters exactly as well as one
 * four up and twelve, because shelter is about how much sky is cut
 * off, and that is a slope: rise over run. Measuring the two
 * separately, as this first did, needed a fudge factor to trade them
 * off and got a six-metre gorge wrong by a third.
 *
 * NOT A FLUID MODEL, and it should not pretend to be. Real shelter
 * involves separation, recirculation and a wake that reattaches
 * downstream; a lee slope can gust harder than the open. This is
 * line-of-sight occlusion, which gets the first-order thing right —
 * you are out of the wind when something is between you and it — for
 * six heightfield samples.
 *
 * @param wx her position, world units
 * @param wz her position, world units
 * @param altitude HER height above the sea, world units — not her AGL.
 *   A ridge shelters her if it stands higher THAN SHE IS; how far she
 *   happens to be off the floor at the time is beside the point.
 * @param fromX unit vector pointing INTO the wind (where it comes from)
 * @param fromZ
 * @param groundAt the drawn terrain, injected so this module stays free
 *   of the heightfield and the tests can hand it a shape
 * @returns the share of the wind that gets through, 0 to 1
 */
export function shelter(
  wx: number, wz: number, altitude: number,
  fromX: number, fromZ: number,
  groundAt: (x: number, z: number) => number,
): number {
  let worst = 0;
  for (const reach of SHELTER_REACH) {
    const over = groundAt(wx + fromX * reach, wz + fromZ * reach) - altitude;
    if (over <= 0) continue;
    // The tangent of the angle that ridge subtends from where she is.
    const slope = Math.min(1, over / reach / SHELTER_TAN);
    const blocked = slope * slope * (3 - 2 * slope);
    if (blocked > worst) worst = blocked;
  }
  return 1 - worst;
}

/**
 * How far upwind to look, in world units — one to twelve metres.
 *
 * Geometric rather than even, because the near samples are the ones
 * that decide whether she is tucked in behind something and the far
 * ones only refine it. Six of them, which is enough that a wall does
 * not slide between two samples in a gorge as narrow as she can fly.
 */
export const SHELTER_REACH = [100, 200, 350, 550, 800, 1_200] as const;

/**
 * The elevation angle at which terrain blocks the wind completely,
 * as a tangent. Fifteen degrees.
 *
 * Generous compared with a wind-engineering rule of thumb, which puts
 * useful shelter within a few ridge-heights downwind — but this is a
 * queen two centimetres long, and the surface roughness she flies
 * through is not the roughness a weather station stands in.
 */
export const SHELTER_TAN = Math.tan((15 * Math.PI) / 180);
