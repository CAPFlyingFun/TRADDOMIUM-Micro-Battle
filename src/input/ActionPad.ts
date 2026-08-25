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
  /** Whether it is being held right now — for climb and descend. */
  readonly held: boolean;
  /** Grey it out and stop it taking taps. */
  enable(on: boolean): void;
  /**
   * Take it off the pad entirely, or put it back.
   *
   * NOT the same as enable(), and the difference is the contextual-HUD
   * rule. A control for something she COULD do here but cannot right
   * now is greyed; a control for something that has nothing to do with
   * where she is standing should not be taking up room in the corner
   * of a phone at all. Drinking is the second kind — there is no water
   * on most of the island.
   */
  show(on: boolean): void;
  /** Change the glyph without rebuilding the button. */
  label(glyph: string): void;
}

class PadButton implements Action {
  private taps = 0;
  private on = true;
  private down = false;
  private there = true;

  constructor(readonly el: HTMLButtonElement) {}

  get held(): boolean {
    return this.on && this.down;
  }

  press(): void {
    if (!this.on) return;
    this.taps += 1;
    this.down = true;
  }

  release(): void {
    this.down = false;
  }

  label(glyph: string): void {
    if (this.el.textContent !== glyph) this.el.textContent = glyph;
  }

  takeTaps(): number {
    const had = this.taps;
    this.taps = 0;
    return had;
  }

  show(on: boolean): void {
    if (on === this.there) return;
    this.there = on;
    this.el.style.display = on ? '' : 'none';
    if (!on) { this.taps = 0; this.down = false; }
  }

  enable(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.el.style.opacity = on ? '1' : '.4';
    this.el.style.filter = on ? 'none' : 'grayscale(1)';
    // Taps banked while it was live would otherwise fire late.
    if (!on) {
      this.taps = 0;
      this.down = false;
    }
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
      // ABOVE THE LIFT LEVER, which owns the bottom of this column
      // now that climb and descend are no longer buttons. Left where
      // it was, the remaining actions drew straight through it.
      bottom: 'calc(198px + min(env(safe-area-inset-bottom), 12px))',
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
    const up = () => {
      el.style.transform = 'none';
      button.release();
    };
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
      // Held matters now — climb and descend are held, not tapped — so
      // the key has to track down AND up, and the auto-repeat has to be
      // ignored or one hold reads as a hundred presses.
      const tap = (event: KeyboardEvent) => {
        if (event.code !== key || event.repeat) return;
        event.preventDefault();
        button.press();
      };
      const lift = (event: KeyboardEvent) => {
        if (event.code === key) button.release();
      };
      const blur = () => button.release();
      window.addEventListener('keydown', tap);
      window.addEventListener('keyup', lift);
      window.addEventListener('blur', blur);
      this.detach.push(() => {
        window.removeEventListener('keydown', tap);
        window.removeEventListener('keyup', lift);
        window.removeEventListener('blur', blur);
      });
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
