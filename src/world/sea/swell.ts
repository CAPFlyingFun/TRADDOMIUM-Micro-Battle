/**
 * THE SEA'S SWELL — one mathematical surface everybody asks.
 *
 * The ocean is not a plane at y = 0; it is a sum of travelling waves.
 * The whole design is that there is exactly ONE answer to "how high is
 * the sea here, now": this module. The renderer displaces its sheet
 * with the same table (`swellChunk()` bakes it into the vertex shader),
 * the water query adds it to the sea's depth so floating, landing and
 * the underwater look all ride the same surface, and the tests read it
 * directly. The old disease — the renderer says the water is HERE and
 * gameplay says THERE — cannot start if there is only one place an
 * answer can come from.
 *
 * CARRIED FROM v0, DELIBERATELY AND ALMOST UNCHANGED. `docs/research/
 * WATER_SYSTEM_AUDIT.md` §14 verified this module and put it on the
 * protected list: one clock, CPU/GPU formula identity, the lattice
 * contract, amplitude-continuous crossfades. Its own §5 proved the
 * ocean pipeline byte-identical across the entire window in which the
 * ocean was blamed for a regression it did not cause — "there is
 * nothing there to fix". The maths and every tuned constant below are
 * v0's. What changed is ownership, and only that.
 *
 * WHAT CHANGED FOR v1, and why each one:
 *
 *  - IT IS A CLASS. v0 kept eleven module-level mutable singletons and
 *    a `resetSwell()` that existed only because tests leaked state into
 *    each other (the audit notes it has zero callers in src/). v1's
 *    rule is that a module mutates only state it owns, so the sea owns
 *    its own.
 *  - THE GROUND IS INJECTED. v0 called a global `groundHeight(x, z)`
 *    against a module singleton. v1 hands in a height source that takes
 *    a `WorldPoint` — the seam CLAUDE.md names as "the one place v0
 *    left unchecked, and where its bugs came from".
 *  - THE PUBLIC DOOR TAKES A WorldPoint. Inside, where both numbers
 *    demonstrably came from one, it works in bare numbers: a wave sum
 *    is arithmetic and the lattice sampler evaluates four corners per
 *    query.
 *
 * VERTICAL ONLY, deliberately. True Gerstner waves also displace
 * horizontally, sharpening crests — and making "height at (x, z)"
 * answerable only by iteration. At these steepnesses (centimetres of
 * amplitude over metres of wavelength) the sharpening is nearly
 * invisible, and an exact, cheap, SHARED query is worth more than a
 * slightly pointier crest. The centimetre chop that is pointy lives in
 * the ripple texture, not in geometry.
 *
 * REAL DISPERSION AT ANT SCALE. Each wave runs at the deep-water speed
 * physics gives its wavelength (omega = sqrt(g·k), g in cm/s² like
 * everything else here), so the longer swell genuinely outruns the
 * shorter wind sea.
 *
 * Pure: no three, no DOM, no fetch. `src/world/` is core — and the GLSL
 * emitters below are legal here because a string generator imports
 * nothing. Keeping them beside the maths they mirror is the whole
 * reason the CPU and the GPU cannot drift apart.
 */
import { world, type WorldPoint } from '../coords';

/** Gravity, in the world's own units — centimetres per second squared. */
export const G = 981;

// ---------------------------------------------------------------------------
// Shoaling — waves GROW toward the shore
// ---------------------------------------------------------------------------

/**
 * SHOALING: waves grow toward the shore, they do not fade away.
 *
 * v0's first two cuts faded amplitude to nothing in shallow water to
 * protect the beach. That is backwards, and Joshua caught it twice —
 * "the ocean goes up and down but visually it's still flat", then
 * "offshore is smaller waves... as the waves get closer to shore they
 * visually get taller and more obvious". He was describing shoaling,
 * which is what real water does: a wave slows over a rising bottom, its
 * energy packs into a shorter, taller form, and it steepens until it
 * breaks.
 *
 * Green's law gives height as depth^(-1/4). `REFERENCE_DEPTH` is where
 * the table's amplitudes are the honest ones; shallower water
 * multiplies them, capped at `SHOAL_CAP` so the arithmetic cannot run
 * away over a reef. Only in the last few centimetres — the swash, where
 * foam takes over — does a taper bring the surface back to flat, so the
 * feathered waterline stays exactly where it was.
 *
 * WHY IT MATTERS VISUALLY: a wave reads by its SLOPE, not its height.
 * Amplitude times wavenumber is that slope, and offshore this table is
 * about four degrees — invisible at the grazing angle an ant sees.
 * Shoaled at the shore it is nearer fifteen, which is a wave you can
 * watch coming.
 */
export const REFERENCE_DEPTH = 700;
export const SHOAL_CAP = 2.2;
/** Below this the swash flattens the surface; above it, full shoaling. */
export const SWASH_LO = 6;
export const SWASH_HI = 34;
/**
 * A trough may not cut below the bed — it stops this far above it.
 * Without it a shoaled wave in shallow water drives the sheet through
 * the sand, which is both wrong and a z-fight.
 */
export const KEEL = 4;

/**
 * WATER CANNOT HOLD A WAVE TALLER THAN ITSELF.
 *
 * Green's law is only half the shore. It grows a wave as the bottom
 * rises and has no opinion about whether the water could physically
 * carry the result — left alone it produced a crest standing 1.85 m
 * over half a metre of water. That is not a big wave, it is an
 * impossible one.
 *
 * The classic breaker index closes it: a wave breaks when its HEIGHT
 * approaches about 0.78 of the depth (McCowan's solitary-wave limit,
 * where every surf-zone model starts). Height is twice amplitude, so
 * the surface may stand at most 0.39 of the depth from mean — and in
 * the saturated inner surf zone real waves sit ON that line rather than
 * under it, which is why the envelope asymptotes to it.
 *
 * WHY IT IS SMOOTH. A hard `min` of the two is a crease: the shoreline
 * would carry a ring at the depth where the branch flips, and crossing
 * it the sea would change slope in a step. This is a soft minimum,
 *
 *     shoal = green · limit / (green^n + limit^n)^(1/n)
 *
 * smooth everywhere, never exceeding either input, and at n = 4 within
 * 1.5% of Green's law until the limit is close. Offshore, where the
 * limit is forty times the wave, the departure is one part in ten
 * million: the deep sea is not touched.
 *
 * A FUNCTION OF STILL-WATER DEPTH, deliberately. If the limit read the
 * live column — the bed plus the wave standing on it — it would
 * modulate itself at wave rate and the sea would breathe.
 */
export const BREAKER_INDEX = 0.78;
/** The same limit as an AMPLITUDE — half the height. */
export const BREAKER_AMPLITUDE = BREAKER_INDEX / 2;
/** How sharply the envelope turns onto the limit. Higher is tighter. */
export const BREAK_SOFTNESS = 4;

/**
 * Green's law alone — what the shoaling WANTS, before the water gets a
 * say. Public because "how much of the wave the depth took away" is the
 * surf zone's own definition (see `brokenAt`) and cannot be read off
 * the capped answer by itself.
 */
export function greenShoalAt(depth: number): number {
  const grown = Math.pow(REFERENCE_DEPTH / Math.max(depth, 30), 0.25);
  const capped = Math.min(SHOAL_CAP, Math.max(1, grown));
  const t = Math.min(1, Math.max(0, (depth - SWASH_LO) / (SWASH_HI - SWASH_LO)));
  return capped * (t * t * (3 - 2 * t));
}

/** The tallest the surface may stand here, world units from mean. */
export function breakerAmplitudeAt(depth: number): number {
  return BREAKER_AMPLITUDE * Math.max(0, depth);
}

/** Soft minimum — see the comment above BREAKER_INDEX. */
export function softMin(a: number, b: number): number {
  const n = BREAK_SOFTNESS;
  const sum = Math.pow(a, n) + Math.pow(b, n);
  if (sum <= 0) return 0;
  return (a * b) / Math.pow(sum, 1 / n);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export interface Wave {
  /** Unit propagation direction. */
  readonly dx: number;
  readonly dz: number;
  /** Wavenumber, 2π over wavelength. */
  readonly k: number;
  /** Angular frequency — sqrt(G·k), deep-water dispersion. */
  readonly omega: number;
  /** Amplitude (half the wave height), world units. The BASE — see `envelope`. */
  readonly amp: number;
  /**
   * The slow swell and lull of this component's energy, around 1.
   *
   * A procedural sea arrives in SETS, and that is a modulation of
   * amplitude over tens of seconds rather than a different wave. The
   * built-in table has none; a generated field brings one per
   * component. Read once a frame by `tick`, never per sample, so every
   * consumer of the sea sees the same amplitude in the same frame.
   */
  readonly envelope?: (seconds: number) => number;
}

/** One component, from a wavelength, an amplitude and a compass heading it runs TOWARD. */
export function wave(lambda: number, amp: number, towardDeg: number): Wave {
  const rad = (towardDeg * Math.PI) / 180;
  const k = (2 * Math.PI) / lambda;
  return {
    dx: Math.sin(rad),
    dz: -Math.cos(rad), // compass: 0° is −z (north), 90° is +x (east)
    k,
    omega: Math.sqrt(G * k),
    amp,
  };
}

/**
 * THE SEA JOSHUA ACCEPTED. Two components, and that is not a placeholder.
 *
 * Geometry can afford no more at the sheet's vertex spacing — anything
 * much shorter than about 6 m aliases into mush — and the finer sea
 * state is already carried by the ripple texture. Headings put the
 * swell out of the ENE trades, running toward the west-southwest.
 *
 * STEEPNESS IS WHAT YOU SEE, and v0's first three cuts of this table
 * had none: 13 cm of amplitude over nine metres is a slope of three
 * degrees, which at an ant's grazing view is a flat sheet that
 * nonetheless carries her up and down — "I am above and below the
 * surface, haha". These are short and tall enough to READ: about twelve
 * degrees of face offshore, half again as steep once shoaling has hold
 * of them at the shore.
 *
 * This table is what the bare URL ran in v0 — the live NOAA sea was
 * always behind a flag — so it is the ocean that passed device
 * acceptance, and it is the cheap one: two components rather than the
 * procedural field's five (ten mid-crossfade).
 */
export const DEFAULT_WAVES: readonly Wave[] = [
  wave(360, 16, 245), // the swell: 3.6 m, 32 cm crest-to-trough, T 1.5 s
  wave(210, 6, 222), // wind sea: 2.1 m, 12 cm, T 1.1 s
];

/**
 * WHERE HEAVE ENDS AND CHOP BEGINS — the corner of the camera's
 * spectral filter, in seconds of period.
 *
 * THREE SECONDS, and it is not picked. It is the geometric mean of the
 * two periods this game's sea is designed around: the 6 s dominant
 * swell a buoy reports and the 1.518 s chop the game has always drawn.
 * sqrt(6 × 1.518) = 3.02. The generated field leaves an empty gap
 * between those populations — nothing lands between 1.84 s and 5.43 s —
 * so the corner sits in the middle of it and the split does not need
 * the generator's macro/meso LABEL to reproduce its macro/meso split.
 *
 * THIRD ORDER, also not picked: the least order that passes every macro
 * component above 95% while holding every meso component below 25%.
 * Second order leaves the 1.84 s chop at 35%, which is still bobbing.
 */
export const HEAVE_CORNER_S = 3;
export const HEAVE_ORDER = 3;

/** How much of a component of this frequency the camera should follow. */
export function heaveGain(omega: number): number {
  const period = (2 * Math.PI) / Math.max(omega, 1e-9);
  const ratio = HEAVE_CORNER_S / period;
  return 1 / Math.sqrt(1 + Math.pow(ratio, 2 * HEAVE_ORDER));
}

/** The mesh the renderer is drawing, so gameplay can sample the same chords. */
export interface SwellLattice {
  readonly ox: number;
  readonly oz: number;
  readonly cell: number;
}

export interface SeaSwellOptions {
  /**
   * How high the ground is at a world position — the SEA BED. Injected,
   * because the sea does not own the terrain and v1 does not reach for
   * a module global to find it.
   */
  readonly groundAt: (at: WorldPoint) => number;
  readonly table?: readonly Wave[];
}

export class SeaSwell {
  private readonly groundAt: (at: WorldPoint) => number;
  private waves: readonly Wave[];
  /**
   * The live amplitude of each component this frame — base times its
   * envelope. Recomputed once per tick rather than per sample, because
   * a height query that re-evaluated the envelope would be answering
   * about a slightly different sea every time it was asked.
   */
  private liveAmp: number[];
  /**
   * What the shader reads instead of a baked amplitude literal.
   *
   * Wavenumber, frequency and heading do not change within a generation
   * and stay baked; the AMPLITUDE does, because that is where wave
   * groups live. ONE array, shared BY REFERENCE with the material's
   * uniforms and filled from the very numbers the CPU uses — which is
   * half of why the two cannot disagree.
   */
  readonly ampUniform: { value: number[] };
  private clock = 0;
  private lattice: SwellLattice | null = null;
  private peakOf: (() => number) | null = null;
  private peakSum = 0;
  private heaveGains: number[] = [];
  private meanPeriod = 0;
  private version = 0;

  constructor(options: SeaSwellOptions) {
    this.groundAt = options.groundAt;
    this.waves = options.table ?? DEFAULT_WAVES;
    this.liveAmp = this.waves.map((w) => w.amp);
    this.ampUniform = { value: this.waves.map((w) => w.amp) };
    this.recompute();
  }

  // -- the table -------------------------------------------------------------

  /**
   * Swap the sea. Everything that asks a question comes through here —
   * the baked vertex chunk, the CPU height query, the orbital current,
   * the surf's breaker depth — so swapping the table swaps the whole
   * ocean at once, and a rendered sea cannot disagree with a gameplay one.
   */
  setTable(table: readonly Wave[] | null): void {
    const next = table && table.length > 0 ? table : DEFAULT_WAVES;
    const sameShape = next.length === this.waves.length
      && next.every((w, i) => w.k === this.waves[i].k && w.omega === this.waves[i].omega
        && w.dx === this.waves[i].dx && w.dz === this.waves[i].dz);
    this.waves = next;
    this.liveAmp = next.map((w) => w.amp);
    this.ampUniform.value = next.map((w) => w.amp);
    this.recompute();
    // A table with a different SHAPE needs the material built again:
    // wavenumbers, headings and the baked peak are literals in the
    // shader. Amplitudes alone do not — those are the uniform, and they
    // move every frame.
    if (!sameShape) this.version += 1;
  }

  /** Changes when the table's SHAPE changes, so a renderer knows to rebuild. */
  tableVersion(): number {
    return this.version;
  }

  activeWaves(): readonly Wave[] {
    return this.waves;
  }

  isDefaultSea(): boolean {
    return this.waves === DEFAULT_WAVES;
  }

  /**
   * WHO DECIDES HOW TALL THIS SEA CAN STAND — and why it is a seam.
   *
   * The table's own peak sum is the honest answer for one generation
   * and the wrong one for two. During a crossfade the table holds an
   * outgoing sea and an incoming one, and neither is ever at full
   * amplitude while the other is: summing both peaks would advertise a
   * crest half again taller than the water can reach and, worse, it
   * would JUMP the instant the second generation joined. That number is
   * the denominator of the breaking envelope, so a jump in it is a step
   * in wave height everywhere the shore is shallow — measured at
   * eighteen per cent in three metres of water.
   *
   * So whoever owns the generations may answer instead. The contract is
   * that the answer is a SLOW property of the sea: it may drift across
   * a transition, it may not move at wave rate.
   */
  setPeakSource(source: (() => number) | null): void {
    this.peakOf = source;
    if (this.peakOf) this.peakSum = this.peakOf();
  }

  // -- what the sea is -------------------------------------------------------

  /** The table's amplitude sum before any shoaling, out where amplitudes are honest. */
  amplitude(): number {
    return this.peakSum;
  }

  /** The most the surface can ever leave sea level, either way. */
  reach(): number {
    return this.peakSum * SHOAL_CAP;
  }

  /**
   * The sea's own period, energy-weighted, in seconds.
   *
   * Anything sized in "how long can a wave hold something under" is a
   * fraction of THIS, not a constant: constants swept against a 1.5 s
   * sea fire on every crest of a 6 s one. Weighted by A² because that
   * is energy, which is what makes a wave the one you notice. The
   * shipped table comes out at 1.47 s.
   */
  period(): number {
    return this.meanPeriod;
  }

  /** The primary component's angular frequency — the beat a presentation clock can follow. */
  beat(): number {
    let best = this.waves[0];
    for (const w of this.waves) if (w.amp > best.amp) best = w;
    return best.omega;
  }

  /** How much this depth multiplies the table's amplitudes — Green's law grown into the depth limit. */
  shoalAt(depth: number): number {
    const green = greenShoalAt(depth);
    if (green <= 0) return 0;
    const peak = this.peakSum;
    if (peak <= 0) return green;
    return softMin(green, breakerAmplitudeAt(depth) / peak);
  }

  /**
   * How much of the wave the depth took, 0 to 1 — the surf zone's own
   * measure of itself. The energy the envelope removes has not
   * vanished; it is what `surf` spends as a shoreward bore, so the same
   * number that flattens the geometry drives the surge.
   */
  brokenAt(depth: number): number {
    const green = greenShoalAt(depth);
    if (green <= 0) return 0;
    return Math.min(1, Math.max(0, 1 - this.shoalAt(depth) / green));
  }

  // -- the clock -------------------------------------------------------------

  /**
   * THE ONE CLOCK. Advancing the sea is this and nothing else, and it
   * must have exactly one call site: both sheets' uTime and every
   * gameplay query then read the same instant. The audit verified that
   * invariant in v0 and it is the reason the GPU can never be on a
   * different `now` from the CPU.
   *
   * @returns the new clock, for the renderer's uniform.
   */
  tick(dt: number): number {
    this.clock += Math.max(0, dt);
    this.refreshAmplitudes();
    return this.clock;
  }

  now(): number {
    return this.clock;
  }

  /**
   * Clock and lattice only — the table stands.
   *
   * Not to be confused with building a fresh sea. v0 shipped a bug
   * where the wrong one of these was called and `?sea=procedural`
   * reported itself on while the ocean ran the old table; the two are
   * separate on purpose.
   */
  restartClock(): void {
    this.clock = 0;
    this.lattice = null;
    this.refreshAmplitudes();
  }

  // -- the lattice -----------------------------------------------------------

  /**
   * THE MESH THE RENDERER ACTUALLY DRAWS, not the curve behind it.
   *
   * The near sheet is a LATTICE. Its vertices sit on the analytic curve
   * and every pixel between them is a straight line across the cell, so
   * the drawn surface is piecewise-bilinear: it misses each crest and
   * fills in each trough. With a 3.6 m wave on a 70 cm lattice that is
   * five samples a wavelength, and the gap between chord and arc
   * reaches nine centimetres in shoaled water. Nine centimetres is
   * nothing to a person and NINE BODY LENGTHS to her — floating on the
   * analytic curve while the sheet is drawn on the chords is exactly
   * why she "seems too low in the wave".
   *
   * So gameplay samples the CHORDS too: the four surrounding vertices
   * are evaluated exactly as the vertex shader evaluates them,
   * including each corner's own water column, and the result is
   * bilinear between them.
   *
   * With no lattice registered — the tests, any headless caller — the
   * answer is the analytic curve, which is honest when nothing is drawn.
   */
  setLattice(lattice: SwellLattice): void {
    this.lattice = lattice;
  }

  clearLattice(): void {
    this.lattice = null;
  }

  // -- the surface -----------------------------------------------------------

  /**
   * How far the sea surface stands from y = 0 here, NOW. Positive is a crest.
   *
   * @param depth the still-water column here. Used directly when no
   *   mesh is registered; with one, each lattice corner uses its OWN
   *   column, because that is what the shader does.
   */
  heightAt(at: WorldPoint, depth: number): number {
    return this.sampled(at.wx, at.wz, depth, null);
  }

  /**
   * The slow half of the very same sea — a camera's reference, and
   * nothing else's. NOT a second surface: it is `heightAt` with each
   * component scaled by `heaveGain`, from the same table at the same
   * instant through the same mesh. Sum the heave and the chop and the
   * sea comes back exactly.
   */
  heaveAt(at: WorldPoint, depth: number): number {
    return this.sampled(at.wx, at.wz, depth, this.heaveGains);
  }

  /** The fast half — what a camera should not copy. */
  chopAt(at: WorldPoint, depth: number): number {
    return this.sampled(at.wx, at.wz, depth, null) - this.sampled(at.wx, at.wz, depth, this.heaveGains);
  }

  /**
   * THE WATER'S OWN HORIZONTAL MOTION, from the very same waves.
   *
   * A wave is not a river: the water in it does not travel with the
   * crest, it goes round in a circle and comes back. At the surface of
   * a deep-water wave that circle's horizontal component is omega·eta —
   * the wave's angular speed times how high the surface stands at that
   * instant — along the wave's own direction. Forward under a crest,
   * backward under a trough, netting to nothing over a cycle, which is
   * exactly what floating in a swell feels like.
   *
   * IT IS THE SAME TABLE `heightAt` SUMS, and that is why it lives
   * here. A current computed from a second copy of the waves would push
   * her one way while the surface she is riding went the other — the
   * two-answers disease this module exists to prevent.
   */
  orbitalAt(at: WorldPoint, depth: number): { x: number; z: number } {
    const shoal = this.shoalAt(depth);
    if (shoal <= 0) return { x: 0, z: 0 };
    let x = 0;
    let z = 0;
    for (let i = 0; i < this.waves.length; i += 1) {
      const w = this.waves[i];
      const eta = this.liveAmp[i] * Math.cos((at.wx * w.dx + at.wz * w.dz) * w.k - w.omega * this.clock);
      const u = w.omega * eta * shoal;
      x += u * w.dx;
      z += u * w.dz;
    }
    return { x, z };
  }

  // -- the GPU half ----------------------------------------------------------

  /**
   * The same waves as GLSL, for the sheet's vertex shader — accumulating
   * height into `sw` and the height GRADIENT into `swSlope`.
   *
   * THIS IS THE FORMULA IDENTITY, and it is neither a transpiler nor a
   * hand-written copy: the module that OWNS the table prints its own
   * numbers into the shader source. `swellChunk` maps over the very
   * array `rawSwell` iterates, so the two cannot describe different
   * waves. Amplitude is the one thing that moves within a generation,
   * and it is a uniform sharing an object with the CPU's own array.
   */
  swellChunk(): string {
    return this.waves.map((w, i) => `
          float ph${i} = (worldXZ.x * ${w.dx.toFixed(6)} + worldXZ.y * ${w.dz.toFixed(6)}) * ${w.k.toFixed(8)} - ${w.omega.toFixed(6)} * uTime;
          sw += uWaveAmp[${i}] * cos(ph${i});
          swSlope += vec2(${w.dx.toFixed(6)}, ${w.dz.toFixed(6)}) * (-uWaveAmp[${i}] * ${w.k.toFixed(8)} * sin(ph${i}));`).join('');
  }

  swellUniformChunk(): string {
    return `uniform float uWaveAmp[${this.waves.length}];`;
  }

  /**
   * The shoaling envelope as GLSL, from a `depth` in scope into `shoal`.
   *
   * The peak amplitude is BAKED rather than sent as a uniform because it
   * cannot change within a generation: wave groups move each
   * component's live amplitude, but the envelope this cap is built from
   * is the generation's own peak, and a new generation rebuilds the
   * material anyway.
   */
  shoalChunk(): string {
    const peak = Math.max(this.peakSum, 1e-6);
    const n = BREAK_SOFTNESS.toFixed(1);
    return `
          float green = clamp(pow(${REFERENCE_DEPTH.toFixed(1)} / max(depth, 30.0), 0.25), 1.0, ${SHOAL_CAP.toFixed(2)})
            * smoothstep(${SWASH_LO.toFixed(1)}, ${SWASH_HI.toFixed(1)}, depth);
          // Water cannot hold a wave taller than itself — see swell.ts.
          float breakLimit = ${BREAKER_AMPLITUDE.toFixed(4)} * max(depth, 0.0) / ${peak.toFixed(4)};
          float softSum = pow(green, ${n}) + pow(breakLimit, ${n});
          float shoal = softSum > 0.0
            ? green * breakLimit * pow(softSum, ${(-1 / BREAK_SOFTNESS).toFixed(4)})
            : 0.0;`;
  }

  /** Hand the amplitude array to a material BY REFERENCE. Structurally typed: no three here. */
  bindUniforms(uniforms: Record<string, { value: unknown }>): void {
    uniforms.uWaveAmp = this.ampUniform as { value: unknown };
  }

  // -- inside ----------------------------------------------------------------

  /** The analytic curve at a point, with an optional per-component weighting. */
  private rawSwell(wx: number, wz: number, depth: number, gains: number[] | null): number {
    const shoal = this.shoalAt(depth);
    if (shoal <= 0) return 0;
    let y = 0;
    for (let i = 0; i < this.waves.length; i += 1) {
      const w = this.waves[i];
      const a = gains ? this.liveAmp[i] * gains[i] : this.liveAmp[i];
      y += a * Math.cos((wx * w.dx + wz * w.dz) * w.k - w.omega * this.clock);
    }
    // A SLICE IS NOT A SURFACE. The keel is a floor on where the water
    // may be; a spectral slice is not where the water is, so it does
    // not get the clamp.
    if (gains) return y * shoal;
    return Math.max(y * shoal, -Math.max(0, depth - KEEL));
  }

  /** The lattice-aware sampler behind the surface and its two halves. */
  private sampled(wx: number, wz: number, depth: number, gains: number[] | null): number {
    const lattice = this.lattice;
    if (!lattice) return this.rawSwell(wx, wz, depth, gains);
    const { ox, oz, cell } = lattice;
    const fx = (wx - ox) / cell;
    const fz = (wz - oz) / cell;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const corner = (cx: number, cz: number): number => {
      const x = ox + cx * cell;
      const z = oz + cz * cell;
      return this.rawSwell(x, z, -this.groundAt(world(x, z)), gains);
    };
    const a = corner(ix, iz);
    const b = corner(ix + 1, iz);
    const c = corner(ix, iz + 1);
    const d = corner(ix + 1, iz + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Live amplitudes for this frame, and the array the GPU shares. */
  private refreshAmplitudes(): void {
    for (let i = 0; i < this.waves.length; i += 1) {
      const w = this.waves[i];
      const a = w.envelope ? w.amp * w.envelope(this.clock) : w.amp;
      this.liveAmp[i] = a;
      this.ampUniform.value[i] = a;
    }
    if (this.peakOf) this.peakSum = this.peakOf();
  }

  /** Peak, heave gains and mean period — once a generation, not per sample. */
  private recompute(): void {
    this.heaveGains = this.waves.map((w) => heaveGain(w.omega));
    // The largest an envelope can make a component, sampled FORWARD
    // from now: an incoming generation's fade starts at nothing, so
    // sampling from time zero would read it as silent.
    let peak = 0;
    let energy = 0;
    let weighted = 0;
    for (const w of this.waves) {
      let most = w.amp;
      if (w.envelope) {
        for (let s = 0; s <= 60; s += 0.5) most = Math.max(most, w.amp * w.envelope(this.clock + s));
      }
      peak += most;
      const e = w.amp * w.amp;
      energy += e;
      weighted += e * ((2 * Math.PI) / Math.max(w.omega, 1e-9));
    }
    this.peakSum = this.peakOf ? this.peakOf() : peak;
    this.meanPeriod = energy > 0 ? weighted / energy : 0;
    this.refreshAmplitudes();
  }
}
