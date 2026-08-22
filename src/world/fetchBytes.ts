/**
 * A DOWNLOAD YOU CAN WATCH.
 *
 * three's `TextureLoader` hands its work to an `<img>` element, and an
 * image element reports nothing at all until it is finished — no size,
 * no progress, no rate. That is fine when nobody is watching and
 * useless when a loading screen has promised the player a byte count.
 *
 * So the bytes are pulled here instead, through `fetch`, where the
 * response headers give the size before the body starts and the stream
 * gives every chunk on the way. What comes out is a blob URL, which the
 * existing loader consumes exactly as it consumed the original path —
 * everything downstream of this (colour space, wrapping, anisotropy,
 * the average-colour measurement) is untouched.
 */

export interface Pull {
  /** Total bytes, from Content-Length. Zero when the server won't say. */
  readonly size: number;
  /** An object URL for the fetched bytes. Revoke it when done. */
  readonly url: string;
}

/**
 * Fetch a file, reporting bytes as they arrive.
 *
 * @param url what to fetch
 * @param onSize called once, as soon as the size is known
 * @param onBytes called repeatedly with the running total
 */
async function pullParts(
  url: string,
  onSize: (bytes: number) => void,
  onBytes: (bytes: number) => void,
): Promise<{ parts: Uint8Array[]; size: number; type: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — ${response.status}`);

  // `Content-Length` counts what came down the WIRE. When the server
  // compresses on the way, the stream below yields the DECOMPRESSED
  // bytes, and there is no header that says how many of those there
  // will be — so a readout built on it counts past its own maximum. It
  // is right for the images and the model, which are already
  // compressed formats no server bothers to gzip; anything that does
  // get gzipped should pass its own known size instead (see loadGrid).
  // Either way the guard below means `done` can never exceed `total`.
  const encoded = Boolean(response.headers.get('content-encoding'));
  let declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > 0 && !encoded) onSize(declared);
  else declared = 0;
  const type = response.headers.get('content-type') ?? 'application/octet-stream';

  // No stream to read (an old browser, or a response with no body) —
  // take the whole thing and report it as one arrival. The bar still
  // moves, it just moves in one step for this file.
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    onSize(whole.byteLength);
    onBytes(whole.byteLength);
    return { parts: [whole], size: whole.byteLength, type };
  }

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    // Never report past the total. A declared length that turns out to
    // be short — compression, a truncated header, a proxy rewriting
    // things — must move, not be exceeded.
    if (declared > 0 && got > declared) {
      declared = got;
      onSize(declared);
    }
    onBytes(got);
  }
  // A server that did not declare a length still knows one now.
  if (declared <= 0) onSize(got);
  return { parts, size: got, type };
}

/**
 * Fetch a file, reporting bytes as they arrive, as a blob URL.
 *
 * @param url what to fetch
 * @param onSize called once, as soon as the size is known
 * @param onBytes called repeatedly with the running total
 */
export async function pullBytes(
  url: string,
  onSize: (bytes: number) => void,
  onBytes: (bytes: number) => void,
): Promise<Pull> {
  const { parts, size, type } = await pullParts(url, onSize, onBytes);
  return { size, url: URL.createObjectURL(new Blob(parts as BlobPart[], { type })) };
}

/** The same, for something that wants the bytes rather than a URL. */
export async function pullBuffer(
  url: string,
  onSize: (bytes: number) => void,
  onBytes: (bytes: number) => void,
): Promise<ArrayBuffer> {
  const { parts, size } = await pullParts(url, onSize, onBytes);
  const whole = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.byteLength;
  }
  return whole.buffer;
}
