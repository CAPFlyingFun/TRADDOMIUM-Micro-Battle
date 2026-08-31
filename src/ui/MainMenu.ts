/**
 * THE FRONT DOOR.
 *
 * The game used to drop the player straight onto a beach with no idea
 * what they were looking at. A menu is the difference between a lab and
 * a game, and it is also where CONTINUE will live the day there is
 * anything to continue.
 *
 * Deliberately small: a title, a session choice, three buttons. No
 * animation system, and nothing here knows the world exists.
 *
 * ONE CHOICE SITS ABOVE THE PLAY BUTTONS — Solo or Multiplayer —
 * because it applies to both of them. Continuing an old colony and
 * founding a new one are the same run under two different clocks, and a
 * switch that lived on one button would quietly not apply to the other.
 *
 * MULTIPLAYER PROMISES EXACTLY ONE THING TODAY, and the caption under
 * the pair says it out loud: the world keeps running while a menu or
 * the map is open. There is no netcode anywhere in src/, so a word that
 * hinted at other players would be a lie printed on the front door —
 * and the day a server owns the clock, this label gains meaning rather
 * than changing it.
 *
 * The choice reaches the game as an ARGUMENT to whichever play button
 * was pressed, rather than as something to go and ask the menu for
 * afterwards, so there is never a second copy of it to fall out of step.
 */
import { buildStamp, VERSION } from '../build';
import { modeCaption, type SessionMode } from '../game/session';

const LIVE = 'rgb(110, 255, 150)';
/**
 * The half of the split that is not chosen. Dimmer than the live green
 * and brighter than the disabled grey, because it is a working control:
 * borrowing the "not built yet" colours for it would teach the player
 * that half of the choice is unavailable.
 */
const UNCHOSEN = 'rgba(255, 226, 160, .55)';

/** What CONTINUE would do, and what it should say it does. */
export interface Resume {
  readonly label: string;
  /** @param mode whichever half of the split was lit when it was pressed */
  readonly run: (mode: SessionMode) => void;
}

export interface MenuChoice {
  /**
   * The run waiting to be picked up, or null when there is none.
   *
   * NULL IS A REAL STATE and it stays visible: the button greys out
   * rather than vanishing, because a menu whose buttons move depending
   * on history teaches the player nothing about where things are.
   */
  readonly resume: Resume | null;
  /** The mode rides along with the press, so it cannot be read stale. */
  readonly newColony: (mode: SessionMode) => void;
  readonly settings: () => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;
  private readonly modeButtons = new Map<SessionMode, HTMLButtonElement>();
  private readonly modeNote: HTMLDivElement;
  /**
   * MULTIPLAYER BY DEFAULT (Joshua, 2026-08-30): the game is meant to
   * be played in a world that keeps running, so Solo is the deliberate
   * step aside rather than the way in.
   */
  private mode: SessionMode = 'multiplayer';

  constructor(host: HTMLElement, choose: MenuChoice) {
    this.root = document.createElement('div');
    this.root.dataset.ui = 'main-menu';
    Object.assign(this.root.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      padding: 'calc(14px + env(safe-area-inset-top)) 18px calc(14px + env(safe-area-inset-bottom))',
      background: 'radial-gradient(circle at 50% 32%, #1d2a18, #070a06 74%)',
      zIndex: '50',
    } as Partial<CSSStyleDeclaration>);

    const title = document.createElement('div');
    title.innerHTML = `
      <div style="font:800 30px/1 'Chakra Petch',system-ui,sans-serif;
                  letter-spacing:.18em;color:rgba(255,226,160,.95)">TRADDOMIUM</div>
      <div style="font:600 14px/1.6 system-ui,sans-serif;letter-spacing:.34em;
                  color:rgba(255,226,160,.6);text-align:center">MICRO BATTLE!</div>`;
    title.style.textAlign = 'center';
    title.style.marginBottom = '8px';

    this.modeNote = this.caption(modeCaption(this.mode));
    this.modeNote.dataset.ui = 'mode-why';
    // Brighter than a button's caption. This one is not a footnote:
    // it is the only place the build admits what MULTIPLAYER is not.
    this.modeNote.style.color = 'rgba(255,226,160,.5)';

    // The resume handle is read into a const so the CONTINUE closure
    // captures the narrowed value rather than re-reading a nullable
    // field at click time.
    const resume = choose.resume;

    this.root.append(
      title,
      this.split(),
      this.button(
        'CONTINUE COLONY', 'continue',
        resume ? () => resume.run(this.mode) : null,
        resume?.label ?? 'No colony yet',
      ),
      this.button('NEW COLONY', 'new-colony', () => choose.newColony(this.mode)),
      // NOT 'settings'. The gear the panel puts on screen already
      // carries that name, and two different controls under one
      // selector is how a click lands on whichever one the DOM happens
      // to reach first — which for a probe meant tapping a gear hidden
      // behind this very menu.
      this.button('SETTINGS', 'menu-settings', choose.settings),
      this.stamp(),
    );
    host.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  show(): void {
    this.root.style.display = 'flex';
  }

  /**
   * SOLO | MULTIPLAYER, joined into one control.
   *
   * Two segments rather than a single toggle, because both words have
   * to be legible at once: a switch labelled only with its current
   * state makes the player press it to find out what the other one
   * says, and pressing it is the thing that changes the run.
   */
  private split(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';

    const row = document.createElement('div');
    row.dataset.ui = 'session-mode';
    Object.assign(row.style, {
      display: 'flex',
      // The buttons below are sized content-box — nothing on this page
      // resets that — so each one renders 40px wider than the width it
      // asks for: 36 of padding and 4 of border. The pair has to be as
      // wide as they RENDER or the menu grows a step in its left edge.
      width: 'calc(min(78vw, 300px) + 40px)',
      margin: '0 auto 2px',
    } as Partial<CSSStyleDeclaration>);

    for (const mode of ['solo', 'multiplayer'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.ui = `mode-${mode}`;
      button.textContent = mode.toUpperCase();
      Object.assign(button.style, {
        appearance: 'none',
        position: 'relative',
        flex: '1',
        // Border-box HERE and only here: a zero-basis flex item that
        // adds its padding on top cannot shrink back, so two of them
        // would run off the end of the row they were told to fill.
        boxSizing: 'border-box',
        padding: '11px 8px',
        // Outer corners only, and the second segment sits on the
        // first's border, so the pair reads as one control rather
        // than as two buttons that happen to be adjacent.
        borderRadius: mode === 'solo' ? '11px 0 0 11px' : '0 11px 11px 0',
        marginLeft: mode === 'solo' ? '0' : '-2px',
        font: '700 12px/1 system-ui, sans-serif',
        letterSpacing: '.08em',
        cursor: 'pointer',
        touchAction: 'manipulation',
      } as Partial<CSSStyleDeclaration>);
      button.addEventListener('click', () => this.pick(mode));
      this.modeButtons.set(mode, button);
      row.appendChild(button);
    }

    wrap.append(row, this.modeNote);
    this.paintModes();
    return wrap;
  }

  private pick(mode: SessionMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.paintModes();
  }

  /** Light the chosen half, and say underneath what it means. */
  private paintModes(): void {
    for (const [mode, button] of this.modeButtons) {
      const on = mode === this.mode;
      button.setAttribute('aria-pressed', String(on));
      Object.assign(button.style, {
        border: `2px solid ${on ? LIVE : 'rgba(255,216,130,.34)'}`,
        background: on ? 'rgba(110,255,150,.14)' : 'rgba(255,216,130,.06)',
        color: on ? LIVE : UNCHOSEN,
        // The lit segment keeps its whole border where the two meet.
        zIndex: on ? '1' : '0',
      } as Partial<CSSStyleDeclaration>);
    }
    this.modeNote.textContent = modeCaption(this.mode);
  }

  /** @param run null for a button that is visibly not ready yet */
  private button(
    label: string, name: string, run: (() => void) | null, why = '',
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.textAlign = 'center';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ui = name;
    button.textContent = label;
    button.disabled = run === null;
    Object.assign(button.style, {
      appearance: 'none',
      width: 'min(78vw, 300px)',
      padding: '14px 18px',
      borderRadius: '11px',
      border: `2px solid ${run ? LIVE : 'rgba(255,216,130,.28)'}`,
      background: run ? 'rgba(110,255,150,.14)' : 'rgba(255,216,130,.05)',
      color: run ? LIVE : 'rgba(255,226,160,.35)',
      font: '700 14px/1 system-ui, sans-serif',
      letterSpacing: '.1em',
      cursor: run ? 'pointer' : 'default',
      touchAction: 'manipulation',
    } as Partial<CSSStyleDeclaration>);
    if (run) button.addEventListener('click', run);
    wrap.appendChild(button);

    if (why) wrap.appendChild(this.caption(why));
    return wrap;
  }

  /** The small line under a control saying what it will actually do. */
  private caption(why: string): HTMLDivElement {
    const note = document.createElement('div');
    note.textContent = why;
    Object.assign(note.style, {
      font: '11px/1.6 system-ui, sans-serif',
      color: 'rgba(255,226,160,.3)',
    } as Partial<CSSStyleDeclaration>);
    return note;
  }

  private stamp(): HTMLElement {
    const line = document.createElement('div');
    line.dataset.ui = 'menu-build';
    line.textContent = `v${VERSION} · ${buildStamp()}`;
    Object.assign(line.style, {
      marginTop: '10px',
      font: '11px/1 "JetBrains Mono", ui-monospace, monospace',
      color: 'rgba(255,226,160,.28)',
    } as Partial<CSSStyleDeclaration>);
    return line;
  }
}
