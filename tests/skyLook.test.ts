/**
 * THE SKY'S LOOK, held to what the brief and v0 asked of it — without a
 * canvas, because `skyLook` is pure:
 *
 *   a clear noon is the ACCEPTED island: the shipped sun, sky-light,
 *     horizon and fog, so nothing Joshua signed off changes colour
 *   the fog is exactly the reported visibility, in both directions
 *   overcast is DIFFUSE, not dark — the sun falls and the sky rises
 *     (dimming both is how overcast ends up looking like dusk)
 *   rain thickens the air through the visibility it reports
 *   the day is a chain of cross-fades on the sun's elevation, and
 *     NOTHING SNAPS: no image's weight moves more than 0.05 a degree,
 *     and neither light does, through the whole sweep from night to noon
 *   night is night: both lights dim, a blue-grey bounce, a near-black rim
 *   the night dome's exposure follows the sun: darker at −24° than at
 *     −12°, full by nautical dawn, and NOTHING brightens — the new
 *     dimming is at or under the old at every elevation and every cloud
 *   the key light never comes from under the ground
 */
import { describe, expect, it } from 'vitest';
import {
  CLOUD_FADE_FULL_DEG, DAY_ABOVE_DEG, DIMMING_UNDER_COVER, DUSK_AT_DEG, FOG_TAIL, GROUND_BOUNCE, HORIZON_CLEAR,
  LIGHT_FLOOR, NIGHT_BELOW_DEG, NIGHT_DOME_FLOOR, NIGHT_DOME_FULL_DEG, SUN_WARM, cloudMixOf, domeExposureFor, gloomOf,
  sightFor, skyLook, type SkyLook,
} from '../src/sky/skyLook';
import { SKY_IMAGE_IDS, type SkyImageId } from '../src/assets/skyManifest';
import type { SunPosition } from '../src/world/weather/solar';
import { CLEAR_VISIBILITY_M, FAIR, visibilityFor, type WeatherNow } from '../src/world/weather/weather';

const DEG = Math.PI / 180;
/** 100 world units to the metre, as everywhere. */
const M = 100;

const sun = (elevationDeg: number, azimuthDeg = 180): SunPosition => ({
  elevation: elevationDeg * DEG,
  azimuth: azimuthDeg * DEG,
  declination: 0,
  equationOfTimeMinutes: 0,
});
const weather = (over: Partial<WeatherNow> = {}): WeatherNow => ({ ...FAIR, ...over });

const NOON = sun(80);
const CLEAR = weather({ cloud: 0.1 });
const OVERCAST = weather({ sky: 'cloudy', cloud: 0.95, visibilityM: visibilityFor(0, 0.95) });
const SHOWER = weather({ sky: 'rain', rainMmHr: 10, cloud: 0.95, visibilityM: visibilityFor(10, 0.95) });

/** The weight each of the four skies carries in a look: two slots, four images, the rest zero. */
function weights(look: SkyLook): Record<SkyImageId, number> {
  const out = Object.fromEntries(SKY_IMAGE_IDS.map((id) => [id, 0])) as Record<SkyImageId, number>;
  out[look.image] += 1 - look.mix;
  out[look.nextImage] += look.mix;
  return out;
}

describe('a clear noon', () => {
  const look = skyLook(CLEAR, NOON);

  it('shows the clear sky, whole', () => {
    expect(look.image).toBe('clear');
    expect(look.mix).toBe(0);
    expect(look.dimming).toBe(1);
  });

  it('lights it with a high, warm sun', () => {
    expect(look.sunIntensity).toBeGreaterThanOrEqual(1);
    expect(look.sunColour.r).toBeGreaterThan(look.sunColour.g);
    expect(look.sunColour.g).toBeGreaterThan(look.sunColour.b);
  });

  it('is the ACCEPTED island: the scene’s shipped sun, sky-light, horizon and bounce, to the number', () => {
    // PerformanceWorldScene: DirectionalLight(0xfff4e0, 1.15), HemisphereLight(HORIZON, GROUND_BOUNCE, 1.0),
    // HORIZON #9db6c6 on the background and the fog. A clear noon must render exactly that.
    expect(look.sunIntensity).toBeCloseTo(1.15, 9);
    expect(look.hemisphereIntensity).toBeCloseTo(1.0, 9);
    expect(look.sunColour).toEqual(SUN_WARM);
    expect(look.horizon).toEqual(HORIZON_CLEAR);
    expect(look.hemisphereGround).toEqual(GROUND_BOUNCE);
    expect(HORIZON_CLEAR.r * 255).toBeCloseTo(0x9d, 0);
    expect(HORIZON_CLEAR.g * 255).toBeCloseTo(0xb6, 0);
    expect(HORIZON_CLEAR.b * 255).toBeCloseTo(0xc6, 0);
  });

  it('fogs to exactly the twenty-four kilometres the providers report as clear air', () => {
    expect(look.fogDensity).toBeCloseTo(FOG_TAIL / (24_000 * 100), 15);
    expect(sightFor(look.fogDensity)).toBeCloseTo(CLEAR_VISIBILITY_M * M, 3);
    // 5% contrast — the meteorological definition of visibility — in one place.
    expect(Math.exp(-(FOG_TAIL ** 2))).toBeCloseTo(0.05, 9);
  });

  it('gives the hemisphere the horizon’s colour, so the sky-light and the fog agree', () => {
    expect(look.hemisphereSky).toEqual(look.horizon);
  });
});

describe('overcast is diffuse, not dark', () => {
  const clear = skyLook(CLEAR, NOON);
  const grey = skyLook(OVERCAST, NOON);

  it('takes the sun away and leaves the sky', () => {
    expect(grey.sunIntensity).toBeLessThan(clear.sunIntensity / 3);
    // THE RULE v0 WROTE DOWN: dimming both lights is how overcast ends up
    // looking like dusk. The hemisphere RISES.
    expect(grey.hemisphereIntensity).toBeGreaterThan(clear.hemisphereIntensity);
  });

  it('dims the photograph and greys the horizon, and never puts the lights out', () => {
    expect(grey.dimming).toBeLessThan(1);
    expect(grey.dimming).toBeGreaterThan(0.3);
    // Greyer: less spread between the channels than the clear blue has.
    expect(grey.horizon.b - grey.horizon.r).toBeLessThan(clear.horizon.b - clear.horizon.r);
    expect(grey.sunColour.r - grey.sunColour.b).toBeLessThan(clear.sunColour.r - clear.sunColour.b);
    expect(grey.sunIntensity + grey.hemisphereIntensity).toBeGreaterThan(0.8);
  });

  it('starts counting cover above a half and is total by nine tenths', () => {
    expect(gloomOf(weather({ cloud: 0.3 }))).toBe(0);
    expect(gloomOf(weather({ cloud: 0.7 }))).toBeCloseTo(0.5, 9);
    expect(gloomOf(weather({ cloud: 1 }))).toBe(1);
    expect(gloomOf(weather({ cloud: 0, rainMmHr: 10 }))).toBeGreaterThan(0.9);
  });
});

describe('rain', () => {
  it('thickens the air, through the visibility the weather reports', () => {
    const clear = skyLook(CLEAR, NOON);
    const shower = skyLook(SHOWER, NOON);
    expect(shower.fogDensity).toBeGreaterThan(clear.fogDensity);
    expect(sightFor(shower.fogDensity)).toBeCloseTo(SHOWER.visibilityM * M, 3);
  });

  it('is gloom too: the sun goes even with the cloud held clear', () => {
    const dry = skyLook(weather({ cloud: 0.1 }), NOON);
    const wet = skyLook(weather({ cloud: 0.1, rainMmHr: 10 }), NOON);
    expect(wet.sunIntensity).toBeLessThan(dry.sunIntensity / 2);
    expect(wet.dimming).toBeLessThan(1);
  });
});

describe('the fades', () => {
  it('are where the header says, and each is wide enough that the mix moves no faster than 0.05 a degree', () => {
    expect(NIGHT_BELOW_DEG).toBe(-24);
    expect(DUSK_AT_DEG).toBe(-2);
    expect(DAY_ABOVE_DEG).toBe(20);
    expect(CLOUD_FADE_FULL_DEG).toBe(40);
    expect(DUSK_AT_DEG - NIGHT_BELOW_DEG).toBeGreaterThanOrEqual(20);
    expect(DAY_ABOVE_DEG - DUSK_AT_DEG).toBeGreaterThanOrEqual(20);
    expect(CLOUD_FADE_FULL_DEG - DAY_ABOVE_DEG).toBeGreaterThanOrEqual(20);
  });

  it('mix night into dusk through the twilight, and dusk into day through the low sun', () => {
    const twilight = skyLook(CLEAR, sun(-13));
    expect(twilight.image).toBe('night');
    expect(twilight.nextImage).toBe('dusk');
    expect(twilight.mix).toBeCloseTo(0.5, 9);

    const sunset = skyLook(CLEAR, sun(-2));
    expect(weights(sunset).dusk).toBeCloseTo(1, 9);

    const morning = skyLook(CLEAR, sun(9));
    expect(morning.image).toBe('dusk');
    expect(morning.nextImage).toBe('clear');
    expect(morning.mix).toBeCloseTo(0.5, 9);
  });

  it('pick the day sky by cloud once the sun is high: clear under 0.3, partly over 0.5', () => {
    const high = sun(60);
    expect(cloudMixOf(0.3)).toBe(0);
    expect(cloudMixOf(0.5)).toBe(1);
    expect(skyLook(weather({ cloud: 0.1 }), high).mix).toBe(0);
    const half = skyLook(weather({ cloud: 0.4 }), high);
    expect(half.image).toBe('clear');
    expect(half.nextImage).toBe('partly');
    expect(half.mix).toBeCloseTo(0.5, 9);
    expect(weights(skyLook(weather({ cloud: 0.6 }), high)).partly).toBeCloseTo(1, 9);
  });

  it('cross-fade continuously: nothing snaps anywhere in the day, whatever the weather', () => {
    // Swept at a quarter of a degree, which is a minute of real sun.
    const STEP = 0.25;
    const MIX_PER_DEG = 0.05;
    const clouds = [0, 0.35, 0.45, 0.8, 1];
    const rains = [0, 6];
    for (const cloud of clouds) {
      for (const rainMmHr of rains) {
        const now = weather({ cloud, rainMmHr, visibilityM: visibilityFor(rainMmHr, cloud) });
        let last = skyLook(now, sun(-40));
        for (let e = -40 + STEP; e <= 90; e += STEP) {
          const look = skyLook(now, sun(e));
          const a = weights(last);
          const b = weights(look);
          for (const id of SKY_IMAGE_IDS) {
            expect(Math.abs(b[id] - a[id]), `${id} at ${e}° cloud ${cloud} rain ${rainMmHr}`).toBeLessThanOrEqual(MIX_PER_DEG * STEP + 1e-9);
          }
          expect(Math.abs(look.sunIntensity - last.sunIntensity), `sun at ${e}°`).toBeLessThan(0.02);
          expect(Math.abs(look.hemisphereIntensity - last.hemisphereIntensity), `sky-light at ${e}°`).toBeLessThan(0.02);
          expect(Math.abs(look.horizon.r - last.horizon.r), `horizon at ${e}°`).toBeLessThan(0.02);
          expect(Math.abs(look.horizon.b - last.horizon.b), `horizon at ${e}°`).toBeLessThan(0.02);
          // The dome's exposure follows the sun through the night: continuously, like everything else.
          expect(Math.abs(look.dimming - last.dimming), `dimming at ${e}°`).toBeLessThan(0.02);
          last = look;
        }
      }
    }
  });

  it('cross-fade continuously in cloud too', () => {
    for (const e of [10, 25, 60]) {
      let last = skyLook(weather({ cloud: 0 }), sun(e));
      for (let cloud = 0.01; cloud <= 1; cloud += 0.01) {
        const look = skyLook(weather({ cloud }), sun(e));
        const a = weights(last);
        const b = weights(look);
        for (const id of SKY_IMAGE_IDS) expect(Math.abs(b[id] - a[id]), `${id} at cloud ${cloud}`).toBeLessThan(0.06);
        expect(Math.abs(look.sunIntensity - last.sunIntensity)).toBeLessThan(0.05);
        expect(Math.abs(look.dimming - last.dimming)).toBeLessThan(0.02);
        last = look;
      }
    }
  });
});

describe('night', () => {
  const look = skyLook(CLEAR, sun(-30));

  it('shows the night sky, whole', () => {
    expect(look.image).toBe('night');
    expect(look.mix).toBe(0);
  });

  it('dims BOTH lights and bounces a blue-grey off the ground under a near-black blue rim', () => {
    expect(look.sunIntensity).toBeLessThanOrEqual(0.1);
    expect(look.hemisphereIntensity).toBeLessThanOrEqual(0.2);
    expect(look.hemisphereGround.b).toBeGreaterThan(look.hemisphereGround.r);
    expect(Math.max(look.horizon.r, look.horizon.g, look.horizon.b)).toBeLessThan(0.1);
    expect(look.horizon.b).toBeGreaterThan(look.horizon.r);
  });

  it('is still lit: an overcast night is darker grey, not a lit one', () => {
    const grey = skyLook(OVERCAST, sun(-30));
    expect(Math.max(grey.horizon.r, grey.horizon.g, grey.horizon.b)).toBeLessThan(0.15);
    expect(grey.sunIntensity + grey.hemisphereIntensity).toBeGreaterThan(0.05);
  });
});

describe('the night dome', () => {
  it('is darker in the middle of the night than at dawn, and full by nautical dawn', () => {
    expect(NIGHT_DOME_FLOOR).toBe(0.45);
    expect(NIGHT_DOME_FULL_DEG).toBe(-14);
    const deep = skyLook(CLEAR, sun(-27)).dimming;
    const early = skyLook(CLEAR, sun(-18)).dimming;
    const dawn = skyLook(CLEAR, sun(-12)).dimming;
    const sunset = skyLook(CLEAR, sun(-2)).dimming;
    expect(deep).toBeLessThan(early);
    expect(early).toBeLessThan(dawn);
    expect(dawn).toBe(sunset);
    expect(dawn).toBe(1);
    // The floor holds from the bottom of the night up to where the night → dusk fade begins.
    expect(deep).toBeCloseTo(NIGHT_DOME_FLOOR, 12);
    expect(skyLook(CLEAR, sun(-40)).dimming).toBeCloseTo(NIGHT_DOME_FLOOR, 12);
    expect(skyLook(CLEAR, sun(NIGHT_BELOW_DEG)).dimming).toBeCloseTo(NIGHT_DOME_FLOOR, 12);
    expect(skyLook(CLEAR, sun(NIGHT_DOME_FULL_DEG)).dimming).toBe(1);
    expect(domeExposureFor(-100)).toBe(NIGHT_DOME_FLOOR);
    expect(domeExposureFor(90)).toBe(1);
  });

  it('rides the sun’s REAL elevation, not the key light’s floored one', () => {
    // Every elevation under the floor has the same key light; the dome must still tell them apart.
    expect(skyLook(CLEAR, sun(-27)).sunElevation).toBe(skyLook(CLEAR, sun(-18)).sunElevation);
    expect(skyLook(CLEAR, sun(-27)).dimming).not.toBe(skyLook(CLEAR, sun(-18)).dimming);
  });

  it('never brightens anything: the lights are untouched, and the dimming is at or under the weather’s alone', () => {
    // The NIGHT palette, to the number, on both sides of the change.
    const deep = skyLook(CLEAR, sun(-27));
    const deeper = skyLook(CLEAR, sun(-40));
    expect(deep.sunIntensity).toBe(deeper.sunIntensity);
    expect(deep.hemisphereIntensity).toBe(deeper.hemisphereIntensity);
    expect(deep.horizon).toEqual(deeper.horizon);
    expect(deep.sunColour).toEqual(deeper.sunColour);
    expect(deep.hemisphereGround).toEqual(deeper.hemisphereGround);
    // And at every elevation and every cloud, dimming ≤ 1 − DIMMING_UNDER_COVER · gloom.
    for (const cloud of [0, 0.35, 0.8, 1]) {
      for (const rainMmHr of [0, 6]) {
        const now = weather({ cloud, rainMmHr, visibilityM: visibilityFor(rainMmHr, cloud) });
        const weatherOnly = 1 - DIMMING_UNDER_COVER * gloomOf(now);
        for (let e = -40; e <= 90; e += 0.5) {
          const look = skyLook(now, sun(e));
          expect(look.dimming, `at ${e}° cloud ${cloud} rain ${rainMmHr}`).toBeLessThanOrEqual(weatherOnly + 1e-12);
          expect(look.dimming, `at ${e}°`).toBeGreaterThan(0);
          expect(look.gloom).toBeCloseTo(gloomOf(now), 12);
        }
      }
    }
  });

  it('moves no faster than its own ramp: a quarter of a degree is under 0.014, and it is monotone up to dawn', () => {
    const STEP = 0.25;
    const perDeg = (1 - NIGHT_DOME_FLOOR) / (NIGHT_DOME_FULL_DEG - NIGHT_BELOW_DEG);
    let last = skyLook(CLEAR, sun(-40)).dimming;
    for (let e = -40 + STEP; e <= 0; e += STEP) {
      const now = skyLook(CLEAR, sun(e)).dimming;
      expect(now - last, `at ${e}°`).toBeGreaterThanOrEqual(-1e-12);
      expect(now - last, `at ${e}°`).toBeLessThanOrEqual(perDeg * STEP + 1e-9);
      last = now;
    }
  });

  it('leaves the day exactly as it was: a clear noon at 1, overcast at the weather’s number', () => {
    expect(skyLook(CLEAR, NOON).dimming).toBe(1);
    expect(skyLook(OVERCAST, NOON).dimming).toBeCloseTo(1 - DIMMING_UNDER_COVER * gloomOf(OVERCAST), 12);
    expect(skyLook(CLEAR, sun(20)).dimming).toBe(1);
    expect(skyLook(CLEAR, sun(DUSK_AT_DEG)).dimming).toBe(1);
  });
});

describe('the key light', () => {
  it('follows the sun by day and never comes from under the ground after it sets', () => {
    expect(skyLook(CLEAR, sun(80, 200)).sunElevation).toBeCloseTo(80 * DEG, 12);
    expect(skyLook(CLEAR, sun(80, 200)).sunAzimuth).toBeCloseTo(200 * DEG, 12);
    expect(skyLook(CLEAR, sun(-10, 250)).sunElevation).toBe(LIGHT_FLOOR);
    expect(skyLook(CLEAR, sun(-10, 250)).sunAzimuth).toBeCloseTo(250 * DEG, 12);
    expect(LIGHT_FLOOR).toBeGreaterThan(0);
  });
});
