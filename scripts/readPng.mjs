/**
 * Decode a PNG to raw RGBA, so a probe can measure what was DRAWN.
 *
 * Reading pixels back out of the WebGL canvas in the page does not
 * work: without `preserveDrawingBuffer` the buffer is gone the moment
 * it has been composited, and `drawImage` of it yields solid black.
 * Every colour check written that way silently measures nothing and
 * passes — which is exactly what happened while a hole sat in frame.
 *
 * Playwright's screenshot captures the composited page instead, so the
 * honest way to measure a render is to screenshot it and decode that.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPng(path) {
  const file = readFileSync(path);
  if (!file.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path} is not a PNG`);

  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const parts = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const kind = file.toString('ascii', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
    } else if (kind === 'IDAT') {
      parts.push(body);
    } else if (kind === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  if (depth !== 8) throw new Error(`only 8-bit PNGs, got ${depth}`);
  const channels = colour === 6 ? 4 : colour === 2 ? 3 : 0;
  if (!channels) throw new Error(`only RGB/RGBA PNGs, got colour type ${colour}`);

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prior = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prior[i];
      const c = i >= channels ? prior[i - channels] : 0;
      switch (filter) {
        case 1: line[i] = (line[i] + a) & 255; break;
        case 2: line[i] = (line[i] + b) & 255; break;
        case 3: line[i] = (line[i] + ((a + b) >> 1)) & 255; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
          break;
        }
        default: break;
      }
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    prior = line;
  }
  return { width, height, data: out };
}
