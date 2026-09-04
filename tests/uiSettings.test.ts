/**
 * The settings document is untrusted input: numbers outside their range,
 * enums that are not members, booleans that are strings, keys that do not
 * exist. Every one comes back as a valid document, and a valid document
 * round-trips through the store unchanged. No DOM needed.
 */
import { describe, expect, it } from 'vitest';
import { defineStore, memoryKeyValueStore } from '../src/persistence/store';
import {
  SETTINGS_DEFAULTS, SETTINGS_KEY, SETTINGS_LIMITS, SETTINGS_SPEC, SETTINGS_VERSION, sanitizeSettings,
} from '../src/ui/settingsStore';

describe('settings sanitize', () => {
  it('returns a fresh copy of the defaults for garbage', () => {
    for (const bad of [undefined, null, 42, 'text', [], {}]) {
      const s = sanitizeSettings(bad);
      expect(s).toEqual(SETTINGS_DEFAULTS);
      expect(s).not.toBe(SETTINGS_DEFAULTS);
    }
  });

  it('clamps fov to 60..110 and lookSensitivity to its limits, dropping non-finite values', () => {
    expect(sanitizeSettings({ fov: 200 }).fov).toBe(SETTINGS_LIMITS.fov.max);
    expect(sanitizeSettings({ fov: 10 }).fov).toBe(SETTINGS_LIMITS.fov.min);
    expect(sanitizeSettings({ fov: 90 }).fov).toBe(90);
    expect(sanitizeSettings({ fov: NaN }).fov).toBe(SETTINGS_DEFAULTS.fov);
    expect(sanitizeSettings({ fov: '90' }).fov).toBe(SETTINGS_DEFAULTS.fov);
    expect(sanitizeSettings({ lookSensitivity: 99 }).lookSensitivity).toBe(SETTINGS_LIMITS.lookSensitivity.max);
    expect(sanitizeSettings({ lookSensitivity: -1 }).lookSensitivity).toBe(SETTINGS_LIMITS.lookSensitivity.min);
    expect(sanitizeSettings({ lookSensitivity: Infinity }).lookSensitivity).toBe(SETTINGS_DEFAULTS.lookSensitivity);
  });

  it('keeps booleans only when they are booleans and quality only when it is a level', () => {
    expect(sanitizeSettings({ invertY: true }).invertY).toBe(true);
    expect(sanitizeSettings({ invertY: 'true' }).invertY).toBe(SETTINGS_DEFAULTS.invertY);
    expect(sanitizeSettings({ showFps: false }).showFps).toBe(false);
    expect(sanitizeSettings({ showFps: 1 }).showFps).toBe(SETTINGS_DEFAULTS.showFps);
    expect(sanitizeSettings({ quality: 'low' }).quality).toBe('low');
    expect(sanitizeSettings({ quality: 'ultra' }).quality).toBe(SETTINGS_DEFAULTS.quality);
    expect(sanitizeSettings({ quality: 2 }).quality).toBe(SETTINGS_DEFAULTS.quality);
  });

  it('drops unknown keys and always stamps the current version', () => {
    const s = sanitizeSettings({ version: 7, fov: 70, terrainRelief: 1.5, showFix: true });
    expect(s).toEqual({ ...SETTINGS_DEFAULTS, fov: 70, version: SETTINGS_VERSION });
    expect(Object.keys(s).sort()).toEqual(['fov', 'invertY', 'lookSensitivity', 'quality', 'showFps', 'version']);
  });
});

describe('settings store round trip', () => {
  it('reads defaults from an empty store and round-trips a full document', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SETTINGS_SPEC, kv);
    expect(store.read()).toEqual(SETTINGS_DEFAULTS);
    const written = { version: SETTINGS_VERSION, fov: 95, lookSensitivity: 1.75, invertY: true, quality: 'high', showFps: false } as const;
    store.write(written);
    expect(store.read()).toEqual(written);
    expect(kv.get(SETTINGS_KEY)).not.toBeNull();
    expect(SETTINGS_KEY.startsWith('traddomium.v1.')).toBe(true);
  });

  it('clamps on the way back in, so a hand-edited file cannot escape the limits', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SETTINGS_SPEC, kv);
    kv.set(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, fov: 179, lookSensitivity: 0, quality: 'insane' }));
    expect(store.read()).toEqual({
      ...SETTINGS_DEFAULTS,
      fov: SETTINGS_LIMITS.fov.max,
      lookSensitivity: SETTINGS_LIMITS.lookSensitivity.min,
    });
  });

  it('refuses another version and malformed text, never throwing', () => {
    const kv = memoryKeyValueStore();
    const store = defineStore(SETTINGS_SPEC, kv);
    kv.set(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION + 1, fov: 100 }));
    expect(store.read()).toEqual(SETTINGS_DEFAULTS);
    kv.set(SETTINGS_KEY, '{"fov": 1');
    expect(store.read()).toEqual(SETTINGS_DEFAULTS);
  });
});
