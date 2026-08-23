/**
 * THE SEA, AS ONE FUNCTION THAT TWO PROCESSORS AGREE ON.
 *
 * Ported from Beyond Extinction's ocean, which got the important thing
 * right and wrote down why: the swell is a SUM OF SINES rather than a
 * Gerstner wave, so the surface height at a world position is an exact
 * evaluation with no horizontal roll to invert. That is what lets the
 * CPU answer "how high is the sea here" directly — for buoyancy, for a
 * queen washed off a rock, for anything that has to float — while the
 * vertex shader draws the same surface from the same numbers.
 *
 * ONE SOURCE, TWO CONSUMERS. `WAVES` below is the only place the swell
 * is described. `seaHeightAt` reads it; `swellGLSL()` writes shader code
 * from it. A CPU buoyancy that disagreed with the drawn surface would
 * float her a hand's breadth above the water or drown her on a crest,
 * and the only way that can happen is if two places did the arithmetic.
 *
 * THE FLOATING ORIGIN IS THE HARD PART, and BE contributes nothing to
 * it because BE never had one. Its shader tiles off raw world position:
 * fine at 56,000, and at TMB's 5,600,000 it is the ground-texture bug
 * again — float32 spacing at 2.8 million is a quarter of a unit, so a
 * wave phase reconstructed on the GPU quantises. So nothing large ever
 * reaches the shader. The wave phase at the origin is folded into
 * `[0, 2π)` HERE, in float64, and the shader adds it to the small local
 * position. See `foldAt` and the test that proves a rebase does not
 * move the sea.
 *
 * ONE UNIT IS A CENTIMETRE, as everywhere. Wavelengths and amplitudes
 * are real metres times a hundred.
 */

/**
 * Sea level, and the whole reason relief never disturbs it.
 *
 * `groundHeight` returns `relief * height`, so the shoreline moves up
 * and down with the vertical-exaggeration dial — but zero times
 * anything is zero, so the waterline stays exactly where the coastline
 * says it is. Lakes and rivers get no such gift; see WATER_PORT.md 3c.
 */
export const SEA_LEVEL = 0;

/**
 * A directional sine: unit direction, wavelength, amplitude, and how
 * fast its phase turns. Lengths in world units, speed in radians a
 * second.
 */
export interface Wave {
  readonly dx: number;
  readonly dz: number;
  readonly length: number;
  readonly height: number;
  readonly speed: number;
}

/**
 * A CALM KAUAʻI DAY, at the island's real scale.
 *
 * The three components and their periods are Beyond Extinction's, which
 * are real ocean wavelengths and stay real: 118, 67 and 39 metres.
 *
 * THE AMPLITUDES ARE NOT BE'S, and that is deliberate. BE shrank its
 * swell to a tenth of a metre because a first-person human swimmer
 * floats with their eye barely above the waterline, and a real swell
 * would have towered crests over the camera and filled the lower half
 * of the view with water. That is a fix for a human's eye height, not a
 * fact about the sea, and it is exactly the class of number
 * WATER_PORT.md says not to inherit. Here the sum is 0.56 m of
 * amplitude — a little over a metre crest to trough, which is a calm
 * day on this coast.
 *
 * To an ant that is enormous, and it should be. A queen is two
 * centimetres long. The open ocean is not a place she survives, and the
 * sea has no obligation to pretend otherwise.
 */
export const WAVES: readonly Wave[] = [
  { dx: 1.0, dz: 0.0, length: 11_800, height: 30, speed: 0.82 },
  { dx: 0.6, dz: 0.8, length: 6_700, height: 17, speed: 0.98 },
  { dx: -0.7593, dz: 0.6508, length: 3_900, height: 9, speed: 1.2 },
];

/** The most the sea can ever be above or below its level. */
export const SWELL = WAVES.reduce((sum, wave) => sum + wave.height, 0);

/** Radians of phase per world unit travelled along a wave's direction. */
function turn(wave: Wave): number {
  return (2 * Math.PI) / wave.length;
}

/**
 * The phase each wave has already accumulated at the floating origin,
 * folded into one cycle.
 *
 * THE WHOLE FLOATING-ORIGIN ANSWER, and it is three lines because it is
 * done in float64 where 2.8 million is nothing. A sine is periodic, so
 * the phase at `origin + local` is the phase at `origin` plus the phase
 * over `local` — and only the second of those is small enough for the
 * GPU. Take the first modulo a full turn here and hand the shader a
 * number under 6.3.
 *
 * Call it on every rebase. The sea does not move; see the test.
 */
export function foldAt(originX: number, originZ: number): Float32Array {
  const folded = new Float32Array(WAVES.length);
  for (let i = 0; i < WAVES.length; i++) {
    const wave = WAVES[i];
    const along = wave.dx * originX + wave.dz * originZ;
    const full = 2 * Math.PI;
    folded[i] = ((turn(wave) * along) % full + full) % full;
  }
  return folded;
}

/**
 * How high the sea is at a WORLD position, in world units above
 * `SEA_LEVEL`.
 *
 * Exact, not sampled. This is the function the shader draws.
 *
 * @param seconds the shared clock — the same one handed to the material
 */
export function seaHeightAt(wx: number, wz: number, seconds: number): number {
  let height = 0;
  for (const wave of WAVES) {
    height += wave.height
      * Math.sin(turn(wave) * (wave.dx * wx + wave.dz * wz) - wave.speed * seconds);
  }
  return height;
}

/**
 * The surface's slope there — the analytic derivative of the above.
 *
 * Analytic rather than differenced because the shader needs a normal
 * per vertex and a finite difference would cost three more evaluations
 * to get a worse answer. The normal is `normalize(-dx, 1, -dz)`.
 */
export function seaSlopeAt(
  wx: number, wz: number, seconds: number,
): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const wave of WAVES) {
    const k = turn(wave);
    const rate = wave.height * k
      * Math.cos(k * (wave.dx * wx + wave.dz * wz) - wave.speed * seconds);
    x += rate * wave.dx;
    z += rate * wave.dz;
  }
  return { x, z };
}

/**
 * HOW FAST THE WATER ITSELF IS MOVING, and which way.
 *
 * The sea surface going up and down is only half of a wave. The water
 * under it travels in orbits — forward under a crest, back under a
 * trough — and that is the half that picks a queen up and puts her
 * somewhere else.
 *
 * FREE, AND EXACT, from the table already here. For a linear deep-water
 * wave the horizontal particle velocity at the surface is
 *
 *     u = A · ω · sin(θ)  along the wave's direction
 *       = ω · η
 *
 * — in phase with the elevation, so it is literally the surface height
 * times the angular frequency. No second model, no tuning constant, and
 * no way for the water to flow one way while the wave that carries it
 * goes another. That is the same discipline as `swellGLSL`, and it is
 * most of the reason a sum of sines was chosen over a Gerstner wave.
 *
 * Peak here is about half a metre a second. A queen is ELEVEN
 * MILLIMETRES long and runs at a quarter of a metre a second, so the
 * open sea moves twice as fast as she does before a wave has broken.
 */
export function seaFlowAt(
  wx: number, wz: number, seconds: number,
): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const wave of WAVES) {
    const rise = wave.height
      * Math.sin(turn(wave) * (wave.dx * wx + wave.dz * wz) - wave.speed * seconds);
    x += wave.speed * rise * wave.dx;
    z += wave.speed * rise * wave.dz;
  }
  return { x, z };
}

/** The fastest the open sea can ever carry her, world units a second. */
export const FLOW = WAVES.reduce((sum, w) => sum + w.height * w.speed, 0);

/**
 * The same swell, as GLSL, generated from the same table.
 *
 * WRITTEN RATHER THAN WRITTEN TWICE. The constants are baked into the
 * source at full precision, so there is no uniform array to keep in
 * step and no way for the drawn surface to drift from the one the CPU
 * answers about.
 *
 * `p` is the LOCAL position and `phase` the folded origin phase, so the
 * two together are the world position — without either of them ever
 * being large. That is the rule of this file.
 */
export function swellGLSL(): string {
  const height: string[] = [];
  const slope: string[] = [];
  WAVES.forEach((wave, i) => {
    const k = turn(wave);
    const arg = `${k.toExponential(9)}*(${wave.dx.toFixed(6)}*p.x`
      + `+${wave.dz.toFixed(6)}*p.y)+phase[${i}]-${wave.speed.toFixed(4)}*t`;
    height.push(`h+=${wave.height.toFixed(4)}*sin(${arg});`);
    slope.push(`g+=${(wave.height * k).toExponential(9)}*cos(${arg})`
      + `*vec2(${wave.dx.toFixed(6)},${wave.dz.toFixed(6)});`);
  });
  return `
    float seaH(vec2 p, float t, vec3 phase) {
      float h = 0.0; ${height.join(' ')} return h;
    }
    vec2 seaSlope(vec2 p, float t, vec3 phase) {
      vec2 g = vec2(0.0); ${slope.join(' ')} return g;
    }`;
}
