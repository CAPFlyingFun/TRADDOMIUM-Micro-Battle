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

export class RotateGate {
  private readonly veil: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  constructor(host: HTMLElement) {
    this.veil = document.createElement('div');
    this.veil.setAttribute('role', 'alertdialog');
    this.veil.innerHTML =
      '<div class="rotate-mark" aria-hidden="true">▭</div>'
      + '<p class="rotate-call">Turn your device sideways</p>'
      + '<p class="rotate-why">TRADDOMIUM plays in landscape.</p>';
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
    this.veil.remove();
  }

  private apply(): void {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const ask = shouldAskToRotate(window.innerWidth, window.innerHeight, coarse);
    this.veil.style.display = ask ? 'flex' : 'none';
  }

  private style(): void {
    Object.assign(this.veil.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      textAlign: 'center',
      padding: '32px',
      background: '#0F0C06',
      color: 'rgba(255, 226, 160, .95)',
      zIndex: '50',
    } satisfies Partial<CSSStyleDeclaration>);

    const sheet = document.createElement('style');
    sheet.textContent = `
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
      }
      .rotate-why {
        margin: 0;
        font: 15px/1.5 system-ui, sans-serif;
        color: rgba(255, 226, 160, .62);
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
