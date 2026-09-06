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
 *
 * THEN IT BECAME TWO CONTROLS (Joshua, 2026-09-05: "Probably separate
 * the two like rendering details vs textures. So could do a random
 * combination"), and the honesty question came with them: two dials that
 * secretly moved together would be one dial drawn twice.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import { SettingsPanel, settingAction } from '../src/ui/SettingsPanel';
import { QUALITY_LEVELS, SETTINGS_SPEC } from '../src/ui/settingsStore';
import { TIER_FOR_QUALITY, tierFor } from '../src/assets/textureQuality';
import { DETAIL_FOR_QUALITY, DETAIL_TIERS, detailFor, objectRadius, waveRadius } from '../src/assets/detailQuality';
import { SHEET_VERTICES, TIER_OCTAVES } from '../src/sea/OceanView';

describe('SettingsPanel quality row', () => {
  it('is live, alongside the other settings the world honours', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = defineStore(SETTINGS_SPEC, memoryKeyValueStore());
    const panel = new SettingsPanel(host, { store, onBack: () => {} });

    for (const field of ['textures', 'detail'] as const) {
      const select = panel.element.querySelector<HTMLSelectElement>(`[data-action="${settingAction(field)}"]`);
      expect(select, field).not.toBeNull();
      expect(select?.disabled, field).toBe(false);
    }
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
    // EACH CAPTION NAMES ITS OWN LADDER, or two controls under one
    // explanation are two controls a player has to guess between.
    expect(text).toMatch(/texture/i);
    expect(text).toMatch(/how far the moving water reaches/i);
    // And it says the sea itself does not stop there, because "detail:
    // low" over an ocean that ends 20 m away would read as a bug.
    expect(text).toMatch(/still reaches the horizon/i);
    panel.dispose();
  });

  it('moves ONE ladder at a time, which is the whole reason there are two', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const store = defineStore(SETTINGS_SPEC, memoryKeyValueStore());
    const panel = new SettingsPanel(host, { store, onBack: () => {} });
    const select = (field: 'textures' | 'detail'): HTMLSelectElement => {
      const el = panel.element.querySelector<HTMLSelectElement>(`[data-action="${settingAction(field)}"]`);
      if (el === null) throw new Error(`no ${field} control`);
      return el;
    };
    select('textures').value = 'low';
    select('textures').dispatchEvent(new Event('change'));
    expect(store.read().textures).toBe('low');
    expect(store.read().detail, 'textures dragged detail with it').toBe('medium');
    select('detail').value = 'high';
    select('detail').dispatchEvent(new Event('change'));
    expect(store.read().detail).toBe('high');
    expect(store.read().textures, 'detail dragged textures with it').toBe('low');
    panel.dispose();
  });

  it('every level of BOTH ladders reaches a rung the ocean can actually build', () => {
    // A control is only honest if each of its three choices lands
    // somewhere real. A level that mapped to nothing would be a live
    // control that silently did nothing for one of its options.
    for (const level of QUALITY_LEVELS) {
      const tier = tierFor(level);
      expect(TIER_FOR_QUALITY[level], level).toBe(tier);
      const detail = detailFor(level);
      expect(DETAIL_FOR_QUALITY[level], level).toBe(detail);
      expect(TIER_OCTAVES[detail], level).toBeGreaterThanOrEqual(1);
      expect(SHEET_VERTICES[detail], level).toBeDefined();
      expect(waveRadius(detail), level).toBeGreaterThan(0);
    }
    // And each ladder's three are genuinely different, or the dial is
    // decoration. Checked SEPARATELY: a detail ladder with three
    // distinct rungs would otherwise cover for a texture ladder with one.
    const detailSeen = new Set(QUALITY_LEVELS.map((l) => `${TIER_OCTAVES[detailFor(l)]}:${SHEET_VERTICES[detailFor(l)].near}`));
    expect(detailSeen.size, 'the detail ladder').toBe(QUALITY_LEVELS.length);
    const texSeen = new Set(QUALITY_LEVELS.map((l) => tierFor(l)));
    expect(texSeen.size, 'the texture ladder').toBe(QUALITY_LEVELS.length);
  });
});

describe('the detail ladder\'s two radii', () => {
  it('puts the world\'s objects exactly as far as the waves at every rung — one radius, two consumers', () => {
    // Joshua's brief put the object bubble at 100 m on high and asked
    // that it respect the ladder that already said 100 m. The day a rung
    // wants them apart, this test is deleted, not loosened.
    for (const tier of DETAIL_TIERS) expect(objectRadius(tier), tier).toBe(waveRadius(tier));
    expect(objectRadius('high')).toBe(10_000);
    expect(objectRadius('ultra-high')).toBe(20_000);
  });
});
