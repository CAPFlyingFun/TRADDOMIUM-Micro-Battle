/**
 * The loading screen: a bar that only ever fills, an ETA that says
 * "measuring" until there is a rate, and a CONTINUE button that exists only
 * while the wiring says continuing is possible.
 *
 * The screen reads progress through `ProgressReader`, a structural type
 * that `world/LoadProgress` satisfies without this file importing it: the
 * ui may not depend on world/. The bar is held monotonic here as well as
 * there — whatever reader is wired in, a bar that runs backwards reads as
 * a stall and a restart, so this screen will not draw one.
 */
import type { FrameInfo, SceneContext, SceneFactory } from '../app/Scene';
import { actionsRow, namedButton, Screen, titledPanel, type Wire } from './screen';

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

export class LoadingScene extends Screen {
  readonly name = 'loading';
  private fill: HTMLElement | null = null;
  private percent: HTMLElement | null = null;
  private eta: HTMLElement | null = null;
  private continueButton: HTMLButtonElement | null = null;
  /** The highest fraction drawn so far; the bar never goes below it. */
  private shown = 0;

  constructor(ctx: SceneContext, private readonly hooks: LoadingHooks) {
    super(ctx, 'plain');
  }

  override async enter(): Promise<void> {
    await super.enter();
    this.hooks.onEnter();
  }

  protected build(root: HTMLElement): void {
    const panel = titledPanel(root, this.hooks.caption, { wide: true });
    const doc = root.ownerDocument;

    const bar = doc.createElement('div');
    bar.className = 'ui-bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    this.fill = doc.createElement('div');
    this.fill.className = 'ui-bar__fill';
    bar.appendChild(this.fill);
    panel.appendChild(bar);

    const status = doc.createElement('div');
    status.className = 'ui-row';
    this.percent = doc.createElement('span');
    this.percent.className = 'ui-readout';
    this.eta = doc.createElement('span');
    this.eta.className = 'ui-subtitle';
    status.append(this.eta, this.percent);
    panel.appendChild(status);

    this.continueButton = namedButton(CONTINUE_ACTION, 'Continue', () => this.hooks.onContinue(), { primary: true });
    this.continueButton.hidden = true;
    actionsRow(panel, [this.continueButton]);
    this.draw();
  }

  override update(_frame: FrameInfo): void {
    this.draw();
  }

  private draw(): void {
    const raw = this.hooks.progress.fraction();
    const fraction = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    if (fraction > this.shown) this.shown = fraction;
    const complete = this.shown >= 1;
    if (this.fill) this.fill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    this.fill?.parentElement?.setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
    if (this.percent) this.percent.textContent = `${Math.round(this.shown * 100)}%`;
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
