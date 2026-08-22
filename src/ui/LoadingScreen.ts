import { readableBytes, readableWait, type LoadState } from './loadPlan';
import { buildStage, GOLD, type Stage } from './splashStage';

/**
 * THE WAY IN.
 *
 * Between picking a spot on the map and standing on it, the game has
 * five megabytes to fetch and a landscape to cut. It used to do that in
 * full view: the world appeared immediately with half of it BLACK,
 * because an unloaded texture samples as nothing, and the far hills
 * grey because their average colour had not been measured yet. It read
 * as a broken world rather than an unfinished one.
 *
 * Joshua's key art carries the whole composition — three shields, the
 * wordmark, and an ornate empty bar frame with clear space around it.
 * So this screen draws almost nothing of its own. It shows the picture
 * and fills in the bar that is already in it.
 *
 * THE PICTURE IS THE BAR'S FRONT LAYER, not a backdrop with a bar
 * placed near it — Joshua cut the bar's interior out of the artwork, so
 * a plain rectangle behind it shows through as an ornate meter. That is
 * also what makes it robust: the first attempt positioned a fill beside
 * the frame painted into the splash, and every small disagreement about
 * how a wide picture fits a wider phone put the bar off its rails. With
 * the art on top, the fill and the hole live in the same box and move
 * together whatever that box does. See `Meter`.
 *
 * What is NOT borrowed from Beyond Extinction — whose look the earlier
 * pass followed — is the progress itself. BE-Godot's bar is a
 * five-second tween with nothing behind it, which is exactly the "0 to
 * 100 and then nothing happens" Joshua does not want. Every number here
 * is measured.
 */

const FADE_MS = 800;

export class LoadingScreen {
  private readonly stage: Stage;
  private readonly step: HTMLSpanElement;
  private readonly tally: HTMLSpanElement;
  private readonly eta: HTMLSpanElement;
  private shown = 0;
  private raf = 0;
  private gone = false;

  constructor(host: HTMLElement, place: string) {
    this.stage = buildStage();
    this.stage.root.dataset.ui = 'loading';
    this.stage.root.style.zIndex = '60';
    this.stage.root.style.opacity = '1';
    this.stage.root.style.transition = `opacity ${FADE_MS}ms ease`;

    // Where she is going. The map just asked; saying it back is what
    // makes the wait feel like travel rather than a spinner.
    this.stage.above.textContent = place.toUpperCase();

    // The three readouts Joshua asked for, on the line under the bar:
    // what is happening, how much of it has arrived, how long is left.
    // One centred line rather than three spread across the frame — the
    // hole is 42% of the picture and they will not fit beside it.
    this.step = document.createElement('span');
    this.tally = document.createElement('span');
    this.eta = document.createElement('span');
    this.tally.style.color = GOLD;
    this.stage.below.append(this.step, dot(), this.tally, dot(), this.eta);

    host.appendChild(this.stage.root);
  }

  /**
   * Show where the plan has got to.
   *
   * The bar EASES toward the real fraction rather than snapping to it.
   * Not decoration: bytes land in bursts, and a bar that jumps 12% and
   * then holds for a second looks stuck twice over. It is never allowed
   * to run ahead of the truth, only to arrive there smoothly.
   */
  update(state: LoadState): void {
    if (this.gone) return;
    this.shown += (state.fraction - this.shown) * 0.22;
    if (state.complete) this.shown = state.fraction;
    this.stage.meter.set(this.shown);

    this.step.textContent = state.label;
    this.tally.textContent = state.bytesTotal > 0
      ? `${readableBytes(state.bytesDone)} / ${readableBytes(state.bytesTotal)}`
      : '';
    this.eta.textContent = state.complete
      ? 'ready'
      : state.secondsLeft === null ? '' : `${readableWait(state.secondsLeft)} left`;
  }

  /** Drive it from a plan until the plan says it is finished. */
  follow(read: () => LoadState): void {
    const step = (): void => {
      if (this.gone) return;
      this.update(read());
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /**
   * Lift the veil, and resolve once it is actually gone.
   *
   * The bar is held at full for a beat first. Not padding — the last
   * thing to finish is the first frame, and cutting the same instant it
   * lands means the player never sees the bar complete, which is the
   * one moment it has to be believed.
   */
  async lift(): Promise<void> {
    if (this.gone) return;
    this.gone = true;
    cancelAnimationFrame(this.raf);
    this.stage.meter.set(1);
    this.step.textContent = 'Ready';
    this.eta.textContent = 'ready';
    await new Promise((done) => setTimeout(done, 260));
    this.stage.root.style.opacity = '0';
    await new Promise((done) => setTimeout(done, FADE_MS));
    this.dispose();
  }

  /** Say why nothing is happening, and stop pretending to load. */
  fail(why: string): void {
    cancelAnimationFrame(this.raf);
    this.gone = true;
    this.stage.below.textContent = why;
    this.stage.below.style.color = 'rgba(255, 150, 130, 0.95)';
  }

  dispose(): void {
    this.gone = true;
    cancelAnimationFrame(this.raf);
    this.stage.stopFitting();
    this.stage.root.remove();
  }
}

/** The separator between readouts. */
function dot(): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = ' · ';
  span.style.opacity = '0.45';
  return span;
}
