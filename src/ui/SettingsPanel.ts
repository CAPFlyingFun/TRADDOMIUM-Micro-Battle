/**
 * THE SETTINGS PANEL — a gear, and the numbers behind it.
 *
 * Deliberately small and deliberately early. It exists so a feel
 * argument can be settled on the phone with a slider instead of a
 * build, and it is scoped to movement and camera only: the real HUD is
 * its own milestone and this must not pre-empt it.
 *
 * It carries `data-ui` rather than `data-control`, so the layout checks
 * that keep the right side clear for bite/grab/dig do not count it —
 * it is chrome, not a control she is driven with.
 */
import {
  DEFAULTS, LIMITS, reset, set, settings, type Dial, type Toggle,
} from './settings';
import { buildStamp, VERSION } from '../build';

const GOLD = 'rgba(255, 226, 160, .9)';
const LIVE = 'rgba(110, 255, 150, .95)';

interface Dialer {
  key: Dial;
  label: string;
  /**
   * True for a dial whose change is EXPENSIVE — it lands on release
   * rather than mid-drag. Terrain smoothing rebuilds every section's
   * geometry, and doing that sixty times a second while a thumb moves
   * would lock the phone solid.
   */
  onRelease?: boolean;
  /** Turns the stored value into what the player should read. */
  show: (value: number) => string;
  /** Turns a slider position back into the stored value. */
  from?: (raw: number) => number;
  to?: (value: number) => number;
}

const DIALS: Dialer[] = [
  { key: 'turnRate', label: 'Turn speed', show: (v) => v.toFixed(0) },
  {
    key: 'turnStart',
    label: 'Turn starts at',
    show: (v) => `${Math.round((v * 180) / Math.PI)}°`,
  },
  { key: 'turnEase', label: 'Turn ease', show: (v) => v.toFixed(1) },
  { key: 'fov', label: 'Field of view', show: (v) => `${v.toFixed(0)}°` },
  { key: 'cameraDistance', label: 'Camera distance', show: (v) => v.toFixed(1) },
  {
    key: 'flightSpeed',
    label: 'Flight speed',
    show: (v) => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: 'terrainSmoothing',
    label: 'Terrain smoothing',
    onRelease: true,
    show: (v) => (v <= 0 ? 'Real Kauai' : `${(v * 100).toFixed(0)}%`),
  },
  {
    key: 'terrainRelief',
    label: 'Terrain height',
    // As a percentage of real Kauai, because "0.45" means nothing and
    // "45%" says what it is: an island not quite half as tall.
    show: (v) => `${(v * 100).toFixed(0)}%`,
  },
  {
    key: 'windInfluence',
    label: 'Wind on flight',
    show: (v) => (v === 0 ? 'off' : `${(v * 100).toFixed(0)}%`),
  },
];

const TOGGLES: Array<{ key: Toggle; label: string; on: string; off: string }> = [
  { key: 'invertLookX', label: 'Look left/right', on: 'Inverted', off: 'Normal' },
  { key: 'invertLookY', label: 'Look up/down', on: 'Drag down lowers', off: 'Drag down lifts' },
  { key: 'invertStickY', label: 'Stick forward', on: 'Inverted', off: 'Normal' },
  { key: 'liveWeather', label: 'World weather', on: 'Live Kauaʻi', off: 'Simulated' },
];

export class SettingsPanel {
  private readonly gear: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly detach: Array<() => void> = [];
  private readonly redraw: Array<() => void> = [];
  private open = false;

  constructor(host: HTMLElement) {
    this.gear = document.createElement('button');
    this.panel = document.createElement('div');
    this.build();
    host.append(this.gear, this.panel);
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.gear.remove();
    this.panel.remove();
  }

  /** Open it from outside — the main menu's SETTINGS button. */
  reveal(): void {
    this.show(true);
  }

  private show(open: boolean): void {
    this.open = open;
    this.panel.style.display = open ? 'flex' : 'none';
    this.gear.setAttribute('aria-expanded', String(open));
    if (open) for (const paint of this.redraw) paint();
  }

  private build(): void {
    this.gear.type = 'button';
    this.gear.textContent = '⚙';
    this.gear.setAttribute('aria-label', 'settings');
    this.gear.dataset.ui = 'settings';
    Object.assign(this.gear.style, {
      position: 'fixed',
      top: 'calc(8px + min(env(safe-area-inset-top), 12px))',
      right: 'calc(10px + min(env(safe-area-inset-right), 14px))',
      width: '34px',
      height: '34px',
      borderRadius: '9px',
      border: '2px solid rgba(255, 216, 130, .7)',
      background: 'rgba(18, 14, 6, .6)',
      boxShadow: '0 0 0 2px rgba(0, 0, 0, .3)',
      color: GOLD,
      font: '600 17px/1 system-ui, sans-serif',
      cursor: 'pointer',
      touchAction: 'none',
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);
    this.claim(this.gear, () => this.show(!this.open));

    this.panel.dataset.ui = 'settings-panel';
    Object.assign(this.panel.style, {
      position: 'fixed',
      top: 'calc(48px + min(env(safe-area-inset-top), 12px))',
      right: 'calc(10px + min(env(safe-area-inset-right), 14px))',
      width: '250px',
      maxHeight: 'calc(100% - 64px)',
      overflowY: 'auto',
      display: 'none',
      flexDirection: 'column',
      gap: '9px',
      padding: '12px',
      borderRadius: '12px',
      border: '2px solid rgba(255, 216, 130, .7)',
      background: 'rgba(14, 11, 5, .93)',
      boxShadow: '0 6px 24px rgba(0, 0, 0, .5)',
      color: GOLD,
      font: '600 12px/1.3 "Chakra Petch", system-ui, sans-serif',
      touchAction: 'pan-y',
      zIndex: '14',
    } as Partial<CSSStyleDeclaration>);
    // A drag inside the panel is a drag on the panel, never on the view.
    this.claim(this.panel, () => {});

    this.panel.appendChild(this.buildTitle());
    for (const dial of DIALS) this.panel.appendChild(this.buildDial(dial));
    for (const toggle of TOGGLES) this.panel.appendChild(this.buildToggle(toggle));
    this.panel.appendChild(this.buildReset());
    this.panel.appendChild(this.buildStampLine());
  }

  /**
   * The version, at the top where it is read as identity.
   *
   * It lives in here rather than on the HUD because it is not part of
   * playing — but it has to live SOMEWHERE, because testing from a
   * deployed build with nothing on screen to identify it means the
   * honest answer to "is this the new one?" is always "probably".
   */
  private buildTitle(): HTMLElement {
    const row = document.createElement('div');
    row.dataset.ui = 'version';
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: '8px',
      paddingBottom: '7px',
      marginBottom: '2px',
      borderBottom: '1px solid rgba(255, 216, 130, .28)',
    } as Partial<CSSStyleDeclaration>);

    const name = document.createElement('span');
    name.textContent = 'TRADDOMIUM';
    name.style.letterSpacing = '1.2px';

    const version = document.createElement('span');
    version.textContent = `v${VERSION}`;
    version.style.color = LIVE;
    version.style.font = '600 12px/1 "JetBrains Mono", ui-monospace, monospace';

    row.append(name, version);
    return row;
  }

  /** And the build itself at the bottom, where a footer belongs. */
  private buildStampLine(): HTMLElement {
    const line = document.createElement('div');
    line.dataset.ui = 'build';
    line.textContent = buildStamp();
    Object.assign(line.style, {
      textAlign: 'center',
      paddingTop: '6px',
      borderTop: '1px solid rgba(255, 216, 130, .22)',
      font: '600 10px/1.4 "JetBrains Mono", ui-monospace, monospace',
      color: 'rgba(255, 226, 160, .5)',
      userSelect: 'text',
    } as Partial<CSSStyleDeclaration>);
    return line;
  }

  private buildDial(dial: Dialer): HTMLElement {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'block' } as Partial<CSSStyleDeclaration>);

    const head = document.createElement('div');
    Object.assign(head.style, {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '3px',
    } as Partial<CSSStyleDeclaration>);
    const name = document.createElement('span');
    name.textContent = dial.label;
    const value = document.createElement('span');
    value.style.color = LIVE;
    head.append(name, value);

    const slider = document.createElement('input');
    slider.type = 'range';
    const limit = LIMITS[dial.key];
    slider.min = String(limit.min);
    slider.max = String(limit.max);
    slider.step = String(limit.step);
    slider.setAttribute('aria-label', dial.label);
    slider.dataset.dial = dial.key;
    Object.assign(slider.style, {
      width: '100%',
      accentColor: LIVE,
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);

    const paint = () => {
      const held = settings()[dial.key];
      slider.value = String(held);
      value.textContent = dial.show(held);
    };
    paint();
    this.redraw.push(paint);

    // An expensive dial still MOVES and still reads out while dragged;
    // only the commit waits. Showing nothing until release would feel
    // like a dead control.
    const onInput = () => {
      if (dial.onRelease) {
        value.textContent = dial.show(Number(slider.value));
        return;
      }
      set(dial.key, Number(slider.value));
      value.textContent = dial.show(settings()[dial.key]);
    };
    const onCommit = () => {
      set(dial.key, Number(slider.value));
      value.textContent = dial.show(settings()[dial.key]);
    };
    slider.addEventListener('input', onInput);
    this.detach.push(() => slider.removeEventListener('input', onInput));
    if (dial.onRelease) {
      slider.addEventListener('change', onCommit);
      this.detach.push(() => slider.removeEventListener('change', onCommit));
    }

    row.append(head, slider);
    return row;
  }

  private buildToggle(toggle: { key: Toggle; label: string; on: string; off: string }): HTMLElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '8px',
    } as Partial<CSSStyleDeclaration>);

    const name = document.createElement('span');
    name.textContent = toggle.label;

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', toggle.label);
    button.dataset.toggle = toggle.key;
    Object.assign(button.style, {
      appearance: 'none',
      border: '1px solid rgba(255, 216, 130, .5)',
      borderRadius: '7px',
      padding: '4px 8px',
      background: 'rgba(255, 210, 110, .08)',
      color: GOLD,
      font: 'inherit',
      cursor: 'pointer',
      touchAction: 'none',
      whiteSpace: 'nowrap',
    } as Partial<CSSStyleDeclaration>);

    // The label says what it DOES, not what it is set to — "Inverted"
    // against a checkbox leaves you working out which way round it is.
    const paint = () => {
      const on = settings()[toggle.key];
      button.textContent = on ? toggle.on : toggle.off;
      button.style.color = on ? LIVE : GOLD;
      button.style.borderColor = on ? LIVE : 'rgba(255, 216, 130, .5)';
    };
    paint();
    this.redraw.push(paint);

    this.claim(button, () => {
      set(toggle.key, !settings()[toggle.key]);
      paint();
    });

    row.append(name, button);
    return row;
  }

  private buildReset(): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Reset to defaults';
    button.setAttribute('aria-label', 'reset settings');
    Object.assign(button.style, {
      appearance: 'none',
      marginTop: '2px',
      border: '1px solid rgba(255, 216, 130, .4)',
      borderRadius: '7px',
      padding: '6px',
      background: 'transparent',
      color: 'rgba(255, 226, 160, .7)',
      font: 'inherit',
      cursor: 'pointer',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.claim(button, () => {
      reset();
      for (const paint of this.redraw) paint();
    });
    return button;
  }

  /**
   * Take the pointer for this element.
   *
   * The camera is driven by a drag anywhere the controls are not, so
   * anything that does not claim its own pointer becomes a place where
   * fiddling with a slider swings the view underneath it.
   */
  private claim(el: HTMLElement, run: () => void): void {
    const onDown = (e: PointerEvent) => {
      run();
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', onDown as EventListener);
    this.detach.push(() => el.removeEventListener('pointerdown', onDown as EventListener));
  }
}

export { DEFAULTS };
