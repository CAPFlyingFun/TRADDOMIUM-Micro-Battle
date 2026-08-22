import { afterEach, describe, expect, it, vi } from 'vitest';
import { pullBuffer, pullBytes } from '../src/world/fetchBytes';

/** A response that streams `body` in chunks, with the given headers. */
function served(body: Uint8Array, headers: Record<string, string>): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(control) {
      for (let at = 0; at < body.length; at += 64) {
        control.enqueue(body.slice(at, at + 64));
      }
      control.close();
    },
  });
  return new Response(stream, { status: 200, headers });
}

/**
 * Watch what a screen would actually have shown.
 *
 * Both callbacks land in ONE ordered log, because that is the thing
 * under test: at every moment the readout painted, was the count it had
 * larger than the total it had? Recording the two separately and
 * pairing them afterwards would be guessing at the order.
 */
function watch() {
  const log: Array<{ size?: number; done?: number }> = [];
  return {
    log,
    onSize: (n: number) => log.push({ size: n }),
    onBytes: (n: number) => log.push({ done: n }),
    /** The worst "1.8 MB / 1.7 MB" this would have printed. */
    get overshoot(): number {
      let total = 0;
      let worst = 0;
      for (const step of log) {
        if (step.size !== undefined) total = step.size;
        if (step.done !== undefined && total > 0) {
          worst = Math.max(worst, step.done - total);
        }
      }
      return worst;
    },
    /** The last size the readout was told. */
    get finalSize(): number {
      let total = 0;
      for (const step of log) if (step.size !== undefined) total = step.size;
      return total;
    },
    get finalDone(): number {
      let done = 0;
      for (const step of log) if (step.done !== undefined) done = step.done;
      return done;
    },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('pulling bytes with a progress readout', () => {
  it('reports the declared size and counts up to it', async () => {
    const body = new Uint8Array(500).fill(7);
    vi.stubGlobal('fetch', async () => served(body, { 'content-length': '500' }));
    const seen = watch();
    const buffer = await pullBuffer('/x.bin', seen.onSize, seen.onBytes);
    expect(buffer.byteLength).toBe(500);
    expect(seen.finalSize).toBe(500);
    expect(seen.finalDone).toBe(500);
    expect(seen.overshoot).toBe(0);
  });

  it('NEVER lets the count run past the total when the server gzips', async () => {
    // THE BUG JOSHUA PHOTOGRAPHED: "1.8 MB / 1.7 MB". Content-Length
    // counts the bytes on the WIRE, and a page host gzips a file of
    // 16-bit integers to about five sixths of its size — but the stream
    // hands over the DECOMPRESSED bytes, so the readout sailed past its
    // own maximum.
    const body = new Uint8Array(2000).fill(3);
    vi.stubGlobal('fetch', async () => served(body, {
      'content-length': '1700',
      'content-encoding': 'gzip',
    }));
    const seen = watch();
    await pullBuffer('/grid.bin', seen.onSize, seen.onBytes);
    expect(seen.overshoot).toBe(0);
    // And the size it settles on is the real one, not the wire count.
    expect(seen.finalSize).toBe(2000);
  });

  it('raises a declared size that turns out to be short', async () => {
    // No encoding header, but the length is wrong anyway — a proxy, a
    // rewrite, a lie. Same rule: the total moves, it is not exceeded.
    const body = new Uint8Array(900).fill(1);
    vi.stubGlobal('fetch', async () => served(body, { 'content-length': '400' }));
    const seen = watch();
    await pullBuffer('/x.bin', seen.onSize, seen.onBytes);
    expect(seen.overshoot).toBe(0);
    expect(seen.finalSize).toBe(900);
  });

  it('still says a size when the server declares none', async () => {
    const body = new Uint8Array(320).fill(9);
    vi.stubGlobal('fetch', async () => served(body, {}));
    const seen = watch();
    await pullBuffer('/x.bin', seen.onSize, seen.onBytes);
    expect(seen.finalSize).toBe(320);
    expect(seen.overshoot).toBe(0);
  });

  it('hands back the bytes in the right order, whatever the chunking', async () => {
    const body = new Uint8Array(300);
    for (let i = 0; i < body.length; i++) body[i] = i % 251;
    vi.stubGlobal('fetch', async () => served(body, { 'content-length': '300' }));
    const got = new Uint8Array(await pullBuffer('/x.bin', () => {}, () => {}));
    expect(Array.from(got)).toEqual(Array.from(body));
  });

  it('makes a blob URL of the same bytes for the loader path', async () => {
    const body = new Uint8Array(128).fill(5);
    vi.stubGlobal('fetch', async () => served(body, { 'content-length': '128' }));
    vi.stubGlobal('URL', Object.assign(Object.create(URL), {
      createObjectURL: () => 'blob:made-up',
      revokeObjectURL: () => {},
    }));
    const pull = await pullBytes('/x.jpg', () => {}, () => {});
    expect(pull.size).toBe(128);
    expect(pull.url).toBe('blob:made-up');
  });

  it('throws with the url and status when the fetch fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    await expect(pullBuffer('/gone.bin', () => {}, () => {}))
      .rejects.toThrow(/gone\.bin.*404/);
  });
});
