// @vitest-environment jsdom
/**
 * Honesty in the settings panel (ARCHITECTURE §2.9): a control nothing
 * reads must not look functional — and one that IS read must not go on
 * apologising for itself.
 *
 * From Phase 0 to Phase 2 this test asserted the opposite: `quality` was
 * disabled and captioned "Quality has no effect yet", because nothing
 * read it. Phase 3 made it real — the ocean reads it for its texture
 * rung, its ripple octaves and its sheet geometry — so the control and
 * the caption change in the same commit as the code that honours them.
 * A stale "no effect yet" note is the same lie as a live dead control,
 * pointing the other way.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import { SettingsPanel, settingAction } from '../src/ui/SettingsPanel';
import { QUALITY_LEVELS, SETTINGS_SPEC } from '../src/ui/settingsStore';
import { TIER_FOR_QUALITY, tierFor } from '../src/assets/textureQuality';
import { SHEET_VERTICES, TIER_OCTAVES } from '../src/sea/OceanView';

describe('SettingsPanel quality row', () => {
  it('is live, alongside the other settings the world honours', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = defineStore(SETTINGS_SPEC, memoryKeyValueStore());
    const panel = new SettingsPanel(host, { store, onBack: () => {} });

    const quality = panel.element.querySelector<HTMLSelectElement>(`[data-action="${settingAction('quality')}"]`);
    expect(quality?.disabled).toBe(false);
    // And the apology is gone, because it is no longer true.
    expect(panel.element.textContent).not.toContain('Quality has no effect yet');

    for (const field of ['fov', 'lookSensitivity', 'invertY', 'showFps'] as const) {
      const control = panel.element.querySelector<HTMLInputElement | HTMLButtonElement>(
        `[data-action="${settingAction(field)}"]`,
      );
      expect(control, field).not.toBeNull();
      expect(control?.disabled, field).toBe(false);
    }
    panel.dispose();
  });

  it('says what it changes, and does not claim what it does not', () => {
    // "Quality" over a game with one layer wired is a promise the build
    // cannot keep. The caption names the layer it reaches and the one it
    // does not, so a player who drops to Low and sees the same terrain
    // has been told why rather than left to wonder.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const panel = new SettingsPanel(host, { store: defineStore(SETTINGS_SPEC, memoryKeyValueStore()), onBack: () => {} });
    const text = panel.element.textContent ?? '';
    expect(text).toMatch(/ocean/i);
    expect(text).toMatch(/[Tt]errain is not affected yet/);
    panel.dispose();
  });

  it('every level it offers reaches a rung the ocean can actually build', () => {
    // The control is only honest if each of its three choices lands
    // somewhere real: a tier with a baked texture, an octave count and a
    // sheet size. A level that mapped to nothing would be a live control
    // that silently did nothing for one of its options.
    for (const level of QUALITY_LEVELS) {
      const tier = tierFor(level);
      expect(TIER_FOR_QUALITY[level], level).toBe(tier);
      expect(TIER_OCTAVES[tier], level).toBeGreaterThanOrEqual(1);
      expect(SHEET_VERTICES[tier], level).toBeDefined();
    }
    // And the three are genuinely different, or the dial is decoration.
    const seen = new Set(QUALITY_LEVELS.map((l) => `${TIER_OCTAVES[tierFor(l)]}:${SHEET_VERTICES[tierFor(l)].near}`));
    expect(seen.size).toBeGreaterThan(1);
  });
});
