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
export async function pullBytes(
  url: string,
  onSize: (bytes: number) => void,
  onBytes: (bytes: number) => void,
): Promise<Pull> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} — ${response.status}`);

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > 0) onSize(declared);

  // No stream to read (an old browser, or a response with no body) —
  // take the whole thing and report it as one arrival. The bar still
  // moves, it just moves in one step for this file.
  if (!response.body) {
    const whole = await response.blob();
    onSize(whole.size);
    onBytes(whole.size);
    return { size: whole.size, url: URL.createObjectURL(whole) };
  }

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.byteLength;
    onBytes(got);
  }
  // A server that did not declare a length still knows one now.
  if (declared <= 0) onSize(got);

  const type = response.headers.get('content-type') ?? 'application/octet-stream';
  const blob = new Blob(parts as BlobPart[], { type });
  return { size: got, url: URL.createObjectURL(blob) };
}
