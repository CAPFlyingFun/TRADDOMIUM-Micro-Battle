import { readableBytes, readableWait, type LoadState } from './loadPlan';

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
 * Styled after the two Beyond Extinction builds, as Joshua asked, which
 * agree on more than they differ: a dark ground, a title in wide
 * uppercase, a slim horizontal bar, and a fade rather than a cut. The
 * web build's is a radial pool of light behind a Cinzel title with a
 * gold sweep; the Godot build's is a broad bar under centre. What is
 * NOT taken from either is the progress itself — BE-Godot's bar is a
 * five-second tween with nothing behind it, which is exactly the "0 to
 * 100 and then nothing happens" Joshua does not want. Every number
 * here is measured.
 *
 * TMB's palette rather than BE's blue: the black and gold this game
 * already is.
 */

const GOLD = 'rgba(255, 226, 160, 0.92)';
const GOLD_DIM = 'rgba(255, 226, 160, 0.52)';
const GOLD_FAINT = 'rgba(255, 226, 160, 0.16)';

/**
 * How long the veil takes to lift.
 *
 * BE's 0.8s, and for its reason: a cut from a loading screen to a
 * living world reads as a glitch, and the fade is what makes arriving
 * feel deliberate. The world is already rendering behind it.
 */
const FADE_MS = 800;

export class LoadingScreen {
  private readonly root: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly step: HTMLDivElement;
  private readonly tally: HTMLDivElement;
  private readonly eta: HTMLDivElement;
  private shown = 0;
  private raf = 0;
  private gone = false;

  constructor(host: HTMLElement, place: string) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'loading';
    Object.assign(this.root.style, {
      position: 'absolute',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      // BE's radial pool of light, in this game's colours: warm centre
      // falling to near-black, so the bar sits in the lit part.
      background:
        'radial-gradient(circle at 50% 42%, #2a1d0c 0%, #140d05 45%, #05050a 100%)',
      zIndex: '60',
      opacity: '1',
      transition: `opacity ${FADE_MS}ms ease`,
      // The veil is the whole interaction while it is up.
      touchAction: 'none',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.textContent = 'TRADDOMIUM';
    Object.assign(title.style, {
      font: '700 clamp(20px, 4.2vw, 34px)/1 ui-serif, Georgia, serif',
      letterSpacing: '0.22em',
      color: GOLD,
      textIndent: '0.22em',
    } as Partial<CSSStyleDeclaration>);

    // Where she is going. The map just asked; saying it back is what
    // makes the wait feel like travel rather than a spinner.
    const where = document.createElement('div');
    where.textContent = place.toUpperCase();
    Object.assign(where.style, {
      font: '600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace',
      letterSpacing: '0.34em',
      color: GOLD_DIM,
      textIndent: '0.34em',
      marginTop: '-4px',
    } as Partial<CSSStyleDeclaration>);

    const track = document.createElement('div');
    Object.assign(track.style, {
      width: 'min(420px, 62vw)',
      height: '4px',
      borderRadius: '4px',
      background: GOLD_FAINT,
      overflow: 'hidden',
      marginTop: '6px',
    } as Partial<CSSStyleDeclaration>);

    this.fill = document.createElement('div');
    Object.assign(this.fill.style, {
      height: '100%',
      width: '0%',
      borderRadius: '4px',
      background: 'linear-gradient(90deg, rgba(255,226,160,.55), #ffe2a0)',
      // Nothing here animates on a timer. The width IS the progress.
      transition: 'width 180ms linear',
    } as Partial<CSSStyleDeclaration>);
    track.appendChild(this.fill);

    // The three readouts Joshua asked for, on one line under the bar:
    // what is happening, how much of it has arrived, how long is left.
    const line = document.createElement('div');
    Object.assign(line.style, {
      width: 'min(420px, 62vw)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: '10px',
      font: '500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      color: GOLD_DIM,
    } as Partial<CSSStyleDeclaration>);

    this.step = document.createElement('div');
    this.tally = document.createElement('div');
    this.eta = document.createElement('div');
    this.tally.style.color = GOLD;
    this.eta.style.whiteSpace = 'nowrap';
    line.append(this.step, this.tally, this.eta);

    this.root.append(title, where, track, line);
    host.appendChild(this.root);
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
    this.fill.style.width = `${(this.shown * 100).toFixed(1)}%`;

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
    this.fill.style.width = '100%';
    this.step.textContent = 'Ready';
    this.eta.textContent = 'ready';
    await new Promise((done) => setTimeout(done, 220));
    this.root.style.opacity = '0';
    await new Promise((done) => setTimeout(done, FADE_MS));
    this.root.remove();
  }

  /** Say why nothing is happening, and stop pretending to load. */
  fail(why: string): void {
    cancelAnimationFrame(this.raf);
    this.gone = true;
    this.step.textContent = why;
    this.step.style.color = 'rgba(255, 150, 130, 0.92)';
    this.tally.textContent = '';
    this.eta.textContent = '';
  }

  dispose(): void {
    this.gone = true;
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }
}
