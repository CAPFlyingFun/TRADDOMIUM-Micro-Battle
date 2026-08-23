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
import { POWER_FLOOR, powerOf } from '../ant/flight';

/** Matches the flight panel's, because they are read together. */
const WARN = '#ffb03a';

const COLUMN_WIDTH = 44;
const ROW_HEIGHT = 26;

/** The one non-gold colour on the HUD: what is live RIGHT NOW. */
const LIVE = 'rgba(110, 255, 150, .95)';
const LIVE_TEXT = 'rgba(214, 255, 226, 1)';
/**
 * The reserve itself is NOT drawn here any more. It moved to the vitals
 * cluster, which is where every meter about her belongs; two gauges of
 * the same number, in two colours, in two corners, is one gauge too
 * many. What stays is the sprint row going grey when there is nothing
 * left to sprint on — that is a statement about the CONTROL, not a
 * meter: this button will not do anything if you press it.
 */

export class PaceSelector {
  private readonly column: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly auto: HTMLButtonElement;
  private readonly readout: HTMLDivElement;
  /** The second line, in flight: her speed over the ground. */
  private readonly overGround: HTMLDivElement;
  private readonly sprintCell: HTMLButtonElement;
  private readonly cells = new Map<Pace, HTMLButtonElement>();
  private readonly detach: Array<() => void> = [];

  private asked: Pace | 'faster' | 'slower' | null = null;
  private sprintTaps = 0;
  private shiftDown = false;

  private shownLit = '';
  private shownSpent = false;
  private shownAuto = '';
  private flips = 0;
  private shownSpeed = -1;
  private shownAir: number | null = null;

  constructor(host: HTMLElement) {
    this.column = document.createElement('div');
    this.rows = document.createElement('div');
    this.auto = document.createElement('button');
    this.readout = document.createElement('div');
    this.overGround = document.createElement('div');
    this.column.dataset.control = 'pace';
    // The column runs the full height so a short window eats it from
    // the top; the ROWS are where it actually draws, and the only
    // box worth testing another panel against.
    this.rows.dataset.ui = 'pace-rows';
    this.style();

    // Sprint on top, then the sustainable rows fastest-first.
    this.sprintCell = this.makeCell(SPRINT_MARK, 'sprint');
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

    this.column.append(this.auto, label, this.rows, this.readout, this.overGround);
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

  /** How many times the Auto chip was tapped since the last read. */
  takeAutoFlips(): number {
    const flips = this.flips;
    this.flips = 0;
    return flips;
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

  /** Show what is selected, whether it can be had, and how fast she is going. */
  show(
    pace: Pace,
    sprinting: boolean,
    spent: boolean,
    speed: number,
    auto: boolean,
    way: 1 | -1,
    /**
     * Her AIRSPEED, when she is flying. Null on the ground.
     *
     * On the ground these are the same number and one line says it. In
     * the air they part company — the wind is added to her airspeed to
     * get her speed over the ground — and that difference is the whole
     * of the flight model. Better said here, where the speed already
     * is, than as a second instrument somewhere else.
     */
    air: number | null = null,
  ): void {
    // ONE row is green, and it is whatever is actually in force. Pace
    // and sprint were lit independently, so a sprint over a crawl lit
    // both — truthful and unreadable, since green is supposed to answer
    // "what speed am I doing" with one row.
    const lit = `${pace}|${sprinting}`;
    if (this.shownLit !== lit) {
      this.shownLit = lit;
      for (const [at, cell] of this.cells) {
        this.mark(cell, at !== pace ? 'off' : sprinting ? 'chosen' : 'live');
      }
      this.mark(this.sprintCell, sprinting ? 'live' : 'off');
    }

    if (spent !== this.shownSpent) {
      this.shownSpent = spent;
      this.sprintCell.style.filter = spent ? 'grayscale(1)' : 'none';
      this.sprintCell.style.opacity = spent ? '0.55' : '1';
    }

    const chip = auto ? (way > 0 ? 'ahead' : 'astern') : 'off';
    if (this.shownAuto !== chip) {
      this.shownAuto = chip;
      // Once Auto is running the lane collapses; this chip is all that
      // is left of it, and it doubles as the direction control — there
      // is no room for a second lane below the stick.
      this.auto.style.opacity = auto ? '1' : '0';
      this.auto.style.pointerEvents = auto ? 'auto' : 'none';
      this.auto.textContent = way > 0 ? 'AUTO ▲' : 'AUTO ▼';
    }

    // ON THE GROUND, HER SPEED. IN THE AIR, HER POWER.
    //
    // One world unit is about a centimetre, rounded to a tenth so a
    // continuously varying speed does not flicker every frame. That is
    // the right readout for walking, where the number IS the thing she
    // is doing, and the wrong one for flying, where 41.6 cm/s tells a
    // pilot nothing actionable and the digit that keeps moving is the
    // one that matters least. Airborne it becomes five notches against
    // a floor — see powerOf.
    //
    // The speeds themselves have not gone away, they have gone where
    // they mean something: airspeed with her heading under the compass,
    // ground speed with her track on the flight panel. Read as a pair
    // they show the wind doing its work, which is what the old
    // AIR-over-GND stack here was reaching for without the headings.
    const shown = Math.round(Math.abs(speed) * 10) / 10;
    const flying = air === null ? null : powerOf(air);
    if (shown !== this.shownSpeed || flying !== this.shownAir) {
      this.shownSpeed = shown;
      this.shownAir = flying;
      // THE LABEL GOES, THE NUMBER STAYS. The lit row already says
      // which setting is in force, so "PWR" was naming a thing the
      // column is titled after; the percentage is the part that is not
      // already on screen, and the floor warning below needs something
      // to be a percentage OF.
      this.readout.textContent = flying === null
        ? `${shown.toFixed(1)} cm/s`
        : `${flying}%`;
      // Under the floor she is descending whatever else she does. A
      // mark, not a verdict: the model lets her fly slower than this,
      // it just will not hold her up while she does.
      const low = flying !== null && flying < POWER_FLOOR;
      this.readout.style.color = low ? WARN : LIVE_TEXT;
      this.overGround.textContent = low ? `\u26a0 MIN ${POWER_FLOOR}%` : '';
      this.overGround.style.display = low ? 'block' : 'none';
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
      // Reserved so lighting a row does not shift its contents sideways.
      borderLeft: '3px solid transparent',
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

  /**
   * How a row reads.
   *
   * LIVE is the speed she is actually doing — green, because a brighter
   * gold was not enough: every row is gold, so at a glance the whole
   * ladder read as one speed. CHOSEN is the pace still selected
   * underneath a sprint that is overriding it: marked in gold so it is
   * clearly picked without claiming to be what is happening.
   */
  private mark(cell: HTMLButtonElement, as: 'live' | 'chosen' | 'off'): void {
    const live = as === 'live';
    const chosen = as === 'chosen';
    cell.style.color = live ? LIVE_TEXT
      : chosen ? 'rgba(255, 236, 190, .95)' : 'rgba(255, 226, 160, .55)';
    cell.style.background = live ? 'rgba(90, 255, 130, .17)'
      : chosen ? 'rgba(255, 210, 110, .12)' : 'transparent';
    cell.style.borderLeft = live ? `3px solid ${LIVE}`
      : chosen ? '3px solid rgba(255, 210, 110, .75)' : '3px solid transparent';
    cell.style.boxShadow = live ? 'inset 0 0 12px rgba(90, 255, 130, .28)' : 'none';
    cell.style.textShadow = live ? '0 0 8px rgba(90, 255, 130, .8)' : 'none';
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

    this.auto.type = 'button';
    this.auto.setAttribute('aria-label', 'auto direction');
    this.auto.dataset.control = 'auto-chip';
    this.auto.textContent = 'AUTO ▲';
    this.listenTap(this.auto, () => { this.flips += 1; });
    Object.assign(this.auto.style, {
      appearance: 'none',
      border: '0',
      width: '100%',
      cursor: 'pointer',
      touchAction: 'none',
      textAlign: 'center',
      font: '700 9px/1.6 "Chakra Petch", system-ui, sans-serif',
      letterSpacing: '.5px',
      // ONE LINE. The label wrapped to three inside a 44-pixel column
      // and drew a square the size of the pace rows themselves for
      // what is a status chip. The padlock went with it — the widest
      // glyph in the string, and the amber already says locked.
      whiteSpace: 'nowrap',
      padding: '3px 0',
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
      color: LIVE_TEXT,
      textShadow: '0 1px 3px rgba(0, 0, 0, .85)',
      userSelect: 'none',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.readout.textContent = '0.0 cm/s';

    Object.assign(this.overGround.style, {
      flex: '0 0 auto',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      display: 'none',
      marginTop: '2px',
      font: '600 9px/1 "JetBrains Mono", ui-monospace, monospace',
      color: WARN,
      textShadow: '0 1px 3px rgba(0, 0, 0, .85)',
      userSelect: 'none',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
  }
}
