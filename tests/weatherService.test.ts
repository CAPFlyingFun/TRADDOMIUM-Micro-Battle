import { describe, expect, it } from 'vitest';
import {
  CACHE_GOOD_MS, REFRESH_MS, WeatherService,
} from '../src/weather/WeatherService';
import { STATIONS } from '../src/weather/stations';
import { TYPICAL, type Conditions, type WeatherProvider } from '../src/weather/conditions';
import type { GeoPoint } from '../src/world/geo';
import { world } from '../src/world/coords';

class FakeStore {
  private held = new Map<string, string>();
  getItem(key: string) { return this.held.get(key) ?? null; }
  setItem(key: string, value: string) { this.held.set(key, value); }
  get size() { return this.held.size; }
}

class Stub implements WeatherProvider {
  readonly id = 'stub';
  calls = 0;
  constructor(private readonly answer: (i: number) => Conditions | null) {}
  async fetch(points: readonly GeoPoint[]): Promise<readonly Conditions[]> {
    this.calls += 1;
    const out: Conditions[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const one = this.answer(i);
      if (one === null) throw new Error('the network is a lie');
      out.push(one);
    }
    return out;
  }
}

/** Let the queued promise callbacks run. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const somewhere = world(STATIONS[0].at.wx, STATIONS[0].at.wz);

describe('the weather service', () => {
  it('has weather before it has asked anyone', () => {
    const service = new WeatherService({
      live: new Stub(() => TYPICAL), clock: () => 0, store: null,
    });
    expect(service.field.empty).toBe(false);
    expect(service.source).toBe('simulated');
    expect(() => service.peek(somewhere)).not.toThrow();
  });

  it('goes live once the readings land', async () => {
    const live = new Stub(() => ({ ...TYPICAL, cloud: 88, rain: 3 }));
    const service = new WeatherService({ live, clock: () => 0, store: null });
    service.poll();
    await settle();
    expect(service.source).toBe('live');
    expect(service.peek(somewhere).cloud).toBeCloseTo(88, 6);
  });

  /** The acceptance criterion that matters most: it cannot stop a boot. */
  it('stays playable when the weather service is down', async () => {
    const dead = new Stub(() => null);
    const service = new WeatherService({ live: dead, clock: () => 0, store: null });
    service.poll();
    await settle();
    expect(service.source).toBe('simulated');
    const game = service.update(somewhere, 1 / 60);
    expect(Number.isFinite(game.windStrength)).toBe(true);
    expect(Number.isFinite(game.sight)).toBe(true);
  });

  it('does not hammer the service', async () => {
    let now = 0;
    const live = new Stub(() => TYPICAL);
    const service = new WeatherService({ live, clock: () => now, store: null });

    for (let i = 0; i < 500; i += 1) {
      service.update(somewhere, 1 / 60);
      now += 100; // fifty seconds of frames
    }
    await settle();
    expect(live.calls).toBe(1);

    now += REFRESH_MS;
    service.update(somewhere, 1 / 60);
    await settle();
    expect(live.calls).toBe(2);
  });

  it('tries again sooner after a failure than after a success', async () => {
    let now = 0;
    let fail = true;
    const live = new Stub(() => (fail ? null : TYPICAL));
    const service = new WeatherService({ live, clock: () => now, store: null });
    service.poll();
    await settle();
    expect(live.calls).toBe(1);

    fail = false;
    now += 2 * 60 * 1000; // two minutes, well short of a refresh
    service.poll();
    await settle();
    expect(live.calls).toBe(2);
    expect(service.source).toBe('live');
  });

  it('keeps the last live reading for the next launch', async () => {
    const store = new FakeStore();
    let now = 1_000_000;
    const live = new Stub(() => ({ ...TYPICAL, cloud: 12, rain: 0.5 }));
    const first = new WeatherService({ live, clock: () => now, store });
    first.poll();
    await settle();
    expect(store.size).toBe(1);

    // Next launch, ten minutes later, with the network gone.
    now += 10 * 60 * 1000;
    const dead = new Stub(() => null);
    const second = new WeatherService({ live: dead, clock: () => now, store });
    expect(second.source).toBe('cached');
    expect(second.peek(somewhere).cloud).toBeCloseTo(12, 6);
  });

  it('will not pass off a stale reading as the weather', async () => {
    const store = new FakeStore();
    let now = 0;
    const live = new Stub(() => ({ ...TYPICAL, cloud: 12 }));
    const first = new WeatherService({ live, clock: () => now, store });
    first.poll();
    await settle();

    now += CACHE_GOOD_MS + 1;
    const second = new WeatherService({
      live: new Stub(() => null), clock: () => now, store,
    });
    expect(second.source).toBe('simulated');
  });

  it('matches a cached reading to its station by name, not by position', async () => {
    const store = new FakeStore();
    // A cache written by a build whose grid was in a different order.
    store.setItem('traddomium.weather', JSON.stringify({
      taken: 0,
      ids: [STATIONS[3].id, 'a-station-that-was-removed', STATIONS[0].id],
      conditions: [
        { ...TYPICAL, cloud: 30 },
        { ...TYPICAL, cloud: 40 },
        { ...TYPICAL, cloud: 50 },
      ],
    }));
    const service = new WeatherService({
      live: new Stub(() => null), clock: () => 1000, store,
    });
    expect(service.source).toBe('cached');
    expect(service.field.samples).toHaveLength(2);
    const byId = new Map(service.field.samples.map((s) => [s.id, s.conditions.cloud]));
    expect(byId.get(STATIONS[0].id)).toBeCloseTo(50, 6);
    expect(byId.get(STATIONS[3].id)).toBeCloseTo(30, 6);
  });

  it('shrugs off a cache full of rubbish', () => {
    for (const rubbish of ['', 'not json', '[]', '{}', 'null', '{"taken":"soon"}']) {
      const store = new FakeStore();
      store.setItem('traddomium.weather', rubbish);
      const service = new WeatherService({
        live: new Stub(() => null), clock: () => 0, store,
      });
      expect(service.field.empty).toBe(false);
      expect(service.source).toBe('simulated');
    }
  });

  it('works in a private window with no storage at all', () => {
    const blocked = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    const service = new WeatherService({
      live: new Stub(() => TYPICAL), clock: () => 0, store: blocked,
    });
    expect(service.field.empty).toBe(false);
    expect(() => service.update(somewhere, 1 / 60)).not.toThrow();
  });

  it('stops asking when the player picks the offline model', async () => {
    const live = new Stub(() => TYPICAL);
    const service = new WeatherService({ live, clock: () => 0, store: null });
    service.setMode('simulated');
    for (let i = 0; i < 50; i += 1) service.update(somewhere, 1 / 60);
    await settle();
    expect(live.calls).toBe(0);
    expect(service.source).toBe('simulated');
    expect(service.using).toBe('simulated');
  });

  it('spawns her already in the weather', () => {
    const service = new WeatherService({
      live: new Stub(() => TYPICAL), clock: () => 0, store: null,
    });
    const arrival = service.settleAt(somewhere);
    const next = service.update(somewhere, 1 / 60);
    expect(next.cloudiness).toBeCloseTo(arrival.cloudiness, 6);
  });

  it('gives two ends of the island two different weathers', () => {
    const service = new WeatherService({
      live: new Stub(() => TYPICAL), clock: () => 6 * 3_600_000, store: null,
    });
    const summit = service.peek(
      STATIONS.find((s) => s.id === 'waialeale')!.at,
    );
    const lee = service.peek(STATIONS.find((s) => s.id === 'kekaha')!.at);
    expect(summit.cloud).toBeGreaterThan(lee.cloud + 15);
  });
});
