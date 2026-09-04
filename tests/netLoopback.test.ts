/**
 * The modelled wire: latency, jitter and loss applied per message on a
 * clock the test owns, delivered in order when pumped, with a hang-up
 * that travels the wire behind what was sent before it. The Phase 0
 * microtask pair keeps working beside it (tests/loopbackTransport.test.ts
 * still covers that path; here only what was added to it).
 */
import { describe, expect, it } from 'vitest';
import { LoopbackTransport, loopbackLink } from '../src/net/LoopbackTransport';
import { delayFor, loses, networkConditions, perfectConditions } from '../src/net/NetworkConditions';
import { seededRandom } from '../src/net/seededRandom';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A link on a clock the test moves by hand. */
function rig(conditions = perfectConditions(), seed = 1) {
  const clock = { now: 0 };
  const link = loopbackLink(() => clock.now, conditions, seededRandom(seed));
  const [a, b] = LoopbackTransport.pair(link);
  return { clock, link, a, b };
}

describe('seededRandom', () => {
  it('yields the same sequence for the same seed, every value in [0, 1)', () => {
    const first = seededRandom(42);
    const second = seededRandom(42);
    const other = seededRandom(43);
    const run = (r: () => number): number[] => Array.from({ length: 100 }, () => r());
    const a = run(first);
    expect(run(second)).toEqual(a);
    expect(run(other)).not.toEqual(a);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(new Set(a).size).toBeGreaterThan(90);
  });
});

describe('NetworkConditions', () => {
  it('clamps every dial into its range and treats non-numbers as off', () => {
    expect(networkConditions({})).toEqual({ latencyMs: 0, jitterMs: 0, dropRate: 0 });
    expect(networkConditions({ latencyMs: -5, jitterMs: Number.NaN, dropRate: 1.3 })).toEqual({
      latencyMs: 0, jitterMs: 0, dropRate: 1,
    });
    expect(networkConditions({ latencyMs: 200, jitterMs: 40, dropRate: 0.3 })).toEqual({ latencyMs: 200, jitterMs: 40, dropRate: 0.3 });
  });

  it('draws from the generator only when a dial makes the draw matter', () => {
    let draws = 0;
    const random = (): number => {
      draws += 1;
      return 0.5;
    };
    expect(delayFor({ latencyMs: 100, jitterMs: 0, dropRate: 0 }, random)).toBe(100);
    expect(loses({ latencyMs: 100, jitterMs: 0, dropRate: 0 }, random)).toBe(false);
    expect(draws).toBe(0);
    expect(delayFor({ latencyMs: 100, jitterMs: 40, dropRate: 0 }, random)).toBe(120);
    expect(loses({ latencyMs: 0, jitterMs: 0, dropRate: 0.6 }, random)).toBe(true);
    expect(loses({ latencyMs: 0, jitterMs: 0, dropRate: 0.4 }, random)).toBe(false);
    expect(draws).toBe(3);
  });

  it('perfectConditions() is a fresh object each time, so nobody shares dials by accident', () => {
    const one = perfectConditions();
    const two = perfectConditions();
    one.latencyMs = 500;
    expect(two.latencyMs).toBe(0);
  });
});

describe('LoopbackTransport on the Phase 0 microtask pair', () => {
  it('tells the far end it hung up, behind what it sent first, without closing the far end', async () => {
    const [a, b] = LoopbackTransport.pair();
    await Promise.all([a.connect(), b.connect()]);
    const events: unknown[] = [];
    b.onMessage((m) => events.push(m));
    b.onClose(() => events.push('closed'));
    a.send('bye');
    a.disconnect();
    expect(events).toEqual([]);
    await flush();
    expect(events).toEqual(['bye', 'closed']);
    expect(b.state).toBe('open');
    expect(a.conditions).toBeNull();
    expect(a.pump(1e9)).toBe(0);
  });

  it('fires its own close handlers once, and not again on a second disconnect', async () => {
    const [a] = LoopbackTransport.pair();
    await a.connect();
    let closes = 0;
    const off = a.onClose(() => {
      closes += 1;
    });
    a.disconnect();
    a.disconnect();
    expect(closes).toBe(1);
    off();
    await a.connect();
    a.disconnect();
    expect(closes).toBe(1);
  });
});

describe('LoopbackTransport on a modelled wire', () => {
  it('delivers nothing until pumped, then exactly when latency has elapsed, in order', async () => {
    const { clock, a, b } = rig(networkConditions({ latencyMs: 100 }));
    await Promise.all([a.connect(), b.connect()]);
    const got: unknown[] = [];
    b.onMessage((m) => got.push(m));
    a.send('one');
    clock.now = 10;
    a.send('two');
    await flush();
    expect(got).toEqual([]);
    expect(b.queued).toBe(2);
    expect(b.pump(99)).toBe(0);
    expect(b.pump(100)).toBe(1);
    expect(got).toEqual(['one']);
    expect(b.pump(109)).toBe(0);
    expect(b.pump(110)).toBe(1);
    expect(got).toEqual(['one', 'two']);
    expect(b.queued).toBe(0);
  });

  it('keeps send order under 200 ms latency and 40 ms jitter, every delay inside [200, 240)', async () => {
    const { clock, a, b } = rig(networkConditions({ latencyMs: 200, jitterMs: 40 }));
    await Promise.all([a.connect(), b.connect()]);
    const sentAt = new Map<number, number>();
    const arrived: { msg: number; at: number }[] = [];
    b.onMessage((m) => arrived.push({ msg: m as number, at: clock.now }));
    let next = 0;
    for (let t = 0; t <= 2000; t += 1) {
      clock.now = t;
      if (t % 16 === 0 && next < 50) {
        sentAt.set(next, t);
        a.send(next);
        next += 1;
      }
      b.pump(t);
    }
    expect(arrived.map((e) => e.msg)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    const delays = arrived.map((e) => e.at - (sentAt.get(e.msg) ?? 0));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(200);
      expect(d).toBeLessThan(241); // the pump runs at whole milliseconds
    }
    expect(new Set(delays).size).toBeGreaterThan(5); // jitter actually varied the delay
  });

  it('loses messages at the drop rate, the same ones on every run with the same seed', async () => {
    const survivors = async (seed: number): Promise<number[]> => {
      const { clock, a, b } = rig(networkConditions({ latencyMs: 10, dropRate: 0.3 }), seed);
      await Promise.all([a.connect(), b.connect()]);
      const got: number[] = [];
      b.onMessage((m) => got.push(m as number));
      for (let i = 0; i < 1000; i += 1) a.send(i);
      clock.now = 10;
      b.pump(10);
      return got;
    };
    const first = await survivors(9);
    const again = await survivors(9);
    const other = await survivors(10);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    expect(first.length).toBeGreaterThan(650);
    expect(first.length).toBeLessThan(750);
    // Order survives loss: what arrives arrives in the order it was sent.
    for (let i = 1; i < first.length; i += 1) expect(first[i]).toBeGreaterThan(first[i - 1] ?? -1);
  });

  it('never loses a hang-up, and delivers it behind what was sent before it', async () => {
    const { a, b } = rig(networkConditions({ latencyMs: 50, dropRate: 1 }));
    await Promise.all([a.connect(), b.connect()]);
    const events: unknown[] = [];
    b.onMessage((m) => events.push(m));
    b.onClose(() => events.push('closed'));
    a.send('lost');
    expect(b.queued).toBe(0); // dropRate 1: every message is lost
    a.disconnect();
    expect(b.queued).toBe(1); // but not the hang-up
    b.pump(49);
    expect(events).toEqual([]);
    b.pump(50);
    expect(events).toEqual(['closed']);
    expect(b.state).toBe('open');
  });

  it('orders a hang-up behind the messages sent before it, even when jitter would have let it overtake', async () => {
    const { clock, a, b } = rig({ latencyMs: 100, jitterMs: 100, dropRate: 0 }, 3);
    await Promise.all([a.connect(), b.connect()]);
    const events: unknown[] = [];
    b.onMessage((m) => events.push(m));
    b.onClose(() => events.push('closed'));
    for (let i = 0; i < 20; i += 1) a.send(i);
    a.disconnect();
    clock.now = 1000;
    b.pump(1000);
    expect(events).toEqual([...Array.from({ length: 20 }, (_, i) => i), 'closed']);
  });

  it('discards what was on the wire towards an end that disconnects, and drops sends to a closed peer', async () => {
    const { a, b } = rig(networkConditions({ latencyMs: 10 }));
    await Promise.all([a.connect(), b.connect()]);
    const got: unknown[] = [];
    b.onMessage((m) => got.push(m));
    a.send('in flight');
    expect(b.queued).toBe(1);
    b.disconnect();
    expect(b.queued).toBe(0);
    expect(b.pump(1e9)).toBe(0);
    expect(got).toEqual([]);
    a.send('to nobody'); // does not throw: a is still open, the peer is not
    expect(b.queued).toBe(0);
    await b.connect();
    a.send('found');
    b.pump(1e9);
    expect(got).toEqual(['found']);
  });

  it('shares one conditions object between both ends and reads it on every send', async () => {
    const { clock, link, a, b } = rig();
    await Promise.all([a.connect(), b.connect()]);
    expect(a.conditions).toBe(link.conditions);
    expect(b.conditions).toBe(link.conditions);
    const gotA: unknown[] = [];
    const gotB: unknown[] = [];
    a.onMessage((m) => gotA.push(m));
    b.onMessage((m) => gotB.push(m));
    a.send('fast');
    b.send('fast back');
    link.conditions.latencyMs = 300;
    a.send('slow');
    b.send('slow back');
    clock.now = 0;
    a.pump(0);
    b.pump(0);
    expect(gotB).toEqual(['fast']);
    expect(gotA).toEqual(['fast back']);
    clock.now = 300;
    a.pump(300);
    b.pump(300);
    expect(gotB).toEqual(['fast', 'slow']);
    expect(gotA).toEqual(['fast back', 'slow back']);
  });
});
