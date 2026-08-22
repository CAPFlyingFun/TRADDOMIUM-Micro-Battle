import { readableBytes, readableWait, type LoadState } from './loadPlan';
import { buildStage, GOLD, GOLD_DIM, type Stage } from './splashStage';

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
  private readonly standby: HTMLDivElement;
  /**
   * Resolves once the screen is really on screen — picture decoded,
   * everything faded up, and a frame painted with it.
   */
  readonly shown: Promise<void>;
  private readonly step: HTMLSpanElement;
  private readonly numbers: HTMLSpanElement;
  /** The bar's eased position, which trails the real fraction. */
  private eased = 0;
  private raf = 0;
  private gone = false;

  constructor(host: HTMLElement, place: string) {
    this.stage = buildStage();
    // EVERYTHING ARRIVES TOGETHER. The picture needs a decode and the
    // bar and captions do not, so left to themselves they turn up
    // seconds apart and the screen looks half-built. It is held at
    // nothing until the picture is ready, and then the whole thing
    // fades up as one.
    this.stage.meter.root.style.opacity = '0';
    this.stage.meter.root.style.transition = 'opacity 220ms ease';
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
    // Two pieces so the line can break between them on a narrow phone
    // rather than running off both edges — see `below` in splashStage.
    this.step = document.createElement('span');
    this.numbers = document.createElement('span');
    this.numbers.style.color = GOLD;
    this.stage.below.append(this.step, this.numbers);

    // Something to look at in the meanwhile. It is usually a fraction
    // of a second; on a cold cache over a phone connection it is not,
    // and a black rectangle with nothing on it reads as a crash.
    this.standby = document.createElement('div');
    this.standby.textContent = 'PREPARING THE ISLAND…';
    Object.assign(this.standby.style, {
      position: 'absolute',
      inset: '0',
      display: 'grid',
      placeItems: 'center',
      font: '600 clamp(10px, 1.6vmin, 15px)/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.28em',
      textIndent: '0.28em',
      color: GOLD_DIM,
      transition: 'opacity 220ms ease',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.stage.root.appendChild(this.standby);

    host.appendChild(this.stage.root);

    this.shown = this.stage.whenPainted.then(() => {
      if (this.gone) return;
      this.stage.meter.root.style.opacity = '1';
      this.standby.style.opacity = '0';
      // Two frames: one for the styles to land, one for the browser to
      // actually paint them. Whoever is waiting on this is about to
      // block the main thread for a second, so the paint has to have
      // happened before they start.
      return new Promise<void>((painted) => {
        requestAnimationFrame(() => requestAnimationFrame(() => painted()));
      });
    });
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
    this.eased += (state.fraction - this.eased) * 0.22;
    if (state.complete) this.eased = state.fraction;
    this.stage.meter.set(this.eased);

    this.step.textContent = state.label;
    const bytes = state.bytesTotal > 0
      ? `${readableBytes(state.bytesDone)} / ${readableBytes(state.bytesTotal)}`
      : '';
    const left = state.complete
      ? 'ready'
      : state.secondsLeft === null ? '' : `${readableWait(state.secondsLeft)} left`;
    this.numbers.textContent = [bytes, left].filter(Boolean).join(' · ');
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
    this.numbers.textContent = '';
    await new Promise((done) => setTimeout(done, 260));
    this.stage.root.style.opacity = '0';
    await new Promise((done) => setTimeout(done, FADE_MS));
    this.dispose();
  }

  /** Say why nothing is happening, and stop pretending to load. */
  fail(why: string): void {
    cancelAnimationFrame(this.raf);
    this.gone = true;
    this.standby.style.opacity = '0';
    this.stage.meter.root.style.opacity = '1';
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
