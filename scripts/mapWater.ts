/**
 * THE ISLAND'S WATER, FROM ABOVE, drawn from what the game actually
 * answers rather than from what the bake intended.
 *
 * Every pixel asks the two functions the game asks: `groundHeight` for
 * the surface she stands on, and `waterLevelAt` for the surface the
 * water stands at. Wet is the second beating the first, which is the
 * same rule the renderer's depth test and the survival code use, so
 * this map cannot flatter the water — if a stream shows here and not in
 * the game, or the other way round, that is a real disagreement and not
 * a difference of method.
 *
 * It reads the SHIPPED bake and the SHIPPED grid at the dials the bake
 * was made with, which is the whole point: this is the tweaked island,
 * not real Kauai and not the raw grid.
 *
 *   npx vite-node scripts/mapWater.ts [pixels]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodeGrid, SPAN } from '../src/world/kauai';
import { groundHeight, setRelief, setSmoothing, useGrid } from '../src/world/heightfield';
import { decodeFlow, useFlow, waterLevelAt, pondLevelAt, type Flow } from '../src/world/flow';
import { DEFAULTS } from '../src/ui/settings';
import { readFileSync } from 'node:fs';

const SIDE = Number(process.argv[2] ?? 1600);
const OUT = 'kauai-water-map.png';

const file = readFileSync('public/kauai-1025.bin');
useGrid(decodeGrid(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)));
setSmoothing(DEFAULTS.terrainSmoothing);
setRelief(DEFAULTS.terrainRelief);
const bin = readFileSync('public/kauai-flow.bin');
const flow: Flow = decodeFlow(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
useFlow(flow);

const step = SPAN / SIDE;
const px = new Uint8Array(SIDE * SIDE * 3);
let land = 0, wet = 0, ponded = 0;

/** Land colour by height, low green through to bare summit grey. */
function ground(h: number): [number, number, number] {
  const m = h / 100;
  const t = Math.min(1, m / 1200);
  if (t < 0.35) {
    const u = t / 0.35;
    return [70 + 60 * u, 95 + 45 * u, 55 + 25 * u];
  }
  const u = (t - 0.35) / 0.65;
  return [130 + 60 * u, 140 + 45 * u, 80 + 80 * u];
}

const started = Date.now();
for (let y = 0; y < SIDE; y++) {
  const wz = (y + 0.5) * step - SPAN / 2;
  for (let x = 0; x < SIDE; x++) {
    const wx = (x + 0.5) * step - SPAN / 2;
    const at = (y * SIDE + x) * 3;
    const g = groundHeight(wx, wz);
    if (g <= 0) {                       // the sea
      px[at] = 18; px[at + 1] = 38; px[at + 2] = 62;
      continue;
    }
    land++;
    const level = waterLevelAt(wx, wz);
    if (level !== null && level > g) {
      wet++;
      const deep = Math.min(1, (level - g) / 200);      // 2 m to full
      const pond = pondLevelAt(wx, wz) !== null;
      if (pond) ponded++;
      // Standing water reads greener, running water bluer, so the two
      // can be told apart at a glance without a second map.
      px[at] = Math.round((pond ? 40 : 30) * (1 - deep) + 10 * deep);
      px[at + 1] = Math.round((pond ? 170 : 120) * (1 - deep) + 40 * deep);
      px[at + 2] = Math.round((pond ? 150 : 220) * (1 - deep) + 110 * deep);
      continue;
    }
    // A cheap hillshade so the valleys the water sits in are readable.
    const dx = groundHeight(wx + step, wz) - g;
    const dz = groundHeight(wx, wz + step) - g;
    const lit = Math.max(0.45, Math.min(1.35, 1 - (dx + dz) / (step * 0.55)));
    const [r, gg, b] = ground(g);
    px[at] = Math.min(255, Math.round(r * lit));
    px[at + 1] = Math.min(255, Math.round(gg * lit));
    px[at + 2] = Math.min(255, Math.round(b * lit));
  }
  if (y % 100 === 0) process.stderr.write(`  row ${y}/${SIDE}\r`);
}

/** Minimal PNG: one IHDR, one deflated IDAT, one IEND. */
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                          // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3)
      .copy(raw, y * (w * 3 + 1) + 1);
  }
  const chunk = (tag: string, body: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const name = Buffer.from(tag, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, body])) >>> 0);
    return Buffer.concat([len, name, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TABLE: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!TABLE) {
    TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

writeFileSync(OUT, png(SIDE, SIDE, px));
console.log(`\n${SIDE}x${SIDE} over ${(SPAN / 100000).toFixed(0)} km`
  + `  = ${(step / 100).toFixed(0)} m a pixel  in ${((Date.now() - started) / 1000).toFixed(0)}s`);
console.log(`  smoothing ${DEFAULTS.terrainSmoothing}  height ${DEFAULTS.terrainRelief}`
  + '  — the dials the bake was made at');
console.log(`  land ${land.toLocaleString()} px,`
  + ` fresh water ${wet.toLocaleString()} (${(100 * wet / land).toFixed(2)}% of land),`
  + ` of which ponded ${ponded.toLocaleString()}`);
console.log(`  wrote ${OUT}`);
