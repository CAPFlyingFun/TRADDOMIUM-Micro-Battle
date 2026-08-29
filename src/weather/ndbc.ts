/**
 * READING NDBC — the buoy feed, turned into facts.
 *
 * NDBC publishes a per-station RSS whose single `<item>` carries the
 * latest observation as a block of HTML inside CDATA: a run of
 * `<strong>Label:</strong> value<br />` lines. It is a page meant for
 * people, and parsing it is therefore label-driven rather than
 * schema-driven.
 *
 * NO DOM. This runs in the browser AND in node tests, and the test
 * suite deliberately has no jsdom (see settings.test.ts, which stubs
 * what it needs). Regex over the raw text works in both and cannot be
 * broken by an entity or a stray tag the way a hand-rolled tag walker
 * can.
 *
 * THE TIMESTAMP COMES FROM THE GUID, not from the human date line. The
 * description says "August 28, 2026 5:56 pm HAST", which needs a
 * timezone table to read; the guid says `NDBC-51208-20260829035600`,
 * which is the same instant in UTC and needs nothing. `pubDate` is the
 * FEED's build time — four minutes later in the fixture — so it is a
 * fallback, never the first choice.
 *
 * NOT EVERY STATION IS A WAVE BUOY, and the pair of fixtures proves it:
 * 51208 is a Waverider off Hanalei and reports height, periods and
 * direction; NWWH1 at Nawiliwili is a Water Level Observation Network
 * station and reports wind, pressure and water temperature with no
 * waves at all. Asking it for a sea state must return null rather than
 * a sea state full of zeroes — see `parseSeaObservation`.
 *
 * This file knows nothing about seaSwell, the ocean, or the game. It
 * turns a document into numbers.
 */
import { FEET_TO_M, type SeaObservation } from './seaState';
import type { GeoPoint } from '../world/geo';

/** Wind, pressure and water from a met station like NWWH1. */
export interface MetObservation {
  readonly station: string;
  readonly observedAt: number;
  /** Degrees true, the direction the wind comes FROM. */
  readonly windFromDeg?: number;
  readonly windSpeedMps?: number;
  readonly windGustMps?: number;
  readonly pressureMb?: number;
  readonly waterTempC?: number;
  readonly at?: GeoPoint;
}

/** Knots to metres a second. */
export const KNOTS_TO_MPS = 0.514444;

/**
 * The one `<item>` of a station feed, as raw text. Returns null for a
 * feed with no observation in it at all.
 */
function itemOf(xml: string): string | null {
  const item = /<item>([\s\S]*?)<\/item>/i.exec(xml);
  return item ? item[1] : null;
}

/**
 * A labelled value out of the description block.
 *
 * The label is matched inside `<strong>…</strong>` and the value is
 * whatever follows up to the next tag, so a missing field simply fails
 * to match instead of capturing the next one along.
 */
function labelled(item: string, label: string): string | null {
  const safe = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hit = new RegExp(`<strong>\\s*${safe}\\s*:\\s*</strong>\\s*([^<]*)`, 'i')
    .exec(item);
  const text = hit ? hit[1].trim() : '';
  // NDBC prints "MM" where an instrument had nothing to say.
  return text && text !== 'MM' ? text : null;
}

/** The first number in a string, or null. Handles a leading minus. */
function firstNumber(text: string | null): number | null {
  if (text === null) return null;
  const hit = /-?\d+(?:\.\d+)?/.exec(text);
  if (!hit) return null;
  const value = Number(hit[0]);
  return Number.isFinite(value) ? value : null;
}

/**
 * A bearing out of a value like `E (81&#176;)` or `NE (50°)`.
 *
 * The PARENTHESISED number is the reading; the compass letters are a
 * rounding of it and would cost precision. Both entity and literal
 * degree signs appear in the wild, so neither is required.
 */
function bearing(text: string | null): number | null {
  if (text === null) return null;
  const hit = /\((-?\d+(?:\.\d+)?)\s*(?:&#176;|&deg;|°)?\)/i.exec(text);
  if (hit) {
    const value = Number(hit[1]);
    return Number.isFinite(value) ? value : null;
  }
  return firstNumber(text);
}

/**
 * A height in metres from a value that may be either unit.
 * NDBC's RSS renders imperial for US stations and metric elsewhere.
 */
function heightM(text: string | null): number | null {
  if (text === null) return null;
  const value = firstNumber(text);
  if (value === null) return null;
  return /\bft\b|feet/i.test(text) ? value * FEET_TO_M : value;
}

/**
 * Water temperature in Celsius. The RSS prints
 * `80.1&#176;F (26.7&#176;C)` — take the Celsius in the parentheses
 * when it is offered, and convert when it is not.
 */
function celsius(text: string | null): number | null {
  if (text === null) return null;
  const paren = /\((-?\d+(?:\.\d+)?)\s*(?:&#176;|&deg;|°)?\s*C\)/i.exec(text);
  if (paren) return Number(paren[1]);
  const value = firstNumber(text);
  if (value === null) return null;
  return /F/i.test(text) ? ((value - 32) * 5) / 9 : value;
}

/** Millibars from `29.94 in (1013.8 mb)`, or from a bare metric value. */
function millibars(text: string | null): number | null {
  if (text === null) return null;
  const paren = /\((-?\d+(?:\.\d+)?)\s*mb\)/i.exec(text);
  if (paren) return Number(paren[1]);
  return /\bmb\b/i.test(text) ? firstNumber(text) : null;
}

/** `21.954N 159.353W` out of the Location line. */
function located(item: string): GeoPoint | undefined {
  const hit = /(-?\d+(?:\.\d+)?)\s*([NS])\s+(-?\d+(?:\.\d+)?)\s*([EW])/i
    .exec(labelled(item, 'Location') ?? '');
  if (!hit) return undefined;
  const lat = Number(hit[1]) * (hit[2].toUpperCase() === 'S' ? -1 : 1);
  const lon = Number(hit[3]) * (hit[4].toUpperCase() === 'W' ? -1 : 1);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
}

/**
 * Station id and observation instant, from `NDBC-51208-20260829035600`.
 *
 * The trailing stamp is UTC. Falls back to the item's `pubDate` — the
 * feed's build time, close but not the same — and finally gives up,
 * because an observation with no time cannot be aged and an
 * unage-able observation must not be treated as fresh.
 */
function identity(item: string): { station: string; observedAt: number } | null {
  const guid = /<guid[^>]*>\s*NDBC-([A-Za-z0-9]+)-(\d{14})\s*<\/guid>/i.exec(item);
  if (guid) {
    const [, station, stamp] = guid;
    const at = Date.UTC(
      Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1,
      Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)),
      Number(stamp.slice(10, 12)), Number(stamp.slice(12, 14)),
    );
    if (Number.isFinite(at)) return { station: station.toUpperCase(), observedAt: at };
  }
  const loose = /<guid[^>]*>\s*NDBC-([A-Za-z0-9]+)-/i.exec(item);
  const published = /<pubDate>([^<]+)<\/pubDate>/i.exec(item);
  const at = published ? Date.parse(published[1]) : NaN;
  if (loose && Number.isFinite(at)) {
    return { station: loose[1].toUpperCase(), observedAt: at };
  }
  return null;
}

/**
 * The sea state from a wave station's feed, or null when the feed
 * carries no waves — which is the honest answer for a met station and
 * the only thing standing between us and a sea state of zeroes.
 */
export function parseSeaObservation(xml: string): SeaObservation | null {
  const item = itemOf(xml);
  if (!item) return null;
  const who = identity(item);
  if (!who) return null;
  const height = heightM(labelled(item, 'Significant Wave Height'));
  const dominant = firstNumber(labelled(item, 'Dominant Wave Period'));
  const average = firstNumber(labelled(item, 'Average Period'));
  const from = bearing(labelled(item, 'Mean Wave Direction'));
  // ALL FOUR OR NOTHING. A partial wave record is a sea state with a
  // hole in it, and every consumer downstream would have to invent
  // whatever was missing.
  if (height === null || dominant === null || average === null || from === null) {
    return null;
  }
  const temp = celsius(labelled(item, 'Water Temperature'));
  const at = located(item);
  return {
    station: who.station,
    observedAt: who.observedAt,
    significantWaveHeightM: height,
    dominantPeriodS: dominant,
    averagePeriodS: average,
    meanFromDeg: from,
    ...(temp === null ? {} : { waterTempC: temp }),
    ...(at ? { at } : {}),
  };
}

/**
 * The wind and water from any station's feed. A wave buoy will fill in
 * whatever met fields it also carries; a met station fills in most of
 * them and no waves.
 */
export function parseMetObservation(xml: string): MetObservation | null {
  const item = itemOf(xml);
  if (!item) return null;
  const who = identity(item);
  if (!who) return null;
  const speed = firstNumber(labelled(item, 'Wind Speed'));
  const gust = firstNumber(labelled(item, 'Wind Gust'));
  const from = bearing(labelled(item, 'Wind Direction'));
  const pressure = millibars(labelled(item, 'Atmospheric Pressure'));
  const temp = celsius(labelled(item, 'Water Temperature'));
  const at = located(item);
  return {
    station: who.station,
    observedAt: who.observedAt,
    ...(from === null ? {} : { windFromDeg: from }),
    ...(speed === null ? {} : { windSpeedMps: speed * KNOTS_TO_MPS }),
    ...(gust === null ? {} : { windGustMps: gust * KNOTS_TO_MPS }),
    ...(pressure === null ? {} : { pressureMb: pressure }),
    ...(temp === null ? {} : { waterTempC: temp }),
    ...(at ? { at } : {}),
  };
}
