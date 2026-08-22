/**
 * TURN YOUR DEVICE — the landscape gate.
 *
 * The HUD puts a stick under the left thumb and keeps the right side
 * clear for the action controls, which only works with the phone on its
 * side. In portrait there is nowhere for either to go, so rather than
 * ship a cramped layout nobody wants, ask for the rotation — the same
 * call Beyond Extinction makes.
 *
 * Only touch devices are asked. A narrow window on a desktop is still
 * perfectly playable with a keyboard, and blocking it would be rude.
 */

import { buildStage, type Stage } from './splashStage';

/**
 * Whether to ask for a rotation. Kept free of the DOM so the rule can
 * be tested without a browser.
 */
export function shouldAskToRotate(
  width: number,
  height: number,
  coarsePointer: boolean,
): boolean {
  return coarsePointer && height > width;
}

/**
 * Frames the viewport must hold still before the veil comes down. The
 * turn is not one event but a burst of them, and the scene needs a beat
 * to resize and redraw behind the cover.
 */
const SETTLE_FRAMES = 3;

export class RotateGate {
  private readonly stage: Stage;
  private readonly veil: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  private settling = 0;

  constructor(host: HTMLElement) {
    // THE SAME SPLASH THE BOOT SCREEN SHOWED, on the same stage, with
    // its bar full. This screen only ever appears on a phone held the
    // tall way, which is exactly the shape that artwork is composed
    // for, and it is already decoded — the boot screen spent the
    // elevation download showing it. A flat void here would throw that
    // away and make turning the phone feel like a crash.
    //
    // Built on `buildStage` rather than a background-image so it gets
    // the real fit: a background cannot be stopped from cropping the
    // bar's ends off on a tall phone, and cannot put anything BEHIND
    // the picture to show through the cut-out.
    // FRESH, not the shared copy. This screen lives for the whole
    // session and spends most of it hidden, and an image inside a
    // `display: none` subtree can have its decoded pixels reclaimed —
    // so holding the one the loading screen needs would hand it back
    // needing a fresh decode at the worst possible moment. The bytes
    // are cached; a second element costs a decode and no network.
    this.stage = buildStage({ fresh: true });
    this.veil = this.stage.root;
    this.veil.setAttribute('role', 'alertdialog');
    // Loading finished long before this screen appears. An empty bar
    // here reads as a stall.
    this.stage.meter.set(1);

    const say = document.createElement('div');
    say.className = 'rotate-say';
    say.innerHTML =
      '<div class="rotate-mark" aria-hidden="true">▭</div>'
      + '<p class="rotate-call">Turn your device sideways</p>'
      + '<p class="rotate-why">TRADDOMIUM plays in landscape.</p>';
    this.veil.appendChild(say);

    this.style();
    host.appendChild(this.veil);

    const check = () => this.apply();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    this.detach.push(() => window.removeEventListener('resize', check));
    this.detach.push(() => window.removeEventListener('orientationchange', check));
    this.apply();
  }

  /** True while the gate is covering the game. */
  get blocking(): boolean {
    return this.veil.style.display !== 'none';
  }

  dispose(): void {
    for (const off of this.detach) off();
    if (this.settling) cancelAnimationFrame(this.settling);
    this.stage.stopFitting();
    this.veil.remove();
  }

  private apply(): void {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const ask = shouldAskToRotate(window.innerWidth, window.innerHeight, coarse);

    if (ask) {
      // Cover instantly on the way in: the turn is what we are hiding.
      if (this.settling) {
        cancelAnimationFrame(this.settling);
        this.settling = 0;
      }
            // Block, not flex: the picture inside is a sized box positioned
      // by margins, and a flex parent would fight it.
      this.veil.style.display = 'block';
      return;
    }
    if (this.veil.style.display === 'none' || this.settling) return;
    this.holdUntilSettled();
  }

  /**
   * Landscape is reported the moment the device passes the threshold,
   * but the viewport keeps changing for several frames after that and
   * the canvas has not caught up yet. Dropping the veil on the first
   * report shows exactly that changeover. So wait for the size to hold
   * still, and let the scene redraw behind the cover.
   */
  private holdUntilSettled(): void {
    let held = 0;
    let last = `${window.innerWidth}x${window.innerHeight}`;
    const step = () => {
      const now = `${window.innerWidth}x${window.innerHeight}`;
      held = now === last ? held + 1 : 0;
      last = now;
      if (held >= SETTLE_FRAMES) {
        this.settling = 0;
        this.veil.style.display = 'none';
        return;
      }
      this.settling = requestAnimationFrame(step);
    };
    this.settling = requestAnimationFrame(step);
  }

  private style(): void {
    Object.assign(this.veil.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      zIndex: '50',
      color: 'rgba(255, 226, 160, .95)',
    } satisfies Partial<CSSStyleDeclaration>);

    const sheet = document.createElement('style');
    sheet.textContent = `
      /* The message sits LOW, in the dark of the forest floor. Centred
         it would land squarely on the wordmark, and a scrim heavy
         enough to sit text on top of the art would bury the art. */
      .rotate-say {
        position: absolute;
        inset: auto 0 0 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        text-align: center;
        padding: 0 32px 14vh;
        background: linear-gradient(rgba(6, 9, 5, 0), rgba(6, 9, 5, .72) 40%);
      }
      .rotate-mark {
        font-size: 68px;
        line-height: 1;
        color: rgba(255, 210, 110, .85);
        animation: rotate-hint 2.4s ease-in-out infinite;
      }
      .rotate-call {
        margin: 0;
        font: 600 21px/1.3 "Chakra Petch", system-ui, sans-serif;
        letter-spacing: .02em;
        text-shadow: 0 2px 12px rgba(0, 0, 0, .95);
      }
      .rotate-why {
        margin: 0;
        font: 15px/1.5 system-ui, sans-serif;
        color: rgba(255, 226, 160, .62);
        text-shadow: 0 2px 12px rgba(0, 0, 0, .95);
      }
      @keyframes rotate-hint {
        0%, 30% { transform: rotate(0deg); }
        55%, 85% { transform: rotate(90deg); }
        100% { transform: rotate(0deg); }
      }
      @media (prefers-reduced-motion: reduce) {
        .rotate-mark { animation: none; transform: rotate(90deg); }
      }
    `;
    this.veil.appendChild(sheet);
  }
}
