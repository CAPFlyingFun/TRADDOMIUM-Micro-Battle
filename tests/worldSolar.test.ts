/**
 * The sun over Kauaʻi, held against published times rather than against
 * the code's own arithmetic. The published figures are the NOAA Solar
 * Calculator's for Līhuʻe (21.976 N, 159.339 W), HST: on the June
 * solstice sunrise about 05:53 and sunset about 19:17; on the December
 * solstice sunrise about 07:05 and sunset about 17:55. They are quoted
 * from the calculator to the minute; the tolerance below is six
 * minutes, which is a degree and a half of the sun's travel and far
 * inside what a sky image can show.
 */
import { describe, expect, it } from 'vitest';
import { SUNRISE_ELEVATION_DEG, hstToUnixMs, kauaiClock, kauaiLocalHours, sunPosition } from '../src/world/weather/solar';

const LIHUE = { lat: 21.976, lon: -159.339 };
const DEG = 180 / Math.PI;
const TOLERANCE_DEG = 1.5; // six minutes of the sun's travel near the horizon

describe('the sun over Līhuʻe', () => {
  it('rises and sets on the June solstice when NOAA says it does', () => {
    const rise = sunPosition(hstToUnixMs(2026, 6, 21, 5, 53), LIHUE);
    const set = sunPosition(hstToUnixMs(2026, 6, 21, 19, 17), LIHUE);
    expect(rise.elevation * DEG).toBeCloseTo(SUNRISE_ELEVATION_DEG, 0);
    expect(Math.abs(rise.elevation * DEG - SUNRISE_ELEVATION_DEG)).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(set.elevation * DEG - SUNRISE_ELEVATION_DEG)).toBeLessThan(TOLERANCE_DEG);
    // It rises in the north-east and sets in the north-west in June.
    expect(rise.azimuth * DEG).toBeGreaterThan(55);
    expect(rise.azimuth * DEG).toBeLessThan(75);
    expect(set.azimuth * DEG).toBeGreaterThan(285);
    expect(set.azimuth * DEG).toBeLessThan(305);
  });

  it('rises and sets on the December solstice when NOAA says it does, further south', () => {
    const rise = sunPosition(hstToUnixMs(2026, 12, 21, 7, 5), LIHUE);
    const set = sunPosition(hstToUnixMs(2026, 12, 21, 17, 55), LIHUE);
    expect(Math.abs(rise.elevation * DEG - SUNRISE_ELEVATION_DEG)).toBeLessThan(TOLERANCE_DEG);
    expect(Math.abs(set.elevation * DEG - SUNRISE_ELEVATION_DEG)).toBeLessThan(TOLERANCE_DEG);
    expect(rise.azimuth * DEG).toBeGreaterThan(105);
    expect(rise.azimuth * DEG).toBeLessThan(125);
    expect(set.azimuth * DEG).toBeGreaterThan(235);
    expect(set.azimuth * DEG).toBeLessThan(255);
  });

  it('stands nearly overhead at June noon and 45° up at December noon — the declination, 23.4° either way', () => {
    const june = sunPosition(hstToUnixMs(2026, 6, 21, 12, 35), LIHUE);
    const december = sunPosition(hstToUnixMs(2026, 12, 21, 12, 30), LIHUE);
    expect(june.declination * DEG).toBeCloseTo(23.44, 1);
    expect(december.declination * DEG).toBeCloseTo(-23.44, 1);
    // 90 − |lat − dec|, within the equation of time's few minutes.
    expect(june.elevation * DEG).toBeGreaterThan(87);
    expect(december.elevation * DEG).toBeGreaterThan(43.5);
    expect(december.elevation * DEG).toBeLessThan(45.5);
    // At noon in December the sun is due south; in June it passes NORTH of overhead here.
    expect(Math.abs(december.azimuth * DEG - 180)).toBeLessThan(10);
  });

  it('is below the horizon at midnight and the equation of time is small in mid-April', () => {
    const midnight = sunPosition(hstToUnixMs(2026, 3, 1, 0, 0), LIHUE);
    expect(midnight.elevation * DEG).toBeLessThan(-60);
    const april = sunPosition(hstToUnixMs(2026, 4, 15, 12, 0), LIHUE);
    expect(Math.abs(april.equationOfTimeMinutes)).toBeLessThan(1.5);
    const november = sunPosition(hstToUnixMs(2026, 11, 3, 12, 0), LIHUE);
    expect(november.equationOfTimeMinutes).toBeGreaterThan(15);
  });

  it('keeps the island clock on HST, all year, no daylight saving', () => {
    expect(kauaiLocalHours(hstToUnixMs(2026, 6, 21, 14, 30))).toBeCloseTo(14.5, 9);
    expect(kauaiLocalHours(hstToUnixMs(2026, 12, 21, 0, 0))).toBeCloseTo(0, 9);
    expect(kauaiClock(hstToUnixMs(2026, 9, 7, 9, 5))).toBe('09:05');
    expect(kauaiClock(hstToUnixMs(2026, 9, 7, 23, 59))).toBe('23:59');
    // 10:00 UTC is midnight on the island.
    expect(kauaiClock(Date.UTC(2026, 8, 7, 10, 0))).toBe('00:00');
  });
});
