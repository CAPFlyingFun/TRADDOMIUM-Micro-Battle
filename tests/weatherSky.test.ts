import { describe, expect, it } from 'vitest';
import { CLEAR_SKY, FOG_TAIL, sightFor, skyLook } from '../src/weather/sky';
import { toGameWeather } from '../src/weather/gameplay';
import { TYPICAL, type Conditions } from '../src/weather/conditions';
import { UNITS_PER_METRE } from '../src/world/kauai';

const look = (over: Partial<Conditions>) =>
  skyLook(toGameWeather({ ...TYPICAL, ...over }));

describe('the weather sky', () => {
  it('fogs to exactly the visibility that was reported', () => {
    // The provider says 8 km; the fog should hide a surface at 8 km and
    // not at 4. Round-tripping the fit is the honest way to check it.
    const eight = look({ visibility: 8_000, cloud: 40 });
    expect(sightFor(eight.density)).toBeCloseTo(8_000 * UNITS_PER_METRE, 0);
  });

  it('lets her see the island on a clear day', () => {
    const clear = look({ visibility: 24_000, cloud: 5, rain: 0 });
    // Twenty-four kilometres is most of the way across Kauaʻi, and the
    // mountains and the coastline are the only landmarks she has.
    expect(sightFor(clear.density) / UNITS_PER_METRE).toBeGreaterThan(20_000);
  });

  /**
   * The regression this whole section exists for. Fog used to be a
   * fixed 0.0000075 in all weather — about 2.3 km of sight, permanently,
   * whatever the sky was doing. Clear weather must now be clearer than
   * that, or fog is still a hiding place wearing a weather costume.
   */
  it('is no longer a permanent haze', () => {
    const WAS = 0.0000075;
    expect(look({ visibility: 24_000, cloud: 0 }).density).toBeLessThan(WAS);
  });

  it('closes in when it rains', () => {
    const clear = look({ visibility: 24_000, cloud: 5 }).density;
    const shower = look({ visibility: 3_000, cloud: 90, rain: 2 }).density;
    const downpour = look({ visibility: 700, cloud: 100, rain: 9 }).density;
    expect(shower).toBeGreaterThan(clear);
    expect(downpour).toBeGreaterThan(shower);
  });

  it('takes the sun away and leaves the sky', () => {
    const clear = look({ cloud: 0, rain: 0 });
    const grey = look({ cloud: 100, rain: 0 });
    expect(grey.sun).toBeLessThan(clear.sun * 0.5);
    // Overcast is DIFFUSE, not dark: dimming both lights is how
    // overcast ends up looking like dusk.
    expect(grey.ambient).toBeGreaterThan(clear.ambient);
  });

  it('never puts the lights out entirely', () => {
    const worst = look({ cloud: 100, rain: 200, visibility: 0 });
    expect(worst.sun + worst.ambient).toBeGreaterThan(0.8);
  });

  it('greys the sky over as it clouds up, without ever going black', () => {
    const shades = [0, 25, 50, 75, 100].map((cloud) => look({ cloud }).sky);
    expect(shades[0].b).toBeCloseTo(CLEAR_SKY.b, 6);
    for (let i = 1; i < shades.length; i += 1) {
      // Steadily less blue, steadily darker, never out.
      expect(shades[i].b).toBeLessThan(shades[i - 1].b);
      expect(shades[i].r + shades[i].g + shades[i].b).toBeGreaterThan(0.5);
    }
  });

  it('moves smoothly through every weather there is', () => {
    let last = look({ cloud: 0, rain: 0 });
    for (let step = 1; step <= 200; step += 1) {
      const now = look({ cloud: step / 2, rain: (step / 200) * 9 });
      expect(Math.abs(now.sun - last.sun)).toBeLessThan(0.05);
      expect(Math.abs(now.sky.r - last.sky.r)).toBeLessThan(0.02);
      last = now;
    }
  });

  it('keeps the convention it fits to in one place', () => {
    // 5% contrast — the meteorological definition of visibility.
    expect(Math.exp(-(FOG_TAIL ** 2))).toBeCloseTo(0.05, 9);
  });
});
