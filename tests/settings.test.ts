import { beforeEach, describe, expect, it } from 'vitest';
import {
  clamp, DEFAULTS, LIMITS, load, onChange, reset, set, settings,
} from '../src/ui/settings';

/** A localStorage that behaves, for the round-trip checks. */
function store(): Storage {
  const held = new Map<string, string>();
  return {
    getItem: (k) => held.get(k) ?? null,
    setItem: (k, v) => { held.set(k, String(v)); },
    removeItem: (k) => { held.delete(k); },
    clear: () => held.clear(),
    key: (i) => [...held.keys()][i] ?? null,
    get length() { return held.size; },
  } as Storage;
}

beforeEach(() => {
  // defineProperty, not assignment: the blocked-storage check below
  // replaces this with a throwing getter, and assigning over one of
  // those throws — which broke every test that ran after it.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, writable: true, value: store(),
  });
  reset();
});

describe('defaults', () => {
  it('are the values already tuned, so nothing changes out of the box', () => {
    expect(settings()).toEqual(DEFAULTS);
  });

  it('start with nothing inverted', () => {
    expect(DEFAULTS.invertLookX).toBe(false);
    expect(DEFAULTS.invertLookY).toBe(false);
    expect(DEFAULTS.invertStickY).toBe(false);
  });

  it('sit inside their own limits', () => {
    for (const dial of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      expect(DEFAULTS[dial]).toBeGreaterThanOrEqual(LIMITS[dial].min);
      expect(DEFAULTS[dial]).toBeLessThanOrEqual(LIMITS[dial].max);
    }
  });
});

describe('clamping', () => {
  it('holds a dial inside its range rather than refusing it', () => {
    expect(clamp('fov', 5)).toBe(LIMITS.fov.min);
    expect(clamp('fov', 500)).toBe(LIMITS.fov.max);
  });

  it('falls back to the default for a number that is not one', () => {
    expect(clamp('fov', Number.NaN)).toBe(DEFAULTS.fov);
  });

  it('clamps on the way in, so no unplayable value can be stored', () => {
    set('cameraDistance', 9999);
    expect(settings().cameraDistance).toBe(LIMITS.cameraDistance.max);
  });
});

describe('persistence', () => {
  it('writes what was set, so a reload can find it', () => {
    set('fov', 84);
    set('invertLookY', true);
    const saved = JSON.parse(localStorage.getItem('traddomium.settings') ?? '{}');
    expect(saved.fov).toBe(84);
    expect(saved.invertLookY).toBe(true);
  });

  it('reads it back on the next boot', () => {
    localStorage.setItem(
      'traddomium.settings',
      JSON.stringify({ ...DEFAULTS, fov: 84, invertLookY: true }),
    );
    load();
    expect(settings().fov).toBe(84);
    expect(settings().invertLookY).toBe(true);
  });

  it('ignores keys it does not know', () => {
    localStorage.setItem('traddomium.settings', JSON.stringify({ fov: 70, wat: 3 }));
    load();
    expect(settings().fov).toBe(70);
    expect((settings() as Record<string, unknown>).wat).toBeUndefined();
  });

  it('ignores a value of the wrong type rather than taking it', () => {
    // An older build could have stored anything under this key.
    localStorage.setItem('traddomium.settings', JSON.stringify({ fov: 'wide' }));
    load();
    expect(settings().fov).toBe(DEFAULTS.fov);
  });

  it('clamps what it reads back, not just what it is given', () => {
    localStorage.setItem('traddomium.settings', JSON.stringify({ fov: 100000 }));
    load();
    expect(settings().fov).toBe(LIMITS.fov.max);
  });

  it('survives rubbish in the store', () => {
    localStorage.setItem('traddomium.settings', 'not json');
    expect(() => load()).not.toThrow();
    expect(settings()).toEqual(DEFAULTS);
  });

  it('survives storage being unavailable entirely', () => {
    // A private window throws on access rather than returning null.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('blocked'); },
    });
    expect(() => load()).not.toThrow();
    expect(() => set('fov', 70)).not.toThrow();
  });
});

describe('telling the game', () => {
  it('announces a change', () => {
    let told = 0;
    const off = onChange(() => { told += 1; });
    set('fov', 70);
    expect(told).toBe(1);
    off();
    set('fov', 72);
    expect(told).toBe(1);
  });

  it('says nothing when the value did not actually change', () => {
    let told = 0;
    onChange(() => { told += 1; });
    set('fov', DEFAULTS.fov);
    expect(told).toBe(0);
  });
});
