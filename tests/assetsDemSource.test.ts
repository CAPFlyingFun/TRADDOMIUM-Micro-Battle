/**
 * THE DOWNLOAD, AND THE TWO WAYS IT GOES WRONG IN THE FIELD.
 *
 *  1. THE WRONG FILE. The DEM is headerless, so a byte length is the only
 *     integrity check that exists. A truncated or misrouted response must
 *     fail with the URL in the message and must NOT be retried — the same
 *     server will send the same wrong file again, and three retries only
 *     delay the error by 3.5 seconds.
 *  2. THE FLAKY CONNECTION. A dropped socket must be retried, because a
 *     phone on cell data drops sockets and the alternative is a world
 *     that refuses to load.
 *
 * And the one that only breaks in production: the URL goes through
 * `assetUrl`, because the deployed build lives under
 * `/TRADDOMIUM-Micro-Battle/v1/` and an absolute path is a 404 on the
 * only build anybody plays.
 */
import { describe, expect, it, vi } from 'vitest';
import { COARSE_BYTES, HD_TILE_BYTES, hdTileFromName } from '../src/world/dem';
import {
  COARSE_PATH, WrongSizeError, fetchCoarseDem, fetchExactly, fetchHdTile, hdTilePath,
} from '../src/assets/demSource';
import { assetUrl } from '../src/assets/assets';

/** A response carrying exactly `bytes` bytes, streamed in `chunks` pieces. */
function bodyOf(bytes: number, chunks = 1, contentLength: number | null = bytes): Response {
  const size = Math.ceil(bytes / chunks);
  let sent = 0;
  const stream = {
    getReader() {
      return {
        read: async (): Promise<{ done: boolean; value?: Uint8Array }> => {
          if (sent >= bytes) return { done: true };
          const take = Math.min(size, bytes - sent);
          sent += take;
          return { done: false, value: new Uint8Array(take) };
        },
      };
    },
  };
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k === 'content-length' && contentLength !== null ? String(contentLength) : null) },
    body: stream,
    arrayBuffer: async () => new ArrayBuffer(bytes),
  } as unknown as Response;
}

const tileA1 = hdTileFromName('A1');
if (!tileA1) throw new Error('A1 must parse');

describe('where it asks for the survey', () => {
  it('goes through the asset base rather than an absolute path', async () => {
    const fetchImpl = vi.fn(async (_url: string) => bodyOf(COARSE_BYTES));
    await fetchCoarseDem({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const url = fetchImpl.mock.calls[0][0];
    // Not "contains the filename" — the whole URL must be the one the
    // asset base built, which is what makes it right under /v1/ on Pages.
    // (Under vitest the base is `/`; on the deployed build it is not.)
    expect(url).toBe(assetUrl(COARSE_PATH));
  });

  it('names a tile by its own file', () => {
    expect(hdTilePath(tileA1)).toBe('kauai-hd/A1.bin');
  });

  it('asks for exactly the tile size', async () => {
    const fetchImpl = vi.fn(async () => bodyOf(HD_TILE_BYTES));
    const buffer = await fetchHdTile(tileA1, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(buffer.byteLength).toBe(HD_TILE_BYTES);
  });
});

describe('when the file is not the file', () => {
  it('refuses a short response, and says which URL and by how much', async () => {
    const fetchImpl = vi.fn(async () => bodyOf(COARSE_BYTES - 16));
    await expect(fetchCoarseDem({ fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(WrongSizeError);
    // NOT retried: the same server sends the same wrong file.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a long one too', async () => {
    const fetchImpl = vi.fn(async () => bodyOf(COARSE_BYTES + 2));
    await expect(fetchCoarseDem({ fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/should be exactly/);
  });
});

describe('when the connection is not the connection', () => {
  it('retries a dropped socket and succeeds on a later attempt', async () => {
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt < 3) throw new Error('network down');
      return bodyOf(HD_TILE_BYTES);
    });
    const buffer = await fetchHdTile(tileA1, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 3,
    });
    expect(buffer.byteLength).toBe(HD_TILE_BYTES);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('gives up with the URL in the message rather than hanging', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(fetchExactly('kauai-1025.bin', COARSE_BYTES, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    })).rejects.toThrow(/kauai-1025\.bin could not be fetched/);
  });

  it('treats a non-200 as a failure, not as a file', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 } as Response));
    await expect(fetchExactly('nope.bin', 4, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    })).rejects.toThrow(/could not be fetched/);
  });
});

describe('the progress it reports', () => {
  it('is bytes that actually landed, against the length the server promised', async () => {
    const seen: [number, number | null][] = [];
    await fetchExactly('kauai-hd/A1.bin', HD_TILE_BYTES, {
      fetchImpl: (async () => bodyOf(HD_TILE_BYTES, 4)) as unknown as typeof fetch,
      onBytes: (received, total) => seen.push([received, total]),
    });
    expect(seen).toHaveLength(4);
    expect(seen[seen.length - 1]).toEqual([HD_TILE_BYTES, HD_TILE_BYTES]);
    // Monotonic: a bar driven by this cannot run backwards.
    for (let i = 1; i < seen.length; i += 1) expect(seen[i][0]).toBeGreaterThan(seen[i - 1][0]);
  });

  it('withholds the total when the server did not send one, rather than inventing it', async () => {
    const seen: (number | null)[] = [];
    await fetchExactly('kauai-hd/A1.bin', HD_TILE_BYTES, {
      fetchImpl: (async () => bodyOf(HD_TILE_BYTES, 2, null)) as unknown as typeof fetch,
      onBytes: (_received, total) => seen.push(total),
    });
    expect(seen).toEqual([null, null]);
  });

  it('still downloads when the response cannot be streamed at all', async () => {
    const noStream = {
      ok: true,
      status: 200,
      headers: { get: () => String(HD_TILE_BYTES) },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(HD_TILE_BYTES),
    } as unknown as Response;
    const seen: number[] = [];
    const buffer = await fetchExactly('kauai-hd/A1.bin', HD_TILE_BYTES, {
      fetchImpl: (async () => noStream) as unknown as typeof fetch,
      onBytes: (received) => seen.push(received),
    });
    expect(buffer.byteLength).toBe(HD_TILE_BYTES);
    expect(seen).toEqual([HD_TILE_BYTES]);
  });
});
