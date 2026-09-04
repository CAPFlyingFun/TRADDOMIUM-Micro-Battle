/**
 * THE WAY IN: the key art, with the bar that is already in it filled
 * from MEASURED progress.
 *
 * Joshua's key art carries the whole composition — the wordmark and an
 * ornate empty bar with clear space around it — and the bar's interior
 * is cut out of the picture. So this screen draws almost nothing of its
 * own: it shows the picture through `SplashStage` and fills the hole
 * from the `ProgressReader` the wiring hands it (ARCHITECTURE §10). What
 * is NOT borrowed from Beyond Extinction, whose look v0's first pass
 * followed, is the progress itself: BE's bar is a five-second tween with
 * nothing behind it, the "0 to 100 and then nothing happens" Joshua does
 * not want. Every number here is read from the reader.
 *
 * The bar is held monotonic here as well as in `world/LoadProgress`:
 * whatever reader is wired in, a bar that runs backwards reads as a
 * stall and a restart, so this screen will not draw one. The screen
 * reads progress through `ProgressReader`, a structural type the reader
 * satisfies without this file importing it — the ui may not depend on
 * world/ (§2.7; tests/uiBoundary.test.ts).
 *
 * A CONTINUE button exists only while the wiring says continuing is
 * possible; today no world has a press-to-continue gate.
 */
import type { FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { actionsRow, namedButton, Screen, type Wire } from './screen';
import { buildStage, type Stage } from './splash/SplashStage';

/** What the screen needs from a progress source. `world/LoadProgress` has exactly this shape. */
export interface ProgressReader {
  /** 0..1. */
  fraction(): number;
  /** Milliseconds remaining, or null when no rate has been measured yet. */
  etaMs(): number | null;
}

export interface LoadingHooks {
  /** The heading: what is being loaded, in words a player recognises. */
  readonly caption: string;
  readonly progress: ProgressReader;
  /** Called once from `enter()`: begin whatever this screen is waiting on. */
  onEnter(): void;
  /** Polled every frame; the CONTINUE button exists only while this is true. */
  canContinue(): boolean;
  onContinue(): void;
}

/** Outside the closed ACTION vocabulary: only this screen has a "continue". */
export const CONTINUE_ACTION = 'continue';

/**
 * How quickly the drawn bar closes on the measured fraction — a time
 * constant in seconds, so the feel is the same at any frame rate.
 *
 * The bar EASES toward the truth rather than snapping to it. Not
 * decoration: bytes land in bursts, and a bar that jumps 12 % and then
 * holds for a second looks stuck twice over. It is never allowed to run
 * ahead of the truth, only to arrive there smoothly. v0 used 0.22 of the
 * gap per frame at 60 Hz, which is this constant to within a millisecond.
 */
export const EASE_SECONDS = 0.076;

/** Closer than this and the bar is simply put on the value, so it visibly arrives. */
const EASE_SNAP = 0.0005;

export class LoadingScene extends Screen {
  readonly name = 'loading';
  private stage: Stage | null = null;
  private percent: HTMLElement | null = null;
  private eta: HTMLElement | null = null;
  private standby: HTMLElement | null = null;
  private continueButton: HTMLButtonElement | null = null;
  /** The highest measured fraction so far: the truth the readouts show. */
  private shown = 0;
  /** The bar's drawn position, trailing `shown`. */
  private eased = 0;

  constructor(ctx: SceneContext, private readonly hooks: LoadingHooks) {
    super(ctx, 'plain');
  }

  override async enter(): Promise<void> {
    await super.enter();
    this.hooks.onEnter();
  }

  protected build(root: HTMLElement): void {
    const doc = root.ownerDocument;
    const stage = buildStage({ document: doc });
    stage.root.dataset.ui = 'loading-stage';
    stage.meter.root.classList.add('splash-stage--held');
    stage.meter.root.setAttribute('role', 'progressbar');
    stage.meter.root.setAttribute('aria-valuemin', '0');
    stage.meter.root.setAttribute('aria-valuemax', '100');
    stage.meter.root.setAttribute('aria-label', this.hooks.caption);

    // Where the player is going. The picker just asked; saying it back
    // is what makes the wait feel like travel rather than a spinner.
    stage.above.dataset.ui = 'loading-title';
    stage.above.textContent = this.hooks.caption;

    // On the line under the bar: how much has arrived, how long is left.
    // One centred line rather than readouts spread across the frame —
    // the hole is 42 % of the picture and they will not fit beside it.
    this.percent = doc.createElement('span');
    this.percent.dataset.ui = 'loading-percent';
    this.percent.className = 'splash-caption--lit';
    this.eta = doc.createElement('span');
    this.eta.dataset.ui = 'loading-eta';
    stage.below.append(this.percent, this.eta);

    // The heading again, on the dark, until the picture has pixels.
    this.standby = doc.createElement('div');
    this.standby.className = 'splash-standby';
    this.standby.textContent = this.hooks.caption;
    stage.root.appendChild(this.standby);

    this.continueButton = namedButton(CONTINUE_ACTION, 'Continue', () => this.hooks.onContinue(), { primary: true });
    this.continueButton.hidden = true;
    actionsRow(stage.root, [this.continueButton]).classList.add('splash-actions');

    root.appendChild(stage.root);
    this.stage = stage;

    // EVERYTHING ARRIVES TOGETHER: the stage is held at nothing until
    // the picture is decoded, then fades up as one and the standby goes.
    void stage.whenPainted.then(() => {
      if (this.stage !== stage) return;
      stage.meter.root.classList.remove('splash-stage--held');
      this.standby?.classList.add('splash-standby--gone');
    });
    this.draw(0);
  }

  override update(frame: FrameInfo): void {
    // Wall-clock, not sim time: the bar is a readout, and sim time is 0 while paused.
    this.draw(frame.rawDt);
  }

  override dispose(): void {
    this.stage?.stopFitting();
    this.stage = null;
    super.dispose();
  }

  private draw(dt: number): void {
    const raw = this.hooks.progress.fraction();
    const fraction = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    if (fraction > this.shown) this.shown = fraction;
    const complete = this.shown >= 1;

    if (complete) {
      // The last thing to finish is the world's first frame; the bar
      // must be seen full before that lands, so it does not trail here.
      this.eased = 1;
    } else {
      const gap = this.shown - this.eased;
      this.eased += gap * (1 - Math.exp(-Math.max(0, dt) / EASE_SECONDS));
      if (this.shown - this.eased < EASE_SNAP) this.eased = this.shown;
    }

    const stage = this.stage;
    if (!stage) return;
    stage.meter.set(this.eased);
    const percent = Math.round(this.shown * 100);
    stage.meter.root.setAttribute('aria-valuenow', String(percent));
    if (this.percent) this.percent.textContent = `${percent}%`;
    if (this.eta) this.eta.textContent = formatEta(this.hooks.progress.etaMs(), complete);
    if (this.continueButton) this.continueButton.hidden = !this.hooks.canContinue();
  }
}

/** The ETA line. Null is an honest "not measured yet", never a number invented from a timer. */
export function formatEta(etaMs: number | null, complete: boolean): string {
  if (complete) return 'Ready.';
  if (etaMs === null || !Number.isFinite(etaMs)) return 'Measuring…';
  const seconds = Math.max(0, etaMs) / 1000;
  if (seconds < 1) return 'Less than a second left.';
  if (seconds < 60) return `About ${Math.ceil(seconds)} s left.`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds - minutes * 60);
  return `About ${minutes} min ${rest} s left.`;
}

/** Everything the loader shows and drives comes from the wiring: the ui may not import world/. */
export function createLoadingScene(wire: Wire<LoadingHooks>): SceneFactory {
  return (ctx) => new LoadingScene(ctx, wire(ctx));
}
