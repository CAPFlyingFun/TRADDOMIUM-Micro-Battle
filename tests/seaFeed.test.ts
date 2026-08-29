/**
 * THE BUOY, WIRED UP — Stage F.
 *
 * Stage A could read a document. This is what happens when the
 * document has to arrive over a network that is sometimes not there,
 * sometimes slow, sometimes lying, and sometimes simply refused by the
 * browser — and when the answer, whenever it lands, must not be
 * allowed to change the ocean in one step.
 *
 *   ORDER      live, then cached, then a real fixture reading
 *   NEVER ZERO nothing missing may become a flat sea
 *   CACHE      the first frame already has yesterday's sea
 *   TTL        the feed's own thirty minutes, honoured
 *   BLEND      a new reading crossfades over minutes, continuously
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  NDBC_WAVE_STATION, NdbcFeed, ndbcFeedUrl, parseTtlMinutes,
} from '../src/weather/ndbcFeed';
import { SeaService } from '../src/weather/SeaService';
import { parseSeaObservation } from '../src/weather/ndbc';
import { SEA_CACHE_GOOD_MS, TYPICAL_SEA } from '../src/weather/seaState';
import {
  BLEND_SECONDS, blendToObservation, liveObservation, liveRegime, seaBlend,
  seaLine, settleSea, useFixedSea, useProceduralSea,
} from '../src/world/liveSea';
import {
  activeWaves, resetSwell, seaOrbitalAt, seaSwellAt, swellAmplitude, swellTime,
  tickSwell, waveTableVersion,
} from '../src/world/seaSwell';

const RSS = readFileSync('tests/fixtures/51208.rss', 'utf8');
const MET = readFileSync('tests/fixtures/nwwh1.rss', 'utf8');
const REAL = parseSeaObservation(RSS)!;
const DEEP = 10_000;

afterEach(() => { useFixedSea(); resetSwell(); });

/** A store that lives in memory, so a test can watch what was kept. */
function memoryStore() {
  const held = new Map<string, string>();
  return {
    held,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { held.set(k, v); },
  };
}

/** Let a then/catch/finally chain settle before looking at it. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** A provider that answers with whatever the test wants, when asked. */
function feedOf(reply: unknown, spy?: { calls: number }) {
  return {
    fetch: async () => { if (spy) spy.calls += 1; return reply as never; },
  };
}

describe('the feed', () => {
  it('asks the wave buoy, and says which one', () => {
    expect(NDBC_WAVE_STATION).toBe('51208');
    expect(ndbcFeedUrl('51208')).toBe(
      'https://www.ndbc.noaa.gov/data/latest_obs/51208.rss',
    );
    // Proxy-ready: one base to change, and nothing else.
    expect(ndbcFeedUrl('51208', 'https://example.test/ndbc/'))
      .toBe('https://example.test/ndbc/51208.rss');
  });

  it('honours the feed\'s own refresh hint', () => {
    // 51208 advertises thirty minutes, which is also how often the
    // buoy actually transmits.
    expect(parseTtlMinutes(RSS)).toBe(30);
    expect(parseTtlMinutes('<rss></rss>')).toBeNull();
  });

  it('carries the reason back when nothing arrives', async () => {
    const refused = new NdbcFeed({
      fetcher: (async () => { throw new TypeError('Failed to fetch'); }) as never,
    });
    const got = await refused.fetch('51208');
    expect(got.observation).toBeNull();
    // THE POINT OF THIS. A browser refused by CORS and a browser with
    // no network reject identically, and this string is the only place
    // the difference is ever visible — it is what puts the answer in
    // the telemetry line instead of in a guess.
    expect(got.failure).toContain('Failed to fetch');
  });

  it('reports an HTTP error as an HTTP error', async () => {
    const feed = new NdbcFeed({
      fetcher: (async () => ({ ok: false, status: 503 })) as never,
    });
    expect((await feed.fetch('51208')).failure).toBe('HTTP 503');
  });

  it('parses the real 51208 document into a sea', async () => {
    const feed = new NdbcFeed({
      fetcher: (async () => ({ ok: true, text: async () => RSS })) as never,
    });
    const got = await feed.fetch('51208');
    expect(got.observation?.station).toBe('51208');
    expect(got.observation?.significantWaveHeightM).toBeCloseTo(1.3, 1);
    expect(got.ttlMinutes).toBe(30);
  });

  it('refuses a met station standing in for a wave buoy', async () => {
    // NWWH1 reports wind, pressure and water temperature and no waves
    // at all. A 200 that carries no sea is not a sea.
    const feed = new NdbcFeed({
      fetcher: (async () => ({ ok: true, text: async () => MET })) as never,
    });
    const got = await feed.fetch('nwwh1');
    expect(got.observation).toBeNull();
    expect(got.failure).toContain('no wave observation');
  });
});

describe('the service — live, cached, fallback, in that order', () => {
  it('starts on the fallback with nothing stored, and says so', () => {
    const sea = new SeaService({ store: memoryStore(), live: feedOf({}) });
    expect(sea.observation).toBeNull();
    expect(sea.source).toBe('fallback');
    // …and the fallback is a REAL reading, not a flat calm.
    expect(TYPICAL_SEA.significantWaveHeightM).toBeGreaterThan(0.5);
  });

  it('has yesterday\'s sea before the first frame', async () => {
    const store = memoryStore();
    const now = REAL.observedAt + 60_000;
    const first = new SeaService({
      store, clock: () => now,
      live: feedOf({ observation: REAL, ttlMinutes: 30 }),
    });
    first.poll();
    await flush();
    expect(first.source).toBe('live');
    // A second session, started cold, with the network refusing.
    const later = new SeaService({
      store, clock: () => now + 60 * 60_000,
      live: feedOf({ observation: null, failure: 'TypeError: Failed to fetch' }),
    });
    expect(later.observation?.observedAt).toBe(REAL.observedAt);
    expect(later.source).toBe('cached');
  });

  it('drops a stored reading too old to speak for the sea', () => {
    const store = memoryStore();
    const now = REAL.observedAt;
    new SeaService({ store, clock: () => now, live: feedOf({}) })
      .accept(REAL, 'live');
    const stale = new SeaService({
      store, clock: () => now + SEA_CACHE_GOOD_MS + 60_000, live: feedOf({}),
    });
    expect(stale.observation).toBeNull();
    expect(stale.source).toBe('fallback');
  });

  it('keeps the last valid sea when the network fails', async () => {
    let now = REAL.observedAt;
    const sea = new SeaService({
      store: memoryStore(), clock: () => now,
      live: feedOf({ observation: null, failure: 'TypeError: Failed to fetch' }),
    });
    sea.accept(REAL, 'live');
    const before = sea.observation;
    now += 60 * 60_000;
    sea.poll();
    await flush();
    expect(sea.observation).toBe(before);
    expect(sea.state.failure).toContain('Failed to fetch');
  });

  it('keeps it when the document is malformed or partial, too', async () => {
    let now = REAL.observedAt;
    const sea = new SeaService({
      store: memoryStore(), clock: () => now,
      live: feedOf({ observation: null, failure: 'no wave observation in feed' }),
    });
    sea.accept(REAL, 'live');
    now += 60 * 60_000;
    sea.poll();
    await flush();
    expect(sea.observation?.significantWaveHeightM)
      .toBe(REAL.significantWaveHeightM);
  });

  it('does not hammer NOAA — the feed\'s TTL is the cadence', async () => {
    let now = REAL.observedAt;
    const spy = { calls: 0 };
    const sea = new SeaService({
      store: memoryStore(), clock: () => now,
      live: feedOf({ observation: REAL, ttlMinutes: 30 }, spy),
    });
    sea.poll();
    await flush();
    expect(spy.calls).toBe(1);
    for (let i = 0; i < 50; i++) sea.poll();       // a frame loop
    expect(spy.calls).toBe(1);
    now += 29 * 60_000;
    sea.poll();
    expect(spy.calls).toBe(1);
    now += 2 * 60_000;                             // past the half hour
    sea.poll();
    expect(spy.calls).toBe(2);
  });

  it('does not treat a republished reading as news', () => {
    const sea = new SeaService({ store: memoryStore(), live: feedOf({}) });
    sea.accept(REAL, 'live');
    const first = sea.version;
    sea.accept({ ...REAL }, 'live');
    // NDBC serves the same observation for the whole half hour between
    // transmissions; each one must not start a fresh transition.
    expect(sea.version).toBe(first);
    sea.accept({ ...REAL, observedAt: REAL.observedAt + 1_800_000 }, 'live');
    expect(sea.version).toBe(first + 1);
  });

  it('will not be dragged backwards by a stale document', () => {
    const sea = new SeaService({ store: memoryStore(), live: feedOf({}) });
    sea.accept(REAL, 'live');
    sea.accept({ ...REAL, observedAt: REAL.observedAt - 3_600_000 }, 'live');
    expect(sea.observation?.observedAt).toBe(REAL.observedAt);
  });
});

describe('a new reading does not make the Pacific change gears', () => {
  const NEXT = {
    ...REAL,
    observedAt: REAL.observedAt + 1_800_000,
    significantWaveHeightM: 2.4,      // a front arrives
    dominantPeriodS: 9.5,             // longer swell
    meanFromDeg: 310,                 // and from somewhere else
  };

  it('leaves the surface EXACTLY where it was at the first instant', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    tickSwell(37.5);
    const spots: [number, number][] = [[0, 0], [1234, -567], [-8000, 400]];
    const before = spots.map(([x, z]) => seaSwellAt(x, z, DEEP));
    const current = spots.map(([x, z]) => seaOrbitalAt(x, z, DEEP));
    blendToObservation(NEXT);
    tickSwell(0);
    // The arriving generation's crossfade is nought until the clock
    // passes this instant, so joining it is arithmetic no-op — which
    // is the whole reason the table may be swapped here at all.
    spots.forEach(([x, z], i) => {
      expect(seaSwellAt(x, z, DEEP)).toBeCloseTo(before[i], 9);
      expect(seaOrbitalAt(x, z, DEEP).x).toBeCloseTo(current[i].x, 9);
    });
  });

  it('and in the SHALLOWS too, where a step would actually show', () => {
    // THE ONE THAT NEEDED FIXING. The depth-limited breaking envelope
    // divides by how tall the sea says it can stand, and a table that
    // suddenly held two generations used to advertise the SUM of their
    // peaks — so the crest limit halved the instant a transition
    // began. In deep water that is a rounding error; in three metres
    // of water it was an eighteen per cent step in the wave height,
    // right where she floats and right where it is visible.
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    tickSwell(21);
    const shallows = [80, 150, 300, 600];
    const before = shallows.map((d) => seaSwellAt(1234, -567, d));
    blendToObservation(NEXT);
    tickSwell(0);
    shallows.forEach((d, i) => {
      expect(seaSwellAt(1234, -567, d)).toBeCloseTo(before[i], 9);
    });
    // …and the retirement at the other end is just as quiet.
    tickSwell(BLEND_SECONDS + 1);
    const closing = shallows.map((d) => seaSwellAt(1234, -567, d));
    settleSea();
    shallows.forEach((d, i) => {
      expect(seaSwellAt(1234, -567, d)).toBeCloseTo(closing[i], 9);
    });
  });

  it('never advertises a crest the two seas cannot reach', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    const alone = swellAmplitude();
    blendToObservation({ ...NEXT, significantWaveHeightM: REAL.significantWaveHeightM });
    // Equal at both ends, and in between the crossfade of the two —
    // never their sum, because neither is at full amplitude while the
    // other is.
    expect(swellAmplitude()).toBeCloseTo(alone, 6);
    tickSwell(BLEND_SECONDS / 2);
    // Well under the SUM the old arithmetic would have advertised.
    expect(swellAmplitude()).toBeLessThan(alone * 1.5);
    expect(swellAmplitude()).toBeGreaterThan(alone * 0.9);
    tickSwell(BLEND_SECONDS);
    // Past the end it is the incoming generation's own peak — a
    // different realisation of the same energy budget, so a different
    // number, and retiring the old one must not move it.
    const settledTo = swellAmplitude();
    settleSea();
    expect(swellAmplitude()).toBeCloseTo(settledTo, 6);
    expect(settledTo).toBeGreaterThan(alone * 0.6);
    expect(settledTo).toBeLessThan(alone * 1.6);
  });

  it('and exactly where it was at the last one, when the old is retired', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    tickSwell(10);
    blendToObservation(NEXT);
    tickSwell(BLEND_SECONDS + 1);
    const before = seaSwellAt(1234, -567, DEEP);
    expect(settleSea()).toBe(true);
    expect(seaSwellAt(1234, -567, DEEP)).toBeCloseTo(before, 9);
    // One generation again, and it is the new one.
    expect(liveObservation()?.observedAt).toBe(NEXT.observedAt);
  });

  it('crosses over without a step anywhere in between', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    tickSwell(5);
    blendToObservation(NEXT);
    let last = seaSwellAt(1234, -567, DEEP);
    let worst = 0;
    for (let i = 0; i < BLEND_SECONDS * 60 + 600; i++) {
      tickSwell(1 / 60);
      settleSea();
      const now = seaSwellAt(1234, -567, DEEP);
      worst = Math.max(worst, Math.abs(now - last));
      last = now;
    }
    // A metre-and-a-half sea moving at 60 Hz changes by a few units a
    // frame. A generation SWAP would show up here as a jump of tens.
    expect(worst).toBeLessThan(4);
  });

  it('takes minutes over it, and both seas run while it does', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    const alone = activeWaves().length;
    blendToObservation(NEXT);
    expect(activeWaves().length).toBe(alone * 2);
    expect(BLEND_SECONDS).toBeGreaterThanOrEqual(120);
    tickSwell(BLEND_SECONDS / 2);
    const half = seaBlend();
    expect(half?.t).toBeCloseTo(0.5, 2);
    tickSwell(BLEND_SECONDS);
    settleSea();
    expect(seaBlend()).toBeNull();
    expect(activeWaves().length).toBe(alone);
  });

  it('holds the sea\'s energy through the crossover', () => {
    // Equal power, not equal amplitude: faded linearly the variance
    // would dip by half in the middle and the sea would visibly go
    // slack and come back.
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    const rms = (): number => {
      let sum = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const y = seaSwellAt(i * 137.3, -i * 91.7, DEEP);
        sum += y * y;
      }
      return Math.sqrt(sum / n);
    };
    tickSwell(3);
    const opening = rms();
    blendToObservation({ ...NEXT, significantWaveHeightM: REAL.significantWaveHeightM });
    tickSwell(BLEND_SECONDS / 2);
    // Same budget either side, so the middle must match it too.
    expect(rms()).toBeGreaterThan(opening * 0.8);
    expect(rms()).toBeLessThan(opening * 1.25);
  });

  it('rebuilds the water twice per reading, not once per frame', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    const start = waveTableVersion();
    blendToObservation(NEXT);
    expect(waveTableVersion()).toBe(start + 1);
    for (let i = 0; i < 600; i++) { tickSwell(1 / 60); settleSea(); }
    expect(waveTableVersion()).toBe(start + 1);   // amplitude is a uniform
    tickSwell(BLEND_SECONDS);
    settleSea();
    expect(waveTableVersion()).toBe(start + 2);
    for (let i = 0; i < 600; i++) { tickSwell(1 / 60); settleSea(); }
    expect(waveTableVersion()).toBe(start + 2);
  });

  it('is deterministic — same readings, same ocean, every time', () => {
    const replay = () => {
      resetSwell();
      useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
      tickSwell(11);
      blendToObservation(NEXT);
      tickSwell(BLEND_SECONDS * 0.4);
      return [0, 500, -900].map((x) => seaSwellAt(x, x * 2, DEEP));
    };
    expect(replay()).toEqual(replay());
  });

  it('grows the new sea from the reading it was handed', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    blendToObservation(NEXT);
    const now = liveRegime()!;
    expect(now.significantHeightM).toBeCloseTo(2.4, 6);
    expect(now.dominantPeriodS).toBeCloseTo(9.5, 6);
    // MWD is the direction waves come FROM; TMB travels TOWARD.
    expect(now.towardDeg).toBeCloseTo(130, 6);
  });
});

describe('the telemetry line', () => {
  it('says which of the three it is, and what it is running on', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    const line = seaLine({
      source: 'live', station: '51208', observation: REAL, ageMs: 14 * 60_000,
    });
    expect(line).toContain('SEA LIVE 51208');
    expect(line).toContain('Hs 1.3m');
    expect(line).toContain('Tp 6.0s');
    expect(line).toContain('Ap 4.8s');
    expect(line).toContain('FROM 081');
    expect(line).toContain('-> 261');
    expect(line).toContain('age 14m');
  });

  it('names the failure, which is how the phone answers the CORS question', () => {
    resetSwell();
    useProceduralSea();
    const line = seaLine({
      source: 'fallback', station: '51208', observation: null, ageMs: null,
      failure: 'TypeError: Failed to fetch',
    });
    expect(line).toContain('SEA FALLBACK');
    expect(line).toContain('Failed to fetch');
    // And it still reports a sea, because there still IS one.
    expect(line).toContain('Hs 1.3m');
  });

  it('shows a transition while one is running', () => {
    resetSwell();
    useProceduralSea({ observation: REAL, nowMs: REAL.observedAt });
    blendToObservation({ ...REAL, observedAt: REAL.observedAt + 1_800_000 });
    tickSwell(BLEND_SECONDS / 2);
    expect(seaLine({
      source: 'live', station: '51208', observation: REAL, ageMs: 0,
    })).toContain('blend 50%');
    expect(swellTime()).toBeGreaterThan(0);
  });
});
