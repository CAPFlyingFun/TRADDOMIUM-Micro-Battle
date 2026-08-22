/**
 * THE WINGBEAT — measured, not invented.
 *
 * Every number in this file is from a stereo high-speed imaging study
 * of tethered fire ant alates at 8,000 frames per second:
 *
 *   Gui L, Fink T, Cao Z, Sun D, Seiner JM, Streett DA (2010).
 *   Fire ant alate wing motion data and numerical reconstruction.
 *   Journal of Insect Science 10:19. Open access, CC-BY 3.0.
 *
 * The queen is female, so the female column is hers: 96 Hz, forewings
 * sweeping 114.3 degrees and hindwings 135.3, on a stroke plane held
 * 67.7 degrees off her body axis. See docs/WING_MOTION.md.
 *
 * A CAVEAT WORTH REPEATING RATHER THAN BURYING. Those are *Solenopsis
 * richteri*, the black imported fire ant, not our *S. invicta*. They
 * are close congeners of near-identical size that hybridise freely, so
 * it is the best proxy available — and it is still a proxy.
 *
 * NINETY-SIX HERTZ CANNOT BE DRAWN AT SIXTY. That is not a limitation
 * to work around, it is arithmetic: a beat and a half passes between
 * one frame and the next, so whatever is sampled is aliasing rather
 * than motion, and what a phone shows is a strobe. Real wings at this
 * frequency read to the eye as a blur, and a renderer that insists on
 * the true rate produces a worse lie than one that slows it.
 *
 * So the truth and the picture are kept apart. `WINGBEAT_HZ` is the
 * measurement and never changes. `shownHz` is what gets drawn, and it
 * defaults to a rate the eye can actually follow. Anything physical —
 * the sound of her, later — takes the measurement; only the animation
 * takes the slower one.
 */

/** Female fire ant alate wingbeat, hertz. MEASURED. */
export const WINGBEAT_HZ = 96;

/** Forewing sweep, degrees, from phi-min -29.9 to phi-max 84.4. */
export const FOREWING_SWEEP = 114.3;
/** Hindwing sweep, degrees, from phi-min -45.0 to phi-max 90.3. */
export const HINDWING_SWEEP = 135.3;

/** Where each wing's sweep is centred, degrees from the stroke plane. */
export const FOREWING_MID = (84.4 + -29.9) / 2;
export const HINDWING_MID = (90.3 + -45.0) / 2;

/**
 * The stroke plane, degrees off her body axis.
 *
 * The paper's β for the female. Its companion result is the one that
 * matters for animating: β + χ came out at 66.7° for the female and
 * 67.0° for the male, near-identical, while β and χ separately differ
 * by more than ten degrees. The stroke plane is held against the WORLD
 * and the body angle is what moves underneath it — which is why a
 * climbing insect pitches its body rather than tilting its stroke.
 */
export const STROKE_PLANE = 67.7;

/**
 * What the animation actually runs at, hertz.
 *
 * Twelve rather than ninety-six. Nothing at 96 Hz survives a 60 Hz
 * display; this is the fastest that still reads as beating wings
 * instead of a flicker. It is a PRESENTATION number and is deliberately
 * not called a wingbeat frequency anywhere.
 */
export const SHOWN_HZ = 12;

const RAD = Math.PI / 180;

export interface WingPose {
  /** Sweep angle, radians. Positive is forward and up in the stroke. */
  readonly fore: number;
  readonly hind: number;
}

/**
 * Where the wings are at a given phase of the beat, 0 to 1.
 *
 * A cosine rather than the paper's 83-phase table, deliberately. The
 * table describes a TETHERED ant against a blower, at a resolution no
 * display can show, and its fine structure — the slight asymmetry
 * between upstroke and downstroke — is exactly the part that aliases
 * away first. What survives at a watchable rate is the amplitude and
 * the phase relationship between the wing pairs, and those are what
 * this reproduces. The table is in the paper if it is ever wanted for
 * a slow-motion shot or for the sound.
 */
export function poseAt(phase: number): WingPose {
  const turn = phase * Math.PI * 2;
  const swing = Math.cos(turn);
  return {
    fore: (FOREWING_MID + (FOREWING_SWEEP / 2) * swing) * RAD,
    hind: (HINDWING_MID + (HINDWING_SWEEP / 2) * swing) * RAD,
  };
}

/**
 * The beat's own clock.
 *
 * Advanced in SIMULATED seconds and wrapped, so a slow frame does not
 * make the wings stutter and a fast one does not make them race. The
 * phase is kept in 0..1 rather than accumulating, because an ant that
 * flies for thirty minutes at twelve beats a second would otherwise be
 * asking a float to remember twenty-two thousand turns.
 */
export class Wingbeat {
  private phase = 0;
  private amount = 0;

  /**
   * @param dt simulated seconds
   * @param beating whether she is working her wings at all
   */
  update(dt: number, beating: boolean): WingPose {
    // Eased so the wings spin up and wind down rather than snapping
    // between still and full beat at the moment she leaves the ground.
    this.amount += ((beating ? 1 : 0) - this.amount)
      * (1 - Math.exp(-dt / 0.18));
    this.phase = (this.phase + SHOWN_HZ * dt) % 1;

    const swept = poseAt(this.phase);
    // Folded back toward rest as the beat dies away, so a landed queen
    // holds her wings still rather than mid-stroke.
    const rest = poseAt(0.25);
    return {
      fore: rest.fore + (swept.fore - rest.fore) * this.amount,
      hind: rest.hind + (swept.hind - rest.hind) * this.amount,
    };
  }

  /** True while the wings are visibly working. */
  get beating(): boolean {
    return this.amount > 0.02;
  }

  reset(): void {
    this.phase = 0;
    this.amount = 0;
  }
}
