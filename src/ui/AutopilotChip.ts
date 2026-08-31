/**
 * THE ONE THING THE PLAYER NEEDS TO KNOW ABOUT THE AUTOPILOT.
 *
 * Whether it is flying her, and — when it is not — how to ask it to
 * carry on. Everything else about it lives on the developer line.
 *
 * IT IS NOT THE `AUTO` PLATE. That one is auto-RUN, the drag past the
 * stick's rim that holds a ground pace, and it has been on the HUD
 * since long before any of this. ChatGPT suggested folding the
 * autopilot's state into it; two unrelated automations under one word
 * is how a player learns to distrust both, so this is its own chip.
 *
 * THREE STATES AND ONLY THREE.
 *
 *   nothing      no destination — the chip is not on the screen at all
 *   FLYING       the autopilot has the controls
 *   STANDBY      the player took them, and the destination is still there
 *
 * STANDBY is the interesting one, and it is the whole reason this
 * exists. Taking the stick stops the automatic steering and does NOT
 * throw the waypoint away — a queen being hand-flown for a moment is
 * not a queen who has changed her mind. But before this there was no
 * way back except re-confirming the pin on the map, and no way to know
 * that was what was needed. CONTINUE is that way back.
 */

/** What the autopilot is doing, as far as the player is concerned. */
export type ChipState = 'off' | 'flying' | 'standby' | 'resting';

/** Card gold and the affirmative green, from the shared palette. */
const GOLD = 'rgba(255, 216, 130, .85)';
const LIVE = 'rgb(110, 255, 150)';
const INK = 'rgba(18, 14, 6, .72)';

/**
 * What the chip reads, given the state and how fast her clock is.
 *
 * Pure and exported because it is the sentence a player acts on, and
 * because this repo's test run has no DOM. The travel scale is shown
 * only once it is worth showing: a multiplier hovering at 1.0 is a
 * character of noise, and the ramp passes through it every time.
 */
export function chipWords(state: ChipState, travel = 1): string {
  if (state === 'off') return '';
  if (state === 'standby') return 'AP · STANDBY';
  // RESTING SAYS SO. Without it, a queen sitting on the ground with a
  // destination reads as an autopilot that has given up — which is
  // exactly what the flicker looked like before there was a word for
  // it. The multiplier stays on, because her clock is still running
  // fast and the wait really is passing quicker than it looks.
  if (state === 'resting') {
    return travel > 1.05 ? `AP · RESTING ×${travel.toFixed(1)}` : 'AP · RESTING';
  }
  return travel > 1.05 ? `AP · FLYING ×${travel.toFixed(1)}` : 'AP · FLYING';
}

export class AutopilotChip {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly go: HTMLButtonElement;
  private shown: ChipState = 'off';
  private said = '';
  private readonly detach: Array<() => void> = [];

  constructor(host: HTMLElement, onContinue: () => void) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'autopilot-chip';
    Object.assign(this.root.style, {
      position: 'fixed',
      // Low and centre-left of the view: clear of the pace column,
      // which ends at 202, and clear of the lift lever and action pad
      // on the right. Anchored in px inside the safe area, never in
      // viewport units — see any other component here.
      left: 'calc(228px + min(env(safe-area-inset-left), 12px))',
      bottom: 'calc(18px + min(env(safe-area-inset-bottom), 12px))',
      display: 'none',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 10px',
      borderRadius: '10px',
      border: `2px solid ${GOLD}`,
      background: INK,
      boxShadow: '0 0 0 2px rgba(0,0,0,.32), 0 3px 14px rgba(0,0,0,.42)',
      font: '700 11px/1 system-ui, sans-serif',
      letterSpacing: '.12em',
      color: GOLD,
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);

    this.label = document.createElement('span');
    this.root.appendChild(this.label);

    this.go = document.createElement('button');
    this.go.type = 'button';
    this.go.dataset.ui = 'autopilot-continue';
    this.go.textContent = 'CONTINUE';
    Object.assign(this.go.style, {
      appearance: 'none',
      // FORTY-FOUR PIXELS OF TOUCH, whatever the text does. The label is
      // small because the HUD is crowded; the target is not, because a
      // thumb is a thumb.
      minHeight: '44px',
      minWidth: '96px',
      padding: '0 12px',
      borderRadius: '8px',
      border: `2px solid ${LIVE}`,
      background: 'rgba(110,255,150,.14)',
      color: LIVE,
      font: '700 11px/1 system-ui, sans-serif',
      letterSpacing: '.12em',
      cursor: 'pointer',
      touchAction: 'manipulation',
      display: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.root.appendChild(this.go);

    // ITS OWN ELEMENT, never the window. `LookDrag` binds to #app and
    // does not inspect the target, so a tap here would also swing the
    // camera — the same claim SettingsPanel makes for its own panel.
    const tap = (e: PointerEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      onContinue();
    };
    this.go.addEventListener('pointerdown', tap as EventListener);
    this.detach.push(() => this.go.removeEventListener(
      'pointerdown', tap as EventListener,
    ));

    host.appendChild(this.root);
  }

  /** Called each frame. Cheap: writes nothing when nothing changed. */
  show(state: ChipState, travel = 1): void {
    const words = chipWords(state, travel);
    if (state !== this.shown) {
      this.shown = state;
      this.root.style.display = state === 'off' ? 'none' : 'flex';
      this.go.style.display = state === 'standby' ? 'block' : 'none';
    }
    if (words !== this.said) {
      this.said = words;
      this.label.textContent = words;
    }
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.root.remove();
  }
}
