/**
 * THE MIXER ROW: the master and the four buses, which is what separating
 * them was for.
 *
 * Chapter 1's dialogue is on VOICE and the room it is spoken in is on
 * AMBIENCE, SFX and MUSIC (`audio/manifest.ts`), and that separation is a
 * fact nobody can hear until there is a fader per bus. So this checks the
 * three things a device pass depends on: that all five controls exist and
 * are live, that moving one is SAVED — "the slider moved but nothing was
 * stored" is the failure that costs a round trip to notice — and that the
 * readout is in decibels, because the fader's midpoint is -10 dB and a
 * per-cent readout would say "50%" there and teach the player the control
 * is broken.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import { SettingsPanel, mixAction } from '../src/ui/SettingsPanel';
import { SETTINGS_DEFAULTS, SETTINGS_SPEC } from '../src/ui/settingsStore';
import { BUSES, BUS_LABEL } from '../src/audio/manifest';
import { MIX_RANGE_DB, curveGain } from '../src/audio/mix';

const openPanel = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const store = defineStore(SETTINGS_SPEC, memoryKeyValueStore());
  return { store, panel: new SettingsPanel(host, { store, onBack: () => {} }) };
};

describe('SettingsPanel mixer', () => {
  it('offers a live fader for the master and for each of the four buses', () => {
    const { panel } = openPanel();
    for (const bus of ['master', ...BUSES] as const) {
      const input = panel.element.querySelector<HTMLInputElement>(`[data-action="${mixAction(bus)}"]`);
      expect(input, bus).not.toBeNull();
      expect(input?.disabled, bus).toBe(false);
      expect(input?.type, bus).toBe('range');
      expect(input?.min, bus).toBe('0');
      expect(input?.max, bus).toBe('1');
      // Unity: the measured mix, undeparted from.
      expect(Number(input?.value), bus).toBe(1);
    }
    // Each bus is named in words a person would use, not by its id.
    const text = panel.element.textContent ?? '';
    for (const bus of BUSES) expect(text, bus).toContain(BUS_LABEL[bus]);
    panel.dispose();
  });

  it('stores what the fader was moved to, one bus at a time', () => {
    const { store, panel } = openPanel();
    const ambience = panel.element.querySelector<HTMLInputElement>(`[data-action="${mixAction('ambience')}"]`);
    expect(ambience).not.toBeNull();
    ambience!.value = '0.25';
    ambience!.dispatchEvent(new Event('input'));

    const saved = store.read();
    expect(saved.mix.ambience).toBe(0.25);
    // AND NOTHING ELSE MOVED. A mixer that writes the whole document from
    // one control is a mixer that resets the other four on every drag.
    expect(saved.mix.voice).toBe(SETTINGS_DEFAULTS.mix.voice);
    expect(saved.mix.master).toBe(SETTINGS_DEFAULTS.mix.master);
    expect(saved.mix.sfx).toBe(SETTINGS_DEFAULTS.mix.sfx);
    expect(saved.mix.music).toBe(SETTINGS_DEFAULTS.mix.music);
    panel.dispose();
  });

  it('reads out in decibels, and says −∞ where the bus is actually silent', () => {
    const { panel } = openPanel();
    const voice = panel.element.querySelector<HTMLInputElement>(`[data-action="${mixAction('voice')}"]`);
    const row = voice?.parentElement;
    const readout = () => row?.querySelector('.ui-readout')?.textContent ?? '';

    // Unity is 0 dB by construction: the curve is 1 at the top.
    expect(readout()).toBe('0.0 dB');

    // The midpoint is the half-loudness point, -10 dB, which is the whole
    // reason the fader is a curve rather than a multiplier.
    voice!.value = '0.5';
    voice!.dispatchEvent(new Event('input'));
    expect(readout()).toBe('-10.0 dB');
    expect(20 * Math.log10(curveGain(0.5))).toBeCloseTo(-10, 6);

    // And the bottom is silence, not 13.4 dB down: the curve is shifted
    // to reach zero so a bus turned off is off.
    voice!.value = '0';
    voice!.dispatchEvent(new Event('input'));
    expect(readout()).toBe('−∞ dB');
    expect(curveGain(0)).toBe(0);

    // The caption states the travel a player is working with.
    expect(panel.element.textContent ?? '').toContain(MIX_RANGE_DB.toFixed(1));
    panel.dispose();
  });
});
