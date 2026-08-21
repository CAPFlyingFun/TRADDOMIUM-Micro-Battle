/**
 * WEATHER WITH NO INTERNET — the fallback that keeps the game playable.
 *
 * Weather is an enhancement. A third-party API being down, a phone in
 * airplane mode, or a first launch on a plane must not stop the Queen
 * from walking around Kauaʻi. So there is always an answer, and when it
 * is this one the player is told so plainly.
 *
 * It is not noise dressed up as meteorology. Kauaʻi's rainfall pattern
 * is one of the sharpest orographic gradients measured anywhere and it
 * has a simple cause: the northeast trades hit a 1,500 m wall, are
 * forced up, and dump their water on the windward slopes and the summit
 * of Waiʻaleʻale — about 9,500 mm a year there against roughly 500 mm
 * at Kekaha on the lee coast, twenty-five kilometres away.
 *
 *   [Giambelluca et al., "Online Rainfall Atlas of Hawaiʻi",
 *    Bull. Amer. Meteor. Soc. 94 (2013) 313–316.]
 *
 * So the model is: wet near the summit, wet on the windward side, dry
 * to the southwest, with the whole pattern breathing slowly so the sky
 * is not a photograph. The BIOLOGY of the gradient is real. The
 * specific numbers are GAME TUNING chosen to look like the island, not
 * a forecast, and nothing here should ever be presented as one.
 */
import { geoApart, type GeoPoint } from '../world/geo';
import type { Conditions } from './conditions';

/** The wet heart of the island — everything is measured from here. */
const SUMMIT: GeoPoint = { lat: 22.070, lon: -159.498 };

/** How far the summit's rain shadow reaches, in world units. */
const OROGRAPHIC_REACH = 1_600_000; // 16 km

/** The trades come from the ENE, near enough all year. */
const TRADE_BEARING = 65;

/**
 * How wet a place is, 0 (Kekaha in August) to 1 (the summit bog).
 *
 * Two causes, multiplied: nearness to the mountain, and whether you are
 * on the side the wind reaches first.
 */
export function wetness(where: GeoPoint): number {
  const apart = geoApart(where, SUMMIT);
  const near = Math.max(0, 1 - apart / OROGRAPHIC_REACH);

  // Which way this place lies from the summit, as a compass bearing.
  const east = where.lon - SUMMIT.lon;
  const north = where.lat - SUMMIT.lat;
  let bearing = (Math.atan2(east, north) * 180) / Math.PI;
  if (bearing < 0) bearing += 360;

  // Windward if it faces into the trades. Half a turn away is the lee.
  let off = Math.abs(bearing - TRADE_BEARING);
  if (off > 180) off = 360 - off;
  const windward = 0.35 + 0.65 * (1 - off / 180);

  return Math.min(1, near * windward * 1.5);
}

/**
 * A drifting number in 0..1, so the sky is not frozen between launches.
 *
 * Two out-of-step cycles rather than one, which keeps it from feeling
 * like a metronome: about forty minutes and about seven.
 */
function drift(atMs: number, phase: number): number {
  const minutes = atMs / 60_000;
  const slow = Math.sin((minutes / 41 + phase) * Math.PI * 2);
  const quick = Math.sin((minutes / 7.3 + phase * 3) * Math.PI * 2);
  return (slow * 0.7 + quick * 0.3 + 1) / 2;
}

/** Plausible conditions for one place at one moment. No network. */
export function simulate(where: GeoPoint, atMs: number): Conditions {
  const wet = wetness(where);
  const weather = drift(atMs, 0);
  const breeze = drift(atMs, 0.37);

  // Showers pass. A wet place gets them often and heavily; the lee
  // coast mostly does not get them at all.
  const shower = Math.max(0, weather - (1 - wet) * 0.75);
  const rain = shower * shower * 9 * (0.3 + wet);

  const cloud = Math.min(100, 12 + wet * 62 + weather * 32);
  const humidity = Math.min(97, 62 + wet * 24 + shower * 20);

  // Sea level is warm and the summit is not: about 6.5 °C per km, and
  // the wet places here are also the high ones.
  const temperature = 26.5 - wet * 7.5 - shower * 1.5;

  const windSpeed = 9 + breeze * 18 + wet * 4;

  // Rain and cloud on a mountain is how you get fog on a mountain.
  const visibility = rain > 4 ? 900
    : rain > 0.5 ? 3_500
      : cloud > 80 ? 12_000
        : 24_000;

  const code = rain > 4 ? 65 : rain > 1 ? 61 : rain > 0.1 ? 51
    : cloud > 80 ? 3 : cloud > 45 ? 2 : cloud > 15 ? 1 : 0;

  return {
    temperature,
    humidity,
    // The offline model has no convective/large-scale split to make, so
    // everything it produces is simply the total.
    precipitation: rain,
    rain,
    showers: 0,
    cloud,
    windSpeed,
    // The trades wander a little either side of ENE.
    windFrom: (TRADE_BEARING + (breeze - 0.5) * 50 + 360) % 360,
    windGust: windSpeed * 1.45,
    visibility,
    code,
  };
}
