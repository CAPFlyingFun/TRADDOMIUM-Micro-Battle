/**
 * A PNG READER, SHARED BY THE PROBES THAT LOOK AT PIXELS.
 *
 * Playwright's screenshots are 8-bit and non-interlaced, and depending on
 * what is on screen they arrive as RGBA or as RGB — which is exactly the
 * trap that made this a shared file. `probe-ocean.mjs` was written with
 * its own copy that handled only RGBA, and the first frame it took of the
 * sea came back RGB and threw. Two readers is two answers; anything else
 * throws here rather than guessing.
 *
 * Node brings the zlib, so what is left is walking the IDAT bytes and
 * undoing the five filters — thirty lines, against adding a package to
 * the build for a probe.
 *
 * Not wired to a package.json script: it is a module the probes import,
 * and it is listed in scripts/MANUAL.md for that reason.
 */
import { inflateSync } from 'node:zlib';

export function readPng(buffer) {
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  const idat = [];
  let at = 8; // the signature
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colourType = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNG: this reader does not handle one');
    } else if (type === 'IDAT') idat.push(Buffer.from(body));
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (bitDepth !== 8 || (colourType !== 6 && colourType !== 2)) {
    throw new Error(`PNG is depth ${bitDepth} type ${colourType}; this reader handles 8-bit RGB/RGBA`);
  }
  const channels = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 0xff;
    }
    prev = row;
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = row[from];
      out[to + 1] = row[from + 1];
      out[to + 2] = row[from + 2];
      out[to + 3] = channels === 4 ? row[from + 3] : 255;
    }
  }
  return { width, height, data: out };
}
