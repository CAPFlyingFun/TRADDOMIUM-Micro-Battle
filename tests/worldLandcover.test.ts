/**
 * The landcover raster, decoded from the file that ships — not from a
 * fixture that agrees with the decoder by construction.
 *
 * The numbers are the survey's own (docs/research/LANDSCAPE_PORT.md §1):
 * 54.3% water, 28.9% tree, 14.0% grass, 2.0% shrub over the square,
 * Wailua Forest reading TREE with canopy above 0.8, Kōloa Fields
 * reading GRASS. If the binary is ever re-baked they move, and this
 * test is where that shows up.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { world } from '../src/world/coords';
import { ISLAND_HALF_SPAN } from '../src/world/dem';
import { geoToWorld } from '../src/world/geo';
import {
  GRASS, Landcover, OPEN_SEA, SHRUB, TREE, VEG_BYTES, VEG_HEADER_BYTES, VEG_MAGIC, VEG_SIDE, WATER, decodeVeg,
} from '../src/world/landcover';
import { VEG_PATH } from '../src/assets/vegSource';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function shipped(): ArrayBuffer {
  const bytes = readFileSync(path.join(ROOT, 'public', VEG_PATH));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('the shipped landcover raster', () => {
  const buffer = shipped();
  const cover = decodeVeg(buffer);

  it('is the file the bake wrote: TMBV, version 1, 384², 442,380 bytes', () => {
    expect(buffer.byteLength).toBe(VEG_BYTES);
    expect(VEG_BYTES).toBe(442_380);
    expect(new Uint8Array(buffer, 0, 4)).toEqual(new Uint8Array([0x54, 0x4d, 0x42, 0x56]));
    expect(new DataView(buffer).getUint32(0, true)).toBe(VEG_MAGIC);
    expect(cover.side).toBe(VEG_SIDE);
    expect(VEG_HEADER_BYTES).toBe(12);
  });

  it('carries the survey\'s own class shares', () => {
    const shares = cover.shares();
    expect(shares[WATER]).toBeCloseTo(0.543, 2);
    expect(shares[TREE]).toBeCloseTo(0.289, 2);
    expect(shares[GRASS]).toBeCloseTo(0.140, 2);
    expect(shares[SHRUB]).toBeCloseTo(0.020, 2);
  });

  it('puts forest in the Wailua and pasture at Kōloa — the names are Kauaʻi\'s', () => {
    const wailua = cover.classAt(geoToWorld({ lat: 22.043, lon: -159.395 }));
    expect(wailua.kind).toBe(TREE);
    expect(wailua.canopy).toBeGreaterThan(0.8);
    const koloa = cover.classAt(geoToWorld({ lat: 21.907, lon: -159.470 }));
    expect(koloa.kind).toBe(GRASS);
    // And the weights say the same thing, without a wall between them.
    expect(cover.mixAt(geoToWorld({ lat: 22.043, lon: -159.395 })).tree).toBeGreaterThan(0.75);
    expect(cover.mixAt(geoToWorld({ lat: 21.907, lon: -159.470 })).grass).toBeGreaterThan(0.5);
  });

  it('reads as open sea off the grid and at the survey\'s corners', () => {
    expect(cover.classAt(world(ISLAND_HALF_SPAN * 2, ISLAND_HALF_SPAN * 2)).kind).toBe(WATER);
    expect(cover.mixAt(world(ISLAND_HALF_SPAN * 3, 0))).toEqual(OPEN_SEA);
    expect(cover.mixAt(world(Number.NaN, 0))).toEqual(OPEN_SEA);
    expect(cover.classAt(world(-ISLAND_HALF_SPAN, -ISLAND_HALF_SPAN)).kind).toBe(WATER);
  });

  it('mixes to weights that sum to one and blend across a pixel rather than stepping', () => {
    // Walk east across the Wailua forest edge in 10 m steps: every mix
    // sums to one, and no single step moves the tree weight by more than
    // a pixel's worth of blend allows (a nearest read would step 0→1).
    const from = geoToWorld({ lat: 22.043, lon: -159.395 });
    let prev = cover.mixAt(from).tree;
    let maxStep = 0;
    for (let d = 1000; d <= 600_000; d += 1000) {
      const mix = cover.mixAt(world(from.wx + d, from.wz));
      const sum = mix.tree + mix.shrub + mix.grass + mix.bare + mix.water + mix.wetland;
      expect(sum).toBeCloseTo(1, 9);
      expect(mix.canopy).toBeGreaterThanOrEqual(0);
      expect(mix.canopy).toBeLessThanOrEqual(1);
      maxStep = Math.max(maxStep, Math.abs(mix.tree - prev));
      prev = mix.tree;
    }
    expect(maxStep).toBeLessThan(0.15);
    expect(maxStep).toBeGreaterThan(0);
  });

  it('refuses a truncated, mislabelled or wrong-sized file rather than half-reading it', () => {
    expect(() => decodeVeg(buffer.slice(0, 100))).toThrow(/bytes/);
    expect(() => decodeVeg(buffer.slice(0, 8))).toThrow(/not a file/);
    const wrongMagic = buffer.slice(0);
    new DataView(wrongMagic).setUint32(0, 0x564d4254, true);
    expect(() => decodeVeg(wrongMagic)).toThrow(/TMBV/);
    const wrongVersion = buffer.slice(0);
    new DataView(wrongVersion).setUint16(4, 2, true);
    expect(() => decodeVeg(wrongVersion)).toThrow(/version 2/);
    const wrongSide = buffer.slice(0);
    new DataView(wrongSide).setUint32(8, 512, true);
    expect(() => decodeVeg(wrongSide)).toThrow(/512 pixels/);
  });

  it('copies the planes out of the download, so the buffer can be let go', () => {
    const own = shipped();
    const c = new Landcover(own);
    const before = c.classAt(geoToWorld({ lat: 22.043, lon: -159.395 })).kind;
    new Uint8Array(own).fill(0);
    expect(c.classAt(geoToWorld({ lat: 22.043, lon: -159.395 })).kind).toBe(before);
  });
});
