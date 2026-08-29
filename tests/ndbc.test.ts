/**
 * THE BUOY FEED, AGAINST THE REAL DOCUMENTS.
 *
 * Both fixtures are genuine NDBC RSS captured on 2026-08-29 — one wave
 * buoy and one met station — and the pair is the point: the parser has
 * to read the first and REFUSE the second, because a station with no
 * waves in it must not become a sea state full of zeroes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KNOTS_TO_MPS, parseMetObservation, parseSeaObservation } from '../src/weather/ndbc';

const WAVE = readFileSync('tests/fixtures/51208.rss', 'utf8');
const MET = readFileSync('tests/fixtures/nwwh1.rss', 'utf8');

describe('51208 — the Hanalei wave buoy', () => {
  const obs = parseSeaObservation(WAVE);

  it('reads every wave field the feed carries', () => {
    expect(obs).not.toBeNull();
    expect(obs!.station).toBe('51208');
    // 4.3 ft, converted at the boundary so nothing downstream guesses.
    expect(obs!.significantWaveHeightM).toBeCloseTo(4.3 * 0.3048, 6);
    expect(obs!.dominantPeriodS).toBe(6);
    expect(obs!.averagePeriodS).toBe(4.8);
    // The PARENTHESISED bearing, not the "E" that rounds it.
    expect(obs!.meanFromDeg).toBe(81);
    expect(obs!.waterTempC).toBeCloseTo(26.7, 6);
    expect(obs!.at).toEqual({ lat: 22.285, lon: -159.574 });
  });

  it('takes the instant from the guid, not the feed build time', () => {
    // guid NDBC-51208-20260829035600 = the observation, 03:56 UTC.
    // pubDate is 04:10:54 — fourteen minutes later, and not when the
    // buoy measured anything.
    expect(obs!.observedAt).toBe(Date.UTC(2026, 7, 29, 3, 56, 0));
    expect(obs!.observedAt).not.toBe(Date.parse('Sat, 29 Aug 2026 04:10:54 +0000'));
  });

  it('agrees with the human date line in the description', () => {
    // "August 28, 2026 5:56 pm HAST" — Hawaii is UTC-10 all year.
    expect(new Date(obs!.observedAt).toISOString()).toBe('2026-08-29T03:56:00.000Z');
  });

  it('also yields whatever met fields it carries', () => {
    const met = parseMetObservation(WAVE);
    expect(met!.station).toBe('51208');
    expect(met!.waterTempC).toBeCloseTo(26.7, 6);
    // No anemometer on this Waverider.
    expect(met!.windSpeedMps).toBeUndefined();
  });
});

describe('NWWH1 — the Nawiliwili met station', () => {
  it('is NOT a sea state, and says so', () => {
    // The whole reason this fixture is here: it has no waves, and a
    // parser that returned zeroes would hand the ocean a flat calm.
    expect(parseSeaObservation(MET)).toBeNull();
  });

  it('reads the wind, pressure and water it does carry', () => {
    const met = parseMetObservation(MET);
    expect(met).not.toBeNull();
    expect(met!.station).toBe('NWWH1');
    expect(met!.observedAt).toBe(Date.UTC(2026, 7, 29, 4, 0, 0));
    expect(met!.windFromDeg).toBe(50);
    expect(met!.windSpeedMps).toBeCloseTo(13.0 * KNOTS_TO_MPS, 6);
    expect(met!.windGustMps).toBeCloseTo(18.1 * KNOTS_TO_MPS, 6);
    expect(met!.pressureMb).toBeCloseTo(1013.8, 6);
    expect(met!.waterTempC).toBeCloseTo(28.1, 6);
    expect(met!.at).toEqual({ lat: 21.954, lon: -159.353 });
  });

  it('is four minutes after the buoy — two observations, not one', () => {
    const wave = parseSeaObservation(WAVE)!;
    const met = parseMetObservation(MET)!;
    expect(met.observedAt - wave.observedAt).toBe(4 * 60 * 1000);
  });
});

describe('feeds that are broken rather than merely empty', () => {
  it('refuses a document with no item', () => {
    expect(parseSeaObservation('<rss><channel></channel></rss>')).toBeNull();
    expect(parseMetObservation('<rss><channel></channel></rss>')).toBeNull();
  });

  it('refuses an item it cannot put a time on', () => {
    const noTime = WAVE.replace(/<guid[^>]*>[\s\S]*?<\/guid>/i, '')
      .replace(/<pubDate>[\s\S]*?<\/pubDate>/gi, '');
    expect(parseSeaObservation(noTime)).toBeNull();
  });

  it('refuses a partial wave record rather than inventing the rest', () => {
    const noPeriod = WAVE.replace(/<strong>Dominant Wave Period:[\s\S]*?<br \/>/i, '');
    expect(parseSeaObservation(noPeriod)).toBeNull();
  });

  it('treats NDBC\'s own MM as missing', () => {
    const missing = WAVE.replace('4.3 ft', 'MM');
    expect(parseSeaObservation(missing)).toBeNull();
  });

  it('reads a metric feed as happily as an imperial one', () => {
    const metric = WAVE.replace('4.3 ft', '1.3 m');
    expect(parseSeaObservation(metric)!.significantWaveHeightM).toBeCloseTo(1.3, 6);
  });
});
