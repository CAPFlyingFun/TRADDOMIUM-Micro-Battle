/**
 * The loading meter (src/assets/loadMeter.ts; Joshua, 2026-10-20: "15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)... an
 * estimated time remaining once there's enough data... distinguish between downloading and preparing... so it doesn't
 * show 100% before the room is actually usable... handle cached assets correctly").
 */
import { describe, expect, it } from 'vitest';
import { downloadLine, etaLine, formatPercent, LoadMeter, type LoadSnapshot } from '../src/assets/loadMeter';

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}
const MB = 1e6;

describe('the loading meter', () => {
  it("says Joshua's own example in his own words", () => {
    const s: LoadSnapshot = { label: '', phase: 'downloading', received: 15 * MB, total: 30 * MB, fraction: 0.5, bytesPerSecond: 1.2 * MB, etaSeconds: 12.5, cachedBytes: 0, error: null };
    expect(downloadLine(s)).toBe('15.0 MB / 30.0 MB (50.0% @ 1.2 MB/s)');
    expect(etaLine(s)).toBe('about 13 s left');
    expect(etaLine({ ...s, etaSeconds: 125 })).toBe('about 2 min 5 s left');
    expect(downloadLine({ ...s, total: null, fraction: null })).toBe('15.0 MB (1.2 MB/s)');
    expect(formatPercent(0.99999)).toBe('99.9%');
  });

  it('counts a batch of items against their expected total, then prepares, then is ready only when told', () => {
    const c = clock(), m = new LoadMeter(c.now);
    expect(m.snapshot().phase).toBe('idle');
    m.start('Opening');
    m.expect('body', 20 * MB); m.expect('shirt', 10 * MB);
    m.expect('body', 999); // a second expect changes nothing
    c.advance(1000); m.progress('body', 20 * MB);
    let s = m.snapshot();
    expect(s.total).toBe(30 * MB);
    expect(s.phase).toBe('downloading');
    expect(s.fraction).toBeCloseTo(2 / 3, 5);
    c.advance(1000); m.progress('shirt', 10 * MB);
    // every byte in, the phase is no longer downloading -- so 100% only ever shows beside "preparing"
    s = m.snapshot();
    expect(s.phase).toBe('preparing');
    expect(s.fraction).toBe(1);
    m.ready();
    expect(m.snapshot().phase).toBe('ready');
  });

  it('never shows 100% while still downloading', () => {
    const c = clock(), m = new LoadMeter(c.now);
    m.start('x'); m.expect('a', null); m.expect('b', 10);
    m.progress('b', 10);
    const s = m.snapshot();
    expect(s.phase).toBe('downloading'); // a's size is unknown and it is not done
    expect(s.total).toBeNull();
    expect(s.fraction).toBeNull(); // indeterminate, not a guess
    m.downloaded('a');
    expect(m.snapshot().phase).toBe('preparing');
  });

  it('measures speed over the last few seconds, and gives an ETA only once there is enough data', () => {
    const c = clock(), m = new LoadMeter(c.now);
    m.start('x'); m.expect('a', 10 * MB);
    for (let i = 0; i < 10; i++) { c.advance(100); m.progress('a', 0.1 * MB); } // 1 MB in 1 s
    let s = m.snapshot();
    expect(s.bytesPerSecond).toBeCloseTo(1 * MB, -4);
    expect(s.etaSeconds).toBeNull(); // only one second in
    for (let i = 0; i < 10; i++) { c.advance(100); m.progress('a', 0.1 * MB); }
    s = m.snapshot();
    expect(s.etaSeconds).not.toBeNull();
    expect(s.etaSeconds!).toBeGreaterThan(7);
    expect(s.etaSeconds!).toBeLessThan(9); // 8 MB left at 1 MB/s
    // a stall: after the window passes with nothing, there is no speed to quote
    c.advance(4000);
    expect(m.snapshot().bytesPerSecond).toBeNull();
  });

  it("counts the browser's cache as received but never as speed", () => {
    const c = clock(), m = new LoadMeter(c.now);
    m.start('x'); m.expect('shirt', 66 * MB);
    c.advance(50); m.progress('shirt', 66 * MB, 'part.bin'); m.cached('shirt', 'part.bin');
    const s = m.snapshot();
    expect(s.received).toBe(66 * MB);
    expect(s.cachedBytes).toBe(66 * MB);
    expect(s.bytesPerSecond).toBeNull(); // not a 1,320 MB/s connection
    expect(s.phase).toBe('preparing');
  });

  it('takes back what a failed attempt received, and drops a cancelled item', () => {
    const m = new LoadMeter(clock().now);
    m.start('x'); m.expect('a', 10); m.expect('b', 10);
    m.progress('a', 6); m.restart('a');
    expect(m.snapshot().received).toBe(0);
    m.drop('b'); m.progress('a', 10);
    expect(m.snapshot().phase).toBe('preparing');
    m.fail('no');
    expect(m.snapshot()).toMatchObject({ phase: 'failed', error: 'no' });
  });

  it('keeps an item still on its way when a new batch starts and wants it too', () => {
    const m = new LoadMeter(clock().now);
    m.start('first'); m.expect('leggings', 10); m.expect('shirt', 50);
    m.progress('leggings', 4);
    m.start('second');
    expect(m.snapshot().total).toBe(0); // nothing expected yet in this batch
    m.expect('leggings', 10);
    expect(m.snapshot()).toMatchObject({ received: 4, total: 10, label: 'second' });
  });
});
