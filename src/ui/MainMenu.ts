/**
 * THE FRONT DOOR.
 *
 * The game used to drop the player straight onto a beach with no idea
 * what they were looking at. A menu is the difference between a lab and
 * a game, and it is also where CONTINUE will live the day there is
 * anything to continue.
 *
 * Deliberately small: two live buttons, one disabled, and a title. No
 * animation system, and nothing here knows the world exists.
 */
import { buildStamp, VERSION } from '../build';

const LIVE = 'rgb(110, 255, 150)';

export interface MenuChoice {
  readonly newColony: () => void;
  readonly settings: () => void;
}

export class MainMenu {
  private readonly root: HTMLDivElement;

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

    this.root.append(
      title,
      this.button('CONTINUE COLONY', 'continue', null, 'No colony yet'),
      this.button('NEW COLONY', 'new-colony', choose.newColony),
      this.button('SETTINGS', 'settings', choose.settings),
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

    if (why) {
      const note = document.createElement('div');
      note.textContent = why;
      Object.assign(note.style, {
        font: '11px/1.6 system-ui, sans-serif',
        color: 'rgba(255,226,160,.3)',
      } as Partial<CSSStyleDeclaration>);
      wrap.appendChild(note);
    }
    return wrap;
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
