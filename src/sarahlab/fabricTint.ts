/**
 * A CUSTOM FABRIC COLOUR is the family's White swatch, dyed. Each family's atlas has sixteen fixed colours; any other
 * colour is made from the White one (`TINT_BASE_COLOUR`) by scaling every pixel, channel by channel, by tint / base,
 * where `base` is that swatch's measured average (`SWATCH_HEX[family][0]` in `fabricLibrary.ts`).
 *
 * The scale is applied in LINEAR light, not to sRGB bytes. A knit's highlights and shadows are ratios of light; a
 * multiply in linear light keeps those ratios, so the weave survives and only its colour changes, and a swatch whose
 * average is `base` comes out averaging `tint`. The same multiply on gamma-encoded bytes would crush the dark threads
 * and flatten the knit. Alpha is never touched: hosiery's sheerness belongs to the editor, not to the colour.
 *
 * Pure arithmetic on numbers and `Uint8ClampedArray`: no DOM, no three.js, no storage. The caller cuts the swatch.
 */

/** A custom colour as kept: '#rrggbb', lower case. */
export const TINT_PATTERN: RegExp = /^#[0-9a-f]{6}$/i;

/** The swatch a custom colour dyes: each family's White. */
export const TINT_BASE_COLOUR = 0;

/** Below this a base channel is treated as this, so a black base cannot divide by zero. */
const MIN_BASE = 1e-4;

/** A custom colour from untrusted input (a saved file, a colour input): the lower-cased '#rrggbb', or null. No trimming: ' #abcdef' is null. */
export function readTint(v: unknown): string | null {
  return typeof v === 'string' && TINT_PATTERN.test(v) ? v.toLowerCase() : null;
}

/** sRGB byte to linear light, IEC 61966-2-1, built once. */
const LINEAR = (() => {
  const t = new Float64Array(256);
  for (let b = 0; b < 256; b++) {
    const s = b / 255;
    t[b] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }
  return t;
})();

/** One sRGB byte (0..255) to linear light 0..1 (IEC 61966-2-1 piecewise curve). From a 256-entry table built once. */
export function srgbToLinear(byte: number): number {
  // Rounded and clamped so a stray float or NaN reads a real entry rather than undefined.
  return LINEAR[byte > 0 ? (byte < 255 ? Math.round(byte) : 255) : 0];
}

/** Linear light (any number) to an sRGB byte 0..255, rounded, clamped. */
export function linearToSrgb(x: number): number {
  if (!(x > 0)) return 0; // also NaN
  if (x >= 1) return 255;
  const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

/** '#rrggbb' to linear [r, g, b]. Throws on an invalid hex; callers pass readTint's output. */
export function hexToLinear(hex: string): [number, number, number] {
  if (!TINT_PATTERN.test(hex)) throw new Error(`fabricTint: not a '#rrggbb' colour: ${JSON.stringify(hex)}`);
  const n = parseInt(hex.slice(1), 16);
  return [srgbToLinear((n >> 16) & 255), srgbToLinear((n >> 8) & 255), srgbToLinear(n & 255)];
}

/**
 * Dye RGBA bytes in place: channel c of every pixel becomes linearToSrgb(srgbToLinear(c) * tint_c / base_c), with a
 * base channel at or below 1e-4 treated as 1e-4. Alpha untouched. Fast: build one 256-entry output table per
 * channel (the factor is constant per channel), then 3 lookups a pixel. A 512×512 swatch must take well under 50 ms.
 */
export function tintPixels(data: Uint8ClampedArray, tint: string, base: string): void {
  const t = hexToLinear(tint), b = hexToLinear(base);
  const tables = [0, 1, 2].map((c) => {
    const factor = t[c] / Math.max(b[c], MIN_BASE);
    const out = new Uint8Array(256);
    for (let v = 0; v < 256; v++) out[v] = linearToSrgb(LINEAR[v] * factor);
    return out;
  });
  const [r, g, bl] = tables;
  const end = data.length - (data.length % 4); // whole pixels only
  for (let i = 0; i < end; i += 4) {
    data[i] = r[data[i]];
    data[i + 1] = g[data[i + 1]];
    data[i + 2] = bl[data[i + 2]];
  }
}

/** A colour for a label: '#C61E38' (upper case). */
export function tintLabel(hex: string): string {
  return hex.toUpperCase();
}
