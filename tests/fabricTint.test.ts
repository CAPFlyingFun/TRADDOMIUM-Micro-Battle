/**
 * A custom fabric colour (src/sarahlab/fabricTint.ts): untrusted input is read strictly, the sRGB curve round-trips
 * every byte, and dyeing the White swatch in linear light turns its average into the tint while keeping the weave's
 * light and dark as ratios and leaving alpha alone.
 */
import { describe, expect, it } from 'vitest';
import {
  TINT_BASE_COLOUR, hexToLinear, linearToSrgb, readTint, srgbToLinear, tintLabel, tintPixels,
} from '../src/sarahlab/fabricTint';

/** The IEC curve on a fractional byte: the bounds of what a rounded byte can stand for. */
const linF = (b: number): number => {
  const s = Math.min(1, Math.max(0, b / 255));
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const patch = (pixels: readonly (readonly number[])[]): Uint8ClampedArray => new Uint8ClampedArray(pixels.flat());
const bytes = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

describe('readTint', () => {
  it('keeps a valid colour, lower-cased', () => {
    expect(readTint('#AbCdEf')).toBe('#abcdef');
    expect(readTint('#c61e38')).toBe('#c61e38');
  });

  it('rejects anything else, without trimming', () => {
    for (const v of ['abcdef', '#abc', '#abcdefa', 'red', 123, null, undefined, '#gggggg', ' #abcdef', '#abcdef ']) {
      expect(readTint(v), String(v)).toBeNull();
    }
  });

  it('dyes the White swatch', () => {
    expect(TINT_BASE_COLOUR).toBe(0);
  });
});

describe('srgbToLinear and linearToSrgb', () => {
  it('pins the ends and the middle of the curve', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBe(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3);
  });

  it('round-trips every byte', () => {
    for (let b = 0; b < 256; b++) expect(linearToSrgb(srgbToLinear(b)), `byte ${b}`).toBe(b);
  });

  it('clamps out-of-range light', () => {
    expect(linearToSrgb(-1)).toBe(0);
    expect(linearToSrgb(2)).toBe(255);
  });
});

describe('tintPixels', () => {
  const BASE = '#ededee', TINT = '#c61e38';

  it('turns a patch of exactly the base colour into exactly the tint', () => {
    const b = bytes(BASE), data = patch(Array.from({ length: 16 }, () => [...b, 255]));
    tintPixels(data, TINT, BASE);
    const t = bytes(TINT);
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) expect(Math.abs(data[i + c] - t[c])).toBeLessThanOrEqual(1);
    }
  });

  it('leaves black black', () => {
    const data = patch([[0, 0, 0, 255], [0, 0, 0, 7]]);
    tintPixels(data, TINT, BASE);
    expect([...data]).toEqual([0, 0, 0, 255, 0, 0, 0, 7]);
  });

  it('never touches alpha', () => {
    const alphas = [0, 1, 64, 128, 200, 254, 255];
    const data = patch(alphas.map((a, i) => [230 - i * 10, 120 + i * 5, 40 + i * 20, a]));
    tintPixels(data, TINT, BASE);
    expect(alphas.map((_, i) => data[i * 4 + 3])).toEqual(alphas);
  });

  it('keeps the weave: two threads in ratio r stay in ratio r, within rounding', () => {
    // A light and a dark thread of the White knit, dyed by the strong red and by a soft blue, which leaves every
    // channel well above the bottom of the curve where one byte is a large step.
    for (const tint of [TINT, '#b4c8e6']) {
      const light = [236, 232, 240], dark = [150, 140, 160];
      const data = patch([[...light, 255], [...dark, 255]]);
      tintPixels(data, tint, BASE);
      const channels = tint === TINT ? [0] : [0, 1, 2]; // red's green and blue fall to the curve's coarse floor
      for (const c of channels) {
        const r = srgbToLinear(light[c]) / srgbToLinear(dark[c]);
        const o1 = data[c], o2 = data[4 + c];
        expect(o1, `${tint} channel ${c} not clipped`).toBeLessThan(255);
        expect(r, `${tint} channel ${c}`).toBeGreaterThanOrEqual(linF(o1 - 0.5) / linF(o2 + 0.5));
        expect(r, `${tint} channel ${c}`).toBeLessThanOrEqual(linF(o1 + 0.5) / linF(o2 - 0.5));
      }
    }
  });

  it('dyes pure white grey when the base is pure white', () => {
    const data = patch([[255, 255, 255, 255]]);
    tintPixels(data, '#808080', '#ffffff');
    expect([...data]).toEqual([128, 128, 128, 255]);
  });

  it('dyes a 512 x 512 swatch quickly', () => {
    const data = new Uint8ClampedArray(512 * 512 * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37 + (i >> 9) * 11) & 255;
    const alpha = data[3];
    const t0 = performance.now();
    tintPixels(data, TINT, BASE);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(data[3]).toBe(alpha);
  });
});

describe('hexToLinear', () => {
  it('is srgbToLinear per channel', () => {
    expect(hexToLinear('#c61e38')).toEqual([srgbToLinear(0xc6), srgbToLinear(0x1e), srgbToLinear(0x38)]);
    expect(hexToLinear('#C61E38')).toEqual(hexToLinear('#c61e38'));
  });

  it('throws on something that is not a colour', () => {
    expect(() => hexToLinear('nope')).toThrow();
  });
});

describe('tintLabel', () => {
  it('upper-cases', () => {
    expect(tintLabel('#c61e38')).toBe('#C61E38');
  });
});
