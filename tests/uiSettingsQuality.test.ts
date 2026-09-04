// @vitest-environment jsdom
/**
 * Honesty in the settings panel (ARCHITECTURE §2.9): a control nothing
 * reads must not look functional. In Phase 0 nothing reads `quality`, so
 * its control is disabled and the reason stands beside it, while the
 * controls the Performance World does honour stay live.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import { SettingsPanel, settingAction } from '../src/ui/SettingsPanel';
import { SETTINGS_SPEC } from '../src/ui/settingsStore';

describe('SettingsPanel quality row', () => {
  it('is disabled with the reason beside it, while the honoured settings stay live', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = defineStore(SETTINGS_SPEC, memoryKeyValueStore());
    const panel = new SettingsPanel(host, { store, onBack: () => {} });

    const quality = panel.element.querySelector<HTMLSelectElement>(`[data-action="${settingAction('quality')}"]`);
    expect(quality?.disabled).toBe(true);
    expect(panel.element.textContent).toContain('Quality has no effect yet');

    for (const field of ['fov', 'lookSensitivity', 'invertY', 'showFps'] as const) {
      const control = panel.element.querySelector<HTMLInputElement | HTMLButtonElement>(
        `[data-action="${settingAction(field)}"]`,
      );
      expect(control, field).not.toBeNull();
      expect(control?.disabled, field).toBe(false);
    }
    panel.dispose();
  });
});
