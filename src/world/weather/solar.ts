/**
 * WHERE THE SUN IS OVER KAUAʻI — from the real clock, for the real sky.
 *
 * Joshua, 2026-09-07, opening Phase 5: "real weather synced… with a
 * skybox HDRI." A synced sky needs a synced sun: the light, the fog's
 * colour and which image the dome shows all follow the sun's elevation,
 * and the sun's place at any moment is not tuning, it is astronomy.
 *
 * THE ALGORITHM IS NOAA'S. The equations below are the ones in the NOAA
 * Solar Calculator (Meeus, Astronomical Algorithms, ch. 25, simplified
 * for ±0.01° over the years 1800–2200): Julian centuries → the sun's
 * geometric mean longitude and anomaly → the equation of centre → true
 * longitude and apparent longitude → obliquity → declination and the
 * equation of time → true solar time at the observer → hour angle →
 * zenith and azimuth. Nothing here is fitted to a look; the tests hold
 * the result against published sunrise and noon times for Līhuʻe.
 *
 * THE CLOCK IS THE ISLAND'S. Hawaiʻi keeps Hawaii Standard Time all year
 * (UTC−10, no daylight saving), so a local hour is one subtraction from
 * the Unix clock and there is no time-zone database to carry.
 *
 * Elevation is GEOMETRIC, without atmospheric refraction, because it is
 * consumed as an angle to light and rotate by, not read off a horizon.
 * NOAA's sunrise is the moment the geometric elevation passes −0.833°
 * (refraction plus the sun's half-width), and `SUNRISE_ELEVATION_DEG`
 * names that number so the renderer's "night" and "dusk" bands can be
 * defined against it rather than against zero.
 *
 * Pure: no three, no DOM, no clock of its own — the time is handed in.
 */
import type { GeoPoint } from '../geo';

/** Hawaii Standard Time is UTC−10 all year. */
export const HST_OFFSET_HOURS = -10;

/** The geometric elevation at which NOAA calls the sun risen or set: refraction plus the disc's half-width. */
export const SUNRISE_ELEVATION_DEG = -0.833;

export interface SunPosition {
  /** Above the horizon in radians; negative below it. Geometric, no refraction. */
  readonly elevation: number;
  /** Compass bearing of the sun in radians, 0 north, π/2 east, clockwise from above. */
  readonly azimuth: number;
  /** The sun's declination, radians — how far north of the equator it stands today. */
  readonly declination: number;
  /** The equation of time, minutes: how far the sundial is ahead of the clock. */
  readonly equationOfTimeMinutes: number;
}

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** Julian centuries since J2000.0 for a Unix time. */
function julianCentury(unixMs: number): number {
  const julianDay = unixMs / DAY_MS + 2_440_587.5;
  return (julianDay - 2_451_545) / 36_525;
}

/** The sun's position at a Unix time as seen from `where`. */
export function sunPosition(unixMs: number, where: GeoPoint): SunPosition {
  const t = julianCentury(unixMs);
  // The sun's geometric mean longitude and mean anomaly, degrees.
  const meanLongitude = mod(280.46646 + t * (36_000.76983 + t * 0.0003032), 360);
  const meanAnomaly = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  // The eccentricity of the Earth's orbit.
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  // The equation of centre: the difference between the mean and the true anomaly.
  const centre =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const trueLongitude = meanLongitude + centre;
  // Apparent longitude: nutation and aberration, through the moon's ascending node.
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  // Obliquity of the ecliptic, corrected for nutation.
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));
  // The equation of time, minutes.
  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const l0 = meanLongitude * RAD;
  const m = meanAnomaly * RAD;
  const equationOfTimeMinutes = 4 / RAD * (
    y * Math.sin(2 * l0)
    - 2 * eccentricity * Math.sin(m)
    + 4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0)
    - 1.25 * eccentricity * eccentricity * Math.sin(2 * m)
  );
  // True solar time at the observer, minutes past local solar midnight.
  const utcMinutes = mod(unixMs, DAY_MS) / 60_000;
  const trueSolarMinutes = mod(utcMinutes + equationOfTimeMinutes + 4 * where.lon, 1440);
  // Hour angle: negative before solar noon, positive after.
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const lat = where.lat * RAD;
  const cosZenith = Math.sin(lat) * Math.sin(declination) + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = Math.PI / 2 - zenith;
  // Azimuth, clockwise from north. At the zenith itself the bearing is undefined; north is as good as any.
  let azimuth = 0;
  const sinZenith = Math.sin(zenith);
  if (sinZenith > 1e-9) {
    const cosAz = (Math.sin(lat) * cosZenith - Math.sin(declination)) / (Math.cos(lat) * sinZenith);
    const az = Math.acos(Math.min(1, Math.max(-1, cosAz)));
    azimuth = hourAngle > 0 ? mod(az + Math.PI, Math.PI * 2) : mod(3 * Math.PI - az, Math.PI * 2);
  }
  return { elevation, azimuth, declination, equationOfTimeMinutes };
}

/** The island's wall clock: hours past midnight HST, 0 ≤ h < 24, fractional. */
export function kauaiLocalHours(unixMs: number): number {
  return mod(unixMs / 3_600_000 + HST_OFFSET_HOURS, 24);
}

/** The island's wall clock as `HH:MM`, for a HUD line. */
export function kauaiClock(unixMs: number): string {
  // Whole minutes first, so 09:05 does not read 09:04 through a float.
  const minutes = Math.floor(mod(unixMs / 60_000 + HST_OFFSET_HOURS * 60, 1440));
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** The Unix time of a Hawaii Standard Time wall-clock moment, for tests and probes. */
export function hstToUnixMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - HST_OFFSET_HOURS, minute);
}
