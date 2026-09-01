/**
 * THE RASTER THE FOREST GROWS FROM — decoded from the real file.
 *
 * `decodeVeg` threw on `public/kauai-veg.bin` from the day it was
 * written: the magic was typed as the four letters in file order, and
 * a little-endian read returns them reversed. Nothing noticed for four
 * days because nothing called `loadVeg`. This test reads the bake's
 * own output, so the constant and the file can never disagree in
 * silence again.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BARE, GRASS, SHRUB, TREE, VEG_BYTES, WATER, coverAt, decodeVeg, forgetVeg, haveVeg,
} from '../src/world/landcover';
import { geoToWorld } from '../src/world/geo';
import { SPAN } from '../src/world/kauai';

function bytes(): ArrayBuffer {
  const buf = readFileSync('public/kauai-veg.bin');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('the baked raster', () => {
  beforeAll(() => { decodeVeg(bytes()); });
  afterAll(() => { forgetVeg(); });

  it('decodes the REAL file, magic and all', () => {
    expect(haveVeg()).toBe(true);
  });

  it('and the file starts with the letters TMBV, in that order', () => {
    // The bake writes `b"TMBV"` — see scripts/bakeVeg.py. What tripped
    // the decoder was the constant, not the file.
    const head = new Uint8Array(bytes(), 0, 4);
    expect(String.fromCharCode(...head)).toBe('TMBV');
  });

  it('and is exactly as big as the loading code claims', () => {
    expect(bytes().byteLength).toBe(VEG_BYTES);
  });

  it('measures like Kauaʻi — the numbers the bake recorded', () => {
    // scripts/bakeVeg.py: 54.3% water, 28.9% tree, 14.0% grass, 2.0%
    // shrub over the 56 km square. Sampled on a grid rather than read
    // off the planes, so it is the SAME query the game makes.
    const counts = new Map<number, number>();
    let canopy = 0;
    let land = 0;
    const N = 384;
    for (let v = 0; v < N; v++) {
      for (let u = 0; u < N; u++) {
        const wx = -SPAN / 2 + (u / (N - 1)) * SPAN;
        const wz = -SPAN / 2 + (v / (N - 1)) * SPAN;
        const c = coverAt(wx, wz);
        counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
        if (c.kind !== WATER) { canopy += c.canopy * 255; land++; }
      }
    }
    const share = (kind: number): number => (counts.get(kind) ?? 0) / (N * N);
    expect(share(WATER)).toBeCloseTo(0.543, 2);
    expect(share(TREE)).toBeCloseTo(0.289, 2);
    expect(share(GRASS)).toBeCloseTo(0.140, 2);
    expect(share(SHRUB)).toBeCloseTo(0.020, 2);
    expect(canopy / land).toBeCloseTo(167, 0);
    expect(share(BARE)).toBeGreaterThan(0);
  });

  it('calls Wailua Forest forest and Kōloa Fields grass', () => {
    // Two of the spawn regions, by their own coordinates (spawn.ts).
    const wailua = coverAt(geoToWorld({ lat: 22.043, lon: -159.395 }).wx,
      geoToWorld({ lat: 22.043, lon: -159.395 }).wz);
    expect(wailua.kind).toBe(TREE);
    expect(wailua.canopy).toBeGreaterThan(0.8);
    const koloa = geoToWorld({ lat: 21.907, lon: -159.470 });
    expect(coverAt(koloa.wx, koloa.wz).kind).toBe(GRASS);
  });

  it('and reads open sea for anywhere off the square', () => {
    expect(coverAt(SPAN, SPAN).kind).toBe(WATER);
  });
});

describe('without the raster', () => {
  it('everything is water, so nothing grows', () => {
    forgetVeg();
    expect(haveVeg()).toBe(false);
    expect(coverAt(0, 0).kind).toBe(WATER);
  });

  it('and a corrupt file is refused rather than half-read', () => {
    const bad = bytes().slice(0, 100);
    expect(() => decodeVeg(bad)).toThrow();
    expect(haveVeg()).toBe(false);
  });
});
