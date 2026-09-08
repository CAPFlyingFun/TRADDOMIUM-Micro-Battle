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
  CAMERA_SPEED_LEVELS, QUALITY_LEVELS, SETTINGS_LIMITS, sanitizeSettings,
  type CameraSpeed, type Quality, type Settings,
} from './settingsStore';

export interface SettingsPanelHooks {
  /** The settings document. The panel is its only writer but one: the perf world writes `hudCollapsed` from the HUD's own button. */
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

/**
 * The camera-speed rungs, named by WHAT THEY DO rather than by a word
 * that means nothing on its own: a player choosing between "Slow" and
 * "Fast" is choosing between numbers, so the numbers are on the control.
 * They are the tops of the ranges — every rung starts at 1 m/s.
 */
const CAMERA_SPEED_LABEL: Readonly<Record<CameraSpeed, string>> = {
  slow: 'Slow — 1 to 5 m/s',
  medium: 'Medium — 1 to 10 m/s',
  fast: 'Fast — 1 to 30 m/s',
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

  /**
   * TWO LADDERS, TWO CONTROLS — Joshua, 2026-09-05: "Probably separate
   * the two like rendering details vs textures. So could do a random
   * combination."
   *
   * They were one control until then, and one control was wrong because
   * the two costs fail differently. Texture size is GPU MEMORY and its
   * failure is a killed tab; wave radius is VERTICES A FRAME and its
   * failure is a slow one. A player dropping textures to fit a phone's
   * memory was also giving up their sea, and one who wanted more water
   * was paying for textures they may have had no room for. Neither
   * clamps the other now.
   *
   * LIVE SINCE PHASE 3, both of them. Until the ocean arrived nothing
   * read this and the control was disabled with the reason beside it — a
   * control that saves a choice nothing acts on looks functional without
   * being so (§2.9). Each caption says WHAT its ladder changes, because
   * the honest caption for a setting that reaches one layer is not
   * "Quality".
   */
  private buildQuality(): void {
    this.buildLadder('textures', 'Textures', 'Sets the ocean’s texture size and filtering. Terrain is not affected yet.');
    this.buildLadder('detail', 'Detail', 'Sets how far the moving water reaches — 20 m at low, 100 m at high — and how many ripple layers it is drawn with. The sea itself still reaches the horizon.');
    this.buildCameraSpeed();
  }

  /**
   * HOW FAST A FULL PUSH FLIES (Joshua, 2026-09-08: "make the joystick
   * camera speed adjustable... I am moving too fast to see them").
   *
   * Not a quality — it costs the machine nothing — so it is its own
   * control with its own words, and the caption says the one thing a
   * player cannot see from the label: that the floor does not move. A
   * gentle push is 1 m/s at every setting; the rung is the ceiling.
   */
  private buildCameraSpeed(): void {
    const doc = this.element.ownerDocument;
    const select = doc.createElement('select');
    select.className = 'ui-select';
    select.dataset.action = settingAction('cameraSpeed');
    select.setAttribute('aria-label', 'Camera speed');
    for (const level of CAMERA_SPEED_LEVELS) {
      const option = doc.createElement('option');
      option.value = level;
      option.textContent = CAMERA_SPEED_LABEL[level];
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.write({ ...this.current, cameraSpeed: select.value as CameraSpeed });
    });
    this.syncs.push((s) => {
      select.value = s.cameraSpeed;
    });
    labelledRow(this.element, 'Camera speed', [select]);
    note(this.element, 'The fastest a full push of the move stick flies. A gentle push is 1 m/s whichever you choose — this sets the top of the range, not the whole of it.');
  }

  private buildLadder(field: 'textures' | 'detail', label: string, caption: string): void {
    const doc = this.element.ownerDocument;
    const select = doc.createElement('select');
    select.className = 'ui-select';
    select.dataset.action = settingAction(field);
    select.setAttribute('aria-label', label);
    for (const level of QUALITY_LEVELS) {
      const option = doc.createElement('option');
      option.value = level;
      option.textContent = QUALITY_LABEL[level];
      select.appendChild(option);
    }
    select.addEventListener('change', () => {
      this.write({ ...this.current, [field]: select.value as Quality });
    });
    this.syncs.push((s) => {
      select.value = s[field];
    });
    labelledRow(this.element, label, [select]);
    note(this.element, caption);
  }
}
