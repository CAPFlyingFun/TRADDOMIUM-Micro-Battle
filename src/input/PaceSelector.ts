/**
 * THE PACE SELECTOR — a gait limit, not an engine telegraph.
 *
 * It says how fast a FULL push of the stick is allowed to be. Choosing
 * WALK does not make her walk; it makes a full push a walk. That
 * distinction is the whole reason the previous control was scrapped, so
 * the label reads PACE and the marks sit on rows rather than in a
 * filled track that looks like applied power.
 *
 * Three sustainable rows only. Stop is "let go of the stick" and
 * reverse is "push it down" — neither is a maximum forward speed, so
 * neither belongs on a ceiling control.
 *
 * The SPRINT row above them is an override, and doubles as the stamina
 * meter because it is the only setting that costs anything to hold. It
 * is an interim home for sprint: step 06 gives it a proper action
 * button on the right with the rest of them.
 */
import {
  PACE_MARK, PACE_NAME, PACES, SPRINT_MARK, type Pace,
} from '../ant/pace';

const COLUMN_WIDTH = 44;
const ROW_HEIGHT = 26;

export class PaceSelector {
  private readonly column: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly auto: HTMLDivElement;
  private readonly readout: HTMLDivElement;
  private readonly sprintCell: HTMLButtonElement;
  private readonly reserve: HTMLDivElement;
  private readonly cells = new Map<Pace, HTMLButtonElement>();
  private readonly detach: Array<() => void> = [];

  private asked: Pace | 'faster' | 'slower' | null = null;
  private sprintTaps = 0;
  private shiftDown = false;

  private shownPace: Pace | null = null;
  private shownSprint: boolean | null = null;
  private shownStamina = -1;
  private shownSpent = false;
  private shownAuto: boolean | null = null;
  private shownSpeed = -1;

  constructor(host: HTMLElement) {
    this.column = document.createElement('div');
    this.rows = document.createElement('div');
    this.auto = document.createElement('div');
    this.readout = document.createElement('div');
    this.reserve = document.createElement('div');
    this.column.dataset.control = 'pace';
    this.style();

    // Sprint on top, then the sustainable rows fastest-first.
    this.sprintCell = this.makeCell(SPRINT_MARK, 'sprint');
    this.sprintCell.appendChild(this.reserve);
    this.listenTap(this.sprintCell, () => { this.sprintTaps += 1; });
    this.rows.appendChild(this.sprintCell);

    for (const pace of [...PACES].reverse()) {
      const cell = this.makeCell(PACE_MARK[pace], PACE_NAME[pace]);
      this.listenTap(cell, () => { this.asked = pace; });
      this.cells.set(pace, cell);
      this.rows.appendChild(cell);
    }

    const label = document.createElement('div');
    label.textContent = 'PACE';
    Object.assign(label.style, {
      textAlign: 'center',
      font: '700 9px/1 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '1.5px',
      color: 'rgba(255, 232, 178, .9)',
      textShadow: '0 1px 3px rgba(0, 0, 0, .8)',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);

    this.column.append(this.auto, label, this.rows, this.readout);
    host.appendChild(this.column);

    // Desktop: 1 / 2 / 3 pick a pace outright and Shift calls for a
    // sprint. W/S/A/D belong to the stick, which is manual movement as
    // on the phone, and Q/E belong to the camera — binding the pace to
    // those too meant a look-around quietly changed her speed, which
    // re-enabled the low-speed catch-up and steered her.
    const picks: Record<string, Pace> = {
      Digit1: 'crawl', Digit2: 'walk', Digit3: 'run',
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey) this.shiftDown = true;
      if (e.repeat) return;
      const picked = picks[e.code];
      if (picked) this.asked = picked;
    };
    const offKey = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.shiftDown = false;
    };
    const drop = () => { this.shiftDown = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', offKey);
    window.addEventListener('blur', drop);
    this.detach.push(() => window.removeEventListener('keydown', onKey));
    this.detach.push(() => window.removeEventListener('keyup', offKey));
    this.detach.push(() => window.removeEventListener('blur', drop));
  }

  /** A pace tapped since the last read, or one of the step sentinels. */
  takeRequest(): Pace | 'faster' | 'slower' | null {
    const asked = this.asked;
    this.asked = null;
    return asked;
  }

  /** Shift is the desktop sprint: held, not toggled. */
  get sprintHeld(): boolean {
    return this.shiftDown;
  }

  /** How many times sprint was asked for since the last read. */
  takeSprintTaps(): number {
    const taps = this.sprintTaps;
    this.sprintTaps = 0;
    return taps;
  }

  /** Show what is selected, what it costs, and how fast she is going. */
  show(
    pace: Pace,
    sprinting: boolean,
    stamina: number,
    spent: boolean,
    speed: number,
    auto: boolean,
  ): void {
    if (this.shownPace !== pace) {
      this.shownPace = pace;
      for (const [at, cell] of this.cells) this.markLive(cell, at === pace);
    }

    if (this.shownSprint !== sprinting) {
      this.shownSprint = sprinting;
      this.markLive(this.sprintCell, sprinting);
    }

    if (stamina !== this.shownStamina || spent !== this.shownSpent) {
      this.shownStamina = stamina;
      this.shownSpent = spent;
      this.reserve.style.height = `${Math.max(0, Math.min(1, stamina)) * 100}%`;
      this.reserve.style.background = spent
        ? 'rgba(255, 120, 96, .38)'
        : 'rgba(143, 224, 168, .34)';
      this.sprintCell.style.filter = spent ? 'grayscale(1)' : 'none';
    }

    if (this.shownAuto !== auto) {
      this.shownAuto = auto;
      // Once Auto is running the lane collapses; this compact chip is
      // all that is left of it, which keeps the screen for the fight.
      this.auto.style.opacity = auto ? '1' : '0';
    }

    // One world unit is about a centimetre. Rounded to a tenth, so a
    // continuously varying speed does not flicker every frame.
    const shown = Math.round(Math.abs(speed) * 10) / 10;
    if (shown !== this.shownSpeed) {
      this.shownSpeed = shown;
      this.readout.textContent = `${shown.toFixed(1)} cm/s`;
    }
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.column.remove();
  }

  private makeCell(mark: string, name: string): HTMLButtonElement {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.setAttribute('aria-label', name);
    Object.assign(cell.style, {
      position: 'relative',
      appearance: 'none',
      border: '0',
      borderBottom: '1px solid rgba(255, 210, 110, .18)',
      background: 'transparent',
      flex: '1 1 0',
      minHeight: '0',
      padding: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      font: '600 14px/1 "Chakra Petch", system-ui, sans-serif',
      color: 'rgba(255, 226, 160, .55)',
      letterSpacing: '-1px',
      touchAction: 'none',
      cursor: 'pointer',
      transition: 'color 120ms ease, background 120ms ease',
    } as Partial<CSSStyleDeclaration>);

    const glyph = document.createElement('span');
    glyph.textContent = mark;
    glyph.style.position = 'relative';
    cell.appendChild(glyph);
    return cell;
  }

  /** The selected row is lit; the others are legible but quiet. */
  private markLive(cell: HTMLButtonElement, live: boolean): void {
    cell.style.color = live ? 'rgba(255, 244, 214, 1)' : 'rgba(255, 226, 160, .55)';
    cell.style.background = live ? 'rgba(255, 210, 110, .16)' : 'transparent';
  }

  private listenTap(cell: HTMLElement, run: () => void): void {
    const onTap = (e: PointerEvent) => {
      run();
      e.stopPropagation();
      e.preventDefault();
    };
    cell.addEventListener('pointerdown', onTap as EventListener);
    this.detach.push(() => cell.removeEventListener('pointerdown', onTap as EventListener));
  }

  private style(): void {
    // Inboard of the stick and anchored to the BOTTOM, so a short
    // window (a browser toolbar, a small phone) takes height off the
    // top of the column rather than off the thumb's reach.
    Object.assign(this.column.style, {
      position: 'fixed',
      left: 'calc(158px + min(env(safe-area-inset-left), 14px))',
      top: 'calc(8px + env(safe-area-inset-top))',
      bottom: 'calc(20px + min(env(safe-area-inset-bottom), 12px))',
      width: `${COLUMN_WIDTH}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      gap: '3px',
      zIndex: '12',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.rows.style, {
      flex: '1 1 auto',
      minHeight: '0',
      maxHeight: `${ROW_HEIGHT * (PACES.length + 1)}px`,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: '10px',
      border: '2px solid rgba(255, 216, 130, .7)',
      // See MoveStick: the textured ground took the old glass with it.
      background: 'rgba(18, 14, 6, .6)',
      boxShadow: '0 0 0 2px rgba(0, 0, 0, .3), 0 2px 10px rgba(0, 0, 0, .3)',
      overflow: 'hidden',
      touchAction: 'none',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.reserve.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: '0',
      height: '100%',
      background: 'rgba(143, 224, 168, .34)',
      pointerEvents: 'none',
      transition: 'background 160ms ease',
    } as Partial<CSSStyleDeclaration>);

    this.auto.textContent = '🔒 AUTO';
    Object.assign(this.auto.style, {
      textAlign: 'center',
      font: '700 9px/1.6 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.5px',
      color: '#1a1206',
      background: 'rgba(255, 210, 110, .9)',
      borderRadius: '6px',
      opacity: '0',
      transition: 'opacity 160ms ease',
      pointerEvents: 'none',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);

    Object.assign(this.readout.style, {
      flex: '0 0 auto',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      font: '600 10px/1 "JetBrains Mono", ui-monospace, monospace',
      color: 'rgba(255, 232, 178, .95)',
      textShadow: '0 1px 3px rgba(0, 0, 0, .85)',
      userSelect: 'none',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.readout.textContent = '0.0 cm/s';
  }
}
