/**
 * THE ACTION PAD — the right thumb's half of the screen.
 *
 * The left thumb drives: stick, pace, Auto. Everything she DOES rather
 * than everywhere she goes belongs over here, which is why the probe
 * has always insisted the movement controls stay out of the right
 * third. This is what that space was being kept for.
 *
 * It holds a column of round buttons and nothing else. Jump is the
 * first; fly and land are the next two, and they are the reason this is
 * a pad rather than a single button hard-coded into the scene.
 *
 * A button that cannot be used goes dim and stops taking taps. It is
 * still THERE — you can see what it costs you to be out of breath —
 * but pressing it does nothing and it does not pretend otherwise.
 */

const GOLD = 'rgba(255, 216, 130, .7)';

export interface Action {
  /** How many times it was pressed since the last read. */
  takeTaps(): number;
  /** Grey it out and stop it taking taps. */
  enable(on: boolean): void;
}

class PadButton implements Action {
  private taps = 0;
  private on = true;

  constructor(readonly el: HTMLButtonElement) {}

  press(): void {
    if (this.on) this.taps += 1;
  }

  takeTaps(): number {
    const had = this.taps;
    this.taps = 0;
    return had;
  }

  enable(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.style.opacity = on ? '1' : '.4';
    this.el.style.filter = on ? 'none' : 'grayscale(1)';
    // Taps banked while it was live would otherwise fire late.
    if (!on) this.taps = 0;
  }
}

export class ActionPad {
  private readonly pad: HTMLDivElement;
  private readonly detach: Array<() => void> = [];

  constructor(host: HTMLElement) {
    this.pad = document.createElement('div');
    this.pad.dataset.ui = 'actions';
    Object.assign(this.pad.style, {
      position: 'fixed',
      right: 'calc(14px + min(env(safe-area-inset-right), 14px))',
      bottom: 'calc(20px + min(env(safe-area-inset-bottom), 12px))',
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: '10px',
      alignItems: 'center',
      zIndex: '12',
    } as Partial<CSSStyleDeclaration>);
    host.appendChild(this.pad);
  }

  /**
   * @param glyph what it shows
   * @param name the probe's handle on it, and its aria label
   * @param key an optional keyboard equivalent, for the desktop
   */
  add(glyph: string, name: string, key?: string): Action {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = glyph;
    el.dataset.action = name;
    el.setAttribute('aria-label', name);
    Object.assign(el.style, {
      appearance: 'none',
      width: '62px',
      height: '62px',
      borderRadius: '50%',
      border: `2px solid ${GOLD}`,
      background: 'rgba(18, 14, 6, .62)',
      boxShadow: '0 0 0 2px rgba(0,0,0,.3), 0 2px 10px rgba(0,0,0,.35)',
      color: 'rgba(255, 226, 160, .95)',
      font: '24px/1 system-ui, sans-serif',
      cursor: 'pointer',
      touchAction: 'none',
      userSelect: 'none',
      transition: 'opacity 140ms ease, filter 140ms ease, transform 90ms ease',
    } as Partial<CSSStyleDeclaration>);

    const button = new PadButton(el);
    const down = (event: PointerEvent) => {
      // The pad sits over the camera drag surface; without this a tap
      // on a button also swings the view.
      event.preventDefault();
      event.stopPropagation();
      el.style.transform = 'scale(.92)';
      button.press();
    };
    const up = () => { el.style.transform = 'none'; };
    el.addEventListener('pointerdown', down as EventListener);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    this.detach.push(() => {
      el.removeEventListener('pointerdown', down as EventListener);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('pointerleave', up);
    });

    if (key) {
      const tap = (event: KeyboardEvent) => {
        // Ignore the auto-repeat: holding it down is not eight jumps.
        if (event.code !== key || event.repeat) return;
        event.preventDefault();
        button.press();
      };
      window.addEventListener('keydown', tap);
      this.detach.push(() => window.removeEventListener('keydown', tap));
    }

    this.pad.appendChild(el);
    return button;
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach.length = 0;
    this.pad.remove();
  }
}
