/**
 * The settings controls as a DOM panel, so the same rows serve two hosts:
 * the Settings SCREEN from the menu, and the pause overlay in the world —
 * where opening settings must not swap scenes, because the scene is the
 * world and swapping it would dispose the game.
 *
 * Every control carries `data-action="setting:<field>"` (one per persisted
 * field) and Reset carries `setting:reset`, so a probe can drive exactly
 * the control a player touches. Writes go to the store on every change:
 * the document is five fields, and "the slider moved but nothing was saved"
 * is the failure that costs a device round-trip to notice.
 */
import { ACTION } from '../app/actions';
import type { Store } from '../persistence/store';
import { actionRow, actionsRow, labelledRow, namedButton, note, titledPanel } from './screen';
import {
  QUALITY_LEVELS, SETTINGS_LIMITS, sanitizeSettings, type Quality, type Settings,
} from './settingsStore';

export interface SettingsPanelHooks {
  /** The settings document. The panel is its only writer. */
  readonly store: Store<Settings>;
  onBack(): void;
}

export function settingAction(field: keyof Omit<Settings, 'version'>): string {
  return `setting:${field}`;
}

export const SETTING_RESET_ACTION = 'setting:reset';

const QUALITY_LABEL: Readonly<Record<Quality, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export class SettingsPanel {
  readonly element: HTMLElement;
  private current: Settings;
  /** One per control: pushes the current document back into the DOM. */
  private readonly syncs: Array<(s: Settings) => void> = [];

  constructor(host: HTMLElement, private readonly hooks: SettingsPanelHooks) {
    this.current = hooks.store.read();
    this.element = titledPanel(host, 'Settings');
    this.buildRange('fov', 'Field of view', (v) => `${v.toFixed(0)}°`);
    this.buildRange('lookSensitivity', 'Look sensitivity', (v) => `${v.toFixed(2)}×`);
    this.buildSwitch('invertY', 'Invert look up/down');
    this.buildQuality();
    this.buildSwitch('showFps', 'Show frame rate');
    actionsRow(this.element, [
      namedButton(SETTING_RESET_ACTION, 'Reset to defaults', () => this.write(sanitizeSettings(undefined)), { compact: true }),
      actionRow(ACTION.back, 'Back', () => this.hooks.onBack(), { compact: true }),
    ]);
    this.sync();
  }

  dispose(): void {
    this.element.remove();
  }

  private write(next: Settings): void {
    // Through sanitize, so a control cannot store what the store would refuse.
    this.current = sanitizeSettings(next);
    this.hooks.store.write(this.current);
    this.sync();
  }

  private sync(): void {
    for (const push of this.syncs) push(this.current);
  }

  private buildRange(field: 'fov' | 'lookSensitivity', label: string, show: (v: number) => string): void {
    const doc = this.element.ownerDocument;
    const limits = SETTINGS_LIMITS[field];
    const input = doc.createElement('input');
    input.type = 'range';
    input.className = 'ui-range';
    input.dataset.action = settingAction(field);
    input.min = String(limits.min);
    input.max = String(limits.max);
    input.step = String(limits.step);
    input.setAttribute('aria-label', label);
    const readout = doc.createElement('span');
    readout.className = 'ui-readout';
    input.addEventListener('input', () => {
      this.write({ ...this.current, [field]: Number(input.value) });
    });
    this.syncs.push((s) => {
      input.value = String(s[field]);
      readout.textContent = show(s[field]);
    });
    labelledRow(this.element, label, [input, readout]);
  }

  private buildSwitch(field: 'invertY' | 'showFps', label: string): void {
    const button = namedButton(settingAction(field), '', () => {
      this.write({ ...this.current, [field]: !this.current[field] });
    }, { compact: true });
    button.classList.add('ui-switch');
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-label', label);
    this.syncs.push((s) => {
      button.setAttribute('aria-checked', String(s[field]));
      button.textContent = s[field] ? 'On' : 'Off';
    });
    labelledRow(this.element, label, [button]);
  }

  private buildQuality(): void {
    const doc = this.element.ownerDocument;
    const select = doc.createElement('select');
    select.className = 'ui-select';
    select.dataset.action = settingAction('quality');
    select.setAttribute('aria-label', 'Quality');
    for (const level of QUALITY_LEVELS) {
      const option = doc.createElement('option');
      option.value = level;
      option.textContent = QUALITY_LABEL[level];
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.write({ ...this.current, quality: select.value as Quality });
    });
    this.syncs.push((s) => {
      select.value = s.quality;
    });
    // Nothing reads `quality` yet (the renderer / LOD will, once there is
    // terrain to draw), and a control that saves a choice nothing acts on
    // would look functional without being so. Disabled, with the reason
    // beside it; the document keeps the field so the choice is ready.
    select.disabled = true;
    labelledRow(this.element, 'Quality', [select]);
    note(this.element, 'Quality has no effect yet: nothing in this build draws at more than one level of detail.');
  }
}
