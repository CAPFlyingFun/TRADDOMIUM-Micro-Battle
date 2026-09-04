import { describe, expect, it } from 'vitest';
import { LoopbackTransport } from '../src/net/Transport';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('LoopbackTransport', () => {
  it('delivers a message sent on A to B, and not back to A', async () => {
    const [a, b] = LoopbackTransport.pair();
    await Promise.all([a.connect(), b.connect()]);
    expect(a.state).toBe('open');
    const gotB: unknown[] = [];
    const gotA: unknown[] = [];
    b.onMessage((m) => gotB.push(m));
    a.onMessage((m) => gotA.push(m));
    a.send({ kind: 'move', x: 1 });
    expect(gotB).toEqual([]); // never synchronous
    await flush();
    expect(gotB).toEqual([{ kind: 'move', x: 1 }]);
    expect(gotA).toEqual([]);
  });

  it('is bidirectional', async () => {
    const [a, b] = LoopbackTransport.pair();
    await Promise.all([a.connect(), b.connect()]);
    const gotA: unknown[] = [];
    a.onMessage((m) => gotA.push(m));
    b.send('hello');
    await flush();
    expect(gotA).toEqual(['hello']);
  });

  it('throws when sending while closed, and drops what a closed peer would not receive', async () => {
    const [a, b] = LoopbackTransport.pair();
    expect(() => a.send('x')).toThrow(/send while closed/);
    await a.connect();
    const gotB: unknown[] = [];
    b.onMessage((m) => gotB.push(m));
    a.send('lost');
    await flush();
    expect(gotB).toEqual([]);
    await b.connect();
    a.send('found');
    await flush();
    expect(gotB).toEqual(['found']);
  });

  it('unsubscribes handlers and stops delivery after disconnect', async () => {
    const [a, b] = LoopbackTransport.pair();
    await Promise.all([a.connect(), b.connect()]);
    const got: unknown[] = [];
    const off = b.onMessage((m) => got.push(m));
    off();
    a.send(1);
    await flush();
    expect(got).toEqual([]);
    b.onMessage((m) => got.push(m));
    b.disconnect();
    expect(b.state).toBe('closed');
    a.send(2);
    await flush();
    expect(got).toEqual([]);
  });
});
