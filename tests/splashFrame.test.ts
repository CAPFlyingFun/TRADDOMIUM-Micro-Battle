/**
 * The generated splash frame as facts: the bar's rectangle is measured
 * off the art by scripts/bakeArt.mjs, so these pin what any sane
 * measurement must satisfy rather than the numbers themselves — re-cut
 * art may move the bar, but it may not turn it inside out, and the file
 * each frame names must be a baked asset the page can actually fetch.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPLASH_LANDSCAPE, SPLASH_PORTRAIT, splashFor, type SplashCut } from '../src/ui/splash/splashFrame';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const CUTS: readonly [string, SplashCut][] = [
  ['landscape', SPLASH_LANDSCAPE],
  ['portrait', SPLASH_PORTRAIT],
];

describe('splashFrame (generated)', () => {
  it.each(CUTS)('%s: the bar is a rectangle strictly inside the picture', (_name, cut) => {
    expect(cut.left).toBeGreaterThan(0);
    expect(cut.left).toBeLessThan(cut.right);
    expect(cut.right).toBeLessThan(1);
    expect(cut.top).toBeGreaterThan(0);
    expect(cut.top).toBeLessThan(cut.bottom);
    expect(cut.bottom).toBeLessThan(1);
  });

  it.each(CUTS)('%s: the bar is a bar — much wider than it is tall, in pixels', (_name, cut) => {
    // Fractions of different axes: width in pixels is (right-left)·W,
    // height is (bottom-top)·H = (bottom-top)·W/ratio.
    const wide = cut.right - cut.left;
    const tall = (cut.bottom - cut.top) / cut.ratio;
    expect(wide / tall).toBeGreaterThan(4);
  });

  it.each(CUTS)('%s: the bar sits under the wordmark, in the lower half, with room for a caption below', (_name, cut) => {
    expect(cut.top).toBeGreaterThan(0.5);
    expect(cut.bottom).toBeLessThan(0.94);
  });

  it('has a landscape picture near 16:9, cut out, and a portrait one near 9:16, drawn on', () => {
    expect(SPLASH_LANDSCAPE.kind).toBe('cutout');
    expect(SPLASH_LANDSCAPE.ratio).toBeGreaterThan(1.6);
    expect(SPLASH_LANDSCAPE.ratio).toBeLessThan(1.9);
    expect(SPLASH_PORTRAIT.kind).toBe('drawn');
    expect(SPLASH_PORTRAIT.ratio).toBeGreaterThan(0.5);
    expect(SPLASH_PORTRAIT.ratio).toBeLessThan(0.65);
    expect(SPLASH_LANDSCAPE.file).not.toBe(SPLASH_PORTRAIT.file);
  });

  it.each(CUTS)('%s: names a baked file under public/', (_name, cut) => {
    expect(cut.file).toMatch(/^[\w-]+\.webp$/);
    expect(existsSync(path.join(ROOT, 'public', cut.file)), `public/${cut.file} is missing — run npm run bake:art`).toBe(true);
  });

  it('picks the picture composed for the shape of the screen', () => {
    expect(splashFor(932, 430)).toBe(SPLASH_LANDSCAPE);
    expect(splashFor(430, 932)).toBe(SPLASH_PORTRAIT);
    // Square is landscape: the game is landscape, and the cut-out art is the better one.
    expect(splashFor(500, 500)).toBe(SPLASH_LANDSCAPE);
  });
});
